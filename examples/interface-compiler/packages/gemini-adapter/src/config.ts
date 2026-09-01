import { GoogleGenAI } from "@google/genai"
import { calculateModelCostUsd, type Clock, type ModelPricingUsdPerToken, type ValidationIssue } from "@interface-compiler/domain"
import { GeminiReasoningModel } from "./model.js"
import { GoogleGenAiTransport } from "./transport.js"
import { systemClock } from "./clock.js"

export interface GeminiEnvironment {
  readonly GEMINI_API_KEY?: string
  readonly GEMINI_MODEL?: string
}

export type GeminiEnvironmentStatus =
  | { readonly kind: "configured"; readonly model: string }
  | { readonly kind: "missing_api_key" }
  | { readonly kind: "missing_model" }

export type GeminiModelCreationResult =
  | { readonly kind: "created"; readonly model: GeminiReasoningModel }
  | { readonly kind: "invalid_configuration"; readonly issues: readonly ValidationIssue[] }
  | { readonly kind: "missing_api_key" }
  | { readonly kind: "missing_model" }

export interface CreateGeminiModelInput {
  readonly pricing: ModelPricingUsdPerToken
  readonly model?: string
  readonly clock?: Clock
}

export function inspectGeminiEnvironment(environment: GeminiEnvironment = process.env, requestedModel?: string): GeminiEnvironmentStatus {
  const apiKey = environmentText(environment.GEMINI_API_KEY)
  if (apiKey === undefined || apiKey.length === 0) return { kind: "missing_api_key" }
  const model = environmentText(requestedModel) || environmentText(environment.GEMINI_MODEL)
  return model === undefined || model.length === 0 ? { kind: "missing_model" } : { kind: "configured", model }
}

/** Creates a real SDK-backed adapter without accepting credentials as a code/config argument. */
export function createGeminiReasoningModelFromEnvironment(input: CreateGeminiModelInput): GeminiModelCreationResult {
  const environment = process.env
  const status = inspectGeminiEnvironment(environment, input.model)
  if (status.kind !== "configured") return status
  const apiKey = environmentText(environment.GEMINI_API_KEY)
  if (apiKey === undefined || apiKey.length === 0) return { kind: "missing_api_key" }

  const pricingIssues = calculateModelCostUsd({ inputTokens: 0, outputTokens: 0 }, input.pricing)
  if (!pricingIssues.ok) return { kind: "invalid_configuration", issues: pricingIssues.issues }

  const client = new GoogleGenAI({ apiKey })
  return {
    kind: "created",
    model: new GeminiReasoningModel({
      model: status.model,
      pricing: input.pricing,
      transport: new GoogleGenAiTransport(client),
      clock: input.clock ?? systemClock,
    }),
  }
}

function environmentText(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined
}
