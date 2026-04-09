-- Phase 1A-7: History Tables
-- Creates history tables and triggers to capture OLD row values
-- on UPDATE and DELETE operations for audit trail.
--
-- Depends on:
--   20260409000001_security_foundation.sql  (auth helpers)
--   20260409000003_reference_and_core_tables.sql (estimate_nodes, node_item_details)
--   20260409000005_catalog_options_vendors.sql (vendor_id on node_item_details)
--
-- Design decisions:
--   - History captures OLD values only (what the row looked like BEFORE the change)
--   - INSERT operations are NOT logged (the current row IS the insert)
--   - No FK from history tables to source tables (original row may be deleted)
--   - changed_by uses current_setting('app.current_user_id') set by server actions
--   - Triggers bypass via current_setting('app.is_snapshot_copy') for deep-copy operations
--   - RLS: deny-all for anon/authenticated; service_role bypasses RLS for admin access


-- ############################################################
--  1. estimate_nodes_history
-- ############################################################

CREATE TABLE public.estimate_nodes_history (
  -- ── History metadata ──────────────────────────────────────────
  history_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_node_id   UUID           NOT NULL,
  change_type        VARCHAR(10)    NOT NULL,
  changed_at         TIMESTAMPTZ    NOT NULL DEFAULT now(),
  changed_by         UUID           REFERENCES auth.users(id) ON DELETE SET NULL,

  -- ── Columns from estimate_nodes (snapshot of OLD values) ──────
  -- These mirror estimate_nodes exactly. No FKs — originals may be deleted.
  estimate_id        UUID,
  parent_id          UUID,
  node_type          public.node_type,
  name               VARCHAR(255),
  description        TEXT,
  path               LTREE,
  sort_order         INTEGER,
  client_visibility  public.client_visibility,
  flagged            BOOLEAN,
  was_auto_promoted  BOOLEAN,
  catalog_source_id  UUID,
  total_price        DECIMAL(15,4),
  -- search_vector is NOT stored in history (derived column, reconstructable)
  created_by         UUID,
  created_at         TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ,

  -- ── Constraints ───────────────────────────────────────────────
  CONSTRAINT nodes_history_change_type_valid
    CHECK (change_type IN ('update', 'delete'))
);

-- RLS: deny-all for regular users; service_role bypasses RLS
ALTER TABLE public.estimate_nodes_history ENABLE ROW LEVEL SECURITY;

-- Explicit deny for anon
CREATE POLICY "deny_anon"
  ON public.estimate_nodes_history
  FOR ALL TO anon
  USING (false);

-- Explicit deny for authenticated (staff access history via server actions / admin client)
CREATE POLICY "deny_authenticated"
  ON public.estimate_nodes_history
  FOR ALL TO authenticated
  USING (false);


-- ############################################################
--  2. node_item_details_history
-- ############################################################

CREATE TABLE public.node_item_details_history (
  -- ── History metadata ──────────────────────────────────────────
  history_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_detail_id  UUID           NOT NULL,
  change_type         VARCHAR(10)    NOT NULL,
  changed_at          TIMESTAMPTZ    NOT NULL DEFAULT now(),
  changed_by          UUID           REFERENCES auth.users(id) ON DELETE SET NULL,

  -- ── Columns from node_item_details (snapshot of OLD values) ───
  -- These mirror node_item_details exactly. No FKs — originals may be deleted.
  node_id              UUID,
  quantity             DECIMAL(15,4),
  unit_id              UUID,
  unit_cost            DECIMAL(15,4),
  material_cost        DECIMAL(15,4),
  labor_cost           DECIMAL(15,4),
  labor_hours          DECIMAL(10,2),
  labor_rate           DECIMAL(10,2),
  equipment_cost       DECIMAL(15,4),
  subcontractor_cost   DECIMAL(15,4),
  markup_rate          DECIMAL(5,4),
  overhead_rate        DECIMAL(5,4),
  tax_rate             DECIMAL(5,4),
  is_allowance         BOOLEAN,
  allowance_budget     DECIMAL(15,4),
  allowance_status     VARCHAR(50),
  specifications       TEXT,
  purchasing_notes     TEXT,
  vendor_id            UUID,
  archived_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ,

  -- ── Constraints ───────────────────────────────────────────────
  CONSTRAINT item_details_history_change_type_valid
    CHECK (change_type IN ('update', 'delete'))
);

-- RLS: deny-all for regular users; service_role bypasses RLS
ALTER TABLE public.node_item_details_history ENABLE ROW LEVEL SECURITY;

-- Explicit deny for anon
CREATE POLICY "deny_anon"
  ON public.node_item_details_history
  FOR ALL TO anon
  USING (false);

-- Explicit deny for authenticated (staff access history via server actions / admin client)
CREATE POLICY "deny_authenticated"
  ON public.node_item_details_history
  FOR ALL TO authenticated
  USING (false);


-- ############################################################
--  3. History Trigger Functions
-- ############################################################

