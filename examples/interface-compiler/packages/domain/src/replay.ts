import { validateCondition, type Condition } from "./schema.js"
import type { CapabilityId, EvidenceId, ExperimentId, IsoTimestamp, ReplayVersionId, SessionId, VerificationRunId } from "./identity.js"
import { invalid, isIsoTimestamp, isNonEmptyText, isNonNegativeFiniteNumber, isNonNegativeInteger, isRecord, issue, valid, type ValidationIssue, type ValidationResult } from "./validation.js"

const candidateReplayBrand: unique symbol = Symbol("CandidateReplay")
const verifyingReplayBrand: unique symbol = Symbol("VerifyingReplay")
const activeReplayBrand: unique symbol = Symbol("ActiveReplay")
const brokenReplayBrand: unique symbol = Symbol("BrokenReplay")
const supersededReplayBrand: unique symbol = Symbol("SupersededReplay")
const verificationRunBrand: unique symbol = Symbol("VerificationRun")

export interface LocatorTarget {
  readonly semanticDescription: string
  readonly role?: string
  readonly name?: string
  readonly text?: string
  readonly selector?: string
}

export interface NavigateStep {
  readonly type: "navigate"
  readonly url: string
}

export interface ClickStep {
  readonly type: "click"
  readonly target: LocatorTarget
}

export interface FillStep {
  readonly type: "fill"
  readonly target: LocatorTarget
  readonly value: string
}

export interface SelectStep {
  readonly type: "select"
  readonly target: LocatorTarget
  readonly value: string
}

export interface WaitStep {
  readonly type: "wait"
  readonly milliseconds: number
}

export interface ReadStep {
  readonly type: "read"
  readonly target: LocatorTarget
  readonly outputKey: string
}

export interface AssertStep {
  readonly type: "assert"
  readonly condition: Condition
}

export type ReplayStep =
  | NavigateStep
  | ClickStep
  | FillStep
  | SelectStep
  | WaitStep
  | ReadStep
  | AssertStep

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

export type VerificationRun =
  | {
      readonly id: VerificationRunId
      readonly sessionId: SessionId
      readonly freshSession: true
      readonly outcome: "success"
      readonly evidenceIds: readonly EvidenceId[]
      readonly [verificationRunBrand]: true
    }
  | {
      readonly id: VerificationRunId
      readonly sessionId: SessionId
      readonly freshSession: true
      readonly outcome: "failure"
      readonly failureMessage: string
      readonly evidenceIds: readonly EvidenceId[]
      readonly [verificationRunBrand]: true
    }

export type VerificationRunReceipt =
  | {
      readonly id: VerificationRunId
      readonly sessionId: SessionId
      readonly sessionFreshness: "fresh"
      readonly outcome: "success"
      readonly evidenceIds: readonly EvidenceId[]
    }
  | {
      readonly id: VerificationRunId
      readonly sessionId: SessionId
      readonly sessionFreshness: "fresh"
      readonly outcome: "failure"
      readonly failureMessage: string
      readonly evidenceIds: readonly EvidenceId[]
    }

/**
 * Records one adapter-owned verification result on a verifying replay.
 * The returned run is an opaque proof; callers cannot construct the proof
 * accepted by completion by merely setting `freshSession` on an object.
 */
