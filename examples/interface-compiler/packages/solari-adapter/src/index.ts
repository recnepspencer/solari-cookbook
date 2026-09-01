export { createSolariPortFromEnv, type SolariPortCreationResult, type SolariPortEnvironmentOptions } from "./solari-port.js"
export { readSolariConfig, type SolariAdapterConfig, type SolariRegion } from "./configuration.js"
export {
  classifySolariFailure,
  discardTelemetry,
  failure,
  type RedactedSolariFailure,
  type RedactedSolariTelemetryEvent,
  type SolariFailureCode,
  type SolariTelemetryOperation,
  type SolariTelemetryOutcome,
  type TelemetrySink,
} from "./telemetry.js"

export type {
  EvidenceCaptureRequest,
  EvidenceReference,
  SolariCloseResult,
  SolariEvidenceResult,
  SolariObservationResult,
  SolariPort,
  SolariSession,
  SolariSessionLease,
  SolariSessionRequest,
  SolariSessionResult,
  SolariStepResult,
} from "@interface-compiler/domain"

import type {
  EvidenceCaptureRequest,
  OperationContext,
  ReplayStep,
  SolariSession,
  SolariSessionLease,
  SolariSessionRequest,
  SolariSessionResult,
  SolariStepResult,
  SolariObservationResult,
  SolariEvidenceResult,
  SolariCloseResult,
  SolariPort,
} from "@interface-compiler/domain"

export function createBrowser(port: SolariPort, request: SolariSessionRequest, context: OperationContext): Promise<SolariSessionResult> {
  return port.createSession(request, context)
}

export function navigate(browser: SolariSession, step: Extract<ReplayStep, { readonly type: "navigate" }>, context: OperationContext): Promise<SolariStepResult> {
  return browser.executeStep(step, context)
}

export function observe(browser: SolariSession, context: OperationContext): Promise<SolariObservationResult> {
  return browser.observe(context)
}

export function executeStep(browser: SolariSession, step: ReplayStep, context: OperationContext): Promise<SolariStepResult> {
  return browser.executeStep(step, context)
}

export function captureEvidence(browser: SolariSession, request: EvidenceCaptureRequest, context: OperationContext): Promise<SolariEvidenceResult> {
  return browser.captureEvidence(request, context)
}

export function closeBrowser(lease: SolariSessionLease, context: OperationContext): Promise<SolariCloseResult> {
  return lease.release(context)
}
