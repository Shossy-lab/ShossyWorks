# A10 -- Error Handling Reviewer Analysis

**Agent:** A10 (Error Handling Reviewer)
**Date:** 2026-04-06
**Scope:** Error boundaries, unhandled promise rejections, empty catch blocks, error message exposure, graceful degradation, loading states, error recovery patterns
**Codebase:** ShossyWorks -- ~721 LOC, 13 TS + 10 TSX files
**Checklist Items Covered:** 60-74

---

## Summary Statistics

| Severity | Count |
|----------|-------|
| CRITICAL | 5     |
| HIGH     | 6     |
| MEDIUM   | 4     |
| **Total** | **15** |

---

## CRITICAL Findings

---

### C1. No Error Boundary Files Exist Anywhere in the App Router

**Checklist:** Item 62 (Next.js Error Handling Files)
**Severity:** CRITICAL
**Files Missing:**
- `src/app/error.tsx` -- root error boundary
- `src/app/global-error.tsx` -- root layout error boundary (catches errors in root layout itself)
- `src/app/not-found.tsx` -- custom 404 page
- `src/app/(protected)/error.tsx` -- protected route error boundary
- `src/app/(auth)/error.tsx` -- auth route error boundary
- `src/app/(protected)/loading.tsx` -- loading state for protected routes

**Evidence:** Glob search for `**/error.tsx`, `**/global-error.tsx`, `**/not-found.tsx`, `**/loading.tsx` across `src/` returned zero results for all four patterns.

**Impact:** Any unhandled exception in any server component, layout, or page will show Next.js's default error page -- a white screen with a generic stack trace in development or a blank "Application error" in production. Users see no recovery path. There is no way to catch errors in the root layout without `global-error.tsx`.

The protected layout (`src/app/(protected)/layout.tsx`) makes a Supabase `getUser()` call on every request (line 10). If Supabase is unreachable, the user gets a crash screen with no explanation or retry.

**Fix:**
1. Create `src/app/global-error.tsx` (must be `'use client'`, must include `<html>` and `<body>` tags, must accept `error` and `reset` props).
2. Create `src/app/error.tsx` (must be `'use client'`, provides user-friendly error message and a "Try Again" button calling `reset()`).
3. Create `src/app/not-found.tsx` for 404 responses.
4. Create `src/app/(protected)/loading.tsx` with a skeleton or spinner.
5. Consider `src/app/(protected)/error.tsx` to handle Supabase errors in the protected area specifically.

---

### C2. Middleware Has No Error Handling -- Supabase Outage Crashes All Routes

**Checklist:** Item 60 (Unhandled Promise Rejections), Item 67 (Authentication Error Flows)
**Severity:** CRITICAL
**File:** `src/lib/supabase/middleware.ts`, lines 5-48
**File:** `src/middleware.ts`, lines 4-6

**Evidence:**

```typescript
// src/lib/supabase/middleware.ts, line 30
const {
  data: { user },
} = await supabase.auth.getUser();
```

```typescript
// src/middleware.ts, lines 4-6
export async function middleware(request: NextRequest) {
  return await updateSession(request);
}
```

The `updateSession()` function calls `supabase.auth.getUser()` with no try/catch. The `middleware()` function calls `updateSession()` with no try/catch. If Supabase is unreachable (network error, DNS failure, rate limit, service outage), the `getUser()` call throws. Since the middleware runs on EVERY non-static route (see the matcher config), a Supabase outage takes down the entire application -- including public routes.

The middleware matcher at `src/middleware.ts` line 9-11 matches all routes except static assets, meaning every single page request passes through this unprotected code path.

**Impact:** A transient Supabase outage (which Supabase has experienced historically) renders the entire application inaccessible. Users see a 500 error on every route, including sign-in and sign-up. There is no graceful degradation.

