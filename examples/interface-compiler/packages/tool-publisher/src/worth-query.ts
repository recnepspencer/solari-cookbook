import type { ApplicationId, CapabilityId, OperationContext, OperationId, PartialEffectPosture, ReplayVersionId, JsonSchema, ValidationIssue } from "@interface-compiler/domain"
import { validateJsonSchema } from "@interface-compiler/domain"

export type WorthToolCapabilityState = "healthy" | "degraded" | "discovering" | "verifying"

export type WorthPublicationAuthorization =
  | { readonly kind: "authorized"; readonly audience: "gemini_consumer"; readonly disclosure: "semantic_only" }
  | { readonly kind: "denied"; readonly reason: "unauthorized" | "disclosure_not_allowed" | "capability_not_admitted" }

export interface WorthActiveReplayIdentity {
  readonly capabilityId: CapabilityId
  readonly replayVersionId: ReplayVersionId
  readonly version: number
  readonly revision: number
  readonly status: "active"
}

export interface WorthToolCapabilityProjectionCore {
  readonly projectionKind: "worth_tool_capability"
  readonly capabilityId: CapabilityId
  readonly applicationId: ApplicationId
  readonly revision: number
  readonly name: string
  readonly description: string
  readonly inputSchema: JsonSchema
  readonly outputSchema: JsonSchema
  readonly authorization: WorthPublicationAuthorization
}

export type WorthToolCapabilityProjection =
  | (WorthToolCapabilityProjectionCore & { readonly status: "healthy"; readonly activeReplay: WorthActiveReplayIdentity })
  | (WorthToolCapabilityProjectionCore & { readonly status: Exclude<WorthToolCapabilityState, "healthy">; readonly activeReplay?: undefined })

export type WorthPublicationQueryResult =
  | { readonly kind: "found"; readonly projection: WorthToolCapabilityProjection }
  | { readonly kind: "not_found"; readonly capabilityId: CapabilityId }
  | { readonly kind: "denied"; readonly capabilityId: CapabilityId; readonly reason: "unauthorized" | "disclosure_not_allowed" | "capability_not_admitted" }
  | { readonly kind: "stale"; readonly capabilityId: CapabilityId; readonly expectedRevision: number; readonly actualRevision: number }
  | { readonly kind: "cancelled"; readonly capabilityId: CapabilityId; readonly operationId: OperationId; readonly posture: PartialEffectPosture }
  | { readonly kind: "timed_out"; readonly capabilityId: CapabilityId; readonly operationId: OperationId; readonly posture: PartialEffectPosture }
  | { readonly kind: "failed"; readonly capabilityId: CapabilityId; readonly message: string; readonly retryable: boolean }

export type WorthDiscoveryQueryResult =
  | { readonly kind: "found"; readonly projections: readonly WorthToolCapabilityProjection[] }
  | { readonly kind: "cancelled"; readonly operationId: OperationId; readonly posture: PartialEffectPosture }
  | { readonly kind: "timed_out"; readonly operationId: OperationId; readonly posture: PartialEffectPosture }
  | { readonly kind: "failed"; readonly message: string; readonly retryable: boolean }

/**
 * Runtime authority contract for Worth Query. The publisher consumes its
 * immutable eligibility projection; it never stores or reconstructs Worth
 * lifecycle, health, verification, or lineage state.
 */
export interface WorthPublicationQuery {
  readCapabilityForTool(capabilityId: CapabilityId, context: OperationContext): Promise<WorthPublicationQueryResult>
  discoverCapabilitiesForTools(context: OperationContext): Promise<WorthDiscoveryQueryResult>
}

