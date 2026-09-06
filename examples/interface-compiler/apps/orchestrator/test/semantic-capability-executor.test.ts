import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { resolve } from "node:path"
import test from "node:test"
import { promisify } from "node:util"
import type {
  ApplicationId,
  EvidenceCaptureRequest,
  EvidenceId,
  EventId,
  ExecutionId,
  ExperimentId,
  IdSource,
  Observation,
  ObservationId,
  OperationContext,
  OperationId,
  ReasoningModel,
  ReplayStep,
  ReplayVersionId,
  SessionId,
  SolariPort,
  SolariSession,
  VerificationRunId,
} from "@interface-compiler/domain"
import { InterfaceCompilerWorthClient } from "@interface-compiler/worth-adapter"
import { createEnronTradeCapabilities } from "../src/enron-online/capability.js"
import { INGEST_INCOMING_TRADE_CAPABILITY_ID, INCOMING_TRADE_MESSAGE_ID } from "../src/enron-online/contracts.js"
import { createEnronOutcomeVerifier } from "../src/enron-online/outcome-verifier.js"
import { SemanticCapabilityExecutor } from "../src/semantic-capability-executor.js"
import type { OrchestratorWorthPort } from "../src/worth-ports.js"

const root = resolve(import.meta.dirname, "../../..")
const manifest = resolve(root, "worth-runtime-host/Cargo.toml")
const binary = resolve(root, "worth-runtime-host/target/debug", `worth-runtime-host${process.platform === "win32" ? ".exe" : ""}`)
const runFile = promisify(execFile)

test.before(async () => { await runFile("cargo", ["build", "--manifest-path", manifest], { cwd: root }) })

test("the published semantic call drives WORTH-selected Solari replay, recovery, and the next identical call", async (testContext) => {
  const worth = new InterfaceCompilerWorthClient({ process: { command: binary, args: ["--serve"], cwd: root }, credential: "interface-compiler-demo" })
  testContext.after(() => worth.close())
  const clock = new AdvancingClock()
  const ids = new TestIds()
  const solari = new RecoverySolari(clock)
  const executor = new SemanticCapabilityExecutor({
    clock,
    ids,
    worth,
    solari,
    discoveryModel: new DiscoveryModel(),
    verifier: createEnronOutcomeVerifier(),
    verificationEnvironment: { prepareFreshRun: async () => { solari.preparedVerificationWorlds += 1; return { kind: "ready" } } },
  })
  const trades = createEnronTradeCapabilities(executor)
  const input = { messageId: INCOMING_TRADE_MESSAGE_ID }

  const interrupted = await trades.ingestIncomingTrade(input, context("interrupted"))
  assert.equal(interrupted.kind, "interrupted")
  if (interrupted.kind !== "interrupted") throw new Error(`expected typed interruption: ${JSON.stringify(interrupted)}`)
  assert.equal(interrupted.reason, "timed_out")

  const wrongRequest = await trades.ingestIncomingTrade({ messageId: "msg.enron-mailroom.other" }, context("wrong-request"))
  assert.equal(wrongRequest.kind, "unavailable")
  if (wrongRequest.kind !== "unavailable") throw new Error("expected request-bound recovery rejection")
  assert.match(wrongRequest.message, /different semantic request/)

  const rediscoveryInterrupted = await trades.ingestIncomingTrade(input, context("resume-verification"))
  assert.equal(rediscoveryInterrupted.kind, "interrupted")
  if (rediscoveryInterrupted.kind !== "interrupted") throw new Error(`expected rediscovery interruption: ${JSON.stringify(rediscoveryInterrupted)}`)
  assert.equal(rediscoveryInterrupted.reason, "timed_out")

  const first = await trades.ingestIncomingTrade(input, context("resume-degraded"))
  if (first.kind !== "recovered") throw new Error(`expected resumed recovery: ${JSON.stringify(first)}`)
  assert.notEqual(first.activeReplayVersionId, first.failedReplayVersionId)
  assert.equal(solari.preparedVerificationWorlds, 5)
  const active = await worth.readActiveReplay(INGEST_INCOMING_TRADE_CAPABILITY_ID, context("read-active"))
  assert.equal(active.kind, "found")
  if (active.kind !== "found") throw new Error("expected active replacement")
  assert.equal(active.value.id, first.activeReplayVersionId)
  assert.equal(active.value.verification.runs.length, 3)
  assert.equal(new Set(active.value.verification.runs.map((run) => run.sessionId)).size, 3)
  assert.equal(new Set(active.value.verification.runs.flatMap((run) => run.evidenceIds)).size, 3)

  const second = await trades.ingestIncomingTrade(input, context("second", 0))
  assert.equal(second.kind, "succeeded")
  if (second.kind !== "succeeded") throw new Error("expected active replay success")
  assert.equal(second.output.status, "posted")
  assert.equal(second.replayVersionId, first.activeReplayVersionId)

  const third = await trades.ingestIncomingTrade(input, context("third", 0))
  assert.equal(third.kind, "succeeded")
  if (third.kind !== "succeeded") throw new Error("expected idempotent replay success")
  assert.equal(third.output.status, "duplicate")
  assert.equal(third.output.financialReceiptId, second.output.financialReceiptId)
  assert.equal(solari.discoverySessions, 3)
})

