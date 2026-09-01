import type { ApplicationId, CapabilityId, JsonSchema } from "@interface-compiler/domain"
import type { WorthToolCapabilityProjection } from "@interface-compiler/tool-publisher"

export const ENRON_ONLINE_APPLICATION_ID = "application.enron-online" as ApplicationId
export const ENRON_ONLINE_BASE_URL = configuredPortalBaseUrl()
export const INGEST_INCOMING_TRADE_CAPABILITY_ID = "capability.trades.ingest-incoming-trade" as CapabilityId
export const INCOMING_TRADE_MESSAGE_ID = "msg.enron-mailroom.2026-10-1042"

const stringSchema = (description: string): JsonSchema => ({ type: "string", description, minLength: 1 })

const ingestInputSchema: JsonSchema = {
  type: "object",
  properties: { messageId: stringSchema("Incoming source reference") },
  required: ["messageId"],
  additionalProperties: false,
}

const ingestOutputSchema: JsonSchema = {
  type: "object",
  properties: {
    status: stringSchema("posted or duplicate"),
    tradeId: stringSchema("Financials reference"),
    financialReceiptId: stringSchema("Verified Financials receipt"),
    sourceMessageId: stringSchema("Source reference"),
    idempotencyKey: stringSchema("Deduplication key"),
  },
  required: ["status", "tradeId", "financialReceiptId", "sourceMessageId", "idempotencyKey"],
  additionalProperties: false,
}

/** The sole consumer-facing capability. Its replay implementation is private. */
export const INGEST_INCOMING_TRADE_PROJECTION: WorthToolCapabilityProjection = Object.freeze({
  projectionKind: "worth_tool_capability",
  capabilityId: INGEST_INCOMING_TRADE_CAPABILITY_ID,
  applicationId: ENRON_ONLINE_APPLICATION_ID,
  revision: 1,
  name: "trades.ingestIncomingTrade",
  description: "Ingest a delivered source record into Financials and return its verified receipt. Repeated requests are idempotent.",
  inputSchema: ingestInputSchema,
  outputSchema: ingestOutputSchema,
  authorization: {
    kind: "authorized",
    audience: "gemini_consumer",
    disclosure: "semantic_only",
  } as const,
  status: "healthy" as const,
  activeReplay: {
    capabilityId: INGEST_INCOMING_TRADE_CAPABILITY_ID,
    replayVersionId: "replay.trades.ingest-incoming-trade.v1" as never,
    version: 1,
    revision: 1,
    status: "active" as const,
  },
})

export const ENRON_ONLINE_CAPABILITY_PROJECTIONS = Object.freeze([INGEST_INCOMING_TRADE_PROJECTION])

function configuredPortalBaseUrl(): string {
  const configured = process.env.ENRON_ONLINE_BASE_URL?.trim()
  if (configured === undefined || configured.length === 0) return "http://127.0.0.1:4310"

  const url = new URL(configured)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("ENRON_ONLINE_BASE_URL must be an http(s) portal origin")
  }
  if (url.pathname !== "/" || url.search.length > 0 || url.hash.length > 0) {
    throw new Error("ENRON_ONLINE_BASE_URL must be a portal origin without a path, query, or fragment")
  }
  return url.origin
}
