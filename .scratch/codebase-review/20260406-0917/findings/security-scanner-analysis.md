# A1 Security Scanner Analysis

**Agent:** A1 -- Security Scanner
**Project:** ShossyWorks (Construction Estimating Platform)
**Date:** 2026-04-06
**Scope:** OWASP Top 10, hardcoded secrets, env prefix leaks, injection, XSS, CSRF, SSRF, CVE-2025-29927, Supabase RLS gaps, service role key exposure, security headers, cookie security
**Codebase size:** ~721 LOC across 25 source files (13 TS, 10 TSX, 1 CSS, 1 SQL)

---

## Executive Summary

The codebase is at an early stage (Phase 0 scaffold with auth) and has several foundational security patterns done correctly: the admin client uses `server-only` import guard, middleware uses `getUser()` instead of `getSession()`, env validation via T3 Zod schemas separates server from client vars, and the service role key is NOT exposed via `NEXT_PUBLIC_` prefix. However, the analysis found **1 CRITICAL**, **5 HIGH**, and **4 MEDIUM** security issues that must be addressed before the application begins handling real construction data.

---

## Findings

---

### CRIT-1: Open Redirect in OAuth Callback via `next` Query Parameter

**Severity:** CRITICAL
**Category:** OWASP A01 (Broken Access Control), Open Redirect
**File:** `src/app/auth/callback/route.ts` lines 7, 14

**Evidence:**

```typescript
// line 7
const next = searchParams.get("next") ?? "/dashboard";

// line 14
return NextResponse.redirect(`${origin}${next}`);
```

**Problem:** The `next` query parameter is read directly from user-controlled input and concatenated into a redirect URL with zero validation. An attacker can craft a callback URL like:

```
/auth/callback?code=VALID_CODE&next=//evil.com
```

Because `${origin}//evil.com` resolves to `https://evil.com` in many URL parsers, this enables a full open redirect. The attacker can also use `next=/@evil.com` or other URL manipulation techniques to redirect authenticated users to phishing pages that steal credentials or session tokens immediately after a successful login.

This is especially dangerous because it occurs in the authentication callback path -- the user has just authenticated and may trust any page they land on.

**Fix:** Validate that `next` starts with `/` and does not contain `//`, `@`, or protocol schemes. Use a strict allowlist or pathname-only redirect:

```typescript
function sanitizeRedirect(next: string | null): string {
  if (!next) return "/dashboard";
  // Must start with / and not contain // or protocol
  if (next.startsWith("/") && !next.startsWith("//") && !next.includes("://")) {
    return next;
  }
  return "/dashboard";
}
```

---

### HIGH-1: No Security Headers Configured

**Severity:** HIGH
**Category:** OWASP A05 (Security Misconfiguration), Security Headers
**File:** `next.config.ts` (entire file)

**Evidence:**

```typescript
// next.config.ts -- lines 1-9
import "./src/env";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
```

**Problem:** The Next.js configuration is empty. Zero security headers are configured. This means the production deployment at `shossy-works.vercel.app` is missing:

1. **Content-Security-Policy (CSP)** -- No XSS mitigation. Any injected script will execute.
2. **Strict-Transport-Security (HSTS)** -- No enforcement of HTTPS connections. (Vercel provides some defaults, but explicit config is needed for preload list inclusion and max-age control.)
3. **X-Frame-Options** -- No clickjacking protection. The app can be embedded in an attacker's iframe.
4. **X-Content-Type-Options** -- No MIME sniffing prevention.
5. **Referrer-Policy** -- Referrer data leaks to external resources.
6. **Permissions-Policy** -- No restriction on browser features (camera, microphone, geolocation).
7. **`poweredByHeader`** -- Not disabled. The `X-Powered-By: Next.js` header is sent, revealing the framework to attackers for targeted attacks.

For a construction estimating platform that will handle financial data, project details, and business information, this is unacceptable.

**Fix:** Add a `headers()` function to `next.config.ts`:

```typescript
const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://*.supabase.co;",
          },
        ],
      },
    ];
  },
};
```

---

### HIGH-2: RLS Policy Grants Unrestricted Access to `service_role` Without Explicit Role Scoping

**Severity:** HIGH
**Category:** Supabase-Specific Security, RLS Policy Design
**File:** `supabase/migrations/00000000000001_auth_roles.sql` lines 33-35

**Evidence:**

