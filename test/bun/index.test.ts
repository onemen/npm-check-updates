import { spawnSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as bun from '../../src/package-managers/bun'
import { mockPackageManagerRun, sandbox, testFail, testPass } from '../helpers/doctorHelpers'
import { stubSpawnCommand } from '../helpers/stubSpawnCommand.js'
import stubVersions from '../helpers/stubVersions'

const __dirname = dirname(fileURLToPath(import.meta.url))

const mockNpmVersions = {
  emitter20: '2.0.0',
  'ncu-test-return-version': '2.0.0',
  'ncu-test-tag': '1.1.0',
  'ncu-test-v2': '2.0.0',
}

describe('bun', function () {
  let versionStub: { mockRestore: () => void }
  let spawnStub: StubWithSave

  // Use a synchronous check to fail the suite immediately if bun is missing
  beforeAll(function () {
    const result = spawnSync('bun', ['--version'], {
      encoding: 'utf8',
    })

    // On Windows, if 'bun' is missing, status is 1 and error is null.
    // On Linux, if 'bun' is missing, status is 127 and error is null.
    if (result.status !== 0 || result.error) {
      const details = result.stderr?.trim() || result.error?.message || 'Unknown error'

      throw new Error(
        `Required executable 'bun' not found in PATH.\n` +
          `To run these tests, please install Bun: https://bun.sh/docs/installation\n` +
          `System Error: ${details}`,
      )
    }

    versionStub = stubVersions(mockNpmVersions, { spawn: true })
    mockPackageManagerRun()
  })

  afterEach(async context => {
    spawnStub?.mockRestore(context)
  })

  afterAll(async () => {
    versionStub.mockRestore()
  })

  it('list', async () => {
    spawnStub = await stubSpawnCommand('bun list')
    const result = await bun.list({ cwd: __dirname })
    result.should.have.property('ncu-test-v2')
  })

  it('latest', async () => {
    const { version } = await bun.latest('ncu-test-v2', '1.0.0', { cwd: __dirname })
    version!.should.equal('2.0.0')
  })

  describe('doctor', function () {
    // Note: Vitest has testTimeout in config; per-suite timeout not needed here

    afterAll(async () => {
      await sandbox.cleanup()
    })

    testPass({ packageManager: 'bun' })
    testFail({ packageManager: 'bun' })
  })
})
