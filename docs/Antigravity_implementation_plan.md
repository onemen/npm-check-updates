# Vitest Migration: Review & Fixes

## Summary

The WIP vitest migration is largely successful — **576/591 tests pass** (97.5%). There are **6 failing tests** across **5 test files**, all rooted in test infrastructure problems introduced by the switch from Mocha to Vitest.

---

## Q&A: Your Questions

### 1. Keep Chai or switch to Vitest's built-in `expect`?

**Recommendation: Keep Chai for now.**

The tests use Chai's `.should` syntax extensively (e.g. `pkgData.should.have.property(...)`, `stdout.should.containIgnoreCase(...)`), plus the `chai-string` plugin (`containIgnoreCase`, `startWith`) and `chai-as-promised` (`.should.eventually.be.rejectedWith(...)`). These are deeply baked into ~40+ test files.

Vitest's built-in `expect` is a great alternative, but migrating 40+ files away from `.should` chains is a significant effort. The cost/benefit is low right now.

**However, there is one concrete improvement to make**: The `chai-as-promised` integration is currently working, but it requires the global setup to be run. The `.should.eventually.be.rejectedWith(...)` pattern works fine with the current Chai setup.

> [!NOTE]
> If you want to eventually migrate to Vitest's `expect`, do it as a separate PR. For now, keep Chai.

---

### 2. Spawned CLI tests and coverage

**Current state:** Tests in `bin.test.ts`, `doctor.test.ts`, `filter.test.ts` (cli describe), `workspaces.test.ts`, `install.test.ts`, etc. all spawn `build/cli.js` via `spawn-please`. These spawned processes run in a **separate Node.js V8 instance** and their coverage is **not captured** by Vitest's V8 provider.

**Options:**
| Approach | Effort | Result |
|----------|--------|--------|
| **Option A: Accept as-is** (current plan) | None | Spawned CLI tests count as integration tests, not included in coverage |
| **Option B: `NODE_V8_COVERAGE` env var** | Medium | Collect raw V8 coverage from child processes, merge with vitest report using `c8` or `istanbul` |
| **Option C: `--import` coverage hook** | High | Pass a custom loader to the spawned node process that instruments code |

**Recommendation: Option B (enabled but not blocking).**

Vitest's `@vitest/coverage-v8` writes to `NODE_V8_COVERAGE` dir. You can pass this env var to spawned processes to collect their coverage too, then merge. The `vite.config.ts` already has `sourcemap: true`.

Steps to implement when ready:

1. In vitest config, set `coverage.all: true` so all src files appear even if untouched
2. When spawning `build/cli.js`, pass `NODE_V8_COVERAGE=./coverage/tmp` env var
3. After tests, merge with `c8 report --include 'src/**'`

> [!NOTE]
> For now, this is deferred to Phase 2. The current `--coverage` output correctly shows coverage from direct source tests.

---

## Failing Tests: Root Causes

### Issue 1: `silenceProgressBar` stubs not restored between tests (5 failing tests)

**Files:** `getEnginesNodeFromRegistry.test.ts`, `getPeerDependenciesFromRegistry.test.ts`, `getIgnoredUpgradesDueToPeerDeps.test.ts`

**Error:**

```
TypeError: Attempted to wrap render which is already wrapped
```

**Root Cause:** The `silenceProgressBar()` helper registers an `afterEach` hook to restore stubs. But under Vitest's parallel test runner, tests in the same file run **sequentially** but with module isolation by default — however the key issue is that `silenceProgressBar()` is called **inside each `it()` test body**, which means:

1. Test 1 calls `silenceProgressBar()` → stubs are created, `afterEach` is registered
2. Test 2 calls `silenceProgressBar()` again → tries to stub an already-stubbed prototype method → **BOOM**

In Mocha, this worked because `afterEach` at the top-level `describe` scope vs. inside an `it()` behaved slightly differently. In Vitest, the `afterEach` registered inside an `it()` fires _after that test_, which should work... but the issue is that `silenceProgressBar()` calls `afterEach` dynamically inside `it()`. **Vitest does not support registering lifecycle hooks inside a test body** — it will accept them but the timing is unreliable.

**Fix:** Move `silenceProgressBar()` to `beforeEach`/`afterEach` at the `describe` level, not inside each `it()`. Or redesign the helper to use a `sinon.sandbox` pattern with proper lifecycle.

**The cleanest fix** is to have `silenceProgressBar` return a `restore()` function and call it in a proper `afterEach`:

```typescript
// helpers/silenceProgressBar.ts - FIXED
export function silenceProgressBar() {
  const stubs = [
    Sinon.stub(ProgressBar.prototype, 'render'),
    Sinon.stub(ProgressBar.prototype, 'tick'),
    Sinon.stub(ProgressBar.prototype, 'update'),
  ]
  return {
    restore: () => stubs.forEach(s => s.restore()),
  }
}
```

Then in each test file that uses it:

```typescript
describe('...', () => {
  let pb: ReturnType<typeof silenceProgressBar>
  beforeEach(() => { pb = silenceProgressBar() })
  afterEach(() => pb.restore())
  ...
})
```

---

### Issue 2: `filter.test.ts > filter > module` — `options.distTag` is undefined (1 failing test)

**Error:**

```
TypeError: Cannot read properties of undefined (reading 'distTag')
 ❯ src/package-managers/npm.ts:569:18
     [options.distTag || 'latest']: version,
```

