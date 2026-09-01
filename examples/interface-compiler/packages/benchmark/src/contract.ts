import type {
  ActiveReplayProjection,
  ApplicationId,
  BreakEvenCalls,
  ExecutionId,
  ExecutionProjection,
  EvidenceId,
  LifetimeEconomics,
  ModelPricingUsdPerToken,
  ModelUsage,
  ReplayVersionId,
  SafetyStopResult,
} from "@interface-compiler/domain"
import type { WorthCompilationMetricsProjection } from "@interface-compiler/worth-adapter"

export const benchmarkReportSchemaVersion = "interface-compiler.benchmark.v1" as const

export interface BenchmarkTaskIdentity {
  readonly taskId: string
  readonly applicationId: ApplicationId
  readonly objectiveFingerprint: string
  readonly modelId: string
}

export type BenchmarkInspection =
  | { readonly status: "passed"; readonly source: "worth"; readonly reference?: string }
  | { readonly status: "failed"; readonly source: "worth"; readonly reason: string; readonly reference?: string }
  | { readonly status: "provisional"; readonly source: "worth"; readonly reason: string; readonly reference?: string }

export type BenchmarkEvidence =
  | { readonly status: "complete"; readonly source: "worth"; readonly evidenceIds: readonly EvidenceId[]; readonly reference?: string }
  | { readonly status: "missing"; readonly source: "worth"; readonly evidenceIds: readonly EvidenceId[]; readonly missingEvidenceIds: readonly EvidenceId[]; readonly reference?: string }
  | { readonly status: "failed"; readonly source: "worth"; readonly evidenceIds: readonly EvidenceId[]; readonly failedEvidenceIds: readonly EvidenceId[]; readonly reference?: string }

export type BenchmarkRecovery =
  | { readonly status: "not_required" }
  | { readonly status: "completed"; readonly reference?: string }
  | { readonly status: "required"; readonly reason: string; readonly reference?: string }
  | { readonly status: "unknown"; readonly reason: string; readonly reference?: string }

export type BenchmarkSafety =
  | { readonly kind: "safe_completion" }
  | { readonly kind: "stopped_at_boundary"; readonly stop: SafetyStopResult }
  | { readonly kind: "unsafe"; readonly reason: string }

export interface MeasuredBenchmarkExecutionMeasurement {
  readonly status: "measured"
  readonly source: "worth"
  readonly recordId: string
  readonly toolCalls: number
  readonly inspection: BenchmarkInspection
  readonly evidence: BenchmarkEvidence
  readonly recovery: BenchmarkRecovery
  readonly safety: BenchmarkSafety
  /** Optional measured usage that must exactly match the execution projection. */
  readonly usage?: ModelUsage
  /** Optional explicit provider-reported model cost, in USD. */
  readonly modelCostUsd?: number
}

export type BenchmarkExecutionMeasurement =
  | MeasuredBenchmarkExecutionMeasurement
  | { readonly status: "not_measured"; readonly reason: string; readonly source?: "worth" | "other"; readonly recordId?: string }
  | { readonly status: "provisional"; readonly reason: string; readonly source?: "worth" | "other"; readonly recordId?: string }

export interface BenchmarkExecutionRecord {
  readonly task: BenchmarkTaskIdentity
  readonly execution: ExecutionProjection
  readonly measurement: BenchmarkExecutionMeasurement
}

export interface BenchmarkPricingInput {
  readonly direct?: ModelPricingUsdPerToken
  readonly compiled?: ModelPricingUsdPerToken
}

export interface BenchmarkCompilationAttribution {
  readonly kind: "discovery_and_verification_only"
  readonly discoveryExecutionIds: readonly ExecutionId[]
  readonly verificationExecutionIds: readonly ExecutionId[]
}

/** A Worth projection plus the task and attribution scope supplied by the query caller. */
export interface BenchmarkCompilationInput {
  readonly task: BenchmarkTaskIdentity
  readonly projection: WorthCompilationMetricsProjection
  readonly attribution: BenchmarkCompilationAttribution
}

