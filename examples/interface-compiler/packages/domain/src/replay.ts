import type { Condition } from "./schema.js"
import type { CapabilityId, EvidenceId, ExperimentId, IsoTimestamp, ReplayVersionId } from "./identity.js"
import {
  activeReplayBrand,
  brokenReplayBrand,
  candidateReplayBrand,
  isIssuedActiveReplay,
  isIssuedBrokenReplay,
  isIssuedCandidateReplay,
  isIssuedSupersededReplay,
  isIssuedVerifyingReplay,
  registerVerificationRun,
  registerActiveReplay,
  registerBrokenReplay,
  registerCandidateReplay,
  registerSupersededReplay,
  registerVerifyingReplay,
  supersededReplayBrand,
  verifyingReplayBrand,
} from "./replay-brands.js"
import type { ReplayStep } from "./replay-steps.js"
import { validateReplayStep } from "./replay-steps.js"
import { validateReplayFailure, validateVerificationRuns, type VerificationRun } from "./replay-verification.js"
import { invalid, isIsoTimestamp, isNonEmptyText, isNonNegativeFiniteNumber, isNonNegativeInteger, isRecord, issue, valid, type ValidationResult } from "./validation.js"

export type { AssertStep, ClickStep, FillStep, LocatorTarget, NavigateStep, ReadStep, ReplayStep, SelectStep, WaitStep } from "./replay-steps.js"
export type { VerificationRunProjection, VerificationRunReceipt } from "./replay-verification.js"
export { validateReplayFailure }
export { validateReplayStep }

export type ReplayFailure =
  | {
      readonly kind: "step_failed"
      readonly stepIndex: number
      readonly message: string
      readonly evidenceIds: readonly EvidenceId[]
    }
  | {
      readonly kind: "postcondition_failed"
      readonly condition: Condition
      readonly message: string
      readonly evidenceIds: readonly EvidenceId[]
    }
  | {
      readonly kind: "verification_failed"
      readonly message: string
      readonly successfulRuns: number
      readonly requiredSuccessfulRuns: number
      readonly evidenceIds: readonly EvidenceId[]
    }

interface ReplayVersionCore {
  readonly id: ReplayVersionId
  readonly capabilityId: CapabilityId
  readonly version: number
  readonly steps: readonly ReplayStep[]
  readonly confidence: number
  readonly discoveredFromExperimentId: ExperimentId
  readonly supersedes?: ReplayVersionId
  readonly createdAt: IsoTimestamp
}

export interface CandidateReplay extends ReplayVersionCore {
  readonly status: "candidate"
  readonly [candidateReplayBrand]: true
}

export interface VerifyingReplay extends ReplayVersionCore {
  readonly status: "verifying"
  readonly [verifyingReplayBrand]: true
  readonly verification: {
    readonly requiredSuccessfulRuns: number
    readonly runs: readonly VerificationRun[]
  }
}

export interface ActiveReplay extends ReplayVersionCore {
  readonly status: "active"
  readonly [activeReplayBrand]: true
  readonly verifiedAt: IsoTimestamp
  readonly verification: {
    readonly requiredSuccessfulRuns: number
    readonly runs: readonly VerificationRun[]
  }
}

export interface BrokenReplay extends ReplayVersionCore {
  readonly status: "broken"
  readonly [brokenReplayBrand]: true
  readonly failure: ReplayFailure
  readonly brokenAt: IsoTimestamp
}

export interface SupersededReplay extends ReplayVersionCore {
  readonly status: "superseded"
  readonly [supersededReplayBrand]: true
  readonly supersededBy: ReplayVersionId
  readonly supersededAt: IsoTimestamp
}

export type ReplayVersion = CandidateReplay | VerifyingReplay | ActiveReplay | BrokenReplay | SupersededReplay

export interface CandidateReplayInput {
  readonly id: ReplayVersionId
  readonly capabilityId: CapabilityId
  readonly version: number
  readonly steps: readonly ReplayStep[]
  readonly confidence: number
  readonly discoveredFromExperimentId: ExperimentId
  readonly supersedes?: ReplayVersionId
  readonly createdAt: IsoTimestamp
}

export function createCandidateReplay(input: CandidateReplayInput): ValidationResult<CandidateReplay> {
  const issues = validateCandidateReplay(input)
  const result = issues.length > 0
    ? invalid(...issues)
    : valid({
        id: input.id,
        capabilityId: input.capabilityId,
        version: input.version,
        steps: [...input.steps],
        confidence: input.confidence,
        discoveredFromExperimentId: input.discoveredFromExperimentId,
        ...(input.supersedes === undefined ? {} : { supersedes: input.supersedes }),
        createdAt: input.createdAt,
        status: "candidate" as const,
        [candidateReplayBrand]: true as const,
      })
  if (result.ok) registerCandidateReplay(result.value)
  return result
}

