import type { ExecutionCompletion, ExecutionId, ExecutionStart, IsoTimestamp } from "@interface-compiler/domain"
import type { WorthExecutionAdmissionResult, WorthRuntimeSettlementResult } from "./execution-runtime.js"
import type { WorthExecutionQueryEvidence } from "./worth-start-execution.js"
import { INTERFACE_COMPILER_WORTH_ADMIT_EXECUTION_OPERATION, type HostEvidence, type HostResponse } from "./worth-query-wire.js"

export function mapAdmissionResponse(execution: ExecutionStart, response: HostResponse): WorthExecutionAdmissionResult {
  if (response.outcome === "execution_transitioned" && response.operation === INTERFACE_COMPILER_WORTH_ADMIT_EXECUTION_OPERATION && response.execution.execution_id === execution.id && response.execution.lifecycle === "started" && isExecutionMetrics(response.execution.metrics)) {
    return { kind: "admitted", commit: response.commit, projection: { projectionKind: "worth_running_execution", executionId: execution.id, capabilityId: response.execution.capability_id as ExecutionStart["capabilityId"], ...(response.execution.replay_version_id === undefined ? {} : { replayVersionId: response.execution.replay_version_id as ExecutionStart["replayVersionId"] }), mode: response.execution.mode as ExecutionStart["mode"], lifecycle: "started", revision: response.execution.revision, metrics: response.execution.metrics }, evidence: mapEvidence(response.evidence) }
  }
  if (response.outcome === "lifecycle_not_pending" && response.execution_id === execution.id) return { kind: "duplicate", executionId: execution.id, message: `execution identity is already admitted (${response.current_lifecycle})` }
  if (response.outcome === "execution_denied" && response.execution_id === execution.id) return { kind: "denied", executionId: execution.id, message: response.message }
  return { kind: "unavailable", executionId: execution.id, message: "the WORTH host returned a mismatched admission response" }
}

export function mapRuntimeSettlementResponse(executionId: ExecutionId, response: HostResponse): WorthRuntimeSettlementResult {
  const authoritativeCompletion = terminalCompletion(response)
  if (response.outcome === "execution_settled" && response.execution.execution_id === executionId && isTerminalLifecycle(response.execution.lifecycle) && isTerminalExecutionMetrics(response.execution.metrics) && authoritativeCompletion !== undefined) {
    return { kind: "settled", commit: response.commit, projection: { projectionKind: "worth_terminal_execution", executionId, capabilityId: response.execution.capability_id as ExecutionStart["capabilityId"], ...(response.execution.replay_version_id === undefined ? {} : { replayVersionId: response.execution.replay_version_id as ExecutionStart["replayVersionId"] }), mode: response.execution.mode as ExecutionStart["mode"], lifecycle: response.execution.lifecycle, revision: response.execution.revision, metrics: response.execution.metrics, outcome: authoritativeCompletion }, evidence: mapEvidence(response.evidence) }
  }
  if (response.outcome === "execution_stale" && response.execution_id === executionId) return { kind: "stale", executionId, expectedRevision: response.expected_revision, actualRevision: response.actual_revision }
  if (response.outcome === "execution_lifecycle_invalid" && response.execution_id === executionId) return { kind: "lifecycle_invalid", executionId, message: `execution lifecycle is ${response.current_lifecycle}` }
  if (response.outcome === "execution_denied" && response.execution_id === executionId) return { kind: "denied", executionId, message: response.message }
  return { kind: "unavailable", executionId, message: "the WORTH host returned a mismatched settlement response" }
}

function mapEvidence(evidence: HostEvidence): WorthExecutionQueryEvidence {
  return { queryName: evidence.query_name, queryIdentity: evidence.query_identity, basisVersion: evidence.basis_version, projectedRecordCount: evidence.projected_record_count, projectedFieldCount: evidence.projected_field_count, basisReleased: evidence.basis_released }
}

function isTerminalLifecycle(value: string): value is "success" | "failure" | "stopped" { return value === "success" || value === "failure" || value === "stopped" }
function isExecutionMetrics(value: unknown): value is ExecutionStart["metrics"] { return value !== null && typeof value === "object" && typeof (value as { startedAt?: unknown }).startedAt === "string" && ["modelCalls", "inputTokens", "outputTokens", "browserObservations", "browserActions", "estimatedModelCostUsd"].every((field) => typeof (value as Record<string, unknown>)[field] === "number") }
function isTerminalExecutionMetrics(value: unknown): value is ExecutionStart["metrics"] & { readonly endedAt: IsoTimestamp; readonly wallClockMs: number } { return isExecutionMetrics(value) && typeof (value as { endedAt?: unknown }).endedAt === "string" && typeof (value as { wallClockMs?: unknown }).wallClockMs === "number" }
function terminalCompletion(response: HostResponse): ExecutionCompletion | undefined { if (response.outcome !== "execution_settled" || response.execution.settlement === null || typeof response.execution.settlement !== "object") return undefined; const completion = (response.execution.settlement as { completion?: unknown }).completion; return completion !== null && typeof completion === "object" && ["success", "failure", "safety_stop"].includes(String((completion as { kind?: unknown }).kind)) ? completion as ExecutionCompletion : undefined }
