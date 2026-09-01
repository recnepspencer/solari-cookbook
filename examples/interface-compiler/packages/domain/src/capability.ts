import type { ApplicationId, CapabilityId, ReplayVersionId } from "./identity.js"
import { isActiveReplay, isBrokenReplay, isCandidateReplay, validateReplayFailure, type ActiveReplay, type BrokenReplay, type CandidateReplay, type ReplayFailure } from "./replay.js"
import { copyCondition, copyJsonSchema, validateCondition, validateJsonSchema, type Condition, type JsonSchema } from "./schema.js"
import { invalid, isNonEmptyText, isRecord, issue, valid, type ValidationResult } from "./validation.js"

const discoveringCapabilityBrand: unique symbol = Symbol("DiscoveringCapability")
const verifyingCapabilityBrand: unique symbol = Symbol("VerifyingCapability")
const healthyCapabilityBrand: unique symbol = Symbol("HealthyCapability")
const degradedCapabilityBrand: unique symbol = Symbol("DegradedCapability")

const discoveringCapabilityInstances = new WeakSet<object>()
const verifyingCapabilityInstances = new WeakSet<object>()
const healthyCapabilityInstances = new WeakSet<object>()
const degradedCapabilityInstances = new WeakSet<object>()

export interface CapabilityDefinition {
  readonly id: CapabilityId
  readonly applicationId: ApplicationId
  readonly name: string
  readonly description: string
  readonly inputSchema: JsonSchema
  readonly outputSchema: JsonSchema
  readonly preconditions: readonly Condition[]
  readonly postconditions: readonly Condition[]
}

interface CapabilityCore extends CapabilityDefinition {
  readonly preconditions: readonly Condition[]
  readonly postconditions: readonly Condition[]
}

export type DiscoveryReason =
  | { readonly kind: "initial" }
  | {
      readonly kind: "reexploration"
      readonly previousReplayVersionId: ReplayVersionId
      readonly failure: ReplayFailure
    }
  | {
      readonly kind: "verification_failed"
      readonly candidateReplayVersionId: ReplayVersionId
      readonly failure: ReplayFailure
    }

export interface DiscoveringCapability extends CapabilityCore {
  readonly status: "discovering"
  readonly discovery: DiscoveryReason
  readonly [discoveringCapabilityBrand]: true
}

export interface VerifyingCapability extends CapabilityCore {
  readonly status: "verifying"
  readonly candidateReplayVersionId: ReplayVersionId
  readonly [verifyingCapabilityBrand]: true
}

export interface HealthyCapability extends CapabilityCore {
  readonly status: "healthy"
  readonly activeReplayVersionId: ReplayVersionId
  readonly [healthyCapabilityBrand]: true
}

export interface DegradedCapability extends CapabilityCore {
  readonly status: "degraded"
  readonly brokenReplayVersionId: ReplayVersionId
  readonly failure: ReplayFailure
  readonly mode: "exploratory"
  readonly [degradedCapabilityBrand]: true
}

export type Capability = DiscoveringCapability | VerifyingCapability | HealthyCapability | DegradedCapability

export function createCapability(input: CapabilityDefinition): ValidationResult<DiscoveringCapability> {
  const issues = validateCapabilityDefinition(input)
  const result = issues.length > 0
    ? invalid(...issues)
    : valid(
        Object.freeze({
          ...capabilityCore(input),
          status: "discovering" as const,
          discovery: Object.freeze({ kind: "initial" as const }),
          preconditions: Object.freeze(input.preconditions.map(copyCondition)),
          postconditions: Object.freeze(input.postconditions.map(copyCondition)),
          [discoveringCapabilityBrand]: true as const,
        }),
      )
  if (result.ok) discoveringCapabilityInstances.add(result.value)
  return result
}

