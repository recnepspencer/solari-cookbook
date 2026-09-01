import type { ValidationIssue } from "@interface-compiler/domain"
import { evaluatePublicationPolicy, validateToolPublicationPolicy, type ToolPublicationPolicy } from "./policy.js"
import { validateWorthToolCapabilityProjection, type WorthPublicationAuthorization, type WorthToolCapabilityProjection } from "./worth-query.js"

export type PublicationWithheldReason =
  | "invalid_worth_projection"
  | "invalid_publication_policy"
  | "worth_unauthorized"
  | "disclosure_not_semantic"
  | "capability_not_healthy"
  | "active_replay_not_current"
  | "application_not_allowed"
  | "capability_not_allowed"

export type PublicationGateDecision =
  | { readonly kind: "eligible"; readonly projection: Extract<WorthToolCapabilityProjection, { status: "healthy" }> }
  | {
      readonly kind: "withheld"
      readonly reason: PublicationWithheldReason
      readonly issues?: readonly ValidationIssue[]
      readonly worthReason?: "unauthorized" | "disclosure_not_allowed" | "capability_not_admitted"
    }

export function evaluatePublicationGate(
  projection: WorthToolCapabilityProjection,
  policy: ToolPublicationPolicy,
): PublicationGateDecision {
  const policyIssues = validateToolPublicationPolicy(policy)
  if (policyIssues.length > 0) return withheld("invalid_publication_policy", policyIssues)
  const projectionIssues = validateWorthToolCapabilityProjection(projection)
  if (projectionIssues.length > 0) return withheld("invalid_worth_projection", projectionIssues)

  const authorization = projection.authorization
  if (authorization.kind === "denied") return withheld("worth_unauthorized", undefined, authorization.reason)
  if (!isSemanticGeminiAuthorization(authorization)) return withheld("disclosure_not_semantic")
  if (projection.status !== "healthy") return withheld("capability_not_healthy")
  if (projection.activeReplay.status !== "active") return withheld("active_replay_not_current")

  const policyDecision = evaluatePublicationPolicy(policy, projection.applicationId, projection.capabilityId)
  if (policyDecision.kind === "denied") return withheld(policyDecision.reason)
  return { kind: "eligible", projection }
}

function isSemanticGeminiAuthorization(value: WorthPublicationAuthorization): value is Extract<WorthPublicationAuthorization, { kind: "authorized" }> {
  return value.kind === "authorized" && value.audience === "gemini_consumer" && value.disclosure === "semantic_only"
}

function withheld(
  reason: PublicationWithheldReason,
  issues?: readonly ValidationIssue[],
  worthReason?: "unauthorized" | "disclosure_not_allowed" | "capability_not_admitted",
): PublicationGateDecision {
  return {
    kind: "withheld",
    reason,
    ...(issues === undefined ? {} : { issues }),
    ...(worthReason === undefined ? {} : { worthReason }),
  }
}
