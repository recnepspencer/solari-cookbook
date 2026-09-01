import type { ApplicationId, CapabilityId, ExecutionId } from "@interface-compiler/domain"

export const INTERFACE_COMPILER_WORTH_PROTOCOL = "interface-compiler.worth-host.v1" as const
export const INTERFACE_COMPILER_WORTH_READ_OPERATION = "read_application" as const
export const INTERFACE_COMPILER_WORTH_START_EXECUTION_OPERATION = "start_execution" as const
export const INTERFACE_COMPILER_WORTH_ADMIT_EXECUTION_OPERATION = "admit_execution" as const
export const INTERFACE_COMPILER_WORTH_COMPLETE_EXECUTION_OPERATION = "complete_execution" as const
export const INTERFACE_COMPILER_WORTH_PUBLISH_DOMAIN_EVENT_OPERATION = "publish_domain_event" as const
export const INTERFACE_COMPILER_WORTH_READ_CAPABILITY_OPERATION = "read_capability" as const
export const INTERFACE_COMPILER_WORTH_READ_ACTIVE_REPLAY_OPERATION = "read_active_replay" as const

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

export interface HostExecutionProjection {
  readonly projection_kind: "worth_execution"
  readonly execution_id: string
  readonly lifecycle: string
  readonly revision: number
  readonly settlement: unknown
  readonly capability_id: string
  readonly replay_version_id?: string
  readonly mode: string
  readonly metrics: unknown
}

export interface HostCapabilityProjection { readonly projection_kind: "worth_capability"; readonly id: string; readonly revision: number; readonly application_id: string; readonly name: string; readonly description: string; readonly status: string; readonly active_replay_version_id: string }
export interface HostActiveReplayProjection { readonly projection_kind: "worth_replay"; readonly id: string; readonly revision: number; readonly capability_id: string; readonly version: number; readonly steps: readonly HostReplayStep[]; readonly confidence: number; readonly status: string; readonly created_at: string; readonly verified_at: string; readonly verification: HostReplayVerification }
export type HostReplayStep =
  | { readonly type: "navigate"; readonly url: string }
  | { readonly type: "click"; readonly target: HostLocator }
  | { readonly type: "fill" | "select"; readonly target: HostLocator; readonly value: string }
  | { readonly type: "wait"; readonly milliseconds: number }
  | { readonly type: "read"; readonly target: HostLocator; readonly outputKey: string }
  | { readonly type: "assert"; readonly condition: unknown }
interface HostLocator { readonly semanticDescription: string; readonly role?: string; readonly name?: string; readonly text?: string; readonly selector?: string }
export interface HostReplayVerification { readonly requiredSuccessfulRuns: number; readonly runs: readonly HostVerificationRun[] }
interface HostVerificationRun { readonly id: string; readonly capabilityId: string; readonly replayVersionId: string; readonly sessionId: string; readonly freshSession: true; readonly outcome: string; readonly evidenceIds: readonly string[]; readonly completedAt: string }

