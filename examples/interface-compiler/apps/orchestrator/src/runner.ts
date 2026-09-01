import {
  type Clock,
  type EventPublicationResult,
  type Execution,
  type ExecutionCompletion,
  type ExecutionId,
  type ExecutionStart,
  type IsoTimestamp,
  type IdSource,
  type OperationContext,
  type PartialEffectPosture,
  type ReasoningModel,
  type SolariCloseResult,
  type SolariPort,
  type SolariSessionResult,
} from "@interface-compiler/domain"
import type { WorthExecutionAdmissionResult, WorthRuntimeSettlementResult } from "@interface-compiler/worth-adapter"
import type { OrchestratorWorthPort } from "./worth-ports.js"
import { admitPlan } from "./admission.js"
import { eventIdempotencyKey, publishRuntimeEvent } from "./event-publishing.js"
import { closeSolariSession } from "./session-cleanup.js"
import { type OperationController, type RuntimeStop } from "./operation.js"
import {
  eventPublicationIntent,
  runExperimentSession,
  type ExperimentTerminal,
  type RuntimeEventEmitter,
  type RuntimeEventPublication,
} from "./session-runner.js"
import type { ExperimentPlan } from "./planning.js"
import type { SemanticVerifier } from "./semantic-verifier.js"

export interface OrchestratorPorts {
  readonly clock: Clock
  readonly ids: Pick<IdSource, "nextExecutionId" | "nextEventId">
  readonly worth: OrchestratorWorthPort
  readonly solari: SolariPort
  readonly model?: ReasoningModel
  readonly verifier?: SemanticVerifier
}

export type { ExperimentTerminal } from "./session-runner.js"

export type ExperimentRunResult =
  | {
      readonly kind: "not_started"
      readonly reason:
        | "reasoning_model_unavailable"
        | "operation_stopped"
        | "authority_unavailable"
        | "authority_changed"
        | "execution_start_rejected"
        | "execution_start_failed"
        | "session_creation_failed"
      readonly executionId?: ExecutionId
      readonly stop?: RuntimeStop
      readonly authority?: WorthExecutionAdmissionResult
      readonly message?: string
      readonly events: readonly EventPublicationResult[]
    }
  | {
      readonly kind: "attempted"
      readonly executionId: ExecutionId
      readonly terminal: ExperimentTerminal
      readonly settlement: WorthRuntimeSettlementResult
      readonly events: readonly EventPublicationResult[]
      readonly cleanup: RuntimeCleanup
    }
  | {
      readonly kind: "finalization_blocked"
      readonly executionId: ExecutionId
      readonly reason: "invalid_clock" | "worth_submission_failed" | "authority_changed" | "event_publication_failed"
      readonly message?: string
      readonly authority?: WorthExecutionAdmissionResult | WorthRuntimeSettlementResult
      readonly terminal?: ExperimentTerminal
      readonly settlement?: WorthRuntimeSettlementResult
      readonly events: readonly EventPublicationResult[]
      readonly cleanup: RuntimeCleanup
    }

export type RuntimeCleanup = SolariCloseResult | { readonly kind: "not_created" }

type EmitEvent = RuntimeEventEmitter

export class ExperimentRunner {
  public constructor(private readonly ports: OrchestratorPorts) {}

