# Error Handling & Testing Infrastructure Research

**Generated:** 2026-04-03
**Scope:** Cluster 3 (Error Handling & Resilience) + Cluster 4 (Testing Infrastructure)
**Codebase:** ShossyWorks (Next.js 16.2.2, Supabase, Vitest 3)

---

## Table of Contents

1. [Cluster 3: Error Handling & Resilience](#cluster-3-error-handling--resilience)
   - [3A: Error Boundary Structure (error.tsx / global-error.tsx / not-found.tsx)](#3a-error-boundary-structure)
   - [3B: Middleware Error Handling (Supabase Outage)](#3b-middleware-error-handling)
   - [3C: Supabase Error Message Mapping](#3c-supabase-error-message-mapping)
   - [3D: Auth Callback Error Logging](#3d-auth-callback-error-logging)
   - [3E: Sign-Out Error Handling](#3e-sign-out-error-handling)
   - [3F: Protected Layout Error Handling](#3f-protected-layout-error-handling)
   - [3G: Auth Form Try/Catch](#3g-auth-form-trycatch)
   - [3H: Result<T> Type Pattern](#3h-resultt-type-pattern)
   - [3I: Loading States](#3i-loading-states)
2. [Cluster 4: Testing Infrastructure](#cluster-4-testing-infrastructure)
   - [4A: Vitest Projects Configuration](#4a-vitest-projects-configuration)
   - [4B: Smoke Test Separation](#4b-smoke-test-separation)
   - [4C: Component Test Setup](#4c-component-test-setup)
   - [4D: Coverage Configuration](#4d-coverage-configuration)
   - [4E: RLS Policy Testing (pgTAP)](#4e-rls-policy-testing-pgtap)
   - [4F: Non-Null Assertions in Tests](#4f-non-null-assertions-in-tests)
   - [4G: Test Path Resolution](#4g-test-path-resolution)
3. [Implementation Priority Matrix](#implementation-priority-matrix)

---

## Cluster 3: Error Handling & Resilience

### 3A: Error Boundary Structure

**Findings:** CRIT-07 (no error.tsx), HIGH-01 (no loading.tsx), HIGH-02 (no not-found.tsx)

**Current state:** Zero error boundary files anywhere in the app.

#### Best Practice: Next.js App Router Error Hierarchy

Next.js App Router uses file-convention error boundaries. The hierarchy is:

```
app/
  global-error.tsx      -- catches root layout errors (replaces <html>/<body>)
  error.tsx             -- catches errors in root segment children
  not-found.tsx         -- handles 404s globally
  (auth)/
    error.tsx           -- catches auth-specific errors
  (protected)/
    error.tsx           -- catches protected-area errors
    loading.tsx         -- loading state for async server components
    not-found.tsx       -- 404 within protected area
```

Key rules:
- `error.tsx` MUST be a client component (`"use client"`)
- `error.tsx` catches errors in its children but NOT in the layout at the same level
- `global-error.tsx` catches root layout errors and MUST define its own `<html>` and `<body>`
- `not-found.tsx` renders when `notFound()` is called from a server component
- In production, server component errors are scrubbed of details (no stack traces leak)

#### Code Pattern: `src/app/global-error.tsx`

```tsx
"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Log to error tracking service (Sentry, etc.) here
  // error.digest is a server-generated hash safe for client display

  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-[var(--color-bg-secondary)]">
        <div className="w-full max-w-md border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center">
          <h1 className="mb-4 text-xl font-semibold text-[var(--color-text-primary)]">
            Something went wrong
          </h1>
          <p className="mb-6 text-sm text-[var(--color-text-secondary)]">
            An unexpected error occurred. Please try again.
          </p>
          <button
            onClick={() => reset()}
            className="rounded-full bg-[var(--color-interactive)] px-6 py-2 text-[var(--color-interactive-text)]"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
```

#### Code Pattern: `src/app/error.tsx`

```tsx
"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center">
        <h2 className="mb-4 text-lg font-semibold text-[var(--color-text-primary)]">
          Something went wrong
        </h2>
        <p className="mb-6 text-sm text-[var(--color-text-secondary)]">
          {error.digest
            ? `Error reference: ${error.digest}`
            : "An unexpected error occurred."}
        </p>
        <button
          onClick={() => reset()}
          className="rounded-full bg-[var(--color-interactive)] px-6 py-2 text-[var(--color-interactive-text)]"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
```

#### Code Pattern: `src/app/not-found.tsx`

```tsx
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg-secondary)]">
      <div className="w-full max-w-md border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center">
        <h1 className="mb-2 text-4xl font-bold text-[var(--color-text-primary)]">404</h1>
        <h2 className="mb-4 text-lg font-semibold text-[var(--color-text-primary)]">
          Page not found
        </h2>
        <p className="mb-6 text-sm text-[var(--color-text-secondary)]">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Link
          href="/dashboard"
          className="inline-block rounded-full bg-[var(--color-interactive)] px-6 py-2 text-[var(--color-interactive-text)]"
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
```

**Complexity:** LOW -- 4 new files, no logic changes, purely additive.

**Files to create:**
- `src/app/global-error.tsx`
- `src/app/error.tsx`
- `src/app/not-found.tsx`
- `src/app/(protected)/error.tsx`

---

### 3B: Middleware Error Handling

**Finding:** CRIT-09 -- Middleware has no error handling; Supabase outage crashes ALL routes.

**Current state:** `updateSession()` in `src/lib/supabase/middleware.ts` calls `getUser()` with no try/catch. Since middleware runs on every non-static route, a Supabase outage takes down the entire app including public routes.

#### Best Practice: Graceful Degradation in Middleware

The pattern is: wrap the entire auth check in try/catch. On error, allow public routes through and redirect protected routes to sign-in with an error parameter. Middleware should NEVER be a single point of failure for the entire application.

Important security note from CVE-2025-29927: middleware should not be the sole authorization mechanism. The protected layout already does a second `getUser()` check, which provides defense in depth.

#### Code Pattern: `src/lib/supabase/middleware.ts` (updated)

```ts
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/env";

const PUBLIC_ROUTES = ["/sign-in", "/sign-up", "/auth/callback"];

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some((route) => pathname.startsWith(route));
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  try {
    const supabase = createServerClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(
            cookiesToSet: { name: string; value: string; options?: CookieOptions }[],
          ) {
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value),
            );
            supabaseResponse = NextResponse.next({ request });
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options),
            );
          },
        },
      },
    );

    // Refresh session -- uses getUser() (NOT getSession()) for security
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    // If getUser() returned an error (Supabase outage, network issue, etc.)
    // but we got no user, handle gracefully
    if (error) {
      console.error("[middleware] Supabase auth error:", error.message);

      // Public routes: let through even during outage
      if (isPublicRoute(request.nextUrl.pathname)) {
        return supabaseResponse;
      }

      // Protected routes: redirect to sign-in with error indicator
      const url = request.nextUrl.clone();
      url.pathname = "/sign-in";
      url.searchParams.set("error", "service_unavailable");
      return NextResponse.redirect(url);
    }

    if (!user && !isPublicRoute(request.nextUrl.pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = "/sign-in";
      return NextResponse.redirect(url);
    }

    if (
      user &&
      isPublicRoute(request.nextUrl.pathname) &&
      request.nextUrl.pathname !== "/auth/callback"
    ) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      return NextResponse.redirect(url);
    }

    return supabaseResponse;
  } catch (err) {
    // Catastrophic failure (network down, env vars missing, etc.)
    console.error("[middleware] Unhandled error:", err);

    // Public routes: allow through with degraded experience
    if (isPublicRoute(request.nextUrl.pathname)) {
      return NextResponse.next({ request });
    }

    // Protected routes: redirect to sign-in
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.searchParams.set("error", "service_unavailable");
    return NextResponse.redirect(url);
  }
}
```

#### Also update `src/middleware.ts` matcher (HIGH-10)

```ts
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
```

The `api/` exclusion prevents middleware from running on webhook endpoints, health checks, and cron jobs that don't need auth.

**Complexity:** LOW-MEDIUM -- modifying 2 existing files, wrapping existing logic in try/catch.

---

### 3C: Supabase Error Message Mapping

**Finding:** HIGH-03 -- Raw Supabase auth error messages exposed to users (user enumeration risk).

**Current state:** `setError(error.message)` in sign-in/sign-up pages passes raw Supabase strings to UI. These strings can reveal whether an email exists, rate limit thresholds, and internal configuration details.

#### Supabase Auth Error Code Reference

Supabase Auth errors have a `code` property (string) and `status` property (HTTP status). Always match on `error.code`, never on `error.message` (messages can change between versions).

Key error codes to map (77 total; these are the user-facing ones):

| Error Code | HTTP | User-Facing Message |
|---|---|---|
| `invalid_credentials` | 400 | "Invalid email or password." |
| `user_not_found` | 404 | "Invalid email or password." (same as above -- prevents enumeration) |
| `email_not_confirmed` | 403 | "Please check your email to confirm your account." |
| `phone_not_confirmed` | 403 | "Please confirm your phone number." |
| `user_already_exists` | 422 | "An account with this email already exists." |
| `email_exists` | 422 | "An account with this email already exists." |
| `user_banned` | 403 | "This account has been suspended. Contact support." |
| `over_request_rate_limit` | 429 | "Too many attempts. Please wait a moment and try again." |
| `over_email_send_rate_limit` | 429 | "Too many attempts. Please wait a moment and try again." |
| `weak_password` | 422 | "Password is too weak. Use at least 8 characters." |
| `same_password` | 422 | "New password must be different from your current password." |
| `session_not_found` | 404 | "Your session has expired. Please sign in again." |
| `flow_state_expired` | 403 | "This link has expired. Please request a new one." |
| `validation_failed` | 422 | "Please check your input and try again." |

#### Code Pattern: `src/lib/auth/error-messages.ts`

```ts
import type { AuthError } from "@supabase/supabase-js";

const AUTH_ERROR_MAP: Record<string, string> = {
  invalid_credentials: "Invalid email or password.",
  user_not_found: "Invalid email or password.",
  email_not_confirmed:
    "Please check your email to confirm your account before signing in.",
  phone_not_confirmed: "Please confirm your phone number before signing in.",
  user_already_exists: "An account with this email already exists.",
  email_exists: "An account with this email already exists.",
  user_banned: "This account has been suspended. Please contact support.",
  over_request_rate_limit:
    "Too many attempts. Please wait a moment and try again.",
  over_email_send_rate_limit:
    "Too many attempts. Please wait a moment and try again.",
  weak_password:
    "Password is too weak. Use at least 8 characters with a mix of letters and numbers.",
  same_password: "New password must be different from your current password.",
  session_not_found: "Your session has expired. Please sign in again.",
  flow_state_expired: "This link has expired. Please request a new one.",
  validation_failed: "Please check your input and try again.",
  signup_disabled: "Account registration is currently disabled.",
  otp_expired: "This code has expired. Please request a new one.",
};

const DEFAULT_ERROR_MESSAGE =
  "Something went wrong. Please try again later.";

export function getAuthErrorMessage(error: AuthError): string {
  if (error.code && error.code in AUTH_ERROR_MAP) {
    return AUTH_ERROR_MAP[error.code];
  }

  // Log unmapped errors server-side for monitoring
  if (typeof window === "undefined") {
    console.error("[auth] Unmapped error code:", error.code, error.message);
  }

  return DEFAULT_ERROR_MESSAGE;
}
```

#### Usage in sign-in page:

```tsx
// Before:
setError(error.message);

// After:
import { getAuthErrorMessage } from "@/lib/auth/error-messages";
setError(getAuthErrorMessage(error));
```

**Complexity:** LOW -- 1 new utility file, 2 one-line changes in auth pages.

---

### 3D: Auth Callback Error Logging

**Finding:** HIGH-04 -- Auth callback silently discards error details.

**Current state:** `src/app/auth/callback/route.ts` calls `exchangeCodeForSession(code)` and if it fails, redirects to `/sign-in?error=auth_callback_error` with no logging.

#### Code Pattern: `src/app/auth/callback/route.ts` (updated)

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

    // Log the actual error server-side for debugging
    console.error(
      "[auth/callback] Code exchange failed:",
      error.code,
      error.message,
    );

    return NextResponse.redirect(
      `${origin}/sign-in?error=auth_callback_error&code=${encodeURIComponent(error.code ?? "unknown")}`,
    );
  }

  console.error("[auth/callback] No code parameter received");
  return NextResponse.redirect(`${origin}/sign-in?error=auth_callback_error`);
}
```

Then update sign-in page to read and display the error param:

```tsx
// In sign-in page, read URL search params on mount:
import { useSearchParams } from "next/navigation";

const searchParams = useSearchParams();
const urlError = searchParams.get("error");

// Display URL-based errors
useEffect(() => {
  if (urlError === "auth_callback_error") {
    setError("Sign-in failed. Please try again.");
  } else if (urlError === "service_unavailable") {
    setError("Service temporarily unavailable. Please try again later.");
  }
}, [urlError]);
```

**Complexity:** LOW -- 2 file edits, minimal logic changes.

---

### 3E: Sign-Out Error Handling

**Finding:** From cluster notes -- sign-out is fire-and-forget with no error handling.

**Current state:** `src/components/nav/user-menu.tsx` calls `signOut()` with no error handling.

#### Code Pattern:

```tsx
async function handleSignOut() {
  const supabase = createClient();
  const { error } = await supabase.auth.signOut({ scope: "global" });

  if (error) {
    console.error("[sign-out] Failed:", error.message);
    // Still redirect -- user intended to leave, and client-side session
    // will be stale anyway
  }

  router.push("/sign-in");
  router.refresh();
}
```

**Complexity:** LOW -- 1 file edit, ~5 lines changed.

---

### 3F: Protected Layout Error Handling

**Finding:** Protected layout ignores `getUser()` error object (treats outage as "not authenticated").

**Current state:** `src/app/(protected)/layout.tsx` destructures only `data: { user }` from `getUser()`, ignoring the error object. If Supabase is down, `user` is null and the layout redirects to sign-in as if the user isn't authenticated.

#### Code Pattern: `src/app/(protected)/layout.tsx` (updated)

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/nav/sidebar";
import { UserMenu } from "@/components/nav/user-menu";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    // Supabase outage or network error -- redirect with context
    // so sign-in page can show appropriate message
    console.error("[protected/layout] Auth check failed:", error.message);
    redirect("/sign-in?error=service_unavailable");
  }

  if (!user) {
    redirect("/sign-in");
  }

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <header
          className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-[var(--space-6)]"
          style={{ height: "var(--header-height)" }}
        >
          <h2 className="text-[var(--text-lg)] font-[var(--font-semibold)] text-[var(--color-text-primary)]">
            ShossyWorks
          </h2>
          <UserMenu email={user.email ?? ""} />
        </header>
        <main className="flex-1 overflow-y-auto bg-[var(--color-bg-secondary)] p-[var(--space-6)]">
          {children}
        </main>
      </div>
    </div>
  );
}
```

**Complexity:** LOW -- 1 file edit, ~5 lines added.

---

### 3G: Auth Form Try/Catch

**Finding:** Auth forms have no try/catch around network calls (stuck loading state on failure).

**Current state:** `handleSubmit` in sign-in/sign-up pages calls `supabase.auth.signInWithPassword()` with no try/catch. If the network call throws (not just returns an error), `setLoading(false)` is never called and the button stays disabled forever.

#### Code Pattern:

```tsx
async function handleSubmit(e: React.FormEvent) {
  e.preventDefault();
  setLoading(true);
  setError(null);

  try {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(getAuthErrorMessage(error));
      return;
    }

    router.push("/dashboard");
    router.refresh();
  } catch (err) {
    console.error("[sign-in] Unexpected error:", err);
    setError("Unable to connect. Please check your internet connection and try again.");
  } finally {
    setLoading(false);
  }
}
```

The `finally` block ensures `setLoading(false)` is always called, regardless of whether the promise resolved, returned an error, or threw an exception.

**Complexity:** LOW -- 2 file edits (sign-in + sign-up), wrapping existing code.

---

### 3H: Result\<T\> Type Pattern

**Finding:** No type-safe error result pattern established.

**Current state:** No `Result<T>` type exists. Server actions don't exist yet (Phase 1A), but establishing the pattern now prevents inconsistent error handling later.

#### Code Pattern: `src/lib/types/result.ts`

```ts
/**
 * Type-safe result pattern for server actions and mutations.
 * Always return Result<T> from server actions -- never throw.
 */
export type Result<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/**
 * Extended result with field-level validation errors.
 * Use for form submissions with multiple fields.
 */
export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: Record<string, string> };

/** Helper to create success results */
export function ok<T>(data: T): Result<T> {
  return { success: true, data };
}

/** Helper to create error results */
export function err<T>(error: string): Result<T> {
  return { success: false, error };
}
```

#### Usage in future server actions:

```ts
"use server";

import { ok, err } from "@/lib/types/result";
import type { Result } from "@/lib/types/result";

export async function createProject(formData: FormData): Promise<Result<{ id: string }>> {
  const name = formData.get("name") as string;

  if (!name?.trim()) {
    return err("Project name is required.");
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("projects")
      .insert({ name })
      .select("id")
      .single();

    if (error) return err("Failed to create project.");
    return ok(data);
  } catch {
    return err("Something went wrong. Please try again.");
  }
}
```

**Complexity:** LOW -- 1 new utility file, no existing code changes needed yet.

---

### 3I: Loading States

**Finding:** HIGH-01 -- Zero loading.tsx files anywhere; no loading states for async server components.

**Current state:** Protected layout calls `getUser()` (async, 100-200ms network call) with no visual feedback. Users see a blank page during auth verification.

#### Code Pattern: `src/app/(protected)/loading.tsx`

```tsx
export default function ProtectedLoading() {
  return (
    <div className="flex h-screen items-center justify-center bg-[var(--color-bg-secondary)]">
      <div className="flex flex-col items-center gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--color-border)] border-t-[var(--color-interactive)]" />
        <p className="text-sm text-[var(--color-text-secondary)]">Loading...</p>
      </div>
    </div>
  );
}
```

This is a server component (no `"use client"` needed). Next.js wraps it in a Suspense boundary automatically.

**Complexity:** LOW -- 1-2 new files (protected + optionally auth route group).

---

## Cluster 4: Testing Infrastructure

### 4A: Vitest Projects Configuration

**Finding:** HIGH-08 -- `test:smoke`, `test:security`, `test:db`, `test:actions` scripts use `--project` flag but no project definitions exist.

**Current state:** `vitest.config.ts` has a single flat config. Package.json scripts reference `--project smoke`, `--project security`, `--project db`, `--project actions` which all silently fail or run no tests.

#### Best Practice: Vitest Projects (replaces deprecated workspace)

As of Vitest 3.2+, the `workspace` file is deprecated. Use `test.projects` in `vitest.config.ts` instead. Projects are defined inline with separate `include` patterns, environments, and setup files.

#### Code Pattern: `vitest.config.ts` (updated)

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.browser.test.ts"],
          setupFiles: ["./tests/setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "smoke",
          environment: "node",
          include: ["tests/smoke/**/*.test.ts"],
          setupFiles: ["./tests/setup.ts"],
          testTimeout: 15_000,
        },
      },
      {
        extends: true,
        test: {
          name: "security",
          environment: "node",
          include: ["tests/security/**/*.test.ts"],
          setupFiles: ["./tests/setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "db",
          environment: "node",
          include: ["tests/database/**/*.test.ts"],
          setupFiles: ["./tests/setup.ts"],
          testTimeout: 30_000,
        },
      },
      {
        extends: true,
        test: {
          name: "actions",
          environment: "node",
          include: ["tests/actions/**/*.test.ts"],
          setupFiles: ["./tests/setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "component",
          environment: "jsdom",
          include: ["src/**/*.browser.test.{ts,tsx}", "tests/components/**/*.test.{ts,tsx}"],
          setupFiles: ["./tests/setup.ts", "./tests/setup-dom.ts"],
        },
      },
    ],
  },
});
```

#### Update package.json scripts:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:unit": "vitest run --project unit",
    "test:smoke": "vitest run --project smoke",
    "test:security": "vitest run --project security",
    "test:db": "vitest run --project db",
    "test:actions": "vitest run --project actions",
    "test:component": "vitest run --project component",
    "test:ci": "vitest run --project unit --project security",
    "test:coverage": "vitest run --coverage"
  }
}
```

**Key design decisions:**
- `test:ci` runs only unit + security (fast, deterministic, no network calls)
- `test:smoke` runs separately (makes real network calls, may be flaky)
- `test:db` needs a local Supabase instance (`supabase start`)
- `extends: true` inherits path aliases and other root-level config
- Component tests use `jsdom` environment; everything else uses `node`

**Complexity:** MEDIUM -- 1 file rewrite, package.json script updates, verifying all existing tests still pass.

---

### 4B: Smoke Test Separation

**Finding:** Smoke tests make real network calls (flaky in CI).

**Current state:** `tests/smoke/supabase.test.ts` makes real `fetch()` calls to the Supabase API. These will fail in CI without env vars and network access.

#### Best Practice: Separate CI-Mandatory from Optional Tests

The project configuration above handles this via the `test:ci` script that excludes smoke tests. Additional considerations:

1. **CI pipeline should run:** `test:ci` (unit + security only)
2. **Pre-deploy hook should run:** `test:ci` + `test:smoke` (verify connectivity)
3. **Local dev runs:** all tests via `test`

#### GitHub Actions pattern:

```yaml
# .github/workflows/ci.yml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run test:ci
      # Smoke tests only on deploy branches, with env vars
      - if: github.ref == 'refs/heads/main'
        run: npm run test:smoke
        env:
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
          NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

**Complexity:** LOW -- the vitest projects config (4A) already handles this. CI config is additive.

---

### 4C: Component Test Setup

**Finding:** Zero component tests; no @testing-library/react installed.

**Current state:** No component testing infrastructure. The `devDependencies` do not include `@testing-library/react`, `@testing-library/dom`, `@testing-library/jest-dom`, `jsdom`, or `@vitejs/plugin-react`.

#### Important Limitation

Vitest does NOT support testing async server components. From Next.js official docs: "Since async Server Components are new to the React ecosystem, Vitest currently does not support them. While you can still run unit tests for synchronous Server and Client Components, we recommend using E2E tests for async components."

This means the protected layout (async server component) cannot be unit-tested with Vitest. Client components like sign-in/sign-up pages CAN be tested.

#### Setup Steps:

1. Install dependencies:

```bash
npm install -D @testing-library/react @testing-library/dom @testing-library/jest-dom jsdom @vitejs/plugin-react
```

2. Create `tests/setup-dom.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

3. The `component` project in vitest.config.ts (section 4A) already defines `environment: "jsdom"` and includes the setup file.

#### Example Component Test: `src/app/(auth)/sign-in/__tests__/sign-in.browser.test.tsx`

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
}));

// Mock Supabase client
const mockSignIn = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: mockSignIn,
    },
  }),
}));

// Import AFTER mocks are set up
import SignInPage from "../page";

describe("SignInPage", () => {
  it("renders email and password fields", () => {
    render(<SignInPage />);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it("shows error message on invalid credentials", async () => {
    mockSignIn.mockResolvedValueOnce({
      error: { code: "invalid_credentials", message: "Invalid login" },
    });

    render(<SignInPage />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "test@test.com" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/invalid email or password/i)).toBeInTheDocument();
    });
  });

  it("disables button while loading", async () => {
    mockSignIn.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 1000)),
    );

    render(<SignInPage />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "test@test.com" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "password" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByRole("button")).toBeDisabled();
    });
  });
});
```

**Complexity:** MEDIUM -- new dev dependencies, new setup file, new test files. No existing code changes.

---

### 4D: Coverage Configuration

**Finding:** HIGH-09 -- No coverage configuration, no @vitest/coverage-v8 installed.

**Current state:** No coverage block in vitest config. No `@vitest/coverage-v8` in dependencies.

#### Code Pattern:

1. Install:

```bash
npm install -D @vitest/coverage-v8
```

2. Add coverage config to `vitest.config.ts`:

```ts
// Add to the test object alongside projects:
test: {
  globals: true,
  coverage: {
    provider: "v8",
    reporter: ["text", "html", "lcov"],
    include: ["src/**/*.{ts,tsx}"],
    exclude: [
      "src/**/*.test.{ts,tsx}",
      "src/**/*.d.ts",
      "src/lib/types/supabase.ts", // auto-generated
    ],
    thresholds: {
      // Start low, increase as coverage grows
      // Use negative numbers for "max uncovered items" approach
      lines: 20,
      functions: 20,
      branches: 20,
      statements: 20,
    },
  },
  projects: [ /* ... */ ],
}
```

Note: `coverage` is configured at root level, not per-project (Vitest limitation -- projects cannot define their own coverage settings).

3. Add to `.gitignore`:

```
# Coverage
coverage/
```

4. Add script:

```json
"test:coverage": "vitest run --coverage"
```

**Complexity:** LOW -- 1 dependency install, config addition, .gitignore update.

---

### 4E: RLS Policy Testing (pgTAP)

**Finding:** Zero database/RLS tests (no pgTAP).

**Current state:** `tests/database/` directory exists but is empty. No pgTAP tests. The project has RLS policies (user_roles table, custom_access_token_hook) that are untested.

#### Best Practice: pgTAP + supabase-test-helpers

Supabase provides built-in pgTAP support via `supabase test db`. Tests are SQL files in `supabase/tests/`.

#### Setup:

1. Create test helper installation file:

```sql
-- supabase/tests/00000-supabase_test_helpers.sql
-- Copy content from: https://github.com/usebasejump/supabase-test-helpers
-- This provides: tests.create_supabase_user(), tests.authenticate_as(),
-- tests.clear_authentication(), tests.rls_enabled()
```

2. Example RLS test for user_roles table:

```sql
-- supabase/tests/00001-user_roles_rls.test.sql
begin;

