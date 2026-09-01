import {
  calculateBreakEvenCalls,
  validateExecutionMetrics,
  validateSafetyStopResult,
  type ExecutionId,
  type ExecutionMetrics,
  type SafetyStopResult,
} from "@interface-compiler/domain"
import type {
  CompiledPlanMeasurementProvenance,
  WorthQueryEvidence,
} from "@interface-compiler/worth-adapter"
import type { BenchmarkTaskIdentity } from "./contract.js"
import {
  terminalBenchmarkReportSchemaVersion,
  type TerminalBenchmarkIssue,
  type TerminalBenchmarkMetrics,
  type TerminalBenchmarkReport,
  type TerminalBenchmarkReportInput,
  type TerminalBenchmarkRunReport,
  type TerminalBenchmarkSavings,
  type TerminalBreakEven,
  type TerminalCompilationEconomics,
  type TerminalCompilationExecutions,
  type TerminalCompiledPlanAuthority,
  type UnavailableTerminalBenchmarkReport,
  type WorthSettledBenchmarkExecution,
} from "./terminal-report-contract.js"

export { terminalBenchmarkReportSchemaVersion } from "./terminal-report-contract.js"
export type {
  MeasuredTerminalBenchmarkReport,
  TerminalBenchmarkIssue,
  TerminalBenchmarkMetrics,
  TerminalBenchmarkReport,
  TerminalBenchmarkReportInput,
  TerminalBenchmarkRunReport,
  TerminalBenchmarkSavings,
  TerminalBreakEven,
  TerminalCompilationEconomics,
  TerminalCompilationExecutions,
  TerminalCompiledPlanAuthority,
  UnavailableTerminalBenchmarkReport,
  WorthSettledBenchmarkExecution,
} from "./terminal-report-contract.js"

/**
 * Derives a one-run direct/compiled comparison exclusively from terminal WORTH
 * projections. Compilation economics are admitted only when the plan names
 * measured discovery and verification executions and the exact terminal
 * projections for those identities are supplied.
 */
export function createTerminalBenchmarkReport(input: TerminalBenchmarkReportInput): TerminalBenchmarkReport {
  const issues: TerminalBenchmarkIssue[] = []
  validateTask(input.task, issues)
  validatePlanAuthority(input.compiledPlan, issues)
  validateComparisonExecution(input.direct, "direct", input.compiledPlan, issues)
  validateComparisonExecution(input.compiled, "compiled", input.compiledPlan, issues)
  validateMatchingBoundary(input.direct, input.compiled, issues)
  if (input.direct.projection.executionId === input.compiled.projection.executionId) {
    issues.push(issue("compiled.projection.executionId", "duplicate_execution", "direct and compiled runs must have different WORTH execution identities"))
  }

  const compilation = validateCompilation(input.compiledPlan, input.compilation, [input.direct.projection.executionId, input.compiled.projection.executionId], issues)
  if (issues.length > 0) return unavailable(input.task, issues)

  const direct = runReport(input.direct, "direct")
  const compiled = runReport(input.compiled, "compiled")
  const compilationReport = compilationEconomics(input.compiledPlan.compilationProvenance, input.compilation, compilation)
  const breakEven = breakEvenEconomics(compilationReport, direct.metrics.estimatedModelCostUsd, compiled.metrics.estimatedModelCostUsd, issues)
  const perRunSavings = savings(direct.metrics, compiled.metrics, issues)
  if (issues.length > 0) return unavailable(input.task, issues)

  return Object.freeze({
    schemaVersion: terminalBenchmarkReportSchemaVersion,
    kind: "measured",
    task: freezeTask(input.task),
    direct,
    compiled,
    perRunSavings,
    economics: Object.freeze({ compilation: compilationReport, breakEven }),
    provenance: Object.freeze({
      authority: "worth_terminal_execution_projections",
      executionIds: Object.freeze([
        input.direct.projection.executionId,
        input.compiled.projection.executionId,
        ...(compilationReport.kind === "measured" ? compilationReport.discoveryExecutionIds : []),
        ...(compilationReport.kind === "measured" ? compilationReport.verificationExecutionIds : []),
      ]),
      planQueryIdentities: Object.freeze([
        input.compiledPlan.capabilityEvidence.queryIdentity,
        input.compiledPlan.replayEvidence.queryIdentity,
      ]),
    }),
  })
}

