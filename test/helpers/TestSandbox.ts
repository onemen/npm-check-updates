import fs from 'node:fs'
import fsAsync from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** A test sandbox for creating isolated test environments. */
export class TestSandbox {
  private static readonly SANDBOX_FILE_DIR = path.dirname(fileURLToPath(import.meta.url))
  private rootPath: string | null = null
  private cachePath: string | null = null
  private cwdPath: string | null = null
  private originalEnv: NodeJS.ProcessEnv

  private constructor(private readonly rootPrefix: string) {
    this.originalEnv = { ...process.env }
  }

  get isInitialized(): boolean {
    return this.rootPath !== null
  }

  static create(rootPrefix = 'test-suite-'): TestSandbox {
    const normalizedPrefix = rootPrefix.endsWith('-') || rootPrefix.endsWith(path.sep) ? rootPrefix : `${rootPrefix}-`

    const sandbox = new TestSandbox(normalizedPrefix)

    // Initialize paths
    sandbox.rootPath = fs.mkdtempSync(path.join(os.tmpdir(), sandbox.rootPrefix))
    sandbox.cachePath = path.join(sandbox.rootPath, '.cache')
    fs.mkdirSync(sandbox.cachePath, { recursive: true })
    sandbox.cwdPath = path.join(sandbox.rootPath, '.cwd')
    fs.mkdirSync(sandbox.cwdPath, { recursive: true })

    // Environment configuration
    const testEnv: NodeJS.ProcessEnv = {
      npm_config_prefer_offline: 'true',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_update_notifier: 'false',
      npm_config_loglevel: 'error',
      yarn_config_prefer_offline: 'true',
      YARN_CACHE_FOLDER: sandbox.cachePath,
      TMPDIR: sandbox.cachePath,
      TEMP: sandbox.cachePath,
      TMP: sandbox.cachePath,
    }
    Object.assign(process.env, testEnv)

    return sandbox
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
    if (!this.rootPath) {
      throw new Error('Sandbox not initialized.')
    }

    const defaultPackageJson = {
      name: 'test-package',
      version: '1.0.0',
      dependencies: {},
      ...content,
    }

    const targetFolder = testFolderPath ?? this.rootPath
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

  getCachePath(): string {
    if (!this.cachePath) throw new Error('Sandbox not initialized.')
    return this.cachePath
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
    console.log('cleanup 1')

    process.env = this.originalEnv
    vi.restoreAllMocks()
    console.log('cleanup 2 this.rootPath', this.rootPath)

    if (this.rootPath) {
      console.log('cleanup 3')
      this.cleanCwd()
      console.log('cleanup 4')
      await fsAsync.rm(this.rootPath, { recursive: true, force: true }).catch(e => console.log(e))
      console.log('cleanup 5')
      this.rootPath = null
      this.cachePath = null
      this.cwdPath = null
      console.log('cleanup 6')
    }
  }
}
