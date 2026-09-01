import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { promisify } from "node:util"
import type { ApplicationId, CapabilityId, CandidateReplayInput, EventId, ExecutionId, InterfaceCompilerEvent, IsoTimestamp, OperationContext, ReplayVersionId } from "@interface-compiler/domain"
import {
  createWorthApplicationReadAdapter,
  createCompiledPlanReadAdapter,
  createWorthStartExecutionAdapter,
  InterfaceCompilerWorthClient,
  mapReplayRecoveryResponse,
  type WorthApplicationReadResult,
} from "../src/index.js"
import { INTERFACE_COMPILER_WORTH_DEGRADE_REPLAY_OPERATION, INTERFACE_COMPILER_WORTH_PROTOCOL, parseHostResponse } from "../src/worth-query-wire.js"

const interfaceCompilerRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)))
const hostManifest = resolve(interfaceCompilerRoot, "worth-runtime-host/Cargo.toml")
const hostTargetDirectory = process.env.INTERFACE_COMPILER_WORTH_TARGET_DIR ?? resolve(interfaceCompilerRoot, "worth-runtime-host/target")
const hostBinary = resolve(hostTargetDirectory, "debug/worth-runtime-host.exe")
const execFileAsync = promisify(execFile)

function liveHostProcess() {
  return { command: hostBinary, args: ["--serve"], cwd: interfaceCompilerRoot }
}

function id(value: string): ApplicationId {
  return value as ApplicationId
}

function executionId(value: string): ExecutionId {
  return value as ExecutionId
}
function capabilityId(value: string): CapabilityId { return value as CapabilityId }

function context(operationId: string): OperationContext {
  return {
    operationId: operationId as OperationContext["operationId"],
    deadlineAt: new Date(Date.now() + 10_000).toISOString(),
    cancellation: {
      isCancellationRequested: () => false,
      onCancellationRequested: () => () => undefined,
    },
    budget: { maxWallClockMs: 8_000 },
    admission: { maxInFlight: 1, maxQueued: 0, overflow: "reject" },
  }
}

function applicationResult(result: WorthApplicationReadResult): Extract<WorthApplicationReadResult, { readonly kind: "found" }> {
  assert.equal(result.kind, "found")
  return result
}

test.before(async function establishLiveRustHostArtifact() {
  await execFileAsync("cargo", ["build", "--quiet", "--target-dir", hostTargetDirectory, "--manifest-path", hostManifest, "--bin", "worth-runtime-host"], {
    cwd: interfaceCompilerRoot,
    windowsHide: true,
  })
})

test("client crosses the process boundary and returns the WORTH application projection", async (testContext) => {
  const client = new InterfaceCompilerWorthClient({
    process: liveHostProcess(),
    credential: "interface-compiler-demo",
  })
  testContext.after(() => client.close())
  const adapter = createWorthApplicationReadAdapter(client)

  const found = applicationResult(
    await adapter.readApplication(id("application.interface-compiler"), context("operation.client-found")),
  )
  assert.deepEqual(found.value, {
    projectionKind: "worth_application",
    id: id("application.interface-compiler"),
    revision: 7,
    name: "Interface Compiler Demo",
    baseUrl: "https://interface-compiler.example",
  })
  assert.equal(found.evidence.queryName, "interface_compiler_application_read")
  assert.ok(found.evidence.queryIdentity.length > 0)
  assert.equal(found.evidence.projectedRecordCount, 1)
  assert.equal(found.evidence.projectedFieldCount, 4)
  assert.equal(found.evidence.basisReleased, true)

  const missing = await adapter.readApplication(id("application.unknown"), context("operation.client-missing"))
  assert.deepEqual(missing, {
    kind: "not_found",
    entity: "application",
    entityId: id("application.unknown"),
  })
})

