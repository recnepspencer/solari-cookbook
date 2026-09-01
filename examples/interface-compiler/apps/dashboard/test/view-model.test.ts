import assert from "node:assert/strict"
import test from "node:test"
import type { ReplayVersionId } from "@interface-compiler/domain"
import { createDashboardView, selectVerificationSummary } from "../src/view-model.js"
import { createFixtureQuery, fixtureProjection } from "./fixtures.js"

test("the dashboard query fake returns a ready projection without a command surface", async () => {
  const result = await createFixtureQuery().readDashboard({ signal: new AbortController().signal, requestedAt: "2026-08-31T18:00:00.000Z", deadlineAt: "2026-08-31T18:00:15.000Z" })

  assert.equal(result.kind, "ready")
  if (result.kind !== "ready") return
  assert.equal(result.projection.schemaVersion, "worth-dashboard.v1")
})

test("active replay remains active while missing evidence is shown as a separate posture", () => {
  const projection = fixtureProjection()
  const view = createDashboardView(projection, "cap-search")

  assert.equal(view.selectedReplay?.status, "active")
  assert.equal(view.selectedVerification.posture, "missing_evidence")
  assert.deepEqual(view.selectedVerification.missingEvidenceIds.map(String), ["e-missing"])
  assert.ok(view.selectedEvidence.some((item) => String(item.id) === "e-missing" && item.posture === "missing"))
  assert.equal(view.selectedEvidence.some((item) => String(item.id) === "e-failure"), false)
})

test("the dashboard preserves Worth's explicit verification posture and failed evidence references", () => {
  const projection = fixtureProjection()
  const active = projection.replays.find((replay) => replay.status === "active")
  assert.ok(active)
  const inconsistentActive = {
    ...active,
    verification: {
      ...active.verification,
      posture: "inconsistent" as const,
      failedEvidenceIds: ["e-postcondition" as typeof active.verification.failedEvidenceIds[number]],
      explanation: "Worth reports an inconsistent active replay because failed evidence is referenced.",
    },
  }

  const summary = selectVerificationSummary(inconsistentActive)
  assert.equal(summary.posture, "inconsistent")
  assert.deepEqual(summary.failedEvidenceIds.map(String), ["e-postcondition"])
  assert.match(summary.explanation, /failed evidence/i)
  assert.equal(summary.successfulRuns, active.verification.successfulRuns)
})

test("verification posture is not inferred from run rows", () => {
  const active = fixtureProjection().replays.find((replay) => replay.status === "active")
  assert.ok(active)
  const projectionWithWorthPosture = {
    ...active,
    verification: {
      ...active.verification,
      posture: "verified" as const,
      successfulRuns: 0,
      failedRuns: 4,
      explanation: "Worth supplied this posture and counters as a projection fact.",
    },
  }

  const summary = selectVerificationSummary(projectionWithWorthPosture)
  assert.equal(summary.posture, "verified")
  assert.equal(summary.successfulRuns, 0)
  assert.equal(summary.failedRuns, 4)
})

test("candidate verification is provisional and preserves failed run detail", () => {
  const view = createDashboardView(fixtureProjection(), "cap-checkout")

  assert.equal(view.selectedReplay?.status, "verifying")
  assert.equal(view.selectedVerification.posture, "provisional")
  assert.equal(view.selectedVerification.successfulRuns, 1)
  assert.equal(view.selectedVerification.failedRuns, 1)
  assert.equal(view.selectedVerification.requiredSuccessfulRuns, 2)
})

test("broken replay is classified as failed rather than trusted", () => {
  const projection = fixtureProjection()
  const broken = projection.replays.find((replay) => replay.status === "broken")
  assert.ok(broken)

  const summary = selectVerificationSummary(broken)
  assert.equal(summary.posture, "failed")
  assert.equal(summary.replayStatus, "broken")
  assert.match(summary.explanation, /failed/i)
})

test("lineage is sorted by version without mutating the source projection", () => {
  const projection = fixtureProjection()
  const sourceOrder = projection.replays.filter((replay) => replay.capabilityId === "cap-search")
  const view = createDashboardView(projection, "cap-search")

  assert.deepEqual(view.selectedReplays.map((replay) => replay.version), [3, 2, 1])
  assert.deepEqual(projection.replays.filter((replay) => replay.capabilityId === "cap-search"), sourceOrder)
})

test("lifecycle pointers select the exact replay and never substitute a historical version", () => {
  const projection = fixtureProjection()
  const withoutActiveReplay = {
    ...projection,
    capabilities: projection.capabilities.map((item) => item.capability.status === "healthy"
      ? { ...item, capability: { ...item.capability, activeReplayVersionId: "replay-does-not-exist" as ReplayVersionId } }
      : item),
  }

  const view = createDashboardView(withoutActiveReplay, "cap-search")
  assert.equal(view.selectedReplay, null)
  assert.equal(view.selectedReplayResolution, "missing_pointer")
  assert.deepEqual(view.selectedReplays.map((replay) => replay.version), [3, 2, 1])
})

test("an incompatible lifecycle pointer is visible as inconsistent instead of trusted", () => {
  const projection = fixtureProjection()
  const activePointerToSuperseded = {
    ...projection,
    capabilities: projection.capabilities.map((item) => item.capability.status === "healthy"
      ? { ...item, capability: { ...item.capability, activeReplayVersionId: "replay-search-v2" as ReplayVersionId } }
      : item),
  }

  const view = createDashboardView(activePointerToSuperseded, "cap-search")
  assert.equal(view.selectedReplay, null)
  assert.equal(view.selectedReplayResolution, "inconsistent_pointer")
})

test("execution projections retain running, success, and failure outcomes", () => {
  const view = createDashboardView(fixtureProjection(), "cap-search")

  assert.deepEqual(view.selectedExecutions.map((execution) => execution.status), ["running", "success", "failure"])
  const failed = view.selectedExecutions.find((execution) => execution.status === "failure")
  assert.ok(failed)
  if (failed?.status === "failure") assert.equal(failed.outcome.message, "Fixture execution failed")
})

test("measured economics are displayed as projection values and not recalculated", () => {
  const view = createDashboardView(fixtureProjection(), "cap-search")

  assert.equal(view.selectedEconomics?.kind, "measured")
  if (view.selectedEconomics?.kind !== "measured") return
  assert.equal(view.selectedEconomics.metrics.totalCompilationCostMicrocents, 100_000_000)
  assert.equal(view.selectedEconomics.metrics.breakEvenCalls?.kind, "finite")
  assert.equal(view.selectedEconomics.lifetime?.lifetimeNetSavingsMicrocents, 300_000_000)
})

test("a missing replay verification projection stays unavailable", () => {
  const summary = selectVerificationSummary(undefined)
  assert.equal(summary.posture, "unavailable")
  assert.equal(summary.replayStatus, "missing")
})
