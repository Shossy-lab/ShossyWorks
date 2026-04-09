# Risk Reviewer Feedback -- Iteration 1

## Verdict: REVISE

---

## Strengths (what the plan gets right)

1. **Splitting migrations into 10 focused files** is the correct approach. Each migration has a clear scope, and the numbering scheme enforces ordering. This is dramatically better than the original monolithic plan.

2. **RLS-first mandate** (every CREATE TABLE must have ENABLE ROW LEVEL SECURITY) addresses the most critical security gap. The verification scripts check for this.

3. **Snapshot JSONB over deep-copy** is the right storage model. It isolates snapshot data from production tables and makes immutability enforcement straightforward.

4. **Trigger bypass via SET LOCAL** is correctly scoped to the transaction. This is the standard PostgreSQL pattern and cannot leak across connections.

5. **Verification scripts per phase** with concrete PASS/FAIL gates provide a mechanical way to validate each step.

---

## Issues Found

### Issue 1: `user_roles` -> `user_profiles` Migration Can Break Running Auth Flow

- **Severity:** BLOCKING
- **Location in plan:** Phase 1A-0, Migration step 5 ("Data migration from user_roles to user_profiles") and step 9 ("Drop old user_roles table")
- **Problem:** The `custom_access_token_hook` reads from `user_roles` on EVERY token refresh. The `handle_new_user` trigger writes to `user_roles` on EVERY signup. If the migration is applied as a single transaction that creates `user_profiles`, migrates data, updates the hook, updates the trigger, then drops `user_roles`, there is zero downtime risk. BUT if the migration fails AFTER dropping `user_roles` and BEFORE the new hook function is committed (or if the migration is applied in parts), the auth system breaks completely -- no user can log in, no new user can sign up. The plan does not explicitly address atomicity or rollback for this step.
- **Additionally:** The existing `custom_access_token_hook` function casts to `public.app_role` enum type. The new `user_profiles` table still uses `public.app_role`. BUT the plan also has `get_user_role()` returning `TEXT` (not `app_role`). If any RLS policy or trigger compares `get_user_role()` output (text) to `user_profiles.role` (app_role enum), implicit casting may cause unexpected behavior or errors in strict mode.
- **Fix:**
  1. The migration MUST be a single atomic transaction (wrap in BEGIN/COMMIT -- which Supabase migrations already do, but state this explicitly in the plan).
  2. Add a verification step that tests the token hook AFTER migration: create a test user, verify JWT contains `user_role` claim from the new table.
  3. Add explicit note: "If migration 000001 fails, run `supabase db reset` -- no production data exists, so full reset is the recovery path."
  4. Document the `TEXT` vs `app_role` type mismatch and ensure all comparisons use explicit text casting.

### Issue 2: No Explicit Rollback Strategy for Any Migration

