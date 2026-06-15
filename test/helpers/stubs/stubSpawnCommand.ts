import fs from 'node:fs'
import path from 'node:path'
import * as mod from '../../../src/lib/spawnCommand'
import { type FileCacheManager } from '../FileCacheManager'
import { ensureChildProcessCwd, normalizeCommand, sanitizeAndSerialize } from './utils'

type SpawnArgs = Parameters<typeof mod.spawnCommand>
type SpawnReturn = ReturnType<typeof mod.spawnCommand>

export type SpawnHandler = (ctx: {
  command: string
  args: string[]
  rawCommand: SpawnArgs[0]
  rawArgs: SpawnArgs[1]
  spawnPleaseOptions: SpawnArgs[2]
  spawnOptions: SpawnArgs[3]
  original: (...args: SpawnArgs) => SpawnReturn
}) => SpawnReturn

// TODO: move to utils
const lockfiles: Record<string, string> = {
  npm: 'package-lock.json',
  yarn: 'yarn.lock',
  pnpm: 'pnpm-lock.yaml',
  bun: 'bun.lock',
}

/** mock install command for tests  */
async function mockInstall(command: string, args: string[], spawnOptions?: SpawnArgs[3]) {
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
    return `stubSpawnCommand for '${command} install' finished successfully.`
  }

  return null
}

/** stub factory for spawnCommand */
export function stubSpawnCommand() {
  const original = mod.spawnCommand

  return {
    name: 'spawnCommand',

    actions: mockInstall,

    async handleCache(cache: FileCacheManager, key: string, originalArgs: SpawnArgs): SpawnReturn {
      const entry = await cache.getOrSet('spawnCommand', key, async () => {
        try {
          const result = await original(...originalArgs)
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
        const err = Object.assign(new Error(entry.message), {
          stderr: entry.stderr,
          exitCode: entry.exitCode,
        })
        throw err
      }

      return entry
    },

    setupMock(cache: FileCacheManager) {
      vi.spyOn(mod, 'spawnCommand').mockImplementation(
        // async (rawCommand: string, rawArgs: string[], spawnPleaseOptions?: any, spawnOptions?: any) => {
        async (...raw: SpawnArgs) => {
          const [rawCommand, rawArgs, _spawnPleaseOptions, spawnOptions] = raw

          ensureChildProcessCwd(rawCommand, rawArgs, spawnOptions)

          const { command, args, key } = normalizeCommand(rawCommand, rawArgs)

          // console.error('NCU_DEBUG:', key)

          // @ts-expect-error - TODO - use object ctx, see discutions in copilot
          const result = await this.actions(command, args, spawnOptions, raw, original)
          if (result) {
            return { stdout: result, stderr: '' }
          }

          return this.handleCache(cache, key, raw)
        },
      )
    },
  }
}
