import {
  buildToolPublicationArtifact,
  createToolPublicationPolicy,
  type GeminiToolDefinition,
  type WorthToolCapabilityProjection,
} from "@interface-compiler/tool-publisher"
import type { OperationContext } from "@interface-compiler/domain"
import type { OrchestratorWorthPort } from "../worth-ports.js"
import {
  ENRON_ONLINE_APPLICATION_ID,
  INGEST_INCOMING_TRADE_CAPABILITY_ID,
} from "./contracts.js"

/** The consumer receives one stable operation, never UI or attachment mechanics. */
export async function publishEnronOnlineConsumerTools(
  worth: Pick<OrchestratorWorthPort, "readCapability" | "readActiveReplay">,
  context: OperationContext,
): Promise<readonly GeminiToolDefinition[]> {
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

  const capabilityRead = await worth.readCapability(INGEST_INCOMING_TRADE_CAPABILITY_ID, context)
  if (capabilityRead.kind !== "found" || capabilityRead.value.status !== "healthy") throw new Error("WORTH did not authorize a healthy trade-ingestion capability")
  const replayRead = await worth.readActiveReplay(INGEST_INCOMING_TRADE_CAPABILITY_ID, context)
  if (replayRead.kind !== "found" || replayRead.value.id !== capabilityRead.value.activeReplayVersionId) throw new Error("WORTH did not return the capability's active replay identity")
  const projection: WorthToolCapabilityProjection = {
    projectionKind: "worth_tool_capability",
    capabilityId: capabilityRead.value.id,
    applicationId: capabilityRead.value.applicationId,
    revision: capabilityRead.value.revision,
    name: capabilityRead.value.name,
    description: capabilityRead.value.description,
    inputSchema: capabilityRead.value.inputSchema,
    outputSchema: capabilityRead.value.outputSchema,
    authorization: { kind: "authorized", ...capabilityRead.value.publication },
    status: "healthy",
    activeReplay: {
      capabilityId: replayRead.value.capabilityId,
      replayVersionId: replayRead.value.id,
      version: replayRead.value.version,
      revision: replayRead.value.revision,
      status: "active",
    },
  }
  const result = buildToolPublicationArtifact(projection, policy.value, [])
  if (result.kind !== "valid") throw new Error("WORTH projection is not publishable")
  return Object.freeze([result.artifact.definition])
}