function validateTask(task: BenchmarkTaskIdentity, issues: TerminalBenchmarkIssue[]): void {
  if (!isNonEmptyText(task.taskId)) issues.push(issue("task.taskId", "invalid_task", "task id must not be empty"))
  if (!isNonEmptyText(task.applicationId)) issues.push(issue("task.applicationId", "invalid_task", "application id must not be empty"))
  if (!isNonEmptyText(task.objectiveFingerprint)) issues.push(issue("task.objectiveFingerprint", "invalid_task", "objective fingerprint must not be empty"))
  if (!isNonEmptyText(task.modelId)) issues.push(issue("task.modelId", "invalid_task", "model id must not be empty"))
}

function validatePlanAuthority(plan: TerminalCompiledPlanAuthority, issues: TerminalBenchmarkIssue[]): void {
  validateEvidence(plan.capabilityEvidence, "compiledPlan.capabilityEvidence", "capability", issues)
  validateEvidence(plan.replayEvidence, "compiledPlan.replayEvidence", "replay", issues)
  if (!isNonEmptyText(plan.capabilityId)) issues.push(issue("compiledPlan.capabilityId", "capability_mismatch", "capability id must not be empty"))
  if (!isNonEmptyText(plan.replayVersionId)) issues.push(issue("compiledPlan.replayVersionId", "replay_mismatch", "replay version id must not be empty"))
  if (plan.compilationProvenance.kind === "measured") {
    validateExecutionIdentitySet(plan.compilationProvenance.discoveryExecutionIds, "compiledPlan.compilationProvenance.discoveryExecutionIds", issues)
    validateExecutionIdentitySet(plan.compilationProvenance.verificationExecutionIds, "compiledPlan.compilationProvenance.verificationExecutionIds", issues)
    const allIds = [...plan.compilationProvenance.discoveryExecutionIds, ...plan.compilationProvenance.verificationExecutionIds]
    if (new Set(allIds).size !== allIds.length) issues.push(issue("compiledPlan.compilationProvenance", "compilation_attribution_mismatch", "discovery and verification execution identities must be unique and disjoint"))
  }
}

function validateComparisonExecution(
  settlement: WorthSettledBenchmarkExecution,
  mode: "direct" | "compiled",
  plan: TerminalCompiledPlanAuthority,
  issues: TerminalBenchmarkIssue[],
): void {
  const path = mode
  validateEvidence(settlement.evidence, `${path}.evidence`, "execution", issues)
  validateTerminalProjection(settlement, path, issues)
  const projection = settlement.projection
  if (projection.mode !== mode) issues.push(issue(`${path}.projection.mode`, "mode_mismatch", `WORTH projection must be ${mode}`))
  if (projection.capabilityId !== plan.capabilityId) issues.push(issue(`${path}.projection.capabilityId`, "capability_mismatch", "WORTH projection belongs to a different capability"))
  if (mode === "direct" && projection.replayVersionId !== undefined) issues.push(issue(`${path}.projection.replayVersionId`, "replay_mismatch", "direct execution must not name a replay"))
  if (mode === "compiled" && projection.replayVersionId !== plan.replayVersionId) issues.push(issue(`${path}.projection.replayVersionId`, "replay_mismatch", "compiled execution must name the admitted replay"))
  if (projection.lifecycle !== "stopped" || projection.outcome.kind !== "safety_stop" || !validSafetyStop(projection.outcome.stop)) {
    issues.push(issue(`${path}.projection.outcome`, "unsafe_terminal_outcome", "bounded Walmart comparison runs must terminate at a classified human-required safety boundary"))
  }
}