test("compiled-plan adapter reads a healthy capability and its matching active replay from the live WORTH host", async (testContext) => {
  const client = new InterfaceCompilerWorthClient({ process: liveHostProcess(), credential: "interface-compiler-demo" })
  testContext.after(() => client.close())
  const adapter = createCompiledPlanReadAdapter(client)
  const id = capabilityId("capability.walmart.search-products")
  const capability = await adapter.readCapability(id, context("operation.client-capability"))
  const replay = await adapter.readActiveReplay(id, context("operation.client-replay"))
  assert.equal(capability.kind, "found")
  assert.equal(replay.kind, "found")
  if (capability.kind === "found" && replay.kind === "found") {
    assert.equal(capability.value.status, "healthy")
    assert.equal(replay.value.status, "active")
    assert.equal(capability.value.activeReplayVersionId, replay.value.id)
    assert.equal(replay.value.capabilityId, capability.value.id)
    assert.equal(capability.evidence.queryName, "interface_compiler_capability_read")
    assert.equal(replay.evidence.queryName, "interface_compiler_active_replay_read")
    assert.equal(capability.evidence.projectedFieldCount, 10)
    assert.equal(replay.evidence.projectedFieldCount, 14)
    assert.equal(capability.evidence.basisReleased, true)
    assert.equal(replay.evidence.basisReleased, true)
  }
  const missing = await adapter.readCapability(capabilityId("capability.unknown"), context("operation.client-capability-missing"))
  assert.equal(missing.kind, "not_found")
})

test("compiled-plan reads fail closed on a mismatched projection identity", async () => {
  const reply = JSON.stringify({ outcome: "capability_found", protocol: "interface-compiler.worth-host.v1", request_id: "interface-compiler-client-1", operation: "read_capability", capability: { projection_kind: "worth_capability", id: "capability.foreign", revision: 1, application_id: "application.interface-compiler", name: "foreign", description: "foreign", status: "healthy", active_replay_version_id: "replay.foreign" }, evidence: { query_name: "q", query_identity: "i", basis_version: 1, projected_record_count: 1, projected_field_count: 7, basis_released: true } })
  const client = new InterfaceCompilerWorthClient({ process: { command: process.execPath, args: ["-e", `process.stdin.once('data',()=>process.stdout.write(${JSON.stringify(`${reply}\n`)}))`] }, credential: "interface-compiler-demo" })
  const result = await client.readCapability(capabilityId("capability.expected"), context("operation.client-capability-mismatch"))
  await client.close()
  assert.equal(result.kind, "unavailable")
  if (result.kind === "unavailable") assert.equal(result.reason, "malformed_response")
})

test("compiled-plan replay fails closed on foreign verification lineage", async () => {
  const reply = JSON.stringify({ outcome: "active_replay_found", protocol: "interface-compiler.worth-host.v1", request_id: "interface-compiler-client-1", operation: "read_active_replay", replay: { projection_kind: "worth_replay", id: "replay.expected", revision: 1, capability_id: "capability.expected", version: 1, steps: [{ type: "wait", milliseconds: 1 }], confidence: 1, status: "active", created_at: "2026-08-31T17:00:00.000Z", discovered_from_experiment_id: "experiment.expected", verified_at: "2026-08-31T18:00:00.000Z", verification: { requiredSuccessfulRuns: 1, runs: [{ id: "run-1", capabilityId: "capability.foreign", replayVersionId: "replay.expected", sessionId: "session-1", freshSession: true, outcome: "success", evidenceIds: ["evidence-1"], completedAt: "2026-08-31T18:00:00.000Z" }] } }, evidence: { query_name: "q", query_identity: "i", basis_version: 1, projected_record_count: 1, projected_field_count: 14, basis_released: true } })
  const client = new InterfaceCompilerWorthClient({ process: { command: process.execPath, args: ["-e", `process.stdin.once('data',()=>process.stdout.write(${JSON.stringify(`${reply}\n`)}))`] }, credential: "interface-compiler-demo" })
  const result = await client.readActiveReplay(capabilityId("capability.expected"), context("operation.client-replay-lineage"))
  await client.close()
  assert.equal(result.kind, "unavailable")
  if (result.kind === "unavailable") assert.equal(result.reason, "malformed_response")
})

