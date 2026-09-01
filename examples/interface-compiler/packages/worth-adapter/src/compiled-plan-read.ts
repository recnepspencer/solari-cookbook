import { validateReplayStep, type ActiveReplayProjection, type CapabilityId, type CapabilityProjection, type OperationContext, type WorthReadResult } from "@interface-compiler/domain"
import { INTERFACE_COMPILER_WORTH_READ_ACTIVE_REPLAY_OPERATION, INTERFACE_COMPILER_WORTH_READ_CAPABILITY_OPERATION, type HostDenialStage, type HostEvidence, type HostResponse } from "./worth-query-wire.js"

export interface WorthQueryEvidence { readonly queryName: string; readonly queryIdentity: string; readonly basisVersion: number; readonly projectedRecordCount: number; readonly projectedFieldCount: number; readonly basisReleased: boolean }
export type CompiledPlanEntity = "capability" | "replay"
export type CompiledPlanReadResult<T> =
  | { readonly kind: "found"; readonly value: T; readonly evidence: WorthQueryEvidence }
  | Exclude<WorthReadResult<T>, { readonly kind: "found" }>
  | { readonly kind: "denied"; readonly entity: CompiledPlanEntity; readonly entityId: CapabilityId; readonly stage: HostDenialStage; readonly denialKind: string; readonly message: string }
  | { readonly kind: "unavailable"; readonly entity: CompiledPlanEntity; readonly entityId: CapabilityId; readonly operation: "read_capability" | "read_active_replay"; readonly reason: "unsupported" | "not_configured" | "protocol_mismatch" | "transport_unavailable" | "malformed_response"; readonly message: string }

/** The complete read surface needed to admit one compiled plan. It is not WorthAuthority. */
export interface CompiledPlanReadPort {
  readCapability(capabilityId: CapabilityId, context: OperationContext): Promise<CompiledPlanReadResult<CapabilityProjection>>
  readActiveReplay(capabilityId: CapabilityId, context: OperationContext): Promise<CompiledPlanReadResult<ActiveReplayProjection>>
}

export function mapCompiledCapability(capabilityId: CapabilityId, response: Extract<HostResponse, { readonly outcome: "capability_found" }>): CompiledPlanReadResult<CapabilityProjection> {
  const value = response.capability
  if (value.id !== capabilityId || value.status !== "healthy") return malformed("capability", capabilityId, INTERFACE_COMPILER_WORTH_READ_CAPABILITY_OPERATION, "the WORTH capability identity or healthy status is invalid")
  return { kind: "found", value: { projectionKind: "worth_capability", id: capabilityId, revision: value.revision, applicationId: value.application_id as CapabilityProjection["applicationId"], name: value.name, description: value.description, status: "healthy", activeReplayVersionId: value.active_replay_version_id as Extract<CapabilityProjection, { status: "healthy" }>["activeReplayVersionId"] }, evidence: evidence(valueEvidence(response.evidence)) }
}

export function mapCompiledReplay(capabilityId: CapabilityId, response: Extract<HostResponse, { readonly outcome: "active_replay_found" }>): CompiledPlanReadResult<ActiveReplayProjection> {
  const value = response.replay
  const verification = projectVerification(value.verification, capabilityId, value.id)
  if (value.capability_id !== capabilityId || value.status !== "active" || value.steps.length === 0 || value.steps.some((step, index) => validateReplayStep(step, index).length > 0) || verification === undefined || !timestamp(value.created_at) || !timestamp(value.verified_at) || value.confidence < 0 || value.confidence > 1) return malformed("replay", capabilityId, INTERFACE_COMPILER_WORTH_READ_ACTIVE_REPLAY_OPERATION, "the WORTH active replay projection is invalid")
  return { kind: "found", value: { projectionKind: "worth_replay", id: value.id as ActiveReplayProjection["id"], revision: value.revision, capabilityId, version: value.version, steps: value.steps as ActiveReplayProjection["steps"], confidence: value.confidence, status: "active", createdAt: value.created_at as ActiveReplayProjection["createdAt"], verifiedAt: value.verified_at as ActiveReplayProjection["verifiedAt"], verification }, evidence: evidence(valueEvidence(response.evidence)) }
}

function projectVerification(value: unknown, capabilityId: CapabilityId, replayId: string): ActiveReplayProjection["verification"] | undefined {
  if (!record(value) || !Number.isSafeInteger(value.requiredSuccessfulRuns) || (value.requiredSuccessfulRuns as number) < 1 || !Array.isArray(value.runs) || value.runs.length === 0) return undefined
  let successes = 0
  const runs: ActiveReplayProjection["verification"]["runs"][number][] = []
  for (const run of value.runs) {
    if (!record(run) || !text(run.id) || run.capabilityId !== capabilityId || run.replayVersionId !== replayId || !text(run.sessionId) || run.freshSession !== true || run.outcome !== "success" || !Array.isArray(run.evidenceIds) || run.evidenceIds.length === 0 || !run.evidenceIds.every(text) || !timestamp(run.completedAt)) return undefined
    successes += 1
    runs.push({ id: run.id as ActiveReplayProjection["verification"]["runs"][number]["id"], sessionId: run.sessionId as ActiveReplayProjection["verification"]["runs"][number]["sessionId"], capabilityId, replayVersionId: replayId as ActiveReplayProjection["id"], freshSession: run.freshSession, outcome: "success", evidenceIds: run.evidenceIds as unknown as ActiveReplayProjection["verification"]["runs"][number]["evidenceIds"] })
  }
  return successes >= (value.requiredSuccessfulRuns as number) ? { requiredSuccessfulRuns: value.requiredSuccessfulRuns as number, runs } : undefined
}
function malformed<T>(entity: CompiledPlanEntity, entityId: CapabilityId, operation: "read_capability" | "read_active_replay", message: string): CompiledPlanReadResult<T> { return { kind: "unavailable", entity, entityId, operation, reason: "malformed_response", message } }
function evidence(value: WorthQueryEvidence): WorthQueryEvidence { return value }
function valueEvidence(value: HostEvidence): WorthQueryEvidence { return { queryName: value.query_name, queryIdentity: value.query_identity, basisVersion: value.basis_version, projectedRecordCount: value.projected_record_count, projectedFieldCount: value.projected_field_count, basisReleased: value.basis_released } }
function timestamp(value: unknown): boolean { return typeof value === "string" && Number.isFinite(Date.parse(value)) }
function text(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) }

export function createCompiledPlanReadAdapter(client: Pick<CompiledPlanReadPort, "readCapability" | "readActiveReplay">): CompiledPlanReadPort {
  if (client === null || typeof client !== "object" || typeof client.readCapability !== "function" || typeof client.readActiveReplay !== "function") throw new TypeError("a WORTH compiled-plan read client is required")
  return Object.freeze({ readCapability: (id: CapabilityId, context: OperationContext) => client.readCapability(id, context), readActiveReplay: (id: CapabilityId, context: OperationContext) => client.readActiveReplay(id, context) })
}
