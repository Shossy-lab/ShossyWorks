-- Phase A1: Add auth guards to all SECURITY DEFINER RPC functions
-- Addresses: CF-01 (CRITICAL) — any authenticated user can call sensitive
-- business operations. Zero internal authorization checks.
--
-- Fix: Add `IF NOT public.is_staff() THEN RAISE EXCEPTION ...` as the
-- first statement after BEGIN in all 5 SECURITY DEFINER functions.
--
-- Depends on:
--   20260409000001_security_foundation.sql  (is_staff(), get_user_role())
--   20260409000011_functions.sql            (original function definitions)


-- ############################################################
--  1. set_subtree_visibility() — with auth guard
-- ############################################################

CREATE OR REPLACE FUNCTION public.set_subtree_visibility(
  p_node_id    UUID,
  p_visibility public.client_visibility
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_path  public.ltree;
  v_count INTEGER;
BEGIN
  -- AUTH GUARD: Only staff (owner/employee) may call this function
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'Permission denied: staff role required';
  END IF;

  -- Get the node's ltree path
  SELECT path INTO v_path
  FROM public.estimate_nodes
  WHERE id = p_node_id;

  IF v_path IS NULL THEN
    RAISE EXCEPTION 'Node not found or has no path: %', p_node_id;
  END IF;

  -- Update the node and all descendants
  UPDATE public.estimate_nodes
  SET client_visibility = p_visibility,
      updated_at = now()
  WHERE path <@ v_path;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;


-- ############################################################
--  2. deep_copy_estimate() — with auth guard
-- ############################################################

CREATE OR REPLACE FUNCTION public.deep_copy_estimate(
  p_source_estimate_id UUID,
  p_new_name           TEXT DEFAULT NULL,
  p_created_by         UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_new_estimate_id    UUID;
  v_source_project_id  UUID;
  v_source_vg_id       UUID;
  v_source_version     INTEGER;
  v_new_version        INTEGER;
  v_row_count          INTEGER;
BEGIN
  -- AUTH GUARD: Only staff (owner/employee) may call this function
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'Permission denied: staff role required';
  END IF;

  -- =========================================================================
  -- 0. VALIDATE SOURCE EXISTS
  -- =========================================================================
  SELECT project_id, version_group_id, version
    INTO v_source_project_id, v_source_vg_id, v_source_version
    FROM public.estimates
   WHERE id = p_source_estimate_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source estimate % not found', p_source_estimate_id;
  END IF;

  v_new_version := COALESCE(v_source_version, 1) + 1;
  v_new_estimate_id := gen_random_uuid();

  -- =========================================================================
  -- 1. BYPASS TRIGGERS
  -- SET LOCAL scopes to this transaction only.
  -- Bypassed: history triggers, path maintenance, option inheritance
  -- NOT bypassed: updated_at trigger (we WANT fresh timestamps)
  -- =========================================================================
  SET LOCAL app.is_snapshot_copy = 'true';

  -- =========================================================================
  -- 2. CREATE TEMP TABLES FOR ID REMAPPING
  -- Each maps old_id -> new_id. ON COMMIT DROP ensures cleanup.
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
  -- 3. COPY estimates ROW
  -- =========================================================================
  INSERT INTO public.estimates (
    id, project_id, name, description, status,
    version, version_group_id,
    default_markup_rate, default_overhead_rate,
    default_contingency_rate, default_tax_rate,
    notes, created_by, created_at, updated_at
  )
  SELECT
    v_new_estimate_id,
    project_id,
    COALESCE(p_new_name, name || ' (Copy)'),
    description,
    status,
    v_new_version,
    COALESCE(version_group_id, p_source_estimate_id), -- use source as group if none
    default_markup_rate,
    default_overhead_rate,
    default_contingency_rate,
    default_tax_rate,
    notes,
    COALESCE(p_created_by, created_by),
    now(),
    now()
  FROM public.estimates
  WHERE id = p_source_estimate_id;

  -- =========================================================================
  -- 4. COPY estimate_nodes (populate node mapping first)
  -- Two-pass: generate mappings, then INSERT with remapped parent_id.
  -- Path column set to NULL during copy — rebuilt in bulk after.
  -- =========================================================================

  -- Pass A: Generate ID mappings
  INSERT INTO _map_nodes (old_id, new_id)
  SELECT id, gen_random_uuid()
    FROM public.estimate_nodes
   WHERE estimate_id = p_source_estimate_id;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count = 0 THEN
    -- Empty estimate — valid but nothing more to copy
    RESET app.is_snapshot_copy;
    RETURN v_new_estimate_id;
  END IF;

  -- Pass B: INSERT with remapped IDs
  INSERT INTO public.estimate_nodes (
    id, estimate_id, parent_id, path, sort_order,
    node_type, name, description,
    client_visibility, flagged, was_auto_promoted,
    catalog_source_id, total_price,
    created_by, created_at, updated_at
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
    en.client_visibility,
    en.flagged,
    en.was_auto_promoted,
    en.catalog_source_id,                   -- soft reference, copied as-is
    en.total_price,
    COALESCE(p_created_by, en.created_by),
    now(),
    now()
  FROM public.estimate_nodes en
  JOIN _map_nodes mn ON mn.old_id = en.id
  LEFT JOIN _map_nodes mp ON mp.old_id = en.parent_id
  WHERE en.estimate_id = p_source_estimate_id;

  -- =========================================================================
  -- 5. REBUILD ltree PATHS for copied nodes
  -- Single recursive rebuild — O(n) vs O(n*d) per-row triggers.
  -- =========================================================================
  WITH RECURSIVE path_builder AS (
    -- Base case: root nodes (parent_id IS NULL)
    SELECT id, id::text::public.ltree AS computed_path
      FROM public.estimate_nodes
     WHERE estimate_id = v_new_estimate_id
       AND parent_id IS NULL

    UNION ALL

    -- Recursive case: children
    SELECT en.id, pb.computed_path || en.id::text
      FROM public.estimate_nodes en
      JOIN path_builder pb ON en.parent_id = pb.id
     WHERE en.estimate_id = v_new_estimate_id
  )
  UPDATE public.estimate_nodes en
     SET path = pb.computed_path
    FROM path_builder pb
   WHERE en.id = pb.id;

  -- =========================================================================
  -- 6. COPY node_item_details
  -- =========================================================================
  INSERT INTO public.node_item_details (
    id, node_id, quantity, unit_id, unit_cost,
    material_cost, labor_cost, labor_hours, labor_rate,
    equipment_cost, subcontractor_cost,
    markup_rate, overhead_rate, tax_rate,
    is_allowance, allowance_budget, allowance_status,
    specifications, purchasing_notes,
    vendor_id, archived_at,
    created_at, updated_at
  )
  SELECT
    gen_random_uuid(),                      -- new PK
    mn.new_id,                              -- remapped node_id
    nid.quantity, nid.unit_id, nid.unit_cost,
    nid.material_cost, nid.labor_cost, nid.labor_hours, nid.labor_rate,
    nid.equipment_cost, nid.subcontractor_cost,
    nid.markup_rate, nid.overhead_rate, nid.tax_rate,
    nid.is_allowance, nid.allowance_budget, nid.allowance_status,
    nid.specifications, nid.purchasing_notes,
    nid.vendor_id,                          -- shared reference, not remapped
    nid.archived_at,                        -- preserve archive state
    now(), now()
  FROM public.node_item_details nid
  JOIN _map_nodes mn ON mn.old_id = nid.node_id;

  -- =========================================================================
  -- 7. COPY node_assembly_details
  -- =========================================================================
  INSERT INTO public.node_assembly_details (
    id, node_id, quantity, unit_id, assembly_unit_cost,
    ratio_base, specifications, archived_at,
    created_at, updated_at
  )
  SELECT
    gen_random_uuid(),                      -- new PK
    mn.new_id,                              -- remapped node_id
    nad.quantity, nad.unit_id, nad.assembly_unit_cost,
    nad.ratio_base, nad.specifications, nad.archived_at,
    now(), now()
  FROM public.node_assembly_details nad
  JOIN _map_nodes mn ON mn.old_id = nad.node_id;

  -- =========================================================================
  -- 8. COPY node_notes
  -- =========================================================================
  INSERT INTO public.node_notes (
    id, node_id, body, format,
    is_internal, is_client_visible,
    deleted_at, created_by,
    created_at, updated_at
  )
  SELECT
    gen_random_uuid(),                      -- new PK
    mn.new_id,                              -- remapped node_id
    nn.body, nn.format,
    nn.is_internal, nn.is_client_visible,
    nn.deleted_at,                          -- preserve soft-delete state
    COALESCE(p_created_by, nn.created_by),
    now(), now()
  FROM public.node_notes nn
  JOIN _map_nodes mn ON mn.old_id = nn.node_id;

  -- =========================================================================
  -- 9. COPY option_groups (populate mapping)
  -- =========================================================================
  INSERT INTO _map_option_groups (old_id, new_id)
  SELECT id, gen_random_uuid()
    FROM public.option_groups
   WHERE estimate_id = p_source_estimate_id;

  INSERT INTO public.option_groups (
    id, estimate_id, name, description, group_type,
    sort_order, created_at, updated_at
  )
  SELECT
    mog.new_id,                             -- remapped id
    v_new_estimate_id,                      -- new estimate
    og.name, og.description, og.group_type,
    og.sort_order, now(), now()
  FROM public.option_groups og
  JOIN _map_option_groups mog ON mog.old_id = og.id;

  -- =========================================================================
  -- 10. COPY broad_options (populate mapping)
  -- =========================================================================
  INSERT INTO _map_broad_options (old_id, new_id)
  SELECT id, gen_random_uuid()
    FROM public.broad_options
   WHERE estimate_id = p_source_estimate_id;

  INSERT INTO public.broad_options (
    id, estimate_id, name, description,
    sort_order, created_at, updated_at
  )
  SELECT
    mbo.new_id,
    v_new_estimate_id,
    bo.name, bo.description,
    bo.sort_order, now(), now()
  FROM public.broad_options bo
  JOIN _map_broad_options mbo ON mbo.old_id = bo.id;

  -- =========================================================================
  -- 11. COPY option_alternatives (populate mapping)
  -- =========================================================================
  INSERT INTO _map_option_alternatives (old_id, new_id)
  SELECT oa.id, gen_random_uuid()
    FROM public.option_alternatives oa
    JOIN public.option_groups og ON oa.group_id = og.id
   WHERE og.estimate_id = p_source_estimate_id;

  INSERT INTO public.option_alternatives (
    id, group_id, name, description,
    is_selected, price_adjustment, sort_order,
    created_at, updated_at
  )
  SELECT
    moa.new_id,                             -- remapped id
    mog.new_id,                             -- remapped group_id
    oa.name, oa.description,
    oa.is_selected,                         -- preserve selection state
    oa.price_adjustment,
    oa.sort_order, now(), now()
  FROM public.option_alternatives oa
  JOIN _map_option_alternatives moa ON moa.old_id = oa.id
  JOIN _map_option_groups mog ON mog.old_id = oa.group_id;

  -- =========================================================================
  -- 12. COPY broad_option_overrides
  -- =========================================================================
  INSERT INTO public.broad_option_overrides (
    id, broad_option_id, target_node_id,
    override_type, override_value, created_at
  )
  SELECT
    gen_random_uuid(),
    mbo.new_id,                             -- remapped broad_option_id
    mn.new_id,                              -- remapped target_node_id
    boo.override_type,
    boo.override_value,
    now()
  FROM public.broad_option_overrides boo
  JOIN _map_broad_options mbo ON mbo.old_id = boo.broad_option_id
  LEFT JOIN _map_nodes mn ON mn.old_id = boo.target_node_id;

  -- =========================================================================
  -- 13. COPY node_option_memberships (CRITICAL: both FKs remapped)
  -- =========================================================================
  INSERT INTO public.node_option_memberships (
    id, node_id, alternative_id, created_at
  )
  SELECT
    gen_random_uuid(),
    mn.new_id,                              -- remapped node_id
    moa.new_id,                             -- remapped alternative_id
    now()
  FROM public.node_option_memberships nom
  JOIN _map_nodes mn ON mn.old_id = nom.node_id
  JOIN _map_option_alternatives moa ON moa.old_id = nom.alternative_id;

  -- =========================================================================
  -- 14. COPY option_sets (populate mapping)
  -- =========================================================================
  INSERT INTO _map_option_sets (old_id, new_id)
  SELECT id, gen_random_uuid()
    FROM public.option_sets
   WHERE estimate_id = p_source_estimate_id;

  INSERT INTO public.option_sets (
    id, estimate_id, name, description,
    created_by, created_at, updated_at
  )
  SELECT
    mos.new_id,
    v_new_estimate_id,
    os.name, os.description,
    COALESCE(p_created_by, os.created_by),
    now(), now()
  FROM public.option_sets os
  JOIN _map_option_sets mos ON mos.old_id = os.id;

  -- =========================================================================
  -- 15. COPY option_set_selections (double remapping)
  -- =========================================================================
  INSERT INTO public.option_set_selections (
    id, option_set_id, alternative_id
  )
  SELECT
    gen_random_uuid(),
    mos.new_id,                             -- remapped option_set_id
    moa.new_id                              -- remapped alternative_id
  FROM public.option_set_selections oss
  JOIN _map_option_sets mos ON mos.old_id = oss.option_set_id
  JOIN _map_option_alternatives moa ON moa.old_id = oss.alternative_id;

  -- =========================================================================
  -- 16. COPY option_set_broad_selections (double remapping)
  -- Composite PK table: (option_set_id, broad_option_id)
  -- =========================================================================
  INSERT INTO public.option_set_broad_selections (
    option_set_id, broad_option_id
  )
  SELECT
    mos.new_id,                             -- remapped option_set_id
    mbo.new_id                              -- remapped broad_option_id
  FROM public.option_set_broad_selections osbs
  JOIN _map_option_sets mos ON mos.old_id = osbs.option_set_id
  JOIN _map_broad_options mbo ON mbo.old_id = osbs.broad_option_id;

  -- =========================================================================
  -- 17. RESET trigger bypass and return
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


-- ############################################################
--  3. create_estimate_snapshot() — with auth guard
-- ############################################################

CREATE OR REPLACE FUNCTION public.create_estimate_snapshot(
  p_estimate_id   UUID,
  p_name          VARCHAR(255),
  p_snapshot_type public.snapshot_type DEFAULT 'milestone',
  p_created_by    UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_snapshot_id       UUID;
  v_snapshot_data     JSONB;
  v_estimate_status   public.estimate_status;
  v_project_status    public.project_status;
  v_node_count        INTEGER;
  v_total_price       DECIMAL(15,4);
  v_nodes             JSONB;
  v_item_details      JSONB;
  v_assembly_details  JSONB;
  v_node_notes        JSONB;
  v_option_groups     JSONB;
  v_option_alts       JSONB;
  v_option_memberships JSONB;
  v_option_sets       JSONB;
  v_option_set_sels   JSONB;
  v_broad_options     JSONB;
  v_broad_overrides   JSONB;
  v_osbs              JSONB;
BEGIN
  -- AUTH GUARD: Only staff (owner/employee) may call this function
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'Permission denied: staff role required';
  END IF;

  -- Validate estimate exists and capture status context
  SELECT e.status, p.status
    INTO v_estimate_status, v_project_status
    FROM public.estimates e
    LEFT JOIN public.projects p ON p.id = e.project_id
   WHERE e.id = p_estimate_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estimate % not found', p_estimate_id;
  END IF;

  -- Serialize all nodes
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', n.id,
      'parent_id', n.parent_id,
      'sort_order', n.sort_order,
      'node_type', n.node_type,
      'name', n.name,
      'description', n.description,
      'client_visibility', n.client_visibility,
      'flagged', n.flagged,
      'was_auto_promoted', n.was_auto_promoted,
      'catalog_source_id', n.catalog_source_id,
      'total_price', n.total_price,
      'created_by', n.created_by,
      'created_at', n.created_at
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

  -- Serialize item details
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', d.id,
      'node_id', d.node_id,
      'quantity', d.quantity,
      'unit_id', d.unit_id,
      'unit_cost', d.unit_cost,
      'material_cost', d.material_cost,
      'labor_cost', d.labor_cost,
      'labor_hours', d.labor_hours,
      'labor_rate', d.labor_rate,
      'equipment_cost', d.equipment_cost,
      'subcontractor_cost', d.subcontractor_cost,
      'markup_rate', d.markup_rate,
      'overhead_rate', d.overhead_rate,
      'tax_rate', d.tax_rate,
      'is_allowance', d.is_allowance,
      'allowance_budget', d.allowance_budget,
      'allowance_status', d.allowance_status,
      'specifications', d.specifications,
      'purchasing_notes', d.purchasing_notes,
      'vendor_id', d.vendor_id,
      'archived_at', d.archived_at
    )
  ), '[]'::jsonb)
  INTO v_item_details
  FROM public.node_item_details d
  JOIN public.estimate_nodes n ON n.id = d.node_id
  WHERE n.estimate_id = p_estimate_id;

  -- Serialize assembly details
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', d.id,
      'node_id', d.node_id,
      'quantity', d.quantity,
      'unit_id', d.unit_id,
      'assembly_unit_cost', d.assembly_unit_cost,
      'ratio_base', d.ratio_base,
      'specifications', d.specifications,
      'archived_at', d.archived_at
    )
  ), '[]'::jsonb)
  INTO v_assembly_details
  FROM public.node_assembly_details d
  JOIN public.estimate_nodes n ON n.id = d.node_id
  WHERE n.estimate_id = p_estimate_id;

  -- Serialize node notes (exclude soft-deleted)
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

  -- Serialize option groups
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', og.id,
      'name', og.name,
      'description', og.description,
      'group_type', og.group_type,
      'sort_order', og.sort_order,
      'created_at', og.created_at
    )
  ), '[]'::jsonb)
  INTO v_option_groups
  FROM public.option_groups og
  WHERE og.estimate_id = p_estimate_id;

  -- Serialize option alternatives
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', oa.id,
      'group_id', oa.group_id,
      'name', oa.name,
      'description', oa.description,
      'is_selected', oa.is_selected,
      'price_adjustment', oa.price_adjustment,
      'sort_order', oa.sort_order
    )
  ), '[]'::jsonb)
  INTO v_option_alts
  FROM public.option_alternatives oa
  JOIN public.option_groups og ON og.id = oa.group_id
  WHERE og.estimate_id = p_estimate_id;

  -- Serialize option memberships
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', nom.id,
      'node_id', nom.node_id,
      'alternative_id', nom.alternative_id
    )
  ), '[]'::jsonb)
  INTO v_option_memberships
  FROM public.node_option_memberships nom
  JOIN public.estimate_nodes n ON n.id = nom.node_id
  WHERE n.estimate_id = p_estimate_id;

  -- Serialize option sets
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', os.id,
      'name', os.name,
      'description', os.description,
      'created_by', os.created_by
    )
  ), '[]'::jsonb)
  INTO v_option_sets
  FROM public.option_sets os
  WHERE os.estimate_id = p_estimate_id;

  -- Serialize option set selections
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', oss.id,
      'option_set_id', oss.option_set_id,
      'alternative_id', oss.alternative_id
    )
  ), '[]'::jsonb)
  INTO v_option_set_sels
  FROM public.option_set_selections oss
  JOIN public.option_sets os ON os.id = oss.option_set_id
  WHERE os.estimate_id = p_estimate_id;

  -- Serialize broad options
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', bo.id,
      'name', bo.name,
      'description', bo.description,
      'sort_order', bo.sort_order
    )
  ), '[]'::jsonb)
  INTO v_broad_options
  FROM public.broad_options bo
  WHERE bo.estimate_id = p_estimate_id;

  -- Serialize broad option overrides
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', boo.id,
      'broad_option_id', boo.broad_option_id,
      'target_node_id', boo.target_node_id,
      'override_type', boo.override_type,
      'override_value', boo.override_value
    )
  ), '[]'::jsonb)
  INTO v_broad_overrides
  FROM public.broad_option_overrides boo
  JOIN public.broad_options bo ON bo.id = boo.broad_option_id
  WHERE bo.estimate_id = p_estimate_id;

  -- Serialize option set broad selections
  -- Composite PK table: (option_set_id, broad_option_id)
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'option_set_id', osbs.option_set_id,
      'broad_option_id', osbs.broad_option_id
    )
  ), '[]'::jsonb)
  INTO v_osbs
  FROM public.option_set_broad_selections osbs
  JOIN public.option_sets os ON os.id = osbs.option_set_id
  WHERE os.estimate_id = p_estimate_id;

  -- Assemble full snapshot JSONB
  v_snapshot_data := jsonb_build_object(
    'schema_version', public.current_snapshot_schema_version(),
    'serialized_at', now(),
    'nodes', v_nodes,
    'item_details', v_item_details,
    'assembly_details', v_assembly_details,
    'node_notes', v_node_notes,
    'option_groups', v_option_groups,
    'option_alternatives', v_option_alts,
    'option_memberships', v_option_memberships,
    'option_sets', v_option_sets,
    'option_set_selections', v_option_set_sels,
    'broad_options', v_broad_options,
    'broad_option_overrides', v_broad_overrides,
    'option_set_broad_selections', v_osbs
  );

  -- Insert the snapshot
  INSERT INTO public.estimate_snapshots (
    id, estimate_id, name, snapshot_type,
    estimate_status_at_time, project_status_at_time,
    snapshot_data, schema_version, node_count, total_price,
    created_by, created_at
  ) VALUES (
    gen_random_uuid(),
    p_estimate_id,
    p_name,
    p_snapshot_type,
    v_estimate_status,
    v_project_status,
    v_snapshot_data,
    public.current_snapshot_schema_version(),
    v_node_count,
    v_total_price,
    p_created_by,
    now()
  )
  RETURNING id INTO v_snapshot_id;

  RETURN v_snapshot_id;
