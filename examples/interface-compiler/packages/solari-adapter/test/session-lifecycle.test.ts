import assert from "node:assert/strict"
import test from "node:test"
import { context, createWorld, delayed, sessionRequest, TestCancellation } from "./fake-solari.js"

test("fresh browser creation enables recording and close releases browser and SDK client exactly once", async () => {
  const world = createWorld()
  const closeOrder: string[] = []
  world.browser.closeBehavior = async () => { closeOrder.push("browser") }
  world.client.closeBehavior = async () => { closeOrder.push("client") }
  const operationContext = context(world.clock)
  const result = await world.port.createSession(sessionRequest(), operationContext)
  assert.equal(result.kind, "created")
  if (result.kind !== "created") throw new Error("expected a session")
  assert.deepEqual(world.client.launchCalls, [{ recording: true }])

  const closes = await Promise.all([result.session.close(operationContext), result.session.close(operationContext)])
  assert.deepEqual(closes, [{ kind: "closed" }, { kind: "closed" }])
  assert.deepEqual(closeOrder, ["browser", "client"])
  assert.equal(world.browser.closeCalls, 1)
  assert.equal(world.client.closeCalls, 1)
})

test("launch failure closes the client without inventing a session", async () => {
  const world = createWorld()
  world.client.launchBehavior = async () => {
    throw new Error("provider response contains a secret that must not escape")
  }

  const result = await world.port.createSession(sessionRequest(), context(world.clock))
  assert.deepEqual(result, { kind: "failed", message: "Solari SDK operation failed", retryable: true })
  assert.equal(world.client.closeCalls, 1)
  assert.equal(world.browser.closeCalls, 0)
})

test("an expired creation context does not launch a browser and still releases the SDK client", async () => {
  const world = createWorld()
  const operationContext = context(world.clock)
  const expiredContext = { ...operationContext, deadlineAt: new Date(Date.now() - 1).toISOString() }

  const result = await world.port.createSession(sessionRequest(), expiredContext)
  assert.deepEqual(result, { kind: "timed_out" })
  assert.equal(world.client.launchCalls.length, 0)
  assert.equal(world.client.closeCalls, 1)
})

test("pending launch cancellation defers client close until a late browser can close first", async () => {
  const world = createWorld()
  const cancellation = new TestCancellation()
  const operationContext = context(world.clock, cancellation)
  const launch = delayed<unknown>()
  const closeOrder: string[] = []
  world.client.launchBehavior = () => launch.promise
  world.browser.closeBehavior = async () => { closeOrder.push("browser") }
  world.client.closeBehavior = async () => { closeOrder.push("client") }

  const creationPromise = world.port.createSession(sessionRequest(), operationContext)
  await new Promise<void>((resolve) => setImmediate(resolve))
  cancellation.cancel()

  const result = await creationPromise
  assert.deepEqual(result, { kind: "cancelled" })
  assert.equal(world.client.closeCalls, 0)

  launch.resolve(world.browser)
  for (let attempt = 0; attempt < 20 && closeOrder.length < 2; attempt += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  assert.deepEqual(closeOrder, ["browser", "client"])
  assert.equal(world.browser.closeCalls, 1)
  assert.equal(world.client.closeCalls, 1)
})

test("reused-session requests fail closed because the Solari port only owns fresh sessions", async () => {
  const world = createWorld()
  const result = await world.port.createSession(sessionRequest("reused"), context(world.clock))
  assert.deepEqual(result, { kind: "failed", message: "Solari adapter can create fresh sessions only", retryable: false })
  assert.equal(world.client.launchCalls.length, 0)
})

test("cleanup reports a terminal close failure without retrying either owner", async () => {
  const world = createWorld()
  world.browser.closeBehavior = async () => {
    throw new Error("browser close failed")
  }
  world.client.closeBehavior = async () => {
    throw new Error("client close failed")
  }
  const created = await world.port.createSession(sessionRequest(), context(world.clock))
  assert.equal(created.kind, "created")
  if (created.kind !== "created") throw new Error("expected a session")

  const first = await created.session.close(context(world.clock))
  const second = await created.session.close(context(world.clock))
  assert.deepEqual(first, { kind: "close_failed", message: "Solari session cleanup failed", retryable: false })
  assert.deepEqual(second, first)
  assert.equal(world.browser.closeCalls, 1)
  assert.equal(world.client.closeCalls, 1)
})
