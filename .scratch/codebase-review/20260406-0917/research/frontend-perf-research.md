# Frontend & Accessibility + Performance & Build Research

> Research for Cluster 5 and Cluster 6 findings from consolidated-findings.md
> Date: 2026-04-03

---

## Table of Contents

1. [Focus-Visible Ring Pattern (Tailwind v4)](#1-focus-visible-ring-pattern-tailwind-v4)
2. [aria-live Regions for Conditional Errors in React](#2-aria-live-regions-for-conditional-errors-in-react)
3. [Skip-to-Content Link (WCAG 2.4.1)](#3-skip-to-content-link-wcag-241)
4. [prefers-reduced-motion Handling](#4-prefers-reduced-motion-handling)
5. [Open Graph / Social Metadata](#5-open-graph--social-metadata)
6. [Deduplicating getUser() with React cache()](#6-deduplicating-getuser-with-react-cache)
7. [Middleware: getSession() vs getUser() vs getClaims()](#7-middleware-getsession-vs-getuser-vs-getclaims)
8. [next/font Variable Mode for Tailwind v4](#8-nextfont-variable-mode-for-tailwind-v4)
9. [Font Weight Optimization](#9-font-weight-optimization)
10. [Auth Pages: use client Overhead](#10-auth-pages-use-client-overhead)
11. [Next.js Image Config for Supabase Storage](#11-nextjs-image-config-for-supabase-storage)
12. [Complexity Summary](#12-complexity-summary)

---

## 1. Focus-Visible Ring Pattern (Tailwind v4)

**Finding:** `focus:outline-none` destroys focus indicators with no replacement -- WCAG 2.4.7 AA failure.

### Best Practice

Use `outline` (not `ring`) for focus indicators. Outlines survive Windows High Contrast Mode; `box-shadow`/`ring` utilities become invisible in that mode.

Tailwind v4 changed how `outline-none` works internally -- it now uses a transparent outline so that Windows High Contrast Mode users still see focus. But if code explicitly sets `focus:outline-none` without a visible replacement, the indicator is gone for everyone.

### Code Pattern

```css
/* globals.css -- base focus style using design tokens */
@layer base {
  :focus-visible {
    outline: 2px solid var(--color-ring, var(--color-primary));
    outline-offset: 2px;
  }
}
```

```tsx
// Per-component Tailwind classes (replaces focus:outline-none)
className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
```

If using `@theme` tokens:

```css
@theme {
  --color-ring: var(--color-primary);
}
```

```tsx
// Then use the theme utility directly
className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
```

### Key Rules

- **Never** use `focus:outline-none` or `outline-none` without a visible `focus-visible:` replacement.
- Use `outline`, not `ring`, for focus indicators (High Contrast Mode compatibility).
- Use `focus-visible:` variant (not `focus:`), so mouse clicks do not show the ring.
- Apply a base `:focus-visible` rule in `globals.css` as a safety net.

### Fix Complexity

**Medium** -- Search-and-replace `focus:outline-none` across all components (~16 occurrences estimated). Add base `:focus-visible` rule in globals.css. Each component needs a visible `focus-visible:outline-*` added.

Sources:
- https://github.com/tailwindlabs/tailwindcss/issues/15152
- https://tailwindcss.com/docs/hover-focus-and-other-states
- https://tailwindcss.com/docs/outline-style

---

## 2. aria-live Regions for Conditional Errors in React

**Finding:** Error messages not announced to screen readers (missing `role="alert"`, `aria-live`).

### Best Practice

The live region element **must exist in the DOM before the message appears**. Conditional rendering (`{error && <div aria-live="polite">...}`) creates a new DOM node each time -- screen readers do not track new nodes as live region updates.

### Code Pattern -- Per-Form Error

```tsx
// WRONG: conditional rendering destroys the live region
{error && <p role="alert">{error}</p>}

// CORRECT: always mounted, content changes trigger announcement
<p role="alert" aria-live="assertive" aria-atomic="true">
  {error ?? ''}
</p>
```

For form-level errors that should interrupt the user, use `role="alert"` (implicitly `aria-live="assertive"`).

For field-level validation that should not interrupt:

```tsx
<p
  aria-live="polite"
  aria-atomic="true"
  className={error ? 'text-destructive text-sm' : 'sr-only'}
>
  {error ?? ''}
</p>
```

### Code Pattern -- Global Announcer (App-Level)

For toast notifications and async errors, mount a single persistent announcer at the app root:

```tsx
// components/shared/live-announcer.tsx
'use client';

import { createContext, useContext, useState, useCallback } from 'react';

const AnnounceContext = createContext<(msg: string) => void>(() => {});

export function LiveAnnouncer({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState('');

  const announce = useCallback((msg: string) => {
    setMessage(''); // clear first to re-trigger announcement
    requestAnimationFrame(() => setMessage(msg));
  }, []);

  return (
    <AnnounceContext value={announce}>
      {children}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {message}
      </div>
    </AnnounceContext>
  );
}

export const useAnnounce = () => useContext(AnnounceContext);
```

### Key Rules

- Form error containers: always in the DOM, update text content (never conditionally render the container).
- `role="alert"` for form-level errors (assertive, interrupts screen reader).
- `aria-live="polite"` for field-level validation (waits for idle).
- Clear and re-set message to re-trigger announcements of the same text.

### Fix Complexity

**Low-Medium** -- Update error rendering in auth forms (login, signup, forgot-password). Create a shared `LiveAnnouncer` component if toast/async errors exist.

Sources:
- https://k9n.dev/blog/2025-11-aria-live/
- https://dev.to/abbeyperini/live-regions-in-react-4dmd
- https://almerosteyn.com/2017/09/aria-live-regions-in-react

---

## 3. Skip-to-Content Link (WCAG 2.4.1)

**Finding:** No skip-to-content link. WCAG 2.4.1 Level A failure.

### Code Pattern

```tsx
// components/shared/skip-link.tsx
export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[9999] focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-foreground focus:outline-2 focus:outline-offset-2 focus:outline-ring focus:shadow-lg"
    >
      Skip to main content
    </a>
  );
}
```

```tsx
// app/layout.tsx
import { SkipLink } from '@/components/shared/skip-link';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SkipLink />
        <header>{/* nav */}</header>
        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
      </body>
    </html>
  );
}
```

### Key Rules

- Place `<SkipLink>` as the first focusable element in the body.
- Target `<main>` must have `id="main-content"` and `tabIndex={-1}`.
- Use `sr-only` + `focus:not-sr-only` pattern (not `display: none`, which hides from screen readers entirely).

### Fix Complexity

**Low** -- One new component, one edit to `layout.tsx`, add `id` to `<main>`.

Sources:
- https://nextjs.org/docs/architecture/accessibility
- https://prismic.io/blog/nextjs-accessibility

---

## 4. prefers-reduced-motion Handling

**Finding:** No `prefers-reduced-motion` handling (WCAG 2.3.3 AAA).

### Code Pattern

Use Tailwind's `motion-safe:` and `motion-reduce:` variants:

```tsx
// Only animate when user has NOT requested reduced motion
<div className="motion-safe:transition-all motion-safe:duration-300 motion-reduce:transition-none">
  ...
</div>
```

Global default in `globals.css`:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

### Key Rules

- Use `motion-safe:` prefix for all transition/animation classes.
- Add a global reduced-motion reset as a safety net.
- Test with OS-level reduced motion setting enabled.

### Fix Complexity

**Low** -- Add global CSS reset (covers most cases). Audit animation-heavy components individually for `motion-safe:` prefixes.

Sources:
- https://www.w3.org/WAI/WCAG22/Techniques/css/C39.html
- https://www.epicweb.dev/tips/motion-safe-and-motion-reduce-modifiers
- https://blog.pope.tech/2025/12/08/design-accessible-animation-and-movement/

---

## 5. Open Graph / Social Metadata

**Finding:** No Open Graph / social metadata, no `sitemap.ts` or `robots.ts`.

### Code Pattern -- Root Layout Metadata

```tsx
// app/layout.tsx
import type { Metadata } from 'next';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://app.example.com'),
  title: {
    default: 'ShossyWorks',
    template: '%s | ShossyWorks',
  },
  description: 'Project management for construction professionals.',
  openGraph: {
    type: 'website',
    siteName: 'ShossyWorks',
    title: 'ShossyWorks',
    description: 'Project management for construction professionals.',
    images: [
      {
        url: '/og-image.png',   // 1200x630px
        width: 1200,
        height: 630,
        alt: 'ShossyWorks',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ShossyWorks',
    description: 'Project management for construction professionals.',
    images: ['/og-image.png'],
  },
};
```

### Code Pattern -- robots.ts

```tsx
// app/robots.ts
import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/dashboard/', '/api/'],
      },
    ],
    sitemap: `${process.env.NEXT_PUBLIC_SITE_URL}/sitemap.xml`,
  };
}
```

### Code Pattern -- sitemap.ts

```tsx
// app/sitemap.ts
import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://app.example.com';
  return [
    { url: baseUrl, lastModified: new Date(), changeFrequency: 'monthly', priority: 1 },
    { url: `${baseUrl}/login`, lastModified: new Date(), changeFrequency: 'yearly', priority: 0.3 },
  ];
}
```

### Minimum OG for B2B SaaS

| Property | Required | Notes |
|----------|----------|-------|
| `og:title` | Yes | Page or app name |
| `og:description` | Yes | Value proposition, <160 chars |
| `og:image` | Yes | 1200x630px, absolute URL |
| `og:type` | Yes | `website` for landing, `article` for blog |
| `og:url` | Recommended | Canonical URL |
| `twitter:card` | Recommended | `summary_large_image` |

### Fix Complexity

**Low** -- Add metadata export to root layout, create `robots.ts`, create `sitemap.ts`, design a 1200x630 OG image.

Sources:
- https://nextjs.org/docs/app/getting-started/metadata-and-og-images
- https://nextjs.org/docs/app/api-reference/functions/generate-metadata

---

## 6. Deduplicating getUser() with React cache()

**Finding:** Double `getUser()` on every protected page (middleware + layout) -- 200-400ms wasted per request.

### Best Practice

Wrap `getUser()` with `React.cache()` so that multiple calls within the same server render only hit Supabase once. React deduplicates by function reference + serialized arguments within a single request.

### Code Pattern

```tsx
// lib/auth/get-user.ts
import { cache } from 'react';
import { createServerClient } from '@/lib/supabase/server';

/**
 * Cached getUser -- safe to call from any server component.
 * Multiple calls within the same request return the same result.
 */
export const getUser = cache(async () => {
  const supabase = await createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
});

/**
 * Strict version -- throws if no user (use in protected layouts).
 */
export const requireUser = cache(async () => {
  const user = await getUser();
  if (!user) throw new Error('Authentication required');
  return user;
});
```

Usage in server components:

```tsx
// app/(protected)/layout.tsx
import { requireUser } from '@/lib/auth/get-user';

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser(); // first call -- hits Supabase
  return <SidebarLayout user={user}>{children}</SidebarLayout>;
}

// app/(protected)/dashboard/page.tsx
import { getUser } from '@/lib/auth/get-user';

export default async function DashboardPage() {
  const user = await getUser(); // second call -- returns cached result, no network
  return <Dashboard userId={user!.id} />;
}
```

### How It Works

- `cache()` memoizes by function reference. Same function called twice in the same React server render = one actual execution.
- Scope is per-request only. No cross-request leakage.
- This replaces prop-drilling `user` from layout to page.

### Key Rules

- Export a single `getUser` wrapped with `cache()` from one module.
- Import from `@/lib/auth/get-user` everywhere (same function reference = deduplication).
- Do NOT create new `cache()` wrappers in each file (that creates different function references).
- Middleware still runs separately (different request context) -- see Section 7 for the middleware fix.

### Fix Complexity

**Low** -- Create one new file (`lib/auth/get-user.ts`), update imports in layout and pages. No behavioral change.

Sources:
- https://nextjs.org/docs/app/getting-started/caching
- https://nextjs.org/docs/app/getting-started/fetching-data
- https://github.com/vercel/next.js/issues/62162

---

## 7. Middleware: getSession() vs getUser() vs getClaims()

**Finding:** Middleware calls `getUser()` on every request (including public routes), adding 200-400ms network round-trip per page load.

### The Three Options

| Method | Speed | Security | Mechanism |
|--------|-------|----------|-----------|
| `getSession()` | Fast (~1ms) | Unsafe | Reads JWT from cookie, checks format/expiry only. Does NOT validate signature. Tampered tokens pass. |
| `getClaims()` | Fast (~1-5ms) | Safe | Validates JWT signature against project's public keys locally. No network call. |
| `getUser()` | Slow (200-400ms) | Safest | Calls Supabase Auth server to verify token is valid and not revoked. |

### Recommendation: getClaims() in Middleware

`getClaims()` is the correct choice for middleware:
- Validates JWT signature cryptographically (safe against tampering).
- No network round-trip (fast, edge-compatible).
- Only misses: revoked sessions (user logged out elsewhere). For that edge case, `getUser()` in the server component layout catches it.

```tsx
// middleware.ts
import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const PUBLIC_ROUTES = ['/login', '/signup', '/forgot-password', '/auth/callback'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip auth check for public routes FIRST (before any Supabase call)
  if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value, options } of cookiesToSet) {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getClaims() validates JWT signature locally -- fast, no network call
  const { data: { claims }, error } = await supabase.auth.getClaims();

  if (error || !claims) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
```

### Key Rules

- Check public routes BEFORE any Supabase call (currently checking after).
- Use `getClaims()` in middleware (fast + cryptographically secure).
- Use `getUser()` (via `cache()` wrapper) in server component layouts for full verification.
- This layered approach gives speed at the edge + security at render time.

### Fix Complexity

**Low-Medium** -- Update `middleware.ts` to use `getClaims()` and reorder public route check. Verify `@supabase/ssr` version supports `getClaims()` (available since late 2025).

Sources:
- https://github.com/supabase/supabase/issues/40985
- https://github.com/orgs/supabase/discussions/20905
- https://supabase.com/docs/reference/javascript/auth-getclaims
- https://supabase.com/docs/guides/auth/server-side/nextjs

---

## 8. next/font Variable Mode for Tailwind v4

**Finding:** Font loading mismatch: CSS tokens reference "Inter" string but `next/font` uses a hashed name. Monospace font "JetBrains Mono" referenced in tokens but never loaded.

### Best Practice: @theme inline

In Tailwind v4, use `@theme inline` to map `next/font` CSS variables into Tailwind theme tokens. The `inline` keyword is critical -- it tells Tailwind to inline the variable value rather than creating a broken chain of `var()` references across scopes.

### Code Pattern

```tsx
// app/layout.tsx
import { Inter, JetBrains_Mono } from 'next/font/google';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',      // CSS variable name
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains',
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
```

```css
/* globals.css */
@import "tailwindcss";

@theme inline {
  --font-sans: var(--font-inter);
  --font-mono: var(--font-jetbrains);
}
```

Usage in markup:

```tsx
// Uses the theme utility directly -- no arbitrary value syntax needed
<p className="font-sans">Body text in Inter</p>
<code className="font-mono">Code in JetBrains Mono</code>
```

### Why "inline" Matters

Without `inline`, Tailwind generates utility classes that reference `--font-sans` as a theme variable. But `next/font` defines `--font-inter` on `<html>`, and the theme variable lives in a different scope. The `inline` keyword tells Tailwind to substitute `var(--font-inter)` directly into the generated CSS, avoiding the scope mismatch.

### Key Rules

- Use `variable` option in `next/font` to create CSS variables.
- Apply both variables to `<html>` via `className`.
- Map variables in `@theme inline {}` block in `globals.css`.
- Use `font-sans` / `font-mono` utilities, NOT `font-[var(--font-inter)]`.
- Remove any hardcoded font family strings like `"Inter"` from design tokens.

### Fix Complexity

**Medium** -- Update `layout.tsx` font loading, add `@theme inline` block, update `globals.css` tokens, replace `font-[var(...)]` usages across components.

Sources:
- https://tailwindcss.com/docs/theme
- https://www.owolf.com/blog/how-to-use-custom-fonts-in-a-nextjs-15-tailwind-4-app
- https://github.com/tailwindlabs/tailwindcss/discussions/13410

---

## 9. Font Weight Optimization

**Finding:** Inter loads all 9 weights, design system uses only 4.

### Best Practice

Inter is a variable font. When loaded as variable, a single file covers all weights (100-900). The file size is already optimized by `next/font` with automatic subsetting. You do NOT need to restrict weights for variable fonts -- the single file is smaller than loading 4 individual static weight files.

However, if using static (non-variable) Inter, restrict to only needed weights:

```tsx
// Only if NOT using variable font
const inter = Inter({
  weight: ['400', '500', '600', '700'],  // Only the 4 used weights
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});
```

### Key Rules

- Variable fonts: no weight restriction needed (single file, auto-subsetted).
- Static fonts: list only the weights your design system uses.
- Always set `subsets: ['latin']` (or whichever subsets you need).
- Always set `display: 'swap'` for performance.

### Fix Complexity

**Low** -- Verify Inter is loading as variable font (it should be by default with `next/font/google`). If not, add explicit weight restriction.

Sources:
- https://nextjs.org/docs/app/api-reference/components/font
- https://nextjs.org/docs/app/getting-started/fonts

---

## 10. Auth Pages: use client Overhead

**Finding:** Auth pages are entirely `"use client"` -- all static markup shipped as JS.

### Best Practice

Split auth pages into a Server Component wrapper (static layout, heading, branding) and a Client Component form (interactive inputs, state, submission).

### Code Pattern

```tsx
// app/(auth)/login/page.tsx  -- Server Component (NO "use client")
import { LoginForm } from './login-form';

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-6 p-8">
        {/* Static markup -- rendered as HTML, zero JS */}
        <div className="text-center">
          <h1 className="text-2xl font-bold">Welcome back</h1>
          <p className="text-muted-foreground">Sign in to your account</p>
        </div>

        {/* Interactive form -- Client Component boundary */}
        <LoginForm />
      </div>
    </div>
  );
}
```

```tsx
// app/(auth)/login/login-form.tsx  -- Client Component
'use client';

import { useState } from 'react';
// ... form logic, validation, submission
```

### Impact

- Static markup (heading, description, layout) is rendered as HTML -- zero JS shipped.
- Only the form (inputs, validation, submission) is hydrated as a Client Component.
- First Contentful Paint improves because the browser renders HTML before JS loads.

### Fix Complexity

**Low** -- Extract the `"use client"` boundary from the page level to the form component level. Mechanical refactor, no logic changes.

Sources:
- https://nextjs.org/docs/app/getting-started/server-and-client-components

---

## 11. Next.js Image Config for Supabase Storage

**Finding:** No `next.config.ts` performance config (images, headers, caching).

### Code Pattern

```tsx
// next.config.ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
    formats: ['image/avif', 'image/webp'],
  },
  // Security and caching headers
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      {
        source: '/fonts/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },
};

export default nextConfig;
```

### Fix Complexity

**Low** -- Add configuration to `next.config.ts`. No code changes.

Sources:
- https://nextjs.org/docs/app/api-reference/components/image
- https://nextjs.org/docs/app/api-reference/config/next-config-js/images

---

## 12. Complexity Summary

| # | Finding | Complexity | Effort | Dependencies |
|---|---------|-----------|--------|--------------|
| 1 | Focus-visible ring pattern | Medium | ~2hr | None |
| 2 | aria-live error regions | Low-Medium | ~1.5hr | None |
| 3 | Skip-to-content link | Low | ~20min | None |
| 4 | prefers-reduced-motion | Low | ~30min | None |
| 5 | OG / social metadata | Low | ~45min | OG image asset |
| 6 | Deduplicate getUser() with cache() | Low | ~30min | None |
| 7 | Middleware getClaims() | Low-Medium | ~1hr | @supabase/ssr version check |
| 8 | next/font + @theme inline | Medium | ~2hr | Cluster 7 CSS token fixes |
| 9 | Font weight optimization | Low | ~15min | Item 8 |
| 10 | Auth page use client split | Low | ~45min per page | None |
| 11 | next.config.ts image/headers | Low | ~30min | None |

### Recommended Fix Order

1. **Quick wins first (< 30min each):** Items 3, 4, 6, 9, 11
2. **Medium effort, high impact:** Items 7, 2, 10
3. **Coordinate with Cluster 7:** Items 1, 8 (both depend on design token / Tailwind v4 @theme decisions)
4. **Needs asset:** Item 5 (OG image)

### Cross-Cluster Dependencies

- **Items 1, 8 depend on Cluster 7** (CSS token fixes): The `@theme` block, `@theme inline` for fonts, and focus ring token all interact with the same `globals.css` and design token architecture. Fix Cluster 7 first, then apply items 1 and 8.
- **Items 6 + 7 are complementary:** The `cache()` wrapper (item 6) and middleware `getClaims()` (item 7) together solve the double-getUser problem. Implement both in the same PR.
