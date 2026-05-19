import fs from 'node:fs'
import fsAsync from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { type PackageManagerName } from '../../src/types/PackageManagerName'

/** A test sandbox for creating isolated test environments. */
export class TestSandbox {
  private rootPath: string | null = null
  private cachePath: string | null = null
  private subfolderCounter = 0
  private originalEnv: NodeJS.ProcessEnv

  private constructor(
    private readonly rootPrefix: string,
    private readonly fixtureRoot?: string,
  ) {
    this.originalEnv = { ...process.env }
  }

  static async create(rootPrefix = 'test-suite-', relativeFixtureRoot?: string): Promise<TestSandbox> {
    let resolvedFixtureRoot: string | undefined

    // Only resolve the path if a relative path was actually provided
    if (relativeFixtureRoot) {
      const currentDir = path.dirname(fileURLToPath(import.meta.url))
      resolvedFixtureRoot = path.resolve(currentDir, relativeFixtureRoot)
    }

    const normalizedPrefix = rootPrefix.endsWith('-') || rootPrefix.endsWith(path.sep) ? rootPrefix : `${rootPrefix}-`

    const sandbox = new TestSandbox(normalizedPrefix, resolvedFixtureRoot)

    // Initialize paths
    sandbox.rootPath = await fsAsync.mkdtemp(path.join(os.tmpdir(), sandbox.rootPrefix))
    sandbox.cachePath = path.join(sandbox.rootPath, '.cache')
    await fsAsync.mkdir(sandbox.cachePath, { recursive: true })

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

  async createTestFolder(fixtureName: string, packageManager: PackageManagerName = 'npm'): Promise<string> {
    if (!this.rootPath) {
      throw new Error('Sandbox not initialized.')
    }

    this.subfolderCounter++

    const folderName = `${packageManager}-${fixtureName}-${this.subfolderCounter}`
    const testFolderPath = path.join(this.rootPath, folderName)

    // Always create the empty target directory
    await fsAsync.mkdir(testFolderPath, { recursive: true })

    // copy if fixtureRoot exists
    if (this.fixtureRoot) {
      const sourceFixturePath = path.join(this.fixtureRoot, fixtureName)

      if (fs.existsSync(sourceFixturePath)) {
        await fsAsync.cp(sourceFixturePath, testFolderPath, {
          recursive: true,
          dereference: true,
        })
      } else {
        throw new Error(`Fixture directory not found at: ${sourceFixturePath}`)
      }
    }

    return testFolderPath
  }

  getRootPath(): string {
    if (!this.rootPath) throw new Error('Sandbox not initialized.')
    return this.rootPath
  }

  getCachePath(): string {
    if (!this.cachePath) throw new Error('Sandbox not initialized.')
    return this.cachePath
  }

  async cleanup(): Promise<void> {
    process.env = this.originalEnv

    if (this.rootPath) {
      await fsAsync.rm(this.rootPath, { recursive: true, force: true })
      this.rootPath = null
      this.cachePath = null
    }
  }
}
