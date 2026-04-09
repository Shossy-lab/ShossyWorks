# Snapshot Architecture and Lifecycle Research

## Problem Statement

Snapshots are the single most complex new feature in the system. They must serialize an entire estimate tree (10-12 tables with FK relationships) into a single immutable JSONB document, support forward/backward compatibility via `schema_version`, and provide safe restore operations with advisory locking. The snapshot system is DISTINCT from the version system (deep-copy via `version_group_id`): versions are living, editable estimate copies; snapshots are frozen-in-time records that can never be modified. Getting the storage model, serialization schema, and restore workflow wrong creates data integrity risks that compound across every other feature.

## Recommended Solution

### Research Question Answers

**Q1: What is the exact JSONB schema for snapshot serialization? Which tables/fields are included?**

The snapshot JSONB must capture the complete estimate tree and all associated data needed to fully reconstruct the estimate at restore time. This means every table that hangs off `estimates` via FK chains:

| Table | Included? | Why |
|-------|-----------|-----|
| `estimates` (metadata only) | YES | Status, rates, version info at snapshot time |
| `estimate_nodes` | YES | The full tree structure |
| `node_item_details` | YES | Item-specific data (costs, quantities, formulas) |
| `node_assembly_details` | YES | Assembly-specific data |
| `node_notes` | YES | All notes (internal + client-visible) |
| `option_groups` | YES | Option structure |
| `option_alternatives` | YES | Which alternatives exist |
| `node_option_memberships` | YES | Which nodes belong to which alternatives |
| `option_sets` | YES | Saved scenarios |
| `option_set_selections` | YES | Inline selections per scenario |
| `option_set_broad_selections` | YES | Broad option states per scenario |
| `broad_options` | YES | Estimate-level parameter overrides |
| `broad_option_overrides` | YES | Parameter override values |
| `phases` | NO | Project-level, not estimate-level. Referenced by FK but not owned. |
| `cost_codes` | NO | System-level lookup. Referenced but not owned. |
| `units_of_measure` | NO | System-level lookup. Referenced but not owned. |
| `vendors` | NO | Independent entity. Referenced by `vendor_id` FK but not owned. |
| `catalog_items/assemblies` | NO | Source reference only via soft FK (`catalog_source_id`). |
| `project_parameters` | YES (copy) | Formulas depend on parameter values. Snapshot must freeze the parameter values at the time of snapshot. |

**Q2: How does `schema_version` handle forward/backward compatibility?**

`schema_version` is an integer that increments whenever the JSONB structure changes (columns added/removed/renamed from any serialized table). The restore function checks `schema_version` and applies transformations:

- **Backward compatibility (restoring an older snapshot into a newer schema):** The restore function has a migration chain. Each version increment has a corresponding transform function. Example: if v2 added `flagged BOOLEAN` to nodes, restoring a v1 snapshot applies `node.flagged = false` as a default.
- **Forward compatibility (restoring a newer snapshot into an older schema):** NOT supported. The restore function rejects snapshots with `schema_version > CURRENT_SCHEMA_VERSION`. This is the correct design -- forward compatibility requires predicting future changes, which is impossible.
- **Migration chain pattern:** Each version bump registers a `migrate_vN_to_vN+1(data JSONB) RETURNS JSONB` function. The restore function applies them sequentially: v1->v2->v3->...->current.

This is a well-understood pattern (similar to Django migrations, Prisma migrate, etc.) adapted for JSONB.

**Q3: Should snapshots be typed as 'milestone' vs 'checkpoint'?**

YES. Two distinct types serve different purposes:

| Type | Triggered By | UI Behavior | Retention |
|------|-------------|-------------|-----------|
| `milestone` | User manually creates ("Save Snapshot") | Named, appears in snapshot list, browsable | Permanent -- never auto-deleted |
| `checkpoint` | Auto-created by system before destructive operations (restore, version create) | Auto-named with timestamp, appears in history but not primary list | Can be auto-pruned (keep last N per estimate, e.g., 20) |

The `snapshot_type` column on `estimate_snapshots` distinguishes them. UI shows milestones prominently; checkpoints are in a collapsible "Auto-saves" section. This prevents the snapshot list from growing unbounded while ensuring no data is ever lost by a restore operation.

**Q4: What guards should exist for "Restore from Snapshot"?**

Guards depend on estimate status:

| Estimate Status | Restore Behavior | Rationale |
|-----------------|-----------------|-----------|
| `draft` | Allowed freely | No downstream consequences |
| `preliminary` | Allowed with confirmation dialog | Low risk, but worth confirming |
| `active` | Blocked unless user explicitly overrides ("I understand this replaces the active estimate") | Active estimates may have been shared or referenced |
| `complete` | Blocked -- must create new estimate from snapshot instead | Complete estimates are contract prices; overwriting destroys audit trail |

Implementation: The `restore_estimate_snapshot()` function accepts a `force BOOLEAN DEFAULT FALSE` parameter. For `active` status, the server action requires `force = true` (only sent after the confirmation dialog). For `complete`, the function raises an exception regardless of `force`.

**Q5: Should "Create Estimate from Snapshot" be distinct from "Restore"?**

YES, absolutely. These are different operations with different semantics:

| Operation | What It Does | Result |
|-----------|-------------|--------|
| **Restore** | Overwrites the current estimate's tree with snapshot data | Same `estimate_id`, current data replaced |
| **Create from Snapshot** | Creates a NEW estimate seeded with snapshot data | New `estimate_id`, new `version_number`, original untouched |

"Create from Snapshot" is implemented as: (1) create new estimate row with incremented version_number in the same version_group, (2) deserialize snapshot JSONB into the new estimate's tables. This is the safe operation for `active`/`complete` estimates.

**Q6: How does the JSONB approach interact with the version system?**

The version system (deep-copy via `version_group_id`) and the snapshot system serve complementary purposes:

| Aspect | Version System | Snapshot System |
|--------|---------------|-----------------|
| Storage | Full deep-copy into production tables | JSONB blob in `estimate_snapshots` |
| Queryable | YES -- each version is a full estimate you can query, filter, sort | NO -- opaque blob until deserialized |
| Editable | YES -- each version can be independently edited | NO -- snapshots are immutable |
| Use case | "Create Version 2 for Value Engineering" | "Save a checkpoint before I make risky changes" |
| Cost | Expensive (duplicates 10+ tables worth of rows) | Cheap (single JSONB column) |
| FK integrity | Full FK constraints | None -- data is serialized |

Both are needed. Versions are the "working copies" pattern. Snapshots are the "undo/backup" pattern. A user might create Version 2, make 50 edits with 3 milestone snapshots along the way, then create Version 3. The snapshots capture intermediate states within a version's lifecycle that the version system doesn't track.

---

### SQL

#### `estimate_snapshots` CREATE TABLE

