import assert from "node:assert/strict"
import test from "node:test"
import {
  calculateBreakEvenCalls,
  calculateCompilationCostMicrocents,
  calculateCompilationMetrics,
  calculateLifetimeEconomics,
  calculateModelCostMicrocents,
  type ValidationResult,
} from "../src/index.js"

function unwrap<T>(result: ValidationResult<T>): T {
  if (!result.ok) throw new Error(result.issues.map((entry) => `${entry.path}: ${entry.message}`).join(", "))
  return result.value
}

test("compilation cost is the finite sum of discovery and verification costs", () => {
  assert.equal(unwrap(calculateCompilationCostMicrocents(1_250_000_000, 750_000_000)), 2_000_000_000)
  assert.equal(calculateCompilationCostMicrocents(Number.NaN, 1).ok, false)
  assert.equal(calculateCompilationCostMicrocents(-1, 1).ok, false)
})

test("break-even reports the first whole call and preserves the exact ratio", () => {
  const result = unwrap(
    calculateBreakEvenCalls({
      compileCostMicrocents: 3000000000,
      directCostPerCallMicrocents: 1000000000,
      compiledCostPerCallMicrocents: 200000000,
    }),
  )
  assert.deepEqual(result, {
    kind: "finite",
    calls: 4,
    exactCalls: 3.75,
    savingsPerCallMicrocents: 800000000,
  })
})

test("break-even is typed when savings are absent, immediate, or not representable", () => {
  assert.deepEqual(
    unwrap(calculateBreakEvenCalls({ compileCostMicrocents: 3000000000, directCostPerCallMicrocents: 200000000, compiledCostPerCallMicrocents: 200000000 })),
    { kind: "never", reason: "compiled_not_cheaper", savingsPerCallMicrocents: 0 },
  )
  assert.deepEqual(
    unwrap(calculateBreakEvenCalls({ compileCostMicrocents: 0, directCostPerCallMicrocents: 200000000, compiledCostPerCallMicrocents: 100000000 })),
    { kind: "immediate", calls: 0, savingsPerCallMicrocents: 100000000 },
  )
  assert.deepEqual(
    unwrap(calculateBreakEvenCalls({ compileCostMicrocents: Number.MAX_SAFE_INTEGER, directCostPerCallMicrocents: 100000000, compiledCostPerCallMicrocents: 0 })),
    { kind: "finite", calls: 90071993, exactCalls: Number.MAX_SAFE_INTEGER / 100000000, savingsPerCallMicrocents: 100000000 },
  )
  assert.deepEqual(
    calculateBreakEvenCalls({ compileCostMicrocents: Number.MIN_VALUE, directCostPerCallMicrocents: Number.MAX_SAFE_INTEGER, compiledCostPerCallMicrocents: 0 }).ok,
    false,
  )
})

test("lifetime economics includes compilation once and replay cost per execution", () => {
  const metrics = unwrap(
    calculateCompilationMetrics({
      explorationCostMicrocents: 2000000000,
      verificationCostMicrocents: 1000000000,
      directAverageCostMicrocents: 1000000000,
      compiledAverageCostMicrocents: 200000000,
    }),
  )
  const lifetime = unwrap(calculateLifetimeEconomics(metrics, 5))
  assert.deepEqual(lifetime, {
    executions: 5,
    lifetimeDirectCostAvoidedMicrocents: 5000000000,
    lifetimeCompiledCostMicrocents: 4000000000,
    lifetimeNetSavingsMicrocents: 1000000000,
  })
  assert.equal(
    calculateLifetimeEconomics(
      { ...metrics, breakEvenCalls: { kind: "finite", calls: 99, exactCalls: 99, savingsPerCallMicrocents: 800000000 } },
      5,
    ).ok,
    false,
  )
})

test("model cost uses caller-supplied pricing and rejects invalid numeric inputs", () => {
  assert.equal(
    unwrap(
      calculateModelCostMicrocents(
        { inputTokens: 1000, outputTokens: 500 },
        { inputMicrocentsPerToken: 100000, outputMicrocentsPerToken: 200000 },
      ),
    ),
    200000000,
  )
  assert.equal(
    calculateModelCostMicrocents(
      { inputTokens: Number.MAX_SAFE_INTEGER + 1, outputTokens: 0 },
      { inputMicrocentsPerToken: 100000000, outputMicrocentsPerToken: 100000000 },
    ).ok,
    false,
  )
})
