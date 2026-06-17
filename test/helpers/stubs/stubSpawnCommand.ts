import fs from 'node:fs'
import path from 'node:path'
import { type BaseSpawnCtx, type SpawnCtx } from '../../types/stubsTypes'
import { ModuleStubManager } from './ModuleStubManager'
import {
  type PackageManager,
  ensureChildProcessCwd,
  normalizeCommand,
  packageManagerLockfiles,
  sanitizeAndSerialize,
} from './utils'

/** SpawnCommand context builder */
export const buildSpawnContext = ({ raw, original, cache }: BaseSpawnCtx): SpawnCtx => {
  // throw if we are missing cwd in spawnOptions
  ensureChildProcessCwd(...raw)
  return { raw, original, cache, ...normalizeCommand(...raw) }
}

/** mock install command for tests  */
const generalActions = async (ctx: SpawnCtx) => {
  const { command, args, raw } = ctx

  const validLockFile = packageManagerLockfiles[command as PackageManager]
  const isInstall = validLockFile && args.length === 1 && args[0] === 'install'

  if (isInstall) {
    const cwd = raw[3]?.cwd?.toString()
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
    return { stdout: `stubSpawnCommand for '${command} install' finished successfully.`, stderr: '' }
  }

  return undefined
}

/** cache handler */
const generalCache = async (ctx: SpawnCtx) => {
  const { cache, key, original, raw } = ctx
  const entry = await cache?.getOrSet('spawnCommand', key, async () => {
    try {
      const [rawCommand, rawArgs, spawnPleaseOptions, spawnOptions] = raw
      // console.error('NVU_DEBUG: run original', raw[1] ? { command: raw[0], raw: raw[1] } : { url: raw[0] })
      const result = await original(rawCommand, rawArgs, spawnPleaseOptions, spawnOptions)
      if (result.stdout) result.stdout = sanitizeAndSerialize(result.stdout)
      if (result.stderr) result.stderr = sanitizeAndSerialize(result.stderr)
      // result.testName0 = getFullTestName()
      // result.header0 = getOutputHeader()

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
}

// export let stubSpawnCommand: ModuleStubManager<any, any>

// vi.mock('spawn-please', async importOriginal => {
//   const actual = await importOriginal<any>()
//   const originalDefault = actual.default || actual

//   // Perfectly valid without a second parameter!
//   stubSpawnCommand = new ModuleStubManager('spawnCommand', originalDefault, buildSpawnContext)

//   return {
//     __esModule: true,
//     default: async (...args: any[]) => stubSpawnCommand.handleExecution(args),
//   }
// })

// Instantiate it immediately as a constant export.
// It starts with a placeholder function that we will swap later.
/**
 *
 */
let underlyingSpawn = async (...args: any[]): Promise<any> => {
  throw new Error('spawn-please was called before it was initialized by vi.mock')
}

export const stubSpawnCommand = new ModuleStubManager(
  'spawnCommand',
  async (...args) => underlyingSpawn(...args), // Defer execution to our modifiable pointer
  buildSpawnContext,
)

/** Export a helper function to let your mock hook up the real implementation safely */
export function initializeUnderlyingSpawn(realOriginal: any) {
  underlyingSpawn = realOriginal

  stubSpawnCommand.clearHandlers()
  stubSpawnCommand.use(generalActions)
  stubSpawnCommand.use(generalCache)
}
