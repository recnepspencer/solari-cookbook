import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createInterface, type Interface as ReadlineInterface } from "node:readline"
import type {
  ApplicationId,
  ExecutionId,
  OperationContext,
  PartialEffectPosture,
} from "@interface-compiler/domain"
import {
  INTERFACE_COMPILER_WORTH_PROTOCOL,
  INTERFACE_COMPILER_WORTH_READ_OPERATION,
  INTERFACE_COMPILER_WORTH_START_EXECUTION_OPERATION,
  parseHostResponse,
  type HostDenialStage,
  type HostEvidence,
  type HostRequest,
  type HostResponse,
  type HostStartDenialStage,
  type HostUnavailableReason,
} from "./worth-query-wire.js"
import type { WorthExecutionQueryEvidence, WorthStartExecutionAdapter, WorthStartExecutionResult } from "./worth-start-execution.js"
import type { WorthApplicationReadAdapter, WorthApplicationReadResult } from "./worth-application-read.js"
export { INTERFACE_COMPILER_WORTH_PROTOCOL, INTERFACE_COMPILER_WORTH_READ_OPERATION, INTERFACE_COMPILER_WORTH_START_EXECUTION_OPERATION } from "./worth-query-wire.js"

export interface WorthQueryProcessCommand {
  readonly command: string
  readonly args?: readonly string[]
  readonly cwd?: string
}

export interface InterfaceCompilerWorthClientOptions {
  readonly process: WorthQueryProcessCommand
  readonly credential: string
}

type PendingResult = HostResponse | "cancelled" | "timed_out" | undefined
type PendingCompletion = (result: PendingResult) => void

/** App-specific process transport; WORTH retains all runtime authority. */
export class InterfaceCompilerWorthClient implements WorthApplicationReadAdapter, WorthStartExecutionAdapter {
  private readonly processCommand: WorthQueryProcessCommand
  private readonly credential: string
  private readonly pending = new Map<string, PendingCompletion>()
  private nextRequestNumber = 0
  private child: ChildProcessWithoutNullStreams | undefined
  private lines: ReadlineInterface | undefined
  private processFailure: string | undefined
  private closed = false

  public constructor(options: InterfaceCompilerWorthClientOptions) {
    if (options === null || typeof options !== "object" || options.process === null || typeof options.process !== "object") {
      throw new TypeError("a WORTH host process command is required")
    }
    if (typeof options.process.command !== "string" || options.process.command.trim().length === 0) {
      throw new TypeError("the WORTH host process command must not be empty")
    }
    if (typeof options.credential !== "string" || options.credential.trim().length === 0) {
      throw new TypeError("the WORTH host credential must not be empty")
    }
    this.processCommand = options.process
    this.credential = options.credential
  }

  public async readApplication(applicationId: ApplicationId, context: OperationContext): Promise<WorthApplicationReadResult> {
    const remainingMs = this.remainingRequestBudget(context)
    if (remainingMs.kind === "cancelled") return this.cancelled(context)
    if (remainingMs.kind === "timed_out") return this.timedOut(context)
    if (remainingMs.kind === "invalid") return this.denied(applicationId, "request", "invalid_context", remainingMs.message)

    const response = await this.send(
      {
        protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
        request_id: this.nextRequestId(),
        operation: INTERFACE_COMPILER_WORTH_READ_OPERATION,
        application_id: applicationId,
        credential: this.credential,
        deadline_ms: remainingMs.milliseconds,
      },
      context,
      remainingMs.milliseconds,
    )
    if (response === "cancelled") return this.cancelled(context)
    if (response === "timed_out") return this.timedOut(context)
    if (response === undefined) {
      return this.unavailable(applicationId, "transport_unavailable", this.processFailure ?? "the WORTH host process is unavailable")
    }
    return this.mapResponse(applicationId, response)
  }

  public async startExecution(executionId: ExecutionId, context: OperationContext): Promise<WorthStartExecutionResult> {
    const remainingMs = this.remainingRequestBudget(context)
    if (remainingMs.kind === "cancelled") return this.executionInterrupted("cancelled", context, { kind: "not_started" })
    if (remainingMs.kind === "timed_out") return this.executionInterrupted("timed_out", context, { kind: "not_started" })
    if (remainingMs.kind === "invalid") return this.executionDenied(executionId, "request", "invalid_context", remainingMs.message)

    const response = await this.send({
      protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
      request_id: this.nextRequestId(),
      operation: INTERFACE_COMPILER_WORTH_START_EXECUTION_OPERATION,
      execution_id: executionId,
      credential: this.credential,
      deadline_ms: remainingMs.milliseconds,
    }, context, remainingMs.milliseconds)
    if (response === "cancelled" || response === "timed_out") return this.executionInterrupted(response, context, unknownMutationPosture())
    if (response === undefined) return this.executionUnavailable(executionId, "transport_unavailable", this.processFailure ?? "the WORTH host process is unavailable")
    return this.mapStartExecutionResponse(executionId, response)
  }

