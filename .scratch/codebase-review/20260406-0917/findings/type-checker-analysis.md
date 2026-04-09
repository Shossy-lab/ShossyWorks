# Type Checker Analysis (A3)

**Agent:** A3 -- Type Checker
**Domain:** Type Safety -- strict mode, any/unknown usage, missing type annotations, unsafe casts, non-null assertions, implicit any, generic constraints, discriminated unions, exhaustive checks, Supabase type generation, runtime validation boundaries
**Date:** 2026-04-06
**Codebase:** ShossyWorks (~721 LOC, 13 TS, 10 TSX, 1 CSS, 1 SQL migration)

---

## Executive Summary

The codebase is early-stage (Phase 0 scaffolding + auth) with a small surface area. TypeScript compiles cleanly with `strict: true` and zero errors. There are no explicit `any` annotations, no type assertions, no `@ts-ignore` / `@ts-expect-error` suppressions, and no non-null assertions in production code. This is strong.

However, the small surface area masks several structural type safety gaps that will compound as the codebase grows. The most critical finding is the complete absence of Supabase-generated database types -- every Supabase client call returns untyped results, making all database interactions effectively `any`-typed at the data layer. Additional gaps include missing `noUncheckedIndexedAccess` and `noImplicitReturns` compiler flags, non-null assertions in test files, missing return type annotations on all exported functions, and untyped Supabase clients.

**Compiler output:** `npx tsc --noEmit` -- 0 errors, 0 warnings.

---

## Findings

### CRITICAL

---

#### C-01: Supabase Generated Types Do Not Exist (Checklist #61)

**Severity:** CRITICAL
**Files:** `src/lib/types/` (empty directory), `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`, `src/lib/supabase/admin.ts`, `src/lib/supabase/middleware.ts`

**Evidence:**

The `src/lib/types/` directory exists but is completely empty. The `package.json` has a `db:types` script:

```
"db:types": "npx supabase gen types typescript --project-id edpumrranilhipwnvfrq > src/lib/types/supabase.ts"
```

This script has never been run. No `supabase.ts` types file exists. The project has one applied migration (`00000000000001_auth_roles.sql`) that creates:
- `public.app_role` enum (`owner`, `employee`, `client`)
- `public.user_roles` table (5 columns)
- `public.custom_access_token_hook` function

None of these database structures have TypeScript type representations.

**Impact:** Every Supabase client call in the codebase returns untyped results. The `supabase.from("user_roles").select(...)` call in tests, and all future data access code, will have `any`-typed return values. This defeats the purpose of `strict: true` because the `any` comes from the Supabase SDK's generic parameter defaulting to its internal fallback type when no `Database` generic is provided.

**Recommendation:** Run `npm run db:types` immediately. Then parameterize all client factories with the generated `Database` type (see finding H-01).

---

#### C-02: All Supabase Clients Are Untyped -- No Database Generic (Checklist #63)

**Severity:** CRITICAL (escalated from HIGH because no generated types exist at all)
**Files:**
- `src/lib/supabase/client.ts:7`
- `src/lib/supabase/server.ts:8`
- `src/lib/supabase/admin.ts:12`
- `src/lib/supabase/middleware.ts:8`

**Evidence:**

Every Supabase client factory calls `createBrowserClient(...)`, `createServerClient(...)`, or `createClient(...)` without the `Database` generic parameter:

```typescript
// src/lib/supabase/client.ts:7
return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
// Should be: createBrowserClient<Database>(...)

// src/lib/supabase/server.ts:8
return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { ... });
// Should be: createServerClient<Database>(...)

// src/lib/supabase/admin.ts:12
return createClient(env.NEXT_PUBLIC_SUPABASE_URL, serviceKey, { ... });
// Should be: createClient<Database>(...)

// src/lib/supabase/middleware.ts:8
const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { ... });
// Should be: createServerClient<Database>(...)
```

