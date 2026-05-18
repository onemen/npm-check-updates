# Quick Reference: Using runNcuCli in Tests

## Overview
The `runNcuCli` helper function allows tests to invoke the npm-check-updates CLI in-process without mutating the global `process.cwd()`. It uses the `--cwd` CLI argument to specify the working directory.

## Basic Usage

### Simple CLI Test
```typescript
const { stdout, stderr } = await runNcuCli(['--jsonAll', '--workspace', 'a'])
```

### CLI Test with Working Directory
```typescript
const { stdout, stderr } = await runNcuCli(['--jsonAll', '--workspace', 'a'], {
  cwd: '/absolute/path/to/working/dir'
})
```

### CLI Test with stdin
```typescript
const { stdout, stderr } = await runNcuCli(['--jsonUpgraded', '--stdin'], {
  stdin: '{ "dependencies": { "lodash": "1.0.0" } }'
})
```

## Important Rules

### ✅ DO
```typescript
// Option 1: Use cwd option (which gets converted to --cwd)
await runNcuCli(['--jsonAll'], { cwd: '/path/to/dir' })

// Option 2: Use explicit --cwd in args
await runNcuCli(['--jsonAll', '--cwd', '/path/to/dir'])

// Option 3: No cwd needed
await runNcuCli(['--jsonAll'])
```

### ❌ DON'T
```typescript
// ERROR: Conflicting cwd values!
// This will throw "Conflicting cwd values" error
await runNcuCli(['--jsonAll', '--cwd', '/path/to/dir'], {
  cwd: '/another/path'
})
```

## How the _internalInjectedCwd Flag Works

The `_internalInjectedCwd` flag distinguishes between:

| Scenario | Flag Value | Path Output | Example |
|----------|-----------|------------|---------|
| No cwd provided | `false` | **Relative paths** | `"package.json"` |
| `cwd` option used with `runNcuCli()` | `true` | **Absolute paths** | `"/absolute/path/package.json"` |
| Explicit `--cwd` arg | `false` | **Absolute paths** | `"/absolute/path/package.json"` |

## Common Patterns

### Testing with workspaces
```typescript
const tempDir = await setup() // Creates temp workspace
try {
  const { stdout } = await runNcuCli(
    ['--jsonAll', '--workspace', 'a', '--cwd', tempDir]
  )
  // Test assertions
} finally {
  await removeDir(tempDir)
}
```

### Testing with stdin (no file system needed)
```typescript
const { stdout } = await runNcuCli(
  ['--jsonUpgraded', '--stdin', '--filter', 'express'],
  {
    stdin: '{ "dependencies": { "express": "1", "chalk": "0.1.0" } }'
  }
)
```

### Testing CLI arguments without changing directories
```typescript
// Old way (bad):
process.chdir('/some/dir')
await runCommand()
process.chdir(originalDir) // Unsafe if runCommand throws!

// New way (good):
await runNcuCli(['--jsonAll'], { cwd: '/some/dir' })
// Process cwd is never changed, safe even if throws
```

## Debugging Tests

If a test fails with `"Conflicting cwd values"` error:
1. Check if the test is using both `cwd` option AND `--cwd` in args
2. Remove one of them (preferably use the `cwd` option approach as it's clearer)

If a test is getting unexpected path formats:
1. Check if `_internalInjectedCwd` is being set correctly
2. Remember: relative paths only when NO cwd is provided
3. If you provided cwd via option or args, paths will be absolute

## Migration Checklist

When converting a test from `process.chdir()` to `runNcuCli()`:

- [ ] Remove `process.chdir(testDir)` calls
- [ ] Remove corresponding `process.chdir(originalDir)` calls
- [ ] Add `{ cwd: testDir }` option to `runNcuCli()` call
- [ ] Update path expectations if needed (may need to use `--cwd` with absolute paths)
- [ ] Run tests to verify paths are as expected
- [ ] Remove any try/finally blocks that were just for restoring cwd
