import type { IsoTimestamp } from "./identity.js"
import { invalid, isIsoTimestamp, isRecord, issue, valid, type ValidationResult } from "./validation.js"

export type CredentialKind = "username" | "password" | "one_time_code" | "unknown"
export type PersonalInformationKind = "identity" | "contact" | "unknown"
export type PaymentInformationKind = "card" | "bank_account" | "wallet" | "unknown"

export type SafetySignal =
  | { readonly kind: "safe_to_continue" }
  | { readonly kind: "authentication_required"; readonly credential: CredentialKind }
  | { readonly kind: "personal_information_required"; readonly information: PersonalInformationKind }
  | { readonly kind: "shipping_details_required" }
  | { readonly kind: "payment_details_required"; readonly payment: PaymentInformationKind }
  | { readonly kind: "order_placement" }
  | { readonly kind: "access_control_required" }

export interface SafetyBoundaryObservation {
  readonly observedAt: IsoTimestamp
  readonly signal: SafetySignal
}

const safetyStopBrand: unique symbol = Symbol("SafetyStopResult")

interface SafetyStopCore {
  readonly kind: "safety_stop"
  readonly terminal: true
  readonly nextAction: "human_required"
  readonly observedAt: IsoTimestamp
  readonly [safetyStopBrand]: true
}

export type SafetyStopResult =
  | (SafetyStopCore & {
      readonly reason: "authentication_required"
      readonly credential: CredentialKind
    })
  | (SafetyStopCore & {
      readonly reason: "personal_information_required"
      readonly information: PersonalInformationKind
    })
  | (SafetyStopCore & {
      readonly reason: "shipping_details_required"
    })
  | (SafetyStopCore & {
      readonly reason: "payment_details_required"
      readonly payment: PaymentInformationKind
    })
  | (SafetyStopCore & {
      readonly reason: "order_placement"
    })
  | (SafetyStopCore & {
      readonly reason: "access_control_required"
    })

export type SafetyAssessment =
  | { readonly kind: "continue"; readonly terminal: false }
  | { readonly kind: "stop"; readonly terminal: true; readonly result: SafetyStopResult }

export function classifySafetyBoundary(observation: SafetyBoundaryObservation): ValidationResult<SafetyAssessment> {
  if (!observation || typeof observation !== "object") return invalid(issue("observation", "safety observation must be an object"))
  if (!isIsoTimestamp(observation.observedAt)) return invalid(issue("observedAt", "observedAt must be a timestamp"))
  const signalIssues = validateSafetySignal(observation.signal)
  if (signalIssues.length > 0) return invalid(...signalIssues)

  if (observation.signal.kind === "safe_to_continue") {
    return valid({ kind: "continue", terminal: false })
  }

  const result: SafetyStopResult = {
    kind: "safety_stop",
    terminal: true,
    nextAction: "human_required",
    observedAt: observation.observedAt,
    [safetyStopBrand]: true,
    ...safetyReason(observation.signal),
  }
  return valid(Object.freeze({ kind: "stop" as const, terminal: true as const, result: Object.freeze(result) }))
}

export function safetyStopReason(stop: SafetyStopResult): SafetyStopResult["reason"] {
  return stop.reason
}

function safetyReason(signal: Exclude<SafetySignal, { readonly kind: "safe_to_continue" }>):
  | { readonly reason: "authentication_required"; readonly credential: CredentialKind }
  | { readonly reason: "personal_information_required"; readonly information: PersonalInformationKind }
  | { readonly reason: "shipping_details_required" }
  | { readonly reason: "payment_details_required"; readonly payment: PaymentInformationKind }
  | { readonly reason: "order_placement" }
  | { readonly reason: "access_control_required" } {
  switch (signal.kind) {
    case "authentication_required":
      return { reason: signal.kind, credential: signal.credential }
    case "personal_information_required":
      return { reason: signal.kind, information: signal.information }
    case "shipping_details_required":
      return { reason: signal.kind }
    case "payment_details_required":
      return { reason: signal.kind, payment: signal.payment }
    case "order_placement":
      return { reason: signal.kind }
    case "access_control_required":
      return { reason: signal.kind }
  }
}

export function validateSafetySignal(signal: SafetySignal): readonly ReturnType<typeof issue>[] {
  const issues: ReturnType<typeof issue>[] = []
  if (!isRecord(signal)) return [issue("signal", "safety signal must be an object")]
  if (
    signal.kind !== "safe_to_continue" &&
    signal.kind !== "authentication_required" &&
    signal.kind !== "personal_information_required" &&
    signal.kind !== "shipping_details_required" &&
    signal.kind !== "payment_details_required" &&
    signal.kind !== "order_placement" &&
    signal.kind !== "access_control_required"
  ) {
    issues.push(issue("signal.kind", "safety signal kind is not recognized"))
    return issues
  }
  if (signal.kind === "authentication_required" && !isCredentialKind(signal.credential)) issues.push(issue("credential", "credential kind is not recognized"))
  if (signal.kind === "personal_information_required" && !isPersonalInformationKind(signal.information)) issues.push(issue("information", "personal information kind is not recognized"))
  if (signal.kind === "payment_details_required" && !isPaymentInformationKind(signal.payment)) issues.push(issue("payment", "payment kind is not recognized"))
  return issues
}

function isCredentialKind(value: unknown): value is CredentialKind {
  return value === "username" || value === "password" || value === "one_time_code" || value === "unknown"
}

function isPersonalInformationKind(value: unknown): value is PersonalInformationKind {
  return value === "identity" || value === "contact" || value === "unknown"
}

function isPaymentInformationKind(value: unknown): value is PaymentInformationKind {
  return value === "card" || value === "bank_account" || value === "wallet" || value === "unknown"
}

export function isSafetyStopResult(value: unknown): value is SafetyStopResult {
  return validateSafetyStopResult(value).length === 0
}

export function validateSafetyStopResult(value: unknown): readonly ReturnType<typeof issue>[] {
  if (!isRecord(value)) return [issue("stop", "safety stop result must be an object")]
  const stop = value as Record<string, unknown>
  const issues: ReturnType<typeof issue>[] = []
  if (stop.kind !== "safety_stop") issues.push(issue("stop.kind", "safety stop kind is not recognized"))
  if (stop.terminal !== true) issues.push(issue("stop.terminal", "safety stop must be terminal"))
  if (stop.nextAction !== "human_required") issues.push(issue("stop.nextAction", "safety stop requires human action"))
  if (!isIsoTimestamp(stop.observedAt)) issues.push(issue("stop.observedAt", "safety stop timestamp must be valid"))
  if (!Object.prototype.hasOwnProperty.call(value, safetyStopBrand) || (value as Record<symbol, unknown>)[safetyStopBrand] !== true) {
    issues.push(issue("stop", "safety stop must come from classifySafetyBoundary"))
  }
  switch (stop.reason) {
    case "authentication_required":
      if (!isCredentialKind(stop.credential)) issues.push(issue("stop.credential", "credential kind is not recognized"))
      break
    case "personal_information_required":
      if (!isPersonalInformationKind(stop.information)) issues.push(issue("stop.information", "personal information kind is not recognized"))
      break
    case "shipping_details_required":
      break
    case "payment_details_required":
      if (!isPaymentInformationKind(stop.payment)) issues.push(issue("stop.payment", "payment kind is not recognized"))
      break
    case "order_placement":
    case "access_control_required":
      break
    default:
      issues.push(issue("stop.reason", "safety stop reason is not recognized"))
  }
  return issues
}
