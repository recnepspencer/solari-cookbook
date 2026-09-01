import { createHash } from "node:crypto"
import { createApplication, type ApplicationId, type CapabilityId, type Condition, type ExperimentId } from "@interface-compiler/domain"
import type { BenchmarkTaskIdentity } from "@interface-compiler/benchmark"
import type { ExperimentRequest } from "../planning.js"

export const DEMOBLAZE_APPLICATION_ID = "application.demoblaze" as ApplicationId
export const DEMOBLAZE_CAPABILITY_ID = "capability.demoblaze.samsung-galaxy-s6-to-order-boundary" as CapabilityId
export const DEMOBLAZE_BENCHMARK_TASK_ID = "demoblaze-samsung-galaxy-s6-to-order-boundary"

export const DEMOBLAZE_BENCHMARK_OBJECTIVE = [
  "On Demoblaze, select Samsung galaxy s6 and add exactly one to the cart.",
  "Open the cart only far enough to observe the first order, account, authentication, personal-information, shipping, payment, order-confirmation, credential, or access-control boundary, then stop immediately.",
  "Never enter personal or account data, never authenticate, never begin checkout, never confirm an order, and never purchase anything.",
].join(" ")

const applicationResult = createApplication({ id: DEMOBLAZE_APPLICATION_ID, name: "Demoblaze", baseUrl: "https://www.demoblaze.com" })
if (!applicationResult.ok) throw new Error("the built-in Demoblaze application is invalid")
export const DEMOBLAZE_APPLICATION = Object.freeze(applicationResult.value)

export function createDemoblazeExperimentRequest(): ExperimentRequest {
  const expectedOutcome: readonly Condition[] = Object.freeze([{ kind: "custom", name: "bounded_order_boundary_visible", value: { product: "Samsung galaxy s6", maximumQuantity: 1 } }])
  return Object.freeze({
    application: DEMOBLAZE_APPLICATION,
    capabilityId: DEMOBLAZE_CAPABILITY_ID,
    experimentId: "experiment.demoblaze.samsung-galaxy-s6-boundary" as ExperimentId,
    objective: DEMOBLAZE_BENCHMARK_OBJECTIVE,
    input: Object.freeze({ product: "Samsung galaxy s6", maximumQuantity: 1, personalDataEntryAllowed: false, purchaseAllowed: false }),
    expectedOutcome,
  })
}

export function createDemoblazeBenchmarkTask(modelId: string): BenchmarkTaskIdentity {
  return Object.freeze({
    taskId: DEMOBLAZE_BENCHMARK_TASK_ID,
    applicationId: DEMOBLAZE_APPLICATION_ID,
    objectiveFingerprint: `sha256:${createHash("sha256").update(DEMOBLAZE_BENCHMARK_OBJECTIVE, "utf8").digest("hex")}`,
    modelId,
  })
}
