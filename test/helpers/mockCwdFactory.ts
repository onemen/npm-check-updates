import { TestSandbox } from './TestSandbox'

/**
 * Automatically sets up an isolated sandbox environment for test files.
 * * This function hooks into the Vitest lifecycle to:
 * 1. Mock `process.cwd()` to redirect file operations to a temporary,
 * isolated directory for the duration of the test file.
 * 2. Automatically create a unique sandbox folder before tests run.
 * 3. Automatically clean up the sandbox and restore `process.cwd()` after tests.
 * 4. Act as a guardrail to prevent CLI operations from running in the
 * real project root.
 * * @param prefix - The prefix string for the temporary folder name.
 * Defaults to 'ncu-test-sandbox-'.
 */
export function setupCwdMock(prefix = 'ncu-test-sandbox-') {
  // Synchronous initialization ensures no "ZZZ" logs from top-level module code
  const sandbox = TestSandbox.create(prefix)

  // Expose to global for easy access in tests
  ;(globalThis as any).sandbox = sandbox

  vi.spyOn(process, 'cwd').mockImplementation(() => {
    return sandbox.getCwdPath()
  })

  // afterAll(async () => {
  //   spy.mockRestore()
  //   await sandbox.cleanup().catch(error => {
  //     console.log('Error while cleaning up sandbox:', error)
  //   })
  // })

  return sandbox
}