```sql
-- lines 33-35
CREATE POLICY "Service role can manage all roles"
  ON public.user_roles FOR ALL
  USING (true)
  WITH CHECK (true);
```

**Problem:** This RLS policy uses `USING (true) WITH CHECK (true)` which grants unrestricted read/write/delete to ANY role that passes the policy check. While the intention is to allow the service role key to manage roles, this policy actually applies to ALL roles if other policies don't explicitly restrict. In PostgreSQL RLS, policies are OR'd together by default -- meaning the `authenticated` role (which is granted SELECT on this table at line 76) gets its SELECT checked against the union of both policies.

More critically, the policy name suggests it targets the service role, but it does NOT actually restrict to the service role. If ANY future policy or grant gives `authenticated` users DML access beyond SELECT, this wide-open policy becomes exploitable.

The current GRANT/REVOKE setup (lines 68-76) mitigates this because `authenticated` only has SELECT. But this is fragile -- a single `GRANT INSERT ON public.user_roles TO authenticated` would allow any authenticated user to assign themselves the `owner` role via this `USING (true) WITH CHECK (true)` policy.

**Fix:** Either restrict the policy to the service role explicitly:

```sql
CREATE POLICY "Service role can manage all roles"
  ON public.user_roles FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
```

Or if using `supabase_auth_admin` as the managing role, restrict to that. The key point is: never use `USING (true)` on a table that controls authorization decisions.

---

### HIGH-3: `.gitignore` Does Not Exclude Base `.env` File

**Severity:** HIGH
**Category:** OWASP F (Secrets & Credentials), .env Exposure
**File:** `.gitignore` lines 27-29

**Evidence:**

```gitignore
# env files
.env.local
.env*.local
!.env.local.example
```

**Problem:** The `.gitignore` only excludes `.env.local` and `.env*.local`. A bare `.env` file is NOT excluded. If anyone creates a `.env` file (a common developer habit, especially when following tutorials or copying from other projects), it will be tracked by git and potentially committed with real secrets.

The `.env.production`, `.env.staging`, `.env.development` files are also not excluded -- only files matching `*.local` are ignored. This is a time bomb waiting for the first developer who does:

```bash
cp .env.local .env
# or
echo "DATABASE_URL=postgres://..." > .env
```

**Fix:** Add comprehensive `.env` exclusion:

```gitignore
# env files
.env
.env.*
!.env.local.example
!.env.example
```

---

### HIGH-4: `SKIP_ENV_VALIDATION` Bypass Allows Running Without Secret Validation

**Severity:** HIGH
**Category:** OWASP A02 (Security Misconfiguration)
**File:** `src/env.ts` line 43

**Evidence:**

```typescript
// line 43
skipValidation: !!process.env.SKIP_ENV_VALIDATION,
```

**Problem:** The T3 env validation can be entirely bypassed by setting `SKIP_ENV_VALIDATION=true`. When skipped, ALL Zod schemas are bypassed, meaning:

1. The app can start with missing `SUPABASE_SERVICE_ROLE_KEY` and crash at runtime when `admin.ts` tries to use it.
2. More dangerously, the validation that prevents server secrets from leaking via `NEXT_PUBLIC_` prefix is skipped.
3. If a CI/CD pipeline or Docker build sets this flag, the production deployment runs without any env validation.

This is commonly set during Docker builds (where env vars are not available at build time), but the lack of a runtime check after build means production can run with invalid or missing secrets.

**Fix:** At minimum, restrict `skipValidation` to build-time only and add a runtime guard:

```typescript
skipValidation: !!process.env.SKIP_ENV_VALIDATION && process.env.NODE_ENV !== "production",
```

Or better, use `skipValidation` only during `next build` and validate at server startup:

```typescript
skipValidation: !!process.env.CI,  // Only during CI builds
```

---

### HIGH-5: Supabase Auth Error Message Reflected Directly to User

**Severity:** HIGH
**Category:** OWASP A09 (Security Logging Failures), Information Disclosure
**Files:** `src/app/(auth)/sign-in/page.tsx` line 24, `src/app/(auth)/sign-up/page.tsx` line 27

**Evidence:**

```typescript
// sign-in/page.tsx line 24
setError(error.message);

// sign-up/page.tsx line 27
setError(error.message);
```

And then rendered directly:

```tsx
// sign-in/page.tsx lines 41-43
{error && (
  <div className="bg-[var(--color-error-bg)] ...">
    {error}
  </div>
)}
```

