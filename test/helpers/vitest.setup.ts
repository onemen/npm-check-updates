import { afterEach, beforeAll } from 'vitest'
import globalSetup from './globalSetup'
import { cleanupCliMocks } from './runNcuCli.js'

beforeAll(() => {
  globalSetup()
})

afterEach(() => {
  cleanupCliMocks()
})
