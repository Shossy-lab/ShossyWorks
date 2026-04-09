-- Phase A1: Snapshot delete RPC and immutability trigger fix
-- Addresses:
--   CF-04-CRIT — Admin snapshot delete either always fails or bypasses all RLS.
--                Trigger inconsistency between migrations 006/007.
--   CF-06     — Admin delete snapshot bypass needs controlled mechanism.
--   CF-23     — Unhandled throw from createAdminClient().
--
-- Fix:
--   1. Replace prevent_snapshot_mutation() trigger to allow DELETE
--      only when the app.allow_snapshot_delete bypass variable is set.
--   2. Create delete_milestone_snapshot() SECURITY DEFINER RPC that
--      handles the bypass internally (staff-only, milestone-only).
--
-- Depends on:
--   20260409000001_security_foundation.sql  (is_staff())
--   20260409000006_client_sharing_tables.sql (estimate_snapshots, trigger)
--   20260409000007_triggers.sql             (current trigger definition)


-- ############################################################
--  1. Replace prevent_snapshot_mutation() trigger function
--     Allows DELETE only when app.allow_snapshot_delete = 'true'.
--     All other mutations (UPDATE, INSERT via trigger) still blocked.
-- ############################################################

CREATE OR REPLACE FUNCTION public.prevent_snapshot_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Allow DELETE only when the controlled bypass variable is set.
  -- This variable is only set by delete_milestone_snapshot() which
  -- enforces its own auth guard and business rules.
  IF TG_OP = 'DELETE' AND current_setting('app.allow_snapshot_delete', true) = 'true' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'Snapshots are immutable: % not allowed', TG_OP;
END;
$$;

COMMENT ON FUNCTION public.prevent_snapshot_mutation() IS
  'Prevents mutation of estimate_snapshots rows. DELETE is allowed only '
  'when app.allow_snapshot_delete GUC is set to true (controlled by '
  'delete_milestone_snapshot RPC). All other mutations are blocked.';


-- ############################################################
--  2. delete_milestone_snapshot() — staff-only, milestone-only
-- ############################################################
-- Safe RPC for deleting milestone snapshots. Enforces:
--   - Staff role check (owner/employee)
--   - Snapshot must exist
--   - Only 'milestone' type snapshots can be deleted (not 'checkpoint')
--   - Sets bypass variable scoped to current transaction
--   - Returns TRUE on success

CREATE OR REPLACE FUNCTION public.delete_milestone_snapshot(
  p_snapshot_id  UUID,
  p_deleted_by   UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_snapshot_type public.snapshot_type;
BEGIN
  -- AUTH GUARD: Only staff (owner/employee) may delete snapshots
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'Permission denied: staff role required';
  END IF;

  -- Validate snapshot exists and check type
  SELECT snapshot_type
    INTO v_snapshot_type
    FROM public.estimate_snapshots
   WHERE id = p_snapshot_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Snapshot % not found', p_snapshot_id;
  END IF;

  -- Only milestone snapshots can be deleted (checkpoints are protected)
  IF v_snapshot_type != 'milestone' THEN
    RAISE EXCEPTION 'Cannot delete % snapshot. Only milestone snapshots can be deleted.', v_snapshot_type;
  END IF;

  -- Enable the bypass variable (transaction-scoped via SET LOCAL)
  SET LOCAL app.allow_snapshot_delete = 'true';

  -- Delete the snapshot (trigger will allow it due to bypass variable)
  DELETE FROM public.estimate_snapshots
   WHERE id = p_snapshot_id;

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION public.delete_milestone_snapshot(UUID, UUID) IS
  'Safely deletes a milestone snapshot. Staff-only. Refuses to delete '
  'checkpoint snapshots (they are auto-generated safety nets). '
  'Uses transaction-scoped bypass variable to pass immutability trigger.';

GRANT EXECUTE ON FUNCTION public.delete_milestone_snapshot(UUID, UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_milestone_snapshot(UUID, UUID) FROM anon, public;