export type HostResponse =
  | { readonly outcome: "found"; readonly protocol: typeof INTERFACE_COMPILER_WORTH_PROTOCOL; readonly request_id: string; readonly operation: typeof INTERFACE_COMPILER_WORTH_READ_OPERATION; readonly application: HostProjection; readonly evidence: HostEvidence }
  | { readonly outcome: "not_found"; readonly protocol: typeof INTERFACE_COMPILER_WORTH_PROTOCOL; readonly request_id: string; readonly operation: typeof INTERFACE_COMPILER_WORTH_READ_OPERATION; readonly application_id: string }
  | { readonly outcome: "denied"; readonly protocol: typeof INTERFACE_COMPILER_WORTH_PROTOCOL; readonly request_id: string; readonly operation: typeof INTERFACE_COMPILER_WORTH_READ_OPERATION; readonly application_id: string; readonly stage: HostDenialStage; readonly kind: string; readonly message: string }
  | { readonly outcome: "execution_transitioned"; readonly protocol: typeof INTERFACE_COMPILER_WORTH_PROTOCOL; readonly request_id: string; readonly operation: typeof INTERFACE_COMPILER_WORTH_START_EXECUTION_OPERATION; readonly commit: "committed" | "already_committed"; readonly execution: HostExecutionProjection; readonly evidence: HostEvidence }
  | { readonly outcome: "execution_transitioned"; readonly protocol: typeof INTERFACE_COMPILER_WORTH_PROTOCOL; readonly request_id: string; readonly operation: typeof INTERFACE_COMPILER_WORTH_ADMIT_EXECUTION_OPERATION; readonly commit: "committed" | "already_committed"; readonly execution: HostExecutionProjection; readonly evidence: HostEvidence }
  | { readonly outcome: "lifecycle_not_pending"; readonly protocol: typeof INTERFACE_COMPILER_WORTH_PROTOCOL; readonly request_id: string; readonly operation: typeof INTERFACE_COMPILER_WORTH_START_EXECUTION_OPERATION; readonly execution_id: string; readonly current_lifecycle: string }
  | { readonly outcome: "execution_denied"; readonly protocol: typeof INTERFACE_COMPILER_WORTH_PROTOCOL; readonly request_id: string; readonly operation: typeof INTERFACE_COMPILER_WORTH_START_EXECUTION_OPERATION; readonly execution_id: string; readonly stage: HostStartDenialStage; readonly kind: string; readonly message: string }
  | { readonly outcome: "execution_settled"; readonly protocol: typeof INTERFACE_COMPILER_WORTH_PROTOCOL; readonly request_id: string; readonly operation: typeof INTERFACE_COMPILER_WORTH_COMPLETE_EXECUTION_OPERATION; readonly commit: "committed" | "already_committed"; readonly execution: HostExecutionProjection; readonly evidence: HostEvidence }
  | { readonly outcome: "execution_stale"; readonly protocol: typeof INTERFACE_COMPILER_WORTH_PROTOCOL; readonly request_id: string; readonly operation: typeof INTERFACE_COMPILER_WORTH_COMPLETE_EXECUTION_OPERATION; readonly execution_id: string; readonly expected_revision: number; readonly actual_revision: number }
  | { readonly outcome: "execution_lifecycle_invalid"; readonly protocol: typeof INTERFACE_COMPILER_WORTH_PROTOCOL; readonly request_id: string; readonly operation: typeof INTERFACE_COMPILER_WORTH_COMPLETE_EXECUTION_OPERATION; readonly execution_id: string; readonly current_lifecycle: string }
  | { readonly outcome: "event_published"; readonly protocol: typeof INTERFACE_COMPILER_WORTH_PROTOCOL; readonly request_id: string; readonly operation: typeof INTERFACE_COMPILER_WORTH_PUBLISH_DOMAIN_EVENT_OPERATION; readonly commit: "committed" | "already_committed"; readonly event_id: string; readonly journal_revision: number; readonly evidence: HostEvidence }
  | { readonly outcome: "unavailable"; readonly protocol: typeof INTERFACE_COMPILER_WORTH_PROTOCOL; readonly request_id: string; readonly operation: string; readonly reason: HostUnavailableReason; readonly message: string }
  | { readonly outcome: "invalid_request"; readonly protocol: typeof INTERFACE_COMPILER_WORTH_PROTOCOL; readonly request_id: string; readonly reason: string; readonly message: string }
  | { readonly outcome: "capability_found"; readonly protocol: typeof INTERFACE_COMPILER_WORTH_PROTOCOL; readonly request_id: string; readonly operation: typeof INTERFACE_COMPILER_WORTH_READ_CAPABILITY_OPERATION; readonly capability: HostCapabilityProjection; readonly evidence: HostEvidence }
  | { readonly outcome: "active_replay_found"; readonly protocol: typeof INTERFACE_COMPILER_WORTH_PROTOCOL; readonly request_id: string; readonly operation: typeof INTERFACE_COMPILER_WORTH_READ_ACTIVE_REPLAY_OPERATION; readonly replay: HostActiveReplayProjection; readonly evidence: HostEvidence }
  | { readonly outcome: "compiled_read_not_found"; readonly protocol: typeof INTERFACE_COMPILER_WORTH_PROTOCOL; readonly request_id: string; readonly operation: CompiledReadOperation; readonly capability_id: string }
  | { readonly outcome: "compiled_read_denied"; readonly protocol: typeof INTERFACE_COMPILER_WORTH_PROTOCOL; readonly request_id: string; readonly operation: CompiledReadOperation; readonly capability_id: string; readonly stage: HostDenialStage; readonly kind: string; readonly message: string }

