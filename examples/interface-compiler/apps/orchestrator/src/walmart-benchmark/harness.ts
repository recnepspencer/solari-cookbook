import type { Clock, IdSource, OperationContext, ReasoningModel, SolariPort } from "@interface-compiler/domain"
import { createTerminalBenchmarkReport, type TerminalBenchmarkReport, type WorthSettledBenchmarkExecution } from "@interface-compiler/benchmark"
import type { OrchestratorWorthPort } from "../worth-ports.js"
import { createCancellationSource, createOperationController, type OperationController } from "../operation.js"
import { planCompiledExperiment, planDirectExperiment } from "../planning.js"
import { ExperimentRunner, type ExperimentRunResult } from "../runner.js"
import type { SemanticVerifier } from "../semantic-verifier.js"
import { createWalmartBenchmarkTask, createWalmartExperimentRequest } from "./task.js"
import { createWalmartBenchmarkStepPolicy } from "./step-policy.js"

const RUN_WALL_CLOCK_MS = 180_000
const MAX_MODEL_CALLS = 12
const MAX_BROWSER_ACTIONS = 12

export interface WalmartBenchmarkRuntime {
  readonly clock: Clock
  readonly ids: IdSource
  readonly worth: OrchestratorWorthPort
  readonly solari: SolariPort
  readonly model: ReasoningModel
  readonly verifier: SemanticVerifier
}

export type WalmartBenchmarkResult =
  | { readonly kind: "completed"; readonly report: TerminalBenchmarkReport; readonly direct: ExperimentRunResult; readonly compiled: ExperimentRunResult }
  | { readonly kind: "not_completed"; readonly stage: "planning" | "direct" | "compiled"; readonly message: string; readonly direct?: ExperimentRunResult; readonly compiled?: ExperimentRunResult }

/** Runs both modes with the same immutable task, model, budgets, and fresh-session runner contract. */
export async function runWalmartBenchmark(runtime: WalmartBenchmarkRuntime, modelId: string): Promise<WalmartBenchmarkResult> {
  const request = createWalmartExperimentRequest()
  const directPlanning = planDirectExperiment(request)
  if (!directPlanning.ok) return { kind: "not_completed", stage: "planning", message: "the direct Walmart benchmark request is invalid" }

  const planningController = operationController(runtime)
  if (planningController === undefined) return { kind: "not_completed", stage: "planning", message: "the planning operation context could not be created" }
  const compiledPlanning = await planCompiledExperiment(request, runtime.worth, planningController.context)
  if (compiledPlanning.kind !== "planned") return { kind: "not_completed", stage: "planning", message: `WORTH could not plan the compiled Walmart run (${compiledPlanning.kind === "unavailable" ? compiledPlanning.reason : "invalid_request"})` }
  if (compiledPlanning.plan.authority.kind !== "worth_query") return { kind: "not_completed", stage: "planning", message: "compiled benchmark planning did not return live WORTH query evidence" }

  const runner = new ExperimentRunner({ ...runtime, stepPolicy: createWalmartBenchmarkStepPolicy() })
  const directController = operationController(runtime)
  if (directController === undefined) return { kind: "not_completed", stage: "direct", message: "the direct operation context could not be created" }
  const direct = await runner.run(directPlanning.value, directController)
  const directSettlement = safeBoundarySettlement(direct)
  if (directSettlement === undefined) return { kind: "not_completed", stage: "direct", message: "direct mode did not settle at a safe human-required boundary with a closed Solari session", direct }

  const compiledController = operationController(runtime)
  if (compiledController === undefined) return { kind: "not_completed", stage: "compiled", message: "the compiled operation context could not be created", direct }
  const compiled = await runner.run(compiledPlanning.plan, compiledController)
  const compiledSettlement = safeBoundarySettlement(compiled)
  if (compiledSettlement === undefined) return { kind: "not_completed", stage: "compiled", message: "compiled mode did not settle at a safe human-required boundary with a closed Solari session", direct, compiled }

  const authority = compiledPlanning.plan.authority
  const report = createTerminalBenchmarkReport({
    task: createWalmartBenchmarkTask(modelId),
    direct: directSettlement,
    compiled: compiledSettlement,
    compiledPlan: {
      capabilityId: compiledPlanning.plan.capability.id,
      replayVersionId: compiledPlanning.plan.replay.id,
      compilationProvenance: authority.compilationProvenance,
      capabilityEvidence: authority.capabilityEvidence,
      replayEvidence: authority.replayEvidence,
    },
  })
  // A not_comparable report is still the truthful terminal result and must not
  // be replaced with a generic runner error that discards its WORTH evidence.
  return { kind: "completed", report, direct, compiled }
}

function operationController(runtime: Pick<WalmartBenchmarkRuntime, "clock" | "ids">): OperationController | undefined {
  let now: number
  let operationId: OperationContext["operationId"]
  try {
    now = Date.parse(runtime.clock.now())
    operationId = runtime.ids.nextOperationId()
  } catch {
    return undefined
  }
  if (!Number.isFinite(now)) return undefined
  const cancellation = createCancellationSource()
  const result = createOperationController({
    clock: runtime.clock,
    admittedContext: {
      operationId,
      deadlineAt: new Date(now + RUN_WALL_CLOCK_MS).toISOString() as OperationContext["deadlineAt"],
      cancellation: cancellation.token,
      budget: { maxWallClockMs: RUN_WALL_CLOCK_MS, maxModelCalls: MAX_MODEL_CALLS, maxBrowserActions: MAX_BROWSER_ACTIONS, maxEvidenceBytes: 0 },
      admission: { maxInFlight: 1, maxQueued: 0, overflow: "reject" },
    },
  })
  return result.ok ? result.value : undefined
}

function safeBoundarySettlement(result: ExperimentRunResult): WorthSettledBenchmarkExecution | undefined {
  if (result.kind !== "attempted" || result.settlement.kind !== "settled" || result.cleanup.kind !== "closed" || result.terminal.kind !== "safety_stop") return undefined
  const projection = result.settlement.projection
  return projection.lifecycle === "stopped" && projection.outcome.kind === "safety_stop" ? result.settlement : undefined
}
