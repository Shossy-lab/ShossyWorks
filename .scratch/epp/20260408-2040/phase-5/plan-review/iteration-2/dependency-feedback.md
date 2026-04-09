# Dependency Review -- Iteration 2

## Verdict: APPROVE

---

## Issues Resolved from Iteration 1

- [RESOLVED] Issue 1 (BLOCKING -- `client_has_project_access()` created before `client_project_access` table): v2 defers BOTH the function AND all client-role RLS policies to Phase 1A-5. The function is no longer created in Phase 1A-0. Phase 1A-5 Section 1 creates `client_project_access` table FIRST, then `client_has_project_access()` function SECOND. Verification script for Phase 1A-0 confirms `! grep -q "client_has_project_access"` in the security foundation migration. Fix B2 fully addresses this.

- [RESOLVED] Issue 2 (BLOCKING -- core tables have FK references to supporting tables that don't exist yet): v2 reorders migrations so reference/lookup tables (`units_of_measure`, `cost_codes`) are created FIRST at the top of the Phase 1A-2 migration, before core tables. `phases` is also moved to 1A-2 (created after `projects`). `vendor_id` on `node_item_details` is declared as a soft FK (no REFERENCES constraint) in 1A-2, with the hard FK added via `ALTER TABLE` in Phase 1A-4 when `vendors` is created. Verification script checks that `units_of_measure` line number precedes `CREATE TABLE.*projects` line number. Fix B1 fully addresses this.

- [RESOLVED] Issue 9 (BLOCKING -- client RLS policies on 1A-2/3/4 tables reference `client_project_access` from 1A-5): v2 eliminates this entirely by deferring ALL client-role RLS policies to Phase 1A-5 Section 3. Phase 1A-2 through 1A-4 only include staff/owner/pending/anon policies. Phase 1A-5 adds client policies to all prior tables via `CREATE POLICY`. The explicit note "NO client RLS in this migration -- deferred to Phase 1A-5" appears on every table in 1A-2. Fix B2 addresses this as the same root cause as Issue 1.

- [RESOLVED] Issue 3 (MAJOR -- `estimate_approvals` FK to `option_sets` but DAG says 1A-5 independent of 1A-4): v2 DAG explicitly states: "1A-5 depends on BOTH 1A-3 AND 1A-4 (estimate_approvals FK to option_sets)." The parallel opportunity note is corrected: "1A-3 and 1A-4 can run in parallel (both depend only on 1A-2). 1A-5 must wait for both." Fix M12 fully addresses this.

- [RESOLVED] Issue 5 (MAJOR -- history table indexes defined in both 1A-7 and 1A-8): v2 consolidates ALL index creation in Phase 1A-8. Phase 1A-7 explicitly states "No indexes -- all indexes created in Phase 1A-8" and the verification script asserts `! grep -q "CREATE INDEX.*history"` in the history migration. Fix M13 fully addresses this.

- [RESOLVED] Issue 7 (MAJOR -- trigger functions in 1A-6 may reference columns from 1A-3/1A-4): v2 adds "Tables Referenced" annotations to each trigger function in Phase 1A-6. For example: `update_parent_subtotals()` -- "Tables referenced: estimate_nodes ONLY (sums child totals, no option-awareness)." This confirms no trigger depends on 1A-3/1A-4 tables, making the 1A-6 dependency on only "all tables exist" correct in practice. Fix M14 addresses this.

- [RESOLVED] Issue 4 (MINOR -- table creation order within 1A-5): v2 adds explicit ordering note: "Within this migration, table creation order MUST be: client_project_access -> client_has_project_access() -> estimate_snapshots -> estimate_shares -> estimate_comments -> estimate_approvals -> client RLS policies -> client VIEWs." Fix noted in minor fixes.

- [RESOLVED] Issue 6 (MINOR -- 1A-7 DAG annotation says "requires triggers"): v2 rewords DAG annotation to: "Phase 1A-7 (History Tables) -- requires all application tables (for trigger attachment). NO indexes (consolidated in 1A-8)."

- [RESOLVED] Issue 8 (MINOR -- `supabase gen types` requires all migrations applied first): v2 adds `supabase db reset` as mandatory Step 0 in Phase 1A-10 before type generation. Fix M21 addresses this.

- [RESOLVED] Concern 1 (trigger functions split across phases 1A-3, 1A-5, 1A-6): v2 keeps `prevent_snapshot_mutation()` in Phase 1A-5 (alongside the snapshot table) and `prevent_duplicate_company_settings()` in Phase 1A-3 (alongside the settings table). Phase 1A-6 handles the remaining triggers. This is acceptable -- each trigger is co-located with its table. The trigger inventory is now clear from the migration file summary table.

- [RESOLVED] Concern 2 (`app_role` enum may be recreated): v2 Phase 1A-1 has explicit bold note: "IMPORTANT: `app_role` enum ALREADY EXISTS from migration `00000000000001_auth_roles.sql` + `20260406000001_security_fixes.sql` (which added 'pending'). Do NOT create or modify `app_role` in this migration." Verification script checks `! grep -q "CREATE TYPE.*app_role"`. Fix M25 addresses this.

- [RESOLVED] Concern 3 (test database connection requires running Supabase): v2 Phase 1A Prerequisites covers `supabase start`, and Phase 1A-12 notes that `supabase start` and `supabase db reset` must have been run. Tests use existing `vitest.config.ts` with `db` project.

- [RESOLVED] Concern 4 (`vendor_id` FK crosses phase boundaries): v2 explicitly handles this: `vendor_id UUID` in 1A-2 is a "soft FK (no REFERENCES constraint). Vendors created in Phase 1A-4. Hard FK added via ALTER TABLE in Phase 1A-4." Phase 1A-4 migration includes `ALTER TABLE node_item_details ADD CONSTRAINT ... FOREIGN KEY (vendor_id) REFERENCES vendors(id)`.

## Remaining Issues

None.

## New Issues Found

None.

## Final Assessment

All 3 BLOCKING and 3 MAJOR dependency issues from iteration 1 have been resolved. The core structural fix -- deferring client RLS to Phase 1A-5 and reordering reference tables to the top of 1A-2 -- eliminates the forward-reference problems that were the root cause of most BLOCKING issues. The DAG is now accurate (1A-5 depends on both 1A-3 and 1A-4), indexes are consolidated in 1A-8 (single source of truth), trigger dependencies are annotated, and cross-phase FK references use the soft-then-hard pattern (soft ref in 1A-2, ALTER TABLE in 1A-4). The dependency chain is sound.
