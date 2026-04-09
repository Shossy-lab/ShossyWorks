# Consolidated Findings -- Codebase Review

**Date:** 2026-04-06
**Codebase:** ShossyWorks (Construction Estimating Platform)
**Stack:** Next.js 16.2.2 + Supabase + Vercel + Tailwind CSS v4
**Phase:** Phase 0 (scaffolding + auth) -- ~721 LOC across 25 source files
**Agents:** 13

---

## Summary

- **Total raw findings:** 155 across 13 agents
- **After dedup:** 52 unique findings
- **Severity breakdown after dedup:**

| Severity | Count |
|----------|-------|
| CRITICAL | 10 |
| HIGH | 27 |
| MEDIUM | 15 |
| **Total** | **52** |

**Top 3 systemic issues (by agent consensus):**
1. **Open redirect in auth callback** -- flagged by 7 agents (A1, A2, A4, A6, A7, A10, A13)
2. **Overpermissive RLS policy on user_roles** -- flagged by 5 agents (A1, A2, A8, A13, A6)
3. **Missing error boundaries (error.tsx/not-found.tsx/loading.tsx)** -- flagged by 6 agents (A6, A7, A9, A10, A12, A13)

---

## Consensus Heatmap

Findings confirmed by 2+ agents, sorted by agent count then severity.

| # | Finding | Severity | Flagged By | Confidence |
|---|---------|----------|------------|------------|
| 1 | Open redirect in auth callback (`next` param unvalidated) | CRITICAL | A1, A2, A4, A6, A7, A10, A13 (7) | VERY HIGH |
| 2 | No error boundaries (error.tsx / global-error.tsx / not-found.tsx) | CRITICAL | A6, A7, A9, A10, A12, A13 (6) | VERY HIGH |
| 3 | RLS policy `USING(true) WITH CHECK(true)` on user_roles | CRITICAL | A1, A2, A6, A8, A13 (5) | VERY HIGH |
| 4 | Missing Supabase generated types + untyped clients (no `<Database>` generic) | CRITICAL | A3, A4, A6, A7, A8 (5) | VERY HIGH |
| 5 | No loading.tsx / Suspense boundaries anywhere | HIGH | A6, A9, A10, A12 (4) | VERY HIGH |
| 6 | Raw Supabase auth error messages exposed to users | HIGH | A1, A2, A10, A12 (4) | VERY HIGH |
| 7 | Auth callback silently swallows error details (no logging) | HIGH | A1, A4, A7, A10 (4) | VERY HIGH |
| 8 | Missing security headers in next.config.ts | HIGH | A1, A2, A9 (3) | HIGH |
| 9 | `SKIP_ENV_VALIDATION` bypass with no production guard | HIGH | A1, A6, A7 (3) | HIGH |
| 10 | Non-null assertions (`!`) in test files | HIGH | A3, A4, A5 (3) | HIGH |
| 11 | No rate limiting on auth endpoints | HIGH | A1, A2 (2) | HIGH |
| 12 | Auth form duplication (sign-in / sign-up ~85% identical) | HIGH | A4, A6 (2) | HIGH |
| 13 | Auth pages entirely `"use client"` (bundle bloat) | HIGH | A6, A9 (2) | HIGH |
| 14 | Middleware over-matching (runs on all non-static routes) | HIGH | A1, A6, A7 (3) | HIGH |
| 15 | Double `getUser()` call per protected page (middleware + layout) | HIGH | A6, A9 (2) | HIGH |
| 16 | Sign-up redirects to dashboard before email verification | CRITICAL | A2, A6, A7, A13 (4) | VERY HIGH |
| 17 | Browser Supabase client not memoized (new instance per call) | MEDIUM | A6, A7, A9 (3) | HIGH |
| 18 | Vitest project scripts reference nonexistent workspace config | HIGH | A4, A5, A13 (3) | HIGH |
| 19 | No coverage configuration or provider in Vitest | HIGH | A3, A4, A5 (3) | HIGH |
| 20 | Empty catch block in server.ts swallows all errors | MEDIUM | A3, A10, A13 (3) | HIGH |
| 21 | Missing `noUncheckedIndexedAccess` + `noImplicitReturns` tsconfig flags | HIGH | A3, A4 (2) | HIGH |
| 22 | Inline `style={}` violates design system forbidden patterns | MEDIUM | A4, A12 (2) | HIGH |
| 23 | Default employee role for unregistered users | HIGH | A2, A8 (2) | HIGH |
| 24 | Missing not-found.tsx (404 pages) | HIGH | A6, A9, A10, A12 (4) | VERY HIGH |
| 25 | `.gitignore` does not exclude base `.env` file | HIGH | A1 (1) | MODERATE |
| 26 | `font-[var(--font-bold)]` produces `font-family` not `font-weight` | CRITICAL | A13 (1) | MODERATE |
| 27 | `duration-[var(--transition-fast)]` produces invalid CSS | CRITICAL | A13 (1) | MODERATE |
| 28 | custom_access_token_hook lacks search_path + SECURITY DEFINER | CRITICAL | A8 (1) | MODERATE |
| 29 | Middleware has no try/catch -- Supabase outage crashes all routes | CRITICAL | A10 (1) | MODERATE |
| 30 | Missing `prefers-reduced-motion` handling | HIGH | A12 (1) | MODERATE |
| 31 | Focus indicators destroyed with no replacement (WCAG 2.4.7 AA) | CRITICAL | A12 (1) | MODERATE |
| 32 | Error messages not announced to screen readers | CRITICAL | A12 (1) | MODERATE |

