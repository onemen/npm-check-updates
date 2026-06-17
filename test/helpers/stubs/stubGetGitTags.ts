import { gitApi } from '../../../src/package-managers/gitTags'
import { type DefaultCtx } from '../../types/stubsTypes'
import { type FileCacheManager } from './FileCacheManager'
import { createStub } from './genericStubFactory'

export type GitTagsCtx = DefaultCtx<typeof gitApi.getGitTags, FileCacheManager>

/** cache handler */
const cacheHandler = async (ctx: GitTagsCtx) => {
  const { cache, original } = ctx
  const [url] = ctx.raw
  return cache?.getOrSet('getGitTags', url, () => original(url))
}

export const stubGetGitTags = createStub(gitApi.getGitTags, gitApi, 'getGitTags')

stubGetGitTags.use(cacheHandler)
