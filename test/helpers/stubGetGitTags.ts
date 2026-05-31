import fs from 'fs'
import { type MockInstance } from 'vitest'
import { gitApi } from '../../src/package-managers/gitTags'
import { applyPersistentMockRestore, getFixturePath } from './mockUtils'

export type GetGitTagsStub = MockInstance<typeof gitApi.getGitTags>

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
  let initialFixtures = ''

  if (fs.existsSync(fixturePath)) {
    fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'))
    initialFixtures = JSON.stringify(fixtures)
  } else if (!process.env.NCU_SAVE_FIXTURES) {
    throw new Error(`Fixture not found: ${fixturePath}.\nRun with NCU_SAVE_FIXTURES=true`)
  }

  const original = gitApi.getGitTags

  const spy: MockInstance = vi.spyOn(gitApi, 'getGitTags').mockImplementation(async (url: string) => {
    const key = url // Using URL as the key
    const entry = fixtures[key]

    if (entry?._isError) {
      throw new Error(entry.message)
    }

    if (entry) return entry

    if (!process.env.NCU_SAVE_FIXTURES) {
      throw new Error(`Missing fixture for URL: ${url}.\nRun with NCU_SAVE_FIXTURES=true to record.`)
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

  return applyPersistentMockRestore(spy, {
    fixturePath,
    label: 'stubGetGitTags',
    fixtures,
    initialFixtures,
  })
}
