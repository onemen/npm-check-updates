import fs from 'fs/promises'
import { stripVTControlCharacters as stripAnsi } from 'node:util'
import os from 'os'
import path from 'path'
import spawnPlease from 'spawn-please'
import { cliOptionsMap } from '../src/cli-options'
import { chalkInit } from '../src/lib/chalk'
import {
  cleanupFixtureCache,
  cleanupTempFolder,
  createNcuRegExp,
  setTrackedTempFolder,
  setupTempFolder,
  testFail,
  testPass,
} from './helpers/doctorHelpers'
import { runNcuCli } from './helpers/runNcuCli'
import stubVersions from './helpers/stubVersions'

const mockNpmVersions = {
  emitter20: '2.0.0',
  'ncu-test-return-version': '2.0.0',
  'ncu-test-tag': '1.1.0',
  'ncu-test-v2': '2.0.0',
}

describe('doctor', function () {
  // 3 min timeout

  let stub: { restore: () => void }
  let originalEnv: NodeJS.ProcessEnv
  let testEnv: Record<string, string>
  const YARN_CACHE_PATH = path.join(os.tmpdir(), `ncu-test-yarn-cache-${Math.random().toString(36).slice(2, 7)}`)

  beforeAll(async () => {
    originalEnv = { ...process.env }
    stub = stubVersions(mockNpmVersions, { spawn: true })
    // Speed up package manager commands spawned by doctor mode during tests
    await fs.mkdir(YARN_CACHE_PATH, { recursive: true })
    testEnv = {
      npm_config_prefer_offline: 'true',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_update_notifier: 'false',
      npm_config_loglevel: 'error',
      yarn_config_prefer_offline: 'true',
      YARN_CACHE_FOLDER: YARN_CACHE_PATH,
      TMPDIR: YARN_CACHE_PATH,
      TEMP: YARN_CACHE_PATH,
      TMP: YARN_CACHE_PATH,
    }
    Object.assign(process.env, testEnv)
  })
  afterAll(async () => {
    stub.restore()

    for (const key in testEnv) process.env[key] = originalEnv[key]

    await cleanupFixtureCache()
    await fs.rm(YARN_CACHE_PATH, { recursive: true, force: true }).catch(() => {})
  })

  // Automatically clears all tracked temporary directories after every single test
  afterEach(async () => {
    await cleanupTempFolder()
  })

  describe('npm', () => {
    it('print instructions when -u is not specified', async () => {
      await chalkInit()
      const cwd = await setupTempFolder('nopackagefile')
      const { stdout } = await runNcuCli(['--doctor'], { cwd })
      return stripAnsi(stdout).should.equal(
        `Usage: ncu --doctor\n\n${stripAnsi(
          (cliOptionsMap.doctor.help as (options: { markdown: boolean }) => string)({ markdown: false }),
        )}\n`,
      )
    })

    it('throw an error if there is no package file', async () => {
      const cwd = await setupTempFolder('nopackagefile')
      return runNcuCli(['--doctor', '-u'], { cwd }).should.eventually.be.rejectedWith('Missing or invalid package.json')
    })

    it('throw an error if there is no test script', async () => {
      const cwd = await setupTempFolder('notestscript')
      return runNcuCli(['--doctor', '-u'], { cwd }).should.eventually.be.rejectedWith('No npm "test" script')
    })

    it('throw an error if --packageData or --packageFile are supplied', async () => {
      return Promise.all([
        runNcuCli(['--doctor', '-u', '--packageFile', 'package.json']).should.eventually.be.rejectedWith(
          '--packageData and --packageFile are not allowed with --doctor',
        ),
        runNcuCli(['--doctor', '-u', '--packageData', '{}']).should.eventually.be.rejectedWith(
          '--packageData and --packageFile are not allowed with --doctor',
        ),
      ])
    })

    testPass({ packageManager: 'npm' })
    testFail({ packageManager: 'npm' })

    it('pass through options', async function () {
      const cwd = await setupTempFolder('options')
      const pkgPath = path.join(cwd, 'package.json')

      let { stdout, stderr } = await runNcuCli(['--doctor', '-u', '--filter', 'ncu-test-v2'], {
        rejectOnError: false,
        cwd,
      })

      const pkgUpgraded = await fs.readFile(pkgPath, 'utf-8')

      // stderr should be empty or equal to the test script output (output varies by platform/node version)
      stderr = stripAnsi(stderr).trim()
      if (stderr !== '') {
        stderr.should.equal(`> test
> node test.js



> test
> node test.js`)
      }

      // stdout should include normal output
      stripAnsi(stdout).should.containIgnoreCase('Tests pass')
      stripAnsi(stdout).should.containIgnoreCase('ncu-test-v2  ~1.0.0  →  ~2.0.0')

      // package file should include upgrades
      pkgUpgraded.should.containIgnoreCase('"ncu-test-v2": "~2.0.0"')
    })

    it('custom install script with --doctorInstall', async function () {
      const cwd = await setupTempFolder('custominstall')
      const pkgPath = path.join(cwd, 'package.json')
      const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'

      let { stdout, stderr } = await runNcuCli(['--doctor', '-u', '--doctorInstall', npmCmd + ' run myinstall'], {
        rejectOnError: false,
        cwd,
      })

      const pkgUpgraded = await fs.readFile(pkgPath, 'utf-8')

      // stderr should be empty or equal to the test script output (output varies by platform/node version)
      stderr = stripAnsi(stderr).trim()
      if (stderr !== '') {
        stripAnsi(stderr).should.equal(`> test
> echo 'Test Success'



> test
> echo 'Test Success'`)
      }

      // stdout should include normal output
      stripAnsi(stdout).should.containIgnoreCase('Tests pass')

      // package file should include upgrades
      pkgUpgraded.should.containIgnoreCase('"ncu-test-v2": "~2.0.0"')
    })

    it('custom test script with --doctorTest', async function () {
      const cwd = await setupTempFolder('customtest')
      const pkgPath = path.join(cwd, 'package.json')
      const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'

      let { stdout, stderr } = await runNcuCli(['--doctor', '-u', '--doctorTest', `${npmCmd} run mytest`], {
        rejectOnError: false,
        cwd,
      })

      const pkgUpgraded = await fs.readFile(pkgPath, 'utf-8')

      // stderr should be empty or equal to the test script output (output varies by platform/node version)
      stderr = stripAnsi(stderr).trim()
      if (stderr !== '') {
        stderr.should.equal(`> mytest
> echo Success



> mytest
> echo Success`)
      }

      // stdout should include normal output
      stripAnsi(stdout).should.containIgnoreCase('Tests pass')

      // package file should include upgrades
      pkgUpgraded.should.containIgnoreCase('"ncu-test-v2": "~2.0.0"')
    })

    it('custom test script with --doctorTest command that includes spaced words wrapped in quotes', async function () {
      const cwd = await setupTempFolder('customtest2')
      const pkgPath = path.join(cwd, 'package.json')
      const echoPath = path.join(cwd, 'echo.js')

      const { stdout, stderr } = await runNcuCli(['--doctor', '-u', '--doctorTest', `node ${echoPath} '123 456'`], {
        rejectOnError: false,
        cwd,
      })

      const pkgUpgraded = await fs.readFile(pkgPath, 'utf-8')

      // stderr should be empty
      stderr.should.equal('')

      // stdout should include expected output
      stripAnsi(stdout).should.contain("'123 456'")

      // package file should include upgrades
      pkgUpgraded.should.containIgnoreCase('"ncu-test-v2": "~2.0.0"')
    })

    it('handle failed prepare script', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'npm-check-updates-'))
      setTrackedTempFolder(tempDir)
      const pkgPath = path.join(tempDir, 'package.json')

      // package.json
      await fs.writeFile(
        pkgPath,
        JSON.stringify({
          type: 'module',
          scripts: {
            prepare: 'node prepare.js',
            test: 'echo "No tests"',
          },
          dependencies: {
            'ncu-test-v2': '1.0.0',
            'ncu-test-tag': '1.0.0',
          },
        }),
        'utf-8',
      )

      // prepare.js
      // A script that fails if ncu-test-v2 is not at 1.0.0.
      // This is an arbitrary fail condition used to test that doctor mode still works when the npm prepare script fails.
      await fs.writeFile(
        path.join(tempDir, 'prepare.js'),
        `import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ncuTestPkg = require('./node_modules/ncu-test-v2/package.json');
if (ncuTestPkg.version === '1.0.0') {
  console.log('done')
  process.exitCode = 0;
}
else {
  console.error('failed')
  process.exitCode = 1;
}`,
        'utf-8',
      )

      // explicitly set packageManager to avoid auto yarn detection
      await spawnPlease('npm', ['install'], {}, { cwd: tempDir })
      const result = await runNcuCli(['--doctor', '-u', '-p', 'npm'], { rejectOnError: false, cwd: tempDir })
      const pkgUpgraded = JSON.parse(await fs.readFile(pkgPath, 'utf-8'))

      const stdout = result.stdout
      const stderr = result.stderr
      const testTag = createNcuRegExp('ncu-test-tag 1.0.0 →')
      const testV2 = createNcuRegExp('ncu-test-v2 1.0.0 →')

      // stdout should include successful upgrades
      stdout.should.match(testTag)
      stdout.should.not.match(testV2)

      // stderr should include failed prepare script
      stderr.should.containIgnoreCase('failed')
      stderr.should.match(testV2)
      stderr.should.not.match(testTag)

      // package file should only include successful upgrades
      pkgUpgraded.dependencies.should.deep.equal({
        'ncu-test-v2': '1.0.0',
        'ncu-test-tag': '1.1.0',
      })
    })
  })

  describe.skip('yarn', () => {
    testPass({ packageManager: 'yarn' })
    testFail({ packageManager: 'yarn' })
  })
})
