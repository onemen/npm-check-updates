import { defineConfig, mergeConfig } from 'vitest/config'

const baseConfig = {
  globals: true, // This enables describe, it, expect globally
  environment: 'node',

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
  testTimeout: 60000,
  hookTimeout: 60000,
  teardownTimeout: 30000,

  // Setup files
  setupFiles: ['./test/helpers/vitest.setup.ts'],

  // Reporter configuration
  reporters: [['default', { summary: false }]],
  pool: 'threads',
}

export default defineConfig({
  test: {
    projects: [
      {
        test: mergeConfig(baseConfig, {
          name: 'Unit tests',
          isolate: false,
          include: ['test/**/*.test.ts'],
          exclude: ['node_modules', 'build', 'test/test-data', 'test/workspaces.test.ts'],
        }),
      },
      {
        // Workspaces tests creates many temporary files and directories,
        // running them in separate project shorten test runtime
        test: mergeConfig(baseConfig, {
          name: 'Unit tests - Workspaces',
          isolate: false,
          include: ['test/workspaces.test.ts'],
        }),
      },
    ],
  },
})
