import { createHash } from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { type MockInstance, type TestContext } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '../../')

interface PersistentMockOptions {
  fixturePath: string
  label: string
  fixtures: Record<string, any>
  initialFixtures: string
}

/**
 * Wraps a Vitest MockInstance's mockRestore method to automatically
 * persist fixture changes to disk when a test completes successfully.
 * * @param spy - The mock or spy instance to wrap.
 * @param options - Configuration for file path, tracking state, and logging.
 * @returns The original spy instance with the overridden mockRestore method.
 */
export function applyPersistentMockRestore(
  spy: MockInstance<any>,
  { fixturePath, label, fixtures, initialFixtures }: PersistentMockOptions,
): MockInstance<any> {
  const originalRestore = spy.mockRestore.bind(spy)

  spy.mockRestore = (context?: TestContext) => {
    if (!context) {
      console.warn(`[${label}] Warning: mockRestore() called without 'context'. Fixture data will NOT be saved.`)
    }

    const shouldSave =
      !!process.env.NCU_SAVE_FIXTURES &&
      JSON.stringify(fixtures) !== initialFixtures &&
      context?.task?.result?.state === 'pass'

    if (shouldSave) {
      fs.mkdirSync(path.dirname(fixturePath), { recursive: true })
      fs.writeFileSync(fixturePath, JSON.stringify(fixtures, null, 2))
    }

    return originalRestore()
  }

  return spy
}

/** Truncate file names longer then 50 */
function safeTruncate(input: string, maxLength: number = 50): string {
  const sanitized = input.toLowerCase().replace(/[^a-z0-9]+/g, '_')
  if (sanitized.length <= maxLength) return sanitized

  const hash = createHash('md5').update(input).digest('hex').slice(0, 6)
  const prefix = sanitized.slice(0, maxLength - hash.length - 1)
  return `${prefix}_${hash}`
}

/** Get path to fixtures file from test files name and stubName */
export function getFixturePath(stubName: string, fileName: string): string {
  if (!stubName || !fileName) {
    throw new Error('getFixturePath must be called with stubName and fileName')
  }

  /** Get the absolute path from the test runner's internal state */
  const testPath = expect.getState().testPath

  if (!testPath) {
    throw new Error('getFixturePath must be called from within a test')
  }

  let relativePath = path.relative(PROJECT_ROOT, testPath)
  if (relativePath.startsWith('test' + path.sep)) {
    relativePath = relativePath.substring(('test' + path.sep).length)
  }

  const folderName = relativePath
    .replace(/\.test\.(ts|js)$/, '')
    .replace(/\/index$/, '')
    .replace(/[/\\]/g, '_')
  const safeFileName = safeTruncate(fileName.replace(/\s+/g, '_').replace(/\.json$/, ''), 50) + '.json'

  return path.join(PROJECT_ROOT, 'test/fixtures', folderName, `${stubName}_${safeFileName}`)
}

/** convert test title to valid file name */
export function getFixtureName(context: TestContext): string {
  const title = context.task.name

  return title
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/_+/g, '_')
}
