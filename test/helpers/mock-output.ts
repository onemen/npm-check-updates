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
 * Note: AsyncLocalStorage automatically cleans up when context exits.
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
  const realLog = console.log
  const realTime = console.time
  const realTimeLog = console.timeLog
  const realTimeEnd = console.timeEnd
  const realStdout = process.stdout.write

  /** console log mock */
  const mockedConsoleLog = (target: keyof typeof original, type: 'stdout' | 'stderr', ...a: any[]) => {
    const text = format(...a) + '\n'
    const activeBuffers = getActiveBuffers()
    if (activeBuffers) {
      if (isGeneralLog(text)) activeBuffers.general += text
      else activeBuffers[type] += text
    } else {
      const name = testNameStore.getStore() ?? ''
      if (name) {
        realStdout.call(process.stdout, `\x1b[36m${name}\x1b[0m\n`)
      }
      realStdout.call(process.stdout, a.map(arg => inspect(arg, { colors: true, depth: null })).join(' ') + '\n')
      if (name) {
        realStdout.call(process.stdout, '\n')
      }
    }
  }

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
      restoreConsole.forEach(r => r.mockRestore())
    },
  }
}

/**
 * Activates log capturing for the duration of the test.
 */
export function createMock() {
  const mocks = setupLogMocks()

  const currentBuffers: ActiveBuffers = { stdout: '', stderr: '', general: '' }
  let cachedBuffers: ActiveBuffers | null = null

  /**
   * Mock for process.stdout.write.
   * Captures all output written to stdout, routing it to the active buffer.
   */
  const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(chunk => {
    const text = typeof chunk === 'string' ? chunk : format(chunk)
    const activeBuffers = getActiveBuffers() || currentBuffers
    if (isGeneralLog(text)) activeBuffers.general += text
    else activeBuffers.stdout += text
    return true
  })

  /**
   * Mock for process.stderr.write.
   * Captures all output written to stderr, routing it to the active buffer.
   */
  const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(chunk => {
    const text = typeof chunk === 'string' ? chunk : format(chunk)
    const activeBuffers = getActiveBuffers() || currentBuffers
    if (isGeneralLog(text)) activeBuffers.general += text
    else activeBuffers.stderr += text
    return true
  })

  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null): never => {
    const activeBuffers = getActiveBuffers() || currentBuffers
    if (code && code !== 0) {
      const capturedMessage = activeBuffers.stderr.trim()
      const message = capturedMessage || `CLI exited with code ${code}`
      const error = new Error(message)
      Error.captureStackTrace(error, exitSpy)
      throw error
    }
    throw new ExitSuccessSignal()
  })

  /** Enter the async context with currentBuffers */
  const runWithBuffers = async (fn: () => Promise<void>) => {
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
      stdoutSpy.mockRestore()
      stderrSpy.mockRestore()
      exitSpy.mockRestore()
      mocks.mockRestore()
    },
  }
}

beforeEach(() => {
  const name = expect.getState().currentTestName || 'unknown'
  testNameStore.enterWith(name)
})