**Fix:**
```typescript
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  try {
    const supabase = createServerClient(/* ... */);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    // ... route protection logic ...
  } catch (error) {
    // Log server-side, don't expose to user
    console.error("Middleware auth check failed:", error);

    // On public routes, allow through (degrade gracefully)
    const publicRoutes = ["/sign-in", "/sign-up", "/auth/callback"];
    const isPublicRoute = publicRoutes.some((r) =>
      request.nextUrl.pathname.startsWith(r)
    );

    if (isPublicRoute) {
      return supabaseResponse; // Let public routes through
    }

    // On protected routes, redirect to sign-in with error
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.searchParams.set("error", "service_unavailable");
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
```

---

### C3. Sign-Out is Fire-and-Forget -- No Error Handling

**Checklist:** Item 60 (Unhandled Promise Rejections), Item 71 (Silent Failures)
**Severity:** CRITICAL
**File:** `src/components/nav/user-menu.tsx`, lines 9-14

**Evidence:**

```typescript
async function handleSignOut() {
  const supabase = createClient();
  await supabase.auth.signOut();
  router.push("/sign-in");
  router.refresh();
}
```

The `signOut()` call has no try/catch. If the network request fails, the entire `handleSignOut` function throws an unhandled rejection. The `onClick` handler (line 21) calls this async function without catching its result -- this is the classic fire-and-forget async pattern that produces unhandled promise rejections.

Additionally, even if `signOut()` returns an error object (which it does -- `{ error }`), the error property is completely ignored. The destructured return value is not captured at all.

**Impact:** If sign-out fails silently, the user is redirected to sign-in but their session cookies may still be valid. This creates a confusing state where the user appears logged out but their session persists. If `signOut()` throws entirely, the user sees an unhandled error in the console with no feedback.

**Fix:**
```typescript
async function handleSignOut() {
  const supabase = createClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    // Still redirect -- local cookies will eventually expire
    console.error("Sign out failed:", error.message);
  }

  router.push("/sign-in");
  router.refresh();
}
```

Wrap the `onClick` to catch unhandled rejections:
```typescript
onClick={() => void handleSignOut()}
// or
onClick={() => handleSignOut().catch(console.error)}
```

---

### C4. Auth Callback Silently Swallows Error Details

**Checklist:** Item 67 (Authentication Error Flows), Item 71 (Silent Failures)
**Severity:** CRITICAL
**File:** `src/app/auth/callback/route.ts`, lines 4-19
**File:** `src/app/(auth)/sign-in/page.tsx` (no error param handling)

**Evidence:**

```typescript
// src/app/auth/callback/route.ts
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/sign-in?error=auth_callback_error`);
}
```

Three problems here:

**Problem 1: Error details are discarded.** The `error` from `exchangeCodeForSession` contains specific information (expired code, invalid code, rate limit, etc.) but the redirect always uses the generic string `auth_callback_error`. No logging of the actual error occurs anywhere.

**Problem 2: The sign-in page ignores the error query parameter.** The sign-in page (`src/app/(auth)/sign-in/page.tsx`) does not read `searchParams` or `useSearchParams()`. When a user lands on `/sign-in?error=auth_callback_error`, they see a normal sign-in page with no indication that something failed. Grep for `searchParams` and `useSearchParams` in `src/app/(auth)/` returned zero results.

**Problem 3: No try/catch around `exchangeCodeForSession`.** If the call itself throws (network error), the entire route handler crashes with a 500 instead of redirecting gracefully.

**Impact:** Users who click an email confirmation link that has expired or is invalid are silently redirected to sign-in with no explanation. They don't know they need to request a new confirmation email. The error is lost completely -- not logged server-side, not shown to the user.

**Fix:**
```typescript
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);

      if (!error) {
        return NextResponse.redirect(`${origin}${next}`);
      }

      console.error("Auth callback exchange failed:", error.message);
      const errorType = error.message.includes("expired") ? "link_expired" : "auth_error";
      return NextResponse.redirect(`${origin}/sign-in?error=${errorType}`);
    } catch (err) {
      console.error("Auth callback threw:", err);
      return NextResponse.redirect(`${origin}/sign-in?error=service_error`);
    }
  }

  return NextResponse.redirect(`${origin}/sign-in?error=missing_code`);
}
```

Then update sign-in page to read and display the error parameter.

---

### C5. Auth Callback Has Open Redirect Vulnerability via `next` Parameter

**Checklist:** Item 67 (Authentication Error Flows)
**Severity:** CRITICAL
**File:** `src/app/auth/callback/route.ts`, lines 7, 14

**Evidence:**

```typescript
const next = searchParams.get("next") ?? "/dashboard";
// ...
return NextResponse.redirect(`${origin}${next}`);
```

The `next` parameter is taken directly from the query string with no validation. An attacker could craft a URL like:

```
/auth/callback?code=VALID&next=//evil.com
```

The resulting redirect URL becomes `https://shossy-works.vercel.app//evil.com`, which in some browsers resolves to `https://evil.com`. Or with a protocol-relative URL like `next=//evil.com/phishing`, the user is redirected to an attacker-controlled domain after authentication.

