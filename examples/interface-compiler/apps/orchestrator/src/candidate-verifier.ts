import {
  matchesJsonSchema,
  type Application,
  type CapabilityProjection,
  type Clock,
  type Condition,
  type EvidenceReference,
  type IdSource,
  type JsonSchema,
  type JsonValue,
  type Observation,
  type OperationContext,
  type ReplayProjection,
  type ReplayStep,
  type SolariPort,
  type SolariSession,
} from "@interface-compiler/domain"
import type { ReplacementVerificationReceipt } from "@interface-compiler/worth-adapter"
import { diagnoseReplayStepFailure, type ExecutionFailureClassification } from "./failure-diagnosis.js"
import type { OperationController } from "./operation.js"
import type { SemanticVerifier } from "./semantic-verifier.js"
import { assessObservationSafety, assessReplayStepSafety } from "./safety.js"
import { postActionControlStop } from "./session-control.js"

export interface CandidateVerificationEnvironment {
  prepareFreshRun(request: {
    readonly application: Application
    readonly capabilityId: CapabilityProjection["id"]
    readonly replayVersionId: ReplayProjection["id"]
    readonly runIndex: number
    readonly input?: JsonValue
  }, context: OperationContext): Promise<{ readonly kind: "ready" } | { readonly kind: "blocked"; readonly message: string }>
}

export interface CandidateVerificationPorts {
  readonly clock: Clock
  readonly ids: Pick<IdSource, "nextVerificationRunId">
  readonly solari: SolariPort
  readonly verifier: SemanticVerifier
  readonly verificationEnvironment: CandidateVerificationEnvironment
}

export type CandidateVerificationResult =
  | { readonly kind: "completed"; readonly receipt: ReplacementVerificationReceipt; readonly evidence: EvidenceReference }
  | { readonly kind: "blocked"; readonly classification: ExecutionFailureClassification; readonly reason: CandidateVerificationBlockReason; readonly message: string; readonly retryable: boolean }

export type CandidateVerificationBlockReason =
  | "cancelled"
  | "timed_out"
  | "budget_exhausted"
  | "application_unavailable"
  | "precondition_failed"
  | "interaction_failed"
  | "provider_failure"

export async function verifyAdmittedCandidate(
  capability: Extract<CapabilityProjection, { readonly status: "verifying" }>,
  replay: Extract<ReplayProjection, { readonly status: "verifying" }>,
  application: Application,
  input: JsonValue | undefined,
  ports: CandidateVerificationPorts,
  controller: OperationController,
  runIndex: number,
): Promise<CandidateVerificationResult> {
  const context = controller.context
  const gate = controller.check()
  if (gate.kind === "stop") return blockedFromControl(gate.stop.kind)

  try {
    const prepared = await ports.verificationEnvironment.prepareFreshRun({
      application,
      capabilityId: capability.id,
      replayVersionId: replay.id,
      runIndex,
      ...(input === undefined ? {} : { input }),
    }, context)
    if (prepared.kind !== "ready") return blocked("provider_failure", "provider_failure", prepared.message, true)

    const created = await ports.solari.createSession({ application, purpose: "verification", freshness: "fresh" }, context)
    if (created.kind !== "created") return blockedFromSessionCreation(created)

    let result: CandidateVerificationResult
    try {
      result = await executeCandidate(capability, replay, application, input, ports, controller, created.lease.session)
    } catch (error) {
      result = blocked("provider_failure", "provider_failure", `candidate verification failed at its adapter boundary: ${errorMessage(error)}`, true)
    }

    const released = await created.lease.release(context)
    if (released.kind !== "closed") return blocked("provider_failure", "provider_failure", `candidate verification session cleanup failed: ${released.message}`, released.retryable)
    return result
  } catch (error) {
    return blocked("provider_failure", "provider_failure", `candidate verification boundary failed: ${errorMessage(error)}`, true)
  }
}

