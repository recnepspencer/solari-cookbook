import {
  classifySafetyBoundary,
  type InterfaceCompilerEventMap,
  type InterfaceCompilerEventType,
  type Condition,
  type EvidenceId,
  type ExecutionId,
  type JsonValue,
  type Observation,
  type PartialEffectPosture,
  type ReplayFailure,
  type ReplayVersionId,
  type ReasoningModel,
  type ReasoningResult,
  type ReasoningUsage,
  type ReplayStep,
  type SafetyStopResult,
  type SolariObservationResult,
  type SolariSession,
  type SolariStepResult,
  validateCondition,
} from "@interface-compiler/domain"
import { assessObservationSafety, assessReplayStepSafety } from "./safety.js"
import { eventIdempotencyKey } from "./event-publishing.js"
import type { OperationController, RuntimeStop } from "./operation.js"
import {
  type CompiledExperimentPlan,
  type DirectDecision,
  type DirectExperimentPlan,
  type ExperimentPlan,
  validateDirectDecision,
} from "./planning.js"
import type { SemanticVerifier, SemanticVerificationResult } from "./semantic-verifier.js"
import type { ExperimentStepGuard } from "./step-policy.js"
import type { WorthAuthority } from "@interface-compiler/domain"
type WorthEvidenceReader = { readonly readEvidence?: WorthAuthority["readEvidence"] }

export type ExperimentTerminal =
  | { readonly kind: "success"; readonly output?: JsonValue }
  | { readonly kind: "failure"; readonly message: string; readonly replayFailure?: ReplayFailure; readonly posture?: PartialEffectPosture }
  | { readonly kind: "safety_stop"; readonly stop: SafetyStopResult }
  | { readonly kind: "control_stop"; readonly stop: RuntimeStop }

export type RuntimeEventPublication =
  | { readonly kind: "published" }
  | { readonly kind: "stopped"; readonly stop: RuntimeStop }
  | { readonly kind: "failed"; readonly message: string; readonly posture: PartialEffectPosture }

export type RuntimeEventEmitter = <T extends InterfaceCompilerEventType>(type: T, payload: InterfaceCompilerEventMap[T], idempotencyKey: string) => Promise<RuntimeEventPublication>

type ObservationOutcome =
  | { readonly kind: "observed"; readonly observation: Observation }
  | { readonly kind: "fresh_session_off_origin"; readonly observation: Observation }
  | { readonly kind: "terminal"; readonly intent: ExperimentTerminal }

type StepOutcome =
  | { readonly kind: "completed"; readonly observation?: Observation }
  | { readonly kind: "terminal"; readonly intent: ExperimentTerminal }

export async function runExperimentSession(
  plan: ExperimentPlan,
  session: SolariSession,
  controller: OperationController,
  model: ReasoningModel | undefined,
  verifier: SemanticVerifier | undefined,
  worth: WorthEvidenceReader,
  emit: RuntimeEventEmitter,
  executionId: ExecutionId,
  stepGuard?: ExperimentStepGuard,
): Promise<ExperimentTerminal> {
  let firstObservation = await observe(session, controller, emit, executionId, plan.request.application.baseUrl, true)
  if (firstObservation.kind === "fresh_session_off_origin") {
    const initialNavigation: ReplayStep = { type: "navigate", url: plan.request.application.baseUrl }
    const initialAdmission = admitStep(stepGuard, initialNavigation)
    if (initialAdmission !== undefined) return initialAdmission
    const initialAction = await executeStep(
      session,
      initialNavigation,
      controller,
      emit,
      executionId,
      eventIdempotencyKey("browser.action", `${executionId}:fresh-session-navigation`),
    )
    if (initialAction.kind !== "completed") return initialAction.intent
    firstObservation = initialAction.observation === undefined
      ? await observe(session, controller, emit, executionId, plan.request.application.baseUrl)
      : await assessObservation(initialAction.observation, emit, executionId, plan.request.application.baseUrl)
  }
  if (firstObservation.kind !== "observed") return observationIntent(firstObservation)
  let observation = firstObservation.observation

  if (plan.kind === "direct") {
    return runDirect(plan, session, observation, controller, model, verifier, worth, emit, executionId, stepGuard)
  }
  return runCompiled(plan, session, observation, controller, verifier, worth, emit, executionId, stepGuard)
}

