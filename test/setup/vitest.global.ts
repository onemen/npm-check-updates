import { TestSandbox } from '../helpers/TestSandbox'

/** global setup  */
export function setup() {
  // teardown
  return () => {
    TestSandbox.finalCleanup()
  }
}
