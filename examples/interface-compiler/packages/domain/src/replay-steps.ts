import { validateCondition, type Condition } from "./schema.js"
import { isNonEmptyText, isNonNegativeFiniteNumber, isRecord, issue, type ValidationIssue } from "./validation.js"

export interface LocatorTarget {
  readonly semanticDescription: string
  readonly role?: string
  readonly name?: string
  readonly text?: string
  readonly selector?: string
}

export interface NavigateStep {
  readonly type: "navigate"
  readonly url: string
}

export interface ClickStep {
  readonly type: "click"
  readonly target: LocatorTarget
}

export interface FillStep {
  readonly type: "fill"
  readonly target: LocatorTarget
  readonly value: string
}

export interface SelectStep {
  readonly type: "select"
  readonly target: LocatorTarget
  readonly value: string
}

export interface WaitStep {
  readonly type: "wait"
  readonly milliseconds: number
}

export interface ReadStep {
  readonly type: "read"
  readonly target: LocatorTarget
  readonly outputKey: string
}

export interface AssertStep {
  readonly type: "assert"
  readonly condition: Condition
}

export type ReplayStep = NavigateStep | ClickStep | FillStep | SelectStep | WaitStep | ReadStep | AssertStep

export function validateReplayStep(step: unknown, index = 0): readonly ValidationIssue[] {
  if (!isRecord(step)) return [issue(`steps[${index}]`, "replay step must be an object")]

  switch (step.type) {
    case "navigate":
      return isNonEmptyText(step.url) ? [] : [issue(`steps[${index}].url`, "navigate URL must not be empty")]
    case "click":
      return validateLocatorTarget(step.target, index)
    case "fill":
      return [
        ...validateLocatorTarget(step.target, index),
        ...(typeof step.value === "string" ? [] : [issue(`steps[${index}].value`, "fill value must be a string")]),
      ]
    case "select":
      return [
        ...validateLocatorTarget(step.target, index),
        ...(typeof step.value === "string" ? [] : [issue(`steps[${index}].value`, "select value must be a string")]),
      ]
    case "wait":
      return isNonNegativeFiniteNumber(step.milliseconds) && step.milliseconds > 0
        ? []
        : [issue(`steps[${index}].milliseconds`, "wait duration must be finite and positive")]
    case "read":
      return [
        ...validateLocatorTarget(step.target, index),
        ...(isNonEmptyText(step.outputKey) ? [] : [issue(`steps[${index}].outputKey`, "read output key must not be empty")]),
      ]
    case "assert":
      return validateCondition(step.condition, `steps[${index}].condition`)
    default:
      return [issue(`steps[${index}].type`, "replay step kind is not recognized")]
  }
}

function validateLocatorTarget(target: unknown, index: number): readonly ValidationIssue[] {
  if (!isRecord(target)) return [issue(`steps[${index}].target`, "replay locator target must be an object")]
  const issues: ValidationIssue[] = []
  if (!isNonEmptyText(target.semanticDescription)) issues.push(issue(`steps[${index}].target.semanticDescription`, "semantic description must not be empty"))
  for (const field of ["role", "name", "text", "selector"] as const) {
    if (target[field] !== undefined && typeof target[field] !== "string") issues.push(issue(`steps[${index}].target.${field}`, `${field} must be a string when present`))
  }
  return issues
}
