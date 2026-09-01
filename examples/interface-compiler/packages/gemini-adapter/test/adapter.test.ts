import assert from "node:assert/strict"
import test from "node:test"
import {
  createSchema,
  type CancellationToken,
  type Clock,
  type ModelPricingUsdPerToken,
  type OperationContext,
  type Schema,
  type ValidationResult,
} from "@interface-compiler/domain"
import {
  createGeminiReasoningModelFromEnvironment,
  GeminiReasoningModel,
  GoogleGenAiTransport,
  type GeminiGenerateRequest,
  type GeminiReasoningUsage,
  type GeminiTransport,
  type GeminiTransportResult,
} from "../src/index.js"
import { inspectGeminiEnvironment } from "../src/config.js"
import type { GoogleGenAI } from "@google/genai"

const now = "2026-08-31T12:00:00.000Z"
const pricing: ModelPricingUsdPerToken = { inputUsdPerToken: 0.001, outputUsdPerToken: 0.002 }

function unwrap<T>(result: ValidationResult<T>): T {
  if (!result.ok) throw new Error(result.issues.map((entry) => `${entry.path}: ${entry.message}`).join(", "))
  return result.value
}

function responseSchema(): Schema<{ readonly answer: string }> {
  return unwrap(createSchema({
    name: "answer",
    json: {
      type: "object",
      additionalProperties: false,
      required: ["answer"],
      properties: { answer: { type: "string", minLength: 1 } },
    },
  }))
}

function context(options: { readonly cancellation?: TestCancellation; readonly deadlineAt?: string; readonly maxWallClockMs?: number; readonly maxModelCalls?: number } = {}): OperationContext {
  return {
    operationId: "operation.test" as OperationContext["operationId"],
    deadlineAt: options.deadlineAt ?? "2026-08-31T12:01:00.000Z",
    cancellation: options.cancellation?.token ?? new TestCancellation().token,
    budget: { maxWallClockMs: options.maxWallClockMs ?? 60_000, ...(options.maxModelCalls === undefined ? {} : { maxModelCalls: options.maxModelCalls }) },
    admission: { maxInFlight: 1, maxQueued: 0, overflow: "reject" },
  }
}

const clock: Clock = { now: () => now }

class TestCancellation {
  private requested = false
  private readonly listeners = new Set<() => void>()
  public readonly token: CancellationToken = {
    isCancellationRequested: () => this.requested,
    onCancellationRequested: (listener) => {
      if (this.requested) listener()
      else this.listeners.add(listener)
      return () => this.listeners.delete(listener)
    },
  }

  public cancel(): void {
    this.requested = true
    for (const listener of [...this.listeners]) listener()
  }
}

class FakeTransport implements GeminiTransport {
  public readonly requests: GeminiGenerateRequest[] = []
  public constructor(private readonly result: GeminiTransportResult | ((request: GeminiGenerateRequest) => Promise<GeminiTransportResult>)) {}

  public async generateStructured(request: GeminiGenerateRequest): Promise<GeminiTransportResult> {
    this.requests.push(request)
    return typeof this.result === "function" ? this.result(request) : this.result
  }
}

function model(transport: GeminiTransport): GeminiReasoningModel {
  return new GeminiReasoningModel({ model: "test-model", pricing, transport, clock })
}

test("maps official-shaped usage metadata to typed output and an explicit estimate", async () => {
  const transport = new FakeTransport({
    kind: "completed",
    text: '{"answer":"ready"}',
    usage: { promptTokenCount: 3, candidatesTokenCount: 4, thoughtsTokenCount: 1 },
  })

  const result = await model(transport).structuredComplete({ z: 1, a: "two" }, responseSchema(), context())

  assert.equal(result.kind, "completed")
  if (result.kind !== "completed") throw new Error("expected completion")
  assert.deepEqual(result.completion.output, { answer: "ready" })
  assert.equal(result.completion.usage.inputTokens, 3)
  assert.equal(result.completion.usage.outputTokens, 4)
  assert.equal((result.completion.usage as GeminiReasoningUsage).thoughtsTokens, 1)
  assert.ok(Math.abs(result.completion.usage.estimatedModelCostUsd - 0.013) < Number.EPSILON)
  assert.equal(transport.requests.length, 1)
  assert.equal(transport.requests[0]?.model, "test-model")
  assert.equal(transport.requests[0]?.prompt, '{"a":"two","z":1}')
  assert.equal(transport.requests[0]?.responseJsonSchema.type, "object")
  assert.equal(transport.requests[0]?.abortSignal.aborted, false)
})

test("rejects malformed or schema-mismatched provider output without claiming completion", async () => {
  const malformed = await model(new FakeTransport({
    kind: "completed",
    text: "not-json",
    usage: { promptTokenCount: 1, candidatesTokenCount: 1 },
  })).structuredComplete("input", responseSchema(), context())
  assert.deepEqual(malformed, { kind: "failed", message: "Gemini response was not valid JSON", retryable: false, usage: { inputTokens: 1, outputTokens: 1, thoughtsTokens: 0, estimatedModelCostUsd: 0.003 }, effect: { kind: "unknown", recovery: "owner_reconciliation_required" } })

  const mismatched = await model(new FakeTransport({
    kind: "completed",
    text: '{"answer":3}',
    usage: { promptTokenCount: 1, candidatesTokenCount: 1 },
  })).structuredComplete("input", responseSchema(), context())
  assert.equal(mismatched.kind, "failed")
  if (mismatched.kind !== "failed") throw new Error("expected schema failure")
  assert.equal(mismatched.message, "Gemini response did not match the requested JSON schema")
})