END;
$$;


-- ############################################################
--  4. restore_estimate_snapshot() — with auth guard
-- ############################################################

CREATE OR REPLACE FUNCTION public.restore_estimate_snapshot(
  p_snapshot_id  UUID,
  p_restored_by  UUID DEFAULT NULL,
  p_force        BOOLEAN DEFAULT FALSE
)
RETURNS UUID  -- Returns the checkpoint snapshot ID of the auto-saved state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_estimate_id              UUID;
  v_estimate_status          public.estimate_status;
  v_snapshot_data            JSONB;
  v_snapshot_schema_version  INTEGER;
  v_checkpoint_id            UUID;
  v_lock_key                 BIGINT;
  v_rec                      JSONB;
BEGIN
  -- AUTH GUARD: Only staff (owner/employee) may call this function
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'Permission denied: staff role required';
  END IF;

  -- 1. Load and validate snapshot
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

  -- 2. Schema version check
  IF v_snapshot_schema_version > public.current_snapshot_schema_version() THEN
    RAISE EXCEPTION
      'Snapshot schema version % is newer than current version %. Cannot restore.',
      v_snapshot_schema_version, public.current_snapshot_schema_version();
  END IF;

  IF v_snapshot_schema_version < public.current_snapshot_schema_version() THEN
    -- Future: apply migration chain here (v1->v2->...->current)
    RAISE EXCEPTION
      'Snapshot migration from v% to v% not yet implemented.',
      v_snapshot_schema_version, public.current_snapshot_schema_version();
  END IF;

  -- 3. Check estimate status guards
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
      'Cannot restore snapshot over a complete estimate. Use create_estimate_from_snapshot() instead.';
  END IF;

  -- Require force flag for active estimates
  IF v_estimate_status = 'active' AND NOT p_force THEN
    RAISE EXCEPTION
      'Estimate is active. Pass p_force := true to confirm, or use create_estimate_from_snapshot().';
  END IF;

  -- 4. Acquire advisory lock (prevent concurrent restores)
  v_lock_key := hashtext(v_estimate_id::text);

  IF NOT pg_try_advisory_xact_lock(v_lock_key) THEN
    RAISE EXCEPTION
      'Another restore operation is in progress for estimate %. Please try again.',
      v_estimate_id;
  END IF;

  -- 5. Auto-save current state as checkpoint
  v_checkpoint_id := public.create_estimate_snapshot(
    p_estimate_id   := v_estimate_id,
    p_name          := 'Auto-save before restore at ' || to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
    p_snapshot_type := 'checkpoint',
    p_created_by    := p_restored_by
  );

  -- 6. Bypass triggers during bulk delete/insert
  SET LOCAL app.is_snapshot_copy = 'true';

  -- 7. Delete all current estimate data
  -- option_set_broad_selections (composite PK)
  DELETE FROM public.option_set_broad_selections osbs
    USING public.option_sets os
    WHERE osbs.option_set_id = os.id AND os.estimate_id = v_estimate_id;

  -- option_set_selections
  DELETE FROM public.option_set_selections oss
    USING public.option_sets os
    WHERE oss.option_set_id = os.id AND os.estimate_id = v_estimate_id;

  -- option_sets
  DELETE FROM public.option_sets
    WHERE estimate_id = v_estimate_id;

  -- node_option_memberships (via node)
  DELETE FROM public.node_option_memberships nom
    USING public.estimate_nodes en
    WHERE nom.node_id = en.id AND en.estimate_id = v_estimate_id;

  -- option_alternatives (via group)
  DELETE FROM public.option_alternatives oa
    USING public.option_groups og
    WHERE oa.group_id = og.id AND og.estimate_id = v_estimate_id;

  -- broad_option_overrides
  DELETE FROM public.broad_option_overrides boo
    USING public.broad_options bo
    WHERE boo.broad_option_id = bo.id AND bo.estimate_id = v_estimate_id;

  -- broad_options
  DELETE FROM public.broad_options
    WHERE estimate_id = v_estimate_id;

  -- option_groups
  DELETE FROM public.option_groups
    WHERE estimate_id = v_estimate_id;

  -- node_notes
  DELETE FROM public.node_notes nn
    USING public.estimate_nodes en
    WHERE nn.node_id = en.id AND en.estimate_id = v_estimate_id;

  -- node_assembly_details
  DELETE FROM public.node_assembly_details nad
    USING public.estimate_nodes en
    WHERE nad.node_id = en.id AND en.estimate_id = v_estimate_id;

  -- node_item_details
  DELETE FROM public.node_item_details nid
    USING public.estimate_nodes en
    WHERE nid.node_id = en.id AND en.estimate_id = v_estimate_id;

  -- estimate_nodes last
  DELETE FROM public.estimate_nodes
    WHERE estimate_id = v_estimate_id;

  -- 8. Deserialize nodes (two-pass for parent_id FK)
  -- Pass 1: Insert all nodes WITHOUT parent_id
  FOR v_rec IN SELECT * FROM jsonb_array_elements(v_snapshot_data->'nodes')
  LOOP
    INSERT INTO public.estimate_nodes (
      id, estimate_id, parent_id, sort_order,
      node_type, name, description,
      client_visibility, flagged, was_auto_promoted,
      catalog_source_id, total_price,
      created_by, created_at, updated_at
    ) VALUES (
      (v_rec->>'id')::uuid,
      v_estimate_id,
      NULL,  -- parent_id set in pass 2
      COALESCE((v_rec->>'sort_order')::integer, 0),
      (v_rec->>'node_type')::public.node_type,
      v_rec->>'name',
      v_rec->>'description',
      COALESCE((v_rec->>'client_visibility')::public.client_visibility, 'visible'),
      COALESCE((v_rec->>'flagged')::boolean, false),
      COALESCE((v_rec->>'was_auto_promoted')::boolean, false),
      (v_rec->>'catalog_source_id')::uuid,
      COALESCE((v_rec->>'total_price')::decimal, 0),
      (v_rec->>'created_by')::uuid,
      COALESCE((v_rec->>'created_at')::timestamptz, now()),
      now()
    );
  END LOOP;

  -- Pass 2: Set parent_id for non-root nodes
  FOR v_rec IN SELECT * FROM jsonb_array_elements(v_snapshot_data->'nodes')
  LOOP
    IF v_rec->>'parent_id' IS NOT NULL THEN
      UPDATE public.estimate_nodes
      SET parent_id = (v_rec->>'parent_id')::uuid
      WHERE id = (v_rec->>'id')::uuid;
    END IF;
  END LOOP;

  -- 9. Rebuild ltree paths
  WITH RECURSIVE path_builder AS (
    SELECT id, id::text::public.ltree AS computed_path
      FROM public.estimate_nodes
     WHERE estimate_id = v_estimate_id
       AND parent_id IS NULL
    UNION ALL
    SELECT en.id, pb.computed_path || en.id::text
      FROM public.estimate_nodes en
      JOIN path_builder pb ON en.parent_id = pb.id
     WHERE en.estimate_id = v_estimate_id
  )
  UPDATE public.estimate_nodes en
     SET path = pb.computed_path
    FROM path_builder pb
   WHERE en.id = pb.id;

  -- 10. Deserialize item details
  FOR v_rec IN SELECT * FROM jsonb_array_elements(v_snapshot_data->'item_details')
  LOOP
    INSERT INTO public.node_item_details (
      id, node_id, quantity, unit_id, unit_cost,
      material_cost, labor_cost, labor_hours, labor_rate,
      equipment_cost, subcontractor_cost,
      markup_rate, overhead_rate, tax_rate,
      is_allowance, allowance_budget, allowance_status,
      specifications, purchasing_notes,
      vendor_id, archived_at,
      created_at, updated_at
    ) VALUES (
      COALESCE((v_rec->>'id')::uuid, gen_random_uuid()),
      (v_rec->>'node_id')::uuid,
      COALESCE((v_rec->>'quantity')::decimal, 0),
      (v_rec->>'unit_id')::uuid,
      COALESCE((v_rec->>'unit_cost')::decimal, 0),
      COALESCE((v_rec->>'material_cost')::decimal, 0),
      COALESCE((v_rec->>'labor_cost')::decimal, 0),
      COALESCE((v_rec->>'labor_hours')::decimal, 0),
      COALESCE((v_rec->>'labor_rate')::decimal, 0),
      COALESCE((v_rec->>'equipment_cost')::decimal, 0),
      COALESCE((v_rec->>'subcontractor_cost')::decimal, 0),
      (v_rec->>'markup_rate')::decimal,
      (v_rec->>'overhead_rate')::decimal,
      (v_rec->>'tax_rate')::decimal,
      COALESCE((v_rec->>'is_allowance')::boolean, false),
      (v_rec->>'allowance_budget')::decimal,
      v_rec->>'allowance_status',
      v_rec->>'specifications',
      v_rec->>'purchasing_notes',
      (v_rec->>'vendor_id')::uuid,
      (v_rec->>'archived_at')::timestamptz,
      now(), now()
    );
  END LOOP;

  -- 11. Deserialize assembly details
  FOR v_rec IN SELECT * FROM jsonb_array_elements(v_snapshot_data->'assembly_details')
  LOOP
    INSERT INTO public.node_assembly_details (
      id, node_id, quantity, unit_id, assembly_unit_cost,
      ratio_base, specifications, archived_at,
      created_at, updated_at
    ) VALUES (
      COALESCE((v_rec->>'id')::uuid, gen_random_uuid()),
      (v_rec->>'node_id')::uuid,
      COALESCE((v_rec->>'quantity')::decimal, 1),
      (v_rec->>'unit_id')::uuid,
      COALESCE((v_rec->>'assembly_unit_cost')::decimal, 0),
      COALESCE(v_rec->>'ratio_base', 'quantity'),
      v_rec->>'specifications',
      (v_rec->>'archived_at')::timestamptz,
      now(), now()
    );
  END LOOP;

  -- 12. Deserialize node notes
  FOR v_rec IN SELECT * FROM jsonb_array_elements(v_snapshot_data->'node_notes')
  LOOP
    INSERT INTO public.node_notes (
      id, node_id, body, format,
      is_internal, is_client_visible,
      created_by, created_at, updated_at
    ) VALUES (
      (v_rec->>'id')::uuid,
      (v_rec->>'node_id')::uuid,
      v_rec->>'body',
      COALESCE(v_rec->>'format', 'markdown'),
      COALESCE((v_rec->>'is_internal')::boolean, true),
      COALESCE((v_rec->>'is_client_visible')::boolean, false),
      (v_rec->>'created_by')::uuid,
      COALESCE((v_rec->>'created_at')::timestamptz, now()),
      now()
    );
  END LOOP;

  -- 13. Deserialize option groups
  FOR v_rec IN SELECT * FROM jsonb_array_elements(v_snapshot_data->'option_groups')
  LOOP
    INSERT INTO public.option_groups (
      id, estimate_id, name, description,
      group_type, sort_order,
      created_at, updated_at
    ) VALUES (
      (v_rec->>'id')::uuid,
      v_estimate_id,
      v_rec->>'name',
      v_rec->>'description',
      COALESCE((v_rec->>'group_type')::public.option_group_type, 'selection'),
      COALESCE((v_rec->>'sort_order')::integer, 0),
      COALESCE((v_rec->>'created_at')::timestamptz, now()),
      now()
    );
  END LOOP;

  -- 14. Deserialize option alternatives
  FOR v_rec IN SELECT * FROM jsonb_array_elements(v_snapshot_data->'option_alternatives')
  LOOP
    INSERT INTO public.option_alternatives (
      id, group_id, name, description,
      is_selected, price_adjustment, sort_order,
      created_at, updated_at
    ) VALUES (
      (v_rec->>'id')::uuid,
      (v_rec->>'group_id')::uuid,
      v_rec->>'name',
      v_rec->>'description',
      COALESCE((v_rec->>'is_selected')::boolean, false),
      COALESCE((v_rec->>'price_adjustment')::decimal, 0),
      COALESCE((v_rec->>'sort_order')::integer, 0),
      now(), now()
    );
  END LOOP;

  -- 15. Deserialize option memberships
  FOR v_rec IN SELECT * FROM jsonb_array_elements(v_snapshot_data->'option_memberships')
  LOOP
    INSERT INTO public.node_option_memberships (
      id, node_id, alternative_id, created_at
    ) VALUES (
      (v_rec->>'id')::uuid,
      (v_rec->>'node_id')::uuid,
      (v_rec->>'alternative_id')::uuid,
      now()
    );
  END LOOP;

  -- 16. Deserialize broad options
  FOR v_rec IN SELECT * FROM jsonb_array_elements(v_snapshot_data->'broad_options')
  LOOP
    INSERT INTO public.broad_options (
      id, estimate_id, name, description,
      sort_order, created_at, updated_at
    ) VALUES (
      (v_rec->>'id')::uuid,
      v_estimate_id,
      v_rec->>'name',
      v_rec->>'description',
      COALESCE((v_rec->>'sort_order')::integer, 0),
      now(), now()
    );
  END LOOP;

  -- 17. Deserialize broad option overrides
  FOR v_rec IN SELECT * FROM jsonb_array_elements(v_snapshot_data->'broad_option_overrides')
  LOOP
    INSERT INTO public.broad_option_overrides (
      id, broad_option_id, target_node_id,
      override_type, override_value, created_at
    ) VALUES (
      (v_rec->>'id')::uuid,
      (v_rec->>'broad_option_id')::uuid,
      (v_rec->>'target_node_id')::uuid,
      v_rec->>'override_type',
      (v_rec->'override_value'),  -- JSONB column, keep as jsonb
      now()
    );
  END LOOP;

  -- 18. Deserialize option sets
  FOR v_rec IN SELECT * FROM jsonb_array_elements(v_snapshot_data->'option_sets')
  LOOP
    INSERT INTO public.option_sets (
      id, estimate_id, name, description,
      created_by, created_at, updated_at
    ) VALUES (
      (v_rec->>'id')::uuid,
      v_estimate_id,
      v_rec->>'name',
      v_rec->>'description',
      (v_rec->>'created_by')::uuid,
      now(), now()
    );
  END LOOP;

  -- 19. Deserialize option set selections
  FOR v_rec IN SELECT * FROM jsonb_array_elements(v_snapshot_data->'option_set_selections')
  LOOP
    INSERT INTO public.option_set_selections (
      id, option_set_id, alternative_id
    ) VALUES (
      (v_rec->>'id')::uuid,
      (v_rec->>'option_set_id')::uuid,
      (v_rec->>'alternative_id')::uuid
    );
  END LOOP;

  -- 20. Deserialize option set broad selections
  FOR v_rec IN SELECT * FROM jsonb_array_elements(v_snapshot_data->'option_set_broad_selections')
  LOOP
    INSERT INTO public.option_set_broad_selections (
      option_set_id, broad_option_id
    ) VALUES (
      (v_rec->>'option_set_id')::uuid,
      (v_rec->>'broad_option_id')::uuid
    );
  END LOOP;

  -- 21. Reset trigger bypass
  RESET app.is_snapshot_copy;

  RETURN v_checkpoint_id;