test("compiled-plan replay does not mint missing fresh-session evidence", async () => {
  const reply = JSON.stringify({ outcome: "active_replay_found", protocol: "interface-compiler.worth-host.v1", request_id: "interface-compiler-client-1", operation: "read_active_replay", replay: { projection_kind: "worth_replay", id: "replay.expected", revision: 1, capability_id: "capability.expected", version: 1, steps: [{ type: "wait", milliseconds: 1 }], confidence: 1, status: "active", created_at: "2026-08-31T17:00:00.000Z", discovered_from_experiment_id: "experiment.expected", verified_at: "2026-08-31T18:00:00.000Z", verification: { requiredSuccessfulRuns: 1, runs: [{ id: "run-1", capabilityId: "capability.expected", replayVersionId: "replay.expected", sessionId: "session-1", outcome: "success", evidenceIds: ["evidence-1"], completedAt: "2026-08-31T18:00:00.000Z" }] } }, evidence: { query_name: "q", query_identity: "i", basis_version: 1, projected_record_count: 1, projected_field_count: 14, basis_released: true } })
  const client = new InterfaceCompilerWorthClient({ process: { command: process.execPath, args: ["-e", `process.stdin.once('data',()=>process.stdout.write(${JSON.stringify(`${reply}\n`)}))`] }, credential: "interface-compiler-demo" })
  const result = await client.readActiveReplay(capabilityId("capability.expected"), context("operation.client-replay-fresh-session"))
  await client.close()
  assert.equal(result.kind, "unavailable")
  if (result.kind === "unavailable") assert.equal(result.reason, "transport_unavailable")
})

test("client preserves WORTH authentication denial as a typed denial", async (testContext) => {
  const client = new InterfaceCompilerWorthClient({
    process: liveHostProcess(),
    credential: "not-the-admitted-demo-credential",
  })
  testContext.after(() => client.close())

  const result = await client.readApplication(id("application.interface-compiler"), context("operation.client-denied"))
  assert.equal(result.kind, "denied")
  if (result.kind === "denied") {
    assert.equal(result.entity, "application")
    assert.equal(result.stage, "authentication")
  }
})

test("client starts a pending execution through the real WORTH host and preserves its projection evidence", async (testContext) => {
  const client = new InterfaceCompilerWorthClient({ process: liveHostProcess(), credential: "interface-compiler-demo" })
  testContext.after(() => client.close())
  const adapter = createWorthStartExecutionAdapter(client)

  const result = await adapter.startExecution(executionId("execution.demonstration-001"), context("operation.client-start"))
  assert.equal(result.kind, "transitioned")
  if (result.kind === "transitioned") {
    assert.equal(result.commit, "committed")
    assert.deepEqual(result.projection, { projectionKind: "worth_execution", executionId: executionId("execution.demonstration-001"), lifecycle: "started" })
    assert.equal(result.evidence.queryName, "interface_compiler_execution_read")
    assert.equal(result.evidence.projectedRecordCount, 1)
    assert.equal(result.evidence.projectedFieldCount, 4)
    assert.equal(result.evidence.basisReleased, true)
  }
})

test("client preserves WORTH lifecycle rejection for an independently started execution", async (testContext) => {
  const client = new InterfaceCompilerWorthClient({ process: liveHostProcess(), credential: "interface-compiler-demo" })
  testContext.after(() => client.close())

  const result = await client.startExecution(executionId("execution.demonstration-started"), context("operation.client-non-pending"))
  assert.deepEqual(result, { kind: "lifecycle_not_pending", executionId: executionId("execution.demonstration-started"), currentLifecycle: "started" })
})

test("client preserves WORTH start-execution authentication denial", async (testContext) => {
  const client = new InterfaceCompilerWorthClient({ process: liveHostProcess(), credential: "not-the-admitted-demo-credential" })
  testContext.after(() => client.close())

  const result = await client.startExecution(executionId("execution.demonstration-002"), context("operation.client-start-denied"))
  assert.equal(result.kind, "denied")
  if (result.kind === "denied") assert.equal(result.stage, "authentication")
})