  public async run(plan: ExperimentPlan, controller: OperationController): Promise<ExperimentRunResult> {
    const gate = controller.check()
    if (gate.kind === "stop") return { kind: "not_started", reason: "operation_stopped", stop: gate.stop, events: [] }

    const admission = await admitPlan(plan, this.ports.worth, controller)
    if (admission.kind === "stopped") return { kind: "not_started", reason: "operation_stopped", stop: admission.stop, events: [] }
    if (admission.kind === "unavailable") return { kind: "not_started", reason: admission.reason, message: admission.message, events: [] }
    plan = admission.plan

    if (plan.kind === "direct" && this.ports.model === undefined) {
      return { kind: "not_started", reason: "reasoning_model_unavailable", events: [] }
    }

    const events: EventPublicationResult[] = []
    let executionId: ExecutionId
    let startedAt: string
    try {
      executionId = this.ports.ids.nextExecutionId()
      startedAt = this.ports.clock.now()
    } catch {
      return { kind: "not_started", reason: "execution_start_failed", message: "execution identity or clock failed", events }
    }
    const emit: EmitEvent = async (type, payload, idempotencyKey) => {
      return publishRuntimeEvent(this.ports.worth, this.ports.ids, this.ports.clock, controller, events, type, payload, idempotencyKey)
    }
    const execution: ExecutionStart = {
      id: executionId,
      capabilityId: plan.request.capabilityId,
      ...(plan.kind === "compiled" ? { replayVersionId: plan.replay.id } : {}),
      mode: plan.mode,
      metrics: initialExecutionMetrics(startedAt),
    }
    const startGate = controller.check()
    if (startGate.kind === "stop") return { kind: "not_started", reason: "operation_stopped", stop: startGate.stop, events }
    let startResult: WorthExecutionAdmissionResult
    try {
      startResult = await this.ports.worth.admitExecution(execution, controller.context)
    } catch {
      return { kind: "not_started", reason: "execution_start_failed", executionId, message: "Worth did not return a start result", events }
    }
    const startStop = worthStartStop(startResult)
    if (startStop !== undefined) {
      if (startResult.kind === "cancelled" && startResult.posture.kind !== "not_started") {
        return { kind: "finalization_blocked", executionId, reason: "worth_submission_failed", message: "Worth cancelled execution start after commit", authority: startResult, terminal: { kind: "control_stop", stop: startStop }, events, cleanup: { kind: "not_created" } }
      }
      if (startResult.kind === "timed_out") {
        return { kind: "finalization_blocked", executionId, reason: "worth_submission_failed", message: "Worth timed out execution start", authority: startResult, terminal: { kind: "control_stop", stop: startStop }, events, cleanup: { kind: "not_created" } }
      }
      return { kind: "not_started", reason: "operation_stopped", executionId, stop: startStop, authority: startResult, events }
    }
    if (startResult.kind !== "admitted") {
      return { kind: "not_started", reason: "execution_start_rejected", executionId, authority: startResult, events }
    }
    // The accepted running projection is the Worth-issued work admission for
    // this contract. No local execution/lifecycle token is retained.
    const executionRevision = startResult.projection.revision
    if (startResult.projection.executionId !== execution.id || startResult.projection.lifecycle !== "started" || startResult.projection.capabilityId !== execution.capabilityId || startResult.projection.mode !== execution.mode || startResult.projection.replayVersionId !== execution.replayVersionId) {
      return { kind: "finalization_blocked", executionId, reason: "authority_changed", message: "Worth accepted execution start without a matching running execution projection", authority: startResult, events, cleanup: { kind: "not_created" } }
    }
    const startedType = plan.kind === "direct" ? "direct.started" : "compiled.started"
    const startedPublication = await emit(startedType, plan.kind === "direct"
      ? { executionId }
      : { executionId, mode: "compiled" }, eventIdempotencyKey(startedType, executionId))
    const startedIntent = eventPublicationIntent(startedPublication, { kind: "completed" })
    if (startedIntent !== undefined) return this.finalizeWithoutSession(plan, executionId, executionRevision, startedAt, startedIntent, controller, events, emit)

    if (plan.kind === "compiled") {
      const replayStartedPublication = await emit("replay.started", { executionId, replayVersionId: plan.replay.id }, eventIdempotencyKey("replay.started", `${executionId}:${plan.replay.id}`))
      const replayStartedIntent = eventPublicationIntent(replayStartedPublication, { kind: "completed" })
      if (replayStartedIntent !== undefined) return this.finalizeWithoutSession(plan, executionId, executionRevision, startedAt, replayStartedIntent, controller, events, emit)
    }

    const sessionGate = controller.check()
    if (sessionGate.kind === "stop") return this.finalizeWithoutSession(plan, executionId, executionRevision, startedAt, { kind: "control_stop", stop: sessionGate.stop }, controller, events, emit)

    let sessionResult: SolariSessionResult
    try {
      sessionResult = await this.ports.solari.createSession({
        application: plan.request.application,
        purpose: plan.kind === "direct" ? "direct" : "replay",
        freshness: "fresh",
        executionId,
      }, controller.context)
    } catch {
      return this.finalizeWithoutSession(plan, executionId, executionRevision, startedAt, { kind: "failure", message: "Solari did not return a session result" }, controller, events, emit)
    }
    if (sessionResult.kind !== "created") {
      const intent = solariSessionCreationIntent(sessionResult, controller)
      return this.finalizeWithoutSession(plan, executionId, executionRevision, startedAt, intent, controller, events, emit)
    }
    let intent: ExperimentTerminal
    let cleanup: SolariCloseResult
    try {
      intent = plan.kind === "direct"
        ? await runExperimentSession(plan, sessionResult.lease.session, controller, this.ports.model, this.ports.verifier, this.ports.worth, emit, executionId)
        : await runExperimentSession(plan, sessionResult.lease.session, controller, undefined, this.ports.verifier, this.ports.worth, emit, executionId)
    } catch {
      intent = { kind: "failure", message: "orchestrator stopped after an unexpected boundary error", posture: { kind: "unknown", recovery: "owner_reconciliation_required" } }
    } finally {
      cleanup = await closeSolariSession(sessionResult.lease, controller.context)
    }
    return this.finalize(plan, executionId, executionRevision, startedAt, intent, cleanup, controller, events, emit)
  }

