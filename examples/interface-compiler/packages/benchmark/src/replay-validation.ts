import { validateReplayStep, type ActiveReplayProjection } from "@interface-compiler/domain"
import type { BenchmarkRejection } from "./contract.js"
import { addBenchmarkRejection } from "./rejection.js"
import { isNonEmptyText, isNonNegativeSafeInteger, isRecord } from "./record-validation.js"

export function validateActiveReplayProjection(
  value: unknown,
  expectedCapabilityId: string | undefined,
  path: string,
  rejections: BenchmarkRejection[],
): ActiveReplayProjection | undefined {
  const before = rejections.length
  if (!isRecord(value)) {
    addBenchmarkRejection(rejections, "not_comparable", "compiled_replay_unverified", path, "compiled comparison requires a Worth active replay projection")
    return undefined
  }
  if (value.projectionKind !== "worth_replay" || !isNonEmptyText(value.id) || !isNonEmptyText(value.capabilityId)) addBenchmarkRejection(rejections, "not_comparable", "compiled_replay_unverified", path, "active replay projection identity is incomplete")
  if (expectedCapabilityId !== undefined && value.capabilityId !== expectedCapabilityId) addBenchmarkRejection(rejections, "not_comparable", "compiled_replay_unverified", `${path}.capabilityId`, "active replay belongs to a different capability than the compiled executions")
  if (!isNonNegativeSafeInteger(value.revision) || !isNonNegativeSafeInteger(value.version) || value.version < 1) addBenchmarkRejection(rejections, "not_comparable", "compiled_replay_unverified", path, "active replay revision and version must be non-negative safe integers")
  if (!isTimestamp(value.createdAt) || !isTimestamp(value.verifiedAt)) addBenchmarkRejection(rejections, "not_comparable", "compiled_replay_unverified", path, "active replay must carry valid creation and verification timestamps")
  if (typeof value.confidence !== "number" || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) addBenchmarkRejection(rejections, "not_comparable", "compiled_replay_unverified", `${path}.confidence`, "active replay confidence must be between zero and one")
  if (!Array.isArray(value.steps) || value.steps.length === 0) addBenchmarkRejection(rejections, "not_comparable", "compiled_replay_unverified", `${path}.steps`, "active replay must contain replay steps")
  else value.steps.forEach((step, index) => validateReplayStep(step, index).forEach((entry) => addBenchmarkRejection(rejections, "not_comparable", "compiled_replay_unverified", `${path}.steps.${entry.path}`, entry.message)))

  if (value.status !== "active") addBenchmarkRejection(rejections, "not_comparable", "compiled_replay_unverified", `${path}.status`, "compiled comparison requires an active, not provisional, replay")
  const verification = value.verification
  if (!isRecord(verification) || !isNonNegativeSafeInteger(verification.requiredSuccessfulRuns) || verification.requiredSuccessfulRuns < 1 || !Array.isArray(verification.runs)) {
    addBenchmarkRejection(rejections, "not_comparable", "compiled_replay_unverified", `${path}.verification`, "active replay verification projection is incomplete")
  } else {
    const runIds = new Set<string>()
    const sessions = new Set<string>()
    const evidenceIds = new Set<string>()
    let successfulRuns = 0
    verification.runs.forEach((run, index) => {
      const runPath = `${path}.verification.runs[${index}]`
      if (!isRecord(run) || !isNonEmptyText(run.id) || !isNonEmptyText(run.sessionId) || !isNonEmptyText(run.capabilityId) || !isNonEmptyText(run.replayVersionId) || run.freshSession !== true || !Array.isArray(run.evidenceIds)) {
        addBenchmarkRejection(rejections, "not_comparable", "compiled_replay_unverified", runPath, "verification run must be a fresh, complete Worth projection")
        return
      }
      if (run.capabilityId !== value.capabilityId || run.replayVersionId !== value.id) addBenchmarkRejection(rejections, "not_comparable", "compiled_replay_unverified", runPath, "verification run belongs to a different capability or replay")
      if (runIds.has(run.id) || sessions.has(run.sessionId)) addBenchmarkRejection(rejections, "not_comparable", "compiled_replay_unverified", runPath, "verification run ids and fresh sessions must be distinct")
      runIds.add(run.id)
      sessions.add(run.sessionId)
       if (run.outcome === "success") successfulRuns += 1
       else if (run.outcome !== "failure") addBenchmarkRejection(rejections, "not_comparable", "compiled_replay_unverified", `${runPath}.outcome`, "verification run outcome is not recognized")
       else if (!isNonEmptyText(run.failureMessage)) addBenchmarkRejection(rejections, "not_comparable", "compiled_replay_unverified", `${runPath}.failureMessage`, "failed verification runs must retain a failure message")
      if (!hasDistinctTextIds(run.evidenceIds)) addBenchmarkRejection(rejections, "not_comparable", "compiled_replay_unverified", `${runPath}.evidenceIds`, "verification runs must retain distinct evidence ids")
      else run.evidenceIds.forEach((evidenceId) => {
        if (evidenceIds.has(evidenceId)) addBenchmarkRejection(rejections, "not_comparable", "compiled_replay_unverified", `${runPath}.evidenceIds`, "verification evidence ids must be distinct across runs")
        evidenceIds.add(evidenceId)
      })
    })
    if (successfulRuns < verification.requiredSuccessfulRuns) addBenchmarkRejection(rejections, "not_comparable", "compiled_replay_unverified", `${path}.verification`, "active replay has not reached its required successful fresh-session verification count")
  }
  return rejections.length === before ? value as unknown as ActiveReplayProjection : undefined
}

