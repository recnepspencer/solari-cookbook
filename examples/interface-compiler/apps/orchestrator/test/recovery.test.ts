import assert from "node:assert/strict"
import test from "node:test"
import type {
  CandidateReplayInput,
  CapabilityProjection,
  CapabilityId,
  EvidenceId,
  ExperimentId,
  IsoTimestamp,
  OperationContext,
  ReplayProjection,
  ReplayVersionId,
  SessionId,
  VerificationRunId,
} from "@interface-compiler/domain"
import type { ReplayRecoveryPort, ReplayRecoveryResult, ReplacementVerificationReceipt } from "@interface-compiler/worth-adapter"
import { activateExploredReplacement } from "../src/index.js"

const capabilityId = "capability.search" as CapabilityId
const brokenId = "replay.search.v1" as ReplayVersionId
const replacementId = "replay.search.v2" as ReplayVersionId
const createdAt = "2026-09-01T12:01:00.000Z" as IsoTimestamp
const evidence = { queryName: "worth", queryIdentity: "worth-query", basisVersion: 1, projectedRecordCount: 1, projectedFieldCount: 1, basisReleased: true } as const
const failure = { kind: "step_failed" as const, stepIndex: 0, message: "search control disappeared", evidenceIds: ["evidence.failure" as EvidenceId] }

const degradation: Extract<ReplayRecoveryResult, { readonly kind: "applied" }> = {
  kind: "applied",
  commit: "committed",
  capability: { projectionKind: "worth_capability", id: capabilityId, revision: 5, applicationId: "application.shop" as never, name: "Search", description: "Search products", status: "degraded", brokenReplayVersionId: brokenId, failure, mode: "exploratory" },
  replay: { projectionKind: "worth_replay", id: brokenId, revision: 8, capabilityId, version: 1, steps: [{ type: "wait", milliseconds: 1 }], confidence: 0.8, createdAt: "2026-08-31T12:00:00.000Z" as IsoTimestamp, status: "broken", brokenAt: "2026-09-01T12:00:00.000Z" as IsoTimestamp, failure },
  capabilityEvidence: evidence,
  replayEvidence: evidence,
}

const candidate: CandidateReplayInput = {
  id: replacementId,
  capabilityId,
  version: 2,
  steps: [{ type: "navigate", url: "https://shop.test/search" }, { type: "fill", target: { semanticDescription: "search input", role: "searchbox" }, value: "detergent" }],
  confidence: 0.9,
  discoveredFromExperimentId: "experiment.recovery" as ExperimentId,
  supersedes: brokenId,
  createdAt,
}

function context(): OperationContext {
  return { operationId: "operation.recovery" as never, deadlineAt: "2026-09-01T12:10:00.000Z" as IsoTimestamp, cancellation: { isCancellationRequested: () => false, onCancellationRequested: () => () => undefined }, budget: { maxWallClockMs: 10_000 }, admission: { maxInFlight: 1, maxQueued: 0, overflow: "reject" } }
}

function receipt(index: number): ReplacementVerificationReceipt {
  return { id: `verification.recovery.${index}` as VerificationRunId, sessionId: `session.recovery.${index}` as SessionId, capabilityId, replayVersionId: replacementId, sessionFreshness: "fresh", outcome: "success", evidenceIds: [`evidence.recovery.${index}` as EvidenceId], completedAt: `2026-09-01T12:0${index + 1}:00.000Z` as IsoTimestamp }
}

function verifyingCapability(): Extract<CapabilityProjection, { readonly status: "verifying" }> {
  return {
    projectionKind: "worth_capability",
    id: capabilityId,
    revision: 6,
    applicationId: degradation.capability.applicationId,
    name: degradation.capability.name,
    description: degradation.capability.description,
    status: "verifying",
    candidateReplayVersionId: replacementId,
  }
}

