import { Readable } from 'node:stream'
import prompts from 'prompts-ncu'
import { vi } from 'vitest'
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
  const original = {
    argv: process.argv,
    cwd: process.cwd(),
    env: { ...process.env },
    stdin: process.stdin,
  }

  let stdout = ''
  let stderr = ''

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

  // vi.spyOn(console, 'log').mockImplementation(msg => {
  //   stdout += msg + '\n'
  // })
  // vi.spyOn(console, 'info').mockImplementation(msg => {
  //   stdout += msg + '\n'
  // })
  // vi.spyOn(console, 'warn').mockImplementation(msg => {
  //   stdout += msg + '\n'
  // })

  vi.spyOn(process.stderr, 'write').mockImplementation(chunk => {
    stderr += chunk.toString()
    return true
  })
  // vi.spyOn(console, 'error').mockImplementation(msg => {
  //   stderr += msg + '\n'
  // })

  vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
    if (typeof code === 'number' ? code : 0) {
      throw new Error(stderr || `CLI exited with code ${code}`)
    }
  }) as never)

  const result = await ncuCli()
    .then(() => ({ stdout, stderr, error: null }))
    .catch(error => ({ stdout, stderr, error }))

  // clean up before throwing/returning
  process.argv = original.argv
  if (process.cwd() !== original.cwd) process.chdir(original.cwd)
  Object.defineProperty(process, 'stdin', { value: original.stdin, configurable: true })

  for (const key in process.env) delete process.env[key]
  Object.assign(process.env, original.env)

  vi.restoreAllMocks()

  if (options.rejectOnError !== false && result.error) {
    const errorMessage = stderr || result.stderr?.trim() || result.error?.message || String(result.error)
    throw new Error(errorMessage)
  }

  return { stdout: result.stdout, stderr: result.stderr }
}
