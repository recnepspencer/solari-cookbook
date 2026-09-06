import { createApplication, matchesJsonSchema, type CapabilityId, type Clock, type IdSource, type JsonValue, type OperationContext, type PartialEffectPosture, type SolariPort } from "@interface-compiler/domain"
import { isDeepStrictEqual } from "node:util"
import type { ReasoningModel } from "@interface-compiler/domain"
import { createOperationController } from "./operation.js"
import { planCompiledExperiment } from "./planning.js"
import { coordinateReplayRecovery, resumeReplayRecovery, type CoordinatedRecoveryResult, type RecoveryContinuation } from "./recovery-coordinator.js"
import { ExperimentRunner } from "./runner.js"
import type { SemanticVerifier } from "./semantic-verifier.js"
import type { OrchestratorWorthPort } from "./worth-ports.js"
import type { CandidateVerificationEnvironment } from "./candidate-verifier.js"
import type { ReplayRecoveryResult } from "@interface-compiler/worth-adapter"

export interface SemanticCapabilityExecutorPorts {
  readonly clock: Clock
  readonly ids: Pick<IdSource, "nextExecutionId" | "nextEventId" | "nextExperimentId" | "nextReplayVersionId" | "nextVerificationRunId">
  readonly worth: OrchestratorWorthPort
  readonly solari: SolariPort
  readonly discoveryModel: ReasoningModel
  readonly verifier: SemanticVerifier
  readonly verificationEnvironment: CandidateVerificationEnvironment
}

export type SemanticCapabilityExecutionResult<TOutput = JsonValue> =
  | { readonly kind: "succeeded"; readonly output: TOutput; readonly executionId: string; readonly replayVersionId: string }
  | { readonly kind: "recovered"; readonly code: "capability_recovered"; readonly retryable: true; readonly failedReplayVersionId: string; readonly activeReplayVersionId: string }
  | { readonly kind: "invalid_input"; readonly message: string }
  | { readonly kind: "unavailable"; readonly message: string; readonly retryable: boolean }
  | { readonly kind: "interrupted"; readonly reason: "cancelled" | "timed_out"; readonly message: string; readonly retryable: true; readonly posture: PartialEffectPosture }
  | { readonly kind: "reconciliation_required"; readonly message: string; readonly retryable: true; readonly posture?: PartialEffectPosture }
  | { readonly kind: "failed"; readonly message: string; readonly retryable: boolean }

interface PendingRecovery {
  readonly inputIdentity: string
  readonly failedReplayVersionId: string
}

export class SemanticCapabilityExecutor {
  private readonly pendingRecoveries = new Map<CapabilityId, PendingRecovery>()
  public constructor(private readonly ports: SemanticCapabilityExecutorPorts) {}

