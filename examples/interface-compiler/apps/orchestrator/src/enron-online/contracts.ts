import type { ApplicationId, CapabilityId } from "@interface-compiler/domain"

export const ENRON_ONLINE_APPLICATION_ID = "application.enron-online" as ApplicationId
export const ENRON_ONLINE_BASE_URL = configuredPortalBaseUrl()
export const INGEST_INCOMING_TRADE_CAPABILITY_ID = "capability.trades.ingest-incoming-trade" as CapabilityId
export const INCOMING_TRADE_MESSAGE_ID = "msg.enron-mailroom.2026-10-1042"

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
