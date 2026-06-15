import { gitApi } from '../../../src/package-managers/gitTags'
import { type FileCacheManager } from '../FileCacheManager'
import { sanitizeAndSerialize } from './utils'

/** stub factory for getGitTags */
export function stubGetGitTags() {
  return {
    name: 'getGitTags',
    setupMock(cache: FileCacheManager) {
      const original = gitApi.getGitTags

      vi.spyOn(gitApi, 'getGitTags').mockImplementation(async (url: string) => {
        const entry = await cache.getOrSet('getGitTags', url, async () => {
          try {
            // await here to make sure we catch the error
            return await original(url)
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
      })
    },
  }
}