function validateMatchingBoundary(
  direct: WorthSettledBenchmarkExecution,
  compiled: WorthSettledBenchmarkExecution,
  issues: TerminalBenchmarkIssue[],
): void {
  if (direct.projection.outcome.kind !== "safety_stop" || compiled.projection.outcome.kind !== "safety_stop") return
  const directStop = direct.projection.outcome.stop
  const compiledStop = compiled.projection.outcome.stop
  if (!validSafetyStop(directStop) || !validSafetyStop(compiledStop)) return
  if (safetyStopSignature(directStop) !== safetyStopSignature(compiledStop)) {
    issues.push(issue("executions", "boundary_mismatch", "direct and compiled runs must reach the same classified human-required boundary"))
  }
}

function validateCompilation(
  provenance: TerminalCompiledPlanAuthority,
  compilation: TerminalCompilationExecutions | undefined,
  comparisonIds: readonly ExecutionId[],
  issues: TerminalBenchmarkIssue[],
): { readonly discoveryCostUsd: number; readonly verificationCostUsd: number } | undefined {
  if (provenance.compilationProvenance.kind === "synthetic_seed") return undefined
  if (compilation === undefined) return undefined
  const expectedDiscovery = provenance.compilationProvenance.discoveryExecutionIds
  const expectedVerification = provenance.compilationProvenance.verificationExecutionIds
  const actualDiscovery = compilation.discovery.map((entry) => entry.projection.executionId)
  const actualVerification = compilation.verification.map((entry) => entry.projection.executionId)
  if (!sameIdentitySet(expectedDiscovery, actualDiscovery) || !sameIdentitySet(expectedVerification, actualVerification)) {
    issues.push(issue("compilation", "compilation_attribution_mismatch", "compilation terminal projections must exactly match the WORTH plan provenance identities"))
    return undefined
  }
  const allIds = [...comparisonIds, ...actualDiscovery, ...actualVerification]
  if (new Set(allIds).size !== allIds.length) issues.push(issue("compilation", "duplicate_execution", "comparison and compilation executions must be unique and disjoint"))

  for (const [phase, entries] of [["discovery", compilation.discovery], ["verification", compilation.verification]] as const) {
    for (const [index, entry] of entries.entries()) {
      const path = `compilation.${phase}[${index}]`
      validateEvidence(entry.evidence, `${path}.evidence`, "execution", issues)
      validateTerminalProjection(entry, path, issues)
      const projection = entry.projection
      const correctMode = phase === "discovery" ? projection.mode === "exploratory" : projection.mode === "compiled"
      if (!correctMode) issues.push(issue(`${path}.projection.mode`, "mode_mismatch", `${phase} execution has the wrong WORTH mode`))
      if (projection.lifecycle !== "success" || projection.outcome.kind !== "success") issues.push(issue(`${path}.projection.outcome`, "invalid_terminal_projection", `${phase} compilation execution must be successful`))
      if (projection.capabilityId !== provenance.capabilityId) issues.push(issue(`${path}.projection.capabilityId`, "capability_mismatch", "compilation execution belongs to a different capability"))
      if (phase === "verification" && projection.replayVersionId !== provenance.replayVersionId) issues.push(issue(`${path}.projection.replayVersionId`, "replay_mismatch", "verification execution must name the admitted replay"))
    }
  }
  const discoveryCostUsd = sumCost(compilation.discovery)
  const verificationCostUsd = sumCost(compilation.verification)
  if (![discoveryCostUsd, verificationCostUsd, discoveryCostUsd + verificationCostUsd].every(Number.isFinite)) {
    issues.push(issue("compilation", "numeric_overflow", "compilation cost overflowed the finite number range"))
    return undefined
  }
  return { discoveryCostUsd, verificationCostUsd }
}

