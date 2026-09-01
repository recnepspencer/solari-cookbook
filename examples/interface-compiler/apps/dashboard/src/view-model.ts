import type {
  CapabilityId,
  Evidence,
  EvidenceId,
} from "@interface-compiler/domain"
import type {
  CapabilityEconomicsProjection,
  DashboardCapabilityProjection,
  DashboardEvidenceProjection,
  DashboardReplayProjection,
  DashboardReplayVerificationProjection,
  DashboardVerificationPosture,
  WorthDashboardProjection,
} from "./dashboard-contract.js"

/** A verification posture explicitly returned by Worth Query, plus no projection. */
export type VerificationPosture = DashboardVerificationPosture | "unavailable"

export interface VerificationSummary extends Omit<DashboardReplayVerificationProjection, "posture"> {
  readonly posture: VerificationPosture
  readonly replayStatus: DashboardReplayProjection["status"] | "missing"
}

export type EvidencePosture = "present" | "failed" | "missing"

export interface EvidenceView {
  readonly id: EvidenceId
  readonly evidence: Evidence | null
  readonly posture: EvidencePosture
  readonly label: string
  readonly detail: string
  readonly reference?: string
}

export interface DashboardViewModel {
  readonly projection: WorthDashboardProjection
  readonly selectedCapability: DashboardCapabilityProjection | null
  readonly selectedCapabilityId: CapabilityId | null
  readonly selectedReplay: DashboardReplayProjection | null
  readonly selectedReplayResolution: ReplaySelectionResolution
  readonly selectedReplays: readonly DashboardReplayProjection[]
  readonly selectedVerification: VerificationSummary
  readonly selectedEvidence: readonly EvidenceView[]
  readonly selectedEconomics: CapabilityEconomicsProjection | null
  readonly selectedExecutions: WorthDashboardProjection["executions"]
  readonly recentExecutions: WorthDashboardProjection["executions"]
  readonly activeSessionCount: number
}

export function createDashboardView(projection: WorthDashboardProjection, selectedCapabilityId?: string): DashboardViewModel {
  const selectedCapability = chooseCapability(projection.capabilities, selectedCapabilityId)
  const capabilityId = selectedCapability?.capability.id ?? null
  const selectedReplays = capabilityId === null ? [] : sortReplays(projection.replays.filter((replay) => replay.capabilityId === capabilityId))
  const replaySelection = resolveCapabilityReplay(selectedCapability, selectedReplays)
  const selectedReplay = replaySelection.replay
  const selectedVerification = selectVerificationSummary(selectedReplay)
  const selectedEvidence = buildEvidenceViews(projection.evidence, selectedVerification)
  const recentExecutions = sortExecutions(projection.executions)
  const selectedExecutions = capabilityId === null ? [] : recentExecutions.filter((execution) => execution.capabilityId === capabilityId)

  return {
    projection,
    selectedCapability,
    selectedCapabilityId: capabilityId,
    selectedReplay,
    selectedReplayResolution: replaySelection.resolution,
    selectedReplays,
    selectedVerification,
    selectedEvidence,
    selectedEconomics: capabilityId === null ? null : projection.economics.find((economics) => economics.capabilityId === capabilityId) ?? null,
    selectedExecutions,
    recentExecutions,
    activeSessionCount: projection.sessions.filter((session) => session.status === "active").length,
  }
}

/**
 * Selects Worth's verification projection without recalculating its posture,
 * thresholds, or evidence result. The only locally-created state is the
 * explicit absence of a replay projection.
 */
export function selectVerificationSummary(replay: DashboardReplayProjection | null | undefined): VerificationSummary {
  if (replay === undefined || replay === null) {
    return {
      posture: "unavailable",
      replayStatus: "missing",
      requiredSuccessfulRuns: null,
      successfulRuns: 0,
      failedRuns: 0,
      runs: [],
      referencedEvidenceIds: [],
      failedEvidenceIds: [],
      missingEvidenceIds: [],
      explanation: "No replay verification projection was returned for this capability.",
    }
  }

  return {
    replayStatus: replay.status,
    posture: replay.verification.posture,
    requiredSuccessfulRuns: replay.verification.requiredSuccessfulRuns,
    successfulRuns: replay.verification.successfulRuns,
    failedRuns: replay.verification.failedRuns,
    runs: [...replay.verification.runs],
    referencedEvidenceIds: [...replay.verification.referencedEvidenceIds],
    failedEvidenceIds: [...replay.verification.failedEvidenceIds],
    missingEvidenceIds: [...replay.verification.missingEvidenceIds],
    explanation: replay.verification.explanation,
  }
}

export function buildEvidenceViews(
  evidence: readonly DashboardEvidenceProjection[],
  verification: Pick<VerificationSummary, "referencedEvidenceIds" | "missingEvidenceIds">,
): readonly EvidenceView[] {
  const referenced = new Set(verification.referencedEvidenceIds.map(String))
  const views = evidence.filter((item) => referenced.has(String(evidenceProjectionId(item)))).map(toEvidenceView)
  const knownIds = new Set(views.map((view) => String(view.id)))
  const missingViews = uniqueIds(verification.missingEvidenceIds)
    .filter((id) => !knownIds.has(String(id)))
    .map((id): EvidenceView => ({
      id,
      evidence: null,
      posture: "missing",
      label: "Missing evidence",
      detail: "Worth's verification projection references this evidence, but no evidence value was returned.",
    }))
  return [...views, ...missingViews]
}