async function runDirect(
  plan: DirectExperimentPlan,
  session: SolariSession,
  observation: Observation,
  controller: OperationController,
  model: ReasoningModel | undefined,
  verifier: SemanticVerifier | undefined,
  worth: WorthEvidenceReader,
  emit: RuntimeEventEmitter,
  executionId: ExecutionId,
  stepGuard?: ExperimentStepGuard,
): Promise<ExperimentTerminal> {
  if (model === undefined) return { kind: "failure", message: "reasoning model became unavailable before a call" }
  let currentObservation = observation
  let modelCallIndex = 0
  let actionIndex = 0
  for (;;) {
    const modelGate = controller.reserveModelCall()
    if (modelGate.kind === "stop") return { kind: "control_stop", stop: modelGate.stop }
    const modelPreflight = controller.check()
    if (modelPreflight.kind === "stop") return { kind: "control_stop", stop: modelPreflight.stop }
    const modelLogicalIdentity = `${modelCallIndex}`
    modelCallIndex += 1
    const result = await model.structuredComplete<unknown, DirectDecision>({
      role: "explorer",
      objective: plan.request.objective,
      input: plan.request.input,
      observation: currentObservation,
    }, plan.decisionSchema, controller.context)
    const modelEventIntent = await emitModelEvent(result, emit, executionId, modelLogicalIdentity, "explorer")
    if (modelEventIntent !== undefined) return modelEventIntent

    const modelTerminal = modelResultIntent(result, controller)
    if (modelTerminal !== undefined) return modelTerminal
    if (result.kind !== "completed") return { kind: "failure", message: "reasoning provider returned no decision" }
    const afterModel = controller.check()
    if (afterModel.kind === "stop") return { kind: "control_stop", stop: promoteCompletedEffect(afterModel.stop) }
    if (validateDirectDecision(result.completion.output).length > 0) return { kind: "failure", message: "reasoning provider returned an invalid decision" }
    const decision = result.completion.output
    if (decision.kind === "complete") return verifyOutcome(plan.request.expectedOutcome, verifier, worth, currentObservation, decision.output, controller, emit, executionId)
    if (decision.kind === "stop") return classifyDecisionSafety(decision, currentObservation.observedAt)

    const stepAdmission = admitStep(stepGuard, decision.step)
    if (stepAdmission !== undefined) return stepAdmission
    const stepSafety = assessReplayStepSafety(decision.step, currentObservation.observedAt)
    if (!stepSafety.ok) return { kind: "failure", message: "safety classification failed" }
    if (stepSafety.value.kind === "stop") return { kind: "safety_stop", stop: stepSafety.value.result }
    const actionLogicalIdentity = `${executionId}:${actionIndex}`
    actionIndex += 1
    const action = await executeStep(session, decision.step, controller, emit, executionId, eventIdempotencyKey("browser.action", actionLogicalIdentity))
    if (action.kind !== "completed") return action.intent
    const nextObservation = action.observation === undefined
      ? await observe(session, controller, emit, executionId, plan.request.application.baseUrl)
      : await assessObservation(action.observation, emit, executionId, plan.request.application.baseUrl)
    if (nextObservation.kind !== "observed") return observationIntent(nextObservation)
    currentObservation = nextObservation.observation
  }
}