test("does not call the transport after cancellation, deadline, or a zero model budget", async () => {
  const cancelledTransport = new FakeTransport({ kind: "completed", text: '{"answer":"unexpected"}', usage: { promptTokenCount: 1, candidatesTokenCount: 1 } })
  const cancelled = new TestCancellation()
  cancelled.cancel()
  assert.deepEqual(await model(cancelledTransport).structuredComplete("input", responseSchema(), context({ cancellation: cancelled })), { kind: "cancelled", effect: { kind: "not_started" } })
  assert.equal(cancelledTransport.requests.length, 0)

  const timedOutTransport = new FakeTransport({ kind: "completed", text: '{"answer":"unexpected"}', usage: { promptTokenCount: 1, candidatesTokenCount: 1 } })
  assert.deepEqual(await model(timedOutTransport).structuredComplete("input", responseSchema(), context({ deadlineAt: "2026-08-31T11:59:00.000Z" })), { kind: "timed_out", effect: { kind: "not_started" } })
  assert.equal(timedOutTransport.requests.length, 0)

  const budgetTransport = new FakeTransport({ kind: "completed", text: '{"answer":"unexpected"}', usage: { promptTokenCount: 1, candidatesTokenCount: 1 } })
  assert.deepEqual(await model(budgetTransport).structuredComplete("input", responseSchema(), context({ maxModelCalls: 0 })), { kind: "denied", reason: "budget_exhausted", effect: { kind: "not_started" } })
  assert.equal(budgetTransport.requests.length, 0)
})

test("propagates cancellation to an in-flight transport and preserves an explicit partial usage result", async () => {
  const cancellation = new TestCancellation()
  const transport = new FakeTransport((request) => new Promise<GeminiTransportResult>((resolve) => {
    request.abortSignal.addEventListener("abort", () => resolve({
      kind: "cancelled",
      usage: { promptTokenCount: 2, candidatesTokenCount: 0 },
    }), { once: true })
  }))
  const pending = model(transport).structuredComplete("input", responseSchema(), context({ cancellation }))
  cancellation.cancel()
  assert.deepEqual(await pending, { kind: "cancelled", usage: { inputTokens: 2, outputTokens: 0, thoughtsTokens: 0, estimatedModelCostUsd: 0.002 }, effect: { kind: "unknown", recovery: "owner_reconciliation_required" } })
  assert.equal(transport.requests.length, 1)
})

test("enforces the admitted wall-clock budget during an in-flight request", async () => {
  const transport = new FakeTransport((request) => new Promise<GeminiTransportResult>((resolve) => {
    request.abortSignal.addEventListener("abort", () => resolve({ kind: "timed_out" }), { once: true })
  }))
  const result = await model(transport).structuredComplete("input", responseSchema(), context({ maxWallClockMs: 10 }))
  assert.deepEqual(result, { kind: "timed_out", effect: { kind: "unknown", recovery: "owner_reconciliation_required" } })
  assert.equal(transport.requests.length, 1)
})

test("requires environment credentials and model selection without making a request", () => {
  assert.deepEqual(inspectGeminiEnvironment({}), { kind: "missing_api_key" })
  assert.deepEqual(inspectGeminiEnvironment({ GEMINI_API_KEY: 42 as unknown as string, GEMINI_MODEL: "gemini-test" }), { kind: "missing_api_key" })
  assert.deepEqual(inspectGeminiEnvironment({ GEMINI_API_KEY: "test-key" }), { kind: "missing_model" })
  assert.deepEqual(inspectGeminiEnvironment({ GEMINI_API_KEY: "test-key", GEMINI_MODEL: "gemini-test" }), { kind: "configured", model: "gemini-test" })
  const previousKey = process.env.GEMINI_API_KEY
  const previousModel = process.env.GEMINI_MODEL
  try {
    delete process.env.GEMINI_API_KEY
    delete process.env.GEMINI_MODEL
    assert.equal(createGeminiReasoningModelFromEnvironment({ pricing, clock }).kind, "missing_api_key")
  } finally {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = previousKey
    if (previousModel === undefined) delete process.env.GEMINI_MODEL
    else process.env.GEMINI_MODEL = previousModel
  }
})

test("does not fabricate a cost when provider usage metadata is absent", async () => {
  const result = await model(new FakeTransport({ kind: "completed", text: '{"answer":"ready"}', usage: {} })).structuredComplete("input", responseSchema(), context())
  assert.deepEqual(result, { kind: "failed", message: "Gemini response did not include usable token metadata", retryable: true, effect: { kind: "unknown", recovery: "owner_reconciliation_required" } })
})

test("maps the maintained SDK request shape without making a network request", async () => {
  let received: unknown
  const client = {
    models: {
      generateContent: async (parameters: unknown) => {
        received = parameters
        return { text: '{"answer":"ready"}', usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2 } }
      },
    },
  } as unknown as GoogleGenAI
  const schema = responseSchema()
  const abortSignal = new AbortController().signal
  const result = await new GoogleGenAiTransport(client).generateStructured({
    model: "gemini-test",
    prompt: "input",
    responseJsonSchema: schema.json,
    abortSignal,
  })

  assert.deepEqual(result, { kind: "completed", text: '{"answer":"ready"}', usage: { promptTokenCount: 1, candidatesTokenCount: 2 } })
  assert.deepEqual(received, {
    model: "gemini-test",
    contents: "input",
    config: { responseMimeType: "application/json", responseJsonSchema: schema.json, abortSignal },
  })
})
