import assert from "node:assert/strict"
import test from "node:test"
import type {
  ActiveReplayProjection,
  CapabilityProjection,
  IsoTimestamp,
  Observation,
  ObservationId,
  OperationContext,
  OperationId,
  SessionId,
} from "@interface-compiler/domain"
import { createEnronOutcomeVerifier } from "../src/enron-online/outcome-verifier.js"
import { publishEnronOnlineConsumerTools } from "../src/enron-online/tool-publication.js"
import {
  ENRON_ONLINE_APPLICATION_ID,
  INGEST_INCOMING_TRADE_CAPABILITY_ID,
  INCOMING_TRADE_MESSAGE_ID,
} from "../src/enron-online/contracts.js"
import type { OrchestratorWorthPort } from "../src/worth-ports.js"

const timestamp = "2026-09-01T12:00:00.000Z" as IsoTimestamp
const replayId = "replay.trades.ingest-incoming-trade.v9" as never
const inputSchema = { type: "object", properties: { messageId: { type: "string", minLength: 1 } }, required: ["messageId"], additionalProperties: false } as const
const outputSchema = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["posted", "duplicate"] },
    tradeId: { type: "string" },
    financialReceiptId: { type: "string" },
    sourceMessageId: { type: "string" },
    idempotencyKey: { type: "string" },
  },
  required: ["status", "tradeId", "financialReceiptId", "sourceMessageId", "idempotencyKey"],
  additionalProperties: false,
} as const
const capability: Extract<CapabilityProjection, { readonly status: "healthy" }> = {
  projectionKind: "worth_capability",
  id: INGEST_INCOMING_TRADE_CAPABILITY_ID,
  revision: 17,
  applicationId: ENRON_ONLINE_APPLICATION_ID,
  name: "ingestIncomingTrade",
  description: "Ingest a delivered trade message into Financials and verify its receipt.",
  inputSchema,
  outputSchema,
  preconditions: [{ kind: "text_present", text: "EMAIL RECEIVED" }],
  postconditions: [{ kind: "text_present", text: "verified Financials receipt FIN-1042" }],
  publication: { audience: "gemini_consumer", disclosure: "semantic_only" },
  status: "healthy",
  activeReplayVersionId: replayId,
}
const replay: ActiveReplayProjection = {
  projectionKind: "worth_replay",
  id: replayId,
  revision: 23,
  capabilityId: capability.id,
  version: 9,
  steps: [{ type: "wait", milliseconds: 1 }],
  confidence: 1,
  createdAt: timestamp,
  status: "active",
  verifiedAt: timestamp,
  verification: { requiredSuccessfulRuns: 3, runs: [] },
}

test("tool publication derives contract and replay identity from WORTH", async () => {
  const evidence = { queryName: "test", queryIdentity: "test", basisVersion: 1, projectedRecordCount: 1, projectedFieldCount: 1, basisReleased: true } as const
  const worth: Pick<OrchestratorWorthPort, "readCapability" | "readActiveReplay"> = {
    readCapability: async () => ({ kind: "found", value: capability, evidence, compilationProvenance: { kind: "synthetic_seed" } }),
    readActiveReplay: async () => ({ kind: "found", value: replay, evidence, compilationProvenance: { kind: "synthetic_seed" } }),
  }
  const [tool] = await publishEnronOnlineConsumerTools(worth, context())
  assert.equal(tool?.name, "trades.ingest_incoming_trade")
  assert.deepEqual(tool?.inputSchema, inputSchema)
  assert.deepEqual(tool?.outputSchema, outputSchema)
  assert.equal(JSON.stringify(tool).includes(replay.id), false)
  assert.equal(JSON.stringify(tool).includes("selector"), false)
})

test("the Enron verifier projects the exact browser-visible typed receipt and binds it to the input", async () => {
  const verifier = createEnronOutcomeVerifier()
  const result = await verifier.verify({
    conditions: capability.postconditions,
    input: { messageId: INCOMING_TRADE_MESSAGE_ID },
    outputSchema,
    observation: receiptObservation(INCOMING_TRADE_MESSAGE_ID),
  }, context())
  assert.deepEqual(result, {
    kind: "verified",
    output: {
      status: "posted",
      tradeId: "FT-1042",
      financialReceiptId: "FIN-1042",
      sourceMessageId: INCOMING_TRADE_MESSAGE_ID,
      idempotencyKey: `${INCOMING_TRADE_MESSAGE_ID}:abc123`,
    },
    effect: { kind: "completed" },
  })

  const mismatched = await verifier.verify({
    conditions: capability.postconditions,
    input: { messageId: "msg.other" },
    outputSchema,
    observation: receiptObservation(INCOMING_TRADE_MESSAGE_ID),
  }, context())
  assert.equal(mismatched.kind, "failed")
})

test("candidate verification rejects a duplicate receipt from a dirty application world", async () => {
  const verifier = createEnronOutcomeVerifier()
  const result = await verifier.verify({
    phase: "candidate_verification",
    conditions: capability.postconditions,
    input: { messageId: INCOMING_TRADE_MESSAGE_ID },
    outputSchema,
    observation: receiptObservation(INCOMING_TRADE_MESSAGE_ID, "duplicate"),
  }, context())

  assert.equal(result.kind, "failed")
  if (result.kind !== "failed") throw new Error("expected candidate rejection")
  assert.match(result.message, /clean-world Financials post/)
})

function receiptObservation(sourceMessageId: string, status: "posted" | "duplicate" = "posted"): Observation {
  return {
    id: "observation.enron.receipt" as ObservationId,
    sessionId: "session.enron.receipt" as SessionId,
    url: "http://127.0.0.1:4310/?page=mail",
    interactables: [{
      kind: "other",
      role: "status",
      text: `${status === "posted" ? "POSTED" : "DUPLICATE"} FT-1042 / verified Financials receipt FIN-1042 / source ${sourceMessageId} / idempotency ${sourceMessageId}:abc123`,
    }],
    observedAt: timestamp,
  }
}

function context(): OperationContext {
  return {
    operationId: "operation.enron.contract" as OperationId,
    deadlineAt: "2026-09-01T12:05:00.000Z" as IsoTimestamp,
    cancellation: { isCancellationRequested: () => false, onCancellationRequested: () => () => undefined },
    budget: { maxWallClockMs: 300_000 },
    admission: { maxInFlight: 1, maxQueued: 0, overflow: "reject" },
  }
}