test("explored replacement threads only WORTH-issued revisions through verification and activation", async () => {
  const calls: { readonly kind: string; readonly capabilityRevision: number; readonly replayRevision: number }[] = []
  const retained: ReplacementVerificationReceipt[] = []
  const verifyingReplay = (revision: number): Extract<ReplayProjection, { readonly status: "verifying" }> => ({
    projectionKind: "worth_replay", id: replacementId, revision, capabilityId, version: 2, steps: candidate.steps, confidence: candidate.confidence, supersedes: brokenId, createdAt, status: "verifying",
    verification: { requiredSuccessfulRuns: 3, runs: retained.map((run) => run.outcome === "success" ? { id: run.id, sessionId: run.sessionId, capabilityId, replayVersionId: replacementId, freshSession: true, outcome: "success", evidenceIds: run.evidenceIds } : { id: run.id, sessionId: run.sessionId, capabilityId, replayVersionId: replacementId, freshSession: true, outcome: "failure", failureMessage: run.failureMessage, evidenceIds: run.evidenceIds }) },
  })
  const port: ReplayRecoveryPort = {
    degradeReplay: async () => ({ kind: "denied", stage: "request", message: "not used" }),
    acceptReplacementCandidate: async (request) => {
      assert.equal(request.expectedCapabilityRevision, 5)
      assert.equal(request.expectedBrokenReplayRevision, 8)
      assert.notDeepEqual(request.candidate.steps, degradation.replay.steps)
      return { kind: "applied", commit: "committed", capability: verifyingCapability(), replay: verifyingReplay(0), capabilityEvidence: evidence, replayEvidence: evidence }
    },
    recordReplacementVerification: async (request) => {
      calls.push({ kind: "verification", capabilityRevision: request.expectedCapabilityRevision, replayRevision: request.expectedReplayRevision })
      retained.push(request.receipt)
      return { kind: "applied", commit: "committed", capability: verifyingCapability(), replay: verifyingReplay(request.expectedReplayRevision + 1), capabilityEvidence: evidence, replayEvidence: evidence }
    },
    activateReplacement: async (request) => {
      calls.push({ kind: "activation", capabilityRevision: request.expectedCapabilityRevision, replayRevision: request.expectedReplayRevision })
      const verifying = verifyingReplay(request.expectedReplayRevision)
      return { kind: "applied", commit: "committed", capability: { projectionKind: "worth_capability", id: capabilityId, revision: 7, applicationId: degradation.capability.applicationId, name: degradation.capability.name, description: degradation.capability.description, status: "healthy", activeReplayVersionId: replacementId }, replay: { ...verifying, revision: request.expectedReplayRevision + 1, status: "active", verifiedAt: request.verifiedAt }, capabilityEvidence: evidence, replayEvidence: evidence }
    },
  }
  const result = await activateExploredReplacement(port, { degradation, candidate, verificationReceipts: [receipt(1), receipt(2), receipt(3)], verifiedAt: "2026-09-01T12:05:00.000Z" as IsoTimestamp }, context())
  assert.equal(result.kind, "activated")
  if (result.kind !== "activated") throw new Error("expected activation")
  assert.equal(result.capability.id, degradation.capability.id)
  assert.equal(result.capability.name, degradation.capability.name)
  assert.equal(result.capability.activeReplayVersionId, replacementId)
  assert.equal(result.replay.id, replacementId)
  assert.notDeepEqual(result.replay.steps, degradation.replay.steps)
  assert.deepEqual(calls.map((call) => call.replayRevision), [0, 1, 2, 3])
  assert.deepEqual(calls.map((call) => call.capabilityRevision), [6, 6, 6, 6])
})

test("explored replacement stops on WORTH stale and activation denial outcomes", async () => {
  const stalePort: ReplayRecoveryPort = {
    degradeReplay: async () => ({ kind: "denied", stage: "request", message: "not used" }),
    acceptReplacementCandidate: async () => ({ kind: "stale", entity: "capability", entityId: capabilityId, expectedRevision: 5, actualRevision: 6 }),
    recordReplacementVerification: async () => { throw new Error("must not verify a stale candidate") },
    activateReplacement: async () => { throw new Error("must not activate a stale candidate") },
  }
  const stale = await activateExploredReplacement(stalePort, { degradation, candidate, verificationReceipts: [], verifiedAt: "2026-09-01T12:05:00.000Z" as IsoTimestamp }, context())
  assert.equal(stale.kind, "blocked")
  if (stale.kind === "blocked") assert.equal(stale.stage, "candidate")

  const verifying: Extract<ReplayProjection, { readonly status: "verifying" }> = { projectionKind: "worth_replay", id: replacementId, revision: 0, capabilityId, version: 2, steps: candidate.steps, confidence: 0.9, supersedes: brokenId, createdAt, status: "verifying", verification: { requiredSuccessfulRuns: 3, runs: [] } }
  const denialPort: ReplayRecoveryPort = {
    degradeReplay: stalePort.degradeReplay,
    acceptReplacementCandidate: async () => ({ kind: "applied", commit: "committed", capability: verifyingCapability(), replay: verifying, capabilityEvidence: evidence, replayEvidence: evidence }),
    recordReplacementVerification: stalePort.recordReplacementVerification,
    activateReplacement: async () => ({ kind: "denied", stage: "operation_admission", message: "three successes are required" }),
  }
  const denied = await activateExploredReplacement(denialPort, { degradation, candidate, verificationReceipts: [], verifiedAt: "2026-09-01T12:05:00.000Z" as IsoTimestamp }, context())
  assert.equal(denied.kind, "blocked")
  if (denied.kind === "blocked") {
    assert.equal(denied.stage, "activation")
    assert.equal(denied.authority.kind, "denied")
  }
})
