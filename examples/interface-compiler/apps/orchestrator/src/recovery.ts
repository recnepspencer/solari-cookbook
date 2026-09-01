import type {
  ReplayRecoveryPort,
  ReplayRecoveryResult,
  ReplacementVerificationReceipt,
} from "@interface-compiler/worth-adapter"
import type {
  CandidateReplayInput,
  CapabilityProjection,
  IsoTimestamp,
  OperationContext,
  ReplayProjection,
} from "@interface-compiler/domain"

type AppliedRecovery = Extract<ReplayRecoveryResult, { readonly kind: "applied" }>

export interface ExploredReplacementRequest {
  /** The WORTH response that returned the failed capability to exploration. */
  readonly degradation: AppliedRecovery
  /** A concrete replay discovered by the exploratory path. */
  readonly candidate: CandidateReplayInput
  /** Concrete verifier-boundary receipts; WORTH validates and retains their freshness claims. */
  readonly verificationReceipts: readonly ReplacementVerificationReceipt[]
  readonly verifiedAt: IsoTimestamp
}

export type ExploredReplacementResult =
  | { readonly kind: "activated"; readonly capability: Extract<CapabilityProjection, { readonly status: "healthy" }>; readonly replay: Extract<ReplayProjection, { readonly status: "active" }>; readonly authority: AppliedRecovery }
  | { readonly kind: "blocked"; readonly stage: "degradation" | "candidate" | "verification" | "activation"; readonly authority: ReplayRecoveryResult; readonly receiptIndex?: number; readonly message: string }

/**
 * Advances only through WORTH-issued projections. The function retains no
 * lifecycle store: each expected revision comes from the preceding public
 * facade response and WORTH decides every transition.
 */
export async function activateExploredReplacement(
  worth: ReplayRecoveryPort,
  request: ExploredReplacementRequest,
  context: OperationContext,
): Promise<ExploredReplacementResult> {
  const degraded = request.degradation
  if (degraded.capability.status !== "degraded" || degraded.replay.status !== "broken" || degraded.capability.id !== degraded.replay.capabilityId || degraded.capability.brokenReplayVersionId !== degraded.replay.id) {
    return { kind: "blocked", stage: "degradation", authority: degraded, message: "WORTH did not issue a matching degraded capability and broken replay" }
  }

  const candidate = await worth.acceptReplacementCandidate({
    capabilityId: degraded.capability.id,
    brokenReplayVersionId: degraded.replay.id,
    expectedCapabilityRevision: degraded.capability.revision,
    expectedBrokenReplayRevision: degraded.replay.revision,
    candidate: request.candidate,
  }, context)
  if (candidate.kind !== "applied" || candidate.capability.status !== "verifying" || candidate.replay.status !== "verifying" || candidate.capability.id !== degraded.capability.id || candidate.replay.id !== request.candidate.id || candidate.replay.capabilityId !== degraded.capability.id || candidate.capability.candidateReplayVersionId !== candidate.replay.id) {
    return { kind: "blocked", stage: "candidate", authority: candidate, message: "WORTH did not admit the explored candidate into the verifying lineage" }
  }

  let current = candidate
  for (const [receiptIndex, receipt] of request.verificationReceipts.entries()) {
    const recorded = await worth.recordReplacementVerification({
      capabilityId: current.capability.id,
      replayVersionId: current.replay.id,
      expectedCapabilityRevision: current.capability.revision,
      expectedReplayRevision: current.replay.revision,
      receipt,
    }, context)
    if (recorded.kind !== "applied" || recorded.capability.status !== "verifying" || recorded.replay.status !== "verifying" || recorded.capability.id !== current.capability.id || recorded.replay.id !== current.replay.id || recorded.replay.revision <= current.replay.revision) {
      return { kind: "blocked", stage: "verification", authority: recorded, receiptIndex, message: "WORTH did not retain the replacement verification receipt" }
    }
    current = recorded
  }

  const activated = await worth.activateReplacement({
    capabilityId: current.capability.id,
    replayVersionId: current.replay.id,
    expectedCapabilityRevision: current.capability.revision,
    expectedReplayRevision: current.replay.revision,
    verifiedAt: request.verifiedAt,
  }, context)
  if (activated.kind !== "applied" || activated.capability.status !== "healthy" || activated.replay.status !== "active" || activated.capability.id !== degraded.capability.id || activated.capability.activeReplayVersionId !== request.candidate.id || activated.replay.id !== request.candidate.id || activated.replay.capabilityId !== degraded.capability.id) {
    return { kind: "blocked", stage: "activation", authority: activated, message: "WORTH did not activate the verified replacement lineage" }
  }
  return { kind: "activated", capability: activated.capability, replay: activated.replay, authority: activated }
}