**Problem:** Supabase auth error messages are displayed verbatim to the user. Supabase error messages can include:

1. **User enumeration** -- "Invalid login credentials" vs "User not found" reveals whether an email is registered.
2. **Rate limit details** -- "For security purposes, you can only request this after X seconds" reveals rate limiting thresholds.
3. **Internal configuration** -- "Email signups are disabled" or "Password should be at least X characters" reveals auth configuration.
4. **Stack trace fragments** -- In edge cases, Supabase errors can include internal details.

For a construction business platform, user enumeration is a real risk -- attackers can verify which contractor emails are registered.

**Fix:** Map Supabase errors to generic user-facing messages:

```typescript
function getUserFriendlyError(error: AuthError): string {
  switch (error.status) {
    case 400: return "Invalid email or password.";
    case 422: return "Please check your input and try again.";
    case 429: return "Too many attempts. Please try again later.";
    default: return "An error occurred. Please try again.";
  }
}
```

---

### MED-1: No Rate Limiting on Authentication Endpoints

**Severity:** MEDIUM
**Category:** OWASP N (Rate Limiting & DoS)
**Files:** `src/app/(auth)/sign-in/page.tsx`, `src/app/(auth)/sign-up/page.tsx`, `src/middleware.ts`

**Problem:** There is no rate limiting at any layer:

1. No rate limiting middleware in `src/middleware.ts`.
2. No rate limiting on the sign-in/sign-up forms (no client-side throttle, no submission count tracking).
3. No API route rate limiting (no API routes exist yet, but no pattern is established).

While Supabase has its own rate limiting on the auth endpoints (GoTrue), the middleware performs a full `getUser()` call on EVERY request (including static assets not matched by the matcher). A determined attacker can spam requests to trigger Supabase rate limits, causing legitimate user authentication refreshes to fail.

**Fix:** Add rate limiting middleware (e.g., `next-rate-limit`, custom token bucket, or Vercel Edge Rate Limiting). At minimum, implement client-side debouncing on auth form submissions.

---

### MED-2: Middleware Processes All Non-Static Routes Including Public Assets

**Severity:** MEDIUM
**Category:** Performance-Security (DoS Vector)
**File:** `src/middleware.ts` lines 9-11

**Evidence:**

