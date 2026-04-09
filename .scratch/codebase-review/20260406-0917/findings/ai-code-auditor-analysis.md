# A13 -- AI Code Auditor Analysis

**Reviewer:** AI Code Auditor (A13)
**Date:** 2026-04-06
**Scope:** All application source code (~721 LOC), configuration files, SQL migrations, test files
**Focus:** AI-generated code failure patterns, hallucinated APIs, "looks right but isn't" bugs, pattern inconsistencies

---

## Executive Summary

This codebase was built entirely by Claude Code during a Phase 0 scaffolding session. The code is structurally competent -- Supabase client patterns use the correct modern `getAll`/`setAll` cookie interface, auth correctly uses `getUser()` over `getSession()`, and the admin client is properly guarded by `server-only`. However, I found several classic AI code generation failures: a **critical open redirect vulnerability**, a **CSS-in-Tailwind bug that silently produces invalid CSS across every component**, a **dependency version split** that creates two copies of a core library, and **test infrastructure that references nonexistent configuration**.

**Finding Count:** 4 CRITICAL, 5 HIGH, 5 MEDIUM

---

## CRITICAL Findings

### F-AI13-01: Open Redirect in Auth Callback (Checklist #14, #80)

**Severity:** CRITICAL
**File:** `src/app/auth/callback/route.ts`, lines 7, 14
**Category:** Security Blind Spot / Hallucinated Security

```typescript
const next = searchParams.get("next") ?? "/dashboard";
// ...
return NextResponse.redirect(`${origin}${next}`);
```

The `next` parameter is taken directly from user-supplied query parameters with no validation. An attacker can craft a URL like:

```
/auth/callback?code=VALID_CODE&next=https://evil.com
```

Since `origin` is derived from the request URL and `next` is concatenated directly, the redirect destination is attacker-controlled. This is a textbook open redirect (CWE-601) that AI code generators produce frequently because the pattern "looks right" -- it has a default value and uses `origin`, giving the appearance of safety.

**Fix:** Validate that `next` starts with `/` and does not contain `//` or protocol prefixes:

```typescript
const rawNext = searchParams.get("next") ?? "/dashboard";
const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/dashboard";
```

---

### F-AI13-02: Tailwind `font-[var(...)]` Produces `font-family` Not `font-weight` (Checklist #6, #26)

**Severity:** CRITICAL
**Files:** Every component file using `font-[var(--font-bold)]`, `font-[var(--font-medium)]`, `font-[var(--font-semibold)]` -- at least 16 occurrences across 7 files
**Category:** Confidence Without Correctness / "Looks Right" Problem

In Tailwind CSS (including v4.2.2 installed here), the `font-[...]` arbitrary value utility maps to **`font-family`**, not `font-weight`. The correct utility for arbitrary font-weight values is `font-weight-[...]` (Tailwind v4) or `font-[...]` only works for named weight utilities like `font-bold`, `font-medium`, etc.

When you write:
```html
<h1 className="font-[var(--font-bold)]">
```

Tailwind generates:
```css
.font-\[var\(--font-bold\)\] {
  font-family: var(--font-bold);  /* WRONG -- sets font-family to "700" */
}
```

The CSS custom property `--font-bold: 700` is a valid CSS value, so no error is thrown. But `font-family: 700` is nonsensical and the browser silently falls back to the inherited font family. The text appears to render correctly because the `Inter` font from `next/font/google` is applied via class inheritance on `<body>`, masking the bug entirely.

**Affected occurrences (all produce wrong CSS):**
- `font-[var(--font-bold)]` -- 7 files
- `font-[var(--font-medium)]` -- 5 files
- `font-[var(--font-semibold)]` -- 2 files

**Why this is CRITICAL, not MEDIUM:** Every heading and label in the application has no effective font-weight styling. The visual output appears acceptable only because browser defaults and font inheritance happen to produce passable results. This will break visually when components are isolated (Storybook, emails, iframes) or when the design system evolves.

**Fix:** Use Tailwind's named weight utilities directly:
```html
<h1 className="font-bold">    <!-- instead of font-[var(--font-bold)] -->
<p className="font-medium">   <!-- instead of font-[var(--font-medium)] -->
<h2 className="font-semibold"> <!-- instead of font-[var(--font-semibold)] -->
```

Or, if CSS variables must be used, use inline styles or the `font-weight-[...]` pattern in Tailwind v4+.

---

### F-AI13-03: Tailwind `duration-[var(--transition-fast)]` Produces Invalid CSS (Checklist #6, #26)