test("real host binary preserves unsupported operations as correlated unavailable outcomes", async () => {
  const child = spawn(hostBinary, ["--serve"], { cwd: interfaceCompilerRoot, stdio: ["pipe", "pipe", "pipe"], windowsHide: true })
  const response = await new Promise<Record<string, unknown>>((resolveResponse, reject) => {
    let output = ""
    child.once("error", reject)
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8")
      const newline = output.indexOf("\n")
      if (newline >= 0) resolveResponse(JSON.parse(output.slice(0, newline)) as Record<string, unknown>)
    })
    child.stdin.write(`${JSON.stringify({ protocol: "interface-compiler.worth-host.v1", request_id: "unsupported-binary-1", operation: "submit_lifecycle_command", deadline_ms: 1000 })}\n`)
  })
  child.stdin.end()
  await new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()))
  assert.deepEqual(response, {
    outcome: "unavailable",
    protocol: "interface-compiler.worth-host.v1",
    request_id: "unsupported-binary-1",
    operation: "submit_lifecycle_command",
    reason: "unsupported",
    message: "this host exposes only its declared application reads, execution/event operations, and typed replay-recovery operations",
  })
})

test("client fails closed on malformed and protocol-mismatched host replies", async () => {
  for (const reply of ["not-json", JSON.stringify({ protocol: "foreign.protocol", request_id: "interface-compiler-client-1", outcome: "invalid_request", reason: "bad", message: "bad" })]) {
    const client = new InterfaceCompilerWorthClient({
      process: { command: process.execPath, args: ["-e", `process.stdin.once('data',()=>process.stdout.write(${JSON.stringify(`${reply}\n`)}))`] },
      credential: "interface-compiler-demo",
    })
    const result = await client.startExecution(executionId("execution.demonstration-002"), context("operation.client-malformed"))
    await client.close()
    assert.equal(result.kind, "unavailable")
    if (result.kind === "unavailable") assert.equal(result.reason, "transport_unavailable")
  }
})

test("start execution preserves cancellation, timeout, and request correlation posture", async () => {
  const cancelledContext = context("operation.client-cancelled")
  const cancelledClient = new InterfaceCompilerWorthClient({ process: { command: "unused" }, credential: "interface-compiler-demo" })
  const cancelled = await cancelledClient.startExecution(executionId("execution.demonstration-002"), {
    ...cancelledContext,
    cancellation: { ...cancelledContext.cancellation, isCancellationRequested: () => true },
  })
  assert.deepEqual(cancelled, { kind: "cancelled", operationId: cancelledContext.operationId, posture: { kind: "not_started" } })

  const expiredContext = { ...context("operation.client-expired"), deadlineAt: new Date(Date.now() - 1).toISOString() }
  const expired = await cancelledClient.startExecution(executionId("execution.demonstration-002"), expiredContext)
  assert.deepEqual(expired, { kind: "timed_out", operationId: expiredContext.operationId, posture: { kind: "not_started" } })

  const mismatchedReply = JSON.stringify({
    outcome: "lifecycle_not_pending",
    protocol: "interface-compiler.worth-host.v1",
    request_id: "different-request",
    operation: "start_execution",
    execution_id: "execution.demonstration-002",
    current_lifecycle: "started",
  })
  const correlationClient = new InterfaceCompilerWorthClient({ process: { command: process.execPath, args: ["-e", `process.stdin.once('data',()=>process.stdout.write(${JSON.stringify(`${mismatchedReply}\n`)}))`] }, credential: "interface-compiler-demo" })
  const shortContext = { ...context("operation.client-correlation"), budget: { maxWallClockMs: 50 } }
  const correlated = await correlationClient.startExecution(executionId("execution.demonstration-002"), shortContext)
  await correlationClient.close()
  assert.deepEqual(correlated, { kind: "timed_out", operationId: shortContext.operationId, posture: { kind: "unknown", recovery: "owner_reconciliation_required" } })
})

