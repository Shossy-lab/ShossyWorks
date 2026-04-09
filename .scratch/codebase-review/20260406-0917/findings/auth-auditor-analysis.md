# A2 -- Auth Auditor Analysis

**Reviewer:** A2 (Auth Auditor)
**Date:** 2026-04-06
**Codebase:** ShossyWorks (Phase 0 -- auth scaffolding complete)
**Scope:** Authentication/authorization flow completeness, token refresh, route protection, admin client isolation, role injection security, getUser() vs getSession(), RLS on user_roles table

---

## Executive Summary

The auth foundation is competently built. The codebase correctly uses `getUser()` instead of `getSession()` everywhere, the admin client is properly isolated with `server-only`, and the Custom Access Token Hook for role injection follows Supabase best practices. However, there are several HIGH-severity gaps that will become exploitable the moment Phase 1A adds real data and server actions. Two findings are rated CRITICAL because they represent vulnerabilities that exist right now in the deployed production application.

---

## CRITICAL Findings

### C1. Open Redirect in Auth Callback via Unvalidated `next` Parameter

**Severity:** CRITICAL
**Checklist:** #79 (Redirect URL Validation)
**File:** `src/app/auth/callback/route.ts`, lines 7 and 14

```typescript
const next = searchParams.get("next") ?? "/dashboard";
// ...
return NextResponse.redirect(`${origin}${next}`);
```

**The Problem:** The `next` parameter is read directly from the URL query string and used in a redirect without any validation. An attacker can craft a URL like:

```
https://shossy-works.vercel.app/auth/callback?code=VALID_CODE&next=//evil.com
```

The URL `//evil.com` is a protocol-relative URL. When concatenated with `origin`, the result is `https://shossy-works.vercel.app//evil.com`. While this specific attack depends on browser URL resolution, there are more reliable variants:

```
/auth/callback?code=VALID&next=/%09/evil.com
/auth/callback?code=VALID&next=/\evil.com
```

Additionally, even staying within the origin, an attacker can redirect to any path -- including future API routes that might perform destructive actions via GET requests.

**Impact:** After a successful OAuth login, the user is redirected to an attacker-controlled URL. The user has just authenticated and is primed to trust the next page they see. This is a classic phishing vector: the attacker can present a fake login page to harvest credentials.

**Fix:**

```typescript
// Validate next parameter is a relative path starting with /
const rawNext = searchParams.get("next") ?? "/dashboard";
const next = rawNext.startsWith("/") && !rawNext.startsWith("//")
  ? rawNext
  : "/dashboard";
```

Or better, maintain an allowlist of valid redirect prefixes:

```typescript
const ALLOWED_PREFIXES = ["/dashboard", "/projects", "/settings"];
const next = ALLOWED_PREFIXES.some(p => rawNext.startsWith(p))
  ? rawNext
  : "/dashboard";
```

---

### C2. RLS Policy on `user_roles` Grants Service Role Unrestricted Access via Overly Permissive `FOR ALL` Policy

**Severity:** CRITICAL
**Checklist:** #56 (RLS Policy Gaps), #60 (RLS Policy Anti-Patterns), #82 (Admin Escalation Protection)
**File:** `supabase/migrations/00000000000001_auth_roles.sql`, lines 33-35

```sql
CREATE POLICY "Service role can manage all roles"
  ON public.user_roles FOR ALL
  USING (true)
  WITH CHECK (true);
```

**The Problem:** This policy applies to ALL roles (authenticated, anon, service_role) because there is no role check in the USING or WITH CHECK clauses. The policy name says "Service role" but the SQL does not restrict to the service role. In PostgreSQL RLS, when multiple policies exist for the same operation, they are OR'd together. This means:

1. The SELECT policy restricts users to their own role record -- good.
2. The `FOR ALL` policy with `USING(true)` grants SELECT/INSERT/UPDATE/DELETE to everyone -- this overrides policy #1 for all operations.

Any authenticated user can:
- Read all other users' roles
- Change their own role to `owner`
- Change other users' roles
- Delete role records

The `REVOKE ALL ... FROM authenticated` and subsequent `GRANT SELECT ... TO authenticated` on lines 72-76 do mitigate this at the table privilege level -- authenticated users only have SELECT privilege, so they cannot INSERT/UPDATE/DELETE even though the policy would allow it. However, the policy is still dangerously misconfigured because:

