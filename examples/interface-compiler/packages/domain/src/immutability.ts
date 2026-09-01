/** Defensive value ownership for domain records crossing construction boundaries. */

export function cloneAndFreeze<T>(value: T): T {
  const clones = new WeakMap<object, unknown>()

  function copy(input: unknown): unknown {
    if (input === null || typeof input !== "object") return input

    const existing = clones.get(input)
    if (existing !== undefined) return existing

    const output = (Array.isArray(input) ? [] : {}) as { [key: PropertyKey]: unknown }
    clones.set(input, output)

    for (const key of Reflect.ownKeys(input)) {
      if (Array.isArray(input) && key === "length") continue
      const descriptor = Object.getOwnPropertyDescriptor(input, key)
      if (!descriptor) continue
      if ("value" in descriptor) {
        descriptor.value = copy(descriptor.value)
      } else {
        Object.defineProperty(output, key, {
          configurable: descriptor.configurable,
          enumerable: typeof key === "symbol" ? false : descriptor.enumerable,
          writable: true,
          value: copy((input as { [key: PropertyKey]: unknown })[key]),
        })
        continue
      }
      if (typeof key === "symbol") descriptor.enumerable = false
      Object.defineProperty(output, key, descriptor)
    }

    return Object.freeze(output)
  }

  return copy(value) as T
}
