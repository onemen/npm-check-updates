import { gitApi } from '../../../src/package-managers/gitTags'
import { type FileCacheManager } from '../FileCacheManager'
import { type DefaultCtx, createStub } from './genericStubFactory'

export type GitTagsCtx = DefaultCtx<typeof gitApi.getGitTags, FileCacheManager>

/** cache handler */
const generalCache = async (ctx: GitTagsCtx) => {
  const { cache, original } = ctx
  const [url] = ctx.raw
  return cache?.getOrSet('getGitTags', url, async () => await original(url))
}

export const stubGetGitTags = createStub(gitApi.getGitTags, gitApi, 'getGitTags')

stubGetGitTags.use(generalCache)
