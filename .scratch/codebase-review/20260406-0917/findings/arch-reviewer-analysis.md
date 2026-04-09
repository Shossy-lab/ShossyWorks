# A6 -- Architecture Reviewer Analysis

**Reviewer:** A6 (Architecture)
**Domain:** Component boundaries, data flow, server/client boundary, App Router patterns, layout composition, route organization, shared state, dependency direction, error architecture, middleware, configuration management
**Checklist items scanned:** 1-77 (Architecture)
**Date:** 2026-04-06

---

## Executive Summary

The ShossyWorks codebase is in early Phase 0 (scaffolding + auth). The foundation is solid in several areas -- proper server/client Supabase client separation, middleware-based route protection, T3 env validation, and correct use of `getUser()` over `getSession()`. However, the architecture has several gaps that must be addressed before Phase 1A begins, or they will compound into systemic problems as the codebase grows. The most critical issues are: zero error boundaries in the entire application, an open redirect vulnerability in the auth callback, missing Supabase generated types, and a new Supabase client created on every function invocation with no memoization.

---

## CRITICAL Findings

### CRIT-01: No error boundaries anywhere in the application (Checklist #42)

**Severity:** CRITICAL
**Files affected:** Entire `src/app/` directory

There are zero `error.tsx` files in the application. Not at the root, not in `(protected)`, not in `(auth)`, not in any route segment. This means:

- Any unhandled error in a server component (e.g., Supabase connection failure, invalid JWT) will crash the entire page with Next.js's default error page.
- Users see a raw, unstyled error screen with no way to recover.
- In production on Vercel, this surfaces as a generic 500 page with no user-facing recovery action.

**Evidence:**
```
$ find src/app -name "error.tsx"
(no results)
```

The `(protected)/layout.tsx` performs a Supabase `getUser()` call on every render (line 8-10). If Supabase is temporarily unreachable, every protected route crashes with no error boundary to catch it:

```typescript
// src/app/(protected)/layout.tsx:7-10
const supabase = await createClient();
const {
  data: { user },
} = await supabase.auth.getUser();
```

**Required fix:** Add `error.tsx` at minimum in:
- `src/app/error.tsx` (root catch-all)
- `src/app/(protected)/error.tsx` (protected route errors)
- `src/app/(auth)/error.tsx` (auth flow errors)

Each should include a reset/retry mechanism.

---

### CRIT-02: Open redirect vulnerability in auth callback (Checklist #25, #60)

**Severity:** CRITICAL
**File:** `src/app/auth/callback/route.ts`, lines 7-8, 14

The auth callback route reads a `next` query parameter from the URL and uses it to construct a redirect without any validation:

```typescript
// src/app/auth/callback/route.ts:7,14
const next = searchParams.get("next") ?? "/dashboard";
// ...
return NextResponse.redirect(`${origin}${next}`);
```

An attacker can craft a URL like:
```
https://shossy-works.vercel.app/auth/callback?code=VALID_CODE&next=//evil.com
```

The browser will interpret `https://shossy-works.vercel.app//evil.com` as a protocol-relative URL redirect to `evil.com`. More subtly, `next=%2F%2Fevil.com` also works. This is a textbook open redirect that can be used for phishing attacks against users who trust the `shossy-works.vercel.app` domain.

**Required fix:** Validate that `next` starts with `/` and does not contain `//`, or better yet, validate it against an allowlist of internal paths.

```typescript
const next = searchParams.get("next") ?? "/dashboard";
const safePath = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
return NextResponse.redirect(`${origin}${safePath}`);
```

---

### CRIT-03: Missing Supabase generated types -- all DB queries are untyped (Checklist #54, related to #55)

**Severity:** CRITICAL
**Files:** `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`, `src/lib/supabase/admin.ts`

The `package.json` has a `db:types` script that would generate types to `src/lib/types/supabase.ts`, but that file does not exist. The `src/lib/types/` directory does not exist at all.

None of the three Supabase client factories pass a `Database` type parameter:

```typescript
// src/lib/supabase/client.ts:7
return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
// Should be: createBrowserClient<Database>(...)

// src/lib/supabase/server.ts:8
return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {...});
// Should be: createServerClient<Database>(...)

// src/lib/supabase/admin.ts:12
return createClient(env.NEXT_PUBLIC_SUPABASE_URL, serviceKey, {...});
// Should be: createClient<Database>(...)
```

This means every Supabase query returns `any` for data, and the TypeScript compiler cannot catch:
- Misspelled table names
- Non-existent column references
- Wrong data types in inserts/updates
- Invalid filter conditions

**Required fix before Phase 1A:** Run `npm run db:types`, create the `src/lib/types/` directory, and pass `Database` generic to all three client factories.

---

## HIGH Findings

### HIGH-01: No loading states for async server components (Checklist #16, #68)