- **Severity:** BLOCKING
- **Location in plan:** All phases (1A-0 through 1A-9)
- **Problem:** The plan has 10 migration files. None of them document a rollback path. If migration 000005 (catalog/options) fails mid-apply because of a typo in an FK reference, what happens? The plan says "run the verification script" but the verification script checks for file existence and grep patterns -- it does NOT validate that the migration actually applied to the database. Supabase CLI migrations are transactional (they rollback on error), but: (a) this is not stated, (b) if someone uses `supabase db push` instead of `supabase db reset`, partial state is possible, (c) the plan does not address what to do when a migration passes syntax check but produces runtime errors (e.g., a trigger that compiles but throws at execution time).
- **Fix:**
  1. Add a top-level section: "Recovery Strategy" that states: "Phase 1A operates on a local Supabase instance with no production data. The nuclear rollback for ANY failure is `supabase db reset`. This destroys and recreates the local database, reapplying all migrations from scratch. This is acceptable because Phase 1A creates schema only -- no user data exists."
  2. Add to each phase's verification: "Verify migration applied: `psql -c 'SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = '{expected_table}'`"
  3. For Phase 1A-0 specifically (the only migration touching EXISTING data): add an explicit "Before running: verify user_roles has data / is empty" check, and "After running: verify custom_access_token_hook reads from user_profiles" check.

### Issue 3: Window of Exposure Between Table Creation and RLS Policy Application

- **Severity:** MAJOR
- **Location in plan:** Phase 1A-2 through 1A-5 (all table-creation migrations)
- **Problem:** The plan says "Tables (in dependency order)" then "Client VIEWs (in same migration)" then shows RLS as part of each table. But a close reading reveals RLS policies in Phase 1A-2 reference `client_project_access` (for client role policies), which is not created until Phase 1A-5. This creates a circular dependency: the core tables need client access checks for their RLS, but the client access table depends on core tables existing.
- **Specifically:** The RLS policy pattern from `rls-authorization-research.md` uses `EXISTS (SELECT 1 FROM client_project_access WHERE ...)` in client role policies. If `client_project_access` does not exist when `projects` RLS is evaluated, PostgREST will throw a "relation does not exist" error for any client-role user query.
- **Fix:**
  1. Option A (recommended): Create `client_project_access` as part of Phase 1A-2 (core tables), even though it is conceptually a "client/sharing" table. It is an FK dependency for RLS policies on `projects`, `estimates`, and `estimate_nodes`.
  2. Option B: Use a two-pass approach -- create tables with staff-only RLS first, then add client RLS policies in Phase 1A-5 after `client_project_access` exists. This leaves a window where client users get access denied, but since no client users exist in Phase 1A, it is functionally safe.
  3. Document whichever choice is made. Currently the plan is silent on this dependency.

### Issue 4: `exactOptionalPropertyTypes` tsconfig Flag Will Break Existing Code

- **Severity:** MAJOR
- **Location in plan:** Phase 1A-0, "tsconfig Hardening"
- **Problem:** The plan adds `exactOptionalPropertyTypes: true` to tsconfig. This flag changes how TypeScript handles optional properties -- `undefined` is no longer assignable to optional properties without an explicit `| undefined` in the type. This is one of the strictest TypeScript flags and is notorious for breaking existing code. The current codebase has multiple components (auth forms, error boundaries, UI components) that almost certainly pass `undefined` to optional props. Enabling this flag will cause dozens of type errors across existing code that is currently working.
- **Additionally:** `noUncheckedIndexedAccess` will also add `| undefined` to every array/object index access, which will cascade type errors through any code that does `array[0].property` without null checks.
- **Fix:**
  1. Move tsconfig hardening OUT of Phase 1A-0 and INTO a separate preparatory step BEFORE Phase 1A begins.
  2. Or: enable flags incrementally. Start with `noImplicitReturns` (least disruptive), add `noUncheckedIndexedAccess` in 1A-10 when new code is written to handle it, and DEFER `exactOptionalPropertyTypes` until Phase 1B when existing UI code is being touched anyway.
  3. At minimum: the plan must include a step "Fix all existing TypeScript errors caused by new strict flags" with time allocated. Currently the 0.5 session estimate for 1A-0 does not account for this.

### Issue 5: Test Infrastructure Requires Running Supabase Instance -- Brittleness Risk

- **Severity:** MAJOR
- **Location in plan:** Phase 1A-12 (Comprehensive Tests)
- **Problem:** 114+ test cases depend on a running local Supabase instance with all 10 migrations applied. If ANY migration changes after tests are written (e.g., a column rename discovered in Phase 1A-11 server actions), all dependent tests break. The plan sequences tests LAST (Phase 1A-12), but server actions (1A-11) will inevitably discover schema issues that require migration updates. This creates a cascade: fix migration -> re-run `supabase db reset` -> regenerate types -> update server actions -> rewrite tests. The 1.0 session estimate for tests does not account for this rework.
- **Additionally:** The tests use `vitest.config.db.ts` but no such config exists yet. The existing vitest config at the repo root may conflict. Role-switching tests (`role-helpers.ts`) require creating Supabase auth users with specific roles in the JWT, which requires either the service_role key to set claims directly or actually going through the signup + role assignment flow. This is complex test infrastructure that is glossed over as a sub-step.
- **Fix:**
  1. Add a "schema freeze" gate between Phase 1A-9 (functions) and Phase 1A-10 (types). After this gate, migration files are considered stable. Any schema change after this point requires a new numbered migration, not editing an existing one.
  2. Move test infrastructure setup (helpers, factories, vitest config) to Phase 1A-10 alongside type generation -- not Phase 1A-12. This allows server action development in 1A-11 to validate against the test infrastructure immediately.
  3. Split Phase 1A-12 into two sub-phases: 1A-12a (database tests: triggers, constraints, RLS, snapshots -- these test SQL directly) and 1A-12b (server action + validation tests -- these test TypeScript). 1A-12a can run before 1A-11.
  4. Budget an additional 0.5 sessions for test rework and flaky test debugging.

### Issue 6: Context Exhaustion Across 5-6 Sessions

- **Severity:** MAJOR
- **Location in plan:** Cross-cutting (all phases)
- **Problem:** The plan spans 5-6 sessions. Each session must understand: the plan (this document, ~1500 lines), the research files (8 files, ~300KB total), the contracts, INTENT.md, CODEBASE_MAP.md, and the actual code written in prior sessions. By Session 3, a fresh Claude context will need to read: the plan, 3 migration files, 8+ TypeScript files, and understand the decisions baked into each. The research files alone exceed the L3 context budget.
- **Key risk:** A Session 4 agent writing server actions may not know that `client_visibility` is VARCHAR(20) with 3 values (not a boolean), because that decision is buried in Phase 1A-2's migration file and in `client-visibility-research.md`. If the agent writes `client_visible: boolean` in a server action, it creates a type mismatch that may not surface until Phase 1A-12.
- **Fix:**
  1. After each session completes, generate a cumulative "Phase 1A State" document (not a session handoff -- a living document that grows). Include: tables created so far (with key columns), TypeScript files created, decisions locked in, and a "gotchas" section for things that diverge from what a naive agent would assume (e.g., "client_visibility is NOT a boolean").
  2. Add the state document to L1 context loading for all subsequent sessions.
  3. Consider creating a contracts/ file specifically for Phase 1A cross-session state that encodes the non-obvious decisions as enforceable rules.
  4. Each session's verification script should include a "regression check" that validates ALL prior phases, not just the current one. This catches silent breakage from upstream changes.

### Issue 7: Scope Creep -- Phase 1A is Trying to Build Everything

- **Severity:** MAJOR
- **Location in plan:** Phase 1A-4 (options), 1A-5 (sharing), 1A-9 (6 functions), 1A-11 (54 action functions)
- **Problem:** The plan calls Phase 1A "schema foundation," but it includes:
  - **54 server action functions** (not schema)
  - **9 validation schemas** (not schema)
  - **An options tree filter utility** (application logic)
  - **Status transition guardrail functions** (application logic)
  - **164+ test cases** (not schema)
  - **6 PostgreSQL functions** including the full `deep_copy_estimate()` and `restore_estimate_snapshot()` (complex application logic in SQL)
  
  The original Phase 1A was "schema + types + basic tests." The new Phase 1A has grown to include application-layer server actions and utilities that could ship in Phase 1B alongside their UI. There is no UI consuming these actions in 1A -- they are dead code until 1B.
  
  With 54 server actions and no UI to test them against, the risk is that actions will be written against an idealized understanding of the schema, then need significant rework when the UI reveals actual data flow needs.
- **Fix:**
  1. Define a clear MVP for Phase 1A: **schema (migrations 1-10) + generated types + core domain types + verification tests for SQL functions**. This is Sessions 1-3.
  2. Move server actions (1A-11) to Phase 1B, co-located with the UI that consumes them. Write each action ALONGSIDE its UI consumer, not months ahead of it.
  3. Keep Phase 1A-10 (types/validation) but reduce Zod schemas to just the 3 most critical: `createProjectSchema`, `createEstimateSchema`, `createNodeSchema`. Other schemas ship with their server actions in 1B.
  4. This reduces Phase 1A from 5.5 sessions to ~3 sessions and eliminates the dead-code risk.

### Issue 8: `restore_estimate_snapshot()` Deletes Current Tree Before Deserializing

- **Severity:** MAJOR
- **Location in plan:** Phase 1A-9, Function 3
- **Problem:** The plan describes `restore_estimate_snapshot()` as: "Auto-saves current state as checkpoint before restore. Acquires advisory lock. Deletes current tree data, deserializes snapshot JSONB back into tables." If the deserialization fails AFTER the tree is deleted (e.g., JSONB data references a unit_of_measure ID that no longer exists, or schema_version migration chain has a bug), the current tree is destroyed and the snapshot was not successfully restored. The auto-checkpoint exists, but restoring FROM that checkpoint would hit the same deserialization bug.
- **Fix:**
  1. The restore function MUST use a transaction savepoint pattern: (a) auto-save checkpoint, (b) BEGIN savepoint, (c) delete tree, (d) deserialize snapshot, (e) validate FK integrity, (f) if any error -> ROLLBACK TO savepoint (tree is back), (g) if success -> RELEASE savepoint.
  2. Add a "dry run" mode to `restore_estimate_snapshot()` that validates the JSONB can be deserialized without actually modifying data. Run this before the real restore.
  3. Add an explicit test case: "Restore with corrupted JSONB leaves tree intact."
  4. Document this pattern in the plan so the implementing agent knows to use savepoints, not just rely on the auto-checkpoint.

### Issue 9: History Table Has NO RLS -- But May Need Access Control

- **Severity:** MINOR
- **Location in plan:** Phase 1A-7
- **Problem:** The plan says "NO RLS (history is server-side only, not exposed via PostgREST)." However, `ENABLE ROW LEVEL SECURITY` is not the same as "exposed via PostgREST." If RLS is not enabled on a table, it means EVERY PostgREST request (including `anon` key) can read it. The intent is that history tables should not be queryable by clients. But without `ENABLE ROW LEVEL SECURITY` + a restrictive policy, they ARE queryable. The plan's own RLS gate verification script checks for "every table has RLS" but then excludes history tables from the check.
- **Fix:** Enable RLS on history tables with a simple `DENY ALL` policy (or equivalently, enable RLS with no policies -- which defaults to deny). Then add a service_role bypass if server-side queries need access. This costs 2 lines of SQL and eliminates the exposure.

### Issue 10: Verification Scripts Use grep, Not SQL -- False Confidence

- **Severity:** MINOR
- **Location in plan:** All verification scripts
- **Problem:** Every verification script checks that migration FILES contain certain strings (e.g., `grep -q "ENABLE ROW LEVEL SECURITY"`). This verifies the file was written correctly but NOT that the migration was applied. A migration file can contain `ENABLE ROW LEVEL SECURITY` as a comment, in a DROP statement, or in dead code. The scripts do not verify against the actual database state.
- **Fix:** Add a parallel set of SQL-based verification queries. Example: `SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relrowsecurity = true` to verify RLS is actually enabled on tables. The grep checks are useful as a fast pre-commit gate; the SQL checks are the real verification.

### Issue 11: `app_role` Enum Does Not Include `'pending'` in the CREATE TYPE

- **Severity:** MINOR (but will cause migration failure if missed)
- **Location in plan:** Phase 1A-0 (user_profiles uses `app_role` enum), Phase 1A-1 (enums migration)
- **Problem:** The existing `app_role` enum has values: `'owner', 'employee', 'client'` (from migration 000001) and `'pending'` (added via `ALTER TYPE ADD VALUE` in migration 20260406000001). The `user_profiles` table in Phase 1A-0 uses `role public.app_role NOT NULL DEFAULT 'pending'`. This works because `pending` was already added. BUT: the plan creates NEW enums (`project_status`, `estimate_status`) in Phase 1A-1. If an agent mistakenly recreates `app_role` as part of the "enums" migration (thinking all enums go there), it will conflict with the existing type. The plan does not explicitly state "DO NOT recreate app_role -- it already exists."
- **Fix:** Add explicit note in Phase 1A-1: "app_role enum ALREADY EXISTS from migration 00000000000001 + 20260406000001. Do NOT create or modify it in this migration. Only create project_status and estimate_status."

---

## Cross-Cutting Concerns

### 1. Session Boundary Problem
The plan assumes phases map cleanly to sessions (e.g., "Session 1: 1A-0 + 5 migrations"). In practice, a session will hit a problem in migration 3 that requires rethinking migration 2. If the previous migration was committed, the fix requires a new migration file (not editing the committed one). The plan does not address this -- it assumes each migration is right the first time.

**Recommendation:** All 10 migration files should be developed, tested, and verified in a SINGLE session (or at most two) before any are committed. Commit all migration files together once they all pass `supabase db reset`. This avoids the "fix migration 3 but migration 2 is already committed" problem.

### 2. Agent Parallelism Risk
The plan deploys 2-6 agents per phase. For migration phases (SQL files), multiple agents writing to the SAME migration file is a merge conflict waiting to happen. The plan shows Agent 1 and Agent 2 both contributing to `20260409000003_core_tables.sql`. Who owns the file? How are their outputs merged?

**Recommendation:** Each agent should write a SEPARATE file (e.g., `core_tables_projects.sql`, `core_tables_nodes.sql`) and a final integration step concatenates them in dependency order into the single migration file. OR: one agent writes the full migration, and others review.

### 3. Missing "Smoke Test" Between Phases
The plan has verification scripts that check file contents and TypeScript compilation. But there is no smoke test that verifies the actual database schema works end-to-end: "Create a project, create an estimate, add 3 nodes, create a snapshot, restore the snapshot, verify the tree is intact." This smoke test would catch integration issues between migrations that pass individually but fail together.

**Recommendation:** Add a single end-to-end smoke test (SQL script or integration test) after Phase 1A-9 that exercises the critical path: project -> estimate -> nodes -> snapshot -> restore -> verify.

### 4. The 164 Test Count is Aspirational, Not Actionable
The plan starts at 114 test cases (from the comprehensive analysis) but Phase 1A-12 lists 164+. The jump is unexplained. More importantly, writing 164 tests in 1.0 session means ~1 minute per test. For database integration tests that require seed data, role switching, and assertion against query results, 1 minute per test is not realistic. Expect 3-5 minutes per test for the complex ones (snapshot round-trip, RLS matrix).

**Recommendation:** Prioritize ruthlessly. The 15 snapshot round-trip tests and 20 RLS tests are the ones that prevent data loss and security breaches. Write those first. The 43 server action tests and 15 validation tests provide type-safety value but can ship with Phase 1B when the actions are actually consumed by UI.

---

## Final Assessment

The plan is thorough, well-researched, and correctly addresses the major architectural concerns from the analysis. However, it has two categories of risk:

**Execution risks (BLOCKING):**
1. The `user_roles` -> `user_profiles` migration lacks explicit atomicity guarantees and rollback documentation (Issue 1).
2. No migration has a documented rollback strategy beyond "it should be fine" (Issue 2).

**Scope risks (MAJOR, collectively BLOCKING):**
3. Phase 1A has grown from "schema foundation" to "schema + types + 54 actions + 164 tests." This scope makes the 5.5 session estimate optimistic. Historical pattern: when a plan says "5-6 sessions," execution takes 8-10. The server actions and validation schemas should be deferred to Phase 1B (Issue 7).
4. The RLS cross-dependency between `client_project_access` and core tables is unresolved (Issue 3).
5. tsconfig strict flags will create an unpredictable blast radius of type errors in existing code (Issue 4).
6. Cross-session context loss is a real risk that the plan acknowledges with session estimates but does not mitigate with any explicit handoff mechanism (Issue 6).

**Recommended revision priority:**
1. Add recovery strategy section (nuclear: `supabase db reset`)
2. Resolve `client_project_access` RLS dependency
3. Split Phase 1A scope: schema + types in 1A, actions + validation in early 1B
4. Add savepoint pattern to `restore_estimate_snapshot()`
5. Move tsconfig hardening to incremental approach
6. Add cumulative state document for cross-session context
7. Enable RLS on history tables (deny-all)
8. Add SQL-based verification alongside grep-based checks
