import type { EvidenceId, ExecutionId, ExperimentId, IsoTimestamp, ObservationId, ReplayVersionId, SessionId } from "./identity.js"
import { validateObservation, type Observation } from "./observation.js"
import { validateReplayFailure, type ReplayFailure } from "./replay.js"
import { validateCondition, type Condition } from "./schema.js"
import { invalid, isIsoTimestamp, isNonEmptyText, isRecord, issue, valid, type ValidationIssue, type ValidationResult } from "./validation.js"

const evidenceEntityBrand: unique symbol = Symbol("Evidence")

interface EvidenceCore {
  readonly id: EvidenceId
  readonly capturedAt: IsoTimestamp
}

export type EvidenceInput =
  | (EvidenceCore & {
      readonly kind: "solari_session"
      readonly sessionId: SessionId
      readonly recordingRef?: string
    })
  | (EvidenceCore & {
      readonly kind: "observation"
      readonly observationId: ObservationId
      readonly screenshotRef?: string
      readonly snapshotRef?: string
    })
  | (EvidenceCore & {
      readonly kind: "experiment"
      readonly experimentId: ExperimentId
      readonly sessionId: SessionId
      readonly beforeObservationId: ObservationId
      readonly afterObservationId: ObservationId
    })
  | (EvidenceCore & {
      readonly kind: "postcondition"
      readonly condition: Condition
      readonly result: "satisfied" | "not_satisfied"
      readonly observationId?: ObservationId
    })
  | (EvidenceCore & {
      readonly kind: "failure"
      readonly failure: ReplayFailure
      readonly executionId?: ExecutionId
      readonly replayVersionId?: ReplayVersionId
    })

export type Evidence = EvidenceInput & { readonly [evidenceEntityBrand]: true }

export function createEvidence(input: EvidenceInput): ValidationResult<Evidence> {
  const issues = validateEvidence(input)
  return issues.length > 0 ? invalid(...issues) : valid({ ...input, [evidenceEntityBrand]: true as const })
}

export function validateEvidence(input: EvidenceInput): readonly ValidationIssue[] {
  if (!input || typeof input !== "object") return [issue("evidence", "evidence must be an object")]
  const issues: ValidationIssue[] = [
    ...(isNonEmptyText(input.id) ? [] : [issue("id", "evidence id must not be empty")]),
    ...(isIsoTimestamp(input.capturedAt) ? [] : [issue("capturedAt", "capturedAt must be a timestamp")]),
  ]

  switch (input.kind) {
    case "solari_session":
      if (!isNonEmptyText(input.sessionId)) issues.push(issue("sessionId", "session id must not be empty"))
      if (input.recordingRef !== undefined && !isNonEmptyText(input.recordingRef)) issues.push(issue("recordingRef", "recording reference must not be empty"))
      break
    case "observation":
      if (!isNonEmptyText(input.observationId)) issues.push(issue("observationId", "observation id must not be empty"))
      validateOptionalReference(input.screenshotRef, "screenshotRef", issues)
      validateOptionalReference(input.snapshotRef, "snapshotRef", issues)
      break
    case "experiment":
      if (!isNonEmptyText(input.experimentId)) issues.push(issue("experimentId", "experiment id must not be empty"))
      if (!isNonEmptyText(input.sessionId)) issues.push(issue("sessionId", "session id must not be empty"))
      if (!isNonEmptyText(input.beforeObservationId)) issues.push(issue("beforeObservationId", "before observation id must not be empty"))
      if (!isNonEmptyText(input.afterObservationId)) issues.push(issue("afterObservationId", "after observation id must not be empty"))
      break
    case "postcondition":
      issues.push(...validateCondition(input.condition))
      if (input.result !== "satisfied" && input.result !== "not_satisfied") issues.push(issue("result", "postcondition result is not recognized"))
      if (input.observationId !== undefined && !isNonEmptyText(input.observationId)) issues.push(issue("observationId", "observation id must not be empty"))
      break
    case "failure":
      issues.push(...validateReplayFailure(input.failure))
      if (input.executionId !== undefined && !isNonEmptyText(input.executionId)) issues.push(issue("executionId", "execution id must not be empty"))
      if (input.replayVersionId !== undefined && !isNonEmptyText(input.replayVersionId)) issues.push(issue("replayVersionId", "replay version id must not be empty"))
      break
    default:
      issues.push(issue("kind", "evidence kind is not recognized"))
  }
  return issues
}

function validateOptionalReference(value: unknown, path: string, issues: ReturnType<typeof issue>[]): void {
  if (value !== undefined && !isNonEmptyText(value)) issues.push(issue(path, `${path} must not be empty`))
}

export function observationEvidence(
  evidenceId: EvidenceId,
  observation: Observation,
  capturedAt: IsoTimestamp,
): ValidationResult<Evidence> {
  if (!isRecord(observation)) return invalid(issue("observation", "observation is required"))
  const observationIssues = validateObservation(observation)
  if (observationIssues.length > 0) return invalid(...observationIssues)
  return createEvidence({
    kind: "observation",
    id: evidenceId,
    capturedAt,
    observationId: observation.id,
    screenshotRef: observation.screenshotRef,
    snapshotRef: observation.snapshotRef,
  })
}