  public async execute<TOutput>(capabilityId: CapabilityId, input: JsonValue, context: OperationContext): Promise<SemanticCapabilityExecutionResult<TOutput>> {
    const inputIdentity = canonicalJson(input)
    const capabilityRead = await this.ports.worth.readCapability(capabilityId, context)
    const capabilityInterruption = worthReadInterruption(capabilityRead)
    if (capabilityInterruption !== undefined) return capabilityInterruption
    if (capabilityRead.kind !== "found") return { kind: "unavailable", message: "WORTH did not expose a healthy semantic capability", retryable: capabilityRead.kind === "failed" ? capabilityRead.retryable : true }
    const capability = capabilityRead.value
    if (!matchesJsonSchema(input, capability.inputSchema)) return { kind: "invalid_input", message: "semantic capability input did not satisfy the WORTH contract" }

    const applicationRead = await this.ports.worth.readApplication(capability.applicationId, context)
    const applicationInterruption = worthReadInterruption(applicationRead)
    if (applicationInterruption !== undefined) return applicationInterruption
    if (applicationRead.kind !== "found") return { kind: "unavailable", message: "WORTH did not expose the capability application", retryable: true }
    const application = createApplication({ id: applicationRead.value.id, name: applicationRead.value.name, baseUrl: applicationRead.value.baseUrl })
    if (!application.ok) return { kind: "unavailable", message: "WORTH returned an invalid capability application", retryable: false }
    const controller = createOperationController({ admittedContext: context, clock: this.ports.clock })
    if (!controller.ok) return { kind: "invalid_input", message: controller.issues.map((issue) => issue.message).join("; ") }

    const pending = this.pendingRecoveries.get(capabilityId)
    if (pending !== undefined) {
      if (pending.inputIdentity !== inputIdentity) return { kind: "unavailable", message: "WORTH recovery is currently bound to a different semantic request", retryable: true }
      const authoritative = await this.ports.worth.readRecoveryProjection(capabilityId, context)
      if (authoritative.kind === "cancelled" || authoritative.kind === "timed_out") return interruption(authoritative.kind, `WORTH ${authoritative.kind === "cancelled" ? "cancelled" : "timed out"} recovery reconciliation`, authoritative.posture)
      if (authoritative.kind !== "found") return { kind: "reconciliation_required", message: recoveryProjectionMessage(authoritative), retryable: true }
      if (!matchesJsonSchema(input, authoritative.capability.inputSchema)) return { kind: "invalid_input", message: "semantic capability input no longer satisfies the current WORTH recovery contract" }
      if (authoritative.capability.status === "healthy" && authoritative.replay.status === "active") {
        if (authoritative.replay.id === pending.failedReplayVersionId) return { kind: "reconciliation_required", message: "WORTH still exposes the failed replay; no replacement activation is confirmed", retryable: true }
        this.pendingRecoveries.delete(capabilityId)
        return { kind: "recovered", code: "capability_recovered", retryable: true, failedReplayVersionId: pending.failedReplayVersionId, activeReplayVersionId: authoritative.replay.id }
      }
      const continuation: RecoveryContinuation | undefined = authoritative.capability.status === "degraded" && authoritative.replay.status === "broken"
        ? { kind: "degraded", degradation: { capability: authoritative.capability, replay: authoritative.replay } }
        : authoritative.capability.status === "verifying" && authoritative.replay.status === "verifying"
          ? { kind: "verifying", capability: authoritative.capability, replay: authoritative.replay }
          : undefined
      if (continuation === undefined) return { kind: "reconciliation_required", message: "WORTH did not expose a resumable recovery lifecycle", retryable: true }
      const resumed = await resumeReplayRecovery(continuation, application.value, input, { ...this.ports, model: this.ports.discoveryModel }, controller.value)
      return this.recoveryResult<TOutput>(capabilityId, inputIdentity, resumed, pending.failedReplayVersionId)
    }
    if (capability.status === "verifying" || capability.status === "degraded") return { kind: "unavailable", message: "WORTH recovery is resumable but this in-memory runtime does not retain its current continuation", retryable: true }

    const planned = await planCompiledExperiment({ application: application.value, capabilityId, experimentId: this.ports.ids.nextExperimentId(), objective: capability.description, input, preconditions: capability.preconditions, expectedOutcome: capability.postconditions }, this.ports.worth, context)
    if (planned.kind !== "planned") {
      if (planned.kind === "unavailable" && (planned.reason === "worth_cancelled" || planned.reason === "worth_timed_out")) return interruption(planned.reason === "worth_cancelled" ? "cancelled" : "timed_out", `WORTH ${planned.reason === "worth_cancelled" ? "cancelled" : "timed out"} semantic planning`)
      return { kind: "unavailable", message: planned.kind === "invalid_request" ? planned.issues.map((issue) => issue.message).join("; ") : planned.message ?? planned.reason, retryable: planned.kind !== "invalid_request" }
    }
    if (!matchesJsonSchema(input, planned.plan.capability.inputSchema)) return { kind: "invalid_input", message: "semantic capability input did not satisfy the current WORTH contract" }
    const run = await new ExperimentRunner({ clock: this.ports.clock, ids: this.ports.ids, worth: this.ports.worth, solari: this.ports.solari, verifier: this.ports.verifier }).run(planned.plan, controller.value)
    if (run.kind === "attempted" && run.terminal.kind === "success" && run.terminal.output !== undefined && matchesJsonSchema(run.terminal.output, planned.plan.capability.outputSchema) && run.settlement.kind === "settled" && run.settlement.projection.outcome.kind === "success" && isDeepStrictEqual(run.settlement.projection.outcome.output, run.terminal.output)) {
      return { kind: "succeeded", output: run.terminal.output as TOutput, executionId: run.executionId, replayVersionId: planned.plan.replay.id }
    }
    const appliedRecovery = run.kind !== "not_started" && run.recovery?.kind === "applied" ? run.recovery : undefined
    if (appliedRecovery?.capability.status === "degraded" && appliedRecovery.replay.status === "broken") {
      this.pendingRecoveries.set(capabilityId, { inputIdentity, failedReplayVersionId: planned.plan.replay.id })
      const recovered = await coordinateReplayRecovery(appliedRecovery, application.value, input, { ...this.ports, model: this.ports.discoveryModel }, controller.value)
      return this.recoveryResult<TOutput>(capabilityId, inputIdentity, recovered, planned.plan.replay.id)
    }
    if (run.kind === "finalization_blocked" && run.recovery !== undefined && recoveryMayHaveCommitted(run.recovery)) {
      this.pendingRecoveries.set(capabilityId, { inputIdentity, failedReplayVersionId: planned.plan.replay.id })
      return { kind: "reconciliation_required", message: "WORTH recovery may have committed; retry the same request to reconcile its authoritative lifecycle", retryable: true }
    }
    const controlResult = publicControlResult(run)
    if (controlResult !== undefined) return controlResult
    const message = semanticExecutionFailureMessage(run, planned.plan.capability.outputSchema)
    return { kind: "failed", message, retryable: run.kind === "attempted" && run.terminal.kind === "failure" ? run.terminal.retryable ?? true : run.kind !== "finalization_blocked" }
  }