```typescript
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

**Problem:** The matcher regex only excludes `_next/static`, `_next/image`, `favicon.ico`, and common image extensions. This means middleware runs (and calls `supabase.auth.getUser()` which makes a network request to Supabase) on:

1. Every API route (future)
2. Every page navigation
3. Requests for fonts, CSS files, PDFs, or any non-image static asset
4. Robot.txt, sitemap.xml, manifest.json

Each middleware invocation makes a network call to Supabase to validate the session. This creates a DoS amplification vector -- one client request generates one Supabase API call. Under load, this can exhaust Supabase rate limits.

**Fix:** Add more exclusions to the matcher and consider caching the auth check result:

```typescript
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/health|robots.txt|sitemap.xml|manifest.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp|css|js|woff|woff2|ttf|eot|ico|pdf)$).*)",
  ],
};
```

---

### MED-3: Missing CSRF Protection Pattern for Future Server Actions/API Routes

**Severity:** MEDIUM
**Category:** OWASP D (CSRF)
**Files:** No API routes exist yet, but no CSRF pattern is established

**Problem:** The codebase currently has no API routes, but the architecture is clearly heading toward server actions and API routes for construction data CRUD operations. There is no established pattern for CSRF protection:

1. No CSRF token generation or validation utility exists.
2. No `SameSite` cookie configuration is explicitly set (relies on Supabase defaults).
3. No `Origin` or `Referer` header validation in middleware.
4. No server action framework with built-in CSRF protection is established.

When Phase 1A begins (database schema + CRUD operations), the natural tendency will be to add server actions or API routes without CSRF protection, creating a vulnerability window.

**Fix:** Establish the CSRF pattern now before data-mutation code is written. Next.js Server Actions have built-in CSRF protection since Next.js 14, but API Route handlers do not. Document the pattern in the project's architecture rules.

---

### MED-4: Auth Callback Lacks Error Logging (Silent Failure)

**Severity:** MEDIUM
**Category:** OWASP A09 (Security Logging Failures)
**File:** `src/app/auth/callback/route.ts` lines 9-18

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

**Problem:** When `exchangeCodeForSession` fails, the error is silently discarded. The user is redirected to sign-in with a generic error parameter, but:

1. The actual Supabase error is never logged anywhere.
2. Failed auth code exchanges (which could indicate token theft attempts, replay attacks, or expired codes) leave no server-side audit trail.
3. When `code` is null/missing (line 9), it also silently redirects -- no logging of the attempt.

For a business application handling construction contracts and financial data, auth failures should always be logged.

**Fix:** Add structured server-side logging:

```typescript
if (error) {
  console.error("[auth/callback] Code exchange failed:", {
    error: error.message,
    status: error.status,
    timestamp: new Date().toISOString(),
    // Do NOT log the code itself
  });
}
```

---

## Positive Security Patterns (What Was Done Right)

These patterns demonstrate good security awareness and should be maintained as the codebase grows:

1. **`server-only` import guard on admin client** (`src/lib/supabase/admin.ts:1`) -- Prevents the service role key from being bundled into client JavaScript. Verified by test `SEC-L3-01`.

2. **`getUser()` over `getSession()` in middleware** (`src/lib/supabase/middleware.ts:30`) -- Uses the server-validated method that makes a network call to Supabase auth, rather than trusting the JWT from cookies which could be tampered with. Verified by test `SEC-L3-02`.

3. **T3 env validation with Zod** (`src/env.ts`) -- Clear separation of `server` and `client` env schemas. Server secrets cannot be prefixed with `NEXT_PUBLIC_`. Verified by test `SEC-L3-03`.

4. **Azure Key Vault for secrets management** (`scripts/pull-env.sh`) -- Secrets are pulled from Azure Key Vault rather than committed. The script includes a warning comment "NEVER prefix with NEXT_PUBLIC_" for server-only vars.

5. **Admin client disables session persistence** (`src/lib/supabase/admin.ts:14-16`) -- `persistSession: false`, `autoRefreshToken: false`, `detectSessionInUrl: false` prevents the admin client from accidentally storing the service role session.

6. **Security test suite** (`tests/security/secrets.test.ts`) -- Automated tests verify the `server-only` guard, `getUser()` usage, and env prefix correctness.

7. **GRANT/REVOKE on user_roles table** (`supabase/migrations/...` lines 68-76) -- Explicitly revokes DML from `authenticated`, `anon`, and `public` roles, only granting SELECT to `authenticated`.

8. **No `dangerouslySetInnerHTML`, `eval()`, or `innerHTML`** -- Clean React rendering throughout.

9. **No CVE-2025-29927 vulnerability** -- No `x-middleware-subrequest` header handling found. Next.js 16.2.2 is not affected by this CVE (patched in 15.2.3+).

10. **Clean npm audit** -- Zero known vulnerabilities in 537 dependencies.

---

## Summary Table

| ID | Severity | Category | File | Line(s) | Status |
|----|----------|----------|------|---------|--------|
| CRIT-1 | CRITICAL | Open Redirect | src/app/auth/callback/route.ts | 7, 14 | Must fix before production |
| HIGH-1 | HIGH | Missing Security Headers | next.config.ts | all | Must fix |
| HIGH-2 | HIGH | Overpermissive RLS Policy | supabase/migrations/...auth_roles.sql | 33-35 | Must fix |
| HIGH-3 | HIGH | .gitignore Missing .env | .gitignore | 27-29 | Must fix |
| HIGH-4 | HIGH | SKIP_ENV_VALIDATION Bypass | src/env.ts | 43 | Must fix |
| HIGH-5 | HIGH | Auth Error Info Disclosure | src/app/(auth)/sign-in/page.tsx | 24 | Should fix |
| MED-1 | MEDIUM | No Rate Limiting | middleware.ts, auth pages | -- | Establish pattern |
| MED-2 | MEDIUM | Middleware Over-matching | src/middleware.ts | 9-11 | Optimize |
| MED-3 | MEDIUM | No CSRF Pattern | -- | -- | Establish before Phase 1A |
| MED-4 | MEDIUM | Silent Auth Failure | src/app/auth/callback/route.ts | 9-18 | Add logging |

---

## Recommendations Priority

1. **Immediate (blocks deployment):** Fix CRIT-1 (open redirect in auth callback)
2. **This sprint:** Fix HIGH-1 through HIGH-5 (security headers, RLS policy, .gitignore, env validation, error messages)
3. **Before Phase 1A:** Establish rate limiting and CSRF patterns (MED-1, MED-3)
4. **Ongoing:** Add structured logging (MED-4), optimize middleware matching (MED-2)
