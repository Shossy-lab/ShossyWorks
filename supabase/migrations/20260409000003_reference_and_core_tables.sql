-- Phase 1A-2: Reference & Core Tables
-- Creates reference tables (units_of_measure, cost_codes) first,
-- then core tables (projects, estimates, estimate_nodes, detail tables, node_notes).
--
-- Depends on:
--   20260409000001_security_foundation.sql  (get_user_role(), is_staff(), user_profiles)
--   20260409000002_enums_and_extensions.sql  (project_status, estimate_status, node_type,
--                                             client_visibility enums; ltree extension)
--
-- RLS rules for this migration:
--   - Staff (owner + employee) get full CRUD on all tables
--   - All authenticated users can SELECT reference tables (units, cost_codes)
--   - Owner-only policies are NOT needed here (no admin-only tables in this batch)
--   - Client policies are deferred to Phase 1A-5


-- ============================================================
-- HELPER: updated_at trigger function (reusable across all tables)
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


-- ############################################################
--  REFERENCE TABLES (created first — other tables FK to these)
-- ############################################################


-- ============================================================
-- 1. units_of_measure
-- ============================================================
CREATE TABLE public.units_of_measure (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(100) NOT NULL,
  abbreviation  VARCHAR(20)  NOT NULL,
  category      VARCHAR(50),
  sort_order    INTEGER,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT uom_name_unique UNIQUE (name),
  CONSTRAINT uom_abbreviation_unique UNIQUE (abbreviation)
);

-- Auto-update updated_at
CREATE TRIGGER set_units_of_measure_updated_at
  BEFORE UPDATE ON public.units_of_measure
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.units_of_measure ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read (needed for dropdowns, display)
CREATE POLICY "Authenticated users can read units"
  ON public.units_of_measure FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Staff can insert/update/delete
CREATE POLICY "Staff can manage units"
  ON public.units_of_measure FOR ALL
  USING (public.is_staff())
  WITH CHECK (public.is_staff());


-- ============================================================
-- 2. cost_codes
-- ============================================================
CREATE TABLE public.cost_codes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  division      VARCHAR(10)  NOT NULL,
  subdivision   VARCHAR(20),
  title         VARCHAR(255) NOT NULL,
  description   TEXT,
  parent_id     UUID         REFERENCES public.cost_codes(id) ON DELETE SET NULL,
  sort_order    INTEGER,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT cost_codes_division_subdivision_unique UNIQUE (division, subdivision)
);

-- Auto-update updated_at
CREATE TRIGGER set_cost_codes_updated_at
  BEFORE UPDATE ON public.cost_codes
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.cost_codes ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read (needed for dropdowns, reports)
CREATE POLICY "Authenticated users can read cost codes"
  ON public.cost_codes FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Staff can insert/update/delete
CREATE POLICY "Staff can manage cost codes"
  ON public.cost_codes FOR ALL
  USING (public.is_staff())
  WITH CHECK (public.is_staff());


-- ############################################################
--  CORE TABLES
-- ############################################################


