import type { CacheManager, MockSpyInstance } from '../../types/stubsTypes'

/** */
export class ModuleStubManager<Args extends any[], Ret, Ctx = any> {
  public handlers: ((ctx: Ctx) => any | Promise<any>)[] = []
  public key: string = ''
  public realOriginal: (...args: Args) => Promise<Ret>
  public spyInstance: MockSpyInstance | null = null

  // Scoped cache variable assigned by each file's beforeAll hook
  private currentCacheManager: any = null

  // Optional constructor function
  private buildContextFn?: (data: { raw: Args; original: (...args: Args) => Promise<Ret>; cache: any }) => Ctx

  constructor(
    key: string,
    realOriginal: (...args: Args) => Promise<Ret>,
    buildContextFn?: (data: { raw: Args; original: (...args: Args) => Promise<Ret>; cache: any }) => Ctx,
  ) {
    this.key = key
    this.realOriginal = realOriginal
    this.buildContextFn = buildContextFn
  }

  /** Appends a handler to the end of the execution chain */
  public use(handler: (ctx: Ctx) => any | Promise<any>) {
    this.handlers.push(handler)
  }

  /** Prepends a handler to the very front of the execution chain */
  public useFirst(handler: (ctx: Ctx) => any | Promise<any>) {
    this.handlers.unshift(handler)
  }

  /** Called inside beforeAll for each file to register its local cache manager */
  public setupMock(manager: CacheManager) {
    this.currentCacheManager = manager
  }

  /** Resets handlers and state between separate test file executions */
  public clearHandlers() {
    this.handlers = []
    this.currentCacheManager = null
  }

  public restore() {
    this.clearHandlers()
    if (this.spyInstance) {
      this.spyInstance.mockRestore()
      this.spyInstance = null
    }
  }

  /** The execution routing engine triggered by the intercepted module */
  public async handleExecution(args: Args): Promise<Ret> {
    const payload = {
      raw: args,
      original: this.realOriginal,
      cache: this.currentCacheManager,
    }

    // Fall back to a standard object literal context if no custom function is passed
    const ctx = this.buildContextFn ? this.buildContextFn(payload) : (payload as unknown as Ctx)

    // Loop through registered execution handlers
    for (const handler of this.handlers) {
      const result = await handler(ctx)
      if (result !== undefined) return result
    }

    return await this.realOriginal(...args)
  }

  /** Accept an optional setup hook to initialize the spy safely within beforeAll */
  public registerLifecycle(
    cacheManager: CacheManager,
    defaultHandlers: typeof this.handlers = [],
    setupMockFn?: (manager: ModuleStubManager<Args, Ret, Ctx>) => MockSpyInstance | null,
  ) {
    beforeAll(() => {
      this.clearHandlers()

      for (const handler of defaultHandlers) {
        this.use(handler)
      }

      this.setupMock(cacheManager)

      // If a spy initialization function is passed, run it here
      if (setupMockFn && !this.spyInstance) {
        this.spyInstance = setupMockFn(this)
      }
    })

    afterAll(() => {
      this.restore()
    })
  }
}
