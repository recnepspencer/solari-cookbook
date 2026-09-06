import assert from "node:assert/strict"
import test from "node:test"
import type {
  CapabilityProjection,
  EvidenceCaptureRequest,
  EvidenceId,
  IsoTimestamp,
  Observation,
  OperationContext,
  OperationId,
  ReplayProjection,
  ReplayStep,
  SessionId,
  SolariCloseResult,
  SolariPort,
  SolariSession,
  VerificationRunId,
} from "@interface-compiler/domain"
import { createApplication } from "@interface-compiler/domain"
import { verifyAdmittedCandidate, type CandidateVerificationEnvironment } from "../src/candidate-verifier.js"
import { createOperationController } from "../src/operation.js"
import type { SemanticVerifier } from "../src/semantic-verifier.js"

const now = "2026-09-01T12:00:00.000Z" as IsoTimestamp
const applicationResult = createApplication({ id: "application.candidate" as never, name: "Candidate", baseUrl: "https://candidate.test" })
if (!applicationResult.ok) throw new Error("invalid candidate test application")
const application = applicationResult.value
const outputSchema = { type: "object", required: ["ok"], additionalProperties: false, properties: { ok: { type: "boolean" } } } as const
const capability: Extract<CapabilityProjection, { readonly status: "verifying" }> = {
  projectionKind: "worth_capability",
  id: "capability.candidate" as never,
  revision: 2,
  applicationId: application.id,
  name: "candidate",
  description: "verify candidate",
  inputSchema: { type: "object" },
  outputSchema,
  preconditions: [],
  postconditions: [{ kind: "text_present", text: "DONE" }],
  publication: { audience: "gemini_consumer", disclosure: "semantic_only" },
  status: "verifying",
  candidateReplayVersionId: "replay.candidate" as never,
}
const replay: Extract<ReplayProjection, { readonly status: "verifying" }> = {
  projectionKind: "worth_replay",
  id: "replay.candidate" as never,
  revision: 3,
  capabilityId: capability.id,
  version: 2,
  steps: [{ type: "wait", milliseconds: 1 }],
  confidence: 0.5,
  createdAt: now,
  status: "verifying",
  verification: { requiredSuccessfulRuns: 3, runs: [] },
}

test("candidate verification enforces preconditions before browser actions", async () => {
  const session = new FakeSession("session.precondition", [{ kind: "observed", observation: observation("session.precondition"), effect: { kind: "completed" } }])
  const result = await verifyAdmittedCandidate(
    { ...capability, preconditions: [{ kind: "text_present", text: "READY" }] },
    replay,
    application,
    {},
    ports(session, {
      modelUsage: "none",
      verify: async (request) => request.phase === "precondition"
        ? { kind: "failed", condition: request.conditions[0]!, message: "not ready", retryable: false, evidenceIds: [], effect: { kind: "completed" } }
        : { kind: "verified", output: { ok: true }, effect: { kind: "completed" } },
    }),
    controller(5),
    0,
  )
  assert.deepEqual(result, { kind: "blocked", classification: "precondition_failed", reason: "precondition_failed", message: "not ready", retryable: false })
  assert.deepEqual(session.stepIndices, [])
})

test("candidate verification bootstraps a fresh blank Solari session before checking preconditions", async () => {
  const blank = { ...observation("session.blank"), url: "about:blank", pageSummary: "" }
  const session = new FakeSession("session.blank", [
    { kind: "observed", observation: blank, effect: { kind: "completed" } },
    { kind: "observed", observation: observation("session.blank"), effect: { kind: "completed" } },
    { kind: "observed", observation: observation("session.blank"), effect: { kind: "completed" } },
  ])
  const result = await verifyAdmittedCandidate(capability, replay, application, {}, ports(session, successfulVerifier()), controller(3), 0)
  assert.equal(result.kind, "completed")
  assert.deepEqual(session.stepIndices, [0, 0])
})

for (const effect of [{ kind: "completed" as const }, { kind: "unknown" as const, recovery: "owner_reconciliation_required" as const }]) {
  test(`candidate bootstrap failure with ${effect.kind} effect is a provider incident`, async () => {
    const blank = { ...observation(`session.bootstrap-${effect.kind}`), url: "about:blank", pageSummary: "" }
    const failure = { kind: "step_failed" as const, stepIndex: 0, message: "navigation provider lost its response", evidenceIds: [] }
    const session = new FakeSession(
      `session.bootstrap-${effect.kind}`,
      [{ kind: "observed", observation: blank, effect: { kind: "completed" } }],
      `evidence.bootstrap-${effect.kind}`,
      undefined,
      [{ kind: "failed", failure, effect }],
    )

    const result = await verifyAdmittedCandidate(capability, replay, application, {}, ports(session, successfulVerifier()), controller(3), 0)

    assert.equal(result.kind, "blocked")
    if (result.kind === "blocked") assert.deepEqual({ classification: result.classification, reason: result.reason, retryable: result.retryable }, { classification: "provider_failure", reason: "provider_failure", retryable: true })
  })
}

