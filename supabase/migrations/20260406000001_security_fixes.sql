-- Security fixes from codebase review (2026-04-06)
-- CRIT-03: Drop overpermissive RLS policy
-- CRIT-08: Add SECURITY DEFINER + search_path to hook
-- HIGH-15: Add 'pending' role, default new users to pending
-- MED-11: Remove redundant index

-- ── Fix RLS Policy (CRIT-03) ─────────────────────────────────────
-- The "Service role can manage all roles" policy uses USING(true)
-- which grants ALL authenticated users access. Service role bypasses
-- RLS anyway, so this policy is both dangerous and unnecessary.
DROP POLICY "Service role can manage all roles" ON public.user_roles;

-- ── Add Pending Role (HIGH-15) ───────────────────────────────────
-- New users should not get immediate employee access.
-- They start as 'pending' until an owner approves them.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'pending';

-- ── Remove Redundant Index (MED-11) ──────────────────────────────
-- UNIQUE(user_id) already creates an implicit index.
DROP INDEX IF EXISTS idx_user_roles_user_id;

-- ── Replace Hook with Hardened Version (CRIT-08) ─────────────────
-- Adds SECURITY DEFINER + SET search_path = '' to prevent
-- search_path injection (CVE-2018-1058 class vulnerability).
-- Also changes default role from 'employee' to 'pending'.
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

  SELECT ur.role
  INTO user_role
  FROM public.user_roles ur
  WHERE ur.user_id = (event->>'user_id')::UUID;

  IF user_role IS NOT NULL THEN
    claims := jsonb_set(claims, '{app_metadata,user_role}', to_jsonb(user_role::TEXT));
  ELSE
    claims := jsonb_set(claims, '{app_metadata,user_role}', '"pending"');
  END IF;

  RETURN jsonb_build_object('claims', claims);
END;
$$;

-- ── Auto-Create Role on Signup ───────────────────────────────────
-- When a new user signs up, auto-create a 'pending' role row.
-- Without this, users have no role record and rely on the hook default.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'pending');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Permissions for handle_new_user
GRANT EXECUTE ON FUNCTION public.handle_new_user TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.handle_new_user FROM authenticated, anon, public;

-- Grant schema usage to auth admin (required for hook to access public tables)
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
