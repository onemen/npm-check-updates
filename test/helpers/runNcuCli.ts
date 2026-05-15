import path, { dirname } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import prompts from 'prompts-ncu'
import { vi } from 'vitest'
import { ncuCli } from '../../src/ncuCli.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const CLI_BIN_PATH = path.join(__dirname, '../../build/cli.js')

type PromptValue = string[] | boolean

interface CapturedOutputs {
  stdout: string
  stderr: string
  runnerWarning: string
}

interface RunCliOptions {
  cwd?: string
  env?: Record<string, string | undefined>
  inject?: PromptValue[]
  rejectOnError?: boolean
  stdin?: string
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
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    context.stdout += chunk.toString()
    return true
  })

  vi.spyOn(console, 'log').mockImplementation((msg: string) => {
    context.stdout += msg + '\n'
  })

  vi.spyOn(console, 'info').mockImplementation((msg: string) => {
    context.stdout += msg + '\n'
  })

  vi.spyOn(console, 'warn').mockImplementation((msg: string) => {
    context.stdout += msg + '\n'
  })

  vi.spyOn(console, 'error').mockImplementation((...msg: unknown[]) => {
    const formatted = msg.join(' ')
    if (formatted.includes('MaxListenersExceededWarning') || formatted.includes('trace-warnings')) {
      context.runnerWarning += formatted + '\n'
    } else {
      context.stderr += formatted + '\n'
    }
  })

  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    const str = chunk.toString()
    if (str.includes('MaxListenersExceededWarning') || str.includes('trace-warnings')) {
      context.runnerWarning += str + '\n'
      return true
    }
    context.stderr += str
    return true
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
 * Directly checks Vitest's wrapper properties to see if an active spy is present.
 */
function cleanupCliMocks(): void {
  const isSpied = typeof console.error === 'function' && '_isMockFunction' in console.error
  if (isSpied) {
    vi.restoreAllMocks()
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
    runnerWarning: '',
  }

  mockOutputs(captured)

  try {
    const result = await ncuCli()
      .then(() => ({ error: null }))
      .catch(error => ({ error }))

    cleanupCliMocks()

    // If it's a genuine error, and not an intentional exit(0), evaluate rejection rules
    if (result.error && !(result.error instanceof ExitSuccessSignal)) {
      if (options.rejectOnError !== false) {
        const errorMessage = captured.stderr.trim() || result.error?.message || String(result.error)
        throw new Error(errorMessage)
      }
    }

    if (captured.runnerWarning) {
      process.stdout.write(`\n[Test Runner Warning Intercepted]:\n${captured.runnerWarning}\n`)
    }

    return { stdout: captured.stdout, stderr: captured.stderr.trim() }
  } finally {
    process.argv = original.argv
    if (process.cwd() !== original.cwd) process.chdir(original.cwd)
    Object.defineProperty(process, 'stdin', { value: original.stdin, configurable: true })

    for (const key in process.env) delete process.env[key]
    Object.assign(process.env, original.env)

    cleanupCliMocks()
  }
}
