import assert from "node:assert/strict"
import test from "node:test"
import type { EvidenceId, ObservationId } from "@interface-compiler/domain"
import { context, createWorld, executeStepAt, sessionRequest } from "./fake-solari.js"

test("observation and replay steps use the Playwright-compatible Solari page surface", async () => {
  const world = createWorld()
  world.browser.page.addElement({ tagName: "button", textContent: "Add to cart", attributes: { role: "button", "aria-label": "Add to cart" } })
  world.browser.page.addElement({ tagName: "input", attributes: { name: "search", "aria-label": "Search" } })
  const operationContext = context(world.clock)
  const created = await world.port.createSession(sessionRequest(), operationContext)
  assert.equal(created.kind, "created")
  if (created.kind !== "created") throw new Error("expected a session")
  const session = created.lease.session

  const observed = await session.observe(operationContext)
  assert.equal(observed.kind, "observed")
  if (observed.kind !== "observed") throw new Error("expected an observation")
  assert.equal(observed.observation.sessionId, "solari.session.test")
  assert.equal(observed.observation.title, "Shop")
  assert.deepEqual(observed.observation.interactables.map((item) => item.semanticGuess), ["Add to cart", "Search"])
  assert.equal(world.browser.newPageCalls, 1)

  const clicked = await executeStepAt(session, 4, {
    type: "click",
    target: { semanticDescription: "Add to cart", role: "button" },
  }, operationContext)
  assert.deepEqual(clicked, { kind: "completed", effect: { kind: "completed" } })
  assert.equal(world.browser.page.locatorValue.clickCalls, 1)
  assert.deepEqual(world.browser.page.targetResolutions, ["role:button:Add to cart"])

  const navigated = await executeStepAt(session, 5, { type: "navigate", url: "https://shop.test/cart" }, operationContext)
  assert.deepEqual(navigated, { kind: "completed", effect: { kind: "completed" } })
  assert.deepEqual(world.browser.page.gotoValues, ["https://shop.test/cart"])

  const closed = await created.lease.release(operationContext)
  assert.deepEqual(closed, { kind: "closed", sessionId: "solari.session.test", effect: { kind: "completed" } })
})

test("observation omits inactive hidden controls so they cannot create a false safety boundary", async () => {
  const world = createWorld()
  world.browser.page.addElement({ tagName: "input", attributes: { name: "contact-name", hidden: "" } })
  world.browser.page.addElement({ tagName: "input", attributes: { name: "credit-card", "aria-hidden": "true" } })
  world.browser.page.addElement({ tagName: "button", textContent: "Add to cart", attributes: { role: "button" } })
  const created = await world.port.createSession(sessionRequest(), context(world.clock))
  assert.equal(created.kind, "created")
  if (created.kind !== "created") throw new Error("expected a session")

  const observed = await created.lease.session.observe(context(world.clock))
  assert.equal(observed.kind, "observed")
  if (observed.kind !== "observed") throw new Error("expected an observation")
  assert.deepEqual(observed.observation.interactables.map((item) => item.semanticGuess), ["Add to cart"])
})

test("navigation outside the application origin is denied before the page navigates and retains a recording receipt", async () => {
  const world = createWorld()
  const operationContext = context(world.clock)
  const created = await world.port.createSession(sessionRequest(), operationContext)
  assert.equal(created.kind, "created")
  if (created.kind !== "created") throw new Error("expected a session")

  const result = await executeStepAt(created.lease.session, 7, { type: "navigate", url: "https://outside.example/cart" }, operationContext)
  assert.equal(result.kind, "failed")
  if (result.kind !== "failed") throw new Error("expected a step failure")
  assert.equal(result.failure.kind, "step_failed")
  assert.equal(result.failure.stepIndex, 7)
  assert.equal(result.failure.message, "Solari navigation left the application origin")
  assert.equal(result.failure.evidenceIds.length, 1)
  assert.deepEqual(world.browser.page.gotoValues, [])
  assert.equal(world.browser.closeCalls, 1)
  assert.equal(world.client.closeCalls, 1)
})

test("navigation containing credentials is denied even when its origin matches", async () => {
  const world = createWorld()
  const operationContext = context(world.clock)
  const created = await world.port.createSession(sessionRequest(), operationContext)
  assert.equal(created.kind, "created")
  if (created.kind !== "created") throw new Error("expected a session")

  const result = await executeStepAt(created.lease.session, 8, { type: "navigate", url: "https://user:secret@shop.test/private" }, operationContext)
  assert.equal(result.kind, "failed")
  if (result.kind !== "failed") throw new Error("expected a step failure")
  assert.equal(result.failure.kind, "step_failed")
  assert.equal(result.failure.message, "Solari navigation left the application origin")
  assert.equal(result.failure.evidenceIds.length, 1)
  assert.deepEqual(world.browser.page.gotoValues, [])
})

test("read steps are rejected until the domain port has an output carrier", async () => {
  const world = createWorld()
  const operationContext = context(world.clock)
  const created = await world.port.createSession(sessionRequest(), operationContext)
  assert.equal(created.kind, "created")
  if (created.kind !== "created") throw new Error("expected a session")

  const result = await executeStepAt(created.lease.session, 9, {
    type: "read",
    target: { semanticDescription: "order number" },
    outputKey: "orderNumber",
  }, operationContext)
  assert.equal(result.kind, "failed")
  if (result.kind !== "failed") throw new Error("expected a step failure")
  assert.equal(result.failure.kind, "step_failed")
  assert.equal(result.failure.message, "Solari cannot return read-step output through the current domain port")
  assert.equal(result.effect.kind, "not_started")
  assert.deepEqual(world.browser.page.targetResolutions, [])
  assert.equal(result.failure.evidenceIds.length, 1)
})

