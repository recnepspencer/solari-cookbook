import type { IsoTimestamp } from "./identity.js"

export interface Clock {
  now(): IsoTimestamp
}
