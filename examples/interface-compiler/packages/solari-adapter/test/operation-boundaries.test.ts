import assert from "node:assert/strict"
import test from "node:test"
import { context, createWorld, delayed, executeStepAt, TestCancellation, sessionRequest } from "./fake-solari.js"

test("cancellation during a pending browser action returns unknown effect posture and closes the session", async () => {
  const world = createWorld()
  world.browser.page.addElement({ tagName: "button", textContent: "Add to cart" })
  const cancellation = new TestCancellation()
  const operationContext = context(world.clock, cancellation)
  const created = await world.port.createSession(sessionRequest(), operationContext)
  assert.equal(created.kind, "created")
  if (created.kind !== "created") throw new Error("expected a session")

  const pendingClick = delayed<void>()
  world.browser.page.locatorValue.clickBehavior = () => pendingClick.promise
  const stepPromise = executeStepAt(created.lease.session, 2, {
    type: "click",
    target: { semanticDescription: "Add to cart", role: "button" },
  }, operationContext)
  await new Promise<void>((resolve) => setImmediate(resolve))
  cancellation.cancel()

  const result = await stepPromise
  assert.deepEqual(result, {
    kind: "cancelled",
    safePoint: "after_step",
    effect: { kind: "unknown", recovery: "owner_reconciliation_required" },
  })
  await created.lease.release(operationContext)
  assert.equal(world.browser.closeCalls, 1)
  assert.equal(world.client.closeCalls, 1)
  pendingClick.resolve()
})

test("deadline during a pending browser action returns unknown effect posture and closes the session", async () => {
  const world = createWorld()
  world.browser.page.addElement({ tagName: "button", textContent: "Add to cart" })
  const operationContext = context(world.clock, new TestCancellation(), {}, 20)
  const created = await world.port.createSession(sessionRequest(), operationContext)
  assert.equal(created.kind, "created")
  if (created.kind !== "created") throw new Error("expected a session")

  const pendingClick = delayed<void>()
  world.browser.page.locatorValue.clickBehavior = () => pendingClick.promise
  const stepPromise = executeStepAt(created.lease.session, 3, {
    type: "click",
    target: { semanticDescription: "Add to cart", role: "button" },
  }, operationContext)
  await new Promise<void>((resolve) => setImmediate(resolve))

  const result = await stepPromise
  assert.deepEqual(result, {
    kind: "timed_out",
    effect: { kind: "unknown", recovery: "owner_reconciliation_required" },
  })
  await created.lease.release(operationContext)
  assert.equal(world.browser.closeCalls, 1)
  assert.equal(world.client.closeCalls, 1)
  pendingClick.resolve()
})

for (const interruption of ["cancelled", "timed_out"] as const) test(`${interruption} during target inspection cannot dispatch a late click`, async () => {
  const world = createWorld()
  world.browser.page.addElement({ tagName: "button", textContent: "Add to cart" })
  const cancellation = new TestCancellation()
  const operationContext = context(world.clock, cancellation)
  const created = await world.port.createSession(sessionRequest(), operationContext)
  assert.equal(created.kind, "created")
  if (created.kind !== "created") throw new Error("expected a session")
  const inspected = delayed<void>()
  const releaseInspection = delayed<void>()
  const locator = world.browser.page.locatorValue
  locator.evaluateAll = async (evaluate) => {
    inspected.resolve()
    await releaseInspection.promise
    return evaluate(locator.elements)
  }
  const pending = executeStepAt(created.lease.session, 0, { type: "click", target: { semanticDescription: "Add to cart", role: "button" } }, operationContext)
  await inspected.promise
  if (interruption === "cancelled") cancellation.cancel()
  else world.clock.currentMs = Date.parse(operationContext.deadlineAt) + 1
  releaseInspection.resolve()
  const result = await pending
  assert.notEqual(result.kind, "completed")
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(locator.clickCalls, 0)
  await created.lease.release(operationContext)
})

test("browser-action budget denial occurs before the second SDK action", async () => {
  const world = createWorld()
  world.browser.page.addElement({ tagName: "button", textContent: "Add to cart" })
  const operationContext = context(world.clock, new TestCancellation(), { maxBrowserActions: 1 })
  const created = await world.port.createSession(sessionRequest(), operationContext)
  assert.equal(created.kind, "created")
  if (created.kind !== "created") throw new Error("expected a session")

  const first = await executeStepAt(created.lease.session, 0, {
    type: "click",
    target: { semanticDescription: "Add to cart", role: "button" },
  }, operationContext)
  assert.deepEqual(first, { kind: "completed", effect: { kind: "completed" } })
  const second = await executeStepAt(created.lease.session, 1, {
    type: "click",
    target: { semanticDescription: "Buy now", role: "button" },
  }, operationContext)
  assert.equal(second.kind, "failed")
  if (second.kind !== "failed") throw new Error("expected budget failure")
  assert.equal(second.failure.kind, "step_failed")
  if (second.failure.kind !== "step_failed") throw new Error("expected a replay step failure")
  assert.equal(second.failure.message, "Solari resource budget is exhausted")
  assert.equal(second.failure.stepIndex, 1)
  assert.equal(world.browser.page.locatorValue.clickCalls, 1)
  assert.equal(world.browser.closeCalls, 0)
  assert.equal(world.client.closeCalls, 0)
  await created.lease.release(operationContext)
  assert.equal(world.browser.closeCalls, 1)
  assert.equal(world.client.closeCalls, 1)
})

test("zero evidence budget denies receipt capture without claiming an artifact", async () => {
  const world = createWorld()
  const operationContext = context(world.clock, new TestCancellation(), { maxEvidenceBytes: 0 })
  const created = await world.port.createSession(sessionRequest(), operationContext)
  assert.equal(created.kind, "created")
  if (created.kind !== "created") throw new Error("expected a session")

  const result = await created.lease.session.captureEvidence({ kind: "session_recording" }, operationContext)
  assert.deepEqual(result, { kind: "failed", message: "Solari resource budget is exhausted", retryable: false, effect: { kind: "not_started" } })
  assert.equal(world.browser.closeCalls, 0)
  await created.lease.release(operationContext)
})

test("concurrent evidence workflows are serialized and only the owner closes the session", async () => {
  const world = createWorld()
  const operationContext = context(world.clock)
  const created = await world.port.createSession(sessionRequest(), operationContext)
  assert.equal(created.kind, "created")
  if (created.kind !== "created") throw new Error("expected a session")

  const replayLookup = delayed<unknown>()
  let attempts = 0
  world.client.replayBehavior = async () => {
    attempts += 1
    return replayLookup.promise
  }
  const firstPromise = created.lease.session.captureEvidence({ kind: "session_recording" }, operationContext)
  await new Promise<void>((resolve) => setImmediate(resolve))

  const second = await created.lease.session.captureEvidence({ kind: "session_recording" }, operationContext)
  assert.deepEqual(second, { kind: "failed", message: "Solari session already has an operation in flight", retryable: false, effect: { kind: "not_started" } })
  assert.equal(attempts, 1)
  assert.equal(world.browser.closeCalls, 1)
  assert.equal(world.client.closeCalls, 0)

  replayLookup.resolve({ url: "https://replay.test/session/serialized" })
  const first = await firstPromise
  assert.equal(first.kind, "captured")
  assert.equal(world.browser.closeCalls, 1)
  assert.equal(world.client.closeCalls, 1)
})
