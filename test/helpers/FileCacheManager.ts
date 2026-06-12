import fs from 'node:fs'
import path from 'node:path'
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
  private currentSuiteFailed = false
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
    beforeAll(({}, suite: any) => {
      manager.currentSuiteFailed = false

      // Vitest provides the suite context as the 2nd argument here
      const rawFilePath = suite?.filepath ?? 'unknown'

      if (rawFilePath === 'unknown') {
        console.warn('⚠️ [Cache] Unable to resolve test file path from beforeAll context.')
      }

      const relativePath = path.relative(process.cwd(), rawFilePath)
      manager.safeDirName = relativePath.replace(/[\\/.]/g, '_').replace(/_test_ts$/, '')

      for (const stub of stubs) {
        // console.log({ stub })
        manager.initializeStubCache(stub.name)
        //  console.log('call setupMock')
        try {
          stub.setupMock(manager)
        } catch (error) {
          //  console.log('setupMock Error', error)
        }
      }
    })

    // This stays clean and lightweight
    afterEach(context => {
      if (context.task.result?.state === 'fail') {
        manager.currentSuiteFailed = true
      }
    })

    afterAll(() => {
      manager.flushAndAuditAll(!manager.currentSuiteFailed)
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

    // console.log({ fixturePath })

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
  public async getOrSet(stubName: string, inputKey: string, fallbackExecution: () => any): Promise<any> {
    // console.log({ stubName, inputKey })

    const cache = this.mockCaches.get(stubName)
    if (!cache) return fallbackExecution()

    // Evaluates perfectly because getOrSet is executed inside your mock at test-runtime
    const testName = getTestName()
    const invocationPath = `${testName}::${inputKey}`

    cache.invokedPaths.add(invocationPath)
    const testSpace = cache.data[testName] || {}

    if (process.env.REGENERATE_TEST_CACHE === 'true') {
      const freshResult = await fallbackExecution()
      //  console.log({ freshResult })

      testSpace[inputKey] = freshResult
      cache.data[testName] = testSpace
      return freshResult
    }

    if (inputKey in testSpace) {
      return testSpace[inputKey]
    }

    const freshResult = await fallbackExecution()
    testSpace[inputKey] = freshResult
    cache.data[testName] = testSpace
    return freshResult
  }

  /**
   * Final validation and disk sync loop
   */
  private flushAndAuditAll(allTestsPassed: boolean) {
    const isCI = !!process.env.CI
    const shouldSave = (!!process.env.REGENERATE_TEST_CACHE || !!process.env.NCU_SAVE_FIXTURES) && allTestsPassed
    const shouldPurge = process.env.UPDATE_TEST_CACHE === 'true'

    //  console.log('flushAndAuditAll', this.mockCaches.entries())

    for (const [stubName, cache] of this.mockCaches.entries()) {
      const unusedEntries: { testName: string; inputKey: string }[] = []

      for (const testName of Object.keys(cache.data)) {
        for (const inputKey of Object.keys(cache.data[testName])) {
          if (!cache.invokedPaths.has(`${testName}::${inputKey}`)) {
            unusedEntries.push({ testName, inputKey })
          }
        }
      }

      if (shouldPurge && !isCI && unusedEntries.length > 0) {
        for (const { testName, inputKey } of unusedEntries) {
          delete cache.data[testName][inputKey]
          if (Object.keys(cache.data[testName]).length === 0) {
            delete cache.data[testName]
          }
        }
        console.log(`\n🧹 [Cache] Purged ${unusedEntries.length} stale entries from ${stubName}.json`)
      } else if (unusedEntries.length > 0 && !isCI) {
        console.warn(`\n⚠️  [Cache Warning] ${stubName}.json has ${unusedEntries.length} unused fixture entries.`)
      }

      if (shouldSave && !isCI) {
        const sortedCache = Object.keys(cache.data)
          .sort()
          .reduce(
            (acc, testKey) => {
              const testSpace = cache.data[testKey]
              acc[testKey] = Object.keys(testSpace)
                .sort()
                .reduce(
                  (subAcc, inputKey) => {
                    subAcc[inputKey] = testSpace[inputKey]
                    return subAcc
                  },
                  {} as Record<string, any>,
                )
              return acc
            },
            {} as Record<string, any>,
          )

        const newContent = JSON.stringify(sortedCache, null, 2) + '\n'
        if (newContent !== cache.initialContent && Object.keys(sortedCache).length > 0) {
          fs.mkdirSync(path.dirname(cache.fixturePath), { recursive: true })
          fs.writeFileSync(cache.fixturePath, newContent)
        }
      }
    }
  }

  public static bootstrap() {
    this.registerLifecycle([stubSpawnCommand])
  }
}