-- ============================================================
-- 3. projects
-- ============================================================
CREATE TABLE public.projects (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_number  VARCHAR(50)  UNIQUE,
  name            VARCHAR(255) NOT NULL,
  description     TEXT,
  status          public.project_status NOT NULL DEFAULT 'lead',
  client_name     VARCHAR(255),
  client_email    VARCHAR(255),
  client_phone    VARCHAR(50),
  address_line1   VARCHAR(255),
  address_line2   VARCHAR(255),
  city            VARCHAR(100),
  state           VARCHAR(50),
  zip             VARCHAR(20),
  bid_date        DATE,
  start_date      DATE,
  end_date        DATE,
  created_by      UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Auto-update updated_at
CREATE TRIGGER set_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- Staff full CRUD
CREATE POLICY "Staff can manage projects"
  ON public.projects FOR ALL
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- Indexes
CREATE INDEX idx_projects_status ON public.projects(status);
CREATE INDEX idx_projects_created_by ON public.projects(created_by) WHERE created_by IS NOT NULL;


-- ============================================================
-- 4. estimates
-- ============================================================
CREATE TABLE public.estimates (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id               UUID         NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name                     VARCHAR(255) NOT NULL,
  description              TEXT,
  status                   public.estimate_status NOT NULL DEFAULT 'draft',
  version                  INTEGER      NOT NULL DEFAULT 1,
  version_group_id         UUID,
  default_markup_rate      DECIMAL(5,4),
  default_overhead_rate    DECIMAL(5,4),
  default_contingency_rate DECIMAL(5,4),
  default_tax_rate         DECIMAL(5,4),
  notes                    TEXT,
  created_by               UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Auto-update updated_at
CREATE TRIGGER set_estimates_updated_at
  BEFORE UPDATE ON public.estimates
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.estimates ENABLE ROW LEVEL SECURITY;

-- Staff full CRUD
CREATE POLICY "Staff can manage estimates"
  ON public.estimates FOR ALL
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- Indexes
CREATE INDEX idx_estimates_project ON public.estimates(project_id);
CREATE INDEX idx_estimates_status ON public.estimates(status);
CREATE INDEX idx_estimates_version_group ON public.estimates(version_group_id)
  WHERE version_group_id IS NOT NULL;
CREATE INDEX idx_estimates_created_by ON public.estimates(created_by)
  WHERE created_by IS NOT NULL;


-- ============================================================
-- 5. estimate_nodes
-- ============================================================
CREATE TABLE public.estimate_nodes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id        UUID               NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  parent_id          UUID               REFERENCES public.estimate_nodes(id) ON DELETE CASCADE,
  node_type          public.node_type   NOT NULL DEFAULT 'item',
  name               VARCHAR(255)       NOT NULL,
  description        TEXT,
  path               LTREE,
  sort_order         INTEGER            NOT NULL DEFAULT 0,
  client_visibility  public.client_visibility NOT NULL DEFAULT 'visible',
  flagged            BOOLEAN            NOT NULL DEFAULT FALSE,
  was_auto_promoted  BOOLEAN            NOT NULL DEFAULT FALSE,
  catalog_source_id  UUID,
  total_price        DECIMAL(15,4)      DEFAULT 0,
  search_vector      TSVECTOR           GENERATED ALWAYS AS (
                       to_tsvector('english',
                         coalesce(name, '') || ' ' || coalesce(description, '')
                       )
                     ) STORED,
  created_by         UUID               REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ        NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ        NOT NULL DEFAULT now(),

  CONSTRAINT nodes_sort_order_non_negative CHECK (sort_order >= 0)
);

-- Auto-update updated_at
CREATE TRIGGER set_estimate_nodes_updated_at
  BEFORE UPDATE ON public.estimate_nodes
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.estimate_nodes ENABLE ROW LEVEL SECURITY;

-- Staff full CRUD
CREATE POLICY "Staff can manage estimate nodes"
  ON public.estimate_nodes FOR ALL
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- Indexes
CREATE INDEX idx_nodes_estimate ON public.estimate_nodes(estimate_id);
CREATE INDEX idx_nodes_parent ON public.estimate_nodes(parent_id);
CREATE INDEX idx_nodes_tree_order ON public.estimate_nodes(estimate_id, parent_id, sort_order);
CREATE INDEX idx_nodes_path ON public.estimate_nodes USING gist(path);
CREATE INDEX idx_nodes_flagged ON public.estimate_nodes(estimate_id)
  WHERE flagged = TRUE;
CREATE INDEX idx_nodes_search ON public.estimate_nodes USING gin(search_vector);


-- ============================================================
-- 6. node_item_details
-- ============================================================
CREATE TABLE public.node_item_details (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id              UUID           NOT NULL REFERENCES public.estimate_nodes(id) ON DELETE CASCADE,
  quantity             DECIMAL(15,4)  DEFAULT 0,
  unit_id              UUID           REFERENCES public.units_of_measure(id) ON DELETE SET NULL,
  unit_cost            DECIMAL(15,4)  DEFAULT 0,
  material_cost        DECIMAL(15,4)  DEFAULT 0,
  labor_cost           DECIMAL(15,4)  DEFAULT 0,
  labor_hours          DECIMAL(10,2)  DEFAULT 0,
  labor_rate           DECIMAL(10,2)  DEFAULT 0,
  equipment_cost       DECIMAL(15,4)  DEFAULT 0,
  subcontractor_cost   DECIMAL(15,4)  DEFAULT 0,
  markup_rate          DECIMAL(5,4),
  overhead_rate        DECIMAL(5,4),
  tax_rate             DECIMAL(5,4),
  is_allowance         BOOLEAN        NOT NULL DEFAULT FALSE,
  allowance_budget     DECIMAL(15,4),
  allowance_status     VARCHAR(50)    DEFAULT 'pending',
  specifications       TEXT,
  purchasing_notes     TEXT,
  archived_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ    NOT NULL DEFAULT now(),

  CONSTRAINT item_details_node_unique UNIQUE (node_id),
  CONSTRAINT item_quantity_non_negative CHECK (quantity >= 0)
);

-- Auto-update updated_at
CREATE TRIGGER set_node_item_details_updated_at
  BEFORE UPDATE ON public.node_item_details
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.node_item_details ENABLE ROW LEVEL SECURITY;

-- Staff full CRUD
CREATE POLICY "Staff can manage item details"
  ON public.node_item_details FOR ALL
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- Indexes
CREATE INDEX idx_item_details_node ON public.node_item_details(node_id);
CREATE INDEX idx_item_details_unit ON public.node_item_details(unit_id)
  WHERE unit_id IS NOT NULL;


-- ============================================================
-- 7. node_assembly_details
-- ============================================================
CREATE TABLE public.node_assembly_details (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id              UUID           NOT NULL REFERENCES public.estimate_nodes(id) ON DELETE CASCADE,
  quantity             DECIMAL(15,4)  DEFAULT 1,
  unit_id              UUID           REFERENCES public.units_of_measure(id) ON DELETE SET NULL,
  assembly_unit_cost   DECIMAL(15,4)  DEFAULT 0,
  ratio_base           VARCHAR(50)    DEFAULT 'quantity',
  specifications       TEXT,
  archived_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ    NOT NULL DEFAULT now(),

  CONSTRAINT assembly_details_node_unique UNIQUE (node_id),
  CONSTRAINT assembly_quantity_non_negative CHECK (quantity >= 0)
);

-- Auto-update updated_at
CREATE TRIGGER set_node_assembly_details_updated_at
  BEFORE UPDATE ON public.node_assembly_details
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.node_assembly_details ENABLE ROW LEVEL SECURITY;

-- Staff full CRUD
CREATE POLICY "Staff can manage assembly details"
  ON public.node_assembly_details FOR ALL
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- Indexes
CREATE INDEX idx_assembly_details_node ON public.node_assembly_details(node_id);
CREATE INDEX idx_assembly_details_unit ON public.node_assembly_details(unit_id)
  WHERE unit_id IS NOT NULL;


-- ============================================================
-- 8. node_notes
-- ============================================================
CREATE TABLE public.node_notes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id            UUID           NOT NULL REFERENCES public.estimate_nodes(id) ON DELETE CASCADE,
  body               TEXT           NOT NULL,
  format             VARCHAR(20)    NOT NULL DEFAULT 'markdown',
  is_internal        BOOLEAN        NOT NULL DEFAULT TRUE,
  is_client_visible  BOOLEAN        NOT NULL DEFAULT FALSE,
  deleted_at         TIMESTAMPTZ,
  created_by         UUID           REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ    NOT NULL DEFAULT now(),

  -- Format must be one of the supported values
  CONSTRAINT notes_format_valid CHECK (format IN ('markdown', 'html')),
  -- A note must be at least one of internal or client-visible
  CONSTRAINT notes_visibility_check CHECK (is_internal OR is_client_visible)
);

-- Auto-update updated_at
CREATE TRIGGER set_node_notes_updated_at
  BEFORE UPDATE ON public.node_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.node_notes ENABLE ROW LEVEL SECURITY;

-- Staff full CRUD
CREATE POLICY "Staff can manage node notes"
  ON public.node_notes FOR ALL
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- Indexes
-- Active notes for a node (soft-delete filter)
CREATE INDEX idx_node_notes_active ON public.node_notes(node_id)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_node_notes_created_by ON public.node_notes(created_by)
  WHERE created_by IS NOT NULL;
