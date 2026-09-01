import type { WorthDashboardProjection, WorthDashboardQuery, WorthDashboardResult } from "./dashboard-contract.js"
import { isSupportedWorthDashboardProjection } from "./dashboard-contract.js"
import { renderDashboardResult, renderLoadingState } from "./render.js"

export const defaultDashboardQueryTimeoutMs = 15_000

export interface DashboardMountOptions {
  readonly queryTimeoutMs?: number
}

export interface DashboardMount {
  readonly refresh: () => Promise<void>
  readonly dispose: () => void
}

interface ActiveRequest {
  readonly controller: AbortController
  readonly cancel: () => void
  readonly timeout: ReturnType<typeof setTimeout>
}

/**
 * Owns only browser interaction state: selected capability and an in-flight
 * read. It never submits a Worth command or stores a dashboard ledger.
 */
export function mountDashboard(root: HTMLElement, query: WorthDashboardQuery, options: DashboardMountOptions = {}): DashboardMount {
  const queryTimeoutMs = options.queryTimeoutMs ?? defaultDashboardQueryTimeoutMs
  if (!Number.isFinite(queryTimeoutMs) || queryTimeoutMs <= 0) throw new RangeError("dashboard query timeout must be a positive finite number")

  let disposed = false
  let selectedCapabilityId: string | undefined
  let currentProjection: WorthDashboardProjection | undefined
  let activeRequest: ActiveRequest | undefined

  const render = (result: WorthDashboardResult): void => {
    if (disposed) return
    root.innerHTML = renderDashboardResult(result, selectedCapabilityId)
  }

  const cancelActiveRequest = (): void => {
    if (activeRequest === undefined) return
    activeRequest.cancel()
    activeRequest.controller.abort()
    clearTimeout(activeRequest.timeout)
    activeRequest = undefined
  }

  const refresh = async (): Promise<void> => {
    if (disposed) return
    cancelActiveRequest()

    const controller = new AbortController()
    let resolveCancelled: (() => void) | undefined
    const cancellation = new Promise<WorthDashboardResult>((resolve) => {
      resolveCancelled = () => resolve({ kind: "cancelled", message: "The previous projection request was cancelled." })
    })
    let resolveTimedOut: (() => void) | undefined
    const timedOut = new Promise<WorthDashboardResult>((resolve) => {
      resolveTimedOut = () => resolve({ kind: "timed_out", message: "The Worth projection query exceeded its dashboard deadline." })
    })
    const timeout = setTimeout(() => {
      resolveTimedOut?.()
      controller.abort()
    }, queryTimeoutMs)
    const request: ActiveRequest = {
      controller,
      cancel: () => resolveCancelled?.(),
      timeout,
    }
    activeRequest = request
    root.innerHTML = renderLoadingState()
    const requestedAt = new Date()
    const deadlineAt = new Date(requestedAt.getTime() + queryTimeoutMs).toISOString()
    const read = Promise.resolve().then(() => {
      if (disposed || activeRequest !== request) return { kind: "cancelled" as const, message: "The projection request was disposed before it started." }
      return query.readDashboard({ signal: controller.signal, requestedAt: requestedAt.toISOString(), deadlineAt })
    })

    try {
      const result = await Promise.race([read, cancellation, timedOut])
      if (disposed || activeRequest !== request) return
      if (result.kind === "ready") {
        if (!isSupportedWorthDashboardProjection(result.projection)) {
          render({ kind: "unavailable", reason: "unsupported", message: "The Worth query returned an unsupported dashboard projection envelope." })
          return
        }
        if (currentProjection !== undefined && result.projection.sourceRevision < currentProjection.sourceRevision) {
          render({ kind: "stale", sourceRevision: result.projection.sourceRevision, currentRevision: currentProjection.sourceRevision })
          return
        }
        currentProjection = result.projection
        if (selectedCapabilityId !== undefined && !result.projection.capabilities.some((item) => String(item.capability.id) === selectedCapabilityId)) {
          selectedCapabilityId = undefined
        }
      }
      render(result)
    } catch (error: unknown) {
      if (disposed || activeRequest !== request || controller.signal.aborted) return
      render({ kind: "failed", message: errorMessage(error), retryable: true })
    } finally {
      clearTimeout(request.timeout)
      if (activeRequest === request) activeRequest = undefined
    }
  }

  const onClick = (event: Event): void => {
    if (disposed) return
    const capabilityButton = closestElement(event.target, "[data-capability-id]")
    if (capabilityButton !== null) {
      const capabilityId = capabilityButton.dataset.capabilityId
      if (capabilityId !== undefined && currentProjection !== undefined) {
        selectedCapabilityId = capabilityId
        root.innerHTML = renderDashboardResult({ kind: "ready", projection: currentProjection }, selectedCapabilityId)
      }
      return
    }
    if (closestElement(event.target, "[data-action='refresh']") !== null) void refresh()
  }

  root.addEventListener("click", onClick)
  root.innerHTML = renderLoadingState()
  void refresh()

  return {
    refresh,
    dispose: () => {
      if (disposed) return
      disposed = true
      cancelActiveRequest()
      root.removeEventListener("click", onClick)
    },
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : "The Worth query rejected the projection request."
}

function closestElement(target: EventTarget | null, selector: string): HTMLElement | null {
  if (target === null || (typeof target !== "object" && typeof target !== "function")) return null
  const candidate = target as { readonly closest?: unknown }
  if (typeof candidate.closest !== "function") return null
  return candidate.closest.call(target, selector) as HTMLElement | null
}
