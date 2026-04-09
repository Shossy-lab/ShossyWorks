# Feasibility Review -- Iteration 2

## Verdict: APPROVE

---

## Issues Resolved from Iteration 1

- [RESOLVED] Issue 2 (BLOCKING -- tsconfig hardening will break existing build): v2 defers `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` to post-1A hardening pass. Only `noImplicitReturns` is added (safe). Phase 1A-0 section explicitly states "SAFE FLAGS ONLY" and the verification script asserts aggressive flags are NOT present. Fix B4 fully addresses this.

- [RESOLVED] Issue 6 (BLOCKING -- no Supabase local instance management): v2 adds a complete "Phase 1A Prerequisites" section with a bash verification script covering Docker status, Supabase CLI, `supabase start`, `supabase db reset`, and `custom_access_token_hook` registration in `config.toml`. Fix B5 fully addresses this. The Zac action item for config.toml is explicitly called out.

- [RESOLVED] Issue 3 (MAJOR -- destructive DROP TABLE in single migration): v2 splits into two migrations: `20260409000001_security_foundation.sql` (create user_profiles, migrate data, update hooks) and `20260409000001b_drop_user_roles.sql` (drop user_roles only after 1A-0a succeeds). Atomicity note and rollback documentation included. Fix B3 fully addresses this.

- [RESOLVED] Issue 4 (MAJOR -- server action count mismatch 30 vs 54): v2 reduces Phase 1A server actions to CORE ONLY: `projects.ts`, `estimates.ts`, `nodes.ts`, `snapshots.ts` (~28 actions). Deferred to 1B: `catalog.ts`, `search.ts`, `option-sets.ts`, `notes.ts`, `options.ts` (~26 actions). The 28-count is consistent between heading, detailed table, and commit message. Fix M1 fully addresses this.

- [RESOLVED] Issue 5 (MAJOR -- test count mismatch and vitest config error): v2 reduces tests to CORE ONLY (~82 test cases). Deferred ~82 tests to 1B. Session estimate is 1.0 sessions for 82 tests (reasonable). Uses existing `vitest.config.ts` with `db` project -- no new `vitest.config.db.ts`. Fix M2 and M26 fully address this.

- [RESOLVED] Issue 10 (MAJOR -- 54 server actions without reference pattern): v2 adds Step 0 "Reference Implementation" before parallel agents -- one agent creates `_shared.ts` and `projects.ts` as the pattern template, then remaining agents follow. Fix M3 fully addresses this.

- [RESOLVED] Issue 1 (MINOR -- ltree extension repeated): v2 adds comment noting ltree already exists from prior migration. Fix noted in minor fixes list.

- [RESOLVED] Issue 7 (MINOR -- pending-approval page in wrong route group): v2 places page at `src/app/pending-approval/page.tsx` outside route groups. Fix noted in minor fixes list.

- [RESOLVED] Issue 8 (MINOR -- broad_options in wrong phase): v2 moves `broad_options` and `broad_option_overrides` to Phase 1A-4 (options system). Fix M22 addresses this.

- [RESOLVED] Issue 9 (MINOR -- verification script bug): v2 uses per-table RLS check with `grep -q "ALTER TABLE.*${table}.*ENABLE ROW LEVEL SECURITY"` and a count-based fallback `[ "$RLS_COUNT" -ge 9 ]`. Fix M23 addresses this.

- [RESOLVED] Issue 11 (MINOR -- pending role in existing hook): v2 adds explicit note in Phase 1A-0 clarifying that `custom_access_token_hook` was already updated in security_fixes migration.

- [RESOLVED] Concern A (session estimates assume zero debugging): v2 revises total to 6-7 sessions with explicit debugging buffer. Fix M17 addresses this.

- [RESOLVED] Concern B (no rollback strategy): v2 adds top-level "Recovery Strategy" section stating `supabase db reset` as nuclear rollback, documented for every phase. Fix B6 addresses this.

- [RESOLVED] Concern C (supabase gen types requires clean reset): v2 adds `supabase db reset` as mandatory first step in Phase 1A-10. Fix M21 addresses this.

- [RESOLVED] Concern D (custom_access_token_hook registration): Addressed in Phase 1A Prerequisites with explicit config.toml verification. Fix B5 covers this.

## Remaining Issues

None.

## New Issues Found

None.

## Final Assessment

All 2 BLOCKING and 4 MAJOR issues from iteration 1 have been resolved comprehensively. The revised plan demonstrates that each piece of feedback was carefully addressed with specific, traceable fixes (B1-B7, M1-M29). Session estimates are now realistic (6-7 sessions with buffer), server action and test scope are right-sized for Phase 1A, and the prerequisite checklist eliminates the silent-failure risk. The plan is feasible as written.
