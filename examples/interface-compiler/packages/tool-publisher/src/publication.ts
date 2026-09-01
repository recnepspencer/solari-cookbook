import type {
  CapabilityId,
  OperationContext,
  PartialEffectPosture,
  ValidationIssue,
} from "@interface-compiler/domain"
import { validateOperationContext } from "@interface-compiler/domain"
import { buildToolPublicationArtifact, consumerToolDefinition, type ArtifactRejection, type ToolPublicationArtifact } from "./artifact.js"
import { evaluatePublicationGate, type PublicationWithheldReason } from "./gating.js"
import { validateToolPublicationPolicy, type ToolPublicationPolicy } from "./policy.js"
import { createPublicationTelemetry, sourceTelemetry, type PublicationTelemetry } from "./telemetry.js"
import type { ToolExample } from "./metadata.js"
import type { ToolPublicationDeliveryResult, ToolPublicationEnvelope, ToolPublicationSink } from "./publication-port.js"
import { validateWorthPublicationQueryResult, type WorthPublicationQuery, type WorthPublicationQueryResult } from "./worth-query.js"

export interface ToolPublicationRequest {
  readonly capabilityId: CapabilityId
  readonly examples: readonly ToolExample[]
  readonly context: OperationContext
  readonly observedAt: string
}

export type PublicationPreparationWithheldReason = PublicationWithheldReason | "worth_query_denied"

export type ToolPreparationResult =
  | { readonly kind: "prepared"; readonly artifact: ToolPublicationArtifact; readonly telemetry: PublicationTelemetry }
  | {
      readonly kind: "withheld"
      readonly reason: PublicationPreparationWithheldReason
      readonly telemetry: PublicationTelemetry
      readonly worthReason?: "unauthorized" | "disclosure_not_allowed" | "capability_not_admitted"
    }
  | { readonly kind: "rejected"; readonly reasons: readonly PreparationRejection[]; readonly telemetry?: PublicationTelemetry }
  | {
      readonly kind: "unavailable"
      readonly reason: "not_found" | "stale" | "cancelled" | "timed_out" | "failed"
      readonly telemetry: PublicationTelemetry
      readonly expectedRevision?: number
      readonly actualRevision?: number
      readonly operationId?: string
      readonly message?: string
      readonly retryable?: boolean
      readonly posture?: PartialEffectPosture
    }

export type PreparationRejection =
  | ArtifactRejection
  | { readonly kind: "invalid_request"; readonly issues: readonly ValidationIssue[] }
  | { readonly kind: "invalid_policy"; readonly issues: readonly ValidationIssue[] }
  | { readonly kind: "invalid_worth_result"; readonly issues: readonly ValidationIssue[] }

export type ToolPublicationResult =
  | Exclude<ToolPreparationResult, { readonly kind: "prepared" }>
  | { readonly kind: "published"; readonly artifact: ToolPublicationArtifact; readonly publishedVersion: number; readonly telemetry: PublicationTelemetry }
  | { readonly kind: "already_current"; readonly artifact: ToolPublicationArtifact; readonly currentVersion: number; readonly telemetry: PublicationTelemetry }
  | { readonly kind: "conflict"; readonly artifact: ToolPublicationArtifact; readonly currentVersion: number; readonly telemetry: PublicationTelemetry }
  | {
      readonly kind: "delivery_cancelled" | "delivery_timed_out"
      readonly artifact: ToolPublicationArtifact
      readonly posture: PartialEffectPosture
      readonly telemetry: PublicationTelemetry
    }
  | {
      readonly kind: "delivery_failed"
      readonly artifact: ToolPublicationArtifact
      readonly message: string
      readonly retryable: boolean
      readonly posture: PartialEffectPosture
      readonly telemetry: PublicationTelemetry
    }

