import {
  classifySafetyBoundary,
  type IsoTimestamp,
  type Interactable,
  type Observation,
  type ReplayStep,
  type SafetyAssessment,
  type SafetySignal,
  type ValidationResult,
} from "@interface-compiler/domain"

/**
 * Conservative, local boundary detection. It never reads or logs fill values;
 * a future policy service may replace this function without changing the runner.
 */
export function assessObservationSafety(observation: Observation): ValidationResult<SafetyAssessment> {
  const pageDescriptions = [observation.url, observation.title, observation.pageSummary]
  const pageSignal = detectSafetySignal(pageDescriptions)
  const activePageSignal = pageSignal.kind === "authentication_required" && !isActiveAuthenticationBoundary(pageDescriptions)
    ? detectSafetySignalWithoutAuthentication(pageDescriptions)
    : pageSignal
  const signal = activePageSignal.kind === "safe_to_continue"
      ? detectInteractableBoundary(observation.interactables)
      : activePageSignal
  return classifySafetyBoundary({
    observedAt: observation.observedAt,
    signal,
  })
}

export function assessReplayStepSafety(step: ReplayStep, observedAt: IsoTimestamp): ValidationResult<SafetyAssessment> {
  const descriptions: (string | undefined)[] = [step.type]
  if (step.type === "navigate") descriptions.push(step.url)
  if (step.type === "click" || step.type === "fill" || step.type === "select" || step.type === "read") {
    descriptions.push(step.target.semanticDescription, step.target.role, step.target.name, step.target.text, step.target.selector)
  }
  const detected = detectSafetySignal(descriptions)
  const signal = detected.kind !== "safe_to_continue"
    ? detected
    : step.type === "fill" && !isProductSearchTarget(step.target)
      ? { kind: "personal_information_required" as const, information: "unknown" as const }
      : step.type === "select"
        ? { kind: "personal_information_required" as const, information: "unknown" as const }
        : detected
  return classifySafetyBoundary({ observedAt, signal })
}

export function detectSafetySignal(descriptions: readonly (string | undefined)[]): SafetySignal {
  return detectNormalizedSafetySignal(normalizeDescriptions(descriptions), true)
}

function detectSafetySignalWithoutAuthentication(descriptions: readonly (string | undefined)[]): SafetySignal {
  return detectNormalizedSafetySignal(normalizeDescriptions(descriptions), false)
}

function detectNormalizedSafetySignal(normalized: string, includeAuthentication: boolean): SafetySignal {
  if (matches(normalized, /\b(access denied|permission denied|permission required|access required|access forbidden|access restricted|authorization(?: required)?|permission|unauthori[sz]ed|admin(?:istrator)?(?: access)?)\b|\b(?:you\s+)?(?:do\s+not\s+have|need|needs|require|requires)\s+permission\b/)) {
    return { kind: "access_control_required" }
  }
  if (includeAuthentication && matches(normalized, /\b(sign in|log in|login|account|password|passcode|passphrase|one time code|otp|verification code|two factor code|username|credentials?|auth|authentication)\b|\b(?:authenticate|verify)\b(?:\s+(?:your\s+)?(?:identity|account))?\b|\benter\s+(?:your\s+)?(?:credentials?|login|password|username)\b/)) {
    return { kind: "authentication_required", credential: credentialKind(normalized) }
  }
  if (matches(normalized, /\b(payment method|payment details?|payment information|payment required|credit card|debit card|card number|card information|card details?|security code|cvv|cvc|billing address|billing details?|billing information)\b|\benter\s+(?:your\s+)?(?:card|payment|billing)\s+(?:information|details?|address)\b/)) {
    return { kind: "payment_details_required", payment: paymentKind(normalized) }
  }
  if (matches(normalized, /\b(shipping|delivery|mailing) (?:address|details?|information)\b|\b(?:shipping|delivery)\s+(?:address|details?)\s+required\b|\b(?:enter|provide)\s+(?:your\s+)?(?:shipping|delivery|mailing)?\s*address\b|\b(?:postal|zip) code\b|\baddress\s+required\b/)) {
    return { kind: "shipping_details_required" }
  }
  if (matches(normalized, /\bcheckout\b|\b(?:place|submit|confirm|review)\s+(?:your\s+)?order\b|\b(?:buy|pay)\s+now\b|\bcomplete\s+(?:the\s+|your\s+)?purchase\b|\bconfirm\s+(?:the\s+|your\s+)?purchase\b|\bfinali[sz]e\s+(?:the\s+|your\s+)?order\b|\border confirmation\b|\b(?:continue|proceed)\s+(?:as\s+guest|to\s+(?:payment|shipping|delivery))\b/)) {
    return { kind: "order_placement" }
  }
  if (matches(normalized, /\b(full name|date of birth|phone(?: number)?|email(?: address)?|contact info(?:rmation)?|contact details?|personal information|personal details?|street address)\b|\b(?:enter|provide)\s+(?:your\s+)?(?:name|phone|email|personal details?)\b|\bcontact info\s+required\b/)) {
    return { kind: "personal_information_required", information: personalInformationKind(normalized) }
  }
  return { kind: "safe_to_continue" }
}

