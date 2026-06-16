import fs from 'node:fs'
import path from 'node:path'
import type spawnPleaseDefault from 'spawn-please'
import type { BaseSpawnCtx, SpawnCtx } from '../../types/stubsTypes'
import { type FileCacheManager } from '../FileCacheManager'
import { createStub } from './genericStubFactory'
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
  return await cache?.getOrSet('spawnCommand', key, async () => {
    const result = await original(...raw)
    if (result.stdout) result.stdout = sanitizeAndSerialize(result.stdout)
    if (result.stderr) result.stderr = sanitizeAndSerialize(result.stderr)
    return result
  })
}

vi.mock('spawn-please', async importOriginal => {
  const actual = await importOriginal<Record<string, any>>()
  return { ...actual }
})

const spawnModuleNamespace: Record<string, any> = await import('spawn-please')
const actualModule = await vi.importActual<Record<string, any>>('spawn-please')
const originalSpawn = actualModule.default as typeof spawnPleaseDefault

export const stubSpawnCommand = createStub<typeof spawnPleaseDefault, FileCacheManager, SpawnCtx>(
  originalSpawn,
  spawnModuleNamespace,
  'default',
  buildSpawnContext,
  'spawnCommand',
)

stubSpawnCommand.use(generalActions)
stubSpawnCommand.use(generalCache)
