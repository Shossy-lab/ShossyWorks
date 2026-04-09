-- Set user context GUC for history trigger audit trail
-- Called by server actions to set app.current_user_id
-- so history triggers can capture changed_by

CREATE OR REPLACE FUNCTION public.set_user_context(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM set_config('app.current_user_id', p_user_id::text, true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_user_context(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.set_user_context(UUID) FROM anon, public;
