# A9 -- Performance Analyzer: Findings

**Agent:** A9 (Performance Analyzer)
**Scope:** Bundle size, client component scope, rendering, data fetching, caching, font/image optimization, middleware performance, Core Web Vitals
**Codebase:** ShossyWorks -- ~721 LOC, 17 source files (13 TS, 10 TSX, 1 CSS)
**Date:** 2026-04-06

---

## Summary Statistics

| Severity | Count |
|----------|-------|
| CRITICAL | 0     |
| HIGH     | 6     |
| MEDIUM   | 4     |
| LOW      | 2     |
| **Total** | **12** |

**Note on CRITICAL findings:** This codebase is in Phase 0 (scaffolding + auth). No data fetching from application tables exists yet. No images, no heavy third-party libraries, no realtime subscriptions, no timers. The CRITICAL items from the checklist (memory leaks from event listeners/timers/subscriptions, N+1 queries, hydration mismatches, LCP violations) have no applicable code surface at this stage. The findings below focus on architectural patterns already established that will create performance problems as the codebase grows, and on configuration gaps that should be addressed before Phase 1A begins.

---

## HIGH Findings

---

### H1. Middleware calls `getUser()` on every single request -- Supabase auth round-trip on every navigation

**Severity:** HIGH
**Checklist Items:** #49 (TTFB), #27 (server-side performance)
**Files:**
- `src/middleware.ts` (lines 4-6)
- `src/lib/supabase/middleware.ts` (lines 27-30)

**Evidence:**

```typescript
// src/lib/supabase/middleware.ts, line 27-30
// Refresh session -- uses getUser() (NOT getSession()) for security
const {
  data: { user },
} = await supabase.auth.getUser();
```

The middleware matcher is:
```typescript
// src/middleware.ts, line 9-11
matcher: [
  "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
],
```

This matcher captures every non-static request. Every page navigation, every RSC fetch, every route transition triggers a full `getUser()` call. `getUser()` makes a network request to the Supabase Auth server to validate the JWT -- it does NOT just decode the token locally. This adds 50-200ms of latency to every request depending on Supabase region proximity.

**Impact:**
- TTFB increases by the round-trip time to Supabase Auth on every request
- Public routes (/sign-in, /sign-up) also take the hit -- `getUser()` runs BEFORE the public-route check at line 32-33
- As the app adds API routes, each will also go through this middleware

**Recommendation:**
1. Short-circuit public routes BEFORE calling `getUser()`. Move the `publicRoutes` check above the Supabase client creation:
```typescript
const publicRoutes = ["/sign-in", "/sign-up", "/auth/callback"];
const isPublicRoute = publicRoutes.some((route) =>
  request.nextUrl.pathname.startsWith(route)
);
// Only create supabase client and call getUser() for protected routes
if (!isPublicRoute) {
  const supabase = createServerClient(...);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    // redirect to sign-in
  }
  return supabaseResponse;
}
```
2. For authenticated routes, consider using `getSession()` for middleware (local JWT decode, fast) and reserving `getUser()` for server components where a verified user is needed for data operations. The Supabase docs recommend `getUser()` for security-critical paths, but middleware's primary job is token refresh and route guarding, not authoritative user verification.

---

### H2. Double `getUser()` call on every protected page -- redundant Supabase auth round-trip

**Severity:** HIGH
**Checklist Items:** #27 (waterfall/duplicate server-side calls), #30 (missing request deduplication)
**Files:**
- `src/lib/supabase/middleware.ts` (line 30)
- `src/app/(protected)/layout.tsx` (line 10)

**Evidence:**

```typescript
// src/lib/supabase/middleware.ts, line 30
} = await supabase.auth.getUser();

// src/app/(protected)/layout.tsx, line 10
} = await supabase.auth.getUser();
```

Every protected page load triggers `getUser()` twice:
1. First in middleware (network call to Supabase Auth)
2. Then again in the protected layout server component (another network call)

These are independent Supabase client instances (one from `middleware.ts`, one from `server.ts`), so there is no deduplication. This is 2x the auth latency on every protected page.

**Impact:**
- 100-400ms added per protected page load (two sequential Supabase network calls)
- As more server components call `getUser()`, the problem compounds
- No use of React `cache()` to deduplicate within the same request

