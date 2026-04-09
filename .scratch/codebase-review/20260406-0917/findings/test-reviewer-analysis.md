# A5 -- Test Reviewer Analysis

**Reviewer:** A5 (Test Reviewer)
**Domain:** Testing -- coverage, quality, organization, mocking, isolation, flakiness
**Date:** 2026-04-06
**Codebase:** ShossyWorks (Phase 0 -- scaffolding + auth)

---

## Executive Summary

The test suite is in a foundational but severely incomplete state. There are **2 test files** with **8 tests** covering **2 of 17 source files** (11.7% file coverage). The existing tests are well-written for their purpose -- smoke connectivity checks and static security assertions -- but entire testing categories (unit, component, integration, e2e, database) are completely absent. There is no coverage configuration, no coverage provider installed, no component testing library, no mocking infrastructure, and no e2e framework. The smoke tests make real network calls to production Supabase, making them environment-dependent and potentially flaky in CI. Empty test directories (`tests/actions/`, `tests/database/`) suggest planned but unimplemented test categories.

**Test run result:** All 8 tests pass (2 files, 1.17s total).

---

## Metrics Dashboard

| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| Source files | 17 (.ts + .tsx) | -- | -- |
| Test files | 2 | -- | -- |
| Test-to-source ratio | 11.7% | 50%+ | FAIL |
| Total test cases | 8 | -- | -- |
| Total assertions | 14 | -- | -- |
| Assertions per test | 1.75 | >= 1.5 | PASS |
| Coverage config present | No | Yes | FAIL |
| Coverage provider installed | No | Yes | FAIL |
| Coverage thresholds | None | 80%/75%/85% | FAIL |
| Error path tests | 0 | >= 20% of total | FAIL |
| Mock calls | 0 | -- | N/A |
| beforeEach/afterEach balance | 0/0 | Balanced | N/A |
| Skipped tests | 0 | 0 | PASS |
| Component test library | Not installed | Installed | FAIL |
| E2E framework | Not installed | Installed | FAIL |
| pgTAP database tests | 0 | >= 1 per table | FAIL |

---

## CRITICAL Findings

### CRIT-01: Missing Test Categories -- No Unit Tests for Core Infrastructure [Checklist #99]

**Severity:** CRITICAL
**Evidence:** All 17 source files lack unit tests.

The following files contain testable logic but have zero unit tests:

| File | Logic That Needs Testing |
|------|------------------------|
| `src/lib/supabase/admin.ts` | `createAdminClient()` -- fallback key selection (`SUPABASE_SECRET_KEY ?? SUPABASE_SERVICE_ROLE_KEY`), error throw when both keys missing |
| `src/lib/supabase/middleware.ts` | `updateSession()` -- route protection logic, redirect conditions, public route matching |
| `src/middleware.ts` | Middleware entry point -- matcher pattern, delegation to `updateSession` |
| `src/app/auth/callback/route.ts` | OAuth callback -- code exchange, redirect logic, error redirect, `next` parameter handling |
| `src/env.ts` | Environment validation schemas -- Zod schema correctness |

**Impact:** Core authentication and authorization logic has zero test coverage. A regression in `updateSession()` route protection could silently expose protected routes. The `createAdminClient()` key fallback logic is a single point of failure for admin operations with no verification.

**Recommended fix:** Add unit tests for each file listed above. For files with external dependencies (Supabase client, Next.js cookies), use `vi.mock()` to isolate the logic being tested.

---

### CRIT-02: Missing Test Categories -- No Component Tests [Checklist #99]

**Severity:** CRITICAL
**Evidence:** No `@testing-library/react` or `@testing-library/jest-dom` in `package.json`. No component test files exist.

Untested components:

| Component | File | Interactive Logic |
|-----------|------|------------------|
| `SignInPage` | `src/app/(auth)/sign-in/page.tsx` | Form submission, error display, loading state, Supabase auth call |
| `SignUpPage` | `src/app/(auth)/sign-up/page.tsx` | Form submission, error display, loading state, Supabase auth call |
| `Sidebar` | `src/components/nav/sidebar.tsx` | Collapse/expand toggle, active route highlighting |
| `UserMenu` | `src/components/nav/user-menu.tsx` | Sign-out flow |
| `ProtectedLayout` | `src/app/(protected)/layout.tsx` | Auth gate redirect, user data fetching |

