import type { CapabilityId, EventId, ExecutionId, ExperimentId, IsoTimestamp, ObservationId, ReplayVersionId, SessionId, VerificationRunId } from "./identity.js"
import type { Execution, ExecutionMode } from "./execution.js"
import type { ReplayStep } from "./replay.js"

export interface InterfaceCompilerEventMap {
  "direct.started": { readonly executionId: ExecutionId }
  "browser.observed": { readonly executionId: ExecutionId; readonly sessionId: SessionId; readonly observationId: ObservationId }
  "model.called": {
    readonly executionId: ExecutionId
    readonly role: "explorer" | "verifier" | "consumer"
    readonly inputTokens: number
    readonly outputTokens: number
    readonly estimatedModelCostMicrocents: number
  }
  "browser.action": { readonly executionId: ExecutionId; readonly sessionId: SessionId; readonly actionType: ReplayStep["type"] }
  "direct.completed": { readonly executionId: ExecutionId; readonly outcome: Exclude<Execution["status"], "running"> }
  "exploration.started": { readonly capabilityId?: CapabilityId; readonly sessionId: SessionId }
  "experiment.executed": { readonly experimentId: ExperimentId; readonly result: "success" | "failure" | "inconclusive" }
  "replay.proposed": { readonly capabilityId: CapabilityId; readonly replayVersionId: ReplayVersionId }
  "verification.started": { readonly replayVersionId: ReplayVersionId; readonly sessionId: SessionId }
  "verification.succeeded": { readonly replayVersionId: ReplayVersionId; readonly runId: VerificationRunId }
  "replay.activated": { readonly capabilityId: CapabilityId; readonly replayVersionId: ReplayVersionId }
  "compiled.started": { readonly executionId: ExecutionId; readonly mode: Extract<ExecutionMode, "compiled"> }
  "replay.started": { readonly executionId: ExecutionId; readonly replayVersionId: ReplayVersionId }
  "replay.succeeded": { readonly executionId: ExecutionId; readonly replayVersionId: ReplayVersionId }
  "replay.failed": { readonly executionId: ExecutionId; readonly replayVersionId: ReplayVersionId }
  "capability.degraded": { readonly capabilityId: CapabilityId; readonly brokenReplayVersionId: ReplayVersionId }
  "exploration.resumed": { readonly capabilityId: CapabilityId; readonly previousReplayVersionId: ReplayVersionId }
  "replay.superseded": { readonly replayVersionId: ReplayVersionId; readonly supersededBy: ReplayVersionId }
  "capability.healthy": { readonly capabilityId: CapabilityId; readonly activeReplayVersionId: ReplayVersionId }
}

export type InterfaceCompilerEventType = keyof InterfaceCompilerEventMap

export type EventRecovery = "replay_safe" | "owner_reconciliation_required"

export interface EventIntegrity {
  readonly algorithm: "sha256"
  readonly digest: string
}

export type InterfaceCompilerEvent = {
  [Type in InterfaceCompilerEventType]: {
    readonly eventId: EventId
    readonly occurredAt: IsoTimestamp
    readonly protocol: "interface-compiler.events"
    readonly schemaVersion: 1
    readonly idempotencyKey: string
    readonly recovery: EventRecovery
    readonly integrity: EventIntegrity
    readonly estimatedModelCostMicrocents?: number
    readonly type: Type
    readonly payload: InterfaceCompilerEventMap[Type]
  }
}[InterfaceCompilerEventType]