  private async finalizeWithoutSession(
    plan: ExperimentPlan,
    executionId: ExecutionId,
    executionRevision: number,
    startedAt: string,
    intent: ExperimentTerminal,
    controller: OperationController,
    events: EventPublicationResult[],
    emit: EmitEvent,
  ): Promise<ExperimentRunResult> {
    const cleanup: RuntimeCleanup = { kind: "not_created" }
    return this.finalize(plan, executionId, executionRevision, startedAt, intent, cleanup, controller, events, emit)
  }

  private async finalize(
    plan: ExperimentPlan,
    executionId: ExecutionId,
    executionRevision: number,
    startedAt: string,
    intent: ExperimentTerminal,
    cleanup: RuntimeCleanup,
    controller: OperationController,
    events: EventPublicationResult[],
    emit: EmitEvent,
  ): Promise<ExperimentRunResult> {
    let endedAt: string
    try {
      endedAt = this.ports.clock.now()
    } catch {
      return { kind: "finalization_blocked", executionId, reason: "invalid_clock", terminal: intent, events, cleanup }
    }
    if (!validExecutionWindow(startedAt, endedAt)) return { kind: "finalization_blocked", executionId, reason: "invalid_clock", terminal: intent, events, cleanup }

    const settledIntent = cleanup.kind === "close_failed" ? cleanupFailureIntent(intent) : intent
    const completion = completionFor(settledIntent, plan.kind === "compiled")
    let settlement: WorthRuntimeSettlementResult
    try {
      settlement = await settleDelegatedExecution(this.ports.worth, executionId, executionRevision, completion, endedAt, controller.context)
    } catch {
      return { kind: "finalization_blocked", executionId, reason: "worth_submission_failed", message: "Worth did not return a completion result", terminal: settledIntent, events, cleanup }
    }
    if (settlement.kind !== "settled") {
      return {
        kind: "finalization_blocked",
        executionId,
        reason: "worth_submission_failed",
        message: "Worth could not settle the delegated execution",
        authority: settlement,
        terminal: settledIntent,
        settlement,
        events,
        cleanup,
      }
    }
    let finalPublication: RuntimeEventPublication | undefined
    if (plan.kind === "direct") finalPublication = await emit("direct.completed", { executionId, outcome: outcomeStatus(settledIntent) }, eventIdempotencyKey("direct.completed", executionId))
    else if (settledIntent.kind === "success") finalPublication = await emit("replay.succeeded", { executionId, replayVersionId: plan.replay.id }, eventIdempotencyKey("replay.succeeded", `${executionId}:${plan.replay.id}`))
    else if (settledIntent.kind === "failure") finalPublication = await emit("replay.failed", { executionId, replayVersionId: plan.replay.id }, eventIdempotencyKey("replay.failed", `${executionId}:${plan.replay.id}`))
    if (finalPublication !== undefined && finalPublication.kind !== "published") {
      return {
        kind: "finalization_blocked",
        executionId,
        reason: "event_publication_failed",
        message: "Worth accepted execution completion but the terminal event did not publish",
        authority: settlement,
        terminal: settledIntent,
        settlement,
        events,
        cleanup,
      }
    }
    return {
      kind: "attempted",
      executionId,
      terminal: settledIntent,
      settlement,
      events,
      cleanup,
    }
  }
}

