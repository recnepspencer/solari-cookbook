import { validateOperationContext, type OperationContext, type PartialEffectPosture } from "@interface-compiler/domain"
import type { Clock } from "@interface-compiler/domain"

export type SolariOperationResource = "session_creation" | "browser_action" | "observation" | "recording_lookup"

export interface SessionResourceBudget {
  readonly startedAtMs: number
  readonly maxWallClockMs: number
  readonly maxBrowserActions?: number
  readonly maxEvidenceBytes?: number
  browserActionsUsed: number
  closed: boolean
}

export type BoundaryAdmission =
  | { readonly kind: "allowed"; readonly deadlineAtMs: number }
  | { readonly kind: "cancelled" }
  | { readonly kind: "timed_out" }
  | { readonly kind: "budget_exhausted" }
  | { readonly kind: "invalid_context" }
  | { readonly kind: "session_closed" }

export type BoundedOperationResult<T> =
  | { readonly kind: "completed"; readonly value: T }
  | { readonly kind: "cancelled"; readonly safePoint: "before_operation" | "after_operation"; readonly effect: PartialEffectPosture }
  | { readonly kind: "timed_out"; readonly effect: PartialEffectPosture }
  | { readonly kind: "failed"; readonly error: unknown; readonly effect: PartialEffectPosture }
  | { readonly kind: "denied"; readonly reason: "budget_exhausted" | "invalid_context" | "session_closed" | "session_busy" }

export function readClockMilliseconds(clock: Clock): number | undefined {
  try {
    const timestamp = Date.parse(clock.now())
    return Number.isFinite(timestamp) ? timestamp : undefined
  } catch {
    return undefined
  }
}

export function createSessionResourceBudget(context: OperationContext, startedAtMs: number): SessionResourceBudget {
  return {
    startedAtMs,
    maxWallClockMs: context.budget.maxWallClockMs,
    ...(context.budget.maxBrowserActions === undefined ? {} : { maxBrowserActions: context.budget.maxBrowserActions }),
    ...(context.budget.maxEvidenceBytes === undefined ? {} : { maxEvidenceBytes: context.budget.maxEvidenceBytes }),
    browserActionsUsed: 0,
    closed: false,
  }
}

export function admitSessionOperation(
  context: OperationContext,
  budget: SessionResourceBudget,
  resource: SolariOperationResource,
  nowMs: number,
): BoundaryAdmission {
  if (validateOperationContext(context).length > 0) return { kind: "invalid_context" }
  if (budget.closed) return { kind: "session_closed" }
  if (context.cancellation.isCancellationRequested()) return { kind: "cancelled" }

  const contextDeadlineMs = Date.parse(context.deadlineAt)
  const sessionDeadlineMs = budget.startedAtMs + budget.maxWallClockMs
  const contextBudgetDeadlineMs = nowMs + context.budget.maxWallClockMs
  const deadlineAtMs = Math.min(contextDeadlineMs, sessionDeadlineMs, contextBudgetDeadlineMs)
  if (!Number.isFinite(deadlineAtMs) || nowMs >= deadlineAtMs) return { kind: "timed_out" }

  if (resource === "browser_action") {
    const contextActionLimit = context.budget.maxBrowserActions
    const sessionActionLimit = budget.maxBrowserActions
    const actionLimit = Math.min(sessionActionLimit ?? Number.POSITIVE_INFINITY, contextActionLimit ?? Number.POSITIVE_INFINITY)
    if (budget.browserActionsUsed >= actionLimit) return { kind: "budget_exhausted" }
    budget.browserActionsUsed += 1
  }

  return { kind: "allowed", deadlineAtMs }
}