Even without the `//` trick, if the `next` param is set to an absolute URL (`next=https://evil.com`), the template literal `${origin}${next}` produces `https://shossy-works.vercel.apphttps://evil.com` which is not directly exploitable, but the lack of any validation is a security smell that will become dangerous as the codebase evolves.

**Impact:** Phishing attacks via crafted auth callback URLs. Attacker sends user a link to `/auth/callback?code=...&next=//evil.com/login`, user authenticates, then gets redirected to a phishing page that looks like the real sign-in, tricking them into entering credentials again.

**Fix:**
```typescript
const next = searchParams.get("next") ?? "/dashboard";
// Validate: must start with / and not be protocol-relative
const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
return NextResponse.redirect(`${origin}${safeNext}`);
```

---

## HIGH Findings

---

### H1. Raw Supabase Auth Error Messages Exposed to Users

**Checklist:** Item 70 (User-Facing Error Messages), Item 63 (API Error Responses)
**Severity:** HIGH
**Files:** `src/app/(auth)/sign-in/page.tsx` line 24, `src/app/(auth)/sign-up/page.tsx` line 28

**Evidence:**

```typescript
// sign-in/page.tsx, line 24
setError(error.message);

// sign-up/page.tsx, line 28
setError(error.message);
```

Both auth forms pass `error.message` directly from the Supabase SDK to the UI. Supabase returns technical error messages that are not user-friendly:

- `"Invalid login credentials"` -- acceptable but could be more helpful
- `"Email not confirmed"` -- reveals that the email exists in the system (user enumeration)
- `"User already registered"` -- also enables user enumeration
- `"Password should be at least 6 characters"` -- acceptable
- `"Email rate limit exceeded"` -- exposes rate limiting details
- `"Database error querying schema cache"` -- exposes internal infrastructure details
- `"Signup requires a valid password"` -- acceptable but inconsistent

**Impact:** User enumeration via error message differentiation is a known vulnerability. Exposing internal error details also violates the principle of least information. For a construction estimating platform handling business data, this is a meaningful security concern.

**Fix:** Create an error message mapping function:
```typescript
function mapAuthError(message: string): string {
  if (message.includes("Invalid login credentials")) {
    return "Invalid email or password. Please try again.";
  }
  if (message.includes("Email not confirmed")) {
    return "Please check your email for a confirmation link.";
  }
  if (message.includes("already registered")) {
    return "An account with this email already exists. Try signing in.";
  }
  if (message.includes("rate limit")) {
    return "Too many attempts. Please wait a moment and try again.";
  }
  // Default: don't expose raw message
  return "Something went wrong. Please try again.";
}
```

---

### H2. No Error Tracking or Monitoring Infrastructure

**Checklist:** Item 69 (Logging & Monitoring)
**Severity:** HIGH
**File:** `package.json` (no error tracking dependencies)

**Evidence:** Grep for `sentry`, `@sentry`, `datadog`, `logtail`, `axiom`, and `monitoring` in `package.json` returned zero results. Grep for `console.log`, `console.error`, and `console.warn` across all files in `src/` returned zero results.