**Severity:** HIGH
**Files affected:** All route segments

There are zero `loading.tsx` files in the application:

```
$ find src/app -name "loading.tsx"
(no results)
```

The `(protected)/layout.tsx` is an async server component that calls `supabase.auth.getUser()` on every navigation. Without a `loading.tsx`, users see nothing (a blank page or flash) while this network call completes. On slow connections or when Supabase is slow, this creates a jarring experience.

**Required fix:** Add `loading.tsx` at minimum in:
- `src/app/(protected)/loading.tsx`
- Consider `src/app/loading.tsx` for the root

---

### HIGH-02: No not-found handling (Checklist #47)

**Severity:** HIGH
**Files affected:** All route segments

There are zero `not-found.tsx` files. Navigating to any non-existent route within the protected area (e.g., `/projects/invalid-id`) will show Next.js's default 404 page, which is unstyled and does not match the application's design system.

**Required fix:** Add `not-found.tsx` at the root level and in `(protected)` to provide branded 404 pages.

---

### HIGH-03: Supabase client created on every invocation with no memoization (Checklist #39)

**Severity:** HIGH
**Files:** `src/lib/supabase/client.ts`, `src/components/nav/user-menu.tsx` (line 10), `src/app/(auth)/sign-in/page.tsx` (line 20), `src/app/(auth)/sign-up/page.tsx` (line 21)

The browser Supabase client is created fresh on every function call:

```typescript
// src/lib/supabase/client.ts
export function createClient() {
  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
```

And then called inside event handlers, meaning each sign-in, sign-up, and sign-out creates a new client:

```typescript
// src/app/(auth)/sign-in/page.tsx:20
const supabase = createClient();  // new client on every submit

// src/components/nav/user-menu.tsx:10
const supabase = createClient();  // new client on every sign-out
```

While `@supabase/ssr`'s `createBrowserClient` does have internal singleton behavior in some versions, this is implementation detail that should not be relied upon. Explicitly memoizing the client prevents:
- Multiple GoTrue client instances competing for token refresh
- Redundant HTTP connections
- Subtle auth state desync bugs

**Recommended fix:** Memoize the browser client:

```typescript
let browserClient: ReturnType<typeof createBrowserClient> | null = null;

export function createClient() {
  if (!browserClient) {
    browserClient = createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  }
  return browserClient;
}
```

Note: The server client (`server.ts`) correctly creates a new client per request (required because it depends on the per-request cookie store). The admin client (`admin.ts`) could also benefit from memoization but is less urgent since it is only used in server-side contexts.

---

### HIGH-04: Dual auth check -- middleware and layout both verify authentication (Checklist #62)

**Severity:** HIGH
**Files:** `src/lib/supabase/middleware.ts` (lines 29-39), `src/app/(protected)/layout.tsx` (lines 7-13)

Authentication is verified in two places:

**Middleware** (runs on every request):
```typescript
// src/lib/supabase/middleware.ts:29-35
const { data: { user } } = await supabase.auth.getUser();
if (!user && !isPublicRoute) {
  const url = request.nextUrl.clone();
  url.pathname = "/sign-in";
  return NextResponse.redirect(url);
}
```

**Protected layout** (runs on every protected page render):
```typescript
// src/app/(protected)/layout.tsx:7-13
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();
if (!user) {
  redirect("/sign-in");
}
```

This means `getUser()` is called TWICE per navigation to any protected page -- once in middleware, once in the layout. Each call is a network round-trip to Supabase's GoTrue server. This doubles latency on every page load.

The defense-in-depth approach is valid, but the implementation should be optimized. Options:
1. Pass the user from middleware to the layout via headers/cookies to avoid the second network call
2. Accept the double call as intentional defense-in-depth and document it
3. Remove the layout check and rely solely on middleware (less defensive)

**Recommended fix:** At minimum, document this as an intentional pattern. Ideally, pass verified user info through request headers from middleware to avoid the duplicate Supabase call.

---

### HIGH-05: Missing `(auth)` route group layout (Checklist #14)

**Severity:** HIGH
**File:** `src/app/(auth)/` -- no layout.tsx exists

The `(auth)` route group has no dedicated `layout.tsx`. Both `sign-in/page.tsx` and `sign-up/page.tsx` independently render a full-page centered layout:

```typescript
// Both sign-in and sign-up independently render:
<div className="flex min-h-screen items-center justify-center bg-[var(--color-bg-secondary)]">
  <div className="w-full max-w-md border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-8)]">
    ...
  </div>
</div>
```

This violates the DRY principle and will become a maintenance burden when additional auth pages are added (password reset, email verification, magic link, etc.). Each new auth page must manually replicate the centering layout.

**Required fix:** Extract a shared auth layout:

