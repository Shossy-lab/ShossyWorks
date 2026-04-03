-- Phase 0: Auth Roles & Custom Access Token Hook
-- Enables ltree extension (needed in Phase 1A)
-- Creates role enum, user_roles table, and JWT claim injection

-- ── Extensions ────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS ltree;

-- ── Role Enum ─────────────────────────────────────────────────────
CREATE TYPE public.app_role AS ENUM ('owner', 'employee', 'client');

-- ── User Roles Table ──────────────────────────────────────────────
-- Single-company, multi-user: one role per user
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'employee',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- Index for fast lookup by user_id (already covered by UNIQUE, but explicit)
CREATE INDEX idx_user_roles_user_id ON public.user_roles(user_id);

-- RLS on user_roles (only admins can modify, users can read their own)
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own role"
  ON public.user_roles FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Service role can manage all roles"
  ON public.user_roles FOR ALL
  USING (true)
  WITH CHECK (true);

-- ── Custom Access Token Hook ──────────────────────────────────────
-- Injects user_role into JWT app_metadata on every token issue/refresh
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  claims JSONB;
  user_role public.app_role;
BEGIN
  claims := event->'claims';

  SELECT ur.role
  INTO user_role
  FROM public.user_roles ur
  WHERE ur.user_id = (event->>'user_id')::UUID;

  IF user_role IS NOT NULL THEN
    claims := jsonb_set(claims, '{app_metadata,user_role}', to_jsonb(user_role::TEXT));
  ELSE
    -- Default to 'employee' if no role record exists
    claims := jsonb_set(claims, '{app_metadata,user_role}', '"employee"');
  END IF;

  RETURN jsonb_build_object('claims', claims);
END;
$$;

-- ── Permissions ───────────────────────────────────────────────────
-- Auth admin needs full access to user_roles (reads during token generation)
GRANT ALL ON TABLE public.user_roles TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;

-- Revoke from public/authenticated to prevent direct manipulation
REVOKE ALL ON TABLE public.user_roles FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;

-- Grant SELECT to authenticated users (they can see their own role via RLS)
GRANT SELECT ON TABLE public.user_roles TO authenticated;
