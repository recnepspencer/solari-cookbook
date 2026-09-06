import {
  validateCondition,
  validateJsonSchema,
  validateReplayFailure,
  validateReplayStep,
  type CapabilityId,
  type CapabilityProjection,
  type IsoTimestamp,
  type ReplayProjection,
  type ReplayVersionId,
  type VerificationRunProjection,
} from "@interface-compiler/domain"
import type { HostActiveReplayProjection, HostCapabilityProjection } from "./worth-query-wire.js"

export function decodeCapabilityProjection(value: HostCapabilityProjection, expectedId?: CapabilityId): CapabilityProjection | undefined {
  if ((expectedId !== undefined && value.id !== expectedId) || validateJsonSchema(value.input_schema).length > 0 || validateJsonSchema(value.output_schema).length > 0 || !Array.isArray(value.preconditions) || value.preconditions.some((condition) => validateCondition(condition).length > 0) || !Array.isArray(value.postconditions) || value.postconditions.some((condition) => validateCondition(condition).length > 0) || !record(value.publication) || value.publication.audience !== "gemini_consumer" || value.publication.disclosure !== "semantic_only") return undefined
  const id = value.id as CapabilityId
  const core = {
    projectionKind: "worth_capability" as const,
    id,
    revision: value.revision,
    applicationId: value.application_id as CapabilityProjection["applicationId"],
    name: value.name,
    description: value.description,
    inputSchema: structuredClone(value.input_schema) as CapabilityProjection["inputSchema"],
    outputSchema: structuredClone(value.output_schema) as CapabilityProjection["outputSchema"],
    preconditions: structuredClone(value.preconditions) as CapabilityProjection["preconditions"],
    postconditions: structuredClone(value.postconditions) as CapabilityProjection["postconditions"],
    publication: { audience: "gemini_consumer" as const, disclosure: "semantic_only" as const },
  }
  if (value.status === "healthy" && value.active_replay_version_id !== undefined) return { ...core, status: "healthy", activeReplayVersionId: value.active_replay_version_id as ReplayVersionId }
  if (value.status === "verifying" && value.candidate_replay_version_id !== undefined) return { ...core, status: "verifying", candidateReplayVersionId: value.candidate_replay_version_id as ReplayVersionId }
  if (value.status === "degraded" && value.broken_replay_version_id !== undefined && validateReplayFailure(value.failure).length === 0) return { ...core, status: "degraded", brokenReplayVersionId: value.broken_replay_version_id as ReplayVersionId, failure: structuredClone(value.failure) as Extract<CapabilityProjection, { readonly status: "degraded" }>["failure"], mode: "exploratory" }
  return undefined
}

export function decodeReplayProjection(value: HostActiveReplayProjection, expectedCapabilityId?: CapabilityId, expectedReplayId?: ReplayVersionId): ReplayProjection | undefined {
  if ((expectedCapabilityId !== undefined && value.capability_id !== expectedCapabilityId) || (expectedReplayId !== undefined && value.id !== expectedReplayId) || value.steps.length === 0 || value.steps.some((step, index) => validateReplayStep(step, index).length > 0) || !timestamp(value.created_at) || value.confidence < 0 || value.confidence > 1) return undefined
  const capabilityId = value.capability_id as CapabilityId
  const replayId = value.id as ReplayVersionId
  const verification = decodeVerification(value, capabilityId, replayId)
  if (verification === undefined) return undefined
  const core = {
    projectionKind: "worth_replay" as const,
    id: replayId,
    revision: value.revision,
    capabilityId,
    version: value.version,
    steps: structuredClone(value.steps) as ReplayProjection["steps"],
    confidence: value.confidence,
    ...(value.supersedes === undefined ? {} : { supersedes: value.supersedes as ReplayVersionId }),
    createdAt: value.created_at as IsoTimestamp,
  }
  if (value.status === "verifying" && value.verified_at === undefined && value.failure === undefined && value.broken_at === undefined) return { ...core, status: "verifying", verification }
  if (value.status === "active" && value.verified_at !== undefined && timestamp(value.verified_at) && successfulRuns(verification.runs) >= verification.requiredSuccessfulRuns) return { ...core, status: "active", verifiedAt: value.verified_at as IsoTimestamp, verification }
  if (value.status === "broken" && value.broken_at !== undefined && timestamp(value.broken_at) && validateReplayFailure(value.failure).length === 0) return { ...core, status: "broken", brokenAt: value.broken_at as IsoTimestamp, failure: structuredClone(value.failure) as Extract<ReplayProjection, { readonly status: "broken" }>["failure"] }
  return undefined
}

function decodeVerification(value: HostActiveReplayProjection, capabilityId: CapabilityId, replayId: ReplayVersionId): Extract<ReplayProjection, { readonly status: "verifying" | "active" }>["verification"] | undefined {
  if (!Number.isSafeInteger(value.verification.requiredSuccessfulRuns) || value.verification.requiredSuccessfulRuns < 1) return undefined
  const ids = new Set<string>()
  const sessions = new Set<string>()
  const evidenceIds = new Set<string>()
  const runs: VerificationRunProjection[] = []
  for (const run of value.verification.runs) {
    if (run.capabilityId !== capabilityId || run.replayVersionId !== replayId || ids.has(run.id) || sessions.has(run.sessionId) || run.evidenceIds.length === 0 || run.evidenceIds.some((id) => evidenceIds.has(id))) return undefined
    ids.add(run.id)
    sessions.add(run.sessionId)
    run.evidenceIds.forEach((id) => evidenceIds.add(id))
    const core = { id: run.id as VerificationRunProjection["id"], sessionId: run.sessionId as VerificationRunProjection["sessionId"], capabilityId, replayVersionId: replayId, freshSession: true as const, evidenceIds: run.evidenceIds as VerificationRunProjection["evidenceIds"] }
    runs.push(run.outcome === "success" ? { ...core, outcome: "success" } : { ...core, outcome: "failure", failureMessage: run.failureMessage! })
  }
  return { requiredSuccessfulRuns: value.verification.requiredSuccessfulRuns, runs }
}

function successfulRuns(runs: readonly VerificationRunProjection[]): number { return runs.filter((run) => run.outcome === "success").length }
function timestamp(value: unknown): boolean { return typeof value === "string" && Number.isFinite(Date.parse(value)) }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) }