function validateTerminalProjection(settlement: WorthSettledBenchmarkExecution, path: string, issues: TerminalBenchmarkIssue[]): void {
  const projection = settlement.projection
  if (settlement.commit !== "committed" && settlement.commit !== "already_committed") issues.push(issue(`${path}.commit`, "invalid_terminal_projection", "WORTH settlement commit is invalid"))
  if (projection.projectionKind !== "worth_terminal_execution" || !isNonEmptyText(projection.executionId) || !Number.isSafeInteger(projection.revision) || projection.revision < 0) {
    issues.push(issue(`${path}.projection`, "invalid_terminal_projection", "WORTH terminal projection identity or revision is invalid"))
  }
  if (validateExecutionMetrics(projection.metrics as ExecutionMetrics).length > 0 || projection.metrics.endedAt === undefined || projection.metrics.wallClockMs === undefined) {
    issues.push(issue(`${path}.projection.metrics`, "invalid_terminal_projection", "WORTH terminal metrics are invalid or incomplete"))
    return
  }
  const elapsed = Date.parse(projection.metrics.endedAt) - Date.parse(projection.metrics.startedAt)
  if (!Number.isFinite(elapsed) || elapsed !== projection.metrics.wallClockMs) issues.push(issue(`${path}.projection.metrics.wallClockMs`, "invalid_terminal_projection", "WORTH wall clock must equal the terminal timestamp interval"))
}

function validateEvidence(
  evidence: WorthQueryEvidence,
  path: string,
  kind: "execution" | "capability" | "replay",
  issues: TerminalBenchmarkIssue[],
): void {
  const expected = kind === "execution"
    ? { queryName: "interface_compiler_execution_read", projectedFieldCount: 8 }
    : kind === "capability"
      ? { queryName: "interface_compiler_capability_read", projectedFieldCount: 8 }
      : { queryName: "interface_compiler_active_replay_read", projectedFieldCount: 11 }
  if (evidence.queryName !== expected.queryName || !isNonEmptyText(evidence.queryIdentity) || !Number.isSafeInteger(evidence.basisVersion) || evidence.basisVersion < 0 || evidence.projectedRecordCount !== 1 || evidence.projectedFieldCount !== expected.projectedFieldCount || evidence.basisReleased !== true) {
    issues.push(issue(path, "invalid_worth_evidence", `WORTH evidence must identify one released ${kind} projection from ${expected.queryName}`))
  }
}

function validateExecutionIdentitySet(ids: readonly ExecutionId[], path: string, issues: TerminalBenchmarkIssue[]): void {
  if (ids.length === 0 || ids.some((id) => !isNonEmptyText(id)) || new Set(ids).size !== ids.length) {
    issues.push(issue(path, "compilation_attribution_mismatch", "execution identities must be non-empty and unique"))
  }
}

function compilationEconomics(
  provenance: CompiledPlanMeasurementProvenance,
  supplied: TerminalCompilationExecutions | undefined,
  measured: { readonly discoveryCostUsd: number; readonly verificationCostUsd: number } | undefined,
): TerminalCompilationEconomics {
  if (provenance.kind === "synthetic_seed") {
    return { kind: "not_measured", reason: "synthetic_seed_not_economic_evidence", rejectedSuppliedCompilation: supplied !== undefined }
  }
  if (supplied === undefined || measured === undefined) {
    return { kind: "not_measured", reason: "compilation_terminal_projections_not_supplied", rejectedSuppliedCompilation: false }
  }
  return {
    kind: "measured",
    discoveryCostUsd: measured.discoveryCostUsd,
    verificationCostUsd: measured.verificationCostUsd,
    totalCostUsd: measured.discoveryCostUsd + measured.verificationCostUsd,
    discoveryExecutionIds: Object.freeze(supplied.discovery.map((entry) => entry.projection.executionId)),
    verificationExecutionIds: Object.freeze(supplied.verification.map((entry) => entry.projection.executionId)),
  }
}

function breakEvenEconomics(
  compilation: TerminalCompilationEconomics,
  directCostUsd: number,
  compiledCostUsd: number,
  issues: TerminalBenchmarkIssue[],
): TerminalBreakEven {
  if (compilation.kind === "not_measured") return { kind: "not_measured", reason: compilation.reason }
  const result = calculateBreakEvenCalls({ compileCostUsd: compilation.totalCostUsd, directCostPerCallUsd: directCostUsd, compiledCostPerCallUsd: compiledCostUsd })
  if (!result.ok) {
    issues.push(issue("economics.breakEven", "numeric_overflow", "break-even inputs were not valid finite WORTH costs"))
    return { kind: "not_measured", reason: "compilation_terminal_projections_not_supplied" }
  }
  return { kind: "measured", value: result.value }
}

