const registry = new Map<string, any>()

/** register stub for global use */
export function registerStub(key: string, stub: any) {
  registry.set(key, stub)
}

/** get stub for global use */
export function getStub<T = any>(key: string): T {
  return registry.get(key)
}