- The GRANT/REVOKE approach is fragile -- a future migration adding `GRANT INSERT ON user_roles TO authenticated` (e.g., for self-registration) would immediately expose the privilege escalation.
- The `FOR ALL USING(true)` policy still means any authenticated user can SELECT all rows in user_roles, bypassing the "Users can read their own role" policy.

**Impact:** Right now, any authenticated user can read every user's role assignment. If table privileges are ever broadened (common during Phase 1A schema work), full privilege escalation becomes possible.

**Fix:** Add a role check to the policy:

```sql
CREATE POLICY "Service role can manage all roles"
  ON public.user_roles FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
```

Or better, use `TO` clause to target the policy:

```sql
CREATE POLICY "Service role can manage all roles"
  ON public.user_roles FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
```

---

## HIGH Findings

### H1. No Defense in Depth -- Auth Only in Middleware, Zero Server-Side Verification in Pages

**Severity:** HIGH
**Checklist:** #78 (Defense in Depth), #84 (Missing Auth on API Routes)
**Files:** `src/app/(protected)/dashboard/page.tsx`, `src/app/(protected)/projects/page.tsx`, `src/app/(protected)/settings/page.tsx`

**The Problem:** The protected pages under `(protected)/` are static placeholder pages that do not perform any server-side auth check themselves. The protected layout (`src/app/(protected)/layout.tsx`) does call `getUser()` (line 10), which provides a second layer of defense beyond middleware. This is good.

However, the individual page components perform zero auth verification. Currently this is mitigated by the layout check, but as the application grows:

1. **Server actions** added to these pages will have no auth check pattern to follow -- there is no helper, no wrapper, no convention established.
2. **API routes** do not exist yet, but when they do, there is no auth utility or pattern for route handlers to use.
3. Next.js App Router allows direct navigation to page components in certain edge cases (ISR, streaming) where layouts may not re-execute.

The absence of any shared auth utility function (e.g., `requireAuth()` that returns the user or redirects) means every future developer will need to independently implement auth checks, increasing the probability of mistakes.

**Impact:** No immediate exploit, but this is a systemic gap that will produce vulnerabilities when Phase 1A adds data access and mutations. The risk is "when, not if."

**Fix:** Create a shared auth utility:

```typescript
// src/lib/auth.ts
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function requireAuth() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");
  return user;
}

export async function requireRole(role: "owner" | "employee" | "client") {
  const user = await requireAuth();
  // Read role from JWT claims or database
  // Redirect/throw if insufficient
  return user;
}
```

---

### H2. Custom Access Token Hook Defaults Unregistered Users to `employee` Role

**Severity:** HIGH
**Checklist:** #82 (Admin Escalation Protection), #83 (Supabase Custom Claims for RBAC)
**File:** `supabase/migrations/00000000000001_auth_roles.sql`, lines 57-59

```sql
ELSE
  -- Default to 'employee' if no role record exists
  claims := jsonb_set(claims, '{app_metadata,user_role}', '"employee"');
END IF;
```

**The Problem:** When a user signs up and has no record in `user_roles`, the Custom Access Token Hook assigns them the `employee` role by default. This means:

1. Any user who creates an account via the public sign-up page immediately gets `employee` access.
2. There is no approval workflow -- signup alone grants the role.
3. For a construction estimating platform, `employee` likely grants access to project data, financials, and client information.

The sign-up page (`src/app/(auth)/sign-up/page.tsx`) is publicly accessible and has no invitation code, domain restriction, or admin approval flow.

**Combined attack:** Anyone on the internet can:
1. Sign up at `/sign-up`
2. Immediately receive `employee` role in their JWT
3. Access all `employee`-level protected resources

**Impact:** Unauthorized access to business data. In a construction estimating platform, this could expose bid pricing, client contacts, cost breakdowns, and profit margins.

**Fix options (choose one or combine):**
- Default to a `pending` or `unverified` role that has no data access
- Require an invitation code or admin approval before granting `employee`
- Restrict sign-up to specific email domains
- Add a `user_roles` insert trigger on auth.users that defaults to `pending`

---

### H3. Sign-Up Flow Skips Email Verification Before Granting Access

**Severity:** HIGH
**Checklist:** #64 (Email Verification), #62 (Login/Logout/Signup Flow Completeness)
**File:** `src/app/(auth)/sign-up/page.tsx`, lines 20-31

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

