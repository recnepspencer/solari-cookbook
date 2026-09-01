import { invalid, isNonNegativeFiniteNumber, isNonNegativeInteger, isRecord, issue, valid, type ValidationResult } from "./validation.js"

export interface CompilationMetricsInput {
  readonly explorationCostMicrocents: number
  readonly verificationCostMicrocents: number
  readonly directAverageCostMicrocents?: number
  readonly compiledAverageCostMicrocents?: number
}

export type BreakEvenCalls =
  | {
      readonly kind: "immediate"
      readonly calls: 0
      readonly savingsPerCallMicrocents: number
    }
  | {
      readonly kind: "finite"
      readonly calls: number
      readonly exactCalls: number
      readonly savingsPerCallMicrocents: number
    }
  | {
      readonly kind: "never"
      readonly reason: "compiled_not_cheaper"
      readonly savingsPerCallMicrocents: number
    }
  | {
      readonly kind: "unavailable"
      readonly reason: "break_even_exceeds_safe_integer_range" | "break_even_ratio_underflowed"
      readonly savingsPerCallMicrocents: number
    }

export interface CompilationMetrics {
  readonly explorationCostMicrocents: number
  readonly verificationCostMicrocents: number
  readonly totalCompilationCostMicrocents: number
  readonly directAverageCostMicrocents?: number
  readonly compiledAverageCostMicrocents?: number
  readonly breakEvenCalls?: BreakEvenCalls
}

export interface LifetimeEconomics {
  readonly executions: number
  readonly lifetimeDirectCostAvoidedMicrocents: number
  readonly lifetimeCompiledCostMicrocents: number
  readonly lifetimeNetSavingsMicrocents: number
}

export interface ModelPricingMicrocentsPerToken {
  readonly inputMicrocentsPerToken: number
  readonly outputMicrocentsPerToken: number
}

export interface ModelUsage {
  readonly inputTokens: number
  readonly outputTokens: number
}

/** One USD microcent is 1/100,000,000 USD, precise enough for Gemini Flash token prices. */
export const USD_MICROCENTS_PER_USD = 100_000_000

export function calculateCompilationCostMicrocents(
  explorationCostMicrocents: number,
  verificationCostMicrocents: number,
): ValidationResult<number> {
  const issues = validateCosts({ explorationCostMicrocents, verificationCostMicrocents })
  if (issues.length > 0) return invalid(...issues)
  const total = explorationCostMicrocents + verificationCostMicrocents
  return Number.isSafeInteger(total) ? valid(total) : invalid(issue("totalCompilationCostMicrocents", "compilation cost exceeded the safe integer range"))
}

export function calculateBreakEvenCalls(input: {
  readonly compileCostMicrocents: number
  readonly directCostPerCallMicrocents: number
  readonly compiledCostPerCallMicrocents: number
}): ValidationResult<BreakEvenCalls> {
  if (!isRecord(input)) return invalid(issue("input", "break-even input must be an object"))
  const issues = validateCosts(input)
  if (issues.length > 0) return invalid(...issues)

  const savingsPerCallMicrocents = input.directCostPerCallMicrocents - input.compiledCostPerCallMicrocents
  if (savingsPerCallMicrocents <= 0) {
    return valid({ kind: "never", reason: "compiled_not_cheaper", savingsPerCallMicrocents })
  }
  if (input.compileCostMicrocents === 0) {
    return valid({ kind: "immediate", calls: 0, savingsPerCallMicrocents })
  }

  const exactCalls = input.compileCostMicrocents / savingsPerCallMicrocents
  if (input.compileCostMicrocents > 0 && exactCalls === 0) {
    return valid({ kind: "unavailable", reason: "break_even_ratio_underflowed", savingsPerCallMicrocents })
  }
  const calls = Math.ceil(exactCalls)
  if (!Number.isFinite(exactCalls) || !Number.isSafeInteger(calls)) {
    return valid({ kind: "unavailable", reason: "break_even_exceeds_safe_integer_range", savingsPerCallMicrocents })
  }
  return valid({ kind: "finite", calls, exactCalls, savingsPerCallMicrocents })
}

