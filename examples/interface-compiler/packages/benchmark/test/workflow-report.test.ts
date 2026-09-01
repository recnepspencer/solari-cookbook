import assert from "node:assert/strict"
import test from "node:test"
import type { CapabilityId, ExecutionId } from "@interface-compiler/domain"
import { createWorkflowBenchmarkReport, type WorkflowBenchmarkInput } from "../src/index.js"

const workflow = [
  { capabilityId: "capability.enron.market.resolve-contract" as CapabilityId, replayVersionId: "replay.enron.market.resolve-contract.v1" },
  { capabilityId: "capability.enron.trades.stage-trade" as CapabilityId, replayVersionId: "replay.enron.trades.stage-trade.v1" },
  { capabilityId: "capability.enron.risk.request-approval" as CapabilityId, replayVersionId: "replay.enron.risk.request-approval.v1" },
] as const

function settled(id: string, mode: "direct" | "compiled", capabilityId: CapabilityId, replayVersionId?: string, modelCalls = 1) {
  return {
    kind: "settled", commit: "committed",
    projection: { projectionKind: "worth_terminal_execution", executionId: id as ExecutionId, capabilityId, ...(replayVersionId === undefined ? {} : { replayVersionId: replayVersionId as never }), mode, lifecycle: "success", revision: 2, metrics: { startedAt: "2026-09-01T00:00:00.000Z", endedAt: "2026-09-01T00:00:01.000Z", wallClockMs: 1000, modelCalls, inputTokens: 10, outputTokens: 2, browserObservations: 1, browserActions: 1, estimatedModelCostUsd: modelCalls === 0 ? 0 : 0.012 }, outcome: { kind: "success" } },
    evidence: { queryName: "interface_compiler_execution_read", queryIdentity: `query.${id}`, basisVersion: 1, projectedRecordCount: 1, projectedFieldCount: 8, basisReleased: true },
  } as never
}

function input(): WorkflowBenchmarkInput {
  return {
    task: { taskId: "enron-stage-and-approve", applicationId: "application.enron-online" as never, objectiveFingerprint: "sha256:test", modelId: "gemini-test" }, workflow,
    direct: workflow.map((step, index) => settled(`direct.${index}`, "direct", step.capabilityId, undefined, 2)),
    compiled: workflow.map((step, index) => settled(`compiled.${index}`, "compiled", step.capabilityId, step.replayVersionId, 0)),
  }
}

test("aggregates exactly three WORTH-settled semantic calls without inventing costs", () => {
  const report = createWorkflowBenchmarkReport(input())
  assert.equal(report.kind, "measured")
  if (report.kind !== "measured") throw new Error("expected WORTH workflow measurement")
  assert.equal(report.direct.modelCalls, 6)
  assert.equal(report.compiled.modelCalls, 0)
  assert.ok(Math.abs(report.savings.estimatedModelCostUsd - 0.036) < 1e-12)
})

test("rejects a missing semantic execution rather than treating it as zero", () => {
  const value = input()
  const report = createWorkflowBenchmarkReport({ ...value, compiled: value.compiled.slice(0, 2) })
  assert.equal(report.kind, "not_measured")
  if (report.kind === "not_measured") assert.match(report.reasons.join("\n"), /exactly one WORTH terminal execution/)
})
