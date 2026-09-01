import type {
  BreakEvenCalls,
  CapabilityId,
  ExecutionId,
  ReplayVersionId,
  SafetyStopResult,
} from "@interface-compiler/domain"
import type {
  CompiledPlanMeasurementProvenance,
  WorthQueryEvidence,
  WorthRuntimeSettlementResult,
} from "@interface-compiler/worth-adapter"
import type { BenchmarkTaskIdentity } from "./contract.js"

export const terminalBenchmarkReportSchemaVersion = "interface-compiler.terminal-benchmark.v1" as const

export type WorthSettledBenchmarkExecution = Extract<WorthRuntimeSettlementResult, { readonly kind: "settled" }>

export interface TerminalCompiledPlanAuthority {
  readonly capabilityId: CapabilityId
  readonly replayVersionId: ReplayVersionId
  readonly compilationProvenance: CompiledPlanMeasurementProvenance
  readonly capabilityEvidence: WorthQueryEvidence
  readonly replayEvidence: WorthQueryEvidence
}

export interface TerminalCompilationExecutions {
  readonly discovery: readonly WorthSettledBenchmarkExecution[]
  readonly verification: readonly WorthSettledBenchmarkExecution[]
}

export interface TerminalBenchmarkReportInput {
  readonly task: BenchmarkTaskIdentity
  readonly direct: WorthSettledBenchmarkExecution
  readonly compiled: WorthSettledBenchmarkExecution
  readonly compiledPlan: TerminalCompiledPlanAuthority
  readonly compilation?: TerminalCompilationExecutions
}

export interface TerminalBenchmarkMetrics {
  readonly modelCalls: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly browserObservations: number
  readonly browserActions: number
  readonly wallClockMs: number
  readonly estimatedModelCostUsd: number
}

export interface TerminalBenchmarkRunReport {
  readonly executionId: ExecutionId
  readonly mode: "direct" | "compiled"
  readonly metrics: TerminalBenchmarkMetrics
  readonly boundary: SafetyStopResult["reason"]
  readonly worthEvidence: WorthQueryEvidence
}

export type TerminalBenchmarkSavings = Readonly<{
  [Metric in keyof TerminalBenchmarkMetrics]: {
    readonly direct: number
    readonly compiled: number
    readonly absolute: number
    readonly fractionOfDirect: { readonly kind: "measured"; readonly value: number } | { readonly kind: "not_computable"; readonly reason: "zero_denominator" }
  }
}>

export type TerminalCompilationEconomics =
  | {
      readonly kind: "measured"
      readonly discoveryCostUsd: number
      readonly verificationCostUsd: number
      readonly totalCostUsd: number
      readonly discoveryExecutionIds: readonly ExecutionId[]
      readonly verificationExecutionIds: readonly ExecutionId[]
    }
  | {
      readonly kind: "not_measured"
      readonly reason: "synthetic_seed_not_economic_evidence" | "compilation_terminal_projections_not_supplied"
      readonly rejectedSuppliedCompilation: boolean
    }

export type TerminalBreakEven =
  | { readonly kind: "measured"; readonly value: BreakEvenCalls }
  | { readonly kind: "not_measured"; readonly reason: "synthetic_seed_not_economic_evidence" | "compilation_terminal_projections_not_supplied" }

export interface MeasuredTerminalBenchmarkReport {
  readonly schemaVersion: typeof terminalBenchmarkReportSchemaVersion
  readonly kind: "measured"
  readonly task: BenchmarkTaskIdentity
  readonly direct: TerminalBenchmarkRunReport
  readonly compiled: TerminalBenchmarkRunReport
  readonly perRunSavings: TerminalBenchmarkSavings
  readonly economics: {
    readonly compilation: TerminalCompilationEconomics
    readonly breakEven: TerminalBreakEven
  }
  readonly provenance: {
    readonly authority: "worth_terminal_execution_projections"
    readonly executionIds: readonly ExecutionId[]
    readonly planQueryIdentities: readonly string[]
  }
}

export interface TerminalBenchmarkIssue {
  readonly path: string
  readonly code:
    | "invalid_task"
    | "invalid_worth_evidence"
    | "invalid_terminal_projection"
    | "mode_mismatch"
    | "capability_mismatch"
    | "replay_mismatch"
    | "unsafe_terminal_outcome"
    | "boundary_mismatch"
    | "duplicate_execution"
    | "compilation_attribution_mismatch"
    | "numeric_overflow"
  readonly message: string
}

export interface UnavailableTerminalBenchmarkReport {
  readonly schemaVersion: typeof terminalBenchmarkReportSchemaVersion
  readonly kind: "not_comparable"
  readonly task?: BenchmarkTaskIdentity
  readonly issues: readonly TerminalBenchmarkIssue[]
  readonly provenance: { readonly authority: "worth_terminal_execution_projections" }
}

export type TerminalBenchmarkReport = MeasuredTerminalBenchmarkReport | UnavailableTerminalBenchmarkReport
