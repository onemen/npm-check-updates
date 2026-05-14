import { Readable } from 'node:stream'
import prompts from 'prompts-ncu'
import { ncuCli } from '../../src/ncuCli.js'

/**
 * Valid types for prompt injection.
 * Currently covers package selection (string[]) and confirmation (boolean).
 */
type PromptValue = string[] | boolean

/**
 * In-process replacement for spawn-please.
 * Captures stdout/stderr, handles dynamic directory switching, and
 * intercepts process exits seamlessly.
 */
export async function spawn(
  command: string,
  args: string[] = [],
  options: any = {},
  spawnOptions: { cwd?: string; env?: Record<string, string | undefined>; inject?: PromptValue[] } = {},
) {
  const originalArgv = process.argv
  const originalStdin = process.stdin
  const originalCwd = process.cwd()
  const originalEnv = { ...process.env }

  let stdout = ''
  let stderr = ''
  const EXIT_SIGNAL = Symbol('PROCESS_EXIT')

  if (spawnOptions.cwd) {
    process.chdir(spawnOptions.cwd)
  }

  if (spawnOptions.env) {
    Object.assign(process.env, spawnOptions.env)
  }

  // allow prompt injection from environment variable for testing purposes
  if (spawnOptions.inject) {
    prompts.inject(spawnOptions.inject)
  }

  process.argv = [command, ...args]

  if (args.includes('--stdin')) {
    const stdinSource = options.stdin !== undefined ? [options.stdin] : []
    const mockStdin = Readable.from(stdinSource)

    // @ts-expect-error - Node internal stream compatibility
    mockStdin.isTTY = false
    Object.defineProperty(process, 'stdin', { value: mockStdin, configurable: true })
  }

  vi.spyOn(process.stdout, 'write').mockImplementation(chunk => {
    stdout += chunk.toString()
    return true
  })
  vi.spyOn(console, 'log').mockImplementation(msg => (stdout += msg + '\n'))
  vi.spyOn(console, 'log').mockImplementation(msg => {
    stdout += msg + '\n'
  })
  vi.spyOn(console, 'info').mockImplementation(msg => {
    stdout += msg + '\n'
  })
  vi.spyOn(console, 'warn').mockImplementation(msg => {
    stdout += msg + '\n'
  })

  vi.spyOn(process.stderr, 'write').mockImplementation(chunk => {
    stderr += chunk.toString()
    return true
  })
  vi.spyOn(console, 'error').mockImplementation(msg => {
    stderr += msg + '\n'
  })

  vi.spyOn(process, 'exit').mockImplementation(code => {
    const exitError = new Error(stderr.trim())
    // @ts-expect-error - Custom property insertion for test reporting
    exitError.code = code
    // @ts-expect-error - Custom control signal token
    exitError.signal = EXIT_SIGNAL
    throw exitError
  })

  try {
    await ncuCli()
  } catch (error: any) {
    if (error.signal === EXIT_SIGNAL) {
      if (error.code !== 0 && options.rejectOnError !== false) {
        throw error
      }
    } else {
      if (options.rejectOnError !== false) {
        throw error
      }
    }
  } finally {
    process.argv = originalArgv
    vi.restoreAllMocks()
    Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true })
    process.chdir(originalCwd)
    process.env = originalEnv
  }

  return { stdout, stderr }
}
