import assert from "node:assert/strict"
import test from "node:test"
import { createTradeIngestionCapability, type FinancialReceipt, type Financials, type IncomingTradeMessage, type Trade } from "../src/enron-online/ingestion.js"
import { publishEnronOnlineConsumerTools } from "../src/enron-online/tool-publication.js"

const validCsv = "counterparty,instrument,delivery_month,quantity,price,currency\nMidwest Utility 17,NG-HH-2026-10,2026-10,50000,3.18,USD\n"
const message: IncomingTradeMessage = { id: "message.trade.1042", attachmentName: "incoming-trade.csv", attachmentBytes: new TextEncoder().encode(validCsv) }

test("a valid trade email produces one typed Financials post and verified receipt", async () => {
  const financials = fakeFinancials()
  const result = await createTradeIngestionCapability(inbox(message), financials).ingestIncomingTrade({ messageId: message.id })
  assert.deepEqual(result.status, "posted")
  if (result.status !== "posted") return
  assert.equal(result.tradeId, "FT-1042")
  assert.equal(result.financialReceiptId, "FIN-1042")
  assert.equal(financials.posts.length, 1)
  assert.equal(financials.posts[0]?.trade.instrument, "NG-HH-2026-10")
})

test("duplicate delivery returns the prior receipt without a second Financials post", async () => {
  const financials = fakeFinancials()
  const api = createTradeIngestionCapability(inbox(message), financials)
  const first = await api.ingestIncomingTrade({ messageId: message.id })
  const duplicate = await api.ingestIncomingTrade({ messageId: message.id })
  assert.equal(first.status, "posted")
  assert.equal(duplicate.status, "duplicate")
  assert.equal(financials.posts.length, 1)
  if (first.status === "posted" && duplicate.status === "duplicate") assert.equal(duplicate.idempotencyKey, first.idempotencyKey)
})

test("malformed CSV fails before Financials is called", async () => {
  const financials = fakeFinancials()
  const malformed: IncomingTradeMessage = { ...message, attachmentBytes: new TextEncoder().encode("counterparty,quantity\nMidwest Utility 17,50000\n") }
  const result = await createTradeIngestionCapability(inbox(malformed), financials).ingestIncomingTrade({ messageId: malformed.id })
  assert.equal(result.status, "validation_failed")
  assert.equal(financials.posts.length, 0)
})

test("the published UI API Builder tool exposes one semantic operation only", () => {
  const tools = publishEnronOnlineConsumerTools()
  assert.equal(tools.length, 1)
  assert.match(tools[0]?.name ?? "", /ingest/i)
  assert.equal(JSON.stringify(tools).match(/selector|replay|solari|playwright|csv column/i), null)
})

function inbox(value: IncomingTradeMessage) { return { read: async (messageId: string) => messageId === value.id ? value : undefined } }
function fakeFinancials(): Financials & { readonly posts: { readonly trade: Trade; readonly key: string }[] } {
  const posts: { trade: Trade; key: string }[] = []
  return { posts, async post(trade: Trade, key: string): Promise<FinancialReceipt> { posts.push({ trade, key }); return { tradeId: "FT-1042", receiptId: "FIN-1042", status: "posted" } }, async verify(): Promise<boolean> { return true } }
}