**Impact:** Without the `Database` generic, every `.from()` call returns broadly-typed results. Table names are not validated at compile time, column selections are not checked, and return types default to the SDK's internal generic fallback. As the codebase adds data access code in Phase 1A, every query result will be effectively untyped, creating a viral `any`-equivalent that flows through the entire data layer.

**Recommendation:** After generating types (C-01), update all four client factories:
```typescript
import type { Database } from "@/lib/types/supabase";
// then: createBrowserClient<Database>(...), createServerClient<Database>(...), etc.
```

---

### HIGH

---

#### H-01: Missing `noUncheckedIndexedAccess` Compiler Flag (Checklist #5)

**Severity:** HIGH
**File:** `tsconfig.json`

**Evidence:**

```json
{
  "compilerOptions": {
    "strict": true
    // noUncheckedIndexedAccess is NOT set
  }
}
```

The `noUncheckedIndexedAccess` flag is NOT included in TypeScript's `strict: true` bundle. It must be set explicitly. When absent, array index access (`arr[0]`) and object index signatures (`obj[key]`) return `T` instead of `T | undefined`, which is unsound.

**Current impact:** The codebase currently has no array index access or index signature patterns. But this is a Phase 0 scaffold -- Phase 1A will introduce database queries returning arrays, and accessing `result[0]` without undefined checks will be a common source of runtime errors.

**Recommendation:** Add to `tsconfig.json`:
```json
"noUncheckedIndexedAccess": true
```

---

#### H-02: Missing `noImplicitReturns` Compiler Flag (Checklist #4)

**Severity:** HIGH
**File:** `tsconfig.json`

**Evidence:**

```json
{
  "compilerOptions": {
    "strict": true
    // noImplicitReturns is NOT set
  }
}
```

The `noImplicitReturns` flag is NOT included in `strict: true`. Without it, functions with code paths that fall off without returning do not produce errors. This is a footgun for any function that should return a value but has an unhandled branch.

**Current example:** The `GET` handler in `src/app/auth/callback/route.ts` has two branches, both returning `NextResponse`. The structure is correct today. But without the flag, future functions can silently have missing returns.

**Recommendation:** Add to `tsconfig.json`:
```json
"noImplicitReturns": true
```

---

#### H-03: Non-Null Assertions in Test Files Bypass Runtime Safety (Checklist #16)

**Severity:** HIGH
**File:** `tests/smoke/supabase.test.ts:4-6`

**Evidence:**

```typescript
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
```

Three non-null assertions (`!`) on `process.env` accesses. If any of these environment variables is missing, the tests will proceed with `undefined` coerced to a string, producing confusing failures (HTTP requests to `undefined/rest/v1/` or authentication with `undefined` as a key).

**Impact:** Tests become fragile and produce misleading error messages when env is misconfigured. The `!` assertions also establish a pattern that developers will copy into production code.

**Recommendation:** Replace with runtime guards that produce clear failure messages:

```typescript
function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

const SUPABASE_URL = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
```

Or use the existing `env.ts` Zod validation:
```typescript
import { env } from "@/env";
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
```

---

#### H-04: Missing Return Type Annotations on All Exported Functions (Checklist #43)

**Severity:** HIGH
**Files:** Every TypeScript source file with exports

**Evidence:**

None of the exported functions in the codebase have explicit return type annotations. All rely on type inference:

