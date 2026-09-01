import assert from "node:assert/strict"
import test from "node:test"
import type {
  CapabilityId,
  OperationContext,
  OperationId,
  PartialEffectPosture,
} from "@interface-compiler/domain"
import {
  consumerToolDefinition,
  discoverCompiledCapabilities,
  prepareCompiledCapability,
  publishCompiledCapability,
  type ToolExample,
  type ToolPublicationPolicy,
  type WorthPublicationQuery,
  type ToolPublicationRequest,
  type ToolPublicationResult,
  type WorthDiscoveryQueryResult,
  type WorthPublicationQueryResult,
  type WorthToolCapabilityProjection,
  type ToolPublicationSink,
} from "../src/index.js"

const timestamp = "2026-08-31T12:00:00.000Z"
const policy: ToolPublicationPolicy = {
  namespace: "store",
  audience: "gemini_consumer",
  applicationScope: { kind: "all" },
  capabilityScope: { kind: "all" },
  maxDescriptionLength: 160,
  maxExamples: 2,
  additionalForbiddenTerms: [],
}

function id<T extends string>(value: string): T {
  return value as T
}

function context(cancelled = false): OperationContext {
  return {
    operationId: id<OperationId>("operation.tool-publisher.1"),
    deadlineAt: "2026-09-01T00:00:00.000Z",
    cancellation: {
      isCancellationRequested: () => cancelled,
      onCancellationRequested: () => () => undefined,
    },
    budget: { maxWallClockMs: 5000 },
  }
}

function projection(overrides: Record<string, unknown> = {}): WorthToolCapabilityProjection {
  const base: WorthToolCapabilityProjection = {
    projectionKind: "worth_tool_capability",
    capabilityId: id<CapabilityId>("capability.add-to-cart"),
    applicationId: id("application.store"),
    revision: 7,
    name: "AddToCart",
    description: "Add the selected product to the cart.",
    inputSchema: {
      type: "object",
      properties: { productRef: { type: "string" } },
      required: ["productRef"],
    },
    outputSchema: {
      type: "object",
      properties: { status: { type: "string" } },
      required: ["status"],
    },
    authorization: { kind: "authorized", audience: "gemini_consumer", disclosure: "semantic_only" },
    status: "healthy",
    activeReplay: {
      capabilityId: id<CapabilityId>("capability.add-to-cart"),
      replayVersionId: id("replay.add-to-cart.v3"),
      version: 3,
      revision: 12,
      status: "active",
    },
  }
  return { ...base, ...overrides } as WorthToolCapabilityProjection
}

function degradedProjection(): WorthToolCapabilityProjection {
  const withoutReplay: Record<string, unknown> = { ...projection() }
  withoutReplay.capabilityId = id<CapabilityId>("capability.degraded")
  delete withoutReplay.activeReplay
  return { ...withoutReplay, status: "degraded" } as WorthToolCapabilityProjection
}

function request(overrides: Partial<ToolPublicationRequest> = {}): ToolPublicationRequest {
  const examples: ToolExample[] = [{ label: "Selected product", input: { productRef: "sku-42" }, expectedOutput: { status: "added" } }]
  return {
    capabilityId: id<CapabilityId>("capability.add-to-cart"),
    examples,
    context: context(),
    observedAt: timestamp,
    ...overrides,
  }
}

function publicationQuery(result: WorthPublicationQueryResult): WorthPublicationQuery & { readonly readCount: () => number } {
  let reads = 0
  return {
    readCapabilityForTool: async () => {
      reads += 1
      return result
    },
    discoverCapabilitiesForTools: async () => ({ kind: "found", projections: [] }),
    readCount: () => reads,
  }
}

test("preparation derives stable identity and keeps source lineage out of the consumer definition", async () => {
  const source = projection()
  const query = publicationQuery({ kind: "found", projection: source })
  const result = await prepareCompiledCapability(query, policy, request())
  assert.equal(result.kind, "prepared")
  if (result.kind !== "prepared") throw new Error("expected prepared artifact")

  assert.equal(result.artifact.identity.toolId, "store.add_to_cart")
  assert.equal(result.artifact.identity.toolVersion, 3)
  assert.equal(result.artifact.identity.capabilityRevision, 7)
  assert.equal(result.artifact.identity.replayRevision, 12)
  assert.equal(result.artifact.definition.name, "store.add_to_cart")
  assert.equal(result.artifact.definition.examples.length, 1)

  const consumer = consumerToolDefinition(result.artifact)
  assert.equal(Object.prototype.hasOwnProperty.call(consumer, "replayVersionId"), false)
  assert.equal(Object.prototype.hasOwnProperty.call(consumer, "toolVersion"), false)
  assert.equal(JSON.stringify(consumer).includes("steps"), false)
  assert.equal(JSON.stringify(consumer).includes("selector"), false)
  assert.equal(Object.isFrozen(result.artifact), true)
  assert.equal(Object.isFrozen(result.artifact.definition.inputSchema), true)

  ;(source as { description: string }).description = "changed outside publisher"
  assert.equal(result.artifact.definition.description, "Add the selected product to the cart.")
  assert.equal(query.readCount(), 1)
})

