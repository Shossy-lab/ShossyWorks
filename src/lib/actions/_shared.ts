// src/lib/actions/_shared.ts
// ────────────────────────────────────────────────────────────
// Shared utilities for all server actions.
// Every action file imports from here for auth + error handling.
// ────────────────────────────────────────────────────────────
import "server-only";

import { requireUser, requireStaff, getSessionClient } from "@/lib/auth/get-user";
import { err } from "@/lib/types/action-result";
import { ERROR_CODE } from "@/lib/types/action-result";

import type { ActionResult } from "@/lib/types/action-result";

/**
 * Get an authenticated Supabase client and the current user.
 * Redirects to sign-in if not authenticated (via requireUser).
 * Sets the user context GUC for audit trail (CF-17).
 * Uses cached session to avoid double client creation (CF-21).
 */
export async function getAuthenticatedClient() {
  const user = await requireUser();
  const supabase = await getSessionClient();

  // Set the audit trail GUC so history triggers know who made the change (CF-17)
  await supabase.rpc("set_user_context" as never, {
    p_user_id: user.id,
  } as never).then(({ error }) => {
    if (error) {
      // Non-fatal: log but don't block the action. The RPC may not exist
      // until the corresponding migration is applied.
      console.error("Failed to set user context:", error.message);
    }
  });

  return { user, supabase };
}

/**
 * Get an authenticated Supabase client for staff-only actions.
 * Redirects to sign-in if not authenticated or not staff (CF-10).
 * Sets the user context GUC for audit trail (CF-17).
 */
export async function getStaffClient() {
  const user = await requireStaff();
  const supabase = await getSessionClient();

  // Set the audit trail GUC so history triggers know who made the change (CF-17)
  await supabase.rpc("set_user_context" as never, {
    p_user_id: user.id,
  } as never).then(({ error }) => {
    if (error) {
      console.error("Failed to set user context:", error.message);
    }
  });

  return { user, supabase };
}

/**
 * Map common Supabase/PostgREST error codes to ActionResult errors.
 * Always logs the raw error server-side for debugging (CF-20).
 */
export function handleSupabaseError(error: {
  message: string;
  code?: string;
}): ActionResult<never> {
  // Log ALL errors server-side first, including known codes (CF-20)
  console.error("Supabase error:", error);

  if (error.code === "23505") {
    return err(ERROR_CODE.CONFLICT, "A record with this value already exists.");
  }
  if (error.code === "23503") {
    return err(ERROR_CODE.NOT_FOUND, "Referenced record not found.");
  }
  if (error.code === "PGRST116") {
    return err(ERROR_CODE.NOT_FOUND, "Record not found.");
  }

  return err(ERROR_CODE.SERVER_ERROR, "An unexpected error occurred.");
}
