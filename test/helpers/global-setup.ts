import { TestSandbox } from './TestSandbox'

/** global setup  */
export function setup() {
  // teardown
  return () => {
    TestSandbox.finalCleanup()
  }
}
