import assert from "node:assert/strict"
import test from "node:test"
import {
  createApplication,
  type ActiveReplayProjection,
  type ApplicationId,
  type ApplicationProjection,
  type CapabilityId,
  type CapabilityProjection,
  type Clock,
  type Condition,
  type EvidenceCaptureRequest,
  type EvidenceId,
  type EvidenceProjection,
  type EventId,
  type EventPublicationResult,
  type ExecutionId,
  type ExecutionProjection,
  type ExecutionStart,
  type ExperimentId,
  type ExperimentProjection,
  type IdSource,
  type InterfaceCompilerEvent,
  type IsoTimestamp,
  type Observation,
  type ObservationId,
  type OperationContext,
  type OperationId,
  type ReasoningModel,
  type ReasoningResult,
  type ReasoningUsage,
  type ReplayFailure,
  type ReplayProjection,
  type ReplayStep,
  type ReplayVersionId,
  type Schema,
  type SolariCloseResult,
  type SolariObservationResult,
  type SolariPort,
  type SolariSession,
  type SolariSessionResult,
  type SolariStepResult,
  type SessionId,
  type WorthCommand,
  type WorthReadResult,
  type WorthSubmissionResult,
  type ValidationResult,
} from "@interface-compiler/domain"
import {
  createWorthAdapter,
  WORTH_QUERY_HOST_FACADE_BOUNDARY,
  type WorthCompilationMetricsProjection,
  type WorthRuntimePort,
  type WorthExecutionAdmissionResult,
  type WorthRuntimeSettlementResult,
  type ReplayDegradationRequest,
} from "@interface-compiler/worth-adapter"
import {
  createCancellationSource,
  createOperationController,
  ExperimentRunner,
  planCompiledExperiment,
  planDirectExperiment,
  type ExperimentPlan,
  type OrchestratorPorts,
  type OrchestratorWorthPort,
  type SemanticVerificationResult,
  type SemanticVerifier,
} from "../src/index.js"
import { createWalmartBenchmarkStepPolicy } from "../src/walmart-benchmark/step-policy.js"

const timestamp = "2026-08-31T12:00:00.000Z" as IsoTimestamp
const application = validValue(createApplication({ id: id<ApplicationId>("application.shop"), name: "Shop", baseUrl: "https://shop.test" }))
const capabilityId = id<CapabilityId>("capability.add-to-cart")
const replayId = id<ReplayVersionId>("replay.add-to-cart.v1")
const sessionId = id<SessionId>("session.test")

function id<T extends string>(value: string): T {
  return value as T
}

const clock: Clock = { now: () => timestamp }

function operationController(options: { readonly maxModelCalls?: number; readonly maxBrowserActions?: number } = {}) {
  const cancellation = createCancellationSource()
  const context: OperationContext = Object.freeze({
    operationId: id<OperationId>("operation.test"),
    deadlineAt: "2026-08-31T12:01:00.000Z",
    cancellation: cancellation.token,
    budget: Object.freeze({
      maxWallClockMs: 60_000,
      ...(options.maxModelCalls === undefined ? {} : { maxModelCalls: options.maxModelCalls }),
      ...(options.maxBrowserActions === undefined ? {} : { maxBrowserActions: options.maxBrowserActions }),
    }),
    admission: { maxInFlight: 1, maxQueued: 0, overflow: "reject" as const },
  })
  const result = createOperationController({ admittedContext: context, clock })
  if (!result.ok) throw new Error("test operation context was invalid")
  return { controller: result.value, cancellation }
}

function operationContext(): OperationContext {
  return operationController().controller.context
}

function baseRequest(expectedOutcome?: readonly Condition[]): import("../src/index.js").ExperimentRequest {
  return {
    application,
    capabilityId,
    experimentId: id<ExperimentId>("experiment.test"),
    objective: "add the selected item to the cart",
    ...(expectedOutcome === undefined ? {} : { expectedOutcome }),
  }
}

function safeObservation(observationId: string, semanticGuess?: string): Observation {
  return {
    id: id<ObservationId>(observationId),
    sessionId,
    url: "https://shop.test/product/1",
    title: "Product",
    pageSummary: "A product page",
    interactables: semanticGuess === undefined ? [] : [{ kind: "input", semanticGuess }],
    observedAt: timestamp,
  }
}

function clickStep(semanticDescription = "Add to cart"): ReplayStep {
  return { type: "click", target: { semanticDescription, role: "button", name: semanticDescription } }
}

function verifiedReplayProjection(steps: readonly ReplayStep[] = [clickStep(), clickStep("Pay now")]): ActiveReplayProjection {
  return {
    projectionKind: "worth_replay",
    id: replayId,
    revision: 7,
    capabilityId,
    version: 1,
    steps,
    confidence: 0.9,
    createdAt: timestamp,
    status: "active",
    verifiedAt: timestamp,
    verification: { requiredSuccessfulRuns: 3, runs: [] },
  }
}

function validValue<T>(result: ValidationResult<T>): T {
  if (!result.ok) throw new Error(result.issues.map((entry) => entry.message).join(", "))
  return result.value
}

class FakeSession implements SolariSession {
  public readonly sessionId = sessionId
  public readonly executedSteps: ReplayStep[] = []
  public observeCalls = 0
  public released = false
  public releaseContext: OperationContext | undefined

  public constructor(
    private readonly observations: SolariObservationResult[],
    private readonly stepResults: SolariStepResult[],
    private readonly releaseResult: SolariCloseResult = { kind: "closed", sessionId, effect: { kind: "completed" } },
    private readonly beforeStep?: () => void,
  ) {}

  public async observe(_context: OperationContext): Promise<SolariObservationResult> {
    this.observeCalls += 1
    return this.observations.shift() ?? { kind: "observed", observation: safeObservation(`observation.fallback.${this.observeCalls}`), effect: { kind: "completed" } }
  }

  public async executeStep(step: ReplayStep, _context: OperationContext): Promise<SolariStepResult> {
    this.executedSteps.push(step)
    this.beforeStep?.()
    return this.stepResults.shift() ?? { kind: "completed", effect: { kind: "completed" } }
  }

  public async captureEvidence(_request: EvidenceCaptureRequest, _context: OperationContext) {
    return { kind: "failed" as const, message: "evidence is not part of this worker slice", retryable: false, effect: { kind: "not_started" as const } }
  }

  public async release(_context: OperationContext): Promise<SolariCloseResult> {
    this.released = true
    this.releaseContext = _context
    return this.releaseResult
  }
}

class ScriptedSolari implements SolariPort {
  public readonly sessions: FakeSession[] = []

  public constructor(
    private readonly observations: SolariObservationResult[],
    private readonly steps: SolariStepResult[],
    private readonly releaseResult?: SolariCloseResult,
    private readonly beforeStep?: () => void,
  ) {}

