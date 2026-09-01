import type { ApplicationId, CapabilityId, JsonSchema, JsonValue, ValidationIssue } from "@interface-compiler/domain"
import { validateJsonSchema } from "@interface-compiler/domain"
import {
  createToolId,
  isToolId,
  TOOL_ARTIFACT_SCHEMA_ID,
  TOOL_ARTIFACT_SCHEMA_VERSION,
  type ToolArtifactSchemaId,
  type ToolPublicationIdentity,
  type ToolId,
} from "./identity.js"
import {
  createToolMetadata,
  validateSafeJsonSchema,
  validateSafeMetadataText,
  validateToolMetadata,
  type MetadataViolation,
  type ToolExample,
} from "./metadata.js"
import { evaluatePublicationPolicy, validateToolPublicationPolicy, type ToolPublicationPolicy, type PublicationPolicyDecision } from "./policy.js"
import { validateWorthToolCapabilityProjection, type WorthToolCapabilityProjection } from "./worth-query.js"

export interface GeminiToolDefinition {
  readonly name: string
  readonly description: string
  readonly inputSchema: JsonSchema
  readonly outputSchema: JsonSchema
  readonly examples: readonly ToolExample[]
}

/** Includes source lineage for operator telemetry; consumer definitions omit it. */
export interface ToolPublicationArtifact {
  readonly artifactSchemaId: ToolArtifactSchemaId
  readonly artifactSchemaVersion: typeof TOOL_ARTIFACT_SCHEMA_VERSION
  readonly identity: ToolPublicationIdentity
  readonly definition: GeminiToolDefinition
}

export type ArtifactRejection =
  | { readonly kind: "invalid_artifact"; readonly issues: readonly ValidationIssue[] }
  | { readonly kind: "invalid_policy"; readonly issues: readonly ValidationIssue[] }
  | { readonly kind: "invalid_projection"; readonly issues: readonly ValidationIssue[] }
  | { readonly kind: "policy_denied"; readonly reason: "application_not_allowed" | "capability_not_allowed" | "namespace_not_allowed" }
  | { readonly kind: "invalid_identity"; readonly issues: readonly ValidationIssue[] }
  | { readonly kind: "unsafe_metadata"; readonly violations: readonly MetadataViolation[] }
  | { readonly kind: "invalid_schema"; readonly target: "input" | "output"; readonly issues: readonly ValidationIssue[] }

export type ArtifactBuildResult =
  | { readonly kind: "valid"; readonly artifact: ToolPublicationArtifact }
  | { readonly kind: "rejected"; readonly reasons: readonly ArtifactRejection[] }

export function buildToolPublicationArtifact(
  projection: WorthToolCapabilityProjection,
  policy: ToolPublicationPolicy,
  examples: readonly ToolExample[],
): ArtifactBuildResult {
  const policyIssues = validateToolPublicationPolicy(policy)
  if (policyIssues.length > 0) return rejected({ kind: "invalid_policy", issues: policyIssues })

  const projectionIssues = validateWorthToolCapabilityProjection(projection)
  if (projectionIssues.length > 0) return rejected({ kind: "invalid_projection", issues: projectionIssues })
  if (projection.status !== "healthy" || projection.authorization.kind !== "authorized") {
    return rejected({ kind: "invalid_projection", issues: [artifactIssue("projection", "only healthy, Worth-authorized capabilities can produce a publication artifact")] })
  }

  const policyDecision = evaluatePublicationPolicy(policy, projection.applicationId, projection.capabilityId)
  if (policyDecision.kind === "denied") return rejected(policyRejection(policyDecision))

  const idResult = createToolId(policy.namespace, projection.name)
  if (!idResult.ok) return rejected({ kind: "invalid_identity", issues: idResult.issues })
  const nameViolations = validateSafeMetadataText(idResult.value, "definition.name", policy)
  if (nameViolations.length > 0) return rejected({ kind: "unsafe_metadata", violations: nameViolations })

  const metadataResult = createToolMetadata(projection.description, examples, policy)
  if (metadataResult.kind === "invalid") return rejected({ kind: "unsafe_metadata", violations: metadataResult.violations })

  const schemaRejections = validatePublicationSchemas(projection, policy)
  if (schemaRejections.length > 0) return { kind: "rejected", reasons: schemaRejections }

  const identity = createPublicationIdentity(idResult.value, projection)
  const artifact = freezeArtifact({
    artifactSchemaId: TOOL_ARTIFACT_SCHEMA_ID,
    artifactSchemaVersion: TOOL_ARTIFACT_SCHEMA_VERSION,
    identity,
    definition: {
      name: idResult.value,
      description: metadataResult.value.description,
      inputSchema: projection.inputSchema,
      outputSchema: projection.outputSchema,
      examples: metadataResult.value.examples,
    },
  })
  return { kind: "valid", artifact }
}

