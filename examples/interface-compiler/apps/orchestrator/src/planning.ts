import {
  createSchema,
  validateCondition,
  isJsonValue,
  validateApplication,
  validateReplayStep,
  validateSafetySignal,
  type ActiveReplayProjection,
  type Application,
  type CapabilityId,
  type CapabilityProjection,
  type Condition,
  type ExperimentId,
  type JsonValue,
  type OperationContext,
  type ReplayStep,
  type SafetySignal,
  type Schema,
  type ValidationIssue,
  type ValidationResult,
  type WorthReadResult,
} from "@interface-compiler/domain"
import type { CompiledPlanMeasurementProvenance, WorthQueryEvidence } from "@interface-compiler/worth-adapter"

export type DirectDecision =
  | { readonly kind: "act"; readonly step: ReplayStep }
  | { readonly kind: "complete"; readonly output?: JsonValue }
  | { readonly kind: "stop"; readonly signal: Exclude<SafetySignal, { readonly kind: "safe_to_continue" }> }

export interface ExperimentRequest {
  readonly application: Application
  readonly capabilityId: CapabilityId
  readonly experimentId: ExperimentId
  readonly objective: string
  readonly input?: JsonValue
  readonly preconditions?: readonly Condition[]
  readonly expectedOutcome?: readonly Condition[]
}

export interface DirectExperimentPlan {
  readonly kind: "direct"
  readonly mode: "direct"
  readonly request: ExperimentRequest
  readonly decisionSchema: Schema<DirectDecision>
  readonly continueAfterUnverifiedCompletion?: true
}

export interface DirectPlanningOptions {
  readonly continueAfterUnverifiedCompletion?: boolean
}

type HealthyCapabilityProjection = Extract<CapabilityProjection, { readonly status: "healthy" }>

/** Planning requires only these WORTH projections, never the command authority. */
export interface CompiledPlanReadPort {
  readCapability(capabilityId: CapabilityId, context: OperationContext): Promise<CompiledProjectionReadResult<CapabilityProjection>>
  readActiveReplay(capabilityId: CapabilityId, context: OperationContext): Promise<CompiledProjectionReadResult<ActiveReplayProjection>>
}
type CompiledProjectionReadResult<T> =
  | { readonly kind: "found"; readonly value: T; readonly evidence?: WorthQueryEvidence; readonly compilationProvenance?: CompiledPlanMeasurementProvenance }
  | Exclude<WorthReadResult<T>, { readonly kind: "found" }>
  | { readonly kind: "denied" | "unavailable"; readonly message: string }

export type CompiledPlanAuthority =
  | {
      readonly kind: "worth_query"
      readonly capabilityEvidence: WorthQueryEvidence
      readonly replayEvidence: WorthQueryEvidence
      readonly compilationProvenance: CompiledPlanMeasurementProvenance
    }
  | { readonly kind: "projection_only"; readonly compilationProvenance: { readonly kind: "unavailable" } }

export interface CompiledExperimentPlan {
  readonly kind: "compiled"
  readonly mode: "compiled"
  readonly request: ExperimentRequest
  readonly capability: HealthyCapabilityProjection
  readonly replay: ActiveReplayProjection
  readonly authority: CompiledPlanAuthority
}

export type ExperimentPlan = DirectExperimentPlan | CompiledExperimentPlan

export type CompiledPlanningResult =
  | { readonly kind: "planned"; readonly plan: CompiledExperimentPlan }
  | { readonly kind: "invalid_request"; readonly issues: readonly ValidationIssue[] }
  | {
      readonly kind: "unavailable"
      readonly reason: CompiledUnavailableReason
      readonly message?: string
    }

type CompiledUnavailableReason =
  | "capability_not_found"
  | "capability_not_healthy"
  | "active_replay_not_found"
  | "projection_mismatch"
  | "active_replay_invalid"
  | "worth_cancelled"
  | "worth_timed_out"
  | "worth_failed"

export function planDirectExperiment(input: ExperimentRequest, options: DirectPlanningOptions = {}): ValidationResult<DirectExperimentPlan> {
  const requestIssues = validateExperimentRequest(input)
  const schemaResult = createDirectDecisionSchema()
  if (requestIssues.length > 0) return { ok: false, issues: requestIssues }
  if (!schemaResult.ok) return schemaResult
  return {
    ok: true,
    value: Object.freeze({
      kind: "direct",
      mode: "direct",
      request: cloneRequest(input),
      decisionSchema: freezeNested(schemaResult.value),
      ...(options.continueAfterUnverifiedCompletion === true ? { continueAfterUnverifiedCompletion: true as const } : {}),
    }),
  }
}

