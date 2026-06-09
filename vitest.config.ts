import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['node_modules', 'build', 'test/test-data'],

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['node_modules/', 'build/', 'test/', 'src/types/*.*', '**/*.d.ts'],
      // Coverage thresholds not enforced yet - establish baseline first
      // lines: 80,
      // functions: 80,
      // branches: 75,
      // statements: 80,
      excludeAfterRemap: true,
    },

    // Performance & setup
    isolate: false,
    pool: 'threads',
    maxWorkers: '50%',
    testTimeout: 60000,
    hookTimeout: 60000,
    teardownTimeout: 30000,

    // Setup files
    setupFiles: ['./test/helpers/vitest.setup.ts'],
    globalSetup: ['./test/helpers/global-setup.ts'],

    // Reporter configuration
    disableConsoleIntercept: true,
    reporters: [['default', { summary: false }]],
  },
})
