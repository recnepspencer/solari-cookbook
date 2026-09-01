import { createSchema, type Condition, type JsonValue, type ReasoningModel, type Schema } from "@interface-compiler/domain"
import type { SemanticVerificationRequest, SemanticVerificationResult, SemanticVerifier } from "./semantic-verifier.js"

type VerificationDecision =
  | { readonly kind: "verified"; readonly output?: JsonValue }
  | { readonly kind: "failed"; readonly conditionIndex: number; readonly message: string; readonly retryable: boolean }

/** Uses the configured reasoning adapter for semantic inspection without minting WORTH evidence identities. */
export function createReasoningSemanticVerifier(model: ReasoningModel): SemanticVerifier {
  const schema = verificationDecisionSchema()
  return {
    verify: async (request, context) => {
      const result = await model.structuredComplete(verificationPrompt(request), schema, context)
      switch (result.kind) {
        case "completed": {
          const decision = result.completion.output
          if (decision.kind === "verified") return { kind: "verified", ...(decision.output === undefined ? {} : { output: decision.output }), usage: result.completion.usage, effect: result.effect }
          if (!Number.isSafeInteger(decision.conditionIndex) || decision.conditionIndex < 0 || typeof decision.message !== "string" || decision.message.trim().length === 0 || typeof decision.retryable !== "boolean") {
            return providerFailure(request.conditions, "semantic verifier returned an invalid failure decision", false, result.completion.usage, result.effect)
          }
          const condition = conditionAt(request.conditions, decision.conditionIndex)
          return { kind: "failed", condition, message: decision.message, retryable: decision.retryable, evidenceIds: [], usage: result.completion.usage, effect: result.effect }
        }
        case "cancelled": return { kind: "cancelled", ...(result.usage === undefined ? {} : { usage: result.usage }), effect: result.effect }
        case "timed_out": return { kind: "timed_out", ...(result.usage === undefined ? {} : { usage: result.usage }), effect: result.effect }
        case "denied": return providerFailure(request.conditions, "semantic verification was denied by the reasoning boundary", false, undefined, result.effect)
        case "failed": return providerFailure(request.conditions, result.message, result.retryable, result.usage, result.effect)
      }
    },
  }
}

function verificationDecisionSchema(): Schema<VerificationDecision> {
  const result = createSchema<VerificationDecision>({
    name: "interface_compiler_semantic_verification",
    json: {
      type: "object",
      additionalProperties: false,
      required: ["kind"],
      properties: {
        kind: { type: "string", enum: ["verified", "failed"] },
        output: {},
        conditionIndex: { type: "integer", minimum: 0 },
        message: { type: "string", minLength: 1, maxLength: 500 },
        retryable: { type: "boolean" },
      },
    },
  })
  if (!result.ok) throw new Error("semantic verification schema is invalid")
  return result.value
}

function verificationPrompt(request: SemanticVerificationRequest): JsonValue {
  return {
    task: "Evaluate every expected condition against only the supplied public browser observation and output.",
    rules: [
      "Return verified only when every condition is visibly supported.",
      "Do not infer hidden account, identity, shipping, payment, checkout, order, or credential state.",
      "On failure, return the zero-based index of one unsupported condition.",
    ],
    conditions: request.conditions as JsonValue,
    ...(request.observation === undefined ? {} : { observation: request.observation as unknown as JsonValue }),
    ...(request.output === undefined ? {} : { output: request.output }),
  }
}

function conditionAt(conditions: readonly Condition[], index: number): Condition {
  return Number.isSafeInteger(index) && index >= 0 && index < conditions.length ? conditions[index] as Condition : conditions[0] as Condition
}

function providerFailure(
  conditions: readonly Condition[],
  message: string,
  retryable: boolean,
  usage: SemanticVerificationResult["usage"],
  effect: Extract<SemanticVerificationResult, { readonly kind: "failed" }>["effect"],
): SemanticVerificationResult {
  return { kind: "failed", condition: conditions[0] as Condition, message, retryable, evidenceIds: [], ...(usage === undefined ? {} : { usage }), effect }
}