select plan(6);

-- Test 1: RLS is enabled on user_roles
select tests.rls_enabled('public', 'user_roles');

-- Create test users
select tests.create_supabase_user('user_a', 'usera@test.com');
select tests.create_supabase_user('user_b', 'userb@test.com');

-- Insert roles for test users
insert into public.user_roles (user_id, role)
values
  (tests.get_supabase_uid('user_a'), 'employee'),
  (tests.get_supabase_uid('user_b'), 'admin');

-- Test 2: User A can read their own role
select tests.authenticate_as('user_a');
select results_eq(
  $$select role from public.user_roles where user_id = tests.get_supabase_uid('user_a')$$,
  $$values ('employee'::text)$$,
  'User can read their own role'
);

-- Test 3: User A cannot read User B's role
select is_empty(
  $$select * from public.user_roles where user_id = tests.get_supabase_uid('user_b')$$,
  'User cannot read another user role'
);

-- Test 4: User A cannot insert roles
select throws_ok(
  $$insert into public.user_roles (user_id, role) values (tests.get_supabase_uid('user_a'), 'admin')$$,
  null,
  'User cannot insert roles'
);

-- Test 5: User A cannot update roles
select tests.authenticate_as('user_a');
select is_empty(
  $$update public.user_roles set role = 'admin' where user_id = tests.get_supabase_uid('user_a') returning *$$,
  'User cannot update their own role'
);