The codebase has:
- Zero `console.error()` calls
- Zero `console.log()` calls
- Zero structured logging
- Zero error tracking integration
- Zero monitoring of any kind

**Impact:** When errors occur in production (and they will -- Supabase outages, auth failures, network issues), there is no way to know. The team will learn about errors only when users report them, which for a construction estimating platform may mean lost estimates, failed saves, or silent data corruption goes undetected.

**Fix:**
1. **Immediate:** Add `console.error()` logging to all catch blocks and error branches (middleware, auth callback, sign-out).
2. **Near-term:** Install Sentry (`@sentry/nextjs`) for production error tracking. The free tier covers small projects. Configure `sentry.server.config.ts`, `sentry.client.config.ts`, and `sentry.edge.config.ts`.
3. **Ongoing:** As features are built, ensure every error path logs context (user ID, route, operation) server-side.

---

### H3. Sign-In Form Does Not Handle Network Errors

**Checklist:** Item 65 (Network Error Handling), Item 60 (Unhandled Promise Rejections)
**Severity:** HIGH
**Files:** `src/app/(auth)/sign-in/page.tsx` lines 15-31, `src/app/(auth)/sign-up/page.tsx` lines 15-35

**Evidence:**

```typescript
// sign-in/page.tsx
async function handleSubmit(e: React.FormEvent) {
  e.preventDefault();
  setLoading(true);
  setError(null);

  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    setError(error.message);
    setLoading(false);
    return;
  }

  router.push("/dashboard");
  router.refresh();
}
```

**Problem 1: No try/catch around the Supabase call.** If the network is down, `signInWithPassword()` can throw a `TypeError: Failed to fetch` or similar network error. This is NOT caught by the `if (error)` check -- that only handles Supabase-level errors returned in the response. A network-level failure throws an exception.

**Problem 2: Loading state stuck on success.** When auth succeeds, `setLoading(false)` is never called. The button shows "Signing in..." until `router.push()` completes navigation. While the navigation usually happens fast, if the dashboard page is slow to load, the button remains disabled with "Signing in..." and no feedback about the transition.

**Problem 3: Identical pattern in sign-up.** The sign-up form has the exact same vulnerability.

**Impact:** If the user's network drops while submitting the sign-in form, they see an unhandled error in the console and the form becomes stuck in the loading state with no error message displayed. The user must refresh the page to try again.

**Fix:**
```typescript
async function handleSubmit(e: React.FormEvent) {
  e.preventDefault();
  setLoading(true);
  setError(null);

  try {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(mapAuthError(error.message));
      return;
    }

    router.push("/dashboard");
    router.refresh();
  } catch {
    setError("Unable to connect. Check your internet connection and try again.");
  } finally {
    setLoading(false);
  }
}
```

---

### H4. Protected Layout Has No Loading State

**Checklist:** Item 62 (Next.js Error Handling Files -- loading.tsx), Item 74 (Graceful Degradation)
**Severity:** HIGH
**File:** `src/app/(protected)/layout.tsx`
**Missing file:** `src/app/(protected)/loading.tsx`

**Evidence:** The protected layout performs a server-side `getUser()` call (line 10) on every request. There is no `loading.tsx` file in the `(protected)` route segment, nor at the root `src/app/` level. Glob searches for `**/loading.tsx` returned zero results.

**Impact:** When navigating between protected routes, or when the `getUser()` call is slow (high latency to Supabase), the user sees no loading indicator. The page appears frozen. This is especially problematic on mobile or slow connections. As the app grows and pages start fetching data, the lack of Suspense boundaries and loading states will cause pages to block entirely until all data loads.

**Fix:**
Create `src/app/(protected)/loading.tsx`:
```tsx
export default function Loading() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-[var(--color-text-secondary)]">Loading...</div>
    </div>
  );
}
```

---

### H5. Form Validation is Client-Only and Minimal