export interface BenchmarkComparisonInput {
  readonly task: BenchmarkTaskIdentity
  readonly direct: readonly BenchmarkExecutionRecord[]
  readonly compiled: readonly BenchmarkExecutionRecord[]
  readonly compiledReplay: ActiveReplayProjection
  readonly compiledReplayInspection: BenchmarkInspection
  readonly compiledReplayEvidence: BenchmarkEvidence
  readonly pricing?: BenchmarkPricingInput
  readonly compilation?: BenchmarkCompilationInput
}

export type BenchmarkRejectionCategory = "not_measured" | "not_comparable"

export type BenchmarkRejectionCode =
  | "input_invalid"
  | "task_invalid"
  | "task_mismatch"
  | "missing_direct_records"
  | "missing_compiled_records"
  | "record_invalid"
  | "record_not_measured"
  | "record_provisional"
  | "execution_projection_invalid"
  | "execution_incomplete"
  | "execution_failed"
  | "execution_mode_mismatch"
  | "execution_replay_mismatch"
  | "mixed_task"
  | "duplicate_execution"
  | "unsafe_execution"
  | "inspection_failed"
  | "inspection_provisional"
  | "evidence_missing"
  | "evidence_failed"
  | "recovery_unresolved"
  | "stop_outcome_mismatch"
  | "compiled_replay_unverified"
  | "compiled_replay_inspection_failed"
  | "compiled_replay_inspection_provisional"
  | "compiled_replay_evidence_missing"
  | "compiled_replay_evidence_failed"
  | "missing_monetary_data"
  | "invalid_monetary_data"
  | "multiple_monetary_sources"
  | "usage_projection_mismatch"
  | "invalid_pricing"
  | "pricing_mismatch"
  | "compilation_projection_invalid"
  | "compilation_task_mismatch"
  | "compilation_attribution_invalid"
  | "numeric_overflow"

export interface BenchmarkRejection {
  readonly category: BenchmarkRejectionCategory
  readonly code: BenchmarkRejectionCode
  readonly path: string
  readonly message: string
}

export type BenchmarkReportProvenanceSourceKind =
  | "worth_execution_projection"
  | "worth_active_replay_projection"
  | "worth_compilation_metrics_projection"
  | "worth_measurement_metadata"
  | "explicit_model_pricing"
  | "explicit_model_cost"

export interface BenchmarkProvenanceSource {
  readonly kind: BenchmarkReportProvenanceSourceKind
  readonly references: readonly string[]
}

export type BenchmarkCalculationName =
  | "total_tokens"
  | "side_averages"
  | "model_cost"
  | "savings"
  | "savings_percentage"
  | "compilation_cost_attribution"
  | "break_even"
  | "lifetime_economics"

export interface BenchmarkCalculationProvenance {
  readonly name: BenchmarkCalculationName
  readonly formula: string
  readonly inputReferences: readonly string[]
}

export interface BenchmarkReportProvenance {
  readonly authority: "worth_query_projections"
  readonly sources: readonly BenchmarkProvenanceSource[]
  readonly calculations: readonly BenchmarkCalculationProvenance[]
}

export interface BenchmarkMetricValues {
  readonly modelCalls: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens: number
  readonly browserObservations: number
  readonly browserActions: number
  readonly toolCalls: number
  readonly wallClockMs: number
}

export type BenchmarkCostSource = "worth_execution_projection" | "explicit_model_pricing" | "explicit_model_cost"

export interface BenchmarkCostSummary {
  readonly totalUsd: number
  readonly averageUsd: number
  readonly source: BenchmarkCostSource
  /** Present when the cost was calculated from caller-supplied token pricing. */
  readonly pricing?: ModelPricingUsdPerToken
}

export type BenchmarkStopStatus = "safe_completion" | "stopped_at_boundary"

export interface BenchmarkStopSummary {
  readonly status: BenchmarkStopStatus
  readonly terminalReasons: readonly SafetyStopResult["reason"][]
}

