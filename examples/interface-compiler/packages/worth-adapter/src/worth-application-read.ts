import type { ApplicationId, ApplicationProjection, OperationContext, WorthReadResult } from "@interface-compiler/domain"
import { INTERFACE_COMPILER_WORTH_READ_OPERATION, type HostDenialStage } from "./worth-query-wire.js"

export interface WorthApplicationReadEvidence {
  readonly queryName: string
  readonly queryIdentity: string
  readonly basisVersion: number
  readonly projectedRecordCount: number
  readonly projectedFieldCount: number
  readonly basisReleased: boolean
}

export type WorthApplicationReadResult =
  | { readonly kind: "found"; readonly value: ApplicationProjection; readonly evidence: WorthApplicationReadEvidence }
  | Exclude<WorthReadResult<ApplicationProjection>, { readonly kind: "found" }>
  | { readonly kind: "denied"; readonly entity: "application"; readonly entityId: ApplicationId; readonly stage: HostDenialStage; readonly denialKind: string; readonly message: string }
  | { readonly kind: "unavailable"; readonly entity: "application"; readonly entityId: ApplicationId; readonly operation: typeof INTERFACE_COMPILER_WORTH_READ_OPERATION; readonly reason: "unsupported" | "not_configured" | "protocol_mismatch" | "transport_unavailable" | "malformed_response"; readonly message: string }

export interface WorthApplicationReadAdapter {
  readApplication(applicationId: ApplicationId, context: OperationContext): Promise<WorthApplicationReadResult>
}

export function createWorthApplicationReadAdapter(client: Pick<WorthApplicationReadAdapter, "readApplication">): WorthApplicationReadAdapter {
  if (client === null || typeof client !== "object" || typeof client.readApplication !== "function") {
    throw new TypeError("a WORTH application read client is required")
  }
  return Object.freeze({ readApplication: (applicationId: ApplicationId, context: OperationContext) => client.readApplication(applicationId, context) })
}
