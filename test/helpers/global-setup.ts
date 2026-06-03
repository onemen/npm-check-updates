import { TestSandbox } from './TestSandbox'
import { saveGithubUrlsFixtures } from './stubParseGitHubUrl'

/** global setup  */
export function setup() {
  // teardown
  return () => {
    saveGithubUrlsFixtures()
    TestSandbox.finalCleanup()
  }
}
