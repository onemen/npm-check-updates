import cp from 'node:child_process'
import fs from 'node:fs'
import fsAsync from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMainThread } from 'node:worker_threads'
import { getTestName } from './testNameStore'

/** A test sandbox for creating isolated test environments. */
export class TestSandbox {
  private static readonly SANDBOX_FILE_DIR = path.dirname(fileURLToPath(import.meta.url))
  private static readonly SANDBOX_SPAWN_ERROR = Symbol('SANDBOX_SPAWN_ERROR')
  private static _cwdMap = new Map<string, string>()
  private _cwd: string = ''
  private originalEnv: NodeJS.ProcessEnv
  private originalCwd: string
  private yarnCachePath: string | null = null
  private readonly rootPrefix: string

  private constructor(prefix: string) {
    this.rootPrefix = prefix.endsWith('-') ? prefix : `${prefix}-`
    this.originalEnv = { ...process.env }
    this.originalCwd = process.cwd()
  }

  /**
   * Sets up a sandbox and hooks into the Vitest lifecycle to manage
   * isolated working directories.
   */
  private static setup(prefix = 'ncu-test-sandbox-'): TestSandbox {
    const sandbox = new TestSandbox(prefix)

    const cachePrefix = sandbox.rootPrefix
    sandbox.yarnCachePath = path
      .join(os.tmpdir(), `ncu-yarn-cache-${cachePrefix}${Math.random().toString(36).substring(2, 8)}`)
      .replace(/\\/g, '/')

    // Configure environment
    Object.assign(process.env, {
      npm_config_prefer_offline: 'true',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_update_notifier: 'false',
      npm_config_loglevel: 'error',
      YARN_CACHE_FOLDER: sandbox.yarnCachePath,
    })

    return sandbox
  }

  initCwd() {
    const testName = getTestName()

    if (!testName) {
      throw new Error(
        'TestSandbox.cwd accessed outside of a named test context. ' +
          'Ensure to run registerTestNameCapture before TestSandbox.registerLifecycle in vitest.setup.ts.',
      )
    }

    if (TestSandbox._cwdMap.has(testName)) {
      return TestSandbox._cwdMap.get(testName)!
    }

    this._cwd = fs.mkdtempSync(path.join(os.tmpdir(), this.rootPrefix)).replace(/\\/g, '/')
    if (isMainThread) {
      process.chdir(this._cwd)
    }

    TestSandbox._cwdMap.set(testName, this._cwd)

    return this._cwd
  }

  static registerLifecycle() {
    let sandbox: TestSandbox
    let isActive = false
    const originalCwd = process.cwd()

    beforeAll(() => {
      const originalSpawn = cp.spawn
      vi.spyOn(cp, 'spawn').mockImplementation((cmd, args, options = {}) => {
        // sandbox not initialized yet
        if (!sandbox || sandbox.cwd === '') {
          throw new Error('spawn() called before sandbox.initCwd()')
        }

        // missing cwd means sandbox escape
        if (!options.cwd) {
          throw Object.assign(
            new Error(
              [
                `Sandbox violation: child_process.spawn() was called without a "cwd".`,
                ``,
                `This means the tested function triggered a child process without receiving`,
                `sandbox.cwd in its options. As a result, the process ran in the REAL project`,
                `directory instead of the test sandbox.`,
                ``,
                `How to fix:`,
                `  Pass sandbox.cwd to the tested function, for example:`,
                `    getInstalledPackages({ cwd: sandbox.cwd })`,
                `    spawnNpm({ cwd: sandbox.cwd })`,
                `    spawnCommand(cmd, args, { cwd: sandbox.cwd })`,
                ``,
                `If the spawned process expects a package.json (e.g. npm, yarn, pnpm),`,
                `create one inside the sandbox before calling the function:`,
                `    sandbox.createPackageJson({ name: "test", version: "1.0.0" })`,
                ``,
                `Command executed:`,
                `  ${cmd} ${args?.join(' ')}`,
                ``,
                `If this originates from a 3rd‑party library (e.g. spawn-please), ensure your`,
                `wrapper injects { cwd: sandbox.cwd } automatically.`,
              ].join('\n'),
            ),
            { code: TestSandbox.SANDBOX_SPAWN_ERROR },
          )
        }

        return originalSpawn(cmd, args, options)
      })

      sandbox = this.setup()
      globalThis.sandbox = sandbox

      // Mock process.cwd to return sandbox.cwd
      vi.spyOn(process, 'cwd').mockImplementation(() => {
        return isActive ? sandbox.cwd : originalCwd
      })
    })

    beforeEach(async () => {
      isActive = true
      sandbox.initCwd()
    })

    afterEach(async () => {
      const testName = getTestName()
      if (testName && TestSandbox._cwdMap.has(testName)) {
        const cwd = TestSandbox._cwdMap.get(testName)!

        if (isMainThread) {
          try {
            process.chdir(sandbox.originalCwd ?? process.cwd())
          } catch {}
        }

        try {
          await fsAsync.rm(cwd, { recursive: true, force: true })
        } catch {}

        TestSandbox._cwdMap.delete(testName)
      }
    })

    afterAll(async () => {
      if (sandbox) {
        await sandbox.cleanup()
      }
    })
  }

