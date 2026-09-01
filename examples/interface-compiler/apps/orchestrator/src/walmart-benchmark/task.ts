import { createHash } from "node:crypto"
import { createApplication, type ApplicationId, type CapabilityId, type Condition, type ExperimentId } from "@interface-compiler/domain"
import type { BenchmarkTaskIdentity } from "@interface-compiler/benchmark"
import type { ExperimentRequest } from "../planning.js"

export const WALMART_APPLICATION_ID = "application.walmart" as ApplicationId
export const WALMART_CAPABILITY_ID = "capability.walmart.tide-pods-to-checkout-boundary" as CapabilityId
export const WALMART_BENCHMARK_TASK_ID = "walmart-tide-pods-to-checkout-boundary"

export const WALMART_BENCHMARK_OBJECTIVE = [
  "On Walmart, find Tide Pods and add exactly one suitable search result to the cart.",
  "Open the cart only far enough to observe the first checkout, account, authentication, personal-information, shipping, payment, order-confirmation, credential, or access-control boundary, then stop immediately.",
  "Never enter personal or account data, never authenticate, never begin checkout, never confirm an order, and never purchase anything.",
].join(" ")

const applicationResult = createApplication({ id: WALMART_APPLICATION_ID, name: "Walmart", baseUrl: "https://www.walmart.com" })
if (!applicationResult.ok) throw new Error("the built-in Walmart application is invalid")
export const WALMART_APPLICATION = Object.freeze(applicationResult.value)

export function createWalmartExperimentRequest(): ExperimentRequest {
  const expectedOutcome: readonly Condition[] = Object.freeze([{ kind: "custom", name: "bounded_cart_boundary_visible", value: { product: "Tide Pods", maximumQuantity: 1 } }])
  return Object.freeze({
    application: WALMART_APPLICATION,
    capabilityId: WALMART_CAPABILITY_ID,
    experimentId: "experiment.walmart.tide-pods-boundary" as ExperimentId,
    objective: WALMART_BENCHMARK_OBJECTIVE,
    input: Object.freeze({ product: "Tide Pods", maximumQuantity: 1, personalDataEntryAllowed: false, purchaseAllowed: false }),
    expectedOutcome,
  })
}

export function createWalmartBenchmarkTask(modelId: string): BenchmarkTaskIdentity {
  return Object.freeze({
    taskId: WALMART_BENCHMARK_TASK_ID,
    applicationId: WALMART_APPLICATION_ID,
    objectiveFingerprint: `sha256:${createHash("sha256").update(WALMART_BENCHMARK_OBJECTIVE, "utf8").digest("hex")}`,
    modelId,
  })
}
