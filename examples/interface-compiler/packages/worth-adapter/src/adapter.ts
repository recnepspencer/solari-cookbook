import type {
  Application,
  CandidateReplay,
  CapabilityDefinition,
  CapabilityId,
  EventPublisher,
  ExecutionCompletion,
  ExecutionId,
  ExecutionStart,
  IsoTimestamp,
  OperationContext,
  ReplayFailure,
  ReplayVersionId,
  VerificationRunReceipt,
  WorthAuthority,
  WorthCommand,
  WorthSubmissionResult,
} from "@interface-compiler/domain"
import {
  WORTH_QUERY_HOST_FACADE_BOUNDARY,
  type WorthMetricsQueries,
  type WorthQueryHostFacadeBinding,
  type WorthRuntimePort,
} from "./worth-runtime-port.js"

type CommandOf<Kind extends WorthCommand["kind"]> = Extract<WorthCommand, { readonly kind: Kind }>

/** Typed command helpers that submit lifecycle intent to Worth. */
export interface WorthLifecycleCommands {
  registerApplication(application: CommandOf<"register_application">["application"], context: OperationContext): Promise<WorthSubmissionResult>
  registerCapability(definition: CommandOf<"register_capability">["definition"], context: OperationContext): Promise<WorthSubmissionResult>
  recordReplayCandidate(candidate: CommandOf<"record_replay_candidate">["candidate"], expectedCapabilityRevision: number, context: OperationContext): Promise<WorthSubmissionResult>
  beginReplayVerification(replayVersionId: ReplayVersionId, requiredSuccessfulRuns: number, expectedReplayRevision: number, context: OperationContext): Promise<WorthSubmissionResult>
  recordVerificationRun(replayVersionId: ReplayVersionId, receipt: VerificationRunReceipt, expectedReplayRevision: number, context: OperationContext): Promise<WorthSubmissionResult>
  completeReplayVerification(replayVersionId: ReplayVersionId, verifiedAt: IsoTimestamp, expectedReplayRevision: number, context: OperationContext): Promise<WorthSubmissionResult>
  beginCapabilityVerification(capabilityId: CapabilityId, candidateReplayVersionId: ReplayVersionId, expectedCapabilityRevision: number, context: OperationContext): Promise<WorthSubmissionResult>
  activateCapability(capabilityId: CapabilityId, activeReplayVersionId: ReplayVersionId, expectedCapabilityRevision: number, context: OperationContext): Promise<WorthSubmissionResult>
  failCapabilityVerification(capabilityId: CapabilityId, brokenReplayVersionId: ReplayVersionId, expectedCapabilityRevision: number, context: OperationContext): Promise<WorthSubmissionResult>
  recordReplayFailure(replayVersionId: ReplayVersionId, failure: ReplayFailure, brokenAt: IsoTimestamp, expectedReplayRevision: number, context: OperationContext): Promise<WorthSubmissionResult>
  resumeCapabilityExploration(capabilityId: CapabilityId, expectedCapabilityRevision: number, context: OperationContext): Promise<WorthSubmissionResult>
  supersedeReplay(replayVersionId: ReplayVersionId, successorReplayVersionId: ReplayVersionId, supersededAt: IsoTimestamp, expectedReplayRevision: number, context: OperationContext): Promise<WorthSubmissionResult>
  startExecution(execution: ExecutionStart, context: OperationContext): Promise<WorthSubmissionResult>
  completeExecution(executionId: ExecutionId, completion: ExecutionCompletion, endedAt: IsoTimestamp, expectedExecutionRevision: number, context: OperationContext): Promise<WorthSubmissionResult>
}

/**
 * Public Worth boundary consumed by later Interface Compiler workstreams.
 *
 * The object contains no registry, cache, reducer, event bus, or persistence.
 * Every operation below is sent to the injected Worth runtime, which remains
 * the authority for currentness and legal lifecycle transitions.
 */
export interface WorthAdapter extends WorthAuthority, EventPublisher, WorthLifecycleCommands, WorthMetricsQueries {}

export function createWorthAdapter(binding: WorthQueryHostFacadeBinding): WorthAdapter {
  assertWorthQueryHostFacadeBinding(binding)
  return createWorthAdapterForRuntime(binding.runtime)
}

