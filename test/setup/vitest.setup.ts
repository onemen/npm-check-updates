import { config, should as initShould, use } from 'chai'
import chaiAsPromised from 'chai-as-promised'
import chaiString from 'chai-string'
import { installGlobalErrorHandlers } from '../../src/lib/utils/global-error-handlers'
import { FileCacheManager } from '../helpers/FileCacheManager'
import { TestSandbox } from '../helpers/TestSandbox'
import { registerIOCapture } from '../helpers/mockIO'
import { stubGetGitTags } from '../helpers/stubs/stubGetGitTags'
import { stubSpawnPlease } from '../helpers/stubs/stubSpawnPlease'
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

FileCacheManager.registerLifecycle([stubSpawnPlease, stubGetGitTags])
