import fs from 'fs'
import { type MockInstance } from 'vitest'
import { gitApi } from '../../src/package-managers/gitTags'
import { applyPersistentMockRestore, getFixturePath } from './mockUtils.js'

/**
 * Stubs `getGitTags` and enables a record-and-replay workflow for test fixtures.
 * * Usage:
 * import { stubGetGitTags } from './helpers/stubGetGitTags';
 * * let stub: any;
 * afterEach((context) => stub?.mockRestore(context));
 * * it('fetches tags', async () => {
 * stub = await stubGetGitTags('my-test-fixture');
 * // ... test code ...
 * });
 * * @param fixtureName - The name used for the fixture file (saved in `../fixtures/git/<name>.json`).
 * Spaces are automatically converted to underscores.
 */
export async function stubGetGitTags(fixtureName: string) {
  const fixturePath = getFixturePath('getGitTags', fixtureName)

  let fixtures: Record<string, any> = {}
  let fixturesLoaded = false
  let initialFixtures = '{}'

  const original = gitApi.getGitTags

  const spy: MockInstance = vi.spyOn(gitApi, 'getGitTags').mockImplementation(async (url: string) => {
    if (!fixturesLoaded) {
      if (fs.existsSync(fixturePath)) {
        fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'))
      } else if (!process.env.NCU_SAVE_FIXTURES) {
        throw new Error(`Fixture not found: ${fixturePath}. Run with NCU_SAVE_FIXTURES=true`)
      }
      initialFixtures = JSON.stringify(fixtures)
      fixturesLoaded = true
    }

    const key = url // Using URL as the key
    const entry = fixtures[key]

    if (entry?._isError) {
      throw new Error(entry.message)
    }

    if (entry) return entry

    if (!process.env.NCU_SAVE_FIXTURES) {
      throw new Error(`Missing fixture for URL: ${url}. Run with NCU_SAVE_FIXTURES=true to record.`)
    }

    try {
      const result = await original(url)
      fixtures[key] = result
      return result
    } catch (err: any) {
      fixtures[key] = {
        _isError: true,
        message: err.message || err.toString(),
      }
      throw err
    }
  })

  spy.invalidate = async () => {
    const results = spy.mock.results
    if (!results) return

    for (const result of results) {
      if (result.type === 'throw') {
        if (result.value instanceof Error && result.value.message.includes('Fixture not found')) {
          throw result.value
        }
      } else if (result.type === 'return' && result.value instanceof Promise) {
        try {
          await result.value
        } catch (err: any) {
          // Only throw if it matches our specific fixture error
          if (err instanceof Error && err.message.includes('Fixture not found')) {
            throw err
          }
        }
      }
    }
  }

  return applyPersistentMockRestore(spy, {
    fixturePath,
    label: 'stubGetGitTags',
    fixtures,
    initialFixtures,
  })
}
