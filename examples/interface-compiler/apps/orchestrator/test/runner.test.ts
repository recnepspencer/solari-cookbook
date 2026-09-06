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
  type SolariEvidenceResult,
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
  type WorthExecutionAdmissionResult,
  type WorthRuntimeSettlementResult,
  type ReplayDegradationRequest,
  type ReplayRecoveryResult,
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
import { discoverReplacementReplay } from "../src/replay-discovery.js"

const timestamp = "2026-08-31T12:00:00.000Z" as IsoTimestamp
const application = validValue(createApplication({ id: id<ApplicationId>("application.shop"), name: "Shop", baseUrl: "https://shop.test" }))
const capabilityId = id<CapabilityId>("capability.add-to-cart")
const replayId = id<ReplayVersionId>("replay.add-to-cart.v1")
const sessionId = id<SessionId>("session.test")
const capabilityContract = {
  inputSchema: { type: "object", additionalProperties: true },
  outputSchema: { type: "object", properties: { status: { type: "string" } }, required: ["status"], additionalProperties: false },
  preconditions: [],
  postconditions: [{ kind: "text_present", text: "done" }],
  publication: { audience: "gemini_consumer", disclosure: "semantic_only" },
} as const

function id<T extends string>(value: string): T {
  return value as T
}

const clock: Clock = { now: () => timestamp }

function operationController(options: { readonly maxModelCalls?: number; readonly maxBrowserActions?: number; readonly clock?: Clock } = {}) {
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
  const result = createOperationController({ admittedContext: context, clock: options.clock ?? clock })
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
  public readonly executedStepIndices: number[] = []
  public observeCalls = 0
  public released = false
  public releaseContext: OperationContext | undefined

  public constructor(
    private readonly observations: SolariObservationResult[],
    private readonly stepResults: SolariStepResult[],
    private readonly releaseResult: SolariCloseResult = { kind: "closed", sessionId, effect: { kind: "completed" } },
    private readonly beforeStep?: () => void,
    private readonly evidenceResult: SolariEvidenceResult = { kind: "captured", reference: { evidenceId: id<EvidenceId>("evidence.solari.session-receipt"), kind: "session_receipt", externalRef: "solari-session:session.test" }, effect: { kind: "completed" } },
  ) {}

  public async observe(_context: OperationContext): Promise<SolariObservationResult> {
    this.observeCalls += 1
    return this.observations.shift() ?? { kind: "observed", observation: safeObservation(`observation.fallback.${this.observeCalls}`), effect: { kind: "completed" } }
  }

  public async executeStep(step: ReplayStep, _context: OperationContext, stepIndex = 0): Promise<SolariStepResult> {
    this.executedSteps.push(step)
    this.executedStepIndices.push(stepIndex)
    this.beforeStep?.()
    return this.stepResults.shift() ?? { kind: "completed", effect: { kind: "completed" } }
  }

  public async captureEvidence(_request: EvidenceCaptureRequest, _context: OperationContext) {
    return this.evidenceResult
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
    private readonly evidenceResult?: SolariEvidenceResult,
  ) {}

  public async createSession(_request: Parameters<SolariPort["createSession"]>[0], _context: OperationContext): Promise<SolariSessionResult> {
    const session = new FakeSession([...this.observations], [...this.steps], this.releaseResult, this.beforeStep, this.evidenceResult)
    this.sessions.push(session)
    return { kind: "created", lease: { session, release: (context) => session.release(context) }, effect: { kind: "completed" } }
  }
}

class FakeModel implements ReasoningModel {
  public calls = 0
  public readonly schemas: Schema<unknown>[] = []

  public constructor(private readonly results: readonly ReasoningResult<unknown>[]) {}

  public async structuredComplete<TInput, TOutput>(_input: TInput, schema: Schema<TOutput>, _context: OperationContext): Promise<ReasoningResult<TOutput>> {
    this.calls += 1
    this.schemas.push(schema as Schema<unknown>)
    return (this.results[this.calls - 1] ?? {
      kind: "failed",
      message: "scripted model exhausted",
      retryable: false,
      effect: { kind: "unknown", recovery: "owner_reconciliation_required" },
    }) as ReasoningResult<TOutput>
  }
}

class FailedVerifier implements SemanticVerifier {
  public readonly modelUsage = "none" as const
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

class SuccessfulVerifier implements SemanticVerifier {
  public readonly modelUsage = "none" as const
  public async verify(_request: Parameters<SemanticVerifier["verify"]>[0], _context: OperationContext): Promise<SemanticVerificationResult> {
    return { kind: "verified", output: { status: "done" }, effect: { kind: "completed" } }
  }
}

class DeterministicSuccessfulVerifier extends SuccessfulVerifier {
  public readonly modelUsage = "none" as const
}

class CancellingVerifier implements SemanticVerifier {
  public readonly modelUsage = "none" as const
  public constructor(private readonly cancel: () => void) {}