-- ── 3a. estimate_nodes history trigger function ─────────────────
CREATE OR REPLACE FUNCTION public.track_estimate_node_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Bypass during snapshot copy / deep-copy operations
  IF current_setting('app.is_snapshot_copy', true) = 'true' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    INSERT INTO public.estimate_nodes_history (
      history_id,
      original_node_id,
      change_type,
      changed_at,
      changed_by,
      estimate_id,
      parent_id,
      node_type,
      name,
      description,
      path,
      sort_order,
      client_visibility,
      flagged,
      was_auto_promoted,
      catalog_source_id,
      total_price,
      created_by,
      created_at,
      updated_at
    ) VALUES (
      gen_random_uuid(),
      OLD.id,
      'update',
      now(),
      NULLIF(current_setting('app.current_user_id', true), '')::uuid,
      OLD.estimate_id,
      OLD.parent_id,
      OLD.node_type,
      OLD.name,
      OLD.description,
      OLD.path,
      OLD.sort_order,
      OLD.client_visibility,
      OLD.flagged,
      OLD.was_auto_promoted,
      OLD.catalog_source_id,
      OLD.total_price,
      OLD.created_by,
      OLD.created_at,
      OLD.updated_at
    );
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.estimate_nodes_history (
      history_id,
      original_node_id,
      change_type,
      changed_at,
      changed_by,
      estimate_id,
      parent_id,
      node_type,
      name,
      description,
      path,
      sort_order,
      client_visibility,
      flagged,
      was_auto_promoted,
      catalog_source_id,
      total_price,
      created_by,
      created_at,
      updated_at
    ) VALUES (
      gen_random_uuid(),
      OLD.id,
      'delete',
      now(),
      NULLIF(current_setting('app.current_user_id', true), '')::uuid,
      OLD.estimate_id,
      OLD.parent_id,
      OLD.node_type,
      OLD.name,
      OLD.description,
      OLD.path,
      OLD.sort_order,
      OLD.client_visibility,
      OLD.flagged,
      OLD.was_auto_promoted,
      OLD.catalog_source_id,
      OLD.total_price,
      OLD.created_by,
      OLD.created_at,
      OLD.updated_at
    );
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;


-- ── 3b. node_item_details history trigger function ──────────────
CREATE OR REPLACE FUNCTION public.track_item_detail_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Bypass during snapshot copy / deep-copy operations
  IF current_setting('app.is_snapshot_copy', true) = 'true' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    INSERT INTO public.node_item_details_history (
      history_id,
      original_detail_id,
      change_type,
      changed_at,
      changed_by,
      node_id,
      quantity,
      unit_id,
      unit_cost,
      material_cost,
      labor_cost,
      labor_hours,
      labor_rate,
      equipment_cost,
      subcontractor_cost,
      markup_rate,
      overhead_rate,
      tax_rate,
      is_allowance,
      allowance_budget,
      allowance_status,
      specifications,
      purchasing_notes,
      vendor_id,
      archived_at,
      created_at,
      updated_at
    ) VALUES (
      gen_random_uuid(),
      OLD.id,
      'update',
      now(),
      NULLIF(current_setting('app.current_user_id', true), '')::uuid,
      OLD.node_id,
      OLD.quantity,
      OLD.unit_id,
      OLD.unit_cost,
      OLD.material_cost,
      OLD.labor_cost,
      OLD.labor_hours,
      OLD.labor_rate,
      OLD.equipment_cost,
      OLD.subcontractor_cost,
      OLD.markup_rate,
      OLD.overhead_rate,
      OLD.tax_rate,
      OLD.is_allowance,
      OLD.allowance_budget,
      OLD.allowance_status,
      OLD.specifications,
      OLD.purchasing_notes,
      OLD.vendor_id,
      OLD.archived_at,
      OLD.created_at,
      OLD.updated_at
    );
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.node_item_details_history (
      history_id,
      original_detail_id,
      change_type,
      changed_at,
      changed_by,
      node_id,
      quantity,
      unit_id,
      unit_cost,
      material_cost,
      labor_cost,
      labor_hours,
      labor_rate,
      equipment_cost,
      subcontractor_cost,
      markup_rate,
      overhead_rate,
      tax_rate,
      is_allowance,
      allowance_budget,
      allowance_status,
      specifications,
      purchasing_notes,
      vendor_id,
      archived_at,
      created_at,
      updated_at
    ) VALUES (
      gen_random_uuid(),
      OLD.id,
      'delete',
      now(),
      NULLIF(current_setting('app.current_user_id', true), '')::uuid,
      OLD.node_id,
      OLD.quantity,
      OLD.unit_id,
      OLD.unit_cost,
      OLD.material_cost,
      OLD.labor_cost,
      OLD.labor_hours,
      OLD.labor_rate,
      OLD.equipment_cost,
      OLD.subcontractor_cost,
      OLD.markup_rate,
      OLD.overhead_rate,
      OLD.tax_rate,
      OLD.is_allowance,
      OLD.allowance_budget,
      OLD.allowance_status,
      OLD.specifications,
      OLD.purchasing_notes,
      OLD.vendor_id,
      OLD.archived_at,
      OLD.created_at,
      OLD.updated_at
    );
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;


-- ############################################################
--  4. Attach History Triggers
-- ############################################################

-- ── estimate_nodes: track UPDATE and DELETE ─────────────────────
CREATE TRIGGER track_estimate_nodes_history
  AFTER UPDATE OR DELETE ON public.estimate_nodes
  FOR EACH ROW
  EXECUTE FUNCTION public.track_estimate_node_changes();

-- ── node_item_details: track UPDATE and DELETE ──────────────────
CREATE TRIGGER track_node_item_details_history
  AFTER UPDATE OR DELETE ON public.node_item_details
  FOR EACH ROW
  EXECUTE FUNCTION public.track_item_detail_changes();
