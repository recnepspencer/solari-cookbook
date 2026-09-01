import type {
  ActiveReplayProjection,
  ApplicationId,
  CapabilityId,
  ExecutionId,
  ExecutionProjection,
  EvidenceId,
  ReplayVersionId,
  SafetyStopResult,
  SessionId,
  VerificationRunId,
} from "@interface-compiler/domain"
import { classifySafetyBoundary } from "@interface-compiler/domain"
import type { WorthCompilationMetricsProjection } from "@interface-compiler/worth-adapter"
import type {
  BenchmarkCompilationInput,
  BenchmarkComparisonInput,
  BenchmarkExecutionRecord,
  MeasuredBenchmarkExecutionMeasurement,
  BenchmarkTaskIdentity,
} from "../src/index.js"

export type MeasuredExecutionRecord = Omit<BenchmarkExecutionRecord, "execution" | "measurement"> & {
  readonly execution: Extract<ExecutionProjection, { readonly status: "stopped" }>
  readonly measurement: MeasuredBenchmarkExecutionMeasurement
}

export type ValidBenchmarkInput = Omit<BenchmarkComparisonInput, "direct" | "compiled"> & {
  readonly direct: readonly MeasuredExecutionRecord[]
  readonly compiled: readonly MeasuredExecutionRecord[]
}

export const task: BenchmarkTaskIdentity = {
  taskId: "walmart-tide-pods-checkout-v1",
  applicationId: id<ApplicationId>("application.walmart"),
  objectiveFingerprint: "sha256:objective-walmart-tide-pods",
  modelId: "gemini-test-model",
}

export const activeReplayId = id<ReplayVersionId>("replay.add-to-cart.v1")
export const stop = makeAuthenticationStop()

export function validInput(): ValidBenchmarkInput {
  return {
    task,
    direct: [
      executionRecord("direct-1", "direct", 4, 4, 400, 80, 6, 8, "e-direct-1"),
      executionRecord("direct-2", "direct", 6, 6, 600, 120, 8, 10, "e-direct-2"),
    ],
    compiled: [
      executionRecord("compiled-1", "compiled", 1, 1, 100, 20, 2, 2, "e-compiled-1"),
      executionRecord("compiled-2", "compiled", 3, 3, 300, 60, 4, 4, "e-compiled-2"),
    ],
    compiledReplay: activeReplay(),
    compiledReplayInspection: { status: "passed", source: "worth", reference: "worth://inspection/replay.add-to-cart.v1" },
    compiledReplayEvidence: {
      status: "complete",
      source: "worth",
      evidenceIds: ["e-verify-1", "e-verify-2", "e-verify-3"].map(evidenceId),
      reference: "worth://evidence/replay.add-to-cart.v1",
    },
    compilation: compilationInput(),
  }
}

export function executionRecord(
  id: string,
  mode: "direct" | "compiled",
  costUsd: number,
  modelCalls: number,
  inputTokens: number,
  outputTokens: number,
  browserObservations: number,
  browserActions: number,
  evidenceId: string,
  overrides: Partial<MeasuredBenchmarkExecutionMeasurement> = {},
): MeasuredExecutionRecord {
  const executionId = id as ExecutionId
  const measurement: MeasuredBenchmarkExecutionMeasurement = {
    status: "measured",
    source: "worth",
    recordId: `measurement-${id}`,
    toolCalls: mode === "direct" ? 0 : 3,
    inspection: { status: "passed", source: "worth" },
    evidence: { status: "complete", source: "worth", evidenceIds: [evidenceId as EvidenceId] },
    recovery: { status: "not_required" },
    safety: { kind: "stopped_at_boundary", stop },
    ...overrides,
  }
  return {
    task,
    execution: {
      projectionKind: "worth_execution",
      id: executionId,
      revision: 1,
      capabilityId: "capability.add-to-cart" as CapabilityId,
      ...(mode === "compiled" ? { replayVersionId: activeReplayId } : {}),
      mode,
      status: "stopped",
      outcome: { kind: "safety_stop", stop },
      metrics: {
        startedAt: "2026-08-31T18:00:00.000Z",
        endedAt: "2026-08-31T18:00:01.000Z",
        wallClockMs: 1000,
        modelCalls,
        inputTokens,
        outputTokens,
        browserObservations,
        browserActions,
        estimatedModelCostUsd: costUsd,
      },
    },
    measurement,
  }
}

export function activeReplay(): ActiveReplayProjection {
  return {
    projectionKind: "worth_replay",
    id: activeReplayId,
    revision: 8,
    capabilityId: "capability.add-to-cart" as CapabilityId,
    version: 1,
    steps: [{ type: "navigate", url: "https://www.walmart.com" }],
    confidence: 0.99,
    createdAt: "2026-08-31T17:00:00.000Z",
    status: "active",
    verifiedAt: "2026-08-31T17:30:00.000Z",
    verification: {
      requiredSuccessfulRuns: 3,
      runs: [1, 2, 3].map((number) => ({
        id: id<VerificationRunId>(`verification-${number}`),
        sessionId: id<SessionId>(`session-verification-${number}`),
        capabilityId: "capability.add-to-cart" as CapabilityId,
        replayVersionId: activeReplayId,
        freshSession: true as const,
        outcome: "success" as const,
        evidenceIds: [`e-verify-${number}` as EvidenceId],
      })),
    },
  }
}

export function compilationInput(): BenchmarkCompilationInput {
  const projection: WorthCompilationMetricsProjection = {
    projectionKind: "worth_compilation_metrics",
    capabilityId: "capability.add-to-cart" as CapabilityId,
    revision: 12,
    compilation: {
      explorationCostUsd: 3,
      verificationCostUsd: 2,
      totalCompilationCostUsd: 5,
      directAverageCostUsd: 5,
      compiledAverageCostUsd: 2,
      breakEvenCalls: { kind: "finite", calls: 2, exactCalls: 5 / 3, savingsPerCallUsd: 3 },
    },
    lifetime: {
      executions: 4,
      lifetimeDirectCostAvoidedUsd: 20,
      lifetimeCompiledCostUsd: 13,
      lifetimeNetSavingsUsd: 7,
    },
  }
  return {
    task,
    projection,
    attribution: {
      kind: "discovery_and_verification_only",
      discoveryExecutionIds: ["execution-discovery" as ExecutionId],
      verificationExecutionIds: ["execution-verification" as ExecutionId],
    },
  }
}

export function evidenceId(value: string): EvidenceId {
  return value as EvidenceId
}

function makeAuthenticationStop(): SafetyStopResult {
  const assessment = classifySafetyBoundary({
    observedAt: "2026-08-31T18:00:01.000Z",
    signal: { kind: "authentication_required", credential: "password" },
  })
  if (!assessment.ok || assessment.value.kind !== "stop") throw new Error("fixture safety stop could not be created")
  return assessment.value.result
}

function id<T extends string>(value: string): T {
  return value as T
}
