# Correctness Review -- Iteration 1

## Verdict: REVISE

---

## Strengths (what the plan gets right)

1. **Deep-copy FK remapping is correct.** The temp-table-based ID mapping pattern in `deep_copy_estimate()` correctly handles all 5 entity types that need remapping (nodes, option_groups, option_alternatives, broad_options, option_sets). The triple-remapping on `option_set_selections` (set + group + alternative) is the hardest step and is done correctly via JOINs on all three mapping tables.

2. **RLS policy matrix is well-structured.** The `get_user_role()` -> `is_staff()` -> per-table policy chain is clean. Using pure SQL for `get_user_role()` so it can be inlined by the planner is the right call. The `client_has_project_access()` helper avoids duplicating the subquery across 10+ policies.

3. **Snapshot JSONB schema is comprehensive.** All 14 table categories are serialized. The inclusion of `project_parameters` (frozen values at snapshot time) is a detail that many designs miss -- formulas depend on parameter values, so omitting them would make snapshots non-restorable.

4. **CREATE TYPE enum decision is well-justified.** The analysis correctly identifies that Supabase codegen produces proper union types for CREATE TYPE enums but `string` for CHECK constraints, which is a significant type-safety difference at the TypeScript boundary.

5. **Ltree path rebuild strategy in deep-copy is correct.** Inserting all nodes with `path = NULL` then doing a single recursive CTE rebuild is O(n) vs O(n*d) for per-row trigger maintenance. The recursive CTE correctly handles root nodes (base case) and joins children to parents.

---

## Issues Found

### Issue 1: Trigger bypass variable name mismatch between `restore_estimate_snapshot()` and trigger guard checks

- **Severity:** BLOCKING
- **Location in plan:** Phase 1A-6 (Triggers) vs Phase 1A-9 (Functions), and snapshot-architecture-research.md
- **Problem:** The `restore_estimate_snapshot()` function in `snapshot-architecture-research.md` (line 700) sets `SET LOCAL app.is_snapshot_restore = 'true'` and later calls `RESET app.is_snapshot_restore`. However, the implementation plan (Phase 1A-6, line 583) and the deep-copy research define ALL trigger bypass guards as checking `app.is_snapshot_copy`, not `app.is_snapshot_restore`. The restore function uses a different variable name than what the triggers check. This means **every trigger bypass will FAIL during snapshot restore** -- triggers will fire during the bulk delete/insert, causing spurious history entries, incorrect path recalculations, and potentially corrupted auto-promotion/demotion state.
- **Fix:** Unify on a single variable name. The plan already states (Phase 1A-6, line 588) that "The bypass is set via `SET LOCAL app.is_snapshot_copy = 'true'` inside `deep_copy_estimate()` and `restore_estimate_snapshot()`." Change the restore function to use `app.is_snapshot_copy` (matching the triggers), or equivalently change both the restore function and all triggers to use a shared name. The simplest fix: in `restore_estimate_snapshot()`, replace `SET LOCAL app.is_snapshot_restore = 'true'` with `SET LOCAL app.is_snapshot_copy = 'true'` and replace `RESET app.is_snapshot_restore` with `RESET app.is_snapshot_copy`.

### Issue 2: `estimate_status_at_time` uses VARCHAR(50) instead of the `estimate_status` enum type

- **Severity:** MAJOR
- **Location in plan:** Phase 1A-5 (Client/Sharing Tables), snapshot-architecture-research.md line 119
- **Problem:** The `estimate_snapshots` table defines `estimate_status_at_time VARCHAR(50) NOT NULL` and `project_status_at_time VARCHAR(50)`. However, the plan explicitly creates `estimate_status` and `project_status` as `CREATE TYPE` enums in Phase 1A-1, and the estimates/projects tables use those enum types for their `status` columns. The snapshot table should use the same enum types for these status-at-time columns. Using VARCHAR(50) here means:
  - Invalid status values can be stored (no type checking).
  - The `create_estimate_snapshot()` function reads `e.status` (which is type `estimate_status`) into a `VARCHAR(50)` variable, which works via implicit cast but loses type safety.
  - Supabase codegen will produce `string` for these columns instead of the proper union type.
- **Fix:** Change the column definitions to:
  ```sql
  estimate_status_at_time public.estimate_status NOT NULL,
  project_status_at_time  public.project_status,
  ```
  And update the `create_estimate_snapshot()` function's variable declarations from `v_estimate_status VARCHAR(50)` to `v_estimate_status public.estimate_status` (and similarly for project_status).