async function runCompiled(
  plan: CompiledExperimentPlan,
  session: SolariSession,
  observation: Observation,
  controller: OperationController,
  verifier: SemanticVerifier | undefined,
  worth: WorthEvidenceReader,
  emit: RuntimeEventEmitter,
  executionId: ExecutionId,
  stepGuard?: ExperimentStepGuard,
): Promise<ExperimentTerminal> {
  let currentObservation = observation
  for (const [stepIndex, step] of plan.replay.steps.entries()) {
    const stepAdmission = admitStep(stepGuard, step)
    if (stepAdmission !== undefined) return stepAdmission
    const stepSafety = assessReplayStepSafety(step, currentObservation.observedAt)
    if (!stepSafety.ok) return { kind: "failure", message: "safety classification failed" }
    if (stepSafety.value.kind === "stop") return { kind: "safety_stop", stop: stepSafety.value.result }
    const action = await executeStep(session, step, controller, emit, executionId, eventIdempotencyKey("browser.action", `${plan.replay.id}:${stepIndex}`))
    if (action.kind !== "completed") return action.intent
    const nextObservation = action.observation === undefined
      ? await observe(session, controller, emit, executionId, plan.request.application.baseUrl)
      : await assessObservation(action.observation, emit, executionId, plan.request.application.baseUrl)
    if (nextObservation.kind !== "observed") return observationIntent(nextObservation)
    currentObservation = nextObservation.observation
  }
  return verifyOutcome(plan.request.expectedOutcome, verifier, worth, currentObservation, undefined, controller, emit, executionId, plan.replay.id)
}

function admitStep(guard: ExperimentStepGuard | undefined, step: ReplayStep): ExperimentTerminal | undefined {
  if (guard === undefined) return undefined
  try {
    const result = guard.admit(step)
    return result.kind === "denied" ? { kind: "failure", message: result.message } : undefined
  } catch {
    return { kind: "failure", message: "the task-specific step policy failed closed" }
  }
}

async function observe(
  session: SolariSession,
  controller: OperationController,
  emit: RuntimeEventEmitter,
  executionId: ExecutionId,
  applicationBaseUrl: string,
  allowFreshSessionOffOrigin = false,
): Promise<ObservationOutcome> {
  const gate = controller.check()
  if (gate.kind === "stop") return { kind: "terminal", intent: { kind: "control_stop", stop: gate.stop } }
  const result = await session.observe(controller.context)
  if (result.kind !== "observed") return { kind: "terminal", intent: solariObservationIntent(result) }
  return assessObservation(result.observation, emit, executionId, applicationBaseUrl, allowFreshSessionOffOrigin)
}

async function assessObservation(
  observation: Observation,
  emit: RuntimeEventEmitter,
  executionId: ExecutionId,
  applicationBaseUrl: string,
  allowFreshSessionOffOrigin = false,
): Promise<ObservationOutcome> {
  const publication = await emit("browser.observed", { executionId, sessionId: observation.sessionId, observationId: observation.id }, eventIdempotencyKey("browser.observed", `${observation.sessionId}:${observation.id}`))
  const publicationIntent = eventPublicationIntent(publication, { kind: "completed" })
  if (publicationIntent !== undefined) return { kind: "terminal", intent: publicationIntent }
  if (!sameApplicationOrigin(observation.url, applicationBaseUrl)) {
    if (allowFreshSessionOffOrigin && isFreshSessionUrl(observation.url)) {
      return { kind: "fresh_session_off_origin", observation }
    }
    return { kind: "terminal", intent: { kind: "failure", message: "Solari observation left the admitted application origin" } }
  }
  const safety = assessObservationSafety(observation)
  if (!safety.ok) return { kind: "terminal", intent: { kind: "failure", message: "safety classification failed" } }
  return safety.value.kind === "stop"
    ? { kind: "terminal", intent: { kind: "safety_stop", stop: safety.value.result } }
    : { kind: "observed", observation }
}

function isFreshSessionUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "about:" && url.pathname === "blank"
  } catch {
    return false
  }
}

function observationIntent(outcome: Exclude<ObservationOutcome, { readonly kind: "observed" }>): ExperimentTerminal {
  return outcome.kind === "fresh_session_off_origin"
    ? { kind: "failure", message: "fresh Solari page remained off-origin after bootstrap navigation" }
    : outcome.intent
}

