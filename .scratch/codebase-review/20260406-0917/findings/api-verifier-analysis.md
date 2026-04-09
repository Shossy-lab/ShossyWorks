# A7 — API Verifier Analysis

**Reviewer:** A7 (API Verifier)
**Domain:** API Design — auth callback route, Supabase client configuration, env validation as API boundary, middleware as request pipeline, request/response patterns.
**Date:** 2026-04-06
**Codebase Stage:** Phase 0 (scaffolding + auth). No server actions or data-fetching API routes yet.

---

## Executive Summary

The codebase is in early Phase 0 with only one API route (auth callback). The Supabase client architecture follows official patterns correctly, and env validation via T3/Zod is well-structured. However, the auth callback route contains an **open redirect vulnerability** (CRITICAL), several server-side env variables are marked `optional()` despite being required for the application to function (HIGH), and the generated Supabase types are missing, meaning all database queries will be untyped as soon as Phase 1A begins (HIGH). There are also middleware contract gaps and missing error boundaries relevant to the API layer.

**Finding Count:** 3 CRITICAL, 5 HIGH, 5 MEDIUM

---

## Findings

---

### F-API-01: Open Redirect in Auth Callback Route

**Severity:** CRITICAL
**Checklist:** Item 123 (Redirect loop / redirect safety), Item 90 (Input validation on route handlers)
**File:** `src/app/auth/callback/route.ts`, lines 7-14

**Evidence:**

```typescript
const next = searchParams.get("next") ?? "/dashboard";
// ...
return NextResponse.redirect(`${origin}${next}`);
```

The `next` query parameter is taken directly from user input and concatenated into a redirect URL with zero validation. An attacker can craft a URL such as:

```
/auth/callback?code=valid_code&next=//evil.com
```

Since `${origin}//evil.com` resolves to `//evil.com` (protocol-relative URL), the browser will navigate to `evil.com`. Other payloads also work:

- `next=@evil.com` -- some URL parsers interpret `origin@evil.com` as `evil.com` with auth
- `next=/..//evil.com` -- path traversal variants

This is a textbook open redirect, frequently exploited in phishing attacks. After a user authenticates, they trust the redirect -- an attacker chains this with a cloned sign-in page to steal credentials.

**Fix:**

```typescript
const next = searchParams.get("next") ?? "/dashboard";
// Validate: must be a relative path starting with /
const safePath = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
return NextResponse.redirect(`${origin}${safePath}`);
```

Or better: maintain a whitelist of allowed redirect targets.

---

### F-API-02: Critical Server Env Variables Marked Optional

**Severity:** HIGH
**Checklist:** Item 138 (Required env variables checked at startup), Item 49 (Missing .env validation)
**File:** `src/env.ts`, lines 10-22