export function recordVerificationRun(
  replay: VerifyingReplay,
  receipt: VerificationRunReceipt,
): ValidationResult<VerifyingReplay> {
  const issues: ReturnType<typeof issue>[] = []
  if (!hasBrand(replay, verifyingReplayBrand)) return invalid(issue("replay", "verification runs can only be recorded on a verifying replay"))
  if (!isRecord(receipt)) return invalid(issue("receipt", "verification receipt must be an object"))
  if (!isNonEmptyText(receipt.id)) issues.push(issue("id", "verification run id must not be empty"))
  if (!isNonEmptyText(receipt.sessionId)) issues.push(issue("sessionId", "session id must not be empty"))
  if (receipt.sessionFreshness !== "fresh") issues.push(issue("sessionFreshness", "verification must use a fresh Solari session"))
  if (!Array.isArray(receipt.evidenceIds) || receipt.evidenceIds.length === 0) {
    issues.push(issue("evidenceIds", "verification run must retain at least one evidence id"))
  } else if (receipt.evidenceIds.some((evidenceId) => !isNonEmptyText(evidenceId))) {
    issues.push(issue("evidenceIds", "verification evidence ids must not be empty"))
  }
  if (receipt.outcome !== "success" && receipt.outcome !== "failure") {
    issues.push(issue("outcome", "verification outcome must be success or failure"))
  }
  if (receipt.outcome === "failure" && !isNonEmptyText(receipt.failureMessage)) {
    issues.push(issue("failureMessage", "verification failure message must not be empty"))
  }
  if (replay.verification.runs.some((run) => run.id === receipt.id)) issues.push(issue("id", "verification run ids must be distinct"))
  if (replay.verification.runs.some((run) => run.sessionId === receipt.sessionId)) issues.push(issue("sessionId", "verification runs must use distinct fresh sessions"))
  const existingEvidenceIds = new Set(replay.verification.runs.flatMap((run) => [...run.evidenceIds]))
  if (Array.isArray(receipt.evidenceIds) && receipt.evidenceIds.some((evidenceId) => existingEvidenceIds.has(evidenceId))) {
    issues.push(issue("evidenceIds", "verification evidence must be distinct across runs"))
  }
  if (Array.isArray(receipt.evidenceIds) && new Set(receipt.evidenceIds).size !== receipt.evidenceIds.length) {
    issues.push(issue("evidenceIds", "verification evidence ids must be distinct"))
  }
  if (issues.length > 0) return invalid(...issues)

  const run: VerificationRun = receipt.outcome === "success"
    ? {
        id: receipt.id,
        sessionId: receipt.sessionId,
        freshSession: true,
        outcome: "success",
        evidenceIds: [...receipt.evidenceIds],
        [verificationRunBrand]: true,
      }
    : {
        id: receipt.id,
        sessionId: receipt.sessionId,
        freshSession: true,
        outcome: "failure",
        failureMessage: receipt.failureMessage,
        evidenceIds: [...receipt.evidenceIds],
        [verificationRunBrand]: true,
      }
  return valid({
    ...replayCore(replay),
    status: "verifying" as const,
    verification: {
      requiredSuccessfulRuns: replay.verification.requiredSuccessfulRuns,
      runs: [...replay.verification.runs, run],
    },
    [verifyingReplayBrand]: true as const,
  })
}

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
  const issues = validateReplayCore(input)
  return issues.length > 0
    ? invalid(...issues)
    : valid(
        Object.freeze({
          id: input.id,
          capabilityId: input.capabilityId,
          version: input.version,
          steps: Object.freeze([...input.steps]),
          confidence: input.confidence,
          discoveredFromExperimentId: input.discoveredFromExperimentId,
          ...(input.supersedes === undefined ? {} : { supersedes: input.supersedes }),
          createdAt: input.createdAt,
          status: "candidate" as const,
          [candidateReplayBrand]: true as const,
        }),
      )
}

export function beginReplayVerification(
  replay: CandidateReplay,
  requiredSuccessfulRuns = 3,
): ValidationResult<VerifyingReplay> {
  if (!hasBrand(replay, candidateReplayBrand)) {
    return invalid(issue("replay", "candidate replay must come from createCandidateReplay"))
  }
  if (!isNonNegativeInteger(requiredSuccessfulRuns) || requiredSuccessfulRuns < 1) {
    return invalid(issue("requiredSuccessfulRuns", "required successful runs must be a positive safe integer"))
  }

  return valid(
    Object.freeze({
      ...replayCore(replay),
      status: "verifying" as const,
      [verifyingReplayBrand]: true as const,
      verification: Object.freeze({
        requiredSuccessfulRuns,
        runs: Object.freeze([]),
      }),
    }),
  )
}