export async function prepareCompiledCapability(
  query: WorthPublicationQuery,
  policy: ToolPublicationPolicy,
  request: ToolPublicationRequest,
): Promise<ToolPreparationResult> {
  const validation = validatePublicationRequest(policy, request)
  if (validation.rejections.length > 0) return { kind: "rejected", reasons: validation.rejections }
  if (request.context.cancellation.isCancellationRequested()) {
    return unavailablePublication(request, "cancelled", { kind: "not_started" })
  }

  let queryResult: WorthPublicationQueryResult
  try {
    queryResult = await query.readCapabilityForTool(request.capabilityId, request.context)
  } catch (error) {
    return unavailablePublication(request, "failed", undefined, errorMessage(error), false)
  }
  if (!isRecord(queryResult)) return unavailablePublication(request, "failed", undefined, "Worth query returned an invalid result", false)
  if (request.context.cancellation.isCancellationRequested()) return unavailablePublication(request, "cancelled", { kind: "not_started" })
  const queryIssues = validateWorthPublicationQueryResult(queryResult, request.capabilityId)
  if (queryIssues.length > 0) return invalidWorthResult(request, queryIssues)
  return prepareFromWorthResult(queryResult, policy, request)
}

export async function publishCompiledCapability(
  query: WorthPublicationQuery,
  sink: ToolPublicationSink,
  policy: ToolPublicationPolicy,
  request: ToolPublicationRequest,
): Promise<ToolPublicationResult> {
  const preparation = await prepareCompiledCapability(query, policy, request)
  if (preparation.kind !== "prepared") return preparation
  if (request.context.cancellation.isCancellationRequested()) return cancelledBeforeDelivery(preparation.artifact, request)

  let delivery: ToolPublicationDeliveryResult
  try {
    delivery = await sink.publish(createPublicationEnvelope(preparation.artifact), request.context)
  } catch (error) {
    return deliveryFailure(preparation.artifact, request, errorMessage(error), false, unknownPosture())
  }
  if (!isValidDeliveryResult(delivery)) return deliveryFailure(preparation.artifact, request, "publication sink returned an invalid result", false, unknownPosture())
  return publicationFromDelivery(preparation.artifact, request, delivery)
}

function prepareFromWorthResult(
  result: WorthPublicationQueryResult,
  policy: ToolPublicationPolicy,
  request: ToolPublicationRequest,
): ToolPreparationResult {
  switch (result.kind) {
    case "found": {
      const gate = evaluatePublicationGate(result.projection, policy)
      if (gate.kind === "withheld") {
        return {
          kind: "withheld",
          reason: gate.reason,
          worthReason: gate.worthReason,
          telemetry: createPublicationTelemetry({
            operationId: request.context.operationId,
            observedAt: request.observedAt,
            capabilityId: request.capabilityId,
            outcome: "withheld",
            stage: "gate",
          }),
        }
      }
      const artifactResult = buildToolPublicationArtifact(gate.projection, policy, request.examples)
      if (artifactResult.kind === "rejected") {
        return {
          kind: "rejected",
          reasons: artifactResult.reasons,
          telemetry: createPublicationTelemetry({
            operationId: request.context.operationId,
            observedAt: request.observedAt,
            capabilityId: request.capabilityId,
            outcome: "rejected",
            stage: "artifact",
          }),
        }
      }
      return {
        kind: "prepared",
        artifact: artifactResult.artifact,
        telemetry: createPublicationTelemetry({
          operationId: request.context.operationId,
          observedAt: request.observedAt,
          capabilityId: request.capabilityId,
          outcome: "prepared",
          stage: "artifact",
          source: sourceTelemetry(artifactResult.artifact),
          exampleCount: artifactResult.artifact.definition.examples.length,
        }),
      }
    }
    case "denied":
      return {
        kind: "withheld",
        reason: "worth_query_denied",
        worthReason: result.reason,
        telemetry: createPublicationTelemetry({
          operationId: request.context.operationId,
          observedAt: request.observedAt,
          capabilityId: request.capabilityId,
          outcome: "withheld",
          stage: "worth_query",
        }),
      }
    case "not_found":
      return unavailablePublication(request, "not_found")
    case "stale":
      return unavailablePublication(request, "stale", undefined, undefined, undefined, result.expectedRevision, result.actualRevision)
    case "cancelled":
      return unavailablePublication(request, "cancelled", result.posture, undefined, undefined, undefined, undefined, result.operationId)
    case "timed_out":
      return unavailablePublication(request, "timed_out", result.posture, undefined, undefined, undefined, undefined, result.operationId)
    case "failed":
      return unavailablePublication(request, "failed", undefined, result.message, result.retryable)
    default:
      return unavailablePublication(request, "failed", undefined, "Worth query returned an invalid result", false)
  }
}