**Evidence:**

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
  // ...
}
```

Every server-side env variable is `.optional()`. This defeats the entire purpose of T3 env validation. When Phase 1A adds database queries, `DATABASE_URL` will be `undefined` at runtime. When `createAdminClient()` is called, both `SUPABASE_SECRET_KEY` and `SUPABASE_SERVICE_ROLE_KEY` could be `undefined`, causing a runtime throw instead of a build-time or startup-time error.

The admin client (`src/lib/supabase/admin.ts`) already has a manual fallback check, but this creates a two-layer validation system -- T3 says "optional", admin.ts throws at runtime. These should agree.

**Impact:** Production deployment will succeed even with missing critical secrets. Errors surface at request time, not deploy time. For a construction estimating platform handling business data, this is a reliability and security gap.

**Fix:** Classify variables into tiers:
- **Required for any deploy:** `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`), `DATABASE_URL` -- remove `.optional()`
- **Required for specific features:** `ANTHROPIC_API_KEY` -- keep `.optional()` with runtime checks in the AI feature
- **Genuinely optional:** `DIRECT_DATABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` -- `.optional()` is correct

Consider using Zod `.refine()` for the "at least one of" pattern:

```typescript
SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
SUPABASE_SECRET_KEY: z.string().min(1).optional(),
// Then add a superRefine to ensure at least one is present
```

---

### F-API-03: Missing Generated Supabase Types (Pre-Existing Gap)

**Severity:** HIGH
**Checklist:** Item 103 (Supabase types file exists), Item 105 (Generated types actually used), Item 54 (Using 'any' or manual types instead of generated)
**File:** `package.json` line 20 (script exists), `src/lib/types/supabase.ts` (file does not exist)

**Evidence:**

The `db:types` script is defined:

```json
"db:types": "npx supabase gen types typescript --project-id edpumrranilhipwnvfrq > src/lib/types/supabase.ts"
```

But `src/lib/types/` directory does not exist. The script has never been run. None of the three Supabase client factories (`client.ts`, `server.ts`, `admin.ts`) use `createClient<Database>(...)` -- they all create untyped clients.

**Impact:** This is not yet a runtime problem because no database queries exist. However, it is a structural gap that will cause every Phase 1A query to be untyped. Every `.from('table').select()` will return `any` for row data, which means:
- No TypeScript protection against accessing nonexistent columns
- No autocomplete for column names
- Schema changes in migrations will silently break queries without type errors

**Fix (before Phase 1A starts):**
1. Run `npm run db:types` to generate the types file
2. Update all three client factories to use the generic parameter: `createClient<Database>(...)`
3. Add a CI step or pre-commit hook to verify types are not stale

---

### F-API-04: Auth Callback Has No Error Logging

**Severity:** HIGH
**Checklist:** Item 44 (Silent error swallowing), Item 128 (Error response handling)
**File:** `src/app/auth/callback/route.ts`, lines 9-18

**Evidence:**

```typescript
if (code) {
  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (!error) {
    return NextResponse.redirect(`${origin}${next}`);
  }
}
return NextResponse.redirect(`${origin}/sign-in?error=auth_callback_error`);
```

When `exchangeCodeForSession` fails, the error is discarded. The user sees a generic `?error=auth_callback_error` message with no differentiation between:
- Expired auth code (user took too long)
- Invalid auth code (tampering)
- Network error to Supabase
- Supabase service outage
- PKCE verification failure

The error object from Supabase contains a `message` and `status` that could be logged server-side for debugging authentication issues. In a multi-user construction platform, silent auth failures are hard to diagnose without logs.

**Fix:**

```typescript
if (code) {
  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (!error) {
    return NextResponse.redirect(`${origin}${safePath}`);
  }
  console.error("[auth/callback] exchangeCodeForSession failed:", {
    status: error.status,
    message: error.message,
    // Never log the code itself -- it's a credential
  });
}
```

---

### F-API-05: Middleware Auth Is the Only Auth Layer (CVE-2025-29927)

**Severity:** CRITICAL
**Checklist:** Item 121 (Auth checks NOT middleware-only), Item 60 (Missing auth middleware on protected routes)
**File:** `src/lib/supabase/middleware.ts`, `src/app/(protected)/layout.tsx`

**Evidence:**

The codebase has two layers of auth protection:

1. **Middleware** (`src/lib/supabase/middleware.ts`, lines 33-39): Redirects unauthenticated users away from non-public routes.
2. **Protected layout** (`src/app/(protected)/layout.tsx`, lines 8-13): Calls `getUser()` and redirects if no user.

The protected layout provides a second auth check, which is good. However, there are structural concerns:

**Concern A -- Protected layout uses `redirect()` not `notFound()`:** If the auth check in the layout fails, it issues a `redirect("/sign-in")` which is a 307 redirect. This is correct behavior, but there is no mechanism to return a 401/403 for API-like access patterns (e.g., future server actions called from the protected area).

**Concern B -- No auth check on the callback route itself:** The `src/app/auth/callback/route.ts` is the only API route in the codebase and it has no rate limiting or abuse protection. An attacker can probe the callback endpoint with arbitrary `code` values at high volume. Each attempt creates a Supabase client and makes an `exchangeCodeForSession` call, consuming Supabase API quota.

**Concern C -- Future server actions:** The architecture has no pattern established for server action auth checks. When Phase 1A adds data mutations, each server action will need its own `getUser()` call. Without a pattern or helper function established now, developers may rely on middleware alone, which is known to be bypassable (CVE-2025-29927 demonstrated `x-middleware-subrequest` header bypass in Next.js).

**Fix:**
1. Create a shared auth helper: `src/lib/auth/require-user.ts` that encapsulates `createClient() -> getUser() -> throw/return`
2. Document in INTENT.md that every server action and API route must independently verify authentication
3. Consider adding basic rate limiting to the auth callback route

---

### F-API-06: `SKIP_ENV_VALIDATION` Bypass Has No Guardrails

**Severity:** HIGH
**Checklist:** Item 140 (Development-only code in production), Item 138 (Required env variables checked at startup)
**File:** `src/env.ts`, line 43

**Evidence:**

```typescript
skipValidation: !!process.env.SKIP_ENV_VALIDATION,
```

Setting `SKIP_ENV_VALIDATION=1` in any environment completely disables all Zod validation of environment variables. There are no guardrails:
- No `NODE_ENV === 'production'` check to prevent it in production
- No logging when validation is skipped
- No CI check to ensure it is not set in production deploy configs

If this variable is accidentally set in Vercel's production environment config (or inherited from a preview deployment), the application will start with potentially missing or malformed environment variables, causing unpredictable runtime failures.

**Fix:**

```typescript
skipValidation:
  !!process.env.SKIP_ENV_VALIDATION &&
  process.env.NODE_ENV !== "production",
