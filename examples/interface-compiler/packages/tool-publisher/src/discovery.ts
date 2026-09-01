import type { CapabilityId, OperationContext, PartialEffectPosture, ValidationIssue } from "@interface-compiler/domain"
import { validateOperationContext } from "@interface-compiler/domain"
import { buildToolPublicationArtifact, consumerToolDefinition, type ArtifactRejection, type GeminiToolDefinition, type ToolPublicationArtifact } from "./artifact.js"
import { evaluatePublicationGate, type PublicationWithheldReason } from "./gating.js"
import type { PreparationRejection } from "./publication.js"
import { validateToolPublicationPolicy, type ToolPublicationPolicy } from "./policy.js"
import { createDiscoveryTelemetry, type DiscoveryTelemetry } from "./telemetry.js"
import type {
  WorthDiscoveryQueryResult,
  WorthPublicationQuery,
  WorthToolCapabilityProjection,
} from "./worth-query.js"
import { validateWorthDiscoveryQueryResult } from "./worth-query.js"

export interface ToolDiscoveryRequest {
  readonly context: OperationContext
  readonly observedAt: string
}

export type DiscoveryWithheldReason = PublicationWithheldReason | "artifact_rejected" | "duplicate_capability" | "duplicate_tool_id"

export interface DiscoveryWithheldCapability {
  readonly capabilityId?: CapabilityId
  readonly reason: DiscoveryWithheldReason
  readonly worthReason?: "unauthorized" | "disclosure_not_allowed" | "capability_not_admitted"
  readonly artifactReasons?: readonly ArtifactRejection[]
}

export type ToolDiscoveryResult =
  | {
      readonly kind: "discovered"
      readonly tools: readonly GeminiToolDefinition[]
      readonly withheld: readonly DiscoveryWithheldCapability[]
      readonly telemetry: DiscoveryTelemetry
    }
  | { readonly kind: "rejected"; readonly issues: readonly PreparationRejection[] }
  | {
      readonly kind: "unavailable"
      readonly reason: "cancelled" | "timed_out" | "failed"
      readonly telemetry: DiscoveryTelemetry
      readonly operationId?: string
      readonly message?: string
      readonly retryable?: boolean
      readonly posture?: PartialEffectPosture
    }

export async function discoverCompiledCapabilities(
  query: WorthPublicationQuery,
  policy: ToolPublicationPolicy,
  request: ToolDiscoveryRequest,
): Promise<ToolDiscoveryResult> {
  const validation = validateDiscoveryRequest(policy, request)
  if (validation.rejections.length > 0) return { kind: "rejected", issues: validation.rejections }
  if (request.context.cancellation.isCancellationRequested()) return unavailableDiscovery(request, "cancelled", { kind: "not_started" })

  let queryResult: WorthDiscoveryQueryResult
  try {
    queryResult = await query.discoverCapabilitiesForTools(request.context)
  } catch (error) {
    return unavailableDiscovery(request, "failed", undefined, discoveryErrorMessage(error), false)
  }
  if (!isRecord(queryResult)) return unavailableDiscovery(request, "failed", undefined, "Worth query returned an invalid result", false)
  const queryIssues = validateWorthDiscoveryQueryResult(queryResult)
  if (queryIssues.length > 0) return unavailableDiscovery(request, "failed", undefined, "Worth discovery returned an invalid result", false)
  if (queryResult.kind !== "found") return unavailableDiscoveryFromWorthResult(queryResult, request)
  if (!Array.isArray(queryResult.projections)) return unavailableDiscovery(request, "failed", undefined, "Worth discovery returned invalid projections", false)

  const withheld: DiscoveryWithheldCapability[] = []
  const capabilityCounts = countCapabilityIds(queryResult.projections)
  const eligible: EligibleDiscoveryArtifact[] = []
  for (const projection of queryResult.projections) {
    const capabilityId = knownCapabilityId(projection)
    if (capabilityId !== undefined && (capabilityCounts.get(capabilityId) ?? 0) > 1) {
      withheld.push({ capabilityId, reason: "duplicate_capability" })
      continue
    }

    const gate = evaluatePublicationGate(projection, policy)
    if (gate.kind === "withheld") {
      withheld.push({ capabilityId, reason: gate.reason, worthReason: gate.worthReason })
      continue
    }
    const artifactResult = buildToolPublicationArtifact(gate.projection, policy, [])
    if (artifactResult.kind === "rejected") {
      withheld.push({ capabilityId, reason: "artifact_rejected", artifactReasons: artifactResult.reasons })
      continue
    }
    eligible.push({ capabilityId, artifact: artifactResult.artifact })
  }

  const toolIdCounts = new Map<string, number>()
  for (const candidate of eligible) toolIdCounts.set(candidate.artifact.identity.toolId, (toolIdCounts.get(candidate.artifact.identity.toolId) ?? 0) + 1)
  const tools: GeminiToolDefinition[] = []
  for (const candidate of eligible) {
    if ((toolIdCounts.get(candidate.artifact.identity.toolId) ?? 0) > 1) {
      withheld.push({ capabilityId: candidate.capabilityId, reason: "duplicate_tool_id" })
      continue
    }
    tools.push(consumerToolDefinition(candidate.artifact))
  }

  return {
    kind: "discovered",
    tools: Object.freeze(tools),
    withheld: Object.freeze(withheld),
    telemetry: createDiscoveryTelemetry({
      operationId: request.context.operationId,
      observedAt: request.observedAt,
      outcome: "discovered",
      candidates: queryResult.projections.length,
      available: tools.length,
      withheld: withheld.length,
    }),
  }
}