function sameApplicationOrigin(observationUrl: string, applicationBaseUrl: string): boolean {
  try {
    const observation = new URL(observationUrl)
    const application = new URL(applicationBaseUrl)
    return observation.origin === application.origin && observation.username === "" && observation.password === ""
  } catch {
    return false
  }
}

async function executeStep(
  session: SolariSession,
  step: ReplayStep,
  controller: OperationController,
  emit: RuntimeEventEmitter,
  executionId: ExecutionId,
  idempotencyKey: string,
): Promise<StepOutcome> {
  const gate = controller.reserveBrowserAction()
  if (gate.kind === "stop") return { kind: "terminal", intent: { kind: "control_stop", stop: gate.stop } }
  const preflight = controller.check()
  if (preflight.kind === "stop") return { kind: "terminal", intent: { kind: "control_stop", stop: preflight.stop } }
  const result = await session.executeStep(step, controller.context)
  if (result.kind === "completed") {
    const publication = await emit("browser.action", { executionId, sessionId: session.sessionId, actionType: step.type }, idempotencyKey)
    const publicationIntent = eventPublicationIntent(publication, { kind: "completed" })
    if (publicationIntent !== undefined) return { kind: "terminal", intent: publicationIntent }
    const afterAction = controller.check()
    if (afterAction.kind === "stop") return { kind: "terminal", intent: { kind: "control_stop", stop: promoteCompletedEffect(afterAction.stop) } }
    return { kind: "completed", observation: result.observation }
  }
  return { kind: "terminal", intent: solariStepIntent(result) }
}

function modelResultIntent<TOutput>(result: ReasoningResult<TOutput>, controller: OperationController): ExperimentTerminal | undefined {
  switch (result.kind) {
    case "denied":
      return result.reason === "budget_exhausted"
        ? { kind: "control_stop", stop: budgetStop("model_calls", controller) }
        : { kind: "failure", message: "reasoning provider does not support the requested decision schema" }
    case "cancelled": return { kind: "control_stop", stop: cancelledStop(effectSafePoint(result.effect), result.effect) }
    case "timed_out": return { kind: "control_stop", stop: deadlineStop(result.effect) }
    case "failed": return { kind: "failure", message: result.message, posture: result.effect }
    case "completed": return undefined
  }
}

async function emitModelEvent<TOutput>(
  result: ReasoningResult<TOutput>,
  emit: RuntimeEventEmitter,
  executionId: ExecutionId,
  logicalIdentity: string,
  role: "explorer" | "verifier",
): Promise<ExperimentTerminal | undefined> {
  const usage = reasoningUsage(result)
  if (usage === undefined) return undefined
  const publication = await emit("model.called", {
    executionId,
    role,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    estimatedModelCostUsd: usage.estimatedModelCostUsd,
  }, eventIdempotencyKey("model.called", `${executionId}:${role}:${logicalIdentity}`))
  return eventPublicationIntent(publication, result.kind === "completed" ? { kind: "completed" } : { kind: "unknown", recovery: "owner_reconciliation_required" })
}

function reasoningUsage<TOutput>(result: ReasoningResult<TOutput>): ReasoningUsage | undefined {
  if (result.kind === "completed") return result.completion.usage
  if (result.kind === "cancelled" || result.kind === "timed_out" || result.kind === "failed") return result.usage
  return undefined
}

function solariObservationIntent(result: Exclude<SolariObservationResult, { readonly kind: "observed" }>): ExperimentTerminal {
  switch (result.kind) {
    case "cancelled": return { kind: "control_stop", stop: cancelledStop(effectSafePoint(result.effect), result.effect) }
    case "timed_out": return { kind: "control_stop", stop: deadlineStop(result.effect) }
    case "failed": return { kind: "failure", message: result.message, posture: result.effect }
  }
}

