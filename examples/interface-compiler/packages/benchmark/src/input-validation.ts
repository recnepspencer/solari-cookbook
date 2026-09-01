import { calculateCompilationMetrics, calculateLifetimeEconomics, type ActiveReplayProjection, type CompilationMetrics, type CompilationMetricsInput, type LifetimeEconomics } from "@interface-compiler/domain"
import type { BenchmarkCompilationInput, BenchmarkComparisonInput, BenchmarkPricingInput, BenchmarkRejection, BenchmarkTaskIdentity } from "./contract.js"
import { aggregateBenchmarkSide } from "./aggregation.js"
import { addBenchmarkRejection } from "./rejection.js"
import { validateActiveReplayProjection, validateReplayEvidence, validateReplayInspection } from "./replay-validation.js"
import { isNonEmptyText, isNonNegativeSafeInteger, isRecord, isTaskIdentity, taskIdentityMatches, validateExecutionRecords, type ValidatedExecutionRecord } from "./record-validation.js"

export interface ValidatedBenchmarkComparison {
  readonly input: BenchmarkComparisonInput
  readonly task: BenchmarkTaskIdentity
  readonly direct: readonly ValidatedExecutionRecord[]
  readonly compiled: readonly ValidatedExecutionRecord[]
  readonly compiledReplay: ActiveReplayProjection
  readonly compilation?: BenchmarkCompilationInput
}

export interface BenchmarkInputInspection {
  readonly rejections: readonly BenchmarkRejection[]
  readonly value?: ValidatedBenchmarkComparison
}

export function inspectBenchmarkInput(value: unknown): BenchmarkInputInspection {
  const rejections: BenchmarkRejection[] = []
  if (!isRecord(value)) {
    addBenchmarkRejection(rejections, "not_measured", "input_invalid", "input", "benchmark input must be an object")
    return { rejections }
  }
  if (!isTaskIdentity(value.task)) {
    addBenchmarkRejection(rejections, "not_measured", "task_invalid", "task", "comparison must carry a complete task identity")
    return { rejections }
  }
  const task = value.task
  validatePricingInput(value.pricing, rejections)
  const pricing = isRecord(value.pricing) ? value.pricing as unknown as BenchmarkPricingInput : undefined
  const direct = validateExecutionRecords(value.direct, "direct", task, pricing, "direct", rejections)
  const compiled = validateExecutionRecords(value.compiled, "compiled", task, pricing, "compiled", rejections)
  if (direct.length === 0 && Array.isArray(value.direct) && value.direct.length > 0) addBenchmarkRejection(rejections, "not_measured", "missing_direct_records", "direct", "direct side has no valid measured execution records")
  if (compiled.length === 0 && Array.isArray(value.compiled) && value.compiled.length > 0) addBenchmarkRejection(rejections, "not_measured", "missing_compiled_records", "compiled", "compiled side has no valid measured execution records")
  rejectDuplicateIdentities(direct, compiled, rejections)
  rejectCrossSideCostSources(direct, compiled, rejections)
  rejectPricingMismatches(direct, compiled, rejections)
  const capabilityId = commonCapabilityId(direct, compiled, rejections)
  const compiledReplay = direct.length > 0 && compiled.length > 0
    ? validateActiveReplayProjection(value.compiledReplay, capabilityId, "compiledReplay", rejections)
    : undefined
  if (direct.length > 0 && compiled.length > 0) {
    validateReplayInspection(value.compiledReplayInspection, "compiledReplayInspection", rejections)
    validateReplayEvidence(value.compiledReplayEvidence, compiledReplay, "compiledReplayEvidence", rejections)
  }
  rejectReplayMismatches(compiled, compiledReplay, rejections)
  rejectStopMismatches(direct, compiled, rejections)

  let compilation: BenchmarkCompilationInput | undefined
  if (value.compilation !== undefined) compilation = validateCompilationInput(value.compilation, task, capabilityId, direct, compiled, rejections)
  if (rejections.length > 0 || compiledReplay === undefined) return { rejections }
  return {
    rejections,
    value: {
      input: value as unknown as BenchmarkComparisonInput,
      task,
      direct,
      compiled,
      compiledReplay,
      ...(compilation === undefined ? {} : { compilation }),
    },
  }
}

export function validateBenchmarkComparison(value: unknown): readonly BenchmarkRejection[] {
  const inspection = inspectBenchmarkInput(value)
  if (inspection.value === undefined) return inspection.rejections
  const rejections: BenchmarkRejection[] = []
  aggregateValidation(inspection.value, rejections)
  return [...inspection.rejections, ...rejections]
}

