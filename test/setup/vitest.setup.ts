import { config, should as initShould, use } from 'chai'
import chaiAsPromised from 'chai-as-promised'
import chaiString from 'chai-string'
import { installGlobalErrorHandlers } from '../../src/lib/utils/global-error-handlers'
import { FileCacheManager } from '../helpers/FileCacheManager'
import { TestSandbox } from '../helpers/TestSandbox'
import { registerIOCapture } from '../helpers/mockIO'
import { stubGetGitTags } from '../helpers/stubs/stubGetGitTags'
import { initializeUnderlyingSpawn, stubSpawnCommand } from '../helpers/stubs/stubSpawnCommand'
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

vi.mock('spawn-please', async importOriginal => {
  const actual = await importOriginal<any>()
  const originalDefault = actual.default || actual

  // Build out our singleton router wrapper instance
  initializeUnderlyingSpawn(originalDefault)

  return {
    __esModule: true,
    default: async (...args: any[]) => stubSpawnCommand.handleExecution(args),
  }
})

// 2. Safely wire up the life-cycle registry hooks now that execution guarantees alignment
FileCacheManager.registerLifecycle([stubSpawnCommand, stubGetGitTags])
