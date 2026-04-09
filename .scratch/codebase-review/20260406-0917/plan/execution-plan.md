# Codebase Review -- Execution Plan

**Date:** 2026-04-06
**Codebase:** ShossyWorks (Next.js 16.2.2 + Supabase + Tailwind CSS v4)
**Findings:** 52 unique (10 CRITICAL, 27 HIGH, 15 MEDIUM)
**Status:** PLAN ONLY -- awaiting user approval before execution

---

## Fix Priority Order

Ordered by: severity, dependency chain, blast radius, then effort.

| Priority | ID | Finding | Severity | Effort | Why This Order |
|---|---|---|---|---|---|
| 1 | CRIT-01 | Open redirect in auth callback | CRITICAL | Trivial | Exploitable now, zero dependencies |
| 2 | CRIT-03 | RLS policy `USING(true)` on user_roles | CRITICAL | Trivial | Data exposure, zero dependencies |
| 3 | CRIT-08 | Hook missing `SET search_path` | CRITICAL | Trivial | SQL injection vector, zero dependencies |
| 4 | CRIT-09 | Middleware has no try/catch | CRITICAL | Low | Single point of failure for entire app |
| 5 | HIGH-17 | .gitignore missing `.env` exclusion | HIGH | Trivial | Secret leak risk, zero dependencies |
| 6 | HIGH-15 | Default employee role (should be pending) | HIGH | Moderate | Requires new migration, blocks #3 hook update |
| 7 | -- | handle_new_user trigger missing | HIGH | Moderate | Depends on pending role enum existing |
| 8 | MED-09 | No `@theme` block in globals.css | MEDIUM | Medium | **Blocker** for all CSS token fixes |
| 9 | CRIT-06 | font-weight tokens broken (16 occurrences) | CRITICAL | Low | Depends on @theme block |
| 10 | CRIT-07 | duration tokens invalid (7 occurrences) | CRITICAL | Low | Depends on @theme block |
| 11 | MED-08 | text-size ambiguity (22 occurrences) | MEDIUM | Low | Depends on @theme block |
| 12 | HIGH-24 | @t3-oss/env version mismatch | HIGH | Trivial | Must fix before Supabase client changes |
| 13 | HIGH-25 | @supabase/ssr outdated (0.6.1 -> 0.10.0) | HIGH | Low | Must precede getClaims() usage |
| 14 | CRIT-02 | No error boundaries anywhere | CRITICAL | Low | Blocks safe deployment, no deps |
| 15 | HIGH-01 | No loading.tsx / Suspense boundaries | HIGH | Low | UX blocker, pairs with error boundaries |
| 16 | HIGH-02 | No not-found.tsx (404 pages) | HIGH | Low | Pairs with error boundaries |
| 17 | HIGH-03 | Raw auth errors exposed to users | HIGH | Low | User enumeration risk |
| 18 | CRIT-05 | Sign-up redirects before email verification | CRITICAL | Moderate | Depends on error mapping (#17) |
| 19 | CRIT-10 | Focus indicators destroyed (WCAG 2.4.7) | CRITICAL | Medium | Accessibility blocker |
| 20 | MED-14 | Error messages not announced (ARIA) | MEDIUM | Low-Med | Accessibility, pairs with #19 |
| 21 | HIGH-08 | Vitest workspace config broken | HIGH | Medium | Testing infrastructure |
| 22 | HIGH-09 | No coverage provider | HIGH | Low | Depends on vitest config |
| 23 | HIGH-14 | Double getUser() per page | HIGH | Low | Performance, needs cache() wrapper |
| 24 | HIGH-10 | Middleware over-matching | HIGH | Low | Performance, pairs with getClaims() |
| 25 | HIGH-22 | Font loading mismatch | HIGH | Medium | Depends on @theme block existing |

---

## Dependency DAG

```
                     +-----------------+
                     | Phase 5a        |
                     | Security + DB   |
                     +--------+--------+
                              |
              +---------------+---------------+
              |                               |
     +--------v--------+            +--------v--------+
     | Phase 5b        |            | Phase 5c        |
     | CSS Tokens +    |            | Error Handling + |
     | Dependencies    |            | App Shell       |
     +--------+--------+            +--------+--------+
              |                               |
              +---------------+---------------+
                              |
                     +--------v--------+
                     | Phase 5d        |
                     | Testing Infra   |
                     +--------+--------+
                              |
                     +--------v--------+
                     | Phase 5e        |
                     | Perf + A11y     |
                     +-----------------+
```

### Key dependency chains:

1. **@theme block MUST exist BEFORE** font-weight, duration, and text-size token fixes
2. **Dependencies MUST upgrade BEFORE** Supabase client changes (getClaims, cache wrapper)
3. **Error boundaries BEFORE** any new pages/routes (loading.tsx, not-found.tsx)
4. **Auth error mapping MUST exist BEFORE** sign-up flow fix (uses getAuthErrorMessage)
5. **`pending` role enum MUST exist BEFORE** handle_new_user trigger and hook update
6. **Vitest projects config MUST exist BEFORE** coverage configuration
7. **@supabase/ssr upgrade MUST precede** getClaims() in middleware (Phase 5e)
8. **.gitignore fix has zero deps** -- can go in any phase but belongs with security

---

## Execution Phases

### Phase 5a: Critical Security + Database Fixes

**Scope:** Fix exploitable vulnerabilities and database misconfigurations.
**Agent count:** 3 agents (non-overlapping file ownership)
**Estimated time:** 30-45 minutes

#### Agent 5a-1: Auth Callback + .gitignore

**Files owned:**
- `src/app/auth/callback/route.ts` -- fix open redirect (CRIT-01), add error logging (HIGH-04)
- `.gitignore` -- add `.env` and `.env.*` exclusions (HIGH-17)

**Changes:**
1. Add `isValidRedirect()` function with allowlist validation
2. Validate `next` param before use
3. Add `console.error` for exchange failures
4. Update .gitignore env section to exclude `.env` and `.env.*`, preserve `.env.example`

#### Agent 5a-2: Middleware Resilience

**Files owned:**
- `src/lib/supabase/middleware.ts` -- add try/catch, public route check (CRIT-09, HIGH-10)
- `src/middleware.ts` -- update matcher to exclude `/api/` paths (HIGH-10)

**Changes:**
1. Wrap `updateSession()` body in try/catch
2. Add `isPublicRoute()` check with `PUBLIC_ROUTES` array
3. On Supabase error: allow public routes through, redirect protected to `/sign-in?error=service_unavailable`
4. On catch: same graceful degradation
5. Update matcher regex to exclude `api/` and additional static extensions

#### Agent 5a-3: Database Migration

**Files owned:**
- `supabase/migrations/` -- new migration file (CRIT-03, CRIT-08, HIGH-15, handle_new_user)

**Changes (single new migration file `supabase/migrations/20260406000001_security_fixes.sql`):**
1. `DROP POLICY "Service role can manage all roles" ON public.user_roles` (CRIT-03)
2. `ALTER TYPE public.app_role ADD VALUE 'pending'` (HIGH-15)
3. Replace `custom_access_token_hook` with `SET search_path = ''` and default to `'pending'` (CRIT-08)
4. Add `GRANT USAGE ON SCHEMA public TO supabase_auth_admin`
5. Create `handle_new_user()` trigger function with `SECURITY DEFINER SET search_path = ''`
6. Attach trigger to `auth.users`
7. `REVOKE EXECUTE ON FUNCTION public.handle_new_user FROM authenticated, anon, public`

#### Verification Script

```bash
#!/bin/bash
echo "=== Phase 5a Verification ==="
PASS=0; FAIL=0

# Check open redirect fix
if grep -q "isValidRedirect" src/app/auth/callback/route.ts; then
  echo "PASS: Open redirect validation function exists"
  ((PASS++))
else
  echo "FAIL: Missing isValidRedirect in auth callback"
  ((FAIL++))
fi

# Check no unvalidated next param usage
if grep -q 'startsWith("//")' src/app/auth/callback/route.ts; then
  echo "PASS: Protocol-relative URL check present"
  ((PASS++))
else
  echo "FAIL: Missing // check in redirect validation"
  ((FAIL++))
fi

# Check middleware try/catch
if grep -q "catch" src/lib/supabase/middleware.ts; then
  echo "PASS: Middleware has error handling"
  ((PASS++))
else
  echo "FAIL: Middleware missing try/catch"
  ((FAIL++))
fi

# Check middleware public route check
if grep -q "isPublicRoute\|PUBLIC_ROUTES" src/lib/supabase/middleware.ts; then
  echo "PASS: Middleware has public route check"
  ((PASS++))
else
  echo "FAIL: Middleware missing public route check"
  ((FAIL++))
fi

# Check middleware matcher excludes api
if grep -q "api/" src/middleware.ts; then
  echo "PASS: Middleware matcher excludes API routes"
  ((PASS++))
else
  echo "FAIL: Middleware matcher does not exclude API routes"
  ((FAIL++))
fi

# Check .gitignore has .env
if grep -q "^\.env$" .gitignore; then
  echo "PASS: .gitignore excludes .env"
  ((PASS++))
else
  echo "FAIL: .gitignore missing .env exclusion"
  ((FAIL++))
fi

# Check migration exists
MIGRATION=$(find supabase/migrations -name "*security_fixes*" 2>/dev/null | head -1)
if [ -n "$MIGRATION" ]; then
  echo "PASS: Security migration file exists"
  ((PASS++))
else
  echo "FAIL: No security migration file found"
  ((FAIL++))
fi

# Check RLS policy drop
if [ -n "$MIGRATION" ] && grep -q "DROP POLICY" "$MIGRATION"; then
  echo "PASS: Migration drops overpermissive RLS policy"
  ((PASS++))
else
  echo "FAIL: Migration does not drop RLS policy"
  ((FAIL++))
fi

# Check search_path
if [ -n "$MIGRATION" ] && grep -q "search_path" "$MIGRATION"; then
  echo "PASS: Migration sets search_path on hook"
  ((PASS++))
else
  echo "FAIL: Migration missing search_path fix"
  ((FAIL++))
fi

# Check handle_new_user
if [ -n "$MIGRATION" ] && grep -q "handle_new_user" "$MIGRATION"; then
  echo "PASS: Migration creates handle_new_user trigger"
  ((PASS++))
else
  echo "FAIL: Migration missing handle_new_user trigger"
  ((FAIL++))
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && echo "PHASE 5a: ALL PASS" || echo "PHASE 5a: HAS FAILURES"
```

#### Commit Message

```
fix(security): close open redirect, fix RLS policy, add middleware error handling

- Validate auth callback redirect target against allowlist (CRIT-01)
- Drop overpermissive USING(true) RLS policy on user_roles (CRIT-03)
- Add SET search_path to custom_access_token_hook (CRIT-08)
- Wrap middleware in try/catch for graceful degradation (CRIT-09)
- Add .env to .gitignore (HIGH-17)
- Default new users to 'pending' role, add handle_new_user trigger (HIGH-15)
- Exclude API routes from middleware matcher (HIGH-10)
- Add error logging to auth callback (HIGH-04)
```

---

### Phase 5b: CSS Token System + Dependencies

**Scope:** Fix the design token infrastructure and upgrade outdated packages.
**Agent count:** 2 agents
**Estimated time:** 1.5-2 hours
**Depends on:** Phase 5a (no file conflicts, but run sequentially for clean git history)

#### Agent 5b-1: CSS Token System

**Files owned:**
- `src/app/globals.css` -- add `@theme` block, restructure tokens (MED-09, CRIT-06, CRIT-07, MED-08)
- `src/components/nav/sidebar.tsx` -- token syntax updates (6 replacements)
- `src/components/nav/user-menu.tsx` -- token syntax updates (3 replacements)
- `src/app/(auth)/sign-in/page.tsx` -- token syntax updates (10 replacements)
- `src/app/(auth)/sign-up/page.tsx` -- token syntax updates (10 replacements)
- `src/app/(protected)/layout.tsx` -- token syntax updates (2 replacements)
- `src/app/(protected)/dashboard/page.tsx` -- token syntax updates (10 replacements)
- `src/app/(protected)/settings/page.tsx` -- token syntax updates (2 replacements)
- `src/app/(protected)/projects/page.tsx` -- token syntax updates (2 replacements)

**Changes:**
1. Add `@theme` block to globals.css with:
   - `--font-weight-normal/medium/semibold/bold` (font weight namespace)
   - `--text-xs` through `--text-3xl` (font size namespace)
   - `--duration-fast/normal/slow` (split from compound `--transition-*`)
   - `--ease-default` (split from compound `--transition-*`)
   - Color tokens (already in `:root`, mirror in `@theme` for utility generation)
2. Replace across all 8 component files:
   - `font-[var(--font-bold)]` -> `font-bold` (16 occurrences)
   - `font-[var(--font-semibold)]` -> `font-semibold`
   - `font-[var(--font-medium)]` -> `font-medium`
   - `font-[var(--font-normal)]` -> `font-normal`
   - `text-[var(--text-sm)]` -> `text-sm` (22 occurrences)
   - `text-[var(--text-base)]` -> `text-base`
   - `text-[var(--text-lg)]` -> `text-lg` (etc.)
   - `duration-[var(--transition-fast)]` -> `duration-fast` (7 occurrences)
   - `duration-[var(--transition-normal)]` -> `duration-normal`
   - `duration-[var(--transition-slow)]` -> `duration-slow`
3. Remove or relegate superseded `:root` token definitions
4. Replace `style={{ height: "var(--header-height)" }}` with `h-[var(--header-height)]` (MED-03, in layout.tsx and sidebar.tsx)

#### Agent 5b-2: Dependency Upgrades + Env Validation

**Files owned:**
- `package.json` -- version upgrades, add engines/type (HIGH-24, HIGH-25, MED-13)
- `src/env.ts` -- make critical vars required, guard SKIP_ENV_VALIDATION (HIGH-06, MED-04)
- `scripts/pull-env.sh` -- remove unused SUPABASE_PUBLISHABLE_KEY (MED-06)
- `.github/dependabot.yml` -- new file (HIGH-26)

**Changes:**
1. Upgrade `@t3-oss/env-nextjs` from `^0.12` to `^0.13.11` (HIGH-24)
2. Upgrade `@supabase/ssr` from `^0.6.1` to `~0.10.0` (HIGH-25)
3. Add `"type": "module"` and `"engines": { "node": ">=20.0.0" }` (MED-13)
4. Standardize version pinning per research recommendations
5. In `src/env.ts`:
   - Add `&& process.env.NODE_ENV !== "production"` to SKIP_ENV_VALIDATION (HIGH-06)
   - Make `SUPABASE_SERVICE_ROLE_KEY` and `DATABASE_URL` required (MED-04)
   - Keep feature-specific vars optional
6. Remove `SUPABASE_PUBLISHABLE_KEY` line from `scripts/pull-env.sh` (MED-06)
7. Create `.github/dependabot.yml` with grouped update rules (HIGH-26)

**Post-agent step:** Run `npm install` to update lockfile after package.json changes.

#### Verification Script

```bash
#!/bin/bash
echo "=== Phase 5b Verification ==="
PASS=0; FAIL=0

# Check @theme block exists
if grep -q "@theme" src/app/globals.css; then
  echo "PASS: @theme block exists in globals.css"
  ((PASS++))
else
  echo "FAIL: No @theme block in globals.css"
  ((FAIL++))
fi

# Check font-weight tokens in @theme
if grep -q "\-\-font-weight-bold" src/app/globals.css; then
  echo "PASS: Font weight tokens registered in @theme"
  ((PASS++))
else
  echo "FAIL: Font weight tokens missing from @theme"
  ((FAIL++))
fi

# Check duration tokens split
if grep -q "\-\-duration-fast" src/app/globals.css; then
  echo "PASS: Duration tokens split from compound values"
  ((PASS++))
else
  echo "FAIL: Duration tokens not split"
  ((FAIL++))
fi

# Check no broken font-[var()] syntax remains
BROKEN_FONT=$(grep -r "font-\[var(--font-" src/ --include="*.tsx" --include="*.ts" -l 2>/dev/null | wc -l)
if [ "$BROKEN_FONT" -eq 0 ]; then
  echo "PASS: No broken font-[var()] syntax found"
  ((PASS++))
else
  echo "FAIL: $BROKEN_FONT files still have font-[var()] syntax"
  ((FAIL++))
fi

# Check no broken duration-[var(--transition-)] syntax remains
BROKEN_DUR=$(grep -r "duration-\[var(--transition-" src/ --include="*.tsx" --include="*.ts" -l 2>/dev/null | wc -l)
if [ "$BROKEN_DUR" -eq 0 ]; then
  echo "PASS: No broken duration-[var(--transition-)] syntax found"
  ((PASS++))
else
  echo "FAIL: $BROKEN_DUR files still have duration-[var(--transition-)] syntax"
  ((FAIL++))
fi

# Check no ambiguous text-[var(--text-)] syntax remains
BROKEN_TEXT=$(grep -r "text-\[var(--text-" src/ --include="*.tsx" --include="*.ts" -l 2>/dev/null | wc -l)
if [ "$BROKEN_TEXT" -eq 0 ]; then
  echo "PASS: No ambiguous text-[var(--text-)] syntax found"
  ((PASS++))
else
  echo "FAIL: $BROKEN_TEXT files still have text-[var(--text-)] syntax"
  ((FAIL++))
fi

# Check dependency versions
if grep -q '"@t3-oss/env-nextjs": "\^0\.13' package.json; then
  echo "PASS: @t3-oss/env-nextjs upgraded to 0.13.x"
  ((PASS++))
else
  echo "FAIL: @t3-oss/env-nextjs not upgraded"
  ((FAIL++))
fi

if grep -q '"@supabase/ssr": "~0\.10' package.json; then
  echo "PASS: @supabase/ssr upgraded to 0.10.x"
  ((PASS++))
else
  echo "FAIL: @supabase/ssr not upgraded"
  ((FAIL++))
fi

# Check SKIP_ENV_VALIDATION guard
if grep -q 'NODE_ENV.*production' src/env.ts; then
  echo "PASS: SKIP_ENV_VALIDATION has production guard"
  ((PASS++))
else
  echo "FAIL: SKIP_ENV_VALIDATION missing production guard"
  ((FAIL++))
fi

# Check engines field
if grep -q '"engines"' package.json; then
  echo "PASS: engines field present in package.json"
  ((PASS++))
else
  echo "FAIL: engines field missing from package.json"
  ((FAIL++))
fi

# Check dependabot config
if [ -f ".github/dependabot.yml" ]; then
  echo "PASS: Dependabot config exists"
  ((PASS++))
else
  echo "FAIL: No Dependabot config"
  ((FAIL++))
fi

# Check no inline styles remain in sidebar/layout
INLINE_STYLE=$(grep -c 'style={{' src/components/nav/sidebar.tsx src/app/\(protected\)/layout.tsx 2>/dev/null)
if [ "$INLINE_STYLE" -eq 0 ]; then
  echo "PASS: No inline styles in sidebar/layout"
  ((PASS++))
else
  echo "FAIL: $INLINE_STYLE inline style occurrences remain"
  ((FAIL++))
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && echo "PHASE 5b: ALL PASS" || echo "PHASE 5b: HAS FAILURES"
```

#### Commit Message

```
fix(tokens): add @theme block, fix CSS token bugs, upgrade dependencies

- Add @theme block to globals.css for Tailwind v4 integration (MED-09)
- Fix font-[var()] -> font-bold/semibold/medium (CRIT-06, 16 occurrences)
- Split compound transition tokens into duration + easing (CRIT-07, 7 occurrences)
- Fix text-[var()] ambiguity with standard utilities (MED-08, 22 occurrences)
- Replace inline styles with Tailwind arbitrary values (MED-03)
- Upgrade @t3-oss/env-nextjs to ^0.13.11 (HIGH-24)
- Upgrade @supabase/ssr to ~0.10.0 (HIGH-25)
- Guard SKIP_ENV_VALIDATION against production (HIGH-06)
- Make critical server env vars required (MED-04)
- Add Dependabot config (HIGH-26)
- Add engines and type fields to package.json (MED-13)
```

---

### Phase 5c: Error Handling + App Shell

**Scope:** Create error boundaries, loading states, auth error mapping, and fix sign-up flow.
**Agent count:** 3 agents
**Estimated time:** 1-1.5 hours
**Depends on:** Phase 5b (auth pages modified in 5b for token syntax; error mapping needs clean auth pages)

#### Agent 5c-1: Error Boundary Files (new files only)

**Files owned (all new):**
- `src/app/global-error.tsx` -- root layout error boundary (CRIT-02)
- `src/app/error.tsx` -- root segment error boundary (CRIT-02)
- `src/app/not-found.tsx` -- global 404 page (HIGH-02)
- `src/app/(protected)/error.tsx` -- protected area error boundary (CRIT-02)
- `src/app/(protected)/loading.tsx` -- protected area loading state (HIGH-01)
- `src/app/(auth)/error.tsx` -- auth area error boundary (CRIT-02)

**Changes:**
1. Create `global-error.tsx` with "use client", own `<html>/<body>`, reset button
2. Create root `error.tsx` with "use client", error digest display, reset button
3. Create `not-found.tsx` with branded 404, link to dashboard
4. Create `(protected)/error.tsx` with context-appropriate error message
5. Create `(protected)/loading.tsx` with spinner and "Loading..." text
6. Create `(auth)/error.tsx` with auth-context error message

#### Agent 5c-2: Auth Error Mapping + Sign-Up Fix

**Files owned:**
- `src/lib/auth/error-messages.ts` -- new file: error code to user-friendly message map (HIGH-03)
- `src/app/(auth)/sign-up/page.tsx` -- fix email verification flow (CRIT-05), add try/catch (3G), use error mapping
- `src/app/(auth)/sign-in/page.tsx` -- use error mapping (HIGH-03), add try/catch (3G), read URL error params (HIGH-04), fix variable shadowing (MED-05)

**Changes:**
1. Create `src/lib/auth/error-messages.ts` with `getAuthErrorMessage()` (maps Supabase error codes)
2. In sign-up page:
   - Add `showConfirmation` state
   - Check `data.session` after signUp -- if null, show "check your email" UI
   - Replace `setError(error.message)` with `setError(getAuthErrorMessage(error))`
   - Wrap handleSubmit in try/catch with finally { setLoading(false) }
   - Rename destructured `error` to `authError` (MED-05)
3. In sign-in page:
   - Replace `setError(error.message)` with `setError(getAuthErrorMessage(error))`
   - Wrap handleSubmit in try/catch with finally { setLoading(false) }
   - Add `useSearchParams()` to read URL error params (auth_callback_error, service_unavailable)
   - Rename destructured `error` to `authError` (MED-05)

#### Agent 5c-3: Protected Layout + Sign-Out + Result Type

**Files owned:**
- `src/app/(protected)/layout.tsx` -- add error handling for getUser() (3F)
- `src/components/nav/user-menu.tsx` -- add sign-out error handling + scope: global (3E, HIGH-20)
- `src/lib/types/result.ts` -- new file: Result<T> type pattern (3H)

**Changes:**
1. In protected layout: destructure `error` from getUser(), log and redirect with error param if error
2. In user-menu: wrap signOut in try/catch, use `scope: 'global'`, log errors, still redirect on failure
3. Create Result<T> type with `ok()` and `err()` helpers for future server actions

**NOTE:** Agent 5c-1 creates `(protected)/error.tsx` while Agent 5c-3 modifies `(protected)/layout.tsx`. These are **different files** -- no conflict.

#### Verification Script

```bash
#!/bin/bash
echo "=== Phase 5c Verification ==="
PASS=0; FAIL=0

# Error boundary files exist
for f in "src/app/global-error.tsx" "src/app/error.tsx" "src/app/not-found.tsx" "src/app/(protected)/error.tsx" "src/app/(protected)/loading.tsx"; do
  if [ -f "$f" ]; then
    echo "PASS: $f exists"
    ((PASS++))
  else
    echo "FAIL: $f missing"
    ((FAIL++))
  fi
done

# global-error has use client and html/body
if grep -q '"use client"' src/app/global-error.tsx && grep -q "<html" src/app/global-error.tsx; then
  echo "PASS: global-error.tsx has use client and html/body"
  ((PASS++))
else
  echo "FAIL: global-error.tsx missing use client or html/body"
  ((FAIL++))
fi

# Auth error mapping exists
if [ -f "src/lib/auth/error-messages.ts" ]; then
  echo "PASS: Auth error mapping file exists"
  ((PASS++))
else
  echo "FAIL: Auth error mapping file missing"
  ((FAIL++))
fi

# Sign-up checks session before redirect
if grep -q "data\.session\|showConfirmation\|data.session" src/app/\(auth\)/sign-up/page.tsx; then
  echo "PASS: Sign-up checks session before redirect"
  ((PASS++))
else
  echo "FAIL: Sign-up still redirects without session check"
  ((FAIL++))
fi

# No raw error.message in auth pages
RAW_ERR=$(grep -c "error\.message" src/app/\(auth\)/sign-in/page.tsx src/app/\(auth\)/sign-up/page.tsx 2>/dev/null)
if [ "$RAW_ERR" -eq 0 ]; then
  echo "PASS: No raw error.message in auth pages"
  ((PASS++))
else
  echo "FAIL: $RAW_ERR raw error.message references remain"
  ((FAIL++))
fi

# Try/catch in auth forms
for f in "src/app/(auth)/sign-in/page.tsx" "src/app/(auth)/sign-up/page.tsx"; do
  if grep -q "try {" "$f" && grep -q "finally" "$f"; then
    echo "PASS: $f has try/catch/finally"
    ((PASS++))
  else
    echo "FAIL: $f missing try/catch/finally"
    ((FAIL++))
  fi
done

# Protected layout handles error
if grep -q "error" src/app/\(protected\)/layout.tsx | grep -q "console.error\|redirect.*error"; then
  echo "PASS: Protected layout handles getUser error"
  ((PASS++))
else
  # Alternative check
  if grep -q "service_unavailable" src/app/\(protected\)/layout.tsx; then
    echo "PASS: Protected layout handles getUser error (alt check)"
    ((PASS++))
  else
    echo "FAIL: Protected layout does not handle getUser error"
    ((FAIL++))
  fi
fi

# Sign-out has error handling
if grep -q "scope.*global\|scope: .global" src/components/nav/user-menu.tsx; then
  echo "PASS: Sign-out uses global scope"
  ((PASS++))
else
  echo "FAIL: Sign-out missing global scope"
  ((FAIL++))
fi

# Result type exists
if [ -f "src/lib/types/result.ts" ]; then
  echo "PASS: Result<T> type file exists"
  ((PASS++))
else
  echo "FAIL: Result<T> type file missing"
  ((FAIL++))
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && echo "PHASE 5c: ALL PASS" || echo "PHASE 5c: HAS FAILURES"
```

#### Commit Message

```
feat(error-handling): add error boundaries, fix auth flow, map error messages

- Create error.tsx, global-error.tsx, not-found.tsx at root and route groups (CRIT-02, HIGH-02)
- Add loading.tsx for protected routes (HIGH-01)
- Create auth error message mapping (HIGH-03)
- Fix sign-up to check session before redirect, show email confirmation UI (CRIT-05)
- Add try/catch/finally to auth form submissions (3G)
- Handle getUser() errors in protected layout (3F)
- Add global sign-out scope and error handling (HIGH-20, 3E)
- Create Result<T> type for future server actions (3H)
- Fix variable shadowing in auth forms (MED-05)
```

---

### Phase 5d: Testing Infrastructure

**Scope:** Fix vitest configuration, add coverage, fix test assertions.
**Agent count:** 2 agents
**Estimated time:** 45-60 minutes
**Depends on:** Phase 5c (sign-in/sign-up pages finalized; tests reference them)

#### Agent 5d-1: Vitest Configuration

**Files owned:**
- `vitest.config.ts` -- rewrite with projects + coverage config (HIGH-08, HIGH-09)
- `package.json` -- update test scripts only (HIGH-08)

**Changes:**
1. Rewrite vitest.config.ts with `test.projects` array (unit, smoke, security, db, actions, component)
2. Add coverage configuration with v8 provider and initial thresholds
3. Update package.json scripts: `test:unit`, `test:smoke`, `test:security`, `test:db`, `test:actions`, `test:component`, `test:ci`, `test:coverage`
4. Add `coverage/` to `.gitignore`

**NOTE on package.json:** Agent 5d-1 touches only the `"scripts"` section. Agent 5b-2 touched `dependencies`, `devDependencies`, `engines`, and `type`. No overlap.

#### Agent 5d-2: Test File Fixes

**Files owned:**
- `tests/smoke/supabase.test.ts` -- fix non-null assertions (HIGH-07)
- `tests/setup.ts` -- create or update setup file if needed

**Changes:**
1. Replace `process.env.NEXT_PUBLIC_SUPABASE_URL!` with validated env access or early-exit guard
2. Replace `process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!` similarly
3. Replace `process.env.SUPABASE_SERVICE_ROLE_KEY!` similarly
4. Add clear error messages for missing env vars in tests

**Post-phase step:** Install new dev dependencies: `npm install -D @vitest/coverage-v8 @testing-library/react @testing-library/dom @testing-library/jest-dom jsdom`

#### Verification Script

```bash
#!/bin/bash
echo "=== Phase 5d Verification ==="
PASS=0; FAIL=0

# Check vitest has projects config
if grep -q "projects" vitest.config.ts; then
  echo "PASS: vitest.config.ts has projects configuration"
  ((PASS++))
else
  echo "FAIL: vitest.config.ts missing projects"
  ((FAIL++))
fi

# Check named projects exist
for proj in "unit" "smoke" "security" "db" "actions"; do
  if grep -q "name: .${proj}" vitest.config.ts; then
    echo "PASS: Project '${proj}' defined"
    ((PASS++))
  else
    echo "FAIL: Project '${proj}' missing"
    ((FAIL++))
  fi
done

# Check coverage config
if grep -q "coverage" vitest.config.ts && grep -q "provider" vitest.config.ts; then
  echo "PASS: Coverage configuration present"
  ((PASS++))
else
  echo "FAIL: Coverage configuration missing"
  ((FAIL++))
fi

# Check test scripts in package.json
for script in "test:unit" "test:smoke" "test:security" "test:ci" "test:coverage"; do
  if grep -q "\"${script}\"" package.json; then
    echo "PASS: Script '${script}' exists"
    ((PASS++))
  else
    echo "FAIL: Script '${script}' missing"
    ((FAIL++))
  fi
done

# Check no non-null assertions in smoke tests
BANGS=$(grep -c '!' tests/smoke/supabase.test.ts 2>/dev/null)
if [ "$BANGS" -eq 0 ]; then
  echo "PASS: No non-null assertions in smoke tests"
  ((PASS++))
else
  echo "FAIL: $BANGS non-null assertions remain in smoke tests"
  ((FAIL++))
fi

# Check coverage in gitignore
if grep -q "coverage" .gitignore; then
  echo "PASS: coverage/ in .gitignore"
  ((PASS++))
else
  echo "FAIL: coverage/ not in .gitignore"
  ((FAIL++))
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && echo "PHASE 5d: ALL PASS" || echo "PHASE 5d: HAS FAILURES"
```

#### Commit Message

```
fix(testing): configure vitest projects, add coverage, fix test assertions

- Rewrite vitest.config.ts with named projects (unit, smoke, security, db, actions, component) (HIGH-08)
- Add @vitest/coverage-v8 with initial thresholds (HIGH-09)
- Update package.json test scripts to use --project flag (HIGH-08)
- Replace non-null assertions in smoke tests with validated env access (HIGH-07)
```

---

### Phase 5e: Performance + Accessibility

**Scope:** Optimize auth latency, fix WCAG failures, add skip link, add metadata.
**Agent count:** 3 agents
**Estimated time:** 2-2.5 hours
**Depends on:** Phase 5b (@supabase/ssr upgraded to 0.10.0 for getClaims support), Phase 5c (auth pages finalized)

#### Agent 5e-1: Auth Performance (cache + getClaims + font loading)

**Files owned:**
- `src/lib/auth/get-user.ts` -- new file: `cache()`-wrapped getUser/requireUser (HIGH-14)
- `src/lib/supabase/middleware.ts` -- switch from getUser() to getClaims() (HIGH-14)
- `src/app/layout.tsx` -- fix font loading with next/font variable mode (HIGH-22)
- `next.config.ts` -- add image config, security headers, poweredByHeader:false (HIGH-05)

**Changes:**
1. Create `src/lib/auth/get-user.ts`:
   - Export `getUser` wrapped with `React.cache()` for request deduplication
   - Export `requireUser` that throws if no user (for protected layouts)
2. Update `src/lib/supabase/middleware.ts`:
   - Replace `getUser()` with `getClaims()` (fast, local JWT validation, no network call)
   - Move public route check BEFORE any Supabase call
   - Keep existing try/catch from Phase 5a
3. Update `src/app/layout.tsx`:
   - Load Inter with `variable: '--font-inter'`
   - Load JetBrains Mono with `variable: '--font-jetbrains'`
   - Apply both CSS variables to `<html>` className
   - Add `id="main-content"` to `<main>` (for skip link)
   - Add OG metadata export
4. Update `next.config.ts`:
   - Add security headers (X-Frame-Options, X-Content-Type-Options, HSTS, Referrer-Policy, Permissions-Policy, CSP)
   - Add `images.remotePatterns` for Supabase storage
   - Set `poweredByHeader: false`

**NOTE on middleware.ts:** Agent 5e-1 modifies `src/lib/supabase/middleware.ts` (the function body), which was last modified in Phase 5a. Phase 5a adds try/catch; Phase 5e changes the auth method inside it. These are sequential, non-conflicting changes.

#### Agent 5e-2: Accessibility Fixes (auth pages + globals)

**Files owned:**
- `src/app/(auth)/sign-in/page.tsx` -- fix focus indicators, add ARIA (CRIT-10, MED-14)
- `src/app/(auth)/sign-up/page.tsx` -- fix focus indicators, add ARIA (CRIT-10, MED-14)
- `src/app/globals.css` -- add base `:focus-visible` rule, add `prefers-reduced-motion` reset (CRIT-10, MED-15)

**Changes:**
1. In both auth pages:
   - Replace `focus:outline-none` with `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring` (CRIT-10)
   - Add persistent `role="alert" aria-live="assertive" aria-atomic="true"` error container (MED-14)
   - Add `aria-describedby` and `aria-invalid` to inputs when errors exist
   - Add `autoComplete` attributes to email/password inputs
2. In globals.css:
   - Add base `:focus-visible` rule as safety net
   - Add `@media (prefers-reduced-motion: reduce)` global reset (MED-15)
   - Add `@theme inline` block for `--font-sans: var(--font-inter)` and `--font-mono: var(--font-jetbrains)` (HIGH-22)

**NOTE on auth pages:** Agent 5e-2 modifies sign-in/sign-up pages that were last modified in Phase 5c. Phase 5c changes the logic (try/catch, error mapping, session check); Phase 5e changes the markup (focus classes, ARIA attributes). Sequential, non-conflicting.

**NOTE on globals.css:** Agent 5e-2 modifies globals.css that was last modified in Phase 5b. Phase 5b adds the `@theme` block; Phase 5e adds `@theme inline` for fonts and accessibility CSS. These are additive changes to different sections.

#### Agent 5e-3: Skip Link + SEO Files (new files only)

**Files owned (all new except layout.tsx note):**
- `src/components/shared/skip-link.tsx` -- new file (HIGH-27)
- `src/app/robots.ts` -- new file (SEO)
- `src/app/sitemap.ts` -- new file (SEO)

**Changes:**
1. Create `SkipLink` component with sr-only/focus:not-sr-only pattern
2. Create `robots.ts` allowing `/` but disallowing `/dashboard/` and `/api/`
3. Create `sitemap.ts` with base URL and login page entries

**NOTE:** The SkipLink component must be imported in `layout.tsx`. Agent 5e-1 already owns `layout.tsx`. The plan is: Agent 5e-3 creates the component file. Agent 5e-1 imports it in layout.tsx (adding `<SkipLink />` as first child of body).

#### Verification Script

```bash
#!/bin/bash
echo "=== Phase 5e Verification ==="
PASS=0; FAIL=0

# Check cached getUser exists
if [ -f "src/lib/auth/get-user.ts" ]; then
  echo "PASS: Cached getUser file exists"
  ((PASS++))
else
  echo "FAIL: Cached getUser file missing"
  ((FAIL++))
fi

if grep -q "cache" src/lib/auth/get-user.ts 2>/dev/null; then
  echo "PASS: getUser uses React cache()"
  ((PASS++))
else
  echo "FAIL: getUser not using cache()"
  ((FAIL++))
fi

# Check middleware uses getClaims
if grep -q "getClaims" src/lib/supabase/middleware.ts; then
  echo "PASS: Middleware uses getClaims()"
  ((PASS++))
else
  echo "FAIL: Middleware not using getClaims()"
  ((FAIL++))
fi

# Check font loading
if grep -q "variable.*--font-inter\|--font-inter" src/app/layout.tsx; then
  echo "PASS: Font loading uses CSS variable mode"
  ((PASS++))
else
  echo "FAIL: Font loading not using CSS variable mode"
  ((FAIL++))
fi

# Check security headers in next.config.ts
if grep -q "X-Frame-Options\|x-frame-options" next.config.ts; then
  echo "PASS: Security headers configured"
  ((PASS++))
else
  echo "FAIL: Security headers missing from next.config.ts"
  ((FAIL++))
fi

# Check no focus:outline-none without replacement
BROKEN_FOCUS=$(grep -r "focus:outline-none" src/ --include="*.tsx" -l 2>/dev/null | wc -l)
if [ "$BROKEN_FOCUS" -eq 0 ]; then
  echo "PASS: No bare focus:outline-none found"
  ((PASS++))
else
  echo "FAIL: $BROKEN_FOCUS files still have focus:outline-none without replacement"
  ((FAIL++))
fi

# Check focus-visible present
if grep -q "focus-visible" src/app/globals.css; then
  echo "PASS: focus-visible base rule in globals.css"
  ((PASS++))
else
  echo "FAIL: focus-visible rule missing from globals.css"
  ((FAIL++))
fi

# Check reduced-motion
if grep -q "prefers-reduced-motion" src/app/globals.css; then
  echo "PASS: prefers-reduced-motion handling present"
  ((PASS++))
else
  echo "FAIL: prefers-reduced-motion handling missing"
  ((FAIL++))
fi

# Check ARIA on auth pages
for f in "src/app/(auth)/sign-in/page.tsx" "src/app/(auth)/sign-up/page.tsx"; do
  if grep -q 'role="alert"\|aria-live' "$f"; then
    echo "PASS: $f has ARIA error announcement"
    ((PASS++))
  else
    echo "FAIL: $f missing ARIA error announcement"
    ((FAIL++))
  fi
done

# Check skip link
if [ -f "src/components/shared/skip-link.tsx" ]; then
  echo "PASS: Skip link component exists"
  ((PASS++))
else
  echo "FAIL: Skip link component missing"
  ((FAIL++))
fi

if grep -q "SkipLink\|skip-link" src/app/layout.tsx; then
  echo "PASS: Skip link imported in layout"
  ((PASS++))
else
  echo "FAIL: Skip link not imported in layout"
  ((FAIL++))
fi

# Check main-content ID
if grep -q 'id="main-content"' src/app/layout.tsx; then
  echo "PASS: main-content ID on main element"
  ((PASS++))
else
  echo "FAIL: main-content ID missing from layout"
  ((FAIL++))
fi

# Check SEO files
for f in "src/app/robots.ts" "src/app/sitemap.ts"; do
  if [ -f "$f" ]; then
    echo "PASS: $f exists"
    ((PASS++))
  else
    echo "FAIL: $f missing"
    ((FAIL++))
  fi
done

# Check OG metadata
if grep -q "openGraph\|open_graph\|og:" src/app/layout.tsx; then
  echo "PASS: OG metadata configured"
  ((PASS++))
else
  echo "FAIL: OG metadata missing from layout"
  ((FAIL++))
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && echo "PHASE 5e: ALL PASS" || echo "PHASE 5e: HAS FAILURES"
```

#### Commit Message

```
feat(perf,a11y): add getClaims, cache getUser, fix WCAG, add security headers

- Create cached getUser/requireUser with React cache() (HIGH-14)
- Switch middleware from getUser() to getClaims() for local JWT validation (HIGH-14)
- Move public route check before Supabase call in middleware
- Fix font loading with next/font CSS variable mode (HIGH-22)
- Add security headers to next.config.ts (HIGH-05)
- Replace focus:outline-none with focus-visible indicators (CRIT-10)
- Add role="alert" + aria-live for error announcements (MED-14)
- Add prefers-reduced-motion global reset (MED-15)
- Add skip-to-content link (HIGH-27)
- Add robots.ts and sitemap.ts
- Add OG metadata to root layout
```

---

## Conflict Matrix

Every file that appears in more than one phase, with the resolution for which phase owns it and why.

| File | Phase 5a | Phase 5b | Phase 5c | Phase 5d | Phase 5e | Owner Resolution |
|---|---|---|---|---|---|---|
| `src/app/(auth)/sign-in/page.tsx` | -- | 5b (token syntax) | 5c (error mapping, try/catch, URL params) | -- | 5e (focus, ARIA) | **Sequential: 5b -> 5c -> 5e** (non-overlapping changes each phase) |
| `src/app/(auth)/sign-up/page.tsx` | -- | 5b (token syntax) | 5c (session check, error mapping, try/catch) | -- | 5e (focus, ARIA) | **Sequential: 5b -> 5c -> 5e** (non-overlapping changes each phase) |
| `src/app/(protected)/layout.tsx` | -- | 5b (token syntax) | 5c (error handling for getUser) | -- | -- | **Sequential: 5b -> 5c** |
| `src/lib/supabase/middleware.ts` | 5a (try/catch) | -- | -- | -- | 5e (getClaims) | **Sequential: 5a -> 5e** (5a adds try/catch, 5e changes auth method inside it) |
| `src/middleware.ts` | 5a (matcher) | -- | -- | -- | -- | **5a only** |
| `src/app/globals.css` | -- | 5b (@theme block, tokens) | -- | -- | 5e (focus-visible, reduced-motion, @theme inline fonts) | **Sequential: 5b -> 5e** (5b adds @theme, 5e adds @theme inline + a11y CSS) |
| `src/components/nav/sidebar.tsx` | -- | 5b (token syntax) | -- | -- | -- | **5b only** |
| `src/components/nav/user-menu.tsx` | -- | 5b (token syntax) | 5c (sign-out scope + error handling) | -- | -- | **Sequential: 5b -> 5c** |
| `src/app/(protected)/dashboard/page.tsx` | -- | 5b (token syntax) | -- | -- | -- | **5b only** |
| `src/app/(protected)/settings/page.tsx` | -- | 5b (token syntax) | -- | -- | -- | **5b only** |
| `src/app/(protected)/projects/page.tsx` | -- | 5b (token syntax) | -- | -- | -- | **5b only** |
| `src/app/layout.tsx` | -- | -- | -- | -- | 5e (fonts, skip link, OG metadata, main-content ID) | **5e only** |
| `package.json` | -- | 5b (deps, engines, type) | -- | 5d (scripts only) | -- | **5b -> 5d** (different sections: deps vs scripts) |
| `src/env.ts` | -- | 5b (validation, skip guard) | -- | -- | -- | **5b only** |
| `src/app/auth/callback/route.ts` | 5a (redirect validation, logging) | -- | -- | -- | -- | **5a only** |
| `.gitignore` | 5a (.env exclusions) | -- | -- | 5d (coverage/) | -- | **5a -> 5d** (different sections: env vs coverage) |
| `vitest.config.ts` | -- | -- | -- | 5d (full rewrite) | -- | **5d only** |
| `next.config.ts` | -- | -- | -- | -- | 5e (headers, images) | **5e only** |

### Conflict Resolution Rules

1. **No two agents in the same phase touch the same file.** Every file has exactly one agent owner per phase.
2. **Cross-phase edits are sequential, not parallel.** Phases run in order: 5a -> 5b -> 5c -> 5d -> 5e. Each agent reads the file as left by the prior phase.
3. **Token syntax changes (5b) must complete before logic changes (5c).** Phase 5c agents will see clean Tailwind utility classes, not the broken `var()` syntax.
4. **Auth page changes stack cleanly across phases:**
   - Phase 5b: class string replacements only (no logic changes)
   - Phase 5c: JavaScript logic changes (try/catch, error mapping, session check)
   - Phase 5e: HTML attribute additions (ARIA, focus-visible classes)

---

## Findings NOT Addressed in This Plan

These findings are intentionally deferred. They are either lower severity, require external dependencies, or are better addressed as separate workstreams.

| ID | Finding | Severity | Reason for Deferral |
|---|---|---|---|
| HIGH-11 | Rate limiting on auth endpoints | HIGH | Requires Upstash Redis or equivalent. Supabase built-in rate limiting provides temporary protection. Separate workstream. |
| HIGH-12 | Auth form duplication (~85% identical) | HIGH | Refactoring. Functional after Phase 5c fixes. Extract shared components in Phase 1A. |
| HIGH-13 | Auth pages entirely "use client" | HIGH | Server/client split requires restructuring. Better done alongside form deduplication (HIGH-12) in Phase 1A. |
| HIGH-16 | tsconfig strict flags | HIGH | Adding `noUncheckedIndexedAccess` and `noImplicitReturns` may surface many new type errors. Separate task. |
| HIGH-18 | No password reset flow | HIGH | New feature requiring new routes. Phase 1A scope. |
| HIGH-19 | Missing onAuthStateChange listener | HIGH | Requires AuthProvider component. Phase 1A scope. |
| HIGH-21 | No auth utility for server actions | HIGH | No server actions exist yet. Create alongside first server action in Phase 1A. |
| HIGH-23 | Missing (auth) route group layout | HIGH | Pairs with auth form deduplication (HIGH-12). Phase 1A. |
| MED-01 | Browser client not memoized | MEDIUM | Relies on undocumented internal singleton. Low actual risk. |
| MED-02 | Empty catch in server.ts | MEDIUM | Documented Supabase pattern. Add conditional dev logging when convenient. |
| MED-07 | No error tracking infrastructure | MEDIUM | Requires Sentry/Datadog setup. Separate workstream. |
| MED-10 | No auth event logging | MEDIUM | Requires logging infrastructure. Separate workstream. |
| MED-11 | Redundant index on user_id | MEDIUM | Minor perf issue. Include in next migration batch. |
| MED-12 | Hook not enabled in config.toml | MEDIUM | Local dev concern. Verify after migration deployment. |
| MED-22 | Inline styles in sidebar/layout | MEDIUM | Addressed in Phase 5b (token syntax updates). |
| CRIT-04 | No Supabase generated types | CRITICAL | Requires running `npx supabase gen types`. Mechanical but separate from these fixes -- creates a large diff touching all Supabase client files. Recommend as immediate follow-up. |

### Deferred Items Recommended as Immediate Follow-Up

1. **CRIT-04 (Supabase types)** -- Run `npm run db:types` and add `<Database>` generic to all client factories. Mechanical but high impact. Do this immediately after Phase 5e.
2. **HIGH-16 (tsconfig flags)** -- Add `noUncheckedIndexedAccess` and `noImplicitReturns`. Fix resulting type errors. Separate PR.
3. **HIGH-12 + HIGH-13 + HIGH-23 (auth refactor)** -- Extract shared auth components, split server/client boundaries, add (auth) layout. Natural Phase 1A task.

---

## Execution Summary

| Phase | Agents | Files Modified | Files Created | Est. Time | Commit Size |
|---|---|---|---|---|---|
| 5a | 3 | 4 | 1 migration | 30-45 min | 5 files |
| 5b | 2 | 12 | 1 (.github/dependabot.yml) | 1.5-2 hr | 13 files |
| 5c | 3 | 4 | 7 | 1-1.5 hr | 11 files |
| 5d | 2 | 3 | 0-1 | 45-60 min | 3-4 files |
| 5e | 3 | 6 | 4 | 2-2.5 hr | 10 files |
| **Total** | **13 agent-slots** | **29 files** | **13 new files** | **6-8 hr** | **5 commits** |

All phases are designed so that:
- No two agents in the same phase write to the same file
- Each phase produces a single atomic commit
- Each commit leaves the codebase in a buildable, deployable state
- Verification scripts run at every phase gate before committing