**The Problem:** After `signUp()`, the code immediately redirects to `/dashboard` regardless of whether the email has been verified. Supabase's `signUp()` returns a user object even before email confirmation (the user is created with `email_confirmed_at = null` unless Supabase project settings require confirmation).

Two scenarios depending on Supabase project config:

1. **If email confirmation is disabled** (Supabase default for new projects): The user is fully authenticated immediately. No email verification happens at all.
2. **If email confirmation is enabled**: The user gets redirected to `/dashboard`, hits the middleware `getUser()` check, and either gets through (Supabase returns the user even if unconfirmed in some configurations) or gets bounced to sign-in with no explanation.

Neither scenario is correct. The proper flow is: sign up -> show "check your email" page -> user clicks confirmation link -> callback route exchanges code -> redirect to dashboard.

**Impact:** Without email verification, anyone can create accounts with fake email addresses, making account recovery impossible and enabling account squatting. Combined with H2 (auto-employee role), this means unverified accounts get immediate business data access.

**Fix:**

```typescript
// After signUp(), redirect to a confirmation page instead of dashboard
if (!error) {
  router.push("/sign-up/confirm");
  return;
}
```

Create `src/app/(auth)/sign-up/confirm/page.tsx` with a "Check your email" message. Ensure Supabase project has email confirmation enabled in Authentication > Settings.

---

### H4. Missing `onAuthStateChange` Listener for Client-Side Auth State Sync

**Severity:** HIGH
**Checklist:** #75 (Client-Side Auth State Sync), #112 (Tab/Window Auth Sync)
**Files:** `src/lib/supabase/client.ts`, `src/app/(auth)/sign-in/page.tsx`, `src/components/nav/user-menu.tsx`

**The Problem:** The browser Supabase client is created without an `onAuthStateChange` listener anywhere in the application. This listener is essential for:

1. **Token refresh**: The Supabase client needs to detect when the access token is nearing expiration and trigger a refresh. Without `onAuthStateChange`, the client-side token can expire silently, causing subsequent API calls to fail with 401 errors.
2. **Cross-tab sync**: If a user signs out in one tab, other tabs continue to show the authenticated UI with a stale session.
3. **Session recovery**: After a browser returns from sleep/background, the session state may be stale.

The middleware handles token refresh for server-side requests, but client-side Supabase calls (which will be added in Phase 1A for realtime features, client-side data fetching, etc.) will use stale tokens.

**Impact:** Users will experience intermittent auth failures after their access token expires (default: 1 hour). This creates a poor UX and can cause data loss if a form submission fails silently due to an expired token.

**Fix:** Create an auth state provider:

```typescript
// src/components/providers/auth-provider.tsx
"use client";
import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  useEffect(() => {
    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event) => {
        if (event === "SIGNED_OUT") {
          router.push("/sign-in");
          router.refresh();
        }
        if (event === "TOKEN_REFRESHED") {
          router.refresh(); // Sync server components
        }
      }
    );
    return () => subscription.unsubscribe();
  }, [router]);
  return <>{children}</>;
}
```

---

### H5. Sign-Out Does Not Use `scope: 'global'` -- Other Sessions Remain Active

**Severity:** HIGH
**Checklist:** #101 (Token Revocation), #68 (Concurrent Session Handling)
**File:** `src/components/nav/user-menu.tsx`, line 11

```typescript
await supabase.auth.signOut();
```

**The Problem:** `signOut()` without specifying a scope defaults to `scope: 'local'`, which only invalidates the current browser session. If the user is logged in on multiple devices (phone, laptop, shared computer), those sessions remain active.

For a construction estimating platform that will handle sensitive financial data, this is a significant concern:
- A user signs in on a shared worksite computer
- Signs out when they leave
- Their session remains active on that shared computer

**Impact:** Sessions persist on other devices after sign-out, potentially allowing unauthorized access to financial and project data.

**Fix:**

```typescript
await supabase.auth.signOut({ scope: 'global' });
```

Or provide a UI option: "Sign out of all devices" vs "Sign out of this device."

---

### H6. No Password Reset Flow Exists

**Severity:** HIGH
**Checklist:** #63 (Password Reset Flow)
**Files:** Entire `src/app/(auth)/` directory

**The Problem:** There is no password reset or "forgot password" functionality anywhere in the codebase. The sign-in page has no "Forgot password?" link. No route exists for password reset.

