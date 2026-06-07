import fs from 'fs/promises'
import ncu from '../src/'
import { runNcuCli } from './helpers/runNcuCli'
import stubVersions from './helpers/stubVersions'

describe('timeout', async () => {
  let pkgPath: string
  let stub: { mockRestore: () => void }
  beforeEach(async () => {
    pkgPath = await sandbox.createPackageJson({ dependencies: { express: '1' } })
    stub = stubVersions({ express: '1' })
  })
  afterEach(async () => {
    stub.mockRestore()
  })

  it('throw an exception instead of printing to the console when timeout is exceeded', async () => {
    const controller = new AbortController()
    const abortEvent = new Promise((_resolve, reject) => {
      controller.signal.addEventListener('abort', () => reject(new Error('aborted')))
    })

    const upgraded = ncu({
      packageData: await fs.readFile(pkgPath, 'utf-8'),
      timeout: 1,
      // @ts-expect-error - for testing abort event
      controller,
    })

    upgraded.should.eventually.be.rejectedWith(/Exceeded global timeout of 1ms|Idle timeout reached/)
    abortEvent.should.eventually.be.rejectedWith('aborted')
  })

  it('exit with error when timeout is exceeded', async () => {
    await runNcuCli(['--timeout', '1'], {
      stdin: '{ "dependencies": { "express": "1" } }',
    }).should.eventually.be.rejectedWith(/Exceeded global timeout of 1ms|Idle timeout reached/)
  })

  it('completes successfully with timeout', async () => {
    await runNcuCli(['--timeout', '100000'], {
      stdin: '{ "dependencies": { "express": "1" } }',
    })
  })
})