export async function planCompiledExperiment(
  input: ExperimentRequest,
  worth: CompiledPlanReadPort,
  context: OperationContext,
): Promise<CompiledPlanningResult> {
  const requestIssues = validateExperimentRequest(input)
  if (requestIssues.length > 0) return { kind: "invalid_request", issues: requestIssues }
  if (input.expectedOutcome === undefined || input.expectedOutcome.length === 0) {
    return { kind: "invalid_request", issues: [{ path: "expectedOutcome", message: "compiled execution requires at least one semantic outcome condition" }] }
  }

  const capabilityResult = await worth.readCapability(input.capabilityId, context)
  if (capabilityResult.kind !== "found") return mapWorthReadFailure(capabilityResult, "capability_not_found")
  if (capabilityResult.value.applicationId !== input.application.id) return { kind: "unavailable", reason: "projection_mismatch" }
  if (capabilityResult.value.status !== "healthy") return { kind: "unavailable", reason: "capability_not_healthy" }

  const replayResult = await worth.readActiveReplay(input.capabilityId, context)
  if (replayResult.kind !== "found") return mapWorthReadFailure(replayResult, "active_replay_not_found")
  if (replayResult.value.capabilityId !== input.capabilityId || replayResult.value.id !== capabilityResult.value.activeReplayVersionId) {
    return { kind: "unavailable", reason: "projection_mismatch" }
  }
  if (replayResult.value.steps.length === 0) return { kind: "unavailable", reason: "active_replay_invalid" }
  const authority = compiledPlanAuthority(capabilityResult, replayResult)
  if (authority === undefined) return { kind: "unavailable", reason: "projection_mismatch" }

  return {
    kind: "planned",
    plan: Object.freeze({
      kind: "compiled",
      mode: "compiled",
      request: cloneRequest({
        ...input,
        preconditions: capabilityResult.value.preconditions,
        expectedOutcome: capabilityResult.value.postconditions,
      }),
      capability: snapshotProjection(capabilityResult.value),
      replay: snapshotProjection(replayResult.value),
      authority: snapshotProjection(authority),
    }),
  }
}

function compiledPlanAuthority(
  capability: Extract<CompiledProjectionReadResult<CapabilityProjection>, { readonly kind: "found" }>,
  replay: Extract<CompiledProjectionReadResult<ActiveReplayProjection>, { readonly kind: "found" }>,
): CompiledPlanAuthority | undefined {
  const capabilityHasAuthority = capability.evidence !== undefined && capability.compilationProvenance !== undefined
  const replayHasAuthority = replay.evidence !== undefined && replay.compilationProvenance !== undefined
  if (!capabilityHasAuthority && !replayHasAuthority) return { kind: "projection_only", compilationProvenance: { kind: "unavailable" } }
  if (!capabilityHasAuthority || !replayHasAuthority || !sameCompilationProvenance(capability.compilationProvenance, replay.compilationProvenance)) return undefined
  return {
    kind: "worth_query",
    capabilityEvidence: capability.evidence,
    replayEvidence: replay.evidence,
    compilationProvenance: capability.compilationProvenance,
  }
}

function sameCompilationProvenance(left: CompiledPlanMeasurementProvenance | undefined, right: CompiledPlanMeasurementProvenance | undefined): boolean {
  if (left === undefined || right === undefined || left.kind !== right.kind) return false
  if (left.kind === "synthetic_seed") return true
  return right.kind === "measured" &&
    JSON.stringify(left.discoveryExecutionIds) === JSON.stringify(right.discoveryExecutionIds) &&
    JSON.stringify(left.verificationExecutionIds) === JSON.stringify(right.verificationExecutionIds)
}

export function createDirectDecisionSchema(): ValidationResult<Schema<DirectDecision>> {
  return createSchema<DirectDecision>({
    name: "interface_compiler_direct_decision",
    json: {
      type: "object",
      additionalProperties: false,
      required: ["kind"],
      properties: {
        kind: { type: "string", enum: ["act", "complete", "stop"] },
        step: {
          type: "object",
          additionalProperties: false,
          required: ["type"],
          properties: {
            type: { type: "string", enum: ["navigate", "click", "fill", "select", "wait", "read", "assert"] },
            url: { type: "string" },
            target: {
              type: "object",
              additionalProperties: false,
              required: ["semanticDescription"],
              properties: {
                semanticDescription: { type: "string" },
                role: { type: "string" },
                name: { type: "string" },
                text: { type: "string" },
                selector: { type: "string" },
              },
            },
            value: {},
            milliseconds: { type: "number", minimum: 0 },
            outputKey: { type: "string" },
            condition: { type: "object" },
          },
        },
        output: {},
        signal: {
          type: "object",
          additionalProperties: false,
          required: ["kind"],
          properties: {
            kind: {
              type: "string",
              enum: [
                "safe_to_continue",
                "authentication_required",
                "personal_information_required",
                "shipping_details_required",
                "payment_details_required",
                "order_placement",
                "access_control_required",
              ],
            },
            credential: { type: "string", enum: ["username", "password", "one_time_code", "unknown"] },
            information: { type: "string", enum: ["identity", "contact", "unknown"] },
            payment: { type: "string", enum: ["card", "bank_account", "wallet", "unknown"] },
          },
        },
      },
    },
  })
}

