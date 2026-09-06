import type { Application, CapabilityProjection, JsonValue, OperationContext, PartialEffectPosture, ReplayProjection } from "@interface-compiler/domain"
import type { ReplayRecoveryResult } from "@interface-compiler/worth-adapter"
import { verifyAdmittedCandidate, type CandidateVerificationBlockReason, type CandidateVerificationPorts } from "./candidate-verifier.js"
import { discoverReplacementReplay, type ReplayDiscoveryPorts } from "./replay-discovery.js"
import type { OperationController } from "./operation.js"
import type { OrchestratorWorthPort } from "./worth-ports.js"

type AppliedRecovery = Extract<ReplayRecoveryResult, { readonly kind: "applied" }>
type DegradedAuthority = { readonly capability: Extract<CapabilityProjection, { readonly status: "degraded" }>; readonly replay: Extract<ReplayProjection, { readonly status: "broken" }> }
type VerifyingCapability = Extract<CapabilityProjection, { readonly status: "verifying" }>
type VerifyingReplay = Extract<ReplayProjection, { readonly status: "verifying" }>
export type RecoveryContinuation =
  | { readonly kind: "degraded"; readonly degradation: DegradedAuthority }
  | { readonly kind: "verifying"; readonly capability: VerifyingCapability; readonly replay: VerifyingReplay }
export type CoordinatedRecoveryResult =
  | { readonly kind: "activated"; readonly capability: Extract<CapabilityProjection, { readonly status: "healthy" }>; readonly replay: Extract<ReplayProjection, { readonly status: "active" }> }
  | { readonly kind: "blocked"; readonly stage: "discovery" | "candidate" | "verification" | "activation"; readonly reason: CandidateVerificationBlockReason | "authority_unavailable" | "authority_changed" | "reconciliation_required" | "discovery_failed"; readonly message: string; readonly retryable: boolean; readonly continuation?: RecoveryContinuation; readonly posture?: PartialEffectPosture }
type RecoveryPorts = ReplayDiscoveryPorts & CandidateVerificationPorts & { readonly worth: OrchestratorWorthPort }

export function coordinateReplayRecovery(degradation: AppliedRecovery, application: Application, input: JsonValue | undefined, ports: RecoveryPorts, controller: OperationController): Promise<CoordinatedRecoveryResult> {
  if (degradation.capability.status !== "degraded" || degradation.replay.status !== "broken") return Promise.resolve({ kind: "blocked", stage: "discovery", reason: "authority_unavailable", message: "WORTH did not return a degraded recovery pair", retryable: false })
  return recoverFromDegradation({ capability: degradation.capability, replay: degradation.replay }, application, input, ports, controller)
}
export function resumeReplayRecovery(continuation: RecoveryContinuation, application: Application, input: JsonValue | undefined, ports: RecoveryPorts, controller: OperationController): Promise<CoordinatedRecoveryResult> {
  return continuation.kind === "degraded"
    ? recoverFromDegradation(continuation.degradation, application, input, ports, controller)
    : verifyAndActivate(continuation, application, input, ports, controller)
}

async function recoverFromDegradation(degradation: DegradedAuthority, application: Application, input: JsonValue | undefined, ports: RecoveryPorts, controller: OperationController): Promise<CoordinatedRecoveryResult> {
  const stopped = stoppedRecovery(controller.context, ports.clock.now())
  const continuation: RecoveryContinuation = { kind: "degraded", degradation }
  if (stopped !== undefined) return { kind: "blocked", stage: "discovery", ...stopped, retryable: true, continuation }
  const discovery = await discoverReplacementReplay({ degradation, application, objective: degradation.capability.description, ...(input === undefined ? {} : { input }), expectedOutcome: degradation.capability.postconditions }, ports, controller)
  if (discovery.kind !== "discovered") return { kind: "blocked", stage: "discovery", reason: discovery.reason, message: discovery.message, retryable: discovery.retryable, continuation, ...(discovery.posture === undefined ? {} : { posture: discovery.posture }) }
  const admitted = await ports.worth.acceptReplacementCandidate({ capabilityId: degradation.capability.id, brokenReplayVersionId: degradation.replay.id, expectedCapabilityRevision: degradation.capability.revision, expectedBrokenReplayRevision: degradation.replay.revision, candidate: discovery.candidate }, controller.context)
  if (admitted.kind !== "applied" || admitted.capability.status !== "verifying" || admitted.replay.status !== "verifying") return mutationBlock("candidate", "WORTH did not admit the discovered candidate before verification", admitted, continuation)
  return verifyAndActivate({ kind: "verifying", capability: admitted.capability, replay: admitted.replay }, application, input, ports, controller)
}