  public async createSession(_request: Parameters<SolariPort["createSession"]>[0], _context: OperationContext): Promise<SolariSessionResult> {
    const session = new FakeSession([...this.observations], [...this.steps], this.releaseResult, this.beforeStep)
    this.sessions.push(session)
    return { kind: "created", lease: { session, release: (context) => session.release(context) }, effect: { kind: "completed" } }
  }
}

class FakeModel implements ReasoningModel {
  public calls = 0

  public constructor(private readonly results: readonly ReasoningResult<unknown>[]) {}

  public async structuredComplete<TInput, TOutput>(_input: TInput, _schema: Schema<TOutput>, _context: OperationContext): Promise<ReasoningResult<TOutput>> {
    this.calls += 1
    return (this.results[this.calls - 1] ?? {
      kind: "failed",
      message: "scripted model exhausted",
      retryable: false,
      effect: { kind: "unknown", recovery: "owner_reconciliation_required" },
    }) as ReasoningResult<TOutput>
  }
}

class FailedVerifier implements SemanticVerifier {
  public constructor(private readonly options: {
    readonly usage?: ReasoningUsage
    readonly condition?: Condition
    readonly evidenceIds?: readonly EvidenceId[]
  } = {}) {}

  public async verify(request: Parameters<SemanticVerifier["verify"]>[0], _context: OperationContext): Promise<SemanticVerificationResult> {
    const condition = this.options.condition ?? request.conditions[0]
    if (condition === undefined) throw new Error("test verifier requires a condition")
    return {
      kind: "failed",
      condition,
      message: "postcondition was false",
      retryable: false,
      evidenceIds: this.options.evidenceIds ?? [id<EvidenceId>("evidence.postcondition")],
      ...(this.options.usage === undefined ? {} : { usage: this.options.usage }),
      effect: { kind: "completed" },
    }
  }
}

class CancellingVerifier implements SemanticVerifier {
  public constructor(private readonly cancel: () => void) {}

  public async verify(_request: Parameters<SemanticVerifier["verify"]>[0], _context: OperationContext): Promise<SemanticVerificationResult> {
    this.cancel()
    return { kind: "verified", output: { status: "done" }, effect: { kind: "completed" } }
  }
}

class FakeWorthRuntime implements WorthRuntimePort {
  public readonly commands: WorthCommand[] = []
  public readonly events: InterfaceCompilerEvent[] = []
  public readonly capability: CapabilityProjection = {
    projectionKind: "worth_capability",
    id: capabilityId,
    revision: 4,
    applicationId: application.id,
    name: "AddToCart",
    description: "Add an item to the cart",
    status: "healthy",
    activeReplayVersionId: replayId,
  }
  public replay: ActiveReplayProjection = verifiedReplayProjection()
  public rejectNextStart = false
  public failEventPublication = false
  public failEventType: InterfaceCompilerEvent["type"] | undefined
  public mismatchStartProjection = false
  public cancelOnBrowserAction: (() => void) | undefined
  public eventAttempts = 0
  public completed: ExecutionProjection | undefined
  public readonly degradationRequests: ReplayDegradationRequest[] = []
  public denyDegradation = false

  private running: ExecutionStart | undefined
  private replayFailure: ReplayFailure | undefined

  public async readApplication(_id: ApplicationId, _context: OperationContext): Promise<WorthReadResult<ApplicationProjection>> {
    return { kind: "found", value: { projectionKind: "worth_application", id: application.id, revision: 1, name: application.name, baseUrl: application.baseUrl } }
  }

  public async readCapability(_id: CapabilityId, _context: OperationContext): Promise<WorthReadResult<CapabilityProjection>> {
    return { kind: "found", value: this.capability }
  }

  public async readActiveReplay(_id: CapabilityId, _context: OperationContext): Promise<WorthReadResult<ActiveReplayProjection>> {
    return { kind: "found", value: this.replay }
  }

  public async readReplayLineage(_id: CapabilityId, _context: OperationContext): Promise<WorthReadResult<readonly ReplayProjection[]>> {
    return { kind: "found", value: [this.replay] }
  }

  public async readExperiment(experimentId: ExperimentId, _context: OperationContext): Promise<WorthReadResult<ExperimentProjection>> {
    return { kind: "not_found", entity: "experiment", entityId: experimentId }
  }

  public async readEvidence(evidenceId: EvidenceId, _context: OperationContext): Promise<WorthReadResult<EvidenceProjection>> {
    return {
      kind: "found",
      value: {
        projectionKind: "worth_evidence",
        id: evidenceId,
        revision: 1,
        capturedAt: timestamp,
        kind: "observation",
        observationId: id<ObservationId>("observation.evidence"),
      },
    }
  }

  public async readExecution(executionId: ExecutionId, _context: OperationContext): Promise<WorthReadResult<ExecutionProjection>> {
    return this.completed?.id === executionId
      ? { kind: "found", value: this.completed }
      : { kind: "not_found", entity: "execution", entityId: executionId }
  }

  public async readCompilationMetrics(_id: CapabilityId, _context: OperationContext): Promise<WorthReadResult<WorthCompilationMetricsProjection>> {
    return { kind: "not_found", entity: "capability", entityId: capabilityId }
  }

  public async publishEvent(event: InterfaceCompilerEvent, _context: OperationContext): Promise<EventPublicationResult> {
    this.eventAttempts += 1
    if (this.cancelOnBrowserAction !== undefined && event.type === "browser.action") this.cancelOnBrowserAction()
    if (this.failEventPublication || this.failEventType === event.type) {
      return {
        kind: "failed",
        eventId: event.eventId,
        message: "Worth event sink unavailable",
        retryable: true,
        effect: { kind: "unknown", recovery: "owner_reconciliation_required" },
      }
    }
    this.events.push(event)
    return { kind: "published", eventId: event.eventId, effect: { kind: "completed" } }
  }

  public async submit(command: WorthCommand, _context: OperationContext): Promise<WorthSubmissionResult> {
    this.commands.push(command)
    switch (command.kind) {
      case "start_execution":
        if (this.rejectNextStart) {
          this.rejectNextStart = false
          return { kind: "stale", entity: "replay", entityId: replayId, expectedRevision: 7, actualRevision: 8 }
        }
        this.running = command.execution
        const projection = this.mismatchStartProjection
          ? runningProjection({ ...command.execution, capabilityId: id<CapabilityId>("capability.other") })
          : runningProjection(command.execution)
        return { kind: "accepted", projection: { kind: "execution", projection } }
      case "record_replay_failure":
        this.replayFailure = command.failure
        return { kind: "accepted", projection: { kind: "replay", projection: brokenReplayProjection(command) } }
      case "resume_capability_exploration":
        if (this.replayFailure === undefined) throw new Error("replay failure must be recorded before exploration resumes")
        return { kind: "accepted", projection: { kind: "capability", projection: degradedCapabilityProjection(this.replayFailure) } }
      case "complete_execution": {
        const projection = completedProjection(command, this.running, this.events)
        this.completed = projection
        return { kind: "accepted", projection: { kind: "execution", projection } }
      }
      default:
        throw new Error(`unexpected command in worker test: ${command.kind}`)
    }
  }
}

