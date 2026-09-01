import { inspectGeminiEnvironment } from "@interface-compiler/gemini-adapter"
import { readSolariConfig } from "@interface-compiler/solari-adapter"
import type { ModelPricingUsdPerToken } from "@interface-compiler/domain"

export const WALMART_NETWORK_OPT_IN = "INTERFACE_COMPILER_ALLOW_WALMART_NETWORK"
const INPUT_PRICE = "GEMINI_INPUT_USD_PER_MILLION_TOKENS"
const OUTPUT_PRICE = "GEMINI_OUTPUT_USD_PER_MILLION_TOKENS"

export interface WalmartBenchmarkConfigurationInspection {
  readonly mode: "dry_run"
  readonly network: "disabled"
  readonly readyForReviewedExecution: boolean
  readonly networkOptInPresent: boolean
  readonly adapters: {
    readonly gemini: { readonly kind: "configured"; readonly model: string } | { readonly kind: "missing" }
    readonly solari: { readonly kind: "configured" } | { readonly kind: "invalid" }
    readonly worth: { readonly kind: "configured"; readonly storage: "in_memory"; readonly processStarted: false }
  }
  readonly pricing: { readonly kind: "configured"; readonly source: "environment" } | { readonly kind: "invalid" }
  readonly issues: readonly { readonly path: string; readonly message: string }[]
  readonly safeguards: readonly string[]
}

export type WalmartLiveConfiguration =
  | { readonly kind: "configured"; readonly modelId: string; readonly pricing: ModelPricingUsdPerToken }
  | { readonly kind: "invalid"; readonly issues: readonly { readonly path: string; readonly message: string }[] }

/** Reads configuration only. It never constructs an SDK client or starts a process. */
export function inspectWalmartBenchmarkConfiguration(env: NodeJS.ProcessEnv): WalmartBenchmarkConfigurationInspection {
  const issues: { path: string; message: string }[] = []
  const gemini = inspectGeminiEnvironment(env)
  if (gemini.kind !== "configured") issues.push({ path: gemini.kind === "missing_api_key" ? "GEMINI_API_KEY" : "GEMINI_MODEL", message: `${gemini.kind === "missing_api_key" ? "GEMINI_API_KEY" : "GEMINI_MODEL"} must be configured` })
  const solari = readSolariConfig(env)
  if (!solari.ok) issues.push(...solari.issues.map((entry) => ({ path: entry.path, message: entry.message })))
  const pricing = readPricing(env)
  if (pricing.kind === "invalid") issues.push(...pricing.issues)
  const networkOptInPresent = env[WALMART_NETWORK_OPT_IN]?.trim().toLowerCase() === "true"
  if (!networkOptInPresent) issues.push({ path: WALMART_NETWORK_OPT_IN, message: `${WALMART_NETWORK_OPT_IN}=true is required only for the reviewed live command` })

  const adapters: WalmartBenchmarkConfigurationInspection["adapters"] = Object.freeze({
    gemini: gemini.kind === "configured" ? { kind: "configured", model: gemini.model } : { kind: "missing" },
    solari: solari.ok ? { kind: "configured" } : { kind: "invalid" },
    worth: { kind: "configured", storage: "in_memory", processStarted: false },
  })
  const pricingStatus: WalmartBenchmarkConfigurationInspection["pricing"] = pricing.kind === "configured" ? { kind: "configured", source: "environment" } : { kind: "invalid" }
  return Object.freeze({
    mode: "dry_run",
    network: "disabled",
    readyForReviewedExecution: issues.length === 0,
    networkOptInPresent,
    adapters,
    pricing: pricingStatus,
    issues: Object.freeze(issues),
    safeguards: Object.freeze([
      "dry-run constructs no Gemini, Solari, or WORTH client",
      "both live modes use fresh Solari sessions and bounded operation budgets",
      "authentication, account, personal-information, shipping, payment, checkout, order, and credential boundaries are terminal",
      "the harness never supplies personal data and never purchases",
      "economics accept only attributed WORTH terminal projections",
    ]),
  })
}

export function readWalmartLiveConfiguration(env: NodeJS.ProcessEnv): WalmartLiveConfiguration {
  const inspection = inspectWalmartBenchmarkConfiguration(env)
  const pricing = readPricing(env)
  const gemini = inspectGeminiEnvironment(env)
  if (!inspection.readyForReviewedExecution || pricing.kind !== "configured" || gemini.kind !== "configured") return { kind: "invalid", issues: inspection.issues }
  return { kind: "configured", modelId: gemini.model, pricing: pricing.value }
}

function readPricing(env: NodeJS.ProcessEnv): { readonly kind: "configured"; readonly value: ModelPricingUsdPerToken } | { readonly kind: "invalid"; readonly issues: readonly { readonly path: string; readonly message: string }[] } {
  const issues: { path: string; message: string }[] = []
  const inputPerMillion = nonNegativeNumber(env[INPUT_PRICE], INPUT_PRICE, issues)
  const outputPerMillion = nonNegativeNumber(env[OUTPUT_PRICE], OUTPUT_PRICE, issues)
  if (issues.length > 0 || inputPerMillion === undefined || outputPerMillion === undefined) return { kind: "invalid", issues }
  return { kind: "configured", value: Object.freeze({ inputUsdPerToken: inputPerMillion / 1_000_000, outputUsdPerToken: outputPerMillion / 1_000_000 }) }
}

function nonNegativeNumber(value: string | undefined, path: string, issues: { path: string; message: string }[]): number | undefined {
  if (value === undefined || value.trim() === "") {
    issues.push({ path, message: `${path} must be supplied explicitly` })
    return undefined
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    issues.push({ path, message: `${path} must be a finite non-negative number` })
    return undefined
  }
  return parsed
}
