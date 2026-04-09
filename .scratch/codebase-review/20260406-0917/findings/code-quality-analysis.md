# A4 -- Code Quality Analysis

**Reviewer:** A4 (Code Quality Reviewer)  
**Date:** 2026-04-06  
**Codebase:** ShossyWorks -- Construction estimating platform  
**Scope:** Naming conventions, dead code, code duplication, function complexity, file organization, import hygiene, debug artifacts, TODO hygiene, design system compliance  
**Files Reviewed:** 18 source files (13 TS, 10 TSX, 1 CSS, 1 SQL), 3 test files, 3 config files  

---

## Executive Summary

The codebase is small (~721 LOC) and early-stage (Phase 0 complete). Code quality is generally decent for scaffolding, but several systemic issues warrant attention before Phase 1A development begins. The most significant problems are: (1) heavy copy-paste duplication between auth forms, (2) variable shadowing creating ambiguity in error handling, (3) untyped Supabase clients bypassing the generated-types pipeline, (4) inconsistent export styles violating project code-style rules, (5) inline `style={}` attributes violating the design system's "zero hardcoded styles" rule, and (6) missing `noImplicitReturns` and `noUncheckedIndexedAccess` compiler flags that will compound as the codebase grows.

**Finding counts by severity:**
- CRITICAL: 0
- HIGH: 5
- MEDIUM: 8
- LOW: 3

---

## HIGH Findings

### H1. Systemic Copy-Paste Duplication Between Auth Forms (Checklist #83)

**Severity:** HIGH  
**Files:**  
- `src/app/(auth)/sign-in/page.tsx` (lines 1-102)  
- `src/app/(auth)/sign-up/page.tsx` (lines 1-107)  

**Evidence:**

The sign-in and sign-up pages are near-identical clones. The following elements are duplicated verbatim:

1. **State declarations** (identical in both files):
   - `useState("")` for email (sign-in L9, sign-up L9)
   - `useState("")` for password (sign-in L10, sign-up L10)
   - `useState<string | null>(null)` for error (sign-in L11, sign-up L11)
   - `useState(false)` for loading (sign-in L12, sign-up L12)
   - `useRouter()` call (sign-in L13, sign-up L13)

2. **Form submission pattern** (identical structure, only the Supabase auth method differs):
   - `setLoading(true)` + `setError(null)` (sign-in L17-18, sign-up L17-18)
   - Error handling block (sign-in L23-26, sign-up L27-30)
   - `router.push("/dashboard")` + `router.refresh()` (sign-in L29-30, sign-up L33-34)

3. **Entire JSX layout** -- outer wrapper, card container, error display, email input, password input, submit button, and footer link all share identical class strings. The button class string alone is 194 characters repeated verbatim:
   ```
   w-full rounded-full bg-[var(--color-interactive)] px-[var(--space-4)] py-[var(--space-2)] ...
   ```

4. **Identical input field markup** -- the email and password input blocks (label + input + classes) are copy-pasted between pages AND within each page (email field and password field share the same input classes).

**Impact:** Any future change to auth form styling, error handling, or validation requires synchronized edits in both files. As more auth flows are added (password reset, email verification), this pattern will multiply. At ~721 LOC total, auth forms alone consume ~30% of the codebase as duplicated code.

**Recommendation:** Extract shared components:
- `AuthFormLayout` -- wrapper, card, heading, footer link
- `AuthInput` -- label + input with consistent styling
- `AuthSubmitButton` -- pill button with loading state
- Shared `useAuthForm` hook for email/password/error/loading state management

---

### H2. Variable Shadowing -- `error` State vs Destructured `error` (Checklist #87, #88)

**Severity:** HIGH  
**Files:**  
- `src/app/(auth)/sign-in/page.tsx` (lines 11, 21)  
- `src/app/(auth)/sign-up/page.tsx` (lines 11, 21)  

**Evidence:**

Both auth pages declare `error` as React state and then shadow it with a destructured variable inside `handleSubmit`:

```typescript
// Line 11: state declaration
const [error, setError] = useState<string | null>(null);

// Line 21 (inside handleSubmit): shadowing with destructured response
const { error } = await supabase.auth.signInWithPassword({ email, password });
```