**Recommendation:**
1. Wrap the server-side `getUser()` with React `cache()` to deduplicate within a single request:
```typescript
import { cache } from "react";

export const getAuthUser = cache(async () => {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  return { user, error };
});
```
2. Use this cached function in the layout and any server component that needs the user. The first call makes the network request; subsequent calls in the same request return the cached result.
3. Consider if the middleware call can be eliminated (let the layout handle auth checks) or if middleware can use `getSession()` (local JWT decode) while layout uses `getUser()`.

---

### H3. Font loading mismatch -- CSS tokens reference fonts not loaded via `next/font`

**Severity:** HIGH
**Checklist Items:** #19 (not using next/font), #20 (missing font-display strategy)
**Files:**
- `src/app/layout.tsx` (line 5)
- `src/app/globals.css` (lines 61-62, 100)

**Evidence:**

`layout.tsx` correctly loads Inter via `next/font`:
```typescript
const inter = Inter({ subsets: ["latin"] });
```

But `globals.css` declares two font families in design tokens:
```css
/* globals.css, line 61-62 */
--font-family: "Inter", system-ui, -apple-system, sans-serif;
--font-mono: "JetBrains Mono", "Fira Code", monospace;

/* globals.css, line 100 */
body { font-family: var(--font-family); }
```

**Problems:**

1. **CSS `--font-family` token hardcodes `"Inter"` as a string**, but `next/font` generates a unique CSS class with a hashed font-family name (e.g., `__Inter_aabbcc`). The CSS variable references the wrong name. The body gets `font-family: "Inter"` from the CSS variable, while the `<body>` element also gets `inter.className` which sets the correct hashed name. These compete. If the CSS variable is used on elements NOT descended from body (e.g., portals, modals), they will try to load "Inter" by name and fall back to system-ui.

2. **`--font-mono` references "JetBrains Mono" and "Fira Code" but neither is loaded** via `next/font` or any other mechanism. When monospace code is rendered (presumably in a construction estimating platform), the browser will:
   - Request "JetBrains Mono" -- fail (not loaded)
   - Request "Fira Code" -- fail (not loaded)
   - Fall back to the browser's default `monospace`
   - No FOUT protection since there is no `font-display` strategy

3. **`Inter` config is minimal** -- only `subsets: ["latin"]` is specified. No `display: "swap"` is explicitly set (next/font defaults to `swap`, so this is acceptable, but `weight` is not restricted, meaning all 9 weights are loaded when the design system only uses 4: 400, 500, 600, 700).

**Impact:**
- LCP degradation if monospace font is used above the fold (browser tries to load non-existent fonts)
- Unnecessary font weight downloads (5 unused weights for Inter)
- CSS variable / next/font naming collision may cause FOUT in portal/modal contexts

**Recommendation:**
1. Load JetBrains Mono via `next/font/google` in `layout.tsx` if monospace text is planned:
```typescript
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });
```
2. Use `next/font` CSS variable mode for Inter as well:
```typescript
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-family",
});
```
3. Apply variables to html element: `<html className={`${inter.variable} ${jetbrainsMono.variable}`}>`
4. Update CSS tokens to reference the CSS variables generated by `next/font` instead of hardcoding font names.

---

### H4. Auth pages are full client components -- entire sign-in/sign-up pages shipped as client-side JavaScript

**Severity:** HIGH
**Checklist Item:** #29 (excessive `use client` directives)
**Files:**
- `src/app/(auth)/sign-in/page.tsx` (line 1)
- `src/app/(auth)/sign-up/page.tsx` (line 1)

**Evidence:**

```typescript
// src/app/(auth)/sign-in/page.tsx, line 1
"use client";

// src/app/(auth)/sign-up/page.tsx, line 1
"use client";
```

Both auth page components are marked `"use client"` at the top level. This means the entire page -- including static layout elements (headings, labels, paragraph text, the Link component) -- is shipped as client-side JavaScript and hydrated in the browser.

**Current client-side ratio:** 5 out of 10 TSX files are `"use client"` (50%). For a codebase this small, that is high. The auth pages represent the primary entry point for unauthenticated users, where first-load performance matters most.

**What actually needs client-side interactivity:**
- Form state management (email, password, error, loading)
- The `handleSubmit` async function
- `useRouter` for navigation after auth