**Checklist:** Item 64 (Form Validation Errors)
**Severity:** HIGH
**Files:** `src/app/(auth)/sign-in/page.tsx`, `src/app/(auth)/sign-up/page.tsx`

**Evidence:**

Sign-in validation:
- Email: `type="email"` and `required` (HTML attributes only) -- line 56-59
- Password: `required` only (no minLength) -- line 71-74

Sign-up validation:
- Email: `type="email"` and `required` (HTML attributes only) -- line 58-61
- Password: `required` and `minLength={6}` -- line 72-82

**Problems:**
1. **Sign-in has no password length validation.** The sign-up form requires `minLength={6}` but the sign-in form has no such constraint. This is inconsistent.
2. **No Zod validation.** The project has Zod installed (`"zod": "^3.24"` in package.json, already used for env validation in `src/env.ts`) but forms use only HTML attributes for validation.
3. **No per-field error display.** Both forms show a single error block at the top of the form. Individual field errors (e.g., invalid email format) are only shown via the browser's native HTML validation tooltips, not the app's own UI.
4. **No email format validation beyond HTML.** HTML `type="email"` validation is notoriously permissive (accepts `a@b`). No Zod schema validates email format before sending to Supabase.

**Impact:** Users can submit malformed data and receive unhelpful Supabase error messages. The inconsistency between sign-in and sign-up password validation creates confusion. As the app adds forms for projects and estimates, the lack of a shared validation pattern will lead to inconsistent validation across the app.

**Fix:**
1. Create a shared auth schema: `src/lib/schemas/auth.ts` with Zod schemas for sign-in and sign-up.
2. Validate client-side before calling Supabase.
3. Display per-field errors beneath each input.

---

### H6. Protected Layout Ignores getUser() Error Object

**Checklist:** Item 66 (Database Error Handling -- Supabase), Item 71 (Silent Failures)
**Severity:** HIGH
**File:** `src/app/(protected)/layout.tsx`, lines 8-11

**Evidence:**

```typescript
const supabase = await createClient();
const {
  data: { user },
} = await supabase.auth.getUser();

if (!user) {
  redirect("/sign-in");
}
```

The destructuring extracts `data.user` but does not destructure the `error` property. The Supabase `getUser()` method returns `{ data: { user }, error }`. If there is an auth error (expired token, invalid token, Supabase issue), `error` will be set and `user` may be `null`. The code treats all `!user` cases identically -- redirecting to sign-in -- but a Supabase outage (where `error` is set but the user IS authenticated) will force-logout all users.

**Impact:** During a Supabase outage, every authenticated user is redirected to sign-in, even though they have valid sessions. The error is silently discarded. No differentiation between "user is not authenticated" and "we couldn't check if the user is authenticated."

**Fix:**
```typescript
const { data: { user }, error } = await supabase.auth.getUser();

if (error) {
  console.error("Auth check failed in protected layout:", error.message);
  // Could show an error page instead of redirect
}

if (!user) {
  redirect("/sign-in");
}
```

---

## MEDIUM Findings

---

### M1. Empty Catch Block in Server Supabase Client

**Checklist:** Item 71 (Silent Failures)
**Severity:** MEDIUM
**File:** `src/lib/supabase/server.ts`, lines 14-19

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

This is a known Supabase SSR pattern -- Server Components cannot set cookies, so the catch is expected. The comment documents the intent. However, the catch is fully empty (no logging). If the `cookieStore.set` call fails for a DIFFERENT reason (e.g., malformed cookie name, value too large), that error is also silently swallowed.

**Impact:** Low for the documented case (Server Component read-only context). But if this code runs in a context where cookie setting SHOULD work (Route Handler, Server Action) and fails for an unexpected reason, the failure is invisible.

**Mitigating factor:** This is the official Supabase SSR pattern, so the risk is accepted by the ecosystem. Documenting the trade-off with the comment is appropriate.

**Fix (optional):** Add minimal defensive logging:
```typescript
} catch (e) {
  // Server Component context is read-only -- safe to ignore.
  // Log unexpected errors that aren't the expected read-only error.
  if (e instanceof Error && !e.message.includes("cookies")) {
    console.error("Unexpected cookie set error:", e.message);
  }
}
```

