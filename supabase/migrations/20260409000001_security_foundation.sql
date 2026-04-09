-- Phase 1A-0: Security Foundation
-- Establishes get_user_role(), is_staff() helpers, creates user_profiles
-- table (replacing user_roles), updates auth hooks, adds role protection.
--
-- Depends on: 00000000000001_auth_roles.sql (app_role enum, user_roles table)
--             20260406000001_security_fixes.sql ('pending' enum value, hardened hook)

-- ============================================================
-- 1. get_user_role(): Extract role from JWT app_metadata
-- ============================================================
-- SECURITY DEFINER: runs as function owner (postgres), not caller
-- SET search_path = '': prevents search_path injection (CVE-2018-1058)
-- STABLE: does not modify database; safe for RLS evaluation
-- PARALLEL SAFE: can run in parallel query plans
-- Pure SQL: inlined by planner in RLS policies (5-10x faster than PL/pgSQL)
--
-- Returns: 'owner' | 'employee' | 'client' | 'pending' | 'anon'
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'user_role'),
    CASE
      WHEN auth.uid() IS NOT NULL THEN 'pending'
      ELSE 'anon'
    END
  );
$$;

-- Grant to authenticated and anon (needed for RLS policy evaluation)
GRANT EXECUTE ON FUNCTION public.get_user_role() TO authenticated, anon;

-- Revoke from public to prevent non-API access
REVOKE EXECUTE ON FUNCTION public.get_user_role() FROM public;


-- ============================================================
-- 2. is_staff(): Convenience helper for owner/employee check
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.get_user_role() IN ('owner', 'employee');
$$;

GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.is_staff() FROM public;


-- ============================================================
-- 3. user_profiles table (replaces user_roles)
-- ============================================================
CREATE TABLE public.user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'pending',
  display_name VARCHAR(255),
  email VARCHAR(255),
  -- PIN auth columns (Phase 1B ready, unused until then)
  pin_hash VARCHAR(255),
  pin_failed_attempts INTEGER NOT NULL DEFAULT 0,
  pin_locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_user_profile UNIQUE(user_id)
);


-- ============================================================
-- 4. Enable RLS on user_profiles
-- ============================================================
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- 5. RLS policies for user_profiles
-- ============================================================

-- Users can read their own profile
CREATE POLICY "Users can read own profile"
  ON public.user_profiles FOR SELECT
  USING (user_id = (SELECT auth.uid()));

-- Owner has full access to all profiles (user management, role assignment)
CREATE POLICY "Owner can manage all profiles"
  ON public.user_profiles FOR ALL
  USING (public.get_user_role() = 'owner')
  WITH CHECK (public.get_user_role() = 'owner');

-- Staff (owner + employee) can read all profiles
CREATE POLICY "Staff can read all profiles"
  ON public.user_profiles FOR SELECT
  USING (public.is_staff());


-- ============================================================
-- 6. Migrate data from user_roles to user_profiles
-- ============================================================
INSERT INTO public.user_profiles (user_id, role, created_at, updated_at)
SELECT user_id, role, created_at, updated_at
FROM public.user_roles
ON CONFLICT (user_id) DO NOTHING;


-- ============================================================
-- 7. Updated handle_new_user() — now writes to user_profiles
-- ============================================================
-- Replaces the version from 20260406000001_security_fixes.sql.
-- Captures email and display_name from the auth.users row.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.user_profiles (user_id, role, display_name, email)
  VALUES (
    NEW.id,
    'pending',
    COALESCE(NEW.raw_user_meta_data ->> 'display_name', NEW.raw_user_meta_data ->> 'full_name'),
    NEW.email
  );
  RETURN NEW;
END;
$$;

-- The on_auth_user_created trigger already exists (from 20260406000001)
-- and points to handle_new_user(), so no trigger re-creation needed.


-- ============================================================
-- 8. Updated custom_access_token_hook() — reads from user_profiles
-- ============================================================
-- Replaces the version from 20260406000001_security_fixes.sql.
-- Now reads role from user_profiles instead of user_roles.
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  claims JSONB;
  user_role public.app_role;
BEGIN
  claims := event->'claims';

  SELECT up.role
  INTO user_role
  FROM public.user_profiles up
  WHERE up.user_id = (event->>'user_id')::UUID;

  IF user_role IS NOT NULL THEN
    claims := jsonb_set(claims, '{app_metadata,user_role}', to_jsonb(user_role::TEXT));
  ELSE
    claims := jsonb_set(claims, '{app_metadata,user_role}', '"pending"');
  END IF;

  RETURN jsonb_build_object('claims', claims);
END;
$$;


-- ============================================================
-- 9. prevent_role_self_change() — defense-in-depth trigger
-- ============================================================
-- Prevents any non-owner from changing role values on user_profiles.
-- Even if RLS is bypassed (e.g., service role context), this trigger
-- enforces that only owners can change roles.
CREATE OR REPLACE FUNCTION public.prevent_role_self_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- If the role column is being changed, only owners may do so
  IF OLD.role IS DISTINCT FROM NEW.role THEN
    IF public.get_user_role() != 'owner' THEN
      RAISE EXCEPTION 'Only owners can change user roles';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER prevent_role_self_change
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_role_self_change();


-- ============================================================
-- 10. Permissions for user_profiles
-- ============================================================

-- Auth admin needs full access (reads role during token generation)
GRANT ALL ON TABLE public.user_profiles TO supabase_auth_admin;

-- Revoke direct manipulation from API roles
REVOKE ALL ON TABLE public.user_profiles FROM authenticated, anon, public;

-- Grant SELECT back to authenticated (RLS policies control row visibility)
GRANT SELECT ON TABLE public.user_profiles TO authenticated;

-- Schema usage (may already exist, idempotent)
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
