# Migration Plan: Mocha → Vitest + Coverage

## Overview

This document outlines the plan to migrate the test runner from **Mocha** to **Vitest** and add comprehensive code coverage reporting for unit tests.

### Key Benefits

- **Faster test execution** - Vitest is significantly faster than Mocha for TypeScript projects
- **Built-in coverage** - No need for separate nyc/coverage setup
- **Better TypeScript support** - Seamless TS support without additional transpilers
- **Improved DX** - Watch mode, UI mode, better error messages
- **Modern tooling** - Vitest is actively maintained and aligned with Vite ecosystem

---

## Phase 1: Install & Configure Vitest

### 1.1 Install Dependencies

```bash
npm install --save-dev vitest @vitest/coverage-v8
```

**Why @vitest/coverage-v8?**

- Industry-standard coverage provider (same as NYC uses)
- Reliable and well-maintained
- Excellent TypeScript support

**Alternative:** `@vitest/coverage-c8` (if V8 has issues on Windows)

### 1.2 Create Vitest Configuration

Create `test/helpers/vitest.config.ts` (keeping test-related configs in helpers):

```typescript
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
      reporter: ['text', 'json', 'html', 'lcov', 'text-summary'],
      include: ['src/**/*.ts'],
      exclude: ['node_modules/', 'build/', 'test/', '**/*.d.ts'],
      // Coverage thresholds not enforced yet - establish baseline first
      // lines: 80,
      // functions: 80,
      // branches: 75,
      // statements: 80,
    },

    // Performance & setup
    testTimeout: 60000, // Match Mocha timeout
    hookTimeout: 60000,
    teardownTimeout: 30000,

    // Globals setup (replaces Mocha's global describe, it, etc.)
    globals: true,

    // Reporter configuration
    reporters: ['default'],
  },
})
```

---

## Phase 2: Test File Migration

### 2.1 File Structure (No Changes Needed)

- Keep all test files in `test/` directory
- Maintain `.test.ts` extension (already matches Vitest convention)
- No reorganization required

### 2.2 API Migration Reference

| Mocha           | Vitest            | Notes                     |
| --------------- | ----------------- | ------------------------- |
| `describe()`    | `describe()`      | ✅ No change              |
| `it()`          | `it()` / `test()` | ✅ No change              |
| `before()`      | `beforeAll()`     | Minor change              |
| `after()`       | `afterAll()`      | Minor change              |
| `beforeEach()`  | `beforeEach()`    | ✅ No change              |
| `afterEach()`   | `afterEach()`     | Minor change              |
| `it.skip()`     | `it.skip()`       | ✅ No change              |
| `it.only()`     | `it.only()`       | ✅ No change              |
| Chai assertions | Chai assertions   | ✅ No change (chai stays) |

**Key Difference:**

- Mocha uses `before`/`after`
- Vitest uses `beforeAll`/`afterAll`

### 2.3 Update Global Setup

