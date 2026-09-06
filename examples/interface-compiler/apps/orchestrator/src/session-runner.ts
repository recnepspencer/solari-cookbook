import {
  classifySafetyBoundary,
  type ExecutionId,
  type Observation,
  type ReasoningModel,
  type ReasoningResult,
  type ReasoningUsage,
  type ReplayStep,
  type SolariObservationResult,
  type SolariSession,
  type SolariStepResult,
} from "@interface-compiler/domain"
import { diagnoseReplayStepFailure } from "./failure-diagnosis.js"
import { eventIdempotencyKey } from "./event-publishing.js"
import type { OperationController } from "./operation.js"
import { verifyOutcome } from "./outcome-verification.js"
import type { CompiledExperimentPlan, DirectDecision, DirectExperimentPlan, ExperimentPlan } from "./planning.js"
import { validateDirectDecision } from "./planning.js"
import { assessObservationSafety, assessReplayStepSafety } from "./safety.js"
import { budgetStop, cancelledStop, deadlineStop, effectSafePoint, eventPublicationIntent, postActionControlStop, promoteCompletedEffect } from "./session-control.js"
import type { ExperimentTerminal, RuntimeEventEmitter } from "./session-types.js"
import type { SemanticVerifier } from "./semantic-verifier.js"
import type { ExperimentStepGuard } from "./step-policy.js"

type ObservationOutcome =
  | { readonly kind: "observed"; readonly observation: Observation }
  | { readonly kind: "fresh_session_off_origin"; readonly observation: Observation }
  | { readonly kind: "terminal"; readonly intent: ExperimentTerminal }
type StepOutcome =
  | { readonly kind: "completed"; readonly observation?: Observation }
  | { readonly kind: "terminal"; readonly intent: ExperimentTerminal }

export type { ExperimentTerminal, RuntimeEventEmitter, RuntimeEventPublication } from "./session-types.js"
export { eventPublicationIntent } from "./session-control.js"

export async function runExperimentSession(
  plan: ExperimentPlan,
  session: SolariSession,
  controller: OperationController,
  model: ReasoningModel | undefined,
  verifier: SemanticVerifier | undefined,
  emit: RuntimeEventEmitter,
  executionId: ExecutionId,
  stepGuard?: ExperimentStepGuard,
): Promise<ExperimentTerminal> {
  let firstObservation = await observe(session, controller, emit, executionId, plan.request.application.baseUrl, true)
  if (firstObservation.kind === "fresh_session_off_origin") {
    const navigation: ReplayStep = { type: "navigate", url: plan.request.application.baseUrl }
    const admission = admitStep(stepGuard, navigation)
    if (admission !== undefined) return admission
    const action = await executeStep(session, navigation, controller, emit, executionId, eventIdempotencyKey("browser.action", `${executionId}:fresh-session-navigation`), 0)
    if (action.kind !== "completed") return action.intent
    firstObservation = action.observation === undefined
      ? await observe(session, controller, emit, executionId, plan.request.application.baseUrl)
      : await assessObservation(action.observation, emit, executionId, plan.request.application.baseUrl)
  }
  if (firstObservation.kind !== "observed") return observationIntent(firstObservation)
  return plan.kind === "direct"
    ? runDirect(plan, session, firstObservation.observation, controller, model, verifier, emit, executionId, stepGuard)
    : runCompiled(plan, session, firstObservation.observation, controller, verifier, emit, executionId, stepGuard)
}

