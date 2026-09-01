import assert from "node:assert/strict"
import test from "node:test"
import {
  activateCapability,
  beginCapabilityVerification,
  beginReplayVerification,
  calculateBreakEvenCalls,
  calculateCompilationMetrics,
  calculateLifetimeEconomics,
  calculateModelCostUsd,
  classifySafetyBoundary,
  completeReplayVerification,
  createApplication,
  createCandidateReplay,
  createCapability,
  createEvidence,
  createExecution,
  createSchema,
  findInteractables,
  finishExecution,
  isActiveReplay,
  normalizeObservation,
  recordVerificationRun,
  resolveExperiment,
  startExperiment,
  validateExecutionMetrics,
  validateSafetySignal,
  validateSafetyStopResult,
  type ActiveReplay,
  type Application,
  type ApplicationId,
  type ApplicationProjection,
  type CapabilityDefinition,
  type CapabilityId,
  type CandidateReplay,
  type CandidateReplayInput,
  type CompilationMetrics,
  type Evidence,
  type ExecutionCompletion,
  type ExecutionId,
  type ExecutionMetrics,
  type ExecutionStart,
  type ExperimentDefinition,
  type JsonSchema,
  type ModelPricingUsdPerToken,
  type ModelUsage,
  type Observation,
  type PendingExperiment,
  type ReplayVersionId,
  type SafetyBoundaryObservation,
  type SafetySignal,
  type Schema,
  type SessionId,
  type VerificationRunId,
  type VerificationRunReceipt,
  type ValidationResult,
} from "../src/index.js"

const timestamp = "2026-08-31T12:00:00.000Z"

function id<T extends string>(value: string): T {
  return value as T
}

function malformed<T>(value: unknown): T {
  return value as T
}

function unwrap<T>(result: ValidationResult<T>): T {
  if (!result.ok) throw new Error(result.issues.map((entry) => `${entry.path}: ${entry.message}`).join(", "))
  return result.value
}

function candidate(): CandidateReplay {
  const input: CandidateReplayInput = {
    id: id<ReplayVersionId>("replay.add-to-cart.v1"),
    capabilityId: id<CapabilityId>("capability.add-to-cart"),
    version: 1,
    steps: [{ type: "click", target: { semanticDescription: "Add to cart", role: "button" } }],
    confidence: 0.9,
    discoveredFromExperimentId: id("experiment.add-to-cart.v1"),
    createdAt: timestamp,
  }
  return unwrap(createCandidateReplay(input))
}

function receipt(idValue: string, sessionValue: string, evidenceValue: string): VerificationRunReceipt {
  return {
    id: id<VerificationRunId>(idValue),
    sessionId: id<SessionId>(sessionValue),
    sessionFreshness: "fresh",
    outcome: "success",
    evidenceIds: [id(evidenceValue)],
  }
}

function capabilityDefinition(): CapabilityDefinition {
  return {
    id: id<CapabilityId>("capability.add-to-cart"),
    applicationId: id<ApplicationId>("application.walmart"),
    name: "AddToCart",
    description: "Add a selected product to the cart.",
    inputSchema: { type: "object", properties: { productRef: { type: "string" } }, required: ["productRef"] },
    outputSchema: { type: "object", properties: { status: { type: "string" } }, required: ["status"] },
    preconditions: [{ kind: "interactable_present", semanticDescription: "selected product" }],
    postconditions: [{ kind: "product_in_cart", productRef: "selected-product" }],
  }
}

test("verification completion cannot consume fabricated, reused, duplicate, or evidence-free runs", () => {
  const verifying = unwrap(beginReplayVerification(candidate(), 1))
  assert.equal(completeReplayVerification(verifying, timestamp).ok, false)

  assert.equal(
    recordVerificationRun(verifying, { ...receipt("run.1", "session.1", "evidence.1"), sessionFreshness: "reused" } as unknown as VerificationRunReceipt).ok,
    false,
  )
  const first = unwrap(recordVerificationRun(verifying, receipt("run.1", "session.1", "evidence.1")))
  assert.equal(recordVerificationRun(first, receipt("run.1", "session.2", "evidence.2")).ok, false)
  assert.equal(recordVerificationRun(first, receipt("run.2", "session.1", "evidence.2")).ok, false)
  assert.equal(recordVerificationRun(first, { ...receipt("run.2", "session.2", "evidence.1"), evidenceIds: [] }).ok, false)

  const active = unwrap(completeReplayVerification(first, timestamp))
  assert.equal(active.status, "active")
})

