import assert from "node:assert/strict"
import test from "node:test"
import type {
  ApplicationId,
  CandidateReplay,
  CapabilityId,
  CapabilityDefinition,
  CompilationMetrics,
  EvidenceId,
  EventId,
  ExecutionId,
  InterfaceCompilerEvent,
  OperationContext,
  ReplayVersionId,
  ValidationResult,
  VerificationRunReceipt,
  WorthCommand,
  WorthEntity,
  WorthEntityId,
  WorthReadResult,
  WorthSubmissionResult,
} from "@interface-compiler/domain"
import { createApplication, createCandidateReplay, createCapability, createExecution } from "@interface-compiler/domain"
import {
  createWorthAdapter,
  type WorthCompilationMetricsProjection,
  type WorthQueryHostFacadeBinding,
  type WorthRuntimePort,
} from "../src/index.js"

function id<T extends string>(value: string): T {
  return value as T
}

function unwrap<T>(result: ValidationResult<T>): T {
  if (!result.ok) throw new Error(result.issues.map(({ path, message }) => `${path}: ${message}`).join(", "))
  return result.value
}

function context(): OperationContext {
  return {
    operationId: id("operation.adapter-test"),
    deadlineAt: "2026-08-31T13:00:00.000Z",
    cancellation: {
      isCancellationRequested: () => false,
      onCancellationRequested: () => () => undefined,
    },
    budget: { maxWallClockMs: 5_000 },
    admission: { maxInFlight: 2, maxQueued: 4, overflow: "reject" },
  }
}

function failedSubmission(): WorthSubmissionResult {
  return {
    kind: "failed",
    entity: "application",
    entityId: id<ApplicationId>("application.adapter-test"),
    message: "scripted transport result",
    retryable: false,
  }
}

function runtimePort(overrides: Partial<WorthRuntimePort> = {}): WorthRuntimePort {
  const notFound = <T>(entity: WorthEntity, entityId: string): WorthReadResult<T> => ({
    kind: "not_found",
    entity,
    entityId: id<WorthEntityId>(entityId),
  })

  return {
    readApplication: async (applicationId) => notFound("application", applicationId),
    readCapability: async (capabilityId) => notFound("capability", capabilityId),
    readActiveReplay: async (capabilityId) => notFound("replay", capabilityId),
    readReplayLineage: async (capabilityId) => notFound("replay", capabilityId),
    readExperiment: async (experimentId) => notFound("experiment", experimentId),
    readEvidence: async (evidenceId) => notFound("evidence", evidenceId),
    readExecution: async (executionId) => notFound("execution", executionId),
    readCompilationMetrics: async (capabilityId) => notFound("capability", capabilityId),
    submit: async () => failedSubmission(),
    publishEvent: async (event) => ({ kind: "published", eventId: event.eventId, effect: { kind: "completed" } }),
    ...overrides,
  }
}

function createAdapter(runtime: WorthRuntimePort = runtimePort()) {
  return createWorthAdapter({ boundary: "worth-query-host::facade", runtime })
}

test("forwards Worth projections and context without keeping local state", async () => {
  const operationContext = context()
  const capabilityId = id<CapabilityId>("capability.adapter-test")
  let response: WorthReadResult<never> = { kind: "not_found", entity: "capability", entityId: capabilityId }
  const calls: { capabilityId?: CapabilityId; context?: OperationContext } = {}
  const adapter = createAdapter(
    runtimePort({
      readCapability: async (receivedId, receivedContext) => {
        calls.capabilityId = receivedId
        calls.context = receivedContext
        return response
      },
    }),
  )

  const first = await adapter.readCapability(capabilityId, operationContext)
  response = { kind: "failed", entity: "capability", entityId: capabilityId, message: "current Worth failure", retryable: true }
  const second = await adapter.readCapability(capabilityId, operationContext)

  assert.equal(first.kind, "not_found")
  assert.equal(second.kind, "failed")
  assert.equal(calls.capabilityId, capabilityId)
  assert.equal(calls.context, operationContext)
})