async function settleDelegatedExecution(
  worth: OrchestratorWorthPort,
  executionId: ExecutionId,
  executionRevision: number,
  completion: ExecutionCompletion,
  endedAt: string,
  context: OperationContext,
): Promise<WorthRuntimeSettlementResult> {
  return worth.settleExecution(executionId, completion, endedAt as IsoTimestamp, executionRevision, context)
}

function worthStartStop(result: WorthExecutionAdmissionResult): RuntimeStop | undefined {
  switch (result.kind) {
    case "cancelled": return cancelledStop(result.posture.kind === "not_started" ? "before_effect" : "after_effect", result.posture)
    case "timed_out": return deadlineStop(result.posture)
    default: return undefined
  }
}

function initialExecutionMetrics(startedAt: string): ExecutionStart["metrics"] {
  return {
    startedAt,
    modelCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    browserObservations: 0,
    browserActions: 0,
    estimatedModelCostUsd: 0,
  }
}

function validExecutionWindow(startedAt: string, endedAt: string): boolean {
  const startedMs = Date.parse(startedAt)
  const endedMs = Date.parse(endedAt)
  return Number.isFinite(startedMs) && Number.isFinite(endedMs) && endedMs >= startedMs
}

function completionFor(intent: ExperimentTerminal, replayCapable: boolean): ExecutionCompletion {
  switch (intent.kind) {
    case "success":
      return { kind: "success", ...(intent.output === undefined ? {} : { output: intent.output }) }
    case "safety_stop":
      return { kind: "safety_stop", stop: intent.stop }
    case "failure":
      return replayCapable && intent.replayFailure !== undefined
        ? { kind: "failure", reason: "replay_failed", message: intent.message, replayFailure: intent.replayFailure }
        : {
            kind: "failure",
            reason: "execution_failed",
            message: intent.message,
            ...(intent.replayFailure === undefined ? {} : { replayFailure: intent.replayFailure }),
          }
    case "control_stop":
      return { kind: "failure", reason: "execution_failed", message: describeRuntimeStop(intent.stop) }
  }
}

function cleanupFailureIntent(intent: ExperimentTerminal): ExperimentTerminal {
  const message = intent.kind === "failure"
    ? `${intent.message}; Solari cleanup requires owner reconciliation`
    : "Solari cleanup requires owner reconciliation after the delegated execution"
  return {
    kind: "failure",
    message,
    posture: { kind: "unknown", recovery: "owner_reconciliation_required" },
    ...(intent.kind === "failure" && intent.replayFailure === undefined ? {} : intent.kind === "failure" ? { replayFailure: intent.replayFailure } : {}),
  }
}

function outcomeStatus(intent: ExperimentTerminal): Exclude<Execution["status"], "running"> {
  switch (intent.kind) {
    case "success": return "success"
    case "safety_stop": return "stopped"
    case "failure":
    case "control_stop": return "failure"
  }
}

function solariSessionCreationIntent(result: Exclude<SolariSessionResult, { readonly kind: "created" }>, controller: OperationController): ExperimentTerminal {
  switch (result.kind) {
    case "cancelled": return { kind: "control_stop", stop: cancelledStop(effectSafePoint(result.effect), result.effect) }
    case "timed_out": return { kind: "control_stop", stop: deadlineStop(result.effect) }
    case "denied":
      return result.reason === "budget_exhausted"
        ? { kind: "control_stop", stop: budgetStop("browser_actions", controller) }
        : { kind: "failure", message: "Solari could not create the application session" }
    case "failed": return { kind: "failure", message: result.message, posture: result.effect }
  }
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
function describeRuntimeStop(stop: RuntimeStop): string {
  switch (stop.kind) {
    case "cancelled": return "execution cancelled before completion"
    case "deadline_exceeded": return "execution deadline exceeded"
    case "budget_exhausted": return `execution ${stop.resource} budget exhausted`
    case "invalid_budget_request": return `execution received an invalid ${stop.resource} budget request`
  }
}
