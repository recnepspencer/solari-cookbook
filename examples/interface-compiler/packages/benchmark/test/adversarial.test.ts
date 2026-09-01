import assert from "node:assert/strict"
import test from "node:test"
import { createBenchmarkReport, type BenchmarkExecutionRecord } from "../src/index.js"
import { compilationInput, validInput } from "./fixtures.js"

function withModelCosts(input: ReturnType<typeof validInput>, directCost: number, compiledCost: number): ReturnType<typeof validInput> {
  return {
    ...input,
    direct: input.direct.map((record) => ({ ...record, execution: { ...record.execution, metrics: { ...record.execution.metrics, estimatedModelCostUsd: directCost } } })),
    compiled: input.compiled.map((record) => ({ ...record, execution: { ...record.execution, metrics: { ...record.execution.metrics, estimatedModelCostUsd: compiledCost } } })),
    compilation: {
      ...compilationInput(),
      projection: {
        ...compilationInput().projection,
        compilation: {
          explorationCostUsd: 0,
          verificationCostUsd: 0,
          totalCompilationCostUsd: 0,
          directAverageCostUsd: directCost,
          compiledAverageCostUsd: compiledCost,
          breakEvenCalls: directCost > compiledCost
            ? { kind: "immediate" as const, calls: 0, savingsPerCallUsd: directCost - compiledCost }
            : { kind: "never" as const, reason: "compiled_not_cheaper" as const, savingsPerCallUsd: directCost - compiledCost },
        },
        lifetime: {
          executions: 4,
          lifetimeDirectCostAvoidedUsd: directCost * 4,
          lifetimeCompiledCostUsd: compiledCost * 4,
          lifetimeNetSavingsUsd: (directCost - compiledCost) * 4,
        },
      },
    },
  }
}

test("keeps zero and negative savings typed instead of dividing by a non-positive denominator", () => {
  const equal = createBenchmarkReport(withModelCosts(validInput(), 0, 0))
  assert.equal(equal.kind, "measured")
  if (equal.kind === "measured") {
    assert.equal(equal.economics.perExecutionSavings.modelCostUsd.absolute, 0)
    assert.deepEqual(equal.economics.perExecutionSavings.modelCostUsd.percentOfDirect, { kind: "not_computable", reason: "zero_denominator" })
    assert.deepEqual(equal.economics.breakEven, { kind: "measured", value: { kind: "never", reason: "compiled_not_cheaper", savingsPerCallUsd: 0 } })
  }

  const compiledMoreExpensive = createBenchmarkReport(withModelCosts(validInput(), 2, 3))
  assert.equal(compiledMoreExpensive.kind, "measured")
  if (compiledMoreExpensive.kind === "measured") {
    assert.equal(compiledMoreExpensive.economics.perExecutionSavings.modelCostUsd.absolute, -1)
    assert.deepEqual(compiledMoreExpensive.economics.breakEven, { kind: "measured", value: { kind: "never", reason: "compiled_not_cheaper", savingsPerCallUsd: -1 } })
  }
})

test("rejects missing monetary data instead of treating an absent cost as zero", () => {
  const input = validInput()
  const first = input.direct[0]
  assert.ok(first)
  const withoutCost = {
    ...first,
    execution: {
      ...first.execution,
      metrics: { ...first.execution.metrics, estimatedModelCostUsd: undefined },
    },
  }
  const report = createBenchmarkReport({ ...input, direct: [withoutCost as unknown as BenchmarkExecutionRecord, ...input.direct.slice(1)] })

  assert.equal(report.kind, "not_comparable")
  assert.ok(report.reasons.some((reason) => reason.code === "missing_monetary_data"))
})

test("requires explicit pricing to use an explicit usage override and rejects mismatched usage", () => {
  const input = validInput()
  const first = input.direct[0]
  assert.ok(first)
  const report = createBenchmarkReport({
    ...input,
    direct: [{ ...first, measurement: { ...first.measurement, usage: { inputTokens: 999, outputTokens: 1 } } }, ...input.direct.slice(1)],
    pricing: { direct: { inputUsdPerToken: 0.001, outputUsdPerToken: 0.002 } },
  })

  assert.equal(report.kind, "not_comparable")
  assert.ok(report.reasons.some((reason) => reason.code === "usage_projection_mismatch"))
})