function interactableText(interactable: Interactable): readonly (string | undefined)[] {
  return [interactable.semanticGuess, interactable.role, interactable.name, interactable.text]
}

function detectInteractableBoundary(interactables: readonly Interactable[]): SafetySignal {
  for (const interactable of interactables) {
    const descriptions = interactableText(interactable)
    const signal = detectSafetySignal(descriptions)
    if (signal.kind === "safe_to_continue") continue
    if (signal.kind === "authentication_required" && (interactable.kind === "link" || interactable.kind === "button") && !isActiveAuthenticationBoundary(descriptions)) {
      const nonAuthenticationSignal = detectSafetySignalWithoutAuthentication(descriptions)
      if (nonAuthenticationSignal.kind !== "safe_to_continue") return nonAuthenticationSignal
      continue
    }
    return signal
  }
  return { kind: "safe_to_continue" }
}

function normalizeDescriptions(descriptions: readonly (string | undefined)[]): string {
  return descriptions.filter((description): description is string => description !== undefined).join(" ").toLowerCase().replace(/[-_]+/g, " ")
}

function isActiveAuthenticationBoundary(descriptions: readonly (string | undefined)[]): boolean {
  const text = descriptions.filter((description): description is string => description !== undefined).join(" ").toLowerCase().replace(/[-_]+/g, " ")
  return matches(text, /\/(?:account|login|signin|sign-in)(?:[/?#]|$)|\b(?:sign in|log in|login|authentication|account)\s+(?:is\s+)?required\b|\b(?:sign in|log in)\s+to\s+(?:continue|checkout|proceed)\b|\b(?:enter|provide)\s+(?:your\s+)?(?:credentials?|password|username)\b|\bcreate\s+(?:an?\s+)?account\b|\bpassword\s+(?:field|required)\b/)
}

function isProductSearchTarget(target: Extract<ReplayStep, { readonly type: "fill" }>["target"]): boolean {
  const text = [target.semanticDescription, target.role, target.name, target.text, target.selector]
    .filter((entry): entry is string => entry !== undefined)
    .join(" ")
    .toLowerCase()
  return matches(text, /\b(?:product\s+)?search(?:box|\s+field|\s+input)?\b|\bsearch\s+(?:products?|walmart)\b/)
}

function credentialKind(text: string): "username" | "password" | "one_time_code" | "unknown" {
  if (matches(text, /\b(password|passcode|passphrase)\b/)) return "password"
  if (matches(text, /\b(one[ -]?time code|otp|verification code|two[ -]?factor code)\b/)) return "one_time_code"
  if (matches(text, /\b(username|user name)\b/)) return "username"
  return "unknown"
}

function paymentKind(text: string): "card" | "bank_account" | "wallet" | "unknown" {
  if (matches(text, /\b(card|cvv|cvc)\b/)) return "card"
  if (matches(text, /\b(bank|account|routing)\b/)) return "bank_account"
  if (matches(text, /\b(wallet|paypal|pay\s+with)\b/)) return "wallet"
  return "unknown"
}

function personalInformationKind(text: string): "identity" | "contact" | "unknown" {
  if (matches(text, /\b(full name|date of birth|identity)\b/)) return "identity"
  if (matches(text, /\b(phone|email|contact)\b/)) return "contact"
  return "unknown"
}

function matches(text: string, pattern: RegExp): boolean {
  return pattern.test(text)
}