test("a Solari timeout during Gemini discovery reaches the semantic caller as a typed interruption", async (testContext) => {
  const worth = new InterfaceCompilerWorthClient({ process: { command: binary, args: ["--serve"], cwd: root }, credential: "interface-compiler-demo" })
  testContext.after(() => worth.close())
  const clock = new AdvancingClock()
  const executor = new SemanticCapabilityExecutor({
    clock,
    ids: new TestIds(),
    worth,
    solari: new DiscoveryTimeoutSolari(clock),
    discoveryModel: new DiscoveryModel(),
    verifier: createEnronOutcomeVerifier(),
    verificationEnvironment: { prepareFreshRun: async () => ({ kind: "ready" }) },
  })

  const result = await createEnronTradeCapabilities(executor).ingestIncomingTrade({ messageId: INCOMING_TRADE_MESSAGE_ID }, context("discovery-timeout"))
  assert.deepEqual(result.kind === "interrupted" ? { kind: result.kind, reason: result.reason, retryable: result.retryable } : result, { kind: "interrupted", reason: "timed_out", retryable: true })
})

test("WORTH read cancellation and timeout reach the semantic caller as typed interruptions", async (testContext) => {
  const worth = new InterfaceCompilerWorthClient({ process: { command: binary, args: ["--serve"], cwd: root }, credential: "interface-compiler-demo" })
  testContext.after(() => worth.close())
  const clock = new AdvancingClock()
  const executor = new SemanticCapabilityExecutor({
    clock,
    ids: new TestIds(),
    worth,
    solari: new DiscoveryTimeoutSolari(clock),
    discoveryModel: new DiscoveryModel(),
    verifier: createEnronOutcomeVerifier(),
    verificationEnvironment: { prepareFreshRun: async () => ({ kind: "ready" }) },
  })
  const input = { messageId: INCOMING_TRADE_MESSAGE_ID }
  const cancelledContext = context("worth-cancelled")
  const cancelled = await executor.execute(INGEST_INCOMING_TRADE_CAPABILITY_ID, input, { ...cancelledContext, cancellation: { isCancellationRequested: () => true, onCancellationRequested: () => () => undefined } })
  assert.deepEqual(cancelled.kind === "interrupted" ? { kind: cancelled.kind, reason: cancelled.reason } : cancelled, { kind: "interrupted", reason: "cancelled" })

  const timedContext = context("worth-timed-out")
  const timedOut = await executor.execute(INGEST_INCOMING_TRADE_CAPABILITY_ID, input, { ...timedContext, deadlineAt: new Date(Date.now() - 1_000).toISOString() })
  assert.deepEqual(timedOut.kind === "interrupted" ? { kind: timedOut.kind, reason: timedOut.reason } : timedOut, { kind: "interrupted", reason: "timed_out" })
})

for (const mutation of ["degradeReplay", "activateReplacement", "acceptReplacementCandidate"] as const) test(`an ambiguously reported ${mutation} reconciles through WORTH without repeating the business effect`, async (testContext) => {
  const client = new InterfaceCompilerWorthClient({ process: { command: binary, args: ["--serve"], cwd: root }, credential: "interface-compiler-demo" })
  testContext.after(() => client.close())
  const clock = new AdvancingClock()
  const solari = new RecoverySolari(clock, false)
  const worth = interceptOnce(client, mutation, async (invoke) => {
    const committed = await invoke()
    if (committed.kind !== "applied") return committed
    return { kind: "committed_projection_unavailable" as const, commit: "committed" as const, message: `${mutation} committed but its response was lost` }
  })
  const executor = new SemanticCapabilityExecutor({
    clock,
    ids: new TestIds(),
    worth,
    solari,
    discoveryModel: new DiscoveryModel(),
    verifier: createEnronOutcomeVerifier(),
    verificationEnvironment: { prepareFreshRun: async () => ({ kind: "ready" }) },
  })
  const trades = createEnronTradeCapabilities(executor)
  const input = { messageId: INCOMING_TRADE_MESSAGE_ID }

  const ambiguous = await trades.ingestIncomingTrade(input, context("ambiguous-activation"))
  assert.equal(ambiguous.kind, "reconciliation_required")
  assert.equal(solari.replayCalls, 1)

  const reconciled = await trades.ingestIncomingTrade(input, context("reconcile-activation"))
  assert.equal(reconciled.kind, "recovered")
  assert.equal(solari.replayCalls, 1, "reconciliation must not repeat the stale or repaired business replay")

  const executed = await trades.ingestIncomingTrade(input, context("after-reconciliation", 0))
  assert.equal(executed.kind, "succeeded")
  assert.equal(solari.replayCalls, 2)
})

