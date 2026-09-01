import type { EventPublicationResult, ExecutionCompletion, ExecutionId, InterfaceCompilerEvent, IsoTimestamp, OperationContext, PartialEffectPosture } from "@interface-compiler/domain"
import type { WorthExecutionQueryEvidence } from "./worth-start-execution.js"
export interface WorthExecutionSettlementProjection { readonly projectionKind: "worth_execution_settlement"; readonly executionId: ExecutionId; readonly lifecycle: "success" | "failure" | "stopped"; readonly revision: number }
export type WorthExecutionSettlementResult =
  | { readonly kind: "settled"; readonly commit: "committed" | "already_committed"; readonly projection: WorthExecutionSettlementProjection; readonly evidence: WorthExecutionQueryEvidence }
  | { readonly kind: "stale"; readonly executionId: ExecutionId; readonly expectedRevision: number; readonly actualRevision: number }
  | { readonly kind: "lifecycle_invalid"; readonly executionId: ExecutionId; readonly currentLifecycle: string }
  | { readonly kind: "denied" | "unavailable"; readonly executionId: ExecutionId; readonly message: string }
  | { readonly kind: "cancelled" | "timed_out"; readonly operationId: OperationContext["operationId"]; readonly posture: PartialEffectPosture }
export interface WorthExecutionSettlementPort { completeExecution(executionId: ExecutionId, completion: ExecutionCompletion, endedAt: IsoTimestamp, expectedExecutionRevision: number, context: OperationContext): Promise<WorthExecutionSettlementResult>; publish(event: InterfaceCompilerEvent, context: OperationContext): Promise<EventPublicationResult> }
