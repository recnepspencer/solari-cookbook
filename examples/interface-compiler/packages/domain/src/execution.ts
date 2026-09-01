import type { CapabilityId, ExecutionId, IsoTimestamp, ReplayVersionId } from "./identity.js"
import { validateReplayFailure, type ReplayFailure } from "./replay.js"
import { isJsonValue, type JsonValue } from "./schema.js"
import { registerSafetyStopResult, validateSafetyStopResult, type SafetyStopResult } from "./safety.js"
import { invalid, isIsoTimestamp, isNonEmptyText, isNonNegativeFiniteNumber, isNonNegativeInteger, isRecord, issue, valid, type ValidationResult } from "./validation.js"

const runningExecutionBrand: unique symbol = Symbol("RunningExecution")
const successfulExecutionBrand: unique symbol = Symbol("SuccessfulExecution")
const failedExecutionBrand: unique symbol = Symbol("FailedExecution")
const stoppedExecutionBrand: unique symbol = Symbol("StoppedExecution")
const runningExecutionInstances = new WeakSet<object>()

export type ExecutionMode = "direct" | "compiled" | "exploratory"

export interface ExecutionMetrics {
  readonly startedAt: IsoTimestamp
  readonly endedAt?: IsoTimestamp
  readonly wallClockMs?: number
  readonly modelCalls: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly browserObservations: number
  readonly browserActions: number
  readonly estimatedModelCostMicrocents: number
}

interface ExecutionCore {
  readonly id: ExecutionId
  readonly capabilityId: CapabilityId
  readonly replayVersionId?: ReplayVersionId
  readonly mode: ExecutionMode
  readonly metrics: ExecutionMetrics
}

export interface RunningExecution extends ExecutionCore {
  readonly status: "running"
  readonly metrics: ExecutionMetrics & { readonly endedAt?: undefined; readonly wallClockMs?: undefined }
  readonly [runningExecutionBrand]: true
}

export interface SuccessfulExecution extends ExecutionCore {
  readonly status: "success"
  readonly outcome: { readonly kind: "success"; readonly output?: JsonValue }
  readonly metrics: ExecutionMetrics & { readonly endedAt: IsoTimestamp; readonly wallClockMs: number }
  readonly [successfulExecutionBrand]: true
}

export interface FailedExecution extends ExecutionCore {
  readonly status: "failure"
  readonly outcome: FailedExecutionOutcome
  readonly metrics: ExecutionMetrics & { readonly endedAt: IsoTimestamp; readonly wallClockMs: number }
  readonly [failedExecutionBrand]: true
}

export interface StoppedExecution extends ExecutionCore {
  readonly status: "stopped"
  readonly outcome: { readonly kind: "safety_stop"; readonly stop: SafetyStopResult }
  readonly metrics: ExecutionMetrics & { readonly endedAt: IsoTimestamp; readonly wallClockMs: number }
  readonly [stoppedExecutionBrand]: true
}

export type TerminalExecution = SuccessfulExecution | FailedExecution | StoppedExecution
export type Execution = RunningExecution | TerminalExecution

export type ExecutionCompletion =
  | { readonly kind: "success"; readonly output?: JsonValue }
  | FailedExecutionOutcome
  | { readonly kind: "safety_stop"; readonly stop: SafetyStopResult }

export type FailedExecutionOutcome =
  | {
      readonly kind: "failure"
      readonly reason: "replay_failed"
      readonly message: string
      readonly replayFailure: ReplayFailure
    }
  | {
      readonly kind: "failure"
      readonly reason: "execution_failed"
      readonly message: string
      readonly replayFailure?: ReplayFailure
    }

export interface ExecutionStart {
  readonly id: ExecutionId
  readonly capabilityId: CapabilityId
  readonly replayVersionId?: ReplayVersionId
  readonly mode: ExecutionMode
  readonly metrics: ExecutionMetrics
}

export function createExecution(input: ExecutionStart): ValidationResult<RunningExecution> {
  const issues = validateExecutionStart(input)
  if (issues.length > 0) return invalid(...issues)

  const result = valid(
    Object.freeze({
      id: input.id,
      capabilityId: input.capabilityId,
      ...(input.replayVersionId === undefined ? {} : { replayVersionId: input.replayVersionId }),
      mode: input.mode,
      metrics: Object.freeze({
        ...input.metrics,
        endedAt: undefined,
        wallClockMs: undefined,
      }),
      status: "running" as const,
      [runningExecutionBrand]: true as const,
    }),
  )
  if (result.ok) runningExecutionInstances.add(result.value)
  return result
}

