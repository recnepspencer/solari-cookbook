import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"
import type {
  ApplicationId,
  CapabilityId,
  Clock,
  EventId,
  EvidenceId,
  ExecutionId,
  ExperimentId,
  IdSource,
  IsoTimestamp,
  ObservationId,
  OperationId,
  ReplayVersionId,
  SessionId,
  VerificationRunId,
} from "@interface-compiler/domain"
import { createGeminiReasoningModelFromEnvironment } from "@interface-compiler/gemini-adapter"
import { createSolariPortFromEnv } from "@interface-compiler/solari-adapter"
import { InterfaceCompilerWorthClient } from "@interface-compiler/worth-adapter"
import { createReasoningSemanticVerifier } from "../reasoning-semantic-verifier.js"
import type { DemoblazeBenchmarkRuntime } from "./harness.js"
import { readDemoblazeLiveConfiguration } from "./configuration.js"

export type LiveDemoblazeRuntimeResult =
  | { readonly kind: "configured"; readonly modelId: string; readonly runtime: DemoblazeBenchmarkRuntime; close(): Promise<void> }
  | { readonly kind: "invalid"; readonly issues: readonly { readonly path: string; readonly message: string }[] }

const systemClock: Clock = { now: () => new Date().toISOString() as IsoTimestamp }

/** Composes only the real configured adapters. Calls occur later, when the harness runs. */
export function createLiveDemoblazeRuntime(): LiveDemoblazeRuntimeResult {
  const env = process.env
  const configuration = readDemoblazeLiveConfiguration(env)
  if (configuration.kind !== "configured") return configuration

  const gemini = createGeminiReasoningModelFromEnvironment({ pricing: configuration.pricing, model: configuration.modelId, clock: systemClock })
  if (gemini.kind !== "created") return { kind: "invalid", issues: [{ path: "Gemini", message: `Gemini adapter configuration failed (${gemini.kind})` }] }
  const ids = uuidIdSource()
  const solari = createSolariPortFromEnv({ clock: systemClock, idSource: ids, env })
  if (solari.kind !== "configured") return { kind: "invalid", issues: solari.issues.map((entry) => ({ path: entry.path, message: entry.message })) }

  const interfaceCompilerRoot = fileURLToPath(new URL("../../../../", import.meta.url))
  const worth = new InterfaceCompilerWorthClient({
    process: {
      command: "cargo",
      args: ["run", "--quiet", "--offline", "--manifest-path", `${interfaceCompilerRoot}worth-runtime-host/Cargo.toml`, "--bin", "worth-runtime-host", "--", "--serve"],
      cwd: interfaceCompilerRoot,
    },
    credential: env.INTERFACE_COMPILER_WORTH_CREDENTIAL?.trim() || "interface-compiler-demo",
  })
  const verifier = createReasoningSemanticVerifier(gemini.model)
  return {
    kind: "configured",
    modelId: configuration.modelId,
    runtime: { clock: systemClock, ids, worth, solari: solari.port, model: gemini.model, verifier },
    close: () => worth.close(),
  }
}

function uuidIdSource(): IdSource {
  const id = (prefix: string): string => `${prefix}.${randomUUID()}`
  return {
    nextApplicationId: () => id("application") as ApplicationId,
    nextCapabilityId: () => id("capability") as CapabilityId,
    nextReplayVersionId: () => id("replay") as ReplayVersionId,
    nextExperimentId: () => id("experiment") as ExperimentId,
    nextEvidenceId: () => id("evidence") as EvidenceId,
    nextExecutionId: () => id("execution") as ExecutionId,
    nextEventId: () => id("event") as EventId,
    nextSessionId: () => id("session") as SessionId,
    nextObservationId: () => id("observation") as ObservationId,
    nextVerificationRunId: () => id("verification") as VerificationRunId,
    nextOperationId: () => id("operation") as OperationId,
  }
}