export function calculateCompilationMetrics(input: CompilationMetricsInput): ValidationResult<CompilationMetrics> {
  if (!isRecord(input)) return invalid(issue("input", "compilation metrics input must be an object"))
  const compilationCost = calculateCompilationCostMicrocents(input.explorationCostMicrocents, input.verificationCostMicrocents)
  if (!compilationCost.ok) return compilationCost

  const issues = validateOptionalCost(input.directAverageCostMicrocents, "directAverageCostMicrocents")
  issues.push(...validateOptionalCost(input.compiledAverageCostMicrocents, "compiledAverageCostMicrocents"))
  if (issues.length > 0) return invalid(...issues)

  let breakEvenCalls: BreakEvenCalls | undefined
  if (input.directAverageCostMicrocents !== undefined && input.compiledAverageCostMicrocents !== undefined) {
    const breakEven = calculateBreakEvenCalls({
      compileCostMicrocents: compilationCost.value,
      directCostPerCallMicrocents: input.directAverageCostMicrocents,
      compiledCostPerCallMicrocents: input.compiledAverageCostMicrocents,
    })
    if (!breakEven.ok) return breakEven
    breakEvenCalls = breakEven.value
  }

  return valid(
    Object.freeze({
      ...input,
      totalCompilationCostMicrocents: compilationCost.value,
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
    explorationCostMicrocents: metrics.explorationCostMicrocents,
    verificationCostMicrocents: metrics.verificationCostMicrocents,
    directAverageCostMicrocents: metrics.directAverageCostMicrocents,
    compiledAverageCostMicrocents: metrics.compiledAverageCostMicrocents,
  })
  if (!recalculated.ok) return recalculated
  if (recalculated.value.totalCompilationCostMicrocents !== metrics.totalCompilationCostMicrocents) {
    return invalid(issue("totalCompilationCostMicrocents", "total compilation cost must equal its component costs"))
  }
  if (metrics.directAverageCostMicrocents !== undefined && metrics.compiledAverageCostMicrocents !== undefined) {
    if (!sameBreakEven(metrics.breakEvenCalls, recalculated.value.breakEvenCalls)) return invalid(issue("breakEvenCalls", "break-even result must equal its component costs"))
  } else if (metrics.breakEvenCalls !== undefined) {
    return invalid(issue("breakEvenCalls", "break-even requires both direct and compiled average costs"))
  }
  if (metrics.directAverageCostMicrocents === undefined) return invalid(issue("directAverageCostMicrocents", "direct average cost is required"))
  if (metrics.compiledAverageCostMicrocents === undefined) return invalid(issue("compiledAverageCostMicrocents", "compiled average cost is required"))

  const directCostAvoided = metrics.directAverageCostMicrocents * executions
  const compiledCost = metrics.totalCompilationCostMicrocents + metrics.compiledAverageCostMicrocents * executions
  const netSavings = directCostAvoided - compiledCost
  if (![directCostAvoided, compiledCost, netSavings].every(Number.isSafeInteger)) {
    return invalid(issue("lifetime", "lifetime economics exceeded the safe integer range"))
  }

  return valid(
    Object.freeze({
      executions,
      lifetimeDirectCostAvoidedMicrocents: directCostAvoided,
      lifetimeCompiledCostMicrocents: compiledCost,
      lifetimeNetSavingsMicrocents: netSavings,
    }),
  )
}

export function calculateModelCostMicrocents(
  usage: ModelUsage,
  pricing: ModelPricingMicrocentsPerToken,
): ValidationResult<number> {
  if (!isRecord(usage)) return invalid(issue("usage", "model usage must be an object"))
  if (!isRecord(pricing)) return invalid(issue("pricing", "model pricing must be an object"))
  const tokenIssues = [
    ...(isNonNegativeInteger(usage.inputTokens) ? [] : [issue("inputTokens", "input tokens must be a non-negative safe integer")]),
    ...(isNonNegativeInteger(usage.outputTokens) ? [] : [issue("outputTokens", "output tokens must be a non-negative safe integer")]),
  ]
  const pricingIssues = validateCosts({
    inputMicrocentsPerToken: pricing.inputMicrocentsPerToken,
    outputMicrocentsPerToken: pricing.outputMicrocentsPerToken,
  })
  if (tokenIssues.length > 0 || pricingIssues.length > 0) return invalid(...tokenIssues, ...pricingIssues)

  const cost = BigInt(usage.inputTokens) * BigInt(pricing.inputMicrocentsPerToken) + BigInt(usage.outputTokens) * BigInt(pricing.outputMicrocentsPerToken)
  if (cost > BigInt(Number.MAX_SAFE_INTEGER)) return invalid(issue("estimatedModelCostMicrocents", "model cost exceeded the safe integer range"))
  return valid(Number(cost))
}

function validateCosts(input: unknown): ReturnType<typeof issue>[] {
  if (!isRecord(input)) return [issue("input", "cost input must be an object")]
  return Object.entries(input).flatMap(([field, value]) =>
    value === undefined ? [] : isNonNegativeInteger(value) ? [] : [issue(field, "cost must be a non-negative safe integer")],
  )
}

function validateOptionalCost(value: number | undefined, field: string): ReturnType<typeof issue>[] {
  return value === undefined || isNonNegativeInteger(value) ? [] : [issue(field, "cost must be a non-negative safe integer")]
}

function sameBreakEven(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return left === right
  if (!isRecord(left) || !isRecord(right)) return false
  if (left.kind !== right.kind || left.savingsPerCallMicrocents !== right.savingsPerCallMicrocents) return false
  if (typeof left.savingsPerCallMicrocents !== "number" || !Number.isSafeInteger(left.savingsPerCallMicrocents)) return false
  switch (left.kind) {
    case "immediate":
      return right.kind === "immediate" && left.calls === 0 && right.calls === 0 && left.savingsPerCallMicrocents > 0
    case "finite":
      return right.kind === "finite" &&
        isNonNegativeInteger(left.calls) && left.calls > 0 &&
        isNonNegativeFiniteNumber(left.exactCalls) && left.exactCalls > 0 &&
        right.calls === left.calls && right.exactCalls === left.exactCalls && left.savingsPerCallMicrocents > 0
    case "never":
      return right.kind === "never" && left.reason === "compiled_not_cheaper" && right.reason === "compiled_not_cheaper" && left.savingsPerCallMicrocents <= 0
    case "unavailable":
      return right.kind === "unavailable" &&
        (left.reason === "break_even_exceeds_safe_integer_range" || left.reason === "break_even_ratio_underflowed") &&
        right.reason === left.reason && left.savingsPerCallMicrocents > 0
    default:
      return false
  }
}
