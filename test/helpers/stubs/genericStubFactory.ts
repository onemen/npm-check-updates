import type { CacheManager, DefaultCtx } from '../../types/stubsTypes'
import { ModuleStubManager } from './ModuleStubManager'

/** make sure we get the original function */
function ensureNotMock(fn: any, key: string | number | symbol) {
  if (vi.isMockFunction(fn)) {
    throw new Error(
      `createStub: The function "${key.toString()}" is already mocked. ` +
        `Call createStub BEFORE other mocks or only once.`,
    )
  }
}

/** Generic stub factory */
export function createStub<
  F extends (...args: any) => any,
  Cache = CacheManager,
  Ctx = DefaultCtx<F, Cache>,
  Args extends any[] = Parameters<F>,
  Ret = Awaited<ReturnType<F>>,
>(
  original: F,
  spyTarget: Record<string | number, any>,
  spyKey: string | number,
  buildContext?: (data: { raw: Args; original: (...args: Args) => Promise<Ret>; cache: Cache }) => Ctx,
) {
  ensureNotMock(original, spyKey)

  const stub = new ModuleStubManager<Args, Ret, Ctx>(spyKey.toString(), original, buildContext as any)

  // Intercept registerLifecycle to automatically provide the vi.spyOn initialization step
  const originalRegister = stub.registerLifecycle.bind(stub)

  stub.registerLifecycle = (cacheManager: any, defaultHandlers?: any) => {
    originalRegister(cacheManager, defaultHandlers, instance => {
      return vi.spyOn(spyTarget, spyKey).mockImplementation(((...raw: Args) => instance.handleExecution(raw)) as any)
    })
  }

  return stub
}
