import assert from "node:assert/strict"
import test from "node:test"
import { planDirectExperiment } from "../src/planning.js"
import { createWalmartBenchmarkStepPolicy } from "../src/walmart-benchmark/step-policy.js"
import { createWalmartExperimentRequest } from "../src/walmart-benchmark/task.js"

function guard() {
  const plan = planDirectExperiment(createWalmartExperimentRequest())
  if (!plan.ok) throw new Error("the fixed Walmart direct plan must be valid")
  const admission = createWalmartBenchmarkStepPolicy().admit(plan.value)
  if (admission.kind !== "admitted") throw new Error("the fixed Walmart direct plan must be admitted")
  return admission.guard
}

test("admits only the fixed public Tide Pods value through a product search field or URL", () => {
  const policy = guard()
  assert.deepEqual(policy.admit({ type: "fill", target: { semanticDescription: "Walmart product search", role: "searchbox" }, value: "Tide Pods" }), { kind: "admitted" })
  assert.equal(policy.admit({ type: "fill", target: { semanticDescription: "Walmart product search", role: "searchbox" }, value: "person@example.com" }).kind, "denied")
  assert.deepEqual(policy.admit({ type: "navigate", url: "https://www.walmart.com/search?q=Tide%20Pods" }), { kind: "admitted" })
  assert.equal(policy.admit({ type: "navigate", url: "https://www.walmart.com/search?q=arbitrary" }).kind, "denied")
  assert.equal(policy.admit({ type: "navigate", url: "https://www.walmart.com/search" }).kind, "denied")
  assert.equal(policy.admit({ type: "navigate", url: "https://example.com/search?q=Tide%20Pods" }).kind, "denied")
  assert.equal(policy.admit({ type: "navigate", url: "http://www.walmart.com/search?q=Tide%20Pods" }).kind, "denied")
  assert.equal(policy.admit({ type: "navigate", url: "https://www.walmart.com:8443/search?q=Tide%20Pods" }).kind, "denied")
})

test("admits exactly one Tide Pods add-to-cart action and rejects ambiguous or quantity-increasing actions", () => {
  const policy = guard()
  const addTidePods = { type: "click", target: { semanticDescription: "first Tide Pods result Add to cart", role: "button", name: "Add to cart" } } as const
  assert.deepEqual(policy.admit(addTidePods), { kind: "admitted" })
  assert.equal(policy.admit(addTidePods).kind, "denied")

  const ambiguous = guard()
  assert.equal(ambiguous.admit({ type: "click", target: { semanticDescription: "Add to cart", role: "button", name: "Add to cart" } }).kind, "denied")
  assert.equal(ambiguous.admit({ type: "click", target: { semanticDescription: "Add", role: "button", name: "Add" } }).kind, "denied")
  assert.equal(ambiguous.admit({ type: "click", target: { semanticDescription: "Increase quantity", role: "button" } }).kind, "denied")
  assert.equal(ambiguous.admit({ type: "click", target: { semanticDescription: "Tide Pods quantity", role: "button", name: "+" } }).kind, "denied")
})
