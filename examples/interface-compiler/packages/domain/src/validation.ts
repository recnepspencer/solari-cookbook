/** Typed construction results used by pure domain factories. */

import { cloneAndFreeze } from "./immutability.js"

export interface ValidationIssue {
  readonly path: string
  readonly message: string
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] }

export function valid<T>(value: T): ValidationResult<T> {
  return Object.freeze({ ok: true as const, value: cloneAndFreeze(value) })
}

export function invalid(...issues: ValidationIssue[]): ValidationResult<never> {
  return Object.freeze({ ok: false as const, issues: cloneAndFreeze(issues) })
}

export function issue(path: string, message: string): ValidationIssue {
  return { path, message }
}

export function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

export function isNonNegativeInteger(value: unknown): value is number {
  return isNonNegativeFiniteNumber(value) && Number.isSafeInteger(value)
}

export function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
}