---

## Topic Clusters for Research

### Cluster 1: Auth & Security

**Findings:** #1, #8, #9, #11, #16, #23, #25

**Specific issues:**
- Open redirect via `next` query parameter in auth callback (src/app/auth/callback/route.ts:7,14)
- No security headers configured in next.config.ts (CSP, HSTS, X-Frame-Options, etc.)
- `SKIP_ENV_VALIDATION` bypass allows running without any env validation in production
- No rate limiting on auth endpoints (client-side or server-side)
- Sign-up flow skips email verification, immediately redirects to dashboard
- Default `employee` role assigned to any user who signs up (no approval workflow)
- `.gitignore` does not exclude base `.env` file

**Research questions:**
1. What is the correct Next.js 16 security headers configuration for a Supabase+Vercel app?
2. What is the recommended rate limiting approach for Next.js on Vercel (edge rate limiting vs middleware)?
3. How should SKIP_ENV_VALIDATION be constrained to build-time only?
4. What is the correct Supabase email confirmation flow for Next.js App Router?
5. What role-assignment pattern (pending role, invitation-only, domain restriction) best fits a construction estimating platform?

---

### Cluster 2: Database & Schema

**Findings:** #3, #23, #28, plus standalone DB findings

**Specific issues:**
- RLS policy `USING(true) WITH CHECK(true)` on user_roles (all authenticated users can read all roles)
- custom_access_token_hook missing `SECURITY DEFINER SET search_path = ''`
- No `updated_at` trigger on user_roles table
- Missing `GRANT USAGE ON SCHEMA public TO supabase_auth_admin`
- Redundant index on user_id (already covered by UNIQUE constraint)
- Hook not enabled in supabase/config.toml (local dev differs from production)
- No `handle_new_user()` trigger to auto-create role rows on signup
- Missing migration idempotency guards
- Weak password requirements (6 chars, no complexity)
- Email confirmation disabled in config.toml

**Research questions:**
1. Should the "Service role can manage all roles" RLS policy be removed entirely or scoped to service_role?
2. What is the correct `SECURITY DEFINER SET search_path` pattern for Supabase custom hooks?
3. Should moddatetime extension be used for `updated_at` triggers, or a custom function?
4. What password policy is appropriate for a construction business platform (NIST SP 800-63B)?

---

### Cluster 3: Error Handling & Resilience

**Findings:** #2, #5, #6, #7, #24, #29

**Specific issues:**
- Zero error.tsx / global-error.tsx / not-found.tsx files anywhere in app
- Zero loading.tsx files -- no loading states for async server components
- Middleware has no try/catch -- Supabase outage crashes ALL routes
- Auth callback silently discards error details (no server-side logging)
- Raw Supabase error messages shown to users (user enumeration risk)
- Sign-out is fire-and-forget with no error handling
- Protected layout ignores getUser() error object (treats outage as "not authenticated")
- Auth forms have no try/catch around network calls (stuck loading state on failure)
- No error tracking/monitoring infrastructure (Sentry, Datadog, etc.)
- No type-safe error result pattern (`Result<T>`) established
- No graceful degradation strategy

**Research questions:**
1. What error boundary structure is recommended for Next.js App Router with auth?
2. How should middleware handle Supabase outages (graceful degradation vs redirect)?
3. What Supabase error messages should be mapped for user-facing display?
4. Which error tracking tool integrates best with Next.js 16 + Vercel?

---

### Cluster 4: Testing Infrastructure

**Findings:** #10, #18, #19, plus standalone test findings

**Specific issues:**
- Zero unit tests for core infrastructure (middleware, admin client, auth callback)
- Zero component tests (no @testing-library/react installed)
- Zero database/RLS tests (no pgTAP)
- No coverage configuration or provider (@vitest/coverage-v8)
- Vitest project scripts (`--project smoke`) reference nonexistent workspace config
- Non-null assertions in test files bypass type safety
- Smoke tests make real network calls (flaky in CI)
- All tests verify happy paths only -- zero error path tests
- Tests use `__dirname` traversal (fragile path resolution)
- Security tests check file contents, not runtime behavior
- Empty test directories (tests/actions/, tests/database/) with no content
- No documented test naming convention

**Research questions:**
1. What is the correct vitest.workspace.ts configuration for separating smoke/security/unit/component/db tests?
2. Should smoke tests (real network calls) be separated from CI-mandatory tests?
3. What is the minimal component test setup for Next.js App Router pages?
4. How should RLS policies be tested with pgTAP or supabase-test-helpers?

---

### Cluster 5: Frontend & Accessibility

**Findings:** #30, #31, #32, plus standalone a11y findings