async function verifyAndActivate(initial: Extract<RecoveryContinuation, { readonly kind: "verifying" }>, application: Application, input: JsonValue | undefined, ports: RecoveryPorts, controller: OperationController): Promise<CoordinatedRecoveryResult> {
  let current = initial
  for (let index = current.replay.verification.runs.length; index < current.replay.verification.requiredSuccessfulRuns; index += 1) {
    const verification = await verifyAdmittedCandidate(current.capability, current.replay, application, input, ports, controller, index)
    if (verification.kind === "blocked") return { kind: "blocked", stage: "verification", reason: verification.reason, message: `${verification.classification}: ${verification.message}`, retryable: verification.retryable, continuation: current }
    const receipt = verification.receipt
    const registered = await ports.worth.registerVerificationEvidence({ capabilityId: current.capability.id, replayVersionId: current.replay.id, expectedCapabilityRevision: current.capability.revision, expectedReplayRevision: current.replay.revision, sessionId: receipt.sessionId, evidence: verification.evidence, capturedAt: receipt.completedAt }, controller.context)
    if (registered.kind !== "applied" || registered.capability.status !== "verifying" || registered.replay.status !== "verifying") return mutationBlock("verification", "WORTH did not register the Solari session receipt before accepting the verification run", registered, current)
    current = { kind: "verifying", capability: registered.capability, replay: registered.replay }
    const recorded = await ports.worth.recordReplacementVerification({ capabilityId: current.capability.id, replayVersionId: current.replay.id, expectedCapabilityRevision: current.capability.revision, expectedReplayRevision: current.replay.revision, receipt }, controller.context)
    if (receipt.outcome === "failure") {
      if (recorded.kind !== "applied" || recorded.capability.status !== "degraded" || recorded.replay.status !== "broken") return mutationBlock("verification", "WORTH did not degrade the failed candidate", recorded, current)
      return recoverFromDegradation({ capability: recorded.capability, replay: recorded.replay }, application, input, ports, controller)
    }
    if (recorded.kind !== "applied" || recorded.capability.status !== "verifying" || recorded.replay.status !== "verifying") return mutationBlock("verification", "WORTH did not retain candidate verification evidence", recorded, current)
    current = { kind: "verifying", capability: recorded.capability, replay: recorded.replay }
  }
  const activated = await ports.worth.activateReplacement({ capabilityId: current.capability.id, replayVersionId: current.replay.id, expectedCapabilityRevision: current.capability.revision, expectedReplayRevision: current.replay.revision, verifiedAt: ports.clock.now() }, controller.context)
  if (activated.kind !== "applied" || activated.capability.status !== "healthy" || activated.replay.status !== "active") return mutationBlock("activation", "WORTH did not activate the verified replacement", activated, current)
  return { kind: "activated", capability: activated.capability, replay: activated.replay }
}

function mutationBlock(stage: Extract<CoordinatedRecoveryResult, { readonly kind: "blocked" }>["stage"], message: string, result: ReplayRecoveryResult, continuation: RecoveryContinuation): Extract<CoordinatedRecoveryResult, { readonly kind: "blocked" }> {
  const detail = `${message}: ${recoveryOutcomeMessage(result)}`
  if (result.kind === "cancelled" || result.kind === "timed_out") return { kind: "blocked", stage, reason: result.kind, message: detail, retryable: true, continuation, posture: result.posture }
  if (result.kind === "authority_stopped" && (result.reason === "cancelled" || result.reason === "timed_out")) return { kind: "blocked", stage, reason: result.reason, message: detail, retryable: true, continuation }
  if (result.kind === "committed_projection_unavailable" || result.kind === "unavailable" || result.kind === "authority_stopped") return { kind: "blocked", stage, reason: "reconciliation_required", message: detail, retryable: true, continuation }
  if (result.kind === "stale" || result.kind === "applied") return { kind: "blocked", stage, reason: "authority_changed", message: detail, retryable: true, continuation }
  return { kind: "blocked", stage, reason: "authority_unavailable", message: detail, retryable: false, continuation }
}
function recoveryOutcomeMessage(result: ReplayRecoveryResult): string {
  if (result.kind === "denied" || result.kind === "unavailable" || result.kind === "authority_stopped" || result.kind === "committed_projection_unavailable") return `${result.kind}: ${result.message}`
  if (result.kind === "stale") return `stale ${result.entity} revision ${result.expectedRevision}/${result.actualRevision}`
  if (result.kind === "cancelled" || result.kind === "timed_out") return result.kind
  return `unexpected ${result.capability.status}/${result.replay.status} projection`
}
function stoppedRecovery(context: OperationContext, now: string): { readonly reason: "cancelled" | "timed_out"; readonly message: string } | undefined {
  if (context.cancellation.isCancellationRequested()) return { reason: "cancelled", message: "replay recovery was cancelled" }
  return Date.parse(now) >= Date.parse(context.deadlineAt) ? { reason: "timed_out", message: "replay recovery deadline elapsed" } : undefined
}
