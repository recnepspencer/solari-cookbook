import assert from "node:assert/strict"
import test from "node:test"
import type { EvidenceId } from "@interface-compiler/domain"
import { createBenchmarkReport, validateBenchmarkComparison } from "../src/index.js"
import { validInput } from "./fixtures.js"

test("builds a measured side-by-side report from Worth projections", () => {
  const report = createBenchmarkReport(validInput())

  assert.equal(report.kind, "measured")
  if (report.kind !== "measured") return
  assert.equal(report.schemaVersion, "interface-compiler.benchmark.v1")
  assert.deepEqual(report.direct.totals, {
    modelCalls: 10,
    inputTokens: 1000,
    outputTokens: 200,
    totalTokens: 1200,
    browserObservations: 14,
    browserActions: 18,
    toolCalls: 0,
    wallClockMs: 2000,
  })
  assert.deepEqual(report.compiled.averages, {
    modelCalls: 2,
    inputTokens: 200,
    outputTokens: 40,
    totalTokens: 240,
    browserObservations: 3,
    browserActions: 3,
    toolCalls: 3,
    wallClockMs: 1000,
  })
  assert.equal(report.direct.modelCost.averageUsd, 5)
  assert.equal(report.compiled.modelCost.averageUsd, 2)
  assert.equal(report.economics.perExecutionSavings.modelCostUsd.absolute, 3)
  assert.deepEqual(report.economics.breakEven, { kind: "measured", value: { kind: "finite", calls: 2, exactCalls: 5 / 3, savingsPerCallUsd: 3 } })
  assert.deepEqual(report.economics.lifetime, {
    kind: "measured",
    value: {
      executions: 4,
      lifetimeDirectCostAvoidedUsd: 20,
      lifetimeCompiledCostUsd: 13,
      lifetimeNetSavingsUsd: 7,
    },
  })
  assert.deepEqual(report.compiledReplay, {
    replayVersionId: "replay.add-to-cart.v1",
    version: 1,
    revision: 8,
    status: "active_verified",
    requiredSuccessfulRuns: 3,
    successfulRuns: 3,
    runCount: 3,
    failedRuns: 0,
    evidenceIds: ["e-verify-1", "e-verify-2", "e-verify-3"],
  })
  assert.equal(report.provenance.authority, "worth_query_projections")
  assert.match(report.provenance.calculations.find((entry) => entry.name === "compilation_cost_attribution")?.formula ?? "", /discovery and verification only/)
  assert.deepEqual(validateBenchmarkComparison(validInput()), [])
})

test("uses explicit pricing over measured token usage and records its calculation source", () => {
  const input = validInput()
  const report = createBenchmarkReport({
    ...input,
    compilation: undefined,
    pricing: {
      direct: { inputUsdPerToken: 0.001, outputUsdPerToken: 0.002 },
      compiled: { inputUsdPerToken: 0.001, outputUsdPerToken: 0.002 },
    },
  })

  assert.equal(report.kind, "measured")
  if (report.kind !== "measured") return
  assert.equal(report.direct.modelCost.averageUsd, 0.7)
  assert.equal(report.compiled.modelCost.averageUsd, 0.28)
  assert.equal(report.direct.modelCost.source, "explicit_model_pricing")
  assert.deepEqual(report.direct.modelCost.pricing, { inputUsdPerToken: 0.001, outputUsdPerToken: 0.002 })
  assert.match(report.provenance.calculations.find((entry) => entry.name === "model_cost")?.formula ?? "", /inputTokens/)
})

test("reports retained failed verification attempts without weakening an active replay claim", () => {
  const input = validInput()
  const replay = {
    ...input.compiledReplay,
    verification: {
      ...input.compiledReplay.verification,
      runs: [
        ...input.compiledReplay.verification.runs,
        {
          id: "verification-4",
          sessionId: "session-verification-4",
          capabilityId: input.compiledReplay.capabilityId,
          replayVersionId: input.compiledReplay.id,
          freshSession: true as const,
          outcome: "failure" as const,
          failureMessage: "transient verification failure",
          evidenceIds: ["e-verify-4" as EvidenceId],
        },
      ],
    },
  }
  const report = createBenchmarkReport({
    ...input,
    compiledReplay: replay as never,
    compiledReplayEvidence: { ...input.compiledReplayEvidence, evidenceIds: [...input.compiledReplayEvidence.evidenceIds, "e-verify-4" as EvidenceId] },
  })

  assert.equal(report.kind, "measured")
  if (report.kind === "measured") {
    assert.equal(report.compiledReplay.successfulRuns, 3)
    assert.equal(report.compiledReplay.runCount, 4)
    assert.equal(report.compiledReplay.failedRuns, 1)
  }
})

test("keeps economics explicitly not_measured when Worth did not return compilation metrics", () => {
  const input = validInput()
  const report = createBenchmarkReport({ ...input, compilation: undefined })

  assert.equal(report.kind, "measured")
  if (report.kind !== "measured") return
  assert.deepEqual(report.economics.compilation, { kind: "not_measured", reason: "projection_not_returned" })
  assert.deepEqual(report.economics.breakEven, { kind: "not_measured", reason: "projection_not_returned" })
  assert.deepEqual(report.economics.lifetime, { kind: "not_measured", reason: "projection_not_returned" })
})
