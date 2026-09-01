import type {
  BenchmarkEconomicsReport,
  BenchmarkRatio,
  BenchmarkSavings,
  BenchmarkSavingsMetric,
  BenchmarkSideReport,
} from "./contract.js"
import type { ValidatedBenchmarkComparison } from "./input-validation.js"

export function buildEconomics(
  comparison: ValidatedBenchmarkComparison,
  direct: BenchmarkSideReport,
  compiled: BenchmarkSideReport,
): BenchmarkEconomicsReport {
  const compilationInput = comparison.compilation
  const compilation = compilationInput === undefined
    ? { kind: "not_measured" as const, reason: "projection_not_returned" as const }
    : {
        kind: "measured" as const,
        explorationCostUsd: compilationInput.projection.compilation.explorationCostUsd,
        verificationCostUsd: compilationInput.projection.compilation.verificationCostUsd,
        totalCostUsd: compilationInput.projection.compilation.totalCompilationCostUsd,
        attribution: compilationInput.attribution,
      }
  const breakEven = compilationInput?.projection.compilation.breakEvenCalls === undefined
    ? { kind: "not_measured" as const, reason: "projection_not_returned" as const }
    : { kind: "measured" as const, value: compilationInput.projection.compilation.breakEvenCalls }
  const lifetime = compilationInput?.projection.lifetime === undefined
    ? { kind: "not_measured" as const, reason: "projection_not_returned" as const }
    : { kind: "measured" as const, value: compilationInput.projection.lifetime }
  return {
    compilation,
    perExecutionSavings: buildSavings(direct, compiled),
    breakEven,
    lifetime,
  }
}

function buildSavings(direct: BenchmarkSideReport, compiled: BenchmarkSideReport): BenchmarkSavings {
  return {
    modelCalls: savingsMetric(direct.averages.modelCalls, compiled.averages.modelCalls),
    inputTokens: savingsMetric(direct.averages.inputTokens, compiled.averages.inputTokens),
    outputTokens: savingsMetric(direct.averages.outputTokens, compiled.averages.outputTokens),
    totalTokens: savingsMetric(direct.averages.totalTokens, compiled.averages.totalTokens),
    browserObservations: savingsMetric(direct.averages.browserObservations, compiled.averages.browserObservations),
    browserActions: savingsMetric(direct.averages.browserActions, compiled.averages.browserActions),
    toolCalls: savingsMetric(direct.averages.toolCalls, compiled.averages.toolCalls),
    wallClockMs: savingsMetric(direct.averages.wallClockMs, compiled.averages.wallClockMs),
    modelCostUsd: savingsMetric(direct.modelCost.averageUsd, compiled.modelCost.averageUsd),
  }
}

function savingsMetric(directAverage: number, compiledAverage: number): BenchmarkSavingsMetric {
  const absolute = directAverage - compiledAverage
  const percentOfDirect: BenchmarkRatio = directAverage === 0
    ? { kind: "not_computable", reason: "zero_denominator" }
    : { kind: "measured", value: absolute / directAverage }
  return { directAverage, compiledAverage, absolute, percentOfDirect }
}