Inside `handleSubmit`, `error` refers to the Supabase `AuthError | null` object, not the `string | null` state. The code then calls `setError(error.message)` which works -- but the naming collision creates a maintenance trap. A developer modifying the error handling who doesn't notice the shadowing could easily reference the wrong `error` variable, especially as the function grows.

**Impact:** Misleading naming creates cognitive overhead and a latent bug vector. The Supabase `error` is an `AuthError` object with properties like `.message`, `.status`, `.name`, while the state `error` is `string | null`. Confusing them would produce runtime type errors or incorrect UI behavior.

**Recommendation:** Rename the destructured variable to `authError`:
```typescript
const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
if (authError) {
  setError(authError.message);
  ...
}
```

---

### H3. Untyped Supabase Clients -- Missing `Database` Generic Parameter (Checklist #63)

**Severity:** HIGH  
**Files:**  
- `src/lib/supabase/client.ts` (line 7)  
- `src/lib/supabase/server.ts` (line 8)  
- `src/lib/supabase/admin.ts` (line 12)  
- `src/lib/supabase/middleware.ts` (line 8)  

**Evidence:**

All four Supabase client factories create untyped clients:

```typescript
// client.ts L7 -- no generic
createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

// server.ts L8 -- no generic
createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, ...);

// admin.ts L12 -- no generic
createClient(env.NEXT_PUBLIC_SUPABASE_URL, serviceKey, ...);

// middleware.ts L8 -- no generic
createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, ...);
```

Additionally, the Supabase generated types file (`src/lib/types/supabase.ts`) does not exist. The `package.json` has a `db:types` script that would generate it to `src/lib/types/supabase.ts`, but it has never been run -- the `src/lib/types/` directory does not exist.

**Impact:** Without typed clients, every `.from("table_name")` call returns untyped results. As Phase 1A adds database tables, all queries will return `any`-typed data, defeating TypeScript's type safety at the database boundary -- the most critical boundary in a data-driven application. This is the single most impactful type-safety gap to close before Phase 1A.

**Recommendation:**
1. Run `npm run db:types` to generate `src/lib/types/supabase.ts`
2. Add `Database` generic to all clients:
   ```typescript
   import type { Database } from "@/lib/types/supabase";
   createBrowserClient<Database>(...);
   createServerClient<Database>(...);
   createClient<Database>(...);
   ```
3. Add a CI step or pre-push hook to verify types are not stale

---

### H4. Missing `noImplicitReturns` and `noUncheckedIndexedAccess` in tsconfig.json (Checklist #4, #5)

**Severity:** HIGH  
**File:** `tsconfig.json`

**Evidence:**

The `tsconfig.json` has `strict: true` (good) but is missing two important strict-adjacent flags that are NOT included in `strict`:

```json
{
  "compilerOptions": {
    "strict": true,
    // MISSING: "noImplicitReturns": true
    // MISSING: "noUncheckedIndexedAccess": true
  }
}
```

- `noImplicitReturns` -- Without this, functions can silently return `undefined` from some code paths. As the codebase grows with mutation handlers and data transformers, this will allow implicit `undefined` returns to slip through undetected.

- `noUncheckedIndexedAccess` -- Without this, array indexing (`arr[0]`) and object indexing (`obj[key]`) assume the result is defined, when it may be `undefined`. This is especially dangerous in a construction estimating platform that will handle arrays of line items, cost breakdowns, and index-based lookups.

**Impact:** These flags compound in severity as the codebase grows. Setting them now (while the codebase is small) is trivial. Setting them after Phase 1A adds hundreds of array/object access patterns will require bulk annotation fixes.

**Recommendation:** Add both flags to `tsconfig.json`:
```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitReturns": true,
    "noUncheckedIndexedAccess": true
  }
}
```

---

### H5. Non-Null Assertions in Test Files -- Bypassing Type Safety (Checklist #87, #96)

**Severity:** HIGH  
**File:** `tests/smoke/supabase.test.ts` (lines 4-6)

**Evidence:**

The smoke test file uses three non-null assertions (`!`) to extract environment variables:

```typescript
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
```

These assertions suppress TypeScript's `string | undefined` type for `process.env` accesses. If any variable is missing, the tests will fail with cryptic runtime errors ("invalid URL", "missing header") instead of a clear "missing env var" message.