**What does NOT need client-side rendering:**
- The outer layout `<div>` with centering
- The `<h1>` heading ("Sign In" / "Create Account")
- The `<label>` elements
- The link to the other auth page
- The error display (could be server-rendered with a form action)

**Impact:**
- Larger JavaScript bundle for the auth entry point
- Slower Time to Interactive for unauthenticated users
- All static markup is rendered client-side instead of being streamed as HTML

**Recommendation:**
Extract the interactive form into a small client component, keep the page as a server component:
```
sign-in/
  page.tsx          (server component -- renders layout, heading, link)
  sign-in-form.tsx  (client component -- form state + submission)
```
The form component handles `useState`, `useRouter`, and `handleSubmit`. The page component handles the static shell. This reduces the client-side bundle and allows the page structure to be streamed as HTML.

Alternatively, for Next.js 16 with React 19, consider using server actions with progressive enhancement:
```typescript
// page.tsx (server component)
async function signIn(formData: FormData) {
  "use server";
  // handle auth server-side
}
```
This eliminates the need for client-side `useState` for form fields entirely.

---

### H5. No `loading.tsx` or Suspense boundaries -- entire protected layout blocks on auth check

**Severity:** HIGH
**Checklist Items:** #28 (missing streaming with Suspense), #52 (large component trees without Suspense)
**Files:**
- `src/app/(protected)/layout.tsx`
- All directories under `src/app/` (no `loading.tsx` exists anywhere)

**Evidence:**

The protected layout performs an async `getUser()` call:
```typescript
// src/app/(protected)/layout.tsx, line 7-10
const supabase = await createClient();
const {
  data: { user },
} = await supabase.auth.getUser();
```

There is no `loading.tsx` at any route level. There are no Suspense boundaries anywhere in the component tree. This means:

1. The entire protected page (layout + sidebar + header + content) blocks until `getUser()` completes
2. Users see a blank white screen during the auth verification (50-200ms)
3. As data fetching is added in Phase 1A, pages will block on ALL sequential awaits with no partial rendering

**No `loading.tsx` files exist in the project** -- confirmed by glob search.

**Impact:**
- White flash on every protected navigation while auth resolves
- No streaming capability -- as the app grows, users will wait for the slowest data fetch before seeing anything
- First Contentful Paint delayed by auth verification latency

**Recommendation:**
1. Add `loading.tsx` at the protected route group level:
```typescript
// src/app/(protected)/loading.tsx
export default function ProtectedLoading() {
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="animate-pulse">Loading...</div>
    </div>
  );
}
```
2. Plan Suspense boundaries for Phase 1A data-heavy pages (project lists, estimate details). Each independent data section should have its own Suspense boundary to enable streaming.

---

### H6. No `next.config.ts` performance configuration -- empty config with no image, caching, or headers setup

**Severity:** HIGH
**Checklist Items:** #17 (image format config), #18 (external images), #31 (missing ISR), #32 (missing cache headers)
**File:** `next.config.ts`

**Evidence:**

```typescript
// next.config.ts
import "./src/env";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
```

The entire Next.js configuration is empty. No performance-related configuration exists:
- No `images` config (no `remotePatterns`, no AVIF format preference)
- No `headers()` function for security or cache headers
- No `experimental` optimizations
- No `compress` setting (though Vercel handles this)

**Impact (as the app grows):**
- External images (Supabase storage, user uploads) will fail with `next/image` without `remotePatterns`
- No AVIF optimization (30-40% savings over WebP)
- No static cache headers for API responses
- No security headers (CSP, HSTS, X-Frame-Options)

**Recommendation:**
Set up the configuration proactively before Phase 1A:
```typescript
const nextConfig: NextConfig = {
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};
```

---

## MEDIUM Findings

---

### M1. Supabase browser client created fresh on every call -- no singleton pattern

**Severity:** MEDIUM
**Checklist Item:** #5 (unstable references causing re-renders)
**Files:**
- `src/lib/supabase/client.ts` (line 6-8)
- `src/app/(auth)/sign-in/page.tsx` (line 20)
- `src/app/(auth)/sign-up/page.tsx` (line 20)
- `src/components/nav/user-menu.tsx` (line 10)

**Evidence:**

```typescript
// src/lib/supabase/client.ts
export function createClient() {
  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
```