test("one recovery-scoped controller prevents verification sessions from reclaiming browser budget", async () => {
  const first = new FakeSession("session.budget.1", observations("session.budget.1"), "evidence.budget.1")
  const second = new FakeSession("session.budget.2", observations("session.budget.2"), "evidence.budget.2")
  const shared = controller(1)
  const candidatePorts = ports([first, second], successfulVerifier())
  const firstResult = await verifyAdmittedCandidate(capability, replay, application, {}, candidatePorts, shared, 0)
  const secondResult = await verifyAdmittedCandidate(capability, replay, application, {}, candidatePorts, shared, 1)
  assert.equal(firstResult.kind, "completed")
  assert.equal(secondResult.kind, "blocked")
  if (secondResult.kind === "blocked") assert.match(secondResult.message, /budget_exhausted/)
  assert.deepEqual(first.stepIndices, [0])
  assert.deepEqual(second.stepIndices, [])
})

test("cleanup failure cannot activate an otherwise successful candidate", async () => {
  const session = new FakeSession(
    "session.cleanup",
    observations("session.cleanup"),
    "evidence.cleanup",
    { kind: "close_failed", message: "provider did not close", retryable: true, effect: { kind: "unknown", recovery: "owner_reconciliation_required" } },
  )
  const result = await verifyAdmittedCandidate(capability, replay, application, {}, ports(session, successfulVerifier()), controller(5), 0)
  assert.deepEqual(result, { kind: "blocked", classification: "provider_failure", reason: "provider_failure", message: "candidate verification session cleanup failed: provider did not close", retryable: true })
})

test("verifier timeout remains retryable and cannot become a candidate failure receipt", async () => {
  const session = new FakeSession("session.timeout", observations("session.timeout"), "evidence.timeout")
  const verifier: SemanticVerifier = { modelUsage: "required", verify: async () => ({ kind: "timed_out", usage: { inputTokens: 1, outputTokens: 0, estimatedModelCostMicrocents: 0 }, effect: { kind: "not_started" } }) }
  const result = await verifyAdmittedCandidate(capability, replay, application, {}, ports(session, verifier), controller(5), 0)
  assert.equal(result.kind, "blocked")
  if (result.kind === "blocked") assert.deepEqual({ reason: result.reason, retryable: result.retryable }, { reason: "timed_out", retryable: true })
})

test("a completed-effect verifier provider failure cannot become a candidate failure receipt", async () => {
  const session = new FakeSession("session.verifier-provider", observations("session.verifier-provider"), "evidence.verifier-provider")
  const verifier: SemanticVerifier = { modelUsage: "required", verify: async () => ({ kind: "provider_failed", message: "malformed model response", retryable: false, usage: { inputTokens: 1, outputTokens: 1, estimatedModelCostMicrocents: 1 }, effect: { kind: "completed" } }) }
  const result = await verifyAdmittedCandidate(capability, replay, application, {}, ports(session, verifier), controller(5), 0)
  assert.equal(result.kind, "blocked")
  if (result.kind === "blocked") assert.deepEqual({ classification: result.classification, reason: result.reason }, { classification: "provider_failure", reason: "provider_failure" })
  assert.equal(session.captureCalls, 0)
})

test("off-origin candidate observations fail closed before postcondition verification", async () => {
  const outside = { ...observation("session.outside"), url: "https://outside.test" }
  const session = new FakeSession("session.outside", [{ kind: "observed", observation: outside, effect: { kind: "completed" } }])
  let verifierCalls = 0
  const verifier: SemanticVerifier = { modelUsage: "none", verify: async () => { verifierCalls += 1; return { kind: "verified", output: { ok: true }, effect: { kind: "completed" } } } }
  const result = await verifyAdmittedCandidate(capability, replay, application, {}, ports(session, verifier), controller(5), 0)
  assert.equal(result.kind, "blocked")
  if (result.kind === "blocked") assert.equal(result.reason, "interaction_failed")
  assert.equal(verifierCalls, 0)
})