function publicationFromDelivery(
  artifact: ToolPublicationArtifact,
  request: ToolPublicationRequest,
  delivery: ToolPublicationDeliveryResult,
): ToolPublicationResult {
  const shared = {
    operationId: request.context.operationId,
    observedAt: request.observedAt,
    capabilityId: request.capabilityId,
    stage: "delivery" as const,
    source: sourceTelemetry(artifact),
    exampleCount: artifact.definition.examples.length,
  }
  switch (delivery.kind) {
    case "accepted":
      return { kind: "published", artifact, publishedVersion: delivery.publishedVersion, telemetry: createPublicationTelemetry({ ...shared, outcome: "published" }) }
    case "already_current":
      return { kind: "already_current", artifact, currentVersion: delivery.currentVersion, telemetry: createPublicationTelemetry({ ...shared, outcome: "already_current" }) }
    case "conflict":
      return { kind: "conflict", artifact, currentVersion: delivery.currentVersion, telemetry: createPublicationTelemetry({ ...shared, outcome: "delivery_conflict" }) }
    case "cancelled":
      return { kind: "delivery_cancelled", artifact, posture: delivery.posture, telemetry: createPublicationTelemetry({ ...shared, outcome: "delivery_cancelled" }) }
    case "timed_out":
      return { kind: "delivery_timed_out", artifact, posture: delivery.posture, telemetry: createPublicationTelemetry({ ...shared, outcome: "delivery_timed_out" }) }
    case "failed":
      return {
        kind: "delivery_failed",
        artifact,
        message: delivery.message,
        retryable: delivery.retryable,
        posture: delivery.posture,
        telemetry: createPublicationTelemetry({ ...shared, outcome: "delivery_failed" }),
      }
  }
}

function deliveryFailure(
  artifact: ToolPublicationArtifact,
  request: ToolPublicationRequest,
  message: string,
  retryable: boolean,
  posture: PartialEffectPosture,
): ToolPublicationResult {
  return {
    kind: "delivery_failed",
    artifact,
    message,
    retryable,
    posture,
    telemetry: createPublicationTelemetry({
      operationId: request.context.operationId,
      observedAt: request.observedAt,
      capabilityId: request.capabilityId,
      outcome: "delivery_failed",
      stage: "delivery",
      source: sourceTelemetry(artifact),
      exampleCount: artifact.definition.examples.length,
    }),
  }
}

function createPublicationEnvelope(artifact: ToolPublicationArtifact): ToolPublicationEnvelope {
  return Object.freeze({
    identity: artifact.identity,
    definition: consumerToolDefinition(artifact),
  })
}

function cancelledBeforeDelivery(artifact: ToolPublicationArtifact, request: ToolPublicationRequest): ToolPublicationResult {
  return {
    kind: "delivery_cancelled",
    artifact,
    posture: { kind: "not_started" },
    telemetry: createPublicationTelemetry({
      operationId: request.context.operationId,
      observedAt: request.observedAt,
      capabilityId: request.capabilityId,
      outcome: "delivery_cancelled",
      stage: "delivery",
      source: sourceTelemetry(artifact),
      exampleCount: artifact.definition.examples.length,
    }),
  }
}

