import assert from "node:assert/strict"
import test from "node:test"
import { renderDashboardResult } from "../src/render.js"
import { fixtureProjection } from "./fixtures.js"

test("ready view exposes provisional, failed, and missing evidence states", () => {
  const html = renderDashboardResult({ kind: "ready", projection: fixtureProjection() }, "cap-checkout")
  const missingEconomicsHtml = renderDashboardResult({ kind: "ready", projection: fixtureProjection() }, "cap-cart")
  const missingEvidenceHtml = renderDashboardResult({ kind: "ready", projection: fixtureProjection() }, "cap-search")
  const executionHtml = renderDashboardResult({ kind: "ready", projection: fixtureProjection() }, "cap-search")

  assert.match(html, /PROVISIONAL/)
  assert.match(html, /FAILED/)
  assert.match(missingEvidenceHtml, /MISSING EVIDENCE/)
  assert.match(missingEconomicsHtml, /No measured economics/)
  assert.match(executionHtml, /Fixture execution failed/)
  assert.match(html, /Break-even/)
})

test("ready view renders measured values only where the projection marks them measured", () => {
  const html = renderDashboardResult({ kind: "ready", projection: fixtureProjection() }, "cap-search")

  assert.match(html, /\$1\.00/)
  assert.match(html, /25 calls/)
  assert.match(html, /Total tokens/)
  assert.match(html, /1,200/)
  assert.match(html, /Lifetime direct cost avoided/)
  assert.match(html, /Lifetime compiled cost/)
  assert.match(html, /Not measured/)
  assert.match(html, /Missing: wallClockMs, estimatedModelCostUsd/)
})

test("unavailable and failed query results stay explicit and escape provider text", () => {
  const unavailable = renderDashboardResult({ kind: "unavailable", reason: "not_configured" })
  const failed = renderDashboardResult({ kind: "failed", message: "Provider <script>alert('x')</script>", retryable: false })

  assert.match(unavailable, /WORTH QUERY NOT CONNECTED/)
  assert.match(unavailable, /does not create, infer, or repair authority records/)
  assert.match(failed, /Provider &lt;script&gt;alert\(&#39;x&#39;\)&lt;\/script&gt;/)
  assert.doesNotMatch(failed, /<script>alert/)
})

test("discovery projections preserve re-exploration and verification-failure context", () => {
  const projection = fixtureProjection()
  const broken = projection.capabilities.find((item) => item.capability.status === "degraded")
  assert.ok(broken)
  if (broken === undefined || broken.capability.status !== "degraded") return
  const brokenCapability = broken.capability
  const candidate = projection.replays.find((replay) => replay.capabilityId === "cap-checkout")
  assert.ok(candidate)
  if (candidate === undefined) return

  const reexploration = {
    ...projection,
    capabilities: projection.capabilities.map((item) => item.capability.status === "discovering"
      ? { ...item, capability: { ...item.capability, discovery: { kind: "reexploration" as const, previousReplayVersionId: brokenCapability.brokenReplayVersionId, failure: brokenCapability.failure } } }
      : item),
  }
  const verificationFailure = {
    ...projection,
    capabilities: projection.capabilities.map((item) => item.capability.status === "discovering"
      ? { ...item, capability: { ...item.capability, discovery: { kind: "verification_failed" as const, candidateReplayVersionId: candidate.id, failure: brokenCapability.failure } } }
      : item),
  }

  assert.match(renderDashboardResult({ kind: "ready", projection: reexploration }, "cap-account"), /Re-exploration/)
  assert.match(renderDashboardResult({ kind: "ready", projection: reexploration }, "cap-account"), /replay-cart-v2/)
  assert.match(renderDashboardResult({ kind: "ready", projection: verificationFailure }, "cap-account"), /Verification failed/)
  assert.match(renderDashboardResult({ kind: "ready", projection: verificationFailure }, "cap-account"), /replay-checkout-v1/)
})

test("known non-fresh verification sessions are shown as non-fresh", () => {
  const projection = fixtureProjection()
  const verifying = projection.replays.find((replay) => replay.status === "verifying")
  assert.ok(verifying)
  if (verifying === undefined) return
  const nonFresh = {
    ...projection,
    replays: projection.replays.map((replay) => replay.id === verifying.id
      ? { ...replay, verification: { ...replay.verification, runs: replay.verification.runs.map((run, index) => index === 0 ? { ...run, freshSession: false } : run) } }
      : replay),
  }

  assert.match(renderDashboardResult({ kind: "ready", projection: nonFresh }, "cap-checkout"), /not a fresh session/)
})
