import fs from 'fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripVTControlCharacters as stripAnsi } from 'node:util'
import os from 'os'
import path from 'path'
import { type PackageManagerName } from '../../src/types/PackageManagerName'
import { runNcuCli } from './runNcuCli.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const bin = path.join(__dirname, '../../build/cli.js')
const doctorTests = path.join(__dirname, '../test-data/doctor')

// Track the active sandbox path for the currently running test block
let currentTempDir: string | null = null

// TODO: replace ncu with the real function
/** Run the ncu CLI. */
const ncu = async (args: string[], spawnPleaseOptions?: any, spawnOptions?: any) => {
  return runNcuCli('node', [bin, ...args], spawnPleaseOptions, spawnOptions)
}

/** Helper to recursively copy directory contents to a temporary folder */
async function copyDir(src: string, dest: string) {
  await fs.mkdir(dest, { recursive: true })
  const entries = await fs.readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath)
    } else {
      await fs.copyFile(srcPath, destPath)
    }
  }
}

/**
 * Generates a fresh temporary workspace for a fixture folder.
 * Sets the active tracking path for cleanup.
 */
export async function setupTempFolder(fixtureName: string): Promise<string> {
  const originalCwd = path.join(doctorTests, fixtureName)
  currentTempDir = await fs.mkdtemp(path.join(os.tmpdir(), `ncu-doctor-${fixtureName}-`))
  await copyDir(originalCwd, currentTempDir)
  return currentTempDir
}

/** Clears the active sandbox directory tracked by setupTempFolder */
export async function cleanupTempFolder() {
  if (currentTempDir) {
    await fs.rm(currentTempDir, { recursive: true, force: true }).catch(() => {})
    currentTempDir = null
  }
}

/** Used to manually hook custom programmatic tests into the shared sandbox tracking */
export function setTrackedTempFolder(dirPath: string) {
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
  it('upgrade dependencies when tests pass', async function () {
    const cwd = await setupTempFolder('pass')
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
    let { stdout, stderr } = await ncu(['--doctor', '-u', '-p', packageManager], { rejectOnError: false }, { cwd })

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
    const cwd = await setupTempFolder('fail')
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
    const { stdout, stderr } = await ncu(['--doctor', '-u', '-p', packageManager], { rejectOnError: false }, { cwd })

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
