import type { OperationContext, PartialEffectPosture } from "@interface-compiler/domain"
import type { GeminiToolDefinition } from "./artifact.js"
import type { ToolPublicationIdentity } from "./identity.js"

export type ToolPublicationDeliveryResult =
  | { readonly kind: "accepted"; readonly publishedVersion: number }
  | { readonly kind: "already_current"; readonly currentVersion: number }
  | { readonly kind: "conflict"; readonly currentVersion: number }
  | { readonly kind: "cancelled"; readonly posture: PartialEffectPosture }
  | { readonly kind: "timed_out"; readonly posture: PartialEffectPosture }
  | { readonly kind: "failed"; readonly message: string; readonly retryable: boolean; readonly posture: PartialEffectPosture }

/**
 * An immutable Worth-bound publication envelope. Identity is for provider
 * version ordering; only `definition` may cross the final Gemini boundary.
 */
export interface ToolPublicationEnvelope {
  readonly identity: ToolPublicationIdentity
  readonly definition: GeminiToolDefinition
}

/** A downstream provider seam. It receives no lifecycle authority of its own. */
export interface ToolPublicationSink {
  publish(envelope: ToolPublicationEnvelope, context: OperationContext): Promise<ToolPublicationDeliveryResult>
}
