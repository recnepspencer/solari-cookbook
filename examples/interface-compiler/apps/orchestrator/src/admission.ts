import type { ApplicationProjection } from "@interface-compiler/domain"
import type { OrchestratorWorthPort } from "./worth-ports.js"
import type { OperationController, RuntimeStop } from "./operation.js"
import { planCompiledExperiment, type ExperimentPlan } from "./planning.js"

export type PlanAdmission =
  | {
      readonly kind: "admitted"
      readonly plan: ExperimentPlan
    }
  | { readonly kind: "stopped"; readonly stop: RuntimeStop }
  | { readonly kind: "unavailable"; readonly reason: "authority_unavailable" | "authority_changed"; readonly message: string }

type ApplicationAdmission =
  | { readonly kind: "ready"; readonly projection: ApplicationProjection }
  | Exclude<PlanAdmission, { readonly kind: "admitted" }>

/** Rechecks Worth authority immediately before a worker can create effects. */
export async function admitPlan(plan: ExperimentPlan, worth: OrchestratorWorthPort, controller: OperationController): Promise<PlanAdmission> {
  const gate = controller.check()
  if (gate.kind === "stop") return { kind: "stopped", stop: gate.stop }

  try {
    const application = await readAuthoritativeApplication(plan.request.application.id, worth, controller)
    if (application.kind !== "ready") return application
    if (!matchesRequestedApplication(plan.request.application, application.projection)) {
      return { kind: "unavailable", reason: "authority_changed", message: "Worth returned an application projection that does not match the delegated work" }
    }

    if (plan.kind === "direct") {
      const afterRead = controller.check()
      if (afterRead.kind === "stop") return { kind: "stopped", stop: afterRead.stop }
      return {
        kind: "admitted",
        plan,
      }
    }

    const fresh = await planCompiledExperiment(plan.request, worth, controller.context)
    if (fresh.kind === "planned") {
      const afterRead = controller.check()
      if (afterRead.kind === "stop") return { kind: "stopped", stop: afterRead.stop }
      return sameCompiledAuthority(plan, fresh.plan)
        ? {
            kind: "admitted",
            plan: fresh.plan,
          }
        : { kind: "unavailable", reason: "authority_changed", message: "Worth changed the active replay after planning" }
    }
    if (fresh.kind === "invalid_request") return { kind: "unavailable", reason: "authority_changed", message: "the planned work no longer validates" }
    if (fresh.reason === "worth_cancelled") return { kind: "stopped", stop: cancelledStop() }
    if (fresh.reason === "worth_timed_out") return { kind: "stopped", stop: deadlineStop() }
    return { kind: "unavailable", reason: "authority_unavailable", message: fresh.message ?? "Worth could not authorize the compiled work" }
  } catch {
    return { kind: "unavailable", reason: "authority_unavailable", message: "Worth did not return an authority result" }
  }
}

async function readAuthoritativeApplication(applicationId: ExperimentPlan["request"]["application"]["id"], worth: OrchestratorWorthPort, controller: OperationController): Promise<ApplicationAdmission> {
  const application = await worth.readApplication(applicationId, controller.context)
  if (application.kind === "cancelled") return { kind: "stopped", stop: cancelledStop() }
  if (application.kind === "timed_out") return { kind: "stopped", stop: deadlineStop() }
  if (application.kind === "not_found") return { kind: "unavailable", reason: "authority_unavailable", message: "Worth could not authorize the application" }
  if (application.kind === "failed") return { kind: "unavailable", reason: "authority_unavailable", message: application.message }
  if (application.kind === "denied" || application.kind === "unavailable") return { kind: "unavailable", reason: "authority_unavailable", message: application.message }
  if (application.value.id !== applicationId) return { kind: "unavailable", reason: "authority_changed", message: "Worth returned a different application projection" }
  return { kind: "ready", projection: application.value }
}

function matchesRequestedApplication(requested: ExperimentPlan["request"]["application"], projection: ApplicationProjection): boolean {
  return requested.id === projection.id && requested.name === projection.name && requested.baseUrl === projection.baseUrl
}

function sameCompiledAuthority(original: Extract<ExperimentPlan, { readonly kind: "compiled" }>, fresh: Extract<ExperimentPlan, { readonly kind: "compiled" }>): boolean {
  return original.capability.id === fresh.capability.id &&
    original.capability.revision === fresh.capability.revision &&
    original.capability.activeReplayVersionId === fresh.capability.activeReplayVersionId &&
    original.replay.id === fresh.replay.id &&
    original.replay.revision === fresh.replay.revision &&
    original.replay.version === fresh.replay.version &&
    JSON.stringify(original.replay.steps) === JSON.stringify(fresh.replay.steps) &&
    sameCompilationAuthority(original, fresh)
}

function sameCompilationAuthority(
  original: Extract<ExperimentPlan, { readonly kind: "compiled" }>,
  fresh: Extract<ExperimentPlan, { readonly kind: "compiled" }>,
): boolean {
  if (original.authority.kind !== fresh.authority.kind) return false
  return JSON.stringify(original.authority.compilationProvenance) === JSON.stringify(fresh.authority.compilationProvenance)
}

function cancelledStop(): RuntimeStop {
  return { kind: "cancelled", terminal: true, safePoint: "before_effect", posture: { kind: "not_started" } }
}

function deadlineStop(): RuntimeStop {
  return { kind: "deadline_exceeded", terminal: true, posture: { kind: "not_started" } }
}
