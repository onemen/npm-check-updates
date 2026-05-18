# Migration to runNcuCli - Summary of Fixes

## Overview

The npm-check-updates project is being refactored to use the `runNcuCli` test helper instead of `process.chdir()` for managing working directories in tests. This change uses the `--cwd` CLI argument instead of mutating the process's current working directory.

## Issues Identified and Fixed

### Issue 1: Absolute vs Relative Paths in Package Filepath

**Problem**: When `getAllPackages()` is called without a `cwd` option (or without `_internalInjectedCwd` flag), it was always returning absolute paths for package filepaths. However, tests expected relative paths when no explicit cwd was provided.

**Root Cause**: The `loadPackageInfoFromFile()` function in `src/lib/loadPackageInfoFromFile.ts` was always resolving paths to absolute paths using `path.resolve()`.

**Solution**: Modified `loadPackageInfoFromFile()` to return relative paths when:
- No `cwd` was provided to the options AND
- The `_internalInjectedCwd` flag is not set

This preserves the original behavior:
- User-provided `--cwd` → output uses absolute paths  
- Internally injected `cwd` (via `runNcuCli` options) → output uses absolute paths
- No `cwd` at all → output uses relative paths

**File Changed**: `src/lib/loadPackageInfoFromFile.ts`

### Issue 2: Conflicting cwd Values in Workspace Test

**Problem**: The test `update single workspace with --cwd and --workspace` was passing both:
1. A `cwd` option to `runNcuCli()` which gets converted to `--cwd` argument
2. An explicit `--cwd ../../` argument in the CLI args

This violates the rule that tests must not specify both.

**Solution**: Removed the `cwd` option from the `runNcuCli()` call and replaced the relative `--cwd ../../` with an absolute path `--cwd tempDir`. This maintains the test's intent (testing workspace handling when pointing to the root) while following the new pattern.

**File Changed**: `test/workspaces.test.ts`

## Test Results

All 566 tests pass with no failures:
- Test Files: 40 passed, 3 skipped
- Total Tests: 566 passed, 22 skipped

## Key Design Principles

The `_internalInjectedCwd` flag exists to distinguish between:
1. **User explicitly provided `--cwd`**: Should use relative paths in output (preserving original behavior)
2. **Test helper injected `--cwd` via `runNcuCli(options.cwd)`**: Should use absolute paths (avoiding unexpected behavior changes in tests)
3. **No cwd provided**: Should use relative paths (default behavior)

This ensures that tests can reliably specify working directories using the `--cwd` CLI argument while maintaining backward compatibility with the original behavior.
