import {
  calculateModelCostMicrocents,
  isJsonValue,
  validateJsonSchema,
  validateOperationContext,
  type Clock,
  type JsonSchema,
  type ModelPricingMicrocentsPerToken,
  type OperationContext,
  type PartialEffectPosture,
  type ReasoningModel,
  type ReasoningResult,
  type ReasoningUsage,
  type Schema,
} from "@interface-compiler/domain"
import type { GeminiTransport, GeminiTransportResult, GeminiUsageMetadata } from "./transport.js"

export interface GeminiReasoningModelOptions {
  readonly model: string
  readonly pricing: ModelPricingMicrocentsPerToken
  readonly transport: GeminiTransport
  readonly clock: Clock
}

export type GeminiReasoningUsage = ReasoningUsage & { readonly thoughtsTokens: number }

/** Provider adapter that turns one structured Gemini response into a domain result. */
export class GeminiReasoningModel implements ReasoningModel {
  private readonly model: string
  private readonly pricing: ModelPricingMicrocentsPerToken
  private readonly transport: GeminiTransport
  private readonly clock: Clock

  public constructor(options: GeminiReasoningModelOptions) {
    this.model = options.model
    this.pricing = options.pricing
    this.transport = options.transport
    this.clock = options.clock
  }

  public async structuredComplete<TInput, TOutput>(
    input: TInput,
    schema: Schema<TOutput>,
    context: OperationContext,
  ): Promise<ReasoningResult<TOutput>> {
    const contextIssues = validateOperationContext(context)
    if (contextIssues.length > 0) return failed("operation context is invalid", false)

    const preflight = this.preflight(context, schema)
    if (preflight !== undefined) return preflight

    const prompt = serializeInput(input)
    if (prompt === undefined) return failed("reasoning input must be JSON-serializable", false)

    const request = createRequestController(context, this.clock)
    const removeCancellationListener = context.cancellation.onCancellationRequested(() => request.controller.abort("cancelled"))

    try {
      if (request.controller.signal.aborted) {
        return request.controller.signal.reason === "timed_out"
          ? { kind: "timed_out", effect: { kind: "not_started" } }
          : { kind: "cancelled", effect: { kind: "not_started" } }
      }
      const result = await this.transport.generateStructured({
        model: this.model,
        prompt,
        responseJsonSchema: schema.json,
        abortSignal: request.controller.signal,
      })
      return this.mapTransportResult(result, schema, request.controller.signal)
    } catch {
      if (request.controller.signal.aborted) {
        return request.controller.signal.reason === "timed_out"
          ? { kind: "timed_out", effect: { kind: "unknown", recovery: "owner_reconciliation_required" } }
          : { kind: "cancelled", effect: { kind: "unknown", recovery: "owner_reconciliation_required" } }
      }
      return failed("Gemini transport failed before returning a result", true, undefined, unknownEffect())
    } finally {
      removeCancellationListener()
      request.dispose()
    }
  }

  private preflight<TOutput>(context: OperationContext, schema: Schema<TOutput>): ReasoningResult<TOutput> | undefined {
    if (context.cancellation.isCancellationRequested()) return { kind: "cancelled", effect: { kind: "not_started" } }
    if (isDeadlineExceeded(this.clock, context.deadlineAt)) return { kind: "timed_out", effect: { kind: "not_started" } }
    if (context.budget.maxModelCalls === 0) return { kind: "denied", reason: "budget_exhausted", effect: { kind: "not_started" } }
    if (validateJsonSchema(schema.json).length > 0) return { kind: "denied", reason: "schema_not_supported", effect: { kind: "not_started" } }
    return undefined
  }

  private mapTransportResult<TOutput>(
    result: GeminiTransportResult,
    schema: Schema<TOutput>,
    signal: AbortSignal,
  ): ReasoningResult<TOutput> {
    const usage = result.usage === undefined ? undefined : this.toReasoningUsage(result.usage)
    if (result.kind === "cancelled") return { kind: "cancelled", ...(usage === undefined ? {} : { usage }), effect: { kind: "unknown", recovery: "owner_reconciliation_required" } }
    if (result.kind === "timed_out") return { kind: "timed_out", ...(usage === undefined ? {} : { usage }), effect: { kind: "unknown", recovery: "owner_reconciliation_required" } }
    if (result.kind === "failed") return { kind: "failed", message: result.message, retryable: result.retryable, ...(usage === undefined ? {} : { usage }), effect: { kind: "unknown", recovery: "owner_reconciliation_required" } }
    if (signal.aborted) {
      return signal.reason === "timed_out"
        ? { kind: "timed_out", ...(usage === undefined ? {} : { usage }), effect: { kind: "unknown", recovery: "owner_reconciliation_required" } }
        : { kind: "cancelled", ...(usage === undefined ? {} : { usage }), effect: { kind: "unknown", recovery: "owner_reconciliation_required" } }
    }
    if (usage === undefined) return failed("Gemini response did not include usable token metadata", true, undefined, unknownEffect())

    let parsed: unknown
    try {
      parsed = JSON.parse(result.text) as unknown
    } catch {
      return failed("Gemini response was not valid JSON", false, usage, unknownEffect())
    }
    if (!isJsonValue(parsed) || !matchesJsonSchema(parsed, schema.json)) {
      return failed("Gemini response did not match the requested JSON schema", false, usage, unknownEffect())
    }
    return { kind: "completed", completion: { output: parsed as TOutput, usage }, effect: { kind: "completed" } }
  }