### Issue 3: `node_notes.format` CHECK constraint inconsistency between plan and research files

- **Severity:** MAJOR
- **Location in plan:** Phase 1A-2 (Core Tables, line 260) vs comprehensive-analysis.md (line 186) vs type-system-research.md (line 279) vs snapshot-architecture-research.md (line 1096)
- **Problem:** The implementation plan (line 260) specifies `format VARCHAR(20) CHECK ('markdown','plain')`. However:
  - The comprehensive analysis (line 186) says `format ('markdown'/'html')`.
  - The type-system-research.md (line 279) defines the TypeScript type as `format: 'markdown' | 'html'`.
  - The snapshot-architecture-research.md JSONB schema (line 1096) documents `format: "markdown | html"`.
  - The snapshot serialization function (line 858) stores the `format` value from `node_notes`.
  - The snapshot restore (line 858) defaults to `COALESCE(v_note->>'format', 'markdown')`.

  The plan says `plain`, but all research files say `html`. If the plan's CHECK constraint wins, snapshot restore of data serialized with the research file's schema will reject notes with `format = 'html'`, and the TypeScript types will be wrong.
- **Fix:** Resolve the conflict by choosing one set of values. Given that the comprehensive analysis and all three research files agree on `('markdown', 'html')`, and the plan is the outlier, change the plan's CHECK constraint to `CHECK (format IN ('markdown', 'html'))`. Update the plan line 260 accordingly.

### Issue 4: `node_notes` constraint `NOT (is_internal = TRUE AND is_client_visible = TRUE)` is logically inverted

- **Severity:** MAJOR
- **Location in plan:** Phase 1A-2 (Core Tables, line 264)
- **Problem:** The plan states: "Constraint: `NOT (is_internal = TRUE AND is_client_visible = TRUE)`". This means a note cannot be BOTH internal AND client-visible, which makes business sense (an internal note should not be visible to clients). However, the constraint as written allows:
  - `is_internal = TRUE, is_client_visible = FALSE` (internal only -- correct)
  - `is_internal = FALSE, is_client_visible = TRUE` (client-visible -- correct)
  - `is_internal = FALSE, is_client_visible = FALSE` (neither internal nor client-visible -- what is this? A note visible to no one?)
  
  The constraint does NOT enforce that at least one of the two flags is true. A note that is neither internal nor client-visible is effectively invisible -- it exists in the database but no one can see it through either the staff or client pathway. This is likely a logic gap rather than an intentional state.
- **Fix:** Either:
  - (a) Add a second constraint: `CHECK (is_internal OR is_client_visible)` -- every note must be visible to at least one audience.
  - (b) Or, if the intent is that notes default to internal unless explicitly shared, remove `is_client_visible` entirely and just use `is_internal BOOLEAN NOT NULL DEFAULT TRUE` where `is_internal = FALSE` means "client-visible." The current two-boolean model creates 4 states but only 2-3 are valid.
  - Recommendation: Keep the two booleans (they allow a note to be visible to both staff AND clients when `is_internal = FALSE AND is_client_visible = TRUE`). Add the constraint `CHECK (is_internal OR is_client_visible)` to prevent the invisible-to-everyone state.

### Issue 5: `option_groups` RLS policy inconsistency between plan and research files

- **Severity:** MAJOR
- **Location in plan:** Phase 1A-4 (line ~410) vs options-system-research.md (line 139-148) vs rls-authorization-research.md
- **Problem:** The implementation plan (Phase 1A-4) says option_groups RLS is "via estimate ownership chain" but provides no SQL. The options-system-research.md (line 139-148) provides this RLS policy:
  ```sql
  USING (EXISTS (
    SELECT 1 FROM public.estimates e
    JOIN public.projects p ON e.project_id = p.id
    WHERE e.id = option_groups.estimate_id
    AND p.user_id = (SELECT auth.uid())
  ))
  ```
  This policy checks `p.user_id = auth.uid()`, meaning only the project OWNER can manage option groups. Employees cannot. This contradicts the pattern established in the rls-authorization-research.md where ALL staff (owner + employee) get full CRUD via `is_staff()`. The options research file uses a completely different authorization model than the rest of the system.
- **Fix:** The option_groups (and option_alternatives, node_option_memberships, option_sets, option_set_selections, option_set_broad_selections) RLS policies should follow the established pattern:
  ```sql
  CREATE POLICY "staff_all_option_groups"
    ON public.option_groups FOR ALL
    USING (public.is_staff())
    WITH CHECK (public.is_staff());
  ```
  Add client read policies where appropriate (clients should be able to read option groups on their accessible estimates for the option set comparison feature). The owner-only policy from the options research is wrong.

