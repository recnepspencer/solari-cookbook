import { validateCondition } from "./schema.js"
import type { CapabilityId, EvidenceId, IsoTimestamp, ReplayVersionId, SessionId, VerificationRunId } from "./identity.js"
import {
  isIssuedVerificationRun,
  isIssuedVerifyingReplay,
  registerVerificationRun,
  registerVerifyingReplay,
  verificationRunBrand,
  verifyingReplayBrand,
} from "./replay-brands.js"
import type { VerifyingReplay } from "./replay.js"
import { invalid, isIsoTimestamp, isNonEmptyText, isNonNegativeInteger, isRecord, issue, valid, type ValidationIssue, type ValidationResult } from "./validation.js"

/** This is the untrusted receipt submitted by a Solari/verifier boundary. */
export type VerificationRunReceipt =
  | {
      readonly id: VerificationRunId
      readonly sessionId: SessionId
      readonly capabilityId: CapabilityId
      readonly replayVersionId: ReplayVersionId
      readonly sessionFreshness: "fresh"
      readonly outcome: "success"
      readonly evidenceIds: readonly EvidenceId[]
    }
  | {
      readonly id: VerificationRunId
      readonly sessionId: SessionId
      readonly capabilityId: CapabilityId
      readonly replayVersionId: ReplayVersionId
      readonly sessionFreshness: "fresh"
      readonly outcome: "failure"
      readonly failureMessage: string
      readonly evidenceIds: readonly EvidenceId[]
    }

/** Internal Worth-owned proof; it is deliberately omitted from the package facade. */
export type VerificationRun =
  | {
      readonly id: VerificationRunId
      readonly sessionId: SessionId
      readonly capabilityId: CapabilityId
      readonly replayVersionId: ReplayVersionId
      readonly freshSession: true
      readonly outcome: "success"
      readonly evidenceIds: readonly EvidenceId[]
      readonly [verificationRunBrand]: true
    }
  | {
      readonly id: VerificationRunId
      readonly sessionId: SessionId
      readonly capabilityId: CapabilityId
      readonly replayVersionId: ReplayVersionId
      readonly freshSession: true
      readonly outcome: "failure"
      readonly failureMessage: string
      readonly evidenceIds: readonly EvidenceId[]
      readonly [verificationRunBrand]: true
    }

/** Worth-facing read projection; unlike VerificationRun it is not promotable to domain state. */
export type VerificationRunProjection =
  | {
      readonly id: VerificationRunId
      readonly sessionId: SessionId
      readonly capabilityId: CapabilityId
      readonly replayVersionId: ReplayVersionId
      readonly freshSession: true
      readonly outcome: "success"
      readonly evidenceIds: readonly EvidenceId[]
    }
  | {
      readonly id: VerificationRunId
      readonly sessionId: SessionId
      readonly capabilityId: CapabilityId
      readonly replayVersionId: ReplayVersionId
      readonly freshSession: true
      readonly outcome: "failure"
      readonly failureMessage: string
      readonly evidenceIds: readonly EvidenceId[]
    }

/**
 * @internal Only the Worth authority reducer may call this. The public facade
 * exposes VerificationRunReceipt as a command payload, while this reducer is
 * intentionally omitted from index.ts. Worth must resolve the receipt's
 * evidence and fresh-session references against its own authoritative store
 * before invoking this value transition.
 */
