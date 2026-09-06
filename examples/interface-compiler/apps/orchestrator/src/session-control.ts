import type { PartialEffectPosture } from "@interface-compiler/domain"
import type { OperationController, RuntimeStop } from "./operation.js"
import type { ExperimentTerminal, RuntimeEventPublication } from "./session-types.js"

export function eventPublicationIntent(publication: RuntimeEventPublication, posture: PartialEffectPosture): ExperimentTerminal | undefined {
  switch (publication.kind) {
    case "published": return undefined
    case "stopped": return { kind: "control_stop", stop: applyEventPosture(publication.stop, posture) }
    case "failed": return { kind: "failure", message: publication.message, posture: preserveEventEffect(publication.posture, posture) }
  }
}

export function budgetStop(resource: "model_calls" | "browser_actions", controller: OperationController): RuntimeStop {
  const limit = resource === "model_calls" ? controller.context.budget.maxModelCalls : controller.context.budget.maxBrowserActions
  return { kind: "budget_exhausted", terminal: true, resource, limit: limit ?? controller.snapshot()[resource === "model_calls" ? "modelCalls" : "browserActions"], posture: { kind: "not_started" } }
}

export function cancelledStop(safePoint: "before_effect" | "after_effect", posture: PartialEffectPosture = safePoint === "after_effect" ? { kind: "unknown", recovery: "owner_reconciliation_required" } : { kind: "not_started" }): RuntimeStop {
  return { kind: "cancelled", terminal: true, safePoint, posture }
}

export function deadlineStop(posture: PartialEffectPosture = { kind: "not_started" }): RuntimeStop {
  return { kind: "deadline_exceeded", terminal: true, posture }
}

export function effectSafePoint(effect: PartialEffectPosture): "before_effect" | "after_effect" {
  return effect.kind === "not_started" ? "before_effect" : "after_effect"
}

export function promoteCompletedEffect(stop: RuntimeStop): RuntimeStop {
  switch (stop.kind) {
    case "cancelled": return { ...stop, safePoint: "after_effect", posture: { kind: "completed" } }
    case "deadline_exceeded": return { ...stop, posture: { kind: "completed" } }
    case "budget_exhausted": return stop
    case "invalid_budget_request": return stop
  }
}

export function postActionControlStop(controller: OperationController, posture: PartialEffectPosture): RuntimeStop | undefined {
  const gate = controller.check()
  return gate.kind === "stop" ? applyEventPosture(gate.stop, posture) : undefined
}

function applyEventPosture(stop: RuntimeStop, posture: PartialEffectPosture): RuntimeStop {
  const preserved = preserveEventEffect(stop.posture, posture)
  switch (stop.kind) {
    case "cancelled": return { ...stop, safePoint: effectSafePoint(preserved), posture: preserved }
    case "deadline_exceeded": return { ...stop, posture: preserved }
    case "budget_exhausted": return stop
    case "invalid_budget_request": return stop
  }
}

function preserveEventEffect(eventPosture: PartialEffectPosture, priorPosture: PartialEffectPosture): PartialEffectPosture {
  if (eventPosture.kind === "not_started" && priorPosture.kind !== "not_started") return priorPosture
  return eventPosture
}
