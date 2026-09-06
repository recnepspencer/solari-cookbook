import {
  createSchema,
  validateCandidateReplay,
  type Application,
  type CandidateReplayInput,
  type Clock,
  type Condition,
  type IdSource,
  type JsonValue,
  type PartialEffectPosture,
  type ReasoningModel,
  type ReplayStep,
  type Schema,
  type SolariPort,
  type ValidationResult,
} from "@interface-compiler/domain"
import { ExperimentRunner, type ExperimentRunResult, type ExperimentTerminal } from "./runner.js"
import { planDirectExperiment, type DirectDecision } from "./planning.js"
import type { OperationController } from "./operation.js"
import type { OrchestratorWorthPort } from "./worth-ports.js"
import type { SemanticVerifier } from "./semantic-verifier.js"
import type { ExperimentStepPolicy } from "./step-policy.js"

type DegradedAuthority = { readonly capability: import("@interface-compiler/domain").CapabilityProjection; readonly replay: import("@interface-compiler/domain").ReplayProjection }

export interface ReplayDiscoveryPorts {
  readonly clock: Clock
  readonly ids: Pick<IdSource, "nextExecutionId" | "nextEventId" | "nextExperimentId" | "nextReplayVersionId">
  readonly worth: OrchestratorWorthPort
  readonly solari: SolariPort
  readonly model: ReasoningModel
  readonly verifier: SemanticVerifier
}

export interface ReplayDiscoveryRequest {
  readonly degradation: DegradedAuthority
  readonly application: Application
  readonly objective: string
  readonly input?: JsonValue
  readonly expectedOutcome: readonly Condition[]
}

export type ReplayDiscoveryResult =
  | {
      readonly kind: "discovered"
      readonly candidate: CandidateReplayInput
      readonly exploration: Extract<ExperimentRunResult, { readonly kind: "attempted" }>
    }
  | {
      readonly kind: "blocked"
      readonly stage: "degradation" | "planning" | "exploration" | "candidate"
      readonly reason: "cancelled" | "timed_out" | "budget_exhausted" | "discovery_failed"
      readonly message: string
      readonly retryable: boolean
      readonly exploration?: ExperimentRunResult
      readonly posture?: PartialEffectPosture
    }

/**
 * Runs Gemini as a WORTH-admitted direct explorer. The model contributes only
 * actions it actually executed through Solari. Identity, lineage, version,
 * chronology, confidence, and contract assertions are constructed outside the
 * model and remain subject to WORTH candidate admission.
 */
export async function discoverReplacementReplay(
  request: ReplayDiscoveryRequest,
  ports: ReplayDiscoveryPorts,
  controller: OperationController,
): Promise<ReplayDiscoveryResult> {
  const degraded = request.degradation
  if (degraded.capability.status !== "degraded" || degraded.replay.status !== "broken" || degraded.capability.id !== degraded.replay.capabilityId || degraded.capability.brokenReplayVersionId !== degraded.replay.id) {
    return { kind: "blocked", stage: "degradation", reason: "discovery_failed", message: "WORTH did not issue a matching degraded capability and broken replay", retryable: false }
  }
  if (request.expectedOutcome.length === 0) {
    return { kind: "blocked", stage: "planning", reason: "discovery_failed", message: "replay discovery requires an explicit semantic postcondition", retryable: false }
  }

  const experimentId = ports.ids.nextExperimentId()
  const planned = planDirectExperiment({
    application: request.application,
    capabilityId: degraded.capability.id,
    experimentId,
    objective: request.objective,
    ...(request.input === undefined ? {} : { input: request.input }),
    expectedOutcome: request.expectedOutcome,
  }, { continueAfterUnverifiedCompletion: true })
  if (!planned.ok) return { kind: "blocked", stage: "planning", reason: "discovery_failed", message: planned.issues.map((issue) => issue.message).join("; "), retryable: false }
  const decisionSchema = createSemanticDiscoveryDecisionSchema()
  if (!decisionSchema.ok) return { kind: "blocked", stage: "planning", reason: "discovery_failed", message: decisionSchema.issues.map((issue) => issue.message).join("; "), retryable: false }

  const exploration = await new ExperimentRunner({
    clock: ports.clock,
    ids: ports.ids,
    worth: ports.worth,
    solari: ports.solari,
    model: ports.model,
    verifier: ports.verifier,
    stepPolicy: semanticDiscoveryPolicy(request.application.baseUrl),
  }).run({ ...planned.value, decisionSchema: decisionSchema.value }, controller)
  if (exploration.kind !== "attempted" || exploration.terminal.kind !== "success" || exploration.terminal.successfulSteps === undefined || exploration.terminal.successfulSteps.length === 0) {
    return {
      kind: "blocked",
      stage: "exploration",
      reason: explorationStopReason(exploration),
      message: `Gemini did not complete a verified Solari exploration trace: ${describeExplorationFailure(exploration)}`,
      retryable: exploration.kind === "finalization_blocked" || (exploration.kind === "attempted" && exploration.terminal.kind === "control_stop"),
      exploration,
      posture: explorationPosture(exploration),
    }
  }

  let createdAt: string
  try {
    createdAt = ports.clock.now()
  } catch {
    return { kind: "blocked", stage: "candidate", reason: "discovery_failed", message: "candidate chronology could not be established", retryable: true, exploration }
  }
  const candidate: CandidateReplayInput = {
    id: ports.ids.nextReplayVersionId(),
    capabilityId: degraded.capability.id,
    version: degraded.replay.version + 1,
    steps: Object.freeze([
      Object.freeze({ type: "navigate" as const, url: request.application.baseUrl }),
      ...copySteps(exploration.terminal.successfulSteps),
      ...request.expectedOutcome.map((condition) => Object.freeze({ type: "assert" as const, condition: structuredClone(condition) })),
    ]),
    // Trust is earned by WORTH's independent verification runs, not model self-report.
    confidence: 0.5,
    discoveredFromExperimentId: experimentId,
    supersedes: degraded.replay.id,
    createdAt: createdAt as CandidateReplayInput["createdAt"],
  }
  const issues = validateCandidateReplay(candidate)
  if (issues.length > 0) return { kind: "blocked", stage: "candidate", reason: "discovery_failed", message: issues.map((issue) => issue.message).join("; "), retryable: false, exploration }
  return { kind: "discovered", candidate, exploration }
}

