import type { ApplicationId, ExecutionId } from "@interface-compiler/domain"

export const INTERFACE_COMPILER_WORTH_PROTOCOL = "interface-compiler.worth-host.v1" as const
export const INTERFACE_COMPILER_WORTH_READ_OPERATION = "read_application" as const
export const INTERFACE_COMPILER_WORTH_START_EXECUTION_OPERATION = "start_execution" as const

export type HostDenialStage = "request" | "authentication" | "principal_resolution" | "entity_resolution" | "query" | "projection"
export type HostStartDenialStage = "request" | "authentication" | "principal_resolution" | "entity_resolution" | "operation_admission" | "dependency_projection" | "effect_program" | "commit" | "query"
export type HostUnavailableReason = "unsupported" | "not_configured" | "protocol_mismatch"

export interface HostEvidence {
  readonly query_name: string
  readonly query_identity: string
  readonly basis_version: number
  readonly projected_record_count: number
  readonly projected_field_count: number
  readonly basis_released: boolean
}

interface HostProjection {
  readonly projection_kind: "worth_application"
  readonly id: string
  readonly revision: number
  readonly name: string
  readonly base_url: string
}

interface HostExecutionProjection {
  readonly projection_kind: "worth_execution"
  readonly execution_id: string
  readonly lifecycle: string
}

export type HostResponse =
  | { readonly outcome: "found"; readonly protocol: typeof INTERFACE_COMPILER_WORTH_PROTOCOL; readonly request_id: string; readonly operation: typeof INTERFACE_COMPILER_WORTH_READ_OPERATION; readonly application: HostProjection; readonly evidence: HostEvidence }
  | { readonly outcome: "not_found"; readonly protocol: typeof INTERFACE_COMPILER_WORTH_PROTOCOL; readonly request_id: string; readonly operation: typeof INTERFACE_COMPILER_WORTH_READ_OPERATION; readonly application_id: string }
  | { readonly outcome: "denied"; readonly protocol: typeof INTERFACE_COMPILER_WORTH_PROTOCOL; readonly request_id: string; readonly operation: typeof INTERFACE_COMPILER_WORTH_READ_OPERATION; readonly application_id: string; readonly stage: HostDenialStage; readonly kind: string; readonly message: string }
  | { readonly outcome: "execution_transitioned"; readonly protocol: typeof INTERFACE_COMPILER_WORTH_PROTOCOL; readonly request_id: string; readonly operation: typeof INTERFACE_COMPILER_WORTH_START_EXECUTION_OPERATION; readonly commit: "committed" | "already_committed"; readonly execution: HostExecutionProjection; readonly evidence: HostEvidence }
  | { readonly outcome: "lifecycle_not_pending"; readonly protocol: typeof INTERFACE_COMPILER_WORTH_PROTOCOL; readonly request_id: string; readonly operation: typeof INTERFACE_COMPILER_WORTH_START_EXECUTION_OPERATION; readonly execution_id: string; readonly current_lifecycle: string }
  | { readonly outcome: "execution_denied"; readonly protocol: typeof INTERFACE_COMPILER_WORTH_PROTOCOL; readonly request_id: string; readonly operation: typeof INTERFACE_COMPILER_WORTH_START_EXECUTION_OPERATION; readonly execution_id: string; readonly stage: HostStartDenialStage; readonly kind: string; readonly message: string }
  | { readonly outcome: "unavailable"; readonly protocol: typeof INTERFACE_COMPILER_WORTH_PROTOCOL; readonly request_id: string; readonly operation: string; readonly reason: HostUnavailableReason; readonly message: string }
  | { readonly outcome: "invalid_request"; readonly protocol: typeof INTERFACE_COMPILER_WORTH_PROTOCOL; readonly request_id: string; readonly reason: string; readonly message: string }

export type HostRequest =
  | { readonly protocol: typeof INTERFACE_COMPILER_WORTH_PROTOCOL; readonly request_id: string; readonly operation: typeof INTERFACE_COMPILER_WORTH_READ_OPERATION; readonly application_id: ApplicationId; readonly credential: string; readonly deadline_ms: number }
  | { readonly protocol: typeof INTERFACE_COMPILER_WORTH_PROTOCOL; readonly request_id: string; readonly operation: typeof INTERFACE_COMPILER_WORTH_START_EXECUTION_OPERATION; readonly execution_id: ExecutionId; readonly credential: string; readonly deadline_ms: number }

