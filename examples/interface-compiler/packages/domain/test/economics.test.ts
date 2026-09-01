import assert from "node:assert/strict"
import test from "node:test"
import {
  calculateBreakEvenCalls,
  calculateCompilationCostUsd,
  calculateCompilationMetrics,
  calculateLifetimeEconomics,
  calculateModelCostUsd,
  type ValidationResult,
} from "../src/index.js"

function unwrap<T>(result: ValidationResult<T>): T {
  if (!result.ok) throw new Error(result.issues.map((entry) => `${entry.path}: ${entry.message}`).join(", "))
  return result.value
}

test("compilation cost is the finite sum of discovery and verification costs", () => {
  assert.equal(unwrap(calculateCompilationCostUsd(12.5, 7.5)), 20)
  assert.equal(calculateCompilationCostUsd(Number.NaN, 1).ok, false)
  assert.equal(calculateCompilationCostUsd(-1, 1).ok, false)
})

test("break-even reports the first whole call and preserves the exact ratio", () => {
  const result = unwrap(
    calculateBreakEvenCalls({
      compileCostUsd: 30,
      directCostPerCallUsd: 10,
      compiledCostPerCallUsd: 2,
    }),
  )
  assert.deepEqual(result, {
    kind: "finite",
    calls: 4,
    exactCalls: 3.75,
    savingsPerCallUsd: 8,
  })
})

test("break-even is typed when savings are absent, immediate, or not representable", () => {
  assert.deepEqual(
    unwrap(calculateBreakEvenCalls({ compileCostUsd: 30, directCostPerCallUsd: 2, compiledCostPerCallUsd: 2 })),
    { kind: "never", reason: "compiled_not_cheaper", savingsPerCallUsd: 0 },
  )
  assert.deepEqual(
    unwrap(calculateBreakEvenCalls({ compileCostUsd: 0, directCostPerCallUsd: 2, compiledCostPerCallUsd: 1 })),
    { kind: "immediate", calls: 0, savingsPerCallUsd: 1 },
  )
  assert.deepEqual(
    unwrap(calculateBreakEvenCalls({ compileCostUsd: Number.MAX_VALUE, directCostPerCallUsd: 2, compiledCostPerCallUsd: 1 })),
    { kind: "unavailable", reason: "break_even_exceeds_safe_integer_range", savingsPerCallUsd: 1 },
  )
  assert.deepEqual(
    unwrap(calculateBreakEvenCalls({ compileCostUsd: Number.MIN_VALUE, directCostPerCallUsd: Number.MAX_VALUE, compiledCostPerCallUsd: 0 })),
    { kind: "unavailable", reason: "break_even_ratio_underflowed", savingsPerCallUsd: Number.MAX_VALUE },
  )
})

test("lifetime economics includes compilation once and replay cost per execution", () => {
  const metrics = unwrap(
    calculateCompilationMetrics({
      explorationCostUsd: 20,
      verificationCostUsd: 10,
      directAverageCostUsd: 10,
      compiledAverageCostUsd: 2,
    }),
  )
  const lifetime = unwrap(calculateLifetimeEconomics(metrics, 5))
  assert.deepEqual(lifetime, {
    executions: 5,
    lifetimeDirectCostAvoidedUsd: 50,
    lifetimeCompiledCostUsd: 40,
    lifetimeNetSavingsUsd: 10,
  })
  assert.equal(
    calculateLifetimeEconomics(
      { ...metrics, breakEvenCalls: { kind: "finite", calls: 99, exactCalls: 99, savingsPerCallUsd: 8 } },
      5,
    ).ok,
    false,
  )
})

test("model cost uses caller-supplied pricing and rejects invalid numeric inputs", () => {
  assert.equal(
    unwrap(
      calculateModelCostUsd(
        { inputTokens: 1000, outputTokens: 500 },
        { inputUsdPerToken: 0.001, outputUsdPerToken: 0.002 },
      ),
    ),
    2,
  )
  assert.equal(
    calculateModelCostUsd(
      { inputTokens: Number.MAX_SAFE_INTEGER + 1, outputTokens: 0 },
      { inputUsdPerToken: 1, outputUsdPerToken: 1 },
    ).ok,
    false,
  )
})
