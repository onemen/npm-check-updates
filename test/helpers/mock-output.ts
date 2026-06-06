import { AsyncLocalStorage } from 'node:async_hooks'
import { format, inspect } from 'node:util'
import { vi } from 'vitest'

const testNameStore = new AsyncLocalStorage<string>()

type ActiveBuffers = { stdout: string; stderr: string; general: string }
const buffersStore = new AsyncLocalStorage<ActiveBuffers>()

/** Get the current active buffers for this async context */
function getActiveBuffers(): ActiveBuffers | undefined {
  return buffersStore.getStore()
}

/**
 * Get the effective buffer to use.
 * Checks: active context > cached buffers > current buffers
 * Note: AsyncLocalStorage automatically cleans up when context exits,
 * so we don't need to manually clear it.
 */
function getEffectiveBuffer(currentBuf: ActiveBuffers, cachedBuf: ActiveBuffers | null): ActiveBuffers {
  return getActiveBuffers() || cachedBuf || currentBuf
}

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

/**
 * Replaces global console methods with interceptors.
 * Should be called once in vitest.setup.ts.
 */
export function setupLogMocks() {
  const realStdout = process.stdout.write
  const realStderr = process.stderr.write

  const realLog = console.log
  const realTime = console.time
  const realTimeLog = console.timeLog
  const realTimeEnd = console.timeEnd

  /** console log mock */
  const mockedConsoleLog = (target: keyof typeof original, type: 'stdout' | 'stderr', ...a: any[]) => {
    const text = format(...a) + '\n'
    const activeBuffers = getActiveBuffers()
    if (activeBuffers) {
      if (isGeneralLog(text)) activeBuffers.general += text
      else activeBuffers[type] += text
    } else {
      // Use original methods to avoid stream state issues
      const name = testNameStore.getStore() ?? ''
      if (name) {
        original.log(`\x1b[36m${name}\x1b[0m`)
        original.log(a.map(arg => inspect(arg, { colors: true, depth: null })).join(' '))
        original.log('')
      } else {
        original.log(a.map(arg => inspect(arg, { colors: true, depth: null })).join(' '))
      }
    }
  }

  const restoreStdout = vi.spyOn(process.stdout, 'write').mockImplementation(chunk => {
    const text = typeof chunk === 'string' ? chunk : format(chunk)
    const activeBuffers = getActiveBuffers()
    if (activeBuffers) {
      if (isGeneralLog(text)) activeBuffers.general += text
      else activeBuffers.stdout += text
    } else {
      realStdout.call(process.stdout, text)
    }
    return true
  })

  const restoreStderr = vi.spyOn(process.stderr, 'write').mockImplementation(chunk => {
    const text = typeof chunk === 'string' ? chunk : format(chunk)
    const activeBuffers = getActiveBuffers()
    if (activeBuffers) {
      if (isGeneralLog(text)) activeBuffers.general += text
      else activeBuffers.stderr += text
    } else {
      realStderr.call(process.stderr, text)
    }
    return true
  })

  const restoreConsole = [
    vi.spyOn(console, 'log').mockImplementation((...a) => mockedConsoleLog('log', 'stdout', ...a)),
    vi.spyOn(console, 'info').mockImplementation((...a) => mockedConsoleLog('info', 'stdout', ...a)),
    vi.spyOn(console, 'warn').mockImplementation((...a) => mockedConsoleLog('warn', 'stderr', ...a)),
    vi.spyOn(console, 'error').mockImplementation((...a) => mockedConsoleLog('error', 'stderr', ...a)),

    // Timers → general
    vi.spyOn(console, 'time').mockImplementation(label => {
      const activeBuffers = getActiveBuffers()
      if (activeBuffers) {
        console.log = realLog
        realTime(label)
        console.log = mockedConsoleLog
        activeBuffers.general += `[timer:start] ${label ?? 'default'}\n`
      } else {
        realTime(label)
      }
    }),

    vi.spyOn(console, 'timeLog').mockImplementation((label, ...data) => {
      const activeBuffers = getActiveBuffers()
      if (activeBuffers) {
        let printed: string[] = []
        console.log = (...args) => (printed = args)
        realTimeLog(label ?? 'default', ...data)
        console.log = mockedConsoleLog
        activeBuffers.general += `[timer:log] ${format(...printed)}\n`
      } else {
        realTimeLog(label, ...data)
      }
    }),

    vi.spyOn(console, 'timeEnd').mockImplementation(label => {
      const activeBuffers = getActiveBuffers()
      if (activeBuffers) {
        let printed: string[] = []
        console.log = (...args) => (printed = args)
        realTimeEnd(label ?? 'default')
        console.log = mockedConsoleLog
        activeBuffers.general += `[timer:end] ${format(...printed)}\n`
      } else {
        realTimeEnd(label)
      }
    }),

    // Traces → general
    vi.spyOn(console, 'trace').mockImplementation((...a) => {
      const activeBuffers = getActiveBuffers()
      if (activeBuffers) {
        activeBuffers.general += `[trace] ${format(...a)}\n`
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

/**
 * Flushes the event loop to ensure pending stream writes are processed.
 */
export async function flush() {
  return new Promise<void>(resolve => {
    setImmediate(resolve)
  })
}

/**
 * Activates log capturing for the duration of the cli test.
 */
export async function createMock() {
  await flush()
  const currentBuffers: ActiveBuffers = { stdout: '', stderr: '', general: '' }

  const mocks = setupLogMocks()

  let cachedBuffers: ActiveBuffers | null = null

  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null): never => {
    const activeBuffers = getActiveBuffers()
    if (code && code !== 0) {
      const capturedMessage = activeBuffers?.stderr.trim()
      const message = capturedMessage || `CLI exited with code ${code}`
      const error = new Error(message)
      Error.captureStackTrace(error, exitSpy)
      throw error
    }
    throw new ExitSuccessSignal()
  })

  /**
   * Enter the async context with currentBuffers.
   * The context will be automatically cleaned up by AsyncLocalStorage when the fn completes.
   */
  const runWithBuffers = async (fn: () => Promise<any>) => {
    return buffersStore.run(currentBuffers, fn)
  }

  return {
    runWithBuffers,
    get stdout() {
      return getEffectiveBuffer(currentBuffers, cachedBuffers).stdout
    },
    get stderr() {
      return getEffectiveBuffer(currentBuffers, cachedBuffers).stderr
    },
    get generalLogs() {
      return getEffectiveBuffer(currentBuffers, cachedBuffers).general
    },
    get all() {
      const buf = getEffectiveBuffer(currentBuffers, cachedBuffers)
      return { stdout: buf.stdout, stderr: buf.stderr }
    },
    mockRestore() {
      cachedBuffers = { ...(getActiveBuffers() || currentBuffers) }
      mocks.mockRestore()
      exitSpy.mockRestore()
    },
  }
}

beforeEach(() => {
  const name = expect.getState().currentTestName || 'unknown'
  testNameStore.enterWith(name)
})
