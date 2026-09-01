import type {
  ApplicationProjection,
  CapabilityProjection,
  CapabilityId,
  CompilationMetrics,
  Condition,
  Evidence,
  EvidenceId,
  ExecutionId,
  ExecutionProjection,
  IsoTimestamp,
  JsonSchema,
  LifetimeEconomics,
  ReplayFailure,
  ReplayStep,
  ReplayVersionId,
  SessionId,
  SolariSessionPurpose,
  VerificationRunId,
} from "@interface-compiler/domain"

export const dashboardProjectionSchemaVersion = "worth-dashboard.v1" as const

export type DashboardMode = "direct" | "discovering" | "compiled" | "degraded" | "exploring" | "verifying"

export interface DashboardModeProjection {
  readonly value: DashboardMode
  readonly sourceRevision: number
}

/**
 * Worth's core capability projection intentionally stays small. The query
 * projection may attach the contract that the operator needs to inspect,
 * without making the dashboard a second capability authority.
 */
export interface CapabilityContractProjection {
  readonly inputSchema: JsonSchema
  readonly outputSchema: JsonSchema
  readonly preconditions: readonly Condition[]
  readonly postconditions: readonly Condition[]
}

export interface DashboardCapabilityProjection {
  readonly capability: CapabilityProjection
  readonly contract?: CapabilityContractProjection
}

/**
 * A read-only evidence record returned by Worth. Present records use the
 * domain evidence id as their only identity; missing records retain the id
 * that Worth could not resolve. There is no second dashboard-owned id to
 * accidentally bind to a verification reference.
 */
export type DashboardEvidenceProjection =
  | {
      readonly status: "present" | "failed"
      readonly evidence: Evidence
      readonly label?: string
      readonly reference?: string
    }
  | {
      readonly status: "missing"
      readonly id: EvidenceId
      readonly label?: string
      readonly reference?: string
    }

/**
 * This is intentionally a weaker query DTO than Worth's opaque verification
 * proof. The dashboard can display these facts but cannot pass them back to a
 * domain transition as an authority-bearing VerificationRun.
 */
export type DashboardVerificationRunProjection =
  | {
      readonly id: VerificationRunId
      readonly sessionId: SessionId
      readonly freshSession: boolean
      readonly outcome: "success"
      readonly evidenceIds: readonly EvidenceId[]
    }
  | {
      readonly id: VerificationRunId
      readonly sessionId: SessionId
      readonly freshSession: boolean
      readonly outcome: "failure"
      readonly failureMessage: string
      readonly evidenceIds: readonly EvidenceId[]
    }

export type DashboardVerificationPosture = "verified" | "provisional" | "failed" | "missing_evidence" | "inconsistent" | "superseded" | "not_started"

interface DashboardReplayCore {
  readonly projectionKind: "worth_replay"
  readonly id: ReplayVersionId
  readonly revision: number
  readonly capabilityId: CapabilityId
  readonly version: number
  readonly confidence: number
  readonly supersedes?: ReplayVersionId
  readonly supersededBy?: ReplayVersionId
  readonly createdAt: IsoTimestamp
  /** Worth Query's authoritative verification projection for this version. */
  readonly verification: DashboardReplayVerificationProjection
}

export interface DashboardReplayVerificationProjection {
  /** Verification posture is an explicit Worth Query fact, not dashboard inference. */
  readonly posture: DashboardVerificationPosture
  readonly requiredSuccessfulRuns: number | null
  readonly successfulRuns: number
  readonly failedRuns: number
  readonly runs: readonly DashboardVerificationRunProjection[]
  readonly referencedEvidenceIds: readonly EvidenceId[]
  readonly failedEvidenceIds: readonly EvidenceId[]
  readonly missingEvidenceIds: readonly EvidenceId[]
  readonly explanation: string
}

export type DashboardReplayProjection =
  | (DashboardReplayCore & { readonly status: "candidate" })
  | (DashboardReplayCore & { readonly status: "verifying" })
  | (DashboardReplayCore & {
      readonly status: "active"
      readonly steps: readonly ReplayStep[]
      readonly verifiedAt: IsoTimestamp
    })
  | (DashboardReplayCore & { readonly status: "broken"; readonly brokenAt: IsoTimestamp; readonly failure: ReplayFailure })
  | (DashboardReplayCore & { readonly status: "superseded"; readonly supersededBy: ReplayVersionId; readonly supersededAt: IsoTimestamp })

export type DashboardSessionStatus = "active" | "closed" | "failed" | "unknown"