test("session recording evidence is an SDK replay URL receipt and unsupported artifacts are not fabricated", async () => {
  const world = createWorld()
  const operationContext = context(world.clock)
  const created = await world.port.createSession(sessionRequest(), operationContext)
  assert.equal(created.kind, "created")
  if (created.kind !== "created") throw new Error("expected a session")

  const receipt = await created.lease.session.captureEvidence({ kind: "session_recording" }, operationContext)
  assert.deepEqual(receipt, {
    kind: "captured",
    reference: {
      evidenceId: "evidence.1",
      kind: "session_recording",
      externalRef: "https://replay.test/session/receipt",
    },
    effect: { kind: "completed" },
  })
  const repeated = await created.lease.session.captureEvidence({ kind: "session_recording" }, operationContext)
  assert.deepEqual(repeated, receipt)

  const unsupported = await created.lease.session.captureEvidence({ kind: "screenshot", observationId: "observation.not-used" as ObservationId }, operationContext)
  assert.deepEqual(unsupported, {
    kind: "failed",
    message: "Solari can provide session recordings but not this evidence kind",
    retryable: false,
    effect: { kind: "not_started" },
  })
  assert.equal(world.browser.closeCalls, 1)
  assert.equal(world.client.closeCalls, 1)
})

test("recording receipt follows the SDK's asynchronous post-release replay availability", async () => {
  const world = createWorld()
  let attempts = 0
  world.client.replayBehavior = async () => {
    attempts += 1
    if (attempts < 3) throw { status: 404 }
    return { url: "https://replay.test/session/after-upload" }
  }
  const operationContext = context(world.clock)
  const created = await world.port.createSession(sessionRequest(), operationContext)
  assert.equal(created.kind, "created")
  if (created.kind !== "created") throw new Error("expected a session")

  const result = await created.lease.session.captureEvidence({ kind: "session_recording" }, operationContext)
  assert.equal(result.kind, "captured")
  if (result.kind !== "captured") throw new Error("expected a recording receipt")
  assert.equal(result.reference.externalRef, "https://replay.test/session/after-upload")
  assert.equal(attempts, 3)
})

test("a positive evidence-byte budget admits a URL-only receipt without materializing bytes", async () => {
  const world = createWorld()
  const operationContext = context(world.clock, undefined, { maxEvidenceBytes: 1 })
  const created = await world.port.createSession(sessionRequest(), operationContext)
  assert.equal(created.kind, "created")
  if (created.kind !== "created") throw new Error("expected a session")

  const result = await created.lease.session.captureEvidence({ kind: "session_recording" }, operationContext)
  assert.equal(result.kind, "captured")
  if (result.kind !== "captured") throw new Error("expected a recording receipt")
  assert.equal(result.reference.externalRef, "https://replay.test/session/receipt")
  assert.equal(world.browser.closeCalls, 1)
  assert.equal(world.client.closeCalls, 1)
})

test("evidence ID allocation failure after replay lookup reports an unknown effect", async () => {
  const world = createWorld()
  let replayLookedUp = false
  world.client.replayBehavior = async () => {
    replayLookedUp = true
    return { url: "https://replay.test/session/id-failure" }
  }
  world.ids.nextEvidenceId = () => {
    assert.equal(replayLookedUp, true)
    throw new Error("id source failed")
  }
  const operationContext = context(world.clock)
  const created = await world.port.createSession(sessionRequest(), operationContext)
  assert.equal(created.kind, "created")
  if (created.kind !== "created") throw new Error("expected a session")

  const result = await created.lease.session.captureEvidence({ kind: "session_recording" }, operationContext)
  assert.deepEqual(result, { kind: "failed", message: "Solari adapter could not allocate a domain receipt id", retryable: false, effect: { kind: "unknown", recovery: "owner_reconciliation_required" } })
  assert.equal(world.browser.closeCalls, 1)
  assert.equal(world.client.closeCalls, 1)
})

test("blank evidence IDs after replay lookup report an unknown effect", async () => {
  const world = createWorld()
  let replayLookedUp = false
  world.client.replayBehavior = async () => {
    replayLookedUp = true
    return { url: "https://replay.test/session/blank-id" }
  }
  world.ids.nextEvidenceId = () => {
    assert.equal(replayLookedUp, true)
    return "" as EvidenceId
  }
  const operationContext = context(world.clock)
  const created = await world.port.createSession(sessionRequest(), operationContext)
  assert.equal(created.kind, "created")
  if (created.kind !== "created") throw new Error("expected a session")

  const result = await created.lease.session.captureEvidence({ kind: "session_recording" }, operationContext)
  assert.deepEqual(result, { kind: "failed", message: "Solari adapter could not allocate a domain receipt id", retryable: false, effect: { kind: "unknown", recovery: "owner_reconciliation_required" } })
  assert.equal(world.browser.closeCalls, 1)
  assert.equal(world.client.closeCalls, 1)
})
