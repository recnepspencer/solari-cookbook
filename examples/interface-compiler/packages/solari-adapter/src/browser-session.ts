import {
  normalizeObservation,
  validateOperationContext,
  validateReplayStep,
  type Clock,
  type EvidenceCaptureRequest,
  type EvidenceId,
  type IdSource,
  type OperationContext,
  type PartialEffectPosture,
  type ReplayStep,
  type SessionId,
  type SolariCloseResult,
  type SolariEvidenceResult,
  type SolariObservationResult,
  type SolariSession,
  type SolariStepResult,
} from "@interface-compiler/domain"
import { readPageObservation } from "./page-observation.js"
import {
  readClockMilliseconds,
  runSolariOperationWithinBoundary,
  type BoundedOperationResult,
  type SessionResourceBudget,
  type SolariOperationResource,
} from "./resource-boundary.js"
import { ReplayStepExecutionError, executeReplayStepOnPage } from "./replay-step-execution.js"
import { asSolariPage, asSolariReplayUrl, type SolariSdkBrowser, type SolariSdkClient, type SolariSdkPage } from "./solari-sdk.js"
import {
  classifySolariFailure,
  discardTelemetry,
  failure,
  publishTelemetry,
  type SolariFailureCode,
  type SolariTelemetryOperation,
  type SolariTelemetryOutcome,
  type TelemetrySink,
} from "./telemetry.js"

const RECORDING_POLL_ATTEMPTS = 10
const RECORDING_POLL_DELAY_MS = 3_000

type WorkflowAdmission = "acquired" | "invalid_context" | "session_busy" | "session_closed"

interface SolariBrowserSessionOptions {
  readonly client: SolariSdkClient
  readonly browser: SolariSdkBrowser
  readonly applicationOrigin: string
  readonly budget: SessionResourceBudget
  readonly clock: Clock
  readonly idSource: IdSource
  readonly telemetry?: TelemetrySink
}

export class SolariBrowserSession implements SolariSession {
  readonly sessionId: SessionId

  private readonly client: SolariSdkClient
  private readonly browser: SolariSdkBrowser
  private readonly applicationOrigin: string
  private readonly budget: SessionResourceBudget
  private readonly clock: Clock
  private readonly idSource: IdSource
  private readonly telemetry: TelemetrySink
  private currentPage: SolariSdkPage | undefined
  private operationInFlight = false
  private browserClosePromise: Promise<void> | undefined
  private clientClosePromise: Promise<void> | undefined
  private closeResultPromise: Promise<SolariCloseResult> | undefined
  private recordingReference: string | undefined
  private recordingEvidenceId: EvidenceId | undefined

  constructor(options: SolariBrowserSessionOptions) {
    this.client = options.client
    this.browser = options.browser
    this.applicationOrigin = options.applicationOrigin
    this.budget = options.budget
    this.clock = options.clock
    this.idSource = options.idSource
    this.telemetry = options.telemetry ?? discardTelemetry
    this.sessionId = options.browser.id as SessionId
  }

  async observe(context: OperationContext): Promise<SolariObservationResult> {
    const admission = this.beginWorkflow(context, "observe")
    if (admission !== "acquired") return observationResultFromAdmission(admission)
    try {
      const pageResult = await this.ensurePage(context)
      if (pageResult.kind !== "completed") return observationResultFromBoundary(pageResult)

      const result = await this.runOperation(context, "observe", "observation", false, () => readPageObservation(pageResult.value, this.sessionId, this.clock, this.idSource))
      if (result.kind === "completed") return observationFromValidation(result.value)
      return observationResultFromBoundary(result)
    } finally {
      this.endWorkflow()
    }
  }

  async executeStep(step: ReplayStep, context: OperationContext): Promise<SolariStepResult> {
    return this.executeStepAt(0, step, context)
  }

