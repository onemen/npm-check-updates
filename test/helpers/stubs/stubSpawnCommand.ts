import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
// import { type MockInstance, vi } from 'vitest'
import * as mod from '../../../src/lib/spawnCommand'
import type { StubRegistration } from '../FileCacheManager'

/** Helper to clean up dynamic paths/outputs if needed */
const sanitize = (str: string) => str

export const stubSpawnCommand: StubRegistration = {
  name: 'spawnCommand',
  setupMock(cache) {
    // 1. Grab the real underlying function for cache misses
    // (Using vi.spyOn handles tracking, we look up the original from Vitest's spy metadata or a direct import)
    const original = mod.spawnCommand

    console.log('spawnCommand setupMock called\noriginal', original.toString())

    vi.spyOn(mod, 'spawnCommand').mockImplementation(
      async (command: string, args: string[], spawnPleaseOptions?: any, spawnOptions?: any) => {
        console.log('mocked spawnCommand called', { command, args, spawnPleaseOptions, spawnOptions })

        // --- Side-Effect Logic (Package Manager Installs) ---
        // This runs instantly every time since it modifies the local project filesystem workspace
        const isPackageManagerInstall =
          ['npm', 'pnpm', 'yarn', 'bun'].includes(command) && args.length === 1 && args[0] === 'install'

        if (isPackageManagerInstall) {
          const cwd = spawnOptions?.cwd?.toString()
          if (cwd) {
            const lockfilePath = path.join(cwd, 'package-lock.json')
            await fs.promises.writeFile(lockfilePath, '', 'utf8')
            await fs.promises.mkdir(path.join(cwd, 'node_modules'), { recursive: true })
          }
          const stdout = `stubSpawnCommand for ${command} install finished successfully.`

          // Delegate to cache using a fixed key 'install'
          return cache.getOrSet('spawnCommand', 'install', () => ({ stdout, stderr: '' }))
        }

        // --- Cacheable Command Execution Flow ---
        const key = createHash('sha256').update(JSON.stringify({ command, args })).digest('hex')

        // Pass the fallback execution block to cache.getOrSet
        const entry = await cache.getOrSet('spawnCommand', key, async () => {
          // This block ONLY executes on cache miss or when REGENERATE_TEST_CACHE=true
          try {
            const result = await original(command, args, spawnPleaseOptions, spawnOptions)
            if (result.stderr) result.stderr = sanitize(result.stderr)
            console.log('result', result)

            return result
          } catch (err: any) {
            return {
              _isError: true,
              message: sanitize(err.message || err.toString()),
              stderr: sanitize(err.stderr || ''),
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
