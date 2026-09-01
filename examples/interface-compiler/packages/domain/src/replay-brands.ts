export const candidateReplayBrand: unique symbol = Symbol("CandidateReplay")
export const verifyingReplayBrand: unique symbol = Symbol("VerifyingReplay")
export const activeReplayBrand: unique symbol = Symbol("ActiveReplay")
export const brokenReplayBrand: unique symbol = Symbol("BrokenReplay")
export const supersededReplayBrand: unique symbol = Symbol("SupersededReplay")
export const verificationRunBrand: unique symbol = Symbol("VerificationRun")

const candidateReplayInstances = new WeakSet<object>()
const verifyingReplayInstances = new WeakSet<object>()
const activeReplayInstances = new WeakSet<object>()
const brokenReplayInstances = new WeakSet<object>()
const supersededReplayInstances = new WeakSet<object>()
const verificationRunInstances = new WeakSet<object>()

export function registerCandidateReplay(value: object): void {
  candidateReplayInstances.add(value)
}

export function registerVerifyingReplay(value: object): void {
  verifyingReplayInstances.add(value)
}

export function registerActiveReplay(value: object): void {
  activeReplayInstances.add(value)
}

export function registerBrokenReplay(value: object): void {
  brokenReplayInstances.add(value)
}

export function registerSupersededReplay(value: object): void {
  supersededReplayInstances.add(value)
}

export function registerVerificationRun(value: object): void {
  verificationRunInstances.add(value)
}

export function isIssuedCandidateReplay(value: unknown): boolean {
  return isObject(value) && candidateReplayInstances.has(value)
}

export function isIssuedVerifyingReplay(value: unknown): boolean {
  return isObject(value) && verifyingReplayInstances.has(value)
}

export function isIssuedActiveReplay(value: unknown): boolean {
  return isObject(value) && activeReplayInstances.has(value)
}

export function isIssuedBrokenReplay(value: unknown): boolean {
  return isObject(value) && brokenReplayInstances.has(value)
}

export function isIssuedSupersededReplay(value: unknown): boolean {
  return isObject(value) && supersededReplayInstances.has(value)
}

export function isIssuedVerificationRun(value: unknown): boolean {
  return isObject(value) && verificationRunInstances.has(value)
}

function isObject(value: unknown): value is object {
  return value !== null && typeof value === "object"
}