Every call to `createClient()` creates a new Supabase client instance. In the sign-in, sign-up, and user-menu components, this is called inside event handlers (acceptable -- not in render path). However, `createBrowserClient` from `@supabase/ssr` internally deduplicates instances by default, so this is not as severe as it appears. The risk is future code calling `createClient()` inside a render body or `useEffect` without memoization, where it would create new instances on every render.

**Impact:**
- Currently low -- `createBrowserClient` handles deduplication internally
- Risk increases as more client components are added without awareness of this pattern

**Recommendation:**
Document that `createBrowserClient` deduplicates internally, or make it explicit with a module-level singleton:
```typescript
let client: ReturnType<typeof createBrowserClient> | null = null;
export function createClient() {
  if (!client) {
    client = createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  }
  return client;
}
```

---

### M2. No bundle analyzer configured -- no visibility into JavaScript payload

**Severity:** MEDIUM
**Checklist Item:** #4 (bundle analyzer not configured)
**File:** `package.json`

**Evidence:**

No `@next/bundle-analyzer` in dependencies or devDependencies. No bundle analysis script in `package.json` scripts section.

**Impact:**
- No way to detect bundle size regressions as dependencies are added in Phase 1A+
- Heavy dependencies (chart libraries for estimates, PDF generators for reports) could be imported wholesale without detection
- No baseline measurement of current bundle size

**Recommendation:**
```bash
npm install -D @next/bundle-analyzer
```
```typescript
// next.config.ts
import withBundleAnalyzer from "@next/bundle-analyzer";

const config = withBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
})({
  // ... nextConfig
});
```
Add script: `"analyze": "ANALYZE=true next build"`

---

### M3. No error tracking or performance monitoring -- silent failures in production

**Severity:** MEDIUM
**Checklist Items:** #46 (LCP measurement), #47 (CLS measurement), #48 (INP measurement)
**File:** `package.json`

**Evidence:**

Searched for: Sentry, Datadog, Logtail, Axiom, LogRocket, New Relic -- none found in `package.json`. No Web Vitals reporting is configured.

**Impact:**
- No Core Web Vitals measurement in production
- No error tracking -- client-side errors are lost
- No performance regression detection
- As the app grows, performance issues will be invisible until users complain

**Recommendation:**
At minimum, add Web Vitals reporting. Vercel Analytics is the simplest option:
```bash
npm install @vercel/analytics @vercel/speed-insights
```
```typescript
// src/app/layout.tsx
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";

// Inside body:
<Analytics />
<SpeedInsights />
```
For error tracking, Sentry's Next.js SDK provides both error and performance monitoring. Configure before Phase 1A begins.

---

### M4. No `error.tsx` or `global-error.tsx` -- unhandled errors crash to white screen

**Severity:** MEDIUM (performance-adjacent -- affects perceived performance and user experience during errors)
**Checklist Item:** Not a direct performance item, but #46 (LCP) is affected because error states produce zero content
**Files:** None exist -- this is the finding

**Evidence:**

Glob search confirmed: no `error.tsx`, `global-error.tsx`, `not-found.tsx`, or `loading.tsx` exists anywhere under `src/app/`.