```typescript
// src/app/(auth)/layout.tsx
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg-secondary)]">
      <div className="w-full max-w-md border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-8)]">
        {children}
      </div>
    </div>
  );
}
```

---

### HIGH-06: Sign-in and sign-up pages are entirely "use client" with substantial duplication (Checklist #11, #12, #32)

**Severity:** HIGH
**Files:** `src/app/(auth)/sign-in/page.tsx` (103 lines), `src/app/(auth)/sign-up/page.tsx` (108 lines)

Both auth pages are marked `"use client"` at the top level, making the entire page a client component including all the static markup (labels, links, headings). The two pages are ~85% identical -- same form layout, same error handling pattern, same styling, same state management. The only differences are:
- `signInWithPassword` vs `signUp`
- Heading text
- The `emailRedirectTo` option on sign-up
- Link text at the bottom

This creates two problems:
1. **Bundle bloat:** All the static HTML is rendered client-side when it could be server-rendered. The interactive part (the form) should be a small client component composed within a server page.
2. **Duplication:** Any styling or UX change to the auth form must be applied in both files. As more auth methods are added (OAuth, magic link), this duplication multiplies.

**Recommended fix:** Extract a shared `AuthForm` client component that receives configuration props (`mode: "sign-in" | "sign-up"`), and make the page components server components that compose the client form.

---

### HIGH-07: No caching strategy defined (Checklist #64, #65)

**Severity:** HIGH
**Files:** `next.config.ts`, all route segments

The `next.config.ts` is empty:

```typescript
const nextConfig: NextConfig = {
  /* config options here */
};
```

No route segment exports `dynamic`, `revalidate`, or `fetchCache`. No `loading.tsx` files exist for dynamic content. There is no evidence of intentional caching decisions anywhere.

Currently the app has no data-fetching pages beyond auth, so this is not causing bugs today. However, Phase 1A will introduce database-backed pages (projects, estimates). Without establishing caching patterns now, the first developer to add data fetching will set an ad-hoc precedent.

**Required fix before Phase 1A:**
- Decide on default caching strategy for protected vs public pages
- Add `export const dynamic = "force-dynamic"` to the protected layout (user-specific data should never be cached)
- Document the caching strategy in project architecture decisions

---

### HIGH-08: Middleware runs on every request including favicon and API routes (Checklist #61)

**Severity:** HIGH (downgraded from checklist MEDIUM because this codebase calls `getUser()` in middleware)
**File:** `src/middleware.ts` (lines 8-12)

The middleware matcher is:
```typescript
matcher: [
  "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
],
```

This excludes static assets and images, which is correct. However, it still runs on:
- API routes (`/api/*`) -- currently none exist, but they will in Phase 1A
- The auth callback route (`/auth/callback`) -- this is handled in the public routes list, but the middleware still executes and creates a Supabase client + calls `getUser()` before determining it's public
- Health check or monitoring endpoints that may be added later

Each middleware invocation calls `supabase.auth.getUser()` which is a network round-trip. This will matter at scale.

**Recommended fix:** Update the matcher to also exclude `/api/` routes:
```typescript
matcher: [
  "/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
],
```

And consider whether `/auth/callback` should be excluded from middleware entirely (it handles its own auth exchange).

---

## MEDIUM Findings (Noteworthy)

### MED-01: `env.ts` allows skipping validation entirely via SKIP_ENV_VALIDATION

**Severity:** MEDIUM
**File:** `src/env.ts`, line 43

```typescript
skipValidation: !!process.env.SKIP_ENV_VALIDATION,
```

This allows any deployment to bypass env validation by setting a single environment variable. While useful during CI or for specific test scenarios, it undermines the entire T3 env validation system if used carelessly in production. There is no guard to prevent `SKIP_ENV_VALIDATION=true` in production.

**Recommendation:** Add a guard:
```typescript
skipValidation: !!process.env.SKIP_ENV_VALIDATION && process.env.NODE_ENV !== "production",
```

---

### MED-02: Root page does an unconditional redirect with no content (Checklist #66)

**Severity:** MEDIUM
**File:** `src/app/page.tsx`

```typescript
export default function HomePage() {
  redirect("/dashboard");
}
```

This is a server-side redirect on every request to `/`. It means:
- There is no landing page for unauthenticated users
- The redirect chain is: `/` -> redirect to `/dashboard` -> middleware intercepts unauthenticated -> redirect to `/sign-in`. This is two redirects for an unauthenticated user visiting the root URL.

**Recommendation:** Either redirect to `/sign-in` directly for unauthenticated users (check auth state first), or build a proper landing page.

---

### MED-03: Sidebar navigation links reference routes that exist but are placeholder pages

**Severity:** MEDIUM
**File:** `src/components/nav/sidebar.tsx` (lines 7-11), `src/app/(protected)/projects/page.tsx`, `src/app/(protected)/settings/page.tsx`

