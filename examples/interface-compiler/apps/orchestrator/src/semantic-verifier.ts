import type { Condition, EvidenceId, JsonValue, Observation, OperationContext, PartialEffectPosture, ReasoningUsage } from "@interface-compiler/domain"

export interface SemanticVerificationRequest {
  readonly conditions: readonly Condition[]
  readonly observation?: Observation
  readonly output?: JsonValue
}

export type SemanticVerificationResult =
  | { readonly kind: "verified"; readonly output?: JsonValue; readonly usage?: ReasoningUsage; readonly effect: PartialEffectPosture }
  | { readonly kind: "failed"; readonly condition: Condition; readonly message: string; readonly retryable: boolean; readonly evidenceIds: readonly EvidenceId[]; readonly usage?: ReasoningUsage; readonly effect: PartialEffectPosture }
  | { readonly kind: "cancelled"; readonly effect: PartialEffectPosture; readonly usage?: ReasoningUsage }
  | { readonly kind: "timed_out"; readonly effect: PartialEffectPosture; readonly usage?: ReasoningUsage }

/** Adapter seam for semantic postcondition checks owned by Worth or its delegated verifier. */
export interface SemanticVerifier {
  verify(request: SemanticVerificationRequest, context: OperationContext): Promise<SemanticVerificationResult>
}