---

### M2. No Graceful Degradation Pattern Established

**Checklist:** Item 74 (Graceful Degradation)
**Severity:** MEDIUM
**Files:** All protected pages

**Evidence:** The app has a single server-side dependency path: Supabase auth. If that single dependency fails, the entire protected section of the app fails with no fallback. There is no:
- Cached/stale data serving
- Offline indicator
- Service status banner
- Retry mechanism at any level

As Phase 1A adds database-backed features (projects, estimates), every new Supabase query will introduce another single point of failure with no error recovery.

**Impact:** Low now (early stage), but this is a pattern gap. Every new feature will inherit the same "crash on Supabase error" behavior unless a graceful degradation pattern is established early.

**Fix:** Establish error handling patterns NOW, before Phase 1A:
1. Create a `src/lib/errors.ts` module with typed error results.
2. Define the project's error boundary strategy (which route segments get their own `error.tsx`).
3. Create a reusable error UI component with retry button.

---

### M3. Sign-Up Uses window.location.origin Without SSR Guard

**Checklist:** Item 73 (Type-Safe Error Handling), relates to Hydration Item 50
**Severity:** MEDIUM
**File:** `src/app/(auth)/sign-up/page.tsx`, line 24

**Evidence:**

```typescript
options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
```

This accesses `window.location.origin` directly in the component body (inside `handleSubmit`). While this specific case is safe because `handleSubmit` only runs on user interaction (not during SSR/hydration), it represents a fragile pattern. If this line were moved to a `useEffect` initialization or computed at the module level, it would crash during SSR.

The project has `NEXT_PUBLIC_APP_URL` defined in `src/env.ts` (line 33) which should be used instead. This would also be more secure -- `window.location.origin` could be manipulated in certain browser extension contexts.

