import assert from "node:assert/strict"
import test from "node:test"
import { context, createWorld, executeStepAt, sessionRequest } from "./fake-solari.js"

test("telemetry records only redacted operation facts when an SDK call fails", async () => {
  const world = createWorld()
  world.browser.page.addElement({ tagName: "input", attributes: { id: "password" } })
  const operationContext = context(world.clock)
  const created = await world.port.createSession(sessionRequest(), operationContext)
  assert.equal(created.kind, "created")
  if (created.kind !== "created") throw new Error("expected a session")

  world.browser.page.locatorValue.fillBehavior = async () => {
    throw new Error("raw password=secret-value url=https://shop.test/private")
  }
  const result = await executeStepAt(created.lease.session, 3, {
    type: "fill",
    target: { semanticDescription: "private field", selector: "#password" },
    value: "secret-value",
  }, operationContext)
  assert.equal(result.kind, "failed")

  const serializedTelemetry = JSON.stringify(world.telemetry.events)
  assert.equal(serializedTelemetry.includes("secret-value"), false)
  assert.equal(serializedTelemetry.includes("https://shop.test/private"), false)
  assert.equal(serializedTelemetry.includes("#password"), false)
  assert.equal(serializedTelemetry.includes("raw password"), false)
  assert.equal(world.telemetry.events.some((event) => event.errorCode === "sdk_failure"), true)
  assert.equal(world.telemetry.events.every((event) => event.schema === "interface-compiler.solari-adapter.telemetry" && event.version === 1), true)
})

test("malformed evidence kinds never enter redacted telemetry", async () => {
  const world = createWorld()
  const operationContext = context(world.clock)
  const created = await world.port.createSession(sessionRequest(), operationContext)
  assert.equal(created.kind, "created")
  if (created.kind !== "created") throw new Error("expected a session")

  const malformed = await created.lease.session.captureEvidence({ kind: "https://secret.example/evidence" } as never, operationContext)
  assert.deepEqual(malformed, { kind: "failed", message: "Solari browser request is invalid", retryable: false, effect: { kind: "not_started" } })
  const serializedTelemetry = JSON.stringify(world.telemetry.events)
  assert.equal(serializedTelemetry.includes("https://secret.example/evidence"), false)
  assert.equal(world.telemetry.events.some((event) => event.errorCode === "invalid_request" && event.evidenceKind === undefined), true)
  await created.lease.release(operationContext)
})
