import fs from 'node:fs'
import path from 'node:path'
import { type RunnerTask, type RunnerTestFile } from 'vitest'
import { sortObjectDeep } from './mockUtils'
import { stubSpawnCommand } from './stubs/stubSpawnCommand'
import { getTestName } from './testNameStore'

export interface StubRegistration {
  name: string
  setupMock: (cache: FileCacheManager) => void
}

/**
 *
 */
export class FileCacheManager {
  private safeDirName: string = 'unknown'
  private mockCaches = new Map<
    string,
    {
      fixturePath: string
      initialContent: string
      data: Record<string, Record<string, any>>
      invokedPaths: Set<string>
    }
  >()

  public static registerLifecycle(stubs: StubRegistration[]) {
    const manager = new FileCacheManager()

    // eslint-disable-next-line no-empty-pattern
    beforeAll(({}, input) => {
      // Vitest provides the file context as the 2nd argument here
      const file = input as RunnerTestFile
      const rawFilePath = file.filepath ?? 'unknown'

      if (rawFilePath === 'unknown') {
        console.warn('⚠️ [Cache] Unable to resolve test file path from beforeAll context.')
      }

      const relativePath = path.relative(process.cwd(), rawFilePath)
      manager.safeDirName = relativePath
        .replace(/[\\/.]/g, '_')
        .replace(/^test_/, '')
        .replace(/_test_ts$/, '')
        .replace(/_index$/, '')

      for (const stub of stubs) {
        manager.initializeStubCache(stub.name)
        stub.setupMock(manager)
      }
    })

    // eslint-disable-next-line no-empty-pattern
    afterAll(async ({}, input) => {
      const file = input as RunnerTestFile
      await manager.flushAndAuditAll(file)
      vi.restoreAllMocks()
    })
  }

  /**
   * Resolves paths using the instance's file-scoped safeDirName property
   */
  private initializeStubCache(stubName: string) {
    const fixturePath = path.join('test', 'test-data', 'fixtures_cache', this.safeDirName, `${stubName}.json`)
    let initialContent = ''
    let data: Record<string, Record<string, any>> = {}

    if (fs.existsSync(fixturePath)) {
      initialContent = fs.readFileSync(fixturePath, 'utf8')
      data = JSON.parse(initialContent)
    }

    this.mockCaches.set(stubName, {
      fixturePath,
      initialContent,
      data,
      invokedPaths: new Set(),
    })
  }

  /**
   * Retrieves or sets keys using getTestName() smoothly at runtime
   */
  public async getOrSet(
    stubName: string,
    { key, safeArgs: args }: { key: string; safeArgs: string },
    fallbackExecution: () => any,
  ): Promise<any> {
    const cache = this.mockCaches.get(stubName)

    if (!cache) {
      console.warn(
        `⚠️ [Cache] getOrSet called for unregistered stub: "${stubName}". Running fallback execution without caching.`,
      )
      return fallbackExecution()
    }

    // Evaluates perfectly because getOrSet is executed inside your mock at test-runtime
    const testName = getTestName()
    const invocationPath = `${testName}::${key}`
    cache.invokedPaths.add(invocationPath)

    if (!cache.data[testName]) {
      cache.data[testName] = {}
    }
    const testSpace = cache.data[testName]

    const isRegenerate = process.env.REGENERATE_TEST_CACHE === 'true'
    if (!isRegenerate && key in testSpace) {
      return testSpace[key].result
    }

    const result = await fallbackExecution()
    testSpace[key] = { args, result }
    return result
  }

  /** Final validation and disk sync loop */
  private async flushAndAuditAll(file: RunnerTestFile) {
    if (process.env.CI) return

    const validTests = this.getValidTestNames(file.tasks)

    for (const cache of this.mockCaches.values()) {
      // Prune orphaned test entries and unused keys.
      // If a test name is no longer found in the file, we remove its entire space.
      // If a test ran successfully, we remove any keys that weren't actually invoked.
      // Tests that didn't run (skipped/filtered) are left intact to prevent data loss.
      for (const testName of Object.keys(cache.data)) {
        const testInfo = validTests.get(testName)
        if (!testInfo) {
          delete cache.data[testName]
        } else if (testInfo.ran) {
          const testSpace = cache.data[testName]
          for (const inputKey of Object.keys(testSpace)) {
            if (!cache.invokedPaths.has(`${testName}::${inputKey}`)) {
              delete testSpace[inputKey]
            }
          }
          if (Object.keys(testSpace).length === 0) {
            delete cache.data[testName]
          }
        }
      }

      if (Object.keys(cache.data).length === 0) {
        try {
          await fs.promises.unlink(cache.fixturePath)
        } catch (err) {}
        continue
      }

      const sortedCache = sortObjectDeep(cache.data)

      // Ensure trailing newline
      const newContent = JSON.stringify(sortedCache, null, 2) + '\n'
      if (newContent !== cache.initialContent) {
        await fs.promises.mkdir(path.dirname(cache.fixturePath), { recursive: true })
        await fs.promises.writeFile(cache.fixturePath, newContent)
      }
    }
  }

  /** get all tests name in the file that did not failed in this run */
  private getValidTestNames(tasks: RunnerTask[]): Map<string, { ran: boolean }> {
    const validTests = new Map<string, { ran: boolean }>()
    /** Traverses the Vitest task tree to collect all active test names */
    const traverse = (ts: RunnerTask[]) => {
      for (const task of ts) {
        if (task.type === 'test') {
          // Only consider the test name valid if it didn't fail.
          if (task.result?.state !== 'fail') {
            const ran = task.result?.state === 'pass'
            validTests.set(task.name, { ran })
          }
        } else if (task.tasks) {
          traverse(task.tasks)
        }
      }
    }
    traverse(tasks)
    return validTests
  }

  public static bootstrap() {
    this.registerLifecycle([stubSpawnCommand])
  }
}
