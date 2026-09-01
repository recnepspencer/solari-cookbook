import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { promisify } from "node:util"
import type { ApplicationId, OperationContext } from "@interface-compiler/domain"
import {
  createWorthApplicationReadAdapter,
  InterfaceCompilerWorthClient,
  type WorthApplicationReadResult,
} from "../src/index.js"

const interfaceCompilerRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)))
const hostManifest = resolve(interfaceCompilerRoot, "worth-runtime-host/Cargo.toml")
const execFileAsync = promisify(execFile)

function id(value: string): ApplicationId {
  return value as ApplicationId
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
  await execFileAsync("cargo", ["build", "--quiet", "--manifest-path", hostManifest, "--bin", "worth-runtime-host"], {
    cwd: interfaceCompilerRoot,
    windowsHide: true,
  })
})

test("client crosses the process boundary and returns the WORTH application projection", async (testContext) => {
  const client = new InterfaceCompilerWorthClient({
    process: {
      command: "cargo",
      args: ["run", "--quiet", "--manifest-path", hostManifest, "--", "--serve"],
      cwd: interfaceCompilerRoot,
    },
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
    process: {
      command: "cargo",
      args: ["run", "--quiet", "--manifest-path", hostManifest, "--", "--serve"],
      cwd: interfaceCompilerRoot,
    },
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