export function recordVerificationRun(replay: VerifyingReplay, receipt: VerificationRunReceipt): ValidationResult<VerifyingReplay> {
  if (!isIssuedVerifyingReplay(replay) || !hasBrand(replay, verifyingReplayBrand) || !isRecord(replay) || replay.status !== "verifying" || !isRecord(replay.verification) || !Array.isArray(replay.verification.runs)) {
    return invalid(issue("replay", "verification runs can only be recorded on a valid verifying replay"))
  }
  const existingRunIssues = validateVerificationRuns(replay.verification.runs, replay.createdAt, replay)
  if (existingRunIssues.length > 0) return invalid(...existingRunIssues)
  const issues: ReturnType<typeof issue>[] = []
  if (!isRecord(receipt)) return invalid(issue("receipt", "verification receipt must be an object"))
  if (!isNonEmptyText(receipt.id)) issues.push(issue("id", "verification run id must not be empty"))
  if (!isNonEmptyText(receipt.sessionId)) issues.push(issue("sessionId", "session id must not be empty"))
  if (!isNonEmptyText(receipt.capabilityId)) issues.push(issue("capabilityId", "capability id must not be empty"))
  if (!isNonEmptyText(receipt.replayVersionId)) issues.push(issue("replayVersionId", "replay version id must not be empty"))
  if (receipt.capabilityId !== replay.capabilityId) issues.push(issue("capabilityId", "verification receipt belongs to a different capability"))
  if (receipt.replayVersionId !== replay.id) issues.push(issue("replayVersionId", "verification receipt belongs to a different replay"))
  if (receipt.sessionFreshness !== "fresh") issues.push(issue("sessionFreshness", "verification must use a fresh Solari session"))
  if (!isNonNegativeInteger(replay.verification.requiredSuccessfulRuns) || replay.verification.requiredSuccessfulRuns < 1) issues.push(issue("requiredSuccessfulRuns", "required successful runs must be a positive safe integer"))
  if (!Array.isArray(receipt.evidenceIds) || receipt.evidenceIds.length === 0) {
    issues.push(issue("evidenceIds", "verification run must retain at least one evidence id"))
  } else if (receipt.evidenceIds.some((evidenceId) => !isNonEmptyText(evidenceId))) {
    issues.push(issue("evidenceIds", "verification evidence ids must not be empty"))
  }
  if (receipt.outcome !== "success" && receipt.outcome !== "failure") issues.push(issue("outcome", "verification outcome must be success or failure"))
  if (receipt.outcome === "failure" && !isNonEmptyText(receipt.failureMessage)) issues.push(issue("failureMessage", "verification failure message must not be empty"))
  if (replay.verification.runs.some((run) => run.id === receipt.id)) issues.push(issue("id", "verification run ids must be distinct"))
  if (replay.verification.runs.some((run) => run.sessionId === receipt.sessionId)) issues.push(issue("sessionId", "verification runs must use distinct fresh sessions"))
  const existingEvidenceIds = new Set(replay.verification.runs.flatMap((run) => [...run.evidenceIds]))
  if (Array.isArray(receipt.evidenceIds) && receipt.evidenceIds.some((evidenceId) => existingEvidenceIds.has(evidenceId))) issues.push(issue("evidenceIds", "verification evidence must be distinct across runs"))
  if (Array.isArray(receipt.evidenceIds) && new Set(receipt.evidenceIds).size !== receipt.evidenceIds.length) issues.push(issue("evidenceIds", "verification evidence ids must be distinct"))
  if (issues.length > 0) return invalid(...issues)

  const run: VerificationRun = receipt.outcome === "success"
    ? {
        id: receipt.id,
        sessionId: receipt.sessionId,
        capabilityId: replay.capabilityId,
        replayVersionId: replay.id,
        freshSession: true,
        outcome: "success",
        evidenceIds: [...receipt.evidenceIds],
        [verificationRunBrand]: true,
      }
    : {
        id: receipt.id,
        sessionId: receipt.sessionId,
        capabilityId: replay.capabilityId,
        replayVersionId: replay.id,
        freshSession: true,
        outcome: "failure",
        failureMessage: receipt.failureMessage,
        evidenceIds: [...receipt.evidenceIds],
        [verificationRunBrand]: true,
      }
  const result = valid({
    ...replayCore(replay),
    status: "verifying" as const,
    verification: {
      requiredSuccessfulRuns: replay.verification.requiredSuccessfulRuns,
      runs: [...replay.verification.runs, run],
    },
    [verifyingReplayBrand]: true as const,
  })
  if (result.ok) {
    registerVerifyingReplay(result.value)
    result.value.verification.runs.forEach((run) => registerVerificationRun(run))
  }
  return result
}

export function validateReplayFailure(failure: unknown, path = "failure"): readonly ValidationIssue[] {
  if (!isRecord(failure)) return [issue(path, "replay failure must be an object")]
  const issues: ReturnType<typeof issue>[] = []
  if (failure.kind === "step_failed") {
    if (!isNonNegativeInteger(failure.stepIndex)) issues.push(issue(`${path}.stepIndex`, "failed step index must be a non-negative safe integer"))
    if (!isNonEmptyText(failure.message)) issues.push(issue(`${path}.message`, "failure message must not be empty"))
    validateEvidenceIds(failure.evidenceIds, `${path}.evidenceIds`, issues)
  } else if (failure.kind === "postcondition_failed") {
    issues.push(...validateCondition(failure.condition, `${path}.condition`))
    if (!isNonEmptyText(failure.message)) issues.push(issue(`${path}.message`, "failure message must not be empty"))
    validateEvidenceIds(failure.evidenceIds, `${path}.evidenceIds`, issues)
  } else if (failure.kind === "verification_failed") {
    if (!isNonEmptyText(failure.message)) issues.push(issue(`${path}.message`, "failure message must not be empty"))
    if (!isNonNegativeInteger(failure.successfulRuns)) issues.push(issue(`${path}.successfulRuns`, "successful runs must be a non-negative safe integer"))
    if (!isNonNegativeInteger(failure.requiredSuccessfulRuns) || failure.requiredSuccessfulRuns < 1) issues.push(issue(`${path}.requiredSuccessfulRuns`, "required successful runs must be a positive safe integer"))
    if (isNonNegativeInteger(failure.successfulRuns) && isNonNegativeInteger(failure.requiredSuccessfulRuns) && failure.successfulRuns >= failure.requiredSuccessfulRuns) issues.push(issue(`${path}.successfulRuns`, "successful runs must be below the required threshold for a verification failure"))
    validateEvidenceIds(failure.evidenceIds, `${path}.evidenceIds`, issues)
  } else {
    issues.push(issue(`${path}.kind`, "replay failure kind is not recognized"))
  }
  return issues
}