**Specific issues:**
- Focus indicators destroyed (`focus:outline-none`) with no replacement -- WCAG 2.4.7 AA failure
- Error messages not announced to screen readers (missing `role="alert"`, `aria-live`)
- No skip-to-content link (WCAG 2.4.1 A)
- Navigation landmark missing `aria-label`
- Active nav link missing `aria-current="page"`
- Heading hierarchy violations (h2 in layout, h3 skips h2 in dashboard)
- Collapsed sidebar renders empty links (no icons, no aria-label fallback)
- No Open Graph / social metadata
- No sitemap.ts or robots.ts
- Auth form inputs missing `autoComplete` attributes
- No required field indicators (visual)
- No `prefers-reduced-motion` handling (WCAG 2.3.3)
- Color-only error indication (no icon or prefix text)
- No dark mode support
- No responsive adjustments on auth forms (touch targets below 44px)

**Research questions:**
1. What is the correct focus-visible ring pattern for Tailwind v4 with CSS variable tokens?
2. How should aria-live regions be structured for conditional error rendering in React?
3. What heading hierarchy pattern works with Next.js App Router layouts (site title vs page title)?
4. What is the minimum OG metadata for a B2B SaaS application?

---

### Cluster 6: Performance & Build

**Findings:** #13, #14, #15, #17, plus standalone perf findings

**Specific issues:**
- Double `getUser()` on every protected page (middleware + layout) -- 200-400ms wasted
- Middleware runs and calls `getUser()` on public routes before checking if they are public
- Auth pages are entirely `"use client"` -- all static markup shipped as JS
- Browser Supabase client not memoized (new instance per call, relies on internal singleton)
- Font loading mismatch: CSS tokens reference "Inter" string but next/font uses hashed name
- Monospace font "JetBrains Mono" referenced in tokens but never loaded
- Inter loads all 9 weights, design system uses only 4
- No bundle analyzer configured
- No error tracking / performance monitoring (Vercel Analytics, Speed Insights)
- No `next.config.ts` performance config (images, headers, caching)
- No caching strategy defined for any route segment

**Research questions:**
1. Should middleware use `getSession()` (fast, local JWT decode) while layout uses `getUser()` (verified)?
2. How to use React `cache()` to deduplicate getUser() across server components in a single request?
3. What is the correct next/font variable mode configuration for Tailwind v4 CSS variable tokens?
4. What image configuration is needed for Supabase storage with Next.js Image?

---

### Cluster 7: CSS Token Bugs

**Findings:** #26, #27, plus standalone CSS findings

**Specific issues:**
- `font-[var(--font-bold)]` generates `font-family: 700` instead of `font-weight: 700` -- 16+ occurrences
- `duration-[var(--transition-fast)]` with compound token `100ms ease` produces invalid `transition-duration` -- 10+ occurrences
- `text-[var(...)]` ambiguity between font-size and color in Tailwind v4 with CSS variables
- No `@theme` block in globals.css for proper Tailwind v4 theme integration
- All components use verbose `var()` arbitrary value syntax instead of theme utilities
- `disabled:opacity-50` uses magic number not backed by design token

**Research questions:**
1. What is the correct Tailwind v4 approach for CSS variable font weights?
2. How should transition tokens be structured for Tailwind v4 (separate duration and easing)?
3. Is `@theme` integration with CSS custom properties the recommended Tailwind v4 pattern?
4. Should `text-[length:var(--text-sm)]` type hints be used, or should tokens be registered via @theme?

---

### Cluster 8: Dependencies & Config

**Findings:** Plus standalone dep findings

**Specific issues:**
- `@t3-oss/env-core` version mismatch: env-nextjs@0.12 uses env-core@0.12, direct dep is env-core@0.13.11 (two copies)
- `@supabase/ssr` critically outdated (0.6.1 vs 0.10.0, 4 minor versions behind on pre-1.0 pkg)
- No automated dependency update tooling (Dependabot/Renovate)
- Missing `engines` and `type` fields in package.json
- Inconsistent version pinning strategy (mix of exact, narrow caret, wide caret)
- Wide range on `@types/node` (^20) may not match actual Node.js version
- pull-env.sh maps `SUPABASE_PUBLISHABLE_KEY` which code never uses
- All server env vars marked `.optional()` in Zod schema (defeats validation purpose)
- No ESLint TypeScript-specific rules configured

**Research questions:**
1. What breaking changes exist between @supabase/ssr 0.6 and 0.10?
2. What is the correct version alignment for the @t3-oss/env-core + env-nextjs stack?
3. What Dependabot/Renovate configuration is recommended for a Next.js + Supabase project?
4. Which server env vars should be required vs optional for a Supabase+Vercel deployment?

---

## All Findings (deduplicated, sorted by severity)

### CRITICAL (10 findings)

#### CRIT-01: Open Redirect in Auth Callback via `next` Query Parameter
- **File:** `src/app/auth/callback/route.ts`, lines 7, 14
- **Flagged by:** A1, A2, A4, A6, A7, A10, A13 (7 agents)
- **Confidence:** VERY HIGH
- **Problem:** The `next` parameter is read from user-controlled query string and concatenated into a redirect URL with zero validation. Attackers can redirect authenticated users to phishing pages.
- **Evidence:** `const next = searchParams.get("next") ?? "/dashboard";` ... `return NextResponse.redirect(\`${origin}${next}\`);`
- **Fix:** Validate `next` starts with `/`, does not start with `//`, and does not contain protocol schemes. Consider allowlist validation.

