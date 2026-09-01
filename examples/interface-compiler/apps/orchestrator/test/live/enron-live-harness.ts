import { existsSync } from "node:fs"
import { resolve } from "node:path"
import {
  createApplication,
  type Application,
  type Clock,
  type IdSource,
  type OperationContext,
  type OperationId,
  type SolariPort,
} from "@interface-compiler/domain"
import { createSolariPortFromEnv } from "@interface-compiler/solari-adapter"
import { InterfaceCompilerWorthClient } from "@interface-compiler/worth-adapter"
import { createOperationController, type OperationController, type SemanticVerificationRequest, type SemanticVerificationResult, type SemanticVerifier } from "../../src/index.js"
import { ENRON_ONLINE_APPLICATION_ID, ENRON_ONLINE_BASE_URL } from "../../src/enron-online/contracts.js"

const DEFAULT_TIMEOUT_MS = "30000"
const DEMO_CREDENTIAL = "interface-compiler-demo"

export interface EnronLiveHarness {
  readonly application: Application
  readonly clock: Clock
  readonly ids: IdSource
  readonly solari: SolariPort
  readonly verifier: SemanticVerifier
  readonly worth: InterfaceCompilerWorthClient
  context(label: string, budget?: { readonly maxModelCalls?: number; readonly maxBrowserActions?: number }): OperationContext
  controller(label: string, budget?: { readonly maxModelCalls?: number; readonly maxBrowserActions?: number }): OperationController
  resetPortal(): Promise<void>
  close(): Promise<void>
}

/** Loads only the demo's checked-in environment location; callers may override it with process environment. */
export function loadEnronLiveEnvironment(repositoryRoot = process.cwd()): void {
  for (const envFile of [resolve(repositoryRoot, ".env"), resolve(repositoryRoot, "../../.env")]) {
    if (existsSync(envFile)) process.loadEnvFile(envFile)
  }
  process.env.SOLARI_TIMEOUT_MS ??= DEFAULT_TIMEOUT_MS
  process.env.GEMINI_MODEL ??= "gemini-3.7-flash"
}

export function createEnronLiveHarness(repositoryRoot = process.cwd()): EnronLiveHarness {
  loadEnronLiveEnvironment(repositoryRoot)
  const clock: Clock = { now: () => new Date().toISOString() }
  const ids = createLiveIds()
  const applicationResult = createApplication({ id: ENRON_ONLINE_APPLICATION_ID, name: "Enron Online", baseUrl: ENRON_ONLINE_BASE_URL })
  if (!applicationResult.ok) throw new Error("unable to construct the Enron Online demo application")
  const configuredSolari = createSolariPortFromEnv({ clock, idSource: ids })
  if (configuredSolari.kind !== "configured") throw new Error(`Solari configuration is unavailable: ${configuredSolari.kind}`)
  const worth = new InterfaceCompilerWorthClient({
    process: hostCommand(repositoryRoot),
    credential: process.env.WORTH_DEMO_CREDENTIAL?.trim() || DEMO_CREDENTIAL,
  })
  let operationNumber = 0

  const context = (label: string, budget: { readonly maxModelCalls?: number; readonly maxBrowserActions?: number } = {}): OperationContext => {
    operationNumber += 1
    return Object.freeze({
      operationId: `operation.live.${label}.${operationNumber}` as OperationId,
      deadlineAt: new Date(Date.now() + 315_000).toISOString(),
      cancellation: { isCancellationRequested: () => false, onCancellationRequested: () => () => undefined },
      budget: Object.freeze({
        maxWallClockMs: 300_000,
        maxModelCalls: budget.maxModelCalls ?? 40,
        maxBrowserActions: budget.maxBrowserActions ?? 100,
      }),
      admission: Object.freeze({ maxInFlight: 1, maxQueued: 0, overflow: "reject" as const }),
    })
  }
  const controller = (label: string, budget?: { readonly maxModelCalls?: number; readonly maxBrowserActions?: number }) => {
    const result = createOperationController({ admittedContext: context(label, budget), clock })
    if (!result.ok) throw new Error(`invalid live operation context for ${label}`)
    return result.value
  }
  const resetPortal = async (): Promise<void> => {
    const response = await fetch(`${applicationResult.value.baseUrl}/api/reset`, { method: "POST" })
    if (!response.ok) throw new Error(`could not reset the in-memory Enron portal (${response.status})`)
  }
  return Object.freeze({ application: applicationResult.value, clock, ids, solari: configuredSolari.port, verifier: semanticVerifier(), worth, context, controller, resetPortal, close: () => worth.close() })
}

function hostCommand(repositoryRoot: string): { readonly command: string; readonly args: readonly string[]; readonly cwd: string } {
  const configuredCommand = process.env.WORTH_RUNTIME_HOST_COMMAND?.trim()
  if (configuredCommand) return { command: configuredCommand, args: ["--serve"], cwd: repositoryRoot }
  const command = resolve(repositoryRoot, "worth-runtime-host/target/debug", `worth-runtime-host${process.platform === "win32" ? ".exe" : ""}`)
  if (!existsSync(command)) throw new Error("WORTH demo host is not built; run cargo build --manifest-path worth-runtime-host/Cargo.toml")
  return { command, args: ["--serve"], cwd: repositoryRoot }
}

function createLiveIds(): IdSource {
  let sequence = 0
  const next = (kind: string) => `${kind}.live.${++sequence}` as never
  return Object.freeze({
    nextApplicationId: () => next("application"),
    nextCapabilityId: () => next("capability"),
    nextReplayVersionId: () => next("replay"),
    nextExperimentId: () => next("experiment"),
    nextEvidenceId: () => next("evidence"),
    nextExecutionId: () => next("execution"),
    nextEventId: () => next("event"),
    nextSessionId: () => next("session"),
    nextObservationId: () => next("observation"),
    nextVerificationRunId: () => next("verification"),
    nextOperationId: () => next("operation"),
  })
}

function semanticVerifier(): SemanticVerifier {
  return Object.freeze({
    async verify(request: SemanticVerificationRequest): Promise<SemanticVerificationResult> {
      const condition = request.conditions[0]
      if (condition === undefined) throw new Error("live semantic verification requires a postcondition")
      if (condition.kind !== "text_present") return { kind: "failed", condition, message: `live harness does not support ${condition.kind} verification`, retryable: false, evidenceIds: [], effect: { kind: "completed" } }
      const observedText = request.observation === undefined
        ? ""
        : [request.observation.pageSummary, ...request.observation.interactables.flatMap((item) => [item.text, item.name])].filter((value): value is string => typeof value === "string").join("\n")
      return observedText.includes(condition.text)
        ? { kind: "verified", effect: { kind: "completed" } }
        : { kind: "failed", condition, message: `visible business postcondition was not present: ${condition.text}`, retryable: false, evidenceIds: [], effect: { kind: "completed" } }
    },
  })
}