  get SANDBOX_SPAWN_ERROR() {
    return TestSandbox.SANDBOX_SPAWN_ERROR
  }

  get cwd(): string {
    return this._cwd
  }

  /**
   * Copies a fixture folder into the sandbox CWD.
   * @param fixturePath - The path to the fixture folder (e.g., 'doctor/notestscript').
   * @param fixtureRoot - The root directory containing your fixtures.
   * Must be relative to the TestSandbox.ts file location.
   * Defaults to '../test-data'.
   */
  async createTestFolder(fixturePath: string, fixtureRoot: string = '../test-data'): Promise<string> {
    const cwd = this.cwd
    const sourceFixturePath = path.resolve(TestSandbox.SANDBOX_FILE_DIR, fixtureRoot, fixturePath)

    if (fs.existsSync(sourceFixturePath)) {
      await fsAsync.cp(sourceFixturePath, cwd, {
        recursive: true,
        dereference: true,
      })
    } else {
      throw new Error(`Fixture directory not found at: ${sourceFixturePath}`)
    }

    return cwd
  }

  async createPackageJson(content: Partial<Record<string, any>> = {}, testFolderPath?: string): Promise<string> {
    const defaultPackageJson = {
      name: 'test-package',
      version: '1.0.0',
      dependencies: {},
      ...content,
    }

    const targetFolder = testFolderPath ?? this.cwd
    const packageJsonPath = path.join(targetFolder, 'package.json')

    await fsAsync.writeFile(packageJsonPath, JSON.stringify(defaultPackageJson, null, 2), 'utf-8')
    return packageJsonPath
  }

  async cleanup(): Promise<void> {
    vi.restoreAllMocks()
    process.env = this.originalEnv

    if (isMainThread) {
      try {
        process.chdir(this.originalCwd ?? '../')
      } catch (err) {
        console.warn('[Cleanup] Could not revert process.cwd():', err)
      }
    }

    if (this.yarnCachePath) {
      try {
        await fsAsync.rm(this.yarnCachePath, { recursive: true, force: true })
      } catch (err) {}
      this.yarnCachePath = null
    }
  }

  // call this function from vitest teardown to remove any leftover npm-check-updates folders
  static async finalCleanup(): Promise<void> {
    const files = await fsAsync.readdir(os.tmpdir())
    for (const file of files) {
      if (file.startsWith('npm-check-updates-') || file.startsWith('ncu-test-sandbox-')) {
        await fsAsync.rm(path.join(os.tmpdir(), file), { recursive: true, force: true })
      }
    }
  }
}
