import {
  calculateModelCostUsd,
  validateExecutionMetrics,
  type ExecutionMetrics,
  type ModelPricingUsdPerToken,
  type SafetyStopResult,
} from "@interface-compiler/domain"
import type {
  BenchmarkExecutionRecord,
  MeasuredBenchmarkExecutionMeasurement,
  BenchmarkPricingInput,
  BenchmarkRejection,
  BenchmarkStopStatus,
  BenchmarkTaskIdentity,
  BenchmarkCostSource,
} from "./contract.js"
import { addBenchmarkRejection } from "./rejection.js"

export interface ValidatedExecutionRecord {
  readonly input: Omit<BenchmarkExecutionRecord, "measurement"> & { readonly measurement: MeasuredBenchmarkExecutionMeasurement }
  readonly costUsd: number
  readonly costSource: BenchmarkCostSource
  readonly pricing?: ModelPricingUsdPerToken
  readonly stopStatus: BenchmarkStopStatus
  readonly stopSignature: string
  readonly stopReason?: SafetyStopResult["reason"]
}

export function validateExecutionRecords(
  records: unknown,
  mode: "direct" | "compiled",
  task: BenchmarkTaskIdentity,
  pricing: BenchmarkPricingInput | undefined,
  path: string,
  rejections: BenchmarkRejection[],
): readonly ValidatedExecutionRecord[] {
  if (!Array.isArray(records)) {
    addBenchmarkRejection(rejections, "not_measured", mode === "direct" ? "missing_direct_records" : "missing_compiled_records", path, `${mode} execution projections must be an array`)
    return []
  }
  if (records.length === 0) addBenchmarkRejection(rejections, "not_measured", mode === "direct" ? "missing_direct_records" : "missing_compiled_records", path, `${mode} side has no measured execution records`)

  const validated: ValidatedExecutionRecord[] = []
  records.forEach((record, index) => {
    const value = validateExecutionRecord(record, mode, task, pricingForMode(pricing, mode), `${path}[${index}]`, rejections)
    if (value !== undefined) validated.push(value)
  })
  return validated
}

export function taskIdentityMatches(left: BenchmarkTaskIdentity, right: BenchmarkTaskIdentity): boolean {
  return left.taskId === right.taskId &&
    left.applicationId === right.applicationId &&
    left.objectiveFingerprint === right.objectiveFingerprint &&
    left.modelId === right.modelId
}

export function isTaskIdentity(value: unknown): value is BenchmarkTaskIdentity {
  if (!isRecord(value)) return false
  return isNonEmptyText(value.taskId) &&
    isNonEmptyText(value.applicationId) &&
    isNonEmptyText(value.objectiveFingerprint) &&
    isNonEmptyText(value.modelId)
}

export function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

export function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

export function isNonNegativeSafeInteger(value: unknown): value is number {
  return isNonNegativeFiniteNumber(value) && Number.isSafeInteger(value)
}

function validateExecutionRecord(
  value: unknown,
  mode: "direct" | "compiled",
  task: BenchmarkTaskIdentity,
  pricing: ModelPricingUsdPerToken | undefined,
  path: string,
  rejections: BenchmarkRejection[],
): ValidatedExecutionRecord | undefined {
  const before = rejections.length
  if (!isRecord(value)) {
    addBenchmarkRejection(rejections, "not_measured", "record_invalid", path, "benchmark execution record must be an object")
    return undefined
  }

  if (!isTaskIdentity(value.task)) {
    addBenchmarkRejection(rejections, "not_measured", "task_invalid", `${path}.task`, "benchmark execution record must carry a complete task identity")
  } else if (!taskIdentityMatches(value.task, task)) {
    addBenchmarkRejection(rejections, "not_comparable", "mixed_task", `${path}.task`, "execution record belongs to a different task, application, objective, or model")
  }

  const execution = value.execution
  const measurement = value.measurement
  const measurementStatus = isRecord(measurement) ? measurement.status : undefined
  const executionStatus = isRecord(execution) ? execution.status : undefined
  const skipProjectedMonetaryValidation = measurementStatus !== "measured" ||
    (executionStatus !== "success" && executionStatus !== "stopped") ||
    (measurementStatus === "measured" && isRecord(measurement) && (measurement.modelCostUsd !== undefined || pricing !== undefined))
  const terminal = inspectExecutionProjection(execution, mode, skipProjectedMonetaryValidation, `${path}.execution`, rejections)
  inspectMeasurement(measurement, execution, terminal, pricing, `${path}.measurement`, rejections)
  if (rejections.length !== before || terminal === undefined || !isRecord(measurement)) return undefined

  const cost = resolveCost(execution, measurement, pricing, `${path}.measurement`, rejections)
  if (rejections.length !== before || cost === undefined) return undefined

  return {
    input: value as unknown as ValidatedExecutionRecord["input"],
    costUsd: cost.value,
    costSource: cost.source,
    ...(cost.source === "explicit_model_pricing" && pricing !== undefined ? { pricing } : {}),
    stopStatus: terminal.status,
    stopSignature: terminal.stop === undefined ? "safe_completion" : safetyStopSignature(terminal.stop),
    ...(terminal.reason === undefined ? {} : { stopReason: terminal.reason }),
  }
}

