import type { ApplicationId, CapabilityId, JsonSchema } from "@interface-compiler/domain"
import type { WorthToolCapabilityProjection } from "@interface-compiler/tool-publisher"

export const ENRON_ONLINE_APPLICATION_ID = "application.enron-online" as ApplicationId
export const ENRON_ONLINE_BASE_URL = "http://127.0.0.1:4310"
export const RESOLVE_CONTRACT_CAPABILITY_ID = "capability.enron.market.resolve-contract" as CapabilityId
export const STAGE_TRADE_CAPABILITY_ID = "capability.enron.trades.stage-trade" as CapabilityId
export const REQUEST_RISK_APPROVAL_CAPABILITY_ID = "capability.enron.risk.request-approval" as CapabilityId

const string = (description: string): JsonSchema => ({ type: "string", description, minLength: 1 })
const integer = (description: string, minimum = 1): JsonSchema => ({ type: "integer", description, minimum })

function projection(input: {
  readonly capabilityId: CapabilityId
  readonly name: string
  readonly description: string
  readonly inputSchema: JsonSchema
  readonly outputSchema: JsonSchema
  readonly replayVersionId: string
}): WorthToolCapabilityProjection {
  return Object.freeze({
    projectionKind: "worth_tool_capability",
    capabilityId: input.capabilityId,
    applicationId: ENRON_ONLINE_APPLICATION_ID,
    revision: 1,
    name: input.name,
    description: input.description,
    inputSchema: input.inputSchema,
    outputSchema: input.outputSchema,
    authorization: { kind: "authorized" as const, audience: "gemini_consumer" as const, disclosure: "semantic_only" as const },
    status: "healthy",
    activeReplay: { capabilityId: input.capabilityId, replayVersionId: input.replayVersionId as never, version: 1, revision: 1, status: "active" as const },
  })
}

/** Consumer-safe WORTH projection seed. It deliberately contains no portal labels or browser details. */
export const ENRON_ONLINE_CAPABILITY_PROJECTIONS: readonly WorthToolCapabilityProjection[] = Object.freeze([
  projection({
    capabilityId: RESOLVE_CONTRACT_CAPABILITY_ID,
    name: "market.resolveContract",
    description: "Resolve an approved wholesale energy contract for a counterparty, market, delivery period, and requested volume.",
    inputSchema: { type: "object", properties: { counterpartyRef: string("Counterparty reference"), market: string("Wholesale market"), delivery: string("Delivery period"), requestedMmbtu: integer("Requested MMBtu") }, required: ["counterpartyRef", "market", "delivery", "requestedMmbtu"], additionalProperties: false },
    outputSchema: { type: "object", properties: { contractRef: string("Resolved contract reference"), deliveryHub: string("Delivery hub"), approvedMmbtu: integer("Approved MMBtu"), indicativePriceUsdPerMmbtu: { type: "number", description: "Indicative price" } }, required: ["contractRef", "deliveryHub", "approvedMmbtu", "indicativePriceUsdPerMmbtu"], additionalProperties: false },
    replayVersionId: "replay.enron.market.resolve-contract.v1",
  }),
  projection({
    capabilityId: STAGE_TRADE_CAPABILITY_ID,
    name: "trades.stageTrade",
    description: "Stage a resolved wholesale energy contract for review. This creates a reviewable trade reference; it does not book a trade.",
    inputSchema: { type: "object", properties: { contractRef: string("Resolved contract reference") }, required: ["contractRef"], additionalProperties: false },
    outputSchema: { type: "object", properties: { tradeRef: string("Staged trade reference"), status: string("Trade status") }, required: ["tradeRef", "status"], additionalProperties: false },
    replayVersionId: "replay.enron.trades.stage-trade.v1",
  }),
  projection({
    capabilityId: REQUEST_RISK_APPROVAL_CAPABILITY_ID,
    name: "risk.requestApproval",
    description: "Send a staged wholesale energy trade to independent risk review. This requests approval; it does not book a trade.",
    inputSchema: { type: "object", properties: { tradeRef: string("Staged trade reference") }, required: ["tradeRef"], additionalProperties: false },
    outputSchema: { type: "object", properties: { tradeRef: string("Staged trade reference"), status: string("Risk review status") }, required: ["tradeRef", "status"], additionalProperties: false },
    replayVersionId: "replay.enron.risk.request-approval.v1",
  }),
])

export const ENRON_ONLINE_DEMO_REQUEST = Object.freeze({
  counterpartyRef: "midwest-utility-17",
  market: "henry-hub-gas",
  delivery: "next-month",
  requestedMmbtu: 50_000,
})
