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

export function isWorthDashboardReady(result: WorthDashboardResult): result is Extract<WorthDashboardResult, { readonly kind: "ready" }> { return result.kind === "ready" }