function chooseCapability(
  capabilities: readonly DashboardCapabilityProjection[],
  selectedCapabilityId: string | undefined,
): DashboardCapabilityProjection | null {
  if (capabilities.length === 0) return null
  if (selectedCapabilityId !== undefined) {
    const requested = capabilities.find((capability) => String(capability.capability.id) === selectedCapabilityId)
    if (requested !== undefined) return requested
  }
  return capabilities[0]
}

export type ReplaySelectionResolution = "resolved" | "missing_pointer" | "inconsistent_pointer" | "not_applicable"

export function resolveCapabilityReplay(
  capability: DashboardCapabilityProjection | null,
  replays: readonly DashboardReplayProjection[],
): { readonly replay: DashboardReplayProjection | null; readonly resolution: ReplaySelectionResolution } {
  if (capability === null) return { replay: null, resolution: "not_applicable" }
  const pointer = lifecycleReplayId(capability)
  if (pointer === undefined) return { replay: null, resolution: "not_applicable" }
  const replay = replays.find((candidate) => String(candidate.id) === pointer)
  if (replay === undefined) return { replay: null, resolution: "missing_pointer" }
  return replayMatchesLifecycle(capability, replay)
    ? { replay, resolution: "resolved" }
    : { replay: null, resolution: "inconsistent_pointer" }
}

function lifecycleReplayId(capability: DashboardCapabilityProjection): string | undefined {
  switch (capability.capability.status) {
    case "healthy":
      return String(capability.capability.activeReplayVersionId)
    case "verifying":
      return String(capability.capability.candidateReplayVersionId)
    case "degraded":
      return String(capability.capability.brokenReplayVersionId)
    case "discovering":
      return undefined
  }
}

function replayMatchesLifecycle(capability: DashboardCapabilityProjection, replay: DashboardReplayProjection): boolean {
  switch (capability.capability.status) {
    case "healthy":
      return replay.status === "active"
    case "verifying":
      return replay.status === "candidate" || replay.status === "verifying"
    case "degraded":
      return replay.status === "broken"
    case "discovering":
      return false
  }
}

function sortReplays(replays: readonly DashboardReplayProjection[]): readonly DashboardReplayProjection[] {
  return [...replays].sort((left, right) => right.version - left.version)
}

function sortExecutions(executions: WorthDashboardProjection["executions"]): WorthDashboardProjection["executions"] {
  return [...executions].sort((left, right) => right.metrics.startedAt.localeCompare(left.metrics.startedAt))
}

function evidenceProjectionId(item: DashboardEvidenceProjection): EvidenceId {
  return item.status === "missing" ? item.id : item.evidence.id
}

function toEvidenceView(item: DashboardEvidenceProjection): EvidenceView {
  if (item.status === "missing") {
    return {
      id: item.id,
      evidence: null,
      posture: "missing",
      label: item.label ?? "Missing evidence",
      detail: "Worth identified this evidence record, but it was not available in the current projection.",
      ...(item.reference === undefined ? {} : { reference: item.reference }),
    }
  }

  const reference = item.reference ?? evidenceReference(item.evidence)
  return {
    id: item.evidence.id,
    evidence: item.evidence,
    posture: item.status,
    label: item.label ?? evidenceLabel(item.evidence),
    detail: evidenceDetail(item.evidence),
    ...(reference === undefined ? {} : { reference }),
  }
}

function evidenceReference(evidence: Evidence): string | undefined {
  switch (evidence.kind) {
    case "solari_session":
      return evidence.recordingRef
    case "observation":
      return evidence.screenshotRef ?? evidence.snapshotRef
    case "experiment":
    case "postcondition":
    case "failure":
      return undefined
  }
}

function evidenceLabel(evidence: Evidence): string {
  switch (evidence.kind) {
    case "solari_session":
      return "Solari session recording"
    case "observation":
      return "Browser observation"
    case "experiment":
      return "Experiment evidence"
    case "postcondition":
      return "Postcondition result"
    case "failure":
      return "Failure evidence"
  }
}

function evidenceDetail(evidence: Evidence): string {
  switch (evidence.kind) {
    case "solari_session":
      return `Session ${String(evidence.sessionId)}`
    case "observation":
      return `Observation ${String(evidence.observationId)}`
    case "experiment":
      return `Experiment ${String(evidence.experimentId)}`
    case "postcondition":
      return evidence.result === "satisfied" ? "Postcondition satisfied" : "Postcondition not satisfied"
    case "failure":
      return evidence.failure.message
  }
}

function uniqueIds(ids: readonly EvidenceId[]): readonly EvidenceId[] {
  const unique: EvidenceId[] = []
  const seen = new Set<string>()
  for (const id of ids) {
    const key = String(id)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(id)
  }
  return unique
}