export type BenchmarkRecoveryStatus = "not_required" | "completed" | "mixed"

export interface BenchmarkRecoverySummary {
  readonly status: BenchmarkRecoveryStatus
  readonly completedRecords: number
  readonly recordCount: number
}

export interface BenchmarkEvidenceSummary {
  readonly status: "complete"
  readonly evidenceIds: readonly EvidenceId[]
  readonly recordCount: number
}

export interface BenchmarkInspectionSummary {
  readonly status: "passed"
  readonly recordCount: number
}

export interface BenchmarkReplayVerificationReport {
  readonly replayVersionId: ReplayVersionId
  readonly version: number
  readonly revision: number
  readonly status: "active_verified"
  readonly requiredSuccessfulRuns: number
  readonly successfulRuns: number
  readonly runCount: number
  readonly failedRuns: number
  readonly evidenceIds: readonly EvidenceId[]
}

export interface BenchmarkSideReport {
  readonly mode: "direct" | "compiled"
  readonly recordCount: number
  readonly recordIds: readonly string[]
  readonly executionIds: readonly ExecutionId[]
  readonly totals: BenchmarkMetricValues
  readonly averages: BenchmarkMetricValues
  readonly modelCost: BenchmarkCostSummary
  readonly stop: BenchmarkStopSummary
  readonly recovery: BenchmarkRecoverySummary
  readonly evidence: BenchmarkEvidenceSummary
  readonly inspection: BenchmarkInspectionSummary
}

export type BenchmarkRatio =
  | { readonly kind: "measured"; readonly value: number }
  | { readonly kind: "not_computable"; readonly reason: "zero_denominator" }

export interface BenchmarkSavingsMetric {
  readonly directAverage: number
  readonly compiledAverage: number
  /** Positive means the compiled path used less of this metric. */
  readonly absolute: number
  /** Fraction of the direct average saved; for example, 0.6 represents 60%. */
  readonly percentOfDirect: BenchmarkRatio
}

export type BenchmarkSavings = Readonly<{ [Metric in keyof BenchmarkMetricValues | "modelCostUsd"]: BenchmarkSavingsMetric }>

export interface BenchmarkCompilationCostReport {
  readonly kind: "measured"
  readonly explorationCostUsd: number
  readonly verificationCostUsd: number
  readonly totalCostUsd: number
  readonly attribution: BenchmarkCompilationAttribution
}

export type BenchmarkEconomicsValue<T> =
  | { readonly kind: "measured"; readonly value: T }
  | { readonly kind: "not_measured"; readonly reason: "projection_not_returned" }

export interface BenchmarkEconomicsReport {
  readonly compilation: BenchmarkCompilationCostReport | { readonly kind: "not_measured"; readonly reason: "projection_not_returned" }
  readonly perExecutionSavings: BenchmarkSavings
  readonly breakEven: BenchmarkEconomicsValue<BreakEvenCalls>
  readonly lifetime: BenchmarkEconomicsValue<LifetimeEconomics>
}

export interface MeasuredBenchmarkReport {
  readonly schemaVersion: typeof benchmarkReportSchemaVersion
  readonly kind: "measured"
  readonly task: BenchmarkTaskIdentity
  readonly direct: BenchmarkSideReport
  readonly compiled: BenchmarkSideReport
  readonly compiledReplay: BenchmarkReplayVerificationReport
  readonly economics: BenchmarkEconomicsReport
  readonly provenance: BenchmarkReportProvenance
}

export interface UnavailableBenchmarkReport {
  readonly schemaVersion: typeof benchmarkReportSchemaVersion
  readonly kind: "not_measured" | "not_comparable"
  readonly task?: BenchmarkTaskIdentity
  readonly reasons: readonly BenchmarkRejection[]
  readonly provenance: BenchmarkReportProvenance
}

export type BenchmarkReport = MeasuredBenchmarkReport | UnavailableBenchmarkReport