export function validateToolPublicationArtifact(
  artifact: unknown,
  policy: ToolPublicationPolicy,
): readonly ArtifactRejection[] {
  const policyIssues = validateToolPublicationPolicy(policy)
  if (policyIssues.length > 0) return [{ kind: "invalid_policy", issues: policyIssues }]
  if (!isRecord(artifact)) return [{ kind: "invalid_artifact", issues: [artifactIssue("artifact", "publication artifact must be an object")] }]

  const reasons: ArtifactRejection[] = []
  reasons.push(...unexpectedKeyRejections(artifact, ["artifactSchemaId", "artifactSchemaVersion", "identity", "definition"], "artifact"))
  if (artifact.artifactSchemaId !== TOOL_ARTIFACT_SCHEMA_ID || artifact.artifactSchemaVersion !== TOOL_ARTIFACT_SCHEMA_VERSION) {
    reasons.push({ kind: "invalid_artifact", issues: [artifactIssue("artifactSchema", "publication artifact schema id or version is not supported")] })
  }

  reasons.push(...validateArtifactIdentity(artifact.identity))
  if (isRecord(artifact.identity) && isNonEmptyText(artifact.identity.applicationId) && isNonEmptyText(artifact.identity.capabilityId)) {
    const policyDecision = evaluatePublicationPolicy(policy, artifact.identity.applicationId as ApplicationId, artifact.identity.capabilityId as CapabilityId)
    if (policyDecision.kind === "denied") reasons.push(policyRejection(policyDecision))
    if (isToolId(artifact.identity.toolId) && !artifact.identity.toolId.startsWith(`${policy.namespace.trim().toLowerCase()}.`)) {
      reasons.push({ kind: "policy_denied", reason: "namespace_not_allowed" })
    }
  }
  if (!isRecord(artifact.definition)) {
    reasons.push({ kind: "invalid_artifact", issues: [artifactIssue("definition", "consumer tool definition must be an object")] })
    return Object.freeze(reasons)
  }
  reasons.push(...unexpectedKeyRejections(artifact.definition, ["name", "description", "inputSchema", "outputSchema", "examples"], "definition"))
  if (typeof artifact.definition.name !== "string" || !isToolId(artifact.definition.name)) {
    reasons.push({ kind: "invalid_identity", issues: [artifactIssue("definition.name", "tool name is not a valid tool id")] })
  }
  const nameViolations = validateSafeMetadataText(artifact.definition.name, "definition.name", policy)
  if (nameViolations.length > 0) reasons.push({ kind: "unsafe_metadata", violations: nameViolations })

  const metadataViolations = validateToolMetadata(artifact.definition, policy)
  if (metadataViolations.length > 0) reasons.push({ kind: "unsafe_metadata", violations: metadataViolations })
  if (isToolId(artifact.definition.name) && isRecord(artifact.identity) && artifact.identity.toolId !== artifact.definition.name) {
    reasons.push({ kind: "invalid_identity", issues: [artifactIssue("identity.toolId", "identity tool id must match the consumer definition name")] })
  }
  reasons.push(...schemaRejectionsForArtifact(artifact.definition.inputSchema, policy, "input"))
  reasons.push(...schemaRejectionsForArtifact(artifact.definition.outputSchema, policy, "output"))
  return Object.freeze(reasons)
}

/** Returns a consumer projection with only semantic fields; source lineage is deliberately not carried across. */
export function consumerToolDefinition(artifact: ToolPublicationArtifact): GeminiToolDefinition {
  return freezeConsumerDefinition({
    name: artifact.definition.name,
    description: artifact.definition.description,
    inputSchema: artifact.definition.inputSchema,
    outputSchema: artifact.definition.outputSchema,
    examples: artifact.definition.examples,
  })
}

function validatePublicationSchemas(
  projection: WorthToolCapabilityProjection,
  policy: ToolPublicationPolicy,
): readonly ArtifactRejection[] {
  return [
    ...schemaRejectionsForArtifact(projection.inputSchema, policy, "input"),
    ...schemaRejectionsForArtifact(projection.outputSchema, policy, "output"),
  ]
}

function schemaRejectionsForArtifact(
  schema: unknown,
  policy: ToolPublicationPolicy,
  target: "input" | "output",
): readonly ArtifactRejection[] {
  const issues = validateJsonSchema(schema, `definition.${target}Schema`)
  const safetyViolations = validateSafeJsonSchema(schema, policy, `definition.${target}Schema`)
  if (issues.length === 0 && safetyViolations.length === 0) return []
  return [{
    kind: "invalid_schema",
    target,
    issues: Object.freeze([
      ...issues,
      ...safetyViolations.map((violation) => artifactIssue(violation.path, `schema metadata is not publishable: ${violation.kind}`)),
    ]),
  }]
}