export function beginCapabilityVerification(
  capability: DiscoveringCapability,
  candidate: CandidateReplay,
): ValidationResult<VerifyingCapability> {
  if (!isIssuedCapability(capability, discoveringCapabilityInstances, discoveringCapabilityBrand, "discovering")) {
    return invalid(issue("capability", "discovering capability must come from createCapability or a domain transition"))
  }
  if (!isCandidateReplay(candidate)) {
    return invalid(issue("candidate", "candidate replay must come from the replay lifecycle"))
  }
  if (candidate.capabilityId !== capability.id) {
    return invalid(issue("candidate.capabilityId", "candidate replay belongs to a different capability"))
  }

  const result = valid(
    Object.freeze({
      ...capabilityCore(capability),
      status: "verifying" as const,
      candidateReplayVersionId: candidate.id,
      [verifyingCapabilityBrand]: true as const,
    }),
  )
  if (result.ok) verifyingCapabilityInstances.add(result.value)
  return result
}

export function activateCapability(
  capability: VerifyingCapability,
  replay: ActiveReplay,
): ValidationResult<HealthyCapability> {
  if (!isIssuedCapability(capability, verifyingCapabilityInstances, verifyingCapabilityBrand, "verifying")) {
    return invalid(issue("capability", "verifying capability must come from beginCapabilityVerification"))
  }
  if (!isActiveReplay(replay)) {
    return invalid(issue("replay", "active replay must come from completeReplayVerification"))
  }
  if (replay.capabilityId !== capability.id) {
    return invalid(issue("replay.capabilityId", "active replay belongs to a different capability"))
  }
  if (replay.id !== capability.candidateReplayVersionId) {
    return invalid(issue("replay.id", "active replay must be the capability's verifying candidate"))
  }

  const result = valid(
    Object.freeze({
      ...capabilityCore(capability),
      status: "healthy" as const,
      activeReplayVersionId: replay.id,
      [healthyCapabilityBrand]: true as const,
    }),
  )
  if (result.ok) healthyCapabilityInstances.add(result.value)
  return result
}

export function failCapabilityVerification(
  capability: VerifyingCapability,
  replay: BrokenReplay,
): ValidationResult<DiscoveringCapability> {
  if (!isIssuedCapability(capability, verifyingCapabilityInstances, verifyingCapabilityBrand, "verifying")) {
    return invalid(issue("capability", "verifying capability must come from beginCapabilityVerification"))
  }
  if (!isBrokenReplay(replay)) {
    return invalid(issue("replay", "broken replay must come from the replay lifecycle"))
  }
  if (replay.capabilityId !== capability.id) {
    return invalid(issue("replay.capabilityId", "broken replay belongs to a different capability"))
  }
  if (replay.id !== capability.candidateReplayVersionId) {
    return invalid(issue("replay.id", "broken replay must be the capability's verifying candidate"))
  }

  const result = valid(
    Object.freeze({
      ...capabilityCore(capability),
      status: "discovering" as const,
      discovery: Object.freeze({
        kind: "verification_failed" as const,
        candidateReplayVersionId: replay.id,
        failure: replay.failure,
      }),
      [discoveringCapabilityBrand]: true as const,
    }),
  )
  if (result.ok) discoveringCapabilityInstances.add(result.value)
  return result
}

export function degradeCapability(
  capability: HealthyCapability,
  replay: BrokenReplay,
): ValidationResult<DegradedCapability> {
  if (!isIssuedCapability(capability, healthyCapabilityInstances, healthyCapabilityBrand, "healthy")) {
    return invalid(issue("capability", "healthy capability must come from activateCapability"))
  }
  if (!isBrokenReplay(replay)) {
    return invalid(issue("replay", "broken replay must come from the replay lifecycle"))
  }
  if (replay.capabilityId !== capability.id) {
    return invalid(issue("replay.capabilityId", "broken replay belongs to a different capability"))
  }
  if (replay.id !== capability.activeReplayVersionId) {
    return invalid(issue("replay.id", "broken replay must be the active replay"))
  }

  const result = valid(
    Object.freeze({
      ...capabilityCore(capability),
      status: "degraded" as const,
      brokenReplayVersionId: replay.id,
      failure: replay.failure,
      mode: "exploratory" as const,
      [degradedCapabilityBrand]: true as const,
    }),
  )
  if (result.ok) degradedCapabilityInstances.add(result.value)
  return result
}

