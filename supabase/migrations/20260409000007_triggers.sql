-- Phase 1A-6: Triggers
-- Creates trigger functions for tree path maintenance, auto-promotion/demotion,
-- data integrity constraints, snapshot immutability, and company_settings singleton.
--
-- Depends on:
--   20260409000003_reference_and_core_tables.sql  (estimate_nodes, node_item_details,
--                                                  node_assembly_details)
--   20260409000004_supporting_tables.sql          (company_settings)
--   20260409000006_client_sharing_tables.sql      (estimate_snapshots)
--
-- Bypass mechanism:
--   Triggers that participate in bulk operations (deep-copy, snapshot restore)
--   check current_setting('app.is_snapshot_copy', true) = 'true' and skip
--   their logic when active. This is set via SET LOCAL inside
--   deep_copy_estimate() and restore_estimate_snapshot().
--   No other bypass variable names are used.


-- ============================================================
-- 1. maintain_node_path()
--    BEFORE INSERT OR UPDATE on estimate_nodes
--    Maintains the ltree `path` column from the parent chain.
--    BYPASSABLE — snapshot copy skips path maintenance;
--                 paths are rebuilt after bulk insert.
--    References: estimate_nodes (self-referencing parent lookup)
-- ============================================================
CREATE OR REPLACE FUNCTION public.maintain_node_path()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Bypass during deep-copy / snapshot operations
  IF current_setting('app.is_snapshot_copy', true) = 'true' THEN
    RETURN NEW;
  END IF;

  -- Compute path for this node
  IF NEW.parent_id IS NULL THEN
    -- Root node: single-segment path using own id
    NEW.path = NEW.id::text::ltree;
  ELSE
    -- Child node: parent_path || own id
    SELECT path || NEW.id::text INTO NEW.path
    FROM public.estimate_nodes
    WHERE id = NEW.parent_id;
  END IF;

  -- On UPDATE of parent_id: recursively update all descendants' paths
  IF TG_OP = 'UPDATE' AND OLD.parent_id IS DISTINCT FROM NEW.parent_id THEN
    WITH RECURSIVE descendants AS (
      SELECT id, parent_id
      FROM public.estimate_nodes
      WHERE parent_id = NEW.id
      UNION ALL
      SELECT en.id, en.parent_id
      FROM public.estimate_nodes en
      JOIN descendants d ON en.parent_id = d.id
    )
    UPDATE public.estimate_nodes
    SET path = NEW.path || subpath(path, nlevel(OLD.path))
    WHERE id IN (SELECT id FROM descendants);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_maintain_node_path
  BEFORE INSERT OR UPDATE ON public.estimate_nodes
  FOR EACH ROW
  EXECUTE FUNCTION public.maintain_node_path();


-- ============================================================
-- 2. auto_promote_item_parent()
--    AFTER INSERT on estimate_nodes
--    When a child is inserted under a node with node_type = 'item':
--      - Change parent node_type to 'group'
--      - Set parent's was_auto_promoted = TRUE
--      - Archive parent's node_item_details (set archived_at = now())
--    Skips if parent is already group or assembly.
--    BYPASSABLE — snapshot copy skips auto-promotion.
--    References: estimate_nodes, node_item_details
-- ============================================================
CREATE OR REPLACE FUNCTION public.auto_promote_item_parent()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_parent_type public.node_type;
BEGIN
  -- Bypass during deep-copy / snapshot operations
  IF current_setting('app.is_snapshot_copy', true) = 'true' THEN
    RETURN NEW;
  END IF;

  -- Only act if the new node has a parent
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Check the parent's node_type
  SELECT node_type INTO v_parent_type
  FROM public.estimate_nodes
  WHERE id = NEW.parent_id;

  -- Skip if parent is already group or assembly
  IF v_parent_type IS NULL OR v_parent_type != 'item' THEN
    RETURN NEW;
  END IF;

  -- Parent is an item — promote it to group
  UPDATE public.estimate_nodes
  SET node_type = 'group',
      was_auto_promoted = TRUE
  WHERE id = NEW.parent_id;

  -- Archive the parent's item details (soft-delete)
  UPDATE public.node_item_details
  SET archived_at = now()
  WHERE node_id = NEW.parent_id
    AND archived_at IS NULL;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_promote_item_parent
  AFTER INSERT ON public.estimate_nodes
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_promote_item_parent();


-- ============================================================
-- 3. auto_demote_empty_group()
--    AFTER DELETE on estimate_nodes
--    When the last child is removed from a group where
--    was_auto_promoted = TRUE:
--      - Change parent node_type to 'item'
--      - Set parent's was_auto_promoted = FALSE
--      - Restore parent's node_item_details (clear archived_at)
--    Only fires if parent has zero remaining children.
--    BYPASSABLE — snapshot copy skips auto-demotion.
--    References: estimate_nodes, node_item_details
-- ============================================================
CREATE OR REPLACE FUNCTION public.auto_demote_empty_group()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_parent_type        public.node_type;
  v_was_auto_promoted  BOOLEAN;
  v_child_count        INTEGER;
