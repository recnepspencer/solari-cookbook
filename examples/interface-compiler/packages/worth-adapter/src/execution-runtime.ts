import type { EventPublicationResult, ExecutionCompletion, ExecutionId, ExecutionMetrics, ExecutionMode, ExecutionStart, InterfaceCompilerEvent, IsoTimestamp, OperationContext, PartialEffectPosture } from "@interface-compiler/domain"
import type { WorthExecutionQueryEvidence } from "./worth-start-execution.js"

export interface WorthRunningExecutionProjection {
  readonly projectionKind: "worth_running_execution"
  readonly executionId: ExecutionId
  readonly capabilityId: ExecutionStart["capabilityId"]
  readonly replayVersionId?: ExecutionStart["replayVersionId"]
  readonly mode: ExecutionMode
  readonly lifecycle: "started"
  readonly revision: number
  readonly metrics: ExecutionMetrics
}

export interface WorthTerminalExecutionProjection extends Omit<WorthRunningExecutionProjection, "projectionKind" | "lifecycle"> {
  readonly projectionKind: "worth_terminal_execution"
  readonly lifecycle: "success" | "failure" | "stopped"
  readonly metrics: ExecutionMetrics & { readonly endedAt: IsoTimestamp; readonly wallClockMs: number }
  readonly outcome: ExecutionCompletion
}

export type WorthExecutionAdmissionResult =
  | { readonly kind: "admitted"; readonly commit: "committed" | "already_committed"; readonly projection: WorthRunningExecutionProjection; readonly evidence: WorthExecutionQueryEvidence }
  | { readonly kind: "duplicate" | "denied" | "unavailable"; readonly executionId: ExecutionId; readonly message: string }
  | { readonly kind: "cancelled" | "timed_out"; readonly operationId: OperationContext["operationId"]; readonly posture: PartialEffectPosture }

export type WorthRuntimeSettlementResult =
  | { readonly kind: "settled"; readonly commit: "committed" | "already_committed"; readonly projection: WorthTerminalExecutionProjection; readonly evidence: WorthExecutionQueryEvidence }
  | { readonly kind: "stale"; readonly executionId: ExecutionId; readonly expectedRevision: number; readonly actualRevision: number }
  | { readonly kind: "lifecycle_invalid" | "denied" | "unavailable"; readonly executionId: ExecutionId; readonly message: string }
  | { readonly kind: "cancelled" | "timed_out"; readonly operationId: OperationContext["operationId"]; readonly posture: PartialEffectPosture }

export interface WorthExecutionRuntimePort {
  admitExecution(execution: ExecutionStart, context: OperationContext): Promise<WorthExecutionAdmissionResult>
  settleExecution(executionId: ExecutionId, completion: ExecutionCompletion, endedAt: IsoTimestamp, expectedRevision: number, context: OperationContext): Promise<WorthRuntimeSettlementResult>
  publish(event: InterfaceCompilerEvent, context: OperationContext): Promise<EventPublicationResult>
}
