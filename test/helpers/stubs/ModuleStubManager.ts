/** */
export class ModuleStubManager<Args extends any[], Ret, Ctx = any> {
  public handlers: ((ctx: Ctx) => any | Promise<any>)[] = []
  public key: string = ''
  private realOriginal: (...args: Args) => Promise<Ret>

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
  public setupMock(manager: any) {
    this.currentCacheManager = manager
  }

  /** Resets handlers and state between separate test file executions */
  public clearHandlers() {
    this.handlers = []
    this.currentCacheManager = null
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

    // console.error('NCU_DEBUG: ModuleStubManager.handleExecution', { ctx })
    // console.error('NVU_DEBUG: handlers', args[1] ? { command: args[0], args: args[1] } : { url: args[0] })

    // Loop through registered execution handlers
    for (const handler of this.handlers) {
      const result = await handler(ctx)
      if (result !== undefined) return result
    }
    console.error('NVU_DEBUG: run original', args[1] ? { command: args[0], args: args[1] } : { url: args[0] })

    return await this.realOriginal(...args)
  }
}
