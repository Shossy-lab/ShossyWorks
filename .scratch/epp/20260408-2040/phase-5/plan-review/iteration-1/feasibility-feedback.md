# Feasibility Review -- Iteration 1

## Verdict: REVISE

---

## Strengths (what the plan gets right)

1. **Migration ordering is correct.** The 10-migration sequence respects FK dependencies. Each migration is independently numbered and self-contained. No two phases write to the same migration file. This is solid.

2. **Agent scoping within phases is clean.** Table ownership is partitioned so agents within a phase don't write to the same file. The conflict matrix is explicit and accurate.

3. **Verification scripts exist for every phase.** The gate pattern (bash scripts checking file existence, grep for key SQL patterns) is pragmatic and achievable. The RLS gate that queries `pg_tables` is a good safety net.

4. **Research backing is thorough.** All 8 research files exist and are referenced by specific section. The plan doesn't hand-wave -- it says "Reference: snapshot-architecture-research.md Section X" for nearly every design decision.

5. **The decision to create schema-only tables for Phase 1B features** (shares, comments, approvals) is correct. It avoids migration-chaining later and forces RLS to be designed upfront.

6. **The dependency DAG is honest.** Phases 1A-0 through 1A-9 are truly sequential due to migration ordering. The plan correctly identifies that 1A-3 and 1A-4 can run in parallel, and calls out where parallelism exists within phases.

---

## Issues Found

### Issue 1: ltree extension is already created in existing migration -- plan creates it again

- **Severity:** MINOR (but will cause a confusing error if not IF NOT EXISTS)
- **Location in plan:** Phase 1A-1, migration `20260409000002_extensions_and_enums.sql`
- **Problem:** The existing migration `00000000000001_auth_roles.sql` already runs `CREATE EXTENSION IF NOT EXISTS ltree`. The plan's Phase 1A-1 migration also runs `CREATE EXTENSION IF NOT EXISTS ltree`. While `IF NOT EXISTS` prevents a hard failure, this is redundant and signals that the plan author didn't fully inventory the existing migrations. It raises the question: what else in the existing migrations was overlooked?
- **Fix:** Note the existing ltree extension in Phase 1A-1. Still include it with `IF NOT EXISTS` for documentation purposes, but add a comment in the migration: `-- ltree already created in 00000000000001_auth_roles.sql; repeated here for completeness`.

### Issue 2: Phase 1A-0 tsconfig hardening will break the existing build

- **Severity:** BLOCKING
- **Location in plan:** Phase 1A-0, "tsconfig Hardening" section
- **Problem:** The plan adds `noUncheckedIndexedAccess`, `noImplicitReturns`, and `exactOptionalPropertyTypes` to tsconfig. The plan's own Session Estimates table flags this: "tsconfig strict flags may cause existing code errors." But it provides no remediation strategy. The existing codebase has components, middleware, supabase clients, layouts, error boundaries, and pages that were NOT written with these flags. `noUncheckedIndexedAccess` in particular will generate type errors on every array access and object index that doesn't account for `undefined`. `exactOptionalPropertyTypes` is notoriously strict and will break code that passes `undefined` to optional properties. The plan gives Phase 1A-0 only 0.5 sessions and 3 agents, with no agent assigned to fix existing code breakage.
- **Fix:** Either (a) add a dedicated agent in Phase 1A-0 to audit and fix existing code for the new tsconfig flags, increasing session estimate to 0.75, or (b) defer `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` to a separate hardening pass after Phase 1A is complete (lower risk, recommended). At minimum, `noImplicitReturns` is safe to add now.

### Issue 3: Phase 1A-0 user_profiles migration has a destructive DROP TABLE in a single migration

