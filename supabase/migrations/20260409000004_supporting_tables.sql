-- Phase 1A-3: Supporting Tables
-- Creates: phases, project_parameters, company_settings (singleton),
--          user_preferences, estimate_view_state
--
-- Depends on:
--   20260409000001_security_foundation.sql  (get_user_role(), is_staff())
--   20260409000002_enums_and_extensions.sql  (enums)
--   20260409000003_core_tables.sql           (projects, estimates, units_of_measure)
--   auth.users                               (Supabase built-in)

-- ============================================================
-- 0. Utility: set_updated_at() trigger function
-- ============================================================
-- Reusable trigger function for auto-updating updated_at columns.
-- Idempotent: CREATE OR REPLACE so it can exist before this migration.
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
-- 1. phases
-- ############################################################
-- Classificatory tags for grouping estimate nodes by construction phase.
-- Phases do NOT affect tree hierarchy -- nodes reference a phase via
-- phase_id on the base table (estimate_nodes).

CREATE TABLE public.phases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- FK to project
  project_id UUID NOT NULL
    REFERENCES public.projects(id) ON DELETE CASCADE,

  -- Phase definition
  name VARCHAR(255) NOT NULL,
  description TEXT,
  color VARCHAR(7),
  sort_order INTEGER NOT NULL DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger: auto-update updated_at
CREATE TRIGGER set_phases_updated_at
  BEFORE UPDATE ON public.phases
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.phases ENABLE ROW LEVEL SECURITY;

-- Staff (owner + employee): full CRUD
CREATE POLICY "staff_full_access" ON public.phases
  FOR ALL TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- Deny anon
CREATE POLICY "deny_anon" ON public.phases
  FOR ALL TO anon
  USING (false);

-- Note: pending and client users have no matching policy, so RLS
-- deny-by-default gives them zero rows. No explicit deny needed.


-- ############################################################
-- 2. project_parameters
-- ############################################################
-- Named values for formula evaluation (e.g., wall_area, roof_pitch).
-- These are the variables that math.js formulas reference.

CREATE TABLE public.project_parameters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- FK to project
  project_id UUID NOT NULL
    REFERENCES public.projects(id) ON DELETE CASCADE,

  -- Parameter definition
  name VARCHAR(255) NOT NULL,
  value DECIMAL(15,4) NOT NULL,
  unit VARCHAR(50),
  description TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Unique parameter name per project
  CONSTRAINT unique_project_parameter UNIQUE (project_id, name)
);

-- Trigger: auto-update updated_at
CREATE TRIGGER set_project_parameters_updated_at
  BEFORE UPDATE ON public.project_parameters
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.project_parameters ENABLE ROW LEVEL SECURITY;

-- Staff (owner + employee): full CRUD
CREATE POLICY "staff_full_access" ON public.project_parameters
  FOR ALL TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- Deny anon
CREATE POLICY "deny_anon" ON public.project_parameters
  FOR ALL TO anon
  USING (false);


-- ############################################################
-- 3. company_settings (SINGLETON)
-- ############################################################
-- Single-row company configuration.
-- Hybrid: columns for calculated/constrained fields (rates, FK),
-- JSONB for display/informational fields (contact, license, terms).

CREATE TABLE public.company_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Singleton enforcement: only one row can ever exist
  singleton_key TEXT NOT NULL DEFAULT 'default' UNIQUE
    CONSTRAINT only_one_row CHECK (singleton_key = 'default'),

  -- ── Financial Defaults (columns -- used in calculations) ──────
  default_markup_rate DECIMAL(5,4) NOT NULL DEFAULT 0.0000
    CONSTRAINT valid_markup CHECK (default_markup_rate >= 0 AND default_markup_rate <= 1),
  default_overhead_rate DECIMAL(5,4) NOT NULL DEFAULT 0.0000
    CONSTRAINT valid_overhead CHECK (default_overhead_rate >= 0 AND default_overhead_rate <= 1),
  default_contingency_rate DECIMAL(5,4) NOT NULL DEFAULT 0.0000
    CONSTRAINT valid_contingency CHECK (default_contingency_rate >= 0 AND default_contingency_rate <= 1),
  default_tax_rate DECIMAL(5,4) NOT NULL DEFAULT 0.0000
    CONSTRAINT valid_tax CHECK (default_tax_rate >= 0 AND default_tax_rate <= 1),

  -- ── Default Unit (FK -- used when creating new items) ─────────
  default_unit_id UUID
    REFERENCES public.units_of_measure(id) ON DELETE SET NULL,

  -- ── Display / Informational Fields (JSONB) ────────────────────
  -- Schema for settings_json is enforced at the application level via Zod.
  -- The database treats this as an opaque blob.
  settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- ── Timestamps ────────────────────────────────────────────────
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger: auto-update updated_at
CREATE TRIGGER set_company_settings_updated_at
  BEFORE UPDATE ON public.company_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;

