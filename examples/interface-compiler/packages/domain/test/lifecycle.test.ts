import assert from "node:assert/strict"
import test from "node:test"
import {
  activateCapability,
  beginCapabilityVerification,
  beginReplayVerification,
  completeReplayVerification,
  createCandidateReplay,
  createCapability,
  degradeCapability,
  failCapabilityVerification,
  markReplayBroken,
  resumeCapabilityExploration,
  successfulVerificationCount,
  supersedeReplay,
  type ApplicationId,
  type CapabilityId,
  type CandidateReplay,
  type CapabilityDefinition,
  type EvidenceId,
  type ExperimentId,
  type ReplayFailure,
  type ReplayVersionId,
  type SessionId,
  type VerificationRunId,
  type VerificationRunReceipt,
  type VerifyingReplay,
  type ValidationResult,
} from "../src/index.js"
import { recordVerificationRun } from "../src/replay-verification.js"

const createdAt = "2026-08-31T12:00:00.000Z"

function id<T extends string>(value: string): T {
  return value as T
}

function unwrap<T>(result: ValidationResult<T>): T {
  if (!result.ok) throw new Error(result.issues.map((entry) => `${entry.path}: ${entry.message}`).join(", "))
  return result.value
}

function capabilityDefinition(): CapabilityDefinition {
  return {
    id: id<CapabilityId>("capability.add-to-cart"),
    applicationId: id<ApplicationId>("application.wholesale-catalog"),
    name: "AddToCart",
    description: "Add one selected product to the cart.",
    inputSchema: { type: "object", required: ["productRef"], properties: { productRef: { type: "string" } } },
    outputSchema: { type: "object", required: ["status"], properties: { status: { type: "string" } } },
    preconditions: [{ kind: "interactable_present", semanticDescription: "selected product" }],
    postconditions: [{ kind: "product_in_cart", productRef: "selected-product" }],
  }
}

function candidate(version: number, supersedes?: string): CandidateReplay {
  return unwrap(
    createCandidateReplay({
      id: id<ReplayVersionId>(`replay.add-to-cart.v${version}`),
      capabilityId: id<CapabilityId>("capability.add-to-cart"),
      version,
      steps: [
        {
          type: "click",
          target: { semanticDescription: "Add to cart", role: "button", text: "Add to cart" },
        },
      ],
      confidence: 0.8,
      discoveredFromExperimentId: id<ExperimentId>(`experiment.add-to-cart.v${version}`),
      supersedes: supersedes === undefined ? undefined : id<ReplayVersionId>(supersedes),
      createdAt,
    }),
  )
}

function successfulReceipts(count: number): VerificationRunReceipt[] {
  return Array.from({ length: count }, (_, index) => ({
    id: id<VerificationRunId>(`verification-run.${index + 1}`),
    sessionId: id<SessionId>(`session.fresh.${index + 1}`),
    capabilityId: id<CapabilityId>("capability.add-to-cart"),
    replayVersionId: id<ReplayVersionId>("replay.add-to-cart.v1"),
    sessionFreshness: "fresh" as const,
    outcome: "success" as const,
    evidenceIds: [id<EvidenceId>(`evidence.run.${index + 1}`)],
  }))
}

function recordReceipts(replay: VerifyingReplay, receipts: readonly VerificationRunReceipt[]): VerifyingReplay {
  return receipts.reduce((current, receipt) => unwrap(recordVerificationRun(current, receipt)), replay)
}

function replayFailure(replayVersionId: string): ReplayFailure {
  return {
    kind: "step_failed",
    stepIndex: 0,
    message: "the semantic target was not found",
    evidenceIds: [id<EvidenceId>(`evidence.failure.${replayVersionId}`)],
  }
}

test("candidate replay becomes active only after three distinct fresh-session successes", () => {
  const initial = unwrap(createCapability(capabilityDefinition()))
  const replayCandidate = candidate(1)
  const verifyingReplay = unwrap(beginReplayVerification(replayCandidate))
  const verifyingCapability = unwrap(beginCapabilityVerification(initial, replayCandidate))

  const activeReplay = unwrap(completeReplayVerification(recordReceipts(verifyingReplay, successfulReceipts(3)), createdAt))
  assert.equal(activeReplay.status, "active")
  if (activeReplay.status !== "active") throw new Error("expected active replay")
  assert.equal(successfulVerificationCount(activeReplay), 3)

  const healthyCapability = unwrap(activateCapability(verifyingCapability, activeReplay))
  assert.equal(healthyCapability.status, "healthy")
  assert.equal(healthyCapability.activeReplayVersionId, activeReplay.id)
})

test("failed active replay degrades the capability and resumes exploration with lineage", () => {
  const initial = unwrap(createCapability(capabilityDefinition()))
  const replayCandidate = candidate(1)
  const verifyingCapability = unwrap(beginCapabilityVerification(initial, replayCandidate))
  const activeReplay = unwrap(
    completeReplayVerification(recordReceipts(unwrap(beginReplayVerification(replayCandidate)), successfulReceipts(3)), createdAt),
  )
  if (activeReplay.status !== "active") throw new Error("expected active replay")
  const healthyCapability = unwrap(activateCapability(verifyingCapability, activeReplay))

  const brokenReplay = unwrap(markReplayBroken(activeReplay, replayFailure(activeReplay.id), "2026-08-31T12:01:00.000Z"))
  const degraded = unwrap(degradeCapability(healthyCapability, brokenReplay))
  assert.equal(degraded.status, "degraded")
  assert.equal(degraded.mode, "exploratory")

  const exploring = unwrap(resumeCapabilityExploration(degraded))
  assert.equal(exploring.status, "discovering")
  assert.equal(exploring.discovery.kind, "reexploration")
  if (exploring.discovery.kind !== "reexploration") throw new Error("expected re-exploration")
  assert.equal(exploring.discovery.previousReplayVersionId, brokenReplay.id)
})

test("verification failure is a broken replay and a candidate can be explicitly superseded", () => {
  const replayCandidate = candidate(1)
  const verifyingReplay = unwrap(beginReplayVerification(replayCandidate))
  const failed = unwrap(completeReplayVerification(recordReceipts(verifyingReplay, successfulReceipts(2)), createdAt))
  assert.equal(failed.status, "broken")
  if (failed.status !== "broken") throw new Error("expected broken replay")
  assert.equal(failed.failure.kind, "verification_failed")
  assert.equal(failed.failure.successfulRuns, 2)

  const initial = unwrap(createCapability(capabilityDefinition()))
  const verifyingCapability = unwrap(beginCapabilityVerification(initial, replayCandidate))
  const rediscovering = unwrap(failCapabilityVerification(verifyingCapability, failed))
  assert.equal(rediscovering.status, "discovering")
  assert.equal(rediscovering.discovery.kind, "verification_failed")

  const abandonedCandidate = candidate(2, replayCandidate.id)
  const successor = candidate(3, abandonedCandidate.id)
  const superseded = unwrap(supersedeReplay(abandonedCandidate, successor, "2026-08-31T12:02:00.000Z"))
  assert.equal(superseded.status, "superseded")
  assert.equal(superseded.supersededBy, successor.id)
})

test("transition functions reject a replay from another capability", () => {
  const initial = unwrap(createCapability(capabilityDefinition()))
  const foreignCandidate = unwrap(
    createCandidateReplay({
      ...candidate(1),
      id: id<ReplayVersionId>("replay.foreign.v1"),
      capabilityId: id<CapabilityId>("capability.other"),
    }),
  )
  const result = beginCapabilityVerification(initial, foreignCandidate)
  assert.equal(result.ok, false)
})