| File | Function | Inferred Return |
|------|----------|----------------|
| `src/lib/supabase/client.ts:6` | `createClient()` | `SupabaseClient` (inferred) |
| `src/lib/supabase/server.ts:5` | `createClient()` | `Promise<SupabaseClient>` (inferred) |
| `src/lib/supabase/admin.ts:6` | `createAdminClient()` | `SupabaseClient` (inferred) |
| `src/lib/supabase/middleware.ts:5` | `updateSession(request)` | `Promise<NextResponse>` (inferred) |
| `src/middleware.ts:4` | `middleware(request)` | `Promise<NextResponse>` (inferred) |
| `src/app/auth/callback/route.ts:4` | `GET(request)` | `Promise<NextResponse>` (inferred) |
| `src/app/layout.tsx:12` | `RootLayout({children})` | `JSX.Element` (inferred) |
| `src/app/page.tsx:3` | `HomePage()` | `never` (inferred, redirect) |
| `src/app/(auth)/sign-in/page.tsx:8` | `SignInPage()` | `JSX.Element` (inferred) |
| `src/app/(auth)/sign-up/page.tsx:8` | `SignUpPage()` | `JSX.Element` (inferred) |
| `src/components/nav/sidebar.tsx:13` | `Sidebar()` | `JSX.Element` (inferred) |
| `src/components/nav/user-menu.tsx:6` | `UserMenu({email})` | `JSX.Element` (inferred) |
| `src/app/(protected)/layout.tsx:6` | `ProtectedLayout({children})` | `Promise<JSX.Element>` (inferred) |
| `src/app/(protected)/dashboard/page.tsx:3` | `DashboardPage()` | `JSX.Element` (inferred) |
| `src/app/(protected)/projects/page.tsx:1` | `ProjectsPage()` | `JSX.Element` (inferred) |
| `src/app/(protected)/settings/page.tsx:1` | `SettingsPage()` | `JSX.Element` (inferred) |

**Impact:** While TypeScript's inference is correct here, missing return types on exported functions means:
1. The public API contract is implicit -- changes to internals can silently change the return type
2. The compiler cannot catch accidental return type changes
3. Consumers of these functions have no explicit contract to depend on
4. For the Supabase client factories specifically, adding the `Database` generic (C-02 fix) will change the inferred return type, and without explicit annotations there is no compiler check that the change is intentional

**Recommendation:** Add explicit return types to all exported functions. At minimum, prioritize the Supabase client factories and the API route handler. For React components, the community convention is split, but for non-trivial components (layouts, pages with data fetching), explicit return types catch async/sync mismatches.

---

#### H-05: Auth Callback Route Handler Uses `Request` Instead of `NextRequest` (Checklist #56)

**Severity:** HIGH
**File:** `src/app/auth/callback/route.ts:4`

**Evidence:**

```typescript
export async function GET(request: Request) {
```

The handler uses the generic Web API `Request` type instead of Next.js's `NextRequest`. While this works at runtime (Next.js passes a `NextRequest` which extends `Request`), using `Request` loses access to:
- `request.nextUrl` (already using manual `new URL(request.url)` instead)
- `request.cookies` (typed cookie access)
- `request.geo`, `request.ip` (if needed later)

**Impact:** The `new URL(request.url)` pattern is verbose and loses the richer typing that `NextRequest.nextUrl` provides. More critically, this establishes a pattern where future route handlers might also use `Request`, losing Next.js middleware integration benefits.

**Recommendation:**
```typescript
import { type NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = request.nextUrl.searchParams.get("next") ?? "/dashboard";
  // ...
}
```

---

### MEDIUM

---

#### M-01: Missing `noFallthroughCasesInSwitch` Compiler Flag (Checklist #8)

**Severity:** MEDIUM
**File:** `tsconfig.json`

**Evidence:** The flag is not set. While the codebase currently has no `switch` statements, Phase 1A will introduce role-based access control using the `app_role` enum (`owner`, `employee`, `client`). Switch statements over this enum without fallthrough protection will be a likely pattern.

**Recommendation:** Add to `tsconfig.json`:
```json
"noFallthroughCasesInSwitch": true
```

---

#### M-02: Missing `exactOptionalPropertyTypes` Compiler Flag (Checklist #6)

**Severity:** MEDIUM
**File:** `tsconfig.json`