```sql
-- ============================================================
-- estimate_snapshots: Immutable JSONB snapshots of estimate trees
-- ============================================================

CREATE TABLE public.estimate_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id     UUID NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  name            VARCHAR(255) NOT NULL,
  description     TEXT,
  
  -- Snapshot classification
  snapshot_type   VARCHAR(20) NOT NULL DEFAULT 'milestone'
    CONSTRAINT valid_snapshot_type CHECK (snapshot_type IN ('milestone', 'checkpoint')),
  
  -- Context at time of snapshot
  estimate_status_at_time VARCHAR(50) NOT NULL,
  project_status_at_time  VARCHAR(50),
  version_number_at_time  INTEGER,
  
  -- The serialized estimate tree (all tables)
  snapshot_data   JSONB NOT NULL,
  schema_version  INTEGER NOT NULL DEFAULT 1,
  
  -- Summary metadata (queryable without deserializing JSONB)
  node_count      INTEGER NOT NULL DEFAULT 0,
  total_price     DECIMAL(15,4) NOT NULL DEFAULT 0,
  
  -- Audit
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  -- Restore tracking
  restored_at     TIMESTAMPTZ,
  restored_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Indexes
CREATE INDEX idx_snapshots_estimate 
  ON public.estimate_snapshots(estimate_id, created_at DESC);

CREATE INDEX idx_snapshots_type 
  ON public.estimate_snapshots(estimate_id, snapshot_type) 
  WHERE snapshot_type = 'milestone';

-- RLS
ALTER TABLE public.estimate_snapshots ENABLE ROW LEVEL SECURITY;

-- Owner/employee can read all snapshots
CREATE POLICY "Authenticated users can read snapshots"
  ON public.estimate_snapshots FOR SELECT
  TO authenticated
  USING (true);

-- Only service_role / server actions can insert (no direct client inserts)
CREATE POLICY "Service role can insert snapshots"
  ON public.estimate_snapshots FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Immutability enforcement: no updates or deletes allowed
-- (except restored_at/restored_by which are set by the restore function)
CREATE OR REPLACE FUNCTION prevent_snapshot_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Snapshots are immutable and cannot be deleted';
  END IF;
  
  IF TG_OP = 'UPDATE' THEN
    -- Allow ONLY setting restored_at/restored_by (for tracking restore usage)
    IF NEW.snapshot_data IS DISTINCT FROM OLD.snapshot_data
       OR NEW.name IS DISTINCT FROM OLD.name
       OR NEW.description IS DISTINCT FROM OLD.description
       OR NEW.snapshot_type IS DISTINCT FROM OLD.snapshot_type
       OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
       OR NEW.node_count IS DISTINCT FROM OLD.node_count
       OR NEW.total_price IS DISTINCT FROM OLD.total_price
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
    THEN
      RAISE EXCEPTION 'Snapshots are immutable. Only restored_at and restored_by can be updated.';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_snapshot_mutation
  BEFORE UPDATE OR DELETE ON public.estimate_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION prevent_snapshot_mutation();
```

#### `create_estimate_snapshot()` Function