test("active replay and projection/entity types cannot be forged or interchanged", () => {
  const replay = candidate()
  const fakeActive = {
    ...replay,
    status: "active",
    verifiedAt: timestamp,
    verification: { requiredSuccessfulRuns: 1, runs: [] },
  } as unknown as ActiveReplay
  assert.equal(isActiveReplay(fakeActive), false)

  const capability = unwrap(createCapability(capabilityDefinition()))
  const verifyingCapability = unwrap(beginCapabilityVerification(capability, replay))
  assert.equal(activateCapability(verifyingCapability, fakeActive).ok, false)
})

test("domain factories take ownership of nested values", () => {
  const target = { semanticDescription: "Add to cart", role: "button" }
  const steps = [{ type: "click" as const, target }]
  const replay = unwrap(
    createCandidateReplay({
      ...candidate(),
      steps,
    }),
  )
  target.semanticDescription = "changed outside the domain"
  steps[0].target.role = "changed outside the domain"
  assert.equal(replay.steps[0].type, "click")
  if (replay.steps[0].type !== "click") throw new Error("expected click step")
  assert.equal(replay.steps[0].target.semanticDescription, "Add to cart")
  assert.equal(replay.steps[0].target.role, "button")
  assert.equal(Object.isFrozen(replay), true)
  assert.equal(Object.isFrozen(replay.steps), true)
  assert.equal(Object.isFrozen(replay.steps[0]), true)
  assert.equal(Object.isFrozen(replay.steps[0].target), true)

  const schema = { type: "object" as const, properties: { nested: { type: "string" as const } } }
  const capability = unwrap(createCapability({ ...capabilityDefinition(), inputSchema: schema }))
  assert.equal(Object.isFrozen(capability.inputSchema), true)
  assert.equal(Object.isFrozen((capability.inputSchema as { properties?: unknown }).properties), true)
})

test("malformed runtime values fail closed without throwing", () => {
  const results = [
    createApplication(malformed<Application>(null)),
    createCapability(malformed<CapabilityDefinition>(null)),
    createCandidateReplay(malformed<CandidateReplayInput>(null)),
    normalizeObservation(malformed<Observation>(null)),
    createEvidence(malformed<Evidence>({ kind: "unknown" })),
    startExperiment(malformed<ExperimentDefinition>(null)),
    resolveExperiment(malformed<PendingExperiment>(null), "success", [id("evidence.1")], timestamp),
    createSchema<unknown>(malformed<{ name: string; json: JsonSchema }>(null)),
    createExecution(malformed<ExecutionStart>(null)),
    classifySafetyBoundary(malformed<SafetyBoundaryObservation>(null)),
    calculateBreakEvenCalls(malformed<{ compileCostUsd: number; directCostPerCallUsd: number; compiledCostPerCallUsd: number }>(null)),
    calculateCompilationMetrics(malformed<{ explorationCostUsd: number; verificationCostUsd: number }>(null)),
    calculateLifetimeEconomics(malformed<CompilationMetrics>(null), 1),
    calculateModelCostUsd(malformed<ModelUsage>(null), malformed<ModelPricingUsdPerToken>(null)),
  ]
  assert.ok(results.every((result) => result.ok === false))

  assert.doesNotThrow(() => findInteractables(malformed<Observation>(null), "button"))
  assert.deepEqual(validateExecutionMetrics(malformed<ExecutionMetrics>(null)), [{ path: "metrics", message: "execution metrics must be an object" }])
  assert.deepEqual(validateSafetySignal(malformed<SafetySignal>({ kind: "unknown" })), [{ path: "signal.kind", message: "safety signal kind is not recognized" }])
  assert.equal(validateSafetyStopResult({ kind: "safety_stop", terminal: true, nextAction: "human_required", reason: "order_placement" }).length > 0, true)

  const running = unwrap(
    createExecution({
      id: id<ExecutionId>("execution.1"),
      capabilityId: id<CapabilityId>("capability.add-to-cart"),
      mode: "compiled",
      metrics: {
        startedAt: timestamp,
        modelCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        browserObservations: 0,
        browserActions: 0,
        estimatedModelCostUsd: 0,
      },
    }),
  )
  assert.equal(finishExecution(running, malformed<ExecutionCompletion>({ kind: "unknown" }), timestamp).ok, false)
})

export function publicContractTypeFence(
  application: Application,
  applicationProjection: ApplicationProjection,
  applicationId: ApplicationId,
  capabilityId: CapabilityId,
  schemaString: Schema<string>,
): void {
  // @ts-expect-error projections are not mutable domain entities or interchangeable records
  applicationProjection = application
  // @ts-expect-error branded identifiers prevent cross-entity identity confusion
  capabilityId = applicationId
  // @ts-expect-error schema output types are bound to their schema descriptor
  const schemaNumber: Schema<number> = schemaString
  void [applicationProjection, application, capabilityId, schemaNumber]
}