export function parseHostResponse(line: string): HostResponse | undefined {
  let value: unknown
  try { value = JSON.parse(line) } catch { return undefined }
  if (!isRecord(value) || value.protocol !== INTERFACE_COMPILER_WORTH_PROTOCOL || !isNonEmptyText(value.request_id) || typeof value.outcome !== "string") return undefined
  if (value.outcome === "found" && value.operation === INTERFACE_COMPILER_WORTH_READ_OPERATION && isHostProjection(value.application) && isHostEvidence(value.evidence)) return { outcome: "found", protocol: INTERFACE_COMPILER_WORTH_PROTOCOL, request_id: value.request_id, operation: INTERFACE_COMPILER_WORTH_READ_OPERATION, application: value.application, evidence: value.evidence }
  if (value.outcome === "not_found" && value.operation === INTERFACE_COMPILER_WORTH_READ_OPERATION && isNonEmptyText(value.application_id)) return { outcome: "not_found", protocol: INTERFACE_COMPILER_WORTH_PROTOCOL, request_id: value.request_id, operation: INTERFACE_COMPILER_WORTH_READ_OPERATION, application_id: value.application_id }
  if (value.outcome === "denied" && value.operation === INTERFACE_COMPILER_WORTH_READ_OPERATION && isNonEmptyText(value.application_id) && isHostDenialStage(value.stage) && isNonEmptyText(value.kind) && typeof value.message === "string") return { outcome: "denied", protocol: INTERFACE_COMPILER_WORTH_PROTOCOL, request_id: value.request_id, operation: INTERFACE_COMPILER_WORTH_READ_OPERATION, application_id: value.application_id, stage: value.stage, kind: value.kind, message: value.message }
  if (value.outcome === "execution_transitioned" && value.operation === INTERFACE_COMPILER_WORTH_START_EXECUTION_OPERATION && isHostCommit(value.commit) && isHostExecutionProjection(value.execution) && isHostEvidence(value.evidence)) return { outcome: "execution_transitioned", protocol: INTERFACE_COMPILER_WORTH_PROTOCOL, request_id: value.request_id, operation: INTERFACE_COMPILER_WORTH_START_EXECUTION_OPERATION, commit: value.commit, execution: value.execution, evidence: value.evidence }
  if (value.outcome === "lifecycle_not_pending" && value.operation === INTERFACE_COMPILER_WORTH_START_EXECUTION_OPERATION && isNonEmptyText(value.execution_id) && isNonEmptyText(value.current_lifecycle)) return { outcome: "lifecycle_not_pending", protocol: INTERFACE_COMPILER_WORTH_PROTOCOL, request_id: value.request_id, operation: INTERFACE_COMPILER_WORTH_START_EXECUTION_OPERATION, execution_id: value.execution_id, current_lifecycle: value.current_lifecycle }
  if (value.outcome === "execution_denied" && value.operation === INTERFACE_COMPILER_WORTH_START_EXECUTION_OPERATION && isNonEmptyText(value.execution_id) && isHostStartDenialStage(value.stage) && isNonEmptyText(value.kind) && typeof value.message === "string") return { outcome: "execution_denied", protocol: INTERFACE_COMPILER_WORTH_PROTOCOL, request_id: value.request_id, operation: INTERFACE_COMPILER_WORTH_START_EXECUTION_OPERATION, execution_id: value.execution_id, stage: value.stage, kind: value.kind, message: value.message }
  if (value.outcome === "unavailable" && isNonEmptyText(value.operation) && isHostUnavailableReason(value.reason) && typeof value.message === "string") return { outcome: "unavailable", protocol: INTERFACE_COMPILER_WORTH_PROTOCOL, request_id: value.request_id, operation: value.operation, reason: value.reason, message: value.message }
  if (value.outcome === "invalid_request" && isNonEmptyText(value.reason) && typeof value.message === "string") return { outcome: "invalid_request", protocol: INTERFACE_COMPILER_WORTH_PROTOCOL, request_id: value.request_id, reason: value.reason, message: value.message }
  return undefined
}

function isHostProjection(value: unknown): value is HostProjection { return isRecord(value) && value.projection_kind === "worth_application" && isNonEmptyText(value.id) && isRevision(value.revision) && typeof value.name === "string" && typeof value.base_url === "string" }
function isHostExecutionProjection(value: unknown): value is HostExecutionProjection { return isRecord(value) && value.projection_kind === "worth_execution" && isNonEmptyText(value.execution_id) && isNonEmptyText(value.lifecycle) }
function isHostEvidence(value: unknown): value is HostEvidence { return isRecord(value) && isNonEmptyText(value.query_name) && isNonEmptyText(value.query_identity) && isRevision(value.basis_version) && isRevision(value.projected_record_count) && isRevision(value.projected_field_count) && typeof value.basis_released === "boolean" }
function isHostCommit(value: unknown): value is "committed" | "already_committed" { return value === "committed" || value === "already_committed" }
function isHostDenialStage(value: unknown): value is HostDenialStage { return value === "request" || value === "authentication" || value === "principal_resolution" || value === "entity_resolution" || value === "query" || value === "projection" }
function isHostStartDenialStage(value: unknown): value is HostStartDenialStage { return value === "request" || value === "authentication" || value === "principal_resolution" || value === "entity_resolution" || value === "operation_admission" || value === "dependency_projection" || value === "effect_program" || value === "commit" || value === "query" }
function isHostUnavailableReason(value: unknown): value is HostUnavailableReason { return value === "unsupported" || value === "not_configured" || value === "protocol_mismatch" }
function isRevision(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 }
function isNonEmptyText(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" }
