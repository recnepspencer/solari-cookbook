import { invalid, isNonNegativeFiniteNumber, isNonNegativeInteger, isRecord, issue, valid, type ValidationResult } from "./validation.js"

export interface CompilationMetricsInput {
  readonly explorationCostUsd: number
  readonly verificationCostUsd: number
  readonly directAverageCostUsd?: number
  readonly compiledAverageCostUsd?: number
}

export type BreakEvenCalls =
  | {
      readonly kind: "immediate"
      readonly calls: 0
      readonly savingsPerCallUsd: number
    }
  | {
      readonly kind: "finite"
      readonly calls: number
      readonly exactCalls: number
      readonly savingsPerCallUsd: number
    }
  | {
      readonly kind: "never"
      readonly reason: "compiled_not_cheaper"
      readonly savingsPerCallUsd: number
    }
  | {
      readonly kind: "unavailable"
      readonly reason: "break_even_exceeds_safe_integer_range"
      readonly savingsPerCallUsd: number
    }

export interface CompilationMetrics {
  readonly explorationCostUsd: number
  readonly verificationCostUsd: number
  readonly totalCompilationCostUsd: number
  readonly directAverageCostUsd?: number
  readonly compiledAverageCostUsd?: number
  readonly breakEvenCalls?: BreakEvenCalls
}

export interface LifetimeEconomics {
  readonly executions: number
  readonly lifetimeDirectCostAvoidedUsd: number
  readonly lifetimeCompiledCostUsd: number
  readonly lifetimeNetSavingsUsd: number
}

export interface ModelPricingUsdPerToken {
  readonly inputUsdPerToken: number
  readonly outputUsdPerToken: number
}

export interface ModelUsage {
  readonly inputTokens: number
  readonly outputTokens: number
}

export function calculateCompilationCostUsd(
  explorationCostUsd: number,
  verificationCostUsd: number,
): ValidationResult<number> {
  const issues = validateCosts({ explorationCostUsd, verificationCostUsd })
  if (issues.length > 0) return invalid(...issues)
  const total = explorationCostUsd + verificationCostUsd
  return Number.isFinite(total) ? valid(total) : invalid(issue("totalCompilationCostUsd", "compilation cost overflowed the finite number range"))
}

export function calculateBreakEvenCalls(input: {
  readonly compileCostUsd: number
  readonly directCostPerCallUsd: number
  readonly compiledCostPerCallUsd: number
}): ValidationResult<BreakEvenCalls> {
  if (!isRecord(input)) return invalid(issue("input", "break-even input must be an object"))
  const issues = validateCosts(input)
  if (issues.length > 0) return invalid(...issues)

  const savingsPerCallUsd = input.directCostPerCallUsd - input.compiledCostPerCallUsd
  if (savingsPerCallUsd <= 0) {
    return valid({ kind: "never", reason: "compiled_not_cheaper", savingsPerCallUsd })
  }
  if (input.compileCostUsd === 0) {
    return valid({ kind: "immediate", calls: 0, savingsPerCallUsd })
  }

  const exactCalls = input.compileCostUsd / savingsPerCallUsd
  const calls = Math.ceil(exactCalls)
  if (!Number.isFinite(exactCalls) || !Number.isSafeInteger(calls)) {
    return valid({ kind: "unavailable", reason: "break_even_exceeds_safe_integer_range", savingsPerCallUsd })
  }
  return valid({ kind: "finite", calls, exactCalls, savingsPerCallUsd })
}

export function calculateCompilationMetrics(input: CompilationMetricsInput): ValidationResult<CompilationMetrics> {
  if (!isRecord(input)) return invalid(issue("input", "compilation metrics input must be an object"))
  const compilationCost = calculateCompilationCostUsd(input.explorationCostUsd, input.verificationCostUsd)
  if (!compilationCost.ok) return compilationCost

  const issues = validateOptionalCost(input.directAverageCostUsd, "directAverageCostUsd")
  issues.push(...validateOptionalCost(input.compiledAverageCostUsd, "compiledAverageCostUsd"))
  if (issues.length > 0) return invalid(...issues)

  let breakEvenCalls: BreakEvenCalls | undefined
  if (input.directAverageCostUsd !== undefined && input.compiledAverageCostUsd !== undefined) {
    const breakEven = calculateBreakEvenCalls({
      compileCostUsd: compilationCost.value,
      directCostPerCallUsd: input.directAverageCostUsd,
      compiledCostPerCallUsd: input.compiledAverageCostUsd,
    })
    if (!breakEven.ok) return breakEven
    breakEvenCalls = breakEven.value
  }

  return valid(
    Object.freeze({
      ...input,
      totalCompilationCostUsd: compilationCost.value,
      ...(breakEvenCalls === undefined ? {} : { breakEvenCalls }),
    }),
  )
}

