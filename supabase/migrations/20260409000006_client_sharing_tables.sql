-- Phase 1A-5: Client/Sharing Tables + Client RLS
-- Creates: client_project_access, estimate_snapshots, estimate_shares,
--          estimate_comments, estimate_approvals
-- Adds: client_has_project_access() helper function
-- Adds: Client-role RLS policies to ALL prior tables that need them
--
-- Depends on:
--   20260409000001_security_foundation.sql  (get_user_role(), is_staff(), user_profiles)
--   20260409000002_enums_and_extensions.sql  (enums: snapshot_type, estimate_status,
--                                             project_status, approval_status, author_type)
--   20260409000003_reference_and_core_tables.sql  (projects, estimates, estimate_nodes,
--                                                   node_item_details, node_assembly_details, node_notes)
--   20260409000004_supporting_tables.sql  (phases, project_parameters, company_settings,
--                                          user_preferences, estimate_view_state)
--   20260409000005_catalog_options_vendors.sql  (option_groups, option_alternatives,
--                                                option_sets, broad_options, vendors, catalog tables)
--
-- Tables NOT receiving client policies (staff-only or authenticated-read-only):
--   company_settings, user_preferences, estimate_view_state,
--   vendors, catalog_items, catalog_assemblies, cost_codes, units_of_measure,
--   phases, project_parameters, node_option_memberships,
--   option_set_selections, option_set_broad_selections,
--   broad_options, broad_option_overrides


-- ############################################################
--  1. client_project_access — controls which clients see which projects
-- ############################################################

CREATE TABLE public.client_project_access (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id      UUID        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  granted_by      UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT unique_client_project UNIQUE (client_user_id, project_id)
);

-- Index for RLS lookups (client checking their own access)
CREATE INDEX idx_cpa_client ON public.client_project_access(client_user_id, project_id);

-- RLS
ALTER TABLE public.client_project_access ENABLE ROW LEVEL SECURITY;

-- Staff (owner + employee) can manage all client access records
CREATE POLICY "Staff can manage client access"
  ON public.client_project_access FOR ALL
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- Clients can read their own access records
CREATE POLICY "Clients can read own access"
  ON public.client_project_access FOR SELECT
  USING (client_user_id = (SELECT auth.uid()));


-- ############################################################
--  2. client_has_project_access() — helper for client RLS policies
-- ############################################################
-- SECURITY DEFINER: bypasses RLS on client_project_access during check
-- SET search_path = '': prevents search_path injection
-- STABLE + PARALLEL SAFE: safe for RLS policy evaluation and query planning