async function executeCandidate(
  capability: Extract<CapabilityProjection, { readonly status: "verifying" }>,
  replay: Extract<ReplayProjection, { readonly status: "verifying" }>,
  application: Application,
  input: JsonValue | undefined,
  ports: CandidateVerificationPorts,
  controller: OperationController,
  session: SolariSession,
): Promise<CandidateVerificationResult> {
  const initial = await observeCandidateOrigin(session, application, controller)
  if (initial.kind !== "observed") return initial
  const precondition = await verifyConditions(capability.preconditions, initial.observation, input, undefined, "precondition", ports.verifier, controller)
  if (precondition.kind === "blocked") return precondition.result
  if (precondition.kind === "semantic_failure") return blocked("precondition_failed", "precondition_failed", precondition.message, false)

  let currentObservation = initial.observation
  for (const [stepIndex, step] of replay.steps.entries()) {
    const safety = assessReplayStepSafety(step, currentObservation.observedAt)
    if (!safety.ok) return blocked("provider_failure", "provider_failure", "candidate step safety classification failed", false)
    if (safety.value.kind === "stop") return blocked("interaction_failed", "interaction_failed", `candidate step crossed the ${safety.value.result.reason} safety boundary`, false)
    const actionGate = controller.reserveBrowserAction()
    if (actionGate.kind === "stop") return blockedFromControl(actionGate.stop.kind)
    const preflight = controller.check()
    if (preflight.kind === "stop") return blockedFromControl(preflight.stop.kind)
    const action = await session.executeStep(step, controller.context, stepIndex)
    const postActionStop = postActionControlStop(controller, action.effect)
    if (postActionStop !== undefined) return blockedFromControl(postActionStop.kind)
    if (action.kind !== "completed") {
      if (action.kind === "cancelled") return blocked("provider_failure", "cancelled", `candidate step ${stepIndex} was cancelled`, true)
      if (action.kind === "timed_out") return blocked("provider_failure", "timed_out", `candidate step ${stepIndex} timed out`, true)
      if (action.effect.kind !== "not_started") return blocked("provider_failure", "provider_failure", `candidate step ${stepIndex} failed with an uncertain external effect`, true)
      const observed = await session.observe(controller.context)
      if (observed.kind !== "observed") return blockedFromObservation("candidate failure diagnosis", observed)
      const observationBlock = validateCandidateObservation(observed.observation, application)
      if (observationBlock !== undefined) return observationBlock
      const diagnosis = diagnoseReplayStepFailure(step, observed.observation, action.failure, application.baseUrl)
      if (diagnosis.kind !== "repairable_drift") return blocked(diagnosis.classification, diagnosis.classification === "application_unavailable" ? "application_unavailable" : diagnosis.classification === "interaction_failed" ? "interaction_failed" : "provider_failure", `candidate execution incident: ${diagnosis.classification}`, diagnosis.classification !== "interaction_failed")
      return evidenceBackedReceipt("failure", "candidate replay drifted during independent verification", capability, replay, ports, session, controller.context)
    }
    if (action.observation !== undefined) currentObservation = action.observation
    else {
      const observed = await session.observe(controller.context)
      if (observed.kind !== "observed") return blockedFromObservation("candidate outcome observation", observed)
      currentObservation = observed.observation
    }
    const observationBlock = validateCandidateObservation(currentObservation, application)
    if (observationBlock !== undefined) return observationBlock
  }

  const outcome = await verifyConditions(capability.postconditions, currentObservation, input, capability.outputSchema, "candidate_verification", ports.verifier, controller)
  if (outcome.kind === "blocked") return outcome.result
  if (outcome.kind === "semantic_failure") return evidenceBackedReceipt("failure", outcome.message, capability, replay, ports, session, controller.context)
  if (outcome.output === undefined || !matchesJsonSchema(outcome.output, capability.outputSchema)) return evidenceBackedReceipt("failure", "candidate did not satisfy the typed capability contract", capability, replay, ports, session, controller.context)
  return evidenceBackedReceipt("success", undefined, capability, replay, ports, session, controller.context)
}