  private recoveryResult<TOutput>(capabilityId: CapabilityId, inputIdentity: string, recovered: CoordinatedRecoveryResult, failedReplayVersionId: string): SemanticCapabilityExecutionResult<TOutput> {
    if (recovered.kind === "activated") {
      this.pendingRecoveries.delete(capabilityId)
      return { kind: "recovered", code: "capability_recovered", retryable: true, failedReplayVersionId, activeReplayVersionId: recovered.replay.id }
    }
    this.pendingRecoveries.set(capabilityId, { inputIdentity, failedReplayVersionId })
    if (recovered.reason === "cancelled" || recovered.reason === "timed_out") return interruption(recovered.reason, recovered.message, recovered.posture ?? { kind: "unknown", recovery: "owner_reconciliation_required" })
    if (recovered.reason === "reconciliation_required" || recovered.reason === "authority_changed") return { kind: "reconciliation_required", message: recovered.message, retryable: true }
    return recovered.retryable ? { kind: "unavailable", message: recovered.message, retryable: true } : { kind: "failed", message: recovered.message, retryable: false }
  }
}

function recoveryMayHaveCommitted(result: ReplayRecoveryResult): boolean {
  if (result.kind === "cancelled" || result.kind === "timed_out") return result.posture.kind !== "not_started"
  return result.kind === "committed_projection_unavailable" || result.kind === "unavailable" || result.kind === "authority_stopped"
}

function worthReadInterruption(result: { readonly kind: string; readonly posture?: PartialEffectPosture }): Extract<SemanticCapabilityExecutionResult, { readonly kind: "interrupted" }> | undefined {
  if (result.kind === "cancelled") return interruption("cancelled", "WORTH cancelled the semantic capability read", result.posture)
  return result.kind === "timed_out" ? interruption("timed_out", "WORTH timed out the semantic capability read", result.posture) : undefined
}

function interruption(reason: "cancelled" | "timed_out", message: string, posture: PartialEffectPosture = { kind: "not_started" }): Extract<SemanticCapabilityExecutionResult, { readonly kind: "interrupted" }> {
  return { kind: "interrupted", reason, message, retryable: true, posture }
}

function publicControlResult(run: Awaited<ReturnType<ExperimentRunner["run"]>>): Extract<SemanticCapabilityExecutionResult, { readonly kind: "interrupted" | "reconciliation_required" }> | undefined {
  const terminal = run.kind === "not_started" ? undefined : run.terminal
  const stop = run.kind === "not_started" ? run.stop : terminal?.kind === "control_stop" ? terminal.stop : undefined
  if (stop?.kind !== "cancelled" && stop?.kind !== "deadline_exceeded") return undefined
  const reason = stop.kind === "cancelled" ? "cancelled" : "timed_out"
  if (stop.posture.kind === "not_started") return interruption(reason, `semantic capability execution was ${reason === "cancelled" ? "cancelled" : "timed out"} before its next effect`, stop.posture)
  return { kind: "reconciliation_required", message: `semantic capability execution was ${reason === "cancelled" ? "cancelled" : "timed out"} after an effect may have occurred`, retryable: true, posture: stop.posture }
}

function recoveryProjectionMessage(result: Exclude<Awaited<ReturnType<OrchestratorWorthPort["readRecoveryProjection"]>>, { readonly kind: "found" | "cancelled" | "timed_out" }>): string {
  return result.kind === "not_found" ? "WORTH no longer retains the pending recovery projection" : result.message
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`
}

function semanticExecutionFailureMessage(
  run: Awaited<ReturnType<ExperimentRunner["run"]>>,
  outputSchema: import("@interface-compiler/domain").JsonSchema,
): string {
  if (run.kind === "not_started") return run.message ?? run.reason
  if (run.kind === "finalization_blocked") return run.message ?? run.reason
  if (run.terminal.kind === "failure") return run.terminal.message
  if (run.terminal.kind === "safety_stop") return `semantic capability stopped at the ${run.terminal.stop.reason} safety boundary`
  if (run.terminal.kind === "control_stop") return `semantic capability stopped before completion: ${run.terminal.stop.kind}`
  if (run.terminal.output === undefined) return "semantic capability verifier did not return a typed output"
  if (!matchesJsonSchema(run.terminal.output, outputSchema)) return "semantic capability output did not satisfy the WORTH contract"
  if (run.settlement.kind !== "settled") return `WORTH did not settle the verified semantic output: ${run.settlement.kind}`
  if (run.settlement.projection.outcome.kind !== "success") return "WORTH settled the verified semantic output with a non-success outcome"
  return "WORTH settlement did not retain the exact verified semantic output"
}