The project already has a validated env system (`src/env.ts` via `@t3-oss/env-nextjs`), but tests bypass it entirely and use raw `process.env` with `!` assertions.

**Impact:** Tests become flaky and confusing when run in environments without `.env.local`. The non-null assertions hide the root cause. Additionally, `SERVICE_ROLE_KEY` uses a different env var name than what's validated in `src/env.ts` (where it's `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY`), creating a naming inconsistency.

**Recommendation:** Add runtime guards at the top of the test file:
```typescript
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}
const SUPABASE_URL = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
```

---

## MEDIUM Findings

### M1. Inline `style={}` Attributes Violate Design System (DESIGN-SYSTEM.md Forbidden Pattern #5)

**Severity:** MEDIUM  
**Files:**  
- `src/components/nav/sidebar.tsx` (lines 20-23, 27)  
- `src/app/(protected)/layout.tsx` (line 22)  

**Evidence:**

Three inline `style={}` attributes are used for layout dimensions:

```tsx
// sidebar.tsx L20-23
style={{
  width: collapsed ? "var(--sidebar-collapsed)" : "var(--sidebar-width)",
  transition: `width var(--transition-normal)`,
}}

// sidebar.tsx L27
style={{ height: "var(--header-height)" }}

// layout.tsx L22
style={{ height: "var(--header-height)" }}
```

DESIGN-SYSTEM.md "Forbidden Patterns" item #5 states: "Inline `style=` attributes for visual properties" are explicitly banned. While the values themselves reference design tokens (good), the delivery mechanism (inline style) violates the rule.

**Impact:** Inline styles are harder to override, don't participate in Tailwind's responsive/state variant system, and create a precedent that could spread as more components are built. The sidebar width case is the hardest to solve purely with Tailwind (dynamic value based on state), but the `height: "var(--header-height)"` uses could be replaced with Tailwind arbitrary values.

**Recommendation:**
- Replace `style={{ height: "var(--header-height)" }}` with `h-[var(--header-height)]` in sidebar.tsx and layout.tsx
- For the dynamic sidebar width, either accept the inline style as a documented exception or use CSS classes with a data attribute: `data-collapsed={collapsed}` + CSS rules in globals.css

---

### M2. Default Exports on Non-Page Files Violate Code Style Rule (Checklist #87, #97)

**Severity:** MEDIUM  
**Files:**  
- All 8 page/layout files use `export default function` (Next.js requirement -- acceptable)  
- `eslint.config.mjs` (line 17) uses `export default` (ESLint requirement -- acceptable)  
- `vitest.config.ts` (line 4) uses `export default` (Vitest requirement -- acceptable)  

**Evidence:**

The project's `code-style.md` rule states: "Named exports only -- no default exports (except where framework requires them)."

Currently, all default exports are in framework-required locations (Next.js pages, ESLint config, Vitest config). This is compliant. However, the rule is not enforced by ESLint. As the codebase grows and developers add utility modules, the lack of lint enforcement will allow default exports to creep in.

The existing non-page components (`Sidebar`, `UserMenu`) correctly use named exports. This inconsistency (named for components, default for pages) is technically correct per the rule's exception clause, but should be explicitly documented to avoid confusion.

**Recommendation:** Add `"import/no-default-export": "error"` to ESLint config with overrides for `page.tsx`, `layout.tsx`, `route.ts`, `*.config.*` patterns.

---

### M3. Identifier Naming Inconsistency -- `createClient` Used for Three Different Functions (Checklist #87)

**Severity:** MEDIUM  
**Files:**  
- `src/lib/supabase/client.ts` exports `createClient` (browser client)  
- `src/lib/supabase/server.ts` exports `createClient` (server client)  
- `src/lib/supabase/admin.ts` exports `createAdminClient` (admin client)  

**Evidence:**

Two of the three Supabase client factories share the name `createClient` despite returning fundamentally different client types with different capabilities:

| Export | File | Context | Capabilities |
|--------|------|---------|-------------|
| `createClient` | `client.ts` | Browser (client-side) | Anon key, RLS enforced |
| `createClient` | `server.ts` | Server (cookies) | Anon key, RLS enforced, cookie-based auth |
| `createAdminClient` | `admin.ts` | Server (no RLS) | Service role key, bypasses RLS |

