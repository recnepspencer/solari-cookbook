import assert from "node:assert/strict"
import test from "node:test"
import {
  classifySafetyBoundary,
  type ApplicationId,
  type CapabilityId,
  type ExecutionId,
  type ReplayVersionId,
  type SafetySignal,
  type SafetyStopResult,
} from "@interface-compiler/domain"
import {
  createTerminalBenchmarkReport,
  type TerminalBenchmarkReportInput,
  type WorthSettledBenchmarkExecution,
} from "../src/index.js"

const capabilityId = "capability.walmart.tide-pods-to-checkout-boundary" as CapabilityId
const replayVersionId = "replay.walmart.tide-pods-to-checkout-boundary.v1" as ReplayVersionId

function classifiedStop(signal: Exclude<SafetySignal, { readonly kind: "safe_to_continue" }>): SafetyStopResult {
  const assessment = classifySafetyBoundary({ observedAt: "2026-09-01T12:00:01.000Z", signal })
  if (!assessment.ok || assessment.value.kind !== "stop") throw new Error("expected a classified safety stop")
  return assessment.value.result
}

function evidence(identity: string, kind: "execution" | "capability" | "replay" = "execution") {
  const shape = kind === "execution"
    ? { queryName: "interface_compiler_execution_read", projectedFieldCount: 8 }
    : kind === "capability"
      ? { queryName: "interface_compiler_capability_read", projectedFieldCount: 10 }
      : { queryName: "interface_compiler_active_replay_read", projectedFieldCount: 14 }
  return { ...shape, queryIdentity: identity, basisVersion: 17, projectedRecordCount: 1, basisReleased: true } as const
}

function stopped(
  id: string,
  mode: "direct" | "compiled",
  metrics: { readonly modelCalls: number; readonly inputTokens: number; readonly outputTokens: number; readonly browserObservations: number; readonly browserActions: number; readonly wallClockMs: number; readonly estimatedModelCostMicrocents: number },
  stop: SafetyStopResult = classifiedStop({ kind: "order_placement" }),
): WorthSettledBenchmarkExecution {
  return {
    kind: "settled",
    commit: "committed",
    projection: {
      projectionKind: "worth_terminal_execution",
      executionId: id as ExecutionId,
      capabilityId,
      ...(mode === "compiled" ? { replayVersionId } : {}),
      mode,
      lifecycle: "stopped",
      revision: 2,
      metrics: {
        startedAt: "2026-09-01T12:00:00.000Z",
        endedAt: `2026-09-01T12:00:${String(metrics.wallClockMs / 1_000).padStart(2, "0")}.000Z`,
        ...metrics,
      },
      outcome: {
        kind: "safety_stop",
        stop,
      },
    },
    evidence: evidence(`query.${id}`),
  } as WorthSettledBenchmarkExecution
}

function successful(id: string, mode: "exploratory" | "compiled", cost: number): WorthSettledBenchmarkExecution {
  return {
    kind: "settled",
    commit: "committed",
    projection: {
      projectionKind: "worth_terminal_execution",
      executionId: id as ExecutionId,
      capabilityId,
      ...(mode === "compiled" ? { replayVersionId } : {}),
      mode,
      lifecycle: "success",
      revision: 2,
      metrics: { startedAt: "2026-09-01T11:00:00.000Z", endedAt: "2026-09-01T11:00:01.000Z", wallClockMs: 1_000, modelCalls: 1, inputTokens: 11, outputTokens: 7, browserObservations: 1, browserActions: 1, estimatedModelCostMicrocents: cost },
      outcome: { kind: "success" },
    },
    evidence: evidence(`query.${id}`),
  } as WorthSettledBenchmarkExecution
}

function baseInput(): TerminalBenchmarkReportInput {
  return {
    task: { taskId: "walmart-tide-pods-boundary", applicationId: "application.walmart" as ApplicationId, objectiveFingerprint: "sha256:test-objective", modelId: "gemini-test" },
    direct: stopped("execution.direct", "direct", { modelCalls: 3, inputTokens: 300, outputTokens: 90, browserObservations: 5, browserActions: 3, wallClockMs: 3_000, estimatedModelCostMicrocents: 30000000 }),
    compiled: stopped("execution.compiled", "compiled", { modelCalls: 1, inputTokens: 80, outputTokens: 20, browserObservations: 4, browserActions: 3, wallClockMs: 2_000, estimatedModelCostMicrocents: 10000000 }),
    compiledPlan: {
      capabilityId,
      replayVersionId,
      compilationProvenance: { kind: "synthetic_seed" },
      capabilityEvidence: evidence("query.capability", "capability"),
      replayEvidence: evidence("query.replay", "replay"),
    },
  }
}

