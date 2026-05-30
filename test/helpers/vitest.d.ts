import { type MockInstance, type TestContext } from 'vitest'

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface MockInstance<T = any> {
    mockRestore(): void
    // mockRestore(context?: TestContext): Promise<void>
    mockRestore(context?: TestContext): void
    invalidate(): Promise<void>
  }
}

declare global {
  type MockImplementation<T> = Parameters<MockInstance<T>>[0]
}

export {}
