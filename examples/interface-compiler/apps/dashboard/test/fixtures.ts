import { createEvidence, type EvidenceInput } from "@interface-compiler/domain"
import type {
  ApplicationId,
  CapabilityId,
  Condition,
  Evidence,
  EvidenceId,
  ExecutionId,
  ExecutionMetrics,
  ExecutionProjection,
  JsonSchema,
  ObservationId,
  ReplayStep,
  ReplayVersionId,
  SessionId,
} from "@interface-compiler/domain"
import type {
  DashboardEvidenceProjection,
  DashboardReplayProjection,
  DashboardVerificationRunProjection,
  SolariSessionProjection,
  WorthDashboardProjection,
  WorthDashboardQuery,
} from "../src/dashboard-contract.js"

const timestamp = "2026-08-31T18:00:00.000Z"

export function fixtureProjection(): WorthDashboardProjection {
  const healthyCapabilityId = capabilityId("cap-search")
  const verifyingCapabilityId = capabilityId("cap-checkout")
  const degradedCapabilityId = capabilityId("cap-cart")
  const discoveringCapabilityId = capabilityId("cap-account")
  const activeReplayId = replayId("replay-search-v3")
  const verifyingReplayId = replayId("replay-checkout-v1")
  const brokenReplayId = replayId("replay-cart-v2")

  return {
    schemaVersion: "worth-dashboard.v1",
    sourceRevision: 42,
    generatedAt: timestamp,
    application: {
      projectionKind: "worth_application",
      id: applicationId("app-shop"),
      revision: 42,
      name: "Fixture shop projection",
      baseUrl: "https://shop.example.test",
    },
    mode: { value: "compiled", sourceRevision: 42 },
    capabilities: [
      {
        capability: {
          projectionKind: "worth_capability",
          id: healthyCapabilityId,
          revision: 10,
          applicationId: applicationId("app-shop"),
          name: "Search products",
          description: "Find products by a natural-language query.",
          ...capabilityProjectionContract(),
          status: "healthy",
          activeReplayVersionId: activeReplayId,
        },
        contract: fixtureContract(),
      },
      {
        capability: {
          projectionKind: "worth_capability",
          id: verifyingCapabilityId,
          revision: 8,
          applicationId: applicationId("app-shop"),
          name: "Begin checkout",
          description: "Start checkout after cart validation.",
          ...capabilityProjectionContract(),
          status: "verifying",
          candidateReplayVersionId: verifyingReplayId,
        },
        contract: fixtureContract(),
      },
      {
        capability: {
          projectionKind: "worth_capability",
          id: degradedCapabilityId,
          revision: 12,
          applicationId: applicationId("app-shop"),
          name: "Add to cart <script>",
          description: "The previous replay failed during a cart update.",
          ...capabilityProjectionContract(),
          status: "degraded",
          brokenReplayVersionId: brokenReplayId,
          failure: { kind: "step_failed", stepIndex: 2, message: "Cart control was not found", evidenceIds: [evidenceId("e-failure")] },
          mode: "exploratory",
        },
      },
      {
        capability: {
          projectionKind: "worth_capability",
          id: discoveringCapabilityId,
          revision: 3,
          applicationId: applicationId("app-shop"),
          name: "Account overview",
          description: "Discovery has not produced a candidate replay yet.",
          ...capabilityProjectionContract(),
          status: "discovering",
          discovery: { kind: "initial" },
        },
      },
    ],
    replays: [
      activeReplay(activeReplayId, healthyCapabilityId, replayId("replay-search-v2")),
      supersededReplay(replayId("replay-search-v2"), healthyCapabilityId, replayId("replay-search-v1"), activeReplayId),
      supersededReplay(replayId("replay-search-v1"), healthyCapabilityId, replayId("replay-search-v0"), replayId("replay-search-v2")),
      verifyingReplay(verifyingReplayId, verifyingCapabilityId),
      brokenReplay(brokenReplayId, degradedCapabilityId),
    ],
    executions: [
      execution("execution-success", healthyCapabilityId, "success", "compiled", activeReplayId, "2026-08-31T17:59:00.000Z"),
      execution("execution-failure", healthyCapabilityId, "failure", "compiled", activeReplayId, "2026-08-31T17:58:00.000Z"),
      execution("execution-running", healthyCapabilityId, "running", "compiled", activeReplayId, "2026-08-31T18:00:00.000Z"),
      execution("execution-checkout", verifyingCapabilityId, "success", "exploratory", undefined, "2026-08-31T17:57:00.000Z"),
    ],
    evidence: [
      observationEvidence("e-observation"),
      sessionEvidence("e-session"),
      postconditionEvidence("e-postcondition"),
      failureEvidence("e-failure"),
    ],
    sessions: [
      session("session-explorer", "Explorer #3", "exploration", "closed", ["e-session"]),
      session("session-replay", "Replay #19", "replay", "active", ["e-observation", "e-postcondition"]),
    ],
    economics: [
      {
        capabilityId: healthyCapabilityId,
        kind: "measured",
        metrics: {
          explorationCostMicrocents: 60000000,
          verificationCostMicrocents: 40000000,
          totalCompilationCostMicrocents: 100000000,
          directAverageCostMicrocents: 5000000,
          compiledAverageCostMicrocents: 1000000,
          breakEvenCalls: { kind: "finite", calls: 25, exactCalls: 25, savingsPerCallMicrocents: 4000000 },
        },
        lifetime: {
          executions: 100,
          lifetimeDirectCostAvoidedMicrocents: 500000000,
          lifetimeCompiledCostMicrocents: 200000000,
          lifetimeNetSavingsMicrocents: 300000000,
        },
        measuredExecutionIds: [executionId("execution-success")],
      },
      {
        capabilityId: verifyingCapabilityId,
        kind: "partial",
        metrics: null,
        lifetime: null,
        missing: ["compilation_cost", "average_costs", "break_even", "lifetime"],
        measuredExecutionIds: [],
      },
      { capabilityId: degradedCapabilityId, kind: "missing", reason: "no_measured_runs", measuredExecutionIds: [] },
    ],
  }
}