test("a cancelled recovery mutation remains a typed interruption", async (testContext) => {
  const client = new InterfaceCompilerWorthClient({ process: { command: binary, args: ["--serve"], cwd: root }, credential: "interface-compiler-demo" })
  testContext.after(() => client.close())
  const clock = new AdvancingClock()
  const worth = interceptOnce(client, "acceptReplacementCandidate", async () => ({ kind: "cancelled" as const, operationId: "operation.cancelled-candidate" as OperationId, posture: { kind: "not_started" as const } }))
  const executor = new SemanticCapabilityExecutor({
    clock,
    ids: new TestIds(),
    worth,
    solari: new RecoverySolari(clock, false),
    discoveryModel: new DiscoveryModel(),
    verifier: createEnronOutcomeVerifier(),
    verificationEnvironment: { prepareFreshRun: async () => ({ kind: "ready" }) },
  })

  const result = await createEnronTradeCapabilities(executor).ingestIncomingTrade({ messageId: INCOMING_TRADE_MESSAGE_ID }, context("cancelled-candidate"))

  assert.deepEqual(result.kind === "interrupted" ? { kind: result.kind, reason: result.reason, retryable: result.retryable } : result, { kind: "interrupted", reason: "cancelled", retryable: true })
})

test("a terminal event failure cannot strand WORTH's committed degradation", async (testContext) => {
  const client = new InterfaceCompilerWorthClient({ process: { command: binary, args: ["--serve"], cwd: root }, credential: "interface-compiler-demo" })
  testContext.after(() => client.close())
  let lostEvent = false
  const worth = new Proxy(client, {
    get(target, property) {
      if (property === "publish") return async (...args: Parameters<OrchestratorWorthPort["publish"]>) => {
        if (args[0].type === "replay.failed" && !lostEvent) {
          lostEvent = true
          return { kind: "failed", eventId: args[0].eventId, message: "terminal publication unavailable", retryable: true, effect: { kind: "unknown", recovery: "owner_reconciliation_required" } }
        }
        return target.publish(...args)
      }
      const value = Reflect.get(target, property)
      return typeof value === "function" ? value.bind(target) : value
    },
  }) as OrchestratorWorthPort
  const clock = new AdvancingClock()
  const solari = new RecoverySolari(clock, false)
  const executor = new SemanticCapabilityExecutor({ clock, ids: new TestIds(), worth, solari, discoveryModel: new DiscoveryModel(), verifier: createEnronOutcomeVerifier(), verificationEnvironment: { prepareFreshRun: async () => ({ kind: "ready" }) } })
  const trades = createEnronTradeCapabilities(executor)
  const input = { messageId: INCOMING_TRADE_MESSAGE_ID }
  const recovered = await trades.ingestIncomingTrade(input, context("lost-terminal-event"))
  assert.equal(lostEvent, true)
  assert.equal(recovered.kind, "recovered", JSON.stringify(recovered))
  assert.equal(solari.replayCalls, 1)
  assert.equal((await trades.ingestIncomingTrade(input, context("after-lost-event", 0))).kind, "succeeded")
  assert.equal(solari.replayCalls, 2)
})

