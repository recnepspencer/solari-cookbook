import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createInterface, type Interface as ReadlineInterface } from "node:readline"
import type {
  ApplicationId,
  ApplicationProjection,
  OperationContext,
  PartialEffectPosture,
  WorthReadResult,
} from "@interface-compiler/domain"

export const INTERFACE_COMPILER_WORTH_PROTOCOL = "interface-compiler.worth-host.v1" as const
export const INTERFACE_COMPILER_WORTH_READ_OPERATION = "read_application" as const

export interface WorthQueryProcessCommand {
  readonly command: string
  readonly args?: readonly string[]
  readonly cwd?: string
}

export interface InterfaceCompilerWorthClientOptions {
  readonly process: WorthQueryProcessCommand
  readonly credential: string
}

export interface WorthApplicationReadEvidence {
  readonly queryName: string
  readonly queryIdentity: string
  readonly basisVersion: number
  readonly projectedRecordCount: number
  readonly projectedFieldCount: number
  readonly basisReleased: boolean
}

export type WorthApplicationReadResult =
  | {
      readonly kind: "found"
      readonly value: ApplicationProjection
      readonly evidence: WorthApplicationReadEvidence
    }
  | Exclude<WorthReadResult<ApplicationProjection>, { readonly kind: "found" }>
  | {
      readonly kind: "denied"
      readonly entity: "application"
      readonly entityId: ApplicationId
      readonly stage: HostDenialStage
      readonly denialKind: string
      readonly message: string
    }
  | {
      readonly kind: "unavailable"
      readonly entity: "application"
      readonly entityId: ApplicationId
      readonly operation: typeof INTERFACE_COMPILER_WORTH_READ_OPERATION
      readonly reason: "unsupported" | "not_configured" | "protocol_mismatch" | "transport_unavailable" | "malformed_response"
      readonly message: string
    }

export interface WorthApplicationReadAdapter {
  readApplication(applicationId: ApplicationId, context: OperationContext): Promise<WorthApplicationReadResult>
}

type HostDenialStage = "request" | "authentication" | "principal_resolution" | "entity_resolution" | "query" | "projection"

interface HostProjection {
  readonly projection_kind: "worth_application"
  readonly id: string
  readonly revision: number
  readonly name: string
  readonly base_url: string
}

interface HostEvidence {
  readonly query_name: string
  readonly query_identity: string
  readonly basis_version: number
  readonly projected_record_count: number
  readonly projected_field_count: number
  readonly basis_released: boolean
}

type HostResponse =
  | {
      readonly outcome: "found"
      readonly protocol: typeof INTERFACE_COMPILER_WORTH_PROTOCOL
      readonly request_id: string
      readonly operation: typeof INTERFACE_COMPILER_WORTH_READ_OPERATION
      readonly application: HostProjection
      readonly evidence: HostEvidence
    }
  | {
      readonly outcome: "not_found"
      readonly protocol: typeof INTERFACE_COMPILER_WORTH_PROTOCOL
      readonly request_id: string
      readonly operation: typeof INTERFACE_COMPILER_WORTH_READ_OPERATION
      readonly application_id: string
    }
  | {
      readonly outcome: "denied"
      readonly protocol: typeof INTERFACE_COMPILER_WORTH_PROTOCOL
      readonly request_id: string
      readonly operation: typeof INTERFACE_COMPILER_WORTH_READ_OPERATION
      readonly application_id: string
      readonly stage: HostDenialStage
      readonly kind: string
      readonly message: string
    }
  | {
      readonly outcome: "unavailable"
      readonly protocol: typeof INTERFACE_COMPILER_WORTH_PROTOCOL
      readonly request_id: string
      readonly operation: string
      readonly reason: "unsupported" | "not_configured" | "protocol_mismatch"
      readonly message: string
    }
  | {
      readonly outcome: "invalid_request"
      readonly protocol: typeof INTERFACE_COMPILER_WORTH_PROTOCOL
      readonly request_id: string
      readonly reason: string
      readonly message: string
    }

type PendingResult = HostResponse | "cancelled" | "timed_out" | undefined
type PendingCompletion = (result: PendingResult) => void

/**
 * Client for the app-specific WORTH host process.
 *
 * The client owns only process transport and request correlation. WORTH owns
 * the runtime, authentication proof, query admission, projection, currentness
 * and evidence. No WORTH handle, cache, reducer, or lifecycle authority is
 * retained here.
 */
export class InterfaceCompilerWorthClient implements WorthApplicationReadAdapter {
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