test("recovery mutations distinguish interruption before dispatch from an uncertain sent request", async () => {
  const capability = capabilityId("capability.walmart.search-products")
  const replay = "replay.walmart.search-products.v1" as ReplayVersionId
  const execution = executionId("execution.recovery-interruption")
  const request = { executionId: execution, capabilityId: capability, replayVersionId: replay, expectedExecutionRevision: 2, expectedCapabilityRevision: 3, expectedReplayRevision: 5 }
  const cancelledContext = context("operation.recovery-cancelled")
  const cancelledClient = new InterfaceCompilerWorthClient({ process: { command: "unused" }, credential: "interface-compiler-demo" })
  const cancelled = await cancelledClient.degradeReplay(request, {
    ...cancelledContext,
    cancellation: { ...cancelledContext.cancellation, isCancellationRequested: () => true },
  })
  assert.deepEqual(cancelled, { kind: "cancelled", operationId: cancelledContext.operationId, posture: { kind: "not_started" } })

  const delayedClient = new InterfaceCompilerWorthClient({ process: { command: process.execPath, args: ["-e", "process.stdin.resume(); setTimeout(() => {}, 1000)"] }, credential: "interface-compiler-demo" })
  const shortContext = { ...context("operation.recovery-timeout"), budget: { maxWallClockMs: 25 } }
  const timedOut = await delayedClient.degradeReplay(request, shortContext)
  await delayedClient.close()
  assert.deepEqual(timedOut, { kind: "timed_out", operationId: shortContext.operationId, posture: { kind: "unknown", recovery: "owner_reconciliation_required" } })
})

test("adapter preserves typed unresolved and known-committed WORTH recovery outcomes", () => {
  const capability = capabilityId("capability.walmart.search-products")
  const replay = "replay.walmart.search-products.v1" as ReplayVersionId
  const response = parseHostResponse(JSON.stringify({
    outcome: "replay_recovery_stopped",
    protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
    request_id: "request.commit-stop",
    operation: INTERFACE_COMPILER_WORTH_DEGRADE_REPLAY_OPERATION,
    reason: "indeterminate",
    message: "WORTH could not resolve the recovery commit",
  }))
  assert.ok(response)
  assert.deepEqual(
    mapReplayRecoveryResponse(INTERFACE_COMPILER_WORTH_DEGRADE_REPLAY_OPERATION, capability, replay, response),
    { kind: "authority_stopped", reason: "indeterminate", message: "WORTH could not resolve the recovery commit" },
  )
  const committed = parseHostResponse(JSON.stringify({
    outcome: "replay_recovery_committed_projection_unavailable",
    protocol: INTERFACE_COMPILER_WORTH_PROTOCOL,
    request_id: "request.committed-query-stop",
    operation: INTERFACE_COMPILER_WORTH_DEGRADE_REPLAY_OPERATION,
    commit: "committed",
    message: "WORTH committed recovery but could not publish its projections",
  }))
  assert.ok(committed)
  assert.deepEqual(
    mapReplayRecoveryResponse(INTERFACE_COMPILER_WORTH_DEGRADE_REPLAY_OPERATION, capability, replay, committed),
    { kind: "committed_projection_unavailable", commit: "committed", message: "WORTH committed recovery but could not publish its projections" },
  )
})

test("client settles through the real host and publishes a retained concrete event", async (testContext) => {
  const client=new InterfaceCompilerWorthClient({process:liveHostProcess(),credential:"interface-compiler-demo"});testContext.after(()=>client.close());const execution=executionId("execution.demonstration-started")
  const settled=await client.completeExecution(execution,{kind:"success",output:{ok:true}},"2026-09-01T12:00:00.000Z",1,context("operation.live-settlement"));assert.equal(settled.kind,"settled");if(settled.kind==="settled"){assert.equal(settled.projection.revision,2);assert.equal(settled.projection.lifecycle,"success");assert.equal(settled.evidence.queryName,"interface_compiler_execution_read")}
  const stale=await client.completeExecution(execution,{kind:"success"},"2026-09-01T12:00:01.000Z",0,context("operation.live-stale"));assert.equal(stale.kind,"stale")
  const event={eventId:"event.live.1" as EventId,occurredAt:"2026-09-01T12:00:00.000Z",protocol:"interface-compiler.events",schemaVersion:1,idempotencyKey:"compiled.started:execution.demonstration-001",recovery:"replay_safe",integrity:{algorithm:"sha256",digest:"abc"},type:"compiled.started",payload:{executionId:execution,mode:"compiled"}} satisfies InterfaceCompilerEvent
  assert.equal((await client.publish(event,context("operation.live-event"))).kind,"published");assert.equal((await client.publish(event,context("operation.live-event-retry"))).kind,"duplicate")
})

