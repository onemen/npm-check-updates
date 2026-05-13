import { beforeAll } from 'vitest'
import globalSetup from './globalSetup'

/**
 * Global setup for Vitest.
 * Called before all tests run.
 */
beforeAll(() => {
  globalSetup()
})
