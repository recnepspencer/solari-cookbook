import type { EvidenceId } from "@interface-compiler/domain"
import type { BenchmarkCalculationProvenance, BenchmarkComparisonInput, BenchmarkReport, BenchmarkReportProvenance, BenchmarkReportProvenanceSourceKind, BenchmarkRejection, MeasuredBenchmarkReport, UnavailableBenchmarkReport } from "./contract.js"
import { benchmarkReportSchemaVersion } from "./contract.js"
import { aggregateBenchmarkSide } from "./aggregation.js"
import { buildEconomics } from "./economics.js"
import { inspectBenchmarkInput, type ValidatedBenchmarkComparison } from "./input-validation.js"
import { isTaskIdentity } from "./record-validation.js"

export function createBenchmarkReport(input: BenchmarkComparisonInput): BenchmarkReport {
  const inspection = inspectBenchmarkInput(input)
  if (inspection.rejections.length > 0 || inspection.value === undefined) return unavailableReport(input, inspection.rejections)
  const comparison = inspection.value
  const rejections: BenchmarkRejection[] = []
  const direct = aggregateBenchmarkSide("direct", comparison.direct, rejections)
  const compiled = aggregateBenchmarkSide("compiled", comparison.compiled, rejections)
  if (rejections.length > 0 || direct === undefined || compiled === undefined) return unavailableReport(input, rejections)
  return measuredReport(comparison, direct, compiled)
}

export function isMeasuredBenchmarkReport(value: BenchmarkReport): value is MeasuredBenchmarkReport {
  return value.kind === "measured" && value.schemaVersion === benchmarkReportSchemaVersion
}

function measuredReport(
  comparison: ValidatedBenchmarkComparison,
  direct: MeasuredBenchmarkReport["direct"],
  compiled: MeasuredBenchmarkReport["compiled"],
): MeasuredBenchmarkReport {
  return {
    schemaVersion: benchmarkReportSchemaVersion,
    kind: "measured",
    task: comparison.task,
    direct,
    compiled,
    compiledReplay: {
      replayVersionId: comparison.compiledReplay.id,
      version: comparison.compiledReplay.version,
      revision: comparison.compiledReplay.revision,
      status: "active_verified",
      requiredSuccessfulRuns: comparison.compiledReplay.verification.requiredSuccessfulRuns,
      successfulRuns: comparison.compiledReplay.verification.runs.filter((run) => run.outcome === "success").length,
      runCount: comparison.compiledReplay.verification.runs.length,
      failedRuns: comparison.compiledReplay.verification.runs.filter((run) => run.outcome === "failure").length,
      evidenceIds: uniqueReplayEvidenceIds(comparison.compiledReplay),
    },
    economics: buildEconomics(comparison, direct, compiled),
    provenance: buildProvenance(comparison),
  }
}

function uniqueReplayEvidenceIds(replay: ValidatedBenchmarkComparison["compiledReplay"]): readonly EvidenceId[] {
  const ids: EvidenceId[] = []
  const seen = new Set<string>()
  replay.verification.runs.forEach((run) => run.evidenceIds.forEach((evidenceId) => {
    if (!seen.has(evidenceId)) {
      seen.add(evidenceId)
      ids.push(evidenceId)
    }
  }))
  return ids
}

function unavailableReport(input: unknown, rejections: readonly BenchmarkRejection[]): UnavailableBenchmarkReport {
  const category = rejections.some((entry) => entry.category === "not_comparable") ? "not_comparable" : "not_measured"
  const task = isTaskIdentityValue(input) ? input.task : undefined
  return {
    schemaVersion: benchmarkReportSchemaVersion,
    kind: category,
    ...(task === undefined ? {} : { task }),
    reasons: rejections.length === 0 ? [fallbackRejection(category)] : rejections,
    provenance: emptyProvenance(),
  }
}