export async function runSolariOperationWithinBoundary<T>(input: {
  readonly context: OperationContext
  readonly budget: SessionResourceBudget
  readonly resource: SolariOperationResource
  readonly effectful: boolean
  readonly nowMs: number
  readonly readNowMs: () => number | undefined
  readonly operation: () => Promise<T>
  readonly onBoundary: () => Promise<void>
}): Promise<BoundedOperationResult<T>> {
  const admission = admitSessionOperation(input.context, input.budget, input.resource, input.nowMs)
  if (admission.kind !== "allowed") return admissionToOperationResult(admission)

  if (input.context.cancellation.isCancellationRequested()) return { kind: "cancelled", safePoint: "before_operation", effect: { kind: "not_started" } }

  let started = false
  let cancellationPromiseCleanup: (() => void) | undefined
  const cancellationPromise = new Promise<"cancelled">((resolve) => {
    try {
      const unsubscribe = input.context.cancellation.onCancellationRequested(() => resolve("cancelled"))
      cancellationPromiseCleanup = unsubscribe
    } catch {
      resolve("cancelled")
    }
  })

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<"timed_out">((resolve) => {
    const remainingMs = admission.deadlineAtMs - input.nowMs
    if (remainingMs <= 0) {
      resolve("timed_out")
      return
    }
    timeoutHandle = setTimeout(() => resolve("timed_out"), Math.min(remainingMs, 2_147_483_647))
  })

  if (input.context.cancellation.isCancellationRequested() || hasReachedDeadline(input.readNowMs, admission.deadlineAtMs)) {
    cancellationPromiseCleanup?.()
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
    void triggerBoundaryCleanup(input.onBoundary)
    if (input.context.cancellation.isCancellationRequested()) return { kind: "cancelled", safePoint: "before_operation", effect: { kind: "not_started" } }
    return { kind: "timed_out", effect: { kind: "not_started" } }
  }

  const operationPromise = invokeOperation(input.operation, () => {
    started = true
  })

  try {
    const result = await Promise.race([
      operationPromise.then((value) => ({ kind: "completed" as const, value }), (error: unknown) => ({ kind: "failed" as const, error })),
      cancellationPromise.then((kind) => ({ kind })),
      timeoutPromise.then((kind) => ({ kind })),
    ])

    if (result.kind === "completed") {
      const cancellationRequested = input.context.cancellation.isCancellationRequested()
      const deadlineReached = hasReachedDeadline(input.readNowMs, admission.deadlineAtMs)
      if (cancellationRequested || deadlineReached) {
        await triggerBoundaryCleanup(input.onBoundary)
        if (cancellationRequested) return { kind: "cancelled", safePoint: "after_operation", effect: completedOrUnknown(input.effectful) }
        return { kind: "timed_out", effect: completedOrUnknown(input.effectful) }
      }
      return result
    }
    if (result.kind === "cancelled") {
      void operationPromise.catch(() => undefined)
      void triggerBoundaryCleanup(input.onBoundary)
      return { kind: "cancelled", safePoint: started ? "after_operation" : "before_operation", effect: effectAfterBoundary(input.effectful, started) }
    }
    if (result.kind === "timed_out") {
      void operationPromise.catch(() => undefined)
      void triggerBoundaryCleanup(input.onBoundary)
      return { kind: "timed_out", effect: effectAfterBoundary(input.effectful, started) }
    }

    return { kind: "failed", error: result.error, effect: effectAfterFailure(input.effectful, started) }
  } finally {
    cancellationPromiseCleanup?.()
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
  }
}

function hasReachedDeadline(readNowMs: () => number | undefined, deadlineAtMs: number): boolean {
  const nowMs = readNowMs()
  return nowMs !== undefined && nowMs >= deadlineAtMs
}

function invokeOperation<T>(operation: () => Promise<T>, markStarted: () => void): Promise<T> {
  markStarted()
  try {
    return Promise.resolve(operation())
  } catch (error) {
    return Promise.reject(error)
  }
}

function admissionToOperationResult(admission: Exclude<BoundaryAdmission, { readonly kind: "allowed" }>): BoundedOperationResult<never> {
  switch (admission.kind) {
    case "cancelled": return { kind: "cancelled", safePoint: "before_operation", effect: { kind: "not_started" } }
    case "timed_out": return { kind: "timed_out", effect: { kind: "not_started" } }
    case "budget_exhausted": return { kind: "denied", reason: "budget_exhausted" }
    case "invalid_context": return { kind: "denied", reason: "invalid_context" }
    case "session_closed": return { kind: "denied", reason: "session_closed" }
  }
}

function effectAfterBoundary(effectful: boolean, started: boolean): PartialEffectPosture {
  if (!started) return { kind: "not_started" }
  return effectful ? { kind: "unknown", recovery: "owner_reconciliation_required" } : { kind: "not_started" }
}

function effectAfterFailure(effectful: boolean, started: boolean): PartialEffectPosture {
  if (!started) return { kind: "not_started" }
  return effectful ? { kind: "unknown", recovery: "owner_reconciliation_required" } : { kind: "not_started" }
}

function completedOrUnknown(effectful: boolean): PartialEffectPosture {
  return effectful ? { kind: "completed" } : { kind: "not_started" }
}

async function triggerBoundaryCleanup(cleanup: () => Promise<void>): Promise<void> {
  try {
    await cleanup()
  } catch {
    // The operation's typed boundary result remains primary; close() reports cleanup separately.
  }
}
