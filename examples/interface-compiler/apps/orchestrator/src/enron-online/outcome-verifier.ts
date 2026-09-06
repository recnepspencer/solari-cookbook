import type { Condition, JsonValue, Observation, OperationContext } from "@interface-compiler/domain"
import type { SemanticVerificationRequest, SemanticVerificationResult, SemanticVerifier } from "../semantic-verifier.js"

export interface IngestIncomingTradeInput { readonly messageId: string }
export interface IngestIncomingTradeReceipt {
  readonly status: "posted" | "duplicate"
  readonly tradeId: string
  readonly financialReceiptId: string
  readonly sourceMessageId: string
  readonly idempotencyKey: string
}

export interface EnronFinancialsOracle {
  readReceipts(context: OperationContext): Promise<readonly IngestIncomingTradeReceipt[]>
}

/** Verifies the visible Enron contract and projects its accessible receipt without model inference. */
export function createEnronOutcomeVerifier(oracle?: EnronFinancialsOracle): SemanticVerifier {
  return Object.freeze({
    modelUsage: "none",
    async verify(request: SemanticVerificationRequest, context: OperationContext): Promise<SemanticVerificationResult> {
      const visibleText = observationText(request.observation)
      const unsupported = request.conditions.find((condition: Condition) => !conditionSatisfied(condition, visibleText))
      if (unsupported !== undefined) return { kind: "failed", condition: unsupported, message: "the visible Enron contract condition was not satisfied", retryable: false, evidenceIds: [], effect: { kind: "completed" } }
      if (request.outputSchema === undefined) return { kind: "verified", effect: { kind: "completed" } }
      const receiptCondition = request.conditions[0]
      if (receiptCondition === undefined) throw new Error("the WORTH receipt contract has no postcondition")
      const output = receiptFromObservation(request.observation)
      const expectedMessageId = inputMessageId(request.input)
      if (output === undefined || (expectedMessageId !== undefined && output.sourceMessageId !== expectedMessageId)) {
        return { kind: "failed", condition: receiptCondition, message: "the verified Financials receipt was not readable for the requested source message", retryable: false, evidenceIds: [], effect: { kind: "completed" } }
      }
      if (request.phase === "candidate_verification" && output.status !== "posted") {
        return { kind: "failed", condition: receiptCondition, message: "candidate verification requires a clean-world Financials post, not a duplicate", retryable: false, evidenceIds: [], effect: { kind: "completed" } }
      }
      if (oracle !== undefined) {
        const receipts = await oracle.readReceipts(context)
        const retained = receipts.filter((receipt) => receipt.idempotencyKey === output.idempotencyKey)
        if (retained.length !== 1 || !sameReceipt(retained[0], output)) {
          return { kind: "failed", condition: receiptCondition, message: "the independent Financials state did not retain the visible receipt exactly once", retryable: false, evidenceIds: [], effect: { kind: "completed" } }
        }
      }
      return { kind: "verified", output: output as unknown as JsonValue, effect: { kind: "completed" } }
    },
  })
}

function sameReceipt(left: IngestIncomingTradeReceipt | undefined, right: IngestIncomingTradeReceipt): boolean {
  return left !== undefined && left.tradeId === right.tradeId && left.financialReceiptId === right.financialReceiptId && left.sourceMessageId === right.sourceMessageId && left.idempotencyKey === right.idempotencyKey
}

function inputMessageId(input: JsonValue | undefined): string | undefined {
  if (input === null || Array.isArray(input) || typeof input !== "object") return undefined
  const messageId = (input as { readonly [key: string]: JsonValue }).messageId
  return typeof messageId === "string" ? messageId : undefined
}

function conditionSatisfied(condition: Condition, visibleText: string): boolean {
  return condition.kind === "text_present" && visibleText.includes(condition.text)
}

function observationText(observation: Observation | undefined): string {
  if (observation === undefined) return ""
  return [observation.pageSummary, ...observation.interactables.flatMap((item) => [item.text, item.name])]
    .filter((value): value is string => typeof value === "string")
    .join("\n")
}

function receiptFromObservation(observation: Observation | undefined): IngestIncomingTradeReceipt | undefined {
  const statusText = observation?.interactables.find((item) => item.role === "status")?.text
  if (statusText === undefined) return undefined
  const [trade, receipt, source, idempotency] = statusText.split(" / ")
  const status = trade?.startsWith("POSTED ") ? "posted" : trade?.startsWith("DUPLICATE ") ? "duplicate" : undefined
  const tradeId = status === "posted" ? trade?.slice("POSTED ".length) : status === "duplicate" ? trade?.slice("DUPLICATE ".length) : undefined
  const financialReceiptId = stripPrefix(receipt, "verified Financials receipt ")
  const sourceMessageId = stripPrefix(source, "source ")
  const idempotencyKey = stripPrefix(idempotency, "idempotency ")
  if (status === undefined || !tradeId || !financialReceiptId || !sourceMessageId || !idempotencyKey) return undefined
  return Object.freeze({ status, tradeId, financialReceiptId, sourceMessageId, idempotencyKey })
}

function stripPrefix(value: string | undefined, prefix: string): string | undefined {
  if (value === undefined || !value.startsWith(prefix)) return undefined
  const result = value.slice(prefix.length).trim()
  return result.length === 0 ? undefined : result
}
