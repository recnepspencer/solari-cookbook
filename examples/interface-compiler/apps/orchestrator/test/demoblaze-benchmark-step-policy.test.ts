import assert from "node:assert/strict"
import test from "node:test"
import { planDirectExperiment } from "../src/planning.js"
import { createDemoblazeBenchmarkStepPolicy } from "../src/demoblaze-benchmark/step-policy.js"
import { createDemoblazeExperimentRequest } from "../src/demoblaze-benchmark/task.js"

function guard() {
  const plan = planDirectExperiment(createDemoblazeExperimentRequest())
  if (!plan.ok) throw new Error("the fixed Demoblaze direct plan must be valid")
  const admission = createDemoblazeBenchmarkStepPolicy().admit(plan.value)
  if (admission.kind !== "admitted") throw new Error("the fixed Demoblaze direct plan must be admitted")
  return admission.guard
}

test("admits only the fixed public Demoblaze product path", () => {
  const policy = guard()
  assert.deepEqual(policy.admit({ type: "navigate", url: "https://www.demoblaze.com/" }), { kind: "admitted" })
  assert.deepEqual(policy.admit({ type: "click", target: { semanticDescription: "Phones category", role: "link", name: "Phones" } }), { kind: "admitted" })
  assert.deepEqual(policy.admit({ type: "click", target: { semanticDescription: "Samsung galaxy s6 product", role: "link", name: "Samsung galaxy s6" } }), { kind: "admitted" })
  assert.deepEqual(policy.admit({ type: "click", target: { semanticDescription: "Samsung galaxy s6 Add to cart", role: "link", name: "Add to cart" } }), { kind: "admitted" })
  assert.deepEqual(policy.admit({ type: "click", target: { semanticDescription: "Cart", role: "link", name: "Cart" } }), { kind: "admitted" })
  assert.equal(policy.admit({ type: "fill", target: { semanticDescription: "credit card", role: "textbox" }, value: "never-entered" }).kind, "denied")
  assert.equal(guard().admit({ type: "navigate", url: "https://example.com/" }).kind, "denied")
  assert.equal(guard().admit({ type: "navigate", url: "http://www.demoblaze.com/" }).kind, "denied")
  assert.equal(guard().admit({ type: "navigate", url: "https://www.demoblaze.com:8443/" }).kind, "denied")
})

test("admits exactly one fixed-product add-to-cart action and rejects every detour", () => {
  const policy = guard()
  const product = { type: "click", target: { semanticDescription: "Samsung galaxy s6 product", role: "link", name: "Samsung galaxy s6" } } as const
  const add = { type: "click", target: { semanticDescription: "Samsung galaxy s6 Add to cart", role: "link", name: "Add to cart" } } as const
  assert.deepEqual(policy.admit(product), { kind: "admitted" })
  assert.deepEqual(policy.admit(add), { kind: "admitted" })
  assert.equal(policy.admit(add).kind, "denied")

  const ambiguous = guard()
  assert.equal(ambiguous.admit({ type: "click", target: { semanticDescription: "Nexus 6 product", role: "link", name: "Nexus 6" } }).kind, "denied")
  assert.equal(ambiguous.admit({ type: "click", target: { semanticDescription: "Add to cart", role: "button", name: "Add to cart" } }).kind, "denied")
  assert.equal(ambiguous.admit({ type: "click", target: { semanticDescription: "Increase quantity", role: "button" } }).kind, "denied")
  assert.equal(ambiguous.admit({ type: "click", target: { semanticDescription: "Place Order", role: "button", name: "Place Order" } }).kind, "denied")
})

test("permits one informational-modal close before product navigation", () => {
  const policy = guard()
  const close = { type: "click", target: { semanticDescription: "Close", role: "button", name: "Close" } } as const
  assert.deepEqual(policy.admit(close), { kind: "admitted" })
  assert.equal(policy.admit(close).kind, "denied")
})
