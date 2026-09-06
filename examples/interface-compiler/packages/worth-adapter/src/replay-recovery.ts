import {
  type CandidateReplayInput,
  type CapabilityId,
  type CapabilityProjection,
  type ExecutionId,
  type EvidenceReference,
  type IsoTimestamp,
  type OperationContext,
  type PartialEffectPosture,
  type ReplayProjection,
  type ReplayVersionId,
  type VerificationRunReceipt,
} from "@interface-compiler/domain"
import { decodeCapabilityProjection, decodeReplayProjection } from "./projection-decoding.js"
import type { WorthQueryEvidence } from "./compiled-plan-read.js"
import type {
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

export interface VerificationEvidenceRegistrationRequest {
  readonly capabilityId: CapabilityId
  readonly replayVersionId: ReplayVersionId
  readonly expectedCapabilityRevision: number
  readonly expectedReplayRevision: number
  readonly sessionId: VerificationRunReceipt["sessionId"]
  readonly evidence: EvidenceReference
  readonly capturedAt: IsoTimestamp
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
  | { readonly kind: "cancelled"; readonly operationId: string; readonly posture: PartialEffectPosture }
  | { readonly kind: "timed_out"; readonly operationId: string; readonly posture: PartialEffectPosture }

export type ReplayRecoveryProjectionResult =
  | { readonly kind: "found"; readonly capability: CapabilityProjection; readonly replay: ReplayProjection; readonly capabilityEvidence: WorthQueryEvidence; readonly replayEvidence: WorthQueryEvidence }
  | { readonly kind: "not_found"; readonly capabilityId: CapabilityId }
  | { readonly kind: "denied"; readonly message: string }
  | { readonly kind: "unavailable"; readonly reason: "unsupported" | "not_configured" | "protocol_mismatch" | "transport_unavailable" | "malformed_response"; readonly message: string }
  | { readonly kind: "cancelled"; readonly operationId: string; readonly posture: PartialEffectPosture }
  | { readonly kind: "timed_out"; readonly operationId: string; readonly posture: PartialEffectPosture }

/** A narrow public facade over WORTH-owned replay recovery transactions. */
export interface ReplayRecoveryPort {
  readRecoveryProjection(capabilityId: CapabilityId, context: OperationContext): Promise<ReplayRecoveryProjectionResult>
  degradeReplay(request: ReplayDegradationRequest, context: OperationContext): Promise<ReplayRecoveryResult>
  acceptReplacementCandidate(request: ReplacementCandidateRequest, context: OperationContext): Promise<ReplayRecoveryResult>
  registerVerificationEvidence(request: VerificationEvidenceRegistrationRequest, context: OperationContext): Promise<ReplayRecoveryResult>
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
  const capability = decodeCapabilityProjection(response.capability, capabilityId)
  const replay = decodeReplayProjection(response.replay, capabilityId, replayId)
  if (capability === undefined || replay === undefined) {
    return malformed(operation, "the WORTH host returned a malformed recovery projection")
  }
  const capabilityEvidence = evidence(response.capability_evidence)
  const replayEvidence = evidence(response.replay_evidence)
  if (!recoveryPairMatches(capability, replay) || capabilityEvidence.basisVersion !== replayEvidence.basisVersion) {
    return malformed(operation, "the WORTH host returned an inconsistent recovery projection pair")
  }
  return {
    kind: "applied",
    commit: response.commit,
    capability,
    replay,
    capabilityEvidence,
    replayEvidence,
  }
}

export function recoveryPairMatches(capability: CapabilityProjection, replay: ReplayProjection): boolean {
  if (capability.id !== replay.capabilityId) return false
  if (capability.status === "degraded") return replay.status === "broken" && capability.brokenReplayVersionId === replay.id
  if (capability.status === "verifying") return replay.status === "verifying" && capability.candidateReplayVersionId === replay.id
  return capability.status === "healthy" && replay.status === "active" && capability.activeReplayVersionId === replay.id
}

function malformed(operation: ReplayRecoveryOperation, message: string): ReplayRecoveryResult { return { kind: "unavailable", operation, reason: "malformed_response", message } }
function evidence(value: { readonly query_name: string; readonly query_identity: string; readonly basis_version: number; readonly projected_record_count: number; readonly projected_field_count: number; readonly basis_released: boolean }): WorthQueryEvidence { return { queryName: value.query_name, queryIdentity: value.query_identity, basisVersion: value.basis_version, projectedRecordCount: value.projected_record_count, projectedFieldCount: value.projected_field_count, basisReleased: value.basis_released } }
