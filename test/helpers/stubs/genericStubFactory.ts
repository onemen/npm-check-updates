import type { CacheManager, ContextBuilder, DefaultCtx, MockSpyInstance, StubHandler } from '../../types/stubsTypes'

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
export function createStub<F extends (...args: any) => any, Cache = CacheManager, Ctx = DefaultCtx<F, Cache>>(
  original: F,
  spyTarget: Record<string | number, any>,
  spyKey: string | number,
  buildContext?: ContextBuilder<F, Cache, Ctx>,
  spyName: string = spyKey.toString(),
) {
  ensureNotMock(original, spyKey)

  const realOriginal = original
  let spyInstance: MockSpyInstance | null = null

  type Args = Parameters<F>
  type Ret = Awaited<ReturnType<F>>
  type Handler = StubHandler<Ctx, F>

  return {
    key: spyName,

    handlers: [] as Handler[],

    use(handler: Handler) {
      this.handlers.push(handler)
    },

    useFirst(handler: Handler) {
      this.handlers.unshift(handler)
    },

    clearHandlers() {
      this.handlers = []
    },

    setupMock(cache?: Cache) {
      if (spyInstance) return

      /** spy implementation */
      const impl = async (raw: Args): Promise<Ret> => {
        const ctx: Ctx = buildContext
          ? buildContext({ raw, original: realOriginal, cache })
          : ({ raw, original: realOriginal, cache } as DefaultCtx<F, Cache> as Ctx)

        for (const handler of this.handlers) {
          const result = await handler(ctx)
          if (result !== undefined) return result
        }

        return await realOriginal(...raw)
      }

      spyInstance = vi.spyOn(spyTarget, spyKey).mockImplementation(((...raw: Args) => impl(raw)) as F)
    },

    restore() {
      this.clearHandlers()
      if (spyInstance) {
        spyInstance.mockRestore()
        spyInstance = null
      }
    },

    registerLifecycle(cacheManager: Cache, defaultHandlers: Handler[] = []) {
      beforeAll(() => {
        this.clearHandlers()

        for (const handler of defaultHandlers) {
          this.use(handler)
        }

        this.setupMock(cacheManager)
      })

      afterAll(() => {
        this.restore()
      })
    },
  }
}