export function validateCandidateReplay(input: CandidateReplayInput): ReturnType<typeof issue>[] {
  return validateReplayCore(input)
}

export function beginReplayVerification(replay: CandidateReplay, requiredSuccessfulRuns = 3): ValidationResult<VerifyingReplay> {
  if (!isCandidateReplay(replay)) return invalid(issue("replay", "candidate replay must come from createCandidateReplay"))
  if (!isNonNegativeInteger(requiredSuccessfulRuns) || requiredSuccessfulRuns < 1) return invalid(issue("requiredSuccessfulRuns", "required successful runs must be a positive safe integer"))
  const result = valid({
    ...replayCore(replay),
    status: "verifying" as const,
    verification: { requiredSuccessfulRuns, runs: [] },
    [verifyingReplayBrand]: true as const,
  })
  if (result.ok) registerVerifyingReplay(result.value)
  return result
}

export function completeReplayVerification(replay: VerifyingReplay, verifiedAt: IsoTimestamp): ValidationResult<ActiveReplay | BrokenReplay> {
  if (!isVerifyingReplay(replay)) return invalid(issue("replay", "verifying replay must come from beginReplayVerification"))
  const runIssues = validateVerificationRuns(replay.verification.runs, verifiedAt, replay)
  if (runIssues.length > 0) return invalid(...runIssues)
  if (replay.verification.runs.length === 0) return invalid(issue("runs", "verification must retain at least one run"))

  const successfulRuns = replay.verification.runs.filter((run) => run.outcome === "success").length
  const verification = {
    requiredSuccessfulRuns: replay.verification.requiredSuccessfulRuns,
    runs: [...replay.verification.runs],
  }
  if (successfulRuns >= replay.verification.requiredSuccessfulRuns) {
    const result = valid({ ...replayCore(replay), status: "active" as const, verifiedAt, verification, [activeReplayBrand]: true as const })
    if (result.ok) {
      registerActiveReplay(result.value)
      result.value.verification.runs.forEach((run) => registerVerificationRun(run))
    }
    return result
  }

  const result = valid({
    ...replayCore(replay),
    status: "broken" as const,
    brokenAt: verifiedAt,
    failure: {
      kind: "verification_failed" as const,
      message: "replay did not reach the required number of successful fresh-session verifications",
      successfulRuns,
      requiredSuccessfulRuns: replay.verification.requiredSuccessfulRuns,
      evidenceIds: replay.verification.runs.flatMap((run) => [...run.evidenceIds]),
    },
    [brokenReplayBrand]: true as const,
  })
  if (result.ok) registerBrokenReplay(result.value)
  return result
}

export function markReplayBroken(replay: ActiveReplay, failure: ReplayFailure, brokenAt: IsoTimestamp): ValidationResult<BrokenReplay> {
  if (!isActiveReplay(replay)) return invalid(issue("replay", "active replay must come from completeReplayVerification"))
  const failureIssues = validateReplayFailure(failure)
  if (failureIssues.length > 0) return invalid(...failureIssues)
  if (!isIsoTimestamp(brokenAt)) return invalid(issue("brokenAt", "brokenAt must be a timestamp"))
  const result = valid({ ...replayCore(replay), status: "broken" as const, failure, brokenAt, [brokenReplayBrand]: true as const })
  if (result.ok) registerBrokenReplay(result.value)
  return result
}

export function supersedeReplay(replay: CandidateReplay | BrokenReplay, successor: CandidateReplay | VerifyingReplay | ActiveReplay, supersededAt: IsoTimestamp): ValidationResult<SupersededReplay> {
  const issues: ReturnType<typeof issue>[] = []
  if (!isCandidateReplay(replay) && !isBrokenReplay(replay)) issues.push(issue("replay", "replay must come from a domain lifecycle transition"))
  if (!isCandidateReplay(successor) && !isVerifyingReplay(successor) && !isActiveReplay(successor)) issues.push(issue("successor", "successor must come from a domain lifecycle transition"))
  const replayIsValid = isCandidateReplay(replay) || isBrokenReplay(replay)
  const successorIsValid = isCandidateReplay(successor) || isVerifyingReplay(successor) || isActiveReplay(successor)
  if (!replayIsValid || !successorIsValid) return invalid(...issues)
  if (successor.capabilityId !== replay.capabilityId) issues.push(issue("successor.capabilityId", "successor belongs to a different capability"))
  if (successor.version <= replay.version) issues.push(issue("successor.version", "successor version must be greater than the superseded version"))
  if (successor.id === replay.id) issues.push(issue("successor.id", "a replay cannot supersede itself"))
  if (successor.supersedes !== replay.id) issues.push(issue("successor.supersedes", "successor lineage must identify the replay it supersedes"))
  if (!isIsoTimestamp(supersededAt)) issues.push(issue("supersededAt", "supersededAt must be a timestamp"))
  if (issues.length > 0) return invalid(...issues)
  const result = valid({ ...replayCore(replay), status: "superseded" as const, supersededBy: successor.id, supersededAt, [supersededReplayBrand]: true as const })
  if (result.ok) registerSupersededReplay(result.value)
  return result
}

