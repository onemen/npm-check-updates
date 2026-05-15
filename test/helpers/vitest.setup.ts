import { afterEach } from 'vitest'
import globalSetup from './globalSetup'
import { cleanupCliMocks } from './runNcuCli.js'

globalSetup()

afterEach(() => {
  cleanupCliMocks()
})