  public async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.lines?.close()
    this.lines = undefined
    this.completePending(undefined)
    const child = this.child
    this.child = undefined
    if (child !== undefined) await closeChildProcess(child)
  }

  private remainingRequestBudget(context: OperationContext):
    | { readonly kind: "ready"; readonly milliseconds: number }
    | { readonly kind: "cancelled" }
    | { readonly kind: "timed_out" }
    | { readonly kind: "invalid"; readonly message: string } {
    if (context.cancellation.isCancellationRequested()) return { kind: "cancelled" }
    const deadline = Date.parse(context.deadlineAt)
    if (!Number.isFinite(deadline)) return { kind: "invalid", message: "deadlineAt must be an ISO timestamp" }
    if (!Number.isFinite(context.budget.maxWallClockMs) || context.budget.maxWallClockMs <= 0) {
      return { kind: "invalid", message: "maxWallClockMs must be positive" }
    }
    const remaining = deadline - Date.now()
    if (remaining <= 0) return { kind: "timed_out" }
    const milliseconds = Math.min(Math.floor(remaining), Math.floor(context.budget.maxWallClockMs))
    if (milliseconds <= 0) return { kind: "timed_out" }
    return { kind: "ready", milliseconds }
  }

  private nextRequestId(): string {
    this.nextRequestNumber += 1
    return `interface-compiler-client-${this.nextRequestNumber}`
  }

  private ensureProcess(): ChildProcessWithoutNullStreams | undefined {
    if (this.closed || this.processFailure !== undefined) return undefined
    if (this.child !== undefined) return this.child
    try {
      const child = spawn(this.processCommand.command, [...(this.processCommand.args ?? [])], {
        cwd: this.processCommand.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      })
      this.child = child
      this.lines = createInterface({ input: child.stdout })
      this.lines.on("line", (line) => this.receiveLine(line))
      child.stderr.on("data", () => undefined)
      child.once("error", (error) => {
        this.processFailure = describeError(error)
        this.child = undefined
        this.lines?.close()
        this.lines = undefined
        this.completePending(undefined)
      })
      child.once("exit", (code, signal) => {
        if (this.child !== child) return
        this.processFailure = `the WORTH host exited before completing the request (code=${code ?? "none"}, signal=${signal ?? "none"})`
        this.child = undefined
        this.lines?.close()
        this.lines = undefined
        this.completePending(undefined)
      })
      return child
    } catch (error) {
      this.processFailure = describeError(error)
      return undefined
    }
  }

  private send(
    request: HostRequest,
    context: OperationContext,
    timeoutMs: number,
  ): Promise<PendingResult> {
    const child = this.ensureProcess()
    if (child === undefined) return Promise.resolve(undefined)
    return new Promise<PendingResult>((resolve) => {
      let finished = false
      let unsubscribe: (() => void) | undefined
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish: PendingCompletion = (result) => {
        if (finished) return
        finished = true
        if (timer !== undefined) clearTimeout(timer)
        unsubscribe?.()
        this.pending.delete(request.request_id)
        resolve(result)
      }
      this.pending.set(request.request_id, finish)
      unsubscribe = context.cancellation.onCancellationRequested(() => finish("cancelled"))
      if (finished) return
      timer = setTimeout(() => finish("timed_out"), timeoutMs)
      if (finished) {
        clearTimeout(timer)
        return
      }
      try {
        child.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
          if (error !== null && error !== undefined) finish(undefined)
        })
      } catch {
        finish(undefined)
      }
    })
  }

  private receiveLine(line: string): void {
    const response = parseHostResponse(line)
    if (response === undefined) {
      this.processFailure = "the WORTH host emitted a malformed response"
      this.completePending(undefined)
      return
    }
    this.pending.get(response.request_id)?.(response)
  }

  private completePending(result: PendingResult): void {
    for (const complete of this.pending.values()) complete(result)
    this.pending.clear()
  }

  private mapResponse(applicationId: ApplicationId, response: HostResponse): WorthApplicationReadResult {
    switch (response.outcome) {
      case "found":
        if (response.application.id !== applicationId) {
          return this.unavailable(applicationId, "malformed_response", "the WORTH host returned a different application identity")
        }
        return {
          kind: "found",
          value: {
            projectionKind: "worth_application",
            id: response.application.id as ApplicationId,
            revision: response.application.revision,
            name: response.application.name,
            baseUrl: response.application.base_url,
          },
          evidence: {
            queryName: response.evidence.query_name,
            queryIdentity: response.evidence.query_identity,
            basisVersion: response.evidence.basis_version,
            projectedRecordCount: response.evidence.projected_record_count,
            projectedFieldCount: response.evidence.projected_field_count,
            basisReleased: response.evidence.basis_released,
          },
        }
      case "not_found":
        if (response.application_id !== applicationId) {
          return this.unavailable(applicationId, "malformed_response", "the WORTH host returned a different not-found identity")
        }
        return { kind: "not_found", entity: "application", entityId: applicationId }
      case "denied":
        if (response.application_id !== applicationId) {
          return this.unavailable(applicationId, "malformed_response", "the WORTH host returned a different denied identity")
        }
        return {
          kind: "denied",
          entity: "application",
          entityId: applicationId,
          stage: response.stage,
          denialKind: response.kind,
          message: response.message,
        }
      case "unavailable":
        if (response.operation !== INTERFACE_COMPILER_WORTH_READ_OPERATION) {
          return this.unavailable(applicationId, "malformed_response", "the WORTH host returned an unavailable operation that was not requested")
        }
        return this.unavailable(applicationId, response.reason, response.message)
      case "invalid_request":
        return this.denied(applicationId, "request", response.reason, response.message)
      default:
        return this.unavailable(applicationId, "malformed_response", "the WORTH host returned an outcome for a different operation")
    }
  }

  private mapStartExecutionResponse(executionId: ExecutionId, response: HostResponse): WorthStartExecutionResult {
    switch (response.outcome) {
      case "execution_transitioned":
        if (response.execution.execution_id !== executionId) return this.executionUnavailable(executionId, "malformed_response", "the WORTH host returned a different execution identity")
        return { kind: "transitioned", commit: response.commit, projection: { projectionKind: "worth_execution", executionId: response.execution.execution_id as ExecutionId, lifecycle: response.execution.lifecycle }, evidence: mapEvidence(response.evidence) }
      case "lifecycle_not_pending":
        if (response.execution_id !== executionId) return this.executionUnavailable(executionId, "malformed_response", "the WORTH host returned a different non-pending execution identity")
        return { kind: "lifecycle_not_pending", executionId, currentLifecycle: response.current_lifecycle }
      case "execution_denied":
        if (response.execution_id !== executionId) return this.executionUnavailable(executionId, "malformed_response", "the WORTH host returned a different denied execution identity")
        return this.executionDenied(executionId, response.stage, response.kind, response.message)
      case "unavailable":
        if (response.operation !== INTERFACE_COMPILER_WORTH_START_EXECUTION_OPERATION) return this.executionUnavailable(executionId, "malformed_response", "the WORTH host returned an unavailable operation that was not requested")
        return this.executionUnavailable(executionId, response.reason, response.message)
      case "invalid_request":
        return this.executionDenied(executionId, "request", response.reason, response.message)
      default:
        return this.executionUnavailable(executionId, "malformed_response", "the WORTH host returned an outcome for a different operation")
    }
  }

  private executionDenied(executionId: ExecutionId, stage: HostStartDenialStage, denialKind: string, message: string): WorthStartExecutionResult {
    return { kind: "denied", executionId, stage, denialKind, message }
  }

  private executionUnavailable(executionId: ExecutionId, reason: HostUnavailableReason | "transport_unavailable" | "malformed_response", message: string): WorthStartExecutionResult {
    return { kind: "unavailable", executionId, operation: INTERFACE_COMPILER_WORTH_START_EXECUTION_OPERATION, reason, message }
  }

  private executionInterrupted(kind: "cancelled" | "timed_out", context: OperationContext, posture: PartialEffectPosture): WorthStartExecutionResult {
    return { kind, operationId: context.operationId, posture }
  }

  private cancelled(context: OperationContext): Exclude<WorthApplicationReadResult, { readonly kind: "found" }> {
    return {
      kind: "cancelled",
      operationId: context.operationId,
      posture: unknownReadPosture(),
    }
  }

  private timedOut(context: OperationContext): Exclude<WorthApplicationReadResult, { readonly kind: "found" }> {
    return {
      kind: "timed_out",
      operationId: context.operationId,
      posture: unknownReadPosture(),
    }
  }

  private denied(applicationId: ApplicationId, stage: HostDenialStage, denialKind: string, message: string): WorthApplicationReadResult {
    return { kind: "denied", entity: "application", entityId: applicationId, stage, denialKind, message }
  }

  private unavailable(applicationId: ApplicationId, reason: "unsupported" | "not_configured" | "protocol_mismatch" | "transport_unavailable" | "malformed_response", message: string): WorthApplicationReadResult {
    return { kind: "unavailable", entity: "application", entityId: applicationId, operation: INTERFACE_COMPILER_WORTH_READ_OPERATION, reason, message }
  }
}

function unknownReadPosture(): PartialEffectPosture {
  return { kind: "unknown", recovery: "owner_reconciliation_required" }
}

function unknownMutationPosture(): PartialEffectPosture {
  return { kind: "unknown", recovery: "owner_reconciliation_required" }
}

function mapEvidence(evidence: HostEvidence): WorthExecutionQueryEvidence {
  return { queryName: evidence.query_name, queryIdentity: evidence.query_identity, basisVersion: evidence.basis_version, projectedRecordCount: evidence.projected_record_count, projectedFieldCount: evidence.projected_field_count, basisReleased: evidence.basis_released }
}

function closeChildProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.kill()
      resolve()
    }, 1_000)
    child.once("close", () => {
      clearTimeout(timeout)
      resolve()
    })
    child.stdin.end()
  })
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "the WORTH host process could not be started"
}