test("copies every report metric from WORTH terminal projections and derives only the savings", () => {
  const report = createTerminalBenchmarkReport(baseInput())
  assert.equal(report.kind, "measured")
  if (report.kind !== "measured") throw new Error("expected measured terminal comparison")
  assert.deepEqual(report.direct.metrics, { modelCalls: 3, inputTokens: 300, outputTokens: 90, browserObservations: 5, browserActions: 3, wallClockMs: 3_000, estimatedModelCostMicrocents: 30000000 })
  assert.deepEqual(report.compiled.metrics, { modelCalls: 1, inputTokens: 80, outputTokens: 20, browserObservations: 4, browserActions: 3, wallClockMs: 2_000, estimatedModelCostMicrocents: 10000000 })
  assert.equal(report.perRunSavings.inputTokens.absolute, 220)
  assert.equal(report.perRunSavings.estimatedModelCostMicrocents.absolute, 20_000_000)
  assert.deepEqual(report.provenance.executionIds, ["execution.direct", "execution.compiled"])
})

test("rejects synthetic seeded plan projections for compilation economics even when figures are supplied", () => {
  const input = baseInput()
  const report = createTerminalBenchmarkReport({
    ...input,
    compilation: { discovery: [successful("execution.fabricated-discovery", "exploratory", 999)], verification: [successful("execution.fabricated-verification", "compiled", 999)] },
  })
  assert.equal(report.kind, "measured")
  if (report.kind !== "measured") throw new Error("comparison runs remain measurable")
  assert.deepEqual(report.economics.compilation, { kind: "not_measured", reason: "synthetic_seed_not_economic_evidence", rejectedSuppliedCompilation: true })
  assert.deepEqual(report.economics.breakEven, { kind: "not_measured", reason: "synthetic_seed_not_economic_evidence" })
  assert.deepEqual(report.provenance.executionIds, ["execution.direct", "execution.compiled"])
  assert.equal("totalCostMicrocents" in report.economics.compilation, false)
})

test("derives compilation cost and break-even only from exactly attributed WORTH terminal projections", () => {
  const input = baseInput()
  const discovery = successful("execution.discovery", "exploratory", 40_000_000)
  const verification = successful("execution.verification", "compiled", 20_000_000)
  const report = createTerminalBenchmarkReport({
    ...input,
    compiledPlan: {
      ...input.compiledPlan,
      compilationProvenance: { kind: "measured", discoveryExecutionIds: [discovery.projection.executionId], verificationExecutionIds: [verification.projection.executionId] },
    },
    compilation: { discovery: [discovery], verification: [verification] },
  })
  assert.equal(report.kind, "measured")
  if (report.kind !== "measured") throw new Error("expected measured report")
  assert.deepEqual(report.economics.compilation, { kind: "measured", discoveryCostMicrocents: 40000000, verificationCostMicrocents: 20000000, totalCostMicrocents: 60000000, discoveryExecutionIds: ["execution.discovery"], verificationExecutionIds: ["execution.verification"] })
  assert.equal(report.economics.breakEven.kind, "measured")
  if (report.economics.breakEven.kind === "measured") {
    assert.equal(report.economics.breakEven.value.kind, "finite")
    if (report.economics.breakEven.value.kind === "finite") assert.equal(report.economics.breakEven.value.calls, 3)
  }
})

test("fails closed on missing WORTH monetary data instead of substituting zero", () => {
  const input = baseInput()
  const invalid = {
    ...input.direct,
    projection: { ...input.direct.projection, metrics: { ...input.direct.projection.metrics, estimatedModelCostMicrocents: undefined } },
  } as unknown as WorthSettledBenchmarkExecution
  const report = createTerminalBenchmarkReport({ ...input, direct: invalid })
  assert.equal(report.kind, "not_comparable")
  if (report.kind === "not_comparable") assert.equal(report.issues.some((entry) => entry.path === "direct.projection.metrics"), true)
})

test("fails closed when supplied compilation identities do not match measured WORTH provenance", () => {
  const input = baseInput()
  const discovery = successful("execution.discovery", "exploratory", 40_000_000)
  const verification = successful("execution.verification", "compiled", 20_000_000)
  const report = createTerminalBenchmarkReport({
    ...input,
    compiledPlan: { ...input.compiledPlan, compilationProvenance: { kind: "measured", discoveryExecutionIds: ["execution.other" as ExecutionId], verificationExecutionIds: [verification.projection.executionId] } },
    compilation: { discovery: [discovery], verification: [verification] },
  })
  assert.equal(report.kind, "not_comparable")
  if (report.kind === "not_comparable") assert.equal(report.issues.some((entry) => entry.code === "compilation_attribution_mismatch"), true)
})