function runningProjection(execution: ExecutionStart): ExecutionProjection {
  return {
    projectionKind: "worth_execution",
    id: execution.id,
    revision: 1,
    capabilityId: execution.capabilityId,
    ...(execution.replayVersionId === undefined ? {} : { replayVersionId: execution.replayVersionId }),
    mode: execution.mode,
    metrics: { ...execution.metrics, endedAt: undefined, wallClockMs: undefined },
    status: "running",
  }
}

function brokenReplayProjection(command: Extract<WorthCommand, { readonly kind: "record_replay_failure" }>): ReplayProjection {
  return {
    projectionKind: "worth_replay",
    id: command.replayVersionId,
    revision: 8,
    capabilityId,
    version: 1,
    confidence: 0.9,
    createdAt: timestamp,
    status: "broken",
    brokenAt: command.brokenAt,
    failure: command.failure,
    steps: verifiedReplayProjection().steps,
  }
}

function degradedCapabilityProjection(failure: ReplayFailure): CapabilityProjection {
  return {
    projectionKind: "worth_capability",
    id: capabilityId,
    revision: 5,
    applicationId: application.id,
    name: "AddToCart",
    description: "Add an item to the cart",
    status: "degraded",
    brokenReplayVersionId: replayId,
    failure,
    mode: "exploratory",
  }
}

function completedProjection(command: Extract<WorthCommand, { readonly kind: "complete_execution" }>, running: ExecutionStart | undefined, events: readonly InterfaceCompilerEvent[]): ExecutionProjection {
  const execution = running
  if (execution === undefined) throw new Error("execution must be started before completion")
  const modelEvents = events.filter((event) => event.type === "model.called")
  const metrics = {
    ...execution.metrics,
    endedAt: command.endedAt,
    wallClockMs: Date.parse(command.endedAt) - Date.parse(execution.metrics.startedAt),
    modelCalls: modelEvents.length,
    inputTokens: modelEvents.reduce((total, event) => total + (event.type === "model.called" ? event.payload.inputTokens : 0), 0),
    outputTokens: modelEvents.reduce((total, event) => total + (event.type === "model.called" ? event.payload.outputTokens : 0), 0),
    browserObservations: events.filter((event) => event.type === "browser.observed").length,
    browserActions: events.filter((event) => event.type === "browser.action").length,
    estimatedModelCostUsd: modelEvents.reduce((total, event) => total + (event.type === "model.called" ? event.payload.estimatedModelCostUsd : 0), 0),
  }
  if (command.completion.kind === "success") return { ...runningProjection(execution), revision: command.expectedExecutionRevision + 1, status: "success", outcome: command.completion, metrics }
  if (command.completion.kind === "safety_stop") return { ...runningProjection(execution), revision: command.expectedExecutionRevision + 1, status: "stopped", outcome: command.completion, metrics }
  return { ...runningProjection(execution), revision: command.expectedExecutionRevision + 1, status: "failure", outcome: command.completion, metrics }
}

function ports(worth: OrchestratorWorthPort, solari: SolariPort, model?: ReasoningModel, verifier?: SemanticVerifier, ids = operationIds()): OrchestratorPorts {
  return { clock, ids, worth, solari, ...(model === undefined ? {} : { model }), ...(verifier === undefined ? {} : { verifier }) }
}

function operationIds(): Pick<IdSource, "nextExecutionId" | "nextEventId"> {
  let next = 0
  return {
    nextExecutionId: () => id<ExecutionId>(`execution.${++next}`),
    nextEventId: () => id<EventId>(`event.${++next}`),
  }
}

function bind(runtime: FakeWorthRuntime): OrchestratorWorthPort {
  const adapter = createWorthAdapter({ boundary: WORTH_QUERY_HOST_FACADE_BOUNDARY, runtime })
  const evidence = { queryName: "test", queryIdentity: "test", basisVersion: 1, projectedRecordCount: 1, projectedFieldCount: 8, basisReleased: true } as const
  return {
    readApplication: async (id, context) => {
      const result = await adapter.readApplication(id, context)
      return result.kind === "found" ? { ...result, evidence } : result
    },
    readCapability: async (id, context) => {
      const result = await adapter.readCapability(id, context)
      return result.kind === "found" ? { ...result, evidence, compilationProvenance: { kind: "synthetic_seed" } } : result
    },
    readActiveReplay: async (id, context) => {
      const result = await adapter.readActiveReplay(id, context)
      return result.kind === "found" ? { ...result, evidence, compilationProvenance: { kind: "synthetic_seed" } } : result
    },
    readEvidence: adapter.readEvidence,
    publish: adapter.publish,
    admitExecution: async (execution, context): Promise<WorthExecutionAdmissionResult> => {
      const result = await adapter.startExecution(execution, context)
      if (result.kind !== "accepted" || result.projection.kind !== "execution") return result.kind === "cancelled" || result.kind === "timed_out" ? result : { kind: "denied", executionId: execution.id, message: "test WORTH admission rejected" }
      const projection = result.projection.projection
      return { kind: "admitted", commit: "committed", projection: { projectionKind: "worth_running_execution", executionId: projection.id, capabilityId: projection.capabilityId, ...(projection.replayVersionId === undefined ? {} : { replayVersionId: projection.replayVersionId }), mode: projection.mode, lifecycle: "started", revision: projection.revision, metrics: projection.metrics }, evidence }
    },
    settleExecution: async (executionId, completion, endedAt, revision, context): Promise<WorthRuntimeSettlementResult> => {
      const result = await adapter.completeExecution(executionId, completion, endedAt, revision, context)
      if (result.kind !== "accepted" || result.projection.kind !== "execution") return result.kind === "cancelled" || result.kind === "timed_out" ? result : { kind: "denied", executionId, message: "test WORTH settlement rejected" }
      const projection = result.projection.projection
      if (projection.status === "running") return { kind: "denied", executionId, message: "test settlement remained running" }
      if (projection.metrics.endedAt === undefined || projection.metrics.wallClockMs === undefined) return { kind: "denied", executionId, message: "test settlement omitted terminal metrics" }
      return { kind: "settled", commit: "committed", projection: { projectionKind: "worth_terminal_execution", executionId: projection.id, capabilityId: projection.capabilityId, ...(projection.replayVersionId === undefined ? {} : { replayVersionId: projection.replayVersionId }), mode: projection.mode, lifecycle: projection.status, revision: projection.revision, metrics: projection.metrics, outcome: completion }, evidence }
    },
    degradeReplay: async (request) => {
      runtime.degradationRequests.push(request)
      if (runtime.denyDegradation) return { kind: "denied", stage: "operation_admission", message: "scripted WORTH denial" }
      const completed = runtime.completed
      if (request.expectedCapabilityRevision !== runtime.capability.revision) return { kind: "stale", entity: "capability", entityId: request.capabilityId, expectedRevision: request.expectedCapabilityRevision, actualRevision: runtime.capability.revision }
      if (request.expectedReplayRevision !== runtime.replay.revision) return { kind: "stale", entity: "replay", entityId: request.replayVersionId, expectedRevision: request.expectedReplayRevision, actualRevision: runtime.replay.revision }
      if (completed?.status !== "failure" || completed.outcome.kind !== "failure" || completed.outcome.reason !== "replay_failed" || completed.outcome.replayFailure === undefined || completed.revision !== request.expectedExecutionRevision) return { kind: "denied", stage: "operation_admission", message: "WORTH has no matching settled replay failure" }
      if (completed.metrics.endedAt === undefined) return { kind: "denied", stage: "dependency_projection", message: "WORTH terminal time is absent" }
      return {
        kind: "applied",
        commit: "committed",
        capability: { projectionKind: "worth_capability", id: runtime.capability.id, revision: runtime.capability.revision + 1, applicationId: runtime.capability.applicationId, name: runtime.capability.name, description: runtime.capability.description, status: "degraded", brokenReplayVersionId: request.replayVersionId, failure: completed.outcome.replayFailure, mode: "exploratory" },
        replay: { projectionKind: "worth_replay", id: runtime.replay.id, revision: runtime.replay.revision + 1, capabilityId: runtime.replay.capabilityId, version: runtime.replay.version, steps: runtime.replay.steps, confidence: runtime.replay.confidence, createdAt: runtime.replay.createdAt, status: "broken", brokenAt: completed.metrics.endedAt, failure: completed.outcome.replayFailure },
        capabilityEvidence: evidence,
        replayEvidence: evidence,
      }
    },
    acceptReplacementCandidate: async () => ({ kind: "denied", stage: "request", message: "candidate flow is not scripted in runner tests" }),
    recordReplacementVerification: async () => ({ kind: "denied", stage: "request", message: "verification flow is not scripted in runner tests" }),
    activateReplacement: async () => ({ kind: "denied", stage: "request", message: "activation flow is not scripted in runner tests" }),
  }
}

