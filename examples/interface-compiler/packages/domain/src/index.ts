export type { Application, ApplicationInput } from "./application.js"
export { createApplication, validateApplication } from "./application.js"

export type {
  Capability,
  CapabilityDefinition,
  DegradedCapability,
  DiscoveryReason,
  DiscoveringCapability,
  HealthyCapability,
  VerifyingCapability,
} from "./capability.js"
export {
  activateCapability,
  beginCapabilityVerification,
  createCapability,
  degradeCapability,
  failCapabilityVerification,
  resumeCapabilityExploration,
  validateCapabilityDefinition,
} from "./capability.js"

export type {
  AssertStep,
  BrokenReplay,
  CandidateReplay,
  CandidateReplayInput,
  ClickStep,
  FillStep,
  LocatorTarget,
  NavigateStep,
  ReadStep,
  ReplayFailure,
  ReplayStep,
  ReplayVersion,
  SelectStep,
  SupersededReplay,
  VerificationRunProjection,
  VerificationRunReceipt,
  VerifyingReplay,
  ActiveReplay,
  WaitStep,
} from "./replay.js"
export {
  beginReplayVerification,
  completeReplayVerification,
  createCandidateReplay,
  isActiveReplay,
  isBrokenReplay,
  isCandidateReplay,
  isVerifyingReplay,
  markReplayBroken,
  successfulVerificationCount,
  supersedeReplay,
  validateReplayFailure,
  validateCandidateReplay,
  validateReplayStep,
} from "./replay.js"

export type { Interactable, InteractableKind, Observation } from "./observation.js"
export { findInteractables, normalizeObservation, validateObservation } from "./observation.js"

export type { Evidence, EvidenceInput } from "./evidence.js"
export { createEvidence, observationEvidence, validateEvidence } from "./evidence.js"

export type { Experiment, ExperimentDefinition, PendingExperiment, ResolvedExperiment } from "./experiment.js"
export { resolveExperiment, startExperiment, validateExperimentDefinition } from "./experiment.js"

export type {
  Execution,
  ExecutionCompletion,
  ExecutionMetrics,
  ExecutionMode,
  ExecutionStart,
  FailedExecution,
  FailedExecutionOutcome,
  RunningExecution,
  StoppedExecution,
  SuccessfulExecution,
  TerminalExecution,
} from "./execution.js"
export { createExecution, finishExecution, isRunningExecution, validateExecutionCompletion, validateExecutionMetrics } from "./execution.js"

export type {
  BreakEvenCalls,
  CompilationMetrics,
  CompilationMetricsInput,
  LifetimeEconomics,
  ModelPricingMicrocentsPerToken,
  ModelUsage,
} from "./economics.js"
export {
  calculateBreakEvenCalls,
  calculateCompilationCostMicrocents,
  calculateCompilationMetrics,
  calculateLifetimeEconomics,
  calculateModelCostMicrocents,
} from "./economics.js"

export type {
  CredentialKind,
  PaymentInformationKind,
  PersonalInformationKind,
  SafetyAssessment,
  SafetyBoundaryObservation,
  SafetySignal,
  SafetyStopResult,
} from "./safety.js"
export { classifySafetyBoundary, isSafetyStopResult, safetyStopReason, validateSafetySignal, validateSafetyStopResult } from "./safety.js"

export type { EventIntegrity, EventRecovery, InterfaceCompilerEvent, InterfaceCompilerEventMap, InterfaceCompilerEventType } from "./events.js"
export type {
  EvidenceCaptureRequest,
  EvidenceReference,
  SessionFreshness,
  SolariPort,
  SolariSession,
  SolariSessionLease,
  SolariSessionPurpose,
  SolariSessionRequest,
  SolariSessionResult,
  SolariObservationResult,
  SolariEvidenceResult,
  SolariCloseResult,
  SolariStepResult,
} from "./solari-port.js"
export type { ReasoningCompletion, ReasoningModel, ReasoningResult, ReasoningUsage } from "./reasoning-port.js"
export type {
  ActiveReplayProjection,
  ApplicationProjection,
  CapabilityProjection,
  EvidenceProjection,
  ExecutionProjection,
  ExperimentProjection,
  ReplayProjection,
  WorthAuthority,
  WorthCommand,
  WorthDenialReason,
  WorthEntity,
  WorthEntityId,
  WorthMutationProjection,
  WorthReadResult,
  WorthSubmissionResult,
} from "./worth-port.js"
export type { EventPublicationResult, EventPublisher } from "./event-publisher.js"
export type { Clock } from "./clock-port.js"
export type { IdSource } from "./id-source-port.js"
export type { AdmissionPolicy, CancellationToken, OperationContext, PartialEffectPosture, ResourceBudget } from "./operation-context.js"

export type {
  ApplicationId,
  CapabilityId,
  EventId,
  ExecutionId,
  EvidenceId,
  ExperimentId,
  IdentifierKind,
  IsoTimestamp,
  ObservationId,
  ReplayVersionId,
  SessionId,
  VerificationRunId,
  OperationId,
} from "./identity.js"
export type { JsonAnySchema, JsonArraySchema, JsonBooleanSchema, JsonIntegerSchema, JsonNullSchema, JsonNumberSchema, JsonObjectSchema, JsonPrimitive, JsonSchema, JsonStringSchema, JsonValue, Schema, Condition } from "./schema.js"
export { createCondition, createSchema, isCondition, isJsonValue, matchesJsonSchema, validateCondition, validateJsonSchema } from "./schema.js"
export type { ValidationIssue, ValidationResult } from "./validation.js"
export { validateOperationContext } from "./operation-context.js"
