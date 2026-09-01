/** Dependency-free JSON values, schemas, and semantic conditions. */

import { invalid, isNonEmptyText, isRecord, issue, valid, type ValidationIssue, type ValidationResult } from "./validation.js"

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue }

interface JsonSchemaMetadata {
  readonly title?: string
  readonly description?: string
  readonly enum?: readonly JsonValue[]
  readonly const?: JsonValue
}

export interface JsonStringSchema extends JsonSchemaMetadata {
  readonly type: "string"
  readonly minLength?: number
  readonly maxLength?: number
  readonly pattern?: string
}

export interface JsonNumberSchema extends JsonSchemaMetadata {
  readonly type: "number"
  readonly minimum?: number
  readonly maximum?: number
}

export interface JsonIntegerSchema extends JsonSchemaMetadata {
  readonly type: "integer"
  readonly minimum?: number
  readonly maximum?: number
}

export interface JsonBooleanSchema extends JsonSchemaMetadata {
  readonly type: "boolean"
}

export interface JsonNullSchema extends JsonSchemaMetadata {
  readonly type: "null"
}

export interface JsonArraySchema extends JsonSchemaMetadata {
  readonly type: "array"
  readonly items?: JsonSchema
  readonly minItems?: number
  readonly maxItems?: number
}

export interface JsonObjectSchema extends JsonSchemaMetadata {
  readonly type: "object"
  readonly properties?: Readonly<Record<string, JsonSchema>>
  readonly required?: readonly string[]
  readonly additionalProperties?: boolean | JsonSchema
}

export interface JsonAnySchema extends JsonSchemaMetadata {
  readonly type?: undefined
}

export type JsonSchema =
  | JsonStringSchema
  | JsonNumberSchema
  | JsonIntegerSchema
  | JsonBooleanSchema
  | JsonNullSchema
  | JsonArraySchema
  | JsonObjectSchema
  | JsonAnySchema

/** A typed schema descriptor for provider boundaries; it does not execute code. */
const schemaOutputBrand: unique symbol = Symbol("SchemaOutput")

export interface Schema<T> {
  readonly name: string
  readonly json: JsonSchema
  readonly [schemaOutputBrand]: T
}

export function createSchema<T>(input: { readonly name: string; readonly json: JsonSchema }): ValidationResult<Schema<T>> {
  if (!isRecord(input)) return invalid(issue("schema", "schema must be an object"))
  const issues: ValidationIssue[] = []
  if (!isNonEmptyText(input.name)) issues.push(issue("name", "schema name must not be empty"))
  issues.push(...validateJsonSchema(input.json))
  if (issues.length > 0) return invalid(...issues)
  return valid({ name: input.name, json: input.json, [schemaOutputBrand]: undefined as T })
}

export type Condition =
  | { readonly kind: "url_matches"; readonly pattern: string }
  | { readonly kind: "text_present"; readonly text: string }
  | { readonly kind: "interactable_present"; readonly semanticDescription: string }
  | { readonly kind: "cart_count_increased"; readonly baselineKey: string }
  | { readonly kind: "product_in_cart"; readonly productRef: string }
  | { readonly kind: "authentication_required" }
  | { readonly kind: "checkout_started" }
  | { readonly kind: "custom"; readonly name: string; readonly value?: JsonValue }

export function isCondition(value: unknown): value is Condition {
  if (!isRecord(value)) return false
  const kind = (value as { readonly kind?: unknown }).kind
  switch (kind) {
    case "url_matches":
      return isNonEmptyText((value as { readonly pattern?: unknown }).pattern)
    case "text_present":
      return isNonEmptyText((value as { readonly text?: unknown }).text)
    case "interactable_present":
      return isNonEmptyText((value as { readonly semanticDescription?: unknown }).semanticDescription)
    case "cart_count_increased":
      return isNonEmptyText((value as { readonly baselineKey?: unknown }).baselineKey)
    case "product_in_cart":
      return isNonEmptyText((value as { readonly productRef?: unknown }).productRef)
    case "authentication_required":
    case "checkout_started":
      return true
    case "custom":
      return isNonEmptyText((value as { readonly name?: unknown }).name) &&
        ((value as { readonly value?: unknown }).value === undefined || isJsonValue((value as { readonly value?: unknown }).value))
    default:
      return false
  }
}

export function validateCondition(condition: unknown, path = "condition"): readonly ValidationIssue[] {
  return isCondition(condition) ? [] : [issue(path, "condition kind or payload is not recognized")]
}

