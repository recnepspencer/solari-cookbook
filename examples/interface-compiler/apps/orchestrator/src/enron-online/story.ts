import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { parseContractCatalog, parseCounterpartyLimits, resolveContract } from "./catalog.js"
import { ENRON_ONLINE_DEMO_REQUEST } from "./contracts.js"
import { createEnronOnlineApi, type EnronCapabilityRuntime } from "./semantic-api.js"
import { publishEnronOnlineConsumerTools } from "./tool-publication.js"

export async function runEnronOnlineStory(): Promise<{ readonly tools: readonly string[]; readonly tradeRef: string; readonly approval: string }> {
  const root = fileURLToPath(new URL("../../../enron-online-portal/data/", import.meta.url))
  const contracts = parseContractCatalog(readFileSync(`${root}contract_catalog.csv`, "utf8"))
  const limits = parseCounterpartyLimits(readFileSync(`${root}counterparty_limits.csv`, "utf8"))
  const runtime: EnronCapabilityRuntime = {
    admit: async () => ({ kind: "admitted" }),
    stageResolvedContract: async () => ({ tradeRef: "ET-NG-1042", status: "staged" }),
    requestRiskReview: async (tradeRef) => ({ tradeRef, status: "pending_risk_review" }),
  }
  const api = createEnronOnlineApi((input) => resolveContract(contracts, limits, input), runtime)
  const contract = await api.market.resolveContract(ENRON_ONLINE_DEMO_REQUEST)
  const trade = await api.trades.stageTrade({ contractRef: contract.contractRef })
  const approval = await api.risk.requestApproval({ tradeRef: trade.tradeRef })
  return Object.freeze({ tools: publishEnronOnlineConsumerTools().map((tool) => tool.name), tradeRef: trade.tradeRef, approval: approval.status })
}