test("accepts explicit monetary input when the Worth projection has no cost field", () => {
  const input = validInput()
  const withoutProjectedCosts = {
    ...input,
    direct: input.direct.map((record) => ({
      ...record,
      execution: { ...record.execution, metrics: { ...record.execution.metrics, estimatedModelCostUsd: undefined } },
    })),
    compiled: input.compiled.map((record) => ({
      ...record,
      execution: { ...record.execution, metrics: { ...record.execution.metrics, estimatedModelCostUsd: undefined } },
    })),
    compilation: undefined,
    pricing: {
      direct: { inputUsdPerToken: 0.001, outputUsdPerToken: 0.002 },
      compiled: { inputUsdPerToken: 0.001, outputUsdPerToken: 0.002 },
    },
  }
  const report = createBenchmarkReport(withoutProjectedCosts as never)

  assert.equal(report.kind, "measured")
  if (report.kind === "measured") assert.equal(report.direct.modelCost.source, "explicit_model_pricing")
})

test("rejects negative prices and ambiguous explicit cost sources", () => {
  const negativePrice = createBenchmarkReport({ ...validInput(), pricing: { direct: { inputUsdPerToken: -1, outputUsdPerToken: 1 } } })
  assert.equal(negativePrice.kind, "not_comparable")
  assert.ok(negativePrice.reasons.some((reason) => reason.code === "invalid_pricing"))

  const input = validInput()
  const first = input.direct[0]
  assert.ok(first)
  const ambiguous = createBenchmarkReport({
    ...input,
    pricing: { direct: { inputUsdPerToken: 0.001, outputUsdPerToken: 0.001 } },
    direct: [{ ...first, measurement: { ...first.measurement, modelCostUsd: 10 } }, ...input.direct.slice(1)],
  })
  assert.equal(ambiguous.kind, "not_comparable")
  assert.ok(ambiguous.reasons.some((reason) => reason.code === "multiple_monetary_sources"))

  const mismatchedPrices = createBenchmarkReport({
    ...validInput(),
    pricing: {
      direct: { inputUsdPerToken: 0.001, outputUsdPerToken: 0.001 },
      compiled: { inputUsdPerToken: 0.001, outputUsdPerToken: 0.002 },
    },
  })
  assert.equal(mismatchedPrices.kind, "not_comparable")
  assert.ok(mismatchedPrices.reasons.some((reason) => reason.code === "pricing_mismatch"))
})

test("requires compilation costs to be attributed to discovery and verification only", () => {
  const input = validInput()
  const baseCompilation = compilationInput()
  const invalid = {
    ...input,
    compilation: {
      ...baseCompilation,
      attribution: {
        kind: "discovery_and_verification_only" as const,
        discoveryExecutionIds: [input.direct[0]?.execution.id ?? ""],
        verificationExecutionIds: ["execution-verification" as never],
      },
    },
  }
  const report = createBenchmarkReport(invalid)

  assert.equal(report.kind, "not_comparable")
  assert.ok(report.reasons.some((reason) => reason.code === "compilation_attribution_invalid"))
})

test("rejects a compilation projection whose total or break-even contradicts its components", () => {
  const input = validInput()
  const baseCompilation = compilationInput()
  const invalid = {
    ...input,
    compilation: {
      ...baseCompilation,
      projection: {
        ...baseCompilation.projection,
        compilation: {
          ...baseCompilation.projection.compilation,
          totalCompilationCostUsd: 99,
          breakEvenCalls: { kind: "finite" as const, calls: 1, exactCalls: 1, savingsPerCallUsd: 3 },
        },
      },
    },
  }
  const report = createBenchmarkReport(invalid)

  assert.equal(report.kind, "not_comparable")
  assert.ok(report.reasons.filter((reason) => reason.code === "compilation_projection_invalid").length >= 1)
})

test("rejects compilation averages that do not describe the displayed execution records", () => {
  const input = validInput()
  const compilation = compilationInput()
  const report = createBenchmarkReport({
    ...input,
    compilation: {
      ...compilation,
      projection: {
        ...compilation.projection,
        compilation: { ...compilation.projection.compilation, directAverageCostUsd: 99 },
      },
    },
  })

  assert.equal(report.kind, "not_comparable")
  assert.ok(report.reasons.some((reason) => reason.code === "compilation_projection_invalid" && reason.path.endsWith("directAverageCostUsd")))
})

test("does not allow a provisional replay or a failed inspection to become a compiled claim", () => {
  const input = validInput()
  const failedInspection = createBenchmarkReport({
    ...input,
    compiledReplayInspection: { status: "failed", source: "worth", reason: "evidence could not be inspected" },
  })
  assert.equal(failedInspection.kind, "not_comparable")
  assert.ok(failedInspection.reasons.some((reason) => reason.code === "compiled_replay_inspection_failed"))

  const provisionalReplay = { ...input.compiledReplay, status: "verifying" as const }
  const provisional = createBenchmarkReport({ ...input, compiledReplay: provisionalReplay as never })
  assert.equal(provisional.kind, "not_comparable")
  assert.ok(provisional.reasons.some((reason) => reason.code === "compiled_replay_unverified"))
})