function aggregateValidation(comparison: ValidatedBenchmarkComparison, rejections: BenchmarkRejection[]): void {
  aggregateBenchmarkSide("direct", comparison.direct, rejections)
  aggregateBenchmarkSide("compiled", comparison.compiled, rejections)
}

function validatePricingInput(value: unknown, rejections: BenchmarkRejection[]): void {
  if (value === undefined) return
  if (!isRecord(value)) {
    addBenchmarkRejection(rejections, "not_comparable", "invalid_pricing", "pricing", "pricing input must be an object")
    return
  }
  for (const mode of ["direct", "compiled"] as const) {
    const pricing = value[mode]
    if (pricing !== undefined && !isRecord(pricing)) addBenchmarkRejection(rejections, "not_comparable", "invalid_pricing", `pricing.${mode}`, "pricing must contain explicit token prices")
  }
}

function rejectDuplicateIdentities(
  direct: readonly ValidatedExecutionRecord[],
  compiled: readonly ValidatedExecutionRecord[],
  rejections: BenchmarkRejection[],
): void {
  const recordIds = new Set<string>()
  const executionIds = new Set<string>()
  ;[...direct, ...compiled].forEach((record) => {
    const recordId = record.input.measurement.recordId
    const executionId = record.input.execution.id
    if (recordIds.has(recordId)) addBenchmarkRejection(rejections, "not_comparable", "duplicate_execution", `record.${recordId}`, "measured record ids must be distinct")
    if (executionIds.has(executionId)) addBenchmarkRejection(rejections, "not_comparable", "duplicate_execution", `execution.${executionId}`, "execution projection ids must be distinct")
    recordIds.add(recordId)
    executionIds.add(executionId)
  })
}

function rejectCrossSideCostSources(
  direct: readonly ValidatedExecutionRecord[],
  compiled: readonly ValidatedExecutionRecord[],
  rejections: BenchmarkRejection[],
): void {
  const directSource = direct[0]?.costSource
  const compiledSource = compiled[0]?.costSource
  if (directSource !== undefined && compiledSource !== undefined && directSource !== compiledSource) addBenchmarkRejection(rejections, "not_comparable", "multiple_monetary_sources", "pricing", "direct and compiled sides must use the same monetary source")
}

function rejectPricingMismatches(
  direct: readonly ValidatedExecutionRecord[],
  compiled: readonly ValidatedExecutionRecord[],
  rejections: BenchmarkRejection[],
): void {
  const directPricing = direct[0]?.pricing
  const compiledPricing = compiled[0]?.pricing
  if (directPricing !== undefined && compiledPricing !== undefined &&
    (directPricing.inputUsdPerToken !== compiledPricing.inputUsdPerToken || directPricing.outputUsdPerToken !== compiledPricing.outputUsdPerToken)) {
    addBenchmarkRejection(rejections, "not_comparable", "pricing_mismatch", "pricing", "the same model must use the same input and output token prices on both comparison sides")
  }
}

function commonCapabilityId(
  direct: readonly ValidatedExecutionRecord[],
  compiled: readonly ValidatedExecutionRecord[],
  rejections: BenchmarkRejection[],
): string | undefined {
  const ids = [...direct, ...compiled].map((record) => String(record.input.execution.capabilityId))
  const first = ids[0]
  if (first === undefined) return undefined
  if (ids.some((id) => id !== first)) addBenchmarkRejection(rejections, "not_comparable", "task_mismatch", "execution.capabilityId", "direct and compiled records must target one capability")
  return first
}

function rejectReplayMismatches(
  compiled: readonly ValidatedExecutionRecord[],
  replay: ActiveReplayProjection | undefined,
  rejections: BenchmarkRejection[],
): void {
  if (replay === undefined) return
  compiled.forEach((record, index) => {
    if (record.input.execution.replayVersionId !== replay.id) addBenchmarkRejection(rejections, "not_comparable", "execution_replay_mismatch", `compiled[${index}].execution.replayVersionId`, "compiled execution must use the verified active replay projection")
  })
}

function rejectStopMismatches(
  direct: readonly ValidatedExecutionRecord[],
  compiled: readonly ValidatedExecutionRecord[],
  rejections: BenchmarkRejection[],
): void {
  const records = [...direct, ...compiled]
  const first = records[0]
  if (first === undefined) return
  if (records.some((record) => record.stopSignature !== first.stopSignature)) addBenchmarkRejection(rejections, "not_comparable", "stop_outcome_mismatch", "executions", "direct and compiled runs must reach the same safe completion or safety boundary")
}