function capabilityProjectionContract() {
  return {
    inputSchema: { type: "object", additionalProperties: true } as const,
    outputSchema: { type: "object", additionalProperties: true } as const,
    preconditions: [] as const,
    postconditions: [] as const,
    publication: { audience: "gemini_consumer", disclosure: "semantic_only" } as const,
  }
}

export function createFixtureQuery(projection = fixtureProjection()): WorthDashboardQuery {
  return {
    readDashboard: async () => ({ kind: "ready", projection }),
  }
}

function fixtureContract(): { readonly inputSchema: JsonSchema; readonly outputSchema: JsonSchema; readonly preconditions: readonly Condition[]; readonly postconditions: readonly Condition[] } {
  return {
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    outputSchema: { type: "array", items: { type: "object" } },
    preconditions: [{ kind: "url_matches", pattern: "/search" }],
    postconditions: [{ kind: "text_present", text: "Results" }],
  }
}

function activeReplay(id: ReplayVersionId, capabilityId: CapabilityId, supersedes: ReplayVersionId): DashboardReplayProjection {
  return {
    projectionKind: "worth_replay",
    id,
    revision: 7,
    capabilityId,
    version: 3,
    confidence: 0.98,
    supersedes,
    createdAt: timestamp,
    status: "active",
    verifiedAt: timestamp,
    steps: fixtureSteps(),
    verification: {
      posture: "missing_evidence",
      requiredSuccessfulRuns: 3,
      successfulRuns: 3,
      failedRuns: 0,
      runs: [
        verificationRun("verification-1", "session-verification-1", "success", ["e-observation"]),
        verificationRun("verification-2", "session-verification-2", "success", ["e-missing"]),
        verificationRun("verification-3", "session-verification-3", "success", ["e-postcondition"]),
      ],
      referencedEvidenceIds: [evidenceId("e-observation"), evidenceId("e-missing"), evidenceId("e-postcondition")],
      failedEvidenceIds: [],
      missingEvidenceIds: [evidenceId("e-missing")],
      explanation: "Worth reports this active replay with one verification evidence record missing from the current projection.",
    },
  }
}

