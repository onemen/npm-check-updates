import { config, should as initShould, use } from 'chai'
import chaiAsPromised from 'chai-as-promised'
import chaiString from 'chai-string'
import { TestSandbox } from './TestSandbox'

const should = initShould()

use(chaiAsPromised)
use(chaiString)

config.truncateThreshold = 0

process.env.NCU_TESTS = 'true'
;(global as any).should = should

/* Initialize the test sandbox and make it globally available for all tests */
;(globalThis as any).sandbox = TestSandbox.registerLifecycle()

/**
 * Unhandled error handlers for test debugging.
 * These help catch and log errors that would otherwise be silently swallowed.
 */
process.on('unhandledRejection', reason => {
  console.error('[Unhandled Rejection]:', reason)
})

process.on('uncaughtException', error => {
  console.error('[Uncaught Exception]:', error)
})
