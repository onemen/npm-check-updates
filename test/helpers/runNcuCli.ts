import path, { dirname } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { format } from 'node:util'
import prompts from 'prompts-ncu'
import spawn from 'spawn-please'
import { vi } from 'vitest'
import { ncuCli } from '../../src/ncuCli'

const __dirname = dirname(fileURLToPath(import.meta.url))

const CLI_BIN_PATH = path.join(__dirname, '../../build/cli.js')

type PromptValue = string[] | boolean

interface RunCliOptions {
  cwd?: string
  env?: Record<string, string | undefined>
  inject?: PromptValue[]
  rejectOnError?: boolean
  stdin?: string
  silenceRunnerWarning?: boolean
}

/** shorten error message */
function shorten(p: string) {
  // Show only last 2 path segments for readability
  const parts = p.replace(/\\/g, '/').split('/')
  if (parts.length <= 2) return p
  return `…/${parts.slice(-2).join('/')}`
}

/** Tests must not specify both --cwd and options.cwd */
function validateCwdConflict(args: string[], options: RunCliOptions) {
  if (!options.cwd) return

  const index = args.indexOf('--cwd')
  if (index === -1) return

  const argValue = shorten(args[index + 1])
  const optValue = shorten(options.cwd)

  throw new Error(
    `Conflicting cwd values:\n` +
      `  options.cwd → ${optValue}\n` +
      `  args --cwd → ${argValue}\n\n` +
      `Tests must not specify both. Remove --cwd from args or remove options.cwd.`,
  )
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
 * Attaches Vitest spies to cleanly capture all process and console outputs,
 * using the local mutable object references passed from the spawn function.
 */
function mockOutput() {
  let stdout = ''
  let stderr = ''
  let general = ''

  const restoreStdout = vi.spyOn(process.stdout, 'write').mockImplementation(chunk => {
    const text = typeof chunk === 'string' ? chunk : format(chunk)
    if (isGeneralLog(text)) general += text
    else stdout += text
    return true
  })

  const restoreStderr = vi.spyOn(process.stderr, 'write').mockImplementation(chunk => {
    const text = typeof chunk === 'string' ? chunk : format(chunk)
    if (isGeneralLog(text)) general += text
    else stderr += text
    return true
  })

  const restoreConsole = [
    vi.spyOn(console, 'log').mockImplementation((...a) => {
      const text = format(...a) + '\n'
      if (isGeneralLog(text)) general += text
      else stdout += text
    }),
    vi.spyOn(console, 'info').mockImplementation((...a) => {
      stdout += format(...a) + '\n'
    }),
    vi.spyOn(console, 'warn').mockImplementation((...a) => {
      stderr += format(...a) + '\n'
    }),
    vi.spyOn(console, 'error').mockImplementation((...a) => {
      stderr += format(...a) + '\n'
    }),

    // Timers → general
    vi.spyOn(console, 'time').mockImplementation(label => {
      general += `[timer:start] ${label ?? 'default'}\n`
    }),
    vi.spyOn(console, 'timeLog').mockImplementation((label, ...data) => {
      general += `[timer:log] ${label ?? 'default'} ${format(...data)}\n`
    }),
    vi.spyOn(console, 'timeEnd').mockImplementation(label => {
      general += `[timer:end] ${label ?? 'default'}\n`
    }),

    // Traces → general
    vi.spyOn(console, 'trace').mockImplementation((...a) => {
      general += `[trace] ${format(...a)}\n`
    }),
  ]

  // --- 3. Prevent process.exit from killing the worker ---
  const restoreExit = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null): never => {
    if (code && code !== 0) {
      throw new Error(stderr.trim() || `CLI exited with code ${code}`)
    }
    throw new ExitSuccessSignal()
  })

  return {
    get stdout() {
      return stdout
    },
    get stderr() {
      return stderr
    },
    get generalLogs() {
      return general
    },

    get all() {
      return {
        stdout,
        stderr,
      }
    },

    mockRestore() {
      restoreStdout.mockRestore()
      restoreStderr.mockRestore()
      restoreConsole.forEach(r => r.mockRestore())
      restoreExit.mockRestore()
    },
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
  if (options.cwd) {
    validateCwdConflict(args, options)
    args.push('--cwd', options.cwd)
  }

  const original = {
    argv: process.argv,
    env: { ...process.env },
    stdin: process.stdin,
  }

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

  const out = mockOutput()

  let hasError = false

  try {
    await ncuCli()
    return out.all
  } catch (error: any) {
    // If it's a genuine error, and not an intentional exit(0), evaluate rejection rules
    if (options.rejectOnError !== false && error && !(error instanceof ExitSuccessSignal)) {
      hasError = true
      const errorMessage = out.stderr || error?.message || String(error)
      throw new Error(errorMessage, { cause: error })
    }
    return out.all
  } finally {
    if (hasError) {
      // ⏳ Give the async event loop one tick to finish flushing
      // any pending console logs before we restore the real terminal
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    out.mockRestore()

    try {
      process.argv = original.argv
      Object.defineProperty(process, 'stdin', { value: original.stdin, configurable: true })
      for (const key in options.env) process.env[key] = original.env[key]
    } catch (error) {
      console.warn('⚠️  Error during state restoration:', error)
    }

    if (out.generalLogs && !options.silenceRunnerWarning) {
      process.stdout.write(`\n[General Logs]:\n${out.generalLogs}\n`)
    }
  }
}

/**
 * runNcuCliSpawn
 *
 * Purpose:
 * Execute the real built CLI (`build/cli.js`) in a separate Node process.
 * This allows tests to run the CLI exactly as a user would, with full
 * argument parsing, real exit codes, and an isolated working directory.
 *
 * Unlike runNcuCli (which runs in‑process), this version:
 * • does NOT load TypeScript or Vite
 * • does NOT affect coverage
 * • does NOT change the parent process cwd
 * • is fast because it runs the compiled JS directly
 *
 * Usage:
 * runNcuCliSpawn(['--doctor', '--packageFile', 'package.json'], { cwd: '...' })
 */
export async function runNcuCliSpawn(args: string[] = [], options: RunCliOptions = {}) {
  const bin = path.resolve(__dirname, '../../build/cli.js')
  return spawn(
    'node',
    [bin, ...args],
    { ...(options.stdin ? { stdin: options.stdin } : null) },
    { ...options, stdin: undefined },
  )
}
