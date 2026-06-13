import { gitApi } from '../../../src/package-managers/gitTags'
import { type StubRegistration } from '../FileCacheManager'

export const stubGetGitTags: StubRegistration = {
  name: 'getGitTags',
  setupMock(cache) {
    const original = gitApi.getGitTags

    vi.spyOn(gitApi, 'getGitTags').mockImplementation(async (url: string) => {
      const entry = await cache.getOrSet('getGitTags', url, async () => {
        try {
          // await here to make sure we catch the error
          return await original(url)
        } catch (err: any) {
          return {
            _isError: true,
            message: err.message || err.toString(),
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
    })
  },
}
