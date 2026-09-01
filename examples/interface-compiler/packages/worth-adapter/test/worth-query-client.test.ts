import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { promisify } from "node:util"
import type { ApplicationId, ExecutionId, OperationContext } from "@interface-compiler/domain"
import {
  createWorthApplicationReadAdapter,
  createWorthStartExecutionAdapter,
  InterfaceCompilerWorthClient,
  type WorthApplicationReadResult,
} from "../src/index.js"

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
    assert.equal(result.evidence.projectedFieldCount, 2)
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
    message: "this host exposes only read_application and start_execution",
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
