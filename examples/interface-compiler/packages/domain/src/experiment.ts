import type { CapabilityId, EvidenceId, ExperimentId, IsoTimestamp } from "./identity.js"
import { validateReplayStep, type ReplayStep } from "./replay.js"
import { validateCondition, type Condition } from "./schema.js"
import { invalid, isIsoTimestamp, isNonEmptyText, isRecord, issue, valid, type ValidationResult } from "./validation.js"

export interface ExperimentDefinition {
  readonly id: ExperimentId
  readonly capabilityId?: CapabilityId
  readonly hypothesis: string
  readonly proposedSteps: readonly ReplayStep[]
  readonly expectedOutcome: readonly Condition[]
}

export interface PendingExperiment extends ExperimentDefinition {
  readonly result: "pending"
  readonly evidenceIds: readonly []
}

export interface ResolvedExperiment extends ExperimentDefinition {
  readonly result: "success" | "failure" | "inconclusive"
  readonly evidenceIds: readonly EvidenceId[]
  readonly resolvedAt: IsoTimestamp
}

export type Experiment = PendingExperiment | ResolvedExperiment

export function startExperiment(input: ExperimentDefinition): ValidationResult<PendingExperiment> {
  const issues = validateExperimentDefinition(input)
  return issues.length > 0
    ? invalid(...issues)
    : valid(
        Object.freeze({
          ...input,
          result: "pending" as const,
          evidenceIds: Object.freeze([]) as readonly [],
          proposedSteps: Object.freeze([...input.proposedSteps]),
          expectedOutcome: Object.freeze([...input.expectedOutcome]),
        }),
      )
}

export function resolveExperiment(
  experiment: PendingExperiment,
  result: ResolvedExperiment["result"],
  evidenceIds: readonly EvidenceId[],
  resolvedAt: IsoTimestamp,
): ValidationResult<ResolvedExperiment> {
  const issues: ReturnType<typeof issue>[] = []
  if (!isRecord(experiment) || experiment.result !== "pending") {
    return invalid(issue("experiment", "only a pending experiment can be resolved"))
  }
  if (result !== "success" && result !== "failure" && result !== "inconclusive") {
    issues.push(issue("result", "experiment result is not recognized"))
  }
  if (!Array.isArray(evidenceIds) || evidenceIds.length === 0) {
    issues.push(issue("evidenceIds", "a resolved experiment must retain evidence"))
  } else if (evidenceIds.some((evidenceId) => !isNonEmptyText(evidenceId))) {
    issues.push(issue("evidenceIds", "evidence ids must not be empty"))
  }
  if (Array.isArray(evidenceIds) && new Set(evidenceIds).size !== evidenceIds.length) issues.push(issue("evidenceIds", "evidence ids must be distinct"))
  if (!isIsoTimestamp(resolvedAt)) issues.push(issue("resolvedAt", "resolvedAt must be a timestamp"))
  if (issues.length > 0) return invalid(...issues)

  return valid(
    Object.freeze({
      ...experiment,
      result,
      evidenceIds: Object.freeze([...evidenceIds]),
      resolvedAt,
    }),
  )
}

export function validateExperimentDefinition(input: ExperimentDefinition): ReturnType<typeof issue>[] {
  const issues: ReturnType<typeof issue>[] = []
  if (!input || typeof input !== "object") return [issue("experiment", "experiment must be an object")]
  if (!isNonEmptyText(input.id)) issues.push(issue("id", "experiment id must not be empty"))
  if (!isNonEmptyText(input.hypothesis)) issues.push(issue("hypothesis", "hypothesis must not be empty"))
  if (!Array.isArray(input.proposedSteps)) issues.push(issue("proposedSteps", "proposed steps must be an array"))
  if (!Array.isArray(input.expectedOutcome)) issues.push(issue("expectedOutcome", "expected outcome must be an array"))
  if (Array.isArray(input.proposedSteps)) input.proposedSteps.forEach((step, index) => issues.push(...validateReplayStep(step, index)))
  if (Array.isArray(input.expectedOutcome)) input.expectedOutcome.forEach((condition, index) => issues.push(...validateCondition(condition, `expectedOutcome[${index}]`)))
  return issues
}
