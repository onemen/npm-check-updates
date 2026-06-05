import { AsyncLocalStorage } from 'node:async_hooks'
import { format, inspect } from 'node:util'
import { vi } from 'vitest'

const testNameStore = new AsyncLocalStorage<string>()

/**
 * Custom signaling class to cleanly pass successful early exits (like --help or --version)
 * back through the asynchronous control flow chain.
 */
export class ExitSuccessSignal extends Error {
  constructor() {
    super('Process exited successfully')
    this.name = 'ExitSuccessSignal'
  }
}

// Stores the native console methods to allow bypassing when mock is inactive
const original = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
  time: console.time,
  timeLog: console.timeLog,
  timeEnd: console.timeEnd,
  trace: console.trace,
}

type ActiveBuffers = { stdout: string; stderr: string; general: string }
let activeBuffers: ActiveBuffers | null = null

/** Detect logs that are not part of the output */
function isGeneralLog(text: string): boolean {
  return (
    text.startsWith('NCU_DEBUG:') ||
    text.includes('MaxListenersExceededWarning') ||
    text.includes('trace-warnings') ||
    text.includes('DeprecationWarning') ||
    text.includes('ExperimentalWarning')
  )
}

/** Routes output either to active buffers or the native console */
const intercept = (target: keyof typeof original, args: any[], isErr = false) => {
  if (activeBuffers) {
    const text = format(...args) + '\n'
    if (isErr) activeBuffers.stderr += text
    else if (isGeneralLog(text)) activeBuffers.general += text
    else activeBuffers.stdout += text
  } else {
    const name = testNameStore.getStore() ?? ''
    if (name) {
      original.log(`\x1b[36m${name}\x1b[0m\n`)
      original.log(args.map(arg => inspect(arg, { colors: true, depth: null })).join(' ') + '\n')
      original.log('\n')
    } else {
      original.log(args.map(arg => inspect(arg, { colors: true, depth: null })).join(' ') + '\n')
    }
  }
}

/**
 * Replaces global console methods with interceptors.
 * Should be called once in vitest.setup.ts.
 */
