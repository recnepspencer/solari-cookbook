import type { IsoTimestamp, ObservationId, SessionId } from "./identity.js"
import { invalid, isIsoTimestamp, isNonEmptyText, isRecord, issue, valid, type ValidationIssue, type ValidationResult } from "./validation.js"

export type InteractableKind = "link" | "button" | "input" | "select" | "form" | "table" | "other"

export interface Interactable {
  readonly kind: InteractableKind
  readonly role?: string
  readonly name?: string
  readonly text?: string
  readonly semanticGuess?: string
}

export interface Observation {
  readonly id: ObservationId
  readonly sessionId: SessionId
  readonly url: string
  readonly title?: string
  readonly pageSummary?: string
  readonly interactables: readonly Interactable[]
  readonly screenshotRef?: string
  readonly snapshotRef?: string
  readonly observedAt: IsoTimestamp
}

export function normalizeObservation(input: Observation): ValidationResult<Observation> {
  const issues = validateObservation(input)
  return issues.length > 0
    ? invalid(...issues)
    : valid(
        Object.freeze({
          ...input,
          interactables: Object.freeze(input.interactables.map((interactable) => Object.freeze({ ...interactable }))),
        }),
      )
}

export function findInteractables(observation: Observation, semanticDescription: string): readonly Interactable[] {
  if (!isRecord(observation) || !Array.isArray(observation.interactables) || !isNonEmptyText(semanticDescription)) return []
  const expected = semanticDescription.trim().toLowerCase()
  if (expected.length === 0) return []

  return observation.interactables.filter((interactable) => {
    if (!isRecord(interactable)) return false
    const candidates = [interactable.semanticGuess, interactable.name, interactable.text]
    return candidates.some((candidate) => typeof candidate === "string" && candidate.trim().toLowerCase() === expected)
  })
}

export function validateObservation(input: Observation): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!input || typeof input !== "object") return [issue("observation", "observation must be an object")]
  if (!isNonEmptyText(input.id)) issues.push(issue("id", "observation id must not be empty"))
  if (!isNonEmptyText(input.sessionId)) issues.push(issue("sessionId", "session id must not be empty"))
  if (!isNonEmptyText(input.url)) issues.push(issue("url", "observation URL must not be empty"))
  if (!isIsoTimestamp(input.observedAt)) issues.push(issue("observedAt", "observedAt must be a timestamp"))
  if (!Array.isArray(input.interactables)) {
    issues.push(issue("interactables", "interactables must be an array"))
  } else {
    input.interactables.forEach((interactable, index) => issues.push(...validateInteractable(interactable, index)))
  }
  for (const [field, value] of [["title", input.title], ["pageSummary", input.pageSummary], ["screenshotRef", input.screenshotRef], ["snapshotRef", input.snapshotRef]] as const) {
    if (value !== undefined && typeof value !== "string") issues.push(issue(field, `${field} must be a string when present`))
  }
  return issues
}

function validateInteractable(interactable: Interactable, index: number): readonly ValidationIssue[] {
  const value = interactable as unknown
  if (!value || typeof value !== "object") return [issue(`interactables[${index}]`, "interactable must be an object")]
  const record = value as Record<string, unknown>
  if (!isInteractableKind(record.kind)) return [issue(`interactables[${index}].kind`, "interactable kind is not recognized")]
  return ["role", "name", "text", "semanticGuess"].flatMap((field) =>
    record[field] === undefined || typeof record[field] === "string" ? [] : [issue(`interactables[${index}].${field}`, `${field} must be a string when present`)],
  )
}

function isInteractableKind(value: unknown): value is InteractableKind {
  return value === "link" || value === "button" || value === "input" || value === "select" || value === "form" || value === "table" || value === "other"
}