export function validateWorthPublicationQueryResult(
  value: unknown,
  requestedCapabilityId?: CapabilityId,
): readonly ValidationIssue[] {
  if (!isRecord(value)) return [projectionIssue("result", "Worth publication query result must be an object")]
  const issues: ValidationIssue[] = []
  switch (value.kind) {
    case "found":
      issues.push(...unexpectedProjectionKeys(value, ["kind", "projection"], "result"))
      issues.push(...validateWorthToolCapabilityProjection(value.projection))
      if (requestedCapabilityId !== undefined && isRecord(value.projection) && isNonEmptyText(value.projection.capabilityId) && value.projection.capabilityId !== requestedCapabilityId) {
        issues.push(projectionIssue("projection.capabilityId", "Worth returned a different capability than requested"))
      }
      break
    case "not_found":
      issues.push(...unexpectedProjectionKeys(value, ["kind", "capabilityId"], "result"))
      validateReturnedCapabilityId(value.capabilityId, requestedCapabilityId, issues)
      break
    case "denied":
      issues.push(...unexpectedProjectionKeys(value, ["kind", "capabilityId", "reason"], "result"))
      validateReturnedCapabilityId(value.capabilityId, requestedCapabilityId, issues)
      if (value.reason !== "unauthorized" && value.reason !== "disclosure_not_allowed" && value.reason !== "capability_not_admitted") issues.push(projectionIssue("reason", "Worth denial reason is not recognized"))
      break
    case "stale":
      issues.push(...unexpectedProjectionKeys(value, ["kind", "capabilityId", "expectedRevision", "actualRevision"], "result"))
      validateReturnedCapabilityId(value.capabilityId, requestedCapabilityId, issues)
      if (!isNonNegativeInteger(value.expectedRevision)) issues.push(projectionIssue("expectedRevision", "expected revision must be a non-negative safe integer"))
      if (!isNonNegativeInteger(value.actualRevision)) issues.push(projectionIssue("actualRevision", "actual revision must be a non-negative safe integer"))
      break
    case "cancelled":
    case "timed_out":
      issues.push(...unexpectedProjectionKeys(value, ["kind", "capabilityId", "operationId", "posture"], "result"))
      validateReturnedCapabilityId(value.capabilityId, requestedCapabilityId, issues)
      if (!isNonEmptyText(value.operationId)) issues.push(projectionIssue("operationId", "query operation id must not be empty"))
      issues.push(...validatePartialEffectPosture(value.posture, "posture"))
      break
    case "failed":
      issues.push(...unexpectedProjectionKeys(value, ["kind", "capabilityId", "message", "retryable"], "result"))
      validateReturnedCapabilityId(value.capabilityId, requestedCapabilityId, issues)
      if (!isNonEmptyText(value.message)) issues.push(projectionIssue("message", "Worth query failure message must not be empty"))
      if (typeof value.retryable !== "boolean") issues.push(projectionIssue("retryable", "Worth query retryability must be explicit"))
      break
    default:
      issues.push(projectionIssue("kind", "Worth publication query result kind is not recognized"))
  }
  return Object.freeze(issues)
}

export function validateWorthDiscoveryQueryResult(value: unknown): readonly ValidationIssue[] {
  if (!isRecord(value)) return [projectionIssue("result", "Worth discovery query result must be an object")]
  const issues: ValidationIssue[] = []
  switch (value.kind) {
    case "found":
      issues.push(...unexpectedProjectionKeys(value, ["kind", "projections"], "result"))
      if (!Array.isArray(value.projections)) {
        issues.push(projectionIssue("projections", "Worth discovery projections must be an array"))
      } else {
        value.projections.forEach((projection, index) => {
          const projectionIssues = validateWorthToolCapabilityProjection(projection)
          issues.push(...projectionIssues.map((entry) => ({ path: `projections[${index}].${entry.path}`, message: entry.message })))
        })
      }
      break
    case "cancelled":
    case "timed_out":
      issues.push(...unexpectedProjectionKeys(value, ["kind", "operationId", "posture"], "result"))
      if (!isNonEmptyText(value.operationId)) issues.push(projectionIssue("operationId", "query operation id must not be empty"))
      issues.push(...validatePartialEffectPosture(value.posture, "posture"))
      break
    case "failed":
      issues.push(...unexpectedProjectionKeys(value, ["kind", "message", "retryable"], "result"))
      if (!isNonEmptyText(value.message)) issues.push(projectionIssue("message", "Worth discovery failure message must not be empty"))
      if (typeof value.retryable !== "boolean") issues.push(projectionIssue("retryable", "Worth discovery retryability must be explicit"))
      break
    default:
      issues.push(projectionIssue("kind", "Worth discovery query result kind is not recognized"))
  }
  return Object.freeze(issues)
}

