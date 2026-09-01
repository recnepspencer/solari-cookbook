import assert from "node:assert/strict"
import test from "node:test"
import { readSolariConfig } from "../src/index.js"

test("Solari configuration is environment-only and rejects missing or credentialed values", () => {
  const missing = readSolariConfig({})
  assert.equal(missing.ok, false)
  if (missing.ok) throw new Error("expected missing configuration to be rejected")
  assert.deepEqual(missing.issues, [{ path: "SOLARI_API_KEY", message: "SOLARI_API_KEY must be provided through the environment" }])

  const credentialedBaseUrl = readSolariConfig({
    SOLARI_API_KEY: "test-only-key",
    SOLARI_BASE_URL: "https://user:password@staging.example.test",
  })
  assert.equal(credentialedBaseUrl.ok, false)
  if (credentialedBaseUrl.ok) throw new Error("expected credentials in the base URL to be rejected")
  assert.equal(credentialedBaseUrl.issues.some((entry) => entry.path === "SOLARI_BASE_URL"), true)
})

test("valid environment configuration maps only supported Solari options", () => {
  const result = readSolariConfig({
    SOLARI_API_KEY: "test-only-key",
    SOLARI_REGION: "us-west",
    SOLARI_BASE_URL: "https://staging.example.test/gateway",
    SOLARI_TIMEOUT_MS: "5000",
  })
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error("expected configuration to be valid")
  assert.deepEqual(result.value, {
    apiKey: "test-only-key",
    region: "us-west",
    baseUrl: "https://staging.example.test/gateway",
    timeoutMs: 5000,
  })
})
