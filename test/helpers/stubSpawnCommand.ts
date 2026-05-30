import { type SpawnOptions } from 'child_process'
import { createHash } from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import * as mod from '../../src/lib/spawnCommand'
import { type SpawnPleaseOptions } from '../../src/types/SpawnPleaseOptions'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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
  if (!fixtureName) {
    throw new Error('stubSpawnCommand: fixtureName is required')
  }

  const normalizedName = fixtureName.replace(/\s+/g, '_')
  const fixturePath = path.resolve(__dirname, '..', 'fixtures', 'spawnCommand', `${normalizedName}.json`)

  let fixtures: Record<string, any> = {}
  let fixturesLoaded = false
  let initialFixtures = '{}'

  const actualModule = await vi.importActual<typeof mod>('../../src/lib/spawnCommand')
  const original = actualModule.spawnCommand

  const spy: StubWithSave = vi
    .spyOn(mod, 'spawnCommand')
    .mockImplementation(
      async (command: string, args: string[], spawnPleaseOptions?: SpawnPleaseOptions, spawnOptions?: SpawnOptions) => {
        const isPackageManagerInstall =
          ['npm', 'pnpm', 'yarn', 'bun'].includes(command) && args.length === 1 && args[0] === 'install'

        if (isPackageManagerInstall) {
          return { stdout: 'packages installed successfully', stderr: '' }
        }

        if (!fixturesLoaded) {
          if (fs.existsSync(fixturePath)) {
            fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'))
          } else if (!process.env.NCU_SAVE_FIXTURES) {
            throw new Error(
              `Fixture not found: ${fixturePath}\n` +
                `To generate this fixture, run the test with: NCU_SAVE_FIXTURES=true npm test`,
            )
          }
          initialFixtures = JSON.stringify(fixtures)
          fixturesLoaded = true
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

        if (!process.env.NCU_SAVE_FIXTURES) {
          throw new Error(
            `Missing fixture for: ${command} ${args.join(' ')}. Run with NCU_SAVE_FIXTURES=true to record.`,
          )
        }

        try {
          const result = await original(command, args, spawnPleaseOptions, spawnOptions)
          fixtures[key] = result
          return result
        } catch (err: any) {
          fixtures[key] = {
            _isError: true,
            message: err.message || err.toString(),
            stderr: err.stderr || '',
            exitCode: err.exitCode ?? 1,
          }
          throw err
        }
      },
    )

  const originalRestore = spy.mockRestore.bind(spy)

  spy.mockRestore = (context: any) => {
    if (!context) {
      console.warn(
        `[stubSpawnCommand] Warning: mockRestore() called without 'context'. ` +
          `Fixture data will NOT be saved for: ${fixtureName}`,
      )
    }

    const isPassed = context?.task?.result?.state === 'pass'
    const shouldSave =
      process.env.NCU_SAVE_FIXTURES && fixturesLoaded && JSON.stringify(fixtures) !== initialFixtures && isPassed

    if (shouldSave) {
      const dir = path.dirname(fixturePath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(fixturePath, JSON.stringify(fixtures, null, 2))
    }

    return originalRestore()
  }

  return spy
}
