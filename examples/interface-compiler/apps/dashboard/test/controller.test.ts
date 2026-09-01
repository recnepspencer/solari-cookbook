import assert from "node:assert/strict"
import test from "node:test"
import { mountDashboard } from "../src/controller.js"
import type { WorthDashboardProjection, WorthDashboardQuery, WorthDashboardResult } from "../src/dashboard-contract.js"
import { fixtureProjection } from "./fixtures.js"

test("mounted controller loads a ready projection and exposes the retry action for a retryable failure", async () => {
  const root = new FakeRoot()
  const projection = fixtureProjection()
  let calls = 0
  const query: WorthDashboardQuery = {
    readDashboard: async () => {
      calls += 1
      return calls === 1 ? { kind: "failed", message: "temporary query failure", retryable: true } : ready(projection)
    },
  }
  const mount = mountDashboard(root.asElement(), query)

  await nextTick()
  assert.equal(calls, 1)
  assert.match(root.innerHTML, /data-action="refresh"/)
  root.dispatchClick(FakeTarget.refresh())
  await nextTick()
  assert.equal(calls, 2)
  assert.match(root.innerHTML, /Fixture shop projection/)
  root.dispatchClick(FakeTarget.capability("cap-checkout"))
  await nextTick()
  assert.match(root.innerHTML, /Begin checkout/)
  assert.match(root.innerHTML, /PROVISIONAL/)
  mount.dispose()
})

test("dispose prevents later refreshes and stops the mounted controller from rendering", async () => {
  const root = new FakeRoot()
  let calls = 0
  let signal: AbortSignal | undefined
  const query: WorthDashboardQuery = {
    readDashboard: (context) => {
      calls += 1
      signal = context.signal
      return new Promise<WorthDashboardResult>(() => undefined)
    },
  }
  const mount = mountDashboard(root.asElement(), query, { queryTimeoutMs: 1000 })
  await nextTick()
  mount.dispose()
  const previousMarkup = root.innerHTML
  await mount.refresh()

  assert.equal(calls, 1)
  assert.equal(signal?.aborted, true)
  assert.equal(root.innerHTML, previousMarkup)
})

test("immediate disposal prevents a deferred query read from starting", async () => {
  const root = new FakeRoot()
  let calls = 0
  const query: WorthDashboardQuery = {
    readDashboard: async () => {
      calls += 1
      return ready(fixtureProjection())
    },
  }
  const mount = mountDashboard(root.asElement(), query)
  mount.dispose()
  await nextTick()

  assert.equal(calls, 0)
})

test("deadline turns a hanging projection read into an explicit timed-out state", async () => {
  const root = new FakeRoot()
  let signal: AbortSignal | undefined
  const query: WorthDashboardQuery = {
    readDashboard: (context) => {
      signal = context.signal
      return new Promise<WorthDashboardResult>(() => undefined)
    },
  }
  const mount = mountDashboard(root.asElement(), query, { queryTimeoutMs: 5 })

  await wait(20)
  assert.match(root.innerHTML, /Worth query timed out/)
  assert.match(root.innerHTML, /Retry projection/)
  assert.equal(signal?.aborted, true)
  mount.dispose()
})

test("older and unsupported responses cannot replace a newer admitted projection", async () => {
  const root = new FakeRoot()
  const newer = atRevision(fixtureProjection(), 2, "2026-08-31T18:00:02.000Z")
  const older = atRevision(fixtureProjection(), 1, "2026-08-31T18:00:01.000Z")
  let calls = 0
  const query: WorthDashboardQuery = {
    readDashboard: async () => {
      calls += 1
      return calls === 1 ? ready(newer) : ready(older)
    },
  }
  const mount = mountDashboard(root.asElement(), query)
  await nextTick()
  assert.match(root.innerHTML, /Revision 2/)
  await mount.refresh()
  assert.match(root.innerHTML, /Stale Worth projection/)

  const unsupportedQuery: WorthDashboardQuery = {
    readDashboard: async () => ({ kind: "ready", projection: { ...newer, schemaVersion: "worth-dashboard.v0" } as unknown as WorthDashboardProjection }),
  }
  mount.dispose()
  const unsupportedRoot = new FakeRoot()
  const unsupportedMount = mountDashboard(unsupportedRoot.asElement(), unsupportedQuery)
  await nextTick()
  assert.match(unsupportedRoot.innerHTML, /unsupported dashboard projection envelope/)
  unsupportedMount.dispose()
})

test("a superseded in-flight response cannot overwrite the newer response", async () => {
  const root = new FakeRoot()
  const firstProjection = atRevision(fixtureProjection(), 3)
  const secondProjection = atRevision(fixtureProjection(), 4)
  let firstResolve: ((result: WorthDashboardResult) => void) | undefined
  let calls = 0
  const query: WorthDashboardQuery = {
    readDashboard: () => {
      calls += 1
      if (calls === 1) return new Promise<WorthDashboardResult>((resolve) => { firstResolve = resolve })
      return Promise.resolve(ready(secondProjection))
    },
  }
  const mount = mountDashboard(root.asElement(), query)
  await nextTick()
  await mount.refresh()
  assert.match(root.innerHTML, /Revision 4/)
  firstResolve?.(ready(firstProjection))
  await nextTick()
  assert.match(root.innerHTML, /Revision 4/)
  mount.dispose()
})

function ready(projection: WorthDashboardProjection): WorthDashboardResult {
  return { kind: "ready", projection }
}

function atRevision(projection: WorthDashboardProjection, sourceRevision: number, generatedAt = projection.generatedAt): WorthDashboardProjection {
  return { ...projection, sourceRevision, generatedAt, mode: { ...projection.mode, sourceRevision } }
}

async function nextTick(): Promise<void> {
  await wait(0)
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

class FakeRoot {
  innerHTML = ""
  private listener: EventListener | undefined

  addEventListener(_type: string, listener: EventListenerOrEventListenerObject): void {
    this.listener = typeof listener === "function" ? listener : (event) => listener.handleEvent(event)
  }

  removeEventListener(_type: string, listener: EventListenerOrEventListenerObject): void {
    if (this.listener === listener) this.listener = undefined
  }

  dispatchClick(target: FakeTarget): void {
    this.listener?.(new FakeClickEvent(target) as unknown as Event)
  }

  asElement(): HTMLElement {
    return this as unknown as HTMLElement
  }
}

class FakeClickEvent {
  constructor(readonly target: FakeTarget) {}
}

class FakeTarget {
  readonly dataset: { readonly capabilityId?: string }

  private constructor(private readonly action: "refresh" | "capability", capabilityId?: string) {
    this.dataset = capabilityId === undefined ? {} : { capabilityId }
  }

  static refresh(): FakeTarget {
    return new FakeTarget("refresh")
  }

  static capability(capabilityId: string): FakeTarget {
    return new FakeTarget("capability", capabilityId)
  }

  closest(selector: string): FakeTarget | null {
    if (this.action === "refresh" && selector === "[data-action='refresh']") return this
    if (this.action === "capability" && selector === "[data-capability-id]") return this
    return null
  }
}
