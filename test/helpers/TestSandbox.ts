import fs from 'node:fs'
import fsAsync from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMainThread } from 'node:worker_threads'

/** A test sandbox for creating isolated test environments. */
export class TestSandbox {
  private static readonly SANDBOX_FILE_DIR = path.dirname(fileURLToPath(import.meta.url))
  private rootPath: string | null = null
  private cwdPath: string | null = null
  private originalEnv: NodeJS.ProcessEnv

  private constructor(private readonly rootPrefix: string) {
    this.originalEnv = { ...process.env }
  }

  /**
   * Sets up a sandbox and hooks into the Vitest lifecycle to manage
   * isolated working directories.
   */
  private static setup(prefix = 'ncu-test-sandbox-'): TestSandbox {
    const sandbox = new TestSandbox(prefix)

    // Initialize paths
    const rootPrefix = sandbox.rootPrefix.endsWith('-') ? sandbox.rootPrefix : `${sandbox.rootPrefix}-`
    sandbox.rootPath = fs.mkdtempSync(path.join(os.tmpdir(), rootPrefix)).replace(/\\/g, '/')
    sandbox.cwdPath = path.join(sandbox.rootPath, '.cwd').replace(/\\/g, '/')
    fs.mkdirSync(sandbox.cwdPath, { recursive: true })

    // Configure environment
    Object.assign(process.env, {
      npm_config_prefer_offline: 'true',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_update_notifier: 'false',
      npm_config_loglevel: 'error',
      YARN_CACHE_FOLDER: sandbox.rootPath,
    })

    return sandbox
  }

  static registerLifecycle() {
    beforeAll(() => {
      const sandbox = this.setup()
      globalThis.sandbox = sandbox

      // Setup working directory isolation
      if (isMainThread) {
        process.chdir(sandbox.cwdPath!)
      } else {
        vi.spyOn(process, 'cwd').mockImplementation(() => sandbox.cwdPath!)
      }
    })

    afterAll(async () => {
      const sandbox = globalThis.sandbox
      if (sandbox) {
        await sandbox.cleanup()
      }
    })
  }

  /**
   * Copies a fixture folder into the sandbox CWD.
   * @param fixturePath - The path to the fixture folder (e.g., 'doctor/notestscript').
   * @param fixtureRoot - The root directory containing your fixtures.
   * Must be relative to the TestSandbox.ts file location.
   * Defaults to '../test-data'.
   */
  async createTestFolder(fixturePath: string, fixtureRoot: string = '../test-data'): Promise<string> {
    if (!this.cwdPath) {
      throw new Error('Sandbox not initialized.')
    }

    const sourceFixturePath = path.resolve(TestSandbox.SANDBOX_FILE_DIR, fixtureRoot, fixturePath)

    if (fs.existsSync(sourceFixturePath)) {
      await fsAsync.cp(sourceFixturePath, this.cwdPath, {
        recursive: true,
        dereference: true,
      })
    } else {
      throw new Error(`Fixture directory not found at: ${sourceFixturePath}`)
    }

    return this.cwdPath
  }

  async createPackageJson(content: Partial<Record<string, any>> = {}, testFolderPath?: string): Promise<void> {
    if (!this.cwdPath) {
      throw new Error('Sandbox not initialized.')
    }

    const defaultPackageJson = {
      name: 'test-package',
      version: '1.0.0',
      dependencies: {},
      ...content,
    }

    const targetFolder = testFolderPath ?? this.cwdPath
    const packageJsonPath = path.join(targetFolder, 'package.json')

    await fsAsync.writeFile(packageJsonPath, JSON.stringify(defaultPackageJson, null, 2), 'utf-8')
  }

  getCwdPath(): string {
    if (!this.cwdPath) throw new Error('Sandbox not initialized.')
    return this.cwdPath
  }

  getRootPath(): string {
    if (!this.rootPath) throw new Error('Sandbox not initialized.')
    return this.rootPath
  }

  async cleanCwd(): Promise<void> {
    if (!this.cwdPath) throw new Error('Sandbox not initialized.')
    const cwd = this.cwdPath
    const files = await fsAsync.readdir(cwd)

    for (const file of files) {
      const fullPath = path.join(cwd, file)
      await fsAsync.rm(fullPath, { recursive: true, force: true })
    }
  }

  async cleanup(): Promise<void> {
    vi.restoreAllMocks()
    process.env = this.originalEnv

    if (isMainThread) {
      try {
        // Move to the original project root or a neutral parent directory
        process.chdir(this.originalEnv.PWD || '../../')
      } catch (err) {
        console.warn('[Cleanup] Could not revert process.cwd():', err)
      }
    }

    if (this.rootPath) {
      // Give the OS a moment to release handles on the old directory
      await new Promise(resolve => setTimeout(resolve, 50))
      try {
        await fsAsync.rm(this.rootPath, { recursive: true, force: true })
        this.rootPath = null
        this.cwdPath = null
      } catch (err) {
        // wee will clear it in finalCleanup
      }
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