  async executeStepAt(stepIndex: number, step: ReplayStep, context: OperationContext): Promise<SolariStepResult> {
    const admission = this.beginWorkflow(context, "execute_step")
    if (admission !== "acquired") return stepResultFromAdmission(admission, stepIndex)
    try {
      if (!isValidStep(step, stepIndex)) return this.failedStep(safeStepIndex(stepIndex), "invalid_request", { kind: "not_started" }, context)

      const pageResult = await this.ensurePage(context)
      if (pageResult.kind !== "completed") return this.stepResultFromBoundary(pageResult, stepIndex, context)

      if (step.type === "assert") {
        const assertionResult = await this.runOperation(context, "execute_step", "browser_action", false, () => readPageObservation(pageResult.value, this.sessionId, this.clock, this.idSource), step.type)
        if (assertionResult.kind === "completed") {
          if (assertionResult.value.ok) return { kind: "completed", observation: assertionResult.value.value, effect: { kind: "completed" } }
          return this.failedStep(stepIndex, "sdk_contract", { kind: "not_started" }, context)
        }
        return this.stepResultFromBoundary(assertionResult, stepIndex, context)
      }

      const result = await this.runOperation(context, "execute_step", "browser_action", true, () => executeReplayStepOnPage(pageResult.value, step, this.applicationOrigin), step.type)
      if (result.kind === "completed") return { kind: "completed", effect: { kind: "completed" } }
      return this.stepResultFromBoundary(result, stepIndex, context)
    } finally {
      this.endWorkflow()
    }
  }

  async captureEvidence(request: EvidenceCaptureRequest, context: OperationContext): Promise<SolariEvidenceResult> {
    if (validateOperationContext(context).length > 0) return evidenceFailure("invalid_context", false)
    const evidenceKind = readEvidenceKind(request)
    if (evidenceKind === undefined) {
      this.emit(context, "capture_evidence", "failed", "invalid_request")
      return evidenceFailure("invalid_request", false)
    }
    if (evidenceKind !== "session_recording") {
      this.emit(context, "capture_evidence", "failed", "unsupported_evidence", undefined, evidenceKind)
      return evidenceFailure("unsupported_evidence")
    }
    if (this.recordingReference !== undefined && this.recordingEvidenceId !== undefined) {
      return this.cachedRecordingResult()
    }

    const admission = this.beginWorkflow(context, "capture_evidence", undefined, evidenceKind)
    if (admission !== "acquired") return evidenceResultFromAdmission(admission)
    try {
      return await this.captureEvidenceWithinWorkflow(context)
    } finally {
      this.endWorkflow()
    }
  }

  private async captureEvidenceWithinWorkflow(context: OperationContext): Promise<SolariEvidenceResult> {
    if (this.recordingReference !== undefined && this.recordingEvidenceId !== undefined) return this.cachedRecordingResult()
    if (this.budget.closed && this.recordingReference === undefined) {
      this.emit(context, "capture_evidence", "failed", "recording_unavailable_after_close", undefined, "session_recording")
      return evidenceFailure("recording_unavailable_after_close")
    }
    // URL-only receipts materialize no artifact bytes in this adapter. A zero
    // budget still denies the receipt; positive budgets are not spent here.
    if (context.budget.maxEvidenceBytes === 0 || this.budget.maxEvidenceBytes === 0) {
      this.emit(context, "capture_evidence", "budget_exhausted", "budget_exhausted", undefined, "session_recording")
      return evidenceFailure("budget_exhausted", false)
    }

    const releaseResult = await this.releaseForRecording(context)
    if (releaseResult.kind !== "completed") {
      await this.close(context)
      return evidenceResultFromBoundary(releaseResult)
    }

    const recordingUrl = await this.pollRecordingUrl(context)
    if (recordingUrl.kind !== "completed") {
      await this.close(context)
      return evidenceResultFromBoundary(recordingUrl, true)
    }

    let evidenceId: EvidenceId
    try {
      evidenceId = this.idSource.nextEvidenceId()
    } catch {
      await this.close(context)
      this.emit(context, "capture_evidence", "failed", "id_source_failure", undefined, "session_recording")
      return evidenceFailure("id_source_failure", false)
    }
    if (typeof evidenceId !== "string" || evidenceId.trim() === "") {
      await this.close(context)
      this.emit(context, "capture_evidence", "failed", "id_source_failure", undefined, "session_recording")
      return evidenceFailure("id_source_failure", false)
    }

    const closeResult = await this.close(context)
    if (closeResult.kind !== "closed") {
      this.emit(context, "capture_evidence", "failed", "close_failed", undefined, "session_recording")
      return evidenceFailure("close_failed")
    }
    this.recordingReference = recordingUrl.value
    this.recordingEvidenceId = evidenceId
    this.emit(context, "capture_evidence", "completed", undefined, undefined, "session_recording")
    return { kind: "captured", reference: { evidenceId, kind: "session_recording", externalRef: recordingUrl.value } }
  }

