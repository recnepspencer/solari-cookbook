import type { LocatorTarget, ReplayStep } from "@interface-compiler/domain"
import type { SolariSdkLocator, SolariSdkPage } from "./solari-sdk.js"

export type ReplayStepValue = { readonly kind: "none" }

export class ReplayStepExecutionError extends Error {
  readonly code: "navigation_denied" | "locator_unavailable" | "unsupported_step"

  constructor(code: "navigation_denied" | "locator_unavailable" | "unsupported_step") {
    super(code)
    this.name = "ReplayStepExecutionError"
    this.code = code
  }
}

export async function executeReplayStepOnPage(page: SolariSdkPage, step: ReplayStep, applicationOrigin: string): Promise<ReplayStepValue> {
  switch (step.type) {
    case "navigate":
      assertApplicationNavigation(step.url, applicationOrigin)
      await page.goto(step.url)
      return { kind: "none" }
    case "click":
      await resolveLocator(page, step.target).click()
      return { kind: "none" }
    case "fill":
      await resolveLocator(page, step.target).fill(step.value)
      return { kind: "none" }
    case "select":
      await resolveLocator(page, step.target).selectOption(step.value)
      return { kind: "none" }
    case "wait":
      await waitForMilliseconds(step.milliseconds)
      return { kind: "none" }
    case "read":
      throw new ReplayStepExecutionError("unsupported_step")
    case "assert":
      // Postcondition semantics belong to the replay engine. The adapter returns the current observation for that owner.
      return { kind: "none" }
  }
}

function resolveLocator(page: SolariSdkPage, target: LocatorTarget): SolariSdkLocator {
  const accessibleName = target.name ?? target.text ?? target.semanticDescription
  if (target.role !== undefined && page.getByRole !== undefined) return page.getByRole(target.role, { name: accessibleName })
  if (target.name !== undefined && page.getByLabel !== undefined) return page.getByLabel(target.name)
  if (target.text !== undefined && page.getByText !== undefined) return page.getByText(target.text)
  if (target.selector !== undefined) return page.locator(target.selector)
  if (page.getByText !== undefined) return page.getByText(target.semanticDescription)
  throw new ReplayStepExecutionError("locator_unavailable")
}

function assertApplicationNavigation(url: string, applicationOrigin: string): void {
  let target: URL
  try {
    target = new URL(url)
  } catch {
    throw new ReplayStepExecutionError("navigation_denied")
  }
  if (target.origin !== applicationOrigin || target.username !== "" || target.password !== "") throw new ReplayStepExecutionError("navigation_denied")
}

function waitForMilliseconds(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
