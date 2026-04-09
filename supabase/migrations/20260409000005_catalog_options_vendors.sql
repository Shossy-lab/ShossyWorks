-- Phase 1A-4: Catalog, Options & Vendor Tables
-- Creates vendors, catalog tables, option system (9 tables), broad_options.
-- Schema only -- option features ship in Phase 1B.
--
-- Depends on:
--   20260409000001_security_foundation.sql  (is_staff(), get_user_role())
--   20260409000002_enums_and_extensions.sql (node_type, option_group_type enums)
--   20260409000003_reference_and_core_tables.sql (units_of_measure, estimates,
--     estimate_nodes, node_item_details)
--
-- RLS policy: staff (owner + employee) full CRUD on ALL tables.
-- Client policies are deferred to Phase 1A-5.


-- ============================================================
-- 1. vendors
-- ============================================================
CREATE TABLE public.vendors (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(255) NOT NULL,
  contact_name VARCHAR(255),
  email        VARCHAR(255),
  phone        VARCHAR(50),
  address      TEXT,
  notes        TEXT,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Auto-update updated_at
CREATE TRIGGER set_vendors_updated_at
  BEFORE UPDATE ON public.vendors
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can manage vendors"
  ON public.vendors FOR ALL
  USING (public.is_staff())
  WITH CHECK (public.is_staff());


-- ============================================================
-- 1b. Add vendor_id FK to node_item_details
-- ============================================================
-- node_item_details was created in migration 000003 with vendor_id
-- intentionally left as a soft reference. Now that vendors exists,
-- add the column and hard FK constraint.
ALTER TABLE public.node_item_details
  ADD COLUMN IF NOT EXISTS vendor_id UUID;

ALTER TABLE public.node_item_details
  ADD CONSTRAINT fk_item_details_vendor
  FOREIGN KEY (vendor_id)
  REFERENCES public.vendors(id)
  ON DELETE SET NULL;


-- ============================================================
-- 2. catalog_items
-- ============================================================
CREATE TABLE public.catalog_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               VARCHAR(255) NOT NULL,
  description        TEXT,
  node_type          public.node_type NOT NULL,
  category           VARCHAR(100),
  default_unit_id    UUID         REFERENCES public.units_of_measure(id) ON DELETE SET NULL,
  default_unit_cost  DECIMAL(15,4),
  default_labor_rate DECIMAL(10,2),
  item_data          JSONB        NOT NULL DEFAULT '{}',
  is_active          BOOLEAN      NOT NULL DEFAULT TRUE,
  created_by         UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Auto-update updated_at
CREATE TRIGGER set_catalog_items_updated_at
  BEFORE UPDATE ON public.catalog_items
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.catalog_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can manage catalog items"
  ON public.catalog_items FOR ALL
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- Indexes
CREATE INDEX idx_catalog_items_category ON public.catalog_items(category)
  WHERE category IS NOT NULL;
CREATE INDEX idx_catalog_items_active ON public.catalog_items(is_active)
  WHERE is_active = TRUE;


-- ============================================================
-- 3. catalog_assemblies
-- ============================================================
CREATE TABLE public.catalog_assemblies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255) NOT NULL,
  description   TEXT,
  category      VARCHAR(100),
  assembly_data JSONB        NOT NULL DEFAULT '{}',
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_by    UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Auto-update updated_at
CREATE TRIGGER set_catalog_assemblies_updated_at
  BEFORE UPDATE ON public.catalog_assemblies
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.catalog_assemblies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can manage catalog assemblies"
  ON public.catalog_assemblies FOR ALL
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- Indexes
CREATE INDEX idx_catalog_assemblies_category ON public.catalog_assemblies(category)
  WHERE category IS NOT NULL;
CREATE INDEX idx_catalog_assemblies_active ON public.catalog_assemblies(is_active)
  WHERE is_active = TRUE;


-- ============================================================
-- 4. option_groups
-- ============================================================
-- group_type uses the option_group_type enum from migration 000002:
--   'selection' = mutually exclusive alternatives (pick one)
--   'toggle'    = additive on/off (include or exclude)
CREATE TABLE public.option_groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id UUID                    NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  name        VARCHAR(255)            NOT NULL,
  description TEXT,
  group_type  public.option_group_type NOT NULL DEFAULT 'selection',
  sort_order  INTEGER                 NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ             NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ             NOT NULL DEFAULT now()
);

-- Auto-update updated_at
CREATE TRIGGER set_option_groups_updated_at
  BEFORE UPDATE ON public.option_groups
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.option_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can manage option groups"
  ON public.option_groups FOR ALL
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- Indexes
CREATE INDEX idx_option_groups_estimate ON public.option_groups(estimate_id);


-- ============================================================
-- 5. option_alternatives
-- ============================================================
CREATE TABLE public.option_alternatives (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id         UUID           NOT NULL REFERENCES public.option_groups(id) ON DELETE CASCADE,
  name             VARCHAR(255)   NOT NULL,
  description      TEXT,
  is_selected      BOOLEAN        NOT NULL DEFAULT FALSE,
  price_adjustment DECIMAL(15,4)  NOT NULL DEFAULT 0,
  sort_order       INTEGER        NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ    NOT NULL DEFAULT now()
);