function createPublicationIdentity(toolId: ToolId, projection: Extract<WorthToolCapabilityProjection, { status: "healthy" }>): ToolPublicationIdentity {
  return {
    toolId,
    toolVersion: projection.activeReplay.version,
    applicationId: projection.applicationId,
    capabilityId: projection.capabilityId,
    replayVersionId: projection.activeReplay.replayVersionId,
    capabilityRevision: projection.revision,
    replayRevision: projection.activeReplay.revision,
  }
}

function validateArtifactIdentity(value: unknown): ArtifactRejection[] {
  if (!isRecord(value)) return [{ kind: "invalid_identity", issues: [artifactIssue("identity", "publication identity must be an object")] }]
  const issues: ValidationIssue[] = []
  issues.push(...unexpectedKeyIssues(value, ["toolId", "toolVersion", "applicationId", "capabilityId", "replayVersionId", "capabilityRevision", "replayRevision"], "identity"))
  if (!isToolId(value.toolId)) issues.push(artifactIssue("identity.toolId", "tool id is not valid"))
  if (!isNonEmptyText(value.applicationId)) issues.push(artifactIssue("identity.applicationId", "application id must not be empty"))
  if (!isNonEmptyText(value.capabilityId)) issues.push(artifactIssue("identity.capabilityId", "capability id must not be empty"))
  if (!isNonEmptyText(value.replayVersionId)) issues.push(artifactIssue("identity.replayVersionId", "replay version id must not be empty"))
  if (!isNonNegativeInteger(value.toolVersion) || value.toolVersion < 1) issues.push(artifactIssue("identity.toolVersion", "tool version must be positive"))
  if (!isNonNegativeInteger(value.capabilityRevision)) issues.push(artifactIssue("identity.capabilityRevision", "capability revision must be a non-negative safe integer"))
  if (!isNonNegativeInteger(value.replayRevision)) issues.push(artifactIssue("identity.replayRevision", "replay revision must be a non-negative safe integer"))
  return issues.length === 0 ? [] : [{ kind: "invalid_identity", issues: Object.freeze(issues) }]
}

function policyRejection(decision: PublicationPolicyDecision): ArtifactRejection {
  return decision.kind === "denied"
    ? { kind: "policy_denied", reason: decision.reason }
    : { kind: "invalid_policy", issues: [artifactIssue("policy", "publication policy is not valid")] }
}

function rejected(reason: ArtifactRejection): ArtifactBuildResult {
  return { kind: "rejected", reasons: Object.freeze([reason]) }
}

function unexpectedKeyRejections(value: Record<string, unknown>, allowed: readonly string[], path: string): ArtifactRejection[] {
  const issues = unexpectedKeyIssues(value, allowed, path)
  return issues.length === 0 ? [] : [{ kind: "invalid_artifact", issues: Object.freeze(issues) }]
}

function unexpectedKeyIssues(value: Record<string, unknown>, allowed: readonly string[], path: string): ValidationIssue[] {
  const allowedKeys = new Set(allowed)
  return Object.keys(value)
    .filter((key) => !allowedKeys.has(key))
    .map((key) => artifactIssue(`${path}.${key}`, "unexpected publication field is not allowed"))
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

function artifactIssue(path: string, message: string): ValidationIssue {
  return { path, message }
}

function freezeArtifact(artifact: ToolPublicationArtifact): ToolPublicationArtifact {
  return Object.freeze({
    artifactSchemaId: artifact.artifactSchemaId,
    artifactSchemaVersion: artifact.artifactSchemaVersion,
    identity: Object.freeze({ ...artifact.identity }),
    definition: freezeConsumerDefinition(artifact.definition),
  })
}

function freezeConsumerDefinition(definition: GeminiToolDefinition): GeminiToolDefinition {
  const examples: ToolExample[] = definition.examples.map((example) => {
    const copy: { label: string; input: JsonValue; expectedOutput?: JsonValue } = {
      label: example.label,
      input: freezeArtifactJson(example.input) as JsonValue,
    }
    if (example.expectedOutput !== undefined) copy.expectedOutput = freezeArtifactJson(example.expectedOutput) as JsonValue
    return Object.freeze(copy)
  })
  return Object.freeze({
    name: definition.name,
    description: definition.description,
    inputSchema: freezeArtifactJson(definition.inputSchema) as JsonSchema,
    outputSchema: freezeArtifactJson(definition.outputSchema) as JsonSchema,
    examples: Object.freeze(examples),
  })
}

function freezeArtifactJson(value: unknown): unknown {
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => freezeArtifactJson(entry)))
  if (value !== null && typeof value === "object") {
    const copy: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      Object.defineProperty(copy, key, { value: freezeArtifactJson(child), enumerable: true, writable: true, configurable: true })
    }
    return Object.freeze(copy)
  }
  return value
}
