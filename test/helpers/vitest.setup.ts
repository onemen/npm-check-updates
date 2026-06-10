import { config, should as initShould, use } from 'chai'
import chaiAsPromised from 'chai-as-promised'
import chaiString from 'chai-string'
import { installGlobalErrorHandlers } from '../../src/lib/utils/global-error-handlers'
import { FileCacheManager } from './FileCacheManager'
import { TestSandbox } from './TestSandbox'
import { registerIOCapture } from './mockIO'
import { createParseGitHubUrlMock } from './stubParseGitHubUrl'
import { registerTestNameCapture } from './testNameStore'

installGlobalErrorHandlers()

const should = initShould()

use(chaiAsPromised)
use(chaiString)

config.truncateThreshold = 0

process.env.NCU_TESTS = 'true'
;(global as any).should = should

// Mock 'parse-github-url' to provide consistent parsing results for GitHub URLs in tests
vi.mock('parse-github-url', async importOriginal => {
  return createParseGitHubUrlMock(importOriginal)
})

// must run before anything that uses getTestName()
registerTestNameCapture()

// Registers beforeEach/afterEach to install global IO capture.
registerIOCapture()

/* Initialize the test sandbox and make it globally available for all tests */
TestSandbox.registerLifecycle()

FileCacheManager.bootstrap()