```

Or at minimum, log a warning:

```typescript
if (process.env.SKIP_ENV_VALIDATION) {
  console.warn("[env] SKIP_ENV_VALIDATION is set -- env validation disabled");
}
```

---

### F-API-07: Sign-Up Success Path Skips Email Verification

**Severity:** CRITICAL
**Checklist:** Item 118 (Error handling pattern), Item 102 (Supabase auth helpers usage)
**File:** `src/app/(auth)/sign-up/page.tsx`, lines 20-32

**Evidence:**

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

router.push("/dashboard");
router.refresh();
```

After `signUp()` succeeds, the user is immediately redirected to `/dashboard` regardless of whether email confirmation is required. The Supabase `signUp()` response includes a `data.user` object with a `confirmed_at` field and `data.session` which is `null` when email confirmation is pending.

If Supabase is configured to require email confirmation (which is the default and the secure setting):
- `signUp()` returns `{ data: { user, session: null }, error: null }`
- The code treats this as success and pushes to `/dashboard`
- The middleware then detects no session and redirects back to `/sign-in`
- The user sees a confusing loop: sign-up -> dashboard -> sign-in

If Supabase is configured to NOT require email confirmation (less secure):
- The code works but allows anyone to create accounts with unverified email addresses
- No indication to the user about checking their email

**Fix:**

```typescript
const { data, error } = await supabase.auth.signUp({ ... });

if (error) {
  setError(error.message);
  setLoading(false);
  return;
}

if (!data.session) {
  // Email confirmation required
  setMessage("Check your email for a confirmation link.");
  setLoading(false);
  return;
}

// Auto-confirmed (development or specific config)
router.push("/dashboard");
router.refresh();
```

---

### F-API-08: Client Creates New Supabase Instance on Every Call

**Severity:** MEDIUM
**Checklist:** Item 39 (Hardcoded external service clients)
**File:** `src/lib/supabase/client.ts`, lines 6-8

**Evidence:**

```typescript
export function createClient() {
  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
```

Every component that calls `createClient()` creates a new `BrowserClient` instance. In the current codebase, this happens in:
- `sign-in/page.tsx` (on form submit)
- `sign-up/page.tsx` (on form submit)
- `user-menu.tsx` (on sign-out click)

The `@supabase/ssr` `createBrowserClient` function internally handles singleton behavior via `window.__supabase_client`, so multiple calls do not actually create multiple clients. This is by design in the SSR package.

However, this implicit singleton pattern is fragile -- it depends on an undocumented internal behavior of `@supabase/ssr`. If the project later migrates to `@supabase/supabase-js` directly for the browser client (e.g., for custom auth flows), the singleton behavior disappears.

**Impact:** Low now, but worth noting for Phase 1A when more components will need the Supabase client. An explicit singleton or context provider pattern would be more robust.

**Fix (recommend for Phase 1A):** Consider a Supabase context provider or an explicit module-level singleton with lazy initialization.

---

### F-API-09: pull-env.sh Maps `SUPABASE_PUBLISHABLE_KEY` But Code Never Uses It

**Severity:** MEDIUM
**Checklist:** Item 82 (Query parameter usage consistency -- adapted for env var consistency)
**File:** `scripts/pull-env.sh`, line 41; `src/env.ts`

**Evidence:**

In `pull-env.sh`:
```bash
"supabase-publishable-key:SUPABASE_PUBLISHABLE_KEY"
```

But `SUPABASE_PUBLISHABLE_KEY` does not appear in `src/env.ts` (not validated), `.env.local.example` (not documented), or anywhere in `src/` (not consumed). This is a stale mapping -- either:
- The key vault contains a secret that was renamed/deprecated
- The variable was planned but never implemented

The reverse is also true: `CRON_SECRET` is defined in `src/env.ts` and `.env.local.example` but is not mapped in `pull-env.sh`, meaning it will never be automatically pulled from the vault.

**Impact:** Confusion during onboarding and potential security issue if `SUPABASE_PUBLISHABLE_KEY` is actually the anon key under a different name (duplication).

**Fix:**
1. Remove the `supabase-publishable-key` line from `pull-env.sh` (or add the var to `env.ts` if it is needed)
2. Add `cron-secret:CRON_SECRET` to the `SECRET_MAP` in `pull-env.sh`

