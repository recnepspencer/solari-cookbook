import assert from "node:assert/strict"
import test from "node:test"
import type { JsonValue } from "@interface-compiler/domain"
import {
  createToolMetadata,
  validateSafeJsonSchema,
  validateToolMetadata,
  type ToolExample,
  type ToolMetadata,
  type ToolPublicationPolicy,
} from "../src/index.js"

const policy: ToolPublicationPolicy = {
  namespace: "store",
  audience: "gemini_consumer",
  applicationScope: { kind: "all" },
  capabilityScope: { kind: "all" },
  maxDescriptionLength: 160,
  maxExamples: 2,
  additionalForbiddenTerms: [],
}

function unwrapMetadata(result: ReturnType<typeof createToolMetadata>): ToolMetadata {
  if (result.kind === "invalid") throw new Error(result.violations.map((violation) => violation.kind).join(", "))
  return result.value
}

test("semantic metadata is copied and deeply frozen before publication", () => {
  const input = { productRef: "sku-42" }
  const examples: ToolExample[] = [{ label: "A selected product", input }]
  const metadata = unwrapMetadata(createToolMetadata("Add the selected product to the cart.", examples, policy))

  input.productRef = "changed outside publisher"
  examples.push({ label: "another", input: { productRef: "sku-43" } })

  assert.equal(metadata.description, "Add the selected product to the cart.")
  assert.deepEqual(metadata.examples[0].input, { productRef: "sku-42" })
  assert.equal(metadata.examples.length, 1)
  assert.equal(Object.isFrozen(metadata), true)
  assert.equal(Object.isFrozen(metadata.examples), true)
  assert.equal(Object.isFrozen(metadata.examples[0].input), true)
})

test("description, labels, and example keys reject implementation and credential disclosure", () => {
  const descriptionViolations = validateToolMetadata({
    description: "Use the CSS selector and replay the password step.",
    examples: [{ label: "selector example", input: { productRef: "sku-42" } }],
  }, policy)
  assert.ok(descriptionViolations.some((violation) => violation.kind === "forbidden_term" && violation.path === "description"))
  assert.ok(descriptionViolations.some((violation) => violation.kind === "forbidden_term" && violation.path === "examples[0].label"))

  const keyViolations = validateToolMetadata({
    description: "Add the selected product to the cart.",
    examples: [{ label: "credential-shaped input", input: { password: "secret" } }],
  }, policy)
  assert.ok(keyViolations.some((violation) => violation.kind === "unsafe_key" && violation.key === "password"))
  assert.ok(keyViolations.some((violation) => violation.kind === "forbidden_term" && violation.path.includes("password")))
})

test("limits and non-JSON values are rejected without coercion", () => {
  const limitedPolicy = { ...policy, maxDescriptionLength: 10, maxExamples: 1 }
  const tooMany = validateToolMetadata({
    description: "This description is too long.",
    examples: [
      { label: "one", input: { value: 1 } },
      { label: "two", input: { value: 2 } },
    ],
  }, limitedPolicy)
  assert.ok(tooMany.some((violation) => violation.kind === "description_too_long"))
  assert.ok(tooMany.some((violation) => violation.kind === "examples_exceeded"))

  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  const malformed = { label: "cyclic", input: cyclic as unknown as JsonValue } as ToolExample
  assert.doesNotThrow(() => createToolMetadata("A safe description.", [malformed], policy))
  const result = createToolMetadata("A safe description.", [malformed], policy)
  assert.equal(result.kind, "invalid")
  if (result.kind === "invalid") assert.ok(result.violations.some((violation) => violation.kind === "example_invalid"))

  const dateValue = { label: "date", input: new Date("2026-08-31T00:00:00.000Z") as unknown as JsonValue } as ToolExample
  assert.equal(createToolMetadata("A safe description.", [dateValue], policy).kind, "invalid")
})

test("schema disclosure is checked independently of schema shape validation", () => {
  const schema = {
    type: "object",
    properties: {
      card_number: { type: "string" },
    },
  }
  const violations = validateSafeJsonSchema(schema, policy, "inputSchema")
  assert.ok(violations.some((violation) => violation.kind === "unsafe_key" && violation.key === "card_number"))
})

test("camelCase sensitive fields are canonicalized before disclosure checks", () => {
  const violations = validateToolMetadata({
    description: "A semantic operation.",
    examples: [{
      label: "example",
      input: {
        cardNumber: "redacted",
        shippingAddress: "redacted",
        apiKey: "redacted",
        orderId: "redacted",
      },
    }],
  }, policy)
  for (const key of ["cardNumber", "shippingAddress", "apiKey", "orderId"]) {
    assert.ok(violations.some((violation) => violation.kind === "unsafe_key" && violation.key === key))
  }
})