interface EligibleDiscoveryArtifact {
  readonly capabilityId?: CapabilityId
  readonly artifact: ToolPublicationArtifact
}

function countCapabilityIds(projections: readonly WorthToolCapabilityProjection[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const projection of projections) {
    const capabilityId = knownCapabilityId(projection)
    if (capabilityId !== undefined) counts.set(capabilityId, (counts.get(capabilityId) ?? 0) + 1)
  }
  return counts
}

function validateDiscoveryRequest(
  policy: ToolPublicationPolicy,
  request: ToolDiscoveryRequest,
): { readonly rejections: readonly PreparationRejection[] } {
  const policyIssues = validateToolPublicationPolicy(policy)
  if (policyIssues.length > 0) return { rejections: [{ kind: "invalid_policy", issues: policyIssues }] }
  const issues = validateDiscoveryRequestFields(request)
  return { rejections: issues.length === 0 ? [] : [{ kind: "invalid_request", issues }] }
}

function validateDiscoveryRequestFields(request: ToolDiscoveryRequest): ValidationIssue[] {
  if (!isRecord(request)) return [discoveryIssue("request", "discovery request must be an object")]
  const issues: ValidationIssue[] = [...validateOperationContext(request.context)]
  if (!isIsoTimestamp(request.observedAt)) issues.push(discoveryIssue("observedAt", "observedAt must be a timestamp"))
  return issues
}

function unavailableDiscovery(
  request: ToolDiscoveryRequest,
  reason: "cancelled" | "timed_out" | "failed",
  posture?: PartialEffectPosture,
  message?: string,
  retryable?: boolean,
  operationId?: string,
): ToolDiscoveryResult {
  const outcome = reason === "cancelled" ? "query_cancelled" : reason === "timed_out" ? "query_timed_out" : "query_failed"
  return {
    kind: "unavailable",
    reason,
    ...(posture === undefined ? {} : { posture }),
    ...(message === undefined ? {} : { message }),
    ...(retryable === undefined ? {} : { retryable }),
    ...(operationId === undefined ? {} : { operationId }),
    telemetry: createDiscoveryTelemetry({
      operationId: request.context.operationId,
      observedAt: request.observedAt,
      outcome,
      candidates: 0,
      available: 0,
      withheld: 0,
    }),
  }
}

function unavailableDiscoveryFromWorthResult(
  result: Exclude<WorthDiscoveryQueryResult, { readonly kind: "found" }>,
  request: ToolDiscoveryRequest,
): ToolDiscoveryResult {
  switch (result.kind) {
    case "cancelled": return unavailableDiscovery(request, "cancelled", result.posture, undefined, undefined, result.operationId)
    case "timed_out": return unavailableDiscovery(request, "timed_out", result.posture, undefined, undefined, result.operationId)
    case "failed": return unavailableDiscovery(request, "failed", undefined, result.message, result.retryable)
    default: return unavailableDiscovery(request, "failed", undefined, "Worth discovery returned an invalid result", false)
  }
}

function knownCapabilityId(projection: WorthToolCapabilityProjection): CapabilityId | undefined {
  return isNonEmptyText(projection.capabilityId) ? projection.capabilityId : undefined
}

function discoveryErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : "discovery boundary operation failed"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
}

function discoveryIssue(path: string, message: string): ValidationIssue {
  return { path, message }
}