function explorationPosture(exploration: ExperimentRunResult): PartialEffectPosture {
  const terminal = exploration.kind === "not_started" ? undefined : exploration.terminal
  const stop = exploration.kind === "not_started" ? exploration.stop : terminal?.kind === "control_stop" ? terminal.stop : undefined
  if (stop?.kind === "cancelled" || stop?.kind === "deadline_exceeded") return stop.posture
  if (terminal?.kind === "failure" && terminal.posture !== undefined) return terminal.posture
  return exploration.kind === "not_started" ? { kind: "not_started" } : { kind: "unknown", recovery: "owner_reconciliation_required" }
}

function explorationStopReason(exploration: ExperimentRunResult): Extract<ReplayDiscoveryResult, { readonly kind: "blocked" }>["reason"] {
  const terminal = exploration.kind === "attempted" ? exploration.terminal : exploration.kind === "finalization_blocked" ? exploration.terminal : undefined
  const stop = terminal?.kind === "control_stop" ? terminal.stop.kind : exploration.kind === "not_started" ? exploration.stop?.kind : undefined
  if (stop === "cancelled") return "cancelled"
  if (stop === "deadline_exceeded") return "timed_out"
  if (stop === "budget_exhausted" || stop === "invalid_budget_request") return "budget_exhausted"
  return "discovery_failed"
}

function describeExplorationFailure(exploration: ExperimentRunResult): string {
  if (exploration.kind === "not_started") return exploration.message ?? exploration.reason
  if (exploration.kind === "finalization_blocked") {
    const terminal = exploration.terminal === undefined ? undefined : describeTerminal(exploration.terminal)
    return terminal === undefined ? exploration.message ?? exploration.reason : `${exploration.message ?? exploration.reason}; ${terminal}`
  }
  return describeTerminal(exploration.terminal)
}

function describeTerminal(terminal: ExperimentTerminal): string {
  switch (terminal.kind) {
    case "failure": return terminal.message
    case "safety_stop": return `stopped at ${terminal.stop.reason}`
    case "control_stop": return terminal.stop.kind === "budget_exhausted"
      ? `stopped by ${terminal.stop.resource} budget_exhausted at ${terminal.stop.limit}`
      : `stopped by ${terminal.stop.kind}`
    case "success": return "the model completed without any executable browser actions"
  }
}

function semanticDiscoveryPolicy(applicationBaseUrl: string): ExperimentStepPolicy {
  return {
    admit: (plan) => plan.kind !== "direct"
      ? { kind: "denied", message: "replay discovery requires a direct exploration plan" }
      : {
          kind: "admitted",
          guard: {
            admit: (step) => {
              const denial = discoveryStepDenial(step, applicationBaseUrl)
              return denial === undefined ? { kind: "admitted" } : { kind: "denied", message: denial }
            },
          },
        },
  }
}

function createSemanticDiscoveryDecisionSchema(): ValidationResult<Schema<DirectDecision>> {
  return createSchema<DirectDecision>({
    name: "interface_compiler_semantic_discovery_decision",
    json: {
      type: "object",
      additionalProperties: false,
      required: ["kind"],
      properties: {
        kind: { type: "string", enum: ["act", "complete"] },
        step: {
          type: "object",
          additionalProperties: false,
          required: ["type"],
          properties: {
            type: { type: "string", enum: ["click", "fill", "select", "wait"] },
            target: {
              type: "object",
              additionalProperties: false,
              required: ["semanticDescription"],
              properties: {
                semanticDescription: { type: "string" },
                role: { type: "string" },
                name: { type: "string" },
                text: { type: "string" },
              },
            },
            value: {},
            milliseconds: { type: "number", minimum: 0 },
          },
        },
        output: {},
      },
    },
  })
}

function discoveryStepDenial(step: ReplayStep, applicationBaseUrl: string): string | undefined {
  if (step.type === "navigate") return step.url === applicationBaseUrl ? undefined : "discovery navigation must target the WORTH-authorized application origin"
  if (step.type === "read" || step.type === "assert") return `Gemini proposed disallowed discovery step type ${step.type}`
  if (step.type === "wait") return step.milliseconds <= 2_000 ? undefined : `Gemini proposed wait ${step.milliseconds}ms above the 2000ms discovery limit`
  return step.target.selector === undefined ? undefined : `Gemini proposed a selector-bearing ${step.type} step`
}

function copySteps(steps: readonly ReplayStep[]): readonly ReplayStep[] {
  return steps.map((step) => Object.freeze(structuredClone(step)))
}
