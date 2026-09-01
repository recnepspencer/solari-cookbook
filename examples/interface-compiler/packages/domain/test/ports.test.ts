import assert from "node:assert/strict"
import test from "node:test"
import type {
  ActiveReplay,
  ActiveReplayProjection,
  Application,
  ApplicationId,
  ApplicationProjection,
  Clock,
  CapabilityId,
  Evidence,
  EvidenceId,
  EvidenceProjection,
  EventPublicationResult,
  EventPublisher,
  IdSource,
  IsoTimestamp,
  Execution,
  ExecutionId,
  ExecutionProjection,
  Experiment,
  ExperimentId,
  ExperimentProjection,
  ObservationId,
  EventId,
  OperationContext,
  OperationId,
  PartialEffectPosture,
  ReasoningResult,
  ReasoningModel,
  ReplayProjection,
  ReplayVersionId,
  Schema,
  SolariPort,
  SessionId,
  SolariCloseResult,
  SolariEvidenceResult,
  SolariObservationResult,
  SolariSessionResult,
  SolariStepResult,
  VerificationRunId,
  VerificationRunReceipt,
  WorthAuthority,
  WorthCommand,
  WorthReadResult,
  WorthSubmissionResult,
} from "../src/index.js"

const operationId = "operation.port-contract" as OperationId
const applicationId = "application.port-contract" as ApplicationId
const capabilityId = "capability.port-contract" as CapabilityId
const evidenceId = "evidence.port-contract" as EvidenceId
const replayVersionId = "replay.port-contract" as ReplayVersionId
const eventId = "event.port-contract" as EventId
const sessionId = "session.port-contract" as SessionId
const verificationRunId = "verification.port-contract" as VerificationRunId
const experimentId = "experiment.port-contract" as ExperimentId
const executionId = "execution.port-contract" as ExecutionId
const observationId = "observation.port-contract" as ObservationId

const unknownEffect: Extract<PartialEffectPosture, { readonly kind: "unknown" }> = { kind: "unknown", recovery: "owner_reconciliation_required" }

const clock: Clock = { now: (): IsoTimestamp => "2026-08-31T12:00:00.000Z" }
const ids: IdSource = {
  nextApplicationId: () => applicationId,
  nextCapabilityId: () => capabilityId,
  nextReplayVersionId: () => replayVersionId,
  nextExperimentId: () => experimentId,
  nextEvidenceId: () => evidenceId,
  nextExecutionId: () => executionId,
  nextEventId: () => eventId,
  nextSessionId: () => sessionId,
  nextObservationId: () => observationId,
  nextVerificationRunId: () => verificationRunId,
  nextOperationId: () => operationId,
}

function cancelledRead<T>(): WorthReadResult<T> {
  return { kind: "cancelled", operationId, posture: { kind: "not_started" } }
}

const authority: WorthAuthority = {
  readApplication: async (): Promise<WorthReadResult<ApplicationProjection>> => cancelledRead(),
  readCapability: async () => cancelledRead(),
  readActiveReplay: async () => cancelledRead(),
  readReplayLineage: async (): Promise<WorthReadResult<readonly ReplayProjection[]>> => cancelledRead(),
  readExperiment: async (): Promise<WorthReadResult<ExperimentProjection>> => cancelledRead(),
  readEvidence: async (): Promise<WorthReadResult<EvidenceProjection>> => cancelledRead(),
  readExecution: async (): Promise<WorthReadResult<ExecutionProjection>> => cancelledRead(),
  submit: async (): Promise<WorthSubmissionResult> => ({ kind: "denied", entity: "application", entityId: applicationId, reason: "backpressure" }),
}

const solari: SolariPort = {
  createSession: async () => ({ kind: "denied", reason: "backpressure", effect: { kind: "not_started" } }),
}

const reasoningModel: ReasoningModel = {
  structuredComplete: async <TInput, TOutput>(_input: TInput, _schema: Schema<TOutput>, _context: OperationContext): Promise<ReasoningResult<TOutput>> => ({
    kind: "denied",
    reason: "backpressure",
    effect: { kind: "not_started" },
  }),
}

const publisher: EventPublisher = {
  publish: async () => ({ kind: "deferred", eventId, retry: "publisher_recovery_required", effect: unknownEffect }),
}

