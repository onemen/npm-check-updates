import fs from 'fs/promises'
import ncu from '../src/'
import { runNcuCli } from './helpers/runNcuCli'
import stubVersions from './helpers/stubVersions'

describe('timeout', async () => {
  let pkgPath: string
  beforeAll(async () => {
    pkgPath = await sandbox.createPackageJson({ dependencies: { express: '1' } })
  })

  it('throw an exception instead of printing to the console when timeout is exceeded', async () => {
    return ncu({
      packageData: await fs.readFile(pkgPath, 'utf-8'),
      timeout: 1,
    }).should.eventually.be.rejectedWith(/Exceeded global timeout of 1ms|Idle timeout reached/)
  })

  it('exit with error when timeout is exceeded', async () => {
    const stub = stubVersions({ express: '1' })
    try {
      await runNcuCli(['--timeout', '1'], {
        stdin: '{ "dependencies": { "express": "1" } }',
      }).should.eventually.be.rejectedWith(/Exceeded global timeout of 1ms|Idle timeout reached/)
    } finally {
      stub.mockRestore()
    }
  })

  it('completes successfully with timeout', async () => {
    const stub = stubVersions('99.9.9', { spawn: true })
    await runNcuCli(['--timeout', '100000'], { stdin: '{ "dependencies": { "express": "1" } }' })
    stub.mockRestore()
  })
})