test("delivery outcomes are reported from the sink and every request re-queries Worth", async () => {
  const query = publicationQuery({ kind: "found", projection: projection() })
  let deliveries = 0
  let publishedEnvelope: Record<string, unknown> | undefined
  const sink: ToolPublicationSink = {
    publish: async (envelope) => {
      publishedEnvelope = envelope as unknown as Record<string, unknown>
      deliveries += 1
      return deliveries === 1 ? { kind: "accepted", publishedVersion: 3 } : { kind: "already_current", currentVersion: 3 }
    },
  }

  const first = await publishCompiledCapability(query, sink, policy, request())
  const second = await publishCompiledCapability(query, sink, policy, request())
  assert.equal(first.kind, "published")
  assert.equal(second.kind, "already_current")
  assert.equal(query.readCount(), 2)
  assert.equal(deliveries, 2)
  assert.ok(publishedEnvelope !== undefined)
  if (publishedEnvelope !== undefined) {
    assert.equal("identity" in publishedEnvelope, true)
    assert.equal("definition" in publishedEnvelope, true)
    assert.equal("replayVersionId" in publishedEnvelope, false)
    const consumerDefinition = publishedEnvelope.definition as Record<string, unknown>
    assert.equal("replayVersionId" in consumerDefinition, false)
    assert.equal("toolVersion" in consumerDefinition, false)
  }
  assert.equal(first.telemetry?.outcome, "published")
  assert.equal(second.telemetry?.outcome, "already_current")
  if (first.telemetry !== undefined) {
    assert.equal("costUsd" in first.telemetry, false)
    assert.equal("durationMs" in first.telemetry, false)
  }
})

test("cancellation and uncertain delivery remain terminally typed", async () => {
  const cancelled = await publishCompiledCapability(
    publicationQuery({ kind: "found", projection: projection() }),
    { publish: async () => ({ kind: "accepted", publishedVersion: 3 }) },
    policy,
    request({ context: context(true) }),
  )
  assert.equal(cancelled.kind, "unavailable")
  if (cancelled.kind === "unavailable") assert.equal(cancelled.reason, "cancelled")

  const posture: PartialEffectPosture = { kind: "unknown", recovery: "owner_reconciliation_required" }
  const delivery = async (value: "cancelled" | "timed_out" | "failed"): Promise<ToolPublicationResult> => {
    const sink: ToolPublicationSink = {
      publish: async () => value === "failed"
        ? { kind: "failed", message: "provider unavailable", retryable: true, posture }
        : { kind: value, posture },
    }
    return publishCompiledCapability(publicationQuery({ kind: "found", projection: projection() }), sink, policy, request())
  }

  assert.equal((await delivery("cancelled")).kind, "delivery_cancelled")
  assert.equal((await delivery("timed_out")).kind, "delivery_timed_out")
  const failed = await delivery("failed")
  assert.equal(failed.kind, "delivery_failed")
  if (failed.kind === "delivery_failed") {
    assert.equal(failed.retryable, true)
    assert.deepEqual(failed.posture, posture)
    assert.equal(failed.telemetry.outcome, "delivery_failed")
  }
})

test("cancellation that arrives while Worth is queried prevents the publication effect", async () => {
  let cancelled = false
  let sinkCalls = 0
  const operationContext: OperationContext = {
    ...context(),
    cancellation: {
      isCancellationRequested: () => cancelled,
      onCancellationRequested: () => () => undefined,
    },
  }
  const query: WorthPublicationQuery = {
    readCapabilityForTool: async () => {
      cancelled = true
      return { kind: "found", projection: projection() }
    },
    discoverCapabilitiesForTools: async () => ({ kind: "found", projections: [] }),
  }
  const result = await publishCompiledCapability(query, {
    publish: async () => {
      sinkCalls += 1
      return { kind: "accepted", publishedVersion: 3 }
    },
  }, policy, request({ context: operationContext }))
  assert.equal(result.kind, "unavailable")
  if (result.kind === "unavailable") assert.equal(result.reason, "cancelled")
  assert.equal(sinkCalls, 0)
})

test("discovery returns only eligible semantic tools and withholds duplicate identities", async () => {
  const second = projection({
    capabilityId: id<CapabilityId>("capability.other"),
    name: "AddToCart",
    activeReplay: { capabilityId: id<CapabilityId>("capability.other"), replayVersionId: id("replay.other.v1"), version: 1, revision: 2, status: "active" },
  })
  const discovery: WorthDiscoveryQueryResult = { kind: "found", projections: [projection(), second, degradedProjection()] }
  const query: WorthPublicationQuery = {
    readCapabilityForTool: async () => ({ kind: "not_found", capabilityId: id<CapabilityId>("capability.unused") }),
    discoverCapabilitiesForTools: async () => discovery,
  }
  const result = await discoverCompiledCapabilities(query, policy, { context: context(), observedAt: timestamp })
  assert.equal(result.kind, "discovered")
  if (result.kind !== "discovered") throw new Error("expected discovery")
  assert.equal(result.tools.length, 0)
  assert.equal(result.withheld.length, 3)
  assert.equal(result.withheld.filter((item) => item.reason === "duplicate_tool_id").length, 2)
  assert.ok(result.withheld.some((item) => item.reason === "capability_not_healthy"))
  assert.deepEqual(result.telemetry, {
    artifactSchemaId: "interface-compiler.tool-publication",
    artifactSchemaVersion: 1,
    operationId: "operation.tool-publisher.1",
    observedAt: timestamp,
    outcome: "discovered",
    candidates: 3,
    available: 0,
    withheld: 3,
  })

  const reverseQuery: WorthPublicationQuery = {
    readCapabilityForTool: async () => ({ kind: "not_found", capabilityId: id<CapabilityId>("capability.unused") }),
    discoverCapabilitiesForTools: async () => ({ kind: "found", projections: [degradedProjection(), second, projection()] }),
  }
  const reversed = await discoverCompiledCapabilities(reverseQuery, policy, { context: context(), observedAt: timestamp })
  assert.equal(reversed.kind, "discovered")
  if (reversed.kind === "discovered") {
    assert.equal(reversed.tools.length, 0)
    assert.equal(reversed.withheld.filter((item) => item.reason === "duplicate_tool_id").length, 2)
  }
})
