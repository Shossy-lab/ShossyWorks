# Test Reviewer Findings (A5)

**Reviewer:** Test Quality & Coverage Reviewer
**Date:** 2026-04-09
**Scope:** All 12 test files (342 test cases), test helpers, vitest config, test run results

---

## Test Run Results Summary

```
Test Files:  8 failed | 2 passed (10)
Tests:       139 failed | 30 passed | 173 skipped (342)
```

- **security** (4 tests): ALL PASS
- **smoke** (4 tests, but file errors on missing env) - PASS when env present, but file throws and kills the entire test runner if env is missing
- **actions/** (58 tests): ALL FAIL - `server-only` import barrier
- **database/** (280 tests): ALL SKIPPED (no live Supabase in CI)

---

## CRITICAL Findings

### T-CRIT-01: ALL 58 Server Action Tests Are Permanently Broken (Cannot Run)

**Severity:** CRITICAL
**Files:** `tests/actions/projects.test.ts`, `tests/actions/estimates.test.ts`, `tests/actions/nodes.test.ts`, `tests/actions/snapshots.test.ts`
**Evidence:**
```
Error: This module cannot be imported from a Client Component module.
It should only be used from a Server Component.
❯ Object.<anonymous> node_modules/server-only/index.js:1:7
```

All 58 server action tests dynamically import from `@/lib/actions/*`. These action files import `@/lib/actions/_shared.ts` (line 8-9), which imports `@/lib/supabase/server` and `@/lib/auth/get-user`. The file `src/lib/auth/get-user.ts:1` contains `import "server-only"`, which throws unconditionally outside Next.js server context. Vitest runs in Node.js, not a Next.js server component context.

The `describe.skipIf(SKIP)` pattern checks for env vars, but the actual failure is not env-related -- it is the `server-only` import barrier. Even with all env vars present, these tests will ALWAYS fail. The skipIf guard (checking `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`) does not protect against this -- it only guards against missing env vars.

**Impact:** Zero test coverage for all 28 server actions (projects, estimates, nodes, snapshots). The tests look comprehensive on paper but have never passed and cannot pass without either: (a) mocking the `server-only` module in vitest config, or (b) restructuring the server actions to separate the server-only imports from the testable business logic.

**Fix:** Add a vitest alias or mock for `server-only`:
```ts
// vitest.config.ts, within the "actions" project
alias: {
  "server-only": path.resolve(__dirname, "tests/helpers/server-only-mock.ts"),
}
```
Or create `tests/helpers/server-only-mock.ts` as an empty file.

---

## HIGH Findings

### T-HIGH-01: Smoke Test File Throws on Missing Env Vars Instead of Skipping

**Severity:** HIGH
**File:** `tests/smoke/supabase.test.ts:8-12`
**Evidence:**
```ts
if (!url || !anonKey) {
  throw new Error(
    "Missing required env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY",
  );
}
```

This is a top-level `throw` that fires during module evaluation, not inside a test. If env vars are missing, the entire test runner will crash with an unhandled error rather than gracefully skipping. Every other test file (triggers, constraints, rls, actions) uses `const SKIP = !env; describe.skipIf(SKIP)(...)` or `skipIf(SKIP)("test name", ...)`. The smoke test is the sole exception and will break CI runs where env vars are intentionally absent.

**Fix:** Replace the throw with the skipIf pattern used everywhere else.

### T-HIGH-02: 173 Database Tests Skipped With No CI Strategy to Run Them

**Severity:** HIGH
**Files:** `tests/database/triggers.test.ts` (33 tests), `tests/database/rls.test.ts` (140 tests), `tests/database/constraints.test.ts` (multiple), `tests/database/snapshots.test.ts` (multiple)
**Evidence:** All database tests use `describe.skipIf(SKIP)` or `skipIf(SKIP)` where `SKIP = !SUPABASE_URL || !SERVICE_KEY`. There is no CI configuration, Docker Compose setup, or documentation for how to run these tests. The brief mentions "12 test files (248 test cases)" but the actual count is 342, with 173 always skipped.

The trigger and RLS tests depend on a `run_sql` RPC function that must be manually created in the database. There is no migration or setup script that creates this function:
```ts
// tests/database/triggers.test.ts:36
const { data, error } = await admin.rpc('run_sql', { query });
```

Without `run_sql`, even with correct env vars, triggers.test.ts and rls.test.ts will fail with an RPC error. There is no documentation about this prerequisite.

**Impact:** 50%+ of all tests can never run in any automated pipeline. The RLS tests (140 tests) represent the most critical security validation and have no path to CI execution.

### T-HIGH-03: Authorization Tests Are Tautological (ACT-PROJ-15, ACT-PROJ-16)

**Severity:** HIGH
**File:** `tests/actions/projects.test.ts:294-334`
**Evidence:**
```ts
it("ACT-PROJ-15: unauthenticated user gets UNAUTHORIZED error", async () => {
  const { createProject } = await import("@/lib/actions/projects");
  const result = await createProject({ name: "No Auth" });
  if (!result.success) {
    expect(["UNAUTHORIZED", "FORBIDDEN"]).toContain(result.code);
  }
  // If it succeeds, the test environment has an active session -- still valid
});
```

Both authorization tests (ACT-PROJ-15 and ACT-PROJ-16) accept SUCCESS as a valid outcome. A test that passes regardless of the result tests nothing. The comment "If it succeeds, the test environment has an active session -- still valid" means the test cannot fail even if auth is completely broken and allows unauthenticated access.

ACT-PROJ-16 is identical: it checks for a "pending role gets FORBIDDEN" but has no mechanism to set up a pending-role session, and again accepts success as valid.

**Impact:** Authorization/RBAC is completely untested. These tests give false confidence that auth is working.

### T-HIGH-04: Multiple Tests Silently Swallow Failures via try/catch

**Severity:** HIGH
**Files:** `tests/actions/nodes.test.ts:482-499` (ACT-NODE-13), `tests/actions/nodes.test.ts:519-551` (ACT-NODE-14), `tests/actions/nodes.test.ts:570-631` (ACT-NODE-15, ACT-NODE-16), `tests/actions/snapshots.test.ts:382-403` (ACT-SNAP-12), `tests/actions/snapshots.test.ts:420-438` (ACT-SNAP-13)
**Evidence (ACT-NODE-13):**
```ts
try {
  const nodesModule = await import("@/lib/actions/nodes");
  const getNodesFn = (nodesModule as any).getNodes ?? ...;
  if (getNodesFn) { /* test logic */ }
} catch {
  // Function may not be implemented yet -- skip gracefully
}
```

At least 6 tests wrap their entire test body in `try { ... } catch { // not implemented yet }`. These tests will ALWAYS pass even if the underlying function throws an unexpected error, returns wrong data, or doesn't exist. The catch block doesn't distinguish between "module not found" (expected) and "test assertion failed" (bug).

**Impact:** False positives. Tests report green when the feature is broken or missing. A test that catches and ignores all errors is worse than no test -- it provides false confidence.

---

## MEDIUM Findings

### T-MED-01: Inconsistent Skip Patterns Across Database Tests

**Severity:** MEDIUM
**Files:** `tests/database/constraints.test.ts`, `tests/database/snapshots.test.ts` vs `tests/database/triggers.test.ts`, `tests/database/rls.test.ts`

The test files use two different skip patterns:

**Pattern A** (triggers, rls): `describe.skipIf(SKIP)("suite-name", () => { it("test", ...) })`
**Pattern B** (constraints, snapshots): Define `skipIf` locally then use `skipIf(SKIP)("test name", async () => { ... })` outside any describe.skipIf wrapper.

In Pattern B (e.g., `constraints.test.ts:21`), the `describe` blocks are NOT wrapped in skipIf:
```ts
describe("database/constraints/enums", () => {
  skipIf(SKIP)("ENUM-01: ...", async () => { ... });
```

This means describe blocks run, lifecycle hooks (`beforeAll`, `afterAll`) run, but individual tests are skipped. The `beforeAll` in constraints.test.ts creates an admin client even when SKIP is true (line 28-32), which is harmless but wasteful. More importantly, `afterAll` (line 101-110) runs cleanup SQL against a `SKIP=true` environment where `admin` may be undefined, though the `if (SKIP) return` guard at line 102 prevents this.

The inconsistency makes the test suite harder to maintain and reason about.

### T-MED-02: Test Data Cleanup Is Incomplete (Potential Test Pollution)

**Severity:** MEDIUM
**Files:** `tests/helpers/test-utils.ts:393-411`, `tests/actions/projects.test.ts` (no cleanup at all)

The action tests (projects, estimates, nodes, snapshots) create test data via `createProject`, `createEstimate`, etc. but have NO `afterAll` or `afterEach` cleanup hooks. Every test run creates orphaned data in the database:
- `tests/actions/projects.test.ts`: Creates 7+ projects, never deletes any
- `tests/actions/estimates.test.ts`: Creates 8+ projects + estimates, never deletes any
- `tests/actions/nodes.test.ts`: Creates 10+ projects + estimates + nodes, never deletes any

The `cleanupTestProject` / `cleanupTestData` functions exist in `test-utils.ts` but are never called from any action test file.

**Impact:** Test database accumulates garbage data over time. Tests that query for "all projects" or count records will become flaky as orphaned data accumulates.

### T-MED-03: Coverage Thresholds Set to Zero

**Severity:** MEDIUM
**File:** `vitest.config.ts:62-67`
**Evidence:**
```ts
thresholds: {
  statements: 0,
  branches: 0,
  functions: 0,
  lines: 0,
},
```

All coverage thresholds are set to 0%. The comment says "TODO: Raise thresholds after Phase 1A adds unit tests" but Phase 1A is complete. With zero thresholds and zero passing action tests, the coverage gate provides no protection against regressions.

### T-MED-04: No Unit Tests Exist for Testable Pure Logic

**Severity:** MEDIUM
**File:** `vitest.config.ts:24` -- unit project includes `src/**/*.test.ts` but zero files match.

The vitest config defines a `unit` test project for `src/**/*.test.ts` but no such files exist. The project has testable pure functions (Zod validation schemas, type mapping utilities, error formatting, enum definitions) that could be tested without any database or server-only dependency. For example:
- `src/lib/validation/projects.ts` (Zod schemas) -- can validate in pure Node.js
- `src/lib/validation/format-error.ts` -- pure function
- `src/lib/types/action-result.ts` -- type constructors (`ok`, `err`, `validationError`)
- `src/lib/types/enums.ts` -- enum-to-label mappings

These are exactly the kinds of tests that would run fast, never flake, and catch real bugs.

### T-MED-05: RLS Tests Use `run_sql` RPC That May Not Enforce True RLS Context

**Severity:** MEDIUM
**File:** `tests/database/rls.test.ts:94-107`
**Evidence:**
```ts
async function queryAsRole(...) {
  const wrappedSql = `
    SELECT set_config('request.jwt.claims', '${claims}', true);
    SELECT set_config('request.jwt.claim.sub', '${userId}', true);
    ${query}
  `;
  return execSql(admin, wrappedSql);
}
```

The RLS tests use `set_config` to simulate JWT claims within a `run_sql` RPC call made via the service_role client. However, `run_sql` executes as the service_role (which bypasses RLS by default). Whether the `set_config` calls actually cause Postgres to evaluate RLS policies depends on how `run_sql` is implemented -- if it runs as `SECURITY DEFINER` with the service role, RLS is bypassed regardless of `set_config`. The tests assume RLS is evaluated, but there is no verification that `run_sql` uses `SECURITY INVOKER` or switches to the `authenticated` role.

**Impact:** All 140 RLS tests could be false positives if the `run_sql` function doesn't properly switch context. This is the most critical security test suite and its validity depends on an undocumented database function.

### T-MED-06: SQL Injection in Test Helpers

**Severity:** MEDIUM (low exploitability since test-only, but bad pattern)
**Files:** `tests/database/triggers.test.ts:65-69`, `tests/database/rls.test.ts:237-331`
**Evidence:**
```ts
await sql(`INSERT INTO projects (id, name, status) VALUES ('${projectId}', 'Trigger Test Project', 'active')`);
```

All SQL in the trigger and RLS tests uses string interpolation to build queries. While this is test-only code and the values are controlled (UUIDs, hardcoded strings), it establishes a pattern that could be copied to production code. Additionally, if any test data contained a single quote in a name, it would break the SQL.

The RLS seed SQL (`buildSeedSql()`) at line 237 is 100+ lines of interpolated SQL -- a maintenance hazard.

---

## LOW Findings

### T-LOW-01: Test ID Numbering Gaps

**Severity:** LOW
**File:** `tests/smoke/supabase.test.ts`
**Evidence:** Test IDs jump from `CONN-L2-02` to `CONN-L2-04` (CONN-L2-03 is missing). The trigger tests jump from TRG-06 to TRG-10, TRG-15 to TRG-20, TRG-23 to TRG-30, TRG-33 to TRG-40, etc. While these may be intentional (reserving ranges for categories), the gaps make it unclear whether tests were deleted or planned-but-not-written.

### T-LOW-02: Type Assertions Use `as any` and `as TestNode`

**Severity:** LOW
**File:** `tests/helpers/test-utils.ts:93,135,196`
**Evidence:**
```ts
return data as TestProject;  // line 93
return data as TestEstimate; // line 135
return data as TestNode;     // line 196
```

The test helpers cast Supabase query results to test interfaces without validation. If the DB schema changes and returns different fields, the cast silently hides the mismatch and tests may pass with incorrect data.

---

## Coverage Gaps (Missing Test Categories)

| Category | Status | Impact |
|----------|--------|--------|
| Unit tests (pure logic) | MISSING | Zod schemas, enums, type constructors, formatters -- all testable without DB |
| Middleware tests | MISSING | Auth middleware, redirect logic, header injection |
| Component tests | MISSING | No React component tests (expected at this stage, not urgent) |
| API route tests | MISSING | No API endpoint tests |
| Cross-user isolation | PARTIALLY COVERED | RLS tests cover this IF run_sql works correctly |
| Error boundary tests | MISSING | Error boundaries added in recent commit but not tested |
| Optimistic locking | COVERED (in action tests) | But action tests cannot run (T-CRIT-01) |
| Snapshot immutability | COVERED (db tests) | But only runs with live Supabase |

---

## Summary

The test suite has been written with good structure and comprehensive coverage _in theory_, but in practice:

1. **58 action tests (100%) permanently broken** due to `server-only` import barrier (CRITICAL)
2. **173 database tests (100%) always skipped** with no CI path (HIGH)
3. **Authorization tests are tautological** -- pass regardless of outcome (HIGH)
4. **Multiple tests silently swallow all errors** via catch blocks (HIGH)
5. **Only 34 tests can actually execute and produce valid results** (4 security + 4 smoke + 26 in the 2 passing DB suites when env is present)

Effective test coverage is near zero for the application layer. The database tests, while well-written, have no automated execution path.
