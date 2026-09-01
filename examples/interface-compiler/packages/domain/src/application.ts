import type { ApplicationId } from "./identity.js"
import { invalid, isNonEmptyText, issue, valid, type ValidationIssue, type ValidationResult } from "./validation.js"

const applicationEntityBrand: unique symbol = Symbol("Application")

export interface ApplicationInput {
  readonly id: ApplicationId
  readonly name: string
  readonly baseUrl: string
}

export interface Application extends ApplicationInput {
  readonly [applicationEntityBrand]: true
}

export function validateApplication(input: ApplicationInput): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!input || typeof input !== "object") return [issue("application", "application must be an object")]

  if (!isNonEmptyText(input.id)) issues.push(issue("id", "application id must not be empty"))
  if (!isNonEmptyText(input.name)) issues.push(issue("name", "application name must not be empty"))

  if (!isNonEmptyText(input.baseUrl)) {
    issues.push(issue("baseUrl", "base URL must not be empty"))
  } else {
    try {
      const url = new URL(input.baseUrl)
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        issues.push(issue("baseUrl", "base URL must use HTTP or HTTPS"))
      }
      if (url.username || url.password) {
        issues.push(issue("baseUrl", "base URL must not contain credentials"))
      }
    } catch {
      issues.push(issue("baseUrl", "base URL must be an absolute URL"))
    }
  }

  return issues
}

export function createApplication(input: ApplicationInput): ValidationResult<Application> {
  const issues = validateApplication(input)
  return issues.length > 0 ? invalid(...issues) : valid(Object.freeze({ ...structuredClone(input), [applicationEntityBrand]: true as const }))
}