- **Severity:** MAJOR
- **Location in plan:** Phase 1A-0, migration step 9: "Drop old user_roles table"
- **Problem:** The migration creates `user_profiles`, migrates data from `user_roles`, updates the hook and triggers, then drops `user_roles` -- all in one migration. If ANY step fails mid-execution, Supabase migration rollback behavior is unclear (Supabase wraps migrations in transactions, but DDL + DML mixing can cause issues in Postgres). More critically, the existing `custom_access_token_hook` function in `20260406000001_security_fixes.sql` explicitly references `user_roles`. The plan says "Updated custom_access_token_hook() function" in step 7, but if the new hook function definition fails for any reason AFTER `user_roles` is dropped, the auth system breaks completely.
- **Fix:** Split Phase 1A-0 migration into two migrations: (a) `_security_foundation_a.sql` -- create `user_profiles`, migrate data, create new helpers, update hooks/triggers; (b) `_security_foundation_b.sql` -- drop `user_roles` ONLY after the first migration succeeds. This gives a rollback point. Alternatively, rename `user_roles` instead of dropping it (keeps a safety net).

### Issue 4: Server action count jumped from ~30 (plan text) to 54 (detailed table)

- **Severity:** MAJOR
- **Location in plan:** Phase 1A-11 heading says "~30 server actions" but the detailed table lists 54 action functions across 11 files
- **Problem:** The session estimate of 0.75 and the agent assignment of 5 agents were likely based on the "~30" figure. With 54 actions, that's ~11 actions per agent. Each action requires: Zod validation import, Supabase client setup, type-safe query, error mapping, ActionResult return. Even with a consistent pattern, writing 11 well-typed server actions with proper error handling is not a 0.75-session task for an agent. More realistically, each agent needs to write ~11 actions, each ~40-80 lines, plus handle edge cases unique to each entity. The plan also includes `catalog.ts` and `search.ts` as "stubs for 1B" -- even stub actions need proper signatures, types, and validation.
- **Fix:** Either (a) revise the session estimate to 1.0-1.25 sessions for Phase 1A-11, or (b) cut the scope: defer `catalog.ts`, `search.ts`, `option-sets.ts`, and `notes.ts` stubs to Phase 1B (they're schema-only in 1A anyway, so the actions can wait). This drops the count to ~35, which is more realistic for 0.75 sessions with 5 agents.

### Issue 5: Phase 1A-12 test count jumped from 114 to 164 with no session estimate adjustment

- **Severity:** MAJOR
- **Location in plan:** Phase 1A-12 heading says "114+ test cases" but the detailed breakdown sums to 164+
- **Problem:** The comprehensive analysis (C9) identified 114 test cases minimum. The plan's detailed suite breakdown lists: 15 + 12 + 20 + 15 + 15 + 12 + 10 + 12 + 10 + 20 + 15 + 8 = 164. The session estimate remains 1.0 sessions with 6 agents, which is ~27 tests per agent. But these are NOT simple unit tests -- the snapshot round-trip tests require full database state setup, multi-table verification, and cleanup. The RLS tests require role-switching helpers that don't exist yet. The "tests pass" verification gate (`npx vitest run --config vitest.config.db.ts`) references a config file that doesn't exist -- the plan uses `vitest.config.db.ts` but the codebase has `vitest.config.ts` with a `db` project already configured.
- **Fix:** (a) Revise session estimate to 1.5 sessions. (b) Fix the vitest config reference -- tests should use the existing `vitest.config.ts` with its `db` project, not create a new `vitest.config.db.ts`. (c) Prioritize: make CRITICAL tests (snapshot round-trip, deep copy, RLS) the P0 set (~47 tests), and defer MEDIUM/LOW tests (enums, validation, type guards) to a follow-up commit. This lets the gate pass with the most important coverage.

### Issue 6: No Supabase local instance management in the plan

- **Severity:** BLOCKING
- **Location in plan:** Cross-cutting -- affects all migration phases
- **Problem:** The plan assumes `supabase db reset` works in the pre-commit gate, and Phase 1A-10 runs `npx supabase gen types typescript --local`. Both require a running Supabase local instance (`supabase start`). The plan never mentions starting or managing the local Supabase instance. If the developer doesn't have Docker running or the local Supabase containers aren't up, every migration phase will fail its verification gate silently (the SQL files exist, but correctness is unverified). The plan also doesn't mention the `supabase/config.toml` or whether the custom_access_token_hook is registered in the local auth config.
- **Fix:** Add a "Phase 1A Prerequisites" section that includes: (a) verify Docker is running, (b) `supabase start`, (c) verify the existing migrations apply cleanly (`supabase db reset`), (d) verify `custom_access_token_hook` is registered in `supabase/config.toml` under `[auth.hook.custom_access_token]`. This prerequisite check should be a verification script that runs before Phase 1A-0.

### Issue 7: pending-approval page placed in wrong route group

- **Severity:** MINOR
- **Location in plan:** Phase 1A-0, Application Changes table
- **Problem:** The plan places `pending-approval/page.tsx` under `src/app/(auth)/pending-approval/page.tsx`. The `(auth)` route group currently contains `sign-in` and `sign-up` -- these are unauthenticated routes. A pending-approval page is for an AUTHENTICATED user whose role is `pending`. It should be in a separate route group (e.g., `(pending)`) or in the `(protected)` group with its own layout that skips the normal protected layout redirect. Placing it in `(auth)` means it inherits the auth layout, which may redirect authenticated users to the dashboard.
- **Fix:** Either (a) create a new `(pending)` route group with its own layout, or (b) place the page at `src/app/pending-approval/page.tsx` outside any route group so it has no layout interference. The middleware should redirect `pending` users to this page and the page should be accessible to authenticated users only.

### Issue 8: Phase 1A-3 includes broad_options and broad_option_overrides but the plan categorizes them as "supporting" tables

- **Severity:** MINOR
- **Location in plan:** Phase 1A-3
- **Problem:** `broad_options` references `estimates` (FK) and `broad_option_overrides` references `project_parameters` (FK). These are not "supporting/reference" tables -- they are feature tables that belong with the options system in Phase 1A-4. Co-locating them in 1A-3 is confusing and splits the options system logic across two phases/migrations. An agent working on Phase 1A-4 options would need to know that broad_options was already created elsewhere.
- **Fix:** Move `broad_options` and `broad_option_overrides` to Phase 1A-4 migration. They depend on `estimates` and `project_parameters` which are created in 1A-2 and 1A-3 respectively, so 1A-4 still works dependency-wise.

### Issue 9: The Phase 1A-2 verification script has a bug

- **Severity:** MINOR
- **Location in plan:** Phase 1A-2 verification script
- **Problem:** The script checks `grep -q "ENABLE ROW LEVEL SECURITY" "$F"` inside a loop for each table name, but the grep is always the same -- it checks if the string appears ANYWHERE in the file, not once per table. If only ONE table has RLS enabled, all 6 checks pass. This defeats the purpose of per-table RLS verification.
- **Fix:** Change the grep to check for table-specific RLS: `grep -q "ALTER TABLE.*${table}.*ENABLE ROW LEVEL SECURITY" "$F"` or use a count-based check: `[ $(grep -c "ENABLE ROW LEVEL SECURITY" "$F") -ge 6 ]`.

### Issue 10: 54 server actions in Phase 1A-11 without any existing action patterns to follow

- **Severity:** MAJOR
- **Location in plan:** Phase 1A-11
- **Problem:** `src/lib/actions/` is currently empty. The plan assigns 5 agents to write 11 files with 54 actions. There is no reference implementation or shared utility file to establish the pattern BEFORE agents start writing. The plan shows a pattern example in the "Pattern for Every Action" section, but each agent would independently interpret this pattern. Likely results: inconsistent error handling, different import styles, varying levels of type safety, and inconsistent Supabase query patterns. When 5 agents write code in parallel without a shared foundation, you get 5 different coding styles.
- **Fix:** Add a "Phase 1A-11 Setup" step BEFORE the parallel agents: one agent creates `src/lib/actions/_shared.ts` (shared imports, helper functions like `getAuthenticatedClient()`, `mapSupabaseError()`, `requireRole()`) and one reference action file (e.g., `projects.ts` with `createProject` and `listProjects`) as the pattern template. Then the remaining 4 agents implement using that template. This adds ~0.25 sessions but dramatically improves consistency.

### Issue 11: The plan doesn't account for the `pending` role in the existing custom_access_token_hook

- **Severity:** MINOR
- **Location in plan:** Phase 1A-0
- **Problem:** The existing `20260406000001_security_fixes.sql` already added the `pending` value to `app_role` and updated the hook to default new users to `pending`. The plan's Phase 1A-0 says "Updated custom_access_token_hook() function" and "Updated handle_new_user() trigger" -- but it's unclear whether the plan realizes these were ALREADY updated in the security fixes migration. The plan should be explicit about what changes beyond what already exists.
- **Fix:** Phase 1A-0 migration should include a comment: "custom_access_token_hook was already updated in 20260406000001_security_fixes.sql to default to 'pending'. This migration replaces it to query user_profiles instead of user_roles."

---

## Cross-Cutting Concerns

### Concern A: Session estimates assume zero debugging time

Every phase estimate is based on "agents write files, verification passes, commit." In practice, migration phases will hit issues: RLS policies that are subtly wrong (e.g., JOIN chains that don't resolve for client role), trigger bypass mechanisms that interact unexpectedly, Supabase-specific quirks with SECURITY DEFINER and search_path. The plan's total of 5.5 sessions has zero buffer. A realistic total including debugging is 7-8 sessions.

### Concern B: No rollback strategy for failed migrations

If Phase 1A-5 (client/sharing tables) migration fails after being partially applied, what happens? The plan has no `DOWN` migration instructions and no rollback scripts. Supabase migrations are forward-only in production, but during development you can `supabase db reset` (which replays all migrations from scratch). The plan should explicitly state the rollback strategy: "During development, failed migrations are fixed and re-applied via `supabase db reset`. No DOWN migrations are maintained."

### Concern C: Phase 1A-10 supabase gen types requires ALL migrations to be applied first

This is correctly sequenced in the dependency DAG (1A-10 comes after 1A-9), but there's a subtle issue: if any earlier migration was applied to a local Supabase instance and then the migration file was modified (e.g., to fix a bug found during verification), the generated types will be based on the OLD schema unless `supabase db reset` is run first. The plan should add `supabase db reset` as a mandatory first step in Phase 1A-10.

### Concern D: External dependency -- custom_access_token_hook registration

The plan references the custom_access_token_hook extensively but never verifies that it's registered in Supabase's auth configuration. In Supabase local dev, this requires an entry in `supabase/config.toml` under `[auth.hook.custom_access_token]`. If this isn't configured, the JWT won't contain the role claim, and ALL RLS policies based on `get_user_role()` will fail silently (the function will return NULL or the default, not the actual role). This is a Zac action item that needs to be explicitly called out.

### Concern E: The plan creates ~35 tables but the existing schema has exactly 1 (user_roles)

This is a massive schema jump. While all tables are correctly designed in the research files, the sheer volume means the first `supabase db reset` after all migrations will take significant time. More importantly, the generated types file (`supabase.ts`) will be very large, and TypeScript compilation time will increase noticeably. The plan should set expectations for this.

---

## Final Assessment

The plan is architecturally sound but operationally underestimated. The two BLOCKING issues (tsconfig hardening breaking existing code with no remediation plan, and missing Supabase local instance management) must be resolved before execution. The MAJOR issues (action count mismatch, test count mismatch, destructive DROP TABLE in single migration, no shared action pattern) will cause friction that adds 1.5-2 sessions beyond the 5.5 estimate.

**Recommended total session estimate: 7-8 sessions** (5.5 base + 1 for debugging/iteration + 0.5-1 for Issues 2, 4, 5, 10).

The plan should NOT try to do less -- the scope is correct for Phase 1A. The estimates just need to be honest about the complexity of writing 54 server actions, 164 tests, and 10 migrations for the first time in a greenfield schema.