for (const boundary of ["admission", "browser"] as const) {
  for (const reason of ["cancelled", "timed_out"] as const) {
    for (const posture of [{ kind: "not_started" }, { kind: "completed" }, { kind: "unknown", recovery: "owner_reconciliation_required" }] as const) {
      test(`${boundary} ${reason} preserves ${posture.kind} effect posture at the public capability`, async (testContext) => {
        const client = new InterfaceCompilerWorthClient({ process: { command: binary, args: ["--serve"], cwd: root }, credential: "interface-compiler-demo" })
        testContext.after(() => client.close())
        const worth = boundary === "admission" ? interceptOnce(client, "admitExecution", async () => ({ kind: reason, operationId: "operation.interrupted" as OperationId, posture })) : client
        let sessions = 0
        const clock = new AdvancingClock()
        const solari: SolariPort = { createSession: async () => {
          sessions += 1
          const session = new ScriptedSession("solari.session.interrupted", clock, "posted", false)
          session.executeStep = async () => reason === "cancelled" ? { kind: reason, safePoint: posture.kind === "not_started" ? "before_step" : "after_step", effect: posture } : { kind: reason, effect: posture }
          return created(session)
        } }
        const executor = new SemanticCapabilityExecutor({ clock, ids: new TestIds(), worth, solari, discoveryModel: new DiscoveryModel(), verifier: createEnronOutcomeVerifier(), verificationEnvironment: { prepareFreshRun: async () => ({ kind: "ready" }) } })
        const result = await createEnronTradeCapabilities(executor).ingestIncomingTrade({ messageId: INCOMING_TRADE_MESSAGE_ID }, context("interrupted-effect"))
        assert.equal(result.kind, posture.kind === "not_started" ? "interrupted" : "reconciliation_required", JSON.stringify(result))
        assert.ok(result.kind === "interrupted" || result.kind === "reconciliation_required")
        assert.deepEqual(result.posture, posture)
        assert.equal(sessions, boundary === "admission" ? 0 : 1)
        const capability = await client.readCapability(INGEST_INCOMING_TRADE_CAPABILITY_ID, context("still-healthy"))
        assert.equal(capability.kind, "found")
        if (capability.kind === "found") assert.equal(capability.value.status, "healthy")
      })
    }
  }
}

class RecoverySolari implements SolariPort {
  preparedVerificationWorlds = 0
  discoverySessions = 0
  replayCalls = 0
  private verificationCalls = 0
  private verificationCreationAttempts = 0
  constructor(private readonly clock: AdvancingClock, private readonly interruptRecovery = true) {}

  async createSession(request: Parameters<SolariPort["createSession"]>[0]) {
    if (request.purpose === "direct") {
      this.discoverySessions += 1
      if (this.interruptRecovery && this.discoverySessions === 2) return { kind: "timed_out" as const, effect: { kind: "not_started" as const } }
      return created(new ScriptedSession("solari.session.discovery", this.clock, "posted", false))
    }
    if (request.purpose === "verification") {
      this.verificationCreationAttempts += 1
      if (this.interruptRecovery && this.verificationCreationAttempts === 1) return { kind: "timed_out" as const, effect: { kind: "not_started" as const } }
      this.verificationCalls += 1
      return created(new ScriptedSession(`solari.session.verification.${this.verificationCalls}`, this.clock, "posted", this.interruptRecovery && this.verificationCalls === 1))
    }
    this.replayCalls += 1
    return this.replayCalls === 1
      ? created(new ScriptedSession("solari.session.stale-v1", this.clock, "posted", true))
      : created(new ScriptedSession(`solari.session.active.${this.replayCalls}`, this.clock, this.replayCalls === 2 ? "posted" : "duplicate", false))
  }
}

class DiscoveryTimeoutSolari implements SolariPort {
  constructor(private readonly clock: AdvancingClock) {}
  async createSession(request: Parameters<SolariPort["createSession"]>[0]): Promise<Awaited<ReturnType<SolariPort["createSession"]>>> {
    if (request.purpose === "direct") return { kind: "timed_out", effect: { kind: "not_started" } }
    return created(new ScriptedSession("solari.session.discovery-timeout.stale", this.clock, "posted", true))
  }
}

class ScriptedSession implements SolariSession {
  readonly sessionId: SessionId
  constructor(id: string, private readonly clock: AdvancingClock, private readonly status: "posted" | "duplicate", private readonly failStaleClick: boolean) { this.sessionId = id as SessionId }
  async observe(): Promise<Awaited<ReturnType<SolariSession["observe"]>>> { return { kind: "observed", observation: receiptObservation(this.sessionId, this.status, this.clock.now()), effect: { kind: "completed" } } }
  async executeStep(step: ReplayStep, _context: OperationContext, stepIndex = 0): Promise<Awaited<ReturnType<SolariSession["executeStep"]>>> {
    if (this.failStaleClick && step.type === "click") return { kind: "failed", failure: { kind: "step_failed", stepIndex, message: "the stale Open attachment control disappeared", evidenceIds: ["evidence.stale-control" as EvidenceId] }, effect: { kind: "not_started" } }
    return { kind: "completed", observation: receiptObservation(this.sessionId, this.status, this.clock.now()), effect: { kind: "completed" } }
  }
  async captureEvidence(_request: EvidenceCaptureRequest): Promise<Awaited<ReturnType<SolariSession["captureEvidence"]>>> {
    const evidenceId = `evidence.${this.sessionId}` as EvidenceId
    return { kind: "captured", reference: { evidenceId, kind: "session_receipt", externalRef: `solari-session:${this.sessionId}` }, effect: { kind: "completed" } }
  }
}

