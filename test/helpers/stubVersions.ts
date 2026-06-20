import { AsyncLocalStorage } from 'node:async_hooks'
import { type RunnerTestFile } from 'vitest'
import { expect } from 'vitest'
import { npmApi } from '../../src/package-managers/npm'
import { type MockedVersions } from '../../src/types/MockedVersions'

/**
 * Stub Auto‑Restore System
 * ------------------------
 * All stubs created in tests are automatically restored after each test.
 *
 * How it works:
 * 1. Each test is wrapped by `aroundEach` (registered in vitest.setup).
 * 2. At the start of a test, we create a fresh Set() and store it in
 * AsyncLocalStorage (`stubRegistry`).
 * 3. Every stub function (e.g. stubVersions, stubFetchPartialPackument)
 * calls `registerStub()`, which adds its { mockRestore } handler to
 * the current test’s Set.
 * 4. After the test finishes — even if it throws — we iterate the Set
 * and call mockRestore() on every registered stub.
 *
 * Why this exists:
 * - Tests often fail before reaching manual cleanup code.
 * - Vitest runs test files in parallel workers, so leaked mocks can
 * affect unrelated files.
 * - Our stubs detect leaks (via throwLeak) and fail fast if a mock is
 * already active.
 *
 * What this guarantees:
 * - Every stub created in a test is restored automatically.
 * - No need for manual stub.mockRestore() in tests.
 * - No cross‑test or cross‑file mock leakage.
 * - Deterministic cleanup, even on test failures.
 *
 * If you add new stub helpers:
 * - Always call registerStub({ mockRestore }) inside the stub function.
 * - Do NOT manually restore stubs in tests — the lifecycle handles it.
 */

const stubRegistry = new AsyncLocalStorage<Set<{ mockRestore: () => void }>>()

/** AsyncLocalStorage registry */
function registerStub(stub: { mockRestore: () => void }) {
  const store = stubRegistry.getStore()
  if (store) store.add(stub)
}

/** throw if test file have a leaked stub */
function ensureNotLeaked(stubName: string, methodName: keyof typeof npmApi) {
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

/** run in vitest.setup */
export const stubLifecycle = {
  registerLifecycle() {
    aroundEach(async runTest => {
      const set = new Set<{ mockRestore: () => void }>()
      return stubRegistry.run(set, async () => {
        await runTest()
        for (const stub of set) {
          stub.mockRestore()
        }
      })
    })
  },
}

/** Stubs the npmView function from package-managers/npm. Returns the stub object. */
const stubVersions = (mockReturnedVersions: MockedVersions) => {
  ensureNotLeaked('stubVersions', 'fetchUpgradedPackumentMemo')

  // // Save the original memoized method reference to avoid fast-memoize side effects
  // const originalMethod = npmApi.fetchUpgradedPackumentMemo

  // // Create a clean standalone Vitest mock function
  // const mockFn = vi.fn().mockImplementation(npmApi.mockFetchUpgradedPackument(mockReturnedVersions))

  // // Directly overwrite the property on the api object
  // npmApi.fetchUpgradedPackumentMemo = mockFn

  // const stub = {
  //   mockRestore() {
  //     // Cleanly swap the original memoized method back into place
  //     npmApi.fetchUpgradedPackumentMemo = originalMethod
  //   },
  // }

  // registerStub(stub)
  // return stub

  const spy = vi
    .spyOn(npmApi, 'fetchUpgradedPackumentMemo')
    .mockImplementation(npmApi.mockFetchUpgradedPackument(mockReturnedVersions))

  registerStub({
    mockRestore() {
      spy.mockRestore()
    },
  })

  return spy
}

/** Stubs fetchPartialPackument. Returns the stub object. */
export const stubFetchPartialPackument = (mockReturnedVersions: MockedVersions) => {
  ensureNotLeaked('stubFetchPartialPackument', 'fetchPartialPackument')

  const spy = vi
    .spyOn(npmApi, 'fetchPartialPackument')
    .mockImplementation(npmApi.mockFetchPartialPackument(mockReturnedVersions))

  registerStub({
    mockRestore() {
      spy.mockRestore()
    },
  })

  return spy
}

export default stubVersions