export function createCondition<T extends Condition>(condition: T): ValidationResult<T> {
  return isCondition(condition) ? valid(condition) : invalid(issue("condition", "condition kind or payload is not recognized"))
}

export function isJsonValue(value: unknown): value is JsonValue {
  const seen = new WeakSet<object>()

  function visit(current: unknown): boolean {
    if (current === null || typeof current === "string" || typeof current === "boolean") return true
    if (typeof current === "number") return Number.isFinite(current)
    if (typeof current !== "object") return false
    if (seen.has(current)) return false
    seen.add(current)
    const result = Array.isArray(current) ? current.every(visit) : isRecord(current) && Object.values(current).every(visit)
    seen.delete(current)
    return result
  }

  return visit(value)
}

export function validateJsonSchema(schema: unknown, path = "schema"): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const seen = new WeakSet<object>()

  function visit(value: unknown, currentPath: string): void {
    if (!isRecord(value)) {
      issues.push(issue(currentPath, "JSON schema must be an object"))
      return
    }
    if (seen.has(value)) {
      issues.push(issue(currentPath, "JSON schema must not contain cycles"))
      return
    }
    seen.add(value)

    const type = value.type
    if (type !== undefined && type !== "string" && type !== "number" && type !== "integer" && type !== "boolean" && type !== "null" && type !== "array" && type !== "object") {
      issues.push(issue(`${currentPath}.type`, "JSON schema type is not recognized"))
      return
    }
    validateMetadata(value, currentPath, issues)

    if (type === "string") {
      validateOptionalInteger(value.minLength, `${currentPath}.minLength`, issues)
      validateOptionalInteger(value.maxLength, `${currentPath}.maxLength`, issues)
      if (typeof value.minLength === "number" && typeof value.maxLength === "number" && value.minLength > value.maxLength) issues.push(issue(currentPath, "minimum string length must not exceed maximum"))
      if (value.pattern !== undefined && typeof value.pattern !== "string") issues.push(issue(`${currentPath}.pattern`, "pattern must be a string"))
    }
    if (type === "number" || type === "integer") {
      validateOptionalNumber(value.minimum, `${currentPath}.minimum`, issues)
      validateOptionalNumber(value.maximum, `${currentPath}.maximum`, issues)
      if (typeof value.minimum === "number" && typeof value.maximum === "number" && value.minimum > value.maximum) issues.push(issue(currentPath, "minimum must not exceed maximum"))
    }
    if (type === "array") {
      if (value.items !== undefined) visit(value.items, `${currentPath}.items`)
      validateOptionalInteger(value.minItems, `${currentPath}.minItems`, issues)
      validateOptionalInteger(value.maxItems, `${currentPath}.maxItems`, issues)
      if (typeof value.minItems === "number" && typeof value.maxItems === "number" && value.minItems > value.maxItems) issues.push(issue(currentPath, "minimum item count must not exceed maximum"))
    }
    if (type === "object") {
      if (value.properties !== undefined) {
        if (!isRecord(value.properties)) {
          issues.push(issue(`${currentPath}.properties`, "properties must be an object"))
        } else {
          for (const [key, child] of Object.entries(value.properties)) visit(child, `${currentPath}.properties.${key}`)
        }
      }
      if (value.required !== undefined) {
        if (!Array.isArray(value.required) || value.required.some((entry) => !isNonEmptyText(entry))) issues.push(issue(`${currentPath}.required`, "required must contain non-empty property names"))
      }
      if (value.additionalProperties !== undefined && typeof value.additionalProperties !== "boolean") visit(value.additionalProperties, `${currentPath}.additionalProperties`)
    }
    seen.delete(value)
  }

  visit(schema, path)
  return issues
}

function validateMetadata(value: Record<string, unknown>, path: string, issues: ValidationIssue[]): void {
  if (value.title !== undefined && typeof value.title !== "string") issues.push(issue(`${path}.title`, "title must be a string"))
  if (value.description !== undefined && typeof value.description !== "string") issues.push(issue(`${path}.description`, "description must be a string"))
  if (value.enum !== undefined && (!Array.isArray(value.enum) || value.enum.some((entry) => !isJsonValue(entry)))) issues.push(issue(`${path}.enum`, "enum must contain JSON values"))
  if (value.const !== undefined && !isJsonValue(value.const)) issues.push(issue(`${path}.const`, "const must be a JSON value"))
}

function validateOptionalNumber(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) issues.push(issue(path, "value must be a finite number"))
}

function validateOptionalInteger(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (value !== undefined && (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)) issues.push(issue(path, "value must be a non-negative safe integer"))
}
