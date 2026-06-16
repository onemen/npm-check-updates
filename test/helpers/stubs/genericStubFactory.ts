// import { type FileCacheManager } from '../FileCacheManager'

// BuildContext: transforms raw args → typed context
export type ContextBuilder<F extends (...args: any) => any, Cache, Ctx> = (input: {
  raw: Parameters<F>
  original: F
  cache: Cache | undefined
}) => Ctx

export type DefaultCtx<F extends (...args: any) => any, Cache> = {
  raw: Parameters<F>
  original: F
  cache: Cache | undefined
}

export type StubHandler<Ctx, F extends (...args: any) => any> = (
  ctx: Ctx,
) => ReturnType<F> | undefined | Promise<ReturnType<F> | undefined>

/** Generic stub factory */
export function createStub<F extends (...args: any) => any, Cache, Ctx = DefaultCtx<F, Cache>>(
  original: F,
  spyTarget: Record<string | number, any>,
  spyKey: string | number,
  buildContext?: ContextBuilder<F, Cache, Ctx>,
) {
  type Args = Parameters<F>
  type Ret = ReturnType<F>

  return {
    handlers: [] as StubHandler<Ctx, F>[],

    use(handler: StubHandler<Ctx, F>) {
      this.handlers.push(handler)
    },

    setupMock(cache?: Cache) {
      /** spy implementation */
      const impl = async (raw: Args): Promise<Ret> => {
        const ctx: Ctx = buildContext
          ? buildContext({ raw, original, cache })
          : ({ raw, original, cache } as DefaultCtx<F, Cache> as Ctx)

        // console.error('NCU_DEBUG:', 'setupMock', ctx)

        for (const handler of this.handlers) {
          // try {
          //   const result = await handler(ctx)
          //   console.error('NCU_DEBUG: result', { raw: ctx.raw, result })

          //   if (result !== undefined) return result
          // } catch (error) {
          //   console.error('NCU_DEBUG: error', error)
          //   throw error
          // }
          const result = await handler(ctx)
          if (result !== undefined) return result
        }

        console.log('NCU_DEBUG:', 'run original')

        return original(...raw)
      }

      vi.spyOn(spyTarget, spyKey).mockImplementation(((...raw: any[]) => impl(raw as Args)) as any)
    },
  }
}
