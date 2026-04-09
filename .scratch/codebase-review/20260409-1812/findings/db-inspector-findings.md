# Database Inspector Findings (A8)

**Scope:** All 13 SQL migrations in `supabase/migrations/`
**Inspected:** FK ordering, RLS completeness, trigger correctness, function correctness, index strategy, seed data

---

## CRITICAL Findings

### CRIT-01: restore_estimate_snapshot() missing EXCEPTION block -- trigger bypass leak on error

**File:** `supabase/migrations/20260409000011_functions.sql:825-1231`
**Evidence:** `deep_copy_estimate()` (line 491) and `create_estimate_from_snapshot()` (line 1635) both have:
```sql
EXCEPTION
  WHEN OTHERS THEN
    RESET app.is_snapshot_copy;
    RAISE;
```
But `restore_estimate_snapshot()` (lines 825-1231) has NO `EXCEPTION` block. It only calls `RESET app.is_snapshot_copy` on the happy path (line 1227).

**Impact:** If any error occurs during restore (FK violation, null cast, disk space), the `app.is_snapshot_copy = 'true'` flag remains set for the rest of the transaction. While `SET LOCAL` scopes to the transaction and would be cleaned up when the transaction aborts, there is an important subtlety: the auto-checkpoint call at line 903 (`create_estimate_snapshot()`) runs BEFORE `SET LOCAL` at line 911. If the error occurs between lines 911-1226, the transaction rolls back entirely, including the checkpoint save. The user loses both the checkpoint AND the restore fails silently in terms of data protection. More critically, if a `SAVEPOINT` is used by any calling code (Supabase client libraries sometimes do this), the flag could leak past the savepoint rollback into the outer transaction, disabling history triggers, path maintenance, and auto-promotion for subsequent operations.

**Fix:** Add the same `EXCEPTION WHEN OTHERS THEN RESET app.is_snapshot_copy; RAISE;` block that the other two functions use.

---

### CRIT-02: Snapshot immutability bypass inconsistency creates confusion and potential vulnerability

**File:** `supabase/migrations/20260409000006_client_sharing_tables.sql:130-148` and `supabase/migrations/20260409000007_triggers.sql:264-282`

**Evidence:** Migration 006 creates `prevent_snapshot_mutation()` WITH a bypass:
```sql
IF current_setting('app.allow_snapshot_mutation', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
END IF;
```
Then migration 007 replaces the same function WITHOUT the bypass:
```sql
CREATE OR REPLACE FUNCTION public.prevent_snapshot_mutation()
...
BEGIN
  RAISE EXCEPTION 'Snapshots are immutable';
END;
```
And also changes the trigger name from `enforce_snapshot_immutability` to `trg_prevent_snapshot_mutation`.

**Impact:** The final state is correct (no bypass), but the migration 006 version with `app.allow_snapshot_mutation` bypass is dead code that could confuse developers. More importantly, migration 006's trigger name (`enforce_snapshot_immutability`) is explicitly dropped in 007, but if migration 007 fails partway, the system could be left with the bypassable version active. The `RETURN COALESCE(NEW, OLD)` pattern in the old version would allow anyone with the ability to set `app.allow_snapshot_mutation` (any SECURITY DEFINER function or service_role client) to modify or delete snapshots, defeating immutability.

**Severity:** CRITICAL for the intermediate state; the final state is correct. This is a migration ordering risk, not a production runtime risk assuming all migrations succeed.

---

## HIGH Findings

### HIGH-01: set_updated_at() trigger function lacks SECURITY DEFINER and SET search_path

**File:** `supabase/migrations/20260409000003_reference_and_core_tables.sql:20-28`

**Evidence:**
```sql
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
```
Every other trigger function in the codebase uses `SECURITY DEFINER SET search_path = ''` (maintain_node_path, auto_promote_item_parent, prevent_role_self_change, track_estimate_node_changes, etc.). This one does not.

**Impact:** This function is the most widely used trigger in the schema -- attached to 15+ tables. Without `SECURITY DEFINER SET search_path = ''`, it runs as the calling user with the session search_path. A malicious schema could shadow the `now()` function via search_path manipulation (CVE-2018-1058 class). While the practical risk is low (the function is trivial), it violates the project's own hardening standard established in migration 20260406000001.

**Fix:** Add `SECURITY DEFINER SET search_path = ''` to the function definition. Both migration 003 and 004 define it (004 is a redundant `CREATE OR REPLACE`); fix in whichever runs last.

---

### HIGH-02: estimate_nodes table missing phase_id column despite phases table existing

**File:** `supabase/migrations/20260409000003_reference_and_core_tables.sql:209-233` (estimate_nodes definition) and `supabase/migrations/20260409000004_supporting_tables.sql:30-32` (phases comment)

**Evidence:** The phases table comment says:
```sql
-- Phases do NOT affect tree hierarchy -- nodes reference a phase via
-- phase_id on the base table (estimate_nodes).
```
But `estimate_nodes` has no `phase_id` column. The phases table exists, but no table references it via FK.

