import fs from 'node:fs'
import path from 'node:path'
import * as mod from '../../../src/lib/spawnCommand'
import type { StubRegistration } from '../FileCacheManager'
import { sanitizeAndSerialize } from '../mockUtils'

export const stubSpawnCommand: StubRegistration = {
  name: 'spawnCommand',
  setupMock(cache) {
    const original = mod.spawnCommand

    vi.spyOn(mod, 'spawnCommand').mockImplementation(
      async (command: string, args: string[], spawnPleaseOptions?: any, spawnOptions?: any) => {
        /** */
        const quoteIfNeeded = (s: string) => (s.includes(' ') ? JSON.stringify(s) : s)
        const key =
          args.length > 0
            ? `command: ${command}, args: ${args.map(quoteIfNeeded).join(' :: ')}`
            : `command: ${command}, args: <none>`

        const isPackageManagerInstall =
          ['npm', 'pnpm', 'yarn', 'bun'].includes(command) && args.length === 1 && args[0] === 'install'

        if (isPackageManagerInstall) {
          const cwd = spawnOptions?.cwd?.toString()
          if (cwd) {
            // Create the empty lockfile and empty node_module
            const lockfilePath = path.join(cwd, 'package-lock.json')
            await fs.promises.writeFile(lockfilePath, '', 'utf8')
            await fs.promises.mkdir(path.join(cwd, 'node_modules'), { recursive: true })
          }
          const stdout = `stubSpawnCommand for ${command} install finished successfully.`
          // Delegate to cache using a fixed key 'install'
          return cache.getOrSet('spawnCommand', 'install', () => ({ stdout, stderr: '' }))
        }

        const entry = await cache.getOrSet('spawnCommand', key, async () => {
          try {
            const result = await original(command, args, spawnPleaseOptions, spawnOptions)
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