export function setupLogMocks() {
  // console.log = (...a) => intercept('log', a)
  // console.info = (...a) => intercept('info', a)
  // console.warn = (...a) => intercept('warn', a, true)
  // console.error = (...a) => intercept('error', a, true)
  // console.trace = (...a) => intercept('trace', a)

  // console.time = label => {
  //   if (activeBuffers) activeBuffers.general += `[timer:start] ${label ?? 'default'}\n`
  //   else original.time(label)
  // }

  // console.timeLog = (label, ...data) => {
  //   if (activeBuffers) {
  //     let printed: any[] = []
  //     const tempLog = console.log
  //     console.log = (...args) => (printed = args)
  //     original.timeLog(label ?? 'default', ...data)
  //     console.log = tempLog
  //     activeBuffers.general += `[timer:log] ${format(...printed)}\n`
  //   } else {
  //     original.timeLog(label, ...data)
  //   }
  // }

  // console.timeEnd = label => {
  //   if (activeBuffers) {
  //     let printed: any[] = []
  //     const tempLog = console.log
  //     console.log = (...args) => (printed = args)
  //     original.timeEnd(label ?? 'default')
  //     console.log = tempLog
  //     activeBuffers.general += `[timer:end] ${format(...printed)}\n`
  //   } else {
  //     original.timeEnd(label)
  //   }
  // }

  // activeBuffers = { stdout: '', stderr: '', general: '' } as const as ActiveBuffers

  const realStdout = process.stdout.write
  const realStderr = process.stderr.write

  const realLog = console.log
  const realTime = console.time
  const realTimeLog = console.timeLog
  const realTimeEnd = console.timeEnd

  /** console log mock */
  const mockedConsoleLog = (target: keyof typeof original, type: 'stdout' | 'stderr', ...a: any[]) => {
    const text = format(...a) + '\n'
    if (activeBuffers) {
      if (isGeneralLog(text)) activeBuffers.general += text
      else activeBuffers[type] += text
    } else {
      // original[target](text)
      const name = testNameStore.getStore() ?? ''
      if (name) {
        process.stdout.write(`\x1b[36m${name}\x1b[0m\n`)
        process.stdout.write(a.map(arg => inspect(arg, { colors: true, depth: null })).join(' ') + '\n')
        process.stdout.write('\n')
      } else {
        process.stdout.write(a.map(arg => inspect(arg, { colors: true, depth: null })).join(' ') + '\n')
      }
    }
  }

  const restoreStdout = vi.spyOn(process.stdout, 'write').mockImplementation(chunk => {
    const text = typeof chunk === 'string' ? chunk : format(chunk)
    if (activeBuffers) {
      if (isGeneralLog(text)) activeBuffers!.general += text
      else activeBuffers.stdout += text
    } else {
      realStdout(text)
    }
    return true
  })

  const restoreStderr = vi.spyOn(process.stderr, 'write').mockImplementation(chunk => {
    const text = typeof chunk === 'string' ? chunk : format(chunk)
    if (activeBuffers) {
      if (isGeneralLog(text)) activeBuffers!.general += text
      else activeBuffers.stderr += text
    } else {
      realStderr(text)
    }
    return true
  })

  const restoreConsole = [
    vi.spyOn(console, 'log').mockImplementation((...a) => mockedConsoleLog('log', 'stdout', ...a)),
    vi.spyOn(console, 'info').mockImplementation((...a) => mockedConsoleLog('info', 'stdout', ...a)),
    vi.spyOn(console, 'warn').mockImplementation((...a) => mockedConsoleLog('warn', 'stderr', ...a)),
    vi.spyOn(console, 'error').mockImplementation((...a) => mockedConsoleLog('error', 'stderr', ...a)),
    // vi.spyOn(console, 'info').mockImplementation((...a) => {
    //   activeBuffers!.stdout += format(...a) + '\n'
    // }),
    // vi.spyOn(console, 'warn').mockImplementation((...a) => {
    //   activeBuffers!.stderr += format(...a) + '\n'
    // }),
    // vi.spyOn(console, 'error').mockImplementation((...a) => {
    //   activeBuffers!.stderr += format(...a) + '\n'
    // }),

    // Timers → general
    vi.spyOn(console, 'time').mockImplementation(label => {
      if (activeBuffers) {
        console.log = realLog
        realTime(label)
        console.log = mockedConsoleLog
        activeBuffers!.general += `[timer:start] ${label ?? 'default'}\n`
      } else {
        realTime(label)
      }
    }),

    vi.spyOn(console, 'timeLog').mockImplementation((label, ...data) => {
      if (activeBuffers) {
        let printed: string[] = []
        console.log = (...args) => (printed = args)
        realTimeLog(label ?? 'default', ...data)
        console.log = mockedConsoleLog
        activeBuffers!.general += `[timer:log] ${format(...printed)}\n`
      } else {
        realTimeLog(label, ...data)
      }
    }),

    vi.spyOn(console, 'timeEnd').mockImplementation(label => {
      if (activeBuffers) {
        let printed: string[] = []
        console.log = (...args) => (printed = args)
        realTimeEnd(label ?? 'default')
        console.log = mockedConsoleLog
        activeBuffers!.general += `[timer:end] ${format(...printed)}\n`
      } else {
        realTimeEnd(label)
      }
    }),

    // Traces → general
    vi.spyOn(console, 'trace').mockImplementation((...a) => {
      if (activeBuffers) {
        activeBuffers!.general += `[trace] ${format(...a)}\n`
      } else {
        original.trace(...a)
      }
    }),
  ]

  return {
    mockRestore() {
      restoreStdout.mockRestore()
      restoreStderr.mockRestore()
      restoreConsole.forEach(r => r.mockRestore())
    },
  }
}

/** */
export function restoreLogMocks() {
  console.log = original.log
  console.info = original.info
  console.warn = original.warn
  console.error = original.error
  console.trace = original.trace
  console.time = original.time
  console.timeLog = original.timeLog
  console.timeEnd = original.timeEnd
}

/**
 * Flushes the event loop to ensure pending stream writes are processed.
 */
export async function flush() {
  return new Promise<void>(resolve => {
    setImmediate(resolve)
  })
}

/**
 * Activates log capturing for the duration of the test.
 */
export async function createMock() {
  await flush()
  activeBuffers = { stdout: '', stderr: '', general: '' }

  const mocks = setupLogMocks()

  // pendingLogs.length = 0
  let cachedBuffers: ActiveBuffers | null = null

  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null): never => {
    if (code && code !== 0) {
      const capturedMessage = activeBuffers?.stderr.trim()
      const message = capturedMessage || `CLI exited with code ${code}`
      const error = new Error(message)
      Error.captureStackTrace(error, exitSpy)
      throw error
    }
    throw new ExitSuccessSignal()
  })

  return {
    get stdout() {
      return (activeBuffers || cachedBuffers)!.stdout
    },
    get stderr() {
      return (activeBuffers || cachedBuffers)!.stderr
    },
    get generalLogs() {
      return (activeBuffers || cachedBuffers)!.general
    },
    get all() {
      const b = (activeBuffers || cachedBuffers)!
      return { stdout: b.stdout, stderr: b.stderr }
    },
    mockRestore() {
      cachedBuffers = { ...(activeBuffers as ActiveBuffers) }
      activeBuffers = null
      mocks.mockRestore()
      exitSpy.mockRestore()
    },
  }
}

beforeEach(() => {
  const name = expect.getState().currentTestName || 'unknown'
  testNameStore.enterWith(name)
})
