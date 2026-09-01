import type { EvidenceCaptureRequest, OperationId, ReplayStep, SessionId } from "@interface-compiler/domain"

export type SolariFailureCode =
  | "invalid_context"
  | "invalid_request"
  | "clock_failure"
  | "id_source_failure"
  | "sdk_contract"
  | "sdk_failure"
  | "recording_not_ready"
  | "recording_unavailable_after_close"
  | "unsupported_evidence"
  | "session_closed"
  | "session_busy"
  | "budget_exhausted"
  | "deadline_exceeded"
  | "cancelled"
  | "navigation_denied"
  | "locator_unavailable"
  | "unsupported_step"
  | "freshness_unsupported"
  | "close_failed"

export type SolariTelemetryOperation = "create_browser" | "observe" | "execute_step" | "capture_evidence" | "close_browser"
export type SolariTelemetryOutcome = "completed" | "failed" | "cancelled" | "timed_out" | "budget_exhausted" | "session_closed" | "session_busy"

/** Telemetry is deliberately limited to low-cardinality, non-secret fields. */
export interface RedactedSolariTelemetryEvent {
  readonly schema: "interface-compiler.solari-adapter.telemetry"
  readonly version: 1
  readonly operation: SolariTelemetryOperation
  readonly outcome: SolariTelemetryOutcome
  readonly operationId: OperationId
  readonly sessionId?: SessionId
  readonly stepType?: ReplayStep["type"]
  readonly evidenceKind?: EvidenceCaptureRequest["kind"]
  readonly durationMs?: number
  readonly errorCode?: SolariFailureCode
}

export interface TelemetrySink {
  emit(event: RedactedSolariTelemetryEvent): void
}

export const discardTelemetry: TelemetrySink = {
  emit: () => undefined,
}

export interface RedactedSolariFailure {
  readonly code: SolariFailureCode
  readonly retryable: boolean
  readonly message: string
}

export function classifySolariFailure(error: unknown, replayLookup = false): RedactedSolariFailure {
  const status = readStatus(error)
  if (replayLookup && status === 404) return failure("recording_not_ready")

  const code = readKnownCode(error)
  if (code !== undefined && code !== "FeatureRequiresPlan" && code !== "PlanLimitExceeded" && code !== "ConcurrencyLimitExceeded") return failure(code)
  if (code === "FeatureRequiresPlan" || code === "PlanLimitExceeded" || code === "ConcurrencyLimitExceeded") return failure("sdk_failure", false)
  if (status === 401 || status === 403) return failure("sdk_failure", false)
  return failure(code === "sdk_contract" ? "sdk_contract" : "sdk_failure")
}

export function failure(code: SolariFailureCode, retryable = retryableFailure(code)): RedactedSolariFailure {
  return { code, retryable, message: publicFailureMessage(code) }
}

export function publishTelemetry(sink: TelemetrySink, event: RedactedSolariTelemetryEvent): void {
  try {
    sink.emit(event)
  } catch {
    // Diagnostics must not change browser or cleanup outcomes.
  }
}

function retryableFailure(code: SolariFailureCode): boolean {
  return code === "sdk_failure" || code === "recording_not_ready" || code === "clock_failure"
}

function publicFailureMessage(code: SolariFailureCode): string {
  switch (code) {
    case "invalid_context": return "Solari operation context is invalid"
    case "invalid_request": return "Solari browser request is invalid"
    case "clock_failure": return "Solari adapter clock did not provide a valid timestamp"
    case "id_source_failure": return "Solari adapter could not allocate a domain receipt id"
    case "sdk_contract": return "Solari SDK returned an unsupported resource shape"
    case "sdk_failure": return "Solari SDK operation failed"
    case "recording_not_ready": return "Solari session recording is not ready"
    case "recording_unavailable_after_close": return "Solari recording lookup requires a receipt captured before client close"
    case "unsupported_evidence": return "Solari can provide session recordings but not this evidence kind"
    case "session_closed": return "Solari session is closed"
    case "session_busy": return "Solari session already has an operation in flight"
    case "budget_exhausted": return "Solari resource budget is exhausted"
    case "deadline_exceeded": return "Solari operation deadline was exceeded"
    case "cancelled": return "Solari operation was cancelled"
    case "navigation_denied": return "Solari navigation left the application origin"
    case "locator_unavailable": return "Solari could not resolve the replay target"
    case "unsupported_step": return "Solari cannot return read-step output through the current domain port"
    case "freshness_unsupported": return "Solari adapter can create fresh sessions only"
    case "close_failed": return "Solari session cleanup failed"
  }
}

function readStatus(error: unknown): number | undefined {
  if (!isObject(error) || typeof error.status !== "number") return undefined
  return Number.isInteger(error.status) ? error.status : undefined
}

function readKnownCode(error: unknown): SolariFailureCode | "FeatureRequiresPlan" | "PlanLimitExceeded" | "ConcurrencyLimitExceeded" | undefined {
  if (!isObject(error) || typeof error.code !== "string") return undefined
  if (error.code === "FeatureRequiresPlan" || error.code === "PlanLimitExceeded" || error.code === "ConcurrencyLimitExceeded") return error.code
  const adapterCodes: readonly SolariFailureCode[] = [
    "invalid_context",
    "invalid_request",
    "clock_failure",
    "id_source_failure",
    "sdk_contract",
    "sdk_failure",
    "recording_not_ready",
    "recording_unavailable_after_close",
    "unsupported_evidence",
    "session_closed",
    "session_busy",
    "budget_exhausted",
    "deadline_exceeded",
    "cancelled",
    "navigation_denied",
    "locator_unavailable",
    "unsupported_step",
    "freshness_unsupported",
    "close_failed",
  ]
  if (adapterCodes.includes(error.code as SolariFailureCode)) return error.code as SolariFailureCode
  return undefined
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object"
}