export function validateWorthToolCapabilityProjection(value: unknown): readonly ValidationIssue[] {
  if (!isRecord(value)) return [projectionIssue("projection", "Worth publication projection must be an object")]
  const issues: ValidationIssue[] = []
  const commonKeys = ["projectionKind", "capabilityId", "applicationId", "revision", "name", "description", "inputSchema", "outputSchema", "authorization", "status"]
  issues.push(...unexpectedProjectionKeys(value, value.status === "healthy" ? [...commonKeys, "activeReplay"] : commonKeys))
  if (value.projectionKind !== "worth_tool_capability") issues.push(projectionIssue("projectionKind", "projection is not a Worth tool capability projection"))
  for (const [path, id] of [["capabilityId", value.capabilityId], ["applicationId", value.applicationId]] as const) if (!isNonEmptyText(id)) issues.push(projectionIssue(path, `${path} must not be empty`))
  if (!isNonNegativeInteger(value.revision)) issues.push(projectionIssue("revision", "capability revision must be a non-negative safe integer"))
  if (!isNonEmptyText(value.name)) issues.push(projectionIssue("name", "capability name must not be empty"))
  if (!isNonEmptyText(value.description)) issues.push(projectionIssue("description", "capability description must not be empty"))
  issues.push(...validateJsonSchema(value.inputSchema, "inputSchema"), ...validateJsonSchema(value.outputSchema, "outputSchema"))
  issues.push(...validateAuthorization(value.authorization))
  if (value.status !== "healthy" && value.status !== "degraded" && value.status !== "discovering" && value.status !== "verifying") issues.push(projectionIssue("status", "capability state is not recognized"))
  if (value.status === "healthy") {
    issues.push(...validateActiveReplay(value.activeReplay))
    if (isRecord(value.activeReplay) && isNonEmptyText(value.capabilityId) && value.activeReplay.capabilityId !== value.capabilityId) {
      issues.push(projectionIssue("activeReplay.capabilityId", "active replay must belong to the projected capability"))
    }
  }
  if (value.status !== "healthy" && value.activeReplay !== undefined) issues.push(projectionIssue("activeReplay", "non-healthy capabilities cannot expose an active replay"))
  return issues
}

function validateAuthorization(value: unknown): ValidationIssue[] {
  if (!isRecord(value)) return [projectionIssue("authorization", "Worth authorization is required")]
  if (value.kind === "authorized") {
    const unexpected = unexpectedProjectionKeys(value, ["kind", "audience", "disclosure"], "authorization")
    if (unexpected.length > 0) return unexpected
    if (value.audience !== "gemini_consumer") return [projectionIssue("authorization.audience", "authorization audience is not supported")]
    if (value.disclosure !== "semantic_only") return [projectionIssue("authorization.disclosure", "only semantic-only disclosure is publishable")]
    return []
  }
  if (value.kind === "denied" && (value.reason === "unauthorized" || value.reason === "disclosure_not_allowed" || value.reason === "capability_not_admitted")) {
    return unexpectedProjectionKeys(value, ["kind", "reason"], "authorization")
  }
  return [projectionIssue("authorization", "Worth authorization is not recognized")]
}

function validateActiveReplay(value: unknown): ValidationIssue[] {
  if (!isRecord(value)) return [projectionIssue("activeReplay", "healthy capability must identify an active replay")]
  const issues: ValidationIssue[] = []
  issues.push(...unexpectedProjectionKeys(value, ["capabilityId", "replayVersionId", "version", "revision", "status"], "activeReplay"))
  if (!isNonEmptyText(value.capabilityId)) issues.push(projectionIssue("activeReplay.capabilityId", "active replay capability id must not be empty"))
  if (!isNonEmptyText(value.replayVersionId)) issues.push(projectionIssue("activeReplay.replayVersionId", "active replay id must not be empty"))
  if (!isNonNegativeInteger(value.version) || value.version < 1) issues.push(projectionIssue("activeReplay.version", "active replay version must be positive"))
  if (!isNonNegativeInteger(value.revision)) issues.push(projectionIssue("activeReplay.revision", "active replay revision must be a non-negative safe integer"))
  if (value.status !== "active") issues.push(projectionIssue("activeReplay.status", "only an active replay can be published"))
  return issues
}

function validateReturnedCapabilityId(value: unknown, requestedCapabilityId: CapabilityId | undefined, issues: ValidationIssue[]): void {
  if (!isNonEmptyText(value)) {
    issues.push(projectionIssue("capabilityId", "returned capability id must not be empty"))
  } else if (requestedCapabilityId !== undefined && value !== requestedCapabilityId) {
    issues.push(projectionIssue("capabilityId", "Worth returned a different capability than requested"))
  }
}

function validatePartialEffectPosture(value: unknown, path: string): ValidationIssue[] {
  if (!isRecord(value)) return [projectionIssue(path, "partial-effect posture must be an object")]
  if (value.kind === "not_started" || value.kind === "completed") return Object.keys(value).length === 1 ? [] : [projectionIssue(path, "partial-effect posture has unexpected fields")]
  if (value.kind === "unknown" && value.recovery === "owner_reconciliation_required" && Object.keys(value).length === 2) return []
  return [projectionIssue(path, "partial-effect posture is not recognized")]
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

function projectionIssue(path: string, message: string): ValidationIssue {
  return { path, message }
}

function unexpectedProjectionKeys(value: Record<string, unknown>, allowed: readonly string[], path = "projection"): ValidationIssue[] {
  const allowedKeys = new Set(allowed)
  return Object.keys(value)
    .filter((key) => !allowedKeys.has(key))
    .map((key) => projectionIssue(`${path}.${key}`, "unexpected Worth publication field is not allowed"))
}