export interface SolariSessionProjection {
  readonly id: SessionId
  readonly label: string
  readonly purpose: SolariSessionPurpose
  readonly status: DashboardSessionStatus
  readonly startedAt?: IsoTimestamp
  readonly endedAt?: IsoTimestamp
  readonly evidenceIds: readonly EvidenceId[]
  readonly href?: string
}

export type DashboardEconomicsField = "compilation_cost" | "average_costs" | "break_even" | "lifetime"

export type CapabilityEconomicsProjection =
  | {
      readonly capabilityId: DashboardCapabilityProjection["capability"]["id"]
      readonly kind: "measured"
      readonly metrics: CompilationMetrics
      readonly lifetime: LifetimeEconomics | null
      readonly measuredExecutionIds: readonly ExecutionId[]
    }
  | {
      readonly capabilityId: DashboardCapabilityProjection["capability"]["id"]
      readonly kind: "partial"
      readonly metrics: CompilationMetrics | null
      readonly lifetime: LifetimeEconomics | null
      readonly missing: readonly DashboardEconomicsField[]
      readonly measuredExecutionIds: readonly ExecutionId[]
    }
  | {
      readonly capabilityId: DashboardCapabilityProjection["capability"]["id"]
      readonly kind: "missing"
      readonly reason: "no_measured_runs" | "not_available"
      readonly measuredExecutionIds: readonly ExecutionId[]
    }

export interface BenchmarkMeasurementValues {
  readonly modelCalls: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens: number
  readonly browserObservations: number
  readonly browserActions: number
  readonly wallClockMs: number
  readonly estimatedModelCostUsd: number
}

export interface PartialBenchmarkMeasurementValues {
  readonly modelCalls?: number
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly totalTokens?: number
  readonly browserObservations?: number
  readonly browserActions?: number
  readonly wallClockMs?: number
  readonly estimatedModelCostUsd?: number
}

export type BenchmarkMetric = keyof BenchmarkMeasurementValues

export type BenchmarkSideProjection =
  | {
      readonly kind: "measured"
      readonly values: BenchmarkMeasurementValues
      readonly executionIds: readonly ExecutionId[]
    }
  | {
      readonly kind: "partial"
      readonly values: PartialBenchmarkMeasurementValues
      readonly missing: readonly BenchmarkMetric[]
      readonly executionIds: readonly ExecutionId[]
    }
  | {
      readonly kind: "missing"
      readonly reason: "no_measured_runs" | "incomplete_runs"
      readonly executionIds: readonly ExecutionId[]
    }

export interface BenchmarkProjection {
  readonly direct: BenchmarkSideProjection
  readonly compiled: BenchmarkSideProjection
}

export interface WorthDashboardProjection {
  readonly schemaVersion: typeof dashboardProjectionSchemaVersion
  readonly sourceRevision: number
  readonly generatedAt: IsoTimestamp
  readonly application: ApplicationProjection | null
  readonly mode: DashboardModeProjection
  readonly capabilities: readonly DashboardCapabilityProjection[]
  readonly replays: readonly DashboardReplayProjection[]
  readonly executions: readonly ExecutionProjection[]
  readonly evidence: readonly DashboardEvidenceProjection[]
  readonly sessions: readonly SolariSessionProjection[]
  readonly economics: readonly CapabilityEconomicsProjection[]
  readonly benchmark: BenchmarkProjection
}

export interface DashboardQueryContext {
  readonly signal: AbortSignal
  readonly requestedAt: IsoTimestamp
  readonly deadlineAt: IsoTimestamp
}

/**
 * The sole application-facing data boundary. Worth Query is the runtime
 * authority; this contract deliberately has no submit method, and the
 * dashboard only sees the weaker product of a query projection.
 */
export interface WorthDashboardQuery {
  readDashboard(context: DashboardQueryContext): Promise<WorthDashboardResult>
}

export type WorthDashboardResult =
  | { readonly kind: "ready"; readonly projection: WorthDashboardProjection }
  | { readonly kind: "cancelled"; readonly message?: string }
  | { readonly kind: "timed_out"; readonly message?: string }
  | { readonly kind: "stale"; readonly sourceRevision: number; readonly currentRevision: number; readonly message?: string }
  | { readonly kind: "unavailable"; readonly reason: "not_configured" | "not_admitted" | "unsupported"; readonly message?: string }
  | { readonly kind: "failed"; readonly message: string; readonly retryable: boolean }

export function isWorthDashboardReady(result: WorthDashboardResult): result is Extract<WorthDashboardResult, { readonly kind: "ready" }> {
  return result.kind === "ready"
}

