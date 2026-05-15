import { afterEach, beforeAll } from 'vitest'
import globalSetup from './globalSetup'
import { cleanupCliMocks } from './inProcessCli'

beforeAll(() => {
  globalSetup()
})

afterEach(() => {
  cleanupCliMocks()
})