export function successfulVerificationCount(replay: VerifyingReplay | ActiveReplay): number {
  return replay.verification.runs.filter((run) => run.outcome === "success").length
}

export function isCandidateReplay(value: unknown): value is CandidateReplay {
  return isIssuedCandidateReplay(value) && hasBrand(value, candidateReplayBrand) && validateReplayState(value, "candidate")
}

export function isActiveReplay(value: unknown): value is ActiveReplay {
  return isIssuedActiveReplay(value) && hasBrand(value, activeReplayBrand) && validateReplayState(value, "active")
}

export function isBrokenReplay(value: unknown): value is BrokenReplay {
  return isIssuedBrokenReplay(value) && hasBrand(value, brokenReplayBrand) && validateReplayState(value, "broken")
}

export function isVerifyingReplay(value: unknown): value is VerifyingReplay {
  return isIssuedVerifyingReplay(value) && hasBrand(value, verifyingReplayBrand) && validateReplayState(value, "verifying")
}

function validateReplayCore(input: CandidateReplayInput): ReturnType<typeof issue>[] {
  const issues: ReturnType<typeof issue>[] = []
  if (!isRecord(input)) return [issue("replay", "replay candidate must be an object")]
  if (!isNonEmptyText(input.id)) issues.push(issue("id", "replay version id must not be empty"))
  if (!isNonEmptyText(input.capabilityId)) issues.push(issue("capabilityId", "capability id must not be empty"))
  if (!isNonNegativeInteger(input.version) || input.version < 1) issues.push(issue("version", "version must be a positive safe integer"))
  if (!Array.isArray(input.steps)) {
    issues.push(issue("steps", "replay steps must be an array"))
  } else if (input.steps.length === 0) {
    issues.push(issue("steps", "replay must contain at least one step"))
  }
  if (!isNonNegativeFiniteNumber(input.confidence) || input.confidence > 1) issues.push(issue("confidence", "confidence must be finite and between 0 and 1"))
  if (!isNonEmptyText(input.discoveredFromExperimentId)) issues.push(issue("discoveredFromExperimentId", "experiment id must not be empty"))
  if (input.supersedes !== undefined && !isNonEmptyText(input.supersedes)) issues.push(issue("supersedes", "superseded replay id must not be empty when present"))
  if (!isIsoTimestamp(input.createdAt)) issues.push(issue("createdAt", "createdAt must be a timestamp"))
  if (Array.isArray(input.steps)) input.steps.forEach((step, index) => issues.push(...validateReplayStep(step, index)))
  return issues
}

function replayCore(replay: ReplayVersionCore): ReplayVersionCore {
  return {
    id: replay.id,
    capabilityId: replay.capabilityId,
    version: replay.version,
    steps: replay.steps,
    confidence: replay.confidence,
    discoveredFromExperimentId: replay.discoveredFromExperimentId,
    ...(replay.supersedes === undefined ? {} : { supersedes: replay.supersedes }),
    createdAt: replay.createdAt,
  }
}

function validateReplayState(value: unknown, expectedStatus: ReplayVersion["status"]): boolean {
  if (!isRecord(value) || value.status !== expectedStatus) return false
  if (validateReplayCore(value as unknown as CandidateReplayInput).length > 0) return false

  switch (expectedStatus) {
    case "candidate":
      return true
    case "verifying":
      return isRecord(value.verification) &&
        isNonNegativeInteger(value.verification.requiredSuccessfulRuns) &&
        value.verification.requiredSuccessfulRuns >= 1 &&
        Array.isArray(value.verification.runs) &&
        validateVerificationRuns(value.verification.runs as VerificationRun[], value.createdAt as IsoTimestamp, value as unknown as VerifyingReplay).length === 0
    case "active":
      return isIsoTimestamp(value.verifiedAt) &&
        isRecord(value.verification) &&
        isNonNegativeInteger(value.verification.requiredSuccessfulRuns) &&
        value.verification.requiredSuccessfulRuns >= 1 &&
        Array.isArray(value.verification.runs) &&
        validateVerificationRuns(value.verification.runs as VerificationRun[], value.verifiedAt, value as unknown as VerifyingReplay).length === 0
    case "broken":
      return isIsoTimestamp(value.brokenAt) && validateReplayFailure(value.failure).length === 0
    case "superseded":
      return isNonEmptyText(value.supersededBy) && isIsoTimestamp(value.supersededAt) && isIssuedSupersededReplay(value)
  }
}

function hasBrand(value: unknown, brand: symbol): boolean {
  return value !== null && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, brand) && (value as Record<symbol, unknown>)[brand] === true
}