function solariStepIntent(result: Exclude<SolariStepResult, { readonly kind: "completed" }>): ExperimentTerminal {
  switch (result.kind) {
    case "cancelled":
      return {
        kind: "control_stop",
        stop: { kind: "cancelled", terminal: true, safePoint: result.safePoint === "after_step" ? "after_effect" : "before_effect", posture: result.effect },
      }
    case "timed_out": return { kind: "control_stop", stop: { kind: "deadline_exceeded", terminal: true, posture: result.effect } }
    case "failed": return { kind: "failure", message: result.failure.message, replayFailure: result.failure, posture: result.effect }
  }
}

async function verifyOutcome(
  conditions: readonly Condition[] | undefined,
  verifier: SemanticVerifier | undefined,
  worth: WorthEvidenceReader,
  observation: Observation,
  output: JsonValue | undefined,
  controller: OperationController,
  emit: RuntimeEventEmitter,
  executionId: ExecutionId,
  replayVersionId?: ReplayVersionId,
): Promise<ExperimentTerminal> {
  if (conditions === undefined || conditions.length === 0) {
    const gate = controller.check()
    return gate.kind === "stop"
      ? { kind: "control_stop", stop: promoteCompletedEffect(gate.stop) }
      : { kind: "success", ...(output === undefined ? {} : { output }) }
  }
  if (verifier === undefined) return { kind: "failure", message: "semantic outcome verifier is required for this experiment" }
  const gate = controller.reserveModelCall()
  if (gate.kind === "stop") return { kind: "control_stop", stop: gate.stop }

  let result: SemanticVerificationResult
  try {
    result = await verifier.verify({ conditions, observation, ...(output === undefined ? {} : { output }) }, controller.context)
  } catch {
    return { kind: "failure", message: "semantic outcome verifier failed before returning a result" }
  }
  const usageIntent = await emitVerificationUsage(result, emit, executionId, observation.id)
  if (usageIntent !== undefined) return usageIntent
  const afterVerification = controller.check()
  if (afterVerification.kind === "stop") return { kind: "control_stop", stop: promoteCompletedEffect(afterVerification.stop) }
  switch (result.kind) {
    case "verified":
      return result.effect.kind === "completed"
        ? { kind: "success", ...(result.output === undefined ? { ...(output === undefined ? {} : { output }) } : { output: result.output }) }
        : { kind: "failure", message: "semantic verifier did not confirm its external effect", posture: result.effect }
    case "failed": {
      if (result.effect.kind !== "completed") return { kind: "failure", message: result.message, posture: result.effect }
      if (replayVersionId === undefined) return { kind: "failure", message: result.message }
      const replayFailure = await postconditionFailure(result, conditions, replayVersionId, worth, controller)
      if (replayFailure.kind === "stopped") return { kind: "control_stop", stop: replayFailure.stop }
      if (replayFailure.kind === "invalid") return { kind: "failure", message: `${result.message}; ${replayFailure.message}` }
      return { kind: "failure", message: result.message, replayFailure: replayFailure.failure }
    }
    case "cancelled": return { kind: "control_stop", stop: cancelledStop(effectSafePoint(result.effect), result.effect) }
    case "timed_out": return { kind: "control_stop", stop: deadlineStop(result.effect) }
  }
}

async function emitVerificationUsage(
  result: SemanticVerificationResult,
  emit: RuntimeEventEmitter,
  executionId: ExecutionId,
  observationId: Observation["id"],
): Promise<ExperimentTerminal | undefined> {
  if (result.usage === undefined) return undefined
  if (!validReasoningUsage(result.usage)) return { kind: "failure", message: "semantic verifier returned invalid usage metadata", posture: result.effect }
  const publication = await emit("model.called", {
    executionId,
    role: "verifier",
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    estimatedModelCostUsd: result.usage.estimatedModelCostUsd,
  }, eventIdempotencyKey("model.called", `${executionId}:verifier:${observationId}`))
  return eventPublicationIntent(publication, result.effect)
}