function directPlan(expectedOutcome?: readonly Condition[]): ExperimentPlan {
  return unwrapPlan(planDirectExperiment(baseRequest(expectedOutcome)))
}

function unwrapPlan<T extends ExperimentPlan>(result: ValidationResult<T>): T {
  if (!result.ok) throw new Error(result.issues.map((entry) => entry.message).join(", "))
  return result.value
}

test("direct runs stop at an authentication observation before model or browser action", async () => {
  const runtime = new FakeWorthRuntime()
  const solari = new ScriptedSolari([{ kind: "observed", observation: safeObservation("observation.login", "Password"), effect: { kind: "completed" } }], [])
  const model = new FakeModel([])
  const result = await new ExperimentRunner(ports(bind(runtime), solari, model)).run(directPlan(), operationController().controller)

  assert.equal(result.kind, "attempted")
  if (result.kind !== "attempted") throw new Error("expected attempted run")
  assert.equal(result.terminal.kind, "safety_stop")
  if (result.terminal.kind !== "safety_stop") throw new Error("expected safety stop")
  assert.equal(result.terminal.stop.reason, "authentication_required")
  assert.equal(model.calls, 0)
  assert.equal(solari.sessions[0]?.executedSteps.length, 0)
  assert.deepEqual(runtime.commands.map((command) => command.kind), ["start_execution", "complete_execution"])
  assert.equal(runtime.events.some((event) => event.type === "browser.observed"), true)
})

test("an off-origin observation is recorded but never reaches Gemini or another browser effect", async () => {
  const runtime = new FakeWorthRuntime()
  const outside = { ...safeObservation("observation.outside"), url: "https://outside.example/product/1" }
  const solari = new ScriptedSolari([{ kind: "observed", observation: outside, effect: { kind: "completed" } }], [])
  const model = new FakeModel([])
  const result = await new ExperimentRunner(ports(bind(runtime), solari, model)).run(directPlan(), operationController().controller)

  assert.equal(result.kind, "attempted")
  if (result.kind !== "attempted") throw new Error("expected attempted run")
  assert.equal(result.terminal.kind, "failure")
  assert.equal(model.calls, 0)
  assert.equal(solari.sessions[0]?.executedSteps.length, 0)
  assert.equal(runtime.events.filter((event) => event.type === "browser.observed").length, 1)
  assert.equal(runtime.completed?.metrics.browserObservations, 1)
  assert.equal(result.cleanup.kind, "closed")
})

test("direct planning and execution publish only actual model/browser telemetry to Worth", async () => {
  const runtime = new FakeWorthRuntime()
  const solari = new ScriptedSolari(
    [{ kind: "observed", observation: safeObservation("observation.initial"), effect: { kind: "completed" } }],
    [{ kind: "completed", effect: { kind: "completed" }, observation: safeObservation("observation.after-action") }],
  )
  const model = new FakeModel([
    { kind: "completed", completion: { output: { kind: "act", step: clickStep() }, usage: { inputTokens: 3, outputTokens: 4, estimatedModelCostUsd: 0.01 } }, effect: { kind: "completed" } },
    { kind: "completed", completion: { output: { kind: "complete", output: { status: "done" } }, usage: { inputTokens: 2, outputTokens: 1, estimatedModelCostUsd: 0.002 } }, effect: { kind: "completed" } },
  ])
  const result = await new ExperimentRunner(ports(bind(runtime), solari, model, undefined)).run(directPlan(), operationController({ maxModelCalls: 3, maxBrowserActions: 2 }).controller)

  assert.equal(result.kind, "attempted")
  if (result.kind !== "attempted") throw new Error("expected attempted run")
  assert.deepEqual(result.terminal, { kind: "success", output: { status: "done" } })
  assert.equal(solari.sessions[0]?.executedSteps.length, 1)
  const modelEvents = runtime.events.filter((event) => event.type === "model.called")
  assert.deepEqual(modelEvents.map((event) => [event.payload.inputTokens, event.payload.outputTokens, event.payload.estimatedModelCostUsd]), [[3, 4, 0.01], [2, 1, 0.002]])
  assert.equal(modelEvents[0]?.protocol, "interface-compiler.events")
  assert.equal(modelEvents[0]?.schemaVersion, 1)
  assert.equal(modelEvents[0]?.recovery, "replay_safe")
  assert.equal(modelEvents[0]?.integrity.algorithm, "sha256")
  assert.equal(modelEvents[0]?.integrity.digest.length, 64)
  assert.deepEqual(modelEvents.map((event) => event.idempotencyKey), [
    "model.called:execution.1:explorer:0",
    "model.called:execution.1:explorer:1",
  ])
  assert.equal(new Set(runtime.events.map((event) => event.idempotencyKey)).size, runtime.events.length)
  assert.equal(runtime.completed?.metrics.modelCalls, 2)
  assert.equal(runtime.completed?.metrics.browserActions, 1)
  assert.equal(runtime.completed?.metrics.estimatedModelCostUsd, 0.012)
})

