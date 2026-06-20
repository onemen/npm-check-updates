import { config, should as initShould, use } from 'chai'
import chaiAsPromised from 'chai-as-promised'
import chaiString from 'chai-string'
import { installGlobalErrorHandlers } from '../../src/lib/utils/global-error-handlers'
import { TestSandbox } from '../helpers/TestSandbox'
import { registerIOCapture } from '../helpers/mockIO'
import { stubLifecycle } from '../helpers/stubVersions'
import { FileCacheManager } from '../helpers/stubs/FileCacheManager'
import { stubGetGitTagsLifecycle } from '../helpers/stubs/stubGetGitTags'
import { spawnPleaseLifecycle } from '../helpers/stubs/stubSpawnPlease'
import { registerTestNameCapture } from '../helpers/testNameStore'

installGlobalErrorHandlers()

const should = initShould()

use(chaiAsPromised)
use(chaiString)

config.truncateThreshold = 0

process.env.NCU_TESTS = 'true'
;(global as any).should = should

// must run before anything that uses getTestName()
registerTestNameCapture()

// Registers beforeEach/afterEach to install global IO capture.
registerIOCapture()

/* Initialize the test sandbox and make it globally available for all tests */
TestSandbox.registerLifecycle()

/* Initialize the central cache lifecycle */
const cacheManager = FileCacheManager.register()

/* Initialize each global stub/mock and bind it to the cache manager */
spawnPleaseLifecycle.registerLifecycle(cacheManager)
stubGetGitTagsLifecycle.registerLifecycle(cacheManager)

stubLifecycle.registerLifecycle()
