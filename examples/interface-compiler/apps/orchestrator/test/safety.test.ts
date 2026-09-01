import assert from "node:assert/strict"
import test from "node:test"
import { assessReplayStepSafety, detectSafetySignal } from "../src/index.js"

const observedAt = "2026-08-31T12:00:00.000Z"

test("classifies every human-required credential, personal, checkout, and access boundary", () => {
  const cases = [
    [["Password"], "authentication_required"],
    [["Two-factor code"], "authentication_required"],
    [["Credentials are required"], "authentication_required"],
    [["Authentication required"], "authentication_required"],
    [["email address"], "personal_information_required"],
    [["Please enter your address"], "shipping_details_required"],
    [["shipping address"], "shipping_details_required"],
    [["credit card number"], "payment_details_required"],
    [["Enter your card information"], "payment_details_required"],
    [["Billing address"], "payment_details_required"],
    [["Checkout"], "safe_to_continue"],
    [["Place order"], "order_placement"],
    [["Access denied"], "access_control_required"],
    [["Permission required"], "access_control_required"],
    [["Authorization required"], "access_control_required"],
    [["You need permission"], "access_control_required"],
    [["Please authenticate"], "authentication_required"],
    [["Contact info required"], "personal_information_required"],
    [["Address required"], "shipping_details_required"],
    [["Submit your order"], "order_placement"],
    [["Complete the purchase"], "order_placement"],
    [["Add to cart"], "safe_to_continue"],
  ] as const

  for (const [descriptions, expected] of cases) assert.equal(detectSafetySignal(descriptions).kind, expected)
})

test("checks a replay action before the Solari effect is invoked", () => {
  const result = assessReplayStepSafety({
    type: "fill",
    target: { semanticDescription: "payment card number", role: "textbox" },
    value: "never inspected by the boundary detector",
  }, observedAt)
  assert.equal(result.ok, true)
  if (!result.ok || result.value.kind !== "stop") throw new Error("expected payment safety stop")
  assert.equal(result.value.result.reason, "payment_details_required")
})

test("fails closed on sensitive selectors and bare boundary labels", () => {
  assert.equal(detectSafetySignal(["input[name=card-number]"]).kind, "payment_details_required")
  assert.equal(detectSafetySignal(["#password"]).kind, "authentication_required")
  assert.equal(detectSafetySignal(["input[name=auth_token]"]).kind, "authentication_required")
  assert.equal(detectSafetySignal(["[data-testid=permission]"]).kind, "access_control_required")
  assert.equal(detectSafetySignal(["[data-role=admin]"]).kind, "access_control_required")
  assert.equal(detectSafetySignal(["authentication"]).kind, "authentication_required")
  assert.equal(detectSafetySignal(["button.place-order"]).kind, "order_placement")

  const result = assessReplayStepSafety({
    type: "fill",
    target: { semanticDescription: "payment field", selector: "#card-number" },
    value: "never inspected by the boundary detector",
  }, observedAt)
  assert.equal(result.ok, true)
  if (!result.ok || result.value.kind !== "stop") throw new Error("expected selector safety stop")
  assert.equal(result.value.result.reason, "payment_details_required")
})
