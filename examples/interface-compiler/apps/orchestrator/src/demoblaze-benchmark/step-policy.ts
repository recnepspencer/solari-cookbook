import type { ReplayStep } from "@interface-compiler/domain"
import type { ExperimentPlan } from "../planning.js"
import type { ExperimentStepAdmission, ExperimentStepGuard, ExperimentStepPolicy, ExperimentStepPolicyAdmission } from "../step-policy.js"

const DEMOBLAZE_PRODUCT = "samsung galaxy s6"

/** Admits only the fixed public Demoblaze product-to-order-boundary path. */
export function createDemoblazeBenchmarkStepPolicy(): ExperimentStepPolicy {
  return {
    admit: (plan) => admitDemoblazePlan(plan),
  }
}

function admitDemoblazePlan(plan: ExperimentPlan): ExperimentStepPolicyAdmission {
  if (plan.kind === "compiled") {
    const inspection = createDemoblazeStepGuard()
    for (const step of plan.replay.steps) {
      const admission = inspection.admit(step)
      if (admission.kind === "denied") return admission
    }
  }
  return { kind: "admitted", guard: createDemoblazeStepGuard() }
}

function createDemoblazeStepGuard(): ExperimentStepGuard {
  let phase: "select_product" | "add_to_cart" | "open_cart" | "boundary" = "select_product"
  let dismissedInformationalModal = false
  return {
    admit: (step) => {
      const fixedInput = fixedDemoblazeInputAdmission(step)
      if (fixedInput.kind === "denied") return fixedInput
      if (step.type !== "click") return { kind: "admitted" }
      const text = stepText(step)
      if (phase === "select_product" && !dismissedInformationalModal && isCloseStep(step)) {
        dismissedInformationalModal = true
        return { kind: "admitted" }
      }
      if (phase === "select_product" && (text.includes(DEMOBLAZE_PRODUCT) || isPhonesCategoryStep(step))) {
        if (text.includes(DEMOBLAZE_PRODUCT)) phase = "add_to_cart"
        return { kind: "admitted" }
      }
      if (phase === "add_to_cart" && isAddToCartStep(step)) {
        phase = "open_cart"
        return { kind: "admitted" }
      }
      if (phase === "open_cart" && isCartNavigationStep(step)) {
        phase = "boundary"
        return { kind: "admitted" }
      }
      return denied("the Demoblaze benchmark permits one informational-modal Close, Phones, Samsung galaxy s6, one Add to cart action, and Cart; it stops at the order boundary")
    },
  }
}

function fixedDemoblazeInputAdmission(step: ReplayStep): ExperimentStepAdmission {
  if (step.type === "fill" || step.type === "select") {
    return denied("the Demoblaze benchmark never enters or selects form data")
  }
  if (step.type === "navigate") {
    let target: URL
    try {
      target = new URL(step.url)
    } catch {
      return denied("the Demoblaze benchmark navigation must be an absolute URL")
    }
    if (
      target.protocol !== "https:" ||
      (target.hostname !== "www.demoblaze.com" && target.hostname !== "demoblaze.com") ||
      target.port !== "" ||
      target.username !== "" ||
      target.password !== ""
    ) {
      return denied("the Demoblaze benchmark may navigate only to public HTTPS Demoblaze pages")
    }
  }
  if (step.type === "click" && /\b(add another|add one more|increment|increase quantity|quantity increase)\b|(?:^|\s)\+(?:\s|$)/.test(stepText(step))) {
    return denied("the Demoblaze benchmark may not increase cart quantity")
  }
  return { kind: "admitted" }
}

function isAddToCartStep(step: ReplayStep): step is Extract<ReplayStep, { readonly type: "click" }> {
  return step.type === "click" && /\badd(?:\s+(?:to\s+)?(?:cart|basket))?\b/.test(stepText(step))
}

function isCartNavigationStep(step: Extract<ReplayStep, { readonly type: "click" }>): boolean {
  return [step.target.semanticDescription, step.target.name, step.target.text]
    .filter((value): value is string => value !== undefined)
    .some((value) => value.trim().toLowerCase() === "cart")
}

function isPhonesCategoryStep(step: Extract<ReplayStep, { readonly type: "click" }>): boolean {
  return [step.target.semanticDescription, step.target.name, step.target.text]
    .filter((value): value is string => value !== undefined)
    .some((value) => value.trim().toLowerCase() === "phones")
}

function isCloseStep(step: Extract<ReplayStep, { readonly type: "click" }>): boolean {
  return [step.target.semanticDescription, step.target.name, step.target.text]
    .filter((value): value is string => value !== undefined)
    .some((value) => value.trim().toLowerCase() === "close")
}

function stepText(step: Extract<ReplayStep, { readonly type: "click" }>): string {
  return [step.target.semanticDescription, step.target.role, step.target.name, step.target.text, step.target.selector]
    .filter((value): value is string => value !== undefined)
    .join(" ")
    .toLowerCase()
    .replace(/[-_]+/g, " ")
}

function denied(message: string): Extract<ExperimentStepAdmission, { readonly kind: "denied" }> {
  return { kind: "denied", message }
}