-- Owner: full read/write
CREATE POLICY "owner_full_access" ON public.company_settings
  FOR ALL TO authenticated
  USING (public.get_user_role() = 'owner')
  WITH CHECK (public.get_user_role() = 'owner');

-- Employee: read-only (they need rates for creating estimates)
CREATE POLICY "employee_read_only" ON public.company_settings
  FOR SELECT TO authenticated
  USING (public.get_user_role() = 'employee');

-- Deny anon
CREATE POLICY "deny_anon" ON public.company_settings
  FOR ALL TO anon
  USING (false);

-- ── Singleton enforcement trigger ───────────────────────────────
-- Defense in depth beyond the UNIQUE constraint on singleton_key.
-- Provides a clearer error message than a raw constraint violation.
CREATE OR REPLACE FUNCTION public.prevent_duplicate_company_settings()
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

CREATE TRIGGER enforce_singleton_company_settings
  BEFORE INSERT ON public.company_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_duplicate_company_settings();


-- ############################################################
-- 4. user_preferences
-- ############################################################
-- Per-user UI preferences and personal settings.
-- One row per user, JSONB blob for flexibility.
-- user_id as PK: natural key, one row guaranteed, O(1) lookup.

CREATE TABLE public.user_preferences (
  -- Natural PK: one preferences row per user
  user_id UUID PRIMARY KEY
    REFERENCES auth.users(id) ON DELETE CASCADE,

  -- All preferences in one JSONB blob.
  -- Schema enforced by Zod at the application layer.
  preferences JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Timestamps
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger: auto-update updated_at
CREATE TRIGGER set_user_preferences_updated_at
  BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

-- Users can only read/write their own preferences
CREATE POLICY "own_preferences_only" ON public.user_preferences
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Deny anon
CREATE POLICY "deny_anon" ON public.user_preferences
  FOR ALL TO anon
  USING (false);


-- ############################################################
-- 5. estimate_view_state
-- ############################################################
-- Per-user, per-estimate UI state (expand/collapse, column visibility,
-- sort, scroll position). Composite PK -- no synthetic id needed.
--
-- Write frequency: client-side debounce (3s) + persist on
-- visibilitychange/beforeunload. UPSERT pattern:
--   INSERT ... ON CONFLICT (user_id, estimate_id)
--   DO UPDATE SET view_state = EXCLUDED.view_state, updated_at = now()

CREATE TABLE public.estimate_view_state (
  user_id UUID NOT NULL
    REFERENCES auth.users(id) ON DELETE CASCADE,
  estimate_id UUID NOT NULL
    REFERENCES public.estimates(id) ON DELETE CASCADE,

  -- All view state in JSONB. Schema enforced at app layer.
  view_state JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Only updated_at matters (recency, not creation)
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Composite primary key
  PRIMARY KEY (user_id, estimate_id)
);

-- Index: look up all view states for a user (e.g., "recently opened estimates")
CREATE INDEX idx_estimate_view_state_user
  ON public.estimate_view_state(user_id);

-- Index: speeds up CASCADE delete when an estimate is deleted
CREATE INDEX idx_estimate_view_state_estimate
  ON public.estimate_view_state(estimate_id);

-- No updated_at trigger: the UPSERT statement sets updated_at explicitly.
-- Adding a trigger would fire on every debounced write, adding overhead
-- for a value we already set in the UPSERT.

-- RLS
ALTER TABLE public.estimate_view_state ENABLE ROW LEVEL SECURITY;

-- Users can only read/write their own view state
CREATE POLICY "own_view_state_only" ON public.estimate_view_state
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Deny anon
CREATE POLICY "deny_anon" ON public.estimate_view_state
  FOR ALL TO anon
  USING (false);