export function validateDirectDecision(value: unknown): readonly ValidationIssue[] {
  if (!isObject(value)) return [{ path: "decision", message: "direct decision must be an object" }]
  if (value.kind === "act") return validateReplayStep(value.step)
  if (value.kind === "complete") return value.output === undefined || isJsonValue(value.output)
    ? []
    : [{ path: "decision.output", message: "completion output must be JSON" }]
  if (value.kind === "stop") {
    const signalIssues = validateSafetySignal(value.signal as SafetySignal)
    if (signalIssues.length > 0) return signalIssues
    return (value.signal as SafetySignal).kind === "safe_to_continue"
      ? [{ path: "decision.signal", message: "a stop decision must identify a human-required safety boundary" }]
      : []
  }
  return [{ path: "decision.kind", message: "direct decision kind is not recognized" }]
}

function validateExperimentRequest(input: ExperimentRequest): ValidationIssue[] {
  if (!isObject(input)) return [{ path: "request", message: "experiment request must be an object" }]
  const issues = [...validateApplication(input.application)]
  if (!isNonEmptyText(input.capabilityId)) issues.push({ path: "capabilityId", message: "capability id must not be empty" })
  if (!isNonEmptyText(input.experimentId)) issues.push({ path: "experimentId", message: "experiment id must not be empty" })
  if (!isNonEmptyText(input.objective)) issues.push({ path: "objective", message: "objective must not be empty" })
  if (input.input !== undefined && !isJsonValue(input.input)) issues.push({ path: "input", message: "input must be JSON" })
  if (input.expectedOutcome !== undefined && !Array.isArray(input.expectedOutcome)) {
    issues.push({ path: "expectedOutcome", message: "expected outcome must be an array" })
  } else if (Array.isArray(input.expectedOutcome)) {
    input.expectedOutcome.forEach((condition, index) => issues.push(...validateCondition(condition, `expectedOutcome[${index}]`)))
  }
  if (input.preconditions !== undefined && !Array.isArray(input.preconditions)) {
    issues.push({ path: "preconditions", message: "preconditions must be an array" })
  } else if (Array.isArray(input.preconditions)) {
    input.preconditions.forEach((condition, index) => issues.push(...validateCondition(condition, `preconditions[${index}]`)))
  }
  return issues
}

function mapWorthReadFailure<T>(result: Exclude<CompiledProjectionReadResult<T>, { readonly kind: "found" }>, notFoundReason: CompiledUnavailableReason): CompiledPlanningResult {
  switch (result.kind) {
    case "not_found":
      return { kind: "unavailable", reason: notFoundReason }
    case "cancelled":
      return { kind: "unavailable", reason: "worth_cancelled" }
    case "timed_out":
      return { kind: "unavailable", reason: "worth_timed_out" }
    case "failed":
      return { kind: "unavailable", reason: "worth_failed", message: result.message }
    case "denied":
    case "unavailable":
      return { kind: "unavailable", reason: "worth_failed", message: result.message }
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

/** WORTH client mappers have already admitted the projection; retain a private snapshot for this plan. */
function snapshotProjection<T>(value: T): T {
  return freezeNested(structuredClone(value))
}

/** Preserve the branded Application entity; a projection or structured clone cannot mint it. */
function cloneRequest(input: ExperimentRequest): ExperimentRequest {
  const { application, ...requestFields } = input
  const clonedFields = freezeNested(structuredClone(requestFields))
  return Object.freeze({ ...clonedFields, application })
}

function freezeNested<T>(value: T): T {
  const seen = new WeakSet<object>()

  function freeze(current: unknown): void {
    if (current === null || typeof current !== "object" || seen.has(current)) return
    seen.add(current)
    Object.freeze(current)
    if (Array.isArray(current)) current.forEach(freeze)
    else Object.values(current).forEach(freeze)
  }

  freeze(value)
  return value
}
