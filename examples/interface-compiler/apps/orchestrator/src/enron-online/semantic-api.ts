import type { CapabilityId } from "@interface-compiler/domain"
import { REQUEST_RISK_APPROVAL_CAPABILITY_ID, RESOLVE_CONTRACT_CAPABILITY_ID, STAGE_TRADE_CAPABILITY_ID } from "./contracts.js"
import { type ContractResolution, type ResolvedContract } from "./catalog.js"

export interface EnronCapabilityRuntime {
  /** WORTH admits the public capability before its current implementation runs. */
  admit(capabilityId: CapabilityId): Promise<{ readonly kind: "admitted" } | { readonly kind: "unavailable"; readonly reason: string }>
  /** This is the only portal seam. Browser implementation details cannot cross outward. */
  stageResolvedContract(contract: ResolvedContract): Promise<{ readonly tradeRef: string; readonly status: "staged" }>
  requestRiskReview(tradeRef: string): Promise<{ readonly tradeRef: string; readonly status: "pending_risk_review" }>
}

export interface ResolveContractInput { readonly counterpartyRef: string; readonly market: string; readonly delivery: string; readonly requestedMmbtu: number }
export interface StageTradeInput { readonly contractRef: string }
export interface RequestRiskApprovalInput { readonly tradeRef: string }
export interface EnronMarketApi { resolveContract(input: ResolveContractInput): Promise<ResolvedContract> }
export interface EnronTradesApi { stageTrade(input: StageTradeInput): Promise<{ readonly tradeRef: string; readonly status: "staged" }> }
export interface EnronRiskApi { requestApproval(input: RequestRiskApprovalInput): Promise<{ readonly tradeRef: string; readonly status: "pending_risk_review" }> }

/** The stable consumer surface: three semantic calls, no UI mechanics. */
export interface EnronOnlineApi { readonly market: EnronMarketApi; readonly trades: EnronTradesApi; readonly risk: EnronRiskApi }

export function createEnronOnlineApi(
  resolve: (input: ResolveContractInput) => ContractResolution,
  runtime: EnronCapabilityRuntime,
): EnronOnlineApi {
  const resolved = new Map<string, ResolvedContract>()
  const staged = new Set<string>()
  return Object.freeze({
    market: Object.freeze({ async resolveContract(input: ResolveContractInput) {
      await admitted(runtime, RESOLVE_CONTRACT_CAPABILITY_ID)
      const result = resolve(input)
      if (result.kind === "rejected") throw new Error(`contract resolution rejected: ${result.reason}`)
      resolved.set(result.value.contractRef, result.value)
      return result.value
    } }),
    trades: Object.freeze({ async stageTrade(input: StageTradeInput) {
      await admitted(runtime, STAGE_TRADE_CAPABILITY_ID)
      const contract = resolved.get(input.contractRef)
      if (!contract) throw new Error("trade staging requires a contract resolved by this workflow")
      const result = await runtime.stageResolvedContract(contract)
      staged.add(result.tradeRef)
      return result
    } }),
    risk: Object.freeze({ async requestApproval(input: RequestRiskApprovalInput) {
      await admitted(runtime, REQUEST_RISK_APPROVAL_CAPABILITY_ID)
      if (!staged.has(input.tradeRef)) throw new Error("risk approval requires a trade staged by this workflow")
      return runtime.requestRiskReview(input.tradeRef)
    } }),
  })
}

async function admitted(runtime: EnronCapabilityRuntime, capabilityId: CapabilityId): Promise<void> {
  const result = await runtime.admit(capabilityId)
  if (result.kind !== "admitted") throw new Error(`WORTH did not admit ${capabilityId}: ${result.reason}`)
}
