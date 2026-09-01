import type { ApplicationId, CapabilityId, IsoTimestamp, OperationId, ReplayVersionId } from "@interface-compiler/domain"
import {
  TOOL_ARTIFACT_SCHEMA_ID,
  TOOL_ARTIFACT_SCHEMA_VERSION,
  type ToolArtifactSchemaId,
} from "./identity.js"
import type { ToolPublicationArtifact } from "./artifact.js"

export interface PublicationSourceTelemetry {
  readonly applicationId: ApplicationId
  readonly capabilityId: CapabilityId
  readonly replayVersionId: ReplayVersionId
  readonly toolVersion: number
  readonly capabilityRevision: number
  readonly replayRevision: number
}

export type PublicationTelemetryOutcome =
  | "prepared"
  | "published"
  | "already_current"
  | "withheld"
  | "rejected"
  | "query_unavailable"
  | "delivery_cancelled"
  | "delivery_timed_out"
  | "delivery_failed"
  | "delivery_conflict"

export type PublicationTelemetryStage = "worth_query" | "gate" | "artifact" | "delivery"

export interface PublicationTelemetry {
  readonly artifactSchemaId: ToolArtifactSchemaId
  readonly artifactSchemaVersion: typeof TOOL_ARTIFACT_SCHEMA_VERSION
  readonly operationId: OperationId
  readonly observedAt: IsoTimestamp
  readonly capabilityId: CapabilityId
  readonly outcome: PublicationTelemetryOutcome
  readonly stage: PublicationTelemetryStage
  readonly source?: PublicationSourceTelemetry
  readonly exampleCount?: number
}

export interface DiscoveryTelemetry {
  readonly artifactSchemaId: ToolArtifactSchemaId
  readonly artifactSchemaVersion: typeof TOOL_ARTIFACT_SCHEMA_VERSION
  readonly operationId: OperationId
  readonly observedAt: IsoTimestamp
  readonly outcome: "discovered" | "query_cancelled" | "query_timed_out" | "query_failed"
  readonly candidates: number
  readonly available: number
  readonly withheld: number
}

export function sourceTelemetry(artifact: ToolPublicationArtifact): PublicationSourceTelemetry {
  return Object.freeze({
    applicationId: artifact.identity.applicationId,
    capabilityId: artifact.identity.capabilityId,
    replayVersionId: artifact.identity.replayVersionId,
    toolVersion: artifact.identity.toolVersion,
    capabilityRevision: artifact.identity.capabilityRevision,
    replayRevision: artifact.identity.replayRevision,
  })
}

export function createPublicationTelemetry(input: {
  readonly operationId: OperationId
  readonly observedAt: IsoTimestamp
  readonly capabilityId: CapabilityId
  readonly outcome: PublicationTelemetryOutcome
  readonly stage: PublicationTelemetryStage
  readonly source?: PublicationSourceTelemetry
  readonly exampleCount?: number
}): PublicationTelemetry {
  return Object.freeze({
    artifactSchemaId: TOOL_ARTIFACT_SCHEMA_ID,
    artifactSchemaVersion: TOOL_ARTIFACT_SCHEMA_VERSION,
    operationId: input.operationId,
    observedAt: input.observedAt,
    capabilityId: input.capabilityId,
    outcome: input.outcome,
    stage: input.stage,
    ...(input.source === undefined ? {} : { source: Object.freeze({ ...input.source }) }),
    ...(input.exampleCount === undefined ? {} : { exampleCount: input.exampleCount }),
  })
}

export function createDiscoveryTelemetry(input: {
  readonly operationId: OperationId
  readonly observedAt: IsoTimestamp
  readonly outcome: DiscoveryTelemetry["outcome"]
  readonly candidates: number
  readonly available: number
  readonly withheld: number
}): DiscoveryTelemetry {
  return Object.freeze({
    artifactSchemaId: TOOL_ARTIFACT_SCHEMA_ID,
    artifactSchemaVersion: TOOL_ARTIFACT_SCHEMA_VERSION,
    operationId: input.operationId,
    observedAt: input.observedAt,
    outcome: input.outcome,
    candidates: input.candidates,
    available: input.available,
    withheld: input.withheld,
  })
}