function validateCompilationInput(
  value: unknown,
  task: BenchmarkTaskIdentity,
  capabilityId: string | undefined,
  direct: readonly ValidatedExecutionRecord[],
  compiled: readonly ValidatedExecutionRecord[],
  rejections: BenchmarkRejection[],
): BenchmarkCompilationInput | undefined {
  const before = rejections.length
  if (!isRecord(value)) {
    addBenchmarkRejection(rejections, "not_comparable", "compilation_projection_invalid", "compilation", "compilation input must be an object")
    return undefined
  }
  if (!isTaskIdentity(value.task)) addBenchmarkRejection(rejections, "not_comparable", "compilation_task_mismatch", "compilation.task", "compilation metrics must carry the comparison task identity")
  else if (!taskIdentityMatches(value.task, task)) addBenchmarkRejection(rejections, "not_comparable", "compilation_task_mismatch", "compilation.task", "compilation metrics belong to a different task, application, objective, or model")

  const attribution = value.attribution
  const projection = value.projection
  validateCompilationAttribution(attribution, direct, compiled, rejections)
  const compareWithExecutionAverages = rejections.length === 0 && direct.length > 0 && compiled.length > 0
  validateCompilationProjection(projection, capabilityId, direct, compiled, compareWithExecutionAverages, rejections)
  if (rejections.length !== before) return undefined
  return value as unknown as BenchmarkCompilationInput
}

function validateCompilationAttribution(
  value: unknown,
  direct: readonly ValidatedExecutionRecord[],
  compiled: readonly ValidatedExecutionRecord[],
  rejections: BenchmarkRejection[],
): void {
  if (!isRecord(value) || value.kind !== "discovery_and_verification_only") {
    addBenchmarkRejection(rejections, "not_comparable", "compilation_attribution_invalid", "compilation.attribution", "compilation cost must be attributed only to discovery and verification")
    return
  }
  const discovery = value.discoveryExecutionIds
  const verification = value.verificationExecutionIds
  if (!hasDistinctIds(discovery) || !hasDistinctIds(verification)) {
    addBenchmarkRejection(rejections, "not_comparable", "compilation_attribution_invalid", "compilation.attribution", "discovery and verification attribution must contain distinct measured execution ids")
    return
  }
  const allAttributed = [...discovery, ...verification]
  if (new Set(allAttributed).size !== allAttributed.length) addBenchmarkRejection(rejections, "not_comparable", "compilation_attribution_invalid", "compilation.attribution", "discovery and verification execution ids must not overlap")
  const comparisonIds = new Set([...direct, ...compiled].map((record) => String(record.input.execution.id)))
  if (allAttributed.some((id) => comparisonIds.has(id))) addBenchmarkRejection(rejections, "not_comparable", "compilation_attribution_invalid", "compilation.attribution", "compilation executions must be separate from direct and compiled comparison executions")
}

function validateCompilationProjection(
  value: unknown,
  capabilityId: string | undefined,
  direct: readonly ValidatedExecutionRecord[],
  compiled: readonly ValidatedExecutionRecord[],
  compareWithExecutionAverages: boolean,
  rejections: BenchmarkRejection[],
): void {
  if (!isRecord(value) || value.projectionKind !== "worth_compilation_metrics") {
    addBenchmarkRejection(rejections, "not_comparable", "compilation_projection_invalid", "compilation.projection", "compilation input must be a Worth compilation-metrics projection")
    return
  }
  if (capabilityId !== undefined && value.capabilityId !== capabilityId) addBenchmarkRejection(rejections, "not_comparable", "compilation_projection_invalid", "compilation.projection.capabilityId", "compilation metrics belong to a different capability")
  if (!isNonNegativeSafeInteger(value.revision)) addBenchmarkRejection(rejections, "not_comparable", "compilation_projection_invalid", "compilation.projection.revision", "compilation projection revision must be a non-negative safe integer")
  const metrics = value.compilation
  if (!isRecord(metrics)) {
    addBenchmarkRejection(rejections, "not_comparable", "compilation_projection_invalid", "compilation.projection.compilation", "compilation metrics are missing")
    return
  }
  if (!isNonNegativeNumber(metrics.explorationCostUsd) || !isNonNegativeNumber(metrics.verificationCostUsd) || !isNonNegativeNumber(metrics.totalCompilationCostUsd)) addBenchmarkRejection(rejections, "not_comparable", "compilation_projection_invalid", "compilation.projection.compilation", "compilation costs must be finite and non-negative")
  const calculated = calculateCompilationMetrics({
    explorationCostUsd: metrics.explorationCostUsd,
    verificationCostUsd: metrics.verificationCostUsd,
    directAverageCostUsd: metrics.directAverageCostUsd,
    compiledAverageCostUsd: metrics.compiledAverageCostUsd,
  } as CompilationMetricsInput)
  if (!calculated.ok) {
    calculated.issues.forEach((entry) => addBenchmarkRejection(rejections, "not_comparable", "compilation_projection_invalid", `compilation.projection.compilation.${entry.path}`, entry.message))
    return
  }
  if (metrics.totalCompilationCostUsd !== calculated.value.totalCompilationCostUsd) addBenchmarkRejection(rejections, "not_comparable", "compilation_projection_invalid", "compilation.projection.compilation.totalCompilationCostUsd", "total compilation cost must equal exploration plus verification cost")
  if (!sameBreakEven(metrics.breakEvenCalls, calculated.value.breakEvenCalls)) addBenchmarkRejection(rejections, "not_comparable", "compilation_projection_invalid", "compilation.projection.compilation.breakEvenCalls", "break-even projection does not match its component costs")
  if (compareWithExecutionAverages) {
    validateCompilationAverages(metrics.directAverageCostUsd, direct, "directAverageCostUsd", rejections)
    validateCompilationAverages(metrics.compiledAverageCostUsd, compiled, "compiledAverageCostUsd", rejections)
  }
  if (value.lifetime !== undefined) validateLifetimeProjection(value.lifetime, calculated.value, rejections)
}

