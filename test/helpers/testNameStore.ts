import { AsyncLocalStorage } from 'node:async_hooks'

const store = new AsyncLocalStorage<string>()

/** use by vitest.setup.ts to register this lifecycle */
export function registerTestNameCapture() {
  beforeEach(() => {
    const name = expect.getState().currentTestName || 'unknown'
    store.enterWith(name)
  })
}

/** return test name */
export function getTestName() {
  const name = store.getStore()
  if (!name) {
    throw new Error(
      'getTestName() called outside of a test context. ' +
        'Ensure registerTestNameCapture() runs early in vitest.setup.',
    )
  }
  return name
}