**Impact:** The sign-in and sign-up forms are the primary user interaction points. Without component tests, regressions in form validation, error handling, or auth flow will not be caught until production.

**Recommended fix:**
1. Install `@testing-library/react`, `@testing-library/jest-dom`, and `jsdom` (or `happy-dom`)
2. Add a `jsdom` environment to vitest config for component tests
3. Write component tests for at least `SignInPage` and `SignUpPage` covering: form submission, error display, loading state, input validation

---

### CRIT-03: Missing Test Categories -- No Database/RLS Tests [Checklist #99, #108]

**Severity:** CRITICAL
**Evidence:** `tests/database/` directory exists but is empty. No pgTAP test files found. Zero SQL test files in `supabase/tests/`.

The migration `supabase/migrations/00000000000001_auth_roles.sql` creates:
- `app_role` enum (`owner`, `employee`, `client`)
- `user_roles` table with RLS enabled
- Two RLS policies: "Users can read their own role" and "Service role can manage all roles"
- `custom_access_token_hook` function (JWT claim injection)
- Permission grants/revocations

**Impact:** RLS policies are the primary authorization mechanism. The policy "Users can read their own role" (`USING ((SELECT auth.uid()) = user_id)`) has no test verifying that users cannot read OTHER users' roles. The "Service role can manage all roles" policy uses `USING (true) WITH CHECK (true)` -- this needs verification that it only applies to the service role context. The `custom_access_token_hook` function handles JWT token generation with role injection -- a bug here silently breaks authorization for the entire application.

