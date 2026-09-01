import assert from "node:assert/strict"
import test from "node:test"
import type { CapabilityId, JsonSchema, OperationId } from "@interface-compiler/domain"
import {
  buildToolPublicationArtifact,
  createToolId,
  evaluatePublicationGate,
  prepareCompiledCapability,
  publishCompiledCapability,
  validateToolPublicationArtifact,
  validateToolPublicationPolicy,
  validateWorthToolCapabilityProjection,
  discoverCompiledCapabilities,
  type GeminiToolDefinition,
  type ToolPublicationArtifact,
  type ToolPublicationPolicy,
  type WorthPublicationQuery,
  type ToolPublicationRequest,
  type WorthPublicationQueryResult,
  type WorthToolCapabilityProjection,
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

function projection(overrides: Record<string, unknown> = {}): WorthToolCapabilityProjection {
  const value: WorthToolCapabilityProjection = {
    projectionKind: "worth_tool_capability",
    capabilityId: id<CapabilityId>("capability.add-to-cart"),
    applicationId: id("application.store"),
    revision: 7,
    name: "AddToCart",
    description: "Add the selected product to the cart.",
    inputSchema: { type: "object", properties: { productRef: { type: "string" } } },
    outputSchema: { type: "object", properties: { status: { type: "string" } } },
    authorization: { kind: "authorized", audience: "gemini_consumer", disclosure: "semantic_only" },
    status: "healthy",
    activeReplay: { capabilityId: id<CapabilityId>("capability.add-to-cart"), replayVersionId: id("replay.add-to-cart.v1"), version: 1, revision: 4, status: "active" },
  }
  return { ...value, ...overrides } as WorthToolCapabilityProjection
}

function context(): ToolPublicationRequest["context"] {
  return {
    operationId: id<OperationId>("operation.tool-publisher.adversarial"),
    deadlineAt: "2026-09-01T00:00:00.000Z",
    cancellation: { isCancellationRequested: () => false, onCancellationRequested: () => () => undefined },
    budget: { maxWallClockMs: 1000 },
    admission: { maxInFlight: 2, maxQueued: 4, overflow: "reject" },
  }
}

function request(): ToolPublicationRequest {
  return { capabilityId: id<CapabilityId>("capability.add-to-cart"), examples: [], context: context(), observedAt: timestamp }
}

test("Worth state and authorization are fail-closed at the publication gate", () => {
  const denied = evaluatePublicationGate(
    projection({ authorization: { kind: "denied", reason: "capability_not_admitted" } }),
    policy,
  )
  assert.equal(denied.kind, "withheld")
  if (denied.kind === "withheld") {
    assert.equal(denied.reason, "worth_unauthorized")
    assert.equal(denied.worthReason, "capability_not_admitted")
  }

  const states = ["degraded", "discovering", "verifying"] as const
  for (const status of states) {
    const raw = { ...projection() }
    delete (raw as Record<string, unknown>).activeReplay
    const decision = evaluatePublicationGate({ ...raw, status } as WorthToolCapabilityProjection, policy)
    assert.equal(decision.kind, "withheld")
    if (decision.kind === "withheld") assert.equal(decision.reason, "capability_not_healthy")
  }

  const nonCurrentReplay = evaluatePublicationGate(
    projection({ activeReplay: { capabilityId: id<CapabilityId>("capability.add-to-cart"), replayVersionId: id("replay.add-to-cart.v1"), version: 1, revision: 4, status: "broken" } }),
    policy,
  )
  assert.equal(nonCurrentReplay.kind, "withheld")
  if (nonCurrentReplay.kind === "withheld") assert.equal(nonCurrentReplay.reason, "invalid_worth_projection")

  const foreignReplay = evaluatePublicationGate(
    projection({ activeReplay: { capabilityId: id<CapabilityId>("capability.other"), replayVersionId: id("replay.other.v1"), version: 1, revision: 4, status: "active" } }),
    policy,
  )
  assert.equal(foreignReplay.kind, "withheld")
  if (foreignReplay.kind === "withheld") assert.equal(foreignReplay.reason, "invalid_worth_projection")
})

test("policy allowlists and unsafe schemas reject before a publication sink could be reached", async () => {
  const restricted: ToolPublicationPolicy = {
    ...policy,
    applicationScope: { kind: "allowlist", ids: [id("application.other")] },
  }
  const query: WorthPublicationQuery = {
    readCapabilityForTool: async () => ({ kind: "found", projection: projection() }),
    discoverCapabilitiesForTools: async () => ({ kind: "found", projections: [] }),
  }
  const denied = await prepareCompiledCapability(query, restricted, request())
  assert.equal(denied.kind, "withheld")
  if (denied.kind === "withheld") assert.equal(denied.reason, "application_not_allowed")

  const unsafe = buildToolPublicationArtifact(
    projection({ inputSchema: { type: "object", properties: { selector: { type: "string" } } } }),
    policy,
    [],
  )
  assert.equal(unsafe.kind, "rejected")
  if (unsafe.kind === "rejected") assert.ok(unsafe.reasons.some((reason) => reason.kind === "invalid_schema"))

  const unsafeDescription = buildToolPublicationArtifact(projection({ description: "Use the Playwright locator." }), policy, [])
  assert.equal(unsafeDescription.kind, "rejected")
  if (unsafeDescription.kind === "rejected") assert.ok(unsafeDescription.reasons.some((reason) => reason.kind === "unsafe_metadata"))

  const unsafeName = buildToolPublicationArtifact(projection({ name: "SubmitCardNumber" }), policy, [])
  assert.equal(unsafeName.kind, "rejected")
  if (unsafeName.kind === "rejected") assert.ok(unsafeName.reasons.some((reason) => reason.kind === "unsafe_metadata"))

  const preparedUnsafe = await prepareCompiledCapability({
    readCapabilityForTool: async () => ({ kind: "found", projection: projection({ description: "Use the Playwright locator." }) }),
    discoverCapabilitiesForTools: async () => ({ kind: "found", projections: [] }),
  }, policy, request())
  assert.equal(preparedUnsafe.kind, "rejected")
  if (preparedUnsafe.kind === "rejected") assert.ok(preparedUnsafe.reasons.some((reason) => reason.kind === "unsafe_metadata"))
})

test("forged artifacts cannot add source fields or disagree with their identity", () => {
  const built = buildToolPublicationArtifact(projection(), policy, [])
  assert.equal(built.kind, "valid")
  if (built.kind !== "valid") throw new Error("expected valid fixture artifact")

  const forged = JSON.parse(JSON.stringify(built.artifact)) as Record<string, unknown>
  const forgedDefinition = forged.definition as Record<string, unknown>
  forgedDefinition.replaySteps = [{ type: "click" }]
  const extraFieldRejections = validateToolPublicationArtifact(forged, policy)
  assert.ok(extraFieldRejections.some((reason) => reason.kind === "invalid_artifact"))

  const mismatched = JSON.parse(JSON.stringify(built.artifact)) as Record<string, unknown>
  const mismatchedIdentity = mismatched.identity as Record<string, unknown>
  mismatchedIdentity.toolId = "store.other_tool"
  const identityRejections = validateToolPublicationArtifact(mismatched, policy)
  assert.ok(identityRejections.some((reason) => reason.kind === "invalid_identity"))

  const outOfScope = JSON.parse(JSON.stringify(built.artifact)) as Record<string, unknown>
  ;(outOfScope.identity as Record<string, unknown>).applicationId = "application.other"
  const policyRejections = validateToolPublicationArtifact(outOfScope, {
    ...policy,
    applicationScope: { kind: "allowlist", ids: [id("application.store")] },
  })
  assert.ok(policyRejections.some((reason) => reason.kind === "policy_denied" && reason.reason === "application_not_allowed"))

  const wrongNamespace = JSON.parse(JSON.stringify(built.artifact)) as Record<string, unknown>
  ;(wrongNamespace.identity as Record<string, unknown>).toolId = "other.add_to_cart"
  ;(wrongNamespace.definition as Record<string, unknown>).name = "other.add_to_cart"
  const namespaceRejections = validateToolPublicationArtifact(wrongNamespace, policy)
  assert.ok(namespaceRejections.some((reason) => reason.kind === "policy_denied" && reason.reason === "namespace_not_allowed"))

  const schemaWithCycle = { type: "object" } as Record<string, unknown>
  schemaWithCycle.self = schemaWithCycle
  const malformed = projection({ inputSchema: schemaWithCycle as JsonSchema })
  assert.doesNotThrow(() => validateWorthToolCapabilityProjection(malformed))
  assert.doesNotThrow(() => buildToolPublicationArtifact(malformed, policy, []))
})

test("query denial, staleness, cancellation, and failure are not converted into publication success", async () => {
  const results: readonly WorthPublicationQueryResult[] = [
    { kind: "denied", capabilityId: id<CapabilityId>("capability.add-to-cart"), reason: "disclosure_not_allowed" },
    { kind: "stale", capabilityId: id<CapabilityId>("capability.add-to-cart"), expectedRevision: 8, actualRevision: 7 },
    {
      kind: "cancelled",
      capabilityId: id<CapabilityId>("capability.add-to-cart"),
      operationId: id<OperationId>("operation.query.1"),
      posture: { kind: "not_started" },
    },
    {
      kind: "timed_out",
      capabilityId: id<CapabilityId>("capability.add-to-cart"),
      operationId: id<OperationId>("operation.query.2"),
      posture: { kind: "unknown", recovery: "owner_reconciliation_required" },
    },
    { kind: "failed", capabilityId: id<CapabilityId>("capability.add-to-cart"), message: "Worth unavailable", retryable: true },
  ]
  for (const queryResult of results) {
    const query: WorthPublicationQuery = {
      readCapabilityForTool: async () => queryResult,
      discoverCapabilitiesForTools: async () => ({ kind: "found", projections: [] }),
    }
    const result = await prepareCompiledCapability(query, policy, request())
    assert.notEqual(result.kind, "prepared")
    assert.notEqual(result.kind, "published")
    if (queryResult.kind === "denied") {
      assert.equal(result.kind, "withheld")
      if (result.kind === "withheld") assert.equal(result.reason, "worth_query_denied")
    } else {
      assert.equal(result.kind, "unavailable")
      if (result.kind === "unavailable") assert.equal(result.reason, queryResult.kind)
    }
  }
})

test("the returned Worth identity must match the requested capability for every result variant", async () => {
  const other = id<CapabilityId>("capability.other")
  const foundOther = projection({
    capabilityId: other,
    activeReplay: { capabilityId: other, replayVersionId: id("replay.other.v1"), version: 1, revision: 1, status: "active" },
  })
  const mismatched: readonly WorthPublicationQueryResult[] = [
    { kind: "found", projection: foundOther },
    { kind: "not_found", capabilityId: other },
    { kind: "denied", capabilityId: other, reason: "unauthorized" },
    { kind: "stale", capabilityId: other, expectedRevision: 2, actualRevision: 1 },
    { kind: "cancelled", capabilityId: other, operationId: id<OperationId>("operation.query.other.1"), posture: { kind: "not_started" } },
    { kind: "timed_out", capabilityId: other, operationId: id<OperationId>("operation.query.other.2"), posture: { kind: "completed" } },
    { kind: "failed", capabilityId: other, message: "not found", retryable: false },
  ]
  for (const queryResult of mismatched) {
    const query: WorthPublicationQuery = {
      readCapabilityForTool: async () => queryResult,
      discoverCapabilitiesForTools: async () => ({ kind: "found", projections: [] }),
    }
    const result = await prepareCompiledCapability(query, policy, request())
    assert.equal(result.kind, "rejected")
    if (result.kind === "rejected") assert.ok(result.reasons.some((reason) => reason.kind === "invalid_worth_result"))
  }
})

test("a malformed downstream result is not promoted to published", async () => {
  const result = await publishCompiledCapability(
    {
      readCapabilityForTool: async () => ({ kind: "found", projection: projection() }),
      discoverCapabilitiesForTools: async () => ({ kind: "found", projections: [] }),
    },
    { publish: async () => ({ kind: "accepted" } as never) },
    policy,
    request(),
  )
  assert.equal(result.kind, "delivery_failed")
  if (result.kind === "delivery_failed") {
    assert.equal(result.retryable, false)
    assert.deepEqual(result.posture, { kind: "unknown", recovery: "owner_reconciliation_required" })
  }
})

test("malformed policies and runtime values are rejected without throwing", () => {
  assert.ok(validateToolPublicationPolicy(null as unknown as ToolPublicationPolicy).length > 0)
  assert.equal(createToolId("", "AddToCart").ok, false)
  assert.equal(createToolId("store", "").ok, false)
  assert.doesNotThrow(() => validateToolPublicationArtifact(null, policy))
  assert.doesNotThrow(() => validateWorthToolCapabilityProjection(null))
  assert.doesNotThrow(() => buildToolPublicationArtifact(null as unknown as WorthToolCapabilityProjection, policy, []))
})

test("malformed Worth discovery envelopes fail closed before candidate dereference", async () => {
  const malformed: WorthPublicationQuery = {
    readCapabilityForTool: async () => ({ kind: "not_found", capabilityId: id<CapabilityId>("capability.unused") }),
    discoverCapabilitiesForTools: async () => ({ kind: "found", projections: [null] } as never),
  }
  const result = await discoverCompiledCapabilities(malformed, policy, { context: context(), observedAt: timestamp })
  assert.equal(result.kind, "unavailable")
  if (result.kind === "unavailable") {
    assert.equal(result.reason, "failed")
    assert.equal(result.retryable, false)
    assert.equal(result.telemetry.outcome, "query_failed")
  }

  const validCancellation: WorthPublicationQuery = {
    readCapabilityForTool: async () => ({ kind: "not_found", capabilityId: id<CapabilityId>("capability.unused") }),
    discoverCapabilitiesForTools: async () => ({ kind: "cancelled", operationId: id<OperationId>("operation.discovery.1"), posture: { kind: "not_started" } }),
  }
  const cancelled = await discoverCompiledCapabilities(validCancellation, policy, { context: context(), observedAt: timestamp })
  assert.equal(cancelled.kind, "unavailable")
  if (cancelled.kind === "unavailable") assert.equal(cancelled.reason, "cancelled")
})

export function publicationContractTypeFence(artifact: ToolPublicationArtifact, definition: GeminiToolDefinition): void {
  // @ts-expect-error the consumer definition does not carry publisher identity or source lineage
  const invalidArtifact: ToolPublicationArtifact = definition
  // @ts-expect-error the artifact envelope is not itself a consumer definition
  const invalidDefinition: GeminiToolDefinition = artifact
  void [invalidArtifact, invalidDefinition]
}
