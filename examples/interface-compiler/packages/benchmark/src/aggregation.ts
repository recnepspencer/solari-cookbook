import type { EvidenceId, SafetyStopResult } from "@interface-compiler/domain"
import type { BenchmarkMetricValues, BenchmarkRejection, BenchmarkSideReport, BenchmarkRecoveryStatus } from "./contract.js"
import { addBenchmarkRejection } from "./rejection.js"
import type { ValidatedExecutionRecord } from "./record-validation.js"

export function aggregateBenchmarkSide(
  mode: "direct" | "compiled",
  records: readonly ValidatedExecutionRecord[],
  rejections: BenchmarkRejection[],
): BenchmarkSideReport | undefined {
  if (records.length === 0) {
    addBenchmarkRejection(rejections, "not_measured", mode === "direct" ? "missing_direct_records" : "missing_compiled_records", mode, `${mode} side has no valid measured execution records`)
    return undefined
  }
  const sources = new Set(records.map((record) => record.costSource))
  if (sources.size !== 1) {
    addBenchmarkRejection(rejections, "not_comparable", "multiple_monetary_sources", mode, "all records on a comparison side must use one monetary source")
    return undefined
  }
  const totals = sumMetrics(records)
  if (totals === undefined) {
    addBenchmarkRejection(rejections, "not_comparable", "numeric_overflow", mode, "measured metric totals exceeded the finite number range")
    return undefined
  }
  const totalCostUsd = records.reduce((total, record) => total + record.costUsd, 0)
  if (!Number.isFinite(totalCostUsd)) {
    addBenchmarkRejection(rejections, "not_comparable", "numeric_overflow", `${mode}.modelCost`, "measured model-cost total exceeded the finite number range")
    return undefined
  }
  const count = records.length
  const averages = divideMetrics(totals, count)
  const evidenceIds = uniqueEvidenceIds(records)
  const completedRecoveryRecords = records.filter((record) => record.input.measurement.recovery.status === "completed").length
  const recoveryStatus: BenchmarkRecoveryStatus = completedRecoveryRecords === 0
    ? "not_required"
    : completedRecoveryRecords === count
      ? "completed"
      : "mixed"
  const terminalReasons = uniqueTerminalReasons(records)
  const first = records[0]
  return {
    mode,
    recordCount: count,
    recordIds: records.map((record) => record.input.measurement.recordId),
    executionIds: records.map((record) => record.input.execution.id),
    totals,
    averages,
    modelCost: {
      totalUsd: totalCostUsd,
      averageUsd: totalCostUsd / count,
      source: first?.costSource ?? "worth_execution_projection",
      ...(first?.pricing === undefined ? {} : { pricing: first.pricing }),
    },
    stop: {
      status: records[0]?.stopStatus ?? "safe_completion",
      terminalReasons,
    },
    recovery: {
      status: recoveryStatus,
      completedRecords: completedRecoveryRecords,
      recordCount: count,
    },
    evidence: {
      status: "complete",
      evidenceIds,
      recordCount: count,
    },
    inspection: {
      status: "passed",
      recordCount: count,
    },
  }
}

function sumMetrics(records: readonly ValidatedExecutionRecord[]): BenchmarkMetricValues | undefined {
  const totals = {
    modelCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    browserObservations: 0,
    browserActions: 0,
    toolCalls: 0,
    wallClockMs: 0,
  }
  for (const record of records) {
    const metrics = record.input.execution.metrics
    totals.modelCalls += metrics.modelCalls
    totals.inputTokens += metrics.inputTokens
    totals.outputTokens += metrics.outputTokens
    totals.totalTokens += metrics.inputTokens + metrics.outputTokens
    totals.browserObservations += metrics.browserObservations
    totals.browserActions += metrics.browserActions
    totals.toolCalls += record.input.measurement.toolCalls
    totals.wallClockMs += metrics.wallClockMs ?? 0
  }
  const counterFields: readonly (keyof BenchmarkMetricValues)[] = [
    "modelCalls",
    "inputTokens",
    "outputTokens",
    "totalTokens",
    "browserObservations",
    "browserActions",
    "toolCalls",
  ]
  return Object.values(totals).every(Number.isFinite) && counterFields.every((field) => Number.isSafeInteger(totals[field])) ? totals : undefined
}

function divideMetrics(values: BenchmarkMetricValues, divisor: number): BenchmarkMetricValues {
  return {
    modelCalls: values.modelCalls / divisor,
    inputTokens: values.inputTokens / divisor,
    outputTokens: values.outputTokens / divisor,
    totalTokens: values.totalTokens / divisor,
    browserObservations: values.browserObservations / divisor,
    browserActions: values.browserActions / divisor,
    toolCalls: values.toolCalls / divisor,
    wallClockMs: values.wallClockMs / divisor,
  }
}

function uniqueEvidenceIds(records: readonly ValidatedExecutionRecord[]): readonly EvidenceId[] {
  const ids: EvidenceId[] = []
  const seen = new Set<string>()
  records.forEach((record) => record.input.measurement.evidence.evidenceIds.forEach((id) => {
    if (!seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
  }))
  return ids
}

function uniqueTerminalReasons(records: readonly ValidatedExecutionRecord[]): readonly SafetyStopResult["reason"][] {
  const reasons: SafetyStopResult["reason"][] = []
  const seen = new Set<string>()
  records.forEach((record) => {
    if (record.stopReason !== undefined && !seen.has(record.stopReason)) {
      seen.add(record.stopReason)
      reasons.push(record.stopReason)
    }
  })
  return reasons
}
