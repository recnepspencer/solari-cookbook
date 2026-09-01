import type { ValidationIssue, ValidationResult } from "@interface-compiler/domain"

export type SolariRegion = "us-west"

/** Configuration accepted by the Solari client boundary. The API key is never emitted by adapter telemetry. */
export interface SolariAdapterConfig {
  readonly apiKey: string
  readonly region?: SolariRegion
  readonly baseUrl?: string
  readonly timeoutMs?: number
}

export function readSolariConfig(env: NodeJS.ProcessEnv = process.env): ValidationResult<SolariAdapterConfig> {
  const issues: ValidationIssue[] = []
  const apiKey = env.SOLARI_API_KEY?.trim()
  if (!apiKey) issues.push({ path: "SOLARI_API_KEY", message: "SOLARI_API_KEY must be provided through the environment" })

  const region = readRegion(env.SOLARI_REGION, issues)
  const baseUrl = readBaseUrl(env.SOLARI_BASE_URL, issues)
  const timeoutMs = readPositiveInteger(env.SOLARI_TIMEOUT_MS, "SOLARI_TIMEOUT_MS", issues)

  if (issues.length > 0 || apiKey === undefined) return { ok: false, issues: Object.freeze(issues) }

  return {
    ok: true,
    value: Object.freeze({
      apiKey,
      ...(region === undefined ? {} : { region }),
      ...(baseUrl === undefined ? {} : { baseUrl }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    }),
  }
}

function readRegion(value: string | undefined, issues: ValidationIssue[]): SolariRegion | undefined {
  if (value === undefined || value.trim() === "") return undefined
  if (value !== "us-west") {
    issues.push({ path: "SOLARI_REGION", message: "SOLARI_REGION must be us-west when provided" })
    return undefined
  }
  return "us-west"
}

function readBaseUrl(value: string | undefined, issues: ValidationIssue[]): string | undefined {
  if (value === undefined || value.trim() === "") return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      issues.push({ path: "SOLARI_BASE_URL", message: "SOLARI_BASE_URL must use HTTP or HTTPS" })
    }
    if (url.username || url.password) {
      issues.push({ path: "SOLARI_BASE_URL", message: "SOLARI_BASE_URL must not contain credentials" })
    }
    return issues.some((entry) => entry.path === "SOLARI_BASE_URL") ? undefined : value
  } catch {
    issues.push({ path: "SOLARI_BASE_URL", message: "SOLARI_BASE_URL must be an absolute URL" })
    return undefined
  }
}

function readPositiveInteger(value: string | undefined, path: string, issues: ValidationIssue[]): number | undefined {
  if (value === undefined || value.trim() === "") return undefined
  const parsed = Number(value)
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed <= 0) {
    issues.push({ path, message: `${path} must be a positive safe integer` })
    return undefined
  }
  return parsed
}
