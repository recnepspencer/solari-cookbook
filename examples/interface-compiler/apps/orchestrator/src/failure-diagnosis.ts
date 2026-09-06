import type { LocatorTarget, Observation, ReplayFailure, ReplayStep } from "@interface-compiler/domain"

export type ExecutionFailureClassification =
  | "precondition_failed"
  | "ui_drift"
  | "semantic_drift"
  | "application_unavailable"
  | "interaction_failed"
  | "provider_failure"
  | "indeterminate"

export type ReplayFailureDiagnosis =
  | {
      readonly kind: "repairable_drift"
      readonly classification: "ui_drift"
      readonly failure: ReplayFailure
    }
  | {
      readonly kind: "execution_incident"
      readonly classification: Exclude<ExecutionFailureClassification, "ui_drift" | "semantic_drift">
    }

/**
 * A browser error is not evidence of UI drift by itself. We only preserve a
 * replay failure when a same-origin observation proves that the replay's
 * semantic target is absent. Availability and ambiguous interaction failures
 * remain execution incidents and cannot trigger WORTH degradation.
 */
export function diagnoseReplayStepFailure(
  step: ReplayStep,
  observation: Observation,
  failure: ReplayFailure,
  applicationBaseUrl: string,
): ReplayFailureDiagnosis {
  if (!sameApplicationOrigin(observation.url, applicationBaseUrl)) {
    return { kind: "execution_incident", classification: "indeterminate" }
  }
  if (step.type === "navigate") {
    return { kind: "execution_incident", classification: "application_unavailable" }
  }
  if (step.type === "click" || step.type === "fill" || step.type === "select" || step.type === "read") {
    return observationContainsTarget(observation, step.target)
      ? { kind: "execution_incident", classification: "interaction_failed" }
      : { kind: "repairable_drift", classification: "ui_drift", failure }
  }
  return { kind: "execution_incident", classification: "provider_failure" }
}

export function observationContainsTarget(observation: Observation, target: LocatorTarget): boolean {
  const expectedRole = normalized(target.role)
  const expectedNames = [target.name, target.text, target.semanticDescription]
    .map(normalized)
    .filter((value): value is string => value !== undefined)

  return observation.interactables.some((interactable) => {
    const roleMatches = expectedRole === undefined || normalized(interactable.role) === expectedRole
    if (!roleMatches) return false
    const candidates = [interactable.name, interactable.text, interactable.semanticGuess]
      .map(normalized)
      .filter((value): value is string => value !== undefined)
    return expectedNames.some((expected) => candidates.includes(expected))
  })
}

function normalized(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const result = value.replace(/\s+/g, " ").trim().toLowerCase()
  return result.length === 0 ? undefined : result
}

function sameApplicationOrigin(observationUrl: string, applicationBaseUrl: string): boolean {
  try {
    const observation = new URL(observationUrl)
    const application = new URL(applicationBaseUrl)
    return observation.origin === application.origin && observation.username === "" && observation.password === ""
  } catch {
    return false
  }
}
