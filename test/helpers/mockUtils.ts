import fs from 'fs'
import path from 'path'
import { type MockInstance, type TestContext } from 'vitest'

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

/** convert test title to valid file name */
export function getFixtureName(context: TestContext): string {
  const title = context.task.name

  return title
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/_+/g, '_')
}
