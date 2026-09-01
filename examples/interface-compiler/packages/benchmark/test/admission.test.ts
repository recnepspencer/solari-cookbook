import assert from "node:assert/strict"
import test from "node:test"
import type { ActiveReplayProjection } from "@interface-compiler/domain"
import { createBenchmarkReport, type BenchmarkComparisonInput } from "../src/index.js"
import { activeReplay, evidenceId, task, validInput } from "./fixtures.js"

function reasonCodes(input: BenchmarkComparisonInput): readonly string[] {
  const report = createBenchmarkReport(input)
  if (report.kind === "measured") throw new Error("expected an unavailable report")
  return report.reasons.map((reason) => reason.code)
}

test("rejects mixed task identities before aggregating either side", () => {
  const input = validInput()
  const first = input.direct[0]
  assert.ok(first)
  const changed = { ...first, task: { ...task, taskId: "different-task" } }
  const report = createBenchmarkReport({ ...input, direct: [changed, ...input.direct.slice(1)] })

  assert.equal(report.kind, "not_comparable")
  assert.ok(report.reasons.some((reason) => reason.code === "mixed_task"))
})

test("returns not_measured for an explicitly unmeasured record", () => {
  const input = validInput()
  const first = input.direct[0]
  assert.ok(first)
  const unmeasured = { ...first, measurement: { status: "not_measured" as const, reason: "fixture only" } }
  const report = createBenchmarkReport({ ...input, direct: [unmeasured, ...input.direct.slice(1)] })

  assert.equal(report.kind, "not_measured")
  assert.ok(report.reasons.some((reason) => reason.code === "record_not_measured"))
})

test("returns not_measured for a running projection even when its terminal cost is absent", () => {
  const input = validInput()
  const first = input.direct[0]
  assert.ok(first)
  const running = {
    ...first,
    execution: {
      ...first.execution,
      status: "running" as const,
      metrics: { ...first.execution.metrics, endedAt: undefined, wallClockMs: undefined, estimatedModelCostUsd: undefined },
    },
  }
  const report = createBenchmarkReport({ ...input, direct: [running as never, ...input.direct.slice(1)] })

  assert.equal(report.kind, "not_measured")
  assert.ok(report.reasons.some((reason) => reason.code === "execution_incomplete"))
})

test("rejects an active-looking replay whose fresh verification is incomplete", () => {
  const invalidReplay = {
    ...activeReplay(),
    verification: {
      requiredSuccessfulRuns: 3,
      runs: [
        {
          id: "verification-1" as never,
          sessionId: "session-verification-1" as never,
          capabilityId: activeReplay().capabilityId,
          replayVersionId: activeReplay().id,
          freshSession: true as const,
          outcome: "failure" as const,
          failureMessage: "inspection failed",
          evidenceIds: ["e-verify-1" as never],
        },
      ],
    },
  } as unknown as ActiveReplayProjection
  const report = createBenchmarkReport({ ...validInput(), compiledReplay: invalidReplay })

  assert.equal(report.kind, "not_comparable")
  assert.ok(report.reasons.some((reason) => reason.code === "compiled_replay_unverified"))
})

test("rejects inspection, evidence, recovery, and unsafe outcomes instead of claiming a comparison", () => {
  const input = validInput()
  const first = input.compiled[0]
  assert.ok(first)
  const cases: readonly [string, BenchmarkComparisonInput][] = [
    ["inspection", { ...input, compiledReplayInspection: { status: "failed", source: "worth", reason: "missing inspection" } }],
    ["evidence", { ...input, compiledReplayEvidence: { status: "missing", source: "worth", evidenceIds: [], missingEvidenceIds: [evidenceId("e-verify-1")] } }],
    ["recovery", { ...input, compiled: [{ ...first, measurement: { ...first.measurement, recovery: { status: "unknown" as const, reason: "provider did not return recovery state" } } }] }],
    ["unsafe", { ...input, compiled: [{ ...first, measurement: { ...first.measurement, safety: { kind: "unsafe" as const, reason: "credentials were entered" } } }] }],
  ]

  cases.forEach(([label, candidate]) => {
    const report = createBenchmarkReport(candidate)
    assert.equal(report.kind, "not_comparable", label)
    assert.ok(report.reasons.length > 0, label)
  })
})

test("requires the same safe terminal stop on both sides", () => {
  const input = validInput()
  const first = input.compiled[0]
  assert.ok(first)
  const success = {
    ...first,
    execution: { ...first.execution, status: "success" as const, outcome: { kind: "success" as const } },
    measurement: { ...first.measurement, safety: { kind: "safe_completion" as const } },
  }
  const report = createBenchmarkReport({ ...input, compiled: [success, ...input.compiled.slice(1)] })

  assert.equal(report.kind, "not_comparable")
  assert.ok(report.reasons.some((reason) => reason.code === "stop_outcome_mismatch"))
})

test("reports not_measured when a side has no projections", () => {
  const input = validInput()
  const report = createBenchmarkReport({ ...input, direct: [] })

  assert.equal(report.kind, "not_measured")
  assert.ok(report.reasons.some((reason) => reason.code === "missing_direct_records"))
  assert.deepEqual(reasonCodes({ ...input, compiled: [] }).includes("missing_compiled_records"), true)
})
