# Dependency Reviewer -- Iteration 1

## Verdict: REVISE

## Strengths (what the plan gets right)

1. **Linear migration numbering** -- 10 sequentially numbered migration files with no gaps. Each phase has exactly one migration file, preventing cross-phase file collisions.
2. **Trigger bypass mechanism** -- `SET LOCAL app.is_snapshot_copy` is scoped to the transaction. Phase 1A-9 functions correctly depend on Phase 1A-6 triggers being in place.
3. **Type generation timing is correct** -- `supabase gen types` runs in Phase 1A-10 AFTER all migrations (1A-0 through 1A-9) but BEFORE server actions (1A-11). The DAG models this correctly.
4. **Agent file ownership within phases** -- No two agents within a single phase write to the same migration file. Each phase has one `.sql` file and agents are scoped to specific tables within it.
5. **No two phases write to the same migration file** -- The conflict matrix explicitly confirms this.
6. **npm install timing** -- Zod is already in `package.json` (`^3.24`). No new npm packages are introduced in the plan, so no timing issue.
7. **Test dependency on full schema** -- Phase 1A-12 correctly depends on all prior phases. `vitest.config.db.ts` and the test infrastructure reference seed data (Phase 1A-8) and functions (Phase 1A-9) that must exist first.

## Issues Found

### Issue 1: `client_has_project_access()` function created before `client_project_access` table exists
- **Severity:** BLOCKING
- **Location in plan:** Phase 1A-0 (item 3) vs Phase 1A-5 (item 1)
- **Problem:** Phase 1A-0 creates the `client_has_project_access(UUID)` helper function (migration `20260409000001`). This function's body queries `public.client_project_access` (confirmed in `rls-authorization-research.md` Section 4.1):
  ```sql
  SELECT EXISTS (
    SELECT 1 FROM public.client_project_access
    WHERE client_user_id = (SELECT auth.uid())
      AND project_id = p_project_id
  );
  ```
  But the `client_project_access` table is not created until Phase 1A-5 (migration `20260409000006`). PostgreSQL will reject the function creation because the referenced table does not exist at CREATE FUNCTION time (SQL functions and STABLE/IMMUTABLE plpgsql functions have their bodies validated at creation, not just at call time).