---

### F-API-10: No Error Boundaries at Any Route Segment

**Severity:** HIGH
**Checklist:** Item 42 (Missing error boundaries), Item 45 (Missing error recovery UI)
**Files:** `src/app/`, all route segments

**Evidence:**

There are zero `error.tsx` files in the entire app:

```
src/app/                    -- no error.tsx
src/app/(auth)/             -- no error.tsx
src/app/(protected)/        -- no error.tsx
src/app/(protected)/dashboard/ -- no error.tsx
```

If `createClient()` fails (e.g., invalid env vars in production), `getUser()` throws a network error, or any server component throws during rendering, the user sees Next.js's default error page -- a white screen with minimal information in production.

For the auth callback route specifically: if `exchangeCodeForSession` throws (not returns error, but actually throws due to network issues), there is no error boundary to catch it. The user gets a 500 page.

**Impact:** Every unhandled server-side error produces an unhelpful white screen. This is especially problematic during auth flows where users need clear feedback about what went wrong.

**Fix:** Add `error.tsx` at minimum to:
1. `src/app/error.tsx` -- global catch-all
2. `src/app/(auth)/error.tsx` -- auth-specific errors with "try again" link
3. `src/app/(protected)/error.tsx` -- protected area errors with retry

---

### F-API-11: Middleware Matcher Does Not Exclude API Health/Webhook Paths

**Severity:** MEDIUM
**Checklist:** Item 61 (Overly broad middleware matcher), Item 120 (Middleware matcher configuration)
**File:** `src/middleware.ts`, lines 9-11

**Evidence:**