export function finishExecution(
  execution: RunningExecution,
  completion: ExecutionCompletion,
  endedAt: IsoTimestamp,
): ValidationResult<TerminalExecution> {
  if (!isRunningExecution(execution)) return invalid(issue("execution", "execution must come from createExecution"))
  if (!isIsoTimestamp(endedAt)) return invalid(issue("endedAt", "endedAt must be a timestamp"))
  const metricIssues = validateExecutionMetrics(execution.metrics)
  if (metricIssues.length > 0) return invalid(...metricIssues)
  if (execution.metrics.endedAt !== undefined || execution.metrics.wallClockMs !== undefined) return invalid(issue("execution.metrics", "a running execution cannot already be terminal"))
  const completionIssues = validateExecutionCompletion(completion)
  if (completionIssues.length > 0) return invalid(...completionIssues)
  const startedMs = Date.parse(execution.metrics.startedAt)
  const endedMs = Date.parse(endedAt)
  if (endedMs < startedMs) return invalid(issue("endedAt", "endedAt must not precede startedAt"))

  const metrics = Object.freeze({
    ...execution.metrics,
    endedAt,
    wallClockMs: endedMs - startedMs,
  })
  switch (completion.kind) {
    case "success":
      return valid(Object.freeze({ ...execution, status: "success" as const, outcome: completion, metrics, [successfulExecutionBrand]: true as const }))
    case "failure":
      return valid(Object.freeze({ ...execution, status: "failure" as const, outcome: completion, metrics, [failedExecutionBrand]: true as const }))
    case "safety_stop":
      {
        const result = valid(Object.freeze({ ...execution, status: "stopped" as const, outcome: completion, metrics, [stoppedExecutionBrand]: true as const }))
        if (result.ok) registerSafetyStopResult(result.value.outcome.stop)
        return result
      }
    default: {
      const unreachable: never = completion
      return invalid(issue("completion", `completion kind is not recognized: ${String(unreachable)}`))
    }
  }
}

export function validateExecutionMetrics(metrics: ExecutionMetrics): readonly ReturnType<typeof issue>[] {
  const issues: ReturnType<typeof issue>[] = []
  if (!isRecord(metrics)) return [issue("metrics", "execution metrics must be an object")]
  if (!isIsoTimestamp(metrics.startedAt)) issues.push(issue("startedAt", "startedAt must be a timestamp"))
  if (metrics.endedAt !== undefined && !isIsoTimestamp(metrics.endedAt)) issues.push(issue("endedAt", "endedAt must be a timestamp"))
  if (metrics.wallClockMs !== undefined && !isNonNegativeFiniteNumber(metrics.wallClockMs)) issues.push(issue("wallClockMs", "wallClockMs must be finite and non-negative"))
  for (const [field, value] of metricCounters(metrics)) {
    if (!isNonNegativeInteger(value)) issues.push(issue(field, `${field} must be a non-negative safe integer`))
  }
  if (!isNonNegativeInteger(metrics.estimatedModelCostMicrocents)) issues.push(issue("estimatedModelCostMicrocents", "estimated model cost must be a non-negative safe integer"))
  return issues
}

function validateExecutionStart(input: ExecutionStart): ReturnType<typeof issue>[] {
  if (!isRecord(input)) return [issue("execution", "execution start must be an object")]
  const issues = validateExecutionMetrics(input.metrics).slice() as ReturnType<typeof issue>[]
  if (!isRecord(input.metrics)) return issues
  if (!isNonEmptyText(input.id)) issues.push(issue("id", "execution id must not be empty"))
  if (!isNonEmptyText(input.capabilityId)) issues.push(issue("capabilityId", "capability id must not be empty"))
  if (input.mode !== "direct" && input.mode !== "compiled" && input.mode !== "exploratory") issues.push(issue("mode", "execution mode is not recognized"))
  if (input.metrics.endedAt !== undefined) issues.push(issue("metrics.endedAt", "a running execution cannot have endedAt"))
  if (input.metrics.wallClockMs !== undefined) issues.push(issue("metrics.wallClockMs", "a running execution cannot have wallClockMs"))
  return issues
}

function metricCounters(metrics: ExecutionMetrics): readonly (readonly [string, number])[] {
  return [
    ["modelCalls", metrics.modelCalls],
    ["inputTokens", metrics.inputTokens],
    ["outputTokens", metrics.outputTokens],
    ["browserObservations", metrics.browserObservations],
    ["browserActions", metrics.browserActions],
  ]
}

export function validateExecutionCompletion(completion: ExecutionCompletion): readonly ReturnType<typeof issue>[] {
  if (!isRecord(completion)) return [issue("completion", "execution completion must be an object")]
  const issues: ReturnType<typeof issue>[] = []
  switch (completion.kind) {
    case "success":
      if (completion.output !== undefined && !isJsonValue(completion.output)) issues.push(issue("output", "execution output must be a JSON value"))
      break
    case "failure":
      if (!isNonEmptyText(completion.message)) issues.push(issue("message", "failure message must not be empty"))
      if (completion.reason !== "replay_failed" && completion.reason !== "execution_failed") issues.push(issue("reason", "failure reason is not recognized"))
      if (completion.reason === "replay_failed") issues.push(...validateReplayFailure(completion.replayFailure, "replayFailure"))
      if (completion.reason === "execution_failed" && completion.replayFailure !== undefined) issues.push(...validateReplayFailure(completion.replayFailure, "replayFailure"))
      break
    case "safety_stop":
      issues.push(...validateSafetyStopResult(completion.stop))
      break
    default:
      issues.push(issue("kind", "execution completion kind is not recognized"))
  }
  return issues
}

export function isRunningExecution(value: unknown): value is RunningExecution {
  return value !== null && typeof value === "object" && runningExecutionInstances.has(value) && hasBrand(value, runningExecutionBrand) && isRecord(value) && value.status === "running" && validateExecutionStart(value as unknown as ExecutionStart).length === 0
}

function hasBrand(value: unknown, brand: symbol): boolean {
  return value !== null && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, brand) && (value as Record<symbol, unknown>)[brand] === true
}