async function runDirect(
  plan: DirectExperimentPlan,
  session: SolariSession,
  observation: Observation,
  controller: OperationController,
  model: ReasoningModel | undefined,
  verifier: SemanticVerifier | undefined,
  emit: RuntimeEventEmitter,
  executionId: ExecutionId,
  stepGuard?: ExperimentStepGuard,
): Promise<ExperimentTerminal> {
  if (model === undefined) return { kind: "failure", message: "reasoning model became unavailable before a call" }
  let currentObservation = observation
  let modelCallIndex = 0
  let actionIndex = 0
  let completionFeedback: string | undefined
  const successfulSteps: ReplayStep[] = []
  for (;;) {
    const modelGate = controller.reserveModelCall()
    if (modelGate.kind === "stop") return { kind: "control_stop", stop: modelGate.stop }
    const modelPreflight = controller.check()
    if (modelPreflight.kind === "stop") return { kind: "control_stop", stop: modelPreflight.stop }
    const logicalIdentity = `${modelCallIndex++}`
    const result = await model.structuredComplete<unknown, DirectDecision>({
      role: "explorer",
      objective: plan.request.objective,
      input: plan.request.input,
      expectedOutcome: plan.request.expectedOutcome,
      observation: currentObservation,
      successfulActions: successfulSteps,
      ...(completionFeedback === undefined ? {} : { previousCompletionFailure: completionFeedback }),
      instructions: [
        "Choose exactly one next semantic browser action, or complete only when the expected outcome is visibly satisfied.",
        "Use role, accessible name, or visible text. Never emit CSS/XPath selectors, credentials, personal data, or implementation code.",
        "Use wait when the previous action has not yet changed the observed page.",
      ],
    }, plan.decisionSchema, controller.context)
    const modelEventIntent = await emitModelEvent(result, emit, executionId, logicalIdentity)
    if (modelEventIntent !== undefined) return modelEventIntent
    const modelTerminal = modelResultIntent(result, controller)
    if (modelTerminal !== undefined) return modelTerminal
    if (result.kind !== "completed") return { kind: "failure", message: "reasoning provider returned no decision" }
    const afterModel = controller.check()
    if (afterModel.kind === "stop") return { kind: "control_stop", stop: promoteCompletedEffect(afterModel.stop) }
    if (validateDirectDecision(result.completion.output).length > 0) return { kind: "failure", message: "reasoning provider returned an invalid decision" }
    const decision = result.completion.output
    if (decision.kind === "complete") {
      const terminal = await verifyOutcome(plan.request.expectedOutcome, verifier, currentObservation, decision.output, controller, emit, executionId)
      if (terminal.kind === "success") return { ...terminal, successfulSteps: freezeSteps(successfulSteps) }
      if (plan.continueAfterUnverifiedCompletion === true && terminal.kind === "failure") { completionFeedback = terminal.message; continue }
      return terminal
    }
    if (decision.kind === "stop") return classifyDecisionSafety(decision, currentObservation.observedAt)
    completionFeedback = undefined
    const admission = admitStep(stepGuard, decision.step)
    if (admission !== undefined) return admission
    const safety = assessReplayStepSafety(decision.step, currentObservation.observedAt)
    if (!safety.ok) return { kind: "failure", message: "safety classification failed" }
    if (safety.value.kind === "stop") return { kind: "safety_stop", stop: safety.value.result }
    const index = actionIndex++
    const action = await executeStep(session, decision.step, controller, emit, executionId, eventIdempotencyKey("browser.action", `${executionId}:${index}`), index)
    if (action.kind !== "completed") return executionIncident(action.intent)
    successfulSteps.push(structuredClone(decision.step))
    const next = action.observation === undefined
      ? await observe(session, controller, emit, executionId, plan.request.application.baseUrl)
      : await assessObservation(action.observation, emit, executionId, plan.request.application.baseUrl)
    if (next.kind !== "observed") return observationIntent(next)
    currentObservation = next.observation
  }
}

