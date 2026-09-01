import type { ExecutionId, OperationContext, PartialEffectPosture } from "@interface-compiler/domain"
import { INTERFACE_COMPILER_WORTH_START_EXECUTION_OPERATION, type HostStartDenialStage, type HostUnavailableReason } from "./worth-query-wire.js"
import type { WorthApplicationReadEvidence } from "./worth-application-read.js"

export type WorthExecutionQueryEvidence = WorthApplicationReadEvidence

export type WorthStartExecutionResult =
  | { readonly kind: "transitioned"; readonly commit: "committed" | "already_committed"; readonly projection: { readonly projectionKind: "worth_execution"; readonly executionId: ExecutionId; readonly lifecycle: string }; readonly evidence: WorthExecutionQueryEvidence }
  | { readonly kind: "lifecycle_not_pending"; readonly executionId: ExecutionId; readonly currentLifecycle: string }
  | { readonly kind: "denied"; readonly executionId: ExecutionId; readonly stage: HostStartDenialStage; readonly denialKind: string; readonly message: string }
  | { readonly kind: "unavailable"; readonly executionId: ExecutionId; readonly operation: typeof INTERFACE_COMPILER_WORTH_START_EXECUTION_OPERATION; readonly reason: HostUnavailableReason | "transport_unavailable" | "malformed_response"; readonly message: string }
  | { readonly kind: "cancelled" | "timed_out"; readonly operationId: OperationContext["operationId"]; readonly posture: PartialEffectPosture }

export interface WorthStartExecutionAdapter {
  startExecution(executionId: ExecutionId, context: OperationContext): Promise<WorthStartExecutionResult>
}

export function createWorthStartExecutionAdapter(client: Pick<WorthStartExecutionAdapter, "startExecution">): WorthStartExecutionAdapter {
  if (client === null || typeof client !== "object" || typeof client.startExecution !== "function") throw new TypeError("a WORTH start execution client is required")
  return Object.freeze({ startExecution: (executionId: ExecutionId, context: OperationContext) => client.startExecution(executionId, context) })
}
