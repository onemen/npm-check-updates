import path, { dirname } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { format } from 'node:util'
import prompts from 'prompts-ncu'
import { vi } from 'vitest'
import { ncuCli } from '../../src/ncuCli'

const __dirname = dirname(fileURLToPath(import.meta.url))

const CLI_BIN_PATH = path.join(__dirname, '../../build/cli.js')

type PromptValue = string[] | boolean

interface CapturedOutputs {
  stdout: string
  stderr: string
  generalLogs: string
}

interface RunCliOptions {
  cwd?: string
  env?: Record<string, string | undefined>
  inject?: PromptValue[]
  rejectOnError?: boolean
  stdin?: string
  silenceRunnerWarning?: boolean
}

/**
 * Custom signaling class to cleanly pass successful early exits (like --help or --version)
 * back through the asynchronous control flow chain.
 */
class ExitSuccessSignal extends Error {
  constructor() {
    super('Process exited successfully')
    this.name = 'ExitSuccessSignal'
  }
}

/**
 * Attaches Vitest spies to cleanly capture all process and console outputs,
 * using the local mutable object references passed from the spawn function.
 */
function mockOutputs(context: CapturedOutputs): void {
  // 1. Unified routing map for all terminal outputs
  const logMap = {
    // Console methods
    log: 'stdout',
    info: 'stdout',
    warn: 'stdout',
    error: 'stderr',
    trace: 'generalLogs',
    // Low-level streams
    stdout: 'stdout',
    stderr: 'stderr',
  } as const

  /** Unified router that checks for engine/listener warnings before assigning context */
  const routeText = (text: string, targetContext: (typeof logMap)[keyof typeof logMap]) => {
    if (text.includes('MaxListenersExceededWarning') || text.includes('trace-warnings')) {
      context.generalLogs += text
    } else {
      context[targetContext] += text
    }
  }

  // --- 2. Low-Level Stream Interceptors Loop ---
  const streams = ['stdout', 'stderr'] as const
  streams.forEach(stream => {
    vi.spyOn(process[stream], 'write').mockImplementation(chunk => {
      routeText(chunk.toString(), logMap[stream])
      return true
    })
  })

  // --- 3. Console Methods Interceptor Loop ---
  const consoleMethods = ['log', 'info', 'warn', 'error', 'trace'] as const
  consoleMethods.forEach(method => {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      const formatted = format(...args) + '\n'
      routeText(formatted, logMap[method])
    })
  })

  // --- 4. Performance/Timer State Tracking ---
  const timers = new Map<string, number>()

  vi.spyOn(console, 'time').mockImplementation((label = 'default') => {
    timers.set(label, performance.now())
  })

  /** time log helper */
  const handleTimerLog = (label: string, appendData = '') => {
    const start = timers.get(label)
    if (start) {
      const duration = (performance.now() - start).toFixed(3)
      context.generalLogs += `${label}: ${duration}ms${appendData}\n`
    }
  }

  vi.spyOn(console, 'timeLog').mockImplementation((label = 'default', ...data: unknown[]) => {
    const extra = data.length > 0 ? ' ' + format(...data) : ''
    handleTimerLog(label, extra)
  })

  vi.spyOn(console, 'timeEnd').mockImplementation((label = 'default') => {
    handleTimerLog(label)
    timers.delete(label)
  })

  vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null): never => {
    const exitCode = typeof code === 'number' ? code : 0
    if (exitCode !== 0) {
      throw new Error(context.stderr.trim() || `CLI exited with code ${exitCode}`)
    }
    throw new ExitSuccessSignal()
  })
}

/**
 * Tears down all Vitest output spies safely.
 * Validates that all mocks were successfully cleaned up.
 * Directly checks Vitest's wrapper properties to see if an active spy is present.
 *
 * @throws Will log warnings to console if mocks fail to clean up
 */
function cleanupCliMocks(): void {
  try {
    vi.restoreAllMocks()
  } catch (error) {
    console.warn('⚠️  Error while restoring mocks:', error)
  }

  // Validate that mocks were actually cleaned up
  const stillMocked = [
    { name: 'console.error', fn: console.error },
    { name: 'console.warn', fn: console.warn },
    { name: 'console.log', fn: console.log },
    { name: 'console.info', fn: console.info },
    { name: 'console.time', fn: console.time },
    { name: 'console.timeLog', fn: console.timeLog },
    { name: 'console.timeEnd', fn: console.timeEnd },
    { name: 'process.stdout.write', fn: process.stdout.write },
    { name: 'process.stderr.write', fn: process.stderr.write },
    { name: 'process.exit', fn: process.exit },
  ].filter(({ fn }) => typeof fn === 'function' && '_isMockFunction' in fn)

  if (stillMocked.length > 0) {
    console.warn(
      `⚠️  Warning: ${stillMocked.length} mock(s) not properly cleaned up: ${stillMocked.map(m => m.name).join(', ')}`,
    )
  }
}

/**
 * Executes the NCU CLI in-process for testing.
 * Simulates a full command-line execution by forwarding arguments directly to the
 * application entry point without mutating the global `process.argv`. Captures all
 * standard outputs, intercepts early process exits (such as `--help` or `--version`),
 * and ensures localized directory and environment state cleanup.
 *
 * @param args - Array of CLI arguments to pass to NCU (e.g., `['--jsonAll', '-u']`).
 * @param options - Configuration overrides for environment, working directory, and mock inputs.
 * @returns An object containing the accumulated `stdout` and `stderr` strings.
 */
export async function runNcuCli(args: string[] = [], options: RunCliOptions = {}) {
  const original = {
    argv: process.argv,
    cwd: process.cwd(),
    env: { ...process.env },
    stdin: process.stdin,
  }

  if (options.cwd) process.chdir(options.cwd)
  if (options.env) Object.assign(process.env, options.env)
  if (options.inject) prompts.inject(options.inject)

  process.argv = ['node', CLI_BIN_PATH, ...args]

  if (args.includes('--stdin')) {
    const stdinSource = options.stdin !== undefined ? [options.stdin] : []
    const mockStdin = Readable.from(stdinSource)
    // @ts-expect-error - Node internal stream compatibility
    mockStdin.isTTY = false
    Object.defineProperty(process, 'stdin', { value: mockStdin, configurable: true })
  }

  const captured: CapturedOutputs = {
    stdout: '',
    stderr: '',
    generalLogs: '',
  }

  mockOutputs(captured)

  let hasError = false

  try {
    await ncuCli()
    return { stdout: captured.stdout, stderr: captured.stderr }
  } catch (error: any) {
    // If it's a genuine error, and not an intentional exit(0), evaluate rejection rules
    if (options.rejectOnError !== false && error && !(error instanceof ExitSuccessSignal)) {
      hasError = true
      const errorMessage = captured.stderr || error?.message || String(error)
      throw new Error(errorMessage, { cause: error })
    }
    return { stdout: captured.stdout, stderr: captured.stderr }
  } finally {
    if (hasError) {
      // ⏳ Give the async event loop one tick to finish flushing
      // any pending console logs before we restore the real terminal
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    cleanupCliMocks()
    try {
      process.argv = original.argv
      if (process.cwd() !== original.cwd) process.chdir(original.cwd)
      Object.defineProperty(process, 'stdin', { value: original.stdin, configurable: true })
      for (const key in options.env) process.env[key] = original.env[key]
    } catch (error) {
      console.warn('⚠️  Error during state restoration:', error)
    }

    if (captured.generalLogs && !options.silenceRunnerWarning) {
      process.stdout.write(`\n[General Logs]:\n${captured.generalLogs}\n`)
    }
  }
}
