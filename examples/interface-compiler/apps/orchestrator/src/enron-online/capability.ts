import type { OperationContext } from "@interface-compiler/domain"
import type { SemanticCapabilityExecutionResult, SemanticCapabilityExecutor } from "../semantic-capability-executor.js"
import { INGEST_INCOMING_TRADE_CAPABILITY_ID } from "./contracts.js"
import type { IngestIncomingTradeInput, IngestIncomingTradeReceipt } from "./outcome-verifier.js"

export function createEnronTradeCapabilities(executor: SemanticCapabilityExecutor): {
  ingestIncomingTrade(input: IngestIncomingTradeInput, context: OperationContext): Promise<SemanticCapabilityExecutionResult<IngestIncomingTradeReceipt>>
} {
  return Object.freeze({
    ingestIncomingTrade: (input, context) => executor.execute(INGEST_INCOMING_TRADE_CAPABILITY_ID, { messageId: input.messageId }, context),
  })
}
