import type { Application } from "./application.js"
import type { CapabilityDefinition, DiscoveryReason } from "./capability.js"
import type { Execution, ExecutionCompletion, ExecutionStart, FailedExecution, StoppedExecution, SuccessfulExecution } from "./execution.js"
import type { ApplicationId, CapabilityId, ExecutionId, IsoTimestamp, OperationId, ReplayVersionId } from "./identity.js"
import type { CandidateReplay, ReplayFailure, ReplayStep, VerificationRun, VerificationRunReceipt } from "./replay.js"
import type { OperationContext, PartialEffectPosture } from "./operation-context.js"

export interface ApplicationProjection {
  readonly projectionKind: "worth_application"
  readonly id: ApplicationId
  readonly revision: number
  readonly name: string
  readonly baseUrl: string
}

interface CapabilityProjectionCore {
  readonly projectionKind: "worth_capability"
  readonly id: CapabilityId
  readonly revision: number
  readonly applicationId: ApplicationId
  readonly name: string
  readonly description: string
}

export type CapabilityProjection =
  | (CapabilityProjectionCore & { readonly status: "discovering"; readonly discovery: DiscoveryReason })
  | (CapabilityProjectionCore & { readonly status: "verifying"; readonly candidateReplayVersionId: ReplayVersionId })
  | (CapabilityProjectionCore & { readonly status: "healthy"; readonly activeReplayVersionId: ReplayVersionId })
  | (CapabilityProjectionCore & {
      readonly status: "degraded"
      readonly brokenReplayVersionId: ReplayVersionId
      readonly failure: ReplayFailure
      readonly mode: "exploratory"
    })

interface ReplayProjectionCore {
  readonly projectionKind: "worth_replay"
  readonly id: ReplayVersionId
  readonly revision: number
  readonly capabilityId: CapabilityId
  readonly version: number
  readonly confidence: number
  readonly supersedes?: ReplayVersionId
  readonly supersededBy?: ReplayVersionId
  readonly createdAt: IsoTimestamp
}

interface CandidateReplayProjection extends ReplayProjectionCore {
  readonly status: "candidate"
}

interface VerifyingReplayProjection extends ReplayProjectionCore {
  readonly status: "verifying"
  readonly verification: {
    readonly requiredSuccessfulRuns: number
    readonly runs: readonly VerificationRun[]
  }
}

export interface ActiveReplayProjection extends ReplayProjectionCore {
  readonly status: "active"
  readonly steps: readonly ReplayStep[]
  readonly verifiedAt: IsoTimestamp
  readonly verification: {
    readonly requiredSuccessfulRuns: number
    readonly runs: readonly VerificationRun[]
  }
}

interface BrokenReplayProjection extends ReplayProjectionCore {
  readonly status: "broken"
  readonly brokenAt: IsoTimestamp
  readonly failure: ReplayFailure
}

interface SupersededReplayProjection extends ReplayProjectionCore {
  readonly status: "superseded"
  readonly supersededBy: ReplayVersionId
  readonly supersededAt: IsoTimestamp
}

export type ReplayProjection =
  | CandidateReplayProjection
  | VerifyingReplayProjection
  | ActiveReplayProjection
  | BrokenReplayProjection
  | SupersededReplayProjection

interface ExecutionProjectionCore {
  readonly projectionKind: "worth_execution"
  readonly id: ExecutionId
  readonly revision: number
  readonly capabilityId: CapabilityId
  readonly replayVersionId?: ReplayVersionId
  readonly mode: Execution["mode"]
  readonly metrics: Execution["metrics"]
}

export type ExecutionProjection =
  | (ExecutionProjectionCore & { readonly status: "running" })
  | (ExecutionProjectionCore & { readonly status: "success"; readonly outcome: SuccessfulExecution["outcome"] })
  | (ExecutionProjectionCore & { readonly status: "failure"; readonly outcome: FailedExecution["outcome"] })
  | (ExecutionProjectionCore & { readonly status: "stopped"; readonly outcome: StoppedExecution["outcome"] })