BEGIN
  -- Bypass during deep-copy / snapshot operations
  IF current_setting('app.is_snapshot_copy', true) = 'true' THEN
    RETURN OLD;
  END IF;

  -- Only act if the deleted node had a parent
  IF OLD.parent_id IS NULL THEN
    RETURN OLD;
  END IF;

  -- Check the parent's state
  SELECT node_type, was_auto_promoted
  INTO v_parent_type, v_was_auto_promoted
  FROM public.estimate_nodes
  WHERE id = OLD.parent_id;

  -- Only demote if parent was auto-promoted
  IF v_parent_type IS NULL OR v_was_auto_promoted IS NOT TRUE THEN
    RETURN OLD;
  END IF;

  -- Count remaining children
  SELECT count(*) INTO v_child_count
  FROM public.estimate_nodes
  WHERE parent_id = OLD.parent_id;

  -- Only demote if no children remain
  IF v_child_count > 0 THEN
    RETURN OLD;
  END IF;

  -- Demote parent back to item
  UPDATE public.estimate_nodes
  SET node_type = 'item',
      was_auto_promoted = FALSE
  WHERE id = OLD.parent_id;

  -- Restore the parent's archived item details
  UPDATE public.node_item_details
  SET archived_at = NULL
  WHERE node_id = OLD.parent_id
    AND archived_at IS NOT NULL;

  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_auto_demote_empty_group
  AFTER DELETE ON public.estimate_nodes
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_demote_empty_group();


-- ============================================================
-- 4. prevent_item_with_children()
--    BEFORE UPDATE on estimate_nodes
--    When node_type changes TO 'item': check if node has children.
--    If children exist, raise exception.
--    NOT bypassable — data integrity invariant.
--    References: estimate_nodes (child count query)
-- ============================================================
CREATE OR REPLACE FUNCTION public.prevent_item_with_children()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Only check when node_type is being changed TO 'item'
  IF NEW.node_type = 'item' AND (OLD.node_type IS NULL OR OLD.node_type != 'item') THEN
    IF EXISTS (
      SELECT 1 FROM public.estimate_nodes
      WHERE parent_id = NEW.id
      LIMIT 1
    ) THEN
      RAISE EXCEPTION 'Cannot change node type to item: node has children';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prevent_item_with_children
  BEFORE UPDATE ON public.estimate_nodes
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_item_with_children();


-- ============================================================
-- 5. prevent_snapshot_mutation()
--    BEFORE UPDATE OR DELETE on estimate_snapshots
--    Raises exception: snapshots are immutable.
--    NOT bypassable — immutability invariant.
--    References: none
--
--    Note: This function was initially created in migration
--    20260409000006_client_sharing_tables.sql. This OR REPLACE
--    updates it to remove the app.allow_snapshot_mutation bypass
--    (unified to no bypass per implementation plan B7).
--    The trigger is also dropped and recreated to ensure it
--    uses the updated function.
-- ============================================================
CREATE OR REPLACE FUNCTION public.prevent_snapshot_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Snapshots are immutable';
END;
$$;

-- Drop the existing trigger (created in migration 006) and recreate
-- to ensure it references the updated function definition.
DROP TRIGGER IF EXISTS enforce_snapshot_immutability ON public.estimate_snapshots;

CREATE TRIGGER trg_prevent_snapshot_mutation
  BEFORE UPDATE OR DELETE ON public.estimate_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_snapshot_mutation();


-- ============================================================
-- 6. enforce_company_settings_singleton()
--    BEFORE INSERT on company_settings
--    Check if a row already exists, raise exception if so.
--    NOT bypassable — singleton invariant.
--    References: company_settings
--
--    Note: This function replaces prevent_duplicate_company_settings()
--    from migration 20260409000004_supporting_tables.sql with the
--    canonical name and SECURITY DEFINER SET search_path = ''.
--    The old trigger is dropped and recreated.
-- ============================================================
CREATE OR REPLACE FUNCTION public.enforce_company_settings_singleton()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT count(*) FROM public.company_settings) >= 1 THEN
    RAISE EXCEPTION 'company_settings already has a row. UPDATE instead of INSERT.';
  END IF;
  RETURN NEW;
END;
$$;

-- Drop the old trigger (created in migration 004) and recreate
-- with the canonical function name.
DROP TRIGGER IF EXISTS enforce_singleton_company_settings ON public.company_settings;

CREATE TRIGGER trg_enforce_company_settings_singleton
  BEFORE INSERT ON public.company_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_company_settings_singleton();