export function validateReplayInspection(value: unknown, path: string, rejections: BenchmarkRejection[]): void {
  if (!isRecord(value) || value.source !== "worth") {
    addBenchmarkRejection(rejections, "not_comparable", "compiled_replay_inspection_failed", path, "active replay inspection must be a Worth result")
    return
  }
  if (value.status === "failed") addBenchmarkRejection(rejections, "not_comparable", "compiled_replay_inspection_failed", `${path}.status`, "active replay inspection failed")
  else if (value.status === "provisional") addBenchmarkRejection(rejections, "not_comparable", "compiled_replay_inspection_provisional", `${path}.status`, "active replay inspection is provisional")
  else if (value.status !== "passed") addBenchmarkRejection(rejections, "not_comparable", "compiled_replay_inspection_failed", `${path}.status`, "active replay inspection must be passed")
}

export function validateReplayEvidence(value: unknown, replay: ActiveReplayProjection | undefined, path: string, rejections: BenchmarkRejection[]): void {
  if (!isRecord(value) || value.source !== "worth") {
    addBenchmarkRejection(rejections, "not_comparable", "compiled_replay_evidence_missing", path, "active replay evidence must be a Worth result")
    return
  }
  if (value.status === "missing") addBenchmarkRejection(rejections, "not_comparable", "compiled_replay_evidence_missing", `${path}.status`, "active replay evidence is missing")
  else if (value.status === "failed") addBenchmarkRejection(rejections, "not_comparable", "compiled_replay_evidence_failed", `${path}.status`, "active replay evidence failed inspection")
  else if (value.status !== "complete") addBenchmarkRejection(rejections, "not_comparable", "compiled_replay_evidence_missing", `${path}.status`, "active replay evidence must be complete")
  if (value.status !== "complete" || !hasDistinctTextIds(value.evidenceIds)) {
    if (value.status === "complete") addBenchmarkRejection(rejections, "not_comparable", "compiled_replay_evidence_missing", `${path}.evidenceIds`, "complete active replay evidence must contain distinct ids")
    return
  }
  if (replay === undefined) return
  const evidenceIds = new Set(value.evidenceIds)
  replay.verification.runs.forEach((run, index) => {
    if (!run.evidenceIds.every((evidenceId) => evidenceIds.has(evidenceId))) addBenchmarkRejection(rejections, "not_comparable", "compiled_replay_evidence_missing", `${path}.evidenceIds`, `active replay verification evidence for run ${index + 1} was not returned completely`)
  })
}

function hasDistinctTextIds(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyText) && new Set(value).size === value.length
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
}