**Severity:** CRITICAL
**Files:** All interactive components -- `sidebar.tsx`, `user-menu.tsx`, `sign-in/page.tsx`, `sign-up/page.tsx`, `dashboard/page.tsx`
**Category:** Confidence Without Correctness / "Looks Right" Problem

The design tokens define transitions as compound values:
```css
--transition-fast: 100ms ease;
--transition-normal: 200ms ease;
```

But the code uses them in `duration-[...]` utilities:
```html
<button className="duration-[var(--transition-fast)]">
```

This generates:
```css
.duration-\[var\(--transition-fast\)\] {
  transition-duration: var(--transition-fast);
  /* Resolves to: transition-duration: 100ms ease; -- INVALID */
}
```

`transition-duration` only accepts time values (e.g., `100ms`). The `ease` easing function makes the entire declaration invalid, and the browser discards it. No transition animations work.

This is paired with `transition-[background]` which sets `transition-property: background`, so the full intended transition chain is:
1. `transition-[background]` -> sets property (works)
2. `duration-[var(--transition-fast)]` -> sets duration (BROKEN -- invalid value)

**Occurrences:** 10+ across 5 files

**Fix:** Either split the token:
```css
--duration-fast: 100ms;
--easing-default: ease;
```
Or use Tailwind's built-in duration classes: `duration-100`, `duration-200`.

---

### F-AI13-04: RLS Policy "Service role can manage all roles" Uses USING(true) (Checklist #15, #36, Failure Mode #10)

**Severity:** CRITICAL
**File:** `supabase/migrations/00000000000001_auth_roles.sql`, lines 33-35
**Category:** Security Blind Spot / Overly Permissive RLS

```sql
CREATE POLICY "Service role can manage all roles"
  ON public.user_roles FOR ALL
  USING (true)
  WITH CHECK (true);
```

This policy grants ALL operations (SELECT, INSERT, UPDATE, DELETE) to ALL roles. The `USING(true)` / `WITH CHECK(true)` pattern means any authenticated user can read, modify, and delete ANY user's role record -- including elevating their own role to `owner`.

The code comment says "Service role can manage all roles," implying this should be restricted to the service role. But PostgreSQL RLS policies with `USING(true)` apply to ALL roles, not just the service role. The service role bypasses RLS entirely by default, so this policy is redundant for its stated purpose and dangerous for everyone else.

The migration does `REVOKE ALL ON TABLE public.user_roles FROM authenticated, anon, public` followed by `GRANT SELECT ON TABLE public.user_roles TO authenticated`, which mitigates the INSERT/UPDATE/DELETE risk through GRANT restrictions. However, this creates a **defense-in-depth failure**: the RLS policy and the GRANT permissions tell contradictory stories. If anyone later adds a broader GRANT (common during feature development), the `USING(true)` policy instantly becomes exploitable.

**Fix:** Either remove the "Service role" policy entirely (service role bypasses RLS anyway), or scope it properly:

```sql
-- Option A: Remove it (service role doesn't need RLS policies)
-- Simply delete the policy

-- Option B: Scope to service role explicitly
CREATE POLICY "Service role can manage all roles"
  ON public.user_roles FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
```

---

## HIGH Findings

### F-AI13-05: @t3-oss/env-core Version Split -- Two Copies Installed (Checklist #12, #28)

**Severity:** HIGH
**Files:** `package.json`, `src/env.ts`
**Category:** Dependency Bloat / Configuration Mismatch

The project has:
- `@t3-oss/env-nextjs@0.12.0` which depends on `@t3-oss/env-core@0.12.0`
- `@t3-oss/env-core@0.13.11` independently listed in `package.json`

This results in TWO copies of `@t3-oss/env-core` in `node_modules`:
1. `node_modules/@t3-oss/env-core/` -- v0.13.11 (top-level)
2. `node_modules/@t3-oss/env-nextjs/node_modules/@t3-oss/env-core/` -- v0.12.0 (nested)

In `src/env.ts`:
```typescript
import { createEnv } from "@t3-oss/env-nextjs";       // uses env-core 0.12.0
import { vercel } from "@t3-oss/env-core/presets-zod"; // uses env-core 0.13.11
```

The `createEnv` function from env-nextjs internally uses env-core 0.12.0, but `vercel()` comes from env-core 0.13.11. The `extends` option passes the 0.13.11 preset into the 0.12.0 `createEnv` implementation. If there are any breaking changes between these versions in how `extends` processes preset schemas, validation will silently fail or behave unexpectedly.

**Fix:** Align versions. Either upgrade `@t3-oss/env-nextjs` to a version that depends on `@t3-oss/env-core@0.13.x`, or remove the independent `@t3-oss/env-core` dependency and use the version bundled with env-nextjs:

