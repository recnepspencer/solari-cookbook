import type { Condition, EvidenceId, JsonSchema, JsonValue, Observation, OperationContext, PartialEffectPosture, ReasoningUsage } from "@interface-compiler/domain"

export interface SemanticVerificationRequest {
  readonly phase?: "precondition" | "postcondition" | "candidate_verification"
  readonly conditions: readonly Condition[]
  readonly observation?: Observation
  readonly output?: JsonValue
  readonly input?: JsonValue
  readonly outputSchema?: JsonSchema
}

export type SemanticVerificationResult =
  | { readonly kind: "verified"; readonly output?: JsonValue; readonly usage?: ReasoningUsage; readonly effect: PartialEffectPosture }
  | { readonly kind: "failed"; readonly condition: Condition; readonly message: string; readonly retryable: boolean; readonly evidenceIds: readonly EvidenceId[]; readonly usage?: ReasoningUsage; readonly effect: PartialEffectPosture }
  | { readonly kind: "provider_failed"; readonly message: string; readonly retryable: boolean; readonly usage?: ReasoningUsage; readonly effect: PartialEffectPosture }
  | { readonly kind: "cancelled"; readonly effect: PartialEffectPosture; readonly usage?: ReasoningUsage }
  | { readonly kind: "timed_out"; readonly effect: PartialEffectPosture; readonly usage?: ReasoningUsage }

/** Adapter seam for semantic postcondition checks owned by Worth or its delegated verifier. */
export interface SemanticVerifier {
  /** Declares whether admission must reserve one model call before verification. */
  readonly modelUsage: "required" | "none"
  verify(request: SemanticVerificationRequest, context: OperationContext): Promise<SemanticVerificationResult>
}
