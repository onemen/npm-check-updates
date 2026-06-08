import { AsyncLocalStorage } from 'node:async_hooks'
import { format, inspect } from 'node:util'
import { vi } from 'vitest'
import { getTestName } from './testNameStore'

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
export function startGlobalIOCapture() {
  const realTrace = console.trace
  const realStdout = process.stdout.write

  /** console log mock */
  const mockedConsoleLog = (type: 'stdout' | 'stderr', ...a: any[]) => {
    const text = format(...a) + '\n'
    const activeBuffers = getActiveBuffers()
    if (activeBuffers) {
      if (isGeneralLog(text)) activeBuffers.general += text
      else activeBuffers[type] += text
    } else {
      const name = getTestName() ?? ''
      if (name) {
        realStdout.call(process.stdout, `\x1b[36m${name}\x1b[0m\n`)
      }
      const isTimer = typeof a[0] === 'string' && a[0].includes('%s')
      const message = isTimer ? format(...a) : a.map(arg => inspect(arg, { colors: true, depth: null })).join(' ')
      realStdout.call(process.stdout, message + '\n')
      if (name) {
        realStdout.call(process.stdout, '\n')
      }
    }
  }

  const restoreConsole = [
    vi.spyOn(console, 'log').mockImplementation((...a) => mockedConsoleLog('stdout', ...a)),
    vi.spyOn(console, 'info').mockImplementation((...a) => mockedConsoleLog('stdout', ...a)),
    vi.spyOn(console, 'warn').mockImplementation((...a) => mockedConsoleLog('stderr', ...a)),
    vi.spyOn(console, 'error').mockImplementation((...a) => mockedConsoleLog('stderr', ...a)),

    // Traces → general
    vi.spyOn(console, 'trace').mockImplementation((...a) => {
      const activeBuffers = getActiveBuffers()
      if (activeBuffers) {
        activeBuffers.general += `[trace] ${format(...a)}\n`
      } else {
        realTrace(...a)
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
 * Registers beforeEach/afterEach to install global IO capture.
 * Call this once from vitest.setup.ts.
 */
export function registerIOCapture() {
  let mock: { mockRestore(): void }

  beforeEach(() => {
    mock = startGlobalIOCapture()
  })

  afterEach(() => {
    mock.mockRestore()
  })
}

/**
 * Activates log capturing for the duration of the test.
 */
export function captureCliIO() {
  const buffers: ActiveBuffers = { stdout: '', stderr: '', general: '' }
  let finalBuffers: ActiveBuffers | null = null

  const logMocks = startGlobalIOCapture()

  const writeStdout = vi.spyOn(process.stdout, 'write').mockImplementation(chunk => {
    const text = typeof chunk === 'string' ? chunk : format(chunk)
    const active = getActiveBuffers() || buffers
    if (isGeneralLog(text)) active.general += text
    else active.stdout += text
    return true
  })

  const writeStderr = vi.spyOn(process.stderr, 'write').mockImplementation(chunk => {
    const text = typeof chunk === 'string' ? chunk : format(chunk)
    const active = getActiveBuffers() || buffers
    if (isGeneralLog(text)) active.general += text
    else active.stderr += text
    return true
  })

  const exitMock = vi.spyOn(process, 'exit').mockImplementation((code?: number | string | null): never => {
    const active = getActiveBuffers() || buffers
    if (code && code !== 0) {
      const msg = active.stderr.trim() || `CLI exited with code ${code}`
      const err = new Error(msg)
      Error.captureStackTrace(err, exitMock)
      throw err
    }
    throw new ExitSuccessSignal()
  })

  /** activate buffer for this run */
  async function captureDuring(fn: () => Promise<void>) {
    return buffersStore.run(buffers, fn)
  }

  /** return stdout stderr to the test */
  function result() {
    const buf = getEffectiveBuffer(buffers, finalBuffers)
    return { stdout: buf.stdout, stderr: buf.stderr }
  }

  /** restore all mocks */
  function restore() {
    finalBuffers = { ...(getActiveBuffers() || buffers) }
    writeStdout.mockRestore()
    writeStderr.mockRestore()
    exitMock.mockRestore()
    logMocks.mockRestore()
  }

  return {
    captureDuring,
    result,
    get stdout() {
      return result().stdout
    },
    get stderr() {
      return result().stderr
    },
    get general() {
      const buf = getEffectiveBuffer(buffers, finalBuffers)
      return buf.general
    },
    restore,
  }
}
