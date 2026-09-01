/** Stable identifiers and timestamps shared by domain contracts. */

const applicationIdBrand: unique symbol = Symbol("ApplicationId")
const capabilityIdBrand: unique symbol = Symbol("CapabilityId")
const replayVersionIdBrand: unique symbol = Symbol("ReplayVersionId")
const experimentIdBrand: unique symbol = Symbol("ExperimentId")
const evidenceIdBrand: unique symbol = Symbol("EvidenceId")
const executionIdBrand: unique symbol = Symbol("ExecutionId")
const eventIdBrand: unique symbol = Symbol("EventId")
const sessionIdBrand: unique symbol = Symbol("SessionId")
const observationIdBrand: unique symbol = Symbol("ObservationId")
const verificationRunIdBrand: unique symbol = Symbol("VerificationRunId")
const operationIdBrand: unique symbol = Symbol("OperationId")

export type ApplicationId = string & { readonly [applicationIdBrand]: true }
export type CapabilityId = string & { readonly [capabilityIdBrand]: true }
export type ReplayVersionId = string & { readonly [replayVersionIdBrand]: true }
export type ExperimentId = string & { readonly [experimentIdBrand]: true }
export type EvidenceId = string & { readonly [evidenceIdBrand]: true }
export type ExecutionId = string & { readonly [executionIdBrand]: true }
export type EventId = string & { readonly [eventIdBrand]: true }
export type SessionId = string & { readonly [sessionIdBrand]: true }
export type ObservationId = string & { readonly [observationIdBrand]: true }
export type VerificationRunId = string & { readonly [verificationRunIdBrand]: true }
export type OperationId = string & { readonly [operationIdBrand]: true }
export type IsoTimestamp = string

export type IdentifierKind =
  | "application"
  | "capability"
  | "replay_version"
  | "experiment"
  | "evidence"
  | "execution"
  | "event"
  | "session"
  | "observation"
  | "verification_run"
  | "operation"
