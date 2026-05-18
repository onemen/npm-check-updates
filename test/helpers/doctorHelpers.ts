import fs from 'fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripVTControlCharacters as stripAnsi } from 'node:util'
import os from 'os'
import path from 'path'
import spawnPlease from 'spawn-please'
import { type PackageManagerName } from '../../src/types/PackageManagerName'
import { runNcuCli } from './runNcuCli'

const __dirname = dirname(fileURLToPath(import.meta.url))
const doctorTests = path.join(__dirname, '../test-data/doctor')
const FIXTURE_CACHE_DIR = path.join(os.tmpdir(), 'ncu-doctor-cache')
const YARN_CACHE_DIR = path.join(FIXTURE_CACHE_DIR, 'yarn-cache')

// Track the active sandbox path for the currently running test block
let currentTempDir: string | null = null
const trackedTempDirs = new Set<string>()
const resolvedFixturePaths = new Map<string, string>()

/** Ensures that a fixture is built and cached with its node_modules */
async function ensureFixtureCached(fixtureName: string, packageManager: PackageManagerName = 'npm'): Promise<string> {
  const cacheKey = `${fixtureName}-${packageManager}`
  const cachePath = path.join(FIXTURE_CACHE_DIR, cacheKey)
  const fixtureSource = path.join(doctorTests, fixtureName)

  if (!resolvedFixturePaths.has(cacheKey)) {
    const pkgPath = path.join(fixtureSource, 'package.json')
    const hasPkg = await fs
      .access(pkgPath)
      .then(() => true)
      .catch(() => false)

    if (!hasPkg) {
      resolvedFixturePaths.set(cacheKey, fixtureSource)
      return fixtureSource
    }

    const cacheExists = await fs
      .access(cachePath)
      .then(() => true)
      .catch(() => false)
    if (!cacheExists) {
      await fs.mkdir(FIXTURE_CACHE_DIR, { recursive: true })
      await fs.cp(fixtureSource, cachePath, { recursive: true, force: true })

      const installCmd =
        packageManager === 'yarn'
          ? 'yarn'
          : packageManager === 'pnpm'
            ? 'pnpm'
            : packageManager === 'bun'
              ? 'bun'
              : 'npm'

      const installArgs =
        packageManager === 'yarn'
          ? ['--prefer-offline', '--no-progress', '--non-interactive', '--silent', '--cache-folder', YARN_CACHE_DIR]
          : ['install', '--no-audit', '--no-fund', '--prefer-offline', '--loglevel', 'error', '--no-package-lock']

      // Initial install to populate node_modules in cache
      await spawnPlease(
        installCmd,
        installArgs,
        {},
        {
          cwd: cachePath,
          timeout: 60000,
          env: {
            ...process.env,
            // Redirect Yarn's internal temp folders to our tracked cache dir
            TMPDIR: FIXTURE_CACHE_DIR,
            TEMP: FIXTURE_CACHE_DIR,
            TMP: FIXTURE_CACHE_DIR,
            YARN_CACHE_FOLDER: YARN_CACHE_DIR,
          },
        },
      )
    }
    resolvedFixturePaths.set(cacheKey, cachePath)
  }
  return resolvedFixturePaths.get(cacheKey)!
}

/**
 * Generates a fresh temporary workspace for a fixture folder.
 * Sets the active tracking path for cleanup.
 */
export async function setupTempFolder(
  fixtureName: string,
  packageManager: PackageManagerName = 'npm',
): Promise<string> {
  const cachePath = await ensureFixtureCached(fixtureName, packageManager)
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `ncu-doctor-${fixtureName}-${packageManager}-`))
  trackedTempDirs.add(tempDir)
  currentTempDir = tempDir
  await fs.cp(cachePath, currentTempDir, { recursive: true, force: true })
  return currentTempDir
}

/** Clears the active sandbox directory tracked by setupTempFolder */
export async function cleanupTempFolder() {
  const dirs = Array.from(trackedTempDirs)
  trackedTempDirs.clear()
  currentTempDir = null
  await Promise.all(dirs.map(dir => fs.rm(dir, { recursive: true, force: true }).catch(() => {})))
}

/** Clears the fixture cache directory */
export async function cleanupFixtureCache() {
  resolvedFixturePaths.clear()
  await fs.rm(FIXTURE_CACHE_DIR, { recursive: true, force: true }).catch(() => {})
}

/** Used to manually hook custom programmatic tests into the shared sandbox tracking */
export function setTrackedTempFolder(dirPath: string) {
  trackedTempDirs.add(dirPath)
  currentTempDir = dirPath
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
  it.only('upgrade dependencies when tests pass', async function () {
    const cwd = await setupTempFolder('pass', packageManager)
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
    let { stdout, stderr } = await runNcuCli(['--doctor', '-u', '-p', packageManager], { rejectOnError: false, cwd })

    const pkgUpgraded = await fs.readFile(pkgPath, 'utf-8')

    // bun prints the run header to stderr instead of stdout
    if (packageManager === 'bun') {
      stripAnsi(stderr).should.equal('$ echo Success\n\n$ echo Success\n\n')
    } else {
      stderr = stripAnsi(stderr).trim()
      if (stderr !== '') {
        stderr.should.equal(`> test
> echo Success



> test
> echo Success`)
      }
    }

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
    const cwd = await setupTempFolder('fail', packageManager)
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