test("forwards Worth-owned compilation metrics projections without calculating or caching them", async () => {
  const capabilityId = id<CapabilityId>("capability.metrics-test")
  const operationContext = context()
  const projection: WorthCompilationMetricsProjection = {
    projectionKind: "worth_compilation_metrics",
    capabilityId,
    revision: 4,
    compilation: {
      explorationCostUsd: 11,
      verificationCostUsd: 7,
      totalCompilationCostUsd: 18,
      directAverageCostUsd: 4,
      compiledAverageCostUsd: 1,
      breakEvenCalls: { kind: "finite", calls: 6, exactCalls: 6, savingsPerCallUsd: 3 },
    } satisfies CompilationMetrics,
    lifetime: {
      executions: 10,
      lifetimeDirectCostAvoidedUsd: 40,
      lifetimeCompiledCostUsd: 28,
      lifetimeNetSavingsUsd: 12,
    },
  }
  let receivedId: CapabilityId | undefined
  let receivedContext: OperationContext | undefined
  const adapter = createAdapter(
    runtimePort({
      readCompilationMetrics: async (receivedCapabilityId, receivedOperationContext) => {
        receivedId = receivedCapabilityId
        receivedContext = receivedOperationContext
        return { kind: "found", value: projection }
      },
    }),
  )

  const result = await adapter.readCompilationMetrics(capabilityId, operationContext)

  assert.deepEqual(result, { kind: "found", value: projection })
  assert.equal(receivedId, capabilityId)
  assert.equal(receivedContext, operationContext)
})

test("submits lifecycle helpers as Worth commands rather than applying transitions locally", async () => {
  const commands: WorthCommand[] = []
  const submittedContexts: OperationContext[] = []
  const adapter = createAdapter(
    runtimePort({
      submit: async (command, submittedContext) => {
        commands.push(command)
        submittedContexts.push(submittedContext)
        return failedSubmission()
      },
    }),
  )
  const operationContext = context()
  const applicationId = id<ApplicationId>("application.adapter-test")
  const capabilityId = id<CapabilityId>("capability.adapter-test")
  const replayVersionId = id<ReplayVersionId>("replay.adapter-test.v1")
  const successorReplayVersionId = id<ReplayVersionId>("replay.adapter-test.v2")
  const executionId = id<ExecutionId>("execution.adapter-test")
  const application = unwrap(createApplication({ id: applicationId, name: "Adapter test", baseUrl: "https://example.test" }))
  const capabilityDefinition: CapabilityDefinition = unwrap(createCapability({
    id: capabilityId,
    applicationId,
    name: "Adapter capability",
    description: "A capability used only to prove command mapping.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object", properties: {} },
    preconditions: [],
    postconditions: [],
  }))
  const candidate: CandidateReplay = unwrap(
    createCandidateReplay({
      id: replayVersionId,
      capabilityId,
      version: 1,
      steps: [{ type: "wait", milliseconds: 1 }],
      confidence: 0.8,
      discoveredFromExperimentId: id("experiment.adapter-test"),
      createdAt: "2026-08-31T12:00:00.000Z",
    }),
  )
  const verificationReceipt: VerificationRunReceipt = {
    id: id("verification-run.adapter-test"),
    sessionId: id("session.adapter-test"),
    capabilityId,
    replayVersionId,
    sessionFreshness: "fresh",
    outcome: "success",
    evidenceIds: [id("evidence.verification.adapter-test")],
  }
  const replayFailure = { kind: "step_failed" as const, stepIndex: 0, message: "target changed", evidenceIds: [id<EvidenceId>("evidence.failure")] }
  const execution = unwrap(createExecution({
    id: executionId,
    capabilityId,
    replayVersionId,
    mode: "compiled",
    metrics: {
      startedAt: "2026-08-31T12:00:00.000Z",
      modelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      browserObservations: 0,
      browserActions: 0,
      estimatedModelCostUsd: 0,
    },
  }))

  const expectedCapabilityRevision = 4
  const expectedReplayRevision = 7
  const expectedExecutionRevision = 2

  await adapter.registerApplication(application, operationContext)
  await adapter.registerCapability(capabilityDefinition, operationContext)
  await adapter.recordReplayCandidate(candidate, expectedCapabilityRevision, operationContext)
  await adapter.beginReplayVerification(replayVersionId, 3, expectedReplayRevision, operationContext)
  await adapter.recordVerificationRun(replayVersionId, verificationReceipt, expectedReplayRevision, operationContext)
  await adapter.completeReplayVerification(replayVersionId, "2026-08-31T12:00:01.000Z", expectedReplayRevision, operationContext)
  await adapter.beginCapabilityVerification(capabilityId, replayVersionId, expectedCapabilityRevision, operationContext)
  await adapter.activateCapability(capabilityId, replayVersionId, expectedCapabilityRevision, operationContext)
  await adapter.failCapabilityVerification(capabilityId, replayVersionId, expectedCapabilityRevision, operationContext)
  await adapter.recordReplayFailure(replayVersionId, replayFailure, "2026-08-31T12:01:00.000Z", expectedReplayRevision, operationContext)
  await adapter.supersedeReplay(replayVersionId, successorReplayVersionId, "2026-08-31T12:02:00.000Z", expectedReplayRevision, operationContext)
  await adapter.resumeCapabilityExploration(capabilityId, expectedCapabilityRevision, operationContext)
  await adapter.startExecution(execution, operationContext)
  const completion = { kind: "failure" as const, reason: "execution_failed" as const, message: "runtime reported failure" }
  await adapter.completeExecution(executionId, completion, "2026-08-31T12:03:00.000Z", expectedExecutionRevision, operationContext)

  assert.deepEqual(commands, [
    { kind: "register_application", application },
    { kind: "register_capability", definition: capabilityDefinition },
    { kind: "record_replay_candidate", candidate, expectedCapabilityRevision },
    { kind: "begin_replay_verification", replayVersionId, requiredSuccessfulRuns: 3, expectedReplayRevision },
    { kind: "record_verification_run", replayVersionId, receipt: verificationReceipt, expectedReplayRevision },
    { kind: "complete_replay_verification", replayVersionId, verifiedAt: "2026-08-31T12:00:01.000Z", expectedReplayRevision },
    { kind: "begin_capability_verification", capabilityId, candidateReplayVersionId: replayVersionId, expectedCapabilityRevision },
    { kind: "activate_capability", capabilityId, activeReplayVersionId: replayVersionId, expectedCapabilityRevision },
    { kind: "fail_capability_verification", capabilityId, brokenReplayVersionId: replayVersionId, expectedCapabilityRevision },
    { kind: "record_replay_failure", replayVersionId, failure: replayFailure, brokenAt: "2026-08-31T12:01:00.000Z", expectedReplayRevision },
    { kind: "supersede_replay", replayVersionId, successorReplayVersionId, supersededAt: "2026-08-31T12:02:00.000Z", expectedReplayRevision },
    { kind: "resume_capability_exploration", capabilityId, expectedCapabilityRevision },
    { kind: "start_execution", execution },
    { kind: "complete_execution", executionId, completion, endedAt: "2026-08-31T12:03:00.000Z", expectedExecutionRevision },
  ])
  assert.equal(submittedContexts.length, commands.length)
  assert.ok(submittedContexts.every((submittedContext) => submittedContext === operationContext))
  assert.ok(submittedContexts.every(({ admission }) => admission === operationContext.admission))
  assert.equal(Object.isFrozen(adapter), true)
})