test("live recovery facade degrades a failed replay and activates a verified explored replacement", async (testContext) => {
  const client = new InterfaceCompilerWorthClient({ process: liveHostProcess(), credential: "interface-compiler-demo" })
  testContext.after(() => client.close())
  const capability = capabilityId("capability.walmart.search-products")
  const brokenReplay = "replay.walmart.search-products.v1" as ReplayVersionId
  const replacement = "replay.walmart.search-products.v2" as ReplayVersionId
  const execution = executionId("execution.typescript-replay-recovery")
  const admitted = await client.admitExecution({
    id: execution,
    capabilityId: capability,
    replayVersionId: brokenReplay,
    mode: "compiled",
    metrics: { startedAt: "2026-09-01T12:00:00.000Z" as IsoTimestamp, modelCalls: 0, inputTokens: 0, outputTokens: 0, browserObservations: 0, browserActions: 0, estimatedModelCostUsd: 0 },
  }, context("operation.recovery-admit"))
  assert.equal(admitted.kind, "admitted")
  if (admitted.kind !== "admitted") throw new Error("expected WORTH admission")
  const replayFailure = { kind: "step_failed" as const, stepIndex: 1, message: "search target disappeared", evidenceIds: ["evidence.typescript.replay-failure" as never] }
  const settled = await client.settleExecution(execution, { kind: "failure", reason: "replay_failed", message: "compiled replay failed", replayFailure }, "2026-09-01T12:00:04.000Z" as IsoTimestamp, admitted.projection.revision, context("operation.recovery-settle"))
  assert.equal(settled.kind, "settled")
  if (settled.kind !== "settled") throw new Error("expected WORTH settlement")

  const degraded = await client.degradeReplay({ executionId: execution, capabilityId: capability, replayVersionId: brokenReplay, expectedExecutionRevision: settled.projection.revision, expectedCapabilityRevision: 3, expectedReplayRevision: 5 }, context("operation.recovery-degrade"))
  assert.equal(degraded.kind, "applied")
  if (degraded.kind !== "applied") throw new Error("expected WORTH degradation")
  assert.equal(degraded.capability.status, "degraded")
  assert.equal(degraded.replay.status, "broken")

  const candidate: CandidateReplayInput = {
    id: replacement,
    capabilityId: capability,
    version: 2,
    steps: [
      { type: "navigate", url: "https://interface-compiler.example/search" },
      { type: "fill", target: { semanticDescription: "catalog query", role: "searchbox" }, value: "laundry detergent" },
      { type: "click", target: { semanticDescription: "run catalog query", role: "button", name: "Search" } },
    ],
    confidence: 0.875,
    discoveredFromExperimentId: "experiment.typescript.recovery" as never,
    supersedes: brokenReplay,
    createdAt: "2026-09-01T12:01:00.000Z" as IsoTimestamp,
  }
  const stale = await client.acceptReplacementCandidate({ capabilityId: capability, brokenReplayVersionId: brokenReplay, expectedCapabilityRevision: 3, expectedBrokenReplayRevision: degraded.replay.revision, candidate }, context("operation.recovery-stale"))
  assert.equal(stale.kind, "stale")

  const accepted = await client.acceptReplacementCandidate({ capabilityId: capability, brokenReplayVersionId: brokenReplay, expectedCapabilityRevision: degraded.capability.revision, expectedBrokenReplayRevision: degraded.replay.revision, candidate }, context("operation.recovery-candidate"))
  assert.equal(accepted.kind, "applied")
  if (accepted.kind !== "applied") throw new Error("expected WORTH candidate admission")
  assert.equal(accepted.capability.status, "verifying")
  assert.equal(accepted.replay.status, "verifying")
  const premature = await client.activateReplacement({ capabilityId: capability, replayVersionId: replacement, expectedCapabilityRevision: accepted.capability.revision, expectedReplayRevision: accepted.replay.revision, verifiedAt: "2026-09-01T12:05:00.000Z" as IsoTimestamp }, context("operation.recovery-premature"))
  assert.equal(premature.kind, "denied")

  let current = accepted
  for (const index of [1, 2, 3]) {
    const recorded = await client.recordReplacementVerification({
      capabilityId: capability,
      replayVersionId: replacement,
      expectedCapabilityRevision: current.capability.revision,
      expectedReplayRevision: current.replay.revision,
      receipt: { id: `verification.typescript.${index}` as never, sessionId: `solari.session.typescript.${index}` as never, capabilityId: capability, replayVersionId: replacement, sessionFreshness: "fresh", outcome: "success", evidenceIds: [`evidence.typescript.${index}` as never], completedAt: `2026-09-01T12:0${index + 1}:00.000Z` as IsoTimestamp },
    }, context(`operation.recovery-verification-${index}`))
    assert.equal(recorded.kind, "applied")
    if (recorded.kind !== "applied") throw new Error("expected WORTH verification retention")
    current = recorded
  }
  const activated = await client.activateReplacement({ capabilityId: capability, replayVersionId: replacement, expectedCapabilityRevision: current.capability.revision, expectedReplayRevision: current.replay.revision, verifiedAt: "2026-09-01T12:05:00.000Z" as IsoTimestamp }, context("operation.recovery-activate"))
  assert.equal(activated.kind, "applied")
  if (activated.kind !== "applied") throw new Error("expected WORTH replacement activation")
  assert.equal(activated.capability.id, capability)
  assert.equal(activated.capability.name, degraded.capability.name)
  assert.equal(activated.capability.status, "healthy")
  if (activated.capability.status === "healthy") assert.equal(activated.capability.activeReplayVersionId, replacement)
  assert.equal(activated.replay.status, "active")
  assert.equal(activated.replay.id, replacement)
  assert.notDeepEqual(activated.replay.steps, degraded.replay.steps)
  const active = await client.readActiveReplay(capability, context("operation.recovery-read-active"))
  assert.equal(active.kind, "found")
  if (active.kind === "found") assert.equal(active.value.id, replacement)
})

