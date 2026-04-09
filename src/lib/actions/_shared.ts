// src/lib/actions/_shared.ts
// ────────────────────────────────────────────────────────────
// Shared utilities for all server actions.
// Every action file imports from here for auth + error handling.
// ────────────────────────────────────────────────────────────
"use server";

import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/get-user";
import { err } from "@/lib/types/action-result";
import { ERROR_CODE } from "@/lib/types/action-result";

import type { ActionResult } from "@/lib/types/action-result";

/**
 * Get an authenticated Supabase client and the current user.
 * Redirects to sign-in if not authenticated (via requireUser).
 */
export async function getAuthenticatedClient() {
  const user = await requireUser();
  const supabase = await createClient();
  return { user, supabase };
}

/**
 * Map common Supabase/PostgREST error codes to ActionResult errors.
 * Always logs the raw error server-side for debugging.
 */
export function handleSupabaseError(error: {
  message: string;
  code?: string;
}): ActionResult<never> {
  if (error.code === "23505") {
    return err(ERROR_CODE.CONFLICT, "A record with this value already exists.");
  }
  if (error.code === "23503") {
    return err(ERROR_CODE.NOT_FOUND, "Referenced record not found.");
  }
  if (error.code === "PGRST116") {
    return err(ERROR_CODE.NOT_FOUND, "Record not found.");
  }

  console.error("Supabase error:", error);
  return err(ERROR_CODE.SERVER_ERROR, "An unexpected error occurred.");
}
