# Deep-Copy Function Design Research

## Problem Statement

The `deep_copy_estimate()` function is the single most complex SQL function in the system. It must deep-copy 10-12 tables with full FK remapping in a single atomic transaction. Every FK remapping error creates cross-estimate data corruption that silently breaks the tree -- e.g., copied option memberships pointing to the source version's alternatives would cause option switching on one version to affect the other. The function must bypass certain triggers during copy (history logging, path maintenance, option inheritance) while preserving others (updated_at). A companion `restore_estimate_snapshot()` function needs advisory locking to prevent race conditions during restore.

## Recommended Solution

### Table Copy Dependency Order

The FK dependency chain dictates a strict copy order. Each table depends on tables copied before it.

```
COPY ORDER (must be sequential within groups; groups can be parallelized within a transaction):

  Group 1: Root entity
    1. estimates                    (depends on: projects -- NOT copied)

  Group 2: Core tree (depends on estimates)
    2. estimate_nodes               (depends on: estimates, self-ref parent_id, phases -- NOT copied)

  Group 3: Detail tables (depend on estimate_nodes)
    3. node_item_details            (depends on: estimate_nodes)
    4. node_assembly_details        (depends on: estimate_nodes)
    5. node_notes                   (depends on: estimate_nodes)
    6. node_attachments             (depends on: estimate_nodes)

  Group 4: Options layer 1 (depends on estimate_nodes)
    7. option_groups                (depends on: estimates, estimate_nodes via anchor_node_id)
    8. broad_options                (depends on: estimates)

  Group 5: Options layer 2 (depends on layer 1)
    9. option_alternatives          (depends on: option_groups)
    10. broad_option_overrides      (depends on: broad_options, project_parameters -- NOT copied)

  Group 6: Junction/membership tables (depends on both nodes and alternatives)
    11. node_option_memberships     (depends on: estimate_nodes, option_alternatives)

  Group 7: Option sets (depends on options infrastructure)
    12. option_sets                 (depends on: estimates)
    13. option_set_selections       (depends on: option_sets, option_groups, option_alternatives)
    14. option_set_broad_selections (depends on: option_sets, broad_options)
```

**Tables NOT copied** (shared reference data):
- `projects` -- the copy stays in the same project
- `phases` -- shared per project
- `cost_codes` -- global reference data
- `units_of_measure` -- global reference data
- `project_parameters` -- shared per project
- `vendors` -- global reference data
- `catalog_items` / `catalog_assemblies` -- soft references only
- All `_history` tables -- history belongs to the source version

```
DEPENDENCY DIAGRAM:

  estimates (1)
    |
    +---> estimate_nodes (2) [self-ref parent_id]
    |       |
    |       +---> node_item_details (3)
    |       +---> node_assembly_details (4)
    |       +---> node_notes (5)
    |       +---> node_attachments (6)
    |       |
    |       +---> option_groups (7) [via anchor_node_id]
    |               |
    |               +---> option_alternatives (9)
    |                       |
    |                       +---> node_option_memberships (11) [also refs estimate_nodes]
    |                       +---> option_set_selections (13) [also refs option_groups, option_sets]
    |
    +---> broad_options (8)
    |       |
    |       +---> broad_option_overrides (10)
    |       +---> option_set_broad_selections (14) [also refs option_sets]
    |
    +---> option_sets (12)
            |
            +---> option_set_selections (13)
            +---> option_set_broad_selections (14)
```

### SQL: Complete `deep_copy_estimate()` Function