  close(context: OperationContext): Promise<SolariCloseResult> {
    if (this.closeResultPromise === undefined) {
      this.budget.closed = true
      this.closeResultPromise = this.releaseResources()
    }
    return this.closeResultPromise.then((result) => {
      this.emit(context, "close_browser", result.kind === "closed" ? "completed" : "failed", result.kind === "closed" ? undefined : "close_failed")
      return result
    })
  }

  private async ensurePage(context: OperationContext): Promise<BoundedOperationResult<SolariSdkPage>> {
    const result = await this.runOperation(context, "observe", "observation", false, async () => {
      if (this.currentPage !== undefined) return this.currentPage
      const page = asSolariPage(await this.browser.newPage())
      if (page === undefined) throw { code: "sdk_contract" }
      return page
    })
    if (result.kind === "completed") this.currentPage = result.value
    return result
  }

  private async releaseForRecording(context: OperationContext): Promise<BoundedOperationResult<void>> {
    return this.runOperation(context, "capture_evidence", "recording_lookup", true, () => this.releaseBrowserOnce())
  }

  private async pollRecordingUrl(context: OperationContext): Promise<BoundedOperationResult<string>> {
    for (let attempt = 0; attempt < RECORDING_POLL_ATTEMPTS; attempt += 1) {
      const lookup = await this.runOperation(context, "capture_evidence", "recording_lookup", false, async () => {
        const raw = await this.client.sessions.getReplayUrl(this.sessionId)
        const replayUrl = asSolariReplayUrl(raw)
        if (replayUrl === undefined) throw { code: "sdk_contract" }
        return replayUrl.url
      }, undefined, true)
      if (lookup.kind === "completed") return lookup
      if (lookup.kind !== "failed") return lookup
      const classified = classifySolariFailure(lookup.error, true)
      if (classified.code !== "recording_not_ready" || attempt === RECORDING_POLL_ATTEMPTS - 1) return { kind: "failed", error: { code: classified.code }, effect: lookup.effect }

      const waitResult = await this.runOperation(context, "capture_evidence", "recording_lookup", false, () => waitForRecordingRetry(), undefined)
      if (waitResult.kind !== "completed") return waitResult
    }
    return { kind: "failed", error: { code: "recording_not_ready" }, effect: { kind: "not_started" } }
  }

  private async runOperation<T>(
    context: OperationContext,
    telemetryOperation: SolariTelemetryOperation,
    resource: SolariOperationResource,
    effectful: boolean,
    operation: () => Promise<T>,
    stepType?: ReplayStep["type"],
    replayLookup = false,
    evidenceKind?: EvidenceCaptureRequest["kind"],
  ): Promise<BoundedOperationResult<T>> {
    if (validateOperationContext(context).length > 0) return { kind: "denied", reason: "invalid_context" }
    if (this.budget.closed) {
      this.emit(context, telemetryOperation, "session_closed", "session_closed", stepType, evidenceKind)
      return { kind: "denied", reason: "session_closed" }
    }
    const nowMs = readClockMilliseconds(this.clock)
    if (nowMs === undefined) {
      this.emit(context, telemetryOperation, "failed", "clock_failure", stepType, evidenceKind)
      return { kind: "failed", error: { code: "clock_failure" }, effect: { kind: "not_started" } }
    }

    const result = await runSolariOperationWithinBoundary({
      context,
      budget: this.budget,
      resource,
      effectful,
      nowMs,
      readNowMs: () => readClockMilliseconds(this.clock),
      operation,
      onBoundary: () => this.close(context).then(() => undefined),
    })
    this.emitBoundaryResult(context, telemetryOperation, result, stepType, evidenceKind, replayLookup)
    if (result.kind === "cancelled" || result.kind === "timed_out") void this.close(context)
    return result
  }

  private async failedStep(stepIndex: number, code: SolariFailureCode, effect: PartialEffectPosture, context: OperationContext): Promise<SolariStepResult> {
    const evidence = await this.captureFailureRecording(context)
    return {
      kind: "failed",
      failure: {
        kind: "step_failed",
        stepIndex,
        message: failure(code).message,
        evidenceIds: evidence,
      },
      effect,
    }
  }

  private async captureFailureRecording(context: OperationContext): Promise<readonly EvidenceId[]> {
    if (this.budget.closed || this.recordingEvidenceId !== undefined) return this.recordingEvidenceId === undefined ? [] : [this.recordingEvidenceId]
    const result = await this.captureEvidenceWithinWorkflow(context)
    return result.kind === "captured" ? [result.reference.evidenceId] : []
  }