  private toReasoningUsage(metadata: GeminiUsageMetadata): GeminiReasoningUsage | undefined {
    const inputTokens = metadata.promptTokenCount
    const candidateTokens = metadata.candidatesTokenCount
    const thoughtsTokens = metadata.thoughtsTokenCount ?? 0
    if (!isSafeTokenCount(inputTokens) || !isSafeTokenCount(candidateTokens) || !isSafeTokenCount(thoughtsTokens)) return undefined
    if (!Number.isSafeInteger(candidateTokens + thoughtsTokens)) return undefined
    const cost = calculateModelCostMicrocents({ inputTokens, outputTokens: candidateTokens + thoughtsTokens }, this.pricing)
    if (!cost.ok) return undefined
    return { inputTokens, outputTokens: candidateTokens, thoughtsTokens, estimatedModelCostMicrocents: cost.value }
  }
}

function failed<TOutput>(
  message: string,
  retryable: boolean,
  usage?: ReasoningUsage,
  effect: PartialEffectPosture = { kind: "not_started" },
): ReasoningResult<TOutput> {
  return { kind: "failed", message, retryable, ...(usage === undefined ? {} : { usage }), effect }
}

function unknownEffect(): { readonly kind: "unknown"; readonly recovery: "owner_reconciliation_required" } {
  return { kind: "unknown", recovery: "owner_reconciliation_required" }
}

function isDeadlineExceeded(clock: Clock, deadlineAt: string): boolean {
  let now: number
  try {
    now = Date.parse(clock.now())
  } catch {
    return true
  }
  const deadline = Date.parse(deadlineAt)
  return !Number.isFinite(now) || !Number.isFinite(deadline) || now >= deadline
}

function serializeInput(input: unknown): string | undefined {
  if (typeof input === "string") return input
  if (!isJsonValue(input)) return undefined
  return stableJsonStringify(input)
}

function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((entry) => stableJsonStringify(entry)).join(",")}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJsonStringify(entry)}`)
  return `{${entries.join(",")}}`
}

function createRequestController(context: OperationContext, clock: Clock): { readonly controller: AbortController; readonly dispose: () => void } {
  const controller = new AbortController()
  let now = Number.NaN
  try {
    now = Date.parse(clock.now())
  } catch {
    // An invalid provider clock is handled as an expired boundary.
  }
  const deadlineAt = Date.parse(context.deadlineAt)
  const wallClockDeadlineAt = now + context.budget.maxWallClockMs
  const remaining = Math.min(deadlineAt, wallClockDeadlineAt) - now
  let disposed = false
  let remainingDelay = remaining
  let timeout: ReturnType<typeof setTimeout> | undefined
  const armTimeout = (): void => {
    if (disposed || controller.signal.aborted) return
    const delay = Math.min(remainingDelay, 2_147_483_647)
    timeout = setTimeout(() => {
      timeout = undefined
      remainingDelay -= delay
      if (remainingDelay <= 0) controller.abort("timed_out")
      else armTimeout()
    }, delay)
  }
  if (!Number.isFinite(remaining) || remaining <= 0) controller.abort("timed_out")
  else armTimeout()
  return {
    controller,
    dispose: () => {
      disposed = true
      if (timeout !== undefined) clearTimeout(timeout)
    },
  }
}

function isSafeTokenCount(value: number | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function matchesJsonSchema(value: unknown, schema: JsonSchema): boolean {
  if (schema.enum !== undefined && !schema.enum.some((candidate) => stableJsonStringify(candidate) === stableJsonStringify(value))) return false
  if (schema.const !== undefined && stableJsonStringify(schema.const) !== stableJsonStringify(value)) return false
  switch (schema.type) {
    case undefined:
      return true
    case "string":
      if (typeof value !== "string") return false
      if (schema.minLength !== undefined && value.length < schema.minLength) return false
      if (schema.maxLength !== undefined && value.length > schema.maxLength) return false
      if (schema.pattern === undefined) return true
      try {
        return new RegExp(schema.pattern).test(value)
      } catch {
        return false
      }
    case "number":
      return typeof value === "number" && Number.isFinite(value) &&
        (schema.minimum === undefined || value >= schema.minimum) &&
        (schema.maximum === undefined || value <= schema.maximum)
    case "integer":
      return typeof value === "number" && Number.isSafeInteger(value) &&
        (schema.minimum === undefined || value >= schema.minimum) &&
        (schema.maximum === undefined || value <= schema.maximum)
    case "boolean":
      return typeof value === "boolean"
    case "null":
      return value === null
    case "array":
      return Array.isArray(value) &&
        (schema.minItems === undefined || value.length >= schema.minItems) &&
        (schema.maxItems === undefined || value.length <= schema.maxItems) &&
        (schema.items === undefined || value.every((entry) => matchesJsonSchema(entry, schema.items as JsonSchema)))
    case "object":
      return matchesObjectSchema(value, schema)
  }
}

function matchesObjectSchema(value: unknown, schema: Extract<JsonSchema, { readonly type: "object" }>): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const object = value as Record<string, unknown>
  if (schema.required?.some((key) => !Object.prototype.hasOwnProperty.call(object, key))) return false
  const properties = schema.properties ?? {}
  for (const [key, propertyValue] of Object.entries(object)) {
    const propertySchema = properties[key]
    if (propertySchema !== undefined && !matchesJsonSchema(propertyValue, propertySchema)) return false
    if (propertySchema === undefined && schema.additionalProperties === false) return false
    if (propertySchema === undefined && schema.additionalProperties !== undefined && schema.additionalProperties !== true &&
      schema.additionalProperties !== false && !matchesJsonSchema(propertyValue, schema.additionalProperties)) return false
  }
  return true
}
