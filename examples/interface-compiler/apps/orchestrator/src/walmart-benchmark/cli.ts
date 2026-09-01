import { inspectWalmartBenchmarkConfiguration, readWalmartLiveConfiguration } from "./configuration.js"
import { createLiveWalmartRuntime, type LiveWalmartRuntimeResult } from "./live-runtime.js"
import { runWalmartBenchmark } from "./harness.js"
import type { ExperimentRunResult } from "../runner.js"
import type { WorthRuntimeSettlementResult } from "@interface-compiler/worth-adapter"

export interface WalmartBenchmarkCliIo {
  readonly stdout: { write(value: string): unknown }
  readonly stderr: { write(value: string): unknown }
}

export type LiveWalmartRuntimeFactory = () => LiveWalmartRuntimeResult

export async function runWalmartBenchmarkCli(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  io: WalmartBenchmarkCliIo,
  liveFactory: LiveWalmartRuntimeFactory = () => createLiveWalmartRuntime(),
): Promise<number> {
  const dryRun = args.includes("--dry-run")
  const execute = args.includes("--execute")
  if (dryRun && execute) {
    io.stderr.write(`${JSON.stringify({ kind: "invalid_arguments", message: "--dry-run and --execute are mutually exclusive" }, null, 2)}\n`)
    return 2
  }
  if (!execute) {
    io.stdout.write(`${JSON.stringify(inspectWalmartBenchmarkConfiguration(env), null, 2)}\n`)
    return 0
  }
  const configuration = readWalmartLiveConfiguration(env)
  if (configuration.kind !== "configured") {
    io.stderr.write(`${JSON.stringify({ kind: "invalid_configuration", issues: configuration.issues }, null, 2)}\n`)
    return 2
  }
  const live = liveFactory()
  if (live.kind !== "configured") {
    io.stderr.write(`${JSON.stringify({ kind: "invalid_configuration", issues: live.issues }, null, 2)}\n`)
    return 2
  }
  try {
    const result = await runWalmartBenchmark(live.runtime, live.modelId)
    if (result.kind !== "completed") {
      io.stderr.write(`${JSON.stringify({
        kind: result.kind,
        stage: result.stage,
        message: result.message,
        ...(result.direct === undefined ? {} : { direct: summarizeRun(result.direct) }),
        ...(result.compiled === undefined ? {} : { compiled: summarizeRun(result.compiled) }),
      }, null, 2)}\n`)
      return 1
    }
    io.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`)
    return 0
  } finally {
    await live.close()
  }
}

/** Emits only execution lifecycle, terminal posture, cleanup, and WORTH metrics. */
export function summarizeRun(result: ExperimentRunResult): unknown {
  if (result.kind === "not_started") {
    return {
      kind: result.kind,
      reason: result.reason,
      ...(result.executionId === undefined ? {} : { executionId: result.executionId }),
      ...(result.message === undefined ? {} : { message: result.message }),
    }
  }
  if (result.kind === "finalization_blocked") {
    return {
      kind: result.kind,
      executionId: result.executionId,
      reason: result.reason,
      ...(result.message === undefined ? {} : { message: result.message }),
      cleanup: result.cleanup.kind,
      ...(result.terminal === undefined ? {} : { terminal: result.terminal.kind }),
      ...(result.settlement === undefined ? {} : { settlement: summarizeSettlement(result.settlement) }),
    }
  }
  return {
    kind: result.kind,
    executionId: result.executionId,
    terminal: result.terminal.kind,
    cleanup: result.cleanup.kind,
    settlement: summarizeSettlement(result.settlement),
  }
}

function summarizeSettlement(settlement: WorthRuntimeSettlementResult): unknown {
  if (settlement.kind !== "settled") return settlement
  return {
    kind: settlement.kind,
    executionId: settlement.projection.executionId,
    lifecycle: settlement.projection.lifecycle,
    metrics: settlement.projection.metrics,
    outcome: settlement.projection.outcome.kind,
  }
}