async function observeCandidateOrigin(
  session: SolariSession,
  application: Application,
  controller: OperationController,
): Promise<{ readonly kind: "observed"; readonly observation: Observation } | Extract<CandidateVerificationResult, { readonly kind: "blocked" }>> {
  const initial = await session.observe(controller.context)
  if (initial.kind !== "observed") return blockedFromObservation("candidate precondition observation", initial)
  if (sameOrigin(initial.observation.url, application.baseUrl)) {
    const observationBlock = validateCandidateObservation(initial.observation, application)
    return observationBlock ?? { kind: "observed", observation: initial.observation }
  }
  if (!isBlankPage(initial.observation.url)) return blocked("interaction_failed", "interaction_failed", "fresh candidate session opened outside the admitted application origin", false)

  const navigation: ReplayStep = { type: "navigate", url: application.baseUrl }
  const safety = assessReplayStepSafety(navigation, initial.observation.observedAt)
  if (!safety.ok || safety.value.kind === "stop") return blocked("interaction_failed", "interaction_failed", "candidate bootstrap navigation failed safety admission", false)
  const actionGate = controller.reserveBrowserAction()
  if (actionGate.kind === "stop") return blockedFromControl(actionGate.stop.kind)
  const preflight = controller.check()
  if (preflight.kind === "stop") return blockedFromControl(preflight.stop.kind)
  const navigated = await session.executeStep(navigation, controller.context)
  const postActionStop = postActionControlStop(controller, navigated.effect)
  if (postActionStop !== undefined) return blockedFromControl(postActionStop.kind)
  if (navigated.kind === "cancelled") return blocked("provider_failure", "cancelled", "candidate bootstrap navigation was cancelled", true)
  if (navigated.kind === "timed_out") return blocked("provider_failure", "timed_out", "candidate bootstrap navigation timed out", true)
  if (navigated.kind === "failed") {
    return navigated.effect.kind === "not_started"
      ? blocked("application_unavailable", "application_unavailable", describeBoundary("candidate bootstrap navigation", navigated), true)
      : blocked("provider_failure", "provider_failure", "candidate bootstrap navigation returned an uncertain provider effect", true)
  }
  const observed = navigated.observation === undefined ? await session.observe(controller.context) : { kind: "observed" as const, observation: navigated.observation, effect: { kind: "completed" as const } }
  if (observed.kind !== "observed") return blockedFromObservation("candidate bootstrap observation", observed)
  if (!sameOrigin(observed.observation.url, application.baseUrl)) return blocked("interaction_failed", "interaction_failed", "candidate bootstrap navigation did not reach the admitted application origin", false)
  const observationBlock = validateCandidateObservation(observed.observation, application)
  return observationBlock ?? { kind: "observed", observation: observed.observation }
}

async function verifyConditions(
  conditions: readonly Condition[],
  observation: Observation,
  input: JsonValue | undefined,
  outputSchema: JsonSchema | undefined,
  phase: "precondition" | "candidate_verification",
  verifier: SemanticVerifier,
  controller: OperationController,
): Promise<{ readonly kind: "verified"; readonly output?: JsonValue } | { readonly kind: "semantic_failure"; readonly message: string } | { readonly kind: "blocked"; readonly result: Extract<CandidateVerificationResult, { readonly kind: "blocked" }> }> {
  if (conditions.length === 0) return { kind: "verified" }
  if (verifier.modelUsage === "required") {
    const gate = controller.reserveModelCall()
    if (gate.kind === "stop") return { kind: "blocked", result: blockedFromControl(gate.stop.kind) }
  }
  const result = await verifier.verify({ phase, conditions, observation, ...(input === undefined ? {} : { input }), ...(outputSchema === undefined ? {} : { outputSchema }) }, controller.context)
  const afterVerification = controller.check()
  if (afterVerification.kind === "stop") return { kind: "blocked", result: blockedFromControl(afterVerification.stop.kind) }
  if (result.kind === "cancelled") return { kind: "blocked", result: blocked("provider_failure", "cancelled", "semantic verification was cancelled", true) }
  if (result.kind === "timed_out") return { kind: "blocked", result: blocked("provider_failure", "timed_out", "semantic verification timed out", true) }
  if (result.kind === "provider_failed") return { kind: "blocked", result: blocked("provider_failure", "provider_failure", `semantic verification provider failed: ${result.message}`, result.retryable) }
  if (result.effect.kind !== "completed") return { kind: "blocked", result: blocked("provider_failure", "provider_failure", "semantic verifier returned an uncertain effect posture", true) }
  return result.kind === "verified"
    ? { kind: "verified", ...(result.output === undefined ? {} : { output: result.output }) }
    : { kind: "semantic_failure", message: result.message }
}