**Impact:** Users who forget their passwords have no way to recover their accounts. This is a basic auth flow that must exist before the application handles real user data. The lack of this flow will generate support requests and frustrate users.

**Fix:** Implement the standard Supabase password reset flow:
1. Add "Forgot password?" link to sign-in page
2. Create `/forgot-password` page that calls `supabase.auth.resetPasswordForEmail()`
3. Create `/auth/callback` handling for `type=recovery` (already partially handled)
4. Create `/reset-password` page that calls `supabase.auth.updateUser({ password })`

---

### H7. Sign-In Page Exposes Raw Supabase Error Messages to Users

**Severity:** HIGH
**Checklist:** #106 (Information Leaking Error Messages), #108 (User Enumeration)
**File:** `src/app/(auth)/sign-in/page.tsx`, lines 23-24

```typescript
if (error) {
  setError(error.message);
```

**The Problem:** Supabase Auth returns different error messages for different failure scenarios:
- "Invalid login credentials" (user exists, wrong password)
- "Email not confirmed" (user exists, unverified)
- "User not found" (no such user -- in some configurations)

Displaying `error.message` directly exposes Supabase's internal error strings. While Supabase has improved this in recent versions (using "Invalid login credentials" for both cases), the raw error message may still leak implementation details in edge cases (rate limiting, email not confirmed, etc.).

The same issue exists in `sign-up/page.tsx` (line 27).

**Impact:** Potential user enumeration if Supabase configuration or version returns distinguishable errors. Information leakage about implementation details.

**Fix:**

```typescript
if (error) {
  // Map specific errors to user-friendly messages
  const userMessage = error.message.includes("Invalid login")
    ? "Invalid email or password"
    : "Something went wrong. Please try again.";
  setError(userMessage);
}
```

---

### H8. No Security Headers Configured

**Severity:** HIGH
**Checklist:** #41 (CSP), #42 (HSTS), #43 (X-Frame-Options)
**File:** `next.config.ts`

```typescript
const nextConfig: NextConfig = {
  /* config options here */
};
```

**The Problem:** The Next.js config is empty. No security headers are configured:
- No Content-Security-Policy (CSP)
- No Strict-Transport-Security (HSTS)
- No X-Frame-Options (clickjacking protection)
- No X-Content-Type-Options
- No Referrer-Policy
- `poweredByHeader` not disabled (default: enabled, exposes "X-Powered-By: Next.js")

While Vercel provides some default headers, relying on deployment platform defaults is fragile and does not cover CSP.

**Impact:** The application is vulnerable to clickjacking, MIME sniffing attacks, and lacks defense-in-depth against XSS via CSP. The X-Powered-By header reveals the tech stack to attackers.

**Fix:**

```typescript
const nextConfig: NextConfig = {
  poweredByHeader: false,
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        {
          key: "Content-Security-Policy",
          value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://*.supabase.co wss://*.supabase.co;",
        },
      ],
    },
  ],
};
```

---

### H9. No Rate Limiting on Auth Endpoints

**Severity:** HIGH
**Checklist:** #54 (Missing Rate Limits), #98 (Brute Force Protection)
**Files:** `src/app/(auth)/sign-in/page.tsx`, `src/app/(auth)/sign-up/page.tsx`

**The Problem:** There is no rate limiting on authentication attempts at the application level. While Supabase has its own server-side rate limiting (typically 30 requests per hour for auth endpoints by default), the application does not:

1. Implement any client-side throttling or progressive delay
2. Track failed login attempts
3. Implement account lockout after N failures
4. Add CAPTCHA for repeated failures

The middleware processes every auth-related request without any throttling.

**Impact:** Brute force attacks against user accounts. While Supabase's server-side limits provide some protection, they are configurable and may be set permissively. Defense in depth requires application-level controls as well.

**Fix (short-term):** Add client-side progressive delay after failed attempts. **Fix (long-term):** Add server-side rate limiting via middleware or API route handlers using a library like `rate-limiter-flexible` or Vercel's `@vercel/rate-limit`.

---

## MEDIUM Findings

### M1. Custom Access Token Hook Function Lacks `SECURITY INVOKER` Annotation

**Severity:** MEDIUM
**Checklist:** #60 (RLS Policy Anti-Patterns), #91 (Views and Functions Bypassing RLS)
**File:** `supabase/migrations/00000000000001_auth_roles.sql`, line 39