export function completeReplayVerification(
  replay: VerifyingReplay,
  verifiedAt: IsoTimestamp,
): ValidationResult<ActiveReplay | BrokenReplay> {
  if (!hasBrand(replay, verifyingReplayBrand)) {
    return invalid(issue("replay", "verifying replay must come from beginReplayVerification"))
  }
  const runIssues = validateVerificationRuns(replay.verification.runs, verifiedAt)
  if (runIssues.length > 0) return invalid(...runIssues)
  if (replay.verification.runs.length === 0) return invalid(issue("runs", "verification must retain at least one run"))

  const successfulRuns = replay.verification.runs.filter((run) => run.outcome === "success").length
  const copiedRuns = Object.freeze([...replay.verification.runs])
  const verification = Object.freeze({
    requiredSuccessfulRuns: replay.verification.requiredSuccessfulRuns,
    runs: copiedRuns,
  })

  if (successfulRuns >= replay.verification.requiredSuccessfulRuns) {
    return valid(
      Object.freeze({
        ...replayCore(replay),
        status: "active" as const,
        [activeReplayBrand]: true as const,
        verifiedAt,
        verification,
      }),
    )
  }

  const evidenceIds = Object.freeze(replay.verification.runs.flatMap((run) => [...run.evidenceIds]))
  return valid(
    Object.freeze({
      ...replayCore(replay),
      status: "broken" as const,
      [brokenReplayBrand]: true as const,
      brokenAt: verifiedAt,
      failure: {
        kind: "verification_failed" as const,
        message: "replay did not reach the required number of successful fresh-session verifications",
        successfulRuns,
        requiredSuccessfulRuns: replay.verification.requiredSuccessfulRuns,
        evidenceIds,
      },
    }),
  )
}

export function markReplayBroken(
  replay: ActiveReplay,
  failure: ReplayFailure,
  brokenAt: IsoTimestamp,
): ValidationResult<BrokenReplay> {
  if (!isActiveReplay(replay)) return invalid(issue("replay", "active replay must come from completeReplayVerification"))
  const failureIssues = validateReplayFailure(failure)
  if (failureIssues.length > 0) return invalid(...failureIssues)
  if (!isIsoTimestamp(brokenAt)) return invalid(issue("brokenAt", "brokenAt must be a timestamp"))
  return valid({ ...replayCore(replay), status: "broken" as const, failure, brokenAt, [brokenReplayBrand]: true as const })
}

export function supersedeReplay(
  replay: CandidateReplay | BrokenReplay,
  successor: CandidateReplay | VerifyingReplay | ActiveReplay,
  supersededAt: IsoTimestamp,
): ValidationResult<SupersededReplay> {
  const issues: ReturnType<typeof issue>[] = []
  if (!hasBrand(replay, candidateReplayBrand) && !hasBrand(replay, brokenReplayBrand)) {
    issues.push(issue("replay", "replay must come from a domain lifecycle transition"))
  }
  if (!hasBrand(successor, candidateReplayBrand) && !hasBrand(successor, verifyingReplayBrand) && !hasBrand(successor, activeReplayBrand)) {
    issues.push(issue("successor", "successor must come from a domain lifecycle transition"))
  }
  const replayIsValid = isCandidateReplay(replay) || isBrokenReplay(replay)
  const successorIsValid = isCandidateReplay(successor) || hasBrand(successor, verifyingReplayBrand) || isActiveReplay(successor)
  if (!replayIsValid) issues.push(issue("replay", "replay must come from a domain lifecycle transition"))
  if (!successorIsValid) issues.push(issue("successor", "successor must come from a domain lifecycle transition"))
  if (!replayIsValid || !successorIsValid) return invalid(...issues)
  if (successor.capabilityId !== replay.capabilityId) issues.push(issue("successor.capabilityId", "successor belongs to a different capability"))
  if (successor.id === replay.id) issues.push(issue("successor.id", "a replay cannot supersede itself"))
  if (successor.supersedes !== replay.id) issues.push(issue("successor.supersedes", "successor lineage must identify the replay it supersedes"))
  if (!isIsoTimestamp(supersededAt)) issues.push(issue("supersededAt", "supersededAt must be a timestamp"))
  if (issues.length > 0) return invalid(...issues)

  return valid(
    Object.freeze({
      ...replayCore(replay),
      status: "superseded" as const,
      supersededBy: successor.id,
      supersededAt,
      [supersededReplayBrand]: true as const,
    }),
  )
}

export function successfulVerificationCount(replay: VerifyingReplay | ActiveReplay): number {
  return replay.verification.runs.filter((run) => run.outcome === "success").length
}

export function isCandidateReplay(value: unknown): value is CandidateReplay {
  return hasBrand(value, candidateReplayBrand)
}

export function isActiveReplay(value: unknown): value is ActiveReplay {
  return hasBrand(value, activeReplayBrand)
}

export function isBrokenReplay(value: unknown): value is BrokenReplay {
  return hasBrand(value, brokenReplayBrand)
}

export function isVerifyingReplay(value: unknown): value is VerifyingReplay {
  return hasBrand(value, verifyingReplayBrand)
}