  public async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.lines?.close()
    this.lines = undefined
    this.completePending(undefined)
    const child = this.child
    this.child = undefined
    if (child !== undefined) child.kill()
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
    request: {
      readonly protocol: typeof INTERFACE_COMPILER_WORTH_PROTOCOL
      readonly request_id: string
      readonly operation: typeof INTERFACE_COMPILER_WORTH_READ_OPERATION
      readonly application_id: ApplicationId
      readonly credential: string
      readonly deadline_ms: number
    },
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
      timer = setTimeout(() => finish("timed_out"), timeoutMs)
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
    }
  }

  private cancelled(context: OperationContext): Exclude<WorthReadResult<ApplicationProjection>, { readonly kind: "found" }> {
    return {
      kind: "cancelled",
      operationId: context.operationId,
      posture: unknownReadPosture(),
    }
  }

  private timedOut(context: OperationContext): Exclude<WorthReadResult<ApplicationProjection>, { readonly kind: "found" }> {
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

export function createWorthApplicationReadAdapter(client: Pick<WorthApplicationReadAdapter, "readApplication">): WorthApplicationReadAdapter {
  if (client === null || typeof client !== "object" || typeof client.readApplication !== "function") {
    throw new TypeError("a WORTH application read client is required")
  }
  return Object.freeze({ readApplication: (applicationId: ApplicationId, context: OperationContext) => client.readApplication(applicationId, context) })
}

function parseHostResponse(line: string): HostResponse | undefined {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return undefined
  }
  if (!isRecord(value) || value.protocol !== INTERFACE_COMPILER_WORTH_PROTOCOL || !isNonEmptyText(value.request_id) || typeof value.outcome !== "string") return undefined
  if (value.outcome === "found" && value.operation === INTERFACE_COMPILER_WORTH_READ_OPERATION && isHostProjection(value.application) && isHostEvidence(value.evidence)) {
    return { outcome: "found", protocol: INTERFACE_COMPILER_WORTH_PROTOCOL, request_id: value.request_id, operation: INTERFACE_COMPILER_WORTH_READ_OPERATION, application: value.application, evidence: value.evidence }
  }
  if (value.outcome === "not_found" && value.operation === INTERFACE_COMPILER_WORTH_READ_OPERATION && isNonEmptyText(value.application_id)) {
    return { outcome: "not_found", protocol: INTERFACE_COMPILER_WORTH_PROTOCOL, request_id: value.request_id, operation: INTERFACE_COMPILER_WORTH_READ_OPERATION, application_id: value.application_id }
  }
  if (value.outcome === "denied" && value.operation === INTERFACE_COMPILER_WORTH_READ_OPERATION && isNonEmptyText(value.application_id) && isHostDenialStage(value.stage) && isNonEmptyText(value.kind) && typeof value.message === "string") {
    return { outcome: "denied", protocol: INTERFACE_COMPILER_WORTH_PROTOCOL, request_id: value.request_id, operation: INTERFACE_COMPILER_WORTH_READ_OPERATION, application_id: value.application_id, stage: value.stage, kind: value.kind, message: value.message }
  }
  if (value.outcome === "unavailable" && isNonEmptyText(value.operation) && isHostUnavailableReason(value.reason) && typeof value.message === "string") {
    return { outcome: "unavailable", protocol: INTERFACE_COMPILER_WORTH_PROTOCOL, request_id: value.request_id, operation: value.operation, reason: value.reason, message: value.message }
  }
  if (value.outcome === "invalid_request" && isNonEmptyText(value.reason) && typeof value.message === "string") {
    return { outcome: "invalid_request", protocol: INTERFACE_COMPILER_WORTH_PROTOCOL, request_id: value.request_id, reason: value.reason, message: value.message }
  }
  return undefined
}

function isHostProjection(value: unknown): value is HostProjection {
  if (!isRecord(value) || value.projection_kind !== "worth_application") return false
  return isNonEmptyText(value.id) && isRevision(value.revision) && typeof value.name === "string" && typeof value.base_url === "string"
}

function isHostEvidence(value: unknown): value is HostEvidence {
  if (!isRecord(value)) return false
  return isNonEmptyText(value.query_name) && isNonEmptyText(value.query_identity) && isRevision(value.basis_version) && isRevision(value.projected_record_count) && isRevision(value.projected_field_count) && typeof value.basis_released === "boolean"
}

function isHostDenialStage(value: unknown): value is HostDenialStage {
  return value === "request" || value === "authentication" || value === "principal_resolution" || value === "entity_resolution" || value === "query" || value === "projection"
}

function isHostUnavailableReason(value: unknown): value is "unsupported" | "not_configured" | "protocol_mismatch" {
  return value === "unsupported" || value === "not_configured" || value === "protocol_mismatch"
}

function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object"
}

function unknownReadPosture(): PartialEffectPosture {
  return { kind: "unknown", recovery: "owner_reconciliation_required" }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "the WORTH host process could not be started"
}
