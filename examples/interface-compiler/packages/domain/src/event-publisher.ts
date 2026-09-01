import type { InterfaceCompilerEvent } from "./events.js"
import type { EventId } from "./identity.js"
import type { OperationContext } from "./operation-context.js"

export interface EventPublisher {
  publish(event: InterfaceCompilerEvent, context: OperationContext): Promise<EventPublicationResult>
}

export type EventPublicationResult =
  | { readonly kind: "published"; readonly eventId: EventId; readonly effect: { readonly kind: "completed" } }
  | { readonly kind: "duplicate"; readonly eventId: EventId; readonly effect: { readonly kind: "completed" } }
  | { readonly kind: "cancelled"; readonly eventId: EventId; readonly effect: { readonly kind: "unknown"; readonly recovery: "owner_reconciliation_required" } }
  | { readonly kind: "deferred"; readonly eventId: EventId; readonly retry: "publisher_recovery_required"; readonly effect: { readonly kind: "unknown"; readonly recovery: "owner_reconciliation_required" } }
  | { readonly kind: "failed"; readonly eventId: EventId; readonly message: string; readonly retryable: boolean; readonly effect: { readonly kind: "unknown"; readonly recovery: "owner_reconciliation_required" } }
