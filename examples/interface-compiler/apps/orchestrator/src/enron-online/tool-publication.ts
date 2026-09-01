import {
  buildToolPublicationArtifact,
  createToolPublicationPolicy,
  type GeminiToolDefinition,
} from "@interface-compiler/tool-publisher"
import {
  ENRON_ONLINE_APPLICATION_ID,
  INGEST_INCOMING_TRADE_CAPABILITY_ID,
  INGEST_INCOMING_TRADE_PROJECTION,
} from "./contracts.js"

/** The consumer receives one stable operation, never UI or attachment mechanics. */
export function publishEnronOnlineConsumerTools(): readonly GeminiToolDefinition[] {
  const policy = createToolPublicationPolicy({
    namespace: "trades",
    audience: "gemini_consumer",
    applicationScope: { kind: "allowlist", ids: [ENRON_ONLINE_APPLICATION_ID] },
    capabilityScope: { kind: "allowlist", ids: [INGEST_INCOMING_TRADE_CAPABILITY_ID] },
    maxDescriptionLength: 500,
    maxExamples: 1,
    additionalForbiddenTerms: [],
  })
  if (!policy.ok) throw new Error("UI API Builder publication policy is invalid")

  const result = buildToolPublicationArtifact(INGEST_INCOMING_TRADE_PROJECTION, policy.value, [])
  if (result.kind !== "valid") throw new Error("WORTH projection is not publishable")
  return Object.freeze([result.artifact.definition])
}