function validReasoningUsage(usage: ReasoningUsage): boolean {
  return Number.isSafeInteger(usage.inputTokens) && usage.inputTokens >= 0 &&
    Number.isSafeInteger(usage.outputTokens) && usage.outputTokens >= 0 &&
    Number.isFinite(usage.estimatedModelCostUsd) && usage.estimatedModelCostUsd >= 0
}

type PostconditionFailureResult =
  | { readonly kind: "valid"; readonly failure: ReplayFailure }
  | { readonly kind: "invalid"; readonly message: string }
  | { readonly kind: "stopped"; readonly stop: RuntimeStop }

async function postconditionFailure(
  result: Extract<SemanticVerificationResult, { readonly kind: "failed" }>,
  conditions: readonly Condition[],
  replayVersionId: ReplayVersionId,
  worth: WorthEvidenceReader,
  controller: OperationController,
): Promise<PostconditionFailureResult> {
  if (validateCondition(result.condition).length > 0) return { kind: "invalid", message: "semantic verifier returned an invalid postcondition" }
  if (!conditions.some((condition) => sameCondition(condition, result.condition))) return { kind: "invalid", message: "semantic verifier returned an unexpected postcondition" }
  if (!Array.isArray(result.evidenceIds) || result.evidenceIds.length === 0) return { kind: "invalid", message: "semantic verifier returned no evidence for the failed postcondition" }
  const evidenceIds = result.evidenceIds as readonly unknown[]
  if (evidenceIds.some((evidenceId) => typeof evidenceId !== "string" || evidenceId.trim().length === 0)) return { kind: "invalid", message: "semantic verifier returned an invalid evidence reference" }
  if (new Set(evidenceIds).size !== evidenceIds.length) return { kind: "invalid", message: "semantic verifier returned duplicate evidence references" }

  for (const evidenceId of evidenceIds) {
    if (worth.readEvidence === undefined) return { kind: "invalid", message: "WORTH evidence reading is unavailable on the live runtime port" }
    const evidence = await worth.readEvidence(evidenceId as EvidenceId, controller.context)
    const afterEvidenceRead = controller.check()
    if (afterEvidenceRead.kind === "stop") return { kind: "stopped", stop: afterEvidenceRead.stop }
    if (evidence.kind === "cancelled") return { kind: "stopped", stop: cancelledStop(effectSafePoint(evidence.posture), evidence.posture) }
    if (evidence.kind === "timed_out") return { kind: "stopped", stop: deadlineStop(evidence.posture) }
    if (evidence.kind === "not_found" || evidence.kind === "failed") return { kind: "invalid", message: "Worth did not authorize the verifier evidence" }
    if (evidence.value.id !== evidenceId) return { kind: "invalid", message: "Worth returned a different evidence identity" }
    if (!Number.isSafeInteger(evidence.value.revision) || evidence.value.revision < 0) return { kind: "invalid", message: "Worth returned an invalid evidence revision" }
    if (evidence.value.kind === "postcondition" &&
      (evidence.value.result !== "not_satisfied" || !sameCondition(evidence.value.condition, result.condition))) {
      return { kind: "invalid", message: "Worth evidence does not support the failed postcondition" }
    }
    if (evidence.value.kind === "failure" && evidence.value.replayVersionId !== undefined && evidence.value.replayVersionId !== replayVersionId) {
      return { kind: "invalid", message: "Worth evidence belongs to a different replay" }
    }
  }

  return { kind: "valid", failure: {
    kind: "postcondition_failed",
    condition: result.condition,
    message: result.message,
    evidenceIds: evidenceIds as readonly EvidenceId[],
  } }
}