-- Test 6: Admin can read all roles
select tests.authenticate_as('user_b');
select results_eq(
  $$select count(*)::int from public.user_roles$$,
  $$values (2)$$,
  'Admin can read all roles'
);

select tests.clear_authentication();
select * from finish();

rollback;
```

#### Running:

```bash
supabase start         # Start local Supabase
supabase test db       # Run all pgTAP tests
```

#### CI integration:

```yaml
- run: npx supabase start
- run: npx supabase test db
```

**Complexity:** MEDIUM -- requires understanding current RLS policies, writing SQL tests, and ensuring supabase CLI is available in CI. The SQL itself is straightforward once policies are understood.

---

### 4F: Non-Null Assertions in Tests

**Finding:** HIGH-07 -- Three `!` assertions on `process.env` values in smoke tests.

**Current state:** `tests/smoke/supabase.test.ts` lines 4-6 use non-null assertions:

```ts
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
```

If env vars are missing, tests produce cryptic `null` or `undefined` errors deep in test execution.

#### Code Pattern: `tests/helpers/require-env.ts`

```ts
/**
 * Require an environment variable, failing the test with a clear message if missing.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Ensure .env.local exists and contains ${name}.`,
    );
  }
  return value;
}
```

#### Updated smoke test:

```ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "../helpers/require-env";

const SUPABASE_URL = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

// ... rest of tests unchanged
```

**Complexity:** LOW -- 1 new helper file, 3 line changes in smoke test.

---

### 4G: Test Path Resolution

**Finding:** Security tests use `__dirname` traversal (fragile path resolution).

**Current state:** `tests/security/secrets.test.ts` uses `resolve(__dirname, "../../src/lib/supabase/admin.ts")` -- a brittle path that breaks if the test file is moved.

#### Code Pattern: Use path alias from vitest config

Since vitest.config.ts already defines `@` as an alias to `./src`, the tests can use this:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// Use the project root from vitest's working directory
const ROOT = process.cwd();

describe("secret-security", () => {
  it("SEC-L3-01: admin client is guarded by server-only import", () => {
    const adminFile = readFileSync(
      resolve(ROOT, "src/lib/supabase/admin.ts"),
      "utf-8",
    );
    expect(adminFile).toContain('import "server-only"');
  });

  it("SEC-L3-02: middleware uses getUser() not getSession()", () => {
    const middlewareFile = readFileSync(
      resolve(ROOT, "src/lib/supabase/middleware.ts"),
      "utf-8",
    );
    expect(middlewareFile).toMatch(/\.auth\.getUser\(\)/);
    expect(middlewareFile).not.toMatch(/\.auth\.getSession\(\)/);
  });

  // ... remaining tests updated similarly
});
```

Alternatively, create a helper:

```ts
// tests/helpers/read-source.ts
import { readFileSync } from "fs";
import { resolve } from "path";

/** Read a source file relative to project root. */
export function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf-8");
}
```

**Complexity:** LOW -- small refactor of existing test file, optionally with a helper.

---

## Implementation Priority Matrix

| ID | Finding | Severity | Complexity | Priority | Effort |
|---|---|---|---|---|---|
| 3B | Middleware error handling | CRITICAL | LOW-MED | P0 | 2h |
| 3C | Error message mapping | HIGH | LOW | P0 | 1h |
| 3A | Error boundary files | CRITICAL | LOW | P1 | 2h |
| 3D | Callback error logging | HIGH | LOW | P1 | 30m |
| 3G | Auth form try/catch | HIGH | LOW | P1 | 30m |
| 3F | Protected layout error handling | HIGH | LOW | P1 | 30m |
| 3I | Loading states | HIGH | LOW | P1 | 30m |
| 3E | Sign-out error handling | MEDIUM | LOW | P2 | 15m |
| 3H | Result\<T\> type | MEDIUM | LOW | P2 | 30m |
| 4A | Vitest projects config | HIGH | MEDIUM | P1 | 2h |
| 4F | Non-null assertions fix | HIGH | LOW | P1 | 30m |
| 4G | Test path resolution | MEDIUM | LOW | P2 | 30m |
| 4D | Coverage configuration | HIGH | LOW | P2 | 1h |
| 4B | Smoke test CI separation | MEDIUM | LOW | P2 | 1h |
| 4C | Component test setup | MEDIUM | MEDIUM | P3 | 3h |
| 4E | RLS testing (pgTAP) | MEDIUM | MEDIUM | P3 | 4h |

### Recommended Implementation Order

**Phase 1 (Day 1 -- Critical path, ~4h):**
- 3B: Middleware error handling (prevents full-app crashes)
- 3C: Error message mapping (prevents information leakage)
- 3A: Error boundary files (basic resilience infrastructure)
- 3D + 3F + 3G: Auth error handling fixes (all small, related)

**Phase 2 (Day 2 -- Testing foundation, ~4h):**
- 4A: Vitest projects config (unblocks all other testing work)
- 4F: Non-null assertions fix (quick, improves DX)
- 4D: Coverage configuration (enables measurement)
- 3I: Loading states (UX improvement)

**Phase 3 (Day 3 -- Polish, ~5h):**
- 3E + 3H: Sign-out fix + Result type (small improvements)
- 4B + 4G: CI separation + path resolution (test infrastructure)
- 4C: Component test setup (new capability)

**Phase 4 (Day 4 -- Database testing, ~4h):**
- 4E: RLS policy testing with pgTAP (independent workstream)

### Total Estimated Effort: ~17h across 4 working days

### New Dependencies Required

```bash
# Testing infrastructure (Phase 2-3)
npm install -D @vitest/coverage-v8

