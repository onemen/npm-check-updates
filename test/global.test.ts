import { expect } from 'chai'
import path, { dirname } from 'path'
import { fileURLToPath } from 'url'
import { spawn } from './helpers/inProcessCli.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const bin = path.join(__dirname, '../build/cli.js')

describe('global', () => {
  // TODO: Hangs on Windows
  const itSkipWindows = process.platform === 'win32' ? it.skip : it
  itSkipWindows('global should run', async () => {
    const { stdout } = await spawn('node', [bin, '--jsonUpgraded', '--global', 'npm'])
    expect(JSON.parse(stdout))
  })
})