test("publishes events through Worth and preserves the returned publication result", async () => {
  const event: InterfaceCompilerEvent = {
    eventId: id<EventId>("event.adapter-test"),
    occurredAt: "2026-08-31T12:00:00.000Z",
    protocol: "interface-compiler.events",
    schemaVersion: 1,
    idempotencyKey: "event.adapter-test",
    recovery: "replay_safe",
    integrity: { algorithm: "sha256", digest: "adapter-test-digest" },
    type: "capability.healthy",
    payload: {
      capabilityId: id<CapabilityId>("capability.adapter-test"),
      activeReplayVersionId: id<ReplayVersionId>("replay.adapter-test.v1"),
    },
  }
  const operationContext = context()
  let receivedEvent: InterfaceCompilerEvent | undefined
  let receivedContext: OperationContext | undefined
  const adapter = createAdapter(
    runtimePort({
      publishEvent: async (received, receivedOperationContext) => {
        receivedEvent = received
        receivedContext = receivedOperationContext
        return { kind: "duplicate", eventId: received.eventId, effect: { kind: "completed" } }
      },
    }),
  )

  const result = await adapter.publish(event, operationContext)

  assert.deepEqual(result, { kind: "duplicate", eventId: event.eventId, effect: { kind: "completed" } })
  assert.equal(receivedEvent, event)
  assert.equal(receivedContext, operationContext)
})

test("rejects a missing runtime method at the adapter boundary", () => {
  assert.throws(
    () =>
      createWorthAdapter({
        boundary: "worth-query-host::facade",
        runtime: {} as unknown as WorthRuntimePort,
      }),
    /Worth runtime port is missing readApplication\(\)/,
  )
})

test("requires an explicit worth-query-host facade binding", async () => {
  const operationContext = context()
  const runtime = runtimePort()
  const adapter = createWorthAdapter({
    boundary: "worth-query-host::facade",
    runtime,
  })

  assert.deepEqual(await adapter.submit({ kind: "resume_capability_exploration", capabilityId: id("capability.facade"), expectedCapabilityRevision: 0 }, operationContext), failedSubmission())
  assert.throws(() => createWorthAdapter(undefined as unknown as WorthQueryHostFacadeBinding), /host-facade binding is required/)
  assert.throws(
    () => createWorthAdapter({ runtime } as unknown as WorthQueryHostFacadeBinding),
    /must enter through worth-query-host::facade/,
  )
})
