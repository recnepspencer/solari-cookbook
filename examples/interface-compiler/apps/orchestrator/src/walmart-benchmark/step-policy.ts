import type { ReplayStep } from "@interface-compiler/domain"
import type { ExperimentPlan } from "../planning.js"
import type { ExperimentStepAdmission, ExperimentStepGuard, ExperimentStepPolicy, ExperimentStepPolicyAdmission } from "../step-policy.js"

const WALMART_PRODUCT_QUERY = "Tide Pods"

/** Admits only actions that remain inside the fixed public Walmart benchmark task. */
export function createWalmartBenchmarkStepPolicy(): ExperimentStepPolicy {
  return {
    admit: (plan) => admitWalmartPlan(plan),
  }
}

function admitWalmartPlan(plan: ExperimentPlan): ExperimentStepPolicyAdmission {
  if (plan.kind === "compiled") {
    const inspection = createWalmartStepGuard()
    for (const step of plan.replay.steps) {
      const admission = inspection.admit(step)
      if (admission.kind === "denied") return admission
    }
  }
  return { kind: "admitted", guard: createWalmartStepGuard() }
}

function createWalmartStepGuard(): ExperimentStepGuard {
  let addToCartActions = 0
  return {
    admit: (step) => {
      const fixedInput = fixedWalmartInputAdmission(step)
      if (fixedInput.kind === "denied") return fixedInput
      if (!isAddToCartStep(step)) return { kind: "admitted" }
      if (!stepText(step).includes("tide pods")) return denied("the Walmart benchmark may add only a target explicitly identified as Tide Pods")
      addToCartActions += 1
      return addToCartActions === 1
        ? { kind: "admitted" }
        : denied("the Walmart benchmark permits at most one add-to-cart action")
    },
  }
}

function fixedWalmartInputAdmission(step: ReplayStep): ExperimentStepAdmission {
  if (step.type === "fill" && normalize(step.value) !== normalize(WALMART_PRODUCT_QUERY)) {
    return denied("the Walmart benchmark may fill only the fixed public Tide Pods search query")
  }
  if (step.type === "navigate") {
    let target: URL
    try {
      target = new URL(step.url)
    } catch {
      return denied("the Walmart benchmark navigation must be an absolute URL")
    }
    if (
      target.protocol !== "https:" ||
      (target.hostname !== "www.walmart.com" && target.hostname !== "walmart.com") ||
      target.port !== "" ||
      target.username !== "" ||
      target.password !== ""
    ) {
      return denied("the Walmart benchmark may navigate only to public HTTPS Walmart pages")
    }
    if (target.pathname.replace(/\/+$/, "").toLowerCase() === "/search") {
      const query = target.searchParams.get("q")
      if (query === null || normalize(query) !== normalize(WALMART_PRODUCT_QUERY)) {
        return denied("the Walmart benchmark search URL may contain only the fixed public Tide Pods query")
      }
    }
  }
  if (step.type === "click" && /\b(add another|add one more|increment|increase quantity|quantity increase)\b|(?:^|\s)\+(?:\s|$)/.test(stepText(step))) {
    return denied("the Walmart benchmark may not increase cart quantity")
  }
  return { kind: "admitted" }
}

function isAddToCartStep(step: ReplayStep): step is Extract<ReplayStep, { readonly type: "click" }> {
  return step.type === "click" && /\badd(?:\s+(?:to\s+)?(?:cart|basket))?\b/.test(stepText(step))
}

function stepText(step: Extract<ReplayStep, { readonly type: "click" }>): string {
  return [step.target.semanticDescription, step.target.role, step.target.name, step.target.text, step.target.selector]
    .filter((value): value is string => value !== undefined)
    .join(" ")
    .toLowerCase()
    .replace(/[-_]+/g, " ")
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase()
}

function denied(message: string): Extract<ExperimentStepAdmission, { readonly kind: "denied" }> {
  return { kind: "denied", message }
}