### Issue 6: Snapshot immutability trigger has conflicting implementations

- **Severity:** MAJOR
- **Location in plan:** Phase 1A-5 (lines 490-495, snapshot-architecture-research.md lines 166-195) vs rls-authorization-research.md (lines 489-509)
- **Problem:** Two different implementations of `prevent_snapshot_mutation()` exist:
  - **snapshot-architecture-research.md (lines 166-195):** A detailed trigger that checks each column individually to allow ONLY `restored_at` and `restored_by` to be updated, but blocks all other field changes and all deletes.
  - **rls-authorization-research.md (lines 489-509):** A simpler trigger that blocks ALL updates and deletes unless `current_setting('app.allow_snapshot_mutation', true) = 'true'` is set.
  
  These are incompatible approaches. The first allows partial updates (restore tracking) but blocks data mutation. The second blocks everything unless a session variable is set. The restore function needs to UPDATE `restored_at` and `restored_by` after restoring -- the first approach handles this, but the second approach would block it unless the restore function also sets `app.allow_snapshot_mutation`.
  
  Additionally, the second approach introduces a THIRD session variable (`app.allow_snapshot_mutation`) beyond the already-confused `app.is_snapshot_copy` / `app.is_snapshot_restore` situation (Issue 1).
- **Fix:** Use the snapshot-architecture-research.md version (column-by-column check). It is more precise and does not require yet another bypass variable. The trigger allows updating only the restore-tracking columns, which is exactly what the restore function needs. Delete the alternative implementation from rls-authorization-research.md.

### Issue 7: `deep_copy_estimate()` references `node_attachments` table that is not created in any migration

- **Severity:** MAJOR
- **Location in plan:** Phase 1A-9 (Functions), deep-copy-function-research.md (lines 371-382)
- **Problem:** The `deep_copy_estimate()` function includes step 9: "COPY node_attachments" which copies `id, node_id, file_name, file_path, file_size, file_type, attachment_type, uploaded_at, uploaded_by` from a `node_attachments` table. However:
  - The implementation plan does not create a `node_attachments` table in ANY phase (1A-0 through 1A-8).
  - The comprehensive analysis does not list `node_attachments` in the "New Tables (Phase 1A)" section.
  - The snapshot serialization function does NOT serialize attachments.
  - The snapshot restore function does NOT restore attachments.
  
  The deep-copy function will fail with `relation "node_attachments" does not exist` when executed.
- **Fix:** Either:
  - (a) Remove the `node_attachments` copy step from `deep_copy_estimate()` since the table does not exist. Add a comment: "-- TODO: Add node_attachments copy when table is created."
  - (b) Add a `node_attachments` CREATE TABLE to Phase 1A-2 or 1A-3 if file attachments are needed in Phase 1A. If so, also add it to the snapshot serialization and restore functions.
  - Recommendation: (a) -- remove it. Attachments are not mentioned in any of the 5 user decisions and the table is not designed anywhere. It appears to be a forward-looking addition in the deep-copy research that was not coordinated with the table creation plan.

### Issue 8: `create_estimate_snapshot()` is granted to `authenticated` but the plan says INSERT should be service_role only

- **Severity:** MAJOR
- **Location in plan:** Phase 1A-5 (lines 491, 493) vs snapshot-architecture-research.md (lines 571-572)
- **Problem:** The snapshot RLS policy in the plan (Phase 1A-5) states: "Only service_role / server actions can insert (no direct client inserts)." The snapshot-architecture-research.md (line 157-160) creates a policy:
  ```sql
  CREATE POLICY "Service role can insert snapshots"
    ON public.estimate_snapshots FOR INSERT
    TO service_role WITH CHECK (true);
  ```
  But then the `create_estimate_snapshot()` function is granted to `authenticated`:
  ```sql
  GRANT EXECUTE ON FUNCTION public.create_estimate_snapshot TO authenticated;
  ```
  Since `create_estimate_snapshot()` is `SECURITY DEFINER`, it runs as the function owner (typically `postgres`), which bypasses RLS entirely. So the function CAN insert despite the RLS policy. However, the rls-authorization-research.md (lines 464-468) provides a DIFFERENT RLS policy:
  ```sql
  CREATE POLICY "staff_create_snapshots"
    ON public.estimate_snapshots FOR INSERT
    WITH CHECK (public.is_staff());
  ```
  This allows staff to insert via regular `INSERT` statements, not just via the function.
  
  The design intent is unclear: should snapshots be insertable only through the `create_estimate_snapshot()` function (which bypasses RLS via SECURITY DEFINER), or should staff be allowed to INSERT directly into the table?
