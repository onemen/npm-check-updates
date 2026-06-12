import { createHash } from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { type MockInstance, type TestContext } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../../')
const normalizedRoot = projectRoot.replace(/\\/g, '/')

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

    const shouldSave = !!process.env.NCU_SAVE_FIXTURES && context?.task?.result?.state === 'pass'
    const keys = Object.keys(fixtures)
    if (shouldSave && (keys.length > 0 || initialFixtures === '')) {
      // Sort keys alphabetically
      const sortedKeys = keys.sort()
      const sortedFixtures = sortedKeys.reduce(
        (acc, key) => {
          acc[key] = fixtures[key]
          return acc
        },
        {} as Record<string, any>,
      )

      // If the content is different, update the file
      const newContent = JSON.stringify(sortedFixtures, null, 2) + '\n'
      if (newContent !== initialFixtures) {
        fs.mkdirSync(path.dirname(fixturePath), { recursive: true })
        fs.writeFileSync(fixturePath, newContent)
      }
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

  let relativePath = path.relative(projectRoot, testPath)
  if (relativePath.startsWith('test' + path.sep)) {
    relativePath = relativePath.substring(('test' + path.sep).length)
  }

  const folderName = relativePath
    .replace(/\.test\.(ts|js)$/, '')
    .replace(/[/\\]/g, '_')
    .replace(/_index$/, '')
  const safeFileName = safeTruncate(fileName.replace(/\s+/g, '_').replace(/\.json$/, ''), 50) + '.json'

  return path.join(projectRoot, 'test/fixtures', folderName, `${stubName}_${safeFileName}`)
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

/** replacing dynamic system data with static placeholders */
export function sanitize(output: string): string {
  if (!output) return output
  return (
    output
      // Remove npm log paths (e.g., ...\_logs\2026-05-31...-debug-0.log)
      .replace(/C:\\.*\\_logs\\[^ ]+\.log/g, '<NPM_LOG_PATH>')
      // Remove Node process IDs (e.g., (node:8260))
      .replace(/\(node:\d+\)/g, '(node:<PID>)')
      // Remove dynamic timestamps often found in log paths or messages
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}_\d{2}_\d{2}_\d{3}Z/g, '<TIMESTAMP>')
      // Remove every single box‑drawing character
      .replace(/[\u2500-\u257F]/g, '')
  )
}

/** Tokenizes absolute developer paths to safe forward-slashed placeholders */
export function serializeTokens(value: string): string {
  /** make safe value for regex  */
  const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  if (!value) return value
  const normalized = value.replace(/\\+(?!["'])/g, '/')
  const rootA = escapeRegex(normalizedRoot)
  const rootB = escapeRegex(sandbox.cwd)
  const rootRegex = new RegExp(`${rootA}|${rootB}`, 'g')
  return normalized.replace(rootRegex, '<ROOT>')
}

/**
 * Applies both sanitization and tokenization:
 * Replaces dynamic system data (log paths, PIDs, timestamps)
 * Normalizes and tokenizes absolute developer paths to %root%
 */
export function sanitizeAndSerialize(value: string): string {
  if (!value) return value
  const sanitized = sanitize(value)
  return serializeTokens(sanitized)
}