```sql
-- ============================================================
-- create_estimate_snapshot(): Serialize full estimate tree to JSONB
-- ============================================================
-- 
-- Current schema_version: 1
-- JSONB structure documented inline below.
--
-- This function reads ALL tables associated with an estimate and
-- serializes them into a single JSONB document. No FK remapping
-- is needed because we store original UUIDs -- they are only
-- meaningful within the snapshot context.
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_estimate_snapshot(
  p_estimate_id UUID,
  p_name VARCHAR(255),
  p_description TEXT DEFAULT NULL,
  p_snapshot_type VARCHAR(20) DEFAULT 'milestone',
  p_created_by UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_snapshot_id UUID;
  v_snapshot_data JSONB;
  v_estimate_status VARCHAR(50);
  v_project_status VARCHAR(50);
  v_version_number INTEGER;
  v_node_count INTEGER;
  v_total_price DECIMAL(15,4);
  v_estimate_metadata JSONB;
  v_nodes JSONB;
  v_item_details JSONB;
  v_assembly_details JSONB;
  v_node_notes JSONB;
  v_option_groups JSONB;
  v_option_alternatives JSONB;
  v_option_memberships JSONB;
  v_option_sets JSONB;
  v_option_set_selections JSONB;
  v_broad_options JSONB;
  v_broad_option_overrides JSONB;
  v_option_set_broad_selections JSONB;
  v_project_parameters JSONB;
BEGIN
  -- Validate estimate exists
  SELECT 
    e.status,
    e.version_number,
    p.status
  INTO v_estimate_status, v_version_number, v_project_status
  FROM public.estimates e
  LEFT JOIN public.projects p ON p.id = e.project_id
  WHERE e.id = p_estimate_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estimate % not found', p_estimate_id;
  END IF;

  -- Validate snapshot_type
  IF p_snapshot_type NOT IN ('milestone', 'checkpoint') THEN
    RAISE EXCEPTION 'Invalid snapshot_type: %. Must be milestone or checkpoint.', p_snapshot_type;
  END IF;

  -- ── Serialize estimate metadata ──────────────────────────────
  SELECT jsonb_build_object(
    'id', e.id,
    'project_id', e.project_id,
    'name', e.name,
    'version_group_id', e.version_group_id,
    'version_number', e.version_number,
    'version_label', e.version_label,
    'is_current', e.is_current,
    'status', e.status,
    'default_contingency_rate', e.default_contingency_rate,
    'default_overhead_rate', e.default_overhead_rate,
    'created_at', e.created_at,
    'created_by', e.created_by
  )
  INTO v_estimate_metadata
  FROM public.estimates e
  WHERE e.id = p_estimate_id;

  -- ── Serialize all nodes ──────────────────────────────────────
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', n.id,
      'parent_id', n.parent_id,
      'path', n.path::text,
      'sort_order', n.sort_order,
      'node_type', n.node_type,
      'name', n.name,
      'description', n.description,
      'phase_id', n.phase_id,
      'cost_code_id', n.cost_code_id,
      'client_visibility', n.client_visibility,
      'subtotal', n.subtotal,
      'contingency_amount', n.contingency_amount,
      'overhead_amount', n.overhead_amount,
      'total_price', n.total_price,
      'catalog_source_id', n.catalog_source_id,
      'catalog_source_type', n.catalog_source_type,
      'catalog_version', n.catalog_version,
      'reference_name', n.reference_name,
      'flagged', n.flagged,
      'created_at', n.created_at,
      'created_by', n.created_by
    ) ORDER BY n.sort_order
  ), '[]'::jsonb)
  INTO v_nodes
  FROM public.estimate_nodes n
  WHERE n.estimate_id = p_estimate_id;

  -- Capture summary stats
  SELECT COUNT(*), COALESCE(SUM(
    CASE WHEN n.parent_id IS NULL THEN n.total_price ELSE 0 END
  ), 0)
  INTO v_node_count, v_total_price
  FROM public.estimate_nodes n
  WHERE n.estimate_id = p_estimate_id;

  -- ── Serialize item details ───────────────────────────────────
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'node_id', d.node_id,
      'qty', d.qty,
      'raw_qty', d.raw_qty,
      'qty_mode', d.qty_mode,
      'qty_formula', d.qty_formula,
      'ratio_numerator', d.ratio_numerator,
      'ratio_denominator', d.ratio_denominator,
      'unit_id', d.unit_id,
      'unit_cost', d.unit_cost,
      'cost_formula', d.cost_formula,
      'cost_type', d.cost_type,
      'contingency_rate', d.contingency_rate,
      'overhead_rate', d.overhead_rate,
      'unit_price', d.unit_price,
      'waste_factor', d.waste_factor,
      'min_order_qty', d.min_order_qty,
      'package_size', d.package_size,
      'package_unit_id', d.package_unit_id,
      'bid_type', d.bid_type,
      'allowance_budget', d.allowance_budget,
      'allowance_status', d.allowance_status,
      'vendor_id', d.vendor_id,
      'instructions', d.instructions,
      'specifications', d.specifications
    )
  ), '[]'::jsonb)
  INTO v_item_details
  FROM public.node_item_details d
  JOIN public.estimate_nodes n ON n.id = d.node_id
  WHERE n.estimate_id = p_estimate_id;

  -- ── Serialize assembly details ───────────────────────────────
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'node_id', d.node_id,
      'assembly_unit_id', d.assembly_unit_id,
      'assembly_qty', d.assembly_qty,
      'derived_unit_cost', d.derived_unit_cost,
      'qty_formula', d.qty_formula
    )
  ), '[]'::jsonb)
  INTO v_assembly_details
  FROM public.node_assembly_details d
  JOIN public.estimate_nodes n ON n.id = d.node_id
  WHERE n.estimate_id = p_estimate_id;

  -- ── Serialize node notes ─────────────────────────────────────
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', nn.id,
      'node_id', nn.node_id,
      'body', nn.body,
      'format', nn.format,
      'is_internal', nn.is_internal,
      'is_client_visible', nn.is_client_visible,
      'created_by', nn.created_by,
      'created_at', nn.created_at
    )
  ), '[]'::jsonb)
  INTO v_node_notes
  FROM public.node_notes nn
  JOIN public.estimate_nodes n ON n.id = nn.node_id
  WHERE n.estimate_id = p_estimate_id
    AND nn.deleted_at IS NULL;

  -- ── Serialize option groups ──────────────────────────────────
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', og.id,
      'anchor_node_id', og.anchor_node_id,
      'name', og.name,
      'description', og.description,
      'created_at', og.created_at
    )
  ), '[]'::jsonb)
  INTO v_option_groups
  FROM public.option_groups og
  WHERE og.estimate_id = p_estimate_id;

  -- ── Serialize option alternatives ────────────────────────────
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', oa.id,
      'option_group_id', oa.option_group_id,
      'name', oa.name,
      'description', oa.description,
      'is_selected', oa.is_selected,
      'sort_order', oa.sort_order
    )
  ), '[]'::jsonb)
  INTO v_option_alternatives
  FROM public.option_alternatives oa
  JOIN public.option_groups og ON og.id = oa.option_group_id
  WHERE og.estimate_id = p_estimate_id;

  -- ── Serialize option memberships ─────────────────────────────
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', nom.id,
      'node_id', nom.node_id,
      'option_alternative_id', nom.option_alternative_id
    )
  ), '[]'::jsonb)
  INTO v_option_memberships
  FROM public.node_option_memberships nom
  JOIN public.estimate_nodes n ON n.id = nom.node_id
  WHERE n.estimate_id = p_estimate_id;

  -- ── Serialize option sets ────────────────────────────────────
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', os.id,
      'name', os.name,
      'description', os.description,
      'is_default', os.is_default,
      'sort_order', os.sort_order
    )
  ), '[]'::jsonb)
  INTO v_option_sets
  FROM public.option_sets os
  WHERE os.estimate_id = p_estimate_id;

  -- ── Serialize option set selections ──────────────────────────
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', oss.id,
      'option_set_id', oss.option_set_id,
      'option_group_id', oss.option_group_id,
      'selected_alternative_id', oss.selected_alternative_id
    )
  ), '[]'::jsonb)
  INTO v_option_set_selections
  FROM public.option_set_selections oss
  JOIN public.option_sets os ON os.id = oss.option_set_id
  WHERE os.estimate_id = p_estimate_id;

  -- ── Serialize broad options ──────────────────────────────────
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', bo.id,
      'name', bo.name,
      'description', bo.description,
      'is_active', bo.is_active,
      'sort_order', bo.sort_order
    )
  ), '[]'::jsonb)
  INTO v_broad_options
  FROM public.broad_options bo
  WHERE bo.estimate_id = p_estimate_id;

  -- ── Serialize broad option overrides ─────────────────────────
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', boo.id,
      'broad_option_id', boo.broad_option_id,
      'parameter_id', boo.parameter_id,
      'override_value', boo.override_value
    )
  ), '[]'::jsonb)
  INTO v_broad_option_overrides
  FROM public.broad_option_overrides boo
  JOIN public.broad_options bo ON bo.id = boo.broad_option_id
  WHERE bo.estimate_id = p_estimate_id;

  -- ── Serialize option set broad selections ────────────────────
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', osbs.id,
      'option_set_id', osbs.option_set_id,
      'broad_option_id', osbs.broad_option_id,
      'is_active', osbs.is_active
    )
  ), '[]'::jsonb)
  INTO v_option_set_broad_selections
  FROM public.option_set_broad_selections osbs
  JOIN public.option_sets os ON os.id = osbs.option_set_id
  WHERE os.estimate_id = p_estimate_id;

  -- ── Serialize project parameters (frozen values) ─────────────
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', pp.id,
      'name', pp.name,
      'display_name', pp.display_name,
      'value', pp.value,
      'unit_id', pp.unit_id,
      'description', pp.description
    )
  ), '[]'::jsonb)
  INTO v_project_parameters
  FROM public.project_parameters pp
  JOIN public.estimates e ON e.project_id = pp.project_id
  WHERE e.id = p_estimate_id;

  -- ── Assemble full snapshot JSONB ─────────────────────────────
  v_snapshot_data := jsonb_build_object(
    'schema_version', 1,
    'serialized_at', NOW(),
    'estimate', v_estimate_metadata,
    'nodes', v_nodes,
    'item_details', v_item_details,
    'assembly_details', v_assembly_details,
    'node_notes', v_node_notes,
    'option_groups', v_option_groups,
    'option_alternatives', v_option_alternatives,
    'option_memberships', v_option_memberships,
    'option_sets', v_option_sets,
    'option_set_selections', v_option_set_selections,
    'broad_options', v_broad_options,
    'broad_option_overrides', v_broad_option_overrides,
    'option_set_broad_selections', v_option_set_broad_selections,
    'project_parameters', v_project_parameters
  );

  -- ── Insert the snapshot ──────────────────────────────────────
  INSERT INTO public.estimate_snapshots (
    id, estimate_id, name, description, snapshot_type,
    estimate_status_at_time, project_status_at_time, version_number_at_time,
    snapshot_data, schema_version, node_count, total_price,
    created_at, created_by
  ) VALUES (
    gen_random_uuid(),
    p_estimate_id,
    p_name,
    p_description,
    p_snapshot_type,
    v_estimate_status,
    v_project_status,
    v_version_number,
    v_snapshot_data,
    1,  -- CURRENT_SCHEMA_VERSION
    v_node_count,
    v_total_price,
    NOW(),
    p_created_by
  )
  RETURNING id INTO v_snapshot_id;

  RETURN v_snapshot_id;
END;
$$;

-- Grant execute to authenticated users (they call this via server actions)
GRANT EXECUTE ON FUNCTION public.create_estimate_snapshot TO authenticated;
```

#### `restore_estimate_snapshot()` Function