function validateCompilationAverages(
  projectedAverage: unknown,
  records: readonly ValidatedExecutionRecord[],
  field: "directAverageCostUsd" | "compiledAverageCostUsd",
  rejections: BenchmarkRejection[],
): void {
  if (projectedAverage === undefined || records.length === 0) return
  const measuredAverage = records.reduce((total, record) => total + record.costUsd, 0) / records.length
  if (!Number.isFinite(measuredAverage) || projectedAverage !== measuredAverage) addBenchmarkRejection(rejections, "not_comparable", "compilation_projection_invalid", `compilation.projection.compilation.${field}`, `Worth ${field} must equal the measured ${field === "directAverageCostUsd" ? "direct" : "compiled"} comparison average`)
}

function validateLifetimeProjection(value: unknown, metrics: CompilationMetrics, rejections: BenchmarkRejection[]): void {
  if (!isRecord(value) || !isNonNegativeSafeInteger(value.executions)) {
    addBenchmarkRejection(rejections, "not_comparable", "compilation_projection_invalid", "compilation.projection.lifetime", "lifetime projection must contain a non-negative execution count")
    return
  }
  const calculated = calculateLifetimeEconomics(metrics, value.executions)
  if (!calculated.ok) {
    calculated.issues.forEach((entry) => addBenchmarkRejection(rejections, "not_comparable", "compilation_projection_invalid", `compilation.projection.lifetime.${entry.path}`, entry.message))
    return
  }
  if (!sameLifetime(value, calculated.value)) addBenchmarkRejection(rejections, "not_comparable", "compilation_projection_invalid", "compilation.projection.lifetime", "lifetime projection does not match its measured compilation and average costs")
}

function sameBreakEven(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return left === right
  if (!isRecord(left) || !isRecord(right) || left.kind !== right.kind || left.savingsPerCallUsd !== right.savingsPerCallUsd) return false
  switch (left.kind) {
    case "immediate":
      return right.kind === "immediate" && left.calls === 0 && right.calls === 0
    case "finite":
      return right.kind === "finite" && left.calls === right.calls && left.exactCalls === right.exactCalls
    case "never":
      return right.kind === "never" && left.reason === "compiled_not_cheaper" && right.reason === "compiled_not_cheaper"
    case "unavailable":
      return right.kind === "unavailable" && left.reason === right.reason && (left.reason === "break_even_exceeds_safe_integer_range" || left.reason === "break_even_ratio_underflowed")
    default:
      return false
  }
}

function sameLifetime(left: unknown, right: LifetimeEconomics): boolean {
  return isRecord(left) &&
    left.executions === right.executions &&
    left.lifetimeDirectCostAvoidedUsd === right.lifetimeDirectCostAvoidedUsd &&
    left.lifetimeCompiledCostUsd === right.lifetimeCompiledCostUsd &&
    left.lifetimeNetSavingsUsd === right.lifetimeNetSavingsUsd
}

function hasDistinctIds(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyText) && new Set(value).size === value.length
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}