function verifyingReplay(id: ReplayVersionId, capabilityId: CapabilityId): DashboardReplayProjection {
  return {
    projectionKind: "worth_replay",
    id,
    revision: 2,
    capabilityId,
    version: 1,
    confidence: 0.63,
    createdAt: timestamp,
    status: "verifying",
    verification: {
      posture: "provisional",
      requiredSuccessfulRuns: 2,
      successfulRuns: 1,
      failedRuns: 1,
      runs: [verificationRun("verification-4", "session-verification-4", "success", ["e-observation"]), verificationRun("verification-5", "session-verification-5", "failure", ["e-failure"], "Checkout postcondition failed")],
      referencedEvidenceIds: [evidenceId("e-observation"), evidenceId("e-failure")],
      failedEvidenceIds: [evidenceId("e-failure")],
      missingEvidenceIds: [],
      explanation: "Worth reports this candidate as provisional while verification runs are still being collected; one run failed.",
    },
  }
}

function brokenReplay(id: ReplayVersionId, capabilityId: CapabilityId): DashboardReplayProjection {
  return {
    projectionKind: "worth_replay",
    id,
    revision: 6,
    capabilityId,
    version: 2,
    confidence: 0.41,
    createdAt: timestamp,
    status: "broken",
    brokenAt: timestamp,
    failure: { kind: "step_failed", stepIndex: 2, message: "Cart control was not found", evidenceIds: [evidenceId("e-failure")] },
    verification: {
      posture: "failed",
      requiredSuccessfulRuns: null,
      successfulRuns: 0,
      failedRuns: 0,
      runs: [],
      referencedEvidenceIds: [evidenceId("e-failure")],
      failedEvidenceIds: [evidenceId("e-failure")],
      missingEvidenceIds: [],
      explanation: "Worth reports this replay as failed because the cart control was not found.",
    },
  }
}

function supersededReplay(id: ReplayVersionId, capabilityId: CapabilityId, supersedes: ReplayVersionId, supersededBy: ReplayVersionId): DashboardReplayProjection {
  return {
    projectionKind: "worth_replay",
    id,
    revision: 1,
    capabilityId,
    version: Number(id.endsWith("v2") ? 2 : 1),
    confidence: 0.7,
    supersedes,
    supersededBy,
    createdAt: timestamp,
    status: "superseded",
    supersededAt: timestamp,
    verification: {
      posture: "superseded",
      requiredSuccessfulRuns: null,
      successfulRuns: 0,
      failedRuns: 0,
      runs: [],
      referencedEvidenceIds: [],
      failedEvidenceIds: [],
      missingEvidenceIds: [],
      explanation: "Worth reports this replay as superseded by a later version.",
    },
  }
}

function verificationRun(id: string, sessionId: string, outcome: "success" | "failure", evidenceIds: string[], failureMessage?: string): DashboardVerificationRunProjection {
  const shared = { id: id as DashboardVerificationRunProjection["id"], sessionId: sessionId as SessionId, freshSession: true, evidenceIds: evidenceIds.map(evidenceId) }
  return outcome === "success"
    ? { ...shared, outcome }
    : { ...shared, outcome, failureMessage: failureMessage ?? "Fixture verification failed" }
}

function fixtureSteps(): readonly ReplayStep[] {
  return [{ type: "navigate", url: "https://shop.example.test/search" }, { type: "click", target: { semanticDescription: "Search input", role: "textbox" } }]
}

