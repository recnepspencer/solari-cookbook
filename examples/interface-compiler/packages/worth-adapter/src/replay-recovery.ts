import {
  validateReplayFailure,
  validateReplayStep,
  type CandidateReplayInput,
  type CapabilityId,
  type CapabilityProjection,
  type ExecutionId,
  type IsoTimestamp,
  type OperationContext,
  type PartialEffectPosture,
  type ReplayProjection,
  type ReplayVersionId,
  type VerificationRunProjection,
  type VerificationRunReceipt,
} from "@interface-compiler/domain"
import type { WorthQueryEvidence } from "./compiled-plan-read.js"
import type {
  HostActiveReplayProjection,
  HostCapabilityProjection,
  HostRecoveryStopReason,
  HostResponse,
  HostStartDenialStage,
  ReplayRecoveryOperation,
} from "./worth-query-wire.js"

export interface ReplayDegradationRequest {
  readonly executionId: ExecutionId
  readonly capabilityId: CapabilityId
  readonly replayVersionId: ReplayVersionId
  readonly expectedExecutionRevision: number
  readonly expectedCapabilityRevision: number
  readonly expectedReplayRevision: number
}

export interface ReplacementCandidateRequest {
  readonly capabilityId: CapabilityId
  readonly brokenReplayVersionId: ReplayVersionId
  readonly expectedCapabilityRevision: number
  readonly expectedBrokenReplayRevision: number
  readonly candidate: CandidateReplayInput
}

export type ReplacementVerificationReceipt = VerificationRunReceipt & {
  readonly completedAt: IsoTimestamp
}

export interface ReplacementVerificationRequest {
  readonly capabilityId: CapabilityId
  readonly replayVersionId: ReplayVersionId
  readonly expectedCapabilityRevision: number
  readonly expectedReplayRevision: number
  readonly receipt: ReplacementVerificationReceipt
}

export interface ReplacementActivationRequest {
  readonly capabilityId: CapabilityId
  readonly replayVersionId: ReplayVersionId
  readonly expectedCapabilityRevision: number
  readonly expectedReplayRevision: number
  readonly verifiedAt: IsoTimestamp
}

export type ReplayRecoveryResult =
  | {
      readonly kind: "applied"
      readonly commit: "committed" | "already_committed"
      readonly capability: CapabilityProjection
      readonly replay: ReplayProjection
      readonly capabilityEvidence: WorthQueryEvidence
      readonly replayEvidence: WorthQueryEvidence
    }
  | { readonly kind: "stale"; readonly entity: "execution" | "capability" | "replay"; readonly entityId: string; readonly expectedRevision: number; readonly actualRevision: number }
  | { readonly kind: "authority_stopped"; readonly reason: HostRecoveryStopReason; readonly message: string }
  | { readonly kind: "committed_projection_unavailable"; readonly commit: "committed" | "already_committed"; readonly message: string }
  | { readonly kind: "denied"; readonly stage: HostStartDenialStage; readonly message: string }
  | { readonly kind: "unavailable"; readonly operation: ReplayRecoveryOperation; readonly reason: "unsupported" | "not_configured" | "protocol_mismatch" | "transport_unavailable" | "malformed_response"; readonly message: string }
  | { readonly kind: "cancelled" | "timed_out"; readonly operationId: string; readonly posture: PartialEffectPosture }

/** A narrow public facade over WORTH-owned replay recovery transactions. */
export interface ReplayRecoveryPort {
  degradeReplay(request: ReplayDegradationRequest, context: OperationContext): Promise<ReplayRecoveryResult>
  acceptReplacementCandidate(request: ReplacementCandidateRequest, context: OperationContext): Promise<ReplayRecoveryResult>
  recordReplacementVerification(request: ReplacementVerificationRequest, context: OperationContext): Promise<ReplayRecoveryResult>
  activateReplacement(request: ReplacementActivationRequest, context: OperationContext): Promise<ReplayRecoveryResult>
}

export function mapReplayRecoveryResponse(
  operation: ReplayRecoveryOperation,
  capabilityId: CapabilityId,
  replayId: ReplayVersionId,
  response: HostResponse,
): ReplayRecoveryResult {
  if (response.outcome === "replay_recovery_stale" && response.operation === operation) {
    return { kind: "stale", entity: response.entity, entityId: response.entity_id, expectedRevision: response.expected_revision, actualRevision: response.actual_revision }
  }
  if (response.outcome === "replay_recovery_stopped" && response.operation === operation) {
    return { kind: "authority_stopped", reason: response.reason, message: response.message }
  }
  if (response.outcome === "replay_recovery_committed_projection_unavailable" && response.operation === operation) {
    return { kind: "committed_projection_unavailable", commit: response.commit, message: response.message }
  }
  if (response.outcome === "replay_recovery_denied" && response.operation === operation) {
    return { kind: "denied", stage: response.stage, message: response.message }
  }
  if (response.outcome === "unavailable" && response.operation === operation) {
    return { kind: "unavailable", operation, reason: response.reason, message: response.message }
  }
  if (response.outcome !== "replay_recovery_applied" || response.operation !== operation) {
    return malformed(operation, "the WORTH host returned an outcome for a different recovery operation")
  }
  if (response.capability.id !== capabilityId || response.replay.id !== replayId || response.replay.capability_id !== capabilityId) {
    return malformed(operation, "the WORTH host returned a different recovery lineage")
  }
  const capability = projectCapability(response.capability)
  const replay = projectReplay(response.replay)
  if (capability === undefined || replay === undefined) {
    return malformed(operation, "the WORTH host returned a malformed recovery projection")
  }
  return {
    kind: "applied",
    commit: response.commit,
    capability,
    replay,
    capabilityEvidence: evidence(response.capability_evidence),
    replayEvidence: evidence(response.replay_evidence),
  }
}

