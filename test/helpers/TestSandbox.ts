import { AsyncLocalStorage } from 'node:async_hooks'
import fs from 'node:fs'
import fsAsync from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMainThread } from 'node:worker_threads'
import { getTestName } from './testNameStore'

interface TestContext {
  cwd?: string
}

/** A test sandbox for creating isolated test environments. */
export class TestSandbox {
  private static readonly contextStore = new AsyncLocalStorage<TestContext>()
  private static readonly SANDBOX_FILE_DIR = path.dirname(fileURLToPath(import.meta.url))
  private originalEnv: NodeJS.ProcessEnv
  private originalCwd: string
  private sharedCwd: string | null = null
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

  static registerLifecycle() {
    let sandbox: TestSandbox

    beforeAll(() => {
      sandbox = this.setup()
      globalThis.sandbox = sandbox

      // Mock process.cwd to return sandbox.cwd
      vi.spyOn(process, 'cwd').mockImplementation(() => {
        return sandbox.cwd
      })
    })

    beforeEach(() => {
      this.contextStore.enterWith({})
    })

    afterEach(async () => {
      const store = this.contextStore.getStore()
      if (store?.cwd) {
        if (isMainThread) {
          try {
            process.chdir(sandbox.originalCwd ?? '../')
          } catch (err) {}
        }
        try {
          await fsAsync.rm(store.cwd, { recursive: true, force: true })
        } catch (err) {
          console.warn('[afterEach Cleanup] Could not delete test CWD:', err)
        }
      }
    })

    afterAll(async () => {
      if (sandbox) {
        await sandbox.cleanup()
      }
    })
  }

  get cwd(): string {
    const store = TestSandbox.contextStore.getStore()
    if (!store) {
      if (!this.sharedCwd) {
        const testName = getTestName() || 'unknown-test'
        const safeName = testName.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 50)
        this.sharedCwd = fs
          .mkdtempSync(path.join(os.tmpdir(), `${this.rootPrefix}shared-${safeName}-`))
          .replace(/\\/g, '/')
        if (isMainThread) {
          process.chdir(this.sharedCwd)
        }
      }
      return this.sharedCwd
    }

    if (!store.cwd) {
      store.cwd = fs.mkdtempSync(path.join(os.tmpdir(), this.rootPrefix)).replace(/\\/g, '/')
      if (isMainThread) {
        process.chdir(store.cwd)
      }
    }

    return store.cwd
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

    if (this.sharedCwd) {
      await new Promise(resolve => setTimeout(resolve, 0))
      try {
        await fsAsync.rm(this.sharedCwd, { recursive: true, force: true })
        this.sharedCwd = null
      } catch (err) {}
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
    const files = await fs.promises.readdir(os.tmpdir())
    for (const file of files) {
      if (file.startsWith('npm-check-updates-') || file.startsWith('ncu-test-sandbox-')) {
        await fs.promises.rm(path.join(os.tmpdir(), file), { recursive: true, force: true })
      }
    }
  }
}