**Impact:** The phases table is completely disconnected from the rest of the schema. There is no way to assign a phase to an estimate node, which was the documented intent. The table is dead weight until `phase_id UUID REFERENCES public.phases(id)` is added to `estimate_nodes`. Additionally, the `deep_copy_estimate()`, `create_estimate_snapshot()`, and `restore_estimate_snapshot()` functions don't handle phases at all -- they will need updating when `phase_id` is added.

**Fix:** Add `phase_id UUID REFERENCES public.phases(id) ON DELETE SET NULL` to estimate_nodes. Add phases to snapshot serialization/deserialization, and to deep_copy FK remapping.

---

### HIGH-03: Snapshot serialization does not capture estimate-level metadata

**File:** `supabase/migrations/20260409000011_functions.sql:557-782` (create_estimate_snapshot)

**Evidence:** The `snapshot_data` JSONB contains nodes, item_details, assembly_details, node_notes, option_groups, option_alternatives, option_memberships, option_sets, option_set_selections, broad_options, broad_option_overrides, option_set_broad_selections. But it does NOT serialize the estimate row itself (name, description, status, rates, notes, version).

**Impact:** `restore_estimate_snapshot()` only deletes and re-inserts the tree data; the estimate row (name, description, rates, notes) is untouched. This means restoring a snapshot after changing the estimate's `default_markup_rate` leaves the new rate in place, NOT the rate that existed when the snapshot was taken. For an estimating tool, this is significant -- the snapshot doesn't capture the full financial context. The `create_estimate_from_snapshot()` reads from the current estimate row (line 1337-1360), not from the snapshot, so it inherits whatever the current rates are, not the historical ones.

**Fix:** Include estimate-level fields (rates, notes, description, status) in `snapshot_data`. On restore, optionally update the estimate row from the snapshot.

---

### HIGH-04: deep_copy_estimate() does not copy estimate_shares, estimate_comments, or estimate_approvals

**File:** `supabase/migrations/20260409000011_functions.sql:100-497` (deep_copy_estimate)

**Evidence:** The function copies: estimates, estimate_nodes, node_item_details, node_assembly_details, node_notes, option_groups, option_alternatives, node_option_memberships, broad_options, broad_option_overrides, option_sets, option_set_selections, option_set_broad_selections. It does NOT copy estimate_shares, estimate_comments, or estimate_approvals.

