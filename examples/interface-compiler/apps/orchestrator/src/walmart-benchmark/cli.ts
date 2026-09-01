import { inspectWalmartBenchmarkConfiguration, readWalmartLiveConfiguration } from "./configuration.js"
import { createLiveWalmartRuntime, type LiveWalmartRuntimeResult } from "./live-runtime.js"
import { runWalmartBenchmark } from "./harness.js"

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
      io.stderr.write(`${JSON.stringify({ kind: result.kind, stage: result.stage, message: result.message }, null, 2)}\n`)
      return 1
    }
    io.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`)
    return 0
  } finally {
    await live.close()
  }
}