interface TerminalPosture {
  readonly status: BenchmarkStopStatus
  readonly reason?: SafetyStopResult["reason"]
  readonly stop?: SafetyStopResult
}

function inspectExecutionProjection(
  value: unknown,
  expectedMode: "direct" | "compiled",
  skipProjectedMonetaryValidation: boolean,
  path: string,
  rejections: BenchmarkRejection[],
): TerminalPosture | undefined {
  if (!isRecord(value)) {
    addBenchmarkRejection(rejections, "not_measured", "execution_projection_invalid", path, "Worth execution projection must be an object")
    return undefined
  }
  if (value.projectionKind !== "worth_execution") addBenchmarkRejection(rejections, "not_comparable", "execution_projection_invalid", `${path}.projectionKind`, "execution must be a Worth execution projection")
  if (!isNonEmptyText(value.id) || !isNonEmptyText(value.capabilityId)) addBenchmarkRejection(rejections, "not_measured", "execution_projection_invalid", path, "execution projection identity is incomplete")
  if (!isNonNegativeSafeInteger(value.revision)) addBenchmarkRejection(rejections, "not_comparable", "execution_projection_invalid", `${path}.revision`, "execution projection revision must be a non-negative safe integer")
  if (value.mode !== expectedMode) addBenchmarkRejection(rejections, "not_comparable", "execution_mode_mismatch", `${path}.mode`, `expected a ${expectedMode} execution projection`)
  if (expectedMode === "direct" && value.replayVersionId !== undefined) addBenchmarkRejection(rejections, "not_comparable", "execution_replay_mismatch", `${path}.replayVersionId`, "direct execution must not carry a replay version")
  if (expectedMode === "compiled" && !isNonEmptyText(value.replayVersionId)) addBenchmarkRejection(rejections, "not_comparable", "execution_replay_mismatch", `${path}.replayVersionId`, "compiled execution must identify the replay version it used")

  const metrics = value.metrics
  const metricIssues = validateExecutionMetrics(metrics as ExecutionMetrics)
  metricIssues.forEach((metricIssue) => {
    const isMonetary = metricIssue.path === "estimatedModelCostUsd"
    if (isMonetary && skipProjectedMonetaryValidation && isRecord(metrics) && metrics.estimatedModelCostUsd === undefined) return
    addBenchmarkRejection(rejections, isMonetary ? "not_comparable" : "not_measured", isMonetary ? "missing_monetary_data" : "execution_projection_invalid", `${path}.metrics.${metricIssue.path}`, metricIssue.message)
  })

  if (value.status === "running") {
    addBenchmarkRejection(rejections, "not_measured", "execution_incomplete", `${path}.status`, "running execution projections are not terminal measurements")
    return undefined
  }
  if (value.status === "failure") {
    addBenchmarkRejection(rejections, "not_comparable", "execution_failed", `${path}.status`, "failed executions cannot support a claimed direct-versus-compiled comparison")
    return undefined
  }
  if (value.status !== "success" && value.status !== "stopped") {
    addBenchmarkRejection(rejections, "not_measured", "execution_projection_invalid", `${path}.status`, "execution projection status is not a supported terminal status")
    return undefined
  }
  if (!isRecord(metrics) || !isTimestamp(metrics.endedAt) || !isNonNegativeFiniteNumber(metrics.wallClockMs)) {
    addBenchmarkRejection(rejections, "not_measured", "execution_incomplete", `${path}.metrics`, "terminal execution must include endedAt and wallClockMs")
  } else if (isTimestamp(metrics.startedAt) && Date.parse(metrics.endedAt) < Date.parse(metrics.startedAt)) {
    addBenchmarkRejection(rejections, "not_measured", "execution_projection_invalid", `${path}.metrics.endedAt`, "endedAt must not precede startedAt")
  }

  let posture: TerminalPosture
  if (value.status === "success") {
    if (!isRecord(value.outcome) || value.outcome.kind !== "success") addBenchmarkRejection(rejections, "not_comparable", "execution_projection_invalid", `${path}.outcome`, "successful execution must carry a success outcome")
    posture = { status: "safe_completion" }
  } else {
    if (!isRecord(value.outcome) || value.outcome.kind !== "safety_stop" || !isProjectedSafetyStop(value.outcome.stop)) {
      addBenchmarkRejection(rejections, "not_comparable", "unsafe_execution", `${path}.outcome`, "stopped execution must carry a structurally valid safety stop")
      return undefined
    }
    posture = { status: "stopped_at_boundary", reason: value.outcome.stop.reason, stop: value.outcome.stop }
  }
  return posture
}