function buildProvenance(comparison: ValidatedBenchmarkComparison): BenchmarkReportProvenance {
  const directExecutionIds = comparison.direct.map((record) => String(record.input.execution.id))
  const compiledExecutionIds = comparison.compiled.map((record) => String(record.input.execution.id))
  const directRecordIds = comparison.direct.map((record) => record.input.measurement.recordId)
  const compiledRecordIds = comparison.compiled.map((record) => record.input.measurement.recordId)
  const allExecutionIds = [...directExecutionIds, ...compiledExecutionIds]
  const allRecordIds = [...directRecordIds, ...compiledRecordIds]
  const sources: { kind: BenchmarkReportProvenanceSourceKind; references: readonly string[] }[] = [
    { kind: "worth_execution_projection", references: allExecutionIds },
    { kind: "worth_measurement_metadata", references: allRecordIds },
    { kind: "worth_active_replay_projection", references: [`${String(comparison.compiledReplay.id)}@revision:${comparison.compiledReplay.revision}`] },
  ]
  if (comparison.direct[0]?.costSource === "explicit_model_pricing" || comparison.compiled[0]?.costSource === "explicit_model_pricing") sources.push({ kind: "explicit_model_pricing", references: ["direct", "compiled"].filter((mode) => mode === "direct" ? comparison.direct[0]?.costSource === "explicit_model_pricing" : comparison.compiled[0]?.costSource === "explicit_model_pricing") })
  if (comparison.direct[0]?.costSource === "explicit_model_cost" || comparison.compiled[0]?.costSource === "explicit_model_cost") sources.push({ kind: "explicit_model_cost", references: [...directRecordIds, ...compiledRecordIds] })
  const calculations: BenchmarkCalculationProvenance[] = [
    { name: "total_tokens", formula: "totalTokens = inputTokens + outputTokens for each measured execution", inputReferences: allExecutionIds },
    { name: "side_averages", formula: "side average = sum of measured values / measured record count", inputReferences: allExecutionIds },
    { name: "model_cost", formula: costFormula(comparison), inputReferences: allExecutionIds },
    { name: "savings", formula: "per-execution savings = direct average - compiled average", inputReferences: [...directExecutionIds, ...compiledExecutionIds] },
    { name: "savings_percentage", formula: "percentage saved = (direct average - compiled average) / direct average; zero baselines are not computed", inputReferences: [...directExecutionIds, ...compiledExecutionIds] },
  ]
  if (comparison.compilation !== undefined) {
    const projectionReference = `${String(comparison.compilation.projection.capabilityId)}@revision:${comparison.compilation.projection.revision}`
    sources.push({ kind: "worth_compilation_metrics_projection", references: [projectionReference] })
    calculations.push({ name: "compilation_cost_attribution", formula: "Worth projection totalCompilationCostUsd = explorationCostUsd + verificationCostUsd; attributed once to discovery and verification only", inputReferences: [projectionReference, ...comparison.compilation.attribution.discoveryExecutionIds, ...comparison.compilation.attribution.verificationExecutionIds] })
    if (comparison.compilation.projection.compilation.breakEvenCalls !== undefined) calculations.push({ name: "break_even", formula: "break-even value is displayed from the Worth compilation-metrics projection after component validation; it is not recomputed locally", inputReferences: [projectionReference] })
    if (comparison.compilation.projection.lifetime !== undefined) calculations.push({ name: "lifetime_economics", formula: "lifetime economics is displayed from the Worth compilation-metrics projection after consistency validation; it is not recomputed locally", inputReferences: [projectionReference] })
  }
  return { authority: "worth_query_projections", sources, calculations }
}

function costFormula(comparison: ValidatedBenchmarkComparison): string {
  const sources = new Set([...comparison.direct, ...comparison.compiled].map((record) => record.costSource))
  if (sources.has("explicit_model_pricing")) return "modelCostUsd = inputTokens × inputUsdPerToken + outputTokens × outputUsdPerToken"
  if (sources.has("explicit_model_cost")) return "modelCostUsd = explicit provider-reported model cost in USD"
  return "modelCostUsd = Worth execution projection estimatedModelCostUsd"
}

function emptyProvenance(): BenchmarkReportProvenance {
  return { authority: "worth_query_projections", sources: [], calculations: [] }
}

function fallbackRejection(category: "not_measured" | "not_comparable"): BenchmarkRejection {
  return {
    category,
    code: "input_invalid",
    path: "input",
    message: category === "not_measured" ? "no measured comparison was available" : "comparison was not comparable",
  }
}

function isTaskIdentityValue(value: unknown): value is { readonly task: import("./contract.js").BenchmarkTaskIdentity } {
  if (value === null || typeof value !== "object") return false
  const task = (value as Record<string, unknown>).task
  return isTaskIdentity(task)
}
