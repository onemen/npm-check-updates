import { config, should as initShould, use } from 'chai'
import chaiAsPromised from 'chai-as-promised'
import chaiString from 'chai-string'

/** Global test setup for chai and environment. */
const globalSetup = () => {
  // In Chai 5+, should() is an imported function that initializes the prototype
  const should = initShould()

  // Use the named 'use' function instead of 'chai.use'
  use(chaiAsPromised)
  use(chaiString)

  // do not truncate strings in error messages
  config.truncateThreshold = 0

  process.env.NCU_TESTS = 'true'

  // Make should available globally for tests that use should.exist(), etc.
  ;(global as any).should = should

  return should
}

export default globalSetup
