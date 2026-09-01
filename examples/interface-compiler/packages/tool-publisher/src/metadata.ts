import type { JsonValue } from "@interface-compiler/domain"
import type { ToolPublicationPolicy } from "./policy.js"
import { allForbiddenMetadataTerms } from "./policy.js"

export interface ToolExample {
  readonly label: string
  readonly input: JsonValue
  readonly expectedOutput?: JsonValue
}

export interface ToolMetadata {
  readonly description: string
  readonly examples: readonly ToolExample[]
}

export type MetadataViolation =
  | { readonly kind: "metadata_not_object"; readonly path: "metadata" }
  | { readonly kind: "text_empty"; readonly path: string }
  | { readonly kind: "description_empty"; readonly path: "description" }
  | { readonly kind: "description_too_long"; readonly path: "description"; readonly maxLength: number }
  | { readonly kind: "control_character"; readonly path: string }
  | { readonly kind: "forbidden_term"; readonly path: string; readonly term: string }
  | { readonly kind: "unsafe_key"; readonly path: string; readonly key: string }
  | { readonly kind: "invalid_json_value"; readonly path: string }
  | { readonly kind: "examples_not_array"; readonly path: "examples" }
  | { readonly kind: "examples_exceeded"; readonly path: "examples"; readonly maxExamples: number }
  | {
      readonly kind: "example_invalid"
      readonly path: string
      readonly reason: "label_empty" | "input_not_json" | "expected_output_not_json"
    }

export type ToolMetadataBuildResult =
  | { readonly kind: "valid"; readonly value: ToolMetadata }
  | { readonly kind: "invalid"; readonly violations: readonly MetadataViolation[] }

export function validateToolMetadata(input: unknown, policy: ToolPublicationPolicy): readonly MetadataViolation[] {
  if (!isRecord(input)) return [{ kind: "metadata_not_object", path: "metadata" }]

  const violations: MetadataViolation[] = []
  const forbiddenTerms = allForbiddenMetadataTerms(policy)
  const description = input.description
  if (typeof description !== "string" || description.trim().length === 0) {
    violations.push({ kind: "description_empty", path: "description" })
  } else {
    inspectSafeText(description, "description", forbiddenTerms, violations)
    if (description.length > policy.maxDescriptionLength) {
      violations.push({ kind: "description_too_long", path: "description", maxLength: policy.maxDescriptionLength })
    }
  }

  const examples = input.examples
  if (!Array.isArray(examples)) {
    violations.push({ kind: "examples_not_array", path: "examples" })
  } else {
    if (examples.length > policy.maxExamples) violations.push({ kind: "examples_exceeded", path: "examples", maxExamples: policy.maxExamples })
    for (let index = 0; index < examples.length; index += 1) {
      const examplePath = `examples[${index}]`
      const example = examples[index]
      if (!isRecord(example)) {
        violations.push({ kind: "example_invalid", path: examplePath, reason: "label_empty" })
        continue
      }

      if (typeof example.label !== "string" || example.label.trim().length === 0) {
        violations.push({ kind: "example_invalid", path: `${examplePath}.label`, reason: "label_empty" })
      } else {
        inspectSafeText(example.label, `${examplePath}.label`, forbiddenTerms, violations)
      }

      if (!inspectSafeJsonValue(example.input, `${examplePath}.input`, forbiddenTerms, violations, new WeakSet<object>())) {
        violations.push({ kind: "example_invalid", path: `${examplePath}.input`, reason: "input_not_json" })
      }

      if (Object.prototype.hasOwnProperty.call(example, "expectedOutput") &&
        !inspectSafeJsonValue(example.expectedOutput, `${examplePath}.expectedOutput`, forbiddenTerms, violations, new WeakSet<object>())) {
        violations.push({ kind: "example_invalid", path: `${examplePath}.expectedOutput`, reason: "expected_output_not_json" })
      }
    }
  }

  return Object.freeze(violations)
}

export function createToolMetadata(
  description: string,
  examples: readonly ToolExample[],
  policy: ToolPublicationPolicy,
): ToolMetadataBuildResult {
  const candidate = { description, examples }
  const violations = validateToolMetadata(candidate, policy)
  if (violations.length > 0) return { kind: "invalid", violations }

  return {
    kind: "valid",
    value: freezeMetadata({
      description,
      examples: examples.map((example) => freezeExample(example)),
    }),
  }
}

