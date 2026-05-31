import { npmApi } from '../../src/package-managers/npm'
import { type MockedVersions } from '../../src/types/MockedVersions'

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
