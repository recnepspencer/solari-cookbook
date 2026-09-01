import { createHash } from "node:crypto"
import type {
  Clock,
  EventPublicationResult,
  EventPublisher,
  IdSource,
  InterfaceCompilerEvent,
  InterfaceCompilerEventMap,
  InterfaceCompilerEventType,
  PartialEffectPosture,
} from "@interface-compiler/domain"
import type { OperationController, RuntimeStop } from "./operation.js"
import { type RuntimeEventPublication } from "./session-runner.js"

/** Publishes an event only while the delegated operation can still transfer control. */
export async function publishRuntimeEvent<T extends InterfaceCompilerEventType>(
  publisher: EventPublisher,
  ids: Pick<IdSource, "nextEventId">,
  clock: Clock,
  controller: OperationController,
  receipts: EventPublicationResult[],
  type: T,
  payload: InterfaceCompilerEventMap[T],
  idempotencyKey: string,
): Promise<RuntimeEventPublication> {
  const initialGate = controller.check()
  if (initialGate.kind === "stop") return { kind: "stopped", stop: initialGate.stop }
  if (typeof idempotencyKey !== "string" || idempotencyKey.trim().length === 0) return { kind: "failed", message: "event idempotency key is invalid", posture: { kind: "not_started" } }

  let eventId: ReturnType<IdSource["nextEventId"]>
  let event: InterfaceCompilerEvent
  try {
    eventId = ids.nextEventId()
    event = createEvent(eventId, clock.now(), type, payload, idempotencyKey)
  } catch {
    return { kind: "failed", message: "event identity or clock failed", posture: { kind: "not_started" } }
  }

  const publicationGate = controller.check()
  if (publicationGate.kind === "stop") return { kind: "stopped", stop: publicationGate.stop }
  try {
    const publication = await publisher.publish(event, controller.context)
    receipts.push(publication)
    switch (publication.kind) {
      case "published":
      case "duplicate":
        return { kind: "published" }
      case "cancelled":
        return { kind: "stopped", stop: cancelledStop(publication.effect) }
      case "deferred":
        return { kind: "failed", message: "event publication was deferred for Worth recovery", posture: publication.effect }
      case "failed":
        return { kind: "failed", message: publication.message, posture: publication.effect }
    }
  } catch {
    receipts.push({
      kind: "failed",
      eventId,
      message: "event publisher failed",
      retryable: true,
      effect: { kind: "unknown", recovery: "owner_reconciliation_required" },
    })
    return { kind: "failed", message: "event publisher failed", posture: { kind: "unknown", recovery: "owner_reconciliation_required" } }
  }
}

function createEvent<T extends InterfaceCompilerEventType>(
  eventId: ReturnType<IdSource["nextEventId"]>,
  occurredAt: InterfaceCompilerEvent["occurredAt"],
  type: T,
  payload: InterfaceCompilerEventMap[T],
  idempotencyKey: string,
): InterfaceCompilerEvent {
  const unsigned = {
    eventId,
    occurredAt,
    protocol: "interface-compiler.events" as const,
    schemaVersion: 1 as const,
    idempotencyKey,
    recovery: "replay_safe" as const,
    type,
    payload,
  }
  const integrity = { algorithm: "sha256" as const, digest: createHash("sha256").update(canonicalJson(unsigned)).digest("hex") }
  return Object.freeze({ ...unsigned, integrity }) as InterfaceCompilerEvent
}

export function eventIdempotencyKey(type: InterfaceCompilerEventType, logicalIdentity: string): string {
  return `${type}:${logicalIdentity}`
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`
}

function cancelledStop(effect: PartialEffectPosture): RuntimeStop {
  return {
    kind: "cancelled",
    terminal: true,
    safePoint: effect.kind === "not_started" ? "before_effect" : "after_effect",
    posture: effect,
  }
}