#### CRIT-02: No Error Boundaries Anywhere in the Application
- **File:** All route segments -- zero error.tsx, global-error.tsx, not-found.tsx, loading.tsx files exist
- **Flagged by:** A6, A7, A9, A10, A12, A13 (6 agents)
- **Confidence:** VERY HIGH
- **Problem:** Any unhandled error in any server component crashes to a white screen or Next.js default error page. No recovery path for users. Protected layout's `getUser()` failure produces an unrecoverable crash.
- **Fix:** Create error.tsx at root, (protected), and (auth) route groups. Create global-error.tsx, not-found.tsx, and loading.tsx.

#### CRIT-03: RLS Policy Grants Unrestricted Access via `USING(true) WITH CHECK(true)`
- **File:** `supabase/migrations/00000000000001_auth_roles.sql`, lines 33-35
- **Flagged by:** A1, A2, A6, A8, A13 (5 agents)
- **Confidence:** VERY HIGH
- **Problem:** The "Service role can manage all roles" policy applies to ALL Postgres roles, not just service_role. Combined with existing GRANT SELECT to authenticated, any authenticated user can read ALL users' roles. If any future migration broadens GRANTs, privilege escalation to `owner` becomes possible.
- **Fix:** Either remove the policy entirely (service role bypasses RLS anyway) or scope it: `USING (auth.role() = 'service_role')` or use `TO service_role` clause.

#### CRIT-04: No Supabase Generated Types + All Clients Untyped
- **File:** `src/lib/types/` (empty), all four Supabase client factories
- **Flagged by:** A3, A4, A6, A7, A8 (5 agents)
- **Confidence:** VERY HIGH
- **Problem:** `npm run db:types` has never been run. No `Database` generic parameter on any `createClient` call. All Supabase queries return untyped results. Table names, column names, and data types are not validated at compile time.
- **Fix:** Run `npm run db:types`, then add `<Database>` generic to all four client factories.

#### CRIT-05: Sign-Up Redirects to Dashboard Before Email Verification
- **File:** `src/app/(auth)/sign-up/page.tsx`, lines 30-31
- **Flagged by:** A2, A6, A7, A13 (4 agents)
- **Confidence:** VERY HIGH
- **Problem:** After `signUp()`, code immediately does `router.push("/dashboard")` regardless of email confirmation state. If confirmation is required, user gets bounced: sign-up -> dashboard -> middleware redirect -> sign-in. If not required, unverified accounts get immediate access.
- **Fix:** Check `data.session` -- if null, show "check your email" message instead of redirecting.

#### CRIT-06: CSS Token Bug -- `font-[var(--font-bold)]` Produces `font-family` Not `font-weight`
- **File:** 7+ component files, 16+ occurrences
- **Flagged by:** A13 (1 agent)
- **Confidence:** MODERATE (single agent, but technically verifiable)
- **Problem:** In Tailwind CSS v4, `font-[...]` arbitrary value maps to `font-family`, not `font-weight`. `font-[var(--font-bold)]` generates `font-family: 700` which is nonsensical. Text appears correct only because Inter font is applied via class inheritance, masking the bug.
- **Fix:** Use Tailwind named utilities (`font-bold`, `font-medium`, `font-semibold`) or the Tailwind v4 `font-weight-[...]` utility.

#### CRIT-07: CSS Token Bug -- `duration-[var(--transition-fast)]` Produces Invalid CSS
- **File:** 5+ component files, 10+ occurrences
- **Flagged by:** A13 (1 agent)
- **Confidence:** MODERATE (single agent, but technically verifiable)
- **Problem:** Design tokens `--transition-fast: 100ms ease` are compound values. `duration-[var(--transition-fast)]` generates `transition-duration: 100ms ease` which is invalid (duration only accepts time values). Browser discards the declaration. No transitions work.
- **Fix:** Split tokens into `--duration-fast: 100ms` and `--easing-default: ease`, or use Tailwind built-in duration classes.

#### CRIT-08: custom_access_token_hook Lacks search_path Pinning
- **File:** `supabase/migrations/00000000000001_auth_roles.sql`, lines 39-64
- **Flagged by:** A8 (1 agent)
- **Confidence:** MODERATE (single agent, but aligns with Supabase security docs)
- **Problem:** The hook function has no `SET search_path` clause and no explicit `SECURITY DEFINER`. Without search_path pinning, the function is vulnerable to search_path injection attacks (CVE-2018-1058 class). Supabase documentation explicitly requires `SECURITY DEFINER SET search_path = ''` for hook functions.
- **Fix:** Add `SECURITY DEFINER SET search_path = ''` to the function definition.

#### CRIT-09: Middleware Has No Error Handling -- Supabase Outage Crashes All Routes
- **File:** `src/lib/supabase/middleware.ts`, lines 5-48; `src/middleware.ts`, lines 4-6
- **Flagged by:** A10 (1 agent)
- **Confidence:** MODERATE (single agent, but easily verifiable)
- **Problem:** `updateSession()` calls `getUser()` with no try/catch. `middleware()` calls `updateSession()` with no try/catch. Since middleware runs on every non-static route, a Supabase outage takes down the entire application including public routes.
- **Fix:** Wrap middleware logic in try/catch. On error: allow public routes through, redirect protected routes to sign-in with error param.