**Evidence:** Without this flag, optional properties (`prop?: string`) allow both `undefined` and being absent, which are semantically different in JavaScript. The codebase currently uses optional properties in Zod schemas (`z.string().optional()`) and inline types. As the type system grows, this distinction matters for database operations where `undefined` might mean "set to null" vs "don't update this field."

**Recommendation:** Add to `tsconfig.json`:
```json
"exactOptionalPropertyTypes": true
```

Note: This may require changes to existing code if any code explicitly assigns `undefined` to optional properties.

---

#### M-03: Empty Catch Block Silently Swallows Errors (Checklist #14 -- catch clause typing)

**Severity:** MEDIUM
**File:** `src/lib/supabase/server.ts:18`

**Evidence:**

```typescript
setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
  try {
    cookiesToSet.forEach(({ name, value, options }) =>
      cookieStore.set(name, value, options),
    );
  } catch {
    // Server Component context is read-only — safe to ignore
  }
},
```

The empty `catch` block has a comment explaining why it is safe to ignore. The comment is correct -- this is the standard Supabase SSR pattern for handling read-only cookie contexts in Server Components. However:

1. The `catch` block catches ALL errors, not just the "read-only context" error. A different error (e.g., malformed cookie data, cookie size limit exceeded) would be silently swallowed.
2. The catch variable is not typed or used.

**Recommendation:** While this is the documented Supabase pattern, consider at minimum logging unexpected errors in non-production environments:

```typescript
} catch (error) {
  // Server Component context is read-only -- cookie writes fail silently.
  // Log unexpected errors in development.
  if (process.env.NODE_ENV === "development") {
    const msg = error instanceof Error ? error.message : String(error);
    if (!msg.includes("cookies")) {
      console.warn("Unexpected cookie error:", msg);
    }
  }
}
```

---

#### M-04: Environment Variable Validation Bypass Flag (Checklist #81)

**Severity:** MEDIUM
**File:** `src/env.ts:43`

**Evidence:**

```typescript
skipValidation: !!process.env.SKIP_ENV_VALIDATION,
```

The `SKIP_ENV_VALIDATION` flag allows bypassing all Zod validation of environment variables. If this flag is set (intentionally or accidentally), the entire env validation layer is disabled, and `env.NEXT_PUBLIC_SUPABASE_URL` could be `undefined` at runtime even though the Zod schema requires it.

**Impact:** The T3 env pattern is well-established and this flag is standard for build-time CI scenarios. But there is no type narrowing or runtime guard downstream to handle the case where validation was skipped. Code consuming `env.*` values assumes they are validated.

**Recommendation:** Document when `SKIP_ENV_VALIDATION` should be set (CI/build only). Consider adding a runtime assertion in the Supabase client factories that validates the URL format, providing a defense-in-depth layer.

---

#### M-05: Server-Side Environment Variable Schemas Are All Optional (Checklist #81)

**Severity:** MEDIUM
**File:** `src/env.ts:9-27`

**Evidence:**

Every server-side environment variable is marked `.optional()`:

```typescript
server: {
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  SUPABASE_SECRET_KEY: z.string().min(1).optional(),
  DATABASE_URL: z.string().startsWith("postgres").optional(),
  DIRECT_DATABASE_URL: z.string().startsWith("postgres").optional(),
  SUPABASE_DB_PASSWORD: z.string().min(1).optional(),
  SUPABASE_PROJECT_ID: z.string().min(1).optional(),
  SUPABASE_JWT_SECRET: z.string().min(32).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  CRON_SECRET: z.string().min(16).optional(),
},
```

This means `env.SUPABASE_SERVICE_ROLE_KEY` has type `string | undefined`. The `createAdminClient()` function in `src/lib/supabase/admin.ts` correctly handles this with a runtime null check:

```typescript
const serviceKey = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey) {
  throw new Error("Missing SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY");
}
```

This is acceptable at Phase 0 since not all environments need all variables. But as the codebase grows, server-side code that forgets the null check will get a type-correct `string | undefined` and may pass `undefined` to APIs expecting `string`.

