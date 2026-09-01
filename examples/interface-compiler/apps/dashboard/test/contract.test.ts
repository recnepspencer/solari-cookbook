import assert from "node:assert/strict"
import test from "node:test"
import { isSupportedWorthDashboardProjection } from "../src/dashboard-decoder.js"
import { fixtureProjection } from "./fixtures.js"

test("projection admission rejects a duplicate dashboard-owned evidence identity", () => {
  const projection = fixtureProjection()
  const present = projection.evidence.find((item) => item.status !== "missing")
  assert.ok(present)
  if (present === undefined) return

  const malformed = {
    ...projection,
    evidence: [{ status: "present" as const, id: "copied-dashboard-id", evidence: present.evidence }],
  }

  assert.equal(isSupportedWorthDashboardProjection(malformed), false)
})

test("projection admission rejects duplicate canonical evidence ids", () => {
  const projection = fixtureProjection()
  const present = projection.evidence.find((item) => item.status !== "missing")
  assert.ok(present)
  if (present === undefined) return

  const duplicatePresent = { ...projection, evidence: [present, present] }
  const missingCollision = { ...projection, evidence: [present, { status: "missing" as const, id: present.evidence.id }] }

  assert.equal(isSupportedWorthDashboardProjection(duplicatePresent), false)
  assert.equal(isSupportedWorthDashboardProjection(missingCollision), false)
})
