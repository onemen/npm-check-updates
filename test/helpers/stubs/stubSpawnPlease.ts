import fs from 'node:fs'
import path from 'node:path'
import { type BaseSpawnCtx, type SpawnCtx, type SpawnStubManager } from '../../types/stubsTypes'
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
  return await cache?.getOrSet('spawnPlease', key, async () => {
    const result = await original(...raw)
    if (result.stdout) result.stdout = sanitizeAndSerialize(result.stdout)
    if (result.stderr) result.stderr = sanitizeAndSerialize(result.stderr)
    return result
  })
}

// Instantiate it immediately as a constant export.
// It starts with a placeholder function that we will inside vi.mock
export const stubSpawnPlease: SpawnStubManager = new ModuleStubManager(
  'spawnPlease',
  (...args) => stubSpawnPlease.realOriginal(...args),
  buildSpawnContext,
)

vi.mock('spawn-please', async importOriginal => {
  const actual = await importOriginal<any>()

  // Capture the underlying module function references clean
  stubSpawnPlease.realOriginal = actual.default || actual
  stubSpawnPlease.clearHandlers()
  stubSpawnPlease.use(generalActions)
  stubSpawnPlease.use(generalCache)

  return {
    __esModule: true,
    // Explicitly call via instance object layout to preserve class scoping context
    default: async (...args: Parameters<typeof stubSpawnPlease.handleExecution>[0]) =>
      stubSpawnPlease.handleExecution(args),
  }
})
