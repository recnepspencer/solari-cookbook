import type { InterfaceCompilerEvent } from "./events.js"
import type { EventId } from "./identity.js"
import type { OperationContext } from "./operation-context.js"

export interface EventPublisher {
  publish(event: InterfaceCompilerEvent, context: OperationContext): Promise<EventPublicationResult>
}

export type EventPublicationResult =
  | { readonly kind: "published"; readonly eventId: EventId }
  | { readonly kind: "duplicate"; readonly eventId: EventId }
  | { readonly kind: "cancelled"; readonly eventId: EventId }
  | { readonly kind: "deferred"; readonly eventId: EventId; readonly retry: "publisher_recovery_required" }
  | { readonly kind: "failed"; readonly eventId: EventId; readonly message: string; readonly retryable: boolean }
