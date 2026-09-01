import type { Schema } from "./schema.js"
import type { OperationContext, PartialEffectPosture } from "./operation-context.js"

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
  | { readonly kind: "completed"; readonly completion: ReasoningCompletion<TOutput>; readonly effect: { readonly kind: "completed" } }
  | { readonly kind: "denied"; readonly reason: "schema_not_supported" | "budget_exhausted" | "backpressure"; readonly effect: { readonly kind: "not_started" } }
  | { readonly kind: "cancelled"; readonly usage?: ReasoningUsage; readonly partialOutput?: unknown; readonly effect: PartialEffectPosture }
  | { readonly kind: "timed_out"; readonly usage?: ReasoningUsage; readonly partialOutput?: unknown; readonly effect: PartialEffectPosture }
  | { readonly kind: "failed"; readonly message: string; readonly retryable: boolean; readonly usage?: ReasoningUsage; readonly partialOutput?: unknown; readonly effect: PartialEffectPosture }

/** Provider-neutral structured reasoning seam; Gemini belongs behind an adapter. */
export interface ReasoningModel {
  structuredComplete<TInput, TOutput>(input: TInput, schema: Schema<TOutput>, context: OperationContext): Promise<ReasoningResult<TOutput>>
}
