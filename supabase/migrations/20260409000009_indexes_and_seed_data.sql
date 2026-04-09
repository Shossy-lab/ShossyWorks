-- Phase 1A-8: Indexes & Seed Data
-- Adds performance indexes not already defined inline in prior migrations,
-- then seeds reference data for units, cost codes, and company settings.
--
-- Depends on:
--   20260409000003_reference_and_core_tables.sql (estimate_nodes, node_item_details,
--     units_of_measure, cost_codes)
--   20260409000004_supporting_tables.sql (company_settings)
--   20260409000008_history_tables.sql (history tables)
--
-- Index audit: The following indexes ALREADY EXIST in prior migrations
-- and are NOT duplicated here:
--   Migration 3 (reference_and_core_tables):
--     idx_projects_status, idx_projects_created_by,
--     idx_estimates_project, idx_estimates_status, idx_estimates_version_group,
--     idx_estimates_created_by,
--     idx_nodes_estimate, idx_nodes_parent, idx_nodes_tree_order, idx_nodes_path,
--     idx_nodes_flagged, idx_nodes_search,
--     idx_item_details_node, idx_item_details_unit,
--     idx_assembly_details_node, idx_assembly_details_unit,
--     idx_node_notes_active, idx_node_notes_created_by
--   Migration 4 (supporting_tables):
--     idx_estimate_view_state_user, idx_estimate_view_state_estimate
--   Migration 5 (catalog_options_vendors):
--     idx_catalog_items_category, idx_catalog_items_active,
--     idx_catalog_assemblies_category, idx_catalog_assemblies_active,
--     idx_option_groups_estimate, idx_one_selected_per_group,
--     idx_option_alternatives_group,
--     idx_nom_node, idx_nom_alt,
--     idx_option_sets_estimate,
--     idx_oss_set, idx_oss_alt,
--     idx_broad_options_estimate,
--     idx_broad_overrides_option, idx_broad_overrides_node,
--     idx_osbs_broad


-- ############################################################
--  PERFORMANCE INDEXES (not covered by prior migrations)
-- ############################################################


-- ── History table indexes ───────────────────────────────────────
-- Primary query: "show me the history for node X" ordered by time
CREATE INDEX idx_nodes_history_original_node
  ON public.estimate_nodes_history (original_node_id, changed_at DESC);

-- Secondary query: "what changed today in estimate X" (history scan by estimate)
CREATE INDEX idx_nodes_history_estimate
  ON public.estimate_nodes_history (estimate_id, changed_at DESC);

-- Primary query: "show me the history for detail row X" ordered by time
CREATE INDEX idx_item_details_history_original
  ON public.node_item_details_history (original_detail_id, changed_at DESC);

-- Secondary query: "what item details changed for node X" (join back to node)
CREATE INDEX idx_item_details_history_node
  ON public.node_item_details_history (node_id, changed_at DESC);


-- ── estimate_nodes: unpriced / high-cost item queries ───────────
-- Supports "show me all unpriced items" and "items over $X" filters
CREATE INDEX idx_nodes_total_price
  ON public.estimate_nodes (total_price)
  WHERE node_type = 'item';

-- ── estimates: composite for RLS subquery optimization ──────────
-- When client RLS policy needs to check "does this estimate belong
-- to a project I have access to?", the composite index avoids
-- a separate project_id lookup + id verification.
CREATE INDEX idx_estimates_project_id_composite
  ON public.estimates (project_id, id);


-- ############################################################
--  SEED DATA
-- ############################################################


-- ============================================================
-- 1. units_of_measure — 25 common construction units
-- ============================================================
-- Uses ON CONFLICT to be idempotent (safe to re-run).
-- sort_order groups units by category for dropdown display.