The admin client correctly uses a distinct name. The browser and server clients do not. Import disambiguation relies on the import path alone:
```typescript
import { createClient } from "@/lib/supabase/client";  // browser
import { createClient } from "@/lib/supabase/server";  // server
```

**Impact:** If a developer imports from the wrong path, the code compiles without error but creates the wrong client type. This is especially dangerous because a server component accidentally importing the browser client would work in development but fail in production. The identical names prevent any static analysis from catching the mistake.

**Recommendation:** Rename to `createBrowserClient` and `createServerClient`:
```typescript
// client.ts
export function createBrowserClient() { ... }
// server.ts
export function createServerClient() { ... }
```

---

### M4. No Coverage Configuration in Vitest (Checklist #98)

**Severity:** MEDIUM  
**File:** `vitest.config.ts`

**Evidence:**

The Vitest configuration has no coverage settings:

```typescript
test: {
  globals: true,
  environment: "node",
  include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  setupFiles: ["./tests/setup.ts"],
  // MISSING: coverage configuration
}
```

No `@vitest/coverage-v8` or `@vitest/coverage-istanbul` package is installed. No coverage thresholds are defined. No `coverage.all: true` to report uncovered files.

**Impact:** There is no objective measure of what code is tested. With only 2 test files and 8 tests covering smoke and security (no unit tests on application logic), the actual statement/branch coverage is likely below 20%. Without thresholds, coverage can only decrease as the codebase grows.

**Recommendation:**
1. Install `@vitest/coverage-v8`
2. Add coverage config:
   ```typescript
   test: {
     coverage: {
       provider: "v8",
       all: true,
       include: ["src/**/*.{ts,tsx}"],
       thresholds: { statements: 80, branches: 75, functions: 85, lines: 80 },
     },
   }
   ```

---

### M5. `disabled:opacity-50` Uses Tailwind Arbitrary Value Not Backed by Token (Checklist #90, DESIGN-SYSTEM.md)

**Severity:** MEDIUM  
**Files:**  
- `src/app/(auth)/sign-in/page.tsx` (line 84)  
- `src/app/(auth)/sign-up/page.tsx` (line 89)  

**Evidence:**

The submit buttons use `disabled:opacity-50` which is a Tailwind default utility, not a design-token-backed value:

```tsx
className="... disabled:opacity-50"
```

The DESIGN-SYSTEM.md defines no opacity tokens. The `0.5` value is a magic number that controls visual behavior. If the design system later decides disabled states should use `0.4` or `0.6` opacity, both files need manual updates.

**Impact:** Minor for now (2 instances), but as more interactive components are added, the lack of a disabled-state token will lead to inconsistent opacity values across the application.

**Recommendation:** Add `--opacity-disabled: 0.5;` to the design tokens in `globals.css`, then use `disabled:opacity-[var(--opacity-disabled)]` in components.

---

### M6. Auth Callback Route Missing Error Logging (Checklist #95)

**Severity:** MEDIUM  
**File:** `src/app/auth/callback/route.ts` (lines 9-18)

**Evidence:**

The auth callback route silently discards authentication errors:

```typescript
if (code) {
  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (!error) {
    return NextResponse.redirect(`${origin}${next}`);
  }
  // error is silently dropped here -- no logging
}

// Redirects to sign-in with generic error param
return NextResponse.redirect(`${origin}/sign-in?error=auth_callback_error`);
```

When `exchangeCodeForSession` fails, the error object (which contains the reason: expired code, invalid code, rate limit, etc.) is never logged or recorded. The user sees only a generic `auth_callback_error` query param.

**Impact:** Authentication failures in production will be invisible to operators. Debugging user-reported "I can't sign in" issues will require guesswork without server-side logs showing the actual Supabase error.

**Recommendation:** Add server-side error logging before the redirect:
```typescript
if (error) {
  console.error("[auth/callback] exchangeCodeForSession failed:", error.message);
  return NextResponse.redirect(`${origin}/sign-in?error=auth_callback_error`);
}
```

---

### M7. Auth Callback `next` Parameter Open Redirect Risk (Checklist #88, #90)

**Severity:** MEDIUM  
**File:** `src/app/auth/callback/route.ts` (lines 6-7, 14)

**Evidence:**

The `next` query parameter is used directly in a redirect without validation:

