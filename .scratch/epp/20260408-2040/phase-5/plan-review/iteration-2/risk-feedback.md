# Risk Review -- Iteration 2

## Verdict: APPROVE

---

## Issues Resolved from Iteration 1

- [RESOLVED] Issue 1 (BLOCKING -- `user_roles` -> `user_profiles` migration can break auth): v2 splits into two migrations: 1A-0a creates `user_profiles`, migrates data, updates hooks/triggers; 1A-0b drops `user_roles` only after 1A-0a succeeds. Atomicity note states Supabase wraps each migration in a transaction. Recovery path documented: `supabase db reset` for any failure. The split means if 1A-0a fails, `user_roles` is intact and auth continues working. Fix B3 fully addresses this.

- [RESOLVED] Issue 2 (BLOCKING -- no explicit rollback strategy): v2 adds a top-level "Recovery Strategy" section: "Phase 1A operates on a local Supabase instance with no production data. The nuclear rollback for ANY migration failure is `supabase db reset`." Rules include: no DOWN migrations, all migrations verified via reset before committing, failed committed migrations get a new migration file (not editing committed ones). Fix B6 fully addresses this.

- [RESOLVED] Issue 3 (MAJOR -- window of exposure between table creation and RLS): v2 defers ALL client-role RLS policies to Phase 1A-5. Phases 1A-2 through 1A-4 only include staff/owner/pending/anon policies. Phase 1A-5 creates `client_project_access`, then `client_has_project_access()`, then adds client RLS to all prior tables. No client users exist during development, so there is no exposure window. Fix B2 fully addresses the structural issue.

- [RESOLVED] Issue 4 (MAJOR -- `exactOptionalPropertyTypes` will break existing code): v2 defers both `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` to post-1A hardening pass. Only `noImplicitReturns` is enabled (safe, minimal blast radius). Phase 1A-0 section header says "SAFE FLAGS ONLY" and lists the deferred flags with reasoning. Fix B4 fully addresses this.

- [RESOLVED] Issue 5 (MAJOR -- test infrastructure brittleness): v2 moves test infrastructure setup to Phase 1A-10 (alongside type generation), so server actions in 1A-11 can validate against it immediately. Tests use existing `vitest.config.ts` with `db` project (no new config file). The schema freeze is implicit -- Phase 1A-9 is the last migration phase, and 1A-10 runs `supabase db reset` before type generation to ensure clean state. Fix M18 addresses this.

- [RESOLVED] Issue 6 (MAJOR -- context exhaustion across sessions): v2 adds cross-session context management: (a) cumulative "Phase 1A State" document in `.claude/memory/sessions/phase-1a-state.md` updated after each session, (b) document loaded as L1 context at session start, (c) regression check via `supabase db reset` validates all prior phases at each session. The state document explicitly includes "Gotchas" section for non-obvious decisions (e.g., "client_visibility is VARCHAR NOT a boolean"). Fix M16 fully addresses this.

- [RESOLVED] Issue 7 (MAJOR -- Phase 1A scope creep): v2 reduces scope significantly: server actions cut from 54 to ~28 (CORE ONLY), tests cut from 164 to ~82 (CORE ONLY), validation schemas reduced to core entities only (projects, estimates, nodes, snapshots, status). Deferred items (catalog, options, notes, settings, preferences server actions + their tests + validation schemas) ship in Phase 1B alongside consuming UI. Session estimate revised to 6-7 sessions. Fix M1, M2, M28 collectively address this.

- [RESOLVED] Issue 8 (MAJOR -- `restore_estimate_snapshot()` deletes tree before deserializing): v2 adds explicit savepoint pattern: SAVEPOINT pre_restore -> delete tree -> deserialize -> validate FK integrity -> on error ROLLBACK TO pre_restore -> on success RELEASE SAVEPOINT. Verification script checks for `SAVEPOINT` in the functions migration. A test case "Restore with corrupted JSONB leaves tree intact" validates the savepoint rollback. Fix M19 fully addresses this.

- [RESOLVED] Issue 9 (MINOR -- history tables have no RLS): v2 enables RLS on history tables with deny-all policy plus service_role bypass: `CREATE POLICY "service_role_all" ON estimate_nodes_history FOR ALL TO service_role USING (true) WITH CHECK (true)`. Verification script checks for both `ENABLE ROW LEVEL SECURITY` and `service_role` in the history migration. Fix M20 addresses this.

- [RESOLVED] Issue 10 (MINOR -- verification scripts use grep not SQL): v2 adds SQL-based verification alongside grep checks. Phase 1A-12 verification includes a SQL query checking `pg_class.relrowsecurity = false` to find tables without RLS. The RLS Gate section provides a dedicated SQL verification script. Fix noted in minor fixes.

- [RESOLVED] Issue 11 (MINOR -- `app_role` enum recreation risk): v2 adds bold note in Phase 1A-1: "IMPORTANT: `app_role` enum ALREADY EXISTS... Do NOT create or modify `app_role` in this migration." Verification script checks `! grep -q "CREATE TYPE.*app_role"`. Fix M25 addresses this.

- [RESOLVED] Cross-cutting concern 1 (session boundary problem): v2 Recovery Strategy states all migration files should be developed and verified via `supabase db reset` before committing. The approach is fix-in-place during development, new migration file only for already-committed migrations.

- [RESOLVED] Cross-cutting concern 2 (agent parallelism risk): v2 assigns specific table ownership per agent within each phase. No two agents write to the same migration file. The conflict matrix explicitly confirms this.

- [RESOLVED] Cross-cutting concern 3 (missing smoke test): v2 adds an end-to-end smoke test after Phase 1A-9: "project -> estimate -> nodes -> snapshot -> restore -> verify." The SQL smoke test script is included inline in the plan. Fix M29 addresses this.

- [RESOLVED] Cross-cutting concern 4 (test count aspirational): v2 reduces to ~82 core tests with realistic session estimate of 1.0 sessions. Deferred ~82 tests to 1B. The critical path tests (snapshot round-trip, deep-copy, RLS) are prioritized as the core set.

## Remaining Issues

None.

## New Issues Found

None.

## Final Assessment

All 2 BLOCKING and 6 MAJOR risk issues from iteration 1 have been resolved. The two most critical fixes -- explicit recovery strategy via `supabase db reset` and the savepoint pattern for snapshot restore -- eliminate the highest-impact failure modes. Scope reduction from 54 to 28 server actions and 164 to 82 tests brings the plan within realistic session estimates. Cross-session context management via the cumulative state document directly addresses the context exhaustion risk. The plan's risk profile is now acceptable for execution.