END;
$$;


-- ############################################################
--  5. create_estimate_from_snapshot() — with auth guard
-- ############################################################

CREATE OR REPLACE FUNCTION public.create_estimate_from_snapshot(
  p_snapshot_id  UUID,
  p_new_name     TEXT,
  p_created_by   UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_source_estimate_id  UUID;
  v_new_estimate_id     UUID;
  v_snapshot_data       JSONB;
  v_schema_version      INTEGER;
  v_source_project_id   UUID;
  v_source_version      INTEGER;
  v_source_vg_id        UUID;
  v_rec                 JSONB;
BEGIN
  -- AUTH GUARD: Only staff (owner/employee) may call this function
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'Permission denied: staff role required';
  END IF;

  -- 1. Load and validate snapshot
  SELECT s.estimate_id, s.snapshot_data, s.schema_version
    INTO v_source_estimate_id, v_snapshot_data, v_schema_version
    FROM public.estimate_snapshots s
   WHERE s.id = p_snapshot_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Snapshot % not found', p_snapshot_id;
  END IF;

  -- Schema version check
  IF v_schema_version > public.current_snapshot_schema_version() THEN
    RAISE EXCEPTION
      'Snapshot schema version % is newer than current version %. Cannot create estimate.',
      v_schema_version, public.current_snapshot_schema_version();
  END IF;

  IF v_schema_version < public.current_snapshot_schema_version() THEN
    RAISE EXCEPTION
      'Snapshot migration from v% to v% not yet implemented.',
      v_schema_version, public.current_snapshot_schema_version();
  END IF;

  -- 2. Get source estimate info
  SELECT project_id, version_group_id, version
    INTO v_source_project_id, v_source_vg_id, v_source_version
    FROM public.estimates
   WHERE id = v_source_estimate_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source estimate % not found', v_source_estimate_id;
  END IF;

  -- 3. Bypass triggers
  SET LOCAL app.is_snapshot_copy = 'true';

  -- 4. Create ID mapping temp tables
  CREATE TEMP TABLE _sfmap_nodes (
    old_id UUID PRIMARY KEY,
    new_id UUID NOT NULL
  ) ON COMMIT DROP;

  CREATE TEMP TABLE _sfmap_option_groups (
    old_id UUID PRIMARY KEY,
    new_id UUID NOT NULL
  ) ON COMMIT DROP;

  CREATE TEMP TABLE _sfmap_option_alternatives (
    old_id UUID PRIMARY KEY,
    new_id UUID NOT NULL
  ) ON COMMIT DROP;

  CREATE TEMP TABLE _sfmap_broad_options (
    old_id UUID PRIMARY KEY,
    new_id UUID NOT NULL
  ) ON COMMIT DROP;

  CREATE TEMP TABLE _sfmap_option_sets (
    old_id UUID PRIMARY KEY,
    new_id UUID NOT NULL
  ) ON COMMIT DROP;

  -- 5. Create new estimate row
  v_new_estimate_id := gen_random_uuid();

  INSERT INTO public.estimates (
    id, project_id, name, description, status,
    version, version_group_id,
    default_markup_rate, default_overhead_rate,
    default_contingency_rate, default_tax_rate,
    notes, created_by, created_at, updated_at
  )
  SELECT
    v_new_estimate_id,
    project_id,
    p_new_name,
    description,
    'draft',  -- new estimates from snapshots always start as draft
    COALESCE(v_source_version, 1) + 1,
    COALESCE(version_group_id, v_source_estimate_id),
    default_markup_rate,
    default_overhead_rate,
    default_contingency_rate,
    default_tax_rate,
    notes,
    p_created_by,
    now(), now()
  FROM public.estimates
  WHERE id = v_source_estimate_id;

  -- 6. Build node ID mappings from snapshot data
  INSERT INTO _sfmap_nodes (old_id, new_id)
  SELECT (n->>'id')::uuid, gen_random_uuid()
  FROM jsonb_array_elements(v_snapshot_data->'nodes') AS n;

  -- 7. Insert nodes with remapped IDs (no parent_id first)
  INSERT INTO public.estimate_nodes (
    id, estimate_id, parent_id, sort_order,
    node_type, name, description,
    client_visibility, flagged, was_auto_promoted,
    catalog_source_id, total_price,
    created_by, created_at, updated_at
  )
  SELECT
    mn.new_id,
    v_new_estimate_id,
    NULL,  -- parent_id set after all nodes exist
    COALESCE((n->>'sort_order')::integer, 0),
    (n->>'node_type')::public.node_type,
    n->>'name',
    n->>'description',
    COALESCE((n->>'client_visibility')::public.client_visibility, 'visible'),
    COALESCE((n->>'flagged')::boolean, false),
    COALESCE((n->>'was_auto_promoted')::boolean, false),
    (n->>'catalog_source_id')::uuid,
    COALESCE((n->>'total_price')::decimal, 0),
    p_created_by,
    now(), now()
  FROM jsonb_array_elements(v_snapshot_data->'nodes') AS n
  JOIN _sfmap_nodes mn ON mn.old_id = (n->>'id')::uuid;

  -- Set parent_id using remapped IDs
  UPDATE public.estimate_nodes en
  SET parent_id = mp.new_id
  FROM jsonb_array_elements(v_snapshot_data->'nodes') AS n,
       _sfmap_nodes mn,
       _sfmap_nodes mp
  WHERE (n->>'parent_id') IS NOT NULL
    AND mn.old_id = (n->>'id')::uuid
    AND mp.old_id = (n->>'parent_id')::uuid
    AND en.id = mn.new_id;

  -- 8. Rebuild ltree paths
  WITH RECURSIVE path_builder AS (
    SELECT id, id::text::public.ltree AS computed_path
      FROM public.estimate_nodes
     WHERE estimate_id = v_new_estimate_id
       AND parent_id IS NULL
    UNION ALL
    SELECT en.id, pb.computed_path || en.id::text
      FROM public.estimate_nodes en
      JOIN path_builder pb ON en.parent_id = pb.id
     WHERE en.estimate_id = v_new_estimate_id
  )
  UPDATE public.estimate_nodes en
     SET path = pb.computed_path
    FROM path_builder pb
   WHERE en.id = pb.id;

  -- 9. Insert item details with remapped node_id
  INSERT INTO public.node_item_details (
    id, node_id, quantity, unit_id, unit_cost,
    material_cost, labor_cost, labor_hours, labor_rate,
    equipment_cost, subcontractor_cost,
    markup_rate, overhead_rate, tax_rate,
    is_allowance, allowance_budget, allowance_status,
    specifications, purchasing_notes,
    vendor_id, archived_at,
    created_at, updated_at
  )
  SELECT
    gen_random_uuid(),
    mn.new_id,
    COALESCE((d->>'quantity')::decimal, 0),
    (d->>'unit_id')::uuid,
    COALESCE((d->>'unit_cost')::decimal, 0),
    COALESCE((d->>'material_cost')::decimal, 0),
    COALESCE((d->>'labor_cost')::decimal, 0),
    COALESCE((d->>'labor_hours')::decimal, 0),
    COALESCE((d->>'labor_rate')::decimal, 0),
    COALESCE((d->>'equipment_cost')::decimal, 0),
    COALESCE((d->>'subcontractor_cost')::decimal, 0),
    (d->>'markup_rate')::decimal,
    (d->>'overhead_rate')::decimal,
    (d->>'tax_rate')::decimal,
    COALESCE((d->>'is_allowance')::boolean, false),
    (d->>'allowance_budget')::decimal,
    d->>'allowance_status',
    d->>'specifications',
    d->>'purchasing_notes',
    (d->>'vendor_id')::uuid,
    (d->>'archived_at')::timestamptz,
    now(), now()
  FROM jsonb_array_elements(v_snapshot_data->'item_details') AS d
  JOIN _sfmap_nodes mn ON mn.old_id = (d->>'node_id')::uuid;

  -- 10. Insert assembly details with remapped node_id
  INSERT INTO public.node_assembly_details (
    id, node_id, quantity, unit_id, assembly_unit_cost,
    ratio_base, specifications, archived_at,
    created_at, updated_at
  )
  SELECT
    gen_random_uuid(),
    mn.new_id,
    COALESCE((d->>'quantity')::decimal, 1),
    (d->>'unit_id')::uuid,
    COALESCE((d->>'assembly_unit_cost')::decimal, 0),
    COALESCE(d->>'ratio_base', 'quantity'),
    d->>'specifications',
    (d->>'archived_at')::timestamptz,
    now(), now()
  FROM jsonb_array_elements(v_snapshot_data->'assembly_details') AS d
  JOIN _sfmap_nodes mn ON mn.old_id = (d->>'node_id')::uuid;

  -- 11. Insert notes with remapped node_id
  INSERT INTO public.node_notes (
    id, node_id, body, format,
    is_internal, is_client_visible,
    created_by, created_at, updated_at
  )
  SELECT
    gen_random_uuid(),
    mn.new_id,
    d->>'body',
    COALESCE(d->>'format', 'markdown'),
    COALESCE((d->>'is_internal')::boolean, true),
    COALESCE((d->>'is_client_visible')::boolean, false),
    p_created_by,
    COALESCE((d->>'created_at')::timestamptz, now()),
    now()
  FROM jsonb_array_elements(v_snapshot_data->'node_notes') AS d
  JOIN _sfmap_nodes mn ON mn.old_id = (d->>'node_id')::uuid;

  -- 12. Build option group mappings and insert
  INSERT INTO _sfmap_option_groups (old_id, new_id)
  SELECT (og->>'id')::uuid, gen_random_uuid()
  FROM jsonb_array_elements(v_snapshot_data->'option_groups') AS og;

  INSERT INTO public.option_groups (
    id, estimate_id, name, description,
    group_type, sort_order,
    created_at, updated_at
  )
  SELECT
    mog.new_id,
    v_new_estimate_id,
    og->>'name',
    og->>'description',
    COALESCE((og->>'group_type')::public.option_group_type, 'selection'),
    COALESCE((og->>'sort_order')::integer, 0),
    now(), now()
  FROM jsonb_array_elements(v_snapshot_data->'option_groups') AS og
  JOIN _sfmap_option_groups mog ON mog.old_id = (og->>'id')::uuid;

  -- 13. Build alternative mappings and insert
  INSERT INTO _sfmap_option_alternatives (old_id, new_id)
  SELECT (oa->>'id')::uuid, gen_random_uuid()
  FROM jsonb_array_elements(v_snapshot_data->'option_alternatives') AS oa;

  INSERT INTO public.option_alternatives (
    id, group_id, name, description,
    is_selected, price_adjustment, sort_order,
    created_at, updated_at
  )
  SELECT
    moa.new_id,
    mog.new_id,  -- remapped group_id
    oa->>'name',
    oa->>'description',
    COALESCE((oa->>'is_selected')::boolean, false),
    COALESCE((oa->>'price_adjustment')::decimal, 0),
    COALESCE((oa->>'sort_order')::integer, 0),
    now(), now()
  FROM jsonb_array_elements(v_snapshot_data->'option_alternatives') AS oa
  JOIN _sfmap_option_alternatives moa ON moa.old_id = (oa->>'id')::uuid
  JOIN _sfmap_option_groups mog ON mog.old_id = (oa->>'group_id')::uuid;

  -- 14. Insert option memberships (double remapping)
  INSERT INTO public.node_option_memberships (
    id, node_id, alternative_id, created_at
  )
  SELECT
    gen_random_uuid(),
    mn.new_id,
    moa.new_id,
    now()
  FROM jsonb_array_elements(v_snapshot_data->'option_memberships') AS m
  JOIN _sfmap_nodes mn ON mn.old_id = (m->>'node_id')::uuid
  JOIN _sfmap_option_alternatives moa ON moa.old_id = (m->>'alternative_id')::uuid;

  -- 15. Build broad option mappings and insert
  INSERT INTO _sfmap_broad_options (old_id, new_id)
  SELECT (bo->>'id')::uuid, gen_random_uuid()
  FROM jsonb_array_elements(v_snapshot_data->'broad_options') AS bo;

  INSERT INTO public.broad_options (
    id, estimate_id, name, description,
    sort_order, created_at, updated_at
  )
  SELECT
    mbo.new_id,
    v_new_estimate_id,
    bo->>'name',
    bo->>'description',
    COALESCE((bo->>'sort_order')::integer, 0),
    now(), now()
  FROM jsonb_array_elements(v_snapshot_data->'broad_options') AS bo
  JOIN _sfmap_broad_options mbo ON mbo.old_id = (bo->>'id')::uuid;

  -- 16. Insert broad option overrides (remapped)
  INSERT INTO public.broad_option_overrides (
    id, broad_option_id, target_node_id,
    override_type, override_value, created_at
  )
  SELECT
    gen_random_uuid(),
    mbo.new_id,
    mn.new_id,
    boo->>'override_type',
    (boo->'override_value'),  -- JSONB column
    now()
  FROM jsonb_array_elements(v_snapshot_data->'broad_option_overrides') AS boo
  JOIN _sfmap_broad_options mbo ON mbo.old_id = (boo->>'broad_option_id')::uuid
  LEFT JOIN _sfmap_nodes mn ON mn.old_id = (boo->>'target_node_id')::uuid;

  -- 17. Build option set mappings and insert
  INSERT INTO _sfmap_option_sets (old_id, new_id)
  SELECT (os->>'id')::uuid, gen_random_uuid()
  FROM jsonb_array_elements(v_snapshot_data->'option_sets') AS os;

  INSERT INTO public.option_sets (
    id, estimate_id, name, description,
    created_by, created_at, updated_at
  )
  SELECT
    mos.new_id,
    v_new_estimate_id,
    os->>'name',
    os->>'description',
    p_created_by,
    now(), now()
  FROM jsonb_array_elements(v_snapshot_data->'option_sets') AS os
  JOIN _sfmap_option_sets mos ON mos.old_id = (os->>'id')::uuid;

  -- 18. Insert option set selections (double remapping)
  INSERT INTO public.option_set_selections (
    id, option_set_id, alternative_id
  )
  SELECT
    gen_random_uuid(),
    mos.new_id,
    moa.new_id
  FROM jsonb_array_elements(v_snapshot_data->'option_set_selections') AS oss
  JOIN _sfmap_option_sets mos ON mos.old_id = (oss->>'option_set_id')::uuid
  JOIN _sfmap_option_alternatives moa ON moa.old_id = (oss->>'alternative_id')::uuid;

  -- 19. Insert option set broad selections (double remapping)
  INSERT INTO public.option_set_broad_selections (
    option_set_id, broad_option_id
  )
  SELECT
    mos.new_id,
    mbo.new_id
  FROM jsonb_array_elements(v_snapshot_data->'option_set_broad_selections') AS osbs
  JOIN _sfmap_option_sets mos ON mos.old_id = (osbs->>'option_set_id')::uuid
  JOIN _sfmap_broad_options mbo ON mbo.old_id = (osbs->>'broad_option_id')::uuid;

  -- 20. Reset trigger bypass
  RESET app.is_snapshot_copy;

  RETURN v_new_estimate_id;

EXCEPTION
  WHEN OTHERS THEN
    RESET app.is_snapshot_copy;
    RAISE;
END;
$$;
