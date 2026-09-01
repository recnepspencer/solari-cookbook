import assert from "node:assert/strict"
import test from "node:test"
import { parseContractCatalog, parseCounterpartyLimits, resolveContract } from "../src/enron-online/catalog.js"
import { ENRON_ONLINE_DEMO_REQUEST } from "../src/enron-online/contracts.js"
import { createEnronOnlineApi } from "../src/enron-online/semantic-api.js"
import { publishEnronOnlineConsumerTools } from "../src/enron-online/tool-publication.js"
import { benchmarkTask, ENRON_ONLINE_WORKFLOW_BENCHMARK_OBJECTIVE } from "../src/enron-online/benchmark.js"

const contracts = parseContractCatalog(`contract_ref,market,delivery,delivery_hub,side,min_mmbtu,max_mmbtu,price_usd_per_mmbtu\nNG-HH-2026-10,henry-hub-gas,next-month,Henry Hub,purchase,25000,100000,3.18`)
const limits = parseCounterpartyLimits(`counterparty_ref,counterparty_name,approved_markets,open_limit_usd\nmidwest-utility-17,Midwest Utility 17,henry-hub-gas,200000`)

test("compiles three semantic-only consumer tools", () => {
  const tools = publishEnronOnlineConsumerTools()
  assert.deepEqual(tools.map((tool) => tool.name), ["enron.market_resolve_contract", "enron.trades_stage_trade", "enron.risk_request_approval"])
  assert.equal(JSON.stringify(tools).match(/selector|replay|solari|playwright/i), null)
})

test("semantic workflow stages a contract then requests risk review", async () => {
  const admitted: string[] = []
  const api = createEnronOnlineApi((input) => resolveContract(contracts, limits, input), {
    admit: async (id) => { admitted.push(id); return { kind: "admitted" } },
    stageResolvedContract: async () => ({ tradeRef: "ET-NG-1042", status: "staged" }),
    requestRiskReview: async (tradeRef) => ({ tradeRef, status: "pending_risk_review" }),
  })
  const contract = await api.market.resolveContract(ENRON_ONLINE_DEMO_REQUEST)
  const trade = await api.trades.stageTrade({ contractRef: contract.contractRef })
  const approval = await api.risk.requestApproval({ tradeRef: trade.tradeRef })
  assert.equal(approval.status, "pending_risk_review")
  assert.equal(admitted.length, 3)
})

test("contract resolution rejects an over-limit request before a portal effect", () => {
  assert.deepEqual(resolveContract(contracts, limits, { ...ENRON_ONLINE_DEMO_REQUEST, requestedMmbtu: 100_000 }), { kind: "rejected", reason: "limit_exceeded" })
})

test("workflow benchmark identity is tied to the three-call Enron objective", () => {
  const task = benchmarkTask("gemini-2.5-flash")
  assert.equal(task.taskId, "enron-online-stage-and-risk-approval")
  assert.match(task.objectiveFingerprint, /^sha256:[a-f0-9]{64}$/)
  assert.match(ENRON_ONLINE_WORKFLOW_BENCHMARK_OBJECTIVE, /risk approval/i)
})
