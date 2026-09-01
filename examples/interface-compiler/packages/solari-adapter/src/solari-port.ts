import {
  validateApplication,
  validateOperationContext,
  type Application,
  type Clock,
  type IdSource,
  type OperationContext,
  type SolariPort,
  type SolariSessionLease,
  type SolariSessionRequest,
  type SolariSessionResult,
  type ValidationIssue,
} from "@interface-compiler/domain"
import { SolariBrowserSession } from "./browser-session.js"
import { readSolariConfig, type SolariAdapterConfig } from "./configuration.js"
import { createSessionResourceBudget, readClockMilliseconds, runSolariOperationWithinBoundary, type BoundedOperationResult } from "./resource-boundary.js"
import { asSolariBrowser, createDefaultSolariClient, type SolariClientFactory, type SolariSdkClient } from "./solari-sdk.js"
import { classifySolariFailure, discardTelemetry, failure, publishTelemetry, type SolariFailureCode, type SolariTelemetryOutcome, type TelemetrySink } from "./telemetry.js"

interface SolariPortAdapterOptions {
  readonly config: SolariAdapterConfig
  readonly clock: Clock
  readonly idSource: IdSource
  readonly clientFactory?: SolariClientFactory
  readonly telemetry?: TelemetrySink
}

class SolariPortAdapter implements SolariPort {
  private readonly config: SolariAdapterConfig
  private readonly clock: Clock
  private readonly idSource: IdSource
  private readonly clientFactory: SolariClientFactory
  private readonly telemetry: TelemetrySink

  constructor(options: SolariPortAdapterOptions) {
    this.config = options.config
    this.clock = options.clock
    this.idSource = options.idSource
    this.clientFactory = options.clientFactory ?? createDefaultSolariClient
    this.telemetry = options.telemetry ?? discardTelemetry
  }

  async createSession(request: SolariSessionRequest, context: OperationContext): Promise<SolariSessionResult> {
    const requestIssues = validateSessionRequest(request)
    if (requestIssues.length > 0) return this.finishCreation(context, { kind: "failed", message: failure("invalid_request", false).message, retryable: false, effect: { kind: "not_started" } }, "invalid_request")
    if (validateOperationContext(context).length > 0) return this.finishCreation(context, { kind: "failed", message: failure("invalid_context", false).message, retryable: false, effect: { kind: "not_started" } }, "invalid_context")
    if (request.freshness !== "fresh") return this.finishCreation(context, { kind: "failed", message: failure("freshness_unsupported", false).message, retryable: false, effect: { kind: "not_started" } }, "freshness_unsupported")

    const startedAtMs = readClockMilliseconds(this.clock)
    if (startedAtMs === undefined) return this.finishCreation(context, { kind: "failed", message: failure("clock_failure").message, retryable: true, effect: { kind: "not_started" } }, "clock_failure")
    const budget = createSessionResourceBudget(context, startedAtMs)
    const client = this.createClient()
    if (client.kind === "failed") return this.finishCreation(context, client.result, client.errorCode)

    let launchSettled = false
    let settleLaunchPromise: () => void = () => undefined
    const launchSettledPromise = new Promise<void>((resolve) => {
      settleLaunchPromise = resolve
    })
    const markLaunchSettled = (): void => {
      if (launchSettled) return
      launchSettled = true
      settleLaunchPromise()
    }
    const resourceRelease = createUnownedResourceRelease(client.value, launchSettledPromise)
    let cleanupFailureReported = false
    const cleanupWithReport = (browser: unknown): Promise<void> => resourceRelease.close(browser).catch(() => {
      if (cleanupFailureReported) return
      cleanupFailureReported = true
      this.emitCreationCleanupFailure(context)
    })

    let launchedBrowser: unknown
    let launchStarted = false
    const launchResult = await runSolariOperationWithinBoundary({
      context,
      budget,
      resource: "session_creation",
      effectful: true,
      nowMs: startedAtMs,
      readNowMs: () => readClockMilliseconds(this.clock),
      operation: async () => {
        launchStarted = true
        try {
          const value = await client.value.launch({ recording: true })
          launchedBrowser = value
          resourceRelease.setBrowser(value)
          return value
        } finally {
          markLaunchSettled()
        }
      },
      onBoundary: () => cleanupWithReport(undefined),
    })
    if (launchResult.kind !== "completed") {
      if (!launchStarted) markLaunchSettled()
      const cleanup = cleanupWithReport(launchedBrowser)
      if (launchSettled) await finishUnownedCleanup(cleanup)
      else void finishUnownedCleanup(cleanup)
      const result = sessionResultFromBoundary(launchResult)
      return this.finishCreation(context, result, boundaryFailureCode(launchResult))
    }
    launchedBrowser = launchResult.value
    const browser = asSolariBrowser(launchedBrowser)
    if (browser === undefined) {
      await finishUnownedCleanup(cleanupWithReport(launchedBrowser))
      return this.finishCreation(context, { kind: "failed", message: failure("sdk_contract", false).message, retryable: false, effect: { kind: "unknown", recovery: "owner_reconciliation_required" } }, "sdk_contract")
    }

    const session = new SolariBrowserSession({
      client: client.value,
      browser,
      applicationOrigin: new URL(request.application.baseUrl).origin,
      budget,
      clock: this.clock,
      idSource: this.idSource,
      telemetry: this.telemetry,
    })
    const lease: SolariSessionLease = { session, release: (releaseContext) => session.release(releaseContext) }
    return this.finishCreation(context, { kind: "created", lease, effect: { kind: "completed" } }, undefined)
  }