function inspectMeasurement(
  value: unknown,
  execution: unknown,
  terminal: TerminalPosture | undefined,
  pricing: ModelPricingUsdPerToken | undefined,
  path: string,
  rejections: BenchmarkRejection[],
): void {
  if (!isRecord(value)) {
    addBenchmarkRejection(rejections, "not_measured", "record_invalid", path, "benchmark measurement metadata must be an object")
    return
  }
  if (value.status === "not_measured") {
    addBenchmarkRejection(rejections, "not_measured", "record_not_measured", `${path}.status`, "record was explicitly marked not_measured")
    return
  }
  if (value.status === "provisional") {
    addBenchmarkRejection(rejections, "not_comparable", "record_provisional", `${path}.status`, "provisional measurements cannot support a claimed comparison")
    return
  }
  if (value.status !== "measured") {
    addBenchmarkRejection(rejections, "not_measured", "record_invalid", `${path}.status`, "measurement status must be measured")
    return
  }
  if (value.source !== "worth") addBenchmarkRejection(rejections, "not_comparable", "record_invalid", `${path}.source`, "measurement provenance must be the Worth projection boundary")
  if (!isNonEmptyText(value.recordId)) addBenchmarkRejection(rejections, "not_measured", "record_invalid", `${path}.recordId`, "measured record id must not be empty")
  if (!isNonNegativeSafeInteger(value.toolCalls)) addBenchmarkRejection(rejections, "not_measured", "record_invalid", `${path}.toolCalls`, "tool calls must be a non-negative safe integer")

  if (terminal === undefined) return

  inspectInspection(value.inspection, `${path}.inspection`, rejections)
  inspectEvidence(value.evidence, `${path}.evidence`, rejections)
  inspectRecovery(value.recovery, `${path}.recovery`, rejections)
  inspectSafety(value.safety, terminal, `${path}.safety`, rejections)
  inspectUsage(value.usage, execution, `${path}.usage`, rejections)

  if (value.modelCostUsd !== undefined && !isNonNegativeFiniteNumber(value.modelCostUsd)) addBenchmarkRejection(rejections, "not_comparable", "invalid_monetary_data", `${path}.modelCostUsd`, "explicit model cost must be finite and non-negative")
  if (value.modelCostUsd !== undefined && pricing !== undefined) addBenchmarkRejection(rejections, "not_comparable", "multiple_monetary_sources", path, "use either explicit model cost or token pricing for a side, not both")
}

