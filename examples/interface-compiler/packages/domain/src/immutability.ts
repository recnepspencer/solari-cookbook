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
      output[key] = copy((input as { [key: PropertyKey]: unknown })[key])
    }

    return Object.freeze(output)
  }

  return copy(value) as T
}