```sql
-- =============================================================================
-- deep_copy_estimate()
--
-- Deep-copies an entire estimate (all nodes, details, options, memberships,
-- option sets) into a new estimate with fully remapped IDs.
--
-- Uses temp-table-based ID mapping for O(1) lookups instead of row-by-row.
-- Bypasses history triggers, path maintenance, and option inheritance triggers
-- during copy via SET LOCAL app.is_snapshot_copy.
--
-- Returns the new estimate's UUID.
-- =============================================================================

CREATE OR REPLACE FUNCTION deep_copy_estimate(
  p_source_estimate_id UUID,
  p_new_version_label  VARCHAR(255) DEFAULT NULL,
  p_created_by         UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_estimate_id    UUID;
  v_source_project_id  UUID;
  v_source_vg_id       UUID;
  v_source_version     INTEGER;
  v_new_version        INTEGER;
  v_row_count          INTEGER;
BEGIN
  -- =========================================================================
  -- 0. VALIDATE SOURCE EXISTS
  -- =========================================================================
  SELECT project_id, version_group_id, version_number
    INTO v_source_project_id, v_source_vg_id, v_source_version
    FROM estimates
   WHERE id = p_source_estimate_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source estimate % not found', p_source_estimate_id;
  END IF;

  v_new_version := v_source_version + 1;
  v_new_estimate_id := gen_random_uuid();

  -- =========================================================================
  -- 1. BYPASS TRIGGERS
  --
  -- SET LOCAL scopes to this transaction only. Triggers that check this
  -- setting will skip their logic during the copy operation.
  -- Bypassed: history triggers, path maintenance, option inheritance,
  --           auto-promotion, auto-demotion
  -- NOT bypassed: updated_at trigger (we WANT fresh timestamps)
  -- =========================================================================
  SET LOCAL app.is_snapshot_copy = 'true';

  -- =========================================================================
  -- 2. CREATE TEMP TABLES FOR ID REMAPPING
  --
  -- Each temp table maps old_id -> new_id for a single entity type.
  -- Used in subsequent INSERT...SELECT with JOINs to remap FKs.
  -- ON COMMIT DROP ensures cleanup even on error.
  -- =========================================================================
  CREATE TEMP TABLE _map_nodes (
    old_id UUID PRIMARY KEY,
    new_id UUID NOT NULL
  ) ON COMMIT DROP;

  CREATE TEMP TABLE _map_option_groups (
    old_id UUID PRIMARY KEY,
    new_id UUID NOT NULL
  ) ON COMMIT DROP;

  CREATE TEMP TABLE _map_option_alternatives (
    old_id UUID PRIMARY KEY,
    new_id UUID NOT NULL
  ) ON COMMIT DROP;

  CREATE TEMP TABLE _map_broad_options (
    old_id UUID PRIMARY KEY,
    new_id UUID NOT NULL
  ) ON COMMIT DROP;

  CREATE TEMP TABLE _map_option_sets (
    old_id UUID PRIMARY KEY,
    new_id UUID NOT NULL
  ) ON COMMIT DROP;

  -- =========================================================================
  -- 3. COPY estimates ROW (Step 1 in dependency order)
  -- =========================================================================
  INSERT INTO estimates (
    id, project_id, name, version_group_id, version_number,
    version_label, is_current, status,
    default_contingency_rate, default_overhead_rate,
    created_at, updated_at, created_by
  )
  SELECT
    v_new_estimate_id,
    project_id,
    name,
    version_group_id,
    v_new_version,
    COALESCE(p_new_version_label, 'Version ' || v_new_version),
    TRUE,              -- new version becomes current
    status,
    default_contingency_rate,
    default_overhead_rate,
    NOW(),
    NOW(),
    COALESCE(p_created_by, created_by)
  FROM estimates
  WHERE id = p_source_estimate_id;

  -- Mark old version as non-current
  UPDATE estimates
     SET is_current = FALSE,
         updated_at = NOW()
   WHERE id = p_source_estimate_id;

  -- =========================================================================
  -- 4. COPY estimate_nodes (Step 2 -- populate node mapping first)
  --
  -- Two-pass approach:
  --   Pass A: Generate mappings (old_id -> new_id) for ALL nodes
  --   Pass B: INSERT with remapped parent_id via self-join on mapping table
  --
  -- The path column is set to NULL during copy -- a post-copy rebuild
  -- is more efficient than per-row trigger maintenance.
  -- =========================================================================

  -- Pass A: Generate ID mappings
  INSERT INTO _map_nodes (old_id, new_id)
  SELECT id, gen_random_uuid()
    FROM estimate_nodes
   WHERE estimate_id = p_source_estimate_id;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count = 0 THEN
    -- Empty estimate -- valid but nothing more to copy
    RESET app.is_snapshot_copy;
    RETURN v_new_estimate_id;
  END IF;

  -- Pass B: INSERT with remapped IDs
  INSERT INTO estimate_nodes (
    id, estimate_id, parent_id, path, sort_order,
    node_type, name, description,
    phase_id, cost_code_id, client_visibility,
    subtotal, contingency_amount, overhead_amount, total_price,
    catalog_source_id, catalog_source_type, catalog_version,
    reference_name, flagged, was_auto_promoted,
    created_at, updated_at, created_by
  )
  SELECT
    mn.new_id,                              -- remapped id
    v_new_estimate_id,                      -- new estimate
    mp.new_id,                              -- remapped parent_id (NULL for roots)
    NULL,                                   -- path rebuilt post-copy
    en.sort_order,
    en.node_type,
    en.name,
    en.description,
    en.phase_id,                            -- shared reference, not remapped
    en.cost_code_id,                        -- shared reference, not remapped
    en.client_visibility,
    en.subtotal,
    en.contingency_amount,
    en.overhead_amount,
    en.total_price,
    en.catalog_source_id,                   -- soft reference, copied as-is
    en.catalog_source_type,
    en.catalog_version,
    en.reference_name,
    en.flagged,
    en.was_auto_promoted,                   -- copy as-is (see rationale below)
    NOW(),
    NOW(),
    COALESCE(p_created_by, en.created_by)
  FROM estimate_nodes en
  JOIN _map_nodes mn ON mn.old_id = en.id
  LEFT JOIN _map_nodes mp ON mp.old_id = en.parent_id
  WHERE en.estimate_id = p_source_estimate_id;

  -- =========================================================================
  -- 5. REBUILD ltree PATHS for copied nodes
  --
  -- Instead of firing the path trigger per-row during INSERT, we do a single
  -- recursive rebuild after all nodes are inserted. This is dramatically
  -- faster for large trees (O(n) vs O(n*d) where d is average depth).
  -- =========================================================================
  WITH RECURSIVE path_builder AS (
    -- Base case: root nodes (parent_id IS NULL)
    SELECT id, id::text::ltree AS computed_path
      FROM estimate_nodes
     WHERE estimate_id = v_new_estimate_id
       AND parent_id IS NULL

    UNION ALL

    -- Recursive case: children
    SELECT en.id, pb.computed_path || en.id::text
      FROM estimate_nodes en
      JOIN path_builder pb ON en.parent_id = pb.id
     WHERE en.estimate_id = v_new_estimate_id
  )
  UPDATE estimate_nodes en
     SET path = pb.computed_path
    FROM path_builder pb
   WHERE en.id = pb.id;

  -- =========================================================================
  -- 6. COPY node_item_details (Step 3)
  -- =========================================================================
  INSERT INTO node_item_details (
    node_id, qty, raw_qty, qty_mode, qty_formula,
    ratio_numerator, ratio_denominator,
    unit_id, unit_cost, cost_formula, cost_type,
    contingency_rate, overhead_rate, unit_price,
    waste_factor, min_order_qty, package_size, package_unit_id,
    bid_type, allowance_budget, allowance_status,
    vendor_id, instructions, specifications,
    archived_at
  )
  SELECT
    mn.new_id,                              -- remapped node_id
    nid.qty, nid.raw_qty, nid.qty_mode, nid.qty_formula,
    nid.ratio_numerator, nid.ratio_denominator,
    nid.unit_id,                            -- shared reference, not remapped
    nid.unit_cost, nid.cost_formula, nid.cost_type,
    nid.contingency_rate, nid.overhead_rate, nid.unit_price,
    nid.waste_factor, nid.min_order_qty, nid.package_size, nid.package_unit_id,
    nid.bid_type, nid.allowance_budget, nid.allowance_status,
    nid.vendor_id,                          -- shared reference, not remapped
    nid.instructions, nid.specifications,
    nid.archived_at                         -- preserve archive state
  FROM node_item_details nid
  JOIN _map_nodes mn ON mn.old_id = nid.node_id;

  -- =========================================================================
  -- 7. COPY node_assembly_details (Step 4)
  -- =========================================================================
  INSERT INTO node_assembly_details (
    node_id, assembly_unit_id, assembly_qty,
    derived_unit_cost, qty_formula
  )
  SELECT
    mn.new_id,                              -- remapped node_id
    nad.assembly_unit_id,                   -- shared reference, not remapped
    nad.assembly_qty,
    nad.derived_unit_cost,
    nad.qty_formula
  FROM node_assembly_details nad
  JOIN _map_nodes mn ON mn.old_id = nad.node_id;

  -- =========================================================================
  -- 8. COPY node_notes (Step 5)
  -- =========================================================================
  INSERT INTO node_notes (
    id, node_id, body, format,
    is_internal, is_client_visible,
    deleted_at, created_at, updated_at, created_by
  )
  SELECT
    gen_random_uuid(),                      -- new PK
    mn.new_id,                              -- remapped node_id
    nn.body, nn.format,
    nn.is_internal, nn.is_client_visible,
    nn.deleted_at,                          -- preserve soft-delete state
    NOW(), NOW(),
    COALESCE(p_created_by, nn.created_by)
  FROM node_notes nn
  JOIN _map_nodes mn ON mn.old_id = nn.node_id;

  -- =========================================================================
  -- 9. COPY node_attachments (Step 6)
  --
  -- NOTE: This copies the metadata rows. The actual files in Supabase Storage
  -- are NOT duplicated -- both versions reference the same storage paths.
  -- This is intentional: storage deduplication. If file isolation is needed
  -- later, add a storage copy step here.
  -- =========================================================================
  INSERT INTO node_attachments (
    id, node_id, file_name, file_path, file_size, file_type,
    attachment_type, uploaded_at, uploaded_by
  )
  SELECT
    gen_random_uuid(),
    mn.new_id,                              -- remapped node_id
    na.file_name, na.file_path, na.file_size, na.file_type,
    na.attachment_type, na.uploaded_at,
    COALESCE(p_created_by, na.uploaded_by)
  FROM node_attachments na
  JOIN _map_nodes mn ON mn.old_id = na.node_id;

  -- =========================================================================
  -- 10. COPY option_groups (Step 7 -- populate mapping)
  -- =========================================================================
  INSERT INTO _map_option_groups (old_id, new_id)
  SELECT id, gen_random_uuid()
    FROM option_groups
   WHERE estimate_id = p_source_estimate_id;

  INSERT INTO option_groups (
    id, estimate_id, anchor_node_id, name, description,
    created_at, updated_at
  )
  SELECT
    mog.new_id,                             -- remapped id
    v_new_estimate_id,                      -- new estimate
    mn.new_id,                              -- remapped anchor_node_id
    og.name, og.description,
    NOW(), NOW()
  FROM option_groups og
  JOIN _map_option_groups mog ON mog.old_id = og.id
  JOIN _map_nodes mn ON mn.old_id = og.anchor_node_id;

  -- =========================================================================
  -- 11. COPY broad_options (Step 8 -- populate mapping)
  -- =========================================================================
  INSERT INTO _map_broad_options (old_id, new_id)
  SELECT id, gen_random_uuid()
    FROM broad_options
   WHERE estimate_id = p_source_estimate_id;

  INSERT INTO broad_options (
    id, estimate_id, name, description, is_active,
    sort_order, created_at, updated_at
  )
  SELECT
    mbo.new_id,
    v_new_estimate_id,
    bo.name, bo.description, bo.is_active,
    bo.sort_order, NOW(), NOW()
  FROM broad_options bo
  JOIN _map_broad_options mbo ON mbo.old_id = bo.id;

  -- =========================================================================
  -- 12. COPY option_alternatives (Step 9 -- populate mapping)
  -- =========================================================================
  INSERT INTO _map_option_alternatives (old_id, new_id)
  SELECT oa.id, gen_random_uuid()
    FROM option_alternatives oa
    JOIN option_groups og ON oa.option_group_id = og.id
   WHERE og.estimate_id = p_source_estimate_id;

  INSERT INTO option_alternatives (
    id, option_group_id, name, description,
    is_selected, sort_order, created_at, updated_at
  )
  SELECT
    moa.new_id,                             -- remapped id
    mog.new_id,                             -- remapped option_group_id
    oa.name, oa.description,
    oa.is_selected,                         -- preserve selection state
    oa.sort_order, NOW(), NOW()
  FROM option_alternatives oa
  JOIN _map_option_alternatives moa ON moa.old_id = oa.id
  JOIN _map_option_groups mog ON mog.old_id = oa.option_group_id;

  -- =========================================================================
  -- 13. COPY broad_option_overrides (Step 10)
  -- =========================================================================
  INSERT INTO broad_option_overrides (
    id, broad_option_id, parameter_id, override_value
  )
  SELECT
    gen_random_uuid(),
    mbo.new_id,                             -- remapped broad_option_id
    boo.parameter_id,                       -- shared reference, not remapped
    boo.override_value
  FROM broad_option_overrides boo
  JOIN _map_broad_options mbo ON mbo.old_id = boo.broad_option_id;

  -- =========================================================================
  -- 14. COPY node_option_memberships (Step 11 -- CRITICAL)
  --
  -- This is the most error-prone step. BOTH node_id AND
  -- option_alternative_id must be remapped. If either is wrong, option
  -- switching on one version affects the other.
  -- =========================================================================
  INSERT INTO node_option_memberships (
    id, node_id, option_alternative_id
  )
  SELECT
    gen_random_uuid(),
    mn.new_id,                              -- remapped node_id
    moa.new_id                              -- remapped option_alternative_id
  FROM node_option_memberships nom
  JOIN _map_nodes mn ON mn.old_id = nom.node_id
  JOIN _map_option_alternatives moa ON moa.old_id = nom.option_alternative_id;

  -- =========================================================================
  -- 15. COPY option_sets (Step 12 -- populate mapping)
  -- =========================================================================
  INSERT INTO _map_option_sets (old_id, new_id)
  SELECT id, gen_random_uuid()
    FROM option_sets
   WHERE estimate_id = p_source_estimate_id;

  INSERT INTO option_sets (
    id, estimate_id, name, description,
    is_default, sort_order, created_at, updated_at
  )
  SELECT
    mos.new_id,
    v_new_estimate_id,
    os.name, os.description,
    os.is_default, os.sort_order, NOW(), NOW()
  FROM option_sets os
  JOIN _map_option_sets mos ON mos.old_id = os.id;

  -- =========================================================================
  -- 16. COPY option_set_selections (Step 13 -- triple remapping)
  -- =========================================================================
  INSERT INTO option_set_selections (
    id, option_set_id, option_group_id, selected_alternative_id
  )
  SELECT
    gen_random_uuid(),
    mos.new_id,                             -- remapped option_set_id
    mog.new_id,                             -- remapped option_group_id
    moa.new_id                              -- remapped selected_alternative_id
  FROM option_set_selections oss
  JOIN _map_option_sets mos ON mos.old_id = oss.option_set_id
  JOIN _map_option_groups mog ON mog.old_id = oss.option_group_id
  JOIN _map_option_alternatives moa ON moa.old_id = oss.selected_alternative_id;

  -- =========================================================================
  -- 17. COPY option_set_broad_selections (Step 14 -- double remapping)
  -- =========================================================================
  INSERT INTO option_set_broad_selections (
    id, option_set_id, broad_option_id, is_active
  )
  SELECT
    gen_random_uuid(),
    mos.new_id,                             -- remapped option_set_id
    mbo.new_id,                             -- remapped broad_option_id
    osbs.is_active
  FROM option_set_broad_selections osbs
  JOIN _map_option_sets mos ON mos.old_id = osbs.option_set_id
  JOIN _map_broad_options mbo ON mbo.old_id = osbs.broad_option_id;

  -- =========================================================================
  -- 18. RESET trigger bypass and return
  -- =========================================================================
  RESET app.is_snapshot_copy;

  RETURN v_new_estimate_id;

EXCEPTION
  WHEN OTHERS THEN
    -- Ensure bypass flag is cleared even on error
    RESET app.is_snapshot_copy;
    RAISE;
END;
$$;

COMMENT ON FUNCTION deep_copy_estimate IS
  'Deep-copies an entire estimate with full FK remapping across 14 tables. '
  'Uses temp-table ID mapping for set-based operations. Bypasses history/path '
  'triggers during copy via SET LOCAL app.is_snapshot_copy. Returns new estimate UUID.';
```

