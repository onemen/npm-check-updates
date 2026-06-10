import { type SpawnOptions } from 'child_process'
import { createHash } from 'crypto'
import fs from 'fs'
import path from 'path'
import { type MockInstance } from 'vitest'
import * as mod from '../../src/lib/spawnCommand'
import { type SpawnPleaseOptions } from '../../src/types/SpawnPleaseOptions'
import { applyPersistentMockRestore, getFixturePath, sanitize, serializeTokens } from './mockUtils'

export type SpawnCommandStub = MockInstance<typeof mod.spawnCommand>

/**
 * Stubs `spawnCommand` and enables a record-and-replay workflow for test fixtures.
 * * Usage:
 * import { stubSpawnCommand } from './helpers/stubSpawnCommand';
 * * let stub: any;
 * afterEach(() => stub?.mockRestore());
 * * it('runs a command', async () => {
 * stub = await stubSpawnCommand('my-test-fixture');
 * // ... test code ...
 * });
 * * @param fixtureName - The name used for the fixture file (saved in `../fixtures/<name>.json`).
 * Spaces are automatically converted to underscores.
 */
export async function stubSpawnCommand(fixtureName: string) {
  const fixturePath = getFixturePath('spawnCommand', fixtureName)

  let fixtures: Record<string, any> = {}
  let initialFixtures = ''

  if (fs.existsSync(fixturePath)) {
    fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'))
    initialFixtures = JSON.stringify(fixtures)
  } else if (!process.env.NCU_SAVE_FIXTURES) {
    throw new Error(
      `Fixture not found: ${fixturePath}\n` +
        `To generate this fixture, run the test with: NCU_SAVE_FIXTURES=true npm test`,
    )
  }

  const actualModule = await vi.importActual<typeof mod>('../../src/lib/spawnCommand')
  const original = actualModule.spawnCommand

  const spy: MockInstance = vi
    .spyOn(mod, 'spawnCommand')
    .mockImplementation(
      async (command: string, args: string[], spawnPleaseOptions?: SpawnPleaseOptions, spawnOptions?: SpawnOptions) => {
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
          fixtures.install = stdout
          return { stdout, stderr: '' }
        }

        const key = createHash('sha256').update(JSON.stringify({ command, args })).digest('hex')

        const entry = fixtures[key]
        if (entry?._isError) {
          const err = new Error(entry.message)
          ;(err as any).stderr = entry.stderr
          ;(err as any).exitCode = entry.exitCode
          throw err
        }
        if (entry) return entry

        try {
          const result = await original(command, args, spawnPleaseOptions, spawnOptions)
          let { stdout, stderr } = result
          if (stderr) stderr = serializeTokens(sanitize(stderr))
          if (stdout) stdout = serializeTokens(sanitize(stdout))
          fixtures[key] = { stdout, stderr }
          return result
        } catch (err: any) {
          fixtures[key] = {
            _isError: true,
            message: serializeTokens(sanitize(err.message || err.toString())),
            stderr: serializeTokens(sanitize(err.stderr || '')),
            exitCode: err.exitCode ?? 1,
          }
          throw err
        }
      },
    )

  return applyPersistentMockRestore(spy, {
    fixturePath,
    label: 'stubSpawnCommand',
    fixtures,
    initialFixtures,
  })
}