```typescript
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

The matcher excludes Next.js internals and static assets, which is correct. However, it does NOT exclude:
- `/api/*` paths -- when API routes are added in Phase 1A, every API request will go through the Supabase `getUser()` call in middleware. This adds latency and is incorrect for:
  - Webhook receivers (called by external services, no browser cookies)
  - Health check endpoints
  - Public API endpoints
  - Cron job endpoints (the `CRON_SECRET` env var suggests cron jobs are planned)

**Impact:** Not a problem today, but will cause issues as soon as the first API route or webhook is added. Webhook calls from Supabase or external services will fail because middleware tries to read cookies from a server-to-server request.

**Fix:** Update the matcher to preemptively exclude API paths:

```typescript
matcher: [
  "/((?!_next/static|_next/image|api/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
],
```

Or handle API routes explicitly in the middleware function with early returns.

---

### F-API-12: Auth Callback Accepts GET with Query Params but Has No CSRF Protection

**Severity:** MEDIUM
**Checklist:** Item 89 (Proper CORS headers), Item 153 (Webhook receiver validation)
**File:** `src/app/auth/callback/route.ts`

**Evidence:**

The auth callback is a GET route that exchanges a `code` for a session:

```typescript
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
```

This follows the standard OAuth PKCE flow where CSRF is mitigated by the `code_verifier` stored in cookies. Supabase's `exchangeCodeForSession` validates the PKCE flow internally.

However, the route does NOT:
1. Validate the `origin` against a whitelist -- if `request.url` is manipulated by a proxy, `origin` could be an attacker-controlled domain
2. Check that the request has the expected cookies (code_verifier) before attempting the exchange -- a cleaner failure path
3. Set any security headers on the redirect response (e.g., `X-Content-Type-Options`, `Referrer-Policy`)

**Impact:** Low with current PKCE flow. The Supabase SDK handles PKCE verification, so the `code` alone is not sufficient for session hijacking. But the open redirect in F-API-01 compounds this -- an attacker could chain the callback with a malicious `next` parameter.

**Fix:** Addressed primarily by fixing F-API-01. Additionally, validate `origin` matches `NEXT_PUBLIC_APP_URL`:

```typescript
if (origin !== env.NEXT_PUBLIC_APP_URL) {
  return NextResponse.redirect(`${env.NEXT_PUBLIC_APP_URL}/sign-in?error=invalid_origin`);
}
```

---

### F-API-13: Smoke Test Uses Non-Null Assertions on Env Vars

**Severity:** MEDIUM
**Checklist:** Item 49 (Missing .env validation)
**File:** `tests/smoke/supabase.test.ts`, lines 4-6

**Evidence:**

```typescript
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
```

Tests use TypeScript non-null assertions (`!`) instead of the validated `env` module from `src/env.ts`. This means:
1. If `.env.local` is missing or incomplete, tests fail with cryptic `undefined` errors instead of Zod validation messages
2. The `SKIP_ENV_VALIDATION` flag has no effect on tests -- they bypass T3 entirely
3. Test env var handling diverges from app env var handling

**Fix:**

```typescript
import { env } from "@/env";
// or at minimum:
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!SUPABASE_URL) throw new Error("NEXT_PUBLIC_SUPABASE_URL not set");
```

---

## Summary Table

| ID | Severity | Title | File(s) | Checklist |
|---|---|---|---|---|
| F-API-01 | CRITICAL | Open redirect in auth callback | `src/app/auth/callback/route.ts` | 123, 90 |
| F-API-02 | HIGH | All server env vars marked optional | `src/env.ts` | 138, 49 |
| F-API-03 | HIGH | Missing generated Supabase types | `package.json`, `src/lib/types/` | 103, 105, 54 |
| F-API-04 | HIGH | Auth callback silently swallows errors | `src/app/auth/callback/route.ts` | 44, 128 |
| F-API-05 | CRITICAL | No established pattern for per-action auth (CVE-2025-29927) | `middleware.ts`, `(protected)/layout.tsx` | 121, 60 |
| F-API-06 | HIGH | `SKIP_ENV_VALIDATION` has no production guard | `src/env.ts` | 140, 138 |
| F-API-07 | CRITICAL | Sign-up ignores email verification state | `src/app/(auth)/sign-up/page.tsx` | 118, 102 |
| F-API-08 | MEDIUM | Browser client creates new instance per call | `src/lib/supabase/client.ts` | 39 |
| F-API-09 | MEDIUM | pull-env.sh / env.ts variable mismatch | `scripts/pull-env.sh`, `src/env.ts` | 82 |
| F-API-10 | HIGH | No error.tsx at any route segment | `src/app/` | 42, 45 |
| F-API-11 | MEDIUM | Middleware matcher will block future webhooks/cron | `src/middleware.ts` | 61, 120 |
| F-API-12 | MEDIUM | Callback route has no origin validation | `src/app/auth/callback/route.ts` | 89 |
| F-API-13 | MEDIUM | Tests bypass T3 env validation | `tests/smoke/supabase.test.ts` | 49 |

---

## Positive Observations

These patterns are done well and should be preserved:

1. **`server-only` guard on admin client:** `src/lib/supabase/admin.ts` uses `import "server-only"` which causes a build error if this module is ever imported from a client component. This is the correct pattern (checklist item 55).

2. **`getUser()` over `getSession()` in middleware:** `src/lib/supabase/middleware.ts` line 30 correctly uses `supabase.auth.getUser()` instead of `getSession()`. The `getSession()` method reads from local storage/cookies without server verification, making it unsuitable for auth decisions. This is validated by test `SEC-L3-02`.

3. **Cookie handling follows Supabase SSR spec:** Both `server.ts` and `middleware.ts` implement the `getAll/setAll` cookie interface required by `@supabase/ssr`. The middleware correctly re-creates `supabaseResponse` after setting cookies (line 18), which is a common mistake to miss.

4. **Admin client disables session persistence:** `admin.ts` lines 13-15 correctly set `persistSession: false`, `autoRefreshToken: false`, and `detectSessionInUrl: false`. This prevents the service role client from accidentally inheriting a user session.

5. **T3 env validation in next.config.ts:** `next.config.ts` imports `./src/env` which triggers Zod validation at build time, not just at runtime. This is the correct T3 pattern and catches missing NEXT_PUBLIC_ variables during `next build`.

6. **Security test suite:** The `tests/security/secrets.test.ts` file validates structural security properties (server-only import, getUser usage, NEXT_PUBLIC prefix safety). This is a good pattern for catching security regressions automatically.

---

## Priority Remediation Order

1. **F-API-01 (Open Redirect)** -- Immediate. This is exploitable in production right now.
2. **F-API-07 (Sign-Up Verification)** -- Immediate. Users hitting a redirect loop or bypassing email verification.
3. **F-API-05 (Per-Action Auth Pattern)** -- Before Phase 1A. Establish the pattern now.
4. **F-API-02 (Optional Env Vars)** -- Before Phase 1A. Prevent deploy-time surprises.
5. **F-API-06 (SKIP_ENV_VALIDATION)** -- Before Phase 1A. One-line fix.
6. **F-API-10 (Error Boundaries)** -- Before Phase 1A. Prevents white-screen errors.
7. **F-API-04 (Error Logging)** -- Before Phase 1A. Needed for production debugging.
8. **F-API-03 (Supabase Types)** -- First task of Phase 1A. Generate before writing queries.
9. **F-API-09, F-API-11, F-API-13** -- During Phase 1A. Cleanup items.