```sql
-- ============================================================
-- restore_estimate_snapshot(): Auto-save current state, then 
-- deserialize snapshot into the estimate's tables.
--
-- Uses pg_advisory_xact_lock to prevent concurrent restores.
-- Auto-creates a checkpoint snapshot of current state before restoring.
-- Bypasses history triggers during bulk operations.
-- ============================================================

-- Current schema version constant (update when JSONB schema changes)
-- In practice, maintain this as a simple function for easy reference:
CREATE OR REPLACE FUNCTION public.current_snapshot_schema_version()
RETURNS INTEGER
LANGUAGE sql IMMUTABLE
AS $$ SELECT 1; $$;

-- Schema migration functions (add new ones as schema evolves)
-- Example for future: migrate_snapshot_v1_to_v2(data JSONB) RETURNS JSONB

CREATE OR REPLACE FUNCTION public.restore_estimate_snapshot(
  p_snapshot_id UUID,
  p_restored_by UUID DEFAULT NULL,
  p_force BOOLEAN DEFAULT FALSE
)
RETURNS UUID  -- Returns the checkpoint snapshot ID of the auto-saved state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_estimate_id UUID;
  v_estimate_status VARCHAR(50);
  v_snapshot_data JSONB;
  v_snapshot_schema_version INTEGER;
  v_checkpoint_id UUID;
  v_lock_key BIGINT;
  v_node JSONB;
  v_detail JSONB;
  v_note JSONB;
  v_og JSONB;
  v_oa JSONB;
  v_nom JSONB;
  v_os JSONB;
  v_oss JSONB;
  v_bo JSONB;
  v_boo JSONB;
  v_osbs JSONB;
BEGIN
  -- ── 1. Load and validate snapshot ────────────────────────────
  SELECT 
    s.estimate_id, 
    s.snapshot_data, 
    s.schema_version
  INTO v_estimate_id, v_snapshot_data, v_snapshot_schema_version
  FROM public.estimate_snapshots s
  WHERE s.id = p_snapshot_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Snapshot % not found', p_snapshot_id;
  END IF;

  -- ── 2. Schema version check and migration ───────────────────
  IF v_snapshot_schema_version > public.current_snapshot_schema_version() THEN
    RAISE EXCEPTION 
      'Snapshot schema version % is newer than current version %. Cannot restore forward-incompatible snapshots.',
      v_snapshot_schema_version, public.current_snapshot_schema_version();
  END IF;

  -- Apply migrations sequentially if snapshot is older
  -- (Add new ELSIF blocks as schema evolves)
  IF v_snapshot_schema_version < public.current_snapshot_schema_version() THEN
    -- Example for future:
    -- IF v_snapshot_schema_version = 1 THEN
    --   v_snapshot_data := public.migrate_snapshot_v1_to_v2(v_snapshot_data);
    --   v_snapshot_schema_version := 2;
    -- END IF;
    RAISE EXCEPTION 
      'Snapshot migration from v% to v% not yet implemented.',
      v_snapshot_schema_version, public.current_snapshot_schema_version();
  END IF;

  -- ── 3. Check estimate status guards ─────────────────────────
  SELECT e.status
  INTO v_estimate_status
  FROM public.estimates e
  WHERE e.id = v_estimate_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estimate % not found (may have been deleted)', v_estimate_id;
  END IF;

  -- Block restore on complete estimates entirely
  IF v_estimate_status = 'complete' THEN
    RAISE EXCEPTION 
      'Cannot restore snapshot over a complete estimate. Use "Create Estimate from Snapshot" instead.';
  END IF;

  -- Require force flag for active estimates
  IF v_estimate_status = 'active' AND NOT p_force THEN
    RAISE EXCEPTION 
      'Estimate is active. Pass force := true to confirm restore, or use "Create Estimate from Snapshot".';
  END IF;

  -- ── 4. Acquire advisory lock (prevent concurrent restores) ──
  -- Use estimate_id hashtext as lock key for per-estimate locking
  v_lock_key := hashtext(v_estimate_id::text);
  
  IF NOT pg_try_advisory_xact_lock(v_lock_key) THEN
    RAISE EXCEPTION 'Another restore operation is in progress for estimate %. Please try again.', v_estimate_id;
  END IF;

  -- ── 5. Auto-save current state as checkpoint ────────────────
  v_checkpoint_id := public.create_estimate_snapshot(
    p_estimate_id := v_estimate_id,
    p_name := 'Auto-save before restore from "' || (
      SELECT name FROM public.estimate_snapshots WHERE id = p_snapshot_id
    ) || '"',
    p_description := 'Automatic checkpoint created before restoring snapshot ' || p_snapshot_id::text,
    p_snapshot_type := 'checkpoint',
    p_created_by := p_restored_by
  );

  -- ── 6. Bypass history triggers during bulk delete/insert ─────
  SET LOCAL app.is_snapshot_restore = 'true';

  -- ── 7. Delete all current estimate data (cascading order) ────
  -- Due to ON DELETE CASCADE on FKs, deleting nodes cascades to:
  --   node_item_details, node_assembly_details, node_notes,
  --   node_option_memberships (via node_id FK)
  -- We still need to explicitly delete option system tables
  -- that reference estimate_id directly.
  
  -- Delete option system first (no cascades from nodes cover these)
  DELETE FROM public.option_set_broad_selections osbs
    USING public.option_sets os
    WHERE osbs.option_set_id = os.id AND os.estimate_id = v_estimate_id;

  DELETE FROM public.option_set_selections oss
    USING public.option_sets os
    WHERE oss.option_set_id = os.id AND os.estimate_id = v_estimate_id;

  DELETE FROM public.option_sets 
    WHERE estimate_id = v_estimate_id;

  DELETE FROM public.broad_option_overrides boo
    USING public.broad_options bo
    WHERE boo.broad_option_id = bo.id AND bo.estimate_id = v_estimate_id;

  DELETE FROM public.broad_options 
    WHERE estimate_id = v_estimate_id;

  -- node_option_memberships will cascade from node deletes,
  -- but option_alternatives and option_groups need explicit delete
  -- BEFORE nodes (because anchor_node_id FK would block node delete)
  -- Actually: option_groups has ON DELETE CASCADE from anchor_node_id,
  -- and option_alternatives cascades from option_groups. So deleting
  -- nodes handles the full chain. But we must delete option_groups
  -- first to avoid FK issues if anchor_node references a node being deleted.
  -- Safest: delete option_groups explicitly, then nodes.

  DELETE FROM public.option_groups 
    WHERE estimate_id = v_estimate_id;

  -- Now delete all nodes (cascades to details, notes, memberships)
  DELETE FROM public.estimate_nodes 
    WHERE estimate_id = v_estimate_id;

  -- ── 8. Deserialize nodes ─────────────────────────────────────
  -- Insert nodes in a way that respects parent_id FK constraints.
  -- Strategy: insert all nodes with parent_id = NULL first, then
  -- update parent_id afterward. This avoids ordering issues.
  
  -- Insert all nodes WITHOUT parent_id first
  FOR v_node IN SELECT * FROM jsonb_array_elements(v_snapshot_data->'nodes')
  LOOP
    INSERT INTO public.estimate_nodes (
      id, estimate_id, parent_id, sort_order, node_type,
      name, description, phase_id, cost_code_id,
      client_visibility, subtotal, contingency_amount,
      overhead_amount, total_price, catalog_source_id,
      catalog_source_type, catalog_version, reference_name,
      flagged, created_at, created_by
    ) VALUES (
      (v_node->>'id')::uuid,
      v_estimate_id,
      NULL,  -- parent_id set in next step
      (v_node->>'sort_order')::integer,
      v_node->>'node_type',
      v_node->>'name',
      v_node->>'description',
      (v_node->>'phase_id')::uuid,
      (v_node->>'cost_code_id')::uuid,
      COALESCE(v_node->>'client_visibility', 'visible'),
      COALESCE((v_node->>'subtotal')::decimal, 0),
      COALESCE((v_node->>'contingency_amount')::decimal, 0),
      COALESCE((v_node->>'overhead_amount')::decimal, 0),
      COALESCE((v_node->>'total_price')::decimal, 0),
      (v_node->>'catalog_source_id')::uuid,
      v_node->>'catalog_source_type',
      (v_node->>'catalog_version')::integer,
      v_node->>'reference_name',
      COALESCE((v_node->>'flagged')::boolean, false),
      COALESCE((v_node->>'created_at')::timestamptz, NOW()),
      (v_node->>'created_by')::uuid
    );
  END LOOP;

  -- Now set parent_id for all non-root nodes
  FOR v_node IN SELECT * FROM jsonb_array_elements(v_snapshot_data->'nodes')
  LOOP
    IF v_node->>'parent_id' IS NOT NULL THEN
      UPDATE public.estimate_nodes
      SET parent_id = (v_node->>'parent_id')::uuid
      WHERE id = (v_node->>'id')::uuid;
    END IF;
  END LOOP;

  -- ── 9. Deserialize item details ──────────────────────────────
  FOR v_detail IN SELECT * FROM jsonb_array_elements(v_snapshot_data->'item_details')
  LOOP
    INSERT INTO public.node_item_details (
      node_id, qty, raw_qty, qty_mode, qty_formula,
      ratio_numerator, ratio_denominator, unit_id, unit_cost,
      cost_formula, cost_type, contingency_rate, overhead_rate,
      unit_price, waste_factor, min_order_qty, package_size,
      package_unit_id, bid_type, allowance_budget, allowance_status,
      vendor_id, instructions, specifications
    ) VALUES (
      (v_detail->>'node_id')::uuid,
      COALESCE((v_detail->>'qty')::decimal, 0),
      COALESCE((v_detail->>'raw_qty')::decimal, 0),
      COALESCE(v_detail->>'qty_mode', 'numeric'),
      v_detail->>'qty_formula',
      (v_detail->>'ratio_numerator')::decimal,
      (v_detail->>'ratio_denominator')::decimal,
      (v_detail->>'unit_id')::uuid,
      COALESCE((v_detail->>'unit_cost')::decimal, 0),
      v_detail->>'cost_formula',
      v_detail->>'cost_type',
      COALESCE((v_detail->>'contingency_rate')::decimal, 0),
      COALESCE((v_detail->>'overhead_rate')::decimal, 0),
      (v_detail->>'unit_price')::decimal,
      COALESCE((v_detail->>'waste_factor')::decimal, 0),
      (v_detail->>'min_order_qty')::decimal,
      (v_detail->>'package_size')::decimal,
      (v_detail->>'package_unit_id')::uuid,
      COALESCE(v_detail->>'bid_type', 'estimate'),
      (v_detail->>'allowance_budget')::decimal,
      v_detail->>'allowance_status',
      (v_detail->>'vendor_id')::uuid,
      v_detail->>'instructions',
      v_detail->>'specifications'
    );
  END LOOP;

  -- ── 10. Deserialize assembly details ─────────────────────────
  FOR v_detail IN SELECT * FROM jsonb_array_elements(v_snapshot_data->'assembly_details')
  LOOP
    INSERT INTO public.node_assembly_details (
      node_id, assembly_unit_id, assembly_qty,
      derived_unit_cost, qty_formula
    ) VALUES (
      (v_detail->>'node_id')::uuid,
      (v_detail->>'assembly_unit_id')::uuid,
      COALESCE((v_detail->>'assembly_qty')::decimal, 0),
      (v_detail->>'derived_unit_cost')::decimal,
      v_detail->>'qty_formula'
    );
  END LOOP;

  -- ── 11. Deserialize node notes ───────────────────────────────
  FOR v_note IN SELECT * FROM jsonb_array_elements(v_snapshot_data->'node_notes')
  LOOP
    INSERT INTO public.node_notes (
      id, node_id, body, format, is_internal,
      is_client_visible, created_by, created_at
    ) VALUES (
      (v_note->>'id')::uuid,
      (v_note->>'node_id')::uuid,
      v_note->>'body',
      COALESCE(v_note->>'format', 'markdown'),
      COALESCE((v_note->>'is_internal')::boolean, true),
      COALESCE((v_note->>'is_client_visible')::boolean, false),
      (v_note->>'created_by')::uuid,
      COALESCE((v_note->>'created_at')::timestamptz, NOW())
    );
  END LOOP;

  -- ── 12. Deserialize option groups ────────────────────────────
  FOR v_og IN SELECT * FROM jsonb_array_elements(v_snapshot_data->'option_groups')
  LOOP
    INSERT INTO public.option_groups (
      id, estimate_id, anchor_node_id, name, description, created_at
    ) VALUES (
      (v_og->>'id')::uuid,
      v_estimate_id,
      (v_og->>'anchor_node_id')::uuid,
      v_og->>'name',
      v_og->>'description',
      COALESCE((v_og->>'created_at')::timestamptz, NOW())
    );
  END LOOP;

  -- ── 13. Deserialize option alternatives ──────────────────────
  FOR v_oa IN SELECT * FROM jsonb_array_elements(v_snapshot_data->'option_alternatives')
  LOOP
    INSERT INTO public.option_alternatives (
      id, option_group_id, name, description,
      is_selected, sort_order
    ) VALUES (
      (v_oa->>'id')::uuid,
      (v_oa->>'option_group_id')::uuid,
      v_oa->>'name',
      v_oa->>'description',
      COALESCE((v_oa->>'is_selected')::boolean, false),
      COALESCE((v_oa->>'sort_order')::integer, 0)
    );
  END LOOP;

  -- ── 14. Deserialize option memberships ───────────────────────
  FOR v_nom IN SELECT * FROM jsonb_array_elements(v_snapshot_data->'option_memberships')
  LOOP
    INSERT INTO public.node_option_memberships (
      id, node_id, option_alternative_id
    ) VALUES (
      (v_nom->>'id')::uuid,
      (v_nom->>'node_id')::uuid,
      (v_nom->>'option_alternative_id')::uuid
    );
  END LOOP;

  -- ── 15. Deserialize option sets ──────────────────────────────
  FOR v_os IN SELECT * FROM jsonb_array_elements(v_snapshot_data->'option_sets')
  LOOP
    INSERT INTO public.option_sets (
      id, estimate_id, name, description,
      is_default, sort_order
    ) VALUES (
      (v_os->>'id')::uuid,
      v_estimate_id,
      v_os->>'name',
      v_os->>'description',
      COALESCE((v_os->>'is_default')::boolean, false),
      COALESCE((v_os->>'sort_order')::integer, 0)
    );
  END LOOP;

  -- ── 16. Deserialize option set selections ────────────────────
  FOR v_oss IN SELECT * FROM jsonb_array_elements(v_snapshot_data->'option_set_selections')
  LOOP
    INSERT INTO public.option_set_selections (
      id, option_set_id, option_group_id, selected_alternative_id
    ) VALUES (
      (v_oss->>'id')::uuid,
      (v_oss->>'option_set_id')::uuid,
      (v_oss->>'option_group_id')::uuid,
      (v_oss->>'selected_alternative_id')::uuid
    );
  END LOOP;

  -- ── 17. Deserialize broad options ────────────────────────────
  FOR v_bo IN SELECT * FROM jsonb_array_elements(v_snapshot_data->'broad_options')
  LOOP
    INSERT INTO public.broad_options (
      id, estimate_id, name, description,
      is_active, sort_order
    ) VALUES (
      (v_bo->>'id')::uuid,
      v_estimate_id,
      v_bo->>'name',
      v_bo->>'description',
      COALESCE((v_bo->>'is_active')::boolean, false),
      COALESCE((v_bo->>'sort_order')::integer, 0)
    );
  END LOOP;

  -- ── 18. Deserialize broad option overrides ───────────────────
  FOR v_boo IN SELECT * FROM jsonb_array_elements(v_snapshot_data->'broad_option_overrides')
  LOOP
    INSERT INTO public.broad_option_overrides (
      id, broad_option_id, parameter_id, override_value
    ) VALUES (
      (v_boo->>'id')::uuid,
      (v_boo->>'broad_option_id')::uuid,
      (v_boo->>'parameter_id')::uuid,
      (v_boo->>'override_value')::decimal
    );
  END LOOP;

  -- ── 19. Deserialize option set broad selections ──────────────
  FOR v_osbs IN SELECT * FROM jsonb_array_elements(v_snapshot_data->'option_set_broad_selections')
  LOOP
    INSERT INTO public.option_set_broad_selections (
      id, option_set_id, broad_option_id, is_active
    ) VALUES (
      (v_osbs->>'id')::uuid,
      (v_osbs->>'option_set_id')::uuid,
      (v_osbs->>'broad_option_id')::uuid,
      COALESCE((v_osbs->>'is_active')::boolean, false)
    );
  END LOOP;

  -- ── 20. Reset trigger bypass ─────────────────────────────────
  RESET app.is_snapshot_restore;

  -- ── 21. Mark snapshot as having been used for restore ────────
  UPDATE public.estimate_snapshots
  SET restored_at = NOW(),
      restored_by = p_restored_by
  WHERE id = p_snapshot_id;

  -- ── 22. Return the checkpoint ID (auto-save of previous state)
  RETURN v_checkpoint_id;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.restore_estimate_snapshot TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_snapshot_schema_version TO authenticated;
```

