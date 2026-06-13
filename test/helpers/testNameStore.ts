import { AsyncLocalStorage } from 'node:async_hooks'

const store = new AsyncLocalStorage<{ name: string; fullName: string; header: string }>()

/** use by vitest.setup.ts to register this lifecycle */
export function registerTestNameCapture() {
  beforeEach(context => {
    const fileName = context.task.file?.name ?? 'unknown'
    const testName = context.task.name ?? 'unknown'
    const fullTestName = context.task.fullTestName ?? 'unknown'
    const header = `${fileName} > ${testName}`
    store.enterWith({ name: testName, fullName: fullTestName, header })
  })
}

const errorMsg = 'called outside of a test context. Ensure registerTestNameCapture() runs early in vitest.setup.'

/** return test name */
export function getTestName() {
  const storeValue = store.getStore()
  if (!storeValue) {
    throw new Error(`getTestName ${errorMsg}`)
  }
  return storeValue.name
}

/** return test full name */
export function getFullTestName() {
  const storeValue = store.getStore()
  if (!storeValue) {
    throw new Error(`getFullTestName ${errorMsg}`)
  }
  return storeValue.fullName
}

/** return test header */
export function getOutputHeader() {
  const storeValue = store.getStore()
  if (!storeValue) {
    throw new Error(`getOutputHeader ${errorMsg}`)
  }
  return storeValue.header
}
