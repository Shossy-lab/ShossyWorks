# Correctness Review -- Iteration 2

## Verdict: APPROVE

---

## Issues Resolved from Iteration 1

- [RESOLVED] Issue 1 (BLOCKING -- trigger bypass variable name mismatch): v2 unifies on a single variable name `app.is_snapshot_copy` everywhere. Phase 1A-6 explicitly states: "NO other bypass variable names. `app.is_snapshot_restore` and `app.allow_snapshot_mutation` are NOT used anywhere." The `restore_estimate_snapshot()` function in Phase 1A-9 uses `SET LOCAL app.is_snapshot_copy = 'true'`. Verification scripts check for the unified variable AND assert the wrong names are absent (`! grep -q "app.is_snapshot_restore"`). Fix B7 fully addresses this.

- [RESOLVED] Issue 9 (MAJOR -- `client_project_access` table created in 1A-5 but referenced by RLS in 1A-2): v2 defers `client_has_project_access()` AND all client-role RLS policies to Phase 1A-5. Phases 1A-2 through 1A-4 contain only staff/owner/pending/anon policies. Phase 1A-5 creates the table, the function, and then adds client RLS to all prior tables via `CREATE POLICY`. Verification scripts confirm `! grep -q "client_has_project_access"` in migration 1A-2. Fix B2 fully addresses the structural dependency violation.

- [RESOLVED] Issue 2 (MAJOR -- `estimate_status_at_time` uses VARCHAR instead of enum): v2 explicitly specifies `estimate_status_at_time public.estimate_status NOT NULL` and `project_status_at_time public.project_status` (using enums, NOT VARCHAR). Verification script checks for `estimate_status_at_time public.estimate_status`. Fix M6 fully addresses this.

- [RESOLVED] Issue 3 (MAJOR -- `node_notes.format` CHECK constraint mismatch): v2 uses `CHECK (format IN ('markdown', 'html'))` matching all research files. Verification script confirms both `'markdown'` and `'html'` appear in the migration. Fix M7 fully addresses this.

- [RESOLVED] Issue 4 (MAJOR -- `node_notes` constraint allows invisible notes): v2 adds `CHECK (is_internal OR is_client_visible)` as a second constraint, preventing the invisible-to-everyone state. Verification script checks for `is_internal OR is_client_visible` in the migration. Fix M8 fully addresses this.

- [RESOLVED] Issue 5 (MAJOR -- `option_groups` RLS uses owner-only instead of `is_staff()`): v2 explicitly states for option_groups: "RLS: `is_staff()` for all operations (NOT owner-only -- corrected from options research)." All option tables (groups, alternatives, memberships, sets, selections) use `is_staff()`. Verification script checks for `is_staff()` in the options migration. Fix M9 fully addresses this.

- [RESOLVED] Issue 6 (MAJOR -- snapshot immutability trigger has conflicting implementations): v2 resolves in favor of the column-by-column check from snapshot research: "allows ONLY `restored_at` and `restored_by` updates, blocks all other field changes and deletes." No session variable bypass needed for the immutability trigger. Fix M10 fully addresses this.

- [RESOLVED] Issue 7 (MAJOR -- `deep_copy_estimate()` references `node_attachments`): v2 removes `node_attachments` from deep-copy with explicit comment: "Does NOT copy `node_attachments` (table does not exist). Comment: `-- TODO: Add node_attachments copy when table is created`." Verification script asserts `! grep -q "node_attachments"`. Fix M4 fully addresses this.

- [RESOLVED] Issue 8 (MAJOR -- snapshot INSERT policy contradicts design intent): v2 clarifies: "RLS: authenticated SELECT, service_role INSERT only (snapshots created through `create_estimate_snapshot()` SECURITY DEFINER function), no direct UPDATE/DELETE." The intent is function-only creation, which prevents incorrect metadata from direct inserts. Fix M11 fully addresses this.

- [RESOLVED] Issue 10 (MINOR -- snapshot serialization omits `was_auto_promoted`): v2 explicitly includes `was_auto_promoted` in node serialization, restore, and deep-copy. Verification script checks for `was_auto_promoted` in the functions migration. Fix M24 addresses this.

- [RESOLVED] Issue 11 (MINOR -- history trigger RETURN NEW wrong for DELETE): v2 Phase 1A-7 uses `RETURN COALESCE(NEW, OLD)` and includes explicit note: "Uses RETURN COALESCE(NEW, OLD) (NOT bare RETURN NEW) to correctly handle DELETE operations where NEW is NULL."

- [RESOLVED] Issue 12 (MINOR -- `deep_copy_estimate()` uses `SET search_path = public`): v2 specifies all functions use `SET search_path = ''` with schema-qualified references. Verification script asserts `! grep -q "search_path = public"`. Fix in minor fixes list.

- [RESOLVED] Concern 1 (three different bypass variable names): v2 consolidates to single `app.is_snapshot_copy`. Covered by Fix B7.

- [RESOLVED] Concern 2 (Client VIEWs vs RLS-only approach): v2 keeps both VIEWs AND RLS. Client VIEWs are deferred to Phase 1A-5 alongside client RLS. The plan explicitly includes them in Section 4 of Phase 1A-5. This is a deliberate design choice (defense in depth), not an inconsistency.

- [RESOLVED] Concern 3 (snapshot restore missing ltree path rebuild): v2 Phase 1A-9 `restore_estimate_snapshot()` explicitly includes: "Includes ltree path rebuild step (recursive CTE, same as deep-copy)."

## Remaining Issues

None.

## New Issues Found

None.

## Final Assessment

All 1 BLOCKING and 7 MAJOR issues from iteration 1 have been resolved. The most critical fix -- unifying the trigger bypass variable to `app.is_snapshot_copy` everywhere -- is confirmed with both positive checks (variable name present in functions) and negative checks (wrong names absent). The migration dependency chain is now correct with client RLS deferred to 1A-5. All data type mismatches (enum vs VARCHAR, html vs plain, is_staff vs owner-only) are resolved. The plan and research files are now consistent on variable names, column types, CHECK constraints, RLS patterns, and function behavior. The plan is correct as written.