```json
{
  "dependencies": {
    "@t3-oss/env-nextjs": "^0.13",  // latest that aligns with env-core 0.13
  }
}
```
Remove the separate `@t3-oss/env-core` entry unless it's actually needed directly.

---

### F-AI13-06: Vitest Project Configuration Does Not Exist (Checklist #19, #96)

**Severity:** HIGH
**Files:** `package.json` (lines 14-18), `vitest.config.ts`
**Category:** Configuration Mismatch / Hallucinated Configuration

The `package.json` defines these scripts:
```json
"test:smoke": "vitest run --project smoke",
"test:security": "vitest run --project security",
"test:db": "vitest run --project db",
"test:actions": "vitest run --project actions",
```

But Vitest `--project` requires a workspace configuration (`vitest.workspace.ts` or `vitest.workspace.json`) that defines named projects. No such file exists. The `vitest.config.ts` is a single flat config with no `projects` array.

Running `npm run test:smoke` will either error or run all tests (depending on Vitest version behavior for unknown project names), not just the smoke tests.

This is a classic AI pattern: generating plausible-looking script commands that reference infrastructure that was never created. The scripts look complete to a reviewer but don't work.

**Fix:** Either create a `vitest.workspace.ts`:

```typescript
import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  { test: { name: "smoke", include: ["tests/smoke/**/*.test.ts"] } },
  { test: { name: "security", include: ["tests/security/**/*.test.ts"] } },
  { test: { name: "db", include: ["tests/db/**/*.test.ts"] } },
  { test: { name: "actions", include: ["tests/actions/**/*.test.ts"] } },
]);
```

Or remove the `--project` flags and use `--dir` or glob patterns instead.

---

### F-AI13-07: Sign-Up Redirects to Dashboard Before Email Confirmation (Checklist #8, #26)

**Severity:** HIGH
**File:** `src/app/(auth)/sign-up/page.tsx`, lines 30-31
**Category:** Incomplete Implementation / Logic Error

```typescript
const { error } = await supabase.auth.signUp({
  email,
  password,
  options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
});

if (error) {
  setError(error.message);
  setLoading(false);
  return;
}

router.push("/dashboard");  // <-- Immediately redirects to dashboard
router.refresh();
```

The `signUp` call includes `emailRedirectTo`, indicating email confirmation is expected. But the code immediately redirects to `/dashboard` after a successful signUp call, regardless of whether the user has confirmed their email.

Supabase's `signUp` returns a user object even when email confirmation is pending -- the user just cannot authenticate until confirmed. The middleware's `getUser()` call will then fail (no valid session), redirecting back to sign-in. The user flow becomes: sign up -> flash of dashboard redirect -> immediately bounced to sign-in. This is confusing UX.

The correct pattern is to show a "check your email" confirmation message, not redirect to dashboard.

**Fix:**
```typescript
if (!error) {
  // Show confirmation message instead of redirecting
  setConfirmationSent(true);
  return;
}
```

---

### F-AI13-08: Sidebar Navigation Links Become Invisible When Collapsed (Checklist #6, #47)

**Severity:** HIGH
**File:** `src/components/nav/sidebar.tsx`, lines 56-57
**Category:** Confidence Without Correctness

```tsx
<Link href={item.href} title={collapsed ? item.label : undefined}>
  {!collapsed && item.label}
</Link>
```

When the sidebar is collapsed, the link text is hidden (`{!collapsed && item.label}` renders nothing). But there are no icons to replace the text. The navigation items become empty, invisible clickable areas with no visual indicator. The `title` attribute provides a tooltip on hover, but there is no visual content in the collapsed state.

The sidebar collapse feature was implemented with the text-hiding logic but the icon system was never added. This is a common AI half-implementation: the toggle mechanism works, the CSS transition works, the width changes, but the collapsed state is functionally unusable.

**Fix:** Either add icons to navigation items, or disable the collapse feature until icons are available.

---

### F-AI13-09: Tailwind `text-[var(...)]` Ambiguity for Color vs Font-Size (Checklist #6, #26)

**Severity:** HIGH
**Files:** All component files using `text-[var(--text-sm)]` alongside `text-[var(--color-text-secondary)]`
**Category:** "Looks Right" Problem / Framework Cargo-Culting

Tailwind's `text-[...]` utility is ambiguous -- it can set either `font-size` or `color` depending on the detected type of the value. With literal values, Tailwind can determine the type: `text-[0.875rem]` = font-size, `text-[#525252]` = color. But with CSS variables, Tailwind **cannot determine the type at build time**.

Example from `user-menu.tsx`:
```html
<span className="text-[var(--text-sm)] text-[var(--color-text-secondary)]">
```