# Component testing (Phase 3)
npm install -D @testing-library/react @testing-library/dom @testing-library/jest-dom jsdom @vitejs/plugin-react
```

### New Files Created

```
src/app/global-error.tsx               (3A)
src/app/error.tsx                      (3A)
src/app/not-found.tsx                  (3A)
src/app/(protected)/error.tsx          (3A)
src/app/(protected)/loading.tsx        (3I)
src/lib/auth/error-messages.ts         (3C)
src/lib/types/result.ts                (3H)
tests/helpers/require-env.ts           (4F)
tests/helpers/read-source.ts           (4G, optional)
tests/setup-dom.ts                     (4C)
supabase/tests/00000-supabase_test_helpers.sql  (4E)
supabase/tests/00001-user_roles_rls.test.sql    (4E)
```

### Files Modified

```
src/lib/supabase/middleware.ts          (3B)
src/middleware.ts                       (3B -- matcher update)
src/app/(auth)/sign-in/page.tsx         (3C, 3D, 3G)
src/app/(auth)/sign-up/page.tsx         (3C, 3G)
src/app/auth/callback/route.ts          (3D)
src/app/(protected)/layout.tsx          (3F)
src/components/nav/user-menu.tsx        (3E)
vitest.config.ts                        (4A, 4D)
package.json                            (4A scripts, 4C/4D deps)
tests/smoke/supabase.test.ts            (4F)
tests/security/secrets.test.ts          (4G)
.gitignore                              (4D -- coverage/)
```

---

## Sources

### Error Handling
- [Next.js Error Handling Docs](https://nextjs.org/docs/app/getting-started/error-handling)
- [Next.js error.js File Convention](https://nextjs.org/docs/app/api-reference/file-conventions/error)
- [Next.js not-found.js File Convention](https://nextjs.org/docs/app/api-reference/file-conventions/not-found)
- [Next.js 15 Error Handling Best Practices](https://devanddeliver.com/blog/frontend/next-js-15-error-handling-best-practices-for-code-and-routes)
- [Better Stack: Next.js Error Handling Patterns](https://betterstack.com/community/guides/scaling-nodejs/error-handling-nextjs/)
- [Supabase Auth Error Codes](https://supabase.com/docs/guides/auth/debugging/error-codes)
- [Supabase Auth Error Codes (GitHub source)](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/auth/debugging/error-codes.mdx)
- [Supabase Auth Error Codes Gist (77 codes)](https://gist.github.com/julio-salas03/8d996b78ad0f91a3c3b419a83eb2270a)
- [Vercel: Postmortem on Next.js Middleware Bypass (CVE-2025-29927)](https://vercel.com/blog/postmortem-on-next-js-middleware-bypass)
- [Next.js Server Actions Error Handling Pattern](https://medium.com/@pawantripathi648/next-js-server-actions-error-handling-the-pattern-i-wish-i-knew-earlier-e717f28f2f75)
- [error.tsx vs global-error.tsx Discussion](https://github.com/vercel/next.js/discussions/68048)

### Testing
- [Vitest Test Projects (replaces workspace)](https://vitest.dev/guide/workspace)
- [Vitest Coverage Configuration](https://vitest.dev/config/coverage)
- [Vitest Coverage Guide](https://vitest.dev/guide/coverage)
- [Next.js Testing with Vitest](https://nextjs.org/docs/app/guides/testing/vitest)
- [Separating Unit and Integration Tests (Vitest Discussion)](https://github.com/vitest-dev/vitest/discussions/4675)
- [Supabase Testing Overview](https://supabase.com/docs/guides/local-development/testing/overview)
- [Advanced pgTAP Testing (Supabase)](https://supabase.com/docs/guides/local-development/testing/pgtap-extended)
- [Testing on Supabase with pgTAP (Basejump)](https://usebasejump.com/blog/testing-on-supabase-with-pgtap)
- [supabase-test-helpers (GitHub)](https://github.com/usebasejump/supabase-test-helpers)
- [RLS Testing with pgTAP (Medium)](https://blair-devmode.medium.com/testing-row-level-security-rls-policies-in-postgresql-with-pgtap-a-supabase-example-b435c3852602)
- [nextcov -- Coverage for Next.js Server Components](https://dev.to/stevez/nextcov-collecting-test-coverage-for-nextjs-server-components-6gc)