**Recommendation:** Consider using Zod `.refine()` or `.superRefine()` to express "at least one of these must be set" constraints at the schema level rather than in each consumer.

---

#### M-06: Vitest Configuration Missing Type-Aware Settings (Checklist #109 context)

**Severity:** MEDIUM
**File:** `vitest.config.ts`

**Evidence:**

```typescript
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
  },
});
```

The vitest config is missing:
1. **Coverage configuration** -- no `coverage` block with thresholds
2. **TypeScript project reference** -- no `typecheck` block for type-aware test checking
3. **Workspace projects** -- the `package.json` references `--project smoke`, `--project security`, `--project db`, `--project actions` but these are not defined as workspace projects in `vitest.config.ts`

**Impact:** Without coverage thresholds, there is no automated enforcement of test coverage. The `--project` flags in package.json scripts will fail or be ignored without matching workspace configuration.

**Recommendation:** Add coverage and typecheck configuration:

```typescript
test: {
  // ... existing config
  coverage: {
    provider: "v8",
    all: true,
    thresholds: { statements: 80, branches: 75, functions: 85, lines: 80 },
  },
  typecheck: { enabled: true },
},
```

---

### LOW

---

#### L-01: Default Exports Used for Page Components (Checklist -- code-style.md)

**Severity:** LOW
**Files:** All page components and layouts

**Evidence:** The project's `code-style.md` rule states "Named exports only -- no default exports (except where framework requires them)." Next.js App Router requires default exports for `page.tsx`, `layout.tsx`, and `route.ts` handlers. All current default exports are framework-required.

**Status:** Compliant -- no action needed. Documented for completeness.

---

#### L-02: No Exhaustiveness Utilities Defined (Checklist #26)

**Severity:** LOW (currently no union types to exhaust; will become HIGH in Phase 1A)
**Files:** No file contains `assertNever`, `exhaustiveCheck`, or similar patterns.

**Evidence:** The database schema defines an `app_role` enum with values `owner`, `employee`, `client`. When this enum is represented in TypeScript (via generated types from C-01), any `switch` or `if` chain over role values should include an exhaustiveness check to catch unhandled cases at compile time.

**Recommendation:** Create a utility:

