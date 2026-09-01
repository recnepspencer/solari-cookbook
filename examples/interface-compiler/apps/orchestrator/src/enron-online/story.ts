import { INCOMING_TRADE_MESSAGE_ID } from "./contracts.js"
import { createTradeIngestionCapability, type Financials, type IncomingTradeMessage } from "./ingestion.js"
import { publishEnronOnlineConsumerTools } from "./tool-publication.js"

/** Illustrative local walkthrough; the live recovery is the WORTH-backed proof. */
export async function runEnronOnlineContractWalkthrough(): Promise<{ readonly tools: readonly string[]; readonly result: unknown }> {
  const message: IncomingTradeMessage = { id: INCOMING_TRADE_MESSAGE_ID, attachmentName: "midwest-utility-october.csv", attachmentBytes: new TextEncoder().encode("counterparty,instrument,delivery_month,quantity,price,currency\nMidwest Utility 17,NG-HH-2026-10,2026-10,50000,3.18,USD\n") }
  const financials: Financials = { async post() { return { tradeId: "FT-1042", receiptId: "FIN-1042", status: "posted" } }, async verify() { return true } }
  const api = createTradeIngestionCapability({ read: async (messageId) => messageId === message.id ? message : undefined }, financials)
  return Object.freeze({ tools: publishEnronOnlineConsumerTools().map((tool) => tool.name), result: await api.ingestIncomingTrade({ messageId: message.id }) })
}
