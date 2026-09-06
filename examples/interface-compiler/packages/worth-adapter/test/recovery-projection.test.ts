import assert from "node:assert/strict"
import test from "node:test"
import type { CapabilityId, OperationContext, ReplayVersionId } from "@interface-compiler/domain"
import { InterfaceCompilerWorthClient, mapReplayRecoveryResponse } from "../src/index.js"
import { decodeCapabilityProjection, decodeReplayProjection } from "../src/projection-decoding.js"
import { parseHostResponse } from "../src/worth-query-wire.js"

const capabilityId = "capability.recovery" as CapabilityId
const replayId = "replay.candidate" as ReplayVersionId

for (const defect of ["none", "pointer", "basis"] as const) {
  test(`recovery mutation and read enforce coherent pairs: ${defect}`, async (testContext) => {
    const pair = verificationPair()
    if (defect === "pointer") pair.capability.candidate_replay_version_id = "replay.foreign"
    if (defect === "basis") pair.replay_evidence.basis_version += 1
    // Each projection is valid alone: only the cross-projection check can reject these responses.
    assert.ok(decodeCapabilityProjection(pair.capability, capabilityId))
    assert.ok(decodeReplayProjection(pair.replay, capabilityId, replayId))
    const mutation = parseHostResponse(JSON.stringify({
      protocol: "interface-compiler.worth-host.v1", request_id: "mutation", operation: "accept_replacement_candidate",
      outcome: "replay_recovery_applied", commit: "committed", ...pair,
    }))
    assert.ok(mutation)
    const mapped = mapReplayRecoveryResponse("accept_replacement_candidate", capabilityId, replayId, mutation)
    assert.equal(mapped.kind, defect === "none" ? "applied" : "unavailable")
    if (mapped.kind === "unavailable") assert.equal(mapped.reason, "malformed_response")

    const reply = JSON.stringify({
      protocol: "interface-compiler.worth-host.v1", request_id: "interface-compiler-client-1", operation: "read_recovery_projection",
      outcome: "recovery_projection_found", ...pair,
    })
    const client = new InterfaceCompilerWorthClient({
      process: { command: process.execPath, args: ["-e", `process.stdin.once('data',()=>process.stdout.write(${JSON.stringify(`${reply}\n`)}))`] },
      credential: "interface-compiler-demo",
    })
    testContext.after(() => client.close())
    const read = await client.readRecoveryProjection(capabilityId, context())
    assert.equal(read.kind, defect === "none" ? "found" : "unavailable")
    if (read.kind === "unavailable") assert.equal(read.reason, "malformed_response")
  })
}

function verificationPair() {
  const evidence = { query_name: "query", query_identity: "identity", basis_version: 7, projected_record_count: 1, projected_field_count: 15, basis_released: true }
  return {
    capability: {
      projection_kind: "worth_capability" as const, id: capabilityId, revision: 2,
      application_id: "application.recovery", name: "recover", description: "Recovery contract",
      input_schema: { type: "object" }, output_schema: { type: "object" }, preconditions: [], postconditions: [],
      publication: { audience: "gemini_consumer", disclosure: "semantic_only" },
      status: "verifying" as const, candidate_replay_version_id: replayId as string,
      active_replay_version_id: "replay.previous", broken_replay_version_id: "replay.previous",
      failure: { kind: "step_failed", stepIndex: 0, message: "target absent", evidenceIds: ["evidence.drift"] },
    },
    replay: {
      projection_kind: "worth_replay" as const, id: replayId, capability_id: capabilityId, revision: 1, version: 2,
      status: "verifying" as const, steps: [{ type: "wait" as const, milliseconds: 1 }], confidence: 0.5,
      created_at: "2026-09-01T12:00:00.000Z", discovered_from_experiment_id: "experiment.discovery",
      verification: { requiredSuccessfulRuns: 3, runs: [] },
    },
    capability_evidence: { ...evidence }, replay_evidence: { ...evidence },
  }
}

function context(): OperationContext {
  return {
    operationId: "operation.recovery-projection" as OperationContext["operationId"],
    deadlineAt: new Date(Date.now() + 10_000).toISOString(),
    cancellation: { isCancellationRequested: () => false, onCancellationRequested: () => () => undefined },
    budget: { maxWallClockMs: 8_000 }, admission: { maxInFlight: 1, maxQueued: 0, overflow: "reject" },
  }
}
