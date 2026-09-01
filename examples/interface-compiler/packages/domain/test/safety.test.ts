import assert from "node:assert/strict"
import test from "node:test"
import {
  classifySafetyBoundary,
  createExecution,
  finishExecution,
  isSafetyStopResult,
  type ExecutionId,
  type CapabilityId,
  type SafetyAssessment,
  type SafetySignal,
  type ValidationResult,
} from "../src/index.js"

const observedAt = "2026-08-31T12:00:00.000Z"

function id<T extends string>(value: string): T {
  return value as T
}

function unwrap<T>(result: ValidationResult<T>): T {
  if (!result.ok) throw new Error(result.issues.map((entry) => `${entry.path}: ${entry.message}`).join(", "))
  return result.value
}

test("safe observation is a non-terminal continuation", () => {
  const assessment = unwrap(classifySafetyBoundary({ observedAt, signal: { kind: "safe_to_continue" } }))
  assert.deepEqual(assessment, { kind: "continue", terminal: false })
})

test("authentication, personal, shipping, payment, order, and access boundaries are terminal stops", () => {
  const cases: readonly [SafetySignal, string][] = [
    [{ kind: "authentication_required", credential: "password" }, "authentication_required"],
    [{ kind: "personal_information_required", information: "identity" }, "personal_information_required"],
    [{ kind: "shipping_details_required" }, "shipping_details_required"],
    [{ kind: "payment_details_required", payment: "card" }, "payment_details_required"],
    [{ kind: "order_placement" }, "order_placement"],
    [{ kind: "access_control_required" }, "access_control_required"],
  ]

  for (const [signal, reason] of cases) {
    const assessment: SafetyAssessment = unwrap(classifySafetyBoundary({ observedAt, signal }))
    assert.equal(assessment.kind, "stop")
    if (assessment.kind !== "stop") throw new Error("expected safety stop")
    assert.equal(assessment.terminal, true)
    assert.equal(assessment.result.kind, "safety_stop")
    assert.equal(assessment.result.reason, reason)
    assert.equal(assessment.result.nextAction, "human_required")
  }
})

test("invalid safety observation timestamps are rejected before classification", () => {
  const result = classifySafetyBoundary({ observedAt: "not-a-timestamp", signal: { kind: "safe_to_continue" } })
  assert.equal(result.ok, false)
})

test("a classified safety stop remains terminal when attached to an execution", () => {
  const assessment = unwrap(
    classifySafetyBoundary({
      observedAt,
      signal: { kind: "authentication_required", credential: "password" },
    }),
  )
  if (assessment.kind !== "stop") throw new Error("expected safety stop")

  const reflectedCopy = Object.create(Object.getPrototypeOf(assessment.result)) as Record<PropertyKey, unknown>
  for (const key of Reflect.ownKeys(assessment.result)) {
    const descriptor = Object.getOwnPropertyDescriptor(assessment.result, key)
    if (descriptor) Object.defineProperty(reflectedCopy, key, descriptor)
  }
  assert.equal(isSafetyStopResult(reflectedCopy), false)

  const execution = unwrap(
    createExecution({
      id: id<ExecutionId>("execution.checkout.1"),
      capabilityId: id<CapabilityId>("capability.begin-checkout"),
      mode: "compiled",
      metrics: {
        startedAt: observedAt,
        modelCalls: 1,
        inputTokens: 10,
        outputTokens: 5,
        browserObservations: 2,
        browserActions: 1,
        estimatedModelCostUsd: 0.01,
      },
    }),
  )
  const terminal = unwrap(finishExecution(execution, { kind: "safety_stop", stop: assessment.result }, "2026-08-31T12:00:01.000Z"))
  assert.equal(terminal.status, "stopped")
  if (terminal.status !== "stopped") throw new Error("expected stopped execution")
  assert.equal(terminal.outcome.stop.reason, "authentication_required")
})