class DiscoveryModel implements ReasoningModel {
  private call = 0
  async structuredComplete<TInput, TOutput>(input: TInput, _schema: import("@interface-compiler/domain").Schema<TOutput>, _context: OperationContext): Promise<import("@interface-compiler/domain").ReasoningResult<TOutput>> {
    void input
    this.call += 1
    const output = this.call % 2 === 1
      ? { kind: "act", step: { type: "click", target: { semanticDescription: "post delivered trade to Financials", role: "button", name: "Review CSV & post to Financials" } } }
      : { kind: "complete", output: receipt("posted") }
    return { kind: "completed", completion: { output: output as TOutput, usage: { inputTokens: 10, outputTokens: 5, estimatedModelCostMicrocents: 1 } }, effect: { kind: "completed" } }
  }
}

class AdvancingClock {
  private value = Date.now()
  now(): string { this.value += 10; return new Date(this.value).toISOString() }
}

class TestIds implements IdSource {
  private value = 0
  private next(prefix: string): never { this.value += 1; return `${prefix}.joined.${this.value}` as never }
  nextApplicationId(): ApplicationId { return this.next("application") }
  nextCapabilityId() { return this.next("capability") }
  nextReplayVersionId(): ReplayVersionId { return this.next("replay") }
  nextExperimentId(): ExperimentId { return this.next("experiment") }
  nextEvidenceId(): EvidenceId { return this.next("evidence") }
  nextExecutionId(): ExecutionId { return this.next("execution") }
  nextEventId(): EventId { return this.next("event") }
  nextSessionId(): SessionId { return this.next("session") }
  nextObservationId(): ObservationId { return this.next("observation") }
  nextVerificationRunId(): VerificationRunId { return this.next("verification") }
  nextOperationId(): OperationId { return this.next("operation") }
}

function created(session: ScriptedSession) {
  return { kind: "created" as const, lease: { session, release: async () => ({ kind: "closed" as const, sessionId: session.sessionId, effect: { kind: "completed" as const } }) }, effect: { kind: "completed" as const } }
}

function receipt(status: "posted" | "duplicate") {
  return { status, tradeId: "FT-1042", financialReceiptId: "FIN-1042", sourceMessageId: INCOMING_TRADE_MESSAGE_ID, idempotencyKey: `${INCOMING_TRADE_MESSAGE_ID}:abc123` }
}

function receiptObservation(sessionId: SessionId, status: "posted" | "duplicate", observedAt: string): Observation {
  const result = receipt(status)
  return {
    id: `observation.${sessionId}.${observedAt}` as ObservationId,
    sessionId,
    url: "http://127.0.0.1:4310/?page=mail",
    pageSummary: "EMAIL RECEIVED",
    interactables: [{ kind: "other", role: "status", text: `${status === "posted" ? "POSTED" : "DUPLICATE"} ${result.tradeId} / verified Financials receipt ${result.financialReceiptId} / source ${result.sourceMessageId} / idempotency ${result.idempotencyKey}` }],
    observedAt: observedAt as never,
  }
}

function context(label: string, maxModelCalls = 8): OperationContext {
  return {
    operationId: `operation.joined.${label}` as OperationId,
    deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    cancellation: { isCancellationRequested: () => false, onCancellationRequested: () => () => undefined },
    budget: { maxWallClockMs: 55_000, maxModelCalls, maxBrowserActions: 40 },
    admission: { maxInFlight: 1, maxQueued: 0, overflow: "reject" },
  }
}

function interceptOnce<K extends "degradeReplay" | "activateReplacement" | "acceptReplacementCandidate" | "admitExecution">(
  client: InterfaceCompilerWorthClient,
  method: K,
  intercept: (invoke: () => Promise<Awaited<ReturnType<OrchestratorWorthPort[K]>>>) => Promise<Awaited<ReturnType<OrchestratorWorthPort[K]>>>,
): OrchestratorWorthPort {
  let pending = true
  return new Proxy(client, {
    get(target, property) {
      const value = Reflect.get(target, property)
      if (property === method && pending) {
        return (...args: Parameters<OrchestratorWorthPort[K]>) => {
          pending = false
          return intercept(() => Reflect.apply(value, target, args))
        }
      }
      return typeof value === "function" ? value.bind(target) : value
    },
  }) as OrchestratorWorthPort
}
