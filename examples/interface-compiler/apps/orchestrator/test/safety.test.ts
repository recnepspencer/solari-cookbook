import assert from "node:assert/strict"
import test from "node:test"
import type { Observation } from "@interface-compiler/domain"
import { assessObservationSafety, assessReplayStepSafety, detectSafetySignal } from "../src/index.js"

const observedAt = "2026-08-31T12:00:00.000Z"

test("classifies every human-required credential, personal, checkout, and access boundary", () => {
  const cases = [
    [["Password"], "authentication_required"],
    [["Two-factor code"], "authentication_required"],
    [["Credentials are required"], "authentication_required"],
    [["Authentication required"], "authentication_required"],
    [["Account"], "authentication_required"],
    [["email address"], "personal_information_required"],
    [["Please enter your address"], "shipping_details_required"],
    [["shipping address"], "shipping_details_required"],
    [["credit card number"], "payment_details_required"],
    [["Enter your card information"], "payment_details_required"],
    [["Billing address"], "payment_details_required"],
    [["Checkout"], "order_placement"],
    [["Continue as guest"], "order_placement"],
    [["Continue to payment"], "order_placement"],
    [["Review your order"], "order_placement"],
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

test("ignores passive global sign-in navigation but stops when checkout is actionable", () => {
  const passive = {
    id: "observation.passive",
    sessionId: "session.passive",
    url: "https://www.walmart.com/search?q=Tide%20Pods",
    title: "Tide Pods - Walmart.com",
    pageSummary: "Search results",
    interactables: [{ kind: "link", role: "link", name: "Sign In Account" }, { kind: "button", role: "button", name: "Add to cart" }],
    observedAt,
  } as unknown as Observation
  const passiveResult = assessObservationSafety(passive)
  assert.equal(passiveResult.ok, true)
  if (passiveResult.ok) assert.equal(passiveResult.value.kind, "continue")

  const checkoutResult = assessObservationSafety({ ...passive, id: "observation.checkout" as Observation["id"], interactables: [...passive.interactables, { kind: "button", role: "button", name: "Checkout" }] })
  assert.equal(checkoutResult.ok, true)
  if (!checkoutResult.ok || checkoutResult.value.kind !== "stop") throw new Error("expected checkout stop")
  assert.equal(checkoutResult.value.result.reason, "order_placement")
})

test("passive account chrome cannot mask another human-required boundary", () => {
  const pageBoundary = {
    id: "observation.shipping",
    sessionId: "session.shipping",
    url: "https://www.walmart.com/cart",
    title: "Account | Cart",
    pageSummary: "Shipping address required",
    interactables: [],
    observedAt,
  } as unknown as Observation
  const pageResult = assessObservationSafety(pageBoundary)
  assert.equal(pageResult.ok, true)
  if (!pageResult.ok || pageResult.value.kind !== "stop") throw new Error("expected shipping stop")
  assert.equal(pageResult.value.result.reason, "shipping_details_required")

  const interactableResult = assessObservationSafety({
    ...pageBoundary,
    id: "observation.checkout-account" as Observation["id"],
    title: "Cart",
    pageSummary: "Cart",
    interactables: [{ kind: "button", role: "button", name: "Account / Checkout" }],
  })
  assert.equal(interactableResult.ok, true)
  if (!interactableResult.ok || interactableResult.value.kind !== "stop") throw new Error("expected checkout stop")
  assert.equal(interactableResult.value.result.reason, "order_placement")
})

test("allows only the bounded product-search fill and stops all other unknown fills before effects", () => {
  const search = assessReplayStepSafety({ type: "fill", target: { semanticDescription: "Walmart product search", role: "searchbox" }, value: "Tide Pods" }, observedAt)
  assert.equal(search.ok, true)
  if (search.ok) assert.equal(search.value.kind, "continue")

  const unknown = assessReplayStepSafety({ type: "fill", target: { semanticDescription: "optional field", role: "textbox" }, value: "never inspected" }, observedAt)
  assert.equal(unknown.ok, true)
  if (!unknown.ok || unknown.value.kind !== "stop") throw new Error("expected unknown fill stop")
  assert.equal(unknown.value.result.reason, "personal_information_required")
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