function projectionTypeFence(
  application: Application,
  applicationProjection: ApplicationProjection,
  replay: ActiveReplay,
  replayProjection: ActiveReplayProjection,
  evidence: Evidence,
  evidenceProjection: EvidenceProjection,
  experiment: Experiment,
  experimentProjection: ExperimentProjection,
  execution: Execution,
  executionProjection: ExecutionProjection,
): void {
  // @ts-expect-error Worth projections cannot be promoted into domain entities.
  const applicationEntity: Application = applicationProjection
  // @ts-expect-error Domain entities are not read projections.
  const applicationRead: ApplicationProjection = application
  // @ts-expect-error Worth projections cannot be promoted into domain entities.
  const replayEntity: ActiveReplay = replayProjection
  // @ts-expect-error Domain entities are not read projections.
  const replayRead: ActiveReplayProjection = replay
  // @ts-expect-error Worth projections cannot be promoted into domain entities.
  const evidenceEntity: Evidence = evidenceProjection
  // @ts-expect-error Domain entities are not read projections.
  const evidenceRead: EvidenceProjection = evidence
  // @ts-expect-error Worth projections cannot be promoted into domain entities.
  const experimentEntity: Experiment = experimentProjection
  // @ts-expect-error Domain entities are not read projections.
  const experimentRead: ExperimentProjection = experiment
  // @ts-expect-error Worth projections cannot be promoted into domain entities.
  const executionEntity: Execution = executionProjection
  // @ts-expect-error Domain entities are not read projections.
  const executionRead: ExecutionProjection = execution
  void [applicationEntity, applicationRead, replayEntity, replayRead, evidenceEntity, evidenceRead, experimentEntity, experimentRead, executionEntity, executionRead]
}

function currentnessTypeFence(receipt: VerificationRunReceipt): void {
  const safeCommand: WorthCommand = {
    kind: "record_verification_run",
    replayVersionId,
    receipt,
    expectedReplayRevision: 4,
  }
  // @ts-expect-error A replay mutation must carry the revision it was based on.
  const missingRevision: WorthCommand = { kind: "record_verification_run", replayVersionId, receipt }
  void [safeCommand, missingRevision]
}

function outcomeTypeFence(): void {
  const solariSteps: readonly SolariStepResult[] = [
    { kind: "completed", effect: { kind: "completed" } },
    { kind: "cancelled", safePoint: "after_step", effect: unknownEffect },
    { kind: "timed_out", effect: unknownEffect },
  ]
  const observations: readonly SolariObservationResult[] = [
    { kind: "cancelled", effect: { kind: "not_started" } },
    { kind: "timed_out", effect: { kind: "not_started" } },
  ]
  const evidence: readonly SolariEvidenceResult[] = [{ kind: "failed", message: "capture failed", retryable: true, effect: unknownEffect }]
  const close: readonly SolariCloseResult[] = [{ kind: "close_failed", message: "close failed", retryable: true, effect: unknownEffect }]
  const sessions: readonly SolariSessionResult[] = [
    { kind: "denied", reason: "backpressure", effect: { kind: "not_started" } },
    { kind: "cancelled", effect: unknownEffect },
  ]
  const reasoning: ReasoningResult<string> = { kind: "failed", message: "provider failed", retryable: true, effect: unknownEffect }
  const publication: EventPublicationResult = { kind: "deferred", eventId, retry: "publisher_recovery_required", effect: unknownEffect }
  const read: WorthReadResult<ApplicationProjection> = { kind: "timed_out", operationId, posture: unknownEffect }
  const submission: WorthSubmissionResult = { kind: "settlement_deferred", entity: "evidence", entityId: evidenceId, operationId, posture: unknownEffect, recovery: "owner_recovery_required" }
  void [solariSteps, observations, evidence, close, sessions, reasoning, publication, read, submission]
}

test("ports preserve authority boundaries, revision bases, and effect outcomes", () => {
  projectionTypeFence(
    undefined as unknown as Application,
    undefined as unknown as ApplicationProjection,
    undefined as unknown as ActiveReplay,
    undefined as unknown as ActiveReplayProjection,
    undefined as unknown as Evidence,
    undefined as unknown as EvidenceProjection,
    undefined as unknown as Experiment,
    undefined as unknown as ExperimentProjection,
    undefined as unknown as Execution,
    undefined as unknown as ExecutionProjection,
  )
  currentnessTypeFence({
    id: verificationRunId,
    sessionId,
    capabilityId,
    replayVersionId,
    sessionFreshness: "fresh",
    outcome: "success",
    evidenceIds: [evidenceId],
  })
  outcomeTypeFence()
  assert.equal(typeof authority.submit, "function")
  assert.equal(clock.now(), "2026-08-31T12:00:00.000Z")
  assert.equal(ids.nextOperationId(), operationId)
  assert.equal(typeof solari.createSession, "function")
  assert.equal(typeof reasoningModel.structuredComplete, "function")
  assert.equal(typeof publisher.publish, "function")
})