  private beginWorkflow(context: OperationContext, operation: SolariTelemetryOperation, stepType?: ReplayStep["type"], evidenceKind?: EvidenceCaptureRequest["kind"]): WorkflowAdmission {
    if (validateOperationContext(context).length > 0) return "invalid_context"
    if (this.operationInFlight) {
      this.emit(context, operation, "session_busy", "session_busy", stepType, evidenceKind)
      return "session_busy"
    }
    if (this.budget.closed) {
      this.emit(context, operation, "session_closed", "session_closed", stepType, evidenceKind)
      return "session_closed"
    }
    this.operationInFlight = true
    return "acquired"
  }

  private endWorkflow(): void {
    this.operationInFlight = false
  }

  private cachedRecordingResult(): SolariEvidenceResult {
    if (this.recordingReference === undefined || this.recordingEvidenceId === undefined) return evidenceFailure("recording_unavailable_after_close", false)
    return {
      kind: "captured",
      reference: { evidenceId: this.recordingEvidenceId, kind: "session_recording", externalRef: this.recordingReference },
    }
  }

  private async stepResultFromBoundary<T>(result: BoundedOperationResult<T>, stepIndex: number, context: OperationContext): Promise<SolariStepResult> {
    if (result.kind === "cancelled") return { kind: "cancelled", safePoint: result.safePoint === "before_operation" ? "before_step" : "after_step", effect: result.effect }
    if (result.kind === "timed_out") return { kind: "timed_out", effect: result.effect }
    if (result.kind === "denied") return this.failedStep(stepIndex, result.reason === "budget_exhausted" ? "budget_exhausted" : result.reason === "session_closed" ? "session_closed" : result.reason === "invalid_context" ? "invalid_context" : "session_busy", { kind: "not_started" }, context)
    if (result.kind === "completed") return { kind: "completed", effect: { kind: "completed" } }
    const effect = result.error instanceof ReplayStepExecutionError ? { kind: "not_started" as const } : result.effect
    return this.failedStep(stepIndex, failureCode(result.error), effect, context)
  }

  private async releaseResources(): Promise<SolariCloseResult> {
    let browserError: unknown
    let clientError: unknown
    try {
      await this.releaseBrowserOnce()
    } catch (error) {
      browserError = error
    }
    try {
      await this.closeClientOnce()
    } catch (error) {
      clientError = error
    }
    if (browserError !== undefined || clientError !== undefined) return { kind: "close_failed", message: failure("close_failed").message, retryable: false }
    return { kind: "closed" }
  }

  private async releaseBrowserOnce(): Promise<void> {
    if (this.browserClosePromise === undefined) this.browserClosePromise = invokeClose(this.browser)
    return this.browserClosePromise
  }

  private async closeClientOnce(): Promise<void> {
    if (this.clientClosePromise === undefined) this.clientClosePromise = invokeClose(this.client)
    return this.clientClosePromise
  }

  private emitBoundaryResult<T>(context: OperationContext, operation: SolariTelemetryOperation, result: BoundedOperationResult<T>, stepType?: ReplayStep["type"], evidenceKind?: EvidenceCaptureRequest["kind"], replayLookup = false): void {
    if (result.kind === "completed") return this.emit(context, operation, "completed", undefined, stepType, evidenceKind)
    if (result.kind === "cancelled") return this.emit(context, operation, "cancelled", "cancelled", stepType, evidenceKind)
    if (result.kind === "timed_out") return this.emit(context, operation, "timed_out", "deadline_exceeded", stepType, evidenceKind)
    if (result.kind === "denied") {
      if (result.reason === "invalid_context") return this.emit(context, operation, "failed", "invalid_context", stepType, evidenceKind)
      return this.emit(context, operation, result.reason === "budget_exhausted" ? "budget_exhausted" : result.reason === "session_closed" ? "session_closed" : "session_busy", result.reason === "budget_exhausted" ? "budget_exhausted" : result.reason, stepType, evidenceKind)
    }
    const classified = classifySolariFailure(result.error, replayLookup)
    this.emit(context, operation, "failed", classified.code, stepType, evidenceKind)
  }

  private emit(context: OperationContext, operation: SolariTelemetryOperation, outcome: SolariTelemetryOutcome, errorCode?: SolariFailureCode, stepType?: ReplayStep["type"], evidenceKind?: EvidenceCaptureRequest["kind"]): void {
    if (validateOperationContext(context).length > 0) return
    publishTelemetry(this.telemetry, {
      schema: "interface-compiler.solari-adapter.telemetry",
      version: 1,
      operation,
      outcome,
      operationId: context.operationId,
      sessionId: this.sessionId,
      ...(stepType === undefined ? {} : { stepType }),
      ...(evidenceKind === undefined ? {} : { evidenceKind }),
      ...(errorCode === undefined ? {} : { errorCode }),
    })
  }
}