INSERT INTO public.units_of_measure (name, abbreviation, category, sort_order) VALUES
  -- ── Counting ──────────────────────────────────────────────────
  ('each',          'EA',    'counting',   10),
  ('pair',          'PR',    'counting',   20),
  ('set',           'SET',   'counting',   30),
  ('lot',           'LOT',   'counting',   40),

  -- ── Linear ────────────────────────────────────────────────────
  ('linear_foot',   'LF',    'linear',    110),
  ('linear_yard',   'LY',    'linear',    120),

  -- ── Area ──────────────────────────────────────────────────────
  ('square_foot',   'SF',    'area',      210),
  ('square',        'SQ',    'area',      220),

  -- ── Volume ────────────────────────────────────────────────────
  ('cubic_foot',    'CF',    'volume',    310),
  ('cubic_yard',    'CY',    'volume',    320),
  ('gallon',        'GAL',   'volume',    330),

  -- ── Weight ────────────────────────────────────────────────────
  ('pound',         'LB',    'weight',    410),
  ('ton',           'TON',   'weight',    420),

  -- ── Lumber / Sheet Goods ──────────────────────────────────────
  ('board_foot',    'BF',    'lumber',    510),
  ('sheet',         'SHT',   'lumber',    520),
  ('bundle',        'BDL',   'lumber',    530),

  -- ── Packaging / Misc Materials ────────────────────────────────
  ('roll',          'ROLL',  'packaging', 610),
  ('bag',           'BAG',   'packaging', 620),

  -- ── Time ──────────────────────────────────────────────────────
  ('hour',          'HR',    'time',      710),
  ('day',           'DAY',   'time',      720),
  ('week',          'WK',    'time',      730),
  ('month',         'MO',    'time',      740),

  -- ── Contract / Financial ──────────────────────────────────────
  ('lump_sum',      'LS',    'contract',  810),
  ('allowance',     'ALLOW', 'contract',  820),
  ('percent',       '%',     'contract',  830)

ON CONFLICT (name) DO NOTHING;


-- ============================================================
-- 2. cost_codes — CSI MasterFormat divisions (residential focus)
-- ============================================================
-- 14 divisions commonly used in residential construction.
-- subdivision is NULL for top-level divisions (can be extended later).

INSERT INTO public.cost_codes (division, title, description, sort_order) VALUES
  ('01', 'General Requirements',
   'Project overhead, temporary facilities, permits, insurance, cleanup',
   10),

  ('02', 'Existing Conditions',
   'Demolition, site assessment, hazardous material abatement',
   20),

  ('03', 'Concrete',
   'Foundations, slabs, footings, flatwork, decorative concrete',
   30),

  ('04', 'Masonry',
   'Brick, block, stone veneer, mortar, reinforcement',
   40),

  ('05', 'Metals',
   'Structural steel, miscellaneous metals, railings, metal fabrication',
   50),

  ('06', 'Wood, Plastics & Composites',
   'Framing, trim, cabinetry, countertops, millwork, decking',
   60),

  ('07', 'Thermal & Moisture Protection',
   'Insulation, roofing, waterproofing, siding, flashing, gutters',
   70),

  ('08', 'Openings',
   'Windows, doors, skylights, hardware, glazing',
   80),

  ('09', 'Finishes',
   'Drywall, paint, tile, flooring, ceilings, wall coverings',
   90),

  ('10', 'Specialties',
   'Fireplaces, bath accessories, signage, closet systems, mirrors',
   100),

  ('21', 'Fire Suppression',
   'Sprinkler systems, fire protection piping',
   210),

  ('22', 'Plumbing',
   'Fixtures, piping, water heaters, gas piping, sewer/drain',
   220),

  ('23', 'HVAC',
   'Heating, ventilation, air conditioning, ductwork, controls',
   230),

  ('26', 'Electrical',
   'Wiring, panels, outlets, switches, lighting, low voltage',
   260)

ON CONFLICT (division, subdivision) DO NOTHING;


-- ============================================================
-- 3. company_settings — Szostak Build defaults (singleton)
-- ============================================================
-- Rates default to 0 — user configures them on first setup.
-- settings_json contains display/informational fields managed by the app.

INSERT INTO public.company_settings (
  singleton_key,
  default_markup_rate,
  default_overhead_rate,
  default_contingency_rate,
  default_tax_rate,
  settings_json
) VALUES (
  'default',
  0.0000,
  0.0000,
  0.0000,
  0.0000,
  jsonb_build_object(
    'company_name',    'Szostak Build, LLC',
    'license_number',  '',
    'insurance_info',  '',
    'payment_terms',   '',
    'warranty_terms',  '',
    'contact_email',   '',
    'contact_phone',   '',
    'address',         ''
  )
)
ON CONFLICT (singleton_key) DO NOTHING;