Both use `text-[var(...)]`. Tailwind v4 handles this by applying a heuristic based on the variable name, but this is fragile and undocumented behavior. The correct approach in Tailwind v4 is to use CSS variable type hints:

```html
<!-- Explicit type hints -->
<span className="text-[length:var(--text-sm)] text-[color:var(--color-text-secondary)]">
```

Or better yet, register these as Tailwind theme values in the CSS file using `@theme`:

```css
@theme {
  --font-size-sm: var(--text-sm);
  --color-text-secondary: var(--color-text-secondary);
}
```

Then use `text-sm text-text-secondary` directly.

The current approach works by luck in Tailwind v4 (it infers type from common variable name patterns), but is fragile and will break if variable names change or if Tailwind's heuristic changes.

---

## MEDIUM Findings

### F-AI13-10: pull-env.sh Pulls Secret Not Used in Application Code (Checklist #13, #74)

**Severity:** MEDIUM
**File:** `scripts/pull-env.sh`, line 41
**Category:** Dead Code Accumulation

The pull-env script fetches `supabase-publishable-key` and writes it as `SUPABASE_PUBLISHABLE_KEY`:

```bash
"supabase-publishable-key:SUPABASE_PUBLISHABLE_KEY"
```

But `SUPABASE_PUBLISHABLE_KEY` is:
- Not defined in `src/env.ts` (not validated by Zod)
- Not referenced anywhere in the `src/` directory
- Not documented in `.env.local.example`

This is an orphaned environment variable -- pulled from the vault but never consumed. It clutters the `.env.local` file and may confuse developers.

---

### F-AI13-11: No Error Boundaries at Any Route Level (Checklist #86, #90)

**Severity:** MEDIUM
**Files:** Missing `src/app/error.tsx`, `src/app/(protected)/error.tsx`, `src/app/not-found.tsx`
**Category:** Missing Error Paths

There are zero `error.tsx` files and zero `not-found.tsx` files in the entire application. In Next.js App Router, `error.tsx` provides error boundaries at route segment levels. Without them:

- Unhandled errors in server components crash to Next.js's default error page (generic, unstyled)
- Database connection failures show raw error output
- Invalid routes show Next.js default 404 page (no branding)

For a Phase 0 scaffold this is expected, but it should be documented as a known gap.

---

### F-AI13-12: Test Assertions Are Minimal -- Smoke Tests Only Check Reachability (Checklist #30, #19)

**Severity:** MEDIUM
**File:** `tests/smoke/supabase.test.ts`
**Category:** Test Theater

The smoke test `CONN-L2-01` asserts:
```typescript
expect(response.status).toBeLessThan(500);
```

This passes for status codes 200, 201, 301, 400, 401, 403, 404. A 401 or 403 response (indicating broken auth configuration) would pass this test. A more meaningful assertion would be:

```typescript
expect(response.ok).toBe(true); // only passes for 2xx
```

The security tests (SEC-L3-01 through SEC-L3-04) are better -- they verify specific code patterns via file reads. But they test source code content rather than runtime behavior, making them static analysis assertions masquerading as tests.

---

### F-AI13-13: Server Component Cookie `setAll` Silently Swallows Errors (Checklist #31)

**Severity:** MEDIUM
**File:** `src/lib/supabase/server.ts`, lines 14-17
**Category:** Error Handling Theater

```typescript
setAll(cookiesToSet) {
  try {
    cookiesToSet.forEach(({ name, value, options }) =>
      cookieStore.set(name, value, options),
    );
  } catch {
    // Server Component context is read-only — safe to ignore
  }
},
```