export type WorthCommand =
  | { readonly kind: "register_application"; readonly application: Application }
  | { readonly kind: "register_capability"; readonly definition: CapabilityDefinition }
  | { readonly kind: "record_replay_candidate"; readonly candidate: CandidateReplay }
  | { readonly kind: "begin_replay_verification"; readonly replayVersionId: ReplayVersionId; readonly requiredSuccessfulRuns: number }
  | { readonly kind: "record_verification_run"; readonly replayVersionId: ReplayVersionId; readonly receipt: VerificationRunReceipt }
  | {
      readonly kind: "complete_replay_verification"
      readonly replayVersionId: ReplayVersionId
      readonly verifiedAt: IsoTimestamp
    }
  | { readonly kind: "begin_capability_verification"; readonly capabilityId: CapabilityId; readonly candidateReplayVersionId: ReplayVersionId }
  | { readonly kind: "activate_capability"; readonly capabilityId: CapabilityId; readonly activeReplayVersionId: ReplayVersionId }
  | { readonly kind: "fail_capability_verification"; readonly capabilityId: CapabilityId; readonly brokenReplayVersionId: ReplayVersionId }
  | {
      readonly kind: "record_replay_failure"
      readonly replayVersionId: ReplayVersionId
      readonly failure: ReplayFailure
      readonly brokenAt: IsoTimestamp
    }
  | { readonly kind: "resume_capability_exploration"; readonly capabilityId: CapabilityId }
  | { readonly kind: "supersede_replay"; readonly replayVersionId: ReplayVersionId; readonly successorReplayVersionId: ReplayVersionId; readonly supersededAt: IsoTimestamp }
  | { readonly kind: "start_execution"; readonly execution: ExecutionStart }
  | { readonly kind: "complete_execution"; readonly executionId: ExecutionId; readonly completion: ExecutionCompletion; readonly endedAt: IsoTimestamp }

export type WorthMutationProjection =
  | { readonly kind: "application"; readonly projection: ApplicationProjection }
  | { readonly kind: "capability"; readonly projection: CapabilityProjection }
  | { readonly kind: "replay"; readonly projection: ReplayProjection }
  | { readonly kind: "execution"; readonly projection: ExecutionProjection }

export type WorthEntity = "application" | "capability" | "replay" | "execution"
export type WorthEntityId = ApplicationId | CapabilityId | ReplayVersionId | ExecutionId

export type WorthReadResult<T> =
  | { readonly kind: "found"; readonly value: T }
  | { readonly kind: "not_found"; readonly entity: WorthEntity; readonly entityId: WorthEntityId }
  | { readonly kind: "cancelled"; readonly operationId: OperationId; readonly posture: PartialEffectPosture }
  | { readonly kind: "timed_out"; readonly operationId: OperationId; readonly posture: PartialEffectPosture }
  | { readonly kind: "failed"; readonly entity: WorthEntity; readonly entityId: WorthEntityId; readonly message: string; readonly retryable: boolean }

export type WorthDenialReason = "not_found" | "invalid_transition" | "unauthorized_command" | "unsupported"

export type WorthSubmissionResult =
  | { readonly kind: "accepted"; readonly projection: WorthMutationProjection }
  | { readonly kind: "denied"; readonly entity: WorthEntity; readonly entityId: WorthEntityId; readonly reason: WorthDenialReason }
  | { readonly kind: "stale"; readonly entity: WorthEntity; readonly entityId: WorthEntityId; readonly expectedRevision: number; readonly actualRevision: number }
  | { readonly kind: "conflict"; readonly entity: WorthEntity; readonly entityId: WorthEntityId; readonly conflictingEntityId?: WorthEntityId }
  | { readonly kind: "settlement_deferred"; readonly entity: WorthEntity; readonly entityId: WorthEntityId; readonly operationId: OperationId; readonly posture: PartialEffectPosture; readonly recovery: "owner_recovery_required" }
  | { readonly kind: "cancelled"; readonly operationId: OperationId; readonly safePoint: "before_commit" | "after_commit"; readonly posture: PartialEffectPosture }
  | { readonly kind: "timed_out"; readonly operationId: OperationId; readonly posture: PartialEffectPosture }
  | { readonly kind: "failed"; readonly entity: WorthEntity; readonly entityId: WorthEntityId; readonly message: string; readonly retryable: boolean }

/**
 * The future Worth adapter is the only authority that accepts these commands.
 * Every read is an immutable projection; no mutable store or authority handle
 * crosses this contract.
 */
export interface WorthAuthority {
  readApplication(applicationId: ApplicationId, context: OperationContext): Promise<WorthReadResult<ApplicationProjection>>
  readCapability(capabilityId: CapabilityId, context: OperationContext): Promise<WorthReadResult<CapabilityProjection>>
  readActiveReplay(capabilityId: CapabilityId, context: OperationContext): Promise<WorthReadResult<ActiveReplayProjection>>
  readReplayLineage(capabilityId: CapabilityId, context: OperationContext): Promise<WorthReadResult<readonly ReplayProjection[]>>
  readExecution(executionId: ExecutionId, context: OperationContext): Promise<WorthReadResult<ExecutionProjection>>
  submit(command: WorthCommand, context: OperationContext): Promise<WorthSubmissionResult>
}