- **Fix:** Clarify the intent and pick one approach:
  - If snapshots should ONLY be created via the function (stronger immutability guarantee): use the `service_role` INSERT policy from the snapshot research. The function's SECURITY DEFINER will bypass RLS. Regular clients cannot insert directly.
  - If staff should also be able to insert directly: use the `is_staff()` INSERT policy. But this weakens immutability -- direct inserts bypass the summary metadata calculation.
  - Recommendation: Use the function-only approach. Snapshots require computed fields (`node_count`, `total_price`) that must be calculated at insert time. Direct inserts could have incorrect metadata. The INSERT RLS policy should be `TO service_role` only.

### Issue 9: `client_project_access` table is created in Phase 1A-5 but referenced by RLS policies in Phase 1A-2

- **Severity:** MAJOR
- **Location in plan:** Phase 1A-2 (Core Tables) vs Phase 1A-5 (Client/Sharing Tables, line 478)
- **Problem:** The RLS policies for `estimates` (Phase 1A-2, line 233) and `estimate_nodes` (Phase 1A-2, line 245) use `public.client_has_project_access(project_id)`, which queries the `client_project_access` table. The `client_has_project_access()` helper function is created in Phase 1A-0 (Security Foundation). However, the `client_project_access` TABLE is not created until Phase 1A-5 (Client/Sharing Tables, line 478).
  
  When migration `20260409000003_core_tables.sql` (Phase 1A-2) runs, the `client_has_project_access()` function will reference a table that does not yet exist. While the function itself is created in Phase 1A-0 and might succeed (since it is a `STABLE` SQL function that is only evaluated at query time, not at definition time), the RLS policies that use it WILL fail at policy evaluation time for any client user who attempts to access the table before Phase 1A-5 runs.
  
  This is not a runtime crash in practice (no client users exist yet during development migrations), but it is a structural FK-ordering error that creates a dependency violation in the migration sequence.
- **Fix:** Move `client_project_access` CREATE TABLE from Phase 1A-5 to Phase 1A-0 (Security Foundation) or Phase 1A-2 (Core Tables), BEFORE any RLS policy that references it. Alternatively, move the `client_has_project_access()` function and the `client_project_access` table together to Phase 1A-2. The function and its backing table should be co-located in the same migration or in earlier migrations than any policy that uses them.

### Issue 10: Snapshot serialization omits `was_auto_promoted` field from nodes

- **Severity:** MINOR
- **Location in plan:** Phase 1A-9 (Functions), snapshot-architecture-research.md (lines 288-311)
- **Problem:** The `create_estimate_snapshot()` function serializes node fields into JSONB (lines 288-311 of snapshot research). The node serialization includes `flagged` but omits `was_auto_promoted`. However, the `estimate_nodes` table (Phase 1A-2, line 241) includes `was_auto_promoted BOOLEAN NOT NULL DEFAULT FALSE`, and the deep-copy function (deep-copy-research.md, line 264) explicitly copies `was_auto_promoted`.
  
  If a snapshot is restored, all nodes will have `was_auto_promoted = FALSE` (the column default) regardless of their original state. This means the auto-demotion trigger (`auto_demote_from_assembly`) will not correctly demote auto-promoted assemblies after restore, because the flag that indicates they were auto-promoted has been lost.
- **Fix:** Add `'was_auto_promoted', n.was_auto_promoted` to the node serialization in `create_estimate_snapshot()`. Add the corresponding field to the restore function's INSERT statement for nodes.

### Issue 11: History trigger's `RETURN NEW` is wrong for DELETE operations

- **Severity:** MINOR
- **Location in plan:** Phase 1A-7 (History Tables, line 654), deep-copy-function-research.md (line 584)
- **Problem:** The history trigger function `log_node_history()` shown in the plan (line 654) returns `COALESCE(NEW, OLD)`, which works. But the deep-copy research's example trigger `track_node_changes()` (line 584) returns `RETURN NEW` at the end of the function body, even for DELETE operations. In a DELETE trigger, `NEW` is NULL. Returning NULL from a BEFORE trigger cancels the operation. Returning NULL from an AFTER trigger is ignored, but the function is not specified as BEFORE or AFTER.
  
  The plan's Phase 1A-7 version (`RETURN COALESCE(NEW, OLD)`) handles this correctly. But the deep-copy research version at line 584 has `RETURN NEW` after both UPDATE and DELETE branches. If this trigger is a BEFORE trigger and a DELETE occurs, the final `RETURN NEW` returns NULL, which would CANCEL the delete.