function inspectInspection(value: unknown, path: string, rejections: BenchmarkRejection[]): void {
  if (!isRecord(value) || (value.status !== "passed" && value.status !== "failed" && value.status !== "provisional") || value.source !== "worth") {
    addBenchmarkRejection(rejections, "not_comparable", "inspection_failed", path, "inspection must be a Worth result")
    return
  }
  if (value.status === "failed") addBenchmarkRejection(rejections, "not_comparable", "inspection_failed", `${path}.status`, "inspection failed")
  else if (value.status === "provisional") addBenchmarkRejection(rejections, "not_comparable", "inspection_provisional", `${path}.status`, "inspection is provisional")
  else if (value.status !== "passed") addBenchmarkRejection(rejections, "not_comparable", "inspection_failed", `${path}.status`, "inspection must be passed")
}

function inspectEvidence(value: unknown, path: string, rejections: BenchmarkRejection[]): void {
  if (!isRecord(value) || (value.status !== "complete" && value.status !== "missing" && value.status !== "failed") || value.source !== "worth") {
    addBenchmarkRejection(rejections, "not_comparable", "evidence_missing", path, "evidence must be a Worth result")
    return
  }
  if (value.status === "missing") addBenchmarkRejection(rejections, "not_comparable", "evidence_missing", `${path}.status`, "required evidence is missing")
  else if (value.status === "failed") addBenchmarkRejection(rejections, "not_comparable", "evidence_failed", `${path}.status`, "required evidence failed inspection")
  else if (value.status !== "complete") addBenchmarkRejection(rejections, "not_comparable", "evidence_missing", `${path}.status`, "evidence must be complete")
  if (value.status === "complete" && !hasDistinctTextIds(value.evidenceIds)) addBenchmarkRejection(rejections, "not_comparable", "evidence_missing", `${path}.evidenceIds`, "complete evidence must contain at least one distinct id")
}

function inspectRecovery(value: unknown, path: string, rejections: BenchmarkRejection[]): void {
  if (!isRecord(value) || (value.status !== "not_required" && value.status !== "completed" && value.status !== "required" && value.status !== "unknown")) {
    addBenchmarkRejection(rejections, "not_comparable", "recovery_unresolved", path, "recovery status must be explicit")
    return
  }
  if (value.status === "required" || value.status === "unknown") addBenchmarkRejection(rejections, "not_comparable", "recovery_unresolved", `${path}.status`, "execution recovery is unresolved")
}

function inspectSafety(value: unknown, terminal: TerminalPosture | undefined, path: string, rejections: BenchmarkRejection[]): void {
  if (!isRecord(value) || terminal === undefined) {
    addBenchmarkRejection(rejections, "not_comparable", "unsafe_execution", path, "safety assessment is required")
    return
  }
  if (value.kind === "unsafe") {
    addBenchmarkRejection(rejections, "not_comparable", "unsafe_execution", path, "execution was marked unsafe")
    return
  }
  if (terminal.status === "safe_completion") {
    if (value.kind !== "safe_completion") addBenchmarkRejection(rejections, "not_comparable", "unsafe_execution", path, "successful execution must declare safe completion")
    return
  }
  if (value.kind !== "stopped_at_boundary" || !isProjectedSafetyStop(value.stop) || terminal.stop === undefined || !sameSafetyStop(value.stop, terminal.stop)) {
    addBenchmarkRejection(rejections, "not_comparable", "unsafe_execution", path, "safety metadata does not match the terminal safety stop")
  }
}

function inspectUsage(value: unknown, execution: unknown, path: string, rejections: BenchmarkRejection[]): void {
  if (value === undefined) return
  if (!isRecord(value) || !isNonNegativeSafeInteger(value.inputTokens) || !isNonNegativeSafeInteger(value.outputTokens)) {
    addBenchmarkRejection(rejections, "not_comparable", "usage_projection_mismatch", path, "explicit usage must contain non-negative safe token counts")
    return
  }
  if (!isRecord(execution) || !isRecord(execution.metrics) || value.inputTokens !== execution.metrics.inputTokens || value.outputTokens !== execution.metrics.outputTokens) {
    addBenchmarkRejection(rejections, "not_comparable", "usage_projection_mismatch", path, "explicit usage must exactly match the Worth execution projection")
  }
}

