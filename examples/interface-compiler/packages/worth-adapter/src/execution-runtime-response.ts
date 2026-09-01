import { classifySafetyBoundary, validateExecutionCompletion, validateExecutionMetrics, type ExecutionCompletion, type ExecutionId, type ExecutionStart, type IsoTimestamp, type SafetySignal } from "@interface-compiler/domain"
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
  if (response.outcome === "execution_settled" && response.execution.execution_id === executionId && isTerminalLifecycle(response.execution.lifecycle) && isTerminalExecutionMetrics(response.execution.metrics) && authoritativeCompletion !== undefined && lifecycleMatchesCompletion(response.execution.lifecycle, authoritativeCompletion)) {
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
function isExecutionMetrics(value: unknown): value is ExecutionStart["metrics"] { return value !== null && typeof value === "object" && validateExecutionMetrics(value as ExecutionStart["metrics"]).length === 0 }
function isTerminalExecutionMetrics(value: unknown): value is ExecutionStart["metrics"] & { readonly endedAt: IsoTimestamp; readonly wallClockMs: number } {
  if (!isExecutionMetrics(value) || value.endedAt === undefined || value.wallClockMs === undefined) return false
  return Date.parse(value.endedAt) - Date.parse(value.startedAt) === value.wallClockMs
}

function terminalCompletion(response: HostResponse): ExecutionCompletion | undefined {
  if (response.outcome !== "execution_settled" || response.execution.settlement === null || typeof response.execution.settlement !== "object") return undefined
  const completion = (response.execution.settlement as { completion?: unknown }).completion
  if (completion === null || typeof completion !== "object") return undefined
  if ((completion as { kind?: unknown }).kind !== "safety_stop") return validateExecutionCompletion(completion as ExecutionCompletion).length === 0 ? completion as ExecutionCompletion : undefined
  const stop = (completion as { stop?: unknown }).stop
  if (stop === null || typeof stop !== "object") return undefined
  const record = stop as Record<string, unknown>
  if (record.kind !== "safety_stop" || record.terminal !== true || record.nextAction !== "human_required" || typeof record.observedAt !== "string") return undefined
  const signal = safetySignal(record)
  if (signal === undefined) return undefined
  const classified = classifySafetyBoundary({ observedAt: record.observedAt as IsoTimestamp, signal })
  return classified.ok && classified.value.kind === "stop" ? { kind: "safety_stop", stop: classified.value.result } : undefined
}

function safetySignal(stop: Record<string, unknown>): SafetySignal | undefined {
  switch (stop.reason) {
    case "authentication_required": return ["username", "password", "one_time_code", "unknown"].includes(String(stop.credential)) ? { kind: "authentication_required", credential: stop.credential as Extract<SafetySignal, { kind: "authentication_required" }>["credential"] } : undefined
    case "personal_information_required": return ["identity", "contact", "unknown"].includes(String(stop.information)) ? { kind: "personal_information_required", information: stop.information as Extract<SafetySignal, { kind: "personal_information_required" }>["information"] } : undefined
    case "shipping_details_required": return { kind: "shipping_details_required" }
    case "payment_details_required": return ["card", "bank_account", "wallet", "unknown"].includes(String(stop.payment)) ? { kind: "payment_details_required", payment: stop.payment as Extract<SafetySignal, { kind: "payment_details_required" }>["payment"] } : undefined
    case "order_placement": return { kind: "order_placement" }
    case "access_control_required": return { kind: "access_control_required" }
    default: return undefined
  }
}

function lifecycleMatchesCompletion(lifecycle: "success" | "failure" | "stopped", completion: ExecutionCompletion): boolean {
  return (lifecycle === "success" && completion.kind === "success") || (lifecycle === "failure" && completion.kind === "failure") || (lifecycle === "stopped" && completion.kind === "safety_stop")
}