- **Fix:** Two options:
  - (a) Move `client_has_project_access()` creation to Phase 1A-5, alongside the `client_project_access` table. Keep `get_user_role()` and `is_staff()` in Phase 1A-0 (they don't reference application tables). Then modify Phase 1A-2 through 1A-4 RLS policies to omit client-role policies or use inline EXISTS subqueries until Phase 1A-5 creates the helper + backfills the client policies.
  - (b) Create `client_project_access` table early -- move it from Phase 1A-5 to Phase 1A-0 or Phase 1A-2, since it only depends on `auth.users` and `projects`. Then the function and table exist in the same migration or in the correct order.
  - **Recommended:** Option (b) -- create `client_project_access` in Phase 1A-0 alongside the helper function. It only references `auth.users` (always exists) and `projects` (hmm -- projects doesn't exist yet either). Actually, option (a) is cleaner: defer `client_has_project_access()` to Phase 1A-5, and have Phase 1A-2 through 1A-4 use a temporary inline pattern for client RLS policies, then Phase 1A-5 creates the helper and replaces inline policies. OR: create the function as a plpgsql function that does a dynamic query / uses `IF EXISTS` on the table, so it doesn't fail at creation. Simplest correct fix: move `client_has_project_access()` to Phase 1A-5 migration after the table is created, and add an `ALTER POLICY` or `CREATE OR REPLACE` step in Phase 1A-5 to update any RLS policies that reference it.

### Issue 2: Core tables (Phase 1A-2) have FK references to supporting tables (Phase 1A-3)
- **Severity:** BLOCKING
- **Location in plan:** Phase 1A-2 (core tables) vs Phase 1A-3 (supporting tables)
- **Problem:** The deep-copy function research confirms that `estimate_nodes` has `phase_id` and `cost_code_id` columns that are FK references to `phases` and `cost_codes`. `node_item_details` has `unit_id` and `package_unit_id` FK references to `units_of_measure`, and `vendor_id` FK to `vendors` (Phase 1A-4). `node_assembly_details` has `assembly_unit_id` FK to `units_of_measure`. If these are declared as `REFERENCES` constraints in Phase 1A-2, the migration will fail because `units_of_measure`, `cost_codes`, `phases`, and `vendors` don't exist yet.
- **Fix:** Either:
  - (a) Move `units_of_measure`, `cost_codes`, and `phases` to Phase 1A-2 (before the core tables that reference them), OR
  - (b) Reorder so Phase 1A-3 runs BEFORE Phase 1A-2, OR
  - (c) Declare these as soft FKs (no REFERENCES constraint at CREATE TABLE time) and add the constraints via ALTER TABLE in Phase 1A-8 alongside indexes, OR
  - (d) Split Phase 1A-2 so that reference/lookup tables are created first within the same migration file.
  - **Recommended:** Option (a) or (d). The cleanest approach is to create `units_of_measure`, `cost_codes` at the very top of the Phase 1A-2 migration (they have no dependencies on anything except extensions), then create `phases` (which needs `projects`), then the rest. Alternatively, swap Phase 1A-3 to run before 1A-2 but that breaks the "core tables first" narrative. Best: merge the reference/lookup tables into the top of the 1A-2 migration, or create a new 1A-1.5 phase for reference data tables.

### Issue 3: `estimate_approvals` has FK to `option_sets` but DAG says 1A-5 doesn't depend on 1A-4
- **Severity:** MAJOR
- **Location in plan:** Phase 1A-5 (line 512), DAG (lines 1348-1349)
- **Problem:** `estimate_approvals` (Phase 1A-5) has `option_set_id UUID FK` referencing `option_sets` (Phase 1A-4). The plan's DAG explicitly states "1A-5 depends on 1A-2 but NOT on 1A-3/1A-4." If migrations run in file timestamp order (which they do -- all use `20260409000006` for 1A-5 vs `20260409000005` for 1A-4), the ordering is actually correct. But the DAG is wrong about the dependency, and the plan says 1A-3 and 1A-4 can run in parallel with 1A-5. If an agent were to treat these as parallelizable per the DAG, 1A-5 could be written before 1A-4, causing the FK reference to fail.
- **Fix:** Update the DAG to show 1A-5 depends on BOTH 1A-2 AND 1A-4 (not just 1A-2). Remove the statement "1A-5 depends on 1A-2 but NOT on 1A-3/1A-4." The correct parallel opportunity is: 1A-3 and 1A-4 can run in parallel (both depend only on 1A-2). 1A-5 must wait for both 1A-3 and 1A-4 to complete.

### Issue 4: `estimate_comments.node_id` FK references `estimate_nodes` (1A-2) -- fine, but `estimate_comments.share_id` FK likely references `estimate_shares` in the same migration
- **Severity:** MINOR
- **Location in plan:** Phase 1A-5 (lines 503-508)
- **Problem:** `estimate_comments` has `share_id FK` and `estimate_approvals` has `share_id FK`. Both reference `estimate_shares`. All are created in the same Phase 1A-5 migration. This is fine if `estimate_shares` is created BEFORE `estimate_comments` and `estimate_approvals` within the migration file. The plan lists `estimate_shares` as item 3 and `estimate_comments` as item 4, `estimate_approvals` as item 5 -- correct order.
- **Fix:** No change needed, but add a note that within Phase 1A-5, the table creation order (client_project_access -> estimate_snapshots -> estimate_shares -> estimate_comments -> estimate_approvals) must be preserved by agents. Agent 2 (which handles shares, comments, approvals) must create them in this order.

### Issue 5: History table indexes defined in BOTH Phase 1A-7 and Phase 1A-8
- **Severity:** MAJOR
- **Location in plan:** Phase 1A-7 (line 635) and Phase 1A-8 (lines 708-709)
- **Problem:** Phase 1A-7 specifies `estimate_nodes_history` with inline `Indexes: (original_node_id, changed_at DESC), (estimate_id, changed_at DESC)`. Phase 1A-8 lists the exact same indexes as `idx_nodes_history_node` and `idx_nodes_history_estimate`. If both phases implement these indexes, migration 8 will either fail (duplicate index name) or create redundant indexes (different names, same columns).
- **Fix:** Remove the indexes from Phase 1A-7 entirely. Let Phase 1A-8 be the single source for ALL indexes. Phase 1A-7 should only create tables and trigger functions. Update Phase 1A-7 description to clarify: "Indexes for history tables are created in Phase 1A-8."

### Issue 6: Phase 1A-7 says "requires triggers" but the real dependency is on tables, not triggers
- **Severity:** MINOR
- **Location in plan:** DAG (line 1315)
- **Problem:** The DAG shows "Phase 1A-7 (History Tables) -- requires triggers." But history tables themselves don't require triggers to exist -- they are standalone tables with their own trigger functions. The history trigger functions (`log_node_history`) are created IN Phase 1A-7, not consumed from Phase 1A-6. Phase 1A-7 actually only requires the tables it references (primarily `estimate_nodes` from 1A-2). However, conceptually it does require all application tables to exist so the history trigger can be attached to them.
- **Fix:** Reword the DAG annotation: "Phase 1A-7 (History Tables) -- requires all application tables to exist (for trigger attachment)." The actual dependency is on Phases 1A-2 through 1A-5 (all table-creating phases), not specifically on Phase 1A-6. However, since 1A-6 already depends on all table phases, and 1A-7 follows 1A-6 in the DAG, the ordering is still correct. This is a documentation clarity issue, not a functional error.

### Issue 7: Phase 1A-6 triggers reference columns that may not exist if 1A-3/1A-4 aren't complete
- **Severity:** MAJOR
- **Location in plan:** Phase 1A-6 (line 549), DAG (line 1312)
- **Problem:** The DAG says "Phase 1A-6 (Triggers) -- requires all tables exist." But the parallel opportunity note says "1A-3 and 1A-4 can run in parallel (both depend only on 1A-2)." If we take the DAG literally, Phase 1A-6 correctly waits for 1A-3, 1A-4, and 1A-5. However, the `auto_promote_to_assembly()` trigger and `enforce_item_leaf_constraint()` trigger operate on `estimate_nodes` which references `node_item_details` and `node_assembly_details` (both in 1A-2) -- fine. The `update_parent_subtotals()` trigger needs to query `option_groups` and `option_alternatives` (1A-4) if it considers option membership. But the trigger description suggests it only recalculates parent totals from child prices, which is 1A-2 only. So this is probably safe, but the plan should explicitly confirm which tables each trigger queries.
- **Fix:** Add a "Tables Referenced" annotation to each trigger function in Phase 1A-6, confirming it only touches tables from 1A-2 (or explicitly listing any 1A-3/1A-4 dependencies). This prevents an agent from accidentally adding option-aware logic to a trigger that would fail if 1A-4 hadn't run yet.

### Issue 8: `supabase gen types --local` requires local Supabase instance with all migrations applied
- **Severity:** MINOR
- **Location in plan:** Phase 1A-10 (line 834)
- **Problem:** The command `npx supabase gen types typescript --local` requires that the local Supabase instance has been reset/migrated with ALL migrations (1A-0 through 1A-9). The plan doesn't explicitly state that `supabase db reset` should run before `gen types`. If a session applies migrations incrementally and some fail or are partially applied, the generated types may be incomplete or wrong.
- **Fix:** Add an explicit step at the start of Phase 1A-10: "Run `npx supabase db reset` to ensure all 10 migrations are cleanly applied, then run `npx supabase gen types typescript --local`." This ensures a clean schema for type generation.

### Issue 9: Phase 1A-5 creates `client_project_access` but RLS policies on Phase 1A-2/1A-3/1A-4 tables reference client access checks
- **Severity:** BLOCKING
- **Location in plan:** Phases 1A-2 through 1A-4 (RLS policies), Phase 1A-5 (client_project_access table)
- **Problem:** This is the downstream consequence of Issue 1. Phase 1A-2 creates RLS policies like "client read on assigned projects" on `projects`, "client read on project-accessible estimates" on `estimates`, and "client read filtered by client_visibility" on `estimate_nodes`. These policies call `client_has_project_access()` (from Phase 1A-0) which queries `client_project_access` (not created until Phase 1A-5). Even if the function is created as plpgsql with lazy evaluation, the policies will fail at RUNTIME (not creation time) for client-role users between migrations 1A-2 and 1A-5. For a dev environment this might be tolerable, but it's architecturally unsound -- any `supabase db reset` would apply all migrations in order and only the final state matters. However, the parallel execution model (agents running 1A-3, 1A-4, 1A-5 concurrently) is compromised because 1A-5 can't actually be parallelized with 1A-3/1A-4 without also fixing the RLS dependency chain.
- **Fix:** This is the same root cause as Issue 1. The simplest comprehensive fix: create `client_project_access` in Phase 1A-0 (it only depends on `auth.users`, which always exists, and `projects`, which... doesn't exist yet either). Actually the cleanest fix: defer ALL client-role RLS policies to a separate Phase 1A-5.5 or include them in Phase 1A-5 alongside the `client_project_access` table. Phase 1A-2/1A-3/1A-4 would only include owner/employee/pending/anon policies. Phase 1A-5 would add client policies to all tables via `CREATE POLICY` (not `ALTER`).

## Cross-Cutting Concerns

### Concern 1: Trigger functions in Phase 1A-5 and 1A-3 vs Phase 1A-6

The plan creates `prevent_snapshot_mutation()` in Phase 1A-5 and `prevent_duplicate_company_settings()` in Phase 1A-3, then lists them again in Phase 1A-6 "for completeness." This split means trigger functions live in 3 different migration files. While not technically wrong, it makes it harder to find all triggers and increases the risk of naming collisions or conflicting trigger logic. Consider either:
- Moving ALL trigger function creations to Phase 1A-6 and only creating the trigger attachments (CREATE TRIGGER ... ON table) in the table-creating phases, OR
- Keeping the current split but adding a "Trigger Inventory" section that maps every trigger function to its source migration file.

### Concern 2: The `app_role` enum already exists with `pending` but Phase 1A-0 creates `user_profiles` with a different role column

The existing `app_role` enum is `('owner', 'employee', 'client', 'pending')`. Phase 1A-0 merges `user_roles` into `user_profiles` and may change how roles are stored. The plan should explicitly confirm whether `user_profiles.role` uses the same `app_role` enum or introduces a new type. If it uses the same enum, the `custom_access_token_hook` update in Phase 1A-0 must reference the correct column in the correct table. The research file suggests keeping the `app_role` enum.

### Concern 3: Test database connection requires running Supabase instance

Phase 1A-12 tests require database connectivity (`tests/setup/db-helpers.ts`). The plan doesn't specify whether tests run against the local Supabase instance (started via `supabase start`) or a remote database. If local, the Supabase instance must be running with all migrations applied. The verification script uses `vitest.config.db.ts` but doesn't document the requirement to run `supabase start` + `supabase db reset` before tests.

### Concern 4: `vendor_id` FK on `node_item_details` crosses phase boundaries

`node_item_details` (Phase 1A-2) has `vendor_id` referencing `vendors` (Phase 1A-4). This is the same class of problem as Issue 2 but crosses into a different phase. If `vendor_id` is a hard FK constraint, Phase 1A-2 migration will fail because `vendors` table doesn't exist yet. If it's a soft reference (no REFERENCES clause), then no issue. The plan must explicitly state whether this is a hard FK or soft reference.

## Final Assessment

The plan has **3 BLOCKING issues** (Issues 1, 2, 9 -- all related to the same root cause of forward FK/function references) and **3 MAJOR issues** (Issues 3, 5, 7). The core problem is that the phase ordering assumes a clean separation between "core tables" and "supporting/reference tables," but FK constraints create forward dependencies from core tables to reference tables and from helper functions to junction tables.

The recommended structural fix:
1. Create reference/lookup tables (units_of_measure, cost_codes) BEFORE core tables -- either at the top of Phase 1A-2 or in a new Phase 1A-1.5.
2. Defer `client_has_project_access()` and all client-role RLS policies to Phase 1A-5.
3. Update the DAG to show Phase 1A-5 depends on Phase 1A-4 (not just 1A-2).
4. Consolidate ALL index creation in Phase 1A-8 (remove inline indexes from Phase 1A-7).
5. Add explicit table-dependency annotations to each trigger function in Phase 1A-6.

These are tractable fixes that don't require restructuring the entire plan -- they refine the ordering within the existing phase structure.