function resolveCost(
  execution: unknown,
  measurement: Record<string, unknown>,
  pricing: ModelPricingUsdPerToken | undefined,
  path: string,
  rejections: BenchmarkRejection[],
): { readonly value: number; readonly source: BenchmarkCostSource } | undefined {
  if (measurement.modelCostUsd !== undefined) {
    return isNonNegativeFiniteNumber(measurement.modelCostUsd)
      ? { value: measurement.modelCostUsd, source: "explicit_model_cost" }
      : undefined
  }
  if (pricing !== undefined) {
    const metrics = isRecord(execution) ? execution.metrics : undefined
    const usage = isRecord(measurement.usage) ? measurement.usage : metrics
    const priced = calculateModelCostUsd(usage as { readonly inputTokens: number; readonly outputTokens: number }, pricing)
    if (!priced.ok) {
      addBenchmarkRejection(rejections, "not_comparable", "invalid_pricing", path, priced.issues.map(({ message }) => message).join("; "))
      return undefined
    }
    return { value: priced.value, source: "explicit_model_pricing" }
  }
  const projectedCost = isRecord(execution) && isRecord(execution.metrics) ? execution.metrics.estimatedModelCostUsd : undefined
  if (!isNonNegativeFiniteNumber(projectedCost)) {
    addBenchmarkRejection(rejections, "not_comparable", "missing_monetary_data", `${path}.modelCostUsd`, "no explicit model cost, pricing, or valid Worth model-cost measurement was provided")
    return undefined
  }
  return { value: projectedCost, source: "worth_execution_projection" }
}

function pricingForMode(pricing: BenchmarkPricingInput | undefined, mode: "direct" | "compiled"): ModelPricingUsdPerToken | undefined {
  return mode === "direct" ? pricing?.direct : pricing?.compiled
}

function isProjectedSafetyStop(value: unknown): value is SafetyStopResult {
  if (!isRecord(value) || value.kind !== "safety_stop" || value.terminal !== true || value.nextAction !== "human_required" || !isTimestamp(value.observedAt)) return false
  switch (value.reason) {
    case "authentication_required":
      return isCredentialKind(value.credential)
    case "personal_information_required":
      return isPersonalInformationKind(value.information)
    case "shipping_details_required":
    case "order_placement":
    case "access_control_required":
      return true
    case "payment_details_required":
      return isPaymentInformationKind(value.payment)
    default:
      return false
  }
}

function sameSafetyStop(left: SafetyStopResult, right: SafetyStopResult): boolean {
  if (left.reason !== right.reason || left.observedAt !== right.observedAt) return false
  switch (left.reason) {
    case "authentication_required":
      return right.reason === left.reason && left.credential === right.credential
    case "personal_information_required":
      return right.reason === left.reason && left.information === right.information
    case "payment_details_required":
      return right.reason === left.reason && left.payment === right.payment
    case "shipping_details_required":
    case "order_placement":
    case "access_control_required":
      return right.reason === left.reason
  }
}

function safetyStopSignature(stop: SafetyStopResult): string {
  switch (stop.reason) {
    case "authentication_required":
      return `${stop.reason}:${stop.credential}`
    case "personal_information_required":
      return `${stop.reason}:${stop.information}`
    case "payment_details_required":
      return `${stop.reason}:${stop.payment}`
    case "shipping_details_required":
    case "order_placement":
    case "access_control_required":
      return stop.reason
  }
}

function hasDistinctTextIds(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyText) && new Set(value).size === value.length
}

function isCredentialKind(value: unknown): boolean {
  return value === "username" || value === "password" || value === "one_time_code" || value === "unknown"
}

function isPersonalInformationKind(value: unknown): boolean {
  return value === "identity" || value === "contact" || value === "unknown"
}

function isPaymentInformationKind(value: unknown): boolean {
  return value === "card" || value === "bank_account" || value === "wallet" || value === "unknown"
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
