import fs from 'fs/promises'
import { stripVTControlCharacters as stripAnsi } from 'node:util'
import os from 'os'
import path from 'path'
import { type MockInstance } from 'vitest'
import { cliOptionsMap } from '../src/cli-options'
import { chalkInit } from '../src/lib/chalk'
import { pm } from '../src/lib/doctor.js'
import { stripRange } from '../src/lib/version-util.js'
import { createNcuRegExp, sandbox, testFail, testPass } from './helpers/doctorHelpers'
import { runNcuCli } from './helpers/runNcuCli'
import stubVersions from './helpers/stubVersions'

const mockNpmVersions = {
  emitter20: '2.0.0',
  'ncu-test-return-version': '2.0.0',
  'ncu-test-tag': '1.1.0',
  'ncu-test-v2': '2.0.0',
}

const TARGET_PACKAGE = 'ncu-test-return-version'

type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun'

const packageManagerLockfiles: Record<PackageManager, string> = {
  npm: 'package-lock.json',
  yarn: 'yarn.lock',
  pnpm: 'pnpm-lock.yaml',
  bun: 'bun.lock',
}

/** get package.json content for a test */
async function getPackageJson(targetCwd: string) {
  try {
    const packageJsonRaw = await fs.readFile(path.join(targetCwd, 'package.json'), 'utf8')
    return JSON.parse(packageJsonRaw)
  } catch {
    return null
  }
}

describe('doctor', function () {
  let stub: { restore: () => void }
  let pmRun: MockInstance<typeof pm.run>

  beforeAll(async () => {
    stub = stubVersions(mockNpmVersions, { spawn: true })

    const installedVersionsMap = new Map<string, string>()
    const originalRun = pm.run

    pmRun = vi.spyOn(pm, 'run').mockImplementation(async (args, options, print, extraOptions) => {
      const targetCwd = options.cwd
      if (!targetCwd) {
        throw new Error(`Mock execution failed: 'options.cwd' is required for command '${args.join(' ')}'`)
      }

      const pkgJson = await getPackageJson(targetCwd)
      const command = args[0]

      // Install/Add does nothing but pretend to succeed
      if (command === 'install' || command === 'add') {
        let detectedVersion = ''

        // Override with explicit CLI argument if present (e.g., package@2.0.0)
        args.forEach(arg => {
          if (!arg.startsWith('-') && arg.includes('@')) {
            const lastAtIndex = arg.lastIndexOf('@')
            if (lastAtIndex > 0 && arg.slice(0, lastAtIndex) === TARGET_PACKAGE) {
              detectedVersion = stripRange(arg.slice(lastAtIndex + 1))
            }
          }
        })

        if (!detectedVersion) {
          if (pkgJson) {
            const allDeps = {
              ...pkgJson.dependencies,
              ...pkgJson.devDependencies,
              ...pkgJson.optionalDependencies,
              ...pkgJson.peerDependencies,
            }
            if (allDeps[TARGET_PACKAGE]) {
              detectedVersion = stripRange(allDeps[TARGET_PACKAGE])
            }
          }
        }

        // Only save to our memory state if we actually tracked a version change for our target
        if (detectedVersion) {
          installedVersionsMap.set(targetCwd, detectedVersion)
        }

        // Create the empty lockfile
        const lockFileName = packageManagerLockfiles[(options.packageManager || 'npm') as PackageManager]
        const lockfilePath = path.join(targetCwd, lockFileName)
        await fs.writeFile(lockfilePath, '', 'utf8')

        const pmType = options.packageManager || 'npm'
        if (!args.includes('--no-save') && (pmType === 'npm' || pmType === 'pnpm') && pkgJson?.scripts?.prepare) {
          return pm.run(['run', 'prepare'], options, print, extraOptions)
        }

        return 'mocked success output'
      }

      // Intercept the test and prepare execution scripts called by doctor
      if (command === 'run' && ['test', 'prepare'].includes(args[1])) {
        if (args[1] === 'test' && pkgJson?.scripts?.test !== 'node test.js') {
          return 'Skipping unhandled test runner script\n'
        }

        const version = installedVersionsMap.get(targetCwd) || '1.0.0'

        // pass on < 2
        // No need to print to the terminal when the test is successful.
        // break on v2.x
        if (version.startsWith('2')) {
          throw new Error('Breaks with v2.x :(')
        }

        return `mocked success output from ${args[1]} script`
      }

      return originalRun(args, options, print, extraOptions)
    })
  })

  afterAll(async () => {
    stub.restore()
    pmRun.mockRestore()
    await sandbox.cleanup()
  })

  describe('npm', () => {
    it('print instructions when -u is not specified', async () => {
      await chalkInit()
      const cwd = await sandbox.createTestFolder('nopackagefile')
      const { stdout } = await runNcuCli(['--doctor'], { cwd })
      return stripAnsi(stdout).should.equal(
        `Usage: ncu --doctor\n\n${stripAnsi(
          (cliOptionsMap.doctor.help as (options: { markdown: boolean }) => string)({ markdown: false }),
        )}\n`,
      )
    })

    it('throw an error if there is no package file', async () => {
      const cwd = await sandbox.createTestFolder('nopackagefile')
      return runNcuCli(['--doctor', '-u'], { cwd }).should.eventually.be.rejectedWith('Missing or invalid package.json')
    })

    it('throw an error if there is no test script', async () => {
      const cwd = await sandbox.createTestFolder('notestscript')
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
      const cwd = await sandbox.createTestFolder('options')
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
      const cwd = await sandbox.createTestFolder('custominstall')
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
      const cwd = await sandbox.createTestFolder('customtest')
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
      const cwd = await sandbox.createTestFolder('customtest2')
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
            'ncu-test-return-version': '1.0.0',
            'ncu-test-tag': '1.0.0',
          },
        }),
        'utf-8',
      )

      // prepare.js
      await fs.writeFile(
        path.join(tempDir, 'prepare.js'),
        `// run by mocked 'npm run prepare' to simulate a failed install during doctor tests`,
        'utf-8',
      )

      // explicitly set packageManager to avoid auto yarn detection
      await pm.run(['install'], { cwd: tempDir, packageManager: 'npm' })
      const { stdout, stderr } = await runNcuCli(['--doctor', '-u', '-p', 'npm'], {
        rejectOnError: false,
        cwd: tempDir,
      })

      const pkgUpgraded = JSON.parse(await fs.readFile(pkgPath, 'utf-8'))

      const testTag = createNcuRegExp('ncu-test-tag 1.0.0 →')
      const testV2 = createNcuRegExp('ncu-test-return-version 1.0.0 →')

      // stdout should include successful upgrades
      stdout.should.match(testTag)
      stdout.should.not.match(testV2)

      // stderr should include failed prepare script
      stderr.should.containIgnoreCase('Breaks with v2.x :(')
      stderr.should.match(testV2)
      stderr.should.not.match(testTag)

      // package file should only include successful upgrades
      pkgUpgraded.dependencies.should.deep.equal({
        'ncu-test-return-version': '1.0.0',
        'ncu-test-tag': '1.1.0',
      })
    })
  })

  describe('yarn', () => {
    testPass({ packageManager: 'yarn' })
    testFail({ packageManager: 'yarn' })
  })
})
