import assert from "node:assert/strict"
import type {
  Application,
  ApplicationId,
  CapabilityId,
  CancellationToken,
  Clock,
  EvidenceId,
  EventId,
  ExecutionId,
  ExperimentId,
  IdSource,
  OperationContext,
  ObservationId,
  OperationId,
  ReplayVersionId,
  SessionId,
  SolariPort,
  SolariSession,
  SolariSessionRequest,
  VerificationRunId,
} from "@interface-compiler/domain"
import type {
  RedactedSolariTelemetryEvent,
  TelemetrySink,
} from "../src/index.js"
import type {
  SolariClientFactory,
  SolariDomElement,
  SolariSdkBrowser,
  SolariSdkClient,
  SolariSdkLocator,
  SolariSdkPage,
} from "../src/solari-sdk.js"
import { SolariBrowserSession } from "../src/browser-session.js"
import { createSolariPortFromEnv } from "../src/index.js"

export function branded<T extends string>(value: string): T {
  return value as T
}

export class TestClock implements Clock {
  currentMs = Date.now()

  now(): string {
    return new Date(this.currentMs).toISOString()
  }
}

export class TestCancellation implements CancellationToken {
  private readonly listeners = new Set<() => void>()
  private requested = false

  isCancellationRequested(): boolean {
    return this.requested
  }

  onCancellationRequested(listener: () => void): () => void {
    if (this.requested) {
      listener()
      return () => undefined
    }
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  cancel(): void {
    this.requested = true
    for (const listener of this.listeners) listener()
    this.listeners.clear()
  }
}

export class TestIds implements IdSource {
  private sequence = 0

  nextApplicationId(): ApplicationId { return this.next("application") }
  nextCapabilityId(): CapabilityId { return this.next("capability") }
  nextReplayVersionId(): ReplayVersionId { return this.next("replay") }
  nextExperimentId(): ExperimentId { return this.next("experiment") }
  nextEvidenceId(): EvidenceId { return this.next("evidence") }
  nextExecutionId(): ExecutionId { return this.next("execution") }
  nextEventId(): EventId { return this.next("event") }
  nextSessionId(): SessionId { return this.next("session") }
  nextObservationId(): ObservationId { return this.next("observation") }
  nextVerificationRunId(): VerificationRunId { return this.next("verification") }
  nextOperationId(): OperationId { return this.next("operation") }

  private next<T extends string>(kind: string): T {
    this.sequence += 1
    return branded<T>(`${kind}.${this.sequence}`)
  }
}

export class RecordingTelemetry implements TelemetrySink {
  readonly events: RedactedSolariTelemetryEvent[] = []

  emit(event: RedactedSolariTelemetryEvent): void {
    this.events.push(event)
  }
}

export interface FakeElementInput {
  readonly tagName: string
  readonly textContent?: string | null
  readonly attributes?: Readonly<Record<string, string>>
}

class FakeElement implements SolariDomElement {
  readonly tagName: string
  readonly textContent: string | null
  private readonly attributes: Readonly<Record<string, string>>

  constructor(input: FakeElementInput) {
    this.tagName = input.tagName
    this.textContent = input.textContent ?? null
    this.attributes = input.attributes ?? {}
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null
  }
}

export class FakeLocator implements SolariSdkLocator {
  clickCalls = 0
  fillValues: string[] = []
  selectValues: string[] = []
  textContentValue: string | null = "read value"
  clickBehavior: () => Promise<void> = async () => undefined
  fillBehavior: (value: string) => Promise<void> = async () => undefined
  selectBehavior: (value: string) => Promise<unknown> = async () => []
  elements: readonly SolariDomElement[] = []

  async click(): Promise<void> {
    this.clickCalls += 1
    return this.clickBehavior()
  }

  async fill(value: string): Promise<void> {
    this.fillValues.push(value)
    return this.fillBehavior(value)
  }

  async selectOption(value: string): Promise<unknown> {
    this.selectValues.push(value)
    return this.selectBehavior(value)
  }

  async textContent(): Promise<string | null> {
    return this.textContentValue
  }

  async evaluateAll<T>(pageFunction: (elements: readonly SolariDomElement[]) => T): Promise<T> {
    return pageFunction(this.elements)
  }
}

export class FakePage implements SolariSdkPage {
  urlValue = "https://shop.test/"
  titleValue = "Shop"
  readonly locatorValue = new FakeLocator()
  readonly elements: FakeElement[] = []
  readonly locatorSelectors: string[] = []
  readonly targetResolutions: string[] = []
  gotoValues: string[] = []
  gotoBehavior: (url: string) => Promise<unknown> = async () => undefined

  constructor() {
    this.locatorValue.elements = this.elements
  }

  url(): string {
    return this.urlValue
  }