The empty catch block silently swallows ALL errors, not just the "read-only context" error. If `cookieStore.set` throws for a different reason (malformed cookie data, exceeded cookie size limits), the error is silently consumed. This is the canonical "catch-and-swallow" anti-pattern (Error Handling Theater, Failure Mode #31).

The comment claims it's "safe to ignore," which is true for the specific case of read-only Server Component contexts. But the catch block catches everything.

**Note:** This pattern is actually recommended in the official Supabase SSR docs for Next.js Server Components. It IS the correct approach for the read-only context case. The finding is that the pattern is correct but the catch should at minimum be typed or logged in development:

```typescript
} catch (error) {
  // Expected in read-only Server Component context.
  // Cookie refresh will happen in middleware instead.
  if (process.env.NODE_ENV === 'development') {
    console.debug('[supabase/server] Cookie set skipped (read-only context)');
  }
}
```

---

### F-AI13-14: Design Token Variables Used as Tailwind Arbitrary Values Throughout -- Missing @theme Integration (Checklist #24, #25)

**Severity:** MEDIUM
**Files:** All component files
**Category:** Framework Cargo-Culting / Over-Engineering

The codebase defines ~50 CSS custom properties in `globals.css` and then references them via Tailwind arbitrary value syntax everywhere:

```html
className="p-[var(--space-6)] text-[var(--text-2xl)] bg-[var(--color-surface)]"
```

This defeats two major Tailwind v4 features:
1. **Autocomplete** -- IDE tooling cannot suggest `p-[var(--space-6)]` but can suggest `p-6`
2. **@theme integration** -- Tailwind v4 allows registering CSS variables as theme values via `@theme`, which then generates proper utility classes

The correct Tailwind v4 approach is:
```css
@import "tailwindcss";

@theme {
  --spacing-6: 1.5rem;
  --color-surface: #ffffff;
  --font-size-2xl: 1.5rem;
}
```

Then use standard classes: `p-6 text-2xl bg-surface`.

The current approach is valid CSS but is fighting against Tailwind's design rather than leveraging it. Every component carries verbose `var()` references that would be replaced by clean utility names with proper theme integration.

---

## Verified Correct Patterns

For completeness, these patterns were audited and found to be correctly implemented:

1. **getUser() over getSession()** -- `src/lib/supabase/middleware.ts` correctly uses `supabase.auth.getUser()` for server-side auth verification, not the insecure `getSession()`. The security test SEC-L3-02 also enforces this.

2. **server-only guard on admin client** -- `src/lib/supabase/admin.ts` imports `"server-only"` at the top, preventing client-side bundle inclusion. The security test SEC-L3-01 enforces this.

3. **Cookie pattern matches @supabase/ssr 0.6.x API** -- Both `server.ts` and `middleware.ts` use the modern `getAll`/`setAll` cookie interface, not the deprecated `get`/`set`/`remove` pattern. The types align with the installed `@supabase/ssr@0.6.1`.

4. **No NEXT_PUBLIC_ prefix on server secrets** -- Verified via env.ts Zod schemas and security test SEC-L3-03.

5. **Protected layout uses server-side auth check** -- `src/app/(protected)/layout.tsx` calls `getUser()` server-side and redirects if no user. This provides defense-in-depth beyond middleware.

6. **Admin client disables session persistence** -- `admin.ts` sets `persistSession: false`, `autoRefreshToken: false`, `detectSessionInUrl: false` -- correct for server-side service role usage.

7. **createEnv / experimental__runtimeEnv** -- The T3 env pattern in `src/env.ts` correctly uses `experimental__runtimeEnv` for client-side env vars, which is the current API for `@t3-oss/env-nextjs@0.12.0`.

---

## AI Generation Pattern Analysis

### What this codebase does well (unusually so for AI-generated code):
- Correct modern Supabase SSR patterns (not stale v1 patterns)
- Proper security boundaries (server-only, getUser, no exposed secrets)
- RLS enabled on the only table
- Auth middleware with proper cookie handling
- Defense-in-depth with both middleware and layout auth checks

### What it gets wrong (typical AI patterns):
- **"Looks right" CSS bugs** (F-AI13-02, F-AI13-03): The font-weight and transition-duration bugs are invisible without close inspection because the visual output is passable
- **Open redirect** (F-AI13-01): Classic AI pattern of generating plausible but insecure redirect handling
- **Half-implementations** (F-AI13-08): Sidebar collapse without icons
- **Phantom configuration** (F-AI13-06): Test scripts referencing infrastructure that doesn't exist
- **UX logic error** (F-AI13-07): Sign-up redirect that creates a confusing bounce
- **Fighting the framework** (F-AI13-14): Using CSS variables through Tailwind arbitrary values instead of theme integration

---

## Priority Fix Order

1. **F-AI13-01** (Open Redirect) -- Security vulnerability, immediate fix
2. **F-AI13-04** (RLS USING(true)) -- Security vulnerability, immediate fix
3. **F-AI13-02** (font-weight bug) -- Every heading/label has wrong CSS property
4. **F-AI13-03** (transition-duration bug) -- Every transition is broken
5. **F-AI13-05** (env-core version split) -- Fix before adding more env validation
6. **F-AI13-06** (Vitest projects) -- Fix before relying on targeted test runs
7. **F-AI13-07** (Sign-up redirect) -- Fix before production users sign up
8. **F-AI13-09** (text-[] ambiguity) -- Fix alongside F-AI13-02/03 CSS cleanup
9. **F-AI13-08** (Collapsed sidebar) -- Fix or remove collapse feature
10. Remaining MEDIUM findings -- address during Phase 1A development
