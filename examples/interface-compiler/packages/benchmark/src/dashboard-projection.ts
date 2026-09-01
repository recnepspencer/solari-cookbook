import type {
  TerminalBenchmarkMetrics,
  TerminalBenchmarkReport,
  TerminalWorkflowBenchmarkReport,
} from "./terminal-report-contract.js"
import { terminalBenchmarkReportSchemaVersion } from "./terminal-report-contract.js"

/**
 * Presentation-only derivative of the terminal benchmark schema.
 *
 * This is deliberately the only benchmark shape a dashboard may consume. The
 * terminal report remains WORTH's cost authority; totalTokens is a lossless
 * display calculation, never a second measurement.
 */
export interface TerminalDashboardBenchmarkValues extends TerminalBenchmarkMetrics {
  readonly totalTokens: number
}

export type TerminalDashboardBenchmarkSide =
  | {
      readonly kind: "measured"
      readonly values: TerminalDashboardBenchmarkValues
      readonly executionIds: readonly string[]
    }
  | {
      readonly kind: "not_comparable"
      readonly reason: "terminal_report_not_comparable"
      readonly executionIds: readonly string[]
    }

export interface TerminalDashboardBenchmarkProjection {
  readonly direct: TerminalDashboardBenchmarkSide
  readonly compiled: TerminalDashboardBenchmarkSide
}

export type TerminalBenchmarkAnyReport = TerminalBenchmarkReport | TerminalWorkflowBenchmarkReport

export function projectTerminalBenchmarkForDashboard(report: TerminalBenchmarkAnyReport): TerminalDashboardBenchmarkProjection {
  if (report.kind !== "measured") {
    const unavailable = Object.freeze({ kind: "not_comparable" as const, reason: "terminal_report_not_comparable" as const, executionIds: Object.freeze([]) })
    return Object.freeze({ direct: unavailable, compiled: unavailable })
  }
  return Object.freeze({ direct: projectRun(report.direct), compiled: projectRun(report.compiled) })
}

/** Minimal protocol admission for a terminal report before it reaches a view. */
export function isTerminalBenchmarkReport(value: unknown): value is TerminalBenchmarkAnyReport {
  if (!isRecord(value) || value.schemaVersion !== terminalBenchmarkReportSchemaVersion || (value.task !== undefined && !isTerminalTask(value.task)) || !isRecord(value.provenance) || value.provenance.authority !== "worth_terminal_execution_projections") return false
  if (value.kind === "not_comparable") return Array.isArray(value.issues)
  return value.kind === "measured" && isTerminalRun(value.direct) && isTerminalRun(value.compiled)
}

function projectRun(run: { readonly metrics: TerminalBenchmarkMetrics; readonly executionId?: string; readonly executionIds?: readonly string[] }): TerminalDashboardBenchmarkSide {
  const executionIds = run.executionIds ?? (run.executionId === undefined ? [] : [run.executionId])
  return Object.freeze({
    kind: "measured",
    values: Object.freeze({ ...run.metrics, totalTokens: run.metrics.inputTokens + run.metrics.outputTokens }),
    executionIds: Object.freeze([...executionIds]),
  })
}

function isTerminalTask(value: unknown): boolean {
  return isRecord(value) && isNonEmptyText(value.taskId) && isNonEmptyText(value.applicationId) && isNonEmptyText(value.objectiveFingerprint) && isNonEmptyText(value.modelId)
}

function isTerminalRun(value: unknown): value is { readonly metrics: TerminalBenchmarkMetrics; readonly executionId?: string; readonly executionIds?: readonly string[] } {
  if (!isRecord(value) || !isRecord(value.metrics) || !isTerminalMetrics(value.metrics)) return false
  const single = value.executionId === undefined || isNonEmptyText(value.executionId)
  const multiple = value.executionIds === undefined || (Array.isArray(value.executionIds) && value.executionIds.length > 0 && value.executionIds.every(isNonEmptyText))
  return single && multiple && (value.executionId !== undefined || value.executionIds !== undefined)
}

function isTerminalMetrics(value: Record<string, unknown>): boolean {
  const values = ["modelCalls", "inputTokens", "outputTokens", "browserObservations", "browserActions", "wallClockMs", "estimatedModelCostMicrocents"]
  return values.every((key) => Number.isSafeInteger(value[key]) && (value[key] as number) >= 0) && Number.isSafeInteger((value.inputTokens as number) + (value.outputTokens as number))
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