**Recommended fix:**
1. Install `supabase-test-helpers` or configure pgTAP
2. Write SQL tests verifying:
   - Users can only read their own role (not others')
   - Authenticated users cannot INSERT/UPDATE/DELETE roles
   - Service role can perform all CRUD operations
   - `custom_access_token_hook` correctly injects role into claims
   - `custom_access_token_hook` defaults to 'employee' when no role record exists

---

## HIGH Findings

### HIGH-01: No Coverage Configuration or Provider [Checklist #98]

**Severity:** HIGH
**Evidence:** `vitest.config.ts` lines 4-16 -- no `coverage` key present in the test configuration.

```typescript
// vitest.config.ts -- ENTIRE config, no coverage section
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
  },
});
```

No coverage provider (`@vitest/coverage-v8` or `@vitest/coverage-istanbul`) is installed in `package.json`.

**Impact:** Without coverage tracking, there is no way to measure what percentage of code is exercised by tests. Coverage regressions will be invisible. CI cannot enforce coverage thresholds.

**Recommended fix:**
1. Install `@vitest/coverage-v8` as a dev dependency
2. Add coverage configuration to `vitest.config.ts`:
```typescript
test: {
  // existing config...
  coverage: {
    provider: 'v8',
    reporter: ['text', 'lcov'],
    include: ['src/**/*.ts', 'src/**/*.tsx'],
    exclude: ['src/**/*.d.ts'],
    all: true,
    thresholds: {
      statements: 80,
      branches: 75,
      functions: 85,
      lines: 80,
    },
  },
}
```

---

### HIGH-02: Smoke Tests Make Unmocked Network Calls -- Flakiness Risk [Checklist #110]

**Severity:** HIGH
**Evidence:** `tests/smoke/supabase.test.ts` lines 10, 20, 29, 39

```typescript
// Line 10 -- direct fetch to real Supabase
const response = await fetch(`${SUPABASE_URL}/rest/v1/`, {
  headers: {
    apikey: ANON_KEY,
    Authorization: `Bearer ${ANON_KEY}`,
  },
});

// Line 29 -- real Supabase admin client
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data, error } = await admin.auth.admin.listUsers({ perPage: 1 });
```

All 4 smoke tests make real HTTP calls to production Supabase. These tests:
- Require `.env.local` with valid credentials (fail without it)
- Will fail if the network is down, Supabase has an outage, or rate limits are hit
- Use the **service role key** in test code (lines 6, 29, 39) -- exposing admin credentials in test execution context
- Have 10-second timeouts suggesting awareness of network latency

**Impact:** These tests are inherently flaky in CI environments. They will cause intermittent CI failures unrelated to code changes. The service role key usage in tests also means any CI log leak exposes admin credentials.

**Recommended fix:**
- Keep these as a separate `smoke` test suite that runs manually or on a schedule (not in standard CI)
- Ensure the `test` script does NOT run smoke tests by default. Currently `vitest run` runs ALL tests matching `["src/**/*.test.ts", "tests/**/*.test.ts"]`, which includes smoke tests
- Add a `vitest.workspace.ts` to properly separate projects as the `test:smoke`, `test:security`, etc. scripts suggest (they reference `--project` flags but no workspace config exists)

---

### HIGH-03: Non-null Assertions Bypass Safety in Test Setup [Checklist #109]

**Severity:** HIGH
**Evidence:** `tests/smoke/supabase.test.ts` lines 4-6

```typescript
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
```

Three non-null assertions (`!`) on environment variables that may not be set. If `.env.local` is missing or incomplete, these become `undefined` at runtime and tests will fail with cryptic errors (e.g., `TypeError: Cannot read properties of undefined`) instead of a clear "missing env var" message.

**Impact:** Poor developer experience when tests fail due to environment setup issues. The root cause is obscured by downstream errors. This is especially problematic for new contributors or CI environments.

**Recommended fix:** Replace non-null assertions with explicit validation:
```typescript
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const SUPABASE_URL = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
const ANON_KEY = requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const SERVICE_ROLE_KEY = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
```

---

### HIGH-04: No Error Path Testing [Checklist #102]

**Severity:** HIGH
**Evidence:** All 8 tests verify happy paths only. Zero tests verify error conditions.

Untested error paths:

| Source File | Error Path | Risk |
|------------|-----------|------|
| `src/lib/supabase/admin.ts:8` | `throw new Error("Missing SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY")` | Admin client created without any key -- should throw |
| `src/app/auth/callback/route.ts:9-18` | Code exchange failure, missing code parameter | OAuth callback error handling |
| `src/lib/supabase/middleware.ts:35-45` | Unauthenticated user on protected route, authenticated user on auth route | Route protection logic |
| `src/app/(auth)/sign-in/page.tsx:23-26` | `supabase.auth.signInWithPassword` returns error | Auth error display |
| `src/app/(auth)/sign-up/page.tsx:22-28` | `supabase.auth.signUp` returns error | Signup error display |

**Impact:** The security tests (`tests/security/secrets.test.ts`) only check static file contents -- they do not exercise runtime error handling. If `createAdminClient()` stops throwing when keys are missing, there is no test to catch it. If the auth callback stops redirecting on error, nothing catches it.

**Recommended fix:** Add error path tests for at minimum:
1. `createAdminClient()` when both keys are undefined
2. `updateSession()` when `getUser()` returns no user on a protected route
3. Auth callback route when `code` parameter is missing
4. Auth callback route when `exchangeCodeForSession` returns an error

---

### HIGH-05: No API Route Tests [Checklist #107]

**Severity:** HIGH
**Evidence:** `src/app/auth/callback/route.ts` is the only API route handler. No test file exists for it.

The route handler at `src/app/auth/callback/route.ts` handles:
- OAuth code exchange (line 11)
- Redirect on success with configurable `next` parameter (line 14)
- Error redirect to sign-in with error query param (line 18)
- Missing `code` parameter handling (implicit -- falls through to error redirect)

**Impact:** The auth callback is a security-sensitive endpoint. It processes OAuth codes, handles session creation, and controls post-auth redirects. The `next` parameter (line 8: `const next = searchParams.get("next") ?? "/dashboard"`) is an **open redirect vector** if not validated -- an attacker could craft `?next=https://evil.com` and redirect authenticated users. No test verifies this behavior.

**Recommended fix:**
1. Write tests for the callback route covering:
   - Valid code exchange -> redirect to `next` param
   - Invalid code -> redirect to `/sign-in?error=auth_callback_error`
   - Missing code parameter -> redirect to error
   - Open redirect prevention (if `next` is an absolute URL)
2. Consider adding `next` parameter validation in the route handler itself

---

### HIGH-06: Broken Vitest Project References [Checklist #109]

**Severity:** HIGH
**Evidence:** `package.json` lines 14-17

```json
"test:smoke": "vitest run --project smoke",
"test:security": "vitest run --project security",
"test:db": "vitest run --project db",
"test:actions": "vitest run --project actions",
```

These scripts reference `--project` flags, but no `vitest.workspace.ts` or `vitest.workspace.json` file exists. Running `npm run test:smoke` will either silently run no tests or error out because Vitest does not know what "project smoke" means without a workspace configuration.

Additionally, `tests/actions/` and `tests/database/` directories are empty -- they were scaffolded but never populated.

**Impact:** Developers attempting to run project-scoped test commands will get confusing failures. The empty directories create a false impression of test organization without actual content.

**Recommended fix:**
1. Either create a `vitest.workspace.ts` defining the projects:
```typescript
export default [
  { name: 'smoke', test: { include: ['tests/smoke/**/*.test.ts'] } },
  { name: 'security', test: { include: ['tests/security/**/*.test.ts'] } },
  { name: 'db', test: { include: ['tests/database/**/*.test.ts'] } },
  { name: 'actions', test: { include: ['tests/actions/**/*.test.ts'] } },
];
```
2. Or remove the `--project` scripts until workspace config is implemented

---

### HIGH-07: No Middleware Route Protection Tests [Checklist #107]

**Severity:** HIGH
**Evidence:** `src/lib/supabase/middleware.ts` lines 32-46 -- route protection logic with zero tests.

```typescript
const publicRoutes = ["/sign-in", "/sign-up", "/auth/callback"];
const isPublicRoute = publicRoutes.some((route) => request.nextUrl.pathname.startsWith(route));

if (!user && !isPublicRoute) {
  // redirect to sign-in
}

if (user && isPublicRoute && request.nextUrl.pathname !== "/auth/callback") {
  // redirect to dashboard
}
```

This middleware controls the entire auth gate for the application. The security tests in `tests/security/secrets.test.ts` only check that the file contains `.auth.getUser()` -- they do NOT test the actual routing logic.

Test scenarios that need coverage:
- Unauthenticated user accessing `/dashboard` -> redirect to `/sign-in`
- Unauthenticated user accessing `/sign-in` -> allow through
- Authenticated user accessing `/sign-in` -> redirect to `/dashboard`
- Authenticated user accessing `/auth/callback` -> allow through (special case on line 41)
- Unauthenticated user accessing a deeply nested protected route -> redirect
- Routes that start with `/sign-in` but are not `/sign-in` (e.g., `/sign-input`) -> currently treated as public due to `startsWith` matching

**Impact:** A bug in the route protection logic could expose all protected routes to unauthenticated users. The `startsWith` matching strategy is also a subtle risk -- any route starting with `/sign-in`, `/sign-up`, or `/auth/callback` will be treated as public.

---

## MEDIUM Findings

### MED-01: Security Tests Are Brittle -- Testing File Contents Not Runtime Behavior [Checklist #100]

**Severity:** MEDIUM
**Evidence:** `tests/security/secrets.test.ts` -- all 4 tests read file contents with `readFileSync` and check strings.

```typescript
// Line 8-9 -- checking file text, not runtime behavior
const adminFile = readFileSync(
  resolve(__dirname, "../../src/lib/supabase/admin.ts"), "utf-8"
);
expect(adminFile).toContain('import "server-only"');
```

These tests verify static properties of source files:
- `SEC-L3-01`: Checks that `admin.ts` contains `import "server-only"` string
- `SEC-L3-02`: Checks that `middleware.ts` contains `getUser()` and not `getSession()`
- `SEC-L3-03`: Checks that `env.ts` does not expose server vars with `NEXT_PUBLIC_` prefix
- `SEC-L3-04`: Checks that `.env.local.example` does not contain real secrets

While these are valuable guardrails, they test **implementation details** (specific import strings) rather than **behavior** (whether the server-only boundary actually works, whether getUser actually returns validated data). If someone refactors the import to `import serverOnly from "server-only"`, test `SEC-L3-01` will fail even though the protection still works.

**Impact:** Tests are coupled to code formatting and string patterns. Refactoring could break tests without breaking functionality. These should be supplemented with behavioral tests.

---

### MED-02: Test Environment Configuration -- Node Instead of jsdom [Checklist #109]

**Severity:** MEDIUM
**Evidence:** `vitest.config.ts` line 12

```typescript
environment: "node",
```

The entire test suite runs in `node` environment. This is correct for the current smoke and security tests, but prevents component testing. When component tests are added (see CRIT-02), they will need a `jsdom` or `happy-dom` environment.

**Impact:** Component tests cannot be written until the environment is configured. The vitest workspace/project split should include environment per project.

---

### MED-03: Tests Use `__dirname` for File Resolution [Checklist #111]

**Severity:** MEDIUM
**Evidence:** `tests/security/secrets.test.ts` lines 8, 16, 26, 44

```typescript
resolve(__dirname, "../../src/lib/supabase/admin.ts")
```

Using `__dirname` with relative path traversal (`../../`) is fragile. If the test file is moved to a different directory depth, all paths break silently.

**Recommended fix:** Use a project root constant derived from the vitest config or a shared test utility:
```typescript
import { resolve } from 'path';
const ROOT = resolve(__dirname, '../..');
// or import from a shared test util
```

---

### MED-04: Test Setup Loads `.env.local` Unconditionally [Checklist #109]

**Severity:** MEDIUM
**Evidence:** `tests/setup.ts` lines 1-4

```typescript
import { config } from "dotenv";
config({ path: ".env.local" });
```

This setup file loads `.env.local` for ALL tests, including security tests that only read static files. This creates an unnecessary dependency -- security tests should not need environment variables to run.

The T3 env validation in `src/env.ts` is bypassed in tests because the test environment uses `process.env` directly rather than the validated `env` object.

**Impact:** Tests that should be environment-independent fail when `.env.local` is missing. In CI environments without Supabase credentials, even security tests could fail if env validation kicks in during imports.

---

### MED-05: No Test Naming Convention Documented [Checklist #111]

**Severity:** MEDIUM
**Evidence:** Two different naming patterns exist:

- `tests/smoke/supabase.test.ts` uses prefixed IDs: `"CONN-L2-01: Supabase REST API is reachable"`
- `tests/security/secrets.test.ts` uses prefixed IDs: `"SEC-L3-01: admin client is guarded by server-only import"`

The ID scheme (`CONN-L2-01`, `SEC-L3-03`) implies a structured test catalog with layer levels (L2, L3), but this is not documented anywhere. No convention guide exists for test naming.

**Impact:** As the test suite grows, inconsistent naming will make it harder to trace test failures to requirements. The layer numbering scheme should be documented.

---

## LOW Findings

### LOW-01: Assertion on HTTP Status Is Too Permissive [Checklist #101]

**Severity:** LOW
**Evidence:** `tests/smoke/supabase.test.ts` line 16

```typescript
expect(response.status).toBeLessThan(500);
```

This assertion passes for any status < 500, including 401, 403, 404. For a connectivity smoke test, this is arguably intentional (testing that the server responds), but `expect(response.ok).toBe(true)` or `expect(response.status).toBe(200)` would be more precise.

---

### LOW-02: No Test for Root Page Redirect [Checklist #111]

**Severity:** LOW
**Evidence:** `src/app/page.tsx` contains only a redirect:

```typescript
export default function HomePage() {
  redirect("/dashboard");
}
```

While simple, this redirect is the first thing users encounter. No test verifies it works.

---

### LOW-03: Empty Test Directories Should Be Documented [Checklist #111]

**Severity:** LOW
**Evidence:** `tests/actions/` and `tests/database/` are empty directories.

These were scaffolded during project setup but contain no test files. They should either contain placeholder test files with TODO comments, or be removed until needed.

---

## Test Architecture Assessment

### Current Test Pyramid

```
         /\
        /  \
       / E2E\        <- MISSING (no Playwright/Cypress)
      /------\
     / Integ. \      <- MISSING (no integration tests)
    /----------\
   / Component  \    <- MISSING (no RTL, no jsdom)
  /--------------\
 /   Unit Tests   \  <- MISSING (no unit tests for business logic)
/------------------\
|  Smoke + Security | <- EXISTS (2 files, 8 tests)
 ------------------
```

The test suite is inverted -- it has infrastructure-level smoke tests but no unit or component tests. This is common at Phase 0 of a project but must be addressed before any business logic is added in Phase 1A.

### What Must Be Tested Before Phase 1A

Phase 1A will add database schema and data access logic. Before that work begins, the following test infrastructure must be in place:

1. **Coverage provider** -- `@vitest/coverage-v8` with thresholds
2. **Component testing** -- `@testing-library/react` + `jsdom`/`happy-dom` environment
3. **Database testing** -- pgTAP or equivalent for RLS policy verification
4. **Vitest workspace** -- proper project separation for smoke/security/unit/component/db
5. **Unit tests** for existing logic -- `createAdminClient`, `updateSession`, auth callback route
6. **CI test separation** -- smoke tests (network-dependent) separated from unit tests (deterministic)

### Missing Testing Dependencies

| Package | Purpose | Priority |
|---------|---------|----------|
| `@vitest/coverage-v8` | Coverage reporting and thresholds | HIGH |
| `@testing-library/react` | Component testing | HIGH |
| `@testing-library/jest-dom` | DOM assertion matchers | HIGH |
| `@testing-library/user-event` | User interaction simulation | HIGH |
| `jsdom` or `happy-dom` | Browser environment for component tests | HIGH |
| `msw` | HTTP request mocking | MEDIUM |
| `supabase-test-helpers` | pgTAP test utilities | HIGH |

---

## Summary of Findings by Severity

| Severity | Count | Finding IDs |
|----------|-------|-------------|
| CRITICAL | 3 | CRIT-01, CRIT-02, CRIT-03 |
| HIGH | 7 | HIGH-01 through HIGH-07 |
| MEDIUM | 5 | MED-01 through MED-05 |
| LOW | 3 | LOW-01 through LOW-03 |
| **Total** | **18** | |

### Priority Action Items

1. **Immediate (before next feature work):**
   - Install coverage provider and configure thresholds (HIGH-01)
   - Create vitest workspace config to fix broken project scripts (HIGH-06)
   - Write unit tests for `createAdminClient` error path (CRIT-01, HIGH-04)
   - Write unit tests for middleware route protection logic (HIGH-07)

2. **Before Phase 1A:**
   - Install component testing dependencies (CRIT-02)
   - Set up pgTAP or database testing framework (CRIT-03)
   - Write auth callback route tests including open redirect check (HIGH-05)
   - Separate smoke tests from CI-mandatory tests (HIGH-02)

3. **Ongoing:**
   - Document test naming convention (MED-05)
   - Replace `__dirname` traversal with project root constant (MED-03)
   - Add error path tests for every new feature (HIGH-04)

---

## Checklist Coverage Map

| Checklist # | Item | Status | Finding |
|-------------|------|--------|---------|
| #98 | Test coverage analysis | FAIL | HIGH-01 |
| #99 | Missing test categories | FAIL | CRIT-01, CRIT-02, CRIT-03 |
| #100 | Test quality indicators | PARTIAL | MED-01 |
| #101 | Assertion quality | PASS (1.75/test) | LOW-01 minor |
| #102 | Edge case coverage | FAIL | HIGH-04 |
| #103 | Mock quality | N/A | No mocks used |
| #104 | Test isolation | PASS | No shared state |
| #105 | Async testing | PASS | Awaits used correctly |
| #106 | React component testing | FAIL | CRIT-02 |
| #107 | API route testing | FAIL | HIGH-05, HIGH-07 |
| #108 | Database testing | FAIL | CRIT-03 |
| #109 | Test configuration | PARTIAL | HIGH-03, HIGH-06, MED-02, MED-04 |
| #110 | Flaky test detection | FAIL | HIGH-02 |
| #111 | Test naming/organization | PARTIAL | MED-03, MED-05, LOW-02, LOW-03 |
| #112 | Performance testing | N/A | Too early for perf tests |