test("requires both comparison runs to stop at a classified human boundary", () => {
  const input = baseInput()
  const unsafe = { ...input.compiled, projection: { ...input.compiled.projection, lifecycle: "success", outcome: { kind: "success" } } } as WorthSettledBenchmarkExecution
  const report = createTerminalBenchmarkReport({ ...input, compiled: unsafe })
  assert.equal(report.kind, "not_comparable")
  if (report.kind === "not_comparable") assert.equal(report.issues.some((entry) => entry.code === "unsafe_terminal_outcome"), true)
})

test("rejects a structurally plausible safety stop that was not classified by the domain", () => {
  const input = baseInput()
  const forged = {
    ...input.direct,
    projection: {
      ...input.direct.projection,
      outcome: {
        kind: "safety_stop",
        stop: { kind: "safety_stop", terminal: true, nextAction: "human_required", observedAt: "2026-09-01T12:00:01.000Z", reason: "order_placement" },
      },
    },
  } as unknown as WorthSettledBenchmarkExecution
  const report = createTerminalBenchmarkReport({ ...input, direct: forged })
  assert.equal(report.kind, "not_comparable")
  if (report.kind === "not_comparable") assert.equal(report.issues.some((entry) => entry.code === "unsafe_terminal_outcome"), true)
})

test("fails closed instead of throwing on a malformed terminal safety payload", () => {
  const input = baseInput()
  const malformed = {
    ...input.direct,
    projection: { ...input.direct.projection, outcome: { kind: "safety_stop", stop: null } },
  } as unknown as WorthSettledBenchmarkExecution
  const report = createTerminalBenchmarkReport({ ...input, direct: malformed })
  assert.equal(report.kind, "not_comparable")
  if (report.kind === "not_comparable") assert.equal(report.issues.some((entry) => entry.code === "unsafe_terminal_outcome"), true)
})

test("rejects plan authority evidence from the wrong WORTH query family", () => {
  const input = baseInput()
  const report = createTerminalBenchmarkReport({
    ...input,
    compiledPlan: { ...input.compiledPlan, capabilityEvidence: evidence("query.capability", "execution") },
  })
  assert.equal(report.kind, "not_comparable")
  if (report.kind === "not_comparable") {
    assert.equal(report.issues.some((entry) => entry.path === "compiledPlan.capabilityEvidence" && entry.code === "invalid_worth_evidence"), true)
  }
})

test("rejects terminal metrics presented with non-execution WORTH evidence", () => {
  const input = baseInput()
  const direct = { ...input.direct, evidence: evidence("query.direct", "capability") }
  const report = createTerminalBenchmarkReport({ ...input, direct })
  assert.equal(report.kind, "not_comparable")
  if (report.kind === "not_comparable") {
    assert.equal(report.issues.some((entry) => entry.path === "direct.evidence" && entry.code === "invalid_worth_evidence"), true)
  }
})

test("requires direct and compiled runs to reach the same classified boundary", () => {
  const input = baseInput()
  const compiled = stopped(
    "execution.compiled",
    "compiled",
    { modelCalls: 1, inputTokens: 80, outputTokens: 20, browserObservations: 4, browserActions: 3, wallClockMs: 2_000, estimatedModelCostMicrocents: 10000000 },
    classifiedStop({ kind: "shipping_details_required" }),
  )
  const report = createTerminalBenchmarkReport({ ...input, compiled })
  assert.equal(report.kind, "not_comparable")
  if (report.kind === "not_comparable") assert.equal(report.issues.some((entry) => entry.code === "boundary_mismatch"), true)
})

test("fails closed when WORTH supplies a non-integer money metric", () => {
  const input = baseInput()
  const direct = stopped("execution.direct", "direct", {
    modelCalls: 3,
    inputTokens: 300,
    outputTokens: 90,
    browserObservations: 5,
    browserActions: 3,
    wallClockMs: 3_000,
    estimatedModelCostMicrocents: 0,
  })
  const compiled = stopped("execution.compiled", "compiled", {
    modelCalls: 1,
    inputTokens: 80,
    outputTokens: 20,
    browserObservations: 4,
    browserActions: 3,
    wallClockMs: 2_000,
    estimatedModelCostMicrocents: 0.5,
  })
  const report = createTerminalBenchmarkReport({ ...input, direct, compiled })
  assert.equal(report.kind, "not_comparable")
  if (report.kind === "not_comparable") {
    assert.equal(report.issues.some((entry) => entry.path === "compiled.projection.metrics" && entry.code === "invalid_terminal_projection"), true)
  }
})
