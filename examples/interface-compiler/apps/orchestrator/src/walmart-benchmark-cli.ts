import { runWalmartBenchmarkCli } from "./walmart-benchmark/cli.js"

try {
  process.exitCode = await runWalmartBenchmarkCli(process.argv.slice(2), process.env, process)
} catch {
  process.stderr.write(`${JSON.stringify({ kind: "benchmark_failed", message: "the benchmark entrypoint failed without a report" })}\n`)
  process.exitCode = 1
}