test("cancellation after a candidate action blocks before postcondition verification or evidence capture", async () => {
  let cancelled = false
  const session = new FakeSession("session.cancelled", observations("session.cancelled"), "evidence.cancelled", undefined, [], () => { cancelled = true })
  let verifierCalls = 0
  const verifier: SemanticVerifier = { modelUsage: "none", verify: async () => { verifierCalls += 1; return { kind: "verified", output: { ok: true }, effect: { kind: "completed" } } } }
  const result = await verifyAdmittedCandidate(capability, replay, application, {}, ports(session, verifier), controller(5, () => cancelled), 0)
  assert.equal(result.kind, "blocked")
  if (result.kind === "blocked") assert.deepEqual({ reason: result.reason, retryable: result.retryable }, { reason: "cancelled", retryable: true })
  assert.equal(verifierCalls, 0)
  assert.equal(session.captureCalls, 0)
})

test("only diagnosed candidate drift produces a failed WORTH receipt", async () => {
  const failure = { kind: "step_failed" as const, stepIndex: 0, message: "target disappeared", evidenceIds: ["evidence.step" as EvidenceId] }
  const absent = new FakeSession("session.drift", [
    { kind: "observed", observation: observation("session.drift"), effect: { kind: "completed" } },
    { kind: "observed", observation: observation("session.drift"), effect: { kind: "completed" } },
  ], "evidence.drift", { kind: "closed", sessionId: "session.drift" as SessionId, effect: { kind: "completed" } }, [{ kind: "failed", failure, effect: { kind: "not_started" } }])
  const driftReplay = { ...replay, steps: [{ type: "click", target: { semanticDescription: "missing", role: "button", name: "Missing" } }] as readonly ReplayStep[] }
  const result = await verifyAdmittedCandidate(capability, driftReplay, application, {}, ports(absent, successfulVerifier()), controller(5), 0)
  assert.equal(result.kind, "completed")
  if (result.kind === "completed") assert.equal(result.receipt.outcome, "failure")
})

test("an uncertain candidate action effect remains a provider block even when its target is absent", async () => {
  const failure = { kind: "step_failed" as const, stepIndex: 0, message: "provider lost the browser response", evidenceIds: ["evidence.provider" as EvidenceId] }
  const session = new FakeSession("session.provider", observations("session.provider"), "evidence.provider", undefined, [{ kind: "failed", failure, effect: { kind: "unknown", recovery: "owner_reconciliation_required" } }])
  const clickReplay = { ...replay, steps: [{ type: "click", target: { semanticDescription: "missing", role: "button", name: "Missing" } }] as readonly ReplayStep[] }
  const result = await verifyAdmittedCandidate(capability, clickReplay, application, {}, ports(session, successfulVerifier()), controller(5), 0)
  assert.equal(result.kind, "blocked")
  if (result.kind === "blocked") assert.deepEqual({ classification: result.classification, reason: result.reason, retryable: result.retryable }, { classification: "provider_failure", reason: "provider_failure", retryable: true })
  assert.equal(session.captureCalls, 0)
})

test("cancellation after a failed candidate action wins before drift diagnosis", async () => {
  let cancelled = false
  const failure = { kind: "step_failed" as const, stepIndex: 0, message: "target disappeared", evidenceIds: ["evidence.cancelled-failure" as EvidenceId] }
  const session = new FakeSession("session.cancelled-failure", observations("session.cancelled-failure"), "evidence.cancelled-failure", undefined, [{ kind: "failed", failure, effect: { kind: "not_started" } }], () => { cancelled = true })
  const clickReplay = { ...replay, steps: [{ type: "click", target: { semanticDescription: "missing", role: "button", name: "Missing" } }] as readonly ReplayStep[] }

  const result = await verifyAdmittedCandidate(capability, clickReplay, application, {}, ports(session, successfulVerifier()), controller(5, () => cancelled), 0)

  assert.equal(result.kind, "blocked")
  if (result.kind === "blocked") assert.equal(result.reason, "cancelled")
  assert.equal(session.captureCalls, 0)
  assert.equal(session.observationCalls, 1)
})