export function validateSafeMetadataText(
  value: unknown,
  path: string,
  policy: ToolPublicationPolicy,
): readonly MetadataViolation[] {
  if (typeof value !== "string" || value.trim().length === 0) return [{ kind: "text_empty", path }]
  const violations: MetadataViolation[] = []
  inspectSafeText(value, path, allForbiddenMetadataTerms(policy), violations)
  return Object.freeze(violations)
}

/** Applies the same disclosure policy to schema descriptions, constants, and property names. */
export function validateSafeJsonSchema(
  schema: unknown,
  policy: ToolPublicationPolicy,
  path = "schema",
): readonly MetadataViolation[] {
  const violations: MetadataViolation[] = []
  if (!inspectSafeJsonValue(schema, path, allForbiddenMetadataTerms(policy), violations, new WeakSet<object>())) {
    violations.push({ kind: "invalid_json_value", path })
  }
  return Object.freeze(violations)
}

function inspectSafeText(
  value: string,
  path: string,
  forbiddenTerms: readonly string[],
  violations: MetadataViolation[],
): void {
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(value)) violations.push({ kind: "control_character", path })
  const term = findForbiddenTerm(value, forbiddenTerms)
  if (term !== undefined) violations.push({ kind: "forbidden_term", path, term })
}

function inspectSafeJsonValue(
  value: unknown,
  path: string,
  forbiddenTerms: readonly string[],
  violations: MetadataViolation[],
  seen: WeakSet<object>,
): value is JsonValue {
  if (value === null || typeof value === "boolean") return true
  if (typeof value === "string") {
    inspectSafeText(value, path, forbiddenTerms, violations)
    return true
  }
  if (typeof value === "number") return Number.isFinite(value)
  if (typeof value !== "object") return false
  if (seen.has(value)) return false
  seen.add(value)

  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index) ||
          !inspectSafeJsonValue(value[index], `${path}[${index}]`, forbiddenTerms, violations, seen)) return false
      }
      return true
    }
    if (!isPlainJsonObject(value)) return false
    for (const key of Object.keys(value)) {
      const keyPath = `${path}.${key}`
      const term = findForbiddenTerm(key, forbiddenTerms)
      if (term !== undefined || key === "__proto__" || key === "constructor" || key === "prototype") violations.push({ kind: "unsafe_key", path: keyPath, key })
      if (/[\u0000-\u001f\u007f-\u009f]/u.test(key)) violations.push({ kind: "control_character", path: keyPath })
      if (!inspectSafeJsonValue(value[key], keyPath, forbiddenTerms, violations, seen)) return false
    }
    return true
  } finally {
    seen.delete(value)
  }
}

function isPlainJsonObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function findForbiddenTerm(value: string, forbiddenTerms: readonly string[]): string | undefined {
  const normalizedValue = normalizeSafetyText(value)
  if (normalizedValue.length === 0) return undefined
  return forbiddenTerms.find((term) => {
    const normalizedTerm = normalizeSafetyText(term)
    return normalizedTerm.length > 0 && (
      normalizedValue === normalizedTerm ||
      normalizedValue.startsWith(`${normalizedTerm}_`) ||
      normalizedValue.endsWith(`_${normalizedTerm}`) ||
      normalizedValue.includes(`_${normalizedTerm}_`)
    )
  })
}

function normalizeSafetyText(value: string): string {
  return value.trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

function freezeExample(example: ToolExample): ToolExample {
  const copy: { label: string; input: JsonValue; expectedOutput?: JsonValue } = {
    label: example.label,
    input: freezeMetadataJson(example.input),
  }
  if (example.expectedOutput !== undefined) copy.expectedOutput = freezeMetadataJson(example.expectedOutput)
  return Object.freeze(copy)
}

function freezeMetadata(metadata: ToolMetadata): ToolMetadata {
  return Object.freeze({
    description: metadata.description,
    examples: Object.freeze([...metadata.examples]),
  })
}

function freezeMetadataJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => freezeMetadataJson(entry)))
  if (value !== null && typeof value === "object") {
    const copy: Record<string, JsonValue> = {}
    for (const [key, child] of Object.entries(value)) {
      Object.defineProperty(copy, key, { value: freezeMetadataJson(child), enumerable: true, writable: true, configurable: true })
    }
    return Object.freeze(copy)
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