#### JSONB Schema Documentation (schema_version = 1)

```jsonc
// snapshot_data JSONB structure (schema_version: 1)
{
  "schema_version": 1,
  "serialized_at": "2026-04-08T20:00:00Z",
  
  // Estimate metadata at time of snapshot
  "estimate": {
    "id": "uuid",
    "project_id": "uuid",
    "name": "string",
    "version_group_id": "uuid",
    "version_number": 1,
    "version_label": "string | null",
    "is_current": true,
    "status": "draft | preliminary | active | complete",
    "default_contingency_rate": 0.0500,
    "default_overhead_rate": 0.1000,
    "created_at": "timestamptz",
    "created_by": "uuid"
  },
  
  // All estimate nodes (full tree)
  "nodes": [
    {
      "id": "uuid",
      "parent_id": "uuid | null",
      "path": "ltree-as-string",
      "sort_order": 0,
      "node_type": "group | assembly | item",
      "name": "string",
      "description": "string | null",
      "phase_id": "uuid | null",
      "cost_code_id": "uuid | null",
      "client_visibility": "visible | hidden | summary_only",
      "subtotal": 0.0000,
      "contingency_amount": 0.0000,
      "overhead_amount": 0.0000,
      "total_price": 0.0000,
      "catalog_source_id": "uuid | null",
      "catalog_source_type": "item | assembly | null",
      "catalog_version": "int | null",
      "reference_name": "string | null",
      "flagged": false,
      "created_at": "timestamptz",
      "created_by": "uuid | null"
    }
  ],
  
  // Item detail rows (1:1 with item nodes)
  "item_details": [
    {
      "node_id": "uuid",
      "qty": 0.0000,
      "raw_qty": 0.0000,
      "qty_mode": "numeric | formula | ratio",
      "qty_formula": "string | null",
      "ratio_numerator": "decimal | null",
      "ratio_denominator": "decimal | null",
      "unit_id": "uuid | null",
      "unit_cost": 0.0000,
      "cost_formula": "string | null",
      "cost_type": "material | labor | equipment | subcontractor | other | null",
      "contingency_rate": 0.0500,
      "overhead_rate": 0.1000,
      "unit_price": "decimal | null",
      "waste_factor": 0.0000,
      "min_order_qty": "decimal | null",
      "package_size": "decimal | null",
      "package_unit_id": "uuid | null",
      "bid_type": "bid | allowance | estimate",
      "allowance_budget": "decimal | null",
      "allowance_status": "pending_selection | selected | finalized | null",
      "vendor_id": "uuid | null",
      "instructions": "string | null",
      "specifications": "string | null"
    }
  ],
  
  // Assembly detail rows (1:1 with assembly nodes)
  "assembly_details": [
    {
      "node_id": "uuid",
      "assembly_unit_id": "uuid | null",
      "assembly_qty": 0.0000,
      "derived_unit_cost": "decimal | null",
      "qty_formula": "string | null"
    }
  ],
  
  // Notes (soft-deleted excluded)
  "node_notes": [
    {
      "id": "uuid",
      "node_id": "uuid",
      "body": "string",
      "format": "markdown | html",
      "is_internal": true,
      "is_client_visible": false,
      "created_by": "uuid | null",
      "created_at": "timestamptz"
    }
  ],
  
  // Option groups
  "option_groups": [
    {
      "id": "uuid",
      "anchor_node_id": "uuid",
      "name": "string",
      "description": "string | null",
      "created_at": "timestamptz"
    }
  ],
  
  // Option alternatives
  "option_alternatives": [
    {
      "id": "uuid",
      "option_group_id": "uuid",
      "name": "string",
      "description": "string | null",
      "is_selected": true,
      "sort_order": 0
    }
  ],
  
  // Node-to-alternative junction
  "option_memberships": [
    {
      "id": "uuid",
      "node_id": "uuid",
      "option_alternative_id": "uuid"
    }
  ],
  
  // Saved scenario sets
  "option_sets": [
    {
      "id": "uuid",
      "name": "string",
      "description": "string | null",
      "is_default": false,
      "sort_order": 0
    }
  ],
  
  // Inline selections per scenario
  "option_set_selections": [
    {
      "id": "uuid",
      "option_set_id": "uuid",
      "option_group_id": "uuid",
      "selected_alternative_id": "uuid"
    }
  ],
  
  // Broad options (parameter overrides)
  "broad_options": [
    {
      "id": "uuid",
      "name": "string",
      "description": "string | null",
      "is_active": false,
      "sort_order": 0
    }
  ],
  
  // Parameter override values
  "broad_option_overrides": [
    {
      "id": "uuid",
      "broad_option_id": "uuid",
      "parameter_id": "uuid",
      "override_value": 0.0000
    }
  ],
  
  // Broad option states per scenario
  "option_set_broad_selections": [
    {
      "id": "uuid",
      "option_set_id": "uuid",
      "broad_option_id": "uuid",
      "is_active": false
    }
  ],
  
  // Frozen project parameter values
  "project_parameters": [
    {
      "id": "uuid",
      "name": "string",
      "display_name": "string | null",
      "value": 0.0000,
      "unit_id": "uuid | null",
      "description": "string | null"
    }
  ]
}
```

