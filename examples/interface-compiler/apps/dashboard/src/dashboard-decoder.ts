/** Validates the weaker, read-only projection returned by the WORTH query. */
import {
  dashboardProjectionSchemaVersion,
  type DashboardEvidenceProjection,
  type DashboardMode,
  type DashboardReplayProjection,
  type DashboardReplayVerificationProjection,
  type DashboardVerificationPosture,
  type DashboardVerificationRunProjection,
  type WorthDashboardProjection,
} from "./dashboard-contract.js"

export function isSupportedWorthDashboardProjection(value: unknown): value is WorthDashboardProjection {
  if (!isRecord(value)) return false
  if (value.schemaVersion !== dashboardProjectionSchemaVersion || !isRevision(value.sourceRevision) || typeof value.generatedAt !== "string") return false
  if (!Array.isArray(value.capabilities) || !Array.isArray(value.replays) || !Array.isArray(value.executions) || !Array.isArray(value.evidence) || !Array.isArray(value.sessions) || !Array.isArray(value.economics)) return false
  if (!isRecord(value.mode) || !isDashboardMode(value.mode.value) || !isRevision(value.mode.sourceRevision) || value.mode.sourceRevision > value.sourceRevision) return false
  return value.evidence.every(isSupportedEvidenceProjection) && hasUniqueCanonicalEvidenceIds(value.evidence) && value.replays.every(isSupportedReplayProjection)
}

function isDashboardMode(value: unknown): value is DashboardMode { return value === "direct" || value === "discovering" || value === "compiled" || value === "degraded" || value === "exploring" || value === "verifying" }
function isRevision(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 }
function isSupportedEvidenceProjection(value: unknown): value is DashboardEvidenceProjection {
  if (!isRecord(value)) return false
  if (value.status === "missing") return isNonEmptyText(value.id)
  return (value.status === "present" || value.status === "failed") && !("id" in value) && isRecord(value.evidence) && isNonEmptyText(value.evidence.id)
}
function hasUniqueCanonicalEvidenceIds(values: readonly unknown[]): boolean {
  const ids = new Set<string>()
  for (const value of values) { if (!isRecord(value)) return false; const id = value.status === "missing" ? value.id : isRecord(value.evidence) ? value.evidence.id : undefined; if (!isNonEmptyText(id) || ids.has(id)) return false; ids.add(id) }
  return true
}
function isSupportedReplayProjection(value: unknown): value is DashboardReplayProjection {
  if (!isRecord(value) || value.projectionKind !== "worth_replay" || !isNonEmptyText(value.id) || !isRevision(value.revision) || !isNonEmptyText(value.capabilityId) || !isRevision(value.version) || typeof value.confidence !== "number" || !Number.isFinite(value.confidence) || typeof value.createdAt !== "string" || !isSupportedVerificationProjection(value.verification)) return false
  switch (value.status) { case "candidate": case "verifying": return true; case "active": return Array.isArray(value.steps) && typeof value.verifiedAt === "string"; case "broken": return isRecord(value.failure) && typeof value.brokenAt === "string"; case "superseded": return isNonEmptyText(value.supersededBy) && typeof value.supersededAt === "string"; default: return false }
}
function isSupportedVerificationProjection(value: unknown): value is DashboardReplayVerificationProjection {
  return isRecord(value) && isDashboardVerificationPosture(value.posture) && (value.requiredSuccessfulRuns === null || isRevision(value.requiredSuccessfulRuns)) && isRevision(value.successfulRuns) && isRevision(value.failedRuns) && Array.isArray(value.runs) && Array.isArray(value.referencedEvidenceIds) && Array.isArray(value.failedEvidenceIds) && Array.isArray(value.missingEvidenceIds) && typeof value.explanation === "string" && value.referencedEvidenceIds.every(isNonEmptyText) && value.failedEvidenceIds.every(isNonEmptyText) && value.missingEvidenceIds.every(isNonEmptyText) && value.runs.every(isSupportedVerificationRunProjection)
}
function isSupportedVerificationRunProjection(value: unknown): value is DashboardVerificationRunProjection { return isRecord(value) && isNonEmptyText(value.id) && isNonEmptyText(value.sessionId) && typeof value.freshSession === "boolean" && Array.isArray(value.evidenceIds) && value.evidenceIds.every(isNonEmptyText) && (value.outcome === "success" || value.outcome === "failure" && typeof value.failureMessage === "string") }
function isDashboardVerificationPosture(value: unknown): value is DashboardVerificationPosture { return value === "verified" || value === "provisional" || value === "failed" || value === "missing_evidence" || value === "inconsistent" || value === "superseded" || value === "not_started" }
function isNonEmptyText(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" }