function createWorthAdapterForRuntime(runtime: WorthRuntimePort): WorthAdapter {
  assertWorthRuntimePort(runtime)

  const adapter: WorthAdapter = {
    readApplication: (applicationId, context) => runtime.readApplication(applicationId, context),
    readCapability: (capabilityId, context) => runtime.readCapability(capabilityId, context),
    readActiveReplay: (capabilityId, context) => runtime.readActiveReplay(capabilityId, context),
    readReplayLineage: (capabilityId, context) => runtime.readReplayLineage(capabilityId, context),
    readExperiment: (experimentId, context) => runtime.readExperiment(experimentId, context),
    readEvidence: (evidenceId, context) => runtime.readEvidence(evidenceId, context),
    readExecution: (executionId, context) => runtime.readExecution(executionId, context),
    readCompilationMetrics: (capabilityId, context) => runtime.readCompilationMetrics(capabilityId, context),
    submit: (command, context) => runtime.submit(command, context),
    publish: (event, context) => runtime.publishEvent(event, context),

    registerApplication: (application: Application, context) => runtime.submit({ kind: "register_application", application }, context),
    registerCapability: (definition: CapabilityDefinition, context) => runtime.submit({ kind: "register_capability", definition }, context),
    recordReplayCandidate: (candidate: CandidateReplay, expectedCapabilityRevision, context) =>
      runtime.submit({ kind: "record_replay_candidate", candidate, expectedCapabilityRevision }, context),
    beginReplayVerification: (replayVersionId, requiredSuccessfulRuns, expectedReplayRevision, context) =>
      runtime.submit({ kind: "begin_replay_verification", replayVersionId, requiredSuccessfulRuns, expectedReplayRevision }, context),
    recordVerificationRun: (replayVersionId, receipt, expectedReplayRevision, context) =>
      runtime.submit({ kind: "record_verification_run", replayVersionId, receipt, expectedReplayRevision }, context),
    completeReplayVerification: (replayVersionId, verifiedAt, expectedReplayRevision, context) =>
      runtime.submit({ kind: "complete_replay_verification", replayVersionId, verifiedAt, expectedReplayRevision }, context),
    beginCapabilityVerification: (capabilityId, candidateReplayVersionId, expectedCapabilityRevision, context) =>
      runtime.submit({ kind: "begin_capability_verification", capabilityId, candidateReplayVersionId, expectedCapabilityRevision }, context),
    activateCapability: (capabilityId, activeReplayVersionId, expectedCapabilityRevision, context) =>
      runtime.submit({ kind: "activate_capability", capabilityId, activeReplayVersionId, expectedCapabilityRevision }, context),
    failCapabilityVerification: (capabilityId, brokenReplayVersionId, expectedCapabilityRevision, context) =>
      runtime.submit({ kind: "fail_capability_verification", capabilityId, brokenReplayVersionId, expectedCapabilityRevision }, context),
    recordReplayFailure: (replayVersionId, failure, brokenAt, expectedReplayRevision, context) =>
      runtime.submit({ kind: "record_replay_failure", replayVersionId, failure, brokenAt, expectedReplayRevision }, context),
    resumeCapabilityExploration: (capabilityId, expectedCapabilityRevision, context) =>
      runtime.submit({ kind: "resume_capability_exploration", capabilityId, expectedCapabilityRevision }, context),
    supersedeReplay: (replayVersionId, successorReplayVersionId, supersededAt, expectedReplayRevision, context) =>
      runtime.submit({ kind: "supersede_replay", replayVersionId, successorReplayVersionId, supersededAt, expectedReplayRevision }, context),
    startExecution: (execution, context) => runtime.submit({ kind: "start_execution", execution }, context),
    completeExecution: (executionId, completion, endedAt, expectedExecutionRevision, context) =>
      runtime.submit({ kind: "complete_execution", executionId, completion, endedAt, expectedExecutionRevision }, context),
  }

  return Object.freeze(adapter)
}

const requiredRuntimeMethods = [
  "readApplication",
  "readCapability",
  "readActiveReplay",
  "readReplayLineage",
  "readExperiment",
  "readEvidence",
  "readExecution",
  "readCompilationMetrics",
  "submit",
  "publishEvent",
] as const

function assertWorthRuntimePort(runtime: WorthRuntimePort): void {
  if (runtime === null || typeof runtime !== "object") {
    throw new TypeError("Worth runtime port must be an object")
  }

  const candidate = runtime as unknown as Record<string, unknown>
  for (const method of requiredRuntimeMethods) {
    if (typeof candidate[method] !== "function") {
      throw new TypeError(`Worth runtime port is missing ${method}()`)
    }
  }
}

function assertWorthQueryHostFacadeBinding(binding: unknown): asserts binding is WorthQueryHostFacadeBinding {
  if (binding === null || typeof binding !== "object") {
    throw new TypeError("Worth Query host-facade binding is required")
  }

  const candidate = binding as Record<string, unknown>
  if (candidate.boundary !== WORTH_QUERY_HOST_FACADE_BOUNDARY) {
    throw new TypeError(`Worth Query binding must enter through ${WORTH_QUERY_HOST_FACADE_BOUNDARY}`)
  }

  assertWorthRuntimePort(candidate.runtime as WorthRuntimePort)
}