function sameCondition(left: Condition, right: Condition): boolean {
  if (left.kind !== right.kind) return false
  switch (left.kind) {
    case "url_matches": return right.kind === "url_matches" && left.pattern === right.pattern
    case "text_present": return right.kind === "text_present" && left.text === right.text
    case "interactable_present": return right.kind === "interactable_present" && left.semanticDescription === right.semanticDescription
    case "cart_count_increased": return right.kind === "cart_count_increased" && left.baselineKey === right.baselineKey
    case "product_in_cart": return right.kind === "product_in_cart" && left.productRef === right.productRef
    case "authentication_required": return right.kind === "authentication_required"
    case "checkout_started": return right.kind === "checkout_started"
    case "custom": return right.kind === "custom" && left.name === right.name && sameJsonValue(left.value, right.value)
  }
}

function sameJsonValue(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  return stableJsonStringify(left) === stableJsonStringify(right)
}

function stableJsonStringify(value: unknown): string {
  if (value === undefined || value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJsonStringify).join(",")}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableJsonStringify(child)}`)
    .join(",")}}`
}

export function eventPublicationIntent(publication: RuntimeEventPublication, posture: PartialEffectPosture): ExperimentTerminal | undefined {
  switch (publication.kind) {
    case "published": return undefined
    case "stopped": return { kind: "control_stop", stop: applyEventPosture(publication.stop, posture) }
    case "failed": return { kind: "failure", message: publication.message, posture: preserveEventEffect(publication.posture, posture) }
  }
}

function applyEventPosture(stop: RuntimeStop, posture: PartialEffectPosture): RuntimeStop {
  const effectivePosture = preserveEventEffect(stop.posture, posture)
  switch (stop.kind) {
    case "cancelled":
      return { ...stop, safePoint: effectivePosture.kind === "not_started" ? "before_effect" : "after_effect", posture: effectivePosture }
    case "deadline_exceeded": return { ...stop, posture: effectivePosture }
    case "budget_exhausted":
    case "invalid_budget_request":
      return stop
  }
}

function preserveEventEffect(eventPosture: PartialEffectPosture, priorPosture: PartialEffectPosture): PartialEffectPosture {
  return eventPosture.kind === "not_started" ? priorPosture : eventPosture
}

function classifyDecisionSafety(decision: Extract<DirectDecision, { readonly kind: "stop" }>, observedAt: string): ExperimentTerminal {
  const assessment = classifySafetyBoundary({ observedAt, signal: decision.signal })
  if (!assessment.ok || assessment.value.kind !== "stop") return { kind: "failure", message: "invalid safety stop decision" }
  return { kind: "safety_stop", stop: assessment.value.result }
}

function budgetStop(resource: "model_calls" | "browser_actions", controller: OperationController): RuntimeStop {
  const limit = resource === "model_calls" ? controller.context.budget.maxModelCalls : controller.context.budget.maxBrowserActions
  return { kind: "budget_exhausted", terminal: true, resource, limit: limit ?? controller.snapshot()[resource === "model_calls" ? "modelCalls" : "browserActions"], posture: { kind: "not_started" } }
}

function cancelledStop(safePoint: "before_effect" | "after_effect", posture: PartialEffectPosture = safePoint === "after_effect" ? { kind: "unknown", recovery: "owner_reconciliation_required" } : { kind: "not_started" }): RuntimeStop {
  return { kind: "cancelled", terminal: true, safePoint, posture }
}

function deadlineStop(posture: PartialEffectPosture = { kind: "not_started" }): RuntimeStop {
  return { kind: "deadline_exceeded", terminal: true, posture }
}

function effectSafePoint(effect: PartialEffectPosture): "before_effect" | "after_effect" {
  return effect.kind === "not_started" ? "before_effect" : "after_effect"
}

function promoteCompletedEffect(stop: RuntimeStop): RuntimeStop {
  switch (stop.kind) {
    case "cancelled": return { ...stop, safePoint: "after_effect", posture: { kind: "completed" } }
    case "deadline_exceeded": return { ...stop, posture: { kind: "completed" } }
    case "budget_exhausted":
    case "invalid_budget_request":
      return stop
  }
}
