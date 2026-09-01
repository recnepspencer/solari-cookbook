import type { CapabilityId, ExecutionId } from "@interface-compiler/domain"
import type { WorthQueryEvidence } from "@interface-compiler/worth-adapter"
import type { BenchmarkTaskIdentity } from "./contract.js"
import type { WorthSettledBenchmarkExecution } from "./terminal-report-contract.js"

export const workflowBenchmarkReportSchemaVersion = "interface-compiler.workflow-benchmark.v1" as const

export interface WorkflowBenchmarkStep {
  readonly capabilityId: CapabilityId
  readonly replayVersionId: string
}

export interface WorkflowBenchmarkInput {
  readonly task: BenchmarkTaskIdentity
  /** The ordered public-tool workflow, not browser actions. */
  readonly workflow: readonly WorkflowBenchmarkStep[]
  readonly direct: readonly WorthSettledBenchmarkExecution[]
  readonly compiled: readonly WorthSettledBenchmarkExecution[]
}

export interface WorkflowBenchmarkMetrics {
  readonly modelCalls: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly browserObservations: number
  readonly browserActions: number
  readonly wallClockMs: number
  readonly estimatedModelCostUsd: number
}

export type WorkflowBenchmarkReport =
  | {
      readonly schemaVersion: typeof workflowBenchmarkReportSchemaVersion
      readonly kind: "measured"
      readonly task: BenchmarkTaskIdentity
      readonly workflow: readonly WorkflowBenchmarkStep[]
      readonly direct: WorkflowBenchmarkMetrics
      readonly compiled: WorkflowBenchmarkMetrics
      readonly savings: Readonly<{ [Metric in keyof WorkflowBenchmarkMetrics]: number }>
      readonly provenance: { readonly authority: "worth_terminal_execution_projections"; readonly executionIds: readonly ExecutionId[] }
    }
  | {
      readonly schemaVersion: typeof workflowBenchmarkReportSchemaVersion
      readonly kind: "not_measured"
      readonly task: BenchmarkTaskIdentity
      readonly reasons: readonly string[]
      readonly provenance: { readonly authority: "worth_terminal_execution_projections" }
    }

/**
 * This deliberately accepts only settled WORTH terminal projections. It does
 * not take model pricing, browser counters, or a caller-supplied aggregate.
 */
export function createWorkflowBenchmarkReport(input: WorkflowBenchmarkInput): WorkflowBenchmarkReport {
  const reasons: string[] = []
  if (input.workflow.length === 0) reasons.push("workflow must identify at least one semantic capability")
  if (input.direct.length !== input.workflow.length || input.compiled.length !== input.workflow.length) reasons.push("each mode must contain exactly one WORTH terminal execution per semantic capability")
  validateMode(input.direct, "direct", input.workflow, reasons)
  validateMode(input.compiled, "compiled", input.workflow, reasons)
  const allIds = [...input.direct, ...input.compiled].map((entry) => entry.projection.executionId)
  if (new Set(allIds).size !== allIds.length) reasons.push("WORTH execution identities must be unique across both modes")
  if (reasons.length > 0) return Object.freeze({ schemaVersion: workflowBenchmarkReportSchemaVersion, kind: "not_measured", task: Object.freeze({ ...input.task }), reasons: Object.freeze(reasons), provenance: { authority: "worth_terminal_execution_projections" as const } })

  const direct = aggregate(input.direct)
  const compiled = aggregate(input.compiled)
  return Object.freeze({
    schemaVersion: workflowBenchmarkReportSchemaVersion,
    kind: "measured",
    task: Object.freeze({ ...input.task }),
    workflow: Object.freeze(input.workflow.map((step) => Object.freeze({ ...step }))),
    direct,
    compiled,
    savings: savings(direct, compiled),
    provenance: { authority: "worth_terminal_execution_projections" as const, executionIds: Object.freeze(allIds) },
  })
}

function validateMode(entries: readonly WorthSettledBenchmarkExecution[], mode: "direct" | "compiled", workflow: readonly WorkflowBenchmarkStep[], reasons: string[]): void {
  entries.forEach((entry, index) => {
    const expected = workflow[index]
    if (!expected) return
    const projection = entry.projection
    if (!validEvidence(entry.evidence)) reasons.push(`${mode}[${index}] lacks released WORTH execution evidence`)
    if (entry.commit !== "committed" && entry.commit !== "already_committed") reasons.push(`${mode}[${index}] was not committed by WORTH`)
    if (projection.mode !== mode) reasons.push(`${mode}[${index}] mode does not match its workflow side`)
    if (projection.capabilityId !== expected.capabilityId) reasons.push(`${mode}[${index}] capability is not the ordered semantic capability`)
    if (projection.lifecycle !== "success" || projection.outcome.kind !== "success") reasons.push(`${mode}[${index}] did not reach the semantic postcondition`)
    if (mode === "compiled" && projection.replayVersionId !== expected.replayVersionId) reasons.push(`${mode}[${index}] does not name the admitted replay`)
    if (mode === "direct" && projection.replayVersionId !== undefined) reasons.push(`${mode}[${index}] direct execution unexpectedly names a replay`)
  })
}

function aggregate(entries: readonly WorthSettledBenchmarkExecution[]): WorkflowBenchmarkMetrics {
  return Object.freeze(entries.reduce<WorkflowBenchmarkMetrics>((total, entry) => ({
    modelCalls: total.modelCalls + entry.projection.metrics.modelCalls,
    inputTokens: total.inputTokens + entry.projection.metrics.inputTokens,
    outputTokens: total.outputTokens + entry.projection.metrics.outputTokens,
    browserObservations: total.browserObservations + entry.projection.metrics.browserObservations,
    browserActions: total.browserActions + entry.projection.metrics.browserActions,
    wallClockMs: total.wallClockMs + (entry.projection.metrics.wallClockMs ?? 0),
    estimatedModelCostUsd: total.estimatedModelCostUsd + entry.projection.metrics.estimatedModelCostUsd,
  }), { modelCalls: 0, inputTokens: 0, outputTokens: 0, browserObservations: 0, browserActions: 0, wallClockMs: 0, estimatedModelCostUsd: 0 }))
}

function savings(direct: WorkflowBenchmarkMetrics, compiled: WorkflowBenchmarkMetrics): Readonly<{ [Metric in keyof WorkflowBenchmarkMetrics]: number }> {
  return Object.freeze({
    modelCalls: direct.modelCalls - compiled.modelCalls,
    inputTokens: direct.inputTokens - compiled.inputTokens,
    outputTokens: direct.outputTokens - compiled.outputTokens,
    browserObservations: direct.browserObservations - compiled.browserObservations,
    browserActions: direct.browserActions - compiled.browserActions,
    wallClockMs: direct.wallClockMs - compiled.wallClockMs,
    estimatedModelCostUsd: direct.estimatedModelCostUsd - compiled.estimatedModelCostUsd,
  })
}

function validEvidence(evidence: WorthQueryEvidence): boolean {
  return evidence.queryName === "interface_compiler_execution_read" && evidence.projectedRecordCount === 1 && evidence.projectedFieldCount === 8 && evidence.basisReleased === true && evidence.queryIdentity.trim().length > 0
}
