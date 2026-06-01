import fs from 'node:fs/promises'
import path from 'node:path'
import { stripVTControlCharacters as stripAnsi } from 'node:util'
import { pm } from '../../src/lib/doctor'
import { stripRange } from '../../src/lib/version-util'
import { type PackageManagerName } from '../../src/types/PackageManagerName'
// import { TestSandbox } from './TestSandbox'
import { runNcuCli } from './runNcuCli'

// export const sandbox = await TestSandbox.create('ncu-doctor-tests', '../test-data/doctor')

// ;(globalThis as any).sandbox = TestSandbox.create('ncu-doctor-tests')

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

/**
 * Mocks the internal package manager execution (`pm.run`) during Doctor Mode tests.
 *
 * Instead of spawning heavy native child processes for every dependency installation
 * and script lifecycle trigger, this interceptor manages package versioning and
 * lifecycle states entirely in memory.
 *
 * @remarks
 * By avoiding repetitive native `npm install` and `npm test` process spawns on disk
 * (which are exceptionally slow on Windows), this mock cuts down the suite execution
 * time by roughly 40 seconds.
 *
 * @returns A Vitest SpyInstance wrapper around the `pm.run` implementation.
 */
export function mockPackageManagerRun() {
  const installedVersionsMap = new Map<string, string>()
  const originalRun = pm.run
  return vi.spyOn(pm, 'run').mockImplementation(async (args, options, print, extraOptions) => {
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
}

/**
 * Windows terminal environments (like Git-Bash) often render different column padding
 * than Linux, resulting in multiple spaces between the name and version.
 * We use Regex with \s+ to ensure the test passes regardless of whitespace count.
 *
 * Converts a string into a RegExp that handles version arrows and spacing.
 * Escapes dots for literal matching and replaces spaces with \s+.
 */
export function createNcuRegExp(input: string): RegExp {
  // 1. Escape special regex characters (like dots in 1.0.0)
  // 2. Replace spaces with \s+ for flexible matching
  const pattern = input
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Standard escape for regex
    .replace(/ /g, '\\s+') // Replace literal space with \s+

  return new RegExp(pattern, 'i')
}

/** Assertions for npm or yarn when tests pass. */
export const testPass = ({ packageManager }: { packageManager: PackageManagerName }) => {
  it('upgrade dependencies when tests pass', async function () {
    const cwd = await sandbox.createTestFolder('doctor/pass')
    const pkgPath = path.join(cwd, 'package.json')
    const lockfilePath = path.join(
      cwd,
      packageManager === 'yarn'
        ? 'yarn.lock'
        : packageManager === 'pnpm'
          ? 'pnpm-lock.yaml'
          : packageManager === 'bun'
            ? 'bun.lockb'
            : 'package-lock.json',
    )

    // touch yarn.lock
    // yarn.lock is necessary otherwise yarn sees the package.json in the npm-check-updates directory and throws an error.
    if (packageManager === 'yarn' || packageManager === 'bun') {
      await fs.writeFile(lockfilePath, '')
    }

    // explicitly set packageManager to avoid auto yarn detection
    const { stdout } = await runNcuCli(['--doctor', '-u', '-p', packageManager], { rejectOnError: false, cwd })

    const pkgUpgraded = await fs.readFile(pkgPath, 'utf-8')

    // stdout should include normal output
    stripAnsi(stdout).should.containIgnoreCase('Tests pass')
    stripAnsi(stdout).should.containIgnoreCase('ncu-test-v2  ~1.0.0  →  ~2.0.0')

    // package file should include upgrades
    pkgUpgraded.should.containIgnoreCase('"ncu-test-v2": "~2.0.0"')
  })
}

/** Assertions for npm or yarn when tests fail. */
export const testFail = ({ packageManager }: { packageManager: PackageManagerName }) => {
  it('identify broken upgrade', async function () {
    const cwd = await sandbox.createTestFolder('doctor/fail')
    const pkgPath = path.join(cwd, 'package.json')
    const lockfilePath = path.join(
      cwd,
      packageManager === 'yarn'
        ? 'yarn.lock'
        : packageManager === 'pnpm'
          ? 'pnpm-lock.yaml'
          : packageManager === 'bun'
            ? 'bun.lockb'
            : 'package-lock.json',
    )

    // touch yarn.lock (see fail/README)
    if (packageManager === 'yarn') {
      await fs.writeFile(lockfilePath, '')
    }

    // explicitly set packageManager to avoid auto yarn detection
    const { stdout, stderr } = await runNcuCli(['--doctor', '-u', '-p', packageManager], { rejectOnError: false, cwd })

    const pkgUpgraded = await fs.readFile(pkgPath, 'utf-8')

    const testVersion = createNcuRegExp('ncu-test-return-version ~1.0.0 →')
    const testV2 = createNcuRegExp('ncu-test-v2 ~1.0.0 →')
    const emitter = createNcuRegExp('emitter20 1.0.0 →')

    // stdout should include successful upgrades
    stdout.should.match(testV2)
    stdout.should.not.match(testVersion)
    stdout.should.match(emitter)

    // stderr should include first failing upgrade
    stderr.should.containIgnoreCase('Breaks with v2.x')
    stderr.should.not.match(testV2)
    stderr.should.match(testVersion)
    stderr.should.not.match(emitter)

    // package file should only include successful upgrades
    pkgUpgraded.should.containIgnoreCase('"ncu-test-v2": "~2.0.0"')
    pkgUpgraded.should.containIgnoreCase('"ncu-test-return-version": "~1.0.0"')
    pkgUpgraded.should.not.include('"emitter20": "1.0.0"')
  })
}
