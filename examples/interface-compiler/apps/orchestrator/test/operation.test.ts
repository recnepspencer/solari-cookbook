import assert from "node:assert/strict"
import test from "node:test"
import {
  type OperationContext,
} from "@interface-compiler/domain"
import {
  createCancellationSource,
  createOperationController,
  type RuntimeStop,
} from "../src/index.js"

const fixedNow = "2026-08-31T12:00:00.000Z"

function admittedContext(
  options: { readonly maxWallClockMs?: number; readonly maxModelCalls?: number; readonly maxBrowserActions?: number } = {},
  cancellation = createCancellationSource(),
): OperationContext {
  return Object.freeze({
    operationId: "operation.test" as OperationContext["operationId"],
    deadlineAt: "2026-08-31T12:00:01.500Z" as OperationContext["deadlineAt"],
    cancellation: cancellation.token,
    budget: Object.freeze({
      maxWallClockMs: options.maxWallClockMs ?? 1_500,
      ...(options.maxModelCalls === undefined ? {} : { maxModelCalls: options.maxModelCalls }),
      ...(options.maxBrowserActions === undefined ? {} : { maxBrowserActions: options.maxBrowserActions }),
    }),
    admission: { maxInFlight: 1, maxQueued: 0, overflow: "reject" as const },
  })
}

function controller(options: { readonly maxModelCalls?: number; readonly maxBrowserActions?: number } = {}) {
  const cancellation = createCancellationSource()
  const context = admittedContext(options, cancellation)
  const result = createOperationController({ admittedContext: context, clock: { now: () => fixedNow } })
  if (!result.ok) throw new Error(result.issues.map((entry) => `${entry.path}: ${entry.message}`).join(", "))
  return { controller: result.value, cancellation }
}

test("uses the Worth-admitted context without minting an id or deriving a deadline", () => {
  const context = admittedContext()
  const result = createOperationController({
    admittedContext: context,
    clock: { now: () => { throw new Error("the clock is not needed to accept an admitted context") } },
  })
  if (!result.ok) throw new Error("expected a valid operation")

  assert.equal(result.value.context, context)
  assert.equal(result.value.context.operationId, "operation.test")
  assert.equal(result.value.context.deadlineAt, "2026-08-31T12:00:01.500Z")
})

test("requires the bounded admission policy carried by the admitted context", () => {
  const context = admittedContext()
  const invalid = { ...context, admission: undefined } as unknown as OperationContext
  const result = createOperationController({ admittedContext: invalid, clock: { now: () => fixedNow } })
  assert.equal(result.ok, false)
  if (result.ok) throw new Error("expected context rejection")
  assert.ok(result.issues.some((entry) => entry.path === "admission"))
})

test("enforces the admitted wall-clock budget even when its absolute deadline is later", () => {
  let now = fixedNow
  const context = admittedContext({ maxWallClockMs: 100 })
  const result = createOperationController({ admittedContext: context, clock: { now: () => now } })
  if (!result.ok) throw new Error("expected a valid operation")
  assert.deepEqual(result.value.check(), { kind: "continue" })

  now = "2026-08-31T12:00:00.101Z"
  const gate = result.value.check()
  assert.equal(gate.kind, "stop")
  if (gate.kind !== "stop") throw new Error("expected wall-clock deadline stop")
  assert.equal(gate.stop.kind, "deadline_exceeded")
})

test("cancellation is terminal before any reserved effect", () => {
  const { controller: operation, cancellation } = controller({ maxModelCalls: 2, maxBrowserActions: 2 })
  assert.deepEqual(operation.check(), { kind: "continue" })
  cancellation.cancel()
  const gate = operation.reserveModelCall()
  assert.equal(gate.kind, "stop")
  if (gate.kind !== "stop") throw new Error("expected cancellation stop")
  assert.equal(gate.stop.kind, "cancelled")
  assert.equal(gate.stop.posture.kind, "not_started")
  assert.deepEqual(operation.snapshot(), { modelCalls: 0, browserActions: 0, evidenceBytes: 0 })
})

test("model, browser, and evidence budgets stop at their typed boundaries", () => {
  const { controller: operation } = controller({ maxModelCalls: 1, maxBrowserActions: 1 })
  assert.deepEqual(operation.reserveModelCall(), { kind: "continue" })
  assertBudgetStop(operation.reserveModelCall(), "model_calls", 1)

  assert.deepEqual(operation.reserveBrowserAction(), { kind: "continue" })
  assertBudgetStop(operation.reserveBrowserAction(), "browser_actions", 1)

  const evidenceResult = operation.reserveEvidenceBytes(-1)
  assert.equal(evidenceResult.kind, "stop")
  if (evidenceResult.kind !== "stop") throw new Error("expected invalid budget request")
  assert.equal(evidenceResult.stop.kind, "invalid_budget_request")
})

function assertBudgetStop(
  gate: { readonly kind: "continue" } | { readonly kind: "stop"; readonly stop: RuntimeStop },
  resource: "model_calls" | "browser_actions",
  limit: number,
): void {
  assert.equal(gate.kind, "stop")
  if (gate.kind !== "stop") throw new Error("expected budget stop")
  assert.equal(gate.stop.kind, "budget_exhausted")
  if (gate.stop.kind !== "budget_exhausted") throw new Error("expected budget exhaustion")
  assert.equal(gate.stop.resource, resource)
  assert.equal(gate.stop.limit, limit)
}
