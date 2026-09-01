import { createHash } from "node:crypto"
import { createWorkflowBenchmarkReport, type WorkflowBenchmarkReport, type WorthSettledBenchmarkExecution } from "@interface-compiler/benchmark"
import type { BenchmarkTaskIdentity } from "@interface-compiler/benchmark"
import { ENRON_ONLINE_APPLICATION_ID, ENRON_ONLINE_DEMO_REQUEST, ENRON_ONLINE_CAPABILITY_PROJECTIONS } from "./contracts.js"

export const ENRON_ONLINE_WORKFLOW_BENCHMARK_OBJECTIVE = "Resolve the next-month Henry Hub purchase contract for Midwest Utility 17, stage 50,000 MMBtu, then request independent risk approval."

/** Builds the only admissible Enron benchmark input: three semantic calls per mode. */
export function createEnronOnlineWorkflowBenchmark(
  modelId: string,
  direct: readonly WorthSettledBenchmarkExecution[],
  compiled: readonly WorthSettledBenchmarkExecution[],
): WorkflowBenchmarkReport {
  return createWorkflowBenchmarkReport({
    task: benchmarkTask(modelId),
    workflow: ENRON_ONLINE_CAPABILITY_PROJECTIONS.map((projection) => ({ capabilityId: projection.capabilityId, replayVersionId: projection.status === "healthy" ? projection.activeReplay.replayVersionId : "" })),
    direct,
    compiled,
  })
}

export function benchmarkTask(modelId: string): BenchmarkTaskIdentity {
  return Object.freeze({
    taskId: "enron-online-stage-and-risk-approval",
    applicationId: ENRON_ONLINE_APPLICATION_ID,
    objectiveFingerprint: `sha256:${createHash("sha256").update(JSON.stringify(ENRON_ONLINE_DEMO_REQUEST) + ENRON_ONLINE_WORKFLOW_BENCHMARK_OBJECTIVE, "utf8").digest("hex")}`,
    modelId,
  })
}