type CompiledReadOperation = typeof INTERFACE_COMPILER_WORTH_READ_CAPABILITY_OPERATION | typeof INTERFACE_COMPILER_WORTH_READ_ACTIVE_REPLAY_OPERATION

export type HostRequest =
  | { readonly protocol: typeof INTERFACE_COMPILER_WORTH_PROTOCOL; readonly request_id: string; readonly operation: typeof INTERFACE_COMPILER_WORTH_READ_OPERATION; readonly application_id: ApplicationId; readonly credential: string; readonly deadline_ms: number }
  | { readonly protocol: typeof INTERFACE_COMPILER_WORTH_PROTOCOL; readonly request_id: string; readonly operation: typeof INTERFACE_COMPILER_WORTH_START_EXECUTION_OPERATION; readonly execution_id: ExecutionId; readonly credential: string; readonly deadline_ms: number }
  | { readonly protocol: typeof INTERFACE_COMPILER_WORTH_PROTOCOL; readonly request_id: string; readonly operation: typeof INTERFACE_COMPILER_WORTH_ADMIT_EXECUTION_OPERATION; readonly execution_id: ExecutionId; readonly capability_id: CapabilityId; readonly settlement: unknown; readonly credential: string; readonly deadline_ms: number }
  | { readonly protocol: typeof INTERFACE_COMPILER_WORTH_PROTOCOL; readonly request_id: string; readonly operation: typeof INTERFACE_COMPILER_WORTH_COMPLETE_EXECUTION_OPERATION; readonly execution_id: ExecutionId; readonly expected_revision: number; readonly settlement: unknown; readonly credential: string; readonly deadline_ms: number }
  | { readonly protocol: typeof INTERFACE_COMPILER_WORTH_PROTOCOL; readonly request_id: string; readonly operation: typeof INTERFACE_COMPILER_WORTH_PUBLISH_DOMAIN_EVENT_OPERATION; readonly event: unknown; readonly credential: string; readonly deadline_ms: number }
  | { readonly protocol: typeof INTERFACE_COMPILER_WORTH_PROTOCOL; readonly request_id: string; readonly operation: CompiledReadOperation; readonly capability_id: CapabilityId; readonly credential: string; readonly deadline_ms: number }

