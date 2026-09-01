import assert from "node:assert/strict"
import test from "node:test"
import { runWalmartBenchmarkCli } from "../src/walmart-benchmark/cli.js"

function configuredEnvironment(): NodeJS.ProcessEnv {
  return {
    GEMINI_API_KEY: "gemini-secret-that-must-not-be-rendered",
    GEMINI_MODEL: "gemini-reviewed-model",
    GEMINI_INPUT_USD_PER_MILLION_TOKENS: "1.25",
    GEMINI_OUTPUT_USD_PER_MILLION_TOKENS: "5",
    SOLARI_API_KEY: "solari-secret-that-must-not-be-rendered",
    INTERFACE_COMPILER_ALLOW_WALMART_NETWORK: "true",
  }
}

test("dry-run never constructs live adapters or reveals credentials", async () => {
  let liveFactoryCalls = 0
  let stdout = ""
  let stderr = ""
  const code = await runWalmartBenchmarkCli(["--dry-run"], configuredEnvironment(), {
    stdout: { write: (value) => { stdout += value } },
    stderr: { write: (value) => { stderr += value } },
  }, () => {
    liveFactoryCalls += 1
    return { kind: "invalid", issues: [] }
  })

  assert.equal(code, 0)
  assert.equal(liveFactoryCalls, 0)
  assert.equal(stderr, "")
  const report = JSON.parse(stdout) as { network: string; readyForReviewedExecution: boolean; adapters: { worth: { processStarted: boolean } } }
  assert.equal(report.network, "disabled")
  assert.equal(report.readyForReviewedExecution, true)
  assert.equal(report.adapters.worth.processStarted, false)
  assert.equal(stdout.includes("gemini-secret"), false)
  assert.equal(stdout.includes("solari-secret"), false)
})

test("the default command is also no-network and reports missing configuration without constructing adapters", async () => {
  let liveFactoryCalls = 0
  let stdout = ""
  const code = await runWalmartBenchmarkCli([], {}, {
    stdout: { write: (value) => { stdout += value } },
    stderr: { write: () => undefined },
  }, () => {
    liveFactoryCalls += 1
    return { kind: "invalid", issues: [] }
  })
  assert.equal(code, 0)
  assert.equal(liveFactoryCalls, 0)
  const report = JSON.parse(stdout) as { readyForReviewedExecution: boolean; issues: readonly { path: string }[] }
  assert.equal(report.readyForReviewedExecution, false)
  assert.equal(report.issues.some((entry) => entry.path === "GEMINI_API_KEY"), true)
  assert.equal(report.issues.some((entry) => entry.path === "SOLARI_API_KEY"), true)
})

test("only explicit --execute enters the live composition boundary", async () => {
  let liveFactoryCalls = 0
  let stderr = ""
  const code = await runWalmartBenchmarkCli(["--execute"], configuredEnvironment(), {
    stdout: { write: () => undefined },
    stderr: { write: (value) => { stderr += value } },
  }, () => {
    liveFactoryCalls += 1
    return { kind: "invalid", issues: [{ path: "test", message: "live execution intentionally blocked by the test" }] }
  })
  assert.equal(code, 2)
  assert.equal(liveFactoryCalls, 1)
  assert.equal(stderr.includes("intentionally blocked"), true)
})

test("--execute fails before constructing live adapters when the network opt-in is absent", async () => {
  let liveFactoryCalls = 0
  let stderr = ""
  const env = configuredEnvironment()
  delete env.INTERFACE_COMPILER_ALLOW_WALMART_NETWORK
  const code = await runWalmartBenchmarkCli(["--execute"], env, {
    stdout: { write: () => undefined },
    stderr: { write: (value) => { stderr += value } },
  }, () => {
    liveFactoryCalls += 1
    return { kind: "invalid", issues: [] }
  })

  assert.equal(code, 2)
  assert.equal(liveFactoryCalls, 0)
  const result = JSON.parse(stderr) as { kind: string; issues: readonly { path: string }[] }
  assert.equal(result.kind, "invalid_configuration")
  assert.equal(result.issues.some((entry) => entry.path === "INTERFACE_COMPILER_ALLOW_WALMART_NETWORK"), true)
})

test("--dry-run remains no-network when combined with --execute", async () => {
  let liveFactoryCalls = 0
  let stdout = ""
  let stderr = ""
  const code = await runWalmartBenchmarkCli(["--dry-run", "--execute"], configuredEnvironment(), {
    stdout: { write: (value) => { stdout += value } },
    stderr: { write: (value) => { stderr += value } },
  }, () => {
    liveFactoryCalls += 1
    return { kind: "invalid", issues: [] }
  })

  assert.equal(code, 2)
  assert.equal(liveFactoryCalls, 0)
  assert.equal(stdout, "")
  assert.equal((JSON.parse(stderr) as { kind: string }).kind, "invalid_arguments")
})