```typescript
// src/lib/utils/assert-never.ts
export function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unexpected value: ${JSON.stringify(value)}`);
}
```

---

#### L-03: `CookieOptions` Import Pattern (Checklist #73)

**Severity:** LOW
**Files:** `src/lib/supabase/server.ts:1`, `src/lib/supabase/middleware.ts:1`

**Evidence:**

```typescript
import { createServerClient, type CookieOptions } from "@supabase/ssr";
```

The inline `type` modifier is correctly used for `CookieOptions`. This is good practice and correctly separates type-only imports.

**Status:** Compliant -- no action needed.

---

## Compiler Configuration Audit

### tsconfig.json Assessment

| Flag | Status | Severity |
|------|--------|----------|
| `strict` | `true` | PASS |
| `strictNullChecks` | Inherited from `strict` | PASS |
| `noImplicitAny` | Inherited from `strict` | PASS |
| `strictFunctionTypes` | Inherited from `strict` | PASS |
| `strictBindCallApply` | Inherited from `strict` | PASS |
| `strictPropertyInitialization` | Inherited from `strict` | PASS |
| `noImplicitThis` | Inherited from `strict` | PASS |
| `alwaysStrict` | Inherited from `strict` | PASS |
| `useUnknownInCatchVariables` | Inherited from `strict` | PASS |
| `noImplicitReturns` | **NOT SET** | HIGH (H-02) |
| `noUncheckedIndexedAccess` | **NOT SET** | HIGH (H-01) |
| `exactOptionalPropertyTypes` | **NOT SET** | MEDIUM (M-02) |
| `noFallthroughCasesInSwitch` | **NOT SET** | MEDIUM (M-01) |
| `noPropertyAccessFromIndexSignature` | Not set | LOW |
| Strict overrides to `false` | None found | PASS |
| `isolatedModules` | `true` | PASS |
| `skipLibCheck` | `true` | PASS (standard for Next.js) |

### Strict Override Check

No strict-family flags are overridden to `false` after `strict: true`. This is clean.

---

## Pattern Scan Results

### `any` Usage

| Pattern | Count | Location |
|---------|-------|----------|
| Explicit `: any` | 0 | -- |
| `as any` | 0 | -- |
| `as unknown as T` | 0 | -- |
| `useState<any>` / `useRef<any>` | 0 | -- |
| `Promise<any>` | 0 | -- |
| `Record<string, any>` | 0 | -- |
| `Array<any>` | 0 | -- |
| `@ts-ignore` | 0 | -- |
| `@ts-expect-error` | 0 | -- |
| Implicit `any` (tsc report) | 0 | -- |

Zero `any` in production code. Zero `any` in test code. This is excellent.

### Assertions

| Pattern | Count | Location |
|---------|-------|----------|
| `as Type` assertions | 0 | -- |
| Non-null `!` assertions | 3 | `tests/smoke/supabase.test.ts:4-6` |
| Double assertions | 0 | -- |

The three non-null assertions are all in test code (see H-03).

### Runtime Validation

| Boundary | Validation | Status |
|----------|-----------|--------|
| Environment variables | Zod via T3 env | PASS |
| API route inputs | N/A (no API routes accepting body input) | N/A |
| Form data | HTML `required` + `type="email"` + Supabase-side | PARTIAL |
| `JSON.parse` | Not used | N/A |
| External API responses | Not used | N/A |
| Supabase query results | No typed client, no validation | FAIL (C-01/C-02) |

### Server/Client Boundary

| File | Directive | Hooks Used | Status |
|------|-----------|-----------|--------|
| `src/lib/supabase/client.ts` | `"use client"` | None (factory) | PASS |
| `src/components/nav/sidebar.tsx` | `"use client"` | `useState`, `usePathname` | PASS |
| `src/components/nav/user-menu.tsx` | `"use client"` | `useRouter` | PASS |
| `src/app/(auth)/sign-in/page.tsx` | `"use client"` | `useState`, `useRouter` | PASS |
| `src/app/(auth)/sign-up/page.tsx` | `"use client"` | `useState`, `useRouter` | PASS |
| `src/app/layout.tsx` | None (server) | None | PASS |
| `src/app/page.tsx` | None (server) | None | PASS |
| `src/app/(protected)/layout.tsx` | None (server) | None | PASS |
| `src/app/(protected)/dashboard/page.tsx` | None (server) | None | PASS |
| `src/app/(protected)/projects/page.tsx` | None (server) | None | PASS |
| `src/app/(protected)/settings/page.tsx` | None (server) | None | PASS |

All server/client boundaries are correct. No hooks in server components. No server-only imports in client components.

---

## Supabase Type Safety Deep-Dive

This is the most significant type safety gap in the codebase. Here is the full chain of impact:

1. **No generated types file** (`src/lib/types/supabase.ts` does not exist)
2. **All four client factories are untyped** (no `<Database>` generic)
3. **Future data access will be untyped** -- `.from("user_roles").select("*")` returns a broadly-typed result instead of `{ id: string; user_id: string; role: "owner" | "employee" | "client"; created_at: string; updated_at: string }`
4. **No compile-time table name validation** -- `.from("user_roless")` (typo) would not be caught
5. **No compile-time column validation** -- `.select("nonexistent_column")` would not be caught
6. **No insert/update type validation** -- inserting `{ role: "invalid" }` would not be caught

The fix is straightforward:
1. Run `npm run db:types`
2. Add `import type { Database } from "@/lib/types/supabase"` to each client factory
3. Add `<Database>` generic to each `createClient`/`createServerClient`/`createBrowserClient` call

This should be done before any Phase 1A data access code is written.

---

## Auth Form Type Safety Assessment

The sign-in and sign-up forms rely on:
1. HTML `required` attribute for presence validation
2. HTML `type="email"` for email format validation
3. HTML `minLength={6}` for password length (sign-up only, not sign-in)
4. Supabase Auth SDK for server-side validation

There is no client-side Zod validation of form data before submission. While Supabase will reject invalid inputs server-side, adding Zod schemas would:
- Provide immediate user feedback before network round-trips
- Establish a pattern for future forms that will need complex validation (estimates, project data)
- Create a typed boundary between user input and the Supabase SDK

This is acceptable at Phase 0 but should be addressed before Phase 1A introduces data-entry forms.

---

## Summary Table

| ID | Severity | Checklist | Finding | File(s) |
|----|----------|-----------|---------|---------|
| C-01 | CRITICAL | #61 | No Supabase generated types file | `src/lib/types/` (empty) |
| C-02 | CRITICAL | #63 | All Supabase clients untyped (no `<Database>` generic) | `src/lib/supabase/*.ts` |
| H-01 | HIGH | #5 | Missing `noUncheckedIndexedAccess` flag | `tsconfig.json` |
| H-02 | HIGH | #4 | Missing `noImplicitReturns` flag | `tsconfig.json` |
| H-03 | HIGH | #16 | Non-null assertions in test files | `tests/smoke/supabase.test.ts:4-6` |
| H-04 | HIGH | #43 | Missing return type annotations on all exported functions | All source files |
| H-05 | HIGH | #56 | Auth callback uses `Request` instead of `NextRequest` | `src/app/auth/callback/route.ts:4` |
| M-01 | MEDIUM | #8 | Missing `noFallthroughCasesInSwitch` flag | `tsconfig.json` |
| M-02 | MEDIUM | #6 | Missing `exactOptionalPropertyTypes` flag | `tsconfig.json` |
| M-03 | MEDIUM | #14 | Empty catch swallows all errors | `src/lib/supabase/server.ts:18` |
| M-04 | MEDIUM | #81 | Env validation bypass flag without guardrails | `src/env.ts:43` |
| M-05 | MEDIUM | #81 | All server env vars optional (weak type narrowing) | `src/env.ts:9-27` |
| M-06 | MEDIUM | #109 | Vitest config missing coverage/typecheck | `vitest.config.ts` |
| L-01 | LOW | -- | Default exports (framework-required, compliant) | Pages/layouts |
| L-02 | LOW | #26 | No exhaustiveness utilities | -- |
| L-03 | LOW | #73 | CookieOptions uses correct `type` import | Compliant |

**Totals:** 2 CRITICAL, 5 HIGH, 6 MEDIUM, 3 LOW

---

## Positive Observations

Despite the findings above, the codebase demonstrates strong type safety fundamentals:

1. **Zero `any` in the entire codebase** -- not a single explicit or implicit `any` in any source or test file
2. **Zero type assertions** -- no `as Type`, no `as any`, no `as unknown as T`
3. **Zero `@ts-ignore` or `@ts-expect-error`** -- no type checking suppressions
4. **Clean `strict: true`** with no overrides to `false`
5. **Correct server/client boundaries** -- all hooks are in client components, no server imports in client code
6. **Proper use of `type` imports** -- `import type { Metadata }`, `type CookieOptions`
7. **Zod validation at env boundary** -- environment variables are validated at startup
8. **`server-only` import on admin client** -- prevents accidental client-side usage of service role key
9. **`getUser()` over `getSession()`** -- middleware correctly uses the secure auth check pattern

The two CRITICAL findings (missing generated types + untyped clients) are structural gaps that should be fixed before Phase 1A begins, but they reflect the "not yet needed" phase rather than poor practices.
