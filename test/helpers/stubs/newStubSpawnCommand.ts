import fs from 'node:fs'
import path from 'node:path'
import * as mod from '../../../src/lib/spawnCommand'
import { type DefaultCtx, createStub } from './genericStubFactory'
import { type PackageManager, packageManagerLockfiles } from './newStubDoctor'
import { ensureChildProcessCwd, normalizeCommand, sanitizeAndSerialize } from './utils'

export type BaseSpawnCtx = DefaultCtx<typeof mod.spawnCommand>

export type SpawnCtx = BaseSpawnCtx & {
  command: string
  args: string[]
  key: string
}

/** SpawnCommand context builder */
export const buildSpawnContext = ({ raw, original, cache }: BaseSpawnCtx): SpawnCtx => {
  const [rawCommand, rawArgs, , spawnOptions] = raw

  // throw if we are missing cwd in spawnOptions
  ensureChildProcessCwd(rawCommand, rawArgs, spawnOptions)

  const { command, args, key } = normalizeCommand(rawCommand, rawArgs)

  return {
    raw,
    original,
    command,
    args,
    key,
    cache,
  }
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
    const err = Object.assign(new Error(entry.message), {
      stderr: entry.stderr,
      exitCode: entry.exitCode,
    })
    throw err
  }

  return entry
}

export const newStubSpawnCommand = createStub(mod.spawnCommand, mod, 'spawnCommand', buildSpawnContext)

newStubSpawnCommand.use(generalActions)
newStubSpawnCommand.use(generalCache)
