import type { ApplicationId, CapabilityId, ValidationIssue, ValidationResult } from "@interface-compiler/domain"

export const DEFAULT_FORBIDDEN_METADATA_TERMS = Object.freeze([
  "selector",
  "xpath",
  "playwright",
  "dom",
  "css",
  "locator",
  "replay",
  "screenshot",
  "snapshot",
  "solari",
  "password",
  "credential",
  "secret",
  "api_key",
  "token",
  "card_number",
  "cvv",
  "bank_account",
  "shipping_address",
  "identity",
  "personal_information",
  "personal_info",
  "email",
  "phone",
  "shipping",
  "address",
  "payment",
  "order",
  "transaction",
  "account",
  "username",
  "user_id",
  "session_id",
]) as readonly string[]

export type PublicationScope<TId extends string> =
  | { readonly kind: "all" }
  | { readonly kind: "allowlist"; readonly ids: readonly TId[] }

export interface ToolPublicationPolicy {
  readonly namespace: string
  readonly audience: "gemini_consumer"
  readonly applicationScope: PublicationScope<ApplicationId>
  readonly capabilityScope: PublicationScope<CapabilityId>
  readonly maxDescriptionLength: number
  readonly maxExamples: number
  readonly additionalForbiddenTerms: readonly string[]
}

export function createToolPublicationPolicy(input: ToolPublicationPolicy): ValidationResult<ToolPublicationPolicy> {
  const issues = validateToolPublicationPolicy(input)
  if (issues.length > 0) return { ok: false, issues: Object.freeze(issues) }
  return { ok: true, value: Object.freeze({
    namespace: input.namespace.trim().toLowerCase(),
    audience: "gemini_consumer",
    applicationScope: copyScope(input.applicationScope),
    capabilityScope: copyScope(input.capabilityScope),
    maxDescriptionLength: input.maxDescriptionLength,
    maxExamples: input.maxExamples,
    additionalForbiddenTerms: Object.freeze(input.additionalForbiddenTerms.map((term) => term.trim().toLowerCase())),
  }) }
}

export function validateToolPublicationPolicy(input: ToolPublicationPolicy): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!isRecord(input)) return [policyIssue("policy", "publication policy must be an object")]
  if (!isNonEmptyText(input.namespace) || !/^[a-z][a-z0-9_]*$/.test(input.namespace.trim().toLowerCase())) issues.push(policyIssue("namespace", "namespace must be a safe lowercase segment"))
  if (input.audience !== "gemini_consumer") issues.push(policyIssue("audience", "only the Gemini consumer audience is supported"))
  issues.push(...validateScope(input.applicationScope, "applicationScope"))
  issues.push(...validateScope(input.capabilityScope, "capabilityScope"))
  if (!isNonNegativeInteger(input.maxDescriptionLength) || input.maxDescriptionLength < 1) issues.push(policyIssue("maxDescriptionLength", "description limit must be a positive safe integer"))
  if (!isNonNegativeInteger(input.maxExamples)) issues.push(policyIssue("maxExamples", "example limit must be a non-negative safe integer"))
  if (!Array.isArray(input.additionalForbiddenTerms) || input.additionalForbiddenTerms.some((term) => !isNonEmptyText(term))) {
    issues.push(policyIssue("additionalForbiddenTerms", "additional forbidden terms must be non-empty strings"))
  } else if (new Set(input.additionalForbiddenTerms.map((term) => term.trim().toLowerCase())).size !== input.additionalForbiddenTerms.length) {
    issues.push(policyIssue("additionalForbiddenTerms", "additional forbidden terms must be distinct"))
  }
  return issues
}

export type PublicationPolicyDecision =
  | { readonly kind: "allowed" }
  | { readonly kind: "denied"; readonly reason: "application_not_allowed" | "capability_not_allowed"; readonly policyPath: "applicationScope" | "capabilityScope" }

export function evaluatePublicationPolicy(policy: ToolPublicationPolicy, applicationId: ApplicationId, capabilityId: CapabilityId): PublicationPolicyDecision {
  if (!scopeAllows(policy.applicationScope, applicationId)) return { kind: "denied", reason: "application_not_allowed", policyPath: "applicationScope" }
  if (!scopeAllows(policy.capabilityScope, capabilityId)) return { kind: "denied", reason: "capability_not_allowed", policyPath: "capabilityScope" }
  return { kind: "allowed" }
}

export function allForbiddenMetadataTerms(policy: ToolPublicationPolicy): readonly string[] {
  const additionalTerms = Array.isArray(policy.additionalForbiddenTerms)
    ? policy.additionalForbiddenTerms.filter(isNonEmptyText).map((term) => term.trim().toLowerCase())
    : []
  return Object.freeze([...DEFAULT_FORBIDDEN_METADATA_TERMS, ...additionalTerms])
}

function validateScope(scope: unknown, path: string): ValidationIssue[] {
  if (!isRecord(scope)) return [policyIssue(path, "publication scope must be an object")]
  if (scope.kind === "all") return []
  if (scope.kind !== "allowlist" || !Array.isArray(scope.ids) || scope.ids.length === 0 || scope.ids.some((id) => !isNonEmptyText(id))) return [policyIssue(path, "allowlist scope must contain at least one non-empty id")]
  if (new Set(scope.ids).size !== scope.ids.length) return [policyIssue(path, "allowlist ids must be distinct")]
  return []
}

function scopeAllows<TId extends string>(scope: PublicationScope<TId>, id: TId): boolean {
  return scope.kind === "all" || scope.ids.includes(id)
}

function copyScope<TId extends string>(scope: PublicationScope<TId>): PublicationScope<TId> {
  return scope.kind === "all" ? { kind: "all" } : { kind: "allowlist", ids: Object.freeze([...scope.ids]) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isSafeInteger(value) && value >= 0
}

function policyIssue(path: string, message: string): ValidationIssue {
  return { path, message }
}
