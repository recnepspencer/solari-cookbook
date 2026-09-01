import type { CandidateReplayInput } from "@interface-compiler/domain"
import { createCompiledPlanReadAdapter, type ReplacementVerificationReceipt } from "@interface-compiler/worth-adapter"
import { activateExploredReplacement, ExperimentRunner, planCompiledExperiment } from "../../src/index.js"
import { INCOMING_TRADE_MESSAGE_ID, INGEST_INCOMING_TRADE_CAPABILITY_ID } from "../../src/enron-online/contracts.js"
import { createEnronLiveHarness } from "./enron-live-harness.js"

async function run(): Promise<void> {
  const live = createEnronLiveHarness()
  try {
    const request = {
      application: live.application,
      capabilityId: INGEST_INCOMING_TRADE_CAPABILITY_ID,
      experimentId: "experiment.trades.ingest.stale-v1" as never,
      objective: "Ingest the delivered incoming trade by message identity.",
      input: { messageId: INCOMING_TRADE_MESSAGE_ID },
      expectedOutcome: [{ kind: "text_present", text: "POSTED FT-1042" }] as const,
    }
    const stalePlan = await planCompiledExperiment(request, createCompiledPlanReadAdapter(live.worth), live.context("stale-plan"))
    if (stalePlan.kind !== "planned") throw new Error("WORTH did not plan replay v1")
    await live.resetPortal()
    const stale = await new ExperimentRunner({ clock: live.clock, ids: live.ids, worth: live.worth, solari: live.solari, verifier: live.verifier }).run(stalePlan.plan, live.controller("stale-v1"))
    if (stale.kind !== "attempted" || stale.recovery?.kind !== "applied") throw new Error("stale replay v1 did not produce WORTH degradation")

    const candidate = createV2Candidate(live.application.baseUrl, live.clock.now())
    // The demo portal is deliberately in-memory. Run fresh sessions serially
    // so each verification owns a clean portal reset rather than racing the
    // other verifications' test fixture state.
    const receipts: ReplacementVerificationReceipt[] = []
    for (const index of [1, 2, 3]) receipts.push(await verifyCandidate(live, candidate, index))
    const activated = await activateExploredReplacement(live.worth, { degradation: stale.recovery, candidate, verificationReceipts: receipts, verifiedAt: live.clock.now() }, live.context("activate-v2"))
    if (activated.kind !== "activated") throw new Error(`WORTH did not activate replay v2: ${activated.message}`)

    const rerunPlan = await planCompiledExperiment({ ...request, experimentId: "experiment.enron.v2-rerun" as never }, createCompiledPlanReadAdapter(live.worth), live.context("v2-plan"))
    if (rerunPlan.kind !== "planned") throw new Error("WORTH did not plan activated replay v2")
    await live.resetPortal()
    const rerun = await new ExperimentRunner({ clock: live.clock, ids: live.ids, worth: live.worth, solari: live.solari, verifier: live.verifier }).run(rerunPlan.plan, live.controller("v2-rerun"))
    if (rerun.kind !== "attempted" || rerun.terminal.kind !== "success") throw new Error("activated replay v2 did not satisfy its public contract")
    console.log(JSON.stringify({ recovery: "activated", staleReplay: stale.recovery.replay.id, activeReplay: activated.replay.id, verificationSessions: receipts.map((receipt) => receipt.sessionId), rerun: rerun.terminal.kind }, null, 2))
  } finally {
    await live.close()
  }
}

function createV2Candidate(baseUrl: string, createdAt: string): CandidateReplayInput {
  return {
    id: "replay.trades.ingest-incoming-trade.v2" as never,
    capabilityId: INGEST_INCOMING_TRADE_CAPABILITY_ID,
    version: 2,
    steps: [
      // v2 is the current UI release; v1 remains the deliberately stale replay.
      { type: "navigate", url: `${baseUrl}/?page=mail&release=v2` },
      { type: "click", target: { semanticDescription: "deliver trade email", role: "button", name: "Deliver new trade email" } },
      // Delivery updates the old UI asynchronously before the posting control
      // becomes available.
      { type: "wait", milliseconds: 500 },
      { type: "click", target: { semanticDescription: "ingest trade attachment", role: "button", name: "Review CSV & post to Financials" } },
      // Posting this legacy ticket is asynchronous. The wait is private replay
      // implementation detail, not part of the public semantic capability.
      { type: "wait", milliseconds: 750 },
      { type: "assert", condition: { kind: "text_present", text: "POSTED FT-1042" } },
    ],
    confidence: 1,
    discoveredFromExperimentId: "experiment.trades.ingest.recovery.v2" as never,
    supersedes: "replay.trades.ingest-incoming-trade.v1" as never,
    createdAt: createdAt as never,
  }
}

async function verifyCandidate(live: ReturnType<typeof createEnronLiveHarness>, candidate: CandidateReplayInput, index: number): Promise<ReplacementVerificationReceipt> {
  await live.resetPortal()
  const operation = live.context(`v2-verification-${index}`, { maxModelCalls: 0 })
  const created = await live.solari.createSession({ application: live.application, purpose: "verification", freshness: "fresh" }, operation)
  if (created.kind !== "created") throw new Error(`verification ${index} did not create a fresh Solari session`)
  try {
    for (const step of candidate.steps) {
      const result = await created.lease.session.executeStep(step, operation)
      if (result.kind !== "completed") throw new Error(`verification ${index} failed replay v2`)
    }
    const observed = await created.lease.session.observe(operation)
    if (observed.kind !== "observed" || !observed.observation.interactables.some((item) => [item.text, item.name].some((value) => value?.includes("POSTED FT-1042")))) throw new Error(`verification ${index} did not observe the verified Financials receipt`)
    const evidence = await created.lease.session.captureEvidence({ kind: "session_recording" }, operation)
    if (evidence.kind !== "captured") throw new Error(`verification ${index} did not capture a Solari recording`)
    return { id: live.ids.nextVerificationRunId(), sessionId: created.lease.session.sessionId, capabilityId: INGEST_INCOMING_TRADE_CAPABILITY_ID, replayVersionId: candidate.id, sessionFreshness: "fresh", outcome: "success", evidenceIds: [evidence.reference.evidenceId], completedAt: live.clock.now() }
  } finally {
    await created.lease.release(operation)
  }
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