**Fix:**
```typescript
import { env } from "@/env";
// ...
options: { emailRedirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback` },
```

---

### M4. No Type-Safe Error Handling Pattern

**Checklist:** Item 73 (Type-Safe Error Handling)
**Severity:** MEDIUM
**Files:** Entire codebase

**Evidence:** The codebase has no typed error result pattern. Auth form errors are raw strings (`useState<string | null>(null)`). Supabase errors are sometimes destructured, sometimes ignored, never typed. There is no `Result<T, E>` type, no custom error classes, no error code enum.

As the codebase grows, this will lead to inconsistent error handling where each developer (or each feature) invents its own error shape.

**Impact:** Low now, meaningful as features are added. The architecture rules in `.claude/rules/architecture.md` specify `{ success: true, data }` / `{ success: false, error }` as the mutation return pattern, but no implementation of this pattern exists yet.

**Fix:** Create `src/lib/result.ts`:
```typescript
export type Result<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };
```

---

## Items Reviewed With No Issues Found

These checklist items were evaluated and found to be either not applicable at the current codebase stage or adequately handled:

| Item | Status | Notes |
|------|--------|-------|
| 66 (Supabase error -- `data` without `error`) | Partial issue (see H6) | The middleware DOES destructure `data.user` properly, but protected layout ignores the `error` property |
| 67 (getSession vs getUser) | PASS | Middleware correctly uses `getUser()` at `src/lib/supabase/middleware.ts:30`. Security test at `tests/security/secrets.test.ts` enforces this. |
| 68 (Third-party service failures) | N/A | No third-party integrations exist yet |
| 72 (Error recovery -- optimistic updates) | N/A | No mutations or data writes exist yet |

---

## Prioritized Remediation Plan

### Phase 1: Immediate (blocks deployment safety)

| Priority | Finding | Effort | Impact |
|----------|---------|--------|--------|
| 1 | C1: Create error boundary files (error.tsx, global-error.tsx, not-found.tsx) | 30 min | Prevents white-screen crashes in production |
| 2 | C2: Add try/catch to middleware | 15 min | Prevents total site outage on Supabase issues |
| 3 | C5: Validate `next` param in auth callback | 5 min | Closes open redirect vulnerability |
| 4 | C3: Add error handling to sign-out | 10 min | Prevents unhandled promise rejections |
| 5 | C4: Log callback errors + handle error param on sign-in | 20 min | Makes auth failures visible and debuggable |

### Phase 2: Before Phase 1A (prevents compounding debt)

| Priority | Finding | Effort | Impact |
|----------|---------|--------|--------|
| 6 | H3: Add try/catch to auth forms | 15 min | Handles network errors gracefully |
| 7 | H6: Destructure getUser() error in protected layout | 5 min | Differentiates auth failure from outage |
| 8 | H1: Create error message mapping for auth | 20 min | Prevents user enumeration, improves UX |
| 9 | H4: Add loading.tsx for protected routes | 10 min | Prevents frozen UI during navigation |
| 10 | H5: Add Zod validation to auth forms | 30 min | Establishes validation pattern for all future forms |
| 11 | H2: Install Sentry | 45 min | Makes production errors visible to the team |

### Phase 3: Establish patterns (before features scale)

| Priority | Finding | Effort | Impact |
|----------|---------|--------|--------|
| 12 | M2: Define graceful degradation strategy | 30 min | Prevents crash-by-default on every new feature |
| 13 | M3: Use NEXT_PUBLIC_APP_URL instead of window.location | 5 min | Eliminates SSR fragility risk |
| 14 | M4: Create Result type + error module | 20 min | Gives all future code a typed error pattern |
| 15 | M1: Add defensive logging to server cookie catch | 5 min | Makes unexpected cookie errors visible |

**Total estimated effort:** ~4.5 hours for all 15 items.
**Phase 1 alone (deployment safety):** ~1.5 hours.

---

## Methodology

### Files Reviewed (exhaustive -- all application source)
- `src/lib/supabase/client.ts` (9 lines)
- `src/lib/supabase/server.ts` (24 lines)
- `src/lib/supabase/admin.ts` (19 lines)
- `src/lib/supabase/middleware.ts` (48 lines)
- `src/middleware.ts` (12 lines)
- `src/env.ts` (44 lines)
- `src/app/auth/callback/route.ts` (19 lines)
- `src/app/layout.tsx` (18 lines)
- `src/app/page.tsx` (5 lines)
- `src/app/(auth)/sign-in/page.tsx` (102 lines)
- `src/app/(auth)/sign-up/page.tsx` (107 lines)
- `src/app/(protected)/layout.tsx` (35 lines)
- `src/app/(protected)/dashboard/page.tsx` (35 lines)
- `src/app/(protected)/projects/page.tsx` (10 lines)
- `src/app/(protected)/settings/page.tsx` (10 lines)
- `src/components/nav/sidebar.tsx` (66 lines)
- `src/components/nav/user-menu.tsx` (27 lines)
- `src/app/globals.css` (101 lines)
- `supabase/migrations/00000000000001_auth_roles.sql` (77 lines)
- `tests/setup.ts` (4 lines)
- `tests/smoke/supabase.test.ts` (46 lines)
- `tests/security/secrets.test.ts` (51 lines)
- `package.json` (47 lines)

### Automated Searches Performed
- Glob: `**/error.tsx`, `**/global-error.tsx`, `**/not-found.tsx`, `**/loading.tsx` -- all zero results
- Grep: `sentry|@sentry|datadog|logtail|axiom` in package.json -- zero results
- Grep: `console.(log|error|warn)` in src/ -- zero results
- Grep: `try|catch` in src/ -- only 1 location (server.ts cookie handling)
- Grep: `searchParams|useSearchParams` in auth pages -- zero results
- Grep: `window.location` in src/ -- 1 location (sign-up)
- Grep: `.error|error.` in src/ -- 2 locations (both auth forms setting error.message)

### Checklist Items Covered
Items 60-74 from the performance checklist, with primary focus on CRITICAL items 60, 66, 67, 71 as directed.