```typescript
const next = searchParams.get("next") ?? "/dashboard";
// ...
return NextResponse.redirect(`${origin}${next}`);
```

While `${origin}${next}` constructs a same-origin URL (preventing redirects to external domains), the `next` parameter is still unvalidated user input that could redirect to unintended internal routes. A crafted URL like `?next=/sign-out` or `?next=/../admin` could cause unexpected behavior.

Additionally, the string `"/dashboard"` is a magic string repeated across multiple files:
- `src/app/auth/callback/route.ts` line 7 (default redirect)
- `src/lib/supabase/middleware.ts` line 43 (authenticated public-route redirect)
- `src/app/(auth)/sign-in/page.tsx` line 29 (post-sign-in redirect)
- `src/app/(auth)/sign-up/page.tsx` line 33 (post-sign-up redirect)
- `src/app/page.tsx` line 4 (root redirect)

**Impact:** The magic string `/dashboard` appears 5 times. Changing the post-auth landing page requires finding and updating all 5 locations. Missing one creates inconsistent redirect behavior.

**Recommendation:**
1. Define a constant: `export const POST_AUTH_REDIRECT = "/dashboard";` in a shared routes file
2. Add allowlist validation for the `next` parameter:
   ```typescript
   const ALLOWED_REDIRECTS = ["/dashboard", "/projects", "/settings"];
   const next = searchParams.get("next") ?? POST_AUTH_REDIRECT;
   const safePath = ALLOWED_REDIRECTS.includes(next) ? next : POST_AUTH_REDIRECT;
   ```

---

### M8. Vitest Config Missing Project Workspaces (Checklist #97)

**Severity:** MEDIUM  
**File:** `vitest.config.ts`

**Evidence:**

The `package.json` defines four test scripts that reference Vitest projects:

```json
"test:smoke": "vitest run --project smoke",
"test:security": "vitest run --project security",
"test:db": "vitest run --project db",
"test:actions": "vitest run --project actions",
```

But `vitest.config.ts` does not define any project workspaces:

```typescript
test: {
  globals: true,
  environment: "node",
  include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  setupFiles: ["./tests/setup.ts"],
  // MISSING: projects / workspace configuration
}
```

Running `vitest run --project smoke` would either fail or not filter tests as expected, depending on the Vitest version.

**Impact:** The per-category test scripts (`test:smoke`, `test:security`, `test:db`, `test:actions`) may not work correctly. Developers relying on them to run subsets of tests would get unexpected behavior.

**Recommendation:** Either add project/workspace configuration to `vitest.config.ts` or remove the `--project` flags from the scripts and use file-pattern-based filtering instead.

---

## LOW Findings

### L1. No `@theme` Block in globals.css for Tailwind Integration

**Severity:** LOW  
**File:** `src/app/globals.css`

**Evidence:**

DESIGN-SYSTEM.md documents a `@theme` block that maps CSS custom properties to Tailwind utilities:

```css
@theme {
  --color-bg-primary: var(--color-bg-primary);
  --color-surface: var(--color-surface);
  /* ... mapped to Tailwind utilities */
}
```

The actual `globals.css` only has `@import "tailwindcss";` and the `:root` custom properties block. No `@theme` block exists. Components currently use `bg-[var(--color-bg-primary)]` arbitrary value syntax, which works but is verbose and doesn't provide autocomplete in editors.

**Impact:** Minor ergonomic issue. Arbitrary value syntax is functional but harder to type and lacks IDE support compared to theme-mapped utilities.

---

### L2. No ESLint TypeScript-Specific Rules Configured

**Severity:** LOW  
**File:** `eslint.config.mjs`

**Evidence:**

The ESLint config uses `eslint-config-next/typescript` but does not add any `@typescript-eslint` rules beyond the defaults. The `code-style.md` rules around naming conventions, no-`any`, and export styles are not enforced by linting.

**Impact:** Style rules are documentation-only, not enforced. As more developers (or AI agents) contribute, drift from the documented conventions is likely.

---

### L3. `min-h-full` on `<body>` Plus `min-h-screen` on Auth Pages is Redundant

**Severity:** LOW  
**Files:**  
- `src/app/layout.tsx` (line 15): `<body className="... min-h-full ...">`
- `src/app/(auth)/sign-in/page.tsx` (line 34): `min-h-screen`
- `src/app/(auth)/sign-up/page.tsx` (line 38): `min-h-screen`

