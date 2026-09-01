import type { ReplayStep } from "@interface-compiler/domain"
import type { ExperimentPlan } from "./planning.js"

export type ExperimentStepAdmission =
  | { readonly kind: "admitted" }
  | { readonly kind: "denied"; readonly message: string }

export interface ExperimentStepGuard {
  admit(step: ReplayStep): ExperimentStepAdmission
}

export type ExperimentStepPolicyAdmission =
  | { readonly kind: "admitted"; readonly guard: ExperimentStepGuard }
  | { readonly kind: "denied"; readonly message: string }

/** Pure, per-run admission for task-specific browser-step constraints. */
export interface ExperimentStepPolicy {
  admit(plan: ExperimentPlan): ExperimentStepPolicyAdmission
}