test("the Walmart step policy denies an arbitrary search value before the Solari effect", async () => {
  const runtime = new FakeWorthRuntime()
  const solari = new ScriptedSolari(
    [{ kind: "observed", observation: safeObservation("observation.initial"), effect: { kind: "completed" } }],
    [{ kind: "completed", effect: { kind: "completed" } }],
  )
  const model = new FakeModel([{
    kind: "completed",
    completion: { output: { kind: "act", step: { type: "fill", target: { semanticDescription: "product search", role: "searchbox" }, value: "person@example.com" } }, usage: { inputTokens: 2, outputTokens: 1, estimatedModelCostUsd: 0.001 } },
    effect: { kind: "completed" },
  }])
  const result = await new ExperimentRunner({ ...ports(bind(runtime), solari, model), stepPolicy: createWalmartBenchmarkStepPolicy() })
    .run(directPlan(), operationController().controller)

  assert.equal(result.kind, "attempted")
  if (result.kind !== "attempted") throw new Error("expected attempted run")
  assert.equal(result.terminal.kind, "failure")
  assert.equal(solari.sessions[0]?.executedSteps.length, 0)
  assert.equal(runtime.completed?.metrics.browserActions, 0)
  assert.equal(runtime.completed?.metrics.modelCalls, 1)
})

test("compiled planning resolves Worth projections and executes without Gemini reasoning", async () => {
  const runtime = new FakeWorthRuntime()
  const worth = bind(runtime)
  const planned = await planCompiledExperiment(baseRequest([{ kind: "text_present", text: "done" }]), worth, operationContext())
  assert.equal(planned.kind, "planned")
  if (planned.kind !== "planned") throw new Error("expected compiled plan")

  const solari = new ScriptedSolari([{ kind: "observed", observation: safeObservation("observation.initial"), effect: { kind: "completed" } }], [
    { kind: "completed", effect: { kind: "completed" }, observation: safeObservation("observation.after-action") },
  ])
  const result = await new ExperimentRunner(ports(worth, solari)).run(planned.plan, operationController({ maxBrowserActions: 3 }).controller)

  assert.equal(result.kind, "attempted")
  if (result.kind !== "attempted") throw new Error("expected attempted run")
  assert.equal(result.terminal.kind, "safety_stop")
  if (result.terminal.kind !== "safety_stop") throw new Error("expected safety stop")
  assert.equal(result.terminal.stop.reason, "order_placement")
  assert.equal(solari.sessions[0]?.executedSteps.length, 1)
  assert.equal(runtime.events.some((event) => event.type === "model.called"), false)
  assert.equal(runtime.events.filter((event) => event.type === "browser.action").length, 1)
})

test("compiled start publishes its replay boundary before Solari session creation", async () => {
  const runtime = new FakeWorthRuntime()
  runtime.failEventType = "replay.started"
  const planned = await planCompiledExperiment(baseRequest([{ kind: "text_present", text: "done" }]), bind(runtime), operationContext())
  if (planned.kind !== "planned") throw new Error("expected compiled plan")

  const solari = new ScriptedSolari([], [])
  const result = await new ExperimentRunner(ports(bind(runtime), solari)).run(planned.plan, operationController().controller)

  assert.equal(result.kind, "attempted")
  if (result.kind !== "attempted") throw new Error("expected attempted result")
  assert.equal(result.terminal.kind, "failure")
  assert.equal(solari.sessions.length, 0)
  assert.deepEqual(runtime.events.map((event) => event.type), ["compiled.started", "replay.failed"])
})

test("compiled replay failure settles and degrades through the WORTH recovery facade", async () => {
  const runtime = new FakeWorthRuntime()
  const planResult = await planCompiledExperiment(baseRequest([{ kind: "text_present", text: "done" }]), bind(runtime), operationContext())
  if (planResult.kind !== "planned") throw new Error("expected compiled plan")
  const failure: ReplayFailure = { kind: "step_failed", stepIndex: 0, message: "target disappeared", evidenceIds: [id<EvidenceId>("evidence.1")] }
  const solari = new ScriptedSolari(
    [{ kind: "observed", observation: safeObservation("observation.initial"), effect: { kind: "completed" } }],
    [{ kind: "failed", failure, effect: { kind: "unknown", recovery: "owner_reconciliation_required" } }],
  )
  const result = await new ExperimentRunner(ports(bind(runtime), solari)).run(planResult.plan, operationController().controller)

  assert.equal(result.kind, "attempted")
  if (result.kind !== "attempted") throw new Error("expected attempted run")
  assert.equal(result.terminal.kind, "failure")
  assert.deepEqual(runtime.commands.map((command) => command.kind), ["start_execution", "complete_execution"])
  const completion = runtime.commands.at(-1)
  if (completion?.kind !== "complete_execution") throw new Error("expected completion command")
  assert.equal(completion.expectedExecutionRevision, 1)
  assert.equal(completion.completion.kind, "failure")
  if (completion.completion.kind !== "failure") throw new Error("expected failure completion")
  assert.equal(completion.completion.reason, "replay_failed")
  assert.equal(runtime.degradationRequests.length, 1)
  assert.deepEqual(runtime.degradationRequests[0], { executionId: result.executionId, capabilityId, replayVersionId: replayId, expectedExecutionRevision: 2, expectedCapabilityRevision: 4, expectedReplayRevision: 7 })
  assert.equal(result.recovery?.capability.status, "degraded")
  assert.equal(result.recovery?.replay.status, "broken")
})

test("compiled replay failure blocks finalization when WORTH denies degradation", async () => {
  const runtime = new FakeWorthRuntime()
  runtime.denyDegradation = true
  const planResult = await planCompiledExperiment(baseRequest([{ kind: "text_present", text: "done" }]), bind(runtime), operationContext())
  if (planResult.kind !== "planned") throw new Error("expected compiled plan")
  const failure: ReplayFailure = { kind: "step_failed", stepIndex: 0, message: "target disappeared", evidenceIds: [id<EvidenceId>("evidence.denied")] }
  const solari = new ScriptedSolari([{ kind: "observed", observation: safeObservation("observation.initial"), effect: { kind: "completed" } }], [{ kind: "failed", failure, effect: { kind: "completed" } }])
  const result = await new ExperimentRunner(ports(bind(runtime), solari)).run(planResult.plan, operationController().controller)

  assert.equal(result.kind, "finalization_blocked")
  if (result.kind !== "finalization_blocked") throw new Error("expected blocked finalization")
  assert.equal(result.reason, "replay_recovery_failed")
  assert.equal(result.recovery?.kind, "denied")
  assert.equal(runtime.events.some((event) => event.type === "replay.failed"), false)
})