export function validateVerificationRuns(runs: readonly VerificationRun[], verifiedAt: IsoTimestamp, replay: VerifyingReplay): readonly ValidationIssue[] {
  const issues: ReturnType<typeof issue>[] = []
  if (!isIsoTimestamp(verifiedAt)) issues.push(issue("verifiedAt", "verifiedAt must be a timestamp"))
  if (!Array.isArray(runs)) {
    issues.push(issue("runs", "verification runs must be an array"))
    return issues
  }
  const runIds = new Set<string>()
  const sessions = new Set<string>()
  const evidenceIds = new Set<string>()
  runs.forEach((run, index) => {
    const runIssues = validateVerificationRun(run, `runs[${index}]`)
    if (runIssues.length > 0) {
      issues.push(...runIssues)
      return
    }
    if (!isNonEmptyText(run.id)) issues.push(issue(`runs[${index}].id`, "verification run id must not be empty"))
    if (runIds.has(run.id)) issues.push(issue(`runs[${index}].id`, "verification run ids must be distinct"))
    runIds.add(run.id)
    if (!isNonEmptyText(run.sessionId)) issues.push(issue(`runs[${index}].sessionId`, "session id must not be empty"))
    if (run.capabilityId !== replay.capabilityId) issues.push(issue(`runs[${index}].capabilityId`, "verification run belongs to a different capability"))
    if (run.replayVersionId !== replay.id) issues.push(issue(`runs[${index}].replayVersionId`, "verification run belongs to a different replay"))
    if (sessions.has(run.sessionId)) issues.push(issue(`runs[${index}].sessionId`, "verification runs must use distinct fresh sessions"))
    sessions.add(run.sessionId)
    if (!Array.isArray(run.evidenceIds)) return
    run.evidenceIds.forEach((evidenceId: string) => {
      if (evidenceIds.has(evidenceId)) issues.push(issue(`runs[${index}].evidenceIds`, "verification evidence must be distinct across runs"))
      evidenceIds.add(evidenceId)
    })
  })
  return issues
}

function validateVerificationRun(run: unknown, path: string): readonly ValidationIssue[] {
  if (!isRecord(run)) return [issue(path, "verification run must be an object")]
  const issues: ReturnType<typeof issue>[] = []
  if (!isIssuedVerificationRun(run) || !hasBrand(run, verificationRunBrand)) issues.push(issue(path, "verification run must come from the verification authority"))
  if (!isNonEmptyText(run.id)) issues.push(issue(`${path}.id`, "verification run id must not be empty"))
  if (!isNonEmptyText(run.sessionId)) issues.push(issue(`${path}.sessionId`, "session id must not be empty"))
  if (!isNonEmptyText(run.capabilityId)) issues.push(issue(`${path}.capabilityId`, "capability id must not be empty"))
  if (!isNonEmptyText(run.replayVersionId)) issues.push(issue(`${path}.replayVersionId`, "replay version id must not be empty"))
  if (run.freshSession !== true) issues.push(issue(`${path}.freshSession`, "verification evidence must come from a fresh session"))
  if (run.outcome !== "success" && run.outcome !== "failure") issues.push(issue(`${path}.outcome`, "verification outcome is not recognized"))
  if (run.outcome === "failure" && !isNonEmptyText(run.failureMessage)) issues.push(issue(`${path}.failureMessage`, "verification failure message must not be empty"))
  validateEvidenceIds(run.evidenceIds, `${path}.evidenceIds`, issues)
  return issues
}

function validateEvidenceIds(value: unknown, path: string, issues: ReturnType<typeof issue>[]): void {
  if (!Array.isArray(value)) {
    issues.push(issue(path, "evidence ids must be an array"))
    return
  }
  if (value.length === 0) issues.push(issue(path, "evidence ids must not be empty"))
  value.forEach((evidenceId) => {
    if (!isNonEmptyText(evidenceId)) issues.push(issue(path, "evidence ids must not be empty"))
  })
  if (new Set(value).size !== value.length) issues.push(issue(path, "evidence ids must be distinct"))
}

function replayCore(replay: VerifyingReplay): {
  readonly id: ReplayVersionId
  readonly capabilityId: CapabilityId
  readonly version: number
  readonly steps: VerifyingReplay["steps"]
  readonly confidence: number
  readonly discoveredFromExperimentId: VerifyingReplay["discoveredFromExperimentId"]
  readonly supersedes?: ReplayVersionId
  readonly createdAt: IsoTimestamp
} {
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

function hasBrand(value: unknown, brand: symbol): boolean {
  return value !== null && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, brand) && (value as Record<symbol, unknown>)[brand] === true
}