export function parseHostResponse(line: string): HostResponse | undefined {
  let value: unknown
  try { value = JSON.parse(line) } catch { return undefined }
  if (!isRecord(value) || value.protocol !== INTERFACE_COMPILER_WORTH_PROTOCOL || !isNonEmptyText(value.request_id) || typeof value.outcome !== "string") return undefined
  if (value.outcome === "found" && value.operation === INTERFACE_COMPILER_WORTH_READ_OPERATION && isHostProjection(value.application) && isHostEvidence(value.evidence)) return { outcome: "found", protocol: INTERFACE_COMPILER_WORTH_PROTOCOL, request_id: value.request_id, operation: INTERFACE_COMPILER_WORTH_READ_OPERATION, application: value.application, evidence: value.evidence }
  if (value.outcome === "not_found" && value.operation === INTERFACE_COMPILER_WORTH_READ_OPERATION && isNonEmptyText(value.application_id)) return { outcome: "not_found", protocol: INTERFACE_COMPILER_WORTH_PROTOCOL, request_id: value.request_id, operation: INTERFACE_COMPILER_WORTH_READ_OPERATION, application_id: value.application_id }
  if (value.outcome === "denied" && value.operation === INTERFACE_COMPILER_WORTH_READ_OPERATION && isNonEmptyText(value.application_id) && isHostDenialStage(value.stage) && isNonEmptyText(value.kind) && typeof value.message === "string") return { outcome: "denied", protocol: INTERFACE_COMPILER_WORTH_PROTOCOL, request_id: value.request_id, operation: INTERFACE_COMPILER_WORTH_READ_OPERATION, application_id: value.application_id, stage: value.stage, kind: value.kind, message: value.message }
  if (value.outcome === "execution_transitioned" && value.operation === INTERFACE_COMPILER_WORTH_START_EXECUTION_OPERATION && isHostCommit(value.commit) && isHostExecutionProjection(value.execution) && isHostEvidence(value.evidence)) return { outcome: "execution_transitioned", protocol: INTERFACE_COMPILER_WORTH_PROTOCOL, request_id: value.request_id, operation: INTERFACE_COMPILER_WORTH_START_EXECUTION_OPERATION, commit: value.commit, execution: value.execution, evidence: value.evidence }
  if (value.outcome === "execution_transitioned" && value.operation === INTERFACE_COMPILER_WORTH_ADMIT_EXECUTION_OPERATION && isHostCommit(value.commit) && isHostExecutionProjection(value.execution) && isHostEvidence(value.evidence)) return { outcome: "execution_transitioned", protocol: INTERFACE_COMPILER_WORTH_PROTOCOL, request_id: value.request_id, operation: INTERFACE_COMPILER_WORTH_ADMIT_EXECUTION_OPERATION, commit: value.commit, execution: value.execution, evidence: value.evidence }
  if (value.outcome === "lifecycle_not_pending" && value.operation === INTERFACE_COMPILER_WORTH_START_EXECUTION_OPERATION && isNonEmptyText(value.execution_id) && isNonEmptyText(value.current_lifecycle)) return { outcome: "lifecycle_not_pending", protocol: INTERFACE_COMPILER_WORTH_PROTOCOL, request_id: value.request_id, operation: INTERFACE_COMPILER_WORTH_START_EXECUTION_OPERATION, execution_id: value.execution_id, current_lifecycle: value.current_lifecycle }
  if (value.outcome === "execution_denied" && value.operation === INTERFACE_COMPILER_WORTH_START_EXECUTION_OPERATION && isNonEmptyText(value.execution_id) && isHostStartDenialStage(value.stage) && isNonEmptyText(value.kind) && typeof value.message === "string") return { outcome: "execution_denied", protocol: INTERFACE_COMPILER_WORTH_PROTOCOL, request_id: value.request_id, operation: INTERFACE_COMPILER_WORTH_START_EXECUTION_OPERATION, execution_id: value.execution_id, stage: value.stage, kind: value.kind, message: value.message }
  if (value.outcome === "execution_settled" && value.operation === INTERFACE_COMPILER_WORTH_COMPLETE_EXECUTION_OPERATION && isHostCommit(value.commit) && isHostExecutionProjection(value.execution) && isHostEvidence(value.evidence)) return { outcome:"execution_settled",protocol:INTERFACE_COMPILER_WORTH_PROTOCOL,request_id:value.request_id,operation:INTERFACE_COMPILER_WORTH_COMPLETE_EXECUTION_OPERATION,commit:value.commit,execution:value.execution,evidence:value.evidence }
  if (value.outcome === "execution_stale" && value.operation === INTERFACE_COMPILER_WORTH_COMPLETE_EXECUTION_OPERATION && isNonEmptyText(value.execution_id) && isRevision(value.expected_revision) && isRevision(value.actual_revision)) return { outcome:"execution_stale",protocol:INTERFACE_COMPILER_WORTH_PROTOCOL,request_id:value.request_id,operation:INTERFACE_COMPILER_WORTH_COMPLETE_EXECUTION_OPERATION,execution_id:value.execution_id,expected_revision:value.expected_revision,actual_revision:value.actual_revision }
  if (value.outcome === "execution_lifecycle_invalid" && value.operation === INTERFACE_COMPILER_WORTH_COMPLETE_EXECUTION_OPERATION && isNonEmptyText(value.execution_id) && isNonEmptyText(value.current_lifecycle)) return { outcome:"execution_lifecycle_invalid",protocol:INTERFACE_COMPILER_WORTH_PROTOCOL,request_id:value.request_id,operation:INTERFACE_COMPILER_WORTH_COMPLETE_EXECUTION_OPERATION,execution_id:value.execution_id,current_lifecycle:value.current_lifecycle }
  if (value.outcome === "event_published" && value.operation === INTERFACE_COMPILER_WORTH_PUBLISH_DOMAIN_EVENT_OPERATION && isHostCommit(value.commit) && isNonEmptyText(value.event_id) && isRevision(value.journal_revision) && isHostEvidence(value.evidence)) return { outcome:"event_published",protocol:INTERFACE_COMPILER_WORTH_PROTOCOL,request_id:value.request_id,operation:INTERFACE_COMPILER_WORTH_PUBLISH_DOMAIN_EVENT_OPERATION,commit:value.commit,event_id:value.event_id,journal_revision:value.journal_revision,evidence:value.evidence }
  if (value.outcome === "unavailable" && isNonEmptyText(value.operation) && isHostUnavailableReason(value.reason) && typeof value.message === "string") return { outcome: "unavailable", protocol: INTERFACE_COMPILER_WORTH_PROTOCOL, request_id: value.request_id, operation: value.operation, reason: value.reason, message: value.message }
  if (value.outcome === "invalid_request" && isNonEmptyText(value.reason) && typeof value.message === "string") return { outcome: "invalid_request", protocol: INTERFACE_COMPILER_WORTH_PROTOCOL, request_id: value.request_id, reason: value.reason, message: value.message }
  if (value.outcome === "capability_found" && value.operation === INTERFACE_COMPILER_WORTH_READ_CAPABILITY_OPERATION && isHostCapability(value.capability) && isHostEvidence(value.evidence)) return { outcome: "capability_found", protocol: INTERFACE_COMPILER_WORTH_PROTOCOL, request_id: value.request_id, operation: INTERFACE_COMPILER_WORTH_READ_CAPABILITY_OPERATION, capability: value.capability, evidence: value.evidence }
  if (value.outcome === "active_replay_found" && value.operation === INTERFACE_COMPILER_WORTH_READ_ACTIVE_REPLAY_OPERATION && isHostReplay(value.replay) && isHostEvidence(value.evidence)) return { outcome: "active_replay_found", protocol: INTERFACE_COMPILER_WORTH_PROTOCOL, request_id: value.request_id, operation: INTERFACE_COMPILER_WORTH_READ_ACTIVE_REPLAY_OPERATION, replay: value.replay, evidence: value.evidence }
  if (value.outcome === "compiled_read_not_found" && isCompiledReadOperation(value.operation) && isNonEmptyText(value.capability_id)) return { outcome: "compiled_read_not_found", protocol: INTERFACE_COMPILER_WORTH_PROTOCOL, request_id: value.request_id, operation: value.operation, capability_id: value.capability_id }
  if (value.outcome === "compiled_read_denied" && isCompiledReadOperation(value.operation) && isNonEmptyText(value.capability_id) && isHostDenialStage(value.stage) && isNonEmptyText(value.kind) && typeof value.message === "string") return { outcome: "compiled_read_denied", protocol: INTERFACE_COMPILER_WORTH_PROTOCOL, request_id: value.request_id, operation: value.operation, capability_id: value.capability_id, stage: value.stage, kind: value.kind, message: value.message }
  return undefined
}