- **Fix:** Ensure the history trigger uses `RETURN COALESCE(NEW, OLD)` (as the plan already shows), not bare `RETURN NEW`. Alternatively, make it an AFTER trigger (where the return value is ignored). The plan's version is correct; flag the deep-copy research version as having a bug that should not be copied.

### Issue 12: `deep_copy_estimate()` uses `SET search_path = public` instead of `SET search_path = ''`

- **Severity:** MINOR
- **Location in plan:** Phase 1A-9 (Functions), deep-copy-function-research.md (line 109)
- **Problem:** The `deep_copy_estimate()` function is declared with `SET search_path = public` (line 109 of deep-copy research). Every other SECURITY DEFINER function in the plan uses `SET search_path = ''` (the empty string), which is the security best practice to prevent search_path injection (CVE-2018-1058). With `SET search_path = public`, a malicious user could create objects in the public schema that shadow system functions.
  
  However, changing to `SET search_path = ''` means all table references inside the function must be schema-qualified (`public.estimates` instead of `estimates`). The deep-copy function currently uses unqualified table names throughout (e.g., `FROM estimates WHERE id = ...`).
- **Fix:** Either:
  - (a) Change to `SET search_path = ''` and schema-qualify all table references inside the function. This is the security-correct approach.
  - (b) Keep `SET search_path = public` but document the deviation. This is acceptable since the function is SECURITY DEFINER and can only be called via server actions, not directly from PostgREST.
  - Recommendation: (a) for consistency with every other function in the system.

---

## Cross-Cutting Concerns

### Concern 1: Three different bypass variable names across the codebase

The research files and plan use three different session variable names for trigger bypass:
- `app.is_snapshot_copy` -- used by deep_copy_estimate() and trigger guards
- `app.is_snapshot_restore` -- used by restore_estimate_snapshot()
- `app.allow_snapshot_mutation` -- used by snapshot immutability trigger (RLS research version)

This MUST be consolidated to a single variable. Recommendation: use `app.is_snapshot_copy` everywhere, since it is the most established name (used in the plan, deep-copy research, and all trigger guards).

### Concern 2: Client VIEWs (Phase 1A-2) vs RLS-only approach (RLS research)

The implementation plan (Phase 1A-2, lines 268-274) creates PostgreSQL VIEWs for client access (`client_estimate_nodes`, `client_node_item_details`, `client_node_assembly_details`). But the rls-authorization-research.md (Section 5, lines 554-560) explicitly argues AGAINST views: "A PostgreSQL VIEW for client access would: duplicate column definitions, require maintenance when schema changes, not work well with Supabase auto-generated types, add complexity to PostgREST routing."

The plan includes both VIEWs AND RLS policies AND a TypeScript filter function. This triple-layering creates maintenance burden. The research recommends RLS + TypeScript filter only. The plan should resolve this -- either include the VIEWs (from client-visibility-research.md) or exclude them (from rls-authorization-research.md), not both.

### Concern 3: Snapshot restore path deserialization is missing

The `restore_estimate_snapshot()` function (snapshot-architecture-research.md, lines 750-792) inserts nodes WITHOUT the `path` column (it is not in the INSERT column list), but also does not include a post-restore ltree path rebuild step like the deep-copy function does (deep-copy-research.md, lines 280-298). The `path` column will be NULL for all restored nodes. The restore function needs a recursive CTE path rebuild step identical to the one in `deep_copy_estimate()`, run after all nodes are inserted and parent_ids are set.

---

## Final Assessment

The plan is architecturally sound and demonstrates deep understanding of the domain. The deep-copy FK remapping, RLS policy matrix, and snapshot JSONB design are all well-crafted. However, there are 2 BLOCKING and 7 MAJOR issues that must be resolved before implementation.

The most critical fix is Issue 1 (trigger bypass variable name mismatch) -- without this, snapshot restore will corrupt data by firing triggers during bulk operations. Issue 9 (FK ordering of client_project_access) is also blocking because it creates a migration dependency violation.

The 7 MAJOR issues are individually straightforward to fix but collectively indicate that the plan and research files were not fully cross-checked for consistency. A reconciliation pass is needed to ensure the plan, snapshot research, deep-copy research, RLS research, options research, and type-system research all agree on variable names, column types, CHECK constraint values, and RLS policy patterns.

**Estimated effort to fix:** 1-2 hours of focused reconciliation, no architectural changes needed.
