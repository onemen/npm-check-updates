// import { type FileCacheManager } from '../FileCacheManager'
import { type FileCacheManager } from '../FileCacheManager'

// BuildContext: transforms raw args → typed context
export type DefaultCtx<F extends (...args: any) => any, Cache = FileCacheManager> = {
  raw: Parameters<F>
  original: F
  cache: Cache | undefined
}

export type ContextBuilder<F extends (...args: any) => any, Cache, Ctx> = (input: DefaultCtx<F, Cache>) => Ctx

export type StubHandler<Ctx, F extends (...args: any) => any> = (
  ctx: Ctx,
) => Awaited<ReturnType<F>> | undefined | Promise<Awaited<ReturnType<F>> | undefined>

/** Generic stub factory */
export function createStub<F extends (...args: any) => any, Cache = FileCacheManager, Ctx = DefaultCtx<F, Cache>>(
  original: F,
  spyTarget: Record<string | number, any>,
  spyKey: string | number,
  buildContext?: ContextBuilder<F, Cache, Ctx>,
) {
  type Args = Parameters<F>
  type Ret = Awaited<ReturnType<F>>

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

        return await original(...raw)
      }

      vi.spyOn(spyTarget, spyKey).mockImplementation(((...raw: any[]) => impl(raw as Args)) as any)
    },
  }
}