  public async verify(_request: Parameters<SemanticVerifier["verify"]>[0], _context: OperationContext): Promise<SemanticVerificationResult> {
    this.cancel()
    return { kind: "verified", output: { status: "done" }, effect: { kind: "completed" } }
  }
}

class FakeWorthRuntime {
  public readonly commands: WorthCommand[] = []
  public readonly events: InterfaceCompilerEvent[] = []
  public capability: CapabilityProjection = {
    projectionKind: "worth_capability",
    id: capabilityId,
    revision: 4,
    applicationId: application.id,
    name: "AddToCart",
    description: "Add an item to the cart",
    ...capabilityContract,
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
  public readonly registeredEvidenceIds = new Set<EvidenceId>()

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

  public async readExecution(executionId: ExecutionId, _context: OperationContext): Promise<WorthReadResult<ExecutionProjection>> {
    return this.completed?.id === executionId
      ? { kind: "found", value: this.completed }
      : { kind: "not_found", entity: "execution", entityId: executionId }
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
    ...capabilityContract,
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
    estimatedModelCostMicrocents: modelEvents.reduce((total, event) => total + (event.type === "model.called" ? event.payload.estimatedModelCostMicrocents : 0), 0),
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

function discoveryIds(): Pick<IdSource, "nextExecutionId" | "nextEventId" | "nextExperimentId" | "nextReplayVersionId"> {
  let next = 0
  return {
    nextExecutionId: () => id<ExecutionId>(`execution.discovery.${++next}`),
    nextEventId: () => id<EventId>(`event.discovery.${++next}`),
    nextExperimentId: () => id<ExperimentId>(`experiment.discovery.${++next}`),
    nextReplayVersionId: () => id<ReplayVersionId>(`replay.discovery.${++next}`),
  }
}

function appliedDegradation(): Extract<ReplayRecoveryResult, { readonly kind: "applied" }> {
  const failure: ReplayFailure = { kind: "step_failed", stepIndex: 0, message: "target disappeared", evidenceIds: [id<EvidenceId>("evidence.discovery.failure")] }
  return {
    kind: "applied",
    commit: "committed",
    capability: degradedCapabilityProjection(failure),
    replay: {
      projectionKind: "worth_replay",
      id: replayId,
      revision: 8,
      capabilityId,
      version: 1,
      steps: verifiedReplayProjection().steps,
      confidence: 0.9,
      createdAt: timestamp,
      status: "broken",
      brokenAt: "2026-08-31T11:59:00.000Z" as IsoTimestamp,
      failure,
    },
    capabilityEvidence: { queryName: "test", queryIdentity: "test", basisVersion: 1, projectedRecordCount: 1, projectedFieldCount: 8, basisReleased: true },
    replayEvidence: { queryName: "test", queryIdentity: "test", basisVersion: 1, projectedRecordCount: 1, projectedFieldCount: 8, basisReleased: true },
  }
}

function bind(runtime: FakeWorthRuntime): OrchestratorWorthPort {
  const evidence = { queryName: "test", queryIdentity: "test", basisVersion: 1, projectedRecordCount: 1, projectedFieldCount: 8, basisReleased: true } as const
  return {
    readApplication: async (id, context) => {
      const result = await runtime.readApplication(id, context)
      return result.kind === "found" ? { ...result, evidence } : result
    },
    readCapability: async (id, context) => {
      const result = await runtime.readCapability(id, context)
      return result.kind === "found" ? { ...result, evidence, compilationProvenance: { kind: "synthetic_seed" } } : result
    },
    readActiveReplay: async (id, context) => {
      const result = await runtime.readActiveReplay(id, context)
      return result.kind === "found" ? { ...result, evidence, compilationProvenance: { kind: "synthetic_seed" } } : result
    },
    readRecoveryProjection: async () => ({ kind: "denied", message: "recovery projection flow is not scripted in runner tests" }),
    publish: (event, context) => runtime.publishEvent(event, context),
    admitExecution: async (execution, context): Promise<WorthExecutionAdmissionResult> => {
      const result = await runtime.submit({ kind: "start_execution", execution }, context)
      if (result.kind !== "accepted" || result.projection.kind !== "execution") return result.kind === "cancelled" || result.kind === "timed_out" ? result : { kind: "denied", executionId: execution.id, message: "test WORTH admission rejected" }
      const projection = result.projection.projection
      return { kind: "admitted", commit: "committed", projection: { projectionKind: "worth_running_execution", executionId: projection.id, capabilityId: projection.capabilityId, ...(projection.replayVersionId === undefined ? {} : { replayVersionId: projection.replayVersionId }), mode: projection.mode, lifecycle: "started", revision: projection.revision, metrics: projection.metrics }, evidence }
    },
    settleExecution: async (executionId, completion, endedAt, revision, context): Promise<WorthRuntimeSettlementResult> => {
      const result = await runtime.submit({ kind: "complete_execution", executionId, completion, endedAt, expectedExecutionRevision: revision }, context)
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
      if (completed.outcome.replayFailure.kind === "postcondition_failed" && completed.outcome.replayFailure.evidenceIds.some((evidenceId) => !runtime.registeredEvidenceIds.has(evidenceId))) return { kind: "denied", stage: "operation_admission", message: "WORTH has no retained Solari evidence for the failed postcondition" }
      if (completed.metrics.endedAt === undefined) return { kind: "denied", stage: "dependency_projection", message: "WORTH terminal time is absent" }
      return {
        kind: "applied",
        commit: "committed",
        capability: { projectionKind: "worth_capability", id: runtime.capability.id, revision: runtime.capability.revision + 1, applicationId: runtime.capability.applicationId, name: runtime.capability.name, description: runtime.capability.description, ...capabilityContract, status: "degraded", brokenReplayVersionId: request.replayVersionId, failure: completed.outcome.replayFailure, mode: "exploratory" },
        replay: { projectionKind: "worth_replay", id: runtime.replay.id, revision: runtime.replay.revision + 1, capabilityId: runtime.replay.capabilityId, version: runtime.replay.version, steps: runtime.replay.steps, confidence: runtime.replay.confidence, createdAt: runtime.replay.createdAt, status: "broken", brokenAt: completed.metrics.endedAt, failure: completed.outcome.replayFailure },
        capabilityEvidence: evidence,
        replayEvidence: evidence,
      }
    },
    acceptReplacementCandidate: async () => ({ kind: "denied", stage: "request", message: "candidate flow is not scripted in runner tests" }),
    registerVerificationEvidence: async (request) => {
      if (request.expectedCapabilityRevision !== runtime.capability.revision) return { kind: "stale", entity: "capability", entityId: request.capabilityId, expectedRevision: request.expectedCapabilityRevision, actualRevision: runtime.capability.revision }
      if (request.expectedReplayRevision !== runtime.replay.revision) return { kind: "stale", entity: "replay", entityId: request.replayVersionId, expectedRevision: request.expectedReplayRevision, actualRevision: runtime.replay.revision }
      if (runtime.capability.status !== "healthy" || runtime.capability.activeReplayVersionId !== request.replayVersionId || runtime.replay.status !== "active" || request.evidence.kind !== "session_receipt" || request.evidence.evidenceId === id<EvidenceId>("")) return { kind: "denied", stage: "operation_admission", message: "evidence does not belong to the active replay" }
      runtime.registeredEvidenceIds.add(request.evidence.evidenceId)
      runtime.replay = { ...runtime.replay, revision: runtime.replay.revision + 1 }
      return { kind: "applied", commit: "committed", capability: runtime.capability, replay: runtime.replay, capabilityEvidence: evidence, replayEvidence: evidence }
    },
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

test("a fresh blank Solari page navigates to the admitted origin before direct reasoning", async () => {
  const runtime = new FakeWorthRuntime()
  const blank = { ...safeObservation("observation.blank"), url: "about:blank" }
  const solari = new ScriptedSolari(
    [{ kind: "observed", observation: blank, effect: { kind: "completed" } }],
    [{ kind: "completed", observation: safeObservation("observation.after-initial-navigation"), effect: { kind: "completed" } }],
  )
  const model = new FakeModel([
    { kind: "completed", completion: { output: { kind: "stop", signal: { kind: "authentication_required", credential: "unknown" } }, usage: { inputTokens: 1, outputTokens: 1, estimatedModelCostMicrocents: 100000 } }, effect: { kind: "completed" } },
  ])
  const result = await new ExperimentRunner(ports(bind(runtime), solari, model)).run(directPlan(), operationController().controller)

  assert.equal(result.kind, "attempted")
  if (result.kind !== "attempted") throw new Error("expected attempted run")
  assert.equal(result.terminal.kind, "safety_stop")
  assert.equal(model.calls, 1)
  assert.deepEqual(solari.sessions[0]?.executedSteps, [{ type: "navigate", url: "https://shop.test" }])
})

test("direct planning and execution publish only actual model/browser telemetry to Worth", async () => {
  const runtime = new FakeWorthRuntime()
  const solari = new ScriptedSolari(
    [{ kind: "observed", observation: safeObservation("observation.initial"), effect: { kind: "completed" } }],
    [{ kind: "completed", effect: { kind: "completed" }, observation: safeObservation("observation.after-action") }],
  )
  const model = new FakeModel([
    { kind: "completed", completion: { output: { kind: "act", step: clickStep() }, usage: { inputTokens: 3, outputTokens: 4, estimatedModelCostMicrocents: 1000000 } }, effect: { kind: "completed" } },
    { kind: "completed", completion: { output: { kind: "complete", output: { status: "done" } }, usage: { inputTokens: 2, outputTokens: 1, estimatedModelCostMicrocents: 200000 } }, effect: { kind: "completed" } },
  ])
  const result = await new ExperimentRunner(ports(bind(runtime), solari, model, undefined)).run(directPlan(), operationController({ maxModelCalls: 3, maxBrowserActions: 2 }).controller)

  assert.equal(result.kind, "attempted")
  if (result.kind !== "attempted") throw new Error("expected attempted run")
  assert.deepEqual(result.terminal, { kind: "success", output: { status: "done" }, successfulSteps: [clickStep()] })
  assert.equal(solari.sessions[0]?.executedSteps.length, 1)
  const modelEvents = runtime.events.filter((event) => event.type === "model.called")
  assert.deepEqual(modelEvents.map((event) => [event.payload.inputTokens, event.payload.outputTokens, event.payload.estimatedModelCostMicrocents]), [[3, 4, 1_000_000], [2, 1, 200_000]])
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
  assert.equal(runtime.completed?.metrics.estimatedModelCostMicrocents, 1_200_000)
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
  assert.equal(runtime.events.find((event) => event.type === "browser.action")?.idempotencyKey, `browser.action:execution.1:${replayId}:0`)
})

test("compiled execution permits a declared deterministic verifier when model calls are disabled", async () => {
  const runtime = new FakeWorthRuntime()
  runtime.replay = verifiedReplayProjection([{ type: "wait", milliseconds: 0 }])
  const worth = bind(runtime)
  const planned = await planCompiledExperiment(baseRequest([{ kind: "text_present", text: "done" }]), worth, operationContext())
  if (planned.kind !== "planned") throw new Error("expected compiled plan")
  const solari = new ScriptedSolari(
    [{ kind: "observed", observation: safeObservation("observation.initial"), effect: { kind: "completed" } }],
    [{ kind: "completed", effect: { kind: "completed" }, observation: { ...safeObservation("observation.after-action"), pageSummary: "done" } }],
  )

  const result = await new ExperimentRunner(ports(worth, solari, undefined, new DeterministicSuccessfulVerifier())).run(
    planned.plan,
    operationController({ maxModelCalls: 0, maxBrowserActions: 1 }).controller,
  )

  assert.equal(result.kind, "attempted")
  if (result.kind !== "attempted") throw new Error("expected attempted run")
  assert.deepEqual(result.terminal, { kind: "success", output: { status: "done" } })
  assert.equal(runtime.events.some((event) => event.type === "model.called"), false)
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

test("a not-started compiled replay failure settles and degrades through the WORTH recovery facade", async () => {
  const runtime = new FakeWorthRuntime()
  const planResult = await planCompiledExperiment(baseRequest([{ kind: "text_present", text: "done" }]), bind(runtime), operationContext())
  if (planResult.kind !== "planned") throw new Error("expected compiled plan")
  const failure: ReplayFailure = { kind: "step_failed", stepIndex: 0, message: "target disappeared", evidenceIds: [id<EvidenceId>("evidence.1")] }
  const solari = new ScriptedSolari(
    [{ kind: "observed", observation: safeObservation("observation.initial"), effect: { kind: "completed" } }],
    [{ kind: "failed", failure, effect: { kind: "not_started" } }],
  )
  const result = await new ExperimentRunner(ports(bind(runtime), solari)).run(planResult.plan, operationController().controller)

  assert.equal(result.kind, "attempted")
  if (result.kind !== "attempted") throw new Error("expected attempted run")
  assert.equal(result.terminal.kind, "failure")
  if (result.terminal.kind === "failure") assert.equal(result.terminal.classification, "ui_drift")
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

test("compiled execution carries the real nonzero replay index through the Solari port", async () => {
  const runtime = new FakeWorthRuntime()
  runtime.replay = verifiedReplayProjection([clickStep(), clickStep("Open cart")])
  const planResult = await planCompiledExperiment(baseRequest([{ kind: "text_present", text: "done" }]), bind(runtime), operationContext())
  if (planResult.kind !== "planned") throw new Error("expected compiled plan")
  const failure: ReplayFailure = { kind: "step_failed", stepIndex: 1, message: "second target disappeared", evidenceIds: [id<EvidenceId>("evidence.step-index")] }
  const solari = new ScriptedSolari(
    [
      { kind: "observed", observation: safeObservation("observation.index.initial"), effect: { kind: "completed" } },
      { kind: "observed", observation: safeObservation("observation.index.after-first"), effect: { kind: "completed" } },
    ],
    [{ kind: "completed", effect: { kind: "completed" } }, { kind: "failed", failure, effect: { kind: "not_started" } }],
  )
  await new ExperimentRunner(ports(bind(runtime), solari)).run(planResult.plan, operationController().controller)
  assert.deepEqual(solari.sessions[0]?.executedStepIndices, [0, 1])
})

test("compiled execution enforces WORTH preconditions before every replay action", async () => {
  const runtime = new FakeWorthRuntime()
  runtime.capability = {
    ...runtime.capability,
    preconditions: [{ kind: "text_present", text: "source message delivered" }],
  }
  const worth = bind(runtime)
  const planned = await planCompiledExperiment({
    ...baseRequest([{ kind: "text_present", text: "caller supplied condition" }]),
    preconditions: [],
  }, worth, operationContext())
  if (planned.kind !== "planned") throw new Error("expected compiled plan")
  assert.deepEqual(planned.plan.request.preconditions, runtime.capability.preconditions)
  assert.deepEqual(planned.plan.request.expectedOutcome, runtime.capability.postconditions)

  const solari = new ScriptedSolari([
    { kind: "observed", observation: safeObservation("observation.precondition-missing"), effect: { kind: "completed" } },
  ], [])
  const verifier = new FailedVerifier({ evidenceIds: [] })
  const result = await new ExperimentRunner(ports(worth, solari, undefined, verifier)).run(planned.plan, operationController().controller)

  assert.equal(result.kind, "attempted")
  if (result.kind !== "attempted") throw new Error("expected attempted run")
  assert.equal(result.terminal.kind, "failure")
  if (result.terminal.kind !== "failure") throw new Error("expected failure")
  assert.equal(result.terminal.classification, "precondition_failed")
  assert.equal(solari.sessions[0]?.executedSteps.length, 0)
  assert.equal(runtime.degradationRequests.length, 0)
  const completed = runtime.completed
  assert.equal(completed?.status, "failure")
  if (completed?.status === "failure") assert.equal(completed.outcome.reason, "execution_failed")
})

test("a present semantic target makes an action failure an execution incident instead of UI drift", async () => {
  const runtime = new FakeWorthRuntime()
  const planResult = await planCompiledExperiment(baseRequest([{ kind: "text_present", text: "done" }]), bind(runtime), operationContext())
  if (planResult.kind !== "planned") throw new Error("expected compiled plan")
  const failure: ReplayFailure = { kind: "step_failed", stepIndex: 0, message: "click transport failed", evidenceIds: [id<EvidenceId>("evidence.interaction")] }
  const observation: Observation = {
    ...safeObservation("observation.target-present"),
    interactables: [{ kind: "button", role: "button", name: "Add to cart", semanticGuess: "Add to cart" }],
  }
  const solari = new ScriptedSolari(
    [{ kind: "observed", observation, effect: { kind: "completed" } }],
    [{ kind: "failed", failure, effect: { kind: "not_started" } }],
  )
  const result = await new ExperimentRunner(ports(bind(runtime), solari)).run(planResult.plan, operationController().controller)

  assert.equal(result.kind, "attempted")
  if (result.kind !== "attempted" || result.terminal.kind !== "failure") throw new Error("expected attempted failure")
  assert.equal(result.terminal.classification, "interaction_failed")
  assert.equal(result.terminal.replayFailure, undefined)
  assert.equal(runtime.degradationRequests.length, 0)
  const completion = runtime.commands.at(-1)
  if (completion?.kind !== "complete_execution" || completion.completion.kind !== "failure") throw new Error("expected failure completion")
  assert.equal(completion.completion.reason, "execution_failed")
})

test("an uncertain compiled action effect is a provider incident and cannot degrade replay state", async () => {
  const runtime = new FakeWorthRuntime()
  const planResult = await planCompiledExperiment(baseRequest([{ kind: "text_present", text: "done" }]), bind(runtime), operationContext())
  if (planResult.kind !== "planned") throw new Error("expected compiled plan")
  const failure: ReplayFailure = { kind: "step_failed", stepIndex: 0, message: "provider lost the action response", evidenceIds: [id<EvidenceId>("evidence.uncertain")] }
  const solari = new ScriptedSolari(
    [{ kind: "observed", observation: safeObservation("observation.initial"), effect: { kind: "completed" } }],
    [{ kind: "failed", failure, effect: { kind: "unknown", recovery: "owner_reconciliation_required" } }],
  )

  const result = await new ExperimentRunner(ports(bind(runtime), solari)).run(planResult.plan, operationController().controller)

  assert.equal(result.kind, "attempted")
  if (result.kind !== "attempted" || result.terminal.kind !== "failure") throw new Error("expected attempted failure")
  assert.equal(result.terminal.classification, "provider_failure")
  assert.equal(result.terminal.replayFailure, undefined)
  assert.equal(runtime.degradationRequests.length, 0)
})

test("cancellation after a failed compiled action wins before drift diagnosis", async () => {
  const runtime = new FakeWorthRuntime()
  const operation = operationController()
  const planned = await planCompiledExperiment(baseRequest([{ kind: "text_present", text: "done" }]), bind(runtime), operation.controller.context)
  if (planned.kind !== "planned") throw new Error("expected compiled plan")
  const failure: ReplayFailure = { kind: "step_failed", stepIndex: 0, message: "target disappeared", evidenceIds: [id<EvidenceId>("evidence.cancelled-failure")] }
  const solari = new ScriptedSolari(
    [{ kind: "observed", observation: safeObservation("observation.initial"), effect: { kind: "completed" } }],
    [{ kind: "failed", failure, effect: { kind: "not_started" } }],
    undefined,
    operation.cancellation.cancel,
  )

  const result = await new ExperimentRunner(ports(bind(runtime), solari)).run(planned.plan, operation.controller)

  const terminal = "terminal" in result ? result.terminal : undefined
  if (terminal === undefined) throw new Error("expected terminal result")
  assert.equal(terminal.kind, "control_stop")
  if (terminal.kind === "control_stop") assert.equal(terminal.stop.kind, "cancelled")
  assert.equal(runtime.degradationRequests.length, 0)
  assert.equal(solari.sessions[0]?.observeCalls, 1)
})

test("deadline expiry after a failed compiled action wins before drift diagnosis", async () => {
  const runtime = new FakeWorthRuntime()
  let currentTime = timestamp
  const operation = operationController({ clock: { now: () => currentTime } })
  const planned = await planCompiledExperiment(baseRequest([{ kind: "text_present", text: "done" }]), bind(runtime), operation.controller.context)
  if (planned.kind !== "planned") throw new Error("expected compiled plan")
  const failure: ReplayFailure = { kind: "step_failed", stepIndex: 0, message: "target disappeared", evidenceIds: [id<EvidenceId>("evidence.deadline-failure")] }
  const solari = new ScriptedSolari(
    [{ kind: "observed", observation: safeObservation("observation.initial"), effect: { kind: "completed" } }],
    [{ kind: "failed", failure, effect: { kind: "not_started" } }],
    undefined,
    () => { currentTime = "2026-08-31T12:02:00.000Z" as IsoTimestamp },
  )

  const result = await new ExperimentRunner(ports(bind(runtime), solari)).run(planned.plan, operation.controller)

  const terminal = "terminal" in result ? result.terminal : undefined
  if (terminal === undefined) throw new Error("expected terminal result")
  assert.equal(terminal.kind, "control_stop")
  if (terminal.kind === "control_stop") assert.equal(terminal.stop.kind, "deadline_exceeded")
  assert.equal(runtime.degradationRequests.length, 0)
  assert.equal(solari.sessions[0]?.observeCalls, 1)
})

test("a failed navigation is classified as availability and never rewrites the replay", async () => {
  const runtime = new FakeWorthRuntime()
  runtime.replay = verifiedReplayProjection([{ type: "navigate", url: "https://shop.test/products" }])
  const planResult = await planCompiledExperiment(baseRequest([{ kind: "text_present", text: "done" }]), bind(runtime), operationContext())
  if (planResult.kind !== "planned") throw new Error("expected compiled plan")
  const failure: ReplayFailure = { kind: "step_failed", stepIndex: 0, message: "application did not respond", evidenceIds: [id<EvidenceId>("evidence.availability")] }
  const solari = new ScriptedSolari(
    [{ kind: "observed", observation: safeObservation("observation.before-outage"), effect: { kind: "completed" } }],
    [{ kind: "failed", failure, effect: { kind: "not_started" } }],
  )
  const result = await new ExperimentRunner(ports(bind(runtime), solari)).run(planResult.plan, operationController().controller)

  assert.equal(result.kind, "attempted")
  if (result.kind !== "attempted" || result.terminal.kind !== "failure") throw new Error("expected attempted failure")
  assert.equal(result.terminal.classification, "application_unavailable")
  assert.equal(result.terminal.replayFailure, undefined)
  assert.equal(runtime.degradationRequests.length, 0)
})

test("Gemini discovery compiles only the semantic actions that Solari actually executed", async () => {
  const runtime = new FakeWorthRuntime()
  const solari = new ScriptedSolari(
    [{ kind: "observed", observation: { ...safeObservation("observation.discovery.blank"), url: "about:blank" }, effect: { kind: "completed" } }],
    [
      { kind: "completed", observation: safeObservation("observation.discovery.initial"), effect: { kind: "completed" } },
      { kind: "completed", observation: safeObservation("observation.discovery.delivered"), effect: { kind: "completed" } },
    ],
  )
  const model = new FakeModel([
    { kind: "completed", completion: { output: { kind: "act", step: clickStep("Deliver shipment") }, usage: { inputTokens: 10, outputTokens: 4, estimatedModelCostMicrocents: 2_000 } }, effect: { kind: "completed" } },
    { kind: "completed", completion: { output: { kind: "complete", output: { status: "done" } }, usage: { inputTokens: 8, outputTokens: 2, estimatedModelCostMicrocents: 1_000 } }, effect: { kind: "completed" } },
  ])
  const ids = discoveryIds()
  const result = await discoverReplacementReplay({
    degradation: appliedDegradation(),
    application,
    objective: "deliver the shipment",
    expectedOutcome: [{ kind: "text_present", text: "Delivered" }],
  }, { clock, ids, worth: bind(runtime), solari, model, verifier: new SuccessfulVerifier() }, operationController().controller)

  assert.equal(result.kind, "discovered")
  if (result.kind !== "discovered") throw new Error("expected a discovered replay")
  assert.equal(result.candidate.version, 2)
  assert.equal(result.candidate.supersedes, replayId)
  assert.equal(result.candidate.discoveredFromExperimentId.startsWith("experiment.discovery."), true)
  assert.deepEqual(result.candidate.steps, [
    { type: "navigate", url: application.baseUrl },
    clickStep("Deliver shipment"),
    { type: "assert", condition: { kind: "text_present", text: "Delivered" } },
  ])
  assert.deepEqual(solari.sessions[0]?.executedSteps, [{ type: "navigate", url: application.baseUrl }, clickStep("Deliver shipment")])
  assert.equal(model.schemas[0]?.name, "interface_compiler_semantic_discovery_decision")
  assert.deepEqual((((model.schemas[0]?.json as { properties?: Record<string, unknown> }).properties?.step as { properties?: Record<string, unknown> }).properties?.type as { enum?: readonly unknown[] }).enum, ["click", "fill", "select", "wait"])
  assert.equal(runtime.completed?.metrics.modelCalls, 2)
  assert.equal(runtime.completed?.metrics.browserActions, 2)
})

test("Gemini discovery treats an unverified completion claim as feedback and keeps exploring", async () => {
  const runtime = new FakeWorthRuntime()
  const solari = new ScriptedSolari(
    [{ kind: "observed", observation: { ...safeObservation("observation.discovery-feedback.blank"), url: "about:blank" }, effect: { kind: "completed" } }],
    [
      { kind: "completed", observation: safeObservation("observation.discovery-feedback.initial"), effect: { kind: "completed" } },
      { kind: "completed", observation: safeObservation("observation.discovery-feedback.delivered"), effect: { kind: "completed" } },
    ],
  )
  const model = new FakeModel([
    { kind: "completed", completion: { output: { kind: "complete" }, usage: { inputTokens: 6, outputTokens: 1, estimatedModelCostMicrocents: 500 } }, effect: { kind: "completed" } },
    { kind: "completed", completion: { output: { kind: "act", step: clickStep("Deliver shipment") }, usage: { inputTokens: 8, outputTokens: 3, estimatedModelCostMicrocents: 1_000 } }, effect: { kind: "completed" } },
    { kind: "completed", completion: { output: { kind: "complete", output: { status: "done" } }, usage: { inputTokens: 7, outputTokens: 2, estimatedModelCostMicrocents: 800 } }, effect: { kind: "completed" } },
  ])
  let verificationCalls = 0
  const verifier: SemanticVerifier = {
    modelUsage: "none",
    verify: async (request) => {
      verificationCalls += 1
      if (verificationCalls === 1) return { kind: "failed", condition: request.conditions[0] as Condition, message: "receipt is not visible yet", retryable: false, evidenceIds: [], effect: { kind: "completed" } }
      return { kind: "verified", output: { status: "done" }, effect: { kind: "completed" } }
    },
  }

  const result = await discoverReplacementReplay({
    degradation: appliedDegradation(),
    application,
    objective: "deliver the shipment",
    expectedOutcome: [{ kind: "text_present", text: "Delivered" }],
  }, { clock, ids: discoveryIds(), worth: bind(runtime), solari, model, verifier }, operationController().controller)

  assert.equal(result.kind, "discovered")
  if (result.kind !== "discovered") throw new Error("expected a discovered replay")
  assert.deepEqual(result.candidate.steps, [
    { type: "navigate", url: application.baseUrl },
    clickStep("Deliver shipment"),
    { type: "assert", condition: { kind: "text_present", text: "Delivered" } },
  ])
  assert.equal(verificationCalls, 2)
  assert.equal(model.calls, 3)
})

test("Gemini discovery rejects selector-bearing proposals before Solari executes them", async () => {
  const runtime = new FakeWorthRuntime()
  const solari = new ScriptedSolari(
    [{ kind: "observed", observation: safeObservation("observation.discovery.selector"), effect: { kind: "completed" } }],
    [],
  )
  const model = new FakeModel([{
    kind: "completed",
    completion: {
      output: { kind: "act", step: { type: "click", target: { semanticDescription: "Deliver shipment", selector: "#deliver" } } },
      usage: { inputTokens: 10, outputTokens: 4, estimatedModelCostMicrocents: 2_000 },
    },
    effect: { kind: "completed" },
  }])
  const result = await discoverReplacementReplay({
    degradation: appliedDegradation(),
    application,
    objective: "deliver the shipment",
    expectedOutcome: [{ kind: "text_present", text: "Delivered" }],
  }, { clock, ids: discoveryIds(), worth: bind(runtime), solari, model, verifier: new SuccessfulVerifier() }, operationController().controller)

  assert.equal(result.kind, "blocked")
  if (result.kind !== "blocked") throw new Error("expected blocked discovery")
  assert.equal(result.stage, "exploration")
  assert.deepEqual(solari.sessions[0]?.executedSteps, [])
})

test("compiled replay failure blocks finalization when WORTH denies degradation", async () => {
  const runtime = new FakeWorthRuntime()
  runtime.denyDegradation = true
  const planResult = await planCompiledExperiment(baseRequest([{ kind: "text_present", text: "done" }]), bind(runtime), operationContext())
  if (planResult.kind !== "planned") throw new Error("expected compiled plan")
  const failure: ReplayFailure = { kind: "step_failed", stepIndex: 0, message: "target disappeared", evidenceIds: [id<EvidenceId>("evidence.denied")] }
  const solari = new ScriptedSolari([{ kind: "observed", observation: safeObservation("observation.initial"), effect: { kind: "completed" } }], [{ kind: "failed", failure, effect: { kind: "not_started" } }])
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
  const solari = new ScriptedSolari([{ kind: "observed", observation: safeObservation("observation.initial"), effect: { kind: "completed" } }], [{ kind: "failed", failure, effect: { kind: "not_started" } }])

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
  const model = new FakeModel([{ kind: "completed", completion: { output: { kind: "act", step: clickStep() }, usage: { inputTokens: 1, outputTokens: 1, estimatedModelCostMicrocents: 100000 } }, effect: { kind: "completed" } }])
  const result = await new ExperimentRunner(ports(bind(runtime), solari, model)).run(directPlan(), operationController().controller)

  assert.equal(result.kind, "attempted")
  if (result.kind !== "attempted") throw new Error("expected attempted run")
  assert.deepEqual(result.terminal, { kind: "failure", message: "Worth event sink unavailable", posture: { kind: "unknown", recovery: "owner_reconciliation_required" }, classification: "provider_failure" })
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
  const model = new FakeModel([{ kind: "completed", completion: { output: { kind: "act", step: clickStep() }, usage: { inputTokens: 1, outputTokens: 1, estimatedModelCostMicrocents: 100000 } }, effect: { kind: "completed" } }])
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
  const model = new FakeModel([{ kind: "completed", completion: { output: { kind: "act", step: clickStep() }, usage: { inputTokens: 1, outputTokens: 1, estimatedModelCostMicrocents: 100000 } }, effect: { kind: "completed" } }])
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
  const model = new FakeModel([{ kind: "completed", completion: { output: { kind: "complete", output: { status: "done" } }, usage: { inputTokens: 1, outputTokens: 1, estimatedModelCostMicrocents: 100000 } }, effect: { kind: "completed" } }])
  const result = await new ExperimentRunner(ports(bind(runtime), solari, model, new FailedVerifier())).run(directPlan([{ kind: "text_present", text: "must be present" }]), operationController().controller)

  assert.equal(result.kind, "attempted")
  if (result.kind !== "attempted") throw new Error("expected attempted run")
  assert.deepEqual(result.terminal, { kind: "failure", message: "postcondition was false" })
  assert.equal(runtime.commands.at(-1)?.kind, "complete_execution")
})

test("verifier usage is forwarded to Worth as measured model telemetry", async () => {
  const runtime = new FakeWorthRuntime()
  const solari = new ScriptedSolari([{ kind: "observed", observation: safeObservation("observation.initial"), effect: { kind: "completed" } }], [])
  const model = new FakeModel([{ kind: "completed", completion: { output: { kind: "complete", output: { status: "done" } }, usage: { inputTokens: 1, outputTokens: 1, estimatedModelCostMicrocents: 100000 } }, effect: { kind: "completed" } }])
  const verifier = new FailedVerifier({ usage: { inputTokens: 5, outputTokens: 2, estimatedModelCostMicrocents: 900000 } })
  const result = await new ExperimentRunner(ports(bind(runtime), solari, model, verifier)).run(directPlan([{ kind: "text_present", text: "must be present" }]), operationController().controller)

  assert.equal(result.kind, "attempted")
  const verifierEvents = runtime.events.filter((event): event is Extract<InterfaceCompilerEvent, { readonly type: "model.called" }> => event.type === "model.called" && event.payload.role === "verifier")
  assert.deepEqual(verifierEvents.map((event) => [event.payload.inputTokens, event.payload.outputTokens, event.payload.estimatedModelCostMicrocents]), [[5, 2, 900_000]])
  assert.equal(runtime.completed?.metrics.modelCalls, 2)
})

test("cancellation after verifier completion remains an after-effect control stop", async () => {
  const runtime = new FakeWorthRuntime()
  const operation = operationController()
  const solari = new ScriptedSolari([{ kind: "observed", observation: safeObservation("observation.initial"), effect: { kind: "completed" } }], [])
  const model = new FakeModel([{ kind: "completed", completion: { output: { kind: "complete", output: { status: "done" } }, usage: { inputTokens: 1, outputTokens: 1, estimatedModelCostMicrocents: 100000 } }, effect: { kind: "completed" } }])
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
    [{ kind: "failed", failure, effect: { kind: "not_started" } }],
  )
  const model = new FakeModel([{ kind: "completed", completion: { output: { kind: "act", step: clickStep() }, usage: { inputTokens: 1, outputTokens: 1, estimatedModelCostMicrocents: 100000 } }, effect: { kind: "completed" } }])
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
  assert.deepEqual([...runtime.registeredEvidenceIds], [id<EvidenceId>("evidence.solari.session-receipt")])
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

test("verifier-supplied evidence IDs are ignored in favor of a fresh Solari receipt admitted by WORTH", async () => {
  const runtime = new FakeWorthRuntime()
  runtime.replay = verifiedReplayProjection([clickStep()])
  const planned = await planCompiledExperiment(baseRequest([{ kind: "text_present", text: "must be present" }]), bind(runtime), operationContext())
  if (planned.kind !== "planned") throw new Error("expected compiled plan")
  const solari = new ScriptedSolari([{ kind: "observed", observation: safeObservation("observation.initial"), effect: { kind: "completed" } }], [{ kind: "completed", effect: { kind: "completed" } }])
  const verifier = new FailedVerifier({ evidenceIds: [id<EvidenceId>("evidence.duplicate"), id<EvidenceId>("evidence.duplicate")] })
  const result = await new ExperimentRunner(ports(bind(runtime), solari, undefined, verifier)).run(planned.plan, operationController().controller)

  assert.equal(result.kind, "attempted")
  assert.deepEqual([...runtime.registeredEvidenceIds], [id<EvidenceId>("evidence.solari.session-receipt")])
  assert.equal(runtime.registeredEvidenceIds.has(id<EvidenceId>("evidence.duplicate")), false)
  assert.equal(runtime.degradationRequests.length, 1)
  assert.equal(result.kind === "attempted" ? result.recovery?.capability.status : undefined, "degraded")
})

test("a completed-effect semantic provider failure settles without degrading the active replay", async () => {
  const runtime = new FakeWorthRuntime()
  runtime.replay = verifiedReplayProjection([clickStep()])
  const planned = await planCompiledExperiment(baseRequest([{ kind: "text_present", text: "must be present" }]), bind(runtime), operationContext())
  if (planned.kind !== "planned") throw new Error("expected compiled plan")
  const solari = new ScriptedSolari([{ kind: "observed", observation: safeObservation("observation.initial"), effect: { kind: "completed" } }], [{ kind: "completed", effect: { kind: "completed" } }])
  const verifier: SemanticVerifier = { modelUsage: "required", verify: async () => ({ kind: "provider_failed", message: "malformed model response", retryable: false, effect: { kind: "completed" } }) }
  const result = await new ExperimentRunner(ports(bind(runtime), solari, undefined, verifier)).run(planned.plan, operationController().controller)

  assert.equal(result.kind, "attempted")
  if (result.kind !== "attempted") throw new Error("expected attempted run")
  assert.equal(result.terminal.kind, "failure")
  if (result.terminal.kind !== "failure") throw new Error("expected provider failure")
  assert.equal(result.terminal.classification, "provider_failure")
  assert.equal(result.terminal.replayFailure, undefined)
  assert.equal(runtime.registeredEvidenceIds.size, 0)
  assert.equal(runtime.degradationRequests.length, 0)
})

test("cleanup uncertainty strips semantic replay failure and prevents evidence admission or degradation", async () => {
  const runtime = new FakeWorthRuntime()
  runtime.replay = verifiedReplayProjection([clickStep()])
  const planned = await planCompiledExperiment(baseRequest([{ kind: "text_present", text: "must be present" }]), bind(runtime), operationContext())
  if (planned.kind !== "planned") throw new Error("expected compiled plan")
  const solari = new ScriptedSolari(
    [{ kind: "observed", observation: safeObservation("observation.initial"), effect: { kind: "completed" } }],
    [{ kind: "completed", effect: { kind: "completed" } }],
    { kind: "close_failed", message: "browser release failed", retryable: true, effect: { kind: "unknown", recovery: "owner_reconciliation_required" } },
  )
  const result = await new ExperimentRunner(ports(bind(runtime), solari, undefined, new FailedVerifier())).run(planned.plan, operationController().controller)

  assert.equal(result.kind, "attempted")
  if (result.kind !== "attempted") throw new Error("expected attempted run")
  assert.equal(result.terminal.kind, "failure")
  if (result.terminal.kind !== "failure") throw new Error("expected cleanup failure")
  assert.equal(result.terminal.replayFailure, undefined)
  assert.equal(runtime.registeredEvidenceIds.size, 0)
  assert.equal(runtime.degradationRequests.length, 0)
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
  const model = new FakeModel([{ kind: "completed", completion: { output: { kind: "complete", output: { status: "done" } }, usage: { inputTokens: 1, outputTokens: 1, estimatedModelCostMicrocents: 100000 } }, effect: { kind: "completed" } }])
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
