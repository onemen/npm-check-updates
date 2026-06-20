import { type RunnerTestFile } from 'vitest'
import { expect } from 'vitest'
import { npmApi } from '../../src/package-managers/npm'
import { type MockedVersions } from '../../src/types/MockedVersions'

/** throw if test file have a leaked stub */
export function ensureNotLeaked(stubName: string, methodName: keyof typeof npmApi) {
  if (!vi.isMockFunction(npmApi[methodName])) {
    return
  }

  const state = expect.getState()
  const file = { filepath: state.testPath } as RunnerTestFile

  const message =
    `Leaked stub: ${stubName}\n` +
    `  Method: ${methodName}\n` +
    `  File: ${file.filepath}\n` +
    `  Note: This mock was already active before this stub was created.\n` +
    `        The leak may have originated in this test file OR in a previous\n` +
    `        test file that ran earlier in the same worker.\n` +
    `  Fix: Ensure every test that creates this stub calls stub.mockRestore() in afterEach.`

  throw new Error(message)
}

/** Stubs the npmView function from package-managers/npm. Returns the stub object. Call stub.mockRestore() after assertions to restore the original function. Set spawn:true to stub ncu spawned as a child process. */
const stubVersions = (mockReturnedVersions: MockedVersions, { spawn }: { spawn?: boolean } = {}) => {
  // stub child process
  // the only way to stub functionality in spawned child processes is to pass data through process.env and stub internally
  if (spawn) {
    process.env.STUB_VERSIONS = JSON.stringify(mockReturnedVersions)
    return {
      mockRestore: () => {
        // Changed name to match your global find-and-replace
        process.env.STUB_VERSIONS = ''
      },
    }
  }

  ensureNotLeaked('stubVersions', 'fetchUpgradedPackumentMemo')

  // Save the original memoized method reference to avoid fast-memoize side effects
  const originalMethod = npmApi.fetchUpgradedPackumentMemo

  // Create a clean standalone Vitest mock function
  const mockFn = vi.fn().mockImplementation(npmApi.mockFetchUpgradedPackument(mockReturnedVersions))

  // Directly overwrite the property on the api object
  npmApi.fetchUpgradedPackumentMemo = mockFn

  return {
    mockRestore: () => {
      // Cleanly swap the original memoized method back into place
      npmApi.fetchUpgradedPackumentMemo = originalMethod
    },
  }
}

/** Stubs fetchPartialPackument. Returns the stub object. Call stub.mockRestore() after assertions to restore the original function. */
export const stubFetchPartialPackument = (mockReturnedVersions: MockedVersions) => {
  ensureNotLeaked('stubFetchPartialPackument', 'fetchPartialPackument')

  const originalMethod = npmApi.fetchPartialPackument

  const mockFn = vi.fn().mockImplementation(npmApi.mockFetchPartialPackument(mockReturnedVersions))

  npmApi.fetchPartialPackument = mockFn

  return {
    mockRestore: () => {
      npmApi.fetchPartialPackument = originalMethod
    },
  }
}

export default stubVersions