async function runCompiled(
  plan: CompiledExperimentPlan,
  session: SolariSession,
  observation: Observation,
  controller: OperationController,
  verifier: SemanticVerifier | undefined,
  emit: RuntimeEventEmitter,
  executionId: ExecutionId,
  stepGuard?: ExperimentStepGuard,
): Promise<ExperimentTerminal> {
  let currentObservation = observation
  const precondition = await verifyOutcome(plan.request.preconditions, verifier, currentObservation, undefined, controller, emit, executionId, undefined, "precondition", plan.request.input)
  if (precondition.kind !== "success") return precondition
  for (const [stepIndex, step] of plan.replay.steps.entries()) {
    const admission = admitStep(stepGuard, step)
    if (admission !== undefined) return admission
    const safety = assessReplayStepSafety(step, currentObservation.observedAt)
    if (!safety.ok) return { kind: "failure", message: "safety classification failed" }
    if (safety.value.kind === "stop") return { kind: "safety_stop", stop: safety.value.result }
    const action = await executeStep(session, step, controller, emit, executionId, eventIdempotencyKey("browser.action", `${executionId}:${plan.replay.id}:${stepIndex}`), stepIndex)
    if (action.kind !== "completed") return diagnoseCompiledStepIntent(action.intent, step, currentObservation, plan.request.application.baseUrl)
    const next = action.observation === undefined
      ? await observe(session, controller, emit, executionId, plan.request.application.baseUrl)
      : await assessObservation(action.observation, emit, executionId, plan.request.application.baseUrl)
    if (next.kind !== "observed") return observationIntent(next)
    currentObservation = next.observation
  }
  return verifyOutcome(plan.request.expectedOutcome, verifier, currentObservation, undefined, controller, emit, executionId, plan.replay.id, "postcondition", plan.request.input, plan.capability.outputSchema)
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

async function observe(session: SolariSession, controller: OperationController, emit: RuntimeEventEmitter, executionId: ExecutionId, applicationBaseUrl: string, allowFreshSessionOffOrigin = false): Promise<ObservationOutcome> {
  const gate = controller.check()
  if (gate.kind === "stop") return { kind: "terminal", intent: { kind: "control_stop", stop: gate.stop } }
  const result = await session.observe(controller.context)
  return result.kind === "observed"
    ? assessObservation(result.observation, emit, executionId, applicationBaseUrl, allowFreshSessionOffOrigin)
    : { kind: "terminal", intent: solariObservationIntent(result) }
}

async function assessObservation(observation: Observation, emit: RuntimeEventEmitter, executionId: ExecutionId, applicationBaseUrl: string, allowFreshSessionOffOrigin = false): Promise<ObservationOutcome> {
  const publication = await emit("browser.observed", { executionId, sessionId: observation.sessionId, observationId: observation.id }, eventIdempotencyKey("browser.observed", `${observation.sessionId}:${observation.id}`))
  const publicationIntent = eventPublicationIntent(publication, { kind: "completed" })
  if (publicationIntent !== undefined) return { kind: "terminal", intent: publicationIntent }
  if (!sameApplicationOrigin(observation.url, applicationBaseUrl)) {
    if (allowFreshSessionOffOrigin && isFreshSessionUrl(observation.url)) return { kind: "fresh_session_off_origin", observation }
    return { kind: "terminal", intent: { kind: "failure", message: "Solari observation left the admitted application origin" } }
  }
  const safety = assessObservationSafety(observation)
  if (!safety.ok) return { kind: "terminal", intent: { kind: "failure", message: "safety classification failed" } }
  return safety.value.kind === "stop" ? { kind: "terminal", intent: { kind: "safety_stop", stop: safety.value.result } } : { kind: "observed", observation }
}

function observationIntent(outcome: Exclude<ObservationOutcome, { readonly kind: "observed" }>): ExperimentTerminal {
  return outcome.kind === "fresh_session_off_origin" ? { kind: "failure", message: "fresh Solari page remained off-origin after bootstrap navigation" } : outcome.intent
}

function diagnoseCompiledStepIntent(intent: ExperimentTerminal, step: ReplayStep, observation: Observation, applicationBaseUrl: string): ExperimentTerminal {
  if (intent.kind !== "failure" || intent.replayFailure === undefined) return intent
  const diagnosis = diagnoseReplayStepFailure(step, observation, intent.replayFailure, applicationBaseUrl)
  if (diagnosis.kind === "repairable_drift") return { ...intent, replayFailure: diagnosis.failure, classification: diagnosis.classification }
  return { kind: "failure", message: intent.message, ...(intent.posture === undefined ? {} : { posture: intent.posture }), classification: diagnosis.classification }
}

async function executeStep(session: SolariSession, step: ReplayStep, controller: OperationController, emit: RuntimeEventEmitter, executionId: ExecutionId, idempotencyKey: string, stepIndex?: number): Promise<StepOutcome> {
  const gate = controller.reserveBrowserAction()
  if (gate.kind === "stop") return { kind: "terminal", intent: { kind: "control_stop", stop: gate.stop } }
  const preflight = controller.check()
  if (preflight.kind === "stop") return { kind: "terminal", intent: { kind: "control_stop", stop: preflight.stop } }
  const result = await session.executeStep(step, controller.context, stepIndex)
  const postActionStop = postActionControlStop(controller, result.effect)
  if (postActionStop !== undefined) return { kind: "terminal", intent: { kind: "control_stop", stop: postActionStop } }
  if (result.kind !== "completed") return { kind: "terminal", intent: solariStepIntent(result) }
  const publication = await emit("browser.action", { executionId, sessionId: session.sessionId, actionType: step.type }, idempotencyKey)
  const intent = eventPublicationIntent(publication, { kind: "completed" })
  if (intent !== undefined) return { kind: "terminal", intent }
  const after = controller.check()
  return after.kind === "stop" ? { kind: "terminal", intent: { kind: "control_stop", stop: promoteCompletedEffect(after.stop) } } : { kind: "completed", observation: result.observation }
}

function modelResultIntent<T>(result: ReasoningResult<T>, controller: OperationController): ExperimentTerminal | undefined {
  switch (result.kind) {
    case "denied": return result.reason === "budget_exhausted" ? { kind: "control_stop", stop: budgetStop("model_calls", controller) } : { kind: "failure", message: "reasoning provider does not support the requested decision schema" }
    case "cancelled": return { kind: "control_stop", stop: cancelledStop(effectSafePoint(result.effect), result.effect) }
    case "timed_out": return { kind: "control_stop", stop: deadlineStop(result.effect) }
    case "failed": return { kind: "failure", message: result.message, posture: result.effect }
    case "completed": return undefined
  }
}

async function emitModelEvent<T>(result: ReasoningResult<T>, emit: RuntimeEventEmitter, executionId: ExecutionId, logicalIdentity: string): Promise<ExperimentTerminal | undefined> {
  const usage = reasoningUsage(result)
  if (usage === undefined) return undefined
  const publication = await emit("model.called", { executionId, role: "explorer", inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, estimatedModelCostMicrocents: usage.estimatedModelCostMicrocents }, eventIdempotencyKey("model.called", `${executionId}:explorer:${logicalIdentity}`))
  return eventPublicationIntent(publication, result.kind === "completed" ? { kind: "completed" } : { kind: "unknown", recovery: "owner_reconciliation_required" })
}

function reasoningUsage<T>(result: ReasoningResult<T>): ReasoningUsage | undefined {
  if (result.kind === "completed") return result.completion.usage
  if (result.kind === "cancelled" || result.kind === "timed_out" || result.kind === "failed") return result.usage
  return undefined
}

function solariObservationIntent(result: Exclude<SolariObservationResult, { readonly kind: "observed" }>): ExperimentTerminal {
  switch (result.kind) {
    case "cancelled": return { kind: "control_stop", stop: cancelledStop(effectSafePoint(result.effect), result.effect) }
    case "timed_out": return { kind: "control_stop", stop: deadlineStop(result.effect) }
    case "failed": return { kind: "failure", message: result.message, posture: result.effect, classification: "provider_failure" }
  }
}

function solariStepIntent(result: Exclude<SolariStepResult, { readonly kind: "completed" }>): ExperimentTerminal {
  switch (result.kind) {
    case "cancelled": return { kind: "control_stop", stop: { kind: "cancelled", terminal: true, safePoint: result.safePoint === "after_step" ? "after_effect" : "before_effect", posture: result.effect } }
    case "timed_out": return { kind: "control_stop", stop: { kind: "deadline_exceeded", terminal: true, posture: result.effect } }
    case "failed": return result.effect.kind === "not_started"
      ? { kind: "failure", message: result.failure.message, replayFailure: result.failure, posture: result.effect, classification: "indeterminate" }
      : { kind: "failure", message: result.failure.message, posture: result.effect, classification: "provider_failure" }
  }
}

function executionIncident(intent: ExperimentTerminal): ExperimentTerminal {
  return intent.kind !== "failure" ? intent : { kind: "failure", message: intent.message, ...(intent.posture === undefined ? {} : { posture: intent.posture }), classification: intent.classification ?? "provider_failure" }
}

function classifyDecisionSafety(decision: Extract<DirectDecision, { readonly kind: "stop" }>, observedAt: string): ExperimentTerminal {
  const assessment = classifySafetyBoundary({ observedAt, signal: decision.signal })
  return !assessment.ok || assessment.value.kind !== "stop" ? { kind: "failure", message: "invalid safety stop decision" } : { kind: "safety_stop", stop: assessment.value.result }
}

function freezeSteps(steps: readonly ReplayStep[]): readonly ReplayStep[] {
  const copy = structuredClone(steps) as ReplayStep[]
  for (const step of copy) { if ("target" in step) Object.freeze(step.target); if (step.type === "assert") Object.freeze(step.condition); Object.freeze(step) }
  return Object.freeze(copy)
}

function isFreshSessionUrl(value: string): boolean { try { const url = new URL(value); return url.protocol === "about:" && url.pathname === "blank" } catch { return false } }
function sameApplicationOrigin(observationUrl: string, applicationBaseUrl: string): boolean { try { const observation = new URL(observationUrl); const application = new URL(applicationBaseUrl); return observation.origin === application.origin && observation.username === "" && observation.password === "" } catch { return false } }