While primarily an error-handling concern (A10's domain), this has direct performance implications:
- An error during server rendering produces no HTML at all -- infinite perceived load time
- Without `not-found.tsx`, 404 pages fall through to Next.js defaults with no streaming
- Client-side navigation errors produce unrecoverable white screens

**Impact:**
- Any server error produces a full-page white screen (worst possible LCP)
- No graceful degradation for partial failures

**Recommendation:**
Create at minimum:
- `src/app/error.tsx` -- generic error boundary with retry button
- `src/app/global-error.tsx` -- catches root layout errors
- `src/app/not-found.tsx` -- custom 404 page

---

## LOW Findings

---

### L1. Inter font loads all weights -- only 4 of 9 are used

**Severity:** LOW
**Checklist Item:** #21 (loading too many font weights)
**Files:**
- `src/app/layout.tsx` (line 5)
- `src/app/globals.css` (lines 72-75)

**Evidence:**

```typescript
// layout.tsx, line 5
const inter = Inter({ subsets: ["latin"] });
```

```css
/* globals.css, lines 72-75 */
--font-normal: 400;
--font-medium: 500;
--font-semibold: 600;
--font-bold: 700;
```

The design system defines 4 font weights (400, 500, 600, 700), but the `Inter` font is loaded without a `weight` restriction, meaning `next/font` loads all available weights. Inter has variable font support, so the impact is mitigated (one file, not 9), but restricting weights reduces the variable font file size.

**Recommendation:**
```typescript
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});
```

---

### L2. No `preconnect` hint for Supabase API domain

**Severity:** LOW
**Checklist Item:** #56 (missing resource hints)
**File:** `src/app/layout.tsx`

**Evidence:**

The app makes network requests to the Supabase URL on every page (via middleware and layout auth checks), but there is no `<link rel="preconnect">` hint to warm up the TLS connection.

**Recommendation:**
Add to root layout `<head>`:
```tsx
<link rel="preconnect" href={process.env.NEXT_PUBLIC_SUPABASE_URL} />
```
Or use Next.js metadata:
```typescript
export const metadata: Metadata = {
  other: {
    "link:preconnect": process.env.NEXT_PUBLIC_SUPABASE_URL,
  },
};
```

---

## Patterns Reviewed with No Findings

These areas were checked and found to be either not applicable (no code surface) or correctly implemented:

| Area | Status | Notes |
|------|--------|-------|
| Memory leaks (timers, listeners, subscriptions) | N/A | No `addEventListener`, `setInterval`, `setTimeout`, or Supabase realtime subscriptions exist |
| Raw `<img>` tags | Clean | No `<img>` elements found; no images used yet |
| N+1 query patterns | N/A | No application data queries exist yet |
| Hydration mismatches | Clean | Only `window.location.origin` in sign-up (inside event handler, not render body) |
| Render-blocking scripts | Clean | No `<script>` tags found |
| Heavy library imports | Clean | Dependencies are minimal: Supabase, Zod, next/font. No lodash, moment, chart libs |
| CSS-in-JS overhead | Clean | Uses Tailwind CSS (zero runtime, build-time only) |
| Third-party scripts | Clean | None present |
| `getSession()` misuse | Clean | All auth checks use `getUser()` correctly |
| Turbopack | Enabled | `"dev": "next dev --turbopack"` in package.json |
| TypeScript strict mode | Enabled | `"strict": true` in tsconfig.json |
| SELECT * anti-pattern | N/A | No application queries exist |
| Static route matcher | Correct | Middleware matcher excludes static assets, images, favicon |

---

## Prioritized Remediation Plan

### Phase 0 (Before Phase 1A begins -- ~2 hours)

1. **H1 + H2: Fix middleware auth flow** -- Short-circuit public routes before `getUser()`. Wrap server-side `getUser()` in `cache()`. Eliminates 150-400ms per page.
2. **H5: Add `loading.tsx`** at `(protected)/` level. Takes 5 minutes, prevents white flashes.
3. **H4: Refactor auth pages** -- Extract forms to client components, keep pages as server components. Reduces auth entry-point bundle.

### Phase 0.5 (During Phase 1A setup -- ~1 hour)

4. **H3: Fix font loading** -- Use `next/font` variable mode for Inter, load JetBrains Mono if needed, update CSS tokens.
5. **H6: Configure `next.config.ts`** -- Add `images`, `headers()`, prepare for Supabase storage images.
6. **M2: Install bundle analyzer** -- Establish baseline before adding Phase 1A dependencies.

### Phase 1A (Ongoing)

7. **M3: Add monitoring** -- Vercel Analytics + Speed Insights or Sentry. Measure before you optimize.
8. **M4: Add error boundaries** -- `error.tsx`, `global-error.tsx`, `not-found.tsx`.
9. **M1: Document or enforce client singleton** -- Prevent future misuse as more client components are added.

---

## Key Architectural Concern

The most impactful performance issue is the **auth verification architecture** (H1 + H2). The current pattern of `getUser()` in middleware + `getUser()` in layout means every protected page makes 2 sequential network calls to Supabase Auth before rendering any content. As the app grows and pages add their own data fetching, the waterfall becomes:

```
Request -> Middleware getUser() [100ms]
        -> Layout getUser() [100ms]
        -> Page data fetch 1 [variable]
        -> Page data fetch 2 [variable]
        -> Render
```

Fixing this to use `cache()` and short-circuiting public routes could save 100-200ms per page load immediately, and the `cache()` pattern scales correctly as more components need user data.
