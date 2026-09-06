import type { Application } from "./application.js"
import type { ExecutionId, EvidenceId, ObservationId, SessionId } from "./identity.js"
import type { Observation } from "./observation.js"
import type { OperationContext, PartialEffectPosture } from "./operation-context.js"
import type { ReplayFailure, ReplayStep } from "./replay.js"

export type SolariSessionPurpose = "direct" | "exploration" | "verification" | "replay"
export type SessionFreshness = "fresh" | "reused"

export interface SolariSessionRequest {
  readonly application: Application
  readonly purpose: SolariSessionPurpose
  readonly freshness: SessionFreshness
  readonly executionId?: ExecutionId
}

export type SolariStepResult =
  | { readonly kind: "completed"; readonly observation?: Observation; readonly effect: { readonly kind: "completed" } }
  | { readonly kind: "failed"; readonly failure: ReplayFailure; readonly effect: PartialEffectPosture }
  | {
      readonly kind: "cancelled"
      readonly safePoint: "before_step" | "after_step"
      readonly effect: PartialEffectPosture
    }
  | { readonly kind: "timed_out"; readonly effect: PartialEffectPosture }

export type SolariObservationResult =
  | { readonly kind: "observed"; readonly observation: Observation; readonly effect: { readonly kind: "completed" } }
  | { readonly kind: "cancelled"; readonly effect: { readonly kind: "not_started" } }
  | { readonly kind: "timed_out"; readonly effect: { readonly kind: "not_started" } }
  | { readonly kind: "failed"; readonly message: string; readonly retryable: boolean; readonly effect: { readonly kind: "not_started" } }

export type EvidenceCaptureRequest =
  | { readonly kind: "session_recording" }
  | { readonly kind: "session_receipt" }
  | { readonly kind: "screenshot"; readonly observationId: ObservationId }
  | { readonly kind: "snapshot"; readonly observationId: ObservationId }

export interface EvidenceReference {
  readonly evidenceId: EvidenceId
  readonly kind: EvidenceCaptureRequest["kind"]
  readonly externalRef: string
}

export type SolariEvidenceResult =
  | { readonly kind: "captured"; readonly reference: EvidenceReference; readonly effect: { readonly kind: "completed" } }
  | { readonly kind: "cancelled"; readonly effect: PartialEffectPosture }
  | { readonly kind: "timed_out"; readonly effect: PartialEffectPosture }
  | { readonly kind: "failed"; readonly message: string; readonly retryable: boolean; readonly effect: PartialEffectPosture }

export type SolariCloseResult =
  | { readonly kind: "closed"; readonly sessionId: SessionId; readonly effect: { readonly kind: "completed" } }
  | { readonly kind: "close_failed"; readonly message: string; readonly retryable: boolean; readonly effect: PartialEffectPosture }

export type SolariSessionResult =
  | { readonly kind: "created"; readonly lease: SolariSessionLease; readonly effect: { readonly kind: "completed" } }
  | { readonly kind: "denied"; readonly reason: "budget_exhausted" | "application_unavailable" | "backpressure"; readonly effect: { readonly kind: "not_started" } }
  | { readonly kind: "cancelled"; readonly effect: PartialEffectPosture }
  | { readonly kind: "timed_out"; readonly effect: PartialEffectPosture }
  | { readonly kind: "failed"; readonly message: string; readonly retryable: boolean; readonly effect: PartialEffectPosture }

/** Neutral browser contract; a Solari adapter owns session effects and release. */
export interface SolariSession {
  readonly sessionId: SessionId
  observe(context: OperationContext): Promise<SolariObservationResult>
  executeStep(step: ReplayStep, context: OperationContext, stepIndex?: number): Promise<SolariStepResult>
  captureEvidence(request: EvidenceCaptureRequest, context: OperationContext): Promise<SolariEvidenceResult>
}

/** The creating adapter owns this lease; release must be called exactly once by the caller. */
export interface SolariSessionLease {
  readonly session: SolariSession
  release(context: OperationContext): Promise<SolariCloseResult>
}

export interface SolariPort {
  createSession(request: SolariSessionRequest, context: OperationContext): Promise<SolariSessionResult>
}