function projectCapability(value: HostCapabilityProjection): CapabilityProjection | undefined {
  const core = {
    projectionKind: "worth_capability" as const,
    id: value.id as CapabilityProjection["id"],
    revision: value.revision,
    applicationId: value.application_id as CapabilityProjection["applicationId"],
    name: value.name,
    description: value.description,
  }
  if (value.status === "healthy" && value.active_replay_version_id !== undefined) {
    return { ...core, status: "healthy", activeReplayVersionId: value.active_replay_version_id as ReplayVersionId }
  }
  if (value.status === "verifying" && value.candidate_replay_version_id !== undefined) {
    return { ...core, status: "verifying", candidateReplayVersionId: value.candidate_replay_version_id as ReplayVersionId }
  }
  if (value.status === "degraded" && value.broken_replay_version_id !== undefined && validateReplayFailure(value.failure).length === 0) {
    return { ...core, status: "degraded", brokenReplayVersionId: value.broken_replay_version_id as ReplayVersionId, failure: structuredClone(value.failure) as Extract<CapabilityProjection, { status: "degraded" }>["failure"], mode: "exploratory" }
  }
  return undefined
}

function projectReplay(value: HostActiveReplayProjection): ReplayProjection | undefined {
  if (value.steps.length === 0 || value.steps.some((step, index) => validateReplayStep(step, index).length > 0) || !timestamp(value.created_at) || value.confidence < 0 || value.confidence > 1) return undefined
  const verification = projectVerification(value)
  if (verification === undefined) return undefined
  const core = {
    projectionKind: "worth_replay" as const,
    id: value.id as ReplayVersionId,
    revision: value.revision,
    capabilityId: value.capability_id as CapabilityId,
    version: value.version,
    steps: structuredClone(value.steps) as ReplayProjection["steps"],
    confidence: value.confidence,
    ...(value.supersedes === undefined ? {} : { supersedes: value.supersedes as ReplayVersionId }),
    createdAt: value.created_at as IsoTimestamp,
  }
  if (value.status === "verifying" && value.verified_at === undefined && value.failure === undefined && value.broken_at === undefined) {
    return { ...core, status: "verifying", verification }
  }
  if (value.status === "active" && value.verified_at !== undefined && timestamp(value.verified_at) && successfulRuns(verification.runs) >= verification.requiredSuccessfulRuns) {
    return { ...core, status: "active", verifiedAt: value.verified_at as IsoTimestamp, verification }
  }
  if (value.status === "broken" && value.broken_at !== undefined && timestamp(value.broken_at) && validateReplayFailure(value.failure).length === 0) {
    return { ...core, status: "broken", brokenAt: value.broken_at as IsoTimestamp, failure: structuredClone(value.failure) as Extract<ReplayProjection, { status: "broken" }>["failure"] }
  }
  return undefined
}

function projectVerification(value: HostActiveReplayProjection): Extract<ReplayProjection, { status: "verifying" | "active" }>["verification"] | undefined {
  if (!Number.isSafeInteger(value.verification.requiredSuccessfulRuns) || value.verification.requiredSuccessfulRuns < 1) return undefined
  const ids = new Set<string>()
  const sessions = new Set<string>()
  const evidenceIds = new Set<string>()
  const runs: VerificationRunProjection[] = []
  for (const run of value.verification.runs) {
    if (run.capabilityId !== value.capability_id || run.replayVersionId !== value.id || ids.has(run.id) || sessions.has(run.sessionId) || run.evidenceIds.length === 0 || run.evidenceIds.some((id) => evidenceIds.has(id))) return undefined
    ids.add(run.id)
    sessions.add(run.sessionId)
    run.evidenceIds.forEach((id) => evidenceIds.add(id))
    runs.push(run.outcome === "success"
      ? { id: run.id as VerificationRunProjection["id"], sessionId: run.sessionId as VerificationRunProjection["sessionId"], capabilityId: value.capability_id as CapabilityId, replayVersionId: value.id as ReplayVersionId, freshSession: true, outcome: "success", evidenceIds: run.evidenceIds as VerificationRunProjection["evidenceIds"] }
      : { id: run.id as VerificationRunProjection["id"], sessionId: run.sessionId as VerificationRunProjection["sessionId"], capabilityId: value.capability_id as CapabilityId, replayVersionId: value.id as ReplayVersionId, freshSession: true, outcome: "failure", failureMessage: run.failureMessage!, evidenceIds: run.evidenceIds as VerificationRunProjection["evidenceIds"] })
  }
  return { requiredSuccessfulRuns: value.verification.requiredSuccessfulRuns, runs }
}

function successfulRuns(runs: readonly VerificationRunProjection[]): number { return runs.filter((run) => run.outcome === "success").length }
function timestamp(value: unknown): boolean { return typeof value === "string" && Number.isFinite(Date.parse(value)) }
function malformed(operation: ReplayRecoveryOperation, message: string): ReplayRecoveryResult { return { kind: "unavailable", operation, reason: "malformed_response", message } }
function evidence(value: { readonly query_name: string; readonly query_identity: string; readonly basis_version: number; readonly projected_record_count: number; readonly projected_field_count: number; readonly basis_released: boolean }): WorthQueryEvidence { return { queryName: value.query_name, queryIdentity: value.query_identity, basisVersion: value.basis_version, projectedRecordCount: value.projected_record_count, projectedFieldCount: value.projected_field_count, basisReleased: value.basis_released } }