  async title(): Promise<string> {
    return this.titleValue
  }

  async goto(url: string): Promise<unknown> {
    this.gotoValues.push(url)
    this.urlValue = url
    return this.gotoBehavior(url)
  }

  locator(selector: string): SolariSdkLocator {
    this.locatorSelectors.push(selector)
    return this.locatorValue
  }

  getByRole(role: string, options?: { readonly name?: string }): SolariSdkLocator {
    this.targetResolutions.push(`role:${role}:${options?.name ?? ""}`)
    return this.locatorValue
  }

  getByLabel(label: string): SolariSdkLocator {
    this.targetResolutions.push(`label:${label}`)
    return this.locatorValue
  }

  getByText(text: string): SolariSdkLocator {
    this.targetResolutions.push(`text:${text}`)
    return this.locatorValue
  }

  addElement(input: FakeElementInput): void {
    this.elements.push(new FakeElement(input))
  }
}

export class FakeBrowser implements SolariSdkBrowser {
  readonly id = "solari.session.test"
  readonly page = new FakePage()
  newPageCalls = 0
  closeCalls = 0
  closeBehavior: () => Promise<void> = async () => undefined
  newPageBehavior: () => Promise<unknown> = async () => this.page

  async newPage(): Promise<unknown> {
    this.newPageCalls += 1
    return this.newPageBehavior()
  }

  async close(): Promise<void> {
    this.closeCalls += 1
    return this.closeBehavior()
  }
}

export class FakeClient implements SolariSdkClient {
  readonly sessions = {
    getReplayUrl: async (_sessionId: string): Promise<unknown> => this.getReplayUrl(),
  }
  readonly browser: FakeBrowser
  launchCalls: Array<{ readonly recording?: boolean }> = []
  closeCalls = 0
  launchBehavior: () => Promise<unknown>
  closeBehavior: () => Promise<void> = async () => undefined
  replayUrl: unknown = { url: "https://replay.test/session/receipt" }
  replayBehavior: (() => Promise<unknown>) | undefined

  constructor(browser = new FakeBrowser()) {
    this.browser = browser
    this.launchBehavior = async () => this.browser
  }

  async launch(options?: { readonly recording?: boolean }): Promise<unknown> {
    this.launchCalls.push(options ?? {})
    return this.launchBehavior()
  }

  async close(): Promise<void> {
    this.closeCalls += 1
    return this.closeBehavior()
  }

  private async getReplayUrl(): Promise<unknown> {
    if (this.replayBehavior !== undefined) return this.replayBehavior()
    return this.replayUrl
  }
}

export interface AdapterWorld {
  readonly port: SolariPort
  readonly client: FakeClient
  readonly browser: FakeBrowser
  readonly clock: TestClock
  readonly ids: TestIds
  readonly telemetry: RecordingTelemetry
}

export function createWorld(client = new FakeClient()): AdapterWorld {
  const clock = new TestClock()
  const ids = new TestIds()
  const telemetry = new RecordingTelemetry()
  const result = createSolariPortFromEnv({
    env: { SOLARI_API_KEY: "test-only-key" },
    clock,
    idSource: ids,
    clientFactory: (() => client) satisfies SolariClientFactory,
    telemetry,
  })
  assert.equal(result.kind, "configured")
  if (result.kind !== "configured") throw new Error("test world configuration failed")
  return { port: result.port, client, browser: client.browser, clock, ids, telemetry }
}

export function application(): Application {
  return {
    id: branded<ApplicationId>("application.shop"),
    name: "Shop",
    baseUrl: "https://shop.test/",
  }
}

export function sessionRequest(freshness: SolariSessionRequest["freshness"] = "fresh"): SolariSessionRequest {
  return { application: application(), purpose: "replay", freshness }
}

export function executeStepAt(session: SolariSession, stepIndex: number, step: Parameters<SolariBrowserSession["executeStepAt"]>[1], operationContext: OperationContext) {
  if (!(session instanceof SolariBrowserSession)) throw new Error("test session is not the adapter session")
  return session.executeStepAt(stepIndex, step, operationContext)
}

export function context(
  clock: TestClock,
  cancellation = new TestCancellation(),
  overrides: Partial<OperationContext["budget"]> = {},
  deadlineMs = 10_000,
): OperationContext {
  return {
    operationId: branded("operation.test"),
    deadlineAt: new Date(clock.currentMs + deadlineMs).toISOString(),
    cancellation,
    budget: {
      maxWallClockMs: deadlineMs,
      ...overrides,
    },
  }
}

export function delayed<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void; readonly reject: (error: unknown) => void } {
  let resolvePromise: (value: T) => void = () => undefined
  let rejectPromise: (error: unknown) => void = () => undefined
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}
