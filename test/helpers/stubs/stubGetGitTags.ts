import { gitApi } from '../../../src/package-managers/gitTags'
import { type DefaultCtx } from '../../types/stubsTypes'
import { type FileCacheManager } from '../FileCacheManager'
import { createStub } from './genericStubFactory'
import { sanitizeAndSerialize } from './utils'

export type GitTagsCtx = DefaultCtx<typeof gitApi.getGitTags, FileCacheManager>

/** cache handler */
const generalCache = async (ctx: GitTagsCtx) => {
  const { cache, original } = ctx
  const [url] = ctx.raw
  const entry = await cache?.getOrSet('getGitTags', url, async () => {
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
}

export const stubGetGitTags = createStub(gitApi.getGitTags, gitApi, 'getGitTags')

stubGetGitTags.use(generalCache)