  private createClient(): { kind: "created"; value: SolariSdkClient } | { kind: "failed"; result: SolariSessionResult; errorCode: SolariFailureCode } {
    try {
      return { kind: "created", value: this.clientFactory(this.config) }
    } catch (error) {
      const classified = classifySolariFailure(error)
      return { kind: "failed", result: { kind: "failed", message: classified.message, retryable: classified.retryable, effect: { kind: "not_started" } }, errorCode: classified.code }
    }
  }

  private finishCreation(context: OperationContext, result: SolariSessionResult, errorCode?: SolariFailureCode): SolariSessionResult {
    const outcome: SolariTelemetryOutcome = result.kind === "created" ? "completed" : result.kind === "cancelled" ? "cancelled" : result.kind === "timed_out" ? "timed_out" : result.kind === "denied" && result.reason === "budget_exhausted" ? "budget_exhausted" : "failed"
    if (validateOperationContext(context).length === 0) {
      publishTelemetry(this.telemetry, {
        schema: "interface-compiler.solari-adapter.telemetry",
        version: 1,
        operation: "create_browser",
        outcome,
        operationId: context.operationId,
        ...(errorCode === undefined ? {} : { errorCode }),
      })
    }
    return result
  }

  private emitCreationCleanupFailure(context: OperationContext): void {
    if (validateOperationContext(context).length > 0) return
    publishTelemetry(this.telemetry, {
      schema: "interface-compiler.solari-adapter.telemetry",
      version: 1,
      operation: "create_browser",
      outcome: "failed",
      operationId: context.operationId,
      errorCode: "close_failed",
    })
  }
}

export interface SolariPortEnvironmentOptions {
  readonly clock: Clock
  readonly idSource: IdSource
  readonly env?: NodeJS.ProcessEnv
  readonly clientFactory?: SolariClientFactory
  readonly telemetry?: TelemetrySink
}

export type SolariPortCreationResult =
  | { readonly kind: "configured"; readonly port: SolariPort }
  | { readonly kind: "invalid_config"; readonly issues: readonly ValidationIssue[] }

export function createSolariPortFromEnv(options: SolariPortEnvironmentOptions): SolariPortCreationResult {
  const config = readSolariConfig(options.env)
  if (!config.ok) return { kind: "invalid_config", issues: config.issues }
  return {
    kind: "configured",
    port: new SolariPortAdapter({
      config: config.value,
      clock: options.clock,
      idSource: options.idSource,
      ...(options.clientFactory === undefined ? {} : { clientFactory: options.clientFactory }),
      ...(options.telemetry === undefined ? {} : { telemetry: options.telemetry }),
    }),
  }
}

