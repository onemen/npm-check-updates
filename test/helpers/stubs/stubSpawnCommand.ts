import fs from 'node:fs'
import path from 'node:path'
import * as mod from '../../../src/lib/spawnCommand'
import type { StubRegistration } from '../FileCacheManager'
import { ensureChildProcessCwd, normalizeCommand, sanitizeAndSerialize } from './utils'

const lockfiles: Record<string, string> = {
  npm: 'package-lock.json',
  yarn: 'yarn.lock',
  pnpm: 'pnpm-lock.yaml',
  bun: 'bun.lock',
}

/** mock install command for tests  */
async function mockInstall(command: string, args: string[], spawnOptions?: any) {
  const validLockFile = lockfiles[command]
  const isInstall = validLockFile && args.length === 1 && args[0] === 'install'

  if (isInstall) {
    const cwd = spawnOptions?.cwd?.toString()
    if (cwd) {
      // Create the empty lockfile and empty node_module
      await fs.promises.mkdir(path.join(cwd, 'node_modules'), { recursive: true })

      const lockfilePath = path.join(cwd, validLockFile)
      try {
        await fs.promises.access(lockfilePath)
        // File exists — do nothing
      } catch {
        await fs.promises.writeFile(lockfilePath, '', 'utf8')
      }
    }
    return true
  }

  return null
}

export const stubSpawnCommand: StubRegistration = {
  name: 'spawnCommand',
  setupMock(cache) {
    const original = mod.spawnCommand

    vi.spyOn(mod, 'spawnCommand').mockImplementation(
      async (rawCommand: string, rawArgs: string[], spawnPleaseOptions?: any, spawnOptions?: any) => {
        ensureChildProcessCwd(rawCommand, rawArgs, spawnOptions)

        const { command, args } = normalizeCommand(rawCommand, rawArgs)

        /** */
        const quoteIfNeeded = (s: string) => (s.includes(' ') ? JSON.stringify(s) : s)
        const key =
          args.length > 0
            ? `command: ${command}, args: ${args.map(quoteIfNeeded).join(' :: ')}`
            : `command: ${command}, args: <none>`

        const isMockInstall = await mockInstall(command, args, spawnOptions)
        if (isMockInstall) {
          const stdout = `stubSpawnCommand for '${command} install' finished successfully.`
          return { stdout, stderr: '' }
        }

        const entry = await cache.getOrSet('spawnCommand', key, async () => {
          try {
            const result = await original(rawCommand, rawArgs, spawnPleaseOptions, spawnOptions)
            if (result.stdout) result.stdout = sanitizeAndSerialize(result.stdout)
            if (result.stderr) result.stderr = sanitizeAndSerialize(result.stderr)
            return result
          } catch (err: any) {
            return {
              _isError: true,
              message: sanitizeAndSerialize(err.message || err.toString()),
              stderr: sanitizeAndSerialize(err.stderr || ''),
              exitCode: err.exitCode ?? 1,
            }
          }
        })

        // --- Replay Response Handling ---
        if (entry?._isError) {
          const err = new Error(entry.message)
          ;(err as any).stderr = entry.stderr
          ;(err as any).exitCode = entry.exitCode
          throw err
        }

        return entry
      },
    )
  },
}