#### CRIT-10: Focus Indicators Destroyed With No Replacement (WCAG 2.4.7 AA)
- **File:** `src/app/(auth)/sign-in/page.tsx` and `sign-up/page.tsx` -- 6 instances of `focus:outline-none`
- **Flagged by:** A12 (1 agent)
- **Confidence:** MODERATE (single agent, but WCAG compliance is objectively measurable)
- **Problem:** All interactive elements on auth pages have `focus:outline-none` with no replacement focus indicator. The only visual change is a subtle 1px border color shift, which is insufficient per WCAG 2.4.11. Keyboard-only users have no visible focus indication.
- **Fix:** Replace with `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] focus-visible:ring-offset-2`.

---

### HIGH (27 findings)

#### HIGH-01: No loading.tsx / Suspense Boundaries Anywhere
- **Files:** All route segments
- **Flagged by:** A6, A9, A10, A12 (4 agents)
- **Problem:** Zero loading.tsx files exist. Protected layout blocks on async getUser() with no visual feedback. Users see blank page during auth verification.
- **Fix:** Add loading.tsx at minimum to `(protected)/` route group.

#### HIGH-02: Missing not-found.tsx (404 Pages)
- **Files:** All route segments
- **Flagged by:** A6, A9, A10, A12 (4 agents)
- **Problem:** No custom 404 page. Users see generic Next.js default with no branding or recovery.
- **Fix:** Create src/app/not-found.tsx with branded content.

#### HIGH-03: Raw Supabase Auth Error Messages Exposed to Users
- **Files:** `src/app/(auth)/sign-in/page.tsx:24`, `sign-up/page.tsx:27`
- **Flagged by:** A1, A2, A10, A12 (4 agents)
- **Problem:** `setError(error.message)` passes Supabase internal error strings to UI. Enables user enumeration, leaks rate limit thresholds and configuration details.
- **Fix:** Create error message mapping function that returns generic user-friendly messages.

#### HIGH-04: Auth Callback Silently Discards Error Details
- **Files:** `src/app/auth/callback/route.ts:9-18`
- **Flagged by:** A1, A4, A7, A10 (4 agents)
- **Problem:** When exchangeCodeForSession fails, error is discarded. No server-side logging. Sign-in page does not read or display the error query parameter.
- **Fix:** Add console.error logging before redirect. Update sign-in page to read and display error param.

#### HIGH-05: Missing Security Headers in next.config.ts
- **Files:** `next.config.ts` (empty config)
- **Flagged by:** A1, A2, A9 (3 agents)
- **Problem:** No CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy. poweredByHeader not disabled.
- **Fix:** Add headers() function and set poweredByHeader: false.

#### HIGH-06: `SKIP_ENV_VALIDATION` Has No Production Guard
- **Files:** `src/env.ts:43`
- **Flagged by:** A1, A6, A7 (3 agents)
- **Problem:** Setting `SKIP_ENV_VALIDATION=1` bypasses all Zod validation in any environment, including production. App can start with missing secrets.
- **Fix:** Add `&& process.env.NODE_ENV !== "production"` guard.

#### HIGH-07: Non-Null Assertions in Test Files
- **Files:** `tests/smoke/supabase.test.ts:4-6`
- **Flagged by:** A3, A4, A5 (3 agents)
- **Problem:** Three `!` assertions on process.env values. Missing env vars produce cryptic errors instead of clear messages.
- **Fix:** Replace with `requireEnv()` helper or use validated env module.

#### HIGH-08: Vitest Project Scripts Reference Nonexistent Workspace Config
- **Files:** `package.json:14-17`, `vitest.config.ts`
- **Flagged by:** A4, A5, A13 (3 agents)
- **Problem:** `test:smoke`, `test:security`, `test:db`, `test:actions` use `--project` flag but no vitest.workspace.ts exists. Scripts silently fail or run wrong tests.
- **Fix:** Create vitest.workspace.ts defining named projects, or remove --project flags.

#### HIGH-09: No Test Coverage Configuration or Provider
- **Files:** `vitest.config.ts`
- **Flagged by:** A3, A4, A5 (3 agents)
- **Problem:** No coverage block in vitest config. No @vitest/coverage-v8 installed. No coverage thresholds. No way to measure or enforce test coverage.
- **Fix:** Install coverage provider and add coverage configuration with thresholds.

#### HIGH-10: Middleware Over-Matching (Runs on Routes That Don't Need Auth)
- **Files:** `src/middleware.ts:9-11`
- **Flagged by:** A1, A6, A7 (3 agents)
- **Problem:** Matcher excludes only static assets and images. Still runs (with getUser() call) on API routes, health checks, robots.txt, etc. Future webhooks/cron jobs will fail.
- **Fix:** Exclude `/api/` paths, and additional static resources from matcher.

#### HIGH-11: No Rate Limiting on Auth Endpoints
- **Files:** Auth pages, middleware
- **Flagged by:** A1, A2 (2 agents)
- **Problem:** No client-side throttling, no server-side rate limiting, no account lockout, no CAPTCHA. Brute force attacks only mitigated by Supabase server-side limits.
- **Fix:** Add client-side progressive delay; add server-side rate limiting before production.

#### HIGH-12: Auth Form Duplication (~85% Identical Code)
- **Files:** `src/app/(auth)/sign-in/page.tsx`, `sign-up/page.tsx`
- **Flagged by:** A4, A6 (2 agents)
- **Problem:** State declarations, form structure, JSX layout, class strings, input markup all duplicated. ~200 lines of near-identical code. Any change requires synchronized edits.
- **Fix:** Extract shared AuthFormLayout, AuthInput, AuthSubmitButton, useAuthForm hook.