function isValidStep(step: ReplayStep, stepIndex: number): boolean {
  return Number.isSafeInteger(stepIndex) && stepIndex >= 0 && validateReplayStep(step, stepIndex).length === 0
}

function safeStepIndex(stepIndex: number): number {
  return Number.isSafeInteger(stepIndex) && stepIndex >= 0 ? stepIndex : 0
}

function readEvidenceKind(value: unknown): EvidenceCaptureRequest["kind"] | undefined {
  if (value === null || typeof value !== "object") return undefined
  const kind = (value as { readonly kind?: unknown }).kind
  return kind === "session_recording" || kind === "screenshot" || kind === "snapshot" ? kind : undefined
}

function admissionFailureCode(admission: Exclude<WorkflowAdmission, "acquired">): SolariFailureCode {
  switch (admission) {
    case "invalid_context": return "invalid_context"
    case "session_busy": return "session_busy"
    case "session_closed": return "session_closed"
  }
}

function observationResultFromAdmission(admission: Exclude<WorkflowAdmission, "acquired">): SolariObservationResult {
  const code = admissionFailureCode(admission)
  return { kind: "failed", message: failure(code, false).message, retryable: false }
}

function stepResultFromAdmission(admission: Exclude<WorkflowAdmission, "acquired">, stepIndex: number): SolariStepResult {
  const code = admissionFailureCode(admission)
  return {
    kind: "failed",
    failure: {
      kind: "step_failed",
      stepIndex: safeStepIndex(stepIndex),
      message: failure(code, false).message,
      evidenceIds: [],
    },
    effect: { kind: "not_started" },
  }
}

function evidenceResultFromAdmission(admission: Exclude<WorkflowAdmission, "acquired">): SolariEvidenceResult {
  return evidenceFailure(admissionFailureCode(admission), false)
}

function failureCode(error: unknown): SolariFailureCode {
  if (error instanceof ReplayStepExecutionError) return error.code
  const classified = classifySolariFailure(error)
  return classified.code
}

function observationFromValidation(result: ReturnType<typeof normalizeObservation>): SolariObservationResult {
  return result.ok ? { kind: "observed", observation: result.value } : { kind: "failed", message: "Solari observation was invalid", retryable: false }
}

function observationResultFromBoundary<T>(result: BoundedOperationResult<T>): SolariObservationResult {
  if (result.kind === "cancelled") return { kind: "cancelled" }
  if (result.kind === "timed_out") return { kind: "timed_out" }
  if (result.kind === "failed") {
    const classified = classifySolariFailure(result.error)
    return { kind: "failed", message: classified.message, retryable: classified.retryable }
  }
  if (result.kind === "denied") return { kind: "failed", message: failure(result.reason === "budget_exhausted" ? "budget_exhausted" : result.reason === "session_closed" ? "session_closed" : result.reason === "invalid_context" ? "invalid_context" : "session_busy", false).message, retryable: false }
  return { kind: "failed", message: "Solari observation was not completed", retryable: false }
}

function evidenceResultFromBoundary<T>(result: BoundedOperationResult<T>, replayLookup = false): SolariEvidenceResult {
  if (result.kind === "cancelled") return { kind: "cancelled" }
  if (result.kind === "timed_out") return { kind: "timed_out" }
  if (result.kind === "failed") {
    const classified = classifySolariFailure(result.error, replayLookup)
    return evidenceFailure(classified.code, classified.retryable)
  }
  if (result.kind === "denied") return evidenceFailure(result.reason === "budget_exhausted" ? "budget_exhausted" : result.reason === "session_closed" ? "session_closed" : result.reason === "invalid_context" ? "invalid_context" : "session_busy", false)
  return evidenceFailure("sdk_failure")
}

function evidenceFailure(code: SolariFailureCode, retryable = failure(code).retryable): SolariEvidenceResult {
  return { kind: "failed", message: failure(code, retryable).message, retryable }
}

function waitForRecordingRetry(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, RECORDING_POLL_DELAY_MS))
}

function invokeClose(resource: { close(): Promise<void> }): Promise<void> {
  try {
    return Promise.resolve(resource.close())
  } catch (error) {
    return Promise.reject(error)
  }
}