test("terminal event failure still exposes the committed WORTH degradation", async () => {
  const runtime = new FakeWorthRuntime()
  runtime.failEventType = "replay.failed"
  const planResult = await planCompiledExperiment(baseRequest([{ kind: "text_present", text: "done" }]), bind(runtime), operationContext())
  if (planResult.kind !== "planned") throw new Error("expected compiled plan")
  const failure: ReplayFailure = { kind: "step_failed", stepIndex: 0, message: "target disappeared", evidenceIds: [id<EvidenceId>("evidence.event-failure")] }
  const solari = new ScriptedSolari([{ kind: "observed", observation: safeObservation("observation.initial"), effect: { kind: "completed" } }], [{ kind: "failed", failure, effect: { kind: "completed" } }])

  const result = await new ExperimentRunner(ports(bind(runtime), solari)).run(planResult.plan, operationController().controller)

  assert.equal(result.kind, "finalization_blocked")
  if (result.kind !== "finalization_blocked") throw new Error("expected blocked finalization")
  assert.equal(result.reason, "event_publication_failed")
  assert.equal(result.recovery?.kind, "applied")
  if (result.recovery?.kind === "applied") {
    assert.equal(result.recovery.capability.status, "degraded")
    assert.equal(result.recovery.replay.status, "broken")
  }
})

test("compiled work rejects a changed active replay before start", async () => {
  const runtime = new FakeWorthRuntime()
  const planned = await planCompiledExperiment(baseRequest([{ kind: "text_present", text: "done" }]), bind(runtime), operationContext())
  if (planned.kind !== "planned") throw new Error("expected compiled plan")
  runtime.replay = { ...runtime.replay, revision: runtime.replay.revision + 1 }

  const solari = new ScriptedSolari([], [])
  const result = await new ExperimentRunner(ports(bind(runtime), solari)).run(planned.plan, operationController().controller)
  assert.deepEqual(result, { kind: "not_started", reason: "authority_changed", message: "Worth changed the active replay after planning", events: [] })
  assert.equal(runtime.commands.length, 0)
  assert.equal(solari.sessions.length, 0)
})

test("Worth can reject execution start before Solari is called", async () => {
  const runtime = new FakeWorthRuntime()
  runtime.rejectNextStart = true
  const result = await new ExperimentRunner(ports(bind(runtime), new ScriptedSolari([], []), new FakeModel([]))).run(directPlan(), operationController().controller)
  assert.equal(result.kind, "not_started")
  if (result.kind !== "not_started") throw new Error("expected rejected start")
  assert.equal(result.reason, "execution_start_rejected")
  assert.equal(result.authority?.kind, "denied")
})

test("Worth event publication failure prevents the next external effect", async () => {
  const runtime = new FakeWorthRuntime()
  runtime.failEventPublication = true
  const solari = new ScriptedSolari([], [])
  const model = new FakeModel([])
  const result = await new ExperimentRunner(ports(bind(runtime), solari, model)).run(directPlan(), operationController().controller)
  assert.equal(result.kind, "finalization_blocked")
  if (result.kind !== "finalization_blocked") throw new Error("expected finalization block")
  assert.equal(result.reason, "event_publication_failed")
  assert.equal(result.terminal?.kind, "failure")
  if (result.terminal?.kind !== "failure") throw new Error("expected event failure terminal")
  assert.deepEqual(result.terminal.posture, { kind: "unknown", recovery: "owner_reconciliation_required" })
  assert.equal(model.calls, 0)
  assert.equal(solari.sessions.length, 0)
  assert.equal(runtime.eventAttempts, 2)
  assert.deepEqual(runtime.commands.map((command) => command.kind), ["start_execution", "complete_execution"])
})

test("an event failure after a completed browser effect stops before the next model call", async () => {
  const runtime = new FakeWorthRuntime()
  runtime.failEventType = "browser.action"
  const solari = new ScriptedSolari(
    [{ kind: "observed", observation: safeObservation("observation.initial"), effect: { kind: "completed" } }],
    [{ kind: "completed", effect: { kind: "completed" } }],
  )
  const model = new FakeModel([{ kind: "completed", completion: { output: { kind: "act", step: clickStep() }, usage: { inputTokens: 1, outputTokens: 1, estimatedModelCostUsd: 0.001 } }, effect: { kind: "completed" } }])
  const result = await new ExperimentRunner(ports(bind(runtime), solari, model)).run(directPlan(), operationController().controller)

  assert.equal(result.kind, "attempted")
  if (result.kind !== "attempted") throw new Error("expected attempted run")
  assert.deepEqual(result.terminal, { kind: "failure", message: "Worth event sink unavailable", posture: { kind: "unknown", recovery: "owner_reconciliation_required" } })
  assert.equal(model.calls, 1)
  assert.equal(solari.sessions[0]?.executedSteps.length, 1)
  assert.equal(runtime.events.some((event) => event.type === "browser.action"), false)
})

test("cancellation before browser telemetry is typed and prevents the next model effect", async () => {
  const runtime = new FakeWorthRuntime()
  const operation = operationController()
  const solari = new ScriptedSolari(
    [{ kind: "observed", observation: safeObservation("observation.initial"), effect: { kind: "completed" } }],
    [{ kind: "completed", effect: { kind: "completed" } }],
    undefined,
    operation.cancellation.cancel,
  )
  const model = new FakeModel([{ kind: "completed", completion: { output: { kind: "act", step: clickStep() }, usage: { inputTokens: 1, outputTokens: 1, estimatedModelCostUsd: 0.001 } }, effect: { kind: "completed" } }])
  const result = await new ExperimentRunner(ports(bind(runtime), solari, model)).run(directPlan(), operation.controller)

  assert.equal(result.kind, "finalization_blocked")
  if (result.kind !== "finalization_blocked") throw new Error("expected finalization block")
  assert.equal(result.reason, "event_publication_failed")
  assert.deepEqual(result.terminal, { kind: "control_stop", stop: { kind: "cancelled", terminal: true, safePoint: "after_effect", posture: { kind: "completed" } } })
  assert.equal(model.calls, 1)
  assert.equal(solari.sessions[0]?.executedSteps.length, 1)
  assert.equal(runtime.events.some((event) => event.type === "browser.action"), false)
})

