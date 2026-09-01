import type { Clock, IsoTimestamp } from "@interface-compiler/domain"

export const systemClock: Clock = {
  now(): IsoTimestamp {
    return new Date().toISOString()
  },
}