CREATE OR REPLACE FUNCTION public.client_has_project_access(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.client_project_access
    WHERE client_user_id = (SELECT auth.uid())
      AND project_id = p_project_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.client_has_project_access(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.client_has_project_access(UUID) FROM anon, public;


-- ############################################################
--  3. estimate_snapshots — immutable JSONB snapshots of estimate trees
-- ############################################################
-- NO updated_at column: snapshots are immutable once created.
-- Immutability enforced by trigger (defense-in-depth beyond RLS).

CREATE TABLE public.estimate_snapshots (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id              UUID              NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  name                     VARCHAR(255)      NOT NULL,
  description              TEXT,
  snapshot_type             public.snapshot_type NOT NULL DEFAULT 'milestone',
  estimate_status_at_time  public.estimate_status NOT NULL,
  project_status_at_time   public.project_status NOT NULL,
  snapshot_data            JSONB             NOT NULL,
  node_count               INTEGER           NOT NULL DEFAULT 0,
  total_price              DECIMAL(15,4)     DEFAULT 0,
  schema_version           INTEGER           NOT NULL DEFAULT 1,
  created_by               UUID              REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ       NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_snapshots_estimate
  ON public.estimate_snapshots(estimate_id, created_at DESC);

CREATE INDEX idx_snapshots_type
  ON public.estimate_snapshots(estimate_id, snapshot_type)
  WHERE snapshot_type = 'milestone';

-- RLS
ALTER TABLE public.estimate_snapshots ENABLE ROW LEVEL SECURITY;

-- Staff can read all snapshots
CREATE POLICY "Staff can read snapshots"
  ON public.estimate_snapshots FOR SELECT
  USING (public.is_staff());

-- Staff can create snapshots (via server action / function)
CREATE POLICY "Staff can create snapshots"
  ON public.estimate_snapshots FOR INSERT
  WITH CHECK (public.is_staff());

-- No UPDATE or DELETE policies — immutability enforced by trigger below

-- Immutability trigger: prevent all UPDATE and DELETE operations
CREATE OR REPLACE FUNCTION public.prevent_snapshot_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Allow mutation bypass for service_role operations (e.g., restore tracking)
  IF current_setting('app.allow_snapshot_mutation', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'Snapshots are immutable. Cannot % estimate_snapshots.', TG_OP;
END;
$$;

CREATE TRIGGER enforce_snapshot_immutability
  BEFORE UPDATE OR DELETE ON public.estimate_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_snapshot_mutation();


-- ############################################################
--  4. estimate_shares — share link tokens for unauthenticated access
-- ############################################################

CREATE TABLE public.estimate_shares (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id     UUID           NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  share_token     VARCHAR(64)    NOT NULL UNIQUE,
  pin_hash        TEXT           NOT NULL,
  created_by      UUID           REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at      TIMESTAMPTZ    NOT NULL,
  failed_attempts INTEGER        NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  is_revoked      BOOLEAN        NOT NULL DEFAULT FALSE,
  last_accessed_at TIMESTAMPTZ,
  access_count    INTEGER        NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_shares_estimate ON public.estimate_shares(estimate_id);
CREATE INDEX idx_shares_token ON public.estimate_shares(share_token)
  WHERE is_revoked = FALSE;

-- RLS
ALTER TABLE public.estimate_shares ENABLE ROW LEVEL SECURITY;

-- Staff can manage all share links (create, view, revoke)
CREATE POLICY "Staff can manage shares"
  ON public.estimate_shares FOR ALL
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- No client access via RLS — share link validation uses server-side
-- admin client, bypassing RLS entirely.


-- ############################################################
--  5. estimate_comments — threaded comments on estimates/nodes
-- ############################################################

CREATE TABLE public.estimate_comments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id  UUID              NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  node_id      UUID              REFERENCES public.estimate_nodes(id) ON DELETE SET NULL,
  author_type  public.author_type NOT NULL,
  author_id    UUID              REFERENCES auth.users(id) ON DELETE SET NULL,
  share_id     UUID              REFERENCES public.estimate_shares(id) ON DELETE SET NULL,
  body         TEXT              NOT NULL,
  is_resolved  BOOLEAN           NOT NULL DEFAULT FALSE,
  resolved_by  UUID              REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ       NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ       NOT NULL DEFAULT now()
);

-- Auto-update updated_at
CREATE TRIGGER set_estimate_comments_updated_at
  BEFORE UPDATE ON public.estimate_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Indexes
CREATE INDEX idx_comments_estimate ON public.estimate_comments(estimate_id);
CREATE INDEX idx_comments_node ON public.estimate_comments(node_id)
  WHERE node_id IS NOT NULL;
CREATE INDEX idx_comments_author ON public.estimate_comments(author_id)
  WHERE author_id IS NOT NULL;
CREATE INDEX idx_comments_unresolved ON public.estimate_comments(estimate_id)
  WHERE is_resolved = FALSE;

-- RLS
ALTER TABLE public.estimate_comments ENABLE ROW LEVEL SECURITY;

-- Staff: full CRUD on all comments
CREATE POLICY "Staff can manage comments"
  ON public.estimate_comments FOR ALL
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- Clients: can INSERT comments on estimates they have access to
CREATE POLICY "Clients can create comments"
  ON public.estimate_comments FOR INSERT
  WITH CHECK (
    public.get_user_role() = 'client'
    AND EXISTS (
      SELECT 1 FROM public.estimates e
      WHERE e.id = estimate_id
        AND public.client_has_project_access(e.project_id)
    )
  );

-- Clients: can read their own comments on accessible estimates
CREATE POLICY "Clients can read own comments"
  ON public.estimate_comments FOR SELECT
  USING (
    public.get_user_role() = 'client'
    AND author_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.estimates e
      WHERE e.id = estimate_id
        AND public.client_has_project_access(e.project_id)
    )
  );


-- ############################################################
--  6. estimate_approvals — client approval/rejection records
-- ############################################################

CREATE TABLE public.estimate_approvals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id    UUID                NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  author_type    public.author_type  NOT NULL,
  author_id      UUID                REFERENCES auth.users(id) ON DELETE SET NULL,
  share_id       UUID                REFERENCES public.estimate_shares(id) ON DELETE SET NULL,
  status         public.approval_status NOT NULL DEFAULT 'pending',
  notes          TEXT,
  option_set_id  UUID                REFERENCES public.option_sets(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ         NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_approvals_estimate ON public.estimate_approvals(estimate_id);
CREATE INDEX idx_approvals_author ON public.estimate_approvals(author_id)
  WHERE author_id IS NOT NULL;
CREATE INDEX idx_approvals_status ON public.estimate_approvals(estimate_id, status);

-- RLS
ALTER TABLE public.estimate_approvals ENABLE ROW LEVEL SECURITY;

-- Staff: full CRUD on all approvals
CREATE POLICY "Staff can manage approvals"
  ON public.estimate_approvals FOR ALL
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- Clients: can INSERT approvals on estimates they have access to
CREATE POLICY "Clients can create approvals"
  ON public.estimate_approvals FOR INSERT
  WITH CHECK (
    public.get_user_role() = 'client'
    AND EXISTS (
      SELECT 1 FROM public.estimates e
      WHERE e.id = estimate_id
        AND public.client_has_project_access(e.project_id)
    )
  );

-- Clients: can read their own approvals on accessible estimates
CREATE POLICY "Clients can read own approvals"
  ON public.estimate_approvals FOR SELECT
  USING (
    public.get_user_role() = 'client'
    AND author_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.estimates e
      WHERE e.id = estimate_id
        AND public.client_has_project_access(e.project_id)
    )
  );


-- ############################################################
--  CLIENT RLS POLICIES FOR ALL PRIOR TABLES
-- ############################################################
-- These are additive CREATE POLICY statements — they do NOT drop
-- or replace existing staff policies from prior migrations.
-- Each policy name is prefixed with "Clients can" for clarity.


-- ────────────────────────────────────────────────────────────
-- projects (from migration 000003)
-- Clients can SELECT projects they have been granted access to.
-- ────────────────────────────────────────────────────────────
CREATE POLICY "Clients can read accessible projects"
  ON public.projects FOR SELECT
  USING (
    public.get_user_role() = 'client'
    AND public.client_has_project_access(id)
  );


-- ────────────────────────────────────────────────────────────
-- estimates (from migration 000003)
-- Clients can SELECT estimates belonging to their accessible projects.
-- ────────────────────────────────────────────────────────────
CREATE POLICY "Clients can read accessible estimates"
  ON public.estimates FOR SELECT
  USING (
    public.get_user_role() = 'client'
    AND public.client_has_project_access(project_id)
  );


-- ────────────────────────────────────────────────────────────
-- estimate_nodes (from migration 000003)
-- Clients can SELECT non-hidden nodes on accessible estimates.
-- Hidden nodes are completely invisible. Summary_only nodes
-- show through (field-level filtering done at application layer).
-- ────────────────────────────────────────────────────────────
CREATE POLICY "Clients can read visible nodes"
  ON public.estimate_nodes FOR SELECT
  USING (
    public.get_user_role() = 'client'
    AND client_visibility != 'hidden'
    AND EXISTS (
      SELECT 1 FROM public.estimates e
      WHERE e.id = estimate_id
        AND public.client_has_project_access(e.project_id)
    )
  );


-- ────────────────────────────────────────────────────────────
-- node_item_details (from migration 000003)
-- Clients can SELECT item details ONLY for nodes with
-- client_visibility = 'visible' (NOT summary_only, NOT hidden).
-- This blocks cost breakdown for summary_only nodes.
-- ────────────────────────────────────────────────────────────
CREATE POLICY "Clients can read visible item details"
  ON public.node_item_details FOR SELECT
  USING (
    public.get_user_role() = 'client'
    AND EXISTS (
      SELECT 1 FROM public.estimate_nodes en
      JOIN public.estimates e ON e.id = en.estimate_id
      WHERE en.id = node_item_details.node_id
        AND en.client_visibility = 'visible'
        AND public.client_has_project_access(e.project_id)
    )
  );


-- ────────────────────────────────────────────────────────────
-- node_assembly_details (from migration 000003)
-- Same pattern as item_details: only for 'visible' nodes.
-- ────────────────────────────────────────────────────────────
CREATE POLICY "Clients can read visible assembly details"
  ON public.node_assembly_details FOR SELECT
  USING (
    public.get_user_role() = 'client'
    AND EXISTS (
      SELECT 1 FROM public.estimate_nodes en
      JOIN public.estimates e ON e.id = en.estimate_id
      WHERE en.id = node_assembly_details.node_id
        AND en.client_visibility = 'visible'
        AND public.client_has_project_access(e.project_id)
    )
  );


-- ────────────────────────────────────────────────────────────
-- node_notes (from migration 000003)
-- Clients can SELECT notes where:
--   1. is_client_visible = TRUE (builder explicitly marked it)
--   2. Note is not soft-deleted
--   3. Parent node is NOT hidden (visible OR summary_only)
--   4. Estimate belongs to an accessible project
-- ────────────────────────────────────────────────────────────
CREATE POLICY "Clients can read visible notes"
  ON public.node_notes FOR SELECT
  USING (
    public.get_user_role() = 'client'
    AND is_client_visible = TRUE
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.estimate_nodes en
      JOIN public.estimates e ON e.id = en.estimate_id
      WHERE en.id = node_notes.node_id
        AND en.client_visibility != 'hidden'
        AND public.client_has_project_access(e.project_id)
    )
  );


-- ────────────────────────────────────────────────────────────
-- option_groups (from migration 000005)
-- Clients can SELECT option groups for accessible estimates.
-- ────────────────────────────────────────────────────────────
CREATE POLICY "Clients can read accessible option groups"
  ON public.option_groups FOR SELECT
  USING (
    public.get_user_role() = 'client'
    AND EXISTS (
      SELECT 1 FROM public.estimates e
      WHERE e.id = estimate_id
        AND public.client_has_project_access(e.project_id)
    )
  );


-- ────────────────────────────────────────────────────────────
-- option_alternatives (from migration 000005)
-- Clients can SELECT option alternatives for accessible estimates.
-- Requires JOIN through option_groups to reach estimate_id.
-- ────────────────────────────────────────────────────────────
CREATE POLICY "Clients can read accessible option alternatives"
  ON public.option_alternatives FOR SELECT
  USING (
    public.get_user_role() = 'client'
    AND EXISTS (
      SELECT 1 FROM public.option_groups og
      JOIN public.estimates e ON e.id = og.estimate_id
      WHERE og.id = option_alternatives.group_id
        AND public.client_has_project_access(e.project_id)
    )
  );


-- ────────────────────────────────────────────────────────────
-- option_sets (from migration 000005)
-- Clients can SELECT option sets for accessible estimates.
-- ────────────────────────────────────────────────────────────
CREATE POLICY "Clients can read accessible option sets"
  ON public.option_sets FOR SELECT
  USING (
    public.get_user_role() = 'client'
    AND EXISTS (
      SELECT 1 FROM public.estimates e
      WHERE e.id = estimate_id
        AND public.client_has_project_access(e.project_id)
    )
  );


-- ────────────────────────────────────────────────────────────
-- estimate_snapshots (this migration, defined above)
-- Client policy added here to keep all client policies together.
-- Clients can SELECT snapshots for accessible estimates.
-- ────────────────────────────────────────────────────────────
CREATE POLICY "Clients can read accessible snapshots"
  ON public.estimate_snapshots FOR SELECT
  USING (
    public.get_user_role() = 'client'
    AND EXISTS (
      SELECT 1 FROM public.estimates e
      WHERE e.id = estimate_id
        AND public.client_has_project_access(e.project_id)
    )
  );
