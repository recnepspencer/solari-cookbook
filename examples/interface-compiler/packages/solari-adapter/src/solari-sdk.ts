import { Solari, type SolariOptions } from "@solarisdk/browser"
import type { SolariAdapterConfig } from "./configuration.js"

export interface SolariSdkLocator {
  click(): Promise<void>
  fill(value: string): Promise<void>
  selectOption(value: string): Promise<unknown>
  textContent(): Promise<string | null>
  evaluateAll<T>(pageFunction: (elements: readonly SolariDomElement[]) => T): Promise<T>
}

export interface SolariDomElement {
  readonly tagName: string
  readonly textContent: string | null
  getAttribute(name: string): string | null
}

export interface SolariSdkPage {
  url(): string
  title(): Promise<string>
  goto(url: string): Promise<unknown>
  locator(selector: string): SolariSdkLocator
  getByRole?(role: string, options?: { readonly name?: string }): SolariSdkLocator
  getByLabel?(label: string): SolariSdkLocator
  getByText?(text: string): SolariSdkLocator
}

export interface SolariSdkBrowser {
  readonly id: string
  newPage(): Promise<unknown>
  close(): Promise<void>
}

export interface SolariSdkReplayUrl {
  readonly url: string
  readonly expiresInSeconds?: number
  readonly contentEncoding?: string
}

export interface SolariSdkSessions {
  getReplayUrl(sessionId: string): Promise<unknown>
}

export interface SolariSdkClient {
  launch(options?: { readonly recording?: boolean }): Promise<unknown>
  close(): Promise<void>
  readonly sessions: SolariSdkSessions
}

export type SolariClientFactory = (config: SolariAdapterConfig) => SolariSdkClient

/** The only production construction path for the official SDK client. */
export function createDefaultSolariClient(config: SolariAdapterConfig): SolariSdkClient {
  const options: SolariOptions = { apiKey: config.apiKey }
  if (config.region !== undefined) options.region = config.region
  if (config.baseUrl !== undefined) options.baseUrl = config.baseUrl
  if (config.timeoutMs !== undefined) options.timeoutMs = config.timeoutMs

  const client = new Solari(options)
  return {
    launch: (launchOptions) => client.launch(launchOptions),
    close: () => client.close(),
    sessions: {
      getReplayUrl: (sessionId) => client.sessions.getReplayUrl(sessionId),
    },
  }
}

export function asSolariBrowser(value: unknown): SolariSdkBrowser | undefined {
  if (!isObject(value)) return undefined
  if (typeof value.id !== "string" || value.id.trim() === "") return undefined
  if (typeof value.newPage !== "function" || typeof value.close !== "function") return undefined
  return value as unknown as SolariSdkBrowser
}

export function asSolariPage(value: unknown): SolariSdkPage | undefined {
  if (!isObject(value)) return undefined
  if (typeof value.url !== "function" || typeof value.title !== "function" || typeof value.goto !== "function" || typeof value.locator !== "function") return undefined
  return value as unknown as SolariSdkPage
}

export function asSolariReplayUrl(value: unknown): SolariSdkReplayUrl | undefined {
  if (!isObject(value) || typeof value.url !== "string") return undefined
  try {
    const parsed = new URL(value.url)
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined
  } catch {
    return undefined
  }
  return { url: value.url, ...(typeof value.expiresInSeconds === "number" ? { expiresInSeconds: value.expiresInSeconds } : {}) }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object"
}