---

### TypeScript

```typescript
// src/lib/types/snapshots.ts

// ── Snapshot Type Discriminator ─────────────────────────────────

export type SnapshotType = 'milestone' | 'checkpoint';

// ── Snapshot Record (from database) ─────────────────────────────

export interface EstimateSnapshot {
  id: string;
  estimate_id: string;
  name: string;
  description: string | null;
  snapshot_type: SnapshotType;
  estimate_status_at_time: string;
  project_status_at_time: string | null;
  version_number_at_time: number | null;
  snapshot_data: SnapshotData;
  schema_version: number;
  node_count: number;
  total_price: number;
  created_at: string;
  created_by: string | null;
  restored_at: string | null;
  restored_by: string | null;
}

// ── Snapshot List Item (without JSONB for list queries) ──────────

export interface EstimateSnapshotSummary {
  id: string;
  estimate_id: string;
  name: string;
  description: string | null;
  snapshot_type: SnapshotType;
  estimate_status_at_time: string;
  node_count: number;
  total_price: number;
  created_at: string;
  created_by: string | null;
  restored_at: string | null;
}

// ── JSONB Schema (schema_version = 1) ───────────────────────────

export interface SnapshotData {
  schema_version: number;
  serialized_at: string;
  estimate: SnapshotEstimateMetadata;
  nodes: SnapshotNode[];
  item_details: SnapshotItemDetail[];
  assembly_details: SnapshotAssemblyDetail[];
  node_notes: SnapshotNodeNote[];
  option_groups: SnapshotOptionGroup[];
  option_alternatives: SnapshotOptionAlternative[];
  option_memberships: SnapshotOptionMembership[];
  option_sets: SnapshotOptionSet[];
  option_set_selections: SnapshotOptionSetSelection[];
  broad_options: SnapshotBroadOption[];
  broad_option_overrides: SnapshotBroadOptionOverride[];
  option_set_broad_selections: SnapshotOptionSetBroadSelection[];
  project_parameters: SnapshotProjectParameter[];
}

export interface SnapshotEstimateMetadata {
  id: string;
  project_id: string;
  name: string;
  version_group_id: string;
  version_number: number;
  version_label: string | null;
  is_current: boolean;
  status: string;
  default_contingency_rate: number;
  default_overhead_rate: number;
  created_at: string;
  created_by: string | null;
}

export interface SnapshotNode {
  id: string;
  parent_id: string | null;
  path: string;
  sort_order: number;
  node_type: 'group' | 'assembly' | 'item';
  name: string;
  description: string | null;
  phase_id: string | null;
  cost_code_id: string | null;
  client_visibility: 'visible' | 'hidden' | 'summary_only';
  subtotal: number;
  contingency_amount: number;
  overhead_amount: number;
  total_price: number;
  catalog_source_id: string | null;
  catalog_source_type: 'item' | 'assembly' | null;
  catalog_version: number | null;
  reference_name: string | null;
  flagged: boolean;
  created_at: string;
  created_by: string | null;
}

export interface SnapshotItemDetail {
  node_id: string;
  qty: number;
  raw_qty: number;
  qty_mode: 'numeric' | 'formula' | 'ratio';
  qty_formula: string | null;
  ratio_numerator: number | null;
  ratio_denominator: number | null;
  unit_id: string | null;
  unit_cost: number;
  cost_formula: string | null;
  cost_type: 'material' | 'labor' | 'equipment' | 'subcontractor' | 'other' | null;
  contingency_rate: number;
  overhead_rate: number;
  unit_price: number | null;
  waste_factor: number;
  min_order_qty: number | null;
  package_size: number | null;
  package_unit_id: string | null;
  bid_type: 'bid' | 'allowance' | 'estimate';
  allowance_budget: number | null;
  allowance_status: 'pending_selection' | 'selected' | 'finalized' | null;
  vendor_id: string | null;
  instructions: string | null;
  specifications: string | null;
}

export interface SnapshotAssemblyDetail {
  node_id: string;
  assembly_unit_id: string | null;
  assembly_qty: number;
  derived_unit_cost: number | null;
  qty_formula: string | null;
}

export interface SnapshotNodeNote {
  id: string;
  node_id: string;
  body: string;
  format: 'markdown' | 'html';
  is_internal: boolean;
  is_client_visible: boolean;
  created_by: string | null;
  created_at: string;
}

export interface SnapshotOptionGroup {
  id: string;
  anchor_node_id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export interface SnapshotOptionAlternative {
  id: string;
  option_group_id: string;
  name: string;
  description: string | null;
  is_selected: boolean;
  sort_order: number;
}

export interface SnapshotOptionMembership {
  id: string;
  node_id: string;
  option_alternative_id: string;
}

export interface SnapshotOptionSet {
  id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  sort_order: number;
}

export interface SnapshotOptionSetSelection {
  id: string;
  option_set_id: string;
  option_group_id: string;
  selected_alternative_id: string;
}

export interface SnapshotBroadOption {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  sort_order: number;
}

export interface SnapshotBroadOptionOverride {
  id: string;
  broad_option_id: string;
  parameter_id: string;
  override_value: number;
}

export interface SnapshotOptionSetBroadSelection {
  id: string;
  option_set_id: string;
  broad_option_id: string;
  is_active: boolean;
}

export interface SnapshotProjectParameter {
  id: string;
  name: string;
  display_name: string | null;
  value: number;
  unit_id: string | null;
  description: string | null;
}

// ── Server Action Types ─────────────────────────────────────────

export interface CreateSnapshotInput {
  estimate_id: string;
  name: string;
  description?: string;
  snapshot_type?: SnapshotType;
}

export interface RestoreSnapshotInput {
  snapshot_id: string;
  force?: boolean;
}

export interface CreateEstimateFromSnapshotInput {
  snapshot_id: string;
  name?: string;
  version_label?: string;
}
```