Rename `test/helpers/chaiSetup.ts` → `test/helpers/globalSetup.ts` (to clarify it's for global setup, not just chai).

Create `test/helpers/vitest.setup.ts`:

```typescript
import { beforeAll } from 'vitest'
import globalSetup from './globalSetup'

beforeAll(() => {
  globalSetup()
})
```

Add to `test/helpers/vitest.config.ts`:

```typescript
export default defineConfig({
  test: {
    setupFiles: ['test/helpers/vitest.setup.ts'],
  },
})
```

**Note on Chai:** Your tests use `chai` with `.should` syntax and `chai-string` extensions. This will continue to work with Vitest - no changes to assertions needed.

### 2.4 Migration Checklist for Test Files

For each test file:

- [ ] Remove `import chaiSetup from './helpers/chaiSetup'` line (global setup now handles this)
- [ ] Remove `chaiSetup()` call from each test file (~40+ files)
- [ ] Replace `before(` → `beforeAll(` (except "beforeEach") - use find-replace in test/ directory
- [ ] Replace `after(` → `afterAll(` (except "afterEach") - use find-replace in test/ directory
- [ ] Check for any Mocha-specific plugins (none found in your codebase)
- [ ] Verify imports from test helpers still work

**Automated approach:**

```bash
# Find and replace before/after hooks
find test -name '*.test.ts' -type f -exec sed -i 's/^  before(/  beforeAll(/g' {} +
find test -name '*.test.ts' -type f -exec sed -i 's/^  after(/  afterAll(/g' {} +

# Remove chaiSetup imports and calls (requires manual review due to variations)
```

---

## Phase 3: Update package.json Scripts

### 3.1 Current Scripts (Mocha-based)

```json
{
  "test": "tsc --noEmit && npm run test:unit && npm run test:e2e",
  "test:bun": "mocha test/bun",
  "test:unit": "mocha test test/package-managers/* --ignore 'test/bun/*'",
  "test:e2e": "./test/e2e.sh"
}
```

### 3.2 New Scripts (Vitest-based)

```json
{
  "test": "tsc --noEmit && npm run test:unit && npm run test:e2e",
  "test:unit": "vitest run --config test/helpers/vitest.config.ts",
  "test:unit:watch": "vitest --config test/helpers/vitest.config.ts",
  "test:coverage": "vitest run --coverage --config test/helpers/vitest.config.ts",
  "test:coverage:html": "vitest run --coverage --config test/helpers/vitest.config.ts && open coverage/index.html",
  "test:bun": "vitest run --config test/helpers/vitest.config.ts test/bun",
  "test:e2e": "./test/e2e.sh"
}
```

### 3.3 Remove Mocha Configuration

Delete the `mocha` section from `package.json`:

```json
{
  "mocha": {
    "check-leaks": true,
    "extension": ["test.ts"],
    "node-option": [
      "import=tsx",
      "enable-source-maps",
      "trace-deprecation",
      "trace-warnings",
      "no-warnings=TimeoutNaNWarning"
    ],
    "timeout": 60000,
    "recursive": true,
    "exit": true
  }
}
```

### 3.4 No CI/CD Changes Required (Yet)

Do NOT add coverage reporting to CI/CD pipelines at this stage. This is an exploratory phase to establish a baseline and verify test coverage works locally.

---

## Phase 4: Update TypeScript Configuration

### 4.1 Update tsconfig.json

Add Vitest types:

```json
{
  "compilerOptions": {
    "types": ["node", "vitest/globals"]
  }
}
```

### 4.2 Install New Dependencies

```bash
npm install --save-dev vitest @vitest/coverage-v8
```

### 4.3 Remove Old Dependencies

See **Phase 10: Dependencies to Remove** below.

---

## Phase 5: Handle Special Cases

### 5.1 Mocha-specific Hooks (if any)

- `this.skip()` → `t.skip()` or use `it.skip()`
- `this.timeout()` → Use test option or `testTimeout` in config
- Custom reporters → Use Vitest's built-in reporters

**Your codebase:** ✅ No special hooks found

### 5.2 TypeScript Configuration

- Current setup: `tsx` loader with Node options
- Vitest approach: Uses TypeScript automatically if `tsconfig.json` exists
- **Action:** Update `vitest.config.ts` to ensure proper TS handling:

```typescript
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Vitest will auto-detect TypeScript
  },
})
```

### 5.3 Environment Variables

Mocha options in package.json:

```json
{
  "mocha": {
    "check-leaks": true,
    "node-option": [
      "import=tsx",
      "enable-source-maps",
      "trace-deprecation",
      "trace-warnings",
      "no-warnings=TimeoutNaNWarning"
    ]
  }
}
```

Vitest equivalent - add to `vitest.config.ts`:

```typescript
export default defineConfig({
  test: {
    testTimeout: 60000,
    globals: true,
    environment: 'node',
    // Vitest handles source maps automatically
    // trace-deprecation/warnings: handled by NODE_OPTIONS if needed
  },
})
```

---

## Phase 6: Coverage Strategy

### 6.1 Two-Track Testing Approach

Your test suite has two distinct coverage scenarios:

**Track 1: Source Code Coverage (src/**/\*.ts)\*\*

- Direct TypeScript source file testing
- Most test files test this directly
- Use Vitest's standard coverage

**Track 2: Built CLI Coverage (build/cli.js)**

- Some tests spawn the built CLI as a child process (e.g., `bin.test.ts`)
- These tests validate the bundled output from Vite
- Coverage from spawned processes requires special handling

### 6.2 Coverage Configuration

In `test/helpers/vitest.config.ts`:

```typescript
coverage: {
  provider: 'v8',
  reporter: ['text', 'json', 'html', 'lcov'],
  include: ['src/**/*.ts'],
  exclude: ['node_modules/', 'build/', 'test/', '**/*.d.ts'],
  // Thresholds disabled for baseline phase
  // Will enable after establishing baseline metrics
}
```

### 6.3 Coverage Baseline Phase

- Generate coverage reports locally without enforcing thresholds
- Review HTML reports to understand coverage gaps
- Identify which source files need more test coverage
- Plan for Track 2 (spawned CLI) coverage analysis separately
- DO NOT add enforcement to CI/CD yet

### 6.4 Coverage Report Formats

- **text** - Terminal output during runs
- **html** - Interactive report: `coverage/index.html`
- **lcov** - Standard format for IDE integration
- **json** - Programmatic access for analysis

### 6.5 Viewing Coverage Reports

```bash
# Generate and open HTML report
npm run test:coverage:html

# Or manually
npm run test:coverage
open coverage/index.html
```

### 6.6 Coverage Enforcement Timeline

- **Phase 1 (current):** No thresholds - baseline only
- **Phase 2 (future):** Review baseline, identify gaps
- **Phase 3 (future):** Set reasonable thresholds (likely 60-70%)
- **Phase 4 (future):** Enable CI/CD checks
- **Phase 5 (future):** Gradually increase targets

---

## Phase 7: Migration Steps (Execution Order)

### Step 1: Setup & Rename

1. Rename `test/helpers/chaiSetup.ts` → `test/helpers/globalSetup.ts`
2. Update `chaiSetup` function export/import
3. Create `test/helpers/vitest.setup.ts`
4. Create `test/helpers/vitest.config.ts`
5. Update `tsconfig.json` with Vitest types
6. Install Vitest: `npm install --save-dev vitest @vitest/coverage-v8`

### Step 2: Update Test Files (~40+ files)

1. Remove `import chaiSetup from './helpers/chaiSetup'` from all test files
2. Remove `chaiSetup()` calls from all test files
3. Find and replace `before(` → `beforeAll(` in test/ directory
4. Find and replace `after(` → `afterAll(` in test/ directory
5. Run type checking: `npm run lint:types` (should pass)

### Step 3: Update package.json

1. Update test scripts (test:unit, test:coverage, etc.)
2. Delete `mocha` configuration section
3. Remove Mocha dependencies (see Phase 10 list)

### Step 4: Verification

1. Run: `npm run test:unit`
2. Verify all tests pass (should be ~100% same tests)
3. Check coverage: `npm run test:coverage`
4. Review HTML report: `npm run test:coverage:html`
5. Document baseline metrics

### Step 5: Documentation

1. Update README.md test instructions
2. Update CONTRIBUTING.md if needed
3. Commit changes to branch

### Step 6: Analysis (Post-Migration)

1. Review coverage gaps in HTML report
2. Identify files with low coverage
3. Plan for improved coverage in future PRs
4. Plan for spawned CLI coverage strategy

---

## Phase 8: Expected Challenges & Solutions (Windows-Specific)

| Challenge                      | Solution                                                                   |
| ------------------------------ | -------------------------------------------------------------------------- |
| Setup files not running        | Check setupFiles path uses forward slashes: `test/helpers/vitest.setup.ts` |
| Cannot find vitest module      | Run `npm install` again, verify package.json updated                       |
| TypeScript errors after rename | Update all imports: `globalSetup` instead of `chaiSetup`                   |
| Windows line ending issues     | Git config: `core.autocrlf=true` before migration                          |
| Tests timeout after migration  | Check `testTimeout: 60000` in vitest.config.ts                             |
| Coverage not generating        | Ensure source maps enabled: check vite.config.ts `sourcemap: true`         |
| Module resolution errors       | Verify `tsconfig.json` has `moduleResolution: "bundler"` or `"node"`       |

---

## Phase 9: Coverage Analysis for Spawned Processes

### Challenge: Spawned CLI Coverage

Some tests (e.g., `test/bin.test.ts`) spawn the built CLI as a child process:

```typescript
const { stdout } = await spawn('node', [bin, '--jsonUpgraded', '--stdin'], ...)
```

These spawned processes don't contribute to Vitest's coverage report because:

- Vitest instruments the main process only
- Child process has its own V8 instance
- Coverage data isn't automatically collected

### Solution Strategy (Future)

1. **Option A:** Enable V8 coverage in spawned process and merge reports
   - Pass `--coverage` flag to Node
   - Collect coverage JSON files
   - Merge with Vitest reports
   - Complex but comprehensive

2. **Option B:** Accept CLI coverage as integration testing
   - Treat spawned CLI tests as E2E validation
   - Focus unit test coverage on src/ files
   - Simpler approach, reasonable trade-off
   - **Recommended for now**

### Current Approach

- Focus coverage on direct source file testing
- Spawned CLI tests count as integration/E2E tests
- Revisit spawned process coverage in Phase 2 (future)

## Phase 10: Dependencies to Remove

After migration, remove these devDependencies (no longer needed):

**Primary removal:**

- `mocha` ^11.7.5 - Replaced by Vitest
- `@types/mocha` ^10.0.10 - TypeScript types for Mocha

**Optional removals (if not used elsewhere):**

- `should` ^13.2.3 - Only used by Mocha tests, Chai is primary

**Commands to execute:**

```bash
npm uninstall mocha @types/mocha should
npm ci  # Update package-lock.json
```

**Remaining test dependencies (KEEP these):**

- `chai` ^6.2.2 - Assertion library (still used)
- `chai-as-promised` ^8.0.2 - Chai plugin for async (still used)
- `chai-string` ^1.6.0 - Chai string assertions (still used)
- `@types/chai` ^5.2.3 - TypeScript types for Chai (still used)
- `@types/chai-as-promised` ^8.0.2 - TypeScript types (still used)
- `@types/chai-string` ^1.4.5 - TypeScript types (still used)
- `sinon` ^21.1.2 - Mocking library (still used)
- `@types/sinon` ^21.0.1 - TypeScript types (still used)

## Phase 11: Rollback Plan

If major issues occur during migration:

1. **Quick rollback (before commit):**

   ```bash
   git checkout -- package.json package-lock.json
   npm ci
   npm run test:unit  # Should use Mocha again
   ```

2. **After commit (revert commit):**

   ```bash
   git revert <commit-hash>
   npm ci
   npm run test:unit
   ```

3. **If spawned process tests fail:**
   - Problem is likely in test files
   - Don't rollback; debug the specific test file
   - Check imports and hook names changed correctly

4. **If all tests fail to run:**
   - Verify `test/helpers/vitest.config.ts` path correct
   - Check `tsconfig.json` has Vitest types
   - Run `npm install --save-dev vitest @vitest/coverage-v8` again

---

## Phase 12: Expected Outcomes

### Before Migration

- **Test runner:** Mocha
- **Coverage:** Not configured
- **Test speed:** ~45-60 seconds (estimated)
- **Test files:** ~40+ test files with inline `chaiSetup()` calls
- **Assertion library:** Chai + Chai plugins

### After Migration

- **Test runner:** Vitest (modern, Vite-aligned)
- **Coverage:** Full v8-based reporting with HTML/LCOV exports
- **Test speed:** ~25-40 seconds (typically 30-40% faster)
- **Test files:** Same ~40+ files, cleaned of Mocha-isms
- **Assertion library:** Chai + Chai plugins (unchanged)
- **Global setup:** Centralized in `test/helpers/vitest.setup.ts`
- **Configuration:** In `test/helpers/vitest.config.ts`

---

## Phase 13: Documentation Updates

### Files to Update

1. **README.md** - Update test running instructions
2. **CONTRIBUTING.md** - Update development setup section
3. **CI/CD workflows** - NO changes yet (not adding coverage enforcement)
4. **.gitignore** - Ensure `coverage/` is ignored (likely already is)

### Example README.md Update

````markdown
## Testing

### Run tests

npm test # Run all tests (lint + unit + e2e)
npm run test:unit # Run unit tests only  
npm run test:unit:watch # Run in watch mode (for development)

### Test Coverage

```bash
npm run test:coverage       # Generate coverage report
npm run test:coverage:html  # Generate and open HTML report in browser
```
````

Coverage reports are available in the `coverage/` directory. Open `coverage/index.html` to view detailed coverage metrics.

````

### Example CONTRIBUTING.md Update
```markdown
### Running Tests

This project uses [Vitest](https://vitest.dev/) for testing.

- `npm test` - Run all linting and tests
- `npm run test:unit` - Run unit tests only
- `npm run test:unit:watch` - Run tests in watch mode

#### Test Coverage

Generate coverage reports:

```bash
npm run test:coverage       # Terminal output
npm run test:coverage:html  # Interactive HTML report
````

````

---

## Phase 14: Timeline Estimate

| Phase | Effort | Time |
|-------|--------|------|
| 1. Setup & Rename | Small | 20 min |
| 2. Install Dependencies | Small | 5 min |
| 3. Test File Updates (~40 files) | Medium | 45 min |
| 4. package.json & Scripts | Small | 10 min |
| 5. TypeScript Config | Small | 10 min |
| 6. First Test Run | Small | 10 min |
| 7. Verify Coverage | Small | 15 min |
| 8. Remove Old Dependencies | Small | 5 min |
| 9. Documentation Updates | Small | 15 min |
| 10. Commit & PR Review | Medium | 30 min |
| **TOTAL** | | **2.5-3 hours** |

---

## Phase 15: Success Criteria

✅ All tests pass in Vitest (same count as Mocha)
✅ Coverage reports generate without errors (HTML, LCOV, JSON, text)
✅ No coverage thresholds enforced (baseline phase)
✅ Test execution time reduces by at least 20%
✅ Watch mode works smoothly: `npm run test:unit:watch`
✅ `chaiSetup()` calls removed from all test files
✅ `test/helpers/vitest.config.ts` and `test/helpers/vitest.setup.ts` created
✅ `test/helpers/globalSetup.ts` renamed from chaiSetup.ts
✅ TypeScript types updated (Vitest globals in tsconfig.json)
✅ Documentation (README, CONTRIBUTING) updated
✅ Mocha and @types/mocha removed from package.json
✅ No TypeScript errors: `npm run lint:types`

---

## References

- [Vitest Documentation](https://vitest.dev/)
- [Vitest Coverage Guide](https://vitest.dev/guide/coverage.html)
- [Migrating from Mocha to Vitest](https://vitest.dev/guide/migration.html)
- [V8 Coverage Provider](https://github.com/vitest-dev/vitest/tree/main/packages/coverage-v8)
- [Chai Assertion Library](https://www.chaijs.com/)
- [Chai-as-promised Plugin](https://github.com/domenic/chai-as-promised)
- [Chai-string Plugin](https://github.com/onechiporenko/chai-string)

---

## Appendix: Quick Reference

### File Changes Summary

| File | Change | Type |
|------|--------|------|
| `package.json` | Update test scripts, remove mocha config, update deps | Edit |
| `tsconfig.json` | Add vitest/globals to types | Edit |
| `test/helpers/chaiSetup.ts` | Rename to `globalSetup.ts` | Rename |
| `test/helpers/vitest.setup.ts` | Create new setup file | Create |
| `test/helpers/vitest.config.ts` | Create new config file | Create |
| `test/**/*.test.ts` | Remove chaiSetup calls/imports, update hooks | Edit (40+ files) |
| `README.md` | Update test instructions | Edit |
| `CONTRIBUTING.md` | Update test instructions | Edit |

### Key Removals

```bash
# These dependencies will be removed:
npm uninstall mocha @types/mocha should
````

### Key Additions

```bash
# These dependencies will be added:
npm install --save-dev vitest @vitest/coverage-v8
```

### Test Commands (After Migration)

```bash
npm test                    # Full test suite (lint + unit + e2e)
npm run test:unit           # Unit tests only
npm run test:unit:watch     # Watch mode
npm run test:coverage       # Coverage report (terminal)
npm run test:coverage:html  # Coverage report (HTML browser)
```
