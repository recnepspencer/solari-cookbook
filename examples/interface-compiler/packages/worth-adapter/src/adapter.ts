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
import type { WorthMetricsQueries, WorthRuntimePort } from "./worth-runtime-port.js"

type CommandOf<Kind extends WorthCommand["kind"]> = Extract<WorthCommand, { readonly kind: Kind }>

/** Typed command helpers that submit lifecycle intent to Worth. */
export interface WorthLifecycleCommands {
  registerApplication(application: CommandOf<"register_application">["application"], context: OperationContext): Promise<WorthSubmissionResult>
  registerCapability(definition: CommandOf<"register_capability">["definition"], context: OperationContext): Promise<WorthSubmissionResult>
  recordReplayCandidate(candidate: CommandOf<"record_replay_candidate">["candidate"], context: OperationContext): Promise<WorthSubmissionResult>
  beginReplayVerification(replayVersionId: ReplayVersionId, requiredSuccessfulRuns: number, context: OperationContext): Promise<WorthSubmissionResult>
  recordVerificationRun(replayVersionId: ReplayVersionId, receipt: VerificationRunReceipt, context: OperationContext): Promise<WorthSubmissionResult>
  completeReplayVerification(replayVersionId: ReplayVersionId, verifiedAt: IsoTimestamp, context: OperationContext): Promise<WorthSubmissionResult>
  beginCapabilityVerification(capabilityId: CapabilityId, candidateReplayVersionId: ReplayVersionId, context: OperationContext): Promise<WorthSubmissionResult>
  activateCapability(capabilityId: CapabilityId, activeReplayVersionId: ReplayVersionId, context: OperationContext): Promise<WorthSubmissionResult>
  failCapabilityVerification(capabilityId: CapabilityId, brokenReplayVersionId: ReplayVersionId, context: OperationContext): Promise<WorthSubmissionResult>
  recordReplayFailure(replayVersionId: ReplayVersionId, failure: ReplayFailure, brokenAt: IsoTimestamp, context: OperationContext): Promise<WorthSubmissionResult>
  resumeCapabilityExploration(capabilityId: CapabilityId, context: OperationContext): Promise<WorthSubmissionResult>
  supersedeReplay(replayVersionId: ReplayVersionId, successorReplayVersionId: ReplayVersionId, supersededAt: IsoTimestamp, context: OperationContext): Promise<WorthSubmissionResult>
  startExecution(execution: ExecutionStart, context: OperationContext): Promise<WorthSubmissionResult>
  completeExecution(executionId: ExecutionId, completion: ExecutionCompletion, endedAt: IsoTimestamp, context: OperationContext): Promise<WorthSubmissionResult>
}

/**
 * Public Worth boundary consumed by later Interface Compiler workstreams.
 *
 * The object contains no registry, cache, reducer, event bus, or persistence.
 * Every operation below is sent to the injected Worth runtime, which remains
 * the authority for currentness and legal lifecycle transitions.
 */
export interface WorthAdapter extends WorthAuthority, EventPublisher, WorthLifecycleCommands, WorthMetricsQueries {}

export function createWorthAdapter(runtime: WorthRuntimePort): WorthAdapter {
  assertWorthRuntimePort(runtime)

  const adapter: WorthAdapter = {
    readApplication: (applicationId, context) => runtime.readApplication(applicationId, context),
    readCapability: (capabilityId, context) => runtime.readCapability(capabilityId, context),
    readActiveReplay: (capabilityId, context) => runtime.readActiveReplay(capabilityId, context),
    readReplayLineage: (capabilityId, context) => runtime.readReplayLineage(capabilityId, context),
    readExecution: (executionId, context) => runtime.readExecution(executionId, context),
    readCompilationMetrics: (capabilityId, context) => runtime.readCompilationMetrics(capabilityId, context),
    submit: (command, context) => runtime.submit(command, context),
    publish: (event, context) => runtime.publishEvent(event, context),

    registerApplication: (application: Application, context) => runtime.submit({ kind: "register_application", application }, context),
    registerCapability: (definition: CapabilityDefinition, context) => runtime.submit({ kind: "register_capability", definition }, context),
    recordReplayCandidate: (candidate: CandidateReplay, context) => runtime.submit({ kind: "record_replay_candidate", candidate }, context),
    beginReplayVerification: (replayVersionId, requiredSuccessfulRuns, context) =>
      runtime.submit({ kind: "begin_replay_verification", replayVersionId, requiredSuccessfulRuns }, context),
    recordVerificationRun: (replayVersionId, receipt, context) =>
      runtime.submit({ kind: "record_verification_run", replayVersionId, receipt }, context),
    completeReplayVerification: (replayVersionId, verifiedAt, context) =>
      runtime.submit({ kind: "complete_replay_verification", replayVersionId, verifiedAt }, context),
    beginCapabilityVerification: (capabilityId, candidateReplayVersionId, context) =>
      runtime.submit({ kind: "begin_capability_verification", capabilityId, candidateReplayVersionId }, context),
    activateCapability: (capabilityId, activeReplayVersionId, context) =>
      runtime.submit({ kind: "activate_capability", capabilityId, activeReplayVersionId }, context),
    failCapabilityVerification: (capabilityId, brokenReplayVersionId, context) =>
      runtime.submit({ kind: "fail_capability_verification", capabilityId, brokenReplayVersionId }, context),
    recordReplayFailure: (replayVersionId, failure, brokenAt, context) =>
      runtime.submit({ kind: "record_replay_failure", replayVersionId, failure, brokenAt }, context),
    resumeCapabilityExploration: (capabilityId, context) => runtime.submit({ kind: "resume_capability_exploration", capabilityId }, context),
    supersedeReplay: (replayVersionId, successorReplayVersionId, supersededAt, context) =>
      runtime.submit({ kind: "supersede_replay", replayVersionId, successorReplayVersionId, supersededAt }, context),
    startExecution: (execution, context) => runtime.submit({ kind: "start_execution", execution }, context),
    completeExecution: (executionId, completion, endedAt, context) =>
      runtime.submit({ kind: "complete_execution", executionId, completion, endedAt }, context),
  }

  return Object.freeze(adapter)
}

const requiredRuntimeMethods = [
  "readApplication",
  "readCapability",
  "readActiveReplay",
  "readReplayLineage",
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
