-- Phase 1A-0: Drop legacy user_roles table
-- Runs AFTER 20260409000001_security_foundation.sql has created user_profiles
-- and migrated all data.
--
-- Safety: Verifies user_profiles contains data before dropping user_roles.
-- If user_profiles is empty, the migration aborts with an exception to
-- prevent data loss.

-- ============================================================
-- 1. Verify user_profiles has data before dropping user_roles
-- ============================================================
DO $$
DECLARE
  profile_count INTEGER;
BEGIN
  SELECT count(*) INTO profile_count FROM public.user_profiles;

  IF profile_count = 0 THEN
    RAISE EXCEPTION
      'SAFETY CHECK FAILED: user_profiles is empty. '
      'Data migration from user_roles did not run or found no rows. '
      'Aborting drop to prevent data loss. '
      'Run 20260409000001_security_foundation.sql first.';
  END IF;

  RAISE NOTICE 'Safety check passed: user_profiles has % row(s). Proceeding with drop.', profile_count;
END;
$$;


-- ============================================================
-- 2. Revoke grants on the old table before dropping
-- ============================================================
REVOKE ALL ON TABLE public.user_roles FROM supabase_auth_admin, authenticated, anon, public;


-- ============================================================
-- 3. Drop user_roles table
-- ============================================================
-- CASCADE drops dependent objects (RLS policies, indexes).
-- The on_auth_user_created trigger references handle_new_user() which
-- was already updated to write to user_profiles in the previous migration.
DROP TABLE public.user_roles CASCADE;