**Impact:** This is likely intentional (you wouldn't want to copy share links or approvals to a new version), but it is undocumented. Comments are arguably useful to carry forward into new versions. If a user deep-copies an estimate expecting all history to follow, they will lose all comments. The function's docstring says "full deep-copy with FK remapping" which implies completeness.

**Severity note:** Arguably MEDIUM if the omission is intentional. HIGH because the docstring is misleading.

---

### HIGH-05: History triggers deny ALL to authenticated users, but no read path exists

**File:** `supabase/migrations/20260409000008_history_tables.sql:56-68, 113-126`

**Evidence:**
```sql
CREATE POLICY "deny_authenticated"
  ON public.estimate_nodes_history
  FOR ALL TO authenticated
  USING (false);
```
Same pattern on `node_item_details_history`.

**Impact:** The design comment says "staff access history via server actions / admin client." This means history is ONLY accessible via the service_role key (which bypasses RLS). However, if a server action needs to show history to a user and uses the user's authenticated session instead of the admin client, it will get zero rows with no error -- a silent data absence. There is no staff-readable policy path. This is secure but inflexible -- any history feature will require the admin client for every query, which cannot leverage Supabase realtime subscriptions or client-side caching.

---

## MEDIUM Findings

### MED-01: Duplicate set_updated_at() definition across migrations

**File:** `supabase/migrations/20260409000003_reference_and_core_tables.sql:20-28` and `supabase/migrations/20260409000004_supporting_tables.sql:16-24`

**Evidence:** `CREATE OR REPLACE FUNCTION public.set_updated_at()` is defined identically in both migrations. The second is marked "Idempotent: CREATE OR REPLACE so it can exist before this migration" but it serves no purpose since migration 003 always runs before 004.

**Impact:** Minor -- no functional issue, but unnecessary duplication. If one definition is changed without the other, the second silently overwrites the first.

---

### MED-02: estimate_nodes.catalog_source_id is a soft reference with no FK

**File:** `supabase/migrations/20260409000003_reference_and_core_tables.sql:221`

**Evidence:**
```sql
catalog_source_id  UUID,
```
No FK constraint to `catalog_items` or `catalog_assemblies`. The deep_copy comment (line 239) says "soft reference, copied as-is."

**Impact:** There is no referential integrity between nodes and catalog items. A catalog item can be deleted while nodes still reference it. This is arguably intentional (catalog items might be deactivated, not deleted), but it means orphaned references are possible and queries joining on catalog_source_id need LEFT JOINs to be safe.

---

### MED-03: cost_codes seed data uses ON CONFLICT with subdivision=NULL ambiguity

**File:** `supabase/migrations/20260409000009_indexes_and_seed_data.sql:138-195`

**Evidence:** The UNIQUE constraint is `(division, subdivision)`, and seed data inserts rows with `subdivision` as NULL (the column is omitted). However, in PostgreSQL, `NULL != NULL`, so the `ON CONFLICT (division, subdivision) DO NOTHING` clause will NEVER trigger for rows where subdivision is NULL. Running this migration twice would create duplicate rows.

**Impact:** The migration is not truly idempotent for the cost_codes seed data. If re-run (e.g., during development or testing), it will insert duplicate cost code entries with the same division but NULL subdivision. This can cause unexpected behavior in dropdown menus and reports.

**Fix:** Use a partial unique index that handles NULLs: `CREATE UNIQUE INDEX ON cost_codes (division) WHERE subdivision IS NULL;` Or use a sentinel value like empty string instead of NULL.

---

### MED-04: Snapshot total_price calculation only sums root nodes

**File:** `supabase/migrations/20260409000011_functions.sql:579-584`

**Evidence:**
```sql
SELECT COUNT(*), COALESCE(SUM(
  CASE WHEN n.parent_id IS NULL THEN n.total_price ELSE 0 END
), 0)
INTO v_node_count, v_total_price
FROM public.estimate_nodes n
WHERE n.estimate_id = p_estimate_id;
```

**Impact:** This sums `total_price` only for root-level nodes (parent_id IS NULL). This assumes root nodes contain rolled-up totals. If `total_price` is only stored on leaf items (as is common in estimating tools), this will be 0 for all root nodes that are groups. The snapshot's `total_price` metadata would then always be 0, making it useless for display/comparison purposes.

---

### MED-05: No index on client_project_access for project_id alone

**File:** `supabase/migrations/20260409000006_client_sharing_tables.sql:41`

**Evidence:** The only index is:
```sql
CREATE INDEX idx_cpa_client ON public.client_project_access(client_user_id, project_id);
```
But several RLS policies query by `project_id` alone (e.g., "show me all clients with access to this project"). The composite index (client_user_id, project_id) does NOT efficiently support queries filtered on project_id alone (it's the second column).

**Impact:** Staff queries to manage client access per project will require sequential scans on `client_project_access`. Low volume now but will degrade as client count grows.

**Fix:** Add `CREATE INDEX idx_cpa_project ON public.client_project_access(project_id);`

---

### MED-06: estimate_nodes search_vector generated column not captured in snapshot or deep_copy

**File:** `supabase/migrations/20260409000003_reference_and_core_tables.sql:223-227`

**Evidence:** `search_vector` is a `GENERATED ALWAYS AS (...)  STORED` column. It is correctly excluded from snapshot serialization (the column is auto-computed). However, the deep_copy INSERT (migration 011, lines 219-246) and snapshot restore INSERT (lines 974-996) both omit `search_vector`, which is correct because PostgreSQL auto-generates STORED columns on INSERT. No issue here -- noting as confirmed-correct.

---

## LOW Findings

### LOW-01: Trigger naming inconsistency

Some triggers use `set_` prefix (e.g., `set_projects_updated_at`), others use `trg_` prefix (e.g., `trg_maintain_node_path`, `trg_auto_promote_item_parent`). History triggers use yet another pattern (`track_estimate_nodes_history`). This is cosmetic but makes trigger management harder.

### LOW-02: company_settings singleton has redundant enforcement

Both a UNIQUE constraint on `singleton_key` (with CHECK) AND a trigger (`enforce_company_settings_singleton`) enforce the single-row invariant. The comment explicitly calls this "defense in depth," which is acceptable, but the trigger uses `SELECT count(*)` which is slightly less efficient than `EXISTS`.

---

## Summary

| Severity | Count | Key Themes |
|----------|-------|------------|
| CRITICAL | 2 | Missing error handler in restore function, migration ordering risk |
| HIGH | 5 | Missing search_path hardening, missing phase_id FK, incomplete snapshot/copy coverage |
| MEDIUM | 6 | Seed data idempotency, index gaps, soft references |
| LOW | 2 | Naming, redundant constraints |

**FK Ordering:** Correct. All tables are created in dependency order. Reference tables before core tables, core before supporting, supporting before client/sharing.

**RLS Completeness:** Every table has `ENABLE ROW LEVEL SECURITY` and at least one policy. Client policies are comprehensive. The deny-all pattern on history tables is intentional but limits flexibility.

**Trigger Correctness:** Bypass mechanism is consistent (`app.is_snapshot_copy`). Firing order is correct (BEFORE for path/constraint triggers, AFTER for promotion/history triggers). The snapshot immutability bypass was removed in migration 007.

**Seed Data:** Units and company settings are idempotent (ON CONFLICT works). Cost codes are NOT idempotent due to NULL subdivision in the unique constraint.
