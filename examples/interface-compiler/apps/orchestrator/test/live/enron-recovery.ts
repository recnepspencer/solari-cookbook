import { createEnronTradeCapabilities, SemanticCapabilityExecutor } from "../../src/index.js"
import { INGEST_INCOMING_TRADE_CAPABILITY_ID, INCOMING_TRADE_MESSAGE_ID } from "../../src/enron-online/contracts.js"
import { createEnronLiveHarness } from "./enron-live-harness.js"

async function run(): Promise<void> {
  const live = createEnronLiveHarness()
  try {
    const executor = new SemanticCapabilityExecutor({
      clock: live.clock,
      ids: live.ids,
      worth: live.worth,
      solari: live.solari,
      discoveryModel: live.model,
      verifier: live.verifier,
      verificationEnvironment: live.verificationEnvironment,
    })
    const trades = createEnronTradeCapabilities(executor)
    const input = { messageId: INCOMING_TRADE_MESSAGE_ID }

    console.log("[1/3] Calling the stable semantic API against stale replay v1; Gemini recovery is allowed.")
    await prepareDeliveredTrade(live)
    const first = await trades.ingestIncomingTrade(input, live.context("semantic-call-stale-v1", { maxModelCalls: 40, maxBrowserActions: 160 }))
    if (first.kind !== "recovered") throw new Error(`first semantic call did not recover the stale replay: ${JSON.stringify(first)}`)
    const activeRead = await live.worth.readActiveReplay(INGEST_INCOMING_TRADE_CAPABILITY_ID, live.context("proof-active-replay", { maxModelCalls: 0 }))
    if (activeRead.kind !== "found" || activeRead.value.verification.runs.length !== 3) throw new Error("WORTH did not retain exactly three fresh replacement verification runs")
    const retainedSessions = new Set(activeRead.value.verification.runs.map((run) => run.sessionId))
    const retainedEvidence = new Set(activeRead.value.verification.runs.flatMap((run) => run.evidenceIds))
    if (retainedSessions.size !== 3 || retainedEvidence.size !== 3) throw new Error("WORTH replacement evidence was not fresh and distinct")
    const recoveryReceipts = await live.readPortalReceipts()
    if (recoveryReceipts.length !== 1) throw new Error("the isolated final verification world did not contain exactly one Financials receipt")
    console.log(`[1/3] WORTH activated replacement ${first.activeReplayVersionId}; the call returned capability_recovered without retrying the side effect.`)

    console.log("[2/3] Retrying the identical semantic call; Gemini is disabled, so only WORTH's active replay may run.")
    await prepareDeliveredTrade(live)
    const second = await trades.ingestIncomingTrade(input, live.context("semantic-call-active-v2", { maxModelCalls: 0 }))
    if (second.kind !== "succeeded" || second.output.status !== "posted") throw new Error(`second semantic call did not use the activated replay: ${JSON.stringify(second)}`)
    const afterSecond = await live.readPortalReceipts()
    if (afterSecond.length !== 1 || afterSecond[0]?.financialReceiptId !== second.output.financialReceiptId) throw new Error("the independent Financials state did not retain the second call exactly once")
    console.log(`[2/3] Posted through ${second.replayVersionId}; receipt ${second.output.financialReceiptId}.`)

    console.log("[3/3] Calling once more to prove the contract is idempotent and does not post twice.")
    const third = await trades.ingestIncomingTrade(input, live.context("semantic-call-idempotent-v2", { maxModelCalls: 0 }))
    if (third.kind !== "succeeded" || third.output.status !== "duplicate" || third.output.financialReceiptId !== second.output.financialReceiptId) throw new Error(`third semantic call was not idempotent: ${JSON.stringify(third)}`)
    const afterThird = await live.readPortalReceipts()
    if (afterThird.length !== 1 || afterThird[0]?.financialReceiptId !== second.output.financialReceiptId) throw new Error("the duplicate call changed independent Financials state")
    console.log(`[3/3] Duplicate suppressed; the original receipt ${third.output.financialReceiptId} was returned.`)

    console.log(JSON.stringify({
      publicCall: `trades.ingestIncomingTrade({ messageId: "${INCOMING_TRADE_MESSAGE_ID}" })`,
      firstCall: first,
      secondCall: second,
      thirdCall: third,
      proof: {
        firstCallReturnedRecoveryInsteadOfABusinessReceipt: first.kind === "recovered",
        freshVerificationRunsRetainedByWorth: activeRead.value.verification.runs.length,
        independentFinancialsReceiptCountAfterRecovery: recoveryReceipts.length,
        replacementActivatedByWorth: first.activeReplayVersionId,
        nextIdenticalCallUsedReplacement: second.replayVersionId,
        duplicateSuppressed: third.output.status === "duplicate",
        independentFinancialsReceiptCountAfterDuplicate: afterThird.length,
      },
    }, null, 2))
  } finally {
    await live.close()
  }
}

async function prepareDeliveredTrade(live: ReturnType<typeof createEnronLiveHarness>): Promise<void> {
  await live.resetPortal()
  await live.deliverPortal()
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
