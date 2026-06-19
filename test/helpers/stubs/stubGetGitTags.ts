import { gitApi } from '../../../src/package-managers/gitTags'
import { type CacheManager, type DefaultCtx } from '../../types/stubsTypes'
import { createStub } from './genericStubFactory'

type GitTagsCtx = DefaultCtx<typeof gitApi.getGitTags, CacheManager>

/** cache handler */
const cacheHandler = async (ctx: GitTagsCtx) => {
  const { cache, original } = ctx
  const [url] = ctx.raw
  return cache?.getOrSet('getGitTags', url, () => original(url))
}

const stubGetGitTags = createStub(gitApi.getGitTags, gitApi, 'getGitTags')

/** run in vitest.setup */
export const stubGetGitTagsController = {
  registerLifecycle(cacheManager: CacheManager) {
    stubGetGitTags.registerLifecycle(cacheManager, [cacheHandler])
  },
}