function execution(id: string, capabilityId: CapabilityId, status: "running" | "success" | "failure", mode: "direct" | "compiled" | "exploratory", replayVersionId: ReplayVersionId | undefined, startedAt: string): ExecutionProjection {
  const base = { projectionKind: "worth_execution" as const, id: executionId(id), revision: 1, capabilityId, mode, ...(replayVersionId === undefined ? {} : { replayVersionId }) }
  if (status === "running") {
    const metrics: ExecutionMetrics & { readonly endedAt?: undefined; readonly wallClockMs?: undefined } = {
      startedAt,
      endedAt: undefined,
      wallClockMs: undefined,
      modelCalls: 1,
      inputTokens: 100,
      outputTokens: 20,
      browserObservations: 2,
      browserActions: 1,
      estimatedModelCostMicrocents: 2000000,
    }
    return { ...base, status, metrics }
  }

  const metrics: ExecutionMetrics & { readonly endedAt: string; readonly wallClockMs: number } = {
    startedAt,
    endedAt: timestamp,
    wallClockMs: 1500,
    modelCalls: 2,
    inputTokens: 100,
    outputTokens: 20,
    browserObservations: 2,
    browserActions: 1,
    estimatedModelCostMicrocents: 2000000,
  }
  const terminalBase = { ...base, metrics }
  if (status === "success") return { ...terminalBase, status, outcome: { kind: "success" } }
  return { ...terminalBase, status, outcome: { kind: "failure", reason: "execution_failed", message: "Fixture execution failed" } }
}

function observationEvidence(id: string): DashboardEvidenceProjection {
  const evidenceIdValue = evidenceId(id)
  const evidence = admittedEvidence({ id: evidenceIdValue, capturedAt: timestamp, kind: "observation", observationId: `observation-${id}` as ObservationId, screenshotRef: "https://evidence.example.test/screenshot" })
  return { status: "present", evidence, reference: "https://evidence.example.test/observation" }
}

function sessionEvidence(id: string): DashboardEvidenceProjection {
  const evidenceIdValue = evidenceId(id)
  const evidence = admittedEvidence({ id: evidenceIdValue, capturedAt: timestamp, kind: "solari_session", sessionId: sessionId("session-explorer"), recordingRef: "recording://explorer-3" })
  return { status: "present", evidence }
}

function postconditionEvidence(id: string): DashboardEvidenceProjection {
  const evidenceIdValue = evidenceId(id)
  const evidence = admittedEvidence({ id: evidenceIdValue, capturedAt: timestamp, kind: "postcondition", condition: { kind: "text_present", text: "Results" }, result: "satisfied" })
  return { status: "present", evidence }
}

function failureEvidence(id: string): DashboardEvidenceProjection {
  const evidenceIdValue = evidenceId(id)
  const evidence = admittedEvidence({ id: evidenceIdValue, capturedAt: timestamp, kind: "failure", failure: { kind: "step_failed", stepIndex: 2, message: "Cart control was not found", evidenceIds: [evidenceIdValue] } })
  return { status: "failed", evidence }
}

function admittedEvidence(input: EvidenceInput): Evidence {
  const result = createEvidence(input)
  if (!result.ok) throw new Error(result.issues.map((entry) => entry.message).join(", "))
  return result.value
}

function session(id: string, label: string, purpose: SolariSessionProjection["purpose"], status: SolariSessionProjection["status"], evidenceIds: string[]): SolariSessionProjection {
  return { id: sessionId(id), label, purpose, status, startedAt: timestamp, evidenceIds: evidenceIds.map(evidenceId), ...(status === "active" ? {} : { endedAt: timestamp }) }
}

function applicationId(value: string): ApplicationId {
  return value as ApplicationId
}

function capabilityId(value: string): CapabilityId {
  return value as CapabilityId
}

function replayId(value: string): ReplayVersionId {
  return value as ReplayVersionId
}

function evidenceId(value: string): EvidenceId {
  return value as EvidenceId
}

function executionId(value: string): ExecutionId {
  return value as ExecutionId
}

function sessionId(value: string): SessionId {
  return value as SessionId
}