```typescript
// src/lib/actions/snapshots.ts

import type { ActionResult } from '@/lib/types/actions';
import type {
  CreateSnapshotInput,
  RestoreSnapshotInput,
  CreateEstimateFromSnapshotInput,
  EstimateSnapshot,
  EstimateSnapshotSummary,
} from '@/lib/types/snapshots';

export async function createSnapshot(
  input: CreateSnapshotInput
): Promise<ActionResult<{ snapshot_id: string }>> {
  // Calls create_estimate_snapshot() RPC
  // Returns { success: true, data: { snapshot_id } }
  // or { success: false, error: 'message', code: 'ESTIMATE_NOT_FOUND' }
  throw new Error('Not implemented');
}

export async function restoreSnapshot(
  input: RestoreSnapshotInput
): Promise<ActionResult<{ checkpoint_id: string }>> {
  // Calls restore_estimate_snapshot() RPC
  // Returns checkpoint_id of the auto-saved state
  throw new Error('Not implemented');
}

export async function createEstimateFromSnapshot(
  input: CreateEstimateFromSnapshotInput
): Promise<ActionResult<{ estimate_id: string }>> {
  // 1. Create new estimate row (new version_number, same version_group_id)
  // 2. Deserialize snapshot JSONB into new estimate
  // Returns new estimate_id
  throw new Error('Not implemented');
}

export async function listSnapshots(
  estimate_id: string,
  snapshot_type?: 'milestone' | 'checkpoint'
): Promise<ActionResult<EstimateSnapshotSummary[]>> {
  // Queries estimate_snapshots WITHOUT snapshot_data column
  throw new Error('Not implemented');
}

export async function getSnapshot(
  snapshot_id: string
): Promise<ActionResult<EstimateSnapshot>> {
  // Full snapshot with JSONB data for browsing
  throw new Error('Not implemented');
}
```