#### HIGH-13: Auth Pages Entirely `"use client"` (Bundle Bloat)
- **Files:** `src/app/(auth)/sign-in/page.tsx:1`, `sign-up/page.tsx:1`
- **Flagged by:** A6, A9 (2 agents)
- **Problem:** Entire pages including static markup (headings, labels, links) shipped as client JS. Only form state management needs client-side rendering.
- **Fix:** Extract interactive form to small client component, keep page as server component.

#### HIGH-14: Double `getUser()` on Every Protected Page
- **Files:** `src/lib/supabase/middleware.ts:30`, `src/app/(protected)/layout.tsx:10`
- **Flagged by:** A6, A9 (2 agents)
- **Problem:** getUser() called in middleware AND in protected layout. Each is an independent network round-trip to Supabase Auth. Doubles auth latency (100-400ms) per page.
- **Fix:** Wrap server-side getUser() with React `cache()` to deduplicate. Consider passing user from middleware via headers.

#### HIGH-15: Default Employee Role for Unregistered Users
- **Files:** `supabase/migrations/00000000000001_auth_roles.sql:57-59`
- **Flagged by:** A2, A8 (2 agents)
- **Problem:** Hook defaults unregistered users to `employee` role. No approval workflow. Anyone who signs up immediately gets employee access to business data. No handle_new_user() trigger to create actual role rows.
- **Fix:** Default to `pending` role with no data access, or require invitation/approval. Add trigger on auth.users to create role rows.

#### HIGH-16: Missing `noUncheckedIndexedAccess` + `noImplicitReturns` tsconfig Flags
- **Files:** `tsconfig.json`
- **Flagged by:** A3, A4 (2 agents)
- **Problem:** These flags are NOT included in `strict: true`. Without them, array index access assumes defined, and functions can silently return undefined from some paths.
- **Fix:** Add both flags to tsconfig.json. Trivial now, expensive to add later.

#### HIGH-17: .gitignore Does Not Exclude Base .env File
- **Files:** `.gitignore:27-29`
- **Flagged by:** A1 (1 agent)
- **Problem:** Only `.env.local` and `.env*.local` excluded. A bare `.env` file would be tracked by git and potentially committed with real secrets.
- **Fix:** Add `.env` and `.env.*` to .gitignore (with exceptions for examples).

#### HIGH-18: No Password Reset Flow
- **Files:** Entire src/app/(auth)/ directory
- **Flagged by:** A2 (1 agent)
- **Problem:** No "Forgot password?" link. No reset route. Users who forget passwords have no recovery path.
- **Fix:** Implement standard Supabase password reset flow.

#### HIGH-19: Missing onAuthStateChange Listener
- **Files:** `src/lib/supabase/client.ts`, all client components
- **Flagged by:** A2 (1 agent)
- **Problem:** No client-side auth state listener. Token refresh, cross-tab sync, and session recovery are not handled. Client-side token can expire silently.
- **Fix:** Create AuthProvider component with onAuthStateChange listener.

#### HIGH-20: Sign-Out Does Not Use `scope: 'global'`
- **Files:** `src/components/nav/user-menu.tsx:11`
- **Flagged by:** A2 (1 agent)
- **Problem:** `signOut()` defaults to local scope. Other sessions remain active on other devices. Risk for shared worksite computers.
- **Fix:** Use `signOut({ scope: 'global' })` or provide UI option.

#### HIGH-21: No Established Auth Utility for Server Actions
- **Files:** Protected pages, missing `src/lib/auth.ts`
- **Flagged by:** A2, A7 (2 agents)
- **Problem:** No `requireAuth()` or `requireRole()` helper. When Phase 1A adds server actions, each will need independent auth checks with no pattern to follow.
- **Fix:** Create shared auth utilities before Phase 1A.

#### HIGH-22: Font Loading Mismatch -- CSS Tokens vs next/font
- **Files:** `src/app/layout.tsx:5`, `src/app/globals.css:61-62`
- **Flagged by:** A9 (1 agent)
- **Problem:** CSS token `--font-family: "Inter"` hardcodes string name, but next/font uses hashed class. Monospace font "JetBrains Mono" referenced but never loaded.
- **Fix:** Use next/font CSS variable mode. Load JetBrains Mono if needed.

#### HIGH-23: Missing (auth) Route Group Layout
- **Files:** `src/app/(auth)/` -- no layout.tsx
- **Flagged by:** A6 (1 agent)
- **Problem:** Both auth pages independently render identical centering/card layout. No shared auth layout.
- **Fix:** Extract shared auth layout to `src/app/(auth)/layout.tsx`.

#### HIGH-24: @t3-oss/env-core Version Mismatch (Two Copies in Bundle)
- **Files:** `package.json:6-7`
- **Flagged by:** A11, A13 (2 agents)
- **Problem:** env-nextjs@0.12 uses env-core@0.12, but env-core@0.13.11 is also a direct dependency. Two copies installed. createEnv() uses 0.12 internals while vercel() preset uses 0.13.
- **Fix:** Upgrade @t3-oss/env-nextjs to ^0.13.11 to align versions.

