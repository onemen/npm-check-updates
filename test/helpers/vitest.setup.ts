import { config, should as initShould, use } from 'chai'
import chaiAsPromised from 'chai-as-promised'
import chaiString from 'chai-string'
import { installGlobalErrorHandlers } from '../../src/lib/utils/global-error-handlers'
import { TestSandbox } from './TestSandbox'
import { setupLogMocks } from './mock-output'
import { createParseGitHubUrlMock } from './stubParseGitHubUrl'

installGlobalErrorHandlers()

const should = initShould()

use(chaiAsPromised)
use(chaiString)

config.truncateThreshold = 0

process.env.NCU_TESTS = 'true'
;(global as any).should = should

/* Initialize the test sandbox and make it globally available for all tests */
;(globalThis as any).sandbox = TestSandbox.registerLifecycle()

// Mock 'parse-github-url' to provide consistent parsing results for GitHub URLs in tests
vi.mock('parse-github-url', async importOriginal => {
  return createParseGitHubUrlMock(importOriginal)
})

// mock all console methods to capture debug logs
// stream spies (stdout/stderr) are added per-test in createMock() to avoid conflicts
let mock: { mockRestore(): void }
beforeEach(() => {
  mock = setupLogMocks()
})

afterEach(() => {
  mock.mockRestore()
})