export function isSupportedWorthDashboardProjection(value: unknown): value is WorthDashboardProjection {
  if (value === null || typeof value !== "object") return false
  const candidate = value as Record<string, unknown>
  if (candidate.schemaVersion !== dashboardProjectionSchemaVersion || !isRevision(candidate.sourceRevision) || typeof candidate.generatedAt !== "string") return false
  if (!Array.isArray(candidate.capabilities) || !Array.isArray(candidate.replays) || !Array.isArray(candidate.executions) || !Array.isArray(candidate.evidence) || !Array.isArray(candidate.sessions) || !Array.isArray(candidate.economics)) return false
  if (!isRecord(candidate.mode) || !isDashboardMode(candidate.mode.value) || !isRevision(candidate.mode.sourceRevision) || candidate.mode.sourceRevision > candidate.sourceRevision) return false
  if (!candidate.evidence.every(isSupportedEvidenceProjection) || !hasUniqueCanonicalEvidenceIds(candidate.evidence) || !candidate.replays.every(isSupportedReplayProjection)) return false
  return isRecord(candidate.benchmark) && "direct" in candidate.benchmark && "compiled" in candidate.benchmark
}

function isDashboardMode(value: unknown): value is DashboardMode {
  return value === "direct" || value === "discovering" || value === "compiled" || value === "degraded" || value === "exploring" || value === "verifying"
}

function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function isSupportedEvidenceProjection(value: unknown): value is DashboardEvidenceProjection {
  if (!isRecord(value)) return false
  if (value.status === "missing") return isNonEmptyText(value.id)
  if (value.status !== "present" && value.status !== "failed") return false
  return !("id" in value) && isRecord(value.evidence) && isNonEmptyText(value.evidence.id)
}

function hasUniqueCanonicalEvidenceIds(values: readonly unknown[]): boolean {
  const ids = new Set<string>()
  for (const value of values) {
    if (!isRecord(value)) return false
    const id = value.status === "missing" ? value.id : isRecord(value.evidence) ? value.evidence.id : undefined
    if (!isNonEmptyText(id) || ids.has(id)) return false
    ids.add(id)
  }
  return true
}

function isSupportedReplayProjection(value: unknown): value is DashboardReplayProjection {
  if (!isRecord(value) || value.projectionKind !== "worth_replay") return false
  if (!isNonEmptyText(value.id) || !isRevision(value.revision) || !isNonEmptyText(value.capabilityId) || !isRevision(value.version) || typeof value.confidence !== "number" || !Number.isFinite(value.confidence) || typeof value.createdAt !== "string") return false
  if (!isSupportedVerificationProjection(value.verification)) return false
  switch (value.status) {
    case "candidate":
      return true
    case "verifying":
      return true
    case "active":
      return Array.isArray(value.steps) && typeof value.verifiedAt === "string"
    case "broken":
      return isRecord(value.failure) && typeof value.brokenAt === "string"
    case "superseded":
      return isNonEmptyText(value.supersededBy) && typeof value.supersededAt === "string"
    default:
      return false
  }
}

function isSupportedVerificationProjection(value: unknown): value is DashboardReplayVerificationProjection {
  if (!isRecord(value) || !isDashboardVerificationPosture(value.posture)) return false
  if (value.requiredSuccessfulRuns !== null && !isRevision(value.requiredSuccessfulRuns)) return false
  if (!isRevision(value.successfulRuns) || !isRevision(value.failedRuns) || !Array.isArray(value.runs) || !Array.isArray(value.referencedEvidenceIds) || !Array.isArray(value.failedEvidenceIds) || !Array.isArray(value.missingEvidenceIds) || typeof value.explanation !== "string") return false
  if (!value.referencedEvidenceIds.every(isNonEmptyText) || !value.failedEvidenceIds.every(isNonEmptyText) || !value.missingEvidenceIds.every(isNonEmptyText)) return false
  return value.runs.every(isSupportedVerificationRunProjection)
}

function isSupportedVerificationRunProjection(value: unknown): value is DashboardVerificationRunProjection {
  if (!isRecord(value) || !isNonEmptyText(value.id) || !isNonEmptyText(value.sessionId) || typeof value.freshSession !== "boolean" || !Array.isArray(value.evidenceIds) || !value.evidenceIds.every(isNonEmptyText)) return false
  if (value.outcome === "success") return true
  return value.outcome === "failure" && typeof value.failureMessage === "string"
}

function isDashboardVerificationPosture(value: unknown): value is DashboardVerificationPosture {
  return value === "verified" || value === "provisional" || value === "failed" || value === "missing_evidence" || value === "inconsistent" || value === "superseded" || value === "not_started"
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object"
}