test("live narrow runtime port admits an arbitrary execution and returns WORTH-projected telemetry", async (testContext) => {
  const client = new InterfaceCompilerWorthClient({ process: liveHostProcess(), credential: "interface-compiler-demo" })
  testContext.after(() => client.close())
  const execution = executionId("execution.typescript-live-42")
  const startedAt = "2026-09-01T12:00:00.000Z" as IsoTimestamp
  const admitted = await client.admitExecution({ id: execution, capabilityId: capabilityId("capability.walmart.search-products"), mode: "direct", metrics: { startedAt, modelCalls: 0, inputTokens: 0, outputTokens: 0, browserObservations: 0, browserActions: 0, estimatedModelCostUsd: 0 } }, context("operation.live-admit"))
  assert.equal(admitted.kind, "admitted")
  if (admitted.kind !== "admitted") throw new Error("expected admission")
  assert.equal(admitted.projection.executionId, execution)
  assert.equal(admitted.evidence.projectedFieldCount, 8)
  const base = { occurredAt: startedAt, protocol: "interface-compiler.events", schemaVersion: 1, recovery: "replay_safe", integrity: { algorithm: "sha256", digest: "test" } } as const
  const model = { ...base, eventId: "event.ts.model" as EventId, idempotencyKey: "event.ts.model", type: "model.called", payload: { executionId: execution, role: "explorer", inputTokens: 13, outputTokens: 5, estimatedModelCostUsd: 0.031 } } satisfies InterfaceCompilerEvent
  const observation = { ...base, eventId: "event.ts.observation" as EventId, idempotencyKey: "event.ts.observation", type: "browser.observed", payload: { executionId: execution, sessionId: "session.ts" as never, observationId: "observation.ts" as never } } satisfies InterfaceCompilerEvent
  assert.equal((await client.publish(model, context("operation.live-model"))).kind, "published")
  assert.equal((await client.publish(observation, context("operation.live-observation"))).kind, "published")
  const settled = await client.settleExecution(execution, { kind: "success" }, "2026-09-01T12:00:02.250Z" as IsoTimestamp, admitted.projection.revision, context("operation.live-runtime-settle"))
  assert.equal(settled.kind, "settled")
  if (settled.kind !== "settled") throw new Error("expected settlement")
  assert.deepEqual(settled.projection.metrics, { startedAt, endedAt: "2026-09-01T12:00:02.250Z", wallClockMs: 2250, modelCalls: 1, inputTokens: 13, outputTokens: 5, browserObservations: 1, browserActions: 0, estimatedModelCostUsd: 0.031 })
})
