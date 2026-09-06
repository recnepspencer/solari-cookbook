import { type ActiveReplayProjection, type CapabilityId, type CapabilityProjection, type ExecutionId, type OperationContext, type WorthReadResult } from "@interface-compiler/domain"
import { INTERFACE_COMPILER_WORTH_READ_ACTIVE_REPLAY_OPERATION, INTERFACE_COMPILER_WORTH_READ_CAPABILITY_OPERATION, type HostDenialStage, type HostEvidence, type HostResponse } from "./worth-query-wire.js"
import { decodeCapabilityProjection, decodeReplayProjection } from "./projection-decoding.js"

export interface WorthQueryEvidence { readonly queryName: string; readonly queryIdentity: string; readonly basisVersion: number; readonly projectedRecordCount: number; readonly projectedFieldCount: number; readonly basisReleased: boolean }
/**
 * Economics may only be attributed to measured WORTH execution identities.
 * The current replay-recovery host has no such lineage field, so its reads
 * are explicitly classified as synthetic rather than inferred from a proxy.
 */
export type CompiledPlanMeasurementProvenance =
  | { readonly kind: "synthetic_seed" }
  | { readonly kind: "measured"; readonly discoveryExecutionIds: readonly ExecutionId[]; readonly verificationExecutionIds: readonly ExecutionId[] }
export type CompiledPlanEntity = "capability" | "replay"
export type CompiledPlanReadResult<T> =
  | { readonly kind: "found"; readonly value: T; readonly evidence: WorthQueryEvidence; readonly compilationProvenance: CompiledPlanMeasurementProvenance }
  | Exclude<WorthReadResult<T>, { readonly kind: "found" }>
  | { readonly kind: "denied"; readonly entity: CompiledPlanEntity; readonly entityId: CapabilityId; readonly stage: HostDenialStage; readonly denialKind: string; readonly message: string }
  | { readonly kind: "unavailable"; readonly entity: CompiledPlanEntity; readonly entityId: CapabilityId; readonly operation: "read_capability" | "read_active_replay"; readonly reason: "unsupported" | "not_configured" | "protocol_mismatch" | "transport_unavailable" | "malformed_response"; readonly message: string }

/** The complete read surface needed to admit one compiled plan. It is not WorthAuthority. */
export interface CompiledPlanReadPort {
  readCapability(capabilityId: CapabilityId, context: OperationContext): Promise<CompiledPlanReadResult<CapabilityProjection>>
  readActiveReplay(capabilityId: CapabilityId, context: OperationContext): Promise<CompiledPlanReadResult<ActiveReplayProjection>>
}

export function mapCompiledCapability(capabilityId: CapabilityId, response: Extract<HostResponse, { readonly outcome: "capability_found" }>): CompiledPlanReadResult<CapabilityProjection> {
  const capability = decodeCapabilityProjection(response.capability, capabilityId)
  if (capability === undefined) return malformed("capability", capabilityId, INTERFACE_COMPILER_WORTH_READ_CAPABILITY_OPERATION, "the WORTH capability lifecycle is invalid")
  return { kind: "found", value: capability, evidence: evidence(mapHostEvidence(response.evidence)), compilationProvenance: { kind: "synthetic_seed" } }
}

export function mapCompiledReplay(capabilityId: CapabilityId, response: Extract<HostResponse, { readonly outcome: "active_replay_found" }>): CompiledPlanReadResult<ActiveReplayProjection> {
  const replay = decodeReplayProjection(response.replay, capabilityId)
  if (replay === undefined || replay.status !== "active") return malformed("replay", capabilityId, INTERFACE_COMPILER_WORTH_READ_ACTIVE_REPLAY_OPERATION, "the WORTH active replay projection is invalid")
  return { kind: "found", value: replay, evidence: evidence(mapHostEvidence(response.evidence)), compilationProvenance: { kind: "synthetic_seed" } }
}
function malformed<T>(entity: CompiledPlanEntity, entityId: CapabilityId, operation: "read_capability" | "read_active_replay", message: string): CompiledPlanReadResult<T> { return { kind: "unavailable", entity, entityId, operation, reason: "malformed_response", message } }
function evidence(value: WorthQueryEvidence): WorthQueryEvidence { return value }
export function mapHostEvidence(value: HostEvidence): WorthQueryEvidence { return { queryName: value.query_name, queryIdentity: value.query_identity, basisVersion: value.basis_version, projectedRecordCount: value.projected_record_count, projectedFieldCount: value.projected_field_count, basisReleased: value.basis_released } }

export function createCompiledPlanReadAdapter(client: Pick<CompiledPlanReadPort, "readCapability" | "readActiveReplay">): CompiledPlanReadPort {
  if (client === null || typeof client !== "object" || typeof client.readCapability !== "function" || typeof client.readActiveReplay !== "function") throw new TypeError("a WORTH compiled-plan read client is required")
  return Object.freeze({ readCapability: (id: CapabilityId, context: OperationContext) => client.readCapability(id, context), readActiveReplay: (id: CapabilityId, context: OperationContext) => client.readActiveReplay(id, context) })
}