test("an admitted start projection mismatch blocks all delegated effects", async () => {
  const runtime = new FakeWorthRuntime()
  runtime.mismatchStartProjection = true
  const solari = new ScriptedSolari([], [])
  const result = await new ExperimentRunner(ports(bind(runtime), solari, new FakeModel([]))).run(directPlan(), operationController().controller)

  assert.equal(result.kind, "finalization_blocked")
  if (result.kind !== "finalization_blocked") throw new Error("expected authority finalization block")
  assert.equal(result.executionId, "execution.1")
  assert.equal(result.reason, "authority_changed")
  assert.equal(result.message, "Worth accepted execution start without a matching running execution projection")
  assert.equal(result.authority?.kind, "admitted")
  assert.deepEqual(result.events, [])
  assert.deepEqual(result.cleanup, { kind: "not_created" })
  assert.equal(solari.sessions.length, 0)
})

test("cancellation after a completed delegated action is classified as an after-effect stop", async () => {
  const runtime = new FakeWorthRuntime()
  const operation = operationController()
  runtime.cancelOnBrowserAction = operation.cancellation.cancel
  const solari = new ScriptedSolari(
    [{ kind: "observed", observation: safeObservation("observation.initial"), effect: { kind: "completed" } }],
    [{ kind: "completed", effect: { kind: "completed" }, observation: safeObservation("observation.after-action") }],
  )
  const model = new FakeModel([{ kind: "completed", completion: { output: { kind: "act", step: clickStep() }, usage: { inputTokens: 1, outputTokens: 1, estimatedModelCostUsd: 0.001 } }, effect: { kind: "completed" } }])
  const result = await new ExperimentRunner(ports(bind(runtime), solari, model)).run(directPlan(), operation.controller)

  assert.equal(result.kind, "finalization_blocked")
  if (result.kind !== "finalization_blocked") throw new Error("expected finalization block")
  assert.equal(result.reason, "event_publication_failed")
  assert.deepEqual(result.terminal, { kind: "control_stop", stop: { kind: "cancelled", terminal: true, safePoint: "after_effect", posture: { kind: "completed" } } })
  assert.equal(solari.sessions[0]?.executedSteps.length, 1)
  assert.equal(solari.sessions[0]?.releaseContext, operation.controller.context)
})

test("a false semantic postcondition cannot settle a direct run as success", async () => {
  const runtime = new FakeWorthRuntime()
  const solari = new ScriptedSolari([{ kind: "observed", observation: safeObservation("observation.initial"), effect: { kind: "completed" } }], [])
  const model = new FakeModel([{ kind: "completed", completion: { output: { kind: "complete", output: { status: "done" } }, usage: { inputTokens: 1, outputTokens: 1, estimatedModelCostUsd: 0.001 } }, effect: { kind: "completed" } }])
  const result = await new ExperimentRunner(ports(bind(runtime), solari, model, new FailedVerifier())).run(directPlan([{ kind: "text_present", text: "must be present" }]), operationController().controller)

  assert.equal(result.kind, "attempted")
  if (result.kind !== "attempted") throw new Error("expected attempted run")
  assert.deepEqual(result.terminal, { kind: "failure", message: "postcondition was false" })
  assert.equal(runtime.commands.at(-1)?.kind, "complete_execution")
})

test("verifier usage is forwarded to Worth as measured model telemetry", async () => {
  const runtime = new FakeWorthRuntime()
  const solari = new ScriptedSolari([{ kind: "observed", observation: safeObservation("observation.initial"), effect: { kind: "completed" } }], [])
  const model = new FakeModel([{ kind: "completed", completion: { output: { kind: "complete", output: { status: "done" } }, usage: { inputTokens: 1, outputTokens: 1, estimatedModelCostUsd: 0.001 } }, effect: { kind: "completed" } }])
  const verifier = new FailedVerifier({ usage: { inputTokens: 5, outputTokens: 2, estimatedModelCostUsd: 0.009 } })
  const result = await new ExperimentRunner(ports(bind(runtime), solari, model, verifier)).run(directPlan([{ kind: "text_present", text: "must be present" }]), operationController().controller)

  assert.equal(result.kind, "attempted")
  const verifierEvents = runtime.events.filter((event): event is Extract<InterfaceCompilerEvent, { readonly type: "model.called" }> => event.type === "model.called" && event.payload.role === "verifier")
  assert.deepEqual(verifierEvents.map((event) => [event.payload.inputTokens, event.payload.outputTokens, event.payload.estimatedModelCostUsd]), [[5, 2, 0.009]])
  assert.equal(runtime.completed?.metrics.modelCalls, 2)
})

test("cancellation after verifier completion remains an after-effect control stop", async () => {
  const runtime = new FakeWorthRuntime()
  const operation = operationController()
  const solari = new ScriptedSolari([{ kind: "observed", observation: safeObservation("observation.initial"), effect: { kind: "completed" } }], [])
  const model = new FakeModel([{ kind: "completed", completion: { output: { kind: "complete", output: { status: "done" } }, usage: { inputTokens: 1, outputTokens: 1, estimatedModelCostUsd: 0.001 } }, effect: { kind: "completed" } }])
  const result = await new ExperimentRunner(ports(bind(runtime), solari, model, new CancellingVerifier(operation.cancellation.cancel))).run(directPlan([{ kind: "text_present", text: "done" }]), operation.controller)

  assert.equal(result.kind, "finalization_blocked")
  if (result.kind !== "finalization_blocked") throw new Error("expected finalization block")
  assert.equal(result.reason, "event_publication_failed")
  assert.deepEqual(result.terminal, { kind: "control_stop", stop: { kind: "cancelled", terminal: true, safePoint: "after_effect", posture: { kind: "completed" } } })
})

test("a direct browser failure remains an execution failure and does not degrade replay state", async () => {
  const runtime = new FakeWorthRuntime()
  const failure: ReplayFailure = { kind: "step_failed", stepIndex: 0, message: "target disappeared", evidenceIds: [id<EvidenceId>("evidence.direct-failure")] }
  const solari = new ScriptedSolari(
    [{ kind: "observed", observation: safeObservation("observation.initial"), effect: { kind: "completed" } }],
    [{ kind: "failed", failure, effect: { kind: "unknown", recovery: "owner_reconciliation_required" } }],
  )
  const model = new FakeModel([{ kind: "completed", completion: { output: { kind: "act", step: clickStep() }, usage: { inputTokens: 1, outputTokens: 1, estimatedModelCostUsd: 0.001 } }, effect: { kind: "completed" } }])
  const result = await new ExperimentRunner(ports(bind(runtime), solari, model)).run(directPlan(), operationController().controller)

  assert.equal(result.kind, "attempted")
  if (result.kind !== "attempted") throw new Error("expected attempted run")
  assert.equal(result.terminal.kind, "failure")
  assert.equal(runtime.commands.map((command) => command.kind).join(","), "start_execution,complete_execution")
  const completion = runtime.commands.at(-1)
  if (completion?.kind !== "complete_execution") throw new Error("expected completion command")
  assert.equal(completion.completion.kind, "failure")
  if (completion.completion.kind !== "failure") throw new Error("expected execution failure")
  assert.equal(completion.completion.reason, "execution_failed")
})