```sql
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
```

**The Problem:** The function does not specify `SECURITY INVOKER` or `SECURITY DEFINER`. PostgreSQL defaults to `SECURITY INVOKER`, which is the correct behavior for this function. However, this should be explicitly stated for clarity and to prevent accidental changes.

The function is also correctly restricted via `REVOKE EXECUTE ... FROM authenticated, anon, public` (line 73), meaning only `supabase_auth_admin` can call it. This is properly secured.

However, the function is marked `STABLE` when it should arguably be `VOLATILE` since user roles can change between calls within the same transaction. `STABLE` tells PostgreSQL the function returns the same result for the same arguments within a single statement, which could cause stale role data to be cached in the JWT during complex multi-statement transactions.

**Impact:** Low immediate risk due to the REVOKE protections, but the implicit SECURITY INVOKER and questionable STABLE marking should be made explicit for maintenance clarity.

---

### M2. No Logging or Audit Trail for Auth Events

**Severity:** MEDIUM
**Checklist:** #113 (Auth Event Logging), #114 (Failed Login Tracking)
**Files:** All auth flow files

**The Problem:** No auth events are logged anywhere in the application:
- No login attempt logging (successful or failed)
- No sign-up event tracking
- No sign-out recording
- No role change auditing

Supabase provides `auth.audit_log_entries` on the server side, but the application layer has no structured logging, no Sentry/Datadog integration, and no custom audit trail.

**Impact:** If an account compromise occurs, there is no application-level evidence trail. Incident response and forensics will rely entirely on Supabase dashboard logs, which may have limited retention.

---

### M3. `SKIP_ENV_VALIDATION` Escape Hatch Could Mask Missing Auth Config in Production

**Severity:** MEDIUM
**Checklist:** #2 (Security Misconfiguration)
**File:** `src/env.ts`, line 43

```typescript
skipValidation: !!process.env.SKIP_ENV_VALIDATION,
```

**The Problem:** The `SKIP_ENV_VALIDATION` environment variable bypasses all Zod validation of environment variables. If this is set in a production environment (intentionally or accidentally), the application could start without the Supabase URL, anon key, or other critical auth configuration, leading to runtime crashes or -- worse -- silent auth bypasses where undefined env vars cause auth checks to return false/null instead of failing loudly.

**Impact:** If `SKIP_ENV_VALIDATION=1` is set in production, environment variable validation is completely bypassed. A missing `SUPABASE_SERVICE_ROLE_KEY` would cause the admin client to throw at runtime instead of at startup, potentially in the middle of a critical operation.

---

## Positive Findings (What the Codebase Gets Right)

These patterns demonstrate security awareness and should be preserved as the codebase grows:

### P1. Correct Use of `getUser()` Over `getSession()` Everywhere

Every server-side auth check uses `supabase.auth.getUser()`, which validates the JWT against the Supabase Auth server, rather than `getSession()` which only reads from potentially tampered cookies. This is verified by an automated test (`SEC-L3-02`).

- `src/lib/supabase/middleware.ts`, line 30: `await supabase.auth.getUser()`
- `src/app/(protected)/layout.tsx`, line 10: `await supabase.auth.getUser()`

### P2. Admin Client Properly Isolated with `server-only`

`src/lib/supabase/admin.ts` uses `import "server-only"` which causes a build-time error if the module is imported in a client component. This prevents accidental service role key exposure. Verified by automated test (`SEC-L3-01`).

### P3. Sensitive Keys Properly Separated from Client Keys in Env Config

`src/env.ts` correctly separates server-only variables from `NEXT_PUBLIC_` client variables. The service role key, database URL, and JWT secret are all in the `server` block. Verified by automated test (`SEC-L3-03`).

### P4. Cookie Handling Follows Supabase SSR Best Practices

The middleware (`src/lib/supabase/middleware.ts`) correctly implements the Supabase SSR cookie pattern with `getAll` and `setAll`, propagating cookies to both the request and response. This ensures token refresh works correctly across server components.

### P5. Middleware Matcher Covers All Routes

The middleware matcher `/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)` correctly covers all non-static routes, ensuring the auth check runs on every page request.

### P6. RLS Is Enabled on `user_roles` Table

The migration enables RLS on the user_roles table (`ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY`), preventing unauthenticated access via the REST API.

### P7. Security Tests Exist and Cover Key Patterns