#### HIGH-25: @supabase/ssr Critically Outdated (0.6.1 vs 0.10.0)
- **Files:** `package.json:23`
- **Flagged by:** A11 (1 agent)
- **Problem:** 4 minor versions behind on a pre-1.0 package. Auth infrastructure package with potential security-relevant fixes. Near-zero migration cost at current stage.
- **Fix:** Update to `"@supabase/ssr": "^0.10.0"`.

#### HIGH-26: No Automated Dependency Update Tooling
- **Files:** Missing .github/dependabot.yml or renovate.json
- **Flagged by:** A11 (1 agent)
- **Problem:** No Dependabot or Renovate. 9 outdated packages already. Security patches in transitive deps will go unnoticed.
- **Fix:** Add .github/dependabot.yml with weekly npm checks.

#### HIGH-27: No Skip-to-Content Link (WCAG 2.4.1 A)
- **Files:** `src/app/layout.tsx`
- **Flagged by:** A12 (1 agent)
- **Problem:** Keyboard users must tab through entire sidebar navigation on every page to reach main content.
- **Fix:** Add skip link as first child of body, targeting `id="main-content"` on main element.

---

### MEDIUM (15 findings)

#### MED-01: Browser Supabase Client Not Memoized
- **Files:** `src/lib/supabase/client.ts:6-8`
- **Flagged by:** A6, A7, A9 (3 agents)
- **Problem:** `createClient()` creates a new instance per call. `@supabase/ssr` has internal singleton behavior but this is undocumented implementation detail.
- **Fix:** Add explicit module-level singleton with lazy initialization.

#### MED-02: Empty Catch Block in server.ts Swallows All Errors
- **Files:** `src/lib/supabase/server.ts:14-19`
- **Flagged by:** A3, A10, A13 (3 agents)
- **Problem:** Catch block intended for read-only Server Component context also silently swallows unrelated errors. Documented Supabase pattern but overly broad.
- **Fix:** Add conditional logging for unexpected errors in development.

#### MED-03: Inline `style={}` Violates Design System Forbidden Patterns
- **Files:** `sidebar.tsx:20-23,27`, `(protected)/layout.tsx:22`
- **Flagged by:** A4, A12 (2 agents)
- **Problem:** Three inline style attributes use design tokens but via forbidden mechanism. Static height properties should use Tailwind arbitrary values.
- **Fix:** Replace `style={{ height: "var(--header-height)" }}` with `h-[var(--header-height)]`.

#### MED-04: All Server Env Vars Marked Optional in Zod Schema
- **Files:** `src/env.ts:9-27`
- **Flagged by:** A3, A7 (2 agents)
- **Problem:** Every server-side env var is `.optional()`, defeating validation purpose. Production can start with missing critical secrets.
- **Fix:** Make critical vars required; use .refine() for "at least one of" patterns.

#### MED-05: Variable Shadowing in Auth Forms (error state vs destructured error)
- **Files:** `sign-in/page.tsx:11,21`, `sign-up/page.tsx:11,21`
- **Flagged by:** A4 (1 agent)
- **Problem:** React state `error` is shadowed by destructured Supabase response `error` inside handleSubmit.
- **Fix:** Rename destructured variable to `authError`.

#### MED-06: pull-env.sh / env.ts Variable Mismatch
- **Files:** `scripts/pull-env.sh`, `src/env.ts`
- **Flagged by:** A7, A13 (2 agents)
- **Problem:** pull-env.sh maps `SUPABASE_PUBLISHABLE_KEY` which code never uses. `CRON_SECRET` is in env.ts but not in pull-env.sh.
- **Fix:** Align pull-env.sh mappings with env.ts schema.

#### MED-07: No Error Tracking / Monitoring Infrastructure
- **Files:** `package.json`
- **Flagged by:** A9, A10 (2 agents)
- **Problem:** Zero console.error calls in source. No Sentry, Datadog, or any monitoring. Production errors are invisible.
- **Fix:** Add console.error to all error paths immediately. Install Sentry or Vercel Analytics.

#### MED-08: Tailwind `text-[var(...)]` Ambiguity for Color vs Font-Size
- **Files:** All component files
- **Flagged by:** A13 (1 agent)
- **Problem:** `text-[var(--text-sm)]` and `text-[var(--color-text)]` both use `text-[var(...)]`. Tailwind v4 infers type from variable name heuristic, which is fragile.
- **Fix:** Use type hints: `text-[length:var(--text-sm)]`, `text-[color:var(--color-text)]`.

#### MED-09: Missing @theme Block for Tailwind v4 Integration
- **Files:** `src/app/globals.css`
- **Flagged by:** A4, A13 (2 agents)
- **Problem:** No @theme block maps CSS custom properties to Tailwind utilities. Components use verbose `var()` arbitrary syntax without autocomplete.
- **Fix:** Add @theme block registering design tokens as Tailwind theme values.

#### MED-10: No Auth Event Logging / Audit Trail
- **Files:** All auth flow files
- **Flagged by:** A2 (1 agent)
- **Problem:** No login/signup/signout event logging. No failed login tracking. Incident response has no application-level evidence.
- **Fix:** Add structured logging; integrate with audit system.

