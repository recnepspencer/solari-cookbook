import type { IsoTimestamp, OperationId } from "./identity.js"
import { isIsoTimestamp, isNonNegativeFiniteNumber, issue, type ValidationIssue } from "./validation.js"

export interface CancellationToken {
  isCancellationRequested(): boolean
  onCancellationRequested(listener: () => void): () => void
}

export interface ResourceBudget {
  readonly maxWallClockMs: number
  readonly maxModelCalls?: number
  readonly maxBrowserActions?: number
  readonly maxEvidenceBytes?: number
}

export type PartialEffectPosture =
  | { readonly kind: "not_started" }
  | { readonly kind: "completed" }
  | { readonly kind: "unknown"; readonly recovery: "owner_reconciliation_required" }

export interface OperationContext {
  readonly operationId: OperationId
  readonly deadlineAt: IsoTimestamp
  readonly cancellation: CancellationToken
  readonly budget: ResourceBudget
}

export function validateOperationContext(context: OperationContext): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!context || typeof context !== "object") return [issue("context", "operation context must be an object")]
  if (typeof context.operationId !== "string" || context.operationId.trim().length === 0) issues.push(issue("operationId", "operation id must not be empty"))
  if (!isIsoTimestamp(context.deadlineAt)) issues.push(issue("deadlineAt", "deadlineAt must be a timestamp"))
  if (!context.cancellation || typeof context.cancellation.isCancellationRequested !== "function" || typeof context.cancellation.onCancellationRequested !== "function") issues.push(issue("cancellation", "cancellation token is required"))
  if (!context.budget || typeof context.budget !== "object") {
    issues.push(issue("budget", "resource budget is required"))
  } else {
    validateBudgetValue(context.budget.maxWallClockMs, "budget.maxWallClockMs", issues, false)
    validateBudgetValue(context.budget.maxModelCalls, "budget.maxModelCalls", issues, true)
    validateBudgetValue(context.budget.maxBrowserActions, "budget.maxBrowserActions", issues, true)
    validateBudgetValue(context.budget.maxEvidenceBytes, "budget.maxEvidenceBytes", issues, true)
  }
  return issues
}

function validateBudgetValue(value: number | undefined, path: string, issues: ValidationIssue[], optional: boolean): void {
  if (value === undefined && optional) return
  if (!isNonNegativeFiniteNumber(value) || (optional ? !Number.isSafeInteger(value) : value <= 0)) {
    issues.push(issue(path, optional ? "budget value must be a non-negative safe integer" : "max wall-clock budget must be finite and positive"))
  }
}