-- Exactly-one-selected constraint: at most one TRUE per group.
-- Combined with application logic ensuring exactly one (not zero),
-- this makes the invariant database-enforced.
CREATE UNIQUE INDEX idx_one_selected_per_group
  ON public.option_alternatives (group_id)
  WHERE is_selected = TRUE;

-- Auto-update updated_at
CREATE TRIGGER set_option_alternatives_updated_at
  BEFORE UPDATE ON public.option_alternatives
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.option_alternatives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can manage option alternatives"
  ON public.option_alternatives FOR ALL
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- Indexes
CREATE INDEX idx_option_alternatives_group ON public.option_alternatives(group_id);


-- ============================================================
-- 6. node_option_memberships (junction table)
-- ============================================================
-- Links estimate_nodes to option_alternatives.
-- A node belongs to an alternative; nodes with no membership
-- are always visible in the active tree.
CREATE TABLE public.node_option_memberships (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id        UUID        NOT NULL REFERENCES public.estimate_nodes(id) ON DELETE CASCADE,
  alternative_id UUID        NOT NULL REFERENCES public.option_alternatives(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT unique_node_alternative UNIQUE (node_id, alternative_id)
);

-- RLS
ALTER TABLE public.node_option_memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can manage node option memberships"
  ON public.node_option_memberships FOR ALL
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- Performance indexes for active tree query
CREATE INDEX idx_nom_node ON public.node_option_memberships(node_id);
CREATE INDEX idx_nom_alt ON public.node_option_memberships(alternative_id);


-- ============================================================
-- 7. option_sets (saved scenarios)
-- ============================================================
CREATE TABLE public.option_sets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id UUID         NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  created_by  UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Auto-update updated_at
CREATE TRIGGER set_option_sets_updated_at
  BEFORE UPDATE ON public.option_sets
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.option_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can manage option sets"
  ON public.option_sets FOR ALL
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- Indexes
CREATE INDEX idx_option_sets_estimate ON public.option_sets(estimate_id);


-- ============================================================
-- 8. option_set_selections
-- ============================================================
-- Records which alternative is selected per option set.
CREATE TABLE public.option_set_selections (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  option_set_id  UUID NOT NULL REFERENCES public.option_sets(id) ON DELETE CASCADE,
  alternative_id UUID NOT NULL REFERENCES public.option_alternatives(id) ON DELETE CASCADE,

  CONSTRAINT unique_set_alternative UNIQUE (option_set_id, alternative_id)
);

-- RLS
ALTER TABLE public.option_set_selections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can manage option set selections"
  ON public.option_set_selections FOR ALL
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- Indexes
CREATE INDEX idx_oss_set ON public.option_set_selections(option_set_id);
CREATE INDEX idx_oss_alt ON public.option_set_selections(alternative_id);


-- ============================================================
-- 9. broad_options
-- ============================================================
CREATE TABLE public.broad_options (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id UUID         NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  sort_order  INTEGER      NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Auto-update updated_at
CREATE TRIGGER set_broad_options_updated_at
  BEFORE UPDATE ON public.broad_options
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.broad_options ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can manage broad options"
  ON public.broad_options FOR ALL
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- Indexes
CREATE INDEX idx_broad_options_estimate ON public.broad_options(estimate_id);


-- ============================================================
-- 10. broad_option_overrides
-- ============================================================
-- Each override specifies how a broad option modifies a target node.
-- override_type: the kind of override (e.g., 'parameter', 'cost', 'quantity')
-- override_value: JSONB payload describing the override details.
CREATE TABLE public.broad_option_overrides (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broad_option_id UUID         NOT NULL REFERENCES public.broad_options(id) ON DELETE CASCADE,
  target_node_id  UUID         REFERENCES public.estimate_nodes(id) ON DELETE CASCADE,
  override_type   VARCHAR(50)  NOT NULL,
  override_value  JSONB        NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.broad_option_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can manage broad option overrides"
  ON public.broad_option_overrides FOR ALL
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- Indexes
CREATE INDEX idx_broad_overrides_option ON public.broad_option_overrides(broad_option_id);
CREATE INDEX idx_broad_overrides_node ON public.broad_option_overrides(target_node_id)
  WHERE target_node_id IS NOT NULL;


-- ============================================================
-- 11. option_set_broad_selections
-- ============================================================
-- Records which broad options are included in each option set.
-- Composite primary key -- no synthetic id needed for a pure junction.
CREATE TABLE public.option_set_broad_selections (
  option_set_id  UUID NOT NULL REFERENCES public.option_sets(id) ON DELETE CASCADE,
  broad_option_id UUID NOT NULL REFERENCES public.broad_options(id) ON DELETE CASCADE,

  PRIMARY KEY (option_set_id, broad_option_id)
);

-- RLS
ALTER TABLE public.option_set_broad_selections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can manage option set broad selections"
  ON public.option_set_broad_selections FOR ALL
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- Indexes (PK already covers (option_set_id, broad_option_id);
-- add reverse lookup index)
CREATE INDEX idx_osbs_broad ON public.option_set_broad_selections(broad_option_id);