The test suite in `tests/security/secrets.test.ts` verifies critical security properties:
- Admin client has `server-only` guard
- Middleware uses `getUser()` not `getSession()`
- Server-only env vars lack `NEXT_PUBLIC_` prefix
- Example env file contains no real secrets

---

## Risk Matrix Summary

| ID | Finding | Severity | Exploitable Now? | Effort to Fix |
|----|---------|----------|------------------|---------------|
| C1 | Open redirect in auth callback | CRITICAL | Yes | 15 min |
| C2 | RLS policy `FOR ALL USING(true)` on user_roles | CRITICAL | Partially (read-only) | 15 min |
| H1 | No defense-in-depth auth utilities | HIGH | No (needs data) | 1 hour |
| H2 | Auto-employee role for signups | HIGH | Yes | 30 min |
| H3 | No email verification before access | HIGH | Yes | 1 hour |
| H4 | Missing onAuthStateChange listener | HIGH | Not yet (no client data) | 30 min |
| H5 | Sign-out scope is local only | HIGH | Yes | 5 min |
| H6 | No password reset flow | HIGH | Yes (missing feature) | 2 hours |
| H7 | Raw error messages exposed | HIGH | Yes | 15 min |
| H8 | No security headers | HIGH | Yes | 30 min |
| H9 | No rate limiting on auth | HIGH | Yes (Supabase mitigates) | 1 hour |
| M1 | Hook lacks explicit SECURITY INVOKER | MEDIUM | No | 5 min |
| M2 | No auth event logging | MEDIUM | No | 2 hours |
| M3 | SKIP_ENV_VALIDATION risk | MEDIUM | Only if misconfigured | 15 min |

---

## Priority Remediation Order

1. **C1 -- Open redirect**: Fix immediately. This is exploitable today on the deployed Vercel instance.
2. **C2 -- RLS policy**: Fix the `FOR ALL USING(true)` policy to restrict to service_role.
3. **H2 + H3 -- Signup controls**: Either restrict who can sign up or add a `pending` role with no data access. Add email verification.
4. **H8 -- Security headers**: Add headers to next.config.ts.
5. **H7 -- Error messages**: Map Supabase errors to generic user-facing messages.
6. **H5 -- Sign-out scope**: One-line fix, deploy immediately.
7. **H1 -- Auth utilities**: Create `requireAuth()` and `requireRole()` before Phase 1A begins.
8. **H6 -- Password reset**: Implement before any real users are onboarded.
9. **H4 -- onAuthStateChange**: Implement before client-side data fetching is added.
10. **H9 -- Rate limiting**: Implement before public launch.

---

## Files Reviewed

| File | Auth Relevance |
|------|---------------|
| `src/lib/supabase/server.ts` | Server client factory |
| `src/lib/supabase/client.ts` | Browser client factory |
| `src/lib/supabase/admin.ts` | Admin (service role) client factory |
| `src/lib/supabase/middleware.ts` | Token refresh + route protection |
| `src/middleware.ts` | Middleware entry + matcher config |
| `src/env.ts` | Environment variable validation |
| `src/app/(auth)/sign-in/page.tsx` | Sign-in flow |
| `src/app/(auth)/sign-up/page.tsx` | Sign-up flow |
| `src/app/auth/callback/route.ts` | OAuth/email callback handler |
| `src/app/(protected)/layout.tsx` | Protected route layout with auth check |
| `src/app/(protected)/dashboard/page.tsx` | Dashboard page (placeholder) |
| `src/app/(protected)/projects/page.tsx` | Projects page (placeholder) |
| `src/app/(protected)/settings/page.tsx` | Settings page (placeholder) |
| `src/app/page.tsx` | Root redirect to dashboard |
| `src/components/nav/user-menu.tsx` | Sign-out handler |
| `src/components/nav/sidebar.tsx` | Navigation (no auth logic) |
| `supabase/migrations/00000000000001_auth_roles.sql` | Role enum, user_roles table, RLS, Custom Access Token Hook |
| `next.config.ts` | Next.js configuration (empty) |
| `tests/security/secrets.test.ts` | Security regression tests |
| `tests/smoke/supabase.test.ts` | Connection smoke tests |
| `.gitignore` | Env file exclusion patterns |
| `.env.local.example` | Example env (verified no secrets) |
| `scripts/pull-env.sh` | Azure Key Vault secret retrieval |
| `package.json` | Dependency versions |
