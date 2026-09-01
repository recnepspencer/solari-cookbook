import type { Schema } from "./schema.js"
import type { OperationContext } from "./operation-context.js"

export interface ReasoningUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly estimatedModelCostUsd: number
}

export interface ReasoningCompletion<TOutput> {
  readonly output: TOutput
  readonly usage: ReasoningUsage
}

export type ReasoningResult<TOutput> =
  | { readonly kind: "completed"; readonly completion: ReasoningCompletion<TOutput> }
  | { readonly kind: "denied"; readonly reason: "schema_not_supported" | "budget_exhausted" }
  | { readonly kind: "cancelled"; readonly usage?: ReasoningUsage }
  | { readonly kind: "timed_out"; readonly usage?: ReasoningUsage }
  | { readonly kind: "failed"; readonly message: string; readonly retryable: boolean; readonly usage?: ReasoningUsage }

/** Provider-neutral structured reasoning seam; Gemini belongs behind an adapter. */
export interface ReasoningModel {
  structuredComplete<TInput, TOutput>(input: TInput, schema: Schema<TOutput>, context: OperationContext): Promise<ReasoningResult<TOutput>>
}
