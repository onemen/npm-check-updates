import type { CacheManager, ContextBuilder, DefaultCtx, StubHandler } from '../../types/stubsTypes'
import { MockHandler } from './MockHandler'

/** make sure we get the original function */
function ensureNotMock(fn: unknown, key: string | number | symbol): void {
  if (vi.isMockFunction(fn)) {
    throw new Error(
      `createStub: The function "${key.toString()}" is already mocked. ` +
        `Call createStub BEFORE other mocks or only once.`,
    )
  }
}

/** Generic stub factory */
export function createStub<F extends (...args: any[]) => any, Cache = CacheManager, Ctx = DefaultCtx<F, Cache>>(
  original: F,
  spyTarget: Record<string | number, any>,
  spyKey: string | number,
  buildContext?: ContextBuilder<F, Cache, Ctx>,
) {
  ensureNotMock(original, spyKey)

  const stub = new MockHandler<F, Cache, Ctx>(spyKey.toString(), original, buildContext)

  // Bind registerLifecycle to auto-inject the specific spy routine seamlessly
  const originalRegister = stub.registerLifecycle.bind(stub)

  stub.registerLifecycle = (cacheManager: Cache, defaultHandlers?: StubHandler<Ctx, F>[]) => {
    originalRegister(cacheManager, defaultHandlers, instance => {
      return vi.spyOn(spyTarget, spyKey).mockImplementation(instance.handleExecution.bind(instance) as F)
    })
  }

  return stub
}
