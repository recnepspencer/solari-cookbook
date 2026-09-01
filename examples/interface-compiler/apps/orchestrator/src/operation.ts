import {
  validateOperationContext,
  type CancellationToken,
  type Clock,
  type OperationContext,
  type PartialEffectPosture,
  type ValidationResult,
} from "@interface-compiler/domain"

export type RuntimeBudgetResource = "model_calls" | "browser_actions" | "evidence_bytes"

export type RuntimeStop =
  | {
      readonly kind: "cancelled"
      readonly terminal: true
      readonly safePoint: "before_effect" | "after_effect"
      readonly posture: PartialEffectPosture
    }
  | {
      readonly kind: "deadline_exceeded"
      readonly terminal: true
      readonly posture: PartialEffectPosture
    }
  | {
      readonly kind: "budget_exhausted"
      readonly terminal: true
      readonly resource: RuntimeBudgetResource
      readonly limit: number
      readonly posture: PartialEffectPosture
    }
  | {
      readonly kind: "invalid_budget_request"
      readonly terminal: true
      readonly resource: RuntimeBudgetResource
      readonly posture: PartialEffectPosture
    }

export type OperationGate =
  | { readonly kind: "continue" }
  | { readonly kind: "stop"; readonly stop: RuntimeStop }

export interface OperationBudgetSnapshot {
  readonly modelCalls: number
  readonly browserActions: number
  readonly evidenceBytes: number
}

export interface OperationController {
  readonly context: OperationContext
  check(): OperationGate
  reserveModelCall(): OperationGate
  reserveBrowserAction(): OperationGate
  reserveEvidenceBytes(bytes: number): OperationGate
  snapshot(): OperationBudgetSnapshot
}

export interface OperationControllerInput {
  /** The bounded context admitted by Worth for this delegated unit of work. */
  readonly admittedContext: OperationContext
  readonly clock: Clock
}

export function createOperationController(input: OperationControllerInput): ValidationResult<OperationController> {
  const contextIssues = validateOperationContext(input.admittedContext)
  if (contextIssues.length > 0) return { ok: false, issues: contextIssues }

  return {
    ok: true,
    value: createController(input.admittedContext, input.clock),
  }
}

export interface CancellationSource {
  readonly token: CancellationToken
  cancel(): void
}

export function createCancellationSource(): CancellationSource {
  const listeners = new Set<() => void>()
  let cancelled = false
  const token: CancellationToken = {
    isCancellationRequested: () => cancelled,
    onCancellationRequested: (listener) => {
      if (cancelled) listener()
      else listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return {
    token,
    cancel: () => {
      if (cancelled) return
      cancelled = true
      for (const listener of [...listeners]) listener()
      listeners.clear()
    },
  }
}

export function cancellationTokenFromAbortSignal(signal: AbortSignal): CancellationToken {
  const source = createCancellationSource()
  if (signal.aborted) source.cancel()
  else signal.addEventListener("abort", () => source.cancel(), { once: true })
  return source.token
}

function createController(context: OperationContext, clock: Clock): OperationController {
  let modelCalls = 0
  let browserActions = 0
  let evidenceBytes = 0
  let wallClockDeadlineMs: number | undefined

  const snapshot = (): OperationBudgetSnapshot => ({ modelCalls, browserActions, evidenceBytes })
  const check = (): OperationGate => {
    if (context.cancellation.isCancellationRequested()) {
      return { kind: "stop", stop: { kind: "cancelled", terminal: true, safePoint: "before_effect", posture: { kind: "not_started" } } }
    }
    let now: number
    try {
      now = Date.parse(clock.now())
    } catch {
      return { kind: "stop", stop: { kind: "deadline_exceeded", terminal: true, posture: { kind: "not_started" } } }
    }
    const deadline = Date.parse(context.deadlineAt)
    if (!Number.isFinite(now) || !Number.isFinite(deadline)) {
      return { kind: "stop", stop: { kind: "deadline_exceeded", terminal: true, posture: { kind: "not_started" } } }
    }
    if (wallClockDeadlineMs === undefined) wallClockDeadlineMs = now + context.budget.maxWallClockMs
    if (!Number.isFinite(wallClockDeadlineMs) || now >= deadline || now >= wallClockDeadlineMs) {
      return { kind: "stop", stop: { kind: "deadline_exceeded", terminal: true, posture: { kind: "not_started" } } }
    }
    return { kind: "continue" }
  }

  const reserve = (resource: RuntimeBudgetResource, amount: number): OperationGate => {
    const gate = check()
    if (gate.kind === "stop") return gate
    if (!Number.isSafeInteger(amount) || amount < 0) {
      return { kind: "stop", stop: { kind: "invalid_budget_request", terminal: true, resource, posture: { kind: "not_started" } } }
    }

    const used = resource === "model_calls" ? modelCalls : resource === "browser_actions" ? browserActions : evidenceBytes
    const limit = resource === "model_calls"
      ? context.budget.maxModelCalls
      : resource === "browser_actions"
        ? context.budget.maxBrowserActions
        : context.budget.maxEvidenceBytes
    if (limit !== undefined && (used > limit || amount > limit - used)) {
      return { kind: "stop", stop: { kind: "budget_exhausted", terminal: true, resource, limit, posture: { kind: "not_started" } } }
    }

    if (resource === "model_calls") modelCalls += amount
    else if (resource === "browser_actions") browserActions += amount
    else evidenceBytes += amount
    return { kind: "continue" }
  }

  return {
    context,
    check,
    reserveModelCall: () => reserve("model_calls", 1),
    reserveBrowserAction: () => reserve("browser_actions", 1),
    reserveEvidenceBytes: (bytes) => reserve("evidence_bytes", bytes),
    snapshot,
  }
}
