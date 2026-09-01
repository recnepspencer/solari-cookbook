import type { ApplicationId, CapabilityId, ReplayVersionId } from "@interface-compiler/domain"
import type { ValidationResult } from "@interface-compiler/domain"

const toolIdBrand: unique symbol = Symbol("ToolId")

export type ToolId = string & { readonly [toolIdBrand]: true }
export type ToolArtifactSchemaId = "interface-compiler.tool-publication"
export const TOOL_ARTIFACT_SCHEMA_ID: ToolArtifactSchemaId = "interface-compiler.tool-publication"
export const TOOL_ARTIFACT_SCHEMA_VERSION = 1 as const

export interface ToolPublicationIdentity {
  readonly toolId: ToolId
  /** Derived from the current Worth active replay; not part of the Gemini definition. */
  readonly toolVersion: number
  readonly applicationId: ApplicationId
  readonly capabilityId: CapabilityId
  readonly replayVersionId: ReplayVersionId
  readonly capabilityRevision: number
  readonly replayRevision: number
}

export function createToolId(namespace: string, capabilityName: string): ValidationResult<ToolId> {
  const normalizedNamespace = normalizeSegment(namespace)
  const normalizedName = normalizeSemanticName(capabilityName)
  const issues = []
  if (!isSafeSegment(normalizedNamespace)) issues.push({ path: "namespace", message: "namespace must start with a letter and contain only lowercase letters, digits, or underscores" })
  if (!isSafeSegment(normalizedName)) issues.push({ path: "capabilityName", message: "capability name must contain a semantic tool name" })
  if (issues.length > 0) return { ok: false, issues: Object.freeze(issues) }
  return { ok: true, value: `${normalizedNamespace}.${normalizedName}` as ToolId }
}

export function isToolId(value: unknown): value is ToolId {
  return typeof value === "string" && /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(value)
}

function normalizeSegment(value: string): string {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") : ""
}

function normalizeSemanticName(value: string): string {
  if (typeof value !== "string") return ""
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

function isSafeSegment(value: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(value)
}
