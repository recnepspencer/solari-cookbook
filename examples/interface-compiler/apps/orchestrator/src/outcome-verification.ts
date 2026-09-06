import {
  matchesJsonSchema,
  validateCondition,
  type Condition,
  type ExecutionId,
  type JsonSchema,
  type JsonValue,
  type Observation,
  type ReasoningUsage,
  type ReplayVersionId,
} from "@interface-compiler/domain"
import { eventIdempotencyKey } from "./event-publishing.js"
import type { OperationController } from "./operation.js"
import { cancelledStop, deadlineStop, effectSafePoint, eventPublicationIntent, promoteCompletedEffect } from "./session-control.js"
import type { ExperimentTerminal, RuntimeEventEmitter } from "./session-types.js"
import type { SemanticVerifier, SemanticVerificationResult } from "./semantic-verifier.js"

export async function verifyOutcome(
  conditions: readonly Condition[] | undefined,
  verifier: SemanticVerifier | undefined,
  observation: Observation,
  output: JsonValue | undefined,
  controller: OperationController,
  emit: RuntimeEventEmitter,
  executionId: ExecutionId,
  replayVersionId?: ReplayVersionId,
  phase: "precondition" | "postcondition" = "postcondition",
  input?: JsonValue,
  outputSchema?: JsonSchema,
): Promise<ExperimentTerminal> {
  if (conditions === undefined || conditions.length === 0) {
    const gate = controller.check()
    return gate.kind === "stop"
      ? { kind: "control_stop", stop: promoteCompletedEffect(gate.stop) }
      : { kind: "success", ...(output === undefined ? {} : { output }) }
  }
  if (verifier === undefined) return { kind: "failure", message: "semantic outcome verifier is required for this experiment" }
  if (verifier.modelUsage === "required") {
    const gate = controller.reserveModelCall()
    if (gate.kind === "stop") return { kind: "control_stop", stop: gate.stop }
  }

  let result: SemanticVerificationResult
  try {
    result = await verifier.verify({ phase, conditions, observation, ...(output === undefined ? {} : { output }), ...(input === undefined ? {} : { input }), ...(outputSchema === undefined ? {} : { outputSchema }) }, controller.context)
  } catch {
    return { kind: "failure", message: "semantic outcome verifier failed before returning a result" }
  }
  const usageIntent = await emitVerificationUsage(result, emit, executionId, observation.id)
  if (usageIntent !== undefined) return usageIntent
  const afterVerification = controller.check()
  if (afterVerification.kind === "stop") return { kind: "control_stop", stop: promoteCompletedEffect(afterVerification.stop) }
  switch (result.kind) {
    case "verified": {
      if (result.effect.kind !== "completed") return { kind: "failure", message: "semantic verifier did not confirm its external effect", posture: result.effect }
      if (phase === "precondition") return { kind: "success" }
      const verifiedOutput = result.output ?? output
      if (outputSchema !== undefined && (verifiedOutput === undefined || !matchesJsonSchema(verifiedOutput, outputSchema))) return { kind: "failure", message: "verified capability output did not satisfy the WORTH contract", classification: "semantic_drift" }
      return { kind: "success", ...(verifiedOutput === undefined ? {} : { output: verifiedOutput }) }
    }
    case "failed": {
      if (result.effect.kind !== "completed") return { kind: "failure", message: result.message, posture: result.effect }
      if (phase === "precondition") return { kind: "failure", message: result.message, classification: "precondition_failed" }
      if (replayVersionId === undefined) return { kind: "failure", message: result.message }
      if (validateCondition(result.condition).length > 0) return { kind: "failure", message: `${result.message}; semantic verifier returned an invalid postcondition` }
      if (!conditions.some((condition) => sameCondition(condition, result.condition))) return { kind: "failure", message: `${result.message}; semantic verifier returned an unexpected postcondition` }
      return { kind: "failure", message: result.message, failedCondition: result.condition, classification: "semantic_drift" }
    }
    case "provider_failed": return { kind: "failure", message: `semantic verification provider failed: ${result.message}`, retryable: result.retryable, posture: result.effect, classification: "provider_failure" }
    case "cancelled": return { kind: "control_stop", stop: cancelledStop(effectSafePoint(result.effect), result.effect) }
    case "timed_out": return { kind: "control_stop", stop: deadlineStop(result.effect) }
  }
}

async function emitVerificationUsage(result: SemanticVerificationResult, emit: RuntimeEventEmitter, executionId: ExecutionId, observationId: Observation["id"]): Promise<ExperimentTerminal | undefined> {
  if (result.usage === undefined) return undefined
  if (!validReasoningUsage(result.usage)) return { kind: "failure", message: "semantic verifier returned invalid usage metadata", posture: result.effect }
  const publication = await emit("model.called", {
    executionId,
    role: "verifier",
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    estimatedModelCostMicrocents: result.usage.estimatedModelCostMicrocents,
  }, eventIdempotencyKey("model.called", `${executionId}:verifier:${observationId}`))
  return eventPublicationIntent(publication, result.effect)
}

function validReasoningUsage(usage: ReasoningUsage): boolean {
  return Number.isSafeInteger(usage.inputTokens) && usage.inputTokens >= 0 &&
    Number.isSafeInteger(usage.outputTokens) && usage.outputTokens >= 0 &&
    Number.isFinite(usage.estimatedModelCostMicrocents) && usage.estimatedModelCostMicrocents >= 0
}

function sameCondition(left: Condition, right: Condition): boolean {
  if (left.kind !== right.kind) return false
  switch (left.kind) {
    case "url_matches": return right.kind === "url_matches" && left.pattern === right.pattern
    case "text_present": return right.kind === "text_present" && left.text === right.text
    case "interactable_present": return right.kind === "interactable_present" && left.semanticDescription === right.semanticDescription
    case "cart_count_increased": return right.kind === "cart_count_increased" && left.baselineKey === right.baselineKey
    case "product_in_cart": return right.kind === "product_in_cart" && left.productRef === right.productRef
    case "authentication_required": return right.kind === "authentication_required"
    case "checkout_started": return right.kind === "checkout_started"
    case "custom": return right.kind === "custom" && left.name === right.name && stableJsonStringify(left.value) === stableJsonStringify(right.value)
  }
}

function stableJsonStringify(value: unknown): string {
  if (value === undefined || value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJsonStringify).join(",")}]`
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => `${JSON.stringify(key)}:${stableJsonStringify(child)}`).join(",")}}`
}
