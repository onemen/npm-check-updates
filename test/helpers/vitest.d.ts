import { type SpyInstance, type TestContext } from 'vitest'

declare global {
  type StubWithSave<T = TestContext> = SpyInstance<T> & {
    // Overload: the original method takes no arguments
    mockRestore(): void
    // Overload: our custom method takes the context
    mockRestore(context: TestContext): void
  }
}

export {}
