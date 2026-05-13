# Migration Plan Updates Summary

## Key Changes Made to MIGRATION_PLAN_MOCHA_TO_VITEST.md

### 1. Config Location: `test/helpers/vitest.config.ts`
- **Changed from:** `vitest.config.ts` in project root
- **Reason:** Keeps test-related configs co-located with test helpers
- **Impact:** All test commands use `--config test/helpers/vitest.config.ts`

### 2. Chai Setup Refactored
- **Renamed:** `test/helpers/chaiSetup.ts` → `test/helpers/globalSetup.ts`
- **Why:** More descriptive name for global test setup (not just Chai anymore)
- **New file:** `test/helpers/vitest.setup.ts` (Vitest setup entry point)
- **Impact:** Clearer separation of concerns, setup function called via `setupFiles`

### 3. Coverage Configuration
- **Thresholds:** Commented out (disabled for baseline phase)
- **No CI/CD integration:** Skip adding coverage reporting to GitHub Actions yet
- **Reason:** Establish baseline metrics first before enforcing thresholds
- **Include:** Only `src/**/*.ts` (production code)
- **Exclude:** Removed `dist/` (doesn't exist in your project), kept `test/`

### 4. Two-Track Testing Strategy Documented
- **Track 1:** Direct source file tests (standard Vitest coverage)
- **Track 2:** Spawned CLI tests via `spawn()` (integration/E2E category for now)
- **Future consideration:** Plan for spawned process coverage later

### 5. Dependencies to Remove (Phase 10)
Clear list of what to uninstall:
```
npm uninstall mocha @types/mocha should
```

**Clear list of what to KEEP:**
- Chai and plugins (chai, chai-as-promised, chai-string)
- Sinon (mocking)
- All @types/* for the above

### 6. Remove Mocha Configuration (Phase 3.3)
- Delete `mocha` section from `package.json`
- Includes: check-leaks, node-option, timeout, recursive, exit settings

### 7. Simplified Timeline
- **Reduced from:** 4-5 hours
- **Updated to:** 2.5-3 hours
- **Reason:** More focused scope (no CI/CD, no coverage enforcement)

### 8. Enhanced Success Criteria (Phase 15)
Clear, specific checklist including:
- ✅ `chaiSetup()` calls removed from all test files
- ✅ `test/helpers/globalSetup.ts` renamed
- ✅ `test/helpers/vitest.config.ts` and `vitest.setup.ts` created
- ✅ No coverage thresholds enforced
- ✅ Mocha and @types/mocha removed from package.json

### 9. Appendix: Quick Reference
Added for easy lookup:
- File changes summary table
- Key removals/additions commands
- Test commands after migration

### 10. Windows-Specific Guidance (Phase 8)
- Path separator issues (use forward slashes)
- Line ending issues (`core.autocrlf=true`)
- Module resolution configuration

## What Did NOT Change

- Test file structure (still in `test/` directory)
- Test naming convention (still `.test.ts`)
- Assertion library (Chai stays - no changes to assertions)
- Sinon mocking (continues to work)
- `tsx` loader setup (handled automatically by Vitest)

## File Operations Required

| File | Action | Type |
|------|--------|------|
| `test/helpers/chaiSetup.ts` | Rename | File |
| `test/helpers/globalSetup.ts` | Create (from chaiSetup.ts) | File |
| `test/helpers/vitest.setup.ts` | Create new | File |
| `test/helpers/vitest.config.ts` | Create new | File |
| `package.json` | Update scripts + remove mocha config | Edit |
| `tsconfig.json` | Add `vitest/globals` to types | Edit |
| `test/**/*.test.ts` | Remove chaiSetup imports/calls, update hooks | Bulk Edit (~40 files) |
| `README.md` | Update test instructions | Edit |
| `CONTRIBUTING.md` | Update test instructions | Edit |

## Coverage Strategy

### Phase 1 (Current - No Thresholds)
- Generate baseline reports locally
- HTML reports: `coverage/index.html`
- No CI/CD enforcement
- No minimum requirements

### Phase 2 (Future - Analysis)
- Review baseline metrics
- Identify coverage gaps
- Plan improvements

### Phase 3+ (Future - Enforcement)
- Set reasonable thresholds (60-70%)
- Enable CI/CD checks
- Gradually increase targets

## Execution Order Simplified

1. **Setup & Rename** (20 min) - Create config files, rename chaiSetup
2. **Install & Configure** (5 min) - Install Vitest dependencies
3. **Update Tests** (45 min) - Find/replace hooks, remove chaiSetup calls
4. **Update Scripts** (10 min) - Update package.json
5. **TypeScript** (10 min) - Update tsconfig.json
6. **First Test Run** (10 min) - Verify all tests pass
7. **Coverage Check** (15 min) - Generate and review coverage
8. **Cleanup** (5 min) - Remove Mocha dependencies
9. **Documentation** (15 min) - Update README/CONTRIBUTING
10. **Commit & Review** (30 min) - Final checks and commit

**Total: 2.5-3 hours**

## Key Decision Points

### ✅ Decided
- Config in `test/helpers/` (not project root)
- No coverage thresholds initially
- No CI/CD coverage integration initially
- Focus on Track 1 (direct tests) for coverage
- Defer spawned CLI coverage to Phase 2

### 🤔 Future Decisions
- When to set coverage thresholds
- Whether to track spawned CLI coverage
- How to integrate into CI/CD

## Next Steps

1. Review and approve updated migration plan
2. Schedule migration work
3. Create feature branch and begin Phase 1 (Setup & Rename)
4. Execute steps 1-7 in order
5. Generate baseline coverage report
6. Document metrics and findings
7. Plan follow-up phases based on coverage analysis
