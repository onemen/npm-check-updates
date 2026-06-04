import os from 'node:os'
import path, { dirname } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import prompts from 'prompts-ncu'
import spawn from 'spawn-please'
import { ncuCli } from '../../src/ncuCli'
import { ExitSuccessSignal, createMock } from './mock-output'

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
 * • it is slower than runNcuCli
 *
 * Usage:
 * runNcuCliSpawn(['--doctor', '--packageFile', 'package.json'], { cwd: '...' })
 *
 * Note:
 * This function exists primarily as a debug tool to simulate the previous
 * behavior of testing in a child process. Ensure `process.env.TEST_SPAWN_CLI`
 * is set to 'true' before running the tests.
 */
export async function runNcuCliSpawn(args: string[] = [], options: RunCliOptions = {}) {
  // Create a safe, blank home path in the OS temp directory
  const sandboxHome = path.join(os.tmpdir(), 'ncu-isolated-spawn-home')

  const { inject, rejectOnError, stdin, ...testOptions } = options

  // Prepare environment variables for the child process
  const isolatedEnv = {
    ...process.env,
    ...testOptions?.env,
    ...(inject ? { INJECT_PROMPTS: JSON.stringify(inject) } : null),
    HOME: sandboxHome,
    USERPROFILE: sandboxHome,
  }

  // Remove any active shell overrides that bleed through from host machine
  delete (isolatedEnv as any).npm_config_min_release_age
  delete (isolatedEnv as any).npm_config_userconfig
  delete (isolatedEnv as any).npm_config_globalconfig

  const spawnPleaseOptions = {
    rejectOnError,
    stdin,
  }

  const spawnOptions = {
    ...testOptions,
    env: isolatedEnv,
  }

  const bin = path.resolve(__dirname, '../../build/cli.js')
  return spawn('node', [bin, ...args], spawnPleaseOptions, spawnOptions)
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
  if (process.env.TEST_SPAWN_CLI) {
    return runNcuCliSpawn(args, options)
  }

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

  const testName = expect.getState().currentTestName || 'unknown'
  const out = await createMock()

  try {
    await ncuCli()
    // ⏳ src/index.ts run use Promise.race
    // wait before we return to flush all pending logs
    await new Promise(resolve => setTimeout(resolve, 25))
    return out.all
  } catch (error: any) {
    await new Promise(resolve => setTimeout(resolve, 25))
    if (options.rejectOnError !== false && error && !(error instanceof ExitSuccessSignal)) {
      throw error
    }
    return out.all
  } finally {
    out.mockRestore()

    try {
      process.argv = original.argv
      Object.defineProperty(process, 'stdin', { value: original.stdin, configurable: true })
      for (const key in options.env) process.env[key] = original.env[key]
    } catch (error) {
      console.warn('⚠️  Error during state restoration:', error)
    }

    // if (out.generalLogs.trim() && !options.silenceRunnerWarning) {
    //   process.stdout.write(`\n[General Logs]:\n`)
    //   process.stdout.write(`\x1b[36m${testName}\x1b[0m\n`)
    //   process.stdout.write(`${out.generalLogs.trim()}\n`)
    // }
  }
}