#### MED-11: Redundant Index on user_id (Already Covered by UNIQUE)
- **Files:** `supabase/migrations/00000000000001_auth_roles.sql:22-23`
- **Flagged by:** A8 (1 agent)
- **Problem:** Explicit CREATE INDEX on user_id duplicates the automatic unique constraint index. Double write amplification, planner confusion.
- **Fix:** Remove the redundant CREATE INDEX statement.

#### MED-12: Hook Not Enabled in config.toml (Local Dev Differs from Production)
- **Files:** `supabase/config.toml:274-276`
- **Flagged by:** A8 (1 agent)
- **Problem:** custom_access_token_hook configuration is commented out. Local dev tokens lack user_role claim, creating discrepancy with production.
- **Fix:** Uncomment and configure the hook in config.toml.

#### MED-13: Missing engines/type Fields in package.json
- **Files:** `package.json`
- **Flagged by:** A11 (1 agent)
- **Problem:** No engines field to enforce Node.js version. No type field for module system declaration.
- **Fix:** Add `"engines": { "node": ">=18.18.0" }` and `"type": "module"`.

#### MED-14: Error Messages Not Announced to Screen Readers
- **Files:** `sign-in/page.tsx:41-44`, `sign-up/page.tsx:45-48`
- **Flagged by:** A12 (1 agent)
- **Problem:** Error containers missing `role="alert"` and `aria-live`. No `aria-invalid` on inputs. Screen reader users receive no notification of auth failures.
- **Fix:** Add persistent `role="alert"` container. Add `aria-describedby` and `aria-invalid` to inputs.

#### MED-15: Missing prefers-reduced-motion Handling
- **Files:** All interactive components, `globals.css`
- **Flagged by:** A12 (1 agent)
- **Problem:** Zero `prefers-reduced-motion` references in codebase. All transitions (7+ instances) play regardless of user preference.
- **Fix:** Add `@media (prefers-reduced-motion: reduce)` global rule or use Tailwind `motion-reduce:` prefix.

---

## Agent Coverage Summary

| Agent | Role | CRIT | HIGH | MED | Total | Unique Contribution |
|-------|------|------|------|-----|-------|---------------------|
| A1 | Security Scanner | 1 | 5 | 4 | 10 | .gitignore gap, CSRF pattern |
| A2 | Auth Auditor | 2 | 9 | 3 | 14 | Password reset, onAuthStateChange, sign-out scope |
| A3 | Type Checker | 2 | 5 | 6 | 13 | tsconfig flags, return type annotations |
| A4 | Code Quality | 0 | 5 | 8 | 13 | Variable shadowing, naming inconsistency |
| A5 | Test Reviewer | 3 | 7 | 5 | 15 | Test pyramid analysis, missing test categories |
| A6 | Architecture | 3 | 8 | 4 | 15 | Auth layout, caching strategy, root redirect |
| A7 | API Verifier | 3 | 5 | 5 | 13 | Env var tiers, origin validation, pull-env mismatch |
| A8 | DB Inspector | 2 | 6 | 3 | 11 | search_path injection, schema grants, updated_at trigger |
| A9 | Performance | 0 | 6 | 4 | 10 | Font loading, bundle analyzer, preconnect hints |
| A10 | Error Handling | 5 | 6 | 4 | 15 | Middleware crash, sign-out fire-and-forget, Result type |
| A11 | Dep Auditor | 0 | 3 | 5 | 8 | Version mismatches, Dependabot, lockfile analysis |
| A12 | Frontend/A11y | 5 | 11 | 6 | 22 | Focus indicators, ARIA, heading hierarchy, OG metadata |
| A13 | AI Code Auditor | 4 | 5 | 5 | 14 | CSS token bugs, half-implementations, framework misuse |

---

## Remediation Priority

### Immediate (Blocks Deployment Safety)
1. CRIT-01: Fix open redirect in auth callback
2. CRIT-03: Fix or remove overpermissive RLS policy
3. CRIT-09: Add try/catch to middleware
4. CRIT-10: Restore focus indicators on auth pages
5. HIGH-05: Add security headers to next.config.ts

### Before Phase 1A (Prevents Compounding Debt)
6. CRIT-02: Create error boundary files (error.tsx, global-error.tsx, not-found.tsx)
7. CRIT-04: Generate Supabase types and wire Database generic
8. CRIT-05: Fix sign-up email verification flow
9. CRIT-06 + CRIT-07: Fix CSS token bugs (font-weight, duration)
10. CRIT-08: Add SECURITY DEFINER + search_path to hook function
11. HIGH-01: Add loading.tsx files
12. HIGH-03: Map auth error messages to user-friendly text
13. HIGH-06: Guard SKIP_ENV_VALIDATION against production
14. HIGH-15: Change default role to `pending` or add approval
15. HIGH-16: Add missing tsconfig strict flags
16. HIGH-21: Create shared auth utilities (requireAuth, requireRole)
17. HIGH-24: Align @t3-oss/env versions
18. HIGH-25: Upgrade @supabase/ssr

### Early Phase 1A
19. HIGH-08 + HIGH-09: Fix Vitest workspace config and add coverage
20. HIGH-12 + HIGH-13 + HIGH-23: Refactor auth forms (extract shared components)
21. HIGH-14: Deduplicate getUser() calls with React cache()
22. HIGH-22: Fix font loading (next/font variable mode)
23. All MEDIUM findings

---

*Generated by Consolidation Agent from 13 independent reviewer analyses.*