The sidebar declares navigation items:
```typescript
const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/projects", label: "Projects" },
  { href: "/settings", label: "Settings" },
];
```

The Projects and Settings pages are stubs with "coming soon" text. This is fine for Phase 0, but the nav configuration should be externalized to a shared config that can be feature-flagged, rather than hardcoded in the component. When Phase 1A adds real content, modifying this array requires editing a UI component rather than a configuration.

---

### MED-04: Sign-up page does not handle email confirmation flow correctly

**Severity:** MEDIUM
**File:** `src/app/(auth)/sign-up/page.tsx`, lines 29-30

After calling `signUp()`, the page immediately redirects to `/dashboard`:

```typescript
router.push("/dashboard");
router.refresh();
```

If Supabase is configured to require email confirmation (common in production), the user has not confirmed their email yet. They will be redirected to `/dashboard`, hit the middleware auth check, and be bounced back to `/sign-in` -- a confusing experience. The page should show a "check your email" message instead of redirecting.

---

## Architecture Strengths (for completeness)

These are patterns done correctly that should be preserved as the codebase grows:

1. **Server/client Supabase separation:** Three distinct client factories (`client.ts`, `server.ts`, `admin.ts`) with appropriate boundaries. The admin client correctly uses `server-only` import guard.

2. **Middleware auth with `getUser()`:** Uses the secure `getUser()` method (server-side JWT verification) rather than the insecure `getSession()` (trusts client-provided JWT). This is explicitly tested in `tests/security/secrets.test.ts`.

3. **T3 env validation:** All environment variables are validated with Zod schemas at build time. Server-only secrets are correctly in the `server` block without `NEXT_PUBLIC_` prefix.

4. **Route group organization:** Proper use of `(auth)` and `(protected)` route groups for logical separation.

5. **Design tokens via CSS custom properties:** No hardcoded colors/spacing in components -- all reference `var()` tokens. This makes theming and design system changes possible from a single file.

6. **Security tests as code:** The `tests/security/secrets.test.ts` file actively verifies that `server-only` guards are in place and that secret variable names are not prefixed for client exposure. This is an excellent pattern.

---

## Summary Table

| ID | Severity | Checklist | Finding | File(s) |
|----|----------|-----------|---------|---------|
| CRIT-01 | CRITICAL | #42 | No error boundaries anywhere | All route segments |
| CRIT-02 | CRITICAL | #25, #60 | Open redirect in auth callback | `src/app/auth/callback/route.ts` |
| CRIT-03 | CRITICAL | #54, #55 | No Supabase generated types | All Supabase client files |
| HIGH-01 | HIGH | #16, #68 | No loading states | All route segments |
| HIGH-02 | HIGH | #47 | No not-found handling | All route segments |
| HIGH-03 | HIGH | #39 | Browser Supabase client not memoized | `src/lib/supabase/client.ts` |
| HIGH-04 | HIGH | #62 | Duplicate auth check in middleware + layout | `middleware.ts`, `(protected)/layout.tsx` |
| HIGH-05 | HIGH | #14 | Missing (auth) layout, duplicated wrapper | `src/app/(auth)/` |
| HIGH-06 | HIGH | #11, #12, #32 | Auth pages fully client-rendered, duplicated | `sign-in/page.tsx`, `sign-up/page.tsx` |
| HIGH-07 | HIGH | #64, #65 | No caching strategy defined | `next.config.ts`, all routes |
| HIGH-08 | HIGH | #61 | Middleware runs on routes that don't need it | `src/middleware.ts` |
| MED-01 | MEDIUM | #49 | SKIP_ENV_VALIDATION allows prod bypass | `src/env.ts` |
| MED-02 | MEDIUM | #66 | Root page double-redirects unauthenticated users | `src/app/page.tsx` |
| MED-03 | MEDIUM | #34 | Hardcoded nav config in component | `sidebar.tsx` |
| MED-04 | MEDIUM | -- | Sign-up doesn't handle email confirmation | `sign-up/page.tsx` |

---

## Priority Recommendations

**Before Phase 1A starts (blocking):**
1. Add error boundaries (CRIT-01) -- prevents production crashes
2. Fix auth callback open redirect (CRIT-02) -- security vulnerability
3. Generate and wire Supabase types (CRIT-03) -- all Phase 1A queries will be untyped otherwise

**Early Phase 1A (high priority):**
4. Add loading.tsx files (HIGH-01)
5. Add not-found.tsx files (HIGH-02)
6. Extract auth layout and shared form component (HIGH-05, HIGH-06)
7. Define caching strategy before adding data pages (HIGH-07)
8. Address middleware scope (HIGH-08)

**Ongoing:**
9. Memoize browser Supabase client (HIGH-03)
10. Document or resolve dual auth check pattern (HIGH-04)