function runReport(settlement: WorthSettledBenchmarkExecution, mode: "direct" | "compiled"): TerminalBenchmarkRunReport {
  const metrics = settlement.projection.metrics
  const stop = settlement.projection.outcome.kind === "safety_stop" ? settlement.projection.outcome.stop : undefined
  if (stop === undefined) throw new Error("validated terminal settlement lost its safety stop")
  return Object.freeze({
    executionId: settlement.projection.executionId,
    mode,
    metrics: Object.freeze({
      modelCalls: metrics.modelCalls,
      inputTokens: metrics.inputTokens,
      outputTokens: metrics.outputTokens,
      browserObservations: metrics.browserObservations,
      browserActions: metrics.browserActions,
      wallClockMs: metrics.wallClockMs,
      estimatedModelCostUsd: metrics.estimatedModelCostUsd,
    }),
    boundary: stop.reason,
    worthEvidence: Object.freeze({ ...settlement.evidence }),
  })
}

function savings(direct: TerminalBenchmarkMetrics, compiled: TerminalBenchmarkMetrics, issues: TerminalBenchmarkIssue[]): TerminalBenchmarkSavings {
  const entries = (Object.keys(direct) as (keyof TerminalBenchmarkMetrics)[]).map((key) => {
    const absolute = direct[key] - compiled[key]
    const fraction = direct[key] === 0 ? undefined : absolute / direct[key]
    if (!Number.isFinite(absolute) || (fraction !== undefined && !Number.isFinite(fraction))) {
      issues.push(issue(`perRunSavings.${key}`, "numeric_overflow", `${key} savings exceeded the finite number range`))
    }
    return [key, Object.freeze({
      direct: direct[key],
      compiled: compiled[key],
      absolute,
      fractionOfDirect: direct[key] === 0
        ? { kind: "not_computable", reason: "zero_denominator" }
        : { kind: "measured", value: fraction as number },
    })]
  })
  return Object.freeze(Object.fromEntries(entries) as unknown as TerminalBenchmarkSavings)
}

function sumCost(entries: readonly WorthSettledBenchmarkExecution[]): number {
  return entries.reduce((total, entry) => total + entry.projection.metrics.estimatedModelCostUsd, 0)
}

function validSafetyStop(stop: unknown): stop is SafetyStopResult {
  return validateSafetyStopResult(stop).length === 0
}

function safetyStopSignature(stop: SafetyStopResult): string {
  switch (stop.reason) {
    case "authentication_required": return `${stop.reason}:${stop.credential}`
    case "personal_information_required": return `${stop.reason}:${stop.information}`
    case "payment_details_required": return `${stop.reason}:${stop.payment}`
    case "shipping_details_required":
    case "order_placement":
    case "access_control_required": return stop.reason
  }
}

function sameIdentitySet(expected: readonly ExecutionId[], actual: readonly ExecutionId[]): boolean {
  return expected.length === actual.length && expected.every((identity) => actual.includes(identity))
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function issue(path: string, code: TerminalBenchmarkIssue["code"], message: string): TerminalBenchmarkIssue {
  return { path, code, message }
}

function unavailable(task: BenchmarkTaskIdentity, issues: readonly TerminalBenchmarkIssue[]): UnavailableTerminalBenchmarkReport {
  return Object.freeze({ schemaVersion: terminalBenchmarkReportSchemaVersion, kind: "not_comparable", task: freezeTask(task), issues: Object.freeze([...issues]), provenance: Object.freeze({ authority: "worth_terminal_execution_projections" }) })
}

function freezeTask(task: BenchmarkTaskIdentity): BenchmarkTaskIdentity {
  return Object.freeze({ ...task })
}