### Trigger Bypass Mechanism

Every trigger that should be skipped during copy must check the `app.is_snapshot_copy` session variable at the top of its function body.

```sql
-- =============================================================================
-- Pattern: Add this guard to the TOP of every bypassed trigger function
-- =============================================================================

-- Example: history trigger
CREATE OR REPLACE FUNCTION track_node_changes()
RETURNS TRIGGER AS $$
BEGIN
  -- Skip during deep copy / snapshot operations
  IF current_setting('app.is_snapshot_copy', true) = 'true' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  -- Normal history tracking logic...
  IF TG_OP = 'UPDATE' THEN
    INSERT INTO estimate_nodes_history
    SELECT gen_random_uuid(), 'update', NOW(),
           current_setting('app.current_user_id', true)::uuid, OLD.*;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO estimate_nodes_history
    SELECT gen_random_uuid(), 'delete', NOW(),
           current_setting('app.current_user_id', true)::uuid, OLD.*;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

**Triggers to bypass** (add the guard to each):

| Trigger Function | Why Bypass |
|------------------|-----------|
| `track_node_changes()` | History: copied nodes are not "changes" to the original |
| `track_item_detail_changes()` | History: same reason |
| `track_assembly_detail_changes()` | History: same reason |
| `maintain_node_path()` | Path: rebuilt in bulk post-copy (step 5), per-row triggers would be O(n*d) |
| `auto_promote_item_parent()` | Promotion: copying a tree that already has correct types |
| `auto_demote_empty_group()` | Demotion: same reason -- tree is structurally correct |
| `inherit_option_memberships()` | Options: memberships are explicitly copied in step 14 |
| `propagate_option_membership()` | Options: same reason |

**Triggers NOT bypassed:**

| Trigger Function | Why Keep Active |
|------------------|----------------|
| `update_timestamp()` | We WANT `updated_at = NOW()` on copied rows |
| `prevent_item_with_children()` | Safety net -- if copy logic has a bug, this catches it |

**Security of the bypass flag:**

`SET LOCAL` scopes the variable to the current transaction only. It cannot leak to other connections. However, the function is `SECURITY DEFINER` which means it runs as the function owner (typically the migration user), not the calling user. This prevents an attacker from calling `SET LOCAL app.is_snapshot_copy = 'true'` directly through PostgREST/Supabase client, because:

1. PostgREST runs each request in its own transaction
2. The `deep_copy_estimate()` function is called through a server action, not direct SQL
3. RLS policies prevent direct manipulation of the session variable from client code

For extra safety, add this RLS policy helper:

```sql
-- Prevent direct SET of the bypass flag from client connections
-- (This is defense-in-depth; SET LOCAL already scopes to the function's transaction)
CREATE OR REPLACE FUNCTION assert_not_snapshot_copy()
RETURNS BOOLEAN AS $$
BEGIN
  -- Returns TRUE (allows operation) if NOT in snapshot copy mode
  RETURN current_setting('app.is_snapshot_copy', true) IS DISTINCT FROM 'true';
END;
$$ LANGUAGE plpgsql STABLE;
```

### Advisory Lock Strategy for Snapshot Restore

Restoring a snapshot replaces an estimate's entire tree. This is destructive and must be serialized to prevent race conditions (two users restoring different snapshots simultaneously, or a user editing while a restore is in progress).

```sql
-- =============================================================================
-- restore_estimate_snapshot()
--
-- Restores an estimate from a snapshot. Uses advisory locks to prevent
-- concurrent restore/edit operations on the same estimate.
--
-- Strategy:
--   1. Acquire advisory lock on estimate_id (prevents concurrent restores)
--   2. Auto-save current state as a checkpoint snapshot
--   3. Delete all current nodes/options/etc for the estimate
--   4. Deserialize snapshot JSONB back into production tables
--   5. Release advisory lock
-- =============================================================================

CREATE OR REPLACE FUNCTION restore_estimate_snapshot(
  p_snapshot_id  UUID,
  p_restored_by  UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_estimate_id      UUID;
  v_snapshot_data     JSONB;
  v_schema_version   INTEGER;
  v_lock_key         BIGINT;
  v_lock_acquired    BOOLEAN;
  v_checkpoint_name  VARCHAR(255);
  v_current_version  INTEGER;
BEGIN
  -- =========================================================================
  -- 0. LOAD SNAPSHOT METADATA
  -- =========================================================================
  SELECT estimate_id, snapshot_data, schema_version
    INTO v_estimate_id, v_snapshot_data, v_schema_version
    FROM estimate_snapshots
   WHERE id = p_snapshot_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Snapshot % not found', p_snapshot_id;
  END IF;

  -- Validate schema version compatibility
  IF v_schema_version > 1 THEN
    RAISE EXCEPTION 'Snapshot schema version % is not supported by this function (max: 1)',
                    v_schema_version;
  END IF;

  -- =========================================================================
  -- 1. ACQUIRE ADVISORY LOCK
  --
  -- pg_advisory_xact_lock auto-releases at transaction end.
  -- The lock key is derived from the estimate UUID to avoid collisions.
  -- We use a transaction-level lock (not session-level) so it cannot leak.
  --
  -- Lock key derivation: hash the estimate UUID to a bigint.
  -- Using hashtext() which returns int4; cast to bigint for the lock function.
  -- Prefix with a namespace constant (42) to avoid collisions with other
  -- advisory lock users in the application.
  -- =========================================================================
  v_lock_key := ('x' || substr(v_estimate_id::text, 1, 16))::bit(64)::bigint;

  -- Try to acquire lock with timeout (non-blocking attempt)
  v_lock_acquired := pg_try_advisory_xact_lock(42, v_lock_key::int);

  IF NOT v_lock_acquired THEN
    RAISE EXCEPTION 'Cannot restore snapshot: estimate % is locked by another operation. '
                    'Please try again in a moment.',
                    v_estimate_id;
  END IF;

  -- =========================================================================
  -- 2. OPTIMISTIC LOCKING CHECK
  --
  -- Verify the estimate hasn't been modified since the restore was initiated.
  -- The caller should pass the version they last saw. For now, we just check
  -- the estimate still exists and is editable.
  -- =========================================================================
  SELECT version
    INTO v_current_version
    FROM estimates
   WHERE id = v_estimate_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estimate % no longer exists', v_estimate_id;
  END IF;

  -- =========================================================================
  -- 3. AUTO-SAVE CHECKPOINT
  --
  -- Before destroying the current state, save it as a checkpoint snapshot.
  -- This ensures the user can always recover the pre-restore state.
  -- =========================================================================
  v_checkpoint_name := 'Auto-save before restore at ' || to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS');

  PERFORM create_estimate_snapshot(
    v_estimate_id,
    v_checkpoint_name,
    COALESCE(p_restored_by, current_setting('app.current_user_id', true)::uuid)
  );

  -- =========================================================================
  -- 4. BYPASS TRIGGERS AND DELETE CURRENT DATA
  -- =========================================================================
  SET LOCAL app.is_snapshot_copy = 'true';

  -- Delete in reverse dependency order. CASCADE handles most of this,
  -- but explicit ordering prevents trigger-related issues.
  DELETE FROM node_option_memberships
   WHERE node_id IN (SELECT id FROM estimate_nodes WHERE estimate_id = v_estimate_id);

  DELETE FROM option_set_selections
   WHERE option_set_id IN (SELECT id FROM option_sets WHERE estimate_id = v_estimate_id);

  DELETE FROM option_set_broad_selections
   WHERE option_set_id IN (SELECT id FROM option_sets WHERE estimate_id = v_estimate_id);

  DELETE FROM option_sets WHERE estimate_id = v_estimate_id;

  DELETE FROM option_alternatives
   WHERE option_group_id IN (SELECT id FROM option_groups WHERE estimate_id = v_estimate_id);

  DELETE FROM broad_option_overrides
   WHERE broad_option_id IN (SELECT id FROM broad_options WHERE estimate_id = v_estimate_id);

  DELETE FROM broad_options WHERE estimate_id = v_estimate_id;
  DELETE FROM option_groups WHERE estimate_id = v_estimate_id;

  DELETE FROM node_attachments
   WHERE node_id IN (SELECT id FROM estimate_nodes WHERE estimate_id = v_estimate_id);

  DELETE FROM node_notes
   WHERE node_id IN (SELECT id FROM estimate_nodes WHERE estimate_id = v_estimate_id);

  DELETE FROM node_assembly_details
   WHERE node_id IN (SELECT id FROM estimate_nodes WHERE estimate_id = v_estimate_id);

  DELETE FROM node_item_details
   WHERE node_id IN (SELECT id FROM estimate_nodes WHERE estimate_id = v_estimate_id);

  -- Delete nodes last (parent FK constraint)
  -- Delete children before parents (reverse tree order)
  DELETE FROM estimate_nodes WHERE estimate_id = v_estimate_id;

  -- =========================================================================
  -- 5. DESERIALIZE SNAPSHOT INTO PRODUCTION TABLES
  --
  -- The snapshot_data JSONB contains the full tree serialized by
  -- create_estimate_snapshot(). Structure:
  --   {
  --     "nodes": [...],
  --     "item_details": [...],
  --     "assembly_details": [...],
  --     "notes": [...],
  --     "attachments": [...],
  --     "option_groups": [...],
  --     "option_alternatives": [...],
  --     "option_memberships": [...],
  --     "broad_options": [...],
  --     "broad_option_overrides": [...],
  --     "option_sets": [...],
  --     "option_set_selections": [...],
  --     "option_set_broad_selections": [...]
  --   }
  --
  -- IDs in the snapshot are the ORIGINAL IDs from when the snapshot was taken.
  -- We restore them as-is (the estimate_id is the same, and node IDs within
  -- an estimate are unique per estimate, so there are no collisions after
  -- the DELETE above).
  -- =========================================================================

  -- 5a. Restore nodes
  INSERT INTO estimate_nodes (
    id, estimate_id, parent_id, sort_order, node_type,
    name, description, phase_id, cost_code_id,
    client_visibility, subtotal, contingency_amount,
    overhead_amount, total_price, catalog_source_id,
    catalog_source_type, catalog_version, reference_name,
    flagged, was_auto_promoted, created_at, updated_at, created_by
  )
  SELECT
    (n->>'id')::uuid,
    v_estimate_id,
    (n->>'parent_id')::uuid,
    (n->>'sort_order')::integer,
    n->>'node_type',
    n->>'name',
    n->>'description',
    (n->>'phase_id')::uuid,
    (n->>'cost_code_id')::uuid,
    COALESCE(n->>'client_visibility', 'visible'),
    (n->>'subtotal')::decimal,
    (n->>'contingency_amount')::decimal,
    (n->>'overhead_amount')::decimal,
    (n->>'total_price')::decimal,
    (n->>'catalog_source_id')::uuid,
    n->>'catalog_source_type',
    (n->>'catalog_version')::integer,
    n->>'reference_name',
    COALESCE((n->>'flagged')::boolean, false),
    COALESCE((n->>'was_auto_promoted')::boolean, false),
    NOW(), NOW(),
    COALESCE(p_restored_by, (n->>'created_by')::uuid)
  FROM jsonb_array_elements(v_snapshot_data->'nodes') AS n;

  -- 5b. Rebuild ltree paths
  WITH RECURSIVE path_builder AS (
    SELECT id, id::text::ltree AS computed_path
      FROM estimate_nodes
     WHERE estimate_id = v_estimate_id
       AND parent_id IS NULL
    UNION ALL
    SELECT en.id, pb.computed_path || en.id::text
      FROM estimate_nodes en
      JOIN path_builder pb ON en.parent_id = pb.id
     WHERE en.estimate_id = v_estimate_id
  )
  UPDATE estimate_nodes en
     SET path = pb.computed_path
    FROM path_builder pb
   WHERE en.id = pb.id;

  -- 5c. Restore item details
  INSERT INTO node_item_details (
    node_id, qty, raw_qty, qty_mode, qty_formula,
    ratio_numerator, ratio_denominator, unit_id, unit_cost,
    cost_formula, cost_type, contingency_rate, overhead_rate,
    unit_price, waste_factor, min_order_qty, package_size,
    package_unit_id, bid_type, allowance_budget, allowance_status,
    vendor_id, instructions, specifications, archived_at
  )
  SELECT
    (d->>'node_id')::uuid,
    (d->>'qty')::decimal,
    (d->>'raw_qty')::decimal,
    COALESCE(d->>'qty_mode', 'numeric'),
    d->>'qty_formula',
    (d->>'ratio_numerator')::decimal,
    (d->>'ratio_denominator')::decimal,
    (d->>'unit_id')::uuid,
    (d->>'unit_cost')::decimal,
    d->>'cost_formula',
    d->>'cost_type',
    COALESCE((d->>'contingency_rate')::decimal, 0),
    COALESCE((d->>'overhead_rate')::decimal, 0),
    (d->>'unit_price')::decimal,
    COALESCE((d->>'waste_factor')::decimal, 0),
    (d->>'min_order_qty')::decimal,
    (d->>'package_size')::decimal,
    (d->>'package_unit_id')::uuid,
    d->>'bid_type',
    (d->>'allowance_budget')::decimal,
    d->>'allowance_status',
    (d->>'vendor_id')::uuid,
    d->>'instructions',
    d->>'specifications',
    (d->>'archived_at')::timestamptz
  FROM jsonb_array_elements(v_snapshot_data->'item_details') AS d;

  -- 5d. Restore assembly details
  INSERT INTO node_assembly_details (
    node_id, assembly_unit_id, assembly_qty,
    derived_unit_cost, qty_formula
  )
  SELECT
    (d->>'node_id')::uuid,
    (d->>'assembly_unit_id')::uuid,
    (d->>'assembly_qty')::decimal,
    (d->>'derived_unit_cost')::decimal,
    d->>'qty_formula'
  FROM jsonb_array_elements(v_snapshot_data->'assembly_details') AS d;

  -- 5e. Restore notes
  INSERT INTO node_notes (
    id, node_id, body, format,
    is_internal, is_client_visible,
    deleted_at, created_at, updated_at, created_by
  )
  SELECT
    (d->>'id')::uuid,
    (d->>'node_id')::uuid,
    d->>'body',
    COALESCE(d->>'format', 'markdown'),
    COALESCE((d->>'is_internal')::boolean, true),
    COALESCE((d->>'is_client_visible')::boolean, false),
    (d->>'deleted_at')::timestamptz,
    NOW(), NOW(),
    COALESCE(p_restored_by, (d->>'created_by')::uuid)
  FROM jsonb_array_elements(v_snapshot_data->'notes') AS d;

  -- 5f. Restore attachments
  INSERT INTO node_attachments (
    id, node_id, file_name, file_path, file_size, file_type,
    attachment_type, uploaded_at, uploaded_by
  )
  SELECT
    (d->>'id')::uuid,
    (d->>'node_id')::uuid,
    d->>'file_name',
    d->>'file_path',
    (d->>'file_size')::integer,
    d->>'file_type',
    d->>'attachment_type',
    COALESCE((d->>'uploaded_at')::timestamptz, NOW()),
    COALESCE(p_restored_by, (d->>'uploaded_by')::uuid)
  FROM jsonb_array_elements(v_snapshot_data->'attachments') AS d;

  -- 5g. Restore option groups
  INSERT INTO option_groups (
    id, estimate_id, anchor_node_id, name, description,
    created_at, updated_at
  )
  SELECT
    (d->>'id')::uuid,
    v_estimate_id,
    (d->>'anchor_node_id')::uuid,
    d->>'name',
    d->>'description',
    NOW(), NOW()
  FROM jsonb_array_elements(v_snapshot_data->'option_groups') AS d;

  -- 5h. Restore broad options
  INSERT INTO broad_options (
    id, estimate_id, name, description, is_active,
    sort_order, created_at, updated_at
  )
  SELECT
    (d->>'id')::uuid,
    v_estimate_id,
    d->>'name',
    d->>'description',
    COALESCE((d->>'is_active')::boolean, false),
    COALESCE((d->>'sort_order')::integer, 0),
    NOW(), NOW()
  FROM jsonb_array_elements(v_snapshot_data->'broad_options') AS d;

  -- 5i. Restore option alternatives
  INSERT INTO option_alternatives (
    id, option_group_id, name, description,
    is_selected, sort_order, created_at, updated_at
  )
  SELECT
    (d->>'id')::uuid,
    (d->>'option_group_id')::uuid,
    d->>'name',
    d->>'description',
    COALESCE((d->>'is_selected')::boolean, false),
    COALESCE((d->>'sort_order')::integer, 0),
    NOW(), NOW()
  FROM jsonb_array_elements(v_snapshot_data->'option_alternatives') AS d;

  -- 5j. Restore broad option overrides
  INSERT INTO broad_option_overrides (
    id, broad_option_id, parameter_id, override_value
  )
  SELECT
    (d->>'id')::uuid,
    (d->>'broad_option_id')::uuid,
    (d->>'parameter_id')::uuid,
    (d->>'override_value')::decimal
  FROM jsonb_array_elements(v_snapshot_data->'broad_option_overrides') AS d;

  -- 5k. Restore option memberships
  INSERT INTO node_option_memberships (
    id, node_id, option_alternative_id
  )
  SELECT
    (d->>'id')::uuid,
    (d->>'node_id')::uuid,
    (d->>'option_alternative_id')::uuid
  FROM jsonb_array_elements(v_snapshot_data->'option_memberships') AS d;

  -- 5l. Restore option sets
  INSERT INTO option_sets (
    id, estimate_id, name, description,
    is_default, sort_order, created_at, updated_at
  )
  SELECT
    (d->>'id')::uuid,
    v_estimate_id,
    d->>'name',
    d->>'description',
    COALESCE((d->>'is_default')::boolean, false),
    COALESCE((d->>'sort_order')::integer, 0),
    NOW(), NOW()
  FROM jsonb_array_elements(v_snapshot_data->'option_sets') AS d;

  -- 5m. Restore option set selections
  INSERT INTO option_set_selections (
    id, option_set_id, option_group_id, selected_alternative_id
  )
  SELECT
    (d->>'id')::uuid,
    (d->>'option_set_id')::uuid,
    (d->>'option_group_id')::uuid,
    (d->>'selected_alternative_id')::uuid
  FROM jsonb_array_elements(v_snapshot_data->'option_set_selections') AS d;

  -- 5n. Restore option set broad selections
  INSERT INTO option_set_broad_selections (
    id, option_set_id, broad_option_id, is_active
  )
  SELECT
    (d->>'id')::uuid,
    (d->>'option_set_id')::uuid,
    (d->>'broad_option_id')::uuid,
    COALESCE((d->>'is_active')::boolean, false)
  FROM jsonb_array_elements(v_snapshot_data->'option_set_broad_selections') AS d;

  -- =========================================================================
  -- 6. INCREMENT ESTIMATE VERSION AND RESET BYPASS
  -- =========================================================================
  UPDATE estimates
     SET version = version + 1,
         updated_at = NOW()
   WHERE id = v_estimate_id;

  RESET app.is_snapshot_copy;

  RETURN v_estimate_id;

EXCEPTION
  WHEN OTHERS THEN
    RESET app.is_snapshot_copy;
    RAISE;
END;
$$;

COMMENT ON FUNCTION restore_estimate_snapshot IS
  'Restores an estimate from a JSONB snapshot. Auto-saves current state first. '
  'Uses advisory lock to prevent concurrent restores. Bypasses history triggers '
  'during restore via SET LOCAL app.is_snapshot_copy.';
```

### `create_estimate_snapshot()` Function

```sql
-- =============================================================================
-- create_estimate_snapshot()
--
-- Serializes the full estimate tree into a JSONB snapshot stored in
-- estimate_snapshots. This is the read-side companion to
-- restore_estimate_snapshot().
-- =============================================================================

CREATE OR REPLACE FUNCTION create_estimate_snapshot(
  p_estimate_id  UUID,
  p_name         VARCHAR(255),
  p_created_by   UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot_id       UUID := gen_random_uuid();
  v_snapshot_data     JSONB;
  v_node_count        INTEGER;
  v_total_price       DECIMAL(15,4);
  v_estimate_status   VARCHAR(50);
  v_project_status    VARCHAR(50);
BEGIN
  -- Validate estimate exists
  SELECT e.status, p.status
    INTO v_estimate_status, v_project_status
    FROM estimates e
    JOIN projects p ON e.project_id = p.id
   WHERE e.id = p_estimate_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estimate % not found', p_estimate_id;
  END IF;

  -- Get summary stats
  SELECT COUNT(*),
         COALESCE(SUM(total_price) FILTER (WHERE parent_id IS NULL), 0)
    INTO v_node_count, v_total_price
    FROM estimate_nodes
   WHERE estimate_id = p_estimate_id;

  -- Build the JSONB snapshot
  SELECT jsonb_build_object(
    'nodes', COALESCE((
      SELECT jsonb_agg(to_jsonb(en) - 'path')
        FROM estimate_nodes en
       WHERE en.estimate_id = p_estimate_id
    ), '[]'::jsonb),

    'item_details', COALESCE((
      SELECT jsonb_agg(to_jsonb(nid))
        FROM node_item_details nid
        JOIN estimate_nodes en ON nid.node_id = en.id
       WHERE en.estimate_id = p_estimate_id
    ), '[]'::jsonb),

    'assembly_details', COALESCE((
      SELECT jsonb_agg(to_jsonb(nad))
        FROM node_assembly_details nad
        JOIN estimate_nodes en ON nad.node_id = en.id
       WHERE en.estimate_id = p_estimate_id
    ), '[]'::jsonb),

    'notes', COALESCE((
      SELECT jsonb_agg(to_jsonb(nn))
        FROM node_notes nn
        JOIN estimate_nodes en ON nn.node_id = en.id
       WHERE en.estimate_id = p_estimate_id
    ), '[]'::jsonb),

    'attachments', COALESCE((
      SELECT jsonb_agg(to_jsonb(na))
        FROM node_attachments na
        JOIN estimate_nodes en ON na.node_id = en.id
       WHERE en.estimate_id = p_estimate_id
    ), '[]'::jsonb),

    'option_groups', COALESCE((
      SELECT jsonb_agg(to_jsonb(og))
        FROM option_groups og
       WHERE og.estimate_id = p_estimate_id
    ), '[]'::jsonb),

    'option_alternatives', COALESCE((
      SELECT jsonb_agg(to_jsonb(oa))
        FROM option_alternatives oa
        JOIN option_groups og ON oa.option_group_id = og.id
       WHERE og.estimate_id = p_estimate_id
    ), '[]'::jsonb),

    'option_memberships', COALESCE((
      SELECT jsonb_agg(to_jsonb(nom))
        FROM node_option_memberships nom
        JOIN estimate_nodes en ON nom.node_id = en.id
       WHERE en.estimate_id = p_estimate_id
    ), '[]'::jsonb),

    'broad_options', COALESCE((
      SELECT jsonb_agg(to_jsonb(bo))
        FROM broad_options bo
       WHERE bo.estimate_id = p_estimate_id
    ), '[]'::jsonb),

    'broad_option_overrides', COALESCE((
      SELECT jsonb_agg(to_jsonb(boo))
        FROM broad_option_overrides boo
        JOIN broad_options bo ON boo.broad_option_id = bo.id
       WHERE bo.estimate_id = p_estimate_id
    ), '[]'::jsonb),

    'option_sets', COALESCE((
      SELECT jsonb_agg(to_jsonb(os))
        FROM option_sets os
       WHERE os.estimate_id = p_estimate_id
    ), '[]'::jsonb),

    'option_set_selections', COALESCE((
      SELECT jsonb_agg(to_jsonb(oss))
        FROM option_set_selections oss
        JOIN option_sets os ON oss.option_set_id = os.id
       WHERE os.estimate_id = p_estimate_id
    ), '[]'::jsonb),

    'option_set_broad_selections', COALESCE((
      SELECT jsonb_agg(to_jsonb(osbs))
        FROM option_set_broad_selections osbs
        JOIN option_sets os ON osbs.option_set_id = os.id
       WHERE os.estimate_id = p_estimate_id
    ), '[]'::jsonb)
  ) INTO v_snapshot_data;

  -- Insert the snapshot
  INSERT INTO estimate_snapshots (
    id, estimate_id, name, snapshot_type,
    estimate_status_at_time, project_status_at_time,
    snapshot_data, node_count, total_price,
    schema_version, created_at, created_by
  )
  VALUES (
    v_snapshot_id, p_estimate_id, p_name, 'milestone',
    v_estimate_status, v_project_status,
    v_snapshot_data, v_node_count, v_total_price,
    1,  -- schema_version
    NOW(), p_created_by
  );

  RETURN v_snapshot_id;
END;
$$;

COMMENT ON FUNCTION create_estimate_snapshot IS
  'Serializes an estimate tree into JSONB and stores it as an immutable snapshot. '
  'Captures all nodes, details, notes, attachments, options, and sets.';
```

### TypeScript Type Definitions

```typescript
// File: src/lib/types/deep-copy.ts

/**
 * Result from deep_copy_estimate() RPC call
 */
export interface DeepCopyResult {
  newEstimateId: string;
  sourceEstimateId: string;
  versionNumber: number;
}

/**
 * Parameters for the deep copy server action
 */
export interface DeepCopyParams {
  sourceEstimateId: string;
  versionLabel?: string;
}

/**
 * Parameters for snapshot creation
 */
export interface CreateSnapshotParams {
  estimateId: string;
  name: string;
}

/**
 * Parameters for snapshot restore
 */
export interface RestoreSnapshotParams {
  snapshotId: string;
}

/**
 * Snapshot metadata (returned from list/get, does NOT include snapshot_data)
 */
export interface SnapshotMeta {
  id: string;
  estimateId: string;
  name: string;
  snapshotType: 'milestone' | 'checkpoint';
  estimateStatusAtTime: string;
  projectStatusAtTime: string;
  nodeCount: number;
  totalPrice: number;
  schemaVersion: number;
  createdAt: string;
  createdBy: string;
}
```

```typescript
// File: src/lib/actions/estimate-versions.ts

'use server';

import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from '@/lib/types/actions';
import type {
  DeepCopyParams,
  DeepCopyResult,
  CreateSnapshotParams,
  RestoreSnapshotParams,
  SnapshotMeta,
} from '@/lib/types/deep-copy';

export async function deepCopyEstimate(
  params: DeepCopyParams
): Promise<ActionResult<DeepCopyResult>> {
  const supabase = await createClient();

  const { data: user } = await supabase.auth.getUser();
  if (!user.user) {
    return { success: false, error: 'Not authenticated' };
  }

  const { data, error } = await supabase.rpc('deep_copy_estimate', {
    p_source_estimate_id: params.sourceEstimateId,
    p_new_version_label: params.versionLabel ?? null,
    p_created_by: user.user.id,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return {
    success: true,
    data: {
      newEstimateId: data,
      sourceEstimateId: params.sourceEstimateId,
      versionNumber: 0, // caller should refresh
    },
  };
}

export async function createSnapshot(
  params: CreateSnapshotParams
): Promise<ActionResult<{ snapshotId: string }>> {
  const supabase = await createClient();

  const { data: user } = await supabase.auth.getUser();
  if (!user.user) {
    return { success: false, error: 'Not authenticated' };
  }

  const { data, error } = await supabase.rpc('create_estimate_snapshot', {
    p_estimate_id: params.estimateId,
    p_name: params.name,
    p_created_by: user.user.id,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data: { snapshotId: data } };
}

export async function restoreSnapshot(
  params: RestoreSnapshotParams
): Promise<ActionResult<{ estimateId: string }>> {
  const supabase = await createClient();

  const { data: user } = await supabase.auth.getUser();
  if (!user.user) {
    return { success: false, error: 'Not authenticated' };
  }

  const { data, error } = await supabase.rpc('restore_estimate_snapshot', {
    p_snapshot_id: params.snapshotId,
    p_restored_by: user.user.id,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data: { estimateId: data } };
}
```

### File Paths

| Artifact | Path |
|----------|------|
| `deep_copy_estimate()` function | `supabase/migrations/XXXXXXXX_functions.sql` (Migration 10) |
| `create_estimate_snapshot()` function | Same migration file |
| `restore_estimate_snapshot()` function | Same migration file |
| Trigger bypass guards | `supabase/migrations/XXXXXXXX_triggers.sql` (Migration 6) |
| TypeScript types | `src/lib/types/deep-copy.ts` |
| Server actions | `src/lib/actions/estimate-versions.ts` |
| Database tests | `tests/database/deep-copy.test.ts` |

## Trade-offs Considered

### 1. Monolithic vs Composed Sub-Functions

**Chosen: Monolithic.** The entire `deep_copy_estimate()` is one function.

| Approach | Pros | Cons |
|----------|------|------|
| Monolithic | Single transaction context, no inter-function communication overhead, temp tables scoped naturally, easier to audit | Long function (~300 lines), harder to test individual steps |
| Composed sub-functions | Each step testable independently, clearer naming | Temp tables must be CREATE'd before calling subs (or passed as params), transaction management across functions adds complexity, SET LOCAL scoping gets tricky |

**Rationale:** The function's steps are inherently sequential and tightly coupled via temp tables. Extracting `_copy_nodes()`, `_copy_options()` etc. would require either (a) the caller to create all temp tables and pass them, or (b) nested function calls that share the same transaction context. Option (a) leaks implementation details. Option (b) works but adds function-call overhead with no real maintainability benefit -- the steps are simple INSERT...SELECT statements, not complex logic.

The function IS long, but each step is a clearly commented block with a single INSERT...SELECT. Reading top-to-bottom is straightforward. Testing is done end-to-end (see Test Cases below).

### 2. `was_auto_promoted`: Copy as-is vs Reset

**Chosen: Copy as-is.**

The `was_auto_promoted` flag records whether a node was auto-promoted from item to group. In a deep copy (version creation), the copied tree should be an exact replica of the source. Resetting this flag would lose the information about which groups were originally items -- information that the auto-demotion trigger relies on to know whether a group can be auto-demoted. If we reset `was_auto_promoted = FALSE` on the copy, then removing all children from a formerly-auto-promoted group in the copy would NOT trigger auto-demotion, creating inconsistent behavior between versions.

### 3. Snapshot Storage: Deep-Copy vs JSONB Serialization

**Chosen: JSONB serialization for snapshots, deep-copy for versions.** These are distinct operations:

- **Versions** (`deep_copy_estimate()`): Create a new, fully independent, editable estimate. Data lives in production tables with full FK integrity, indexing, and query support. Used for: "Version 2 of this estimate."
- **Snapshots** (`create_estimate_snapshot()`): Create a read-only checkpoint. Data lives as a JSONB blob. Used for: "What did this estimate look like on March 15th?"

The two functions share the same source data but serve different purposes. Both are needed.

### 4. node_notes Impact on Copy Chain

`node_notes` adds one additional step to the copy chain (Step 8 in the function). It depends only on `estimate_nodes` (via `node_id` FK), so it fits cleanly into Group 3 alongside `node_item_details` and `node_assembly_details`. No additional mapping table is needed -- notes have their own UUID PK and only reference `node_id`, which is already in `_map_nodes`.

The `deleted_at` field (soft-delete) is preserved during copy. A soft-deleted note in the source remains soft-deleted in the copy. This is correct -- the copy should be an exact replica.

### 5. Advisory Lock Key Derivation

The lock key uses a two-argument form of `pg_advisory_xact_lock(42, key)` where `42` is a namespace constant. This prevents collisions with other parts of the application that might use advisory locks. The estimate UUID is converted to a bigint via bit manipulation for use as the lock key.

Alternative considered: Using `hashtext(estimate_id::text)` for the key. Rejected because `hashtext` returns int4 and has non-negligible collision probability for UUIDs. The bit-extraction approach is deterministic and collision-free within the UUID space.

## Effort Estimate

| Component | Effort |
|-----------|--------|
| `deep_copy_estimate()` function | 2-3 hours |
| `create_estimate_snapshot()` function | 1-2 hours |
| `restore_estimate_snapshot()` function | 2-3 hours |
| Trigger bypass guards (modify 8 triggers) | 1 hour |
| TypeScript types and server actions | 1 hour |
| Test suite (15+ tests) | 3-4 hours |
| **Total** | **10-14 hours (1.5-2 sessions)** |

## Dependencies

These must exist before `deep_copy_estimate()` can be implemented:

1. **All 14 tables in the copy chain** must be created (Migrations 1-5)
2. **All triggers** must be created WITH the bypass guard (Migration 6)
3. **`estimate_snapshots` table** must exist (Migration 5)
4. **`ltree` extension** must be enabled (Migration 1)
5. **`node_notes` table** must be created with the schema from the comprehensive analysis

## Test Cases

### FK Remapping Correctness Tests

```
Test 1: Basic copy -- node count matches
  Given: estimate with 10 nodes (3 groups, 2 assemblies, 5 items)
  When: deep_copy_estimate() is called
  Then: new estimate has exactly 10 nodes
  And: no node in new estimate references old estimate_id

Test 2: Parent-child relationships preserved
  Given: estimate with tree depth 4 (root -> group -> assembly -> item)
  When: deep_copy_estimate() is called
  Then: tree structure is identical (parent_id references are internal to new estimate)
  And: no parent_id in new estimate points to a node in old estimate

Test 3: Item details remapped correctly
  Given: estimate with 5 items, each with node_item_details
  When: deep_copy_estimate() is called
  Then: new estimate has 5 node_item_details rows
  And: each node_id in new details maps to a node in new estimate
  And: all numeric values (qty, unit_cost, rates) are identical to source

Test 4: Assembly details remapped correctly
  Given: estimate with 2 assemblies, each with node_assembly_details
  When: deep_copy_estimate() is called
  Then: new estimate has 2 node_assembly_details rows
  And: assembly_qty and assembly_unit_id preserved

Test 5: Option group anchor_node_id remapped
  Given: estimate with option group anchored to node A
  When: deep_copy_estimate() is called
  Then: new option group's anchor_node_id points to copy of node A, not original

Test 6: Option alternative selection state preserved
  Given: estimate with option group, alternative "Premium" selected
  When: deep_copy_estimate() is called
  Then: in new estimate, "Premium" is still selected

Test 7: CRITICAL -- Option memberships fully remapped
  Given: estimate with 3 nodes in option alternative "Standard"
  When: deep_copy_estimate() is called
  Then: new memberships reference new node IDs AND new alternative IDs
  And: switching option on new estimate does NOT affect old estimate
  And: switching option on old estimate does NOT affect new estimate

Test 8: Option set selections triple-remapped
  Given: estimate with option set containing 2 group selections
  When: deep_copy_estimate() is called
  Then: new set's selections reference new group IDs, new alternative IDs, new set ID
  And: no FK in new option_set_selections points to old estimate's entities

Test 9: Broad options and overrides remapped
  Given: estimate with 2 broad options, each with 3 overrides
  When: deep_copy_estimate() is called
  Then: new broad options exist with new IDs
  And: overrides reference new broad_option_ids
  And: parameter_id references are preserved (shared reference data)

Test 10: node_notes copied with remapped node_id
  Given: estimate with 5 notes (2 soft-deleted)
  When: deep_copy_estimate() is called
  Then: new estimate has 5 notes with new IDs
  And: soft-deleted notes remain soft-deleted
  And: note content identical to source
```

### Trigger Bypass Tests

```
Test 11: History tables NOT populated during copy
  Given: empty history tables
  When: deep_copy_estimate() is called on a 50-node estimate
  Then: history tables have 0 new rows
  And: after copy, normal edits DO create history rows

Test 12: ltree paths correctly rebuilt post-copy
  Given: estimate with tree depth 5
  When: deep_copy_estimate() is called
  Then: every node in new estimate has a non-NULL path
  And: root nodes have single-segment paths (just their ID)
  And: child paths correctly extend parent paths
  And: path depth matches tree depth for every node

Test 13: Auto-promotion trigger does NOT fire during copy
  Given: estimate with a group that has item children (normal valid state)
  When: deep_copy_estimate() is called
  Then: group node copied as group (not re-promoted)
  And: item details are NOT archived again
```

### Version Management Tests

```
Test 14: Source estimate becomes non-current after copy
  Given: estimate with is_current = TRUE
  When: deep_copy_estimate() is called
  Then: source estimate has is_current = FALSE
  And: new estimate has is_current = TRUE

Test 15: Version number increments correctly
  Given: estimate with version_number = 3
  When: deep_copy_estimate() is called
  Then: new estimate has version_number = 4
  And: same version_group_id as source
```

### Snapshot Tests

```
Test 16: Snapshot round-trip preserves all data
  Given: estimate with nodes, details, options, sets, notes
  When: create_estimate_snapshot() then restore_estimate_snapshot()
  Then: all node counts match
  And: all option states match
  And: all calculated values match
  And: no data loss in round-trip

Test 17: Restore auto-saves checkpoint first
  Given: estimate with 10 nodes, 0 existing snapshots
  When: restore_estimate_snapshot() is called
  Then: 2 snapshots exist (the original + the auto-checkpoint)
  And: auto-checkpoint contains the pre-restore state

Test 18: Advisory lock prevents concurrent restore
  Given: Two concurrent sessions attempting restore on same estimate
  When: Both call restore_estimate_snapshot() simultaneously
  Then: One succeeds, one fails with "estimate is locked" error
  And: The successful restore completes correctly

Test 19: Empty estimate copy produces valid empty estimate
  Given: estimate with 0 nodes
  When: deep_copy_estimate() is called
  Then: new estimate exists with 0 nodes
  And: function returns successfully (no errors from empty JOINs)

Test 20: Archived item details preserved in copy
  Given: estimate with auto-promoted group (has archived node_item_details)
  When: deep_copy_estimate() is called
  Then: copied node_item_details has archived_at set
  And: was_auto_promoted flag is TRUE on the copied node
```