function isHostProjection(value: unknown): value is HostProjection { return isRecord(value) && value.projection_kind === "worth_application" && isNonEmptyText(value.id) && isRevision(value.revision) && typeof value.name === "string" && typeof value.base_url === "string" }
function isHostExecutionProjection(value: unknown): value is HostExecutionProjection { return isRecord(value) && value.projection_kind === "worth_execution" && isNonEmptyText(value.execution_id) && isNonEmptyText(value.lifecycle) && isRevision(value.revision) && "settlement" in value && isNonEmptyText(value.capability_id) && isNonEmptyText(value.mode) && isRecord(value.metrics) && (value.replay_version_id === undefined || isNonEmptyText(value.replay_version_id)) }
function isHostCapability(value: unknown): value is HostCapabilityProjection { return isRecord(value) && value.projection_kind === "worth_capability" && isNonEmptyText(value.id) && isRevision(value.revision) && isNonEmptyText(value.application_id) && typeof value.name === "string" && typeof value.description === "string" && isNonEmptyText(value.status) && isNonEmptyText(value.active_replay_version_id) }
function isHostReplay(value: unknown): value is HostActiveReplayProjection { return isRecord(value) && value.projection_kind === "worth_replay" && isNonEmptyText(value.id) && isRevision(value.revision) && isNonEmptyText(value.capability_id) && isRevision(value.version) && value.version > 0 && Array.isArray(value.steps) && value.steps.every(isHostReplayStep) && typeof value.confidence === "number" && Number.isFinite(value.confidence) && isNonEmptyText(value.status) && isNonEmptyText(value.created_at) && isNonEmptyText(value.verified_at) && isHostVerification(value.verification) }
function isHostReplayStep(value: unknown): value is HostReplayStep { if (!isRecord(value) || !isNonEmptyText(value.type)) return false; switch (value.type) { case "navigate": return isNonEmptyText(value.url); case "click": return isHostLocator(value.target); case "fill": case "select": return isHostLocator(value.target) && typeof value.value === "string"; case "wait": return isRevision(value.milliseconds) && value.milliseconds > 0; case "read": return isHostLocator(value.target) && isNonEmptyText(value.outputKey); case "assert": return isRecord(value.condition); default: return false } }
function isHostLocator(value: unknown): value is HostLocator { return isRecord(value) && isNonEmptyText(value.semanticDescription) && [value.role, value.name, value.text, value.selector].every((entry) => entry === undefined || typeof entry === "string") }
function isHostVerification(value: unknown): value is HostReplayVerification { return isRecord(value) && isRevision(value.requiredSuccessfulRuns) && value.requiredSuccessfulRuns > 0 && Array.isArray(value.runs) && value.runs.every((run) => isRecord(run) && isNonEmptyText(run.id) && isNonEmptyText(run.capabilityId) && isNonEmptyText(run.replayVersionId) && isNonEmptyText(run.sessionId) && run.freshSession === true && isNonEmptyText(run.outcome) && Array.isArray(run.evidenceIds) && run.evidenceIds.every(isNonEmptyText) && isNonEmptyText(run.completedAt)) }
function isCompiledReadOperation(value: unknown): value is CompiledReadOperation { return value === INTERFACE_COMPILER_WORTH_READ_CAPABILITY_OPERATION || value === INTERFACE_COMPILER_WORTH_READ_ACTIVE_REPLAY_OPERATION }
function isHostEvidence(value: unknown): value is HostEvidence { return isRecord(value) && isNonEmptyText(value.query_name) && isNonEmptyText(value.query_identity) && isRevision(value.basis_version) && isRevision(value.projected_record_count) && isRevision(value.projected_field_count) && typeof value.basis_released === "boolean" }
function isHostCommit(value: unknown): value is "committed" | "already_committed" { return value === "committed" || value === "already_committed" }
function isHostDenialStage(value: unknown): value is HostDenialStage { return value === "request" || value === "authentication" || value === "principal_resolution" || value === "entity_resolution" || value === "query" || value === "projection" }
function isHostStartDenialStage(value: unknown): value is HostStartDenialStage { return value === "request" || value === "authentication" || value === "principal_resolution" || value === "entity_resolution" || value === "operation_admission" || value === "dependency_projection" || value === "effect_program" || value === "commit" || value === "query" }
function isHostUnavailableReason(value: unknown): value is HostUnavailableReason { return value === "unsupported" || value === "not_configured" || value === "protocol_mismatch" }
function isRevision(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 }
function isNonEmptyText(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" }