export function calculateLifetimeEconomics(
  metrics: CompilationMetrics,
  executions: number,
): ValidationResult<LifetimeEconomics> {
  if (!isRecord(metrics)) return invalid(issue("metrics", "compilation metrics must be an object"))
  if (!isNonNegativeInteger(executions)) return invalid(issue("executions", "executions must be a non-negative safe integer"))
  const recalculated = calculateCompilationMetrics({
    explorationCostUsd: metrics.explorationCostUsd,
    verificationCostUsd: metrics.verificationCostUsd,
    directAverageCostUsd: metrics.directAverageCostUsd,
    compiledAverageCostUsd: metrics.compiledAverageCostUsd,
  })
  if (!recalculated.ok) return recalculated
  if (recalculated.value.totalCompilationCostUsd !== metrics.totalCompilationCostUsd) {
    return invalid(issue("totalCompilationCostUsd", "total compilation cost must equal its component costs"))
  }
  if (metrics.directAverageCostUsd === undefined) return invalid(issue("directAverageCostUsd", "direct average cost is required"))
  if (metrics.compiledAverageCostUsd === undefined) return invalid(issue("compiledAverageCostUsd", "compiled average cost is required"))

  const directCostAvoided = metrics.directAverageCostUsd * executions
  const compiledCost = metrics.totalCompilationCostUsd + metrics.compiledAverageCostUsd * executions
  const netSavings = directCostAvoided - compiledCost
  if (![directCostAvoided, compiledCost, netSavings].every(Number.isFinite)) {
    return invalid(issue("lifetime", "lifetime economics overflowed the finite number range"))
  }

  return valid(
    Object.freeze({
      executions,
      lifetimeDirectCostAvoidedUsd: directCostAvoided,
      lifetimeCompiledCostUsd: compiledCost,
      lifetimeNetSavingsUsd: netSavings,
    }),
  )
}

export function calculateModelCostUsd(
  usage: ModelUsage,
  pricing: ModelPricingUsdPerToken,
): ValidationResult<number> {
  if (!isRecord(usage)) return invalid(issue("usage", "model usage must be an object"))
  if (!isRecord(pricing)) return invalid(issue("pricing", "model pricing must be an object"))
  const tokenIssues = [
    ...(isNonNegativeInteger(usage.inputTokens) ? [] : [issue("inputTokens", "input tokens must be a non-negative safe integer")]),
    ...(isNonNegativeInteger(usage.outputTokens) ? [] : [issue("outputTokens", "output tokens must be a non-negative safe integer")]),
  ]
  const pricingIssues = validateCosts({
    inputUsdPerToken: pricing.inputUsdPerToken,
    outputUsdPerToken: pricing.outputUsdPerToken,
  })
  if (tokenIssues.length > 0 || pricingIssues.length > 0) return invalid(...tokenIssues, ...pricingIssues)

  const cost = usage.inputTokens * pricing.inputUsdPerToken + usage.outputTokens * pricing.outputUsdPerToken
  return Number.isFinite(cost) ? valid(cost) : invalid(issue("estimatedModelCostUsd", "model cost overflowed the finite number range"))
}

function validateCosts(input: unknown): ReturnType<typeof issue>[] {
  if (!isRecord(input)) return [issue("input", "cost input must be an object")]
  return Object.entries(input).flatMap(([field, value]) =>
    value === undefined ? [] : isNonNegativeFiniteNumber(value) ? [] : [issue(field, "cost must be a finite non-negative number")],
  )
}

function validateOptionalCost(value: number | undefined, field: string): ReturnType<typeof issue>[] {
  return value === undefined || isNonNegativeFiniteNumber(value) ? [] : [issue(field, "cost must be a finite non-negative number")]
}
