import { buildToolPublicationArtifact, createToolPublicationPolicy, type GeminiToolDefinition } from "@interface-compiler/tool-publisher"
import { ENRON_ONLINE_APPLICATION_ID, ENRON_ONLINE_CAPABILITY_PROJECTIONS, REQUEST_RISK_APPROVAL_CAPABILITY_ID, RESOLVE_CONTRACT_CAPABILITY_ID, STAGE_TRADE_CAPABILITY_ID } from "./contracts.js"

/** Produces the exact semantic-only definitions given to a consumer model. */
export function publishEnronOnlineConsumerTools(): readonly GeminiToolDefinition[] {
  const policy = createToolPublicationPolicy({ namespace: "enron", audience: "gemini_consumer", applicationScope: { kind: "allowlist", ids: [ENRON_ONLINE_APPLICATION_ID] }, capabilityScope: { kind: "allowlist", ids: [RESOLVE_CONTRACT_CAPABILITY_ID, STAGE_TRADE_CAPABILITY_ID, REQUEST_RISK_APPROVAL_CAPABILITY_ID] }, maxDescriptionLength: 500, maxExamples: 1, additionalForbiddenTerms: [] })
  if (!policy.ok) throw new Error("Enron Online publication policy is invalid")
  return Object.freeze(ENRON_ONLINE_CAPABILITY_PROJECTIONS.map((projection) => {
    const result = buildToolPublicationArtifact(projection, policy.value, [])
    if (result.kind !== "valid") throw new Error(`WORTH projection for ${projection.capabilityId} is not publishable`)
    return result.artifact.definition
  }))
}