test("a false compiled postcondition is settled and returns the capability to exploration", async () => {
  const runtime = new FakeWorthRuntime()
  runtime.replay = verifiedReplayProjection([clickStep()])
  const planned = await planCompiledExperiment(baseRequest([{ kind: "text_present", text: "must be present" }]), bind(runtime), operationContext())
  if (planned.kind !== "planned") throw new Error("expected compiled plan")
  const solari = new ScriptedSolari([{ kind: "observed", observation: safeObservation("observation.initial"), effect: { kind: "completed" } }], [{ kind: "completed", effect: { kind: "completed" } }])
  const result = await new ExperimentRunner(ports(bind(runtime), solari, undefined, new FailedVerifier())).run(planned.plan, operationController().controller)

  assert.equal(result.kind, "attempted")
  if (result.kind !== "attempted") throw new Error("expected attempted run")
  assert.equal(result.terminal.kind, "failure")
  if (result.terminal.kind !== "failure") throw new Error("expected postcondition failure")
  assert.equal(result.terminal.replayFailure?.kind, "postcondition_failed")
  assert.deepEqual(runtime.commands.map((command) => command.kind), ["start_execution", "complete_execution"])
  assert.equal(runtime.degradationRequests.length, 1)
  assert.equal(result.recovery?.capability.status, "degraded")
})

test("compiled postcondition matching is semantic and evidence is re-authorized by Worth", async () => {
  const runtime = new FakeWorthRuntime()
  runtime.replay = verifiedReplayProjection([clickStep()])
  const requested: Condition = { kind: "custom", name: "cart_state", value: { b: 2, a: 1 } }
  const returned: Condition = { kind: "custom", value: { a: 1, b: 2 }, name: "cart_state" }
  const planned = await planCompiledExperiment(baseRequest([requested]), bind(runtime), operationContext())
  if (planned.kind !== "planned") throw new Error("expected compiled plan")
  const solari = new ScriptedSolari([{ kind: "observed", observation: safeObservation("observation.initial"), effect: { kind: "completed" } }], [{ kind: "completed", effect: { kind: "completed" } }])
  const verifier = new FailedVerifier({ condition: returned, evidenceIds: [id<EvidenceId>("evidence.authorized")] })
  const result = await new ExperimentRunner(ports(bind(runtime), solari, undefined, verifier)).run(planned.plan, operationController().controller)

  assert.equal(result.kind, "attempted")
  assert.equal(runtime.commands.some((command) => command.kind === "record_replay_failure"), false)
})

test("compiled postcondition with malformed evidence cannot degrade the active replay", async () => {
  const runtime = new FakeWorthRuntime()
  runtime.replay = verifiedReplayProjection([clickStep()])
  const planned = await planCompiledExperiment(baseRequest([{ kind: "text_present", text: "must be present" }]), bind(runtime), operationContext())
  if (planned.kind !== "planned") throw new Error("expected compiled plan")
  const solari = new ScriptedSolari([{ kind: "observed", observation: safeObservation("observation.initial"), effect: { kind: "completed" } }], [{ kind: "completed", effect: { kind: "completed" } }])
  const verifier = new FailedVerifier({ evidenceIds: [id<EvidenceId>("evidence.duplicate"), id<EvidenceId>("evidence.duplicate")] })
  const result = await new ExperimentRunner(ports(bind(runtime), solari, undefined, verifier)).run(planned.plan, operationController().controller)

  assert.equal(result.kind, "attempted")
  assert.equal(runtime.commands.some((command) => command.kind === "record_replay_failure"), false)
  assert.deepEqual(runtime.commands.map((command) => command.kind), ["start_execution", "complete_execution"])
})

test("a model budget stop completes the external execution as an explicit control failure", async () => {
  const runtime = new FakeWorthRuntime()
  const solari = new ScriptedSolari([{ kind: "observed", observation: safeObservation("observation.initial"), effect: { kind: "completed" } }], [])
  const model = new FakeModel([])
  const result = await new ExperimentRunner(ports(bind(runtime), solari, model)).run(directPlan(), operationController({ maxModelCalls: 0 }).controller)

  assert.equal(result.kind, "attempted")
  if (result.kind !== "attempted") throw new Error("expected attempted run")
  assert.equal(result.terminal.kind, "control_stop")
  if (result.terminal.kind !== "control_stop") throw new Error("expected control stop")
  assert.equal(result.terminal.stop.kind, "budget_exhausted")
  assert.equal(model.calls, 0)
  assert.equal(solari.sessions[0]?.executedSteps.length, 0)
  assert.equal(runtime.commands.at(-1)?.kind, "complete_execution")
})

test("cleanup failure cannot be reported as a successful delegated execution", async () => {
  const runtime = new FakeWorthRuntime()
  const solari = new ScriptedSolari(
    [{ kind: "observed", observation: safeObservation("observation.initial"), effect: { kind: "completed" } }],
    [],
    { kind: "close_failed", message: "browser release failed", retryable: true, effect: { kind: "unknown", recovery: "owner_reconciliation_required" } },
  )
  const model = new FakeModel([{ kind: "completed", completion: { output: { kind: "complete", output: { status: "done" } }, usage: { inputTokens: 1, outputTokens: 1, estimatedModelCostUsd: 0.001 } }, effect: { kind: "completed" } }])
  const result = await new ExperimentRunner(ports(bind(runtime), solari, model)).run(directPlan(), operationController().controller)

  assert.equal(result.kind, "attempted")
  if (result.kind !== "attempted") throw new Error("expected attempted run")
  assert.equal(result.terminal.kind, "failure")
  if (result.terminal.kind !== "failure") throw new Error("expected cleanup failure")
  assert.match(result.terminal.message, /cleanup requires owner reconciliation/)
  assert.equal(result.cleanup.kind, "close_failed")
})

test("cancellation before execution does not create a Worth run or Solari session", async () => {
  const runtime = new FakeWorthRuntime()
  const solari = new ScriptedSolari([], [])
  const operation = operationController()
  operation.cancellation.cancel()
  const result = await new ExperimentRunner(ports(bind(runtime), solari)).run(directPlan(), operation.controller)

  assert.deepEqual(result, {
    kind: "not_started",
    reason: "operation_stopped",
    stop: { kind: "cancelled", terminal: true, safePoint: "before_effect", posture: { kind: "not_started" } },
    events: [],
  })
  assert.equal(runtime.commands.length, 0)
  assert.equal(solari.sessions.length, 0)
})
