export interface ContractRow {
  readonly contractRef: string
  readonly market: string
  readonly delivery: string
  readonly deliveryHub: string
  readonly side: "purchase" | "sale"
  readonly minMmbtu: number
  readonly maxMmbtu: number
  readonly priceUsdPerMmbtu: number
}

export interface CounterpartyLimitRow {
  readonly counterpartyRef: string
  readonly counterpartyName: string
  readonly approvedMarkets: readonly string[]
  readonly openLimitUsd: number
}

export interface ResolvedContract {
  readonly contractRef: string
  readonly counterpartyRef: string
  readonly deliveryHub: string
  readonly approvedMmbtu: number
  readonly indicativePriceUsdPerMmbtu: number
}

export type ContractResolution =
  | { readonly kind: "resolved"; readonly value: ResolvedContract }
  | { readonly kind: "rejected"; readonly reason: "counterparty_not_found" | "market_not_approved" | "contract_not_found" | "volume_out_of_range" | "limit_exceeded" }

export function parseContractCatalog(csv: string): readonly ContractRow[] {
  return parseRows(csv).map((row) => Object.freeze({
    contractRef: required(row, "contract_ref"), market: required(row, "market"), delivery: required(row, "delivery"), deliveryHub: required(row, "delivery_hub"), side: required(row, "side") as ContractRow["side"],
    minMmbtu: number(row, "min_mmbtu"), maxMmbtu: number(row, "max_mmbtu"), priceUsdPerMmbtu: number(row, "price_usd_per_mmbtu"),
  }))
}

export function parseCounterpartyLimits(csv: string): readonly CounterpartyLimitRow[] {
  return parseRows(csv).map((row) => Object.freeze({
    counterpartyRef: required(row, "counterparty_ref"), counterpartyName: required(row, "counterparty_name"), approvedMarkets: required(row, "approved_markets").split(";").filter(Boolean), openLimitUsd: number(row, "open_limit_usd"),
  }))
}

export function resolveContract(
  contracts: readonly ContractRow[], limits: readonly CounterpartyLimitRow[], input: { readonly counterpartyRef: string; readonly market: string; readonly delivery: string; readonly requestedMmbtu: number },
): ContractResolution {
  const counterparty = limits.find((entry) => entry.counterpartyRef === input.counterpartyRef)
  if (!counterparty) return { kind: "rejected", reason: "counterparty_not_found" }
  if (!counterparty.approvedMarkets.includes(input.market)) return { kind: "rejected", reason: "market_not_approved" }
  const contract = contracts.find((entry) => entry.market === input.market && entry.delivery === input.delivery && entry.side === "purchase")
  if (!contract) return { kind: "rejected", reason: "contract_not_found" }
  if (!Number.isInteger(input.requestedMmbtu) || input.requestedMmbtu < contract.minMmbtu || input.requestedMmbtu > contract.maxMmbtu) return { kind: "rejected", reason: "volume_out_of_range" }
  if (input.requestedMmbtu * contract.priceUsdPerMmbtu > counterparty.openLimitUsd) return { kind: "rejected", reason: "limit_exceeded" }
  return { kind: "resolved", value: Object.freeze({ contractRef: contract.contractRef, counterpartyRef: counterparty.counterpartyRef, deliveryHub: contract.deliveryHub, approvedMmbtu: input.requestedMmbtu, indicativePriceUsdPerMmbtu: contract.priceUsdPerMmbtu }) }
}

function parseRows(csv: string): readonly Record<string, string>[] {
  const lines = csv.trim().split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) throw new Error("CSV must include a header and at least one row")
  const headers = lines[0].split(",")
  return Object.freeze(lines.slice(1).map((line) => Object.freeze(Object.fromEntries(headers.map((header, index) => [header, line.split(",")[index] ?? ""])))) )
}
function required(row: Record<string, string>, key: string): string { const value = row[key]?.trim(); if (!value) throw new Error(`CSV field ${key} is required`); return value }
function number(row: Record<string, string>, key: string): number { const value = Number(required(row, key)); if (!Number.isFinite(value)) throw new Error(`CSV field ${key} must be numeric`); return value }
