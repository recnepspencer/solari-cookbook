import { GoogleGenAI } from "@google/genai"
import type { JsonSchema } from "@interface-compiler/domain"

export interface GeminiUsageMetadata {
  readonly promptTokenCount?: number
  readonly candidatesTokenCount?: number
  readonly thoughtsTokenCount?: number
}

export interface GeminiGenerateRequest {
  readonly model: string
  readonly prompt: string
  readonly responseJsonSchema: JsonSchema
  readonly abortSignal: AbortSignal
}

export type GeminiTransportResult =
  | { readonly kind: "completed"; readonly text: string; readonly usage: GeminiUsageMetadata }
  | { readonly kind: "cancelled"; readonly usage?: GeminiUsageMetadata }
  | { readonly kind: "timed_out"; readonly usage?: GeminiUsageMetadata }
  | {
      readonly kind: "failed"
      readonly message: string
      readonly retryable: boolean
      readonly usage?: GeminiUsageMetadata
    }

/** The only provider-specific seam used by the domain-neutral reasoning adapter. */
export interface GeminiTransport {
  generateStructured(request: GeminiGenerateRequest): Promise<GeminiTransportResult>
}

/**
 * Production transport for the maintained Google GenAI SDK.
 * It performs no request until generateStructured is called.
 */
export class GoogleGenAiTransport implements GeminiTransport {
  public constructor(private readonly client: GoogleGenAI) {}

  public async generateStructured(request: GeminiGenerateRequest): Promise<GeminiTransportResult> {
    try {
      const response = await this.client.models.generateContent({
        model: request.model,
        contents: request.prompt,
        config: {
          responseMimeType: "application/json",
          responseJsonSchema: request.responseJsonSchema,
          abortSignal: request.abortSignal,
        },
      })

      const thoughtsTokenCount = response.usageMetadata?.thoughtsTokenCount
      return {
        kind: "completed",
        text: response.text ?? "",
        usage: {
          promptTokenCount: response.usageMetadata?.promptTokenCount,
          candidatesTokenCount: response.usageMetadata?.candidatesTokenCount,
          ...(thoughtsTokenCount === undefined ? {} : { thoughtsTokenCount }),
        },
      }
    } catch (error: unknown) {
      if (request.abortSignal.aborted) {
        return request.abortSignal.reason === "timed_out"
          ? { kind: "timed_out" }
          : { kind: "cancelled" }
      }

      return {
        kind: "failed",
        message: "Gemini API request failed",
        retryable: isRetryableProviderError(error),
      }
    }
  }
}

function isRetryableProviderError(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false
  const status = (error as { readonly status?: unknown }).status
  return typeof status === "number" && (status === 408 || status === 429 || status >= 500)
}