**Evidence:**

The root layout applies `min-h-full` to `<body>`, while auth pages apply `min-h-screen` to their wrapper `<div>`. Both achieve minimum-height filling but through different mechanisms. This is not a bug, but it creates inconsistency -- the `h-full` on `<html>` makes `min-h-full` on `<body>` equivalent to `min-h-screen` on `<body>`, and then `min-h-screen` on the child div is also redundant.

---

## Cross-Cutting Observations

### Design System Compliance

The codebase is **largely compliant** with DESIGN-SYSTEM.md. Specific compliance results:

| Rule | Status | Notes |
|------|--------|-------|
| No hardcoded hex colors in components | PASS | All colors use `var()` tokens |
| No `rounded-sm/md/lg/xl` | PASS | Only `rounded-full` used (pills) |
| No direct Tailwind color classes | PASS | All colors via `var()` arbitrary values |
| No inline `style=` for visual properties | FAIL | 3 instances (sidebar, header) -- see M1 |
| No hardcoded px spacing | PASS | All spacing uses `var()` tokens |
| No magic `shadow-md/lg` | PASS | No shadow utilities used in components |

### Naming Convention Compliance

| Convention | Status | Notes |
|-----------|--------|-------|
| Files: kebab-case | PASS | `user-menu.tsx`, `sign-in/page.tsx` |
| Components: PascalCase | PASS | `Sidebar`, `UserMenu`, `SignInPage` |
| Functions: camelCase | PASS | `handleSubmit`, `createClient`, `updateSession` |
| Constants: UPPER_SNAKE | N/A | No application constants defined yet |

### Items Not Found (Clean)

- No `console.log` or debug statements in source code
- No `debugger` statements
- No `TODO/FIXME/HACK` comments
- No `eslint-disable` comments
- No `any` types in source code
- No double assertions (`as unknown as T`)
- No barrel exports
- No commented-out code blocks
- No circular dependencies (verified by inspection of import graph)
- No files exceeding 300 lines
- No functions exceeding 50 lines
- No components with more than 4 `useState` calls

---

## Recommendations Priority Matrix

| Priority | Finding | Effort | Impact |
|----------|---------|--------|--------|
| 1 | H3: Generate Supabase types + type clients | Low | Prevents systemic `any` propagation in Phase 1A |
| 2 | H4: Add `noImplicitReturns` + `noUncheckedIndexedAccess` | Low | Trivial now, expensive to add later |
| 3 | H1: Extract shared auth form components | Medium | Reduces ~200 lines of duplication, establishes component patterns |
| 4 | H2: Fix variable shadowing in auth forms | Low | 2-line rename in 2 files |
| 5 | H5: Replace non-null assertions in tests | Low | Better error messages, no runtime risk |
| 6 | M7: Extract `/dashboard` constant + validate `next` param | Low | Prevents future inconsistency and redirect edge cases |
| 7 | M1: Replace inline styles with Tailwind arbitrary values | Low | Design system compliance |
| 8 | M3: Rename `createClient` to distinct names | Low | Prevents wrong-client imports |
| 9 | M4: Add Vitest coverage config | Low | Establishes baseline before Phase 1A |
| 10 | M6: Add error logging in auth callback | Low | Essential for production debugging |
| 11 | M8: Fix or remove Vitest project config | Low | Test scripts should work as documented |

---

## Methodology

1. Read all 18 source files, 3 test files, and 4 config files in full
2. Checked DESIGN-SYSTEM.md forbidden patterns against all component files via targeted grep
3. Searched for `any`, `as unknown as`, `as any as`, double assertions, non-null assertions
4. Searched for `console.log`, `debugger`, `TODO`, `FIXME`, `HACK`, `eslint-disable`
5. Verified naming conventions (files, exports, functions, variables) against code-style.md
6. Verified export style consistency (default vs named) across all files
7. Compared sign-in and sign-up pages line-by-line for duplication
8. Checked Supabase client typing against generated types pipeline
9. Verified tsconfig.json flags against checklist items #1-9
10. Checked vitest.config.ts against package.json test scripts
11. Verified inline styles against DESIGN-SYSTEM.md forbidden patterns