**Root Cause:** The `stubVersions('99.9.9')` call returns a sinon stub that calls `npmApi.mockFetchUpgradedPackument('99.9.9')`. The mock function is invoked with `options` being `undefined`. This is a **test isolation issue** with Vitest: Vitest runs tests in a different module context than Mocha (using Vite's module graph), and the stub setup via `sinon.stub(npmApi, 'fetchUpgradedPackumentMemo')` may be receiving a different function signature.

**Investigation needed:** Check `npmApi.mockFetchUpgradedPackument` to see if `options` was always required, or if something changed.

**Immediate fix:** The test uses `beforeAll`/`afterAll` correctly. The issue is likely that `mockFetchUpgradedPackument` doesn't handle missing `options`. Defensive fix in the source:

```typescript
// src/package-managers/npm.ts:569 - add fallback
[options?.distTag || 'latest']: version,
```

> [!IMPORTANT]
> This is a defensive fix. The actual root cause should be investigated by looking at `mockFetchUpgradedPackument`'s signature.

---

### Issue 3: `doctor.test.ts > npm > upgrade dependencies when tests pass` — version mismatch

**Error:**

```
expected ... to contain 'ncu-test-v2  ~1.0.0  →  ~2.0.0' ignoring case
```

**Root Cause:** The doctor test uses `stubVersions(mockNpmVersions, { spawn: true })` which sets `STUB_VERSIONS` env var. The spawned child process picks up the stub. However, the output shows the upgrade as `~2.0.0  →  ~2.0.0` (same version), which means the `STUB_VERSIONS` env var is either not being picked up, or the test-data's `package.json` has already been modified to `~2.0.0`.

This is a **test data pollution issue**: if a previous test run didn't clean up properly (e.g. crashed), the `test/test-data/doctor/pass/package.json` may still have `~2.0.0` written into it from a previous run.

**Fix:** This is likely a one-time issue. The cleanup happens in `finally` blocks, so a previous test crash may have left stale data.

> [!WARNING]
> Check the file `test/test-data/doctor/pass/package.json` — if it has `~2.0.0` for `ncu-test-v2`, reset it to `~1.0.0`.

---

## Proposed Fixes

### Fix 1: `silenceProgressBar` — make it return a restore handle

#### [MODIFY] [silenceProgressBar.ts](file:///c:/code/ncu/npm-check-updates/test/helpers/silenceProgressBar.ts)

Change the helper to return a `restore()` function instead of registering `afterEach` internally.

#### [MODIFY] [getEnginesNodeFromRegistry.test.ts](file:///c:/code/ncu/npm-check-updates/test/getEnginesNodeFromRegistry.test.ts)

#### [MODIFY] [getPeerDependenciesFromRegistry.test.ts](file:///c:/code/ncu/npm-check-updates/test/getPeerDependenciesFromRegistry.test.ts)

#### [MODIFY] [getIgnoredUpgradesDueToPeerDeps.test.ts](file:///c:/code/ncu/npm-check-updates/test/getIgnoredUpgradesDueToPeerDeps.test.ts)

Update callers to use `beforeEach`/`afterEach`.

---

### Fix 2: Defensive `options?.distTag` in npm.ts

#### [MODIFY] [npm.ts](file:///c:/code/ncu/npm-check-updates/src/package-managers/npm.ts)

Change `options.distTag` → `options?.distTag` at line 569.

---

### Fix 3: Reset test-data/doctor/pass/package.json

Verify and reset if stale.

---

## Suggestions for Improvement

### S1: Add `pool: 'forks'` to vitest config

Vitest by default uses `threads` pool, which can cause module-level singleton issues (like sinon stubs leaking between parallel test files). Using `forks` gives each test file its own Node process — closer to Mocha's behavior:

```typescript
// test/helpers/vitest.config.ts
test: {
  pool: 'forks',  // Each test file gets its own process
  ...
}
```

> [!TIP]
> `forks` is slightly slower but prevents module-level state bleed between files. Given the test suite already takes 60s, this is worth it for correctness.

### S2: `MaxListenersExceededWarning` cleanup

Several test files trigger `MaxListenersExceededWarning: 11 exit listeners added`. This happens because tests add process listeners (via spawn-please or sinon) without cleaning up. Add `process.setMaxListeners(50)` in `vitest.setup.ts` as a temporary suppression, or investigate and fix the actual leaks.

### S3: Add `forceRerunTriggers` for doctor test-data

The doctor tests modify files in `test/test-data/doctor/`. In watch mode, this causes infinite re-runs. Add to vitest config:

```typescript
forceRerunTriggers: ['!test/test-data/**']
```

### S4: Consider `globalSetup` vs `setupFiles`

Currently `vitest.setup.ts` uses `setupFiles` which runs in the **test worker context** (same process). Vitest also has a `globalSetup` option that runs once before all workers. For the Chai initialization this doesn't matter much, but for future process-level setup it may be cleaner to split them.

---

## Verification Plan

After fixes:

```bash
npm run test:unit  # Should show 0 failures
```

Specific files to verify:

- `test/getEnginesNodeFromRegistry.test.ts` — 3/3 pass
- `test/getPeerDependenciesFromRegistry.test.ts` — 3/3 pass
- `test/getIgnoredUpgradesDueToPeerDeps.test.ts` — 2/2 pass
- `test/filter.test.ts` — 22/22 pass
- `test/doctor.test.ts` — no regressions
