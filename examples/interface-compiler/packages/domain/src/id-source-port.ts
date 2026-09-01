import type { ApplicationId, CapabilityId, EventId, ExecutionId, EvidenceId, ExperimentId, ObservationId, OperationId, ReplayVersionId, SessionId, VerificationRunId } from "./identity.js"

export interface IdSource {
  nextApplicationId(): ApplicationId
  nextCapabilityId(): CapabilityId
  nextReplayVersionId(): ReplayVersionId
  nextExperimentId(): ExperimentId
  nextEvidenceId(): EvidenceId
  nextExecutionId(): ExecutionId
  nextEventId(): EventId
  nextSessionId(): SessionId
  nextObservationId(): ObservationId
  nextVerificationRunId(): VerificationRunId
  nextOperationId(): OperationId
}
