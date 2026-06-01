import fs from 'fs/promises'
import path, { dirname } from 'path'
import { fileURLToPath } from 'url'
import ncu from '../src/'
import { runNcuCli } from './helpers/runNcuCli'
import stubVersions from './helpers/stubVersions'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('timeout', async () => {
  it('throw an exception instead of printing to the console when timeout is exceeded', async () => {
    const pkgPath = path.join(__dirname, './test-data/ncu/package-large.json')
    return ncu({
      packageData: await fs.readFile(pkgPath, 'utf-8'),
      timeout: 1,
    }).should.eventually.be.rejectedWith(/Exceeded global timeout of 1ms|Idle timeout reached/)
  })

  it('exit with error when timeout is exceeded', async () => {
    return runNcuCli(['--timeout', '1'], {
      stdin: '{ "dependencies": { "express": "1" } }',
    }).should.eventually.be.rejectedWith(/Exceeded global timeout of 1ms|Idle timeout reached/)
  })

  it('completes successfully with timeout', async () => {
    await sandbox.createPackageJson()
    const stub = stubVersions('99.9.9', { spawn: true })
    await runNcuCli(['--timeout', '100000'], { stdin: '{ "dependencies": { "express": "1" } }' })
    stub.mockRestore()
  })
})