function invalidWorthResult(request: ToolPublicationRequest, issues: readonly ValidationIssue[]): ToolPreparationResult {
  return {
    kind: "rejected",
    reasons: [{ kind: "invalid_worth_result", issues }],
    telemetry: createPublicationTelemetry({
      operationId: request.context.operationId,
      observedAt: request.observedAt,
      capabilityId: request.capabilityId,
      outcome: "rejected",
      stage: "worth_query",
    }),
  }
}

function isValidDeliveryResult(value: unknown): value is ToolPublicationDeliveryResult {
  if (!isRecord(value)) return false
  if (value.kind === "accepted") return isNonNegativeInteger(value.publishedVersion) && value.publishedVersion > 0
  if (value.kind === "already_current" || value.kind === "conflict") return isNonNegativeInteger(value.currentVersion) && value.currentVersion > 0
  if (value.kind === "cancelled" || value.kind === "timed_out") return isValidPartialEffectPosture(value.posture)
  return value.kind === "failed" && isNonEmptyText(value.message) && typeof value.retryable === "boolean" && isValidPartialEffectPosture(value.posture)
}

function isValidPartialEffectPosture(value: unknown): value is PartialEffectPosture {
  if (!isRecord(value)) return false
  if (value.kind === "not_started" || value.kind === "completed") return Object.keys(value).length === 1
  return value.kind === "unknown" && value.recovery === "owner_reconciliation_required" && Object.keys(value).length === 2
}

function validatePublicationRequest(
  policy: ToolPublicationPolicy,
  request: ToolPublicationRequest,
): { readonly rejections: readonly PreparationRejection[] } {
  const policyIssues = validateToolPublicationPolicy(policy)
  if (policyIssues.length > 0) return { rejections: [{ kind: "invalid_policy", issues: policyIssues }] }
  const issues = validateRequestFields(request)
  return { rejections: issues.length === 0 ? [] : [{ kind: "invalid_request", issues }] }
}

function validateRequestFields(request: ToolPublicationRequest): ValidationIssue[] {
  if (!isRecord(request)) return [publicationIssue("request", "publication request must be an object")]
  const issues: ValidationIssue[] = []
  if (!isNonEmptyText(request.capabilityId) || !Array.isArray(request.examples)) {
    issues.push(publicationIssue("request", "capability id and examples are required"))
  }
  if (Array.isArray(request.examples) && request.examples.some((example) => !isRecord(example))) {
    issues.push(publicationIssue("examples", "examples must contain objects"))
  }
  issues.push(...validateOperationContext(request.context))
  if (!isIsoTimestamp(request.observedAt)) issues.push(publicationIssue("observedAt", "observedAt must be a timestamp"))
  return issues
}

function unavailablePublication(
  request: ToolPublicationRequest,
  reason: "not_found" | "stale" | "cancelled" | "timed_out" | "failed",
  posture?: PartialEffectPosture,
  message?: string,
  retryable?: boolean,
  expectedRevision?: number,
  actualRevision?: number,
  operationId?: string,
): ToolPreparationResult {
  return {
    kind: "unavailable",
    reason,
    ...(posture === undefined ? {} : { posture }),
    ...(message === undefined ? {} : { message }),
    ...(retryable === undefined ? {} : { retryable }),
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
    ...(actualRevision === undefined ? {} : { actualRevision }),
    ...(operationId === undefined ? {} : { operationId }),
    telemetry: createPublicationTelemetry({
      operationId: request.context.operationId,
      observedAt: request.observedAt,
      capabilityId: request.capabilityId,
      outcome: "query_unavailable",
      stage: "worth_query",
    }),
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : "publication boundary operation failed"
}

function unknownPosture(): { readonly kind: "unknown"; readonly recovery: "owner_reconciliation_required" } {
  return { kind: "unknown", recovery: "owner_reconciliation_required" }
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

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
}

function publicationIssue(path: string, message: string): ValidationIssue {
  return { path, message }
}