async function evidenceBackedReceipt(
  outcome: "success" | "failure",
  failureMessage: string | undefined,
  capability: Extract<CapabilityProjection, { readonly status: "verifying" }>,
  replay: Extract<ReplayProjection, { readonly status: "verifying" }>,
  ports: CandidateVerificationPorts,
  session: SolariSession,
  context: OperationContext,
): Promise<CandidateVerificationResult> {
  const evidence = await session.captureEvidence({ kind: "session_receipt" }, context)
  if (evidence.kind === "cancelled") return blocked("provider_failure", "cancelled", "candidate evidence capture was cancelled", true)
  if (evidence.kind === "timed_out") return blocked("provider_failure", "timed_out", "candidate evidence capture timed out", true)
  if (evidence.kind === "failed") return blocked("provider_failure", "provider_failure", describeBoundary("candidate verification evidence", evidence), evidence.retryable)
  const core = {
    id: ports.ids.nextVerificationRunId(),
    sessionId: session.sessionId,
    capabilityId: capability.id,
    replayVersionId: replay.id,
    sessionFreshness: "fresh" as const,
    evidenceIds: [evidence.reference.evidenceId],
    completedAt: ports.clock.now() as ReplacementVerificationReceipt["completedAt"],
  }
  const receipt: ReplacementVerificationReceipt = outcome === "success"
    ? { ...core, outcome }
    : { ...core, outcome, failureMessage: failureMessage ?? "candidate verification failed" }
  return { kind: "completed", receipt, evidence: evidence.reference }
}

function describeBoundary(label: string, value: { readonly kind: string; readonly message?: string; readonly reason?: string }): string {
  return `${label} ${value.kind}${value.message === undefined ? value.reason === undefined ? "" : `: ${value.reason}` : `: ${value.message}`}`
}

function blocked(classification: ExecutionFailureClassification, reason: CandidateVerificationBlockReason, message: string, retryable: boolean): Extract<CandidateVerificationResult, { readonly kind: "blocked" }> {
  return { kind: "blocked", classification, reason, message, retryable }
}

function blockedFromControl(kind: "cancelled" | "deadline_exceeded" | "budget_exhausted" | "invalid_budget_request"): Extract<CandidateVerificationResult, { readonly kind: "blocked" }> {
  if (kind === "cancelled") return blocked("provider_failure", "cancelled", "candidate verification was cancelled", true)
  if (kind === "deadline_exceeded") return blocked("provider_failure", "timed_out", "candidate verification timed out", true)
  return blocked("provider_failure", "budget_exhausted", `candidate verification stopped: ${kind}`, true)
}

function blockedFromSessionCreation(result: Exclude<Awaited<ReturnType<SolariPort["createSession"]>>, { readonly kind: "created" }>): Extract<CandidateVerificationResult, { readonly kind: "blocked" }> {
  if (result.kind === "cancelled") return blocked("provider_failure", "cancelled", "fresh candidate session creation was cancelled", true)
  if (result.kind === "timed_out") return blocked("provider_failure", "timed_out", "fresh candidate session creation timed out", true)
  if (result.kind === "denied") return result.reason === "application_unavailable"
    ? blocked("application_unavailable", "application_unavailable", "candidate application is unavailable", true)
    : blocked("provider_failure", result.reason === "budget_exhausted" ? "budget_exhausted" : "provider_failure", `fresh candidate session denied: ${result.reason}`, true)
  return blocked("provider_failure", "provider_failure", describeBoundary("fresh candidate session", result), result.retryable)
}

function blockedFromObservation(label: string, result: Exclude<Awaited<ReturnType<SolariSession["observe"]>>, { readonly kind: "observed" }>): Extract<CandidateVerificationResult, { readonly kind: "blocked" }> {
  if (result.kind === "cancelled") return blocked("provider_failure", "cancelled", `${label} was cancelled`, true)
  if (result.kind === "timed_out") return blocked("provider_failure", "timed_out", `${label} timed out`, true)
  return blocked("provider_failure", "provider_failure", describeBoundary(label, result), result.retryable)
}

function validateCandidateObservation(observation: Observation, application: Application): Extract<CandidateVerificationResult, { readonly kind: "blocked" }> | undefined {
  if (!sameOrigin(observation.url, application.baseUrl)) return blocked("interaction_failed", "interaction_failed", "candidate observation left the admitted application origin", false)
  const safety = assessObservationSafety(observation)
  if (!safety.ok) return blocked("provider_failure", "provider_failure", "candidate observation safety classification failed", false)
  return safety.value.kind === "stop"
    ? blocked("interaction_failed", "interaction_failed", `candidate observation crossed the ${safety.value.result.reason} safety boundary`, false)
    : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isBlankPage(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "about:" && url.pathname === "blank"
  } catch {
    return false
  }
}

function sameOrigin(left: string, right: string): boolean {
  try {
    const candidate = new URL(left)
    const application = new URL(right)
    return candidate.origin === application.origin && candidate.username === "" && candidate.password === ""
  } catch {
    return false
  }
}
