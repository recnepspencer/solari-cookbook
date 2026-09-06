import assert from "node:assert/strict"
import test from "node:test"
import type { OperationContext, OperationId, ReasoningModel } from "@interface-compiler/domain"
import { createReasoningSemanticVerifier } from "../src/reasoning-semantic-verifier.js"

test("reasoning transport failures retain provider provenance even with a completed effect", async () => {
  const model: ReasoningModel = {
    structuredComplete: async () => ({
      kind: "failed",
      message: "provider returned malformed structured output",
      retryable: false,
      usage: { inputTokens: 2, outputTokens: 1, estimatedModelCostMicrocents: 1 },
      effect: { kind: "completed" },
    }),
  }
  const result = await createReasoningSemanticVerifier(model).verify({
    phase: "candidate_verification",
    conditions: [{ kind: "text_present", text: "DONE" }],
  }, context())

  assert.equal(result.kind, "provider_failed")
  if (result.kind !== "provider_failed") throw new Error("expected provider provenance")
  assert.equal(result.retryable, false)
  assert.deepEqual(result.effect, { kind: "completed" })
})

test("malformed completed model decisions retain provider provenance", async () => {
  const model: ReasoningModel = {
    structuredComplete: async <TInput, TOutput>(input: TInput) => {
      void input
      return {
        kind: "completed",
        completion: {
          output: { kind: "failed", conditionIndex: 99, message: "unsupported", retryable: false } as TOutput,
          usage: { inputTokens: 2, outputTokens: 1, estimatedModelCostMicrocents: 1 },
        },
        effect: { kind: "completed" },
      }
    },
  }
  const result = await createReasoningSemanticVerifier(model).verify({ conditions: [{ kind: "text_present", text: "DONE" }] }, context())
  assert.equal(result.kind, "provider_failed")
})

function context(): OperationContext {
  return {
    operationId: "operation.reasoning-verifier" as OperationId,
    deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    cancellation: { isCancellationRequested: () => false, onCancellationRequested: () => () => undefined },
    budget: { maxWallClockMs: 60_000, maxModelCalls: 1 },
    admission: { maxInFlight: 1, maxQueued: 0, overflow: "reject" },
  }
}