export function resumeCapabilityExploration(capability: DegradedCapability): ValidationResult<DiscoveringCapability> {
  if (!isIssuedCapability(capability, degradedCapabilityInstances, degradedCapabilityBrand, "degraded")) {
    return invalid(issue("capability", "degraded capability must come from degradeCapability"))
  }
  const result = valid(
    Object.freeze({
      ...capabilityCore(capability),
      status: "discovering" as const,
      discovery: Object.freeze({
        kind: "reexploration" as const,
        previousReplayVersionId: capability.brokenReplayVersionId,
        failure: capability.failure,
      }),
      [discoveringCapabilityBrand]: true as const,
    }),
  )
  if (result.ok) discoveringCapabilityInstances.add(result.value)
  return result
}

function capabilityCore(input: CapabilityDefinition): CapabilityCore {
  return Object.freeze({
    id: input.id,
    applicationId: input.applicationId,
    name: input.name,
    description: input.description,
    inputSchema: copyJsonSchema(input.inputSchema),
    outputSchema: copyJsonSchema(input.outputSchema),
    preconditions: Object.freeze(input.preconditions.map(copyCondition)),
    postconditions: Object.freeze(input.postconditions.map(copyCondition)),
  })
}

export function validateCapabilityDefinition(input: CapabilityDefinition): ReturnType<typeof issue>[] {
  const issues: ReturnType<typeof issue>[] = []
  if (!isRecord(input)) return [issue("capability", "capability must be an object")]
  if (!isNonEmptyText(input.id)) issues.push(issue("id", "capability id must not be empty"))
  if (!isNonEmptyText(input.applicationId)) issues.push(issue("applicationId", "application id must not be empty"))
  if (!isNonEmptyText(input.name)) issues.push(issue("name", "capability name must not be empty"))
  if (!isNonEmptyText(input.description)) issues.push(issue("description", "capability description must not be empty"))
  if (!input.inputSchema || typeof input.inputSchema !== "object") issues.push(issue("inputSchema", "input schema is required"))
  else issues.push(...validateJsonSchema(input.inputSchema, "inputSchema"))
  if (!input.outputSchema || typeof input.outputSchema !== "object") issues.push(issue("outputSchema", "output schema is required"))
  else issues.push(...validateJsonSchema(input.outputSchema, "outputSchema"))
  if (!Array.isArray(input.preconditions)) {
    issues.push(issue("preconditions", "preconditions must be an array"))
  } else {
    input.preconditions.forEach((condition, index) => issues.push(...validateCondition(condition, `preconditions[${index}]`)))
  }
  if (!Array.isArray(input.postconditions)) {
    issues.push(issue("postconditions", "postconditions must be an array"))
  } else {
    input.postconditions.forEach((condition, index) => issues.push(...validateCondition(condition, `postconditions[${index}]`)))
  }
  return issues
}

function hasBrand(value: unknown, brand: symbol): boolean {
  return value !== null && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, brand) && (value as Record<symbol, unknown>)[brand] === true
}

function isIssuedCapability(
  value: unknown,
  instances: WeakSet<object>,
  brand: symbol,
  status: Capability["status"],
): boolean {
  if (value === null || typeof value !== "object" || !instances.has(value) || !hasBrand(value, brand) || (value as Record<string, unknown>).status !== status) return false
  if (validateCapabilityDefinition(value as CapabilityDefinition).length > 0) return false
  const record = value as Record<string, unknown>
  switch (status) {
    case "discovering":
      return validateDiscoveryReason(record.discovery)
    case "verifying":
      return isNonEmptyText(record.candidateReplayVersionId)
    case "healthy":
      return isNonEmptyText(record.activeReplayVersionId)
    case "degraded":
      return isNonEmptyText(record.brokenReplayVersionId) && record.mode === "exploratory" && validateReplayFailure(record.failure).length === 0
  }
}

function validateDiscoveryReason(value: unknown): boolean {
  if (!isRecord(value)) return false
  switch (value.kind) {
    case "initial":
      return true
    case "reexploration":
      return isNonEmptyText(value.previousReplayVersionId) && validateReplayFailure(value.failure).length === 0
    case "verification_failed":
      return isNonEmptyText(value.candidateReplayVersionId) && validateReplayFailure(value.failure).length === 0
    default:
      return false
  }
}