export function validateReplayFailure(failure: unknown, path = "failure"): readonly ValidationIssue[] {
  if (!isRecord(failure)) return [issue(path, "replay failure must be an object")]
  const issues: ValidationIssue[] = []
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

export function validateReplayStep(step: unknown, index = 0): readonly ValidationIssue[] {
  if (!isRecord(step)) return [issue(`steps[${index}]`, "replay step must be an object")]

  switch (step.type) {
    case "navigate":
      return isNonEmptyText(step.url) ? [] : [issue(`steps[${index}].url`, "navigate URL must not be empty")]
    case "click":
      return validateLocatorTarget(step.target, index)
    case "fill":
      return [
        ...validateLocatorTarget(step.target, index),
        ...(typeof step.value === "string" ? [] : [issue(`steps[${index}].value`, "fill value must be a string")]),
      ]
    case "select":
      return [
        ...validateLocatorTarget(step.target, index),
        ...(typeof step.value === "string" ? [] : [issue(`steps[${index}].value`, "select value must be a string")]),
      ]
    case "wait":
      return isNonNegativeFiniteNumber(step.milliseconds) && step.milliseconds > 0
        ? []
        : [issue(`steps[${index}].milliseconds`, "wait duration must be finite and positive")]
    case "read":
      return [
        ...validateLocatorTarget(step.target, index),
        ...(isNonEmptyText(step.outputKey) ? [] : [issue(`steps[${index}].outputKey`, "read output key must not be empty")]),
      ]
    case "assert":
      return validateCondition(step.condition, `steps[${index}].condition`)
    default:
      return [issue(`steps[${index}].type`, "replay step kind is not recognized")]
  }
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
  if (!isIsoTimestamp(input.createdAt)) issues.push(issue("createdAt", "createdAt must be a timestamp"))

  if (!Array.isArray(input.steps)) return issues
  input.steps.forEach((step, index) => issues.push(...validateReplayStep(step, index)))
  return issues
}

function validateLocatorTarget(target: unknown, index: number): readonly ValidationIssue[] {
  if (!isRecord(target)) return [issue(`steps[${index}].target`, "replay locator target must be an object")]
  const issues: ReturnType<typeof issue>[] = []
  if (!isNonEmptyText(target.semanticDescription)) issues.push(issue(`steps[${index}].target.semanticDescription`, "semantic description must not be empty"))
  for (const field of ["role", "name", "text", "selector"] as const) {
    if (target[field] !== undefined && typeof target[field] !== "string") issues.push(issue(`steps[${index}].target.${field}`, `${field} must be a string when present`))
  }
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

function validateVerificationRuns(runs: readonly VerificationRun[], verifiedAt: IsoTimestamp): ReturnType<typeof issue>[] {
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
    if (sessions.has(run.sessionId)) issues.push(issue(`runs[${index}].sessionId`, "verification runs must use distinct fresh sessions"))
    sessions.add(run.sessionId)
    if (run.freshSession !== true) issues.push(issue(`runs[${index}].freshSession`, "verification evidence must come from a fresh session"))
    if (!Array.isArray(run.evidenceIds)) {
      issues.push(issue(`runs[${index}].evidenceIds`, "verification run evidence must be an array"))
      return
    }
    if (run.evidenceIds.length === 0) issues.push(issue(`runs[${index}].evidenceIds`, "verification run must retain evidence"))
    run.evidenceIds.forEach((evidenceId: string) => {
      if (!isNonEmptyText(evidenceId)) issues.push(issue(`runs[${index}].evidenceIds`, "verification evidence ids must not be empty"))
      if (evidenceIds.has(evidenceId)) issues.push(issue(`runs[${index}].evidenceIds`, "verification evidence must be distinct across runs"))
      evidenceIds.add(evidenceId)
    })
  })
  return issues
}

function validateVerificationRun(run: unknown, path: string): readonly ValidationIssue[] {
  if (!isRecord(run)) return [issue(path, "verification run must be an object")]
  const issues: ValidationIssue[] = []
  if (!hasBrand(run, verificationRunBrand)) issues.push(issue(path, "verification run must come from the verification authority"))
  if (!isNonEmptyText(run.id)) issues.push(issue(`${path}.id`, "verification run id must not be empty"))
  if (!isNonEmptyText(run.sessionId)) issues.push(issue(`${path}.sessionId`, "session id must not be empty"))
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
}

function hasBrand(value: unknown, brand: symbol): boolean {
  return value !== null && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, brand) && (value as Record<symbol, unknown>)[brand] === true
}