test("deadline expiry after a failed candidate action wins before drift diagnosis", async () => {
  let currentTime = now
  const failure = { kind: "step_failed" as const, stepIndex: 0, message: "target disappeared", evidenceIds: ["evidence.deadline-failure" as EvidenceId] }
  const session = new FakeSession("session.deadline-failure", observations("session.deadline-failure"), "evidence.deadline-failure", undefined, [{ kind: "failed", failure, effect: { kind: "not_started" } }], () => { currentTime = "2026-09-01T12:06:00.000Z" as IsoTimestamp })
  const clickReplay = { ...replay, steps: [{ type: "click", target: { semanticDescription: "missing", role: "button", name: "Missing" } }] as readonly ReplayStep[] }

  const result = await verifyAdmittedCandidate(capability, clickReplay, application, {}, ports(session, successfulVerifier()), controller(5, () => false, () => currentTime), 0)

  assert.equal(result.kind, "blocked")
  if (result.kind === "blocked") assert.equal(result.reason, "timed_out")
  assert.equal(session.captureCalls, 0)
  assert.equal(session.observationCalls, 1)
})

class FakeSession implements SolariSession {
  readonly sessionId: SessionId
  readonly stepIndices: number[] = []
  captureCalls = 0
  observationCalls = 0
  constructor(
    id: string,
    private readonly observationResults: Array<Awaited<ReturnType<SolariSession["observe"]>>>,
    private readonly evidenceId = `evidence.${id}`,
    readonly closeResult: SolariCloseResult = { kind: "closed", sessionId: id as SessionId, effect: { kind: "completed" } },
    private readonly stepResults: Array<Awaited<ReturnType<SolariSession["executeStep"]>>> = [],
    private readonly onStep?: () => void,
  ) { this.sessionId = id as SessionId }
  async observe(): Promise<Awaited<ReturnType<SolariSession["observe"]>>> { this.observationCalls += 1; return this.observationResults.shift() ?? { kind: "observed", observation: observation(this.sessionId), effect: { kind: "completed" } } }
  async executeStep(_step: ReplayStep, _context: OperationContext, stepIndex = 0): Promise<Awaited<ReturnType<SolariSession["executeStep"]>>> { this.stepIndices.push(stepIndex); this.onStep?.(); return this.stepResults.shift() ?? { kind: "completed", effect: { kind: "completed" } } }
  async captureEvidence(_request: EvidenceCaptureRequest): Promise<Awaited<ReturnType<SolariSession["captureEvidence"]>>> { this.captureCalls += 1; return { kind: "captured", reference: { evidenceId: this.evidenceId as EvidenceId, kind: "session_receipt", externalRef: `solari-session:${this.sessionId}` }, effect: { kind: "completed" } } }
}

function ports(sessions: FakeSession | readonly FakeSession[], verifier: SemanticVerifier) {
  const queue = Array.isArray(sessions) ? [...sessions] : [sessions]
  let verificationId = 0
  const verificationEnvironment: CandidateVerificationEnvironment = { prepareFreshRun: async () => ({ kind: "ready" }) }
  const solari: SolariPort = { createSession: async () => {
    const session = queue.shift()
    if (session === undefined) return { kind: "failed", message: "no session", retryable: false, effect: { kind: "not_started" } }
    return { kind: "created", lease: { session, release: async () => session.closeResult }, effect: { kind: "completed" } }
  } }
  return { clock: { now: () => now }, ids: { nextVerificationRunId: () => `verification.candidate.${++verificationId}` as VerificationRunId }, solari, verifier, verificationEnvironment }
}

function successfulVerifier(): SemanticVerifier {
  return { modelUsage: "none", verify: async () => ({ kind: "verified", output: { ok: true }, effect: { kind: "completed" } }) }
}

function controller(maxBrowserActions: number, isCancellationRequested: () => boolean = () => false, nowProvider: () => IsoTimestamp = () => now) {
  const context: OperationContext = {
    operationId: "operation.candidate" as OperationId,
    deadlineAt: "2026-09-01T12:05:00.000Z" as IsoTimestamp,
    cancellation: { isCancellationRequested, onCancellationRequested: () => () => undefined },
    budget: { maxWallClockMs: 300_000, maxModelCalls: 5, maxBrowserActions },
    admission: { maxInFlight: 1, maxQueued: 0, overflow: "reject" },
  }
  const result = createOperationController({ admittedContext: context, clock: { now: nowProvider } })
  if (!result.ok) throw new Error("invalid test controller")
  return result.value
}

function observation(sessionId: string): Observation {
  return { id: `observation.${sessionId}` as never, sessionId: sessionId as SessionId, url: application.baseUrl, pageSummary: "DONE", interactables: [], observedAt: now }
}

function observations(sessionId: string): Array<Awaited<ReturnType<SolariSession["observe"]>>> {
  return [
    { kind: "observed", observation: observation(sessionId), effect: { kind: "completed" } },
    { kind: "observed", observation: observation(sessionId), effect: { kind: "completed" } },
  ]
}