function createUnownedResourceRelease(client: SolariSdkClient, launchSettled: Promise<void>): {
  close(browser: unknown): Promise<void>
  setBrowser(browser: unknown): void
} {
  let browserCandidate: unknown
  let finalizationPromise: Promise<void> | undefined
  let browserClosePromise: Promise<void> | undefined
  let clientClosePromise: Promise<void> | undefined
  return {
    setBrowser: (browser) => {
      browserCandidate = browser
    },
    close: (browser) => {
      if (browser !== undefined) browserCandidate = browser
      if (finalizationPromise === undefined) {
        finalizationPromise = finalizeUnownedResources()
      }
      return finalizationPromise
    },
  }

  async function finalizeUnownedResources(): Promise<void> {
    await launchSettled
    let browserError: unknown
    try {
      if (browserClosePromise === undefined && isClosable(browserCandidate)) browserClosePromise = invokeClose(browserCandidate)
      if (browserClosePromise !== undefined) await browserClosePromise
    } catch (error) {
      browserError = error
    }
    let clientError: unknown
    try {
      if (clientClosePromise === undefined) clientClosePromise = invokeClose(client)
      await clientClosePromise
    } catch (error) {
      clientError = error
    }
    if (browserError !== undefined) throw browserError
    if (clientError !== undefined) throw clientError
  }
}

async function finishUnownedCleanup(cleanup: Promise<void>): Promise<void> {
  try {
    await cleanup
  } catch {
    // Creation still returns a typed outcome; the cleanup attempt is not retried.
  }
}

function isClosable(value: unknown): value is { close(): Promise<void> } {
  return value !== null && typeof value === "object" && typeof (value as { close?: unknown }).close === "function"
}

function invokeClose(resource: { close(): Promise<void> }): Promise<void> {
  try {
    return Promise.resolve(resource.close())
  } catch (error) {
    return Promise.reject(error)
  }
}

function validateSessionRequest(request: SolariSessionRequest): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!request || typeof request !== "object") return [{ path: "request", message: "Solari session request must be an object" }]
  issues.push(...validateApplication(request.application as Application))
  if (!isPurpose(request.purpose)) issues.push({ path: "purpose", message: "Solari session purpose is not recognized" })
  if (request.freshness !== "fresh" && request.freshness !== "reused") issues.push({ path: "freshness", message: "Solari session freshness is not recognized" })
  if (request.executionId !== undefined && (typeof request.executionId !== "string" || request.executionId.trim() === "")) issues.push({ path: "executionId", message: "execution id must not be empty" })
  return issues
}

function isPurpose(value: unknown): value is SolariSessionRequest["purpose"] {
  return value === "direct" || value === "exploration" || value === "verification" || value === "replay"
}

function sessionResultFromBoundary(result: Exclude<BoundedOperationResult<unknown>, { readonly kind: "completed" }>): SolariSessionResult {
  if (result.kind === "cancelled") return { kind: "cancelled", effect: result.effect }
  if (result.kind === "timed_out") return { kind: "timed_out", effect: result.effect }
  if (result.kind === "denied") return result.reason === "budget_exhausted" ? { kind: "denied", reason: "budget_exhausted", effect: { kind: "not_started" } } : { kind: "failed", message: failure("invalid_context", false).message, retryable: false, effect: { kind: "not_started" } }
  if (result.kind === "failed") {
    const classified = classifySolariFailure(result.error)
    return { kind: "failed", message: classified.message, retryable: classified.retryable, effect: result.effect }
  }
  return { kind: "failed", message: failure("sdk_failure").message, retryable: true, effect: { kind: "unknown", recovery: "owner_reconciliation_required" } }
}

function boundaryFailureCode(result: Exclude<BoundedOperationResult<unknown>, { readonly kind: "completed" }>): SolariFailureCode | undefined {
  if (result.kind === "cancelled") return "cancelled"
  if (result.kind === "timed_out") return "deadline_exceeded"
  if (result.kind === "denied") return result.reason === "budget_exhausted" ? "budget_exhausted" : result.reason === "invalid_context" ? "invalid_context" : "sdk_failure"
  return classifySolariFailure(result.error).code
}
