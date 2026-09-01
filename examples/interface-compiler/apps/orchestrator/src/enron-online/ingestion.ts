import { createHash } from "node:crypto"

export interface Trade {
  readonly counterparty: string
  readonly instrument: string
  readonly deliveryMonth: string
  readonly quantity: number
  readonly price: number
  readonly currency: "USD"
  readonly source: {
    readonly messageId: string
    readonly attachmentName: string
    readonly attachmentSha256: string
  }
}

export interface IncomingTradeMessage {
  readonly id: string
  readonly attachmentName: string
  readonly attachmentBytes: Uint8Array
}

export interface FinancialReceipt {
  readonly tradeId: string
  readonly receiptId: string
  readonly status: "posted"
}

export interface TradeInbox {
  read(messageId: string): Promise<IncomingTradeMessage | undefined>
}

export interface Financials {
  post(trade: Trade, idempotencyKey: string): Promise<FinancialReceipt>
  verify(receipt: FinancialReceipt): Promise<boolean>
}

export type IngestTradeResult =
  | {
      readonly status: "posted" | "duplicate"
      readonly tradeId: string
      readonly financialReceiptId: string
      readonly sourceMessageId: string
      readonly idempotencyKey: string
    }
  | {
      readonly status: "validation_failed"
      readonly sourceMessageId: string
      readonly reason: string
    }

type PostedTradeResult = Extract<IngestTradeResult, { readonly status: "posted" | "duplicate" }>

/**
 * Deterministic demo capability: canonicalization and idempotency remain
 * outside browser mechanics, while Financials owns posting and verification.
 */
export function createTradeIngestionCapability(
  inbox: TradeInbox,
  financials: Financials,
): { ingestIncomingTrade(input: { readonly messageId: string }): Promise<IngestTradeResult> } {
  const completed = new Map<string, PostedTradeResult>()

  return Object.freeze({
    async ingestIncomingTrade(input: { readonly messageId: string }): Promise<IngestTradeResult> {
      const message = await inbox.read(input.messageId)
      if (message === undefined) {
        return { status: "validation_failed", sourceMessageId: input.messageId, reason: "incoming message was not delivered" }
      }

      const attachmentSha256 = createHash("sha256").update(message.attachmentBytes).digest("hex")
      const idempotencyKey = `${message.id}:${attachmentSha256}`
      const existing = completed.get(idempotencyKey)
      if (existing !== undefined) return { ...existing, status: "duplicate" }

      const parsed = parseTradeCsv(new TextDecoder().decode(message.attachmentBytes), message, attachmentSha256)
      if (parsed.kind === "invalid") {
        return { status: "validation_failed", sourceMessageId: message.id, reason: parsed.reason }
      }

      const receipt = await financials.post(parsed.trade, idempotencyKey)
      if (!(await financials.verify(receipt))) {
        return { status: "validation_failed", sourceMessageId: message.id, reason: "Financials receipt could not be verified" }
      }

      const result = Object.freeze({
        status: "posted" as const,
        tradeId: receipt.tradeId,
        financialReceiptId: receipt.receiptId,
        sourceMessageId: message.id,
        idempotencyKey,
      })
      completed.set(idempotencyKey, result)
      return result
    },
  })
}

export function parseTradeCsv(
  csv: string,
  message: IncomingTradeMessage,
  attachmentSha256: string,
): { readonly kind: "valid"; readonly trade: Trade } | { readonly kind: "invalid"; readonly reason: string } {
  const rows = csv.trim().split(/\r?\n/).map((line) => line.split(",").map((value) => value.trim()))
  const [header, row, ...extra] = rows
  const expected = ["counterparty", "instrument", "delivery_month", "quantity", "price", "currency"]
  if (header === undefined || row === undefined || extra.length > 0 || header.join(",") !== expected.join(",")) {
    return { kind: "invalid", reason: "attachment must contain exactly one canonical trade row" }
  }

  const [counterparty, instrument, deliveryMonth, quantityText, priceText, currency] = row
  const quantity = Number(quantityText)
  const price = Number(priceText)
  if (
    !counterparty ||
    !instrument ||
    !/^\d{4}-\d{2}$/.test(deliveryMonth ?? "") ||
    !Number.isFinite(quantity) || quantity <= 0 ||
    !Number.isFinite(price) || price <= 0 ||
    currency !== "USD"
  ) {
    return { kind: "invalid", reason: "attachment contains invalid canonical trade fields" }
  }

  return {
    kind: "valid",
    trade: Object.freeze({
      counterparty,
      instrument,
      deliveryMonth,
      quantity,
      price,
      currency,
      source: {
        messageId: message.id,
        attachmentName: message.attachmentName,
        attachmentSha256,
      },
    }),
  }
}