---

### File Paths

| File | Purpose |
|------|---------|
| `supabase/migrations/XXXXXXXX_estimate_snapshots.sql` | CREATE TABLE + RLS + immutability trigger |
| `supabase/migrations/XXXXXXXX_snapshot_functions.sql` | `create_estimate_snapshot()` + `restore_estimate_snapshot()` + `current_snapshot_schema_version()` |
| `src/lib/types/snapshots.ts` | TypeScript types for snapshot JSONB, records, and action inputs |
| `src/lib/actions/snapshots.ts` | Server actions (create, restore, list, get, create-from-snapshot) |
| `src/lib/validation/snapshots.ts` | Zod schemas for snapshot action inputs |

---

## Trade-offs Considered

### 1. JSONB Serialization vs Deep-Copy into Production Tables

| Factor | JSONB (chosen) | Deep-Copy |
|--------|---------------|-----------|
| Storage efficiency | Single row per snapshot | 10+ rows per node across multiple tables |
| Query capability | Opaque until deserialized | Full SQL query capability |
| Immutability enforcement | Trivial (one trigger on one table) | Complex (must prevent edits on 10+ tables) |
| Restore complexity | Moderate (deserialize + insert) | Low (flip `is_current` flag) |
| Schema evolution | Requires `schema_version` + migration chain | Automatically matches current schema |
| Snapshot size | ~1-5KB per node (JSONB) | ~10 rows per node across tables |

JSONB wins because snapshots are inherently read-rarely, write-once documents. The query capability of deep-copy is unnecessary -- you never need to "find all snapshots where node X costs more than $Y."

### 2. Row-by-Row Loop vs Batch INSERT...SELECT for Restore

The restore function uses row-by-row `FOR v_node IN jsonb_array_elements(...)` loops rather than `INSERT...SELECT FROM jsonb_populate_recordset()`. Trade-off:

- **Row-by-row** is ~2-5x slower but handles NULL/COALESCE defaults cleanly and is dramatically easier to debug and maintain.
- **Batch** via `jsonb_populate_recordset()` is faster but requires exact column name matching between JSONB keys and table columns, with no room for schema evolution defaults.

For typical estimate sizes (200-1,000 nodes), row-by-row completes in <500ms. The performance difference is negligible. If benchmarking shows this is a bottleneck, the inner loops can be rewritten to batch mode.

### 3. Original UUIDs vs New UUIDs in Snapshots

The design preserves original UUIDs in the JSONB. On restore, the original UUIDs are reinserted (the current data was deleted first). This means:

- External references to node IDs (e.g., in comments, bookmarks) remain valid after restore.
- No ID remapping logic is needed in the restore function.
- The tradeoff: if the estimate is concurrently accessed during restore (unlikely in a single-company tool but possible), the brief window between DELETE and INSERT could cause errors. The advisory lock mitigates this.

### 4. Advisory Lock Strategy

`pg_advisory_xact_lock(hashtext(estimate_id))` was chosen over:
- **`FOR UPDATE` on estimates row:** Would lock the estimate row for all operations, not just restores.
- **Application-level mutex:** Unreliable across multiple server instances.
- **`pg_try_advisory_xact_lock` (chosen):** Non-blocking -- returns false immediately if locked, letting the user retry rather than hanging. The lock is automatically released when the transaction commits/rolls back.

---

## Effort Estimate

| Task | Effort |
|------|--------|
| `estimate_snapshots` table migration | 0.5 hours |
| `create_estimate_snapshot()` function | 2 hours |
| `restore_estimate_snapshot()` function | 3 hours |
| TypeScript types | 1 hour |
| Server actions (5 functions) | 2 hours |
| Validation schemas (Zod) | 0.5 hours |
| Unit tests for snapshot round-trip | 4 hours |
| Edge case tests (empty estimate, large tree, schema migration) | 2 hours |
| **Total** | **~15 hours (2 sessions)** |

---

## Dependencies (What Must Exist First)

1. **All core tables must exist:** `estimates`, `estimate_nodes`, `node_item_details`, `node_assembly_details`, `node_notes`, `option_groups`, `option_alternatives`, `node_option_memberships`, `option_sets`, `option_set_selections`, `broad_options`, `broad_option_overrides`, `option_set_broad_selections`, `project_parameters`
2. **`get_user_role()` helper function** (for RLS policies on `estimate_snapshots`)
3. **History trigger bypass mechanism** (`SET LOCAL app.is_snapshot_restore = 'true'` must be checked in history triggers)
4. **`flagged` column on `estimate_nodes`** (serialized by snapshot)

---

## Test Cases

### Snapshot Creation (5 tests)

1. **Create milestone snapshot of non-empty estimate** -- verify all 14 JSONB sections are populated, node_count and total_price match.
2. **Create checkpoint snapshot** -- verify snapshot_type = 'checkpoint', auto-generated name format.
3. **Create snapshot of empty estimate (0 nodes)** -- verify empty arrays in JSONB, node_count = 0.
4. **Create snapshot of estimate with full option system** -- verify option_groups, alternatives, memberships, sets, broad_options all serialized correctly.
5. **Snapshot of non-existent estimate** -- verify raises exception.

### Snapshot Immutability (3 tests)

6. **Attempt to UPDATE snapshot_data** -- verify trigger blocks mutation.
7. **Attempt to DELETE snapshot** -- verify trigger blocks deletion.
8. **Verify restored_at/restored_by CAN be updated** -- confirm the exception in the immutability trigger.

### Snapshot Restore (7 tests)

9. **Restore snapshot to draft estimate** -- verify full round-trip: create snapshot, modify estimate, restore, compare node-by-node.
10. **Restore auto-creates checkpoint** -- verify a checkpoint snapshot exists after restore with the pre-restore state.
11. **Restore blocked on complete estimate** -- verify exception raised.
12. **Restore blocked on active estimate without force** -- verify exception raised.
13. **Restore allowed on active estimate with force=true** -- verify restore succeeds.
14. **Concurrent restore blocked by advisory lock** -- simulate concurrent call, verify "another restore in progress" error.
15. **Restore snapshot with schema_version > current** -- verify forward-compatibility rejection.

### Schema Evolution (2 tests)

16. **schema_version mismatch triggers migration chain** -- when migration functions exist, verify they transform JSONB correctly.
17. **Snapshot created at v1 can be restored after code upgrades to v2** -- end-to-end migration test (deferred until v2 exists).

### Edge Cases (3 tests)

18. **Snapshot with 1,000 nodes** -- benchmark: creation < 2s, restore < 5s.
19. **Snapshot with deeply nested tree (20 levels)** -- verify parent_id chain reconstructed correctly.
20. **Create Estimate from Snapshot (distinct from restore)** -- verify new estimate_id, original untouched, version_number incremented.
