import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import type { User } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/supabase";

/**
 * Cached auth session — returns the Supabase client AND user in one call.
 * Avoids double client creation when both are needed (CF-21).
 */
export const getAuthSession = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  return { supabase, user, error };
});

/** @deprecated Use getAuthSession() to avoid double client creation */
export const getUser = cache(async () => {
  const { user, error } = await getAuthSession();
  return { user, error };
});

/**
 * Require an authenticated user. Redirects to sign-in on failure.
 */
export async function requireUser(): Promise<User> {
  const { user, error } = await getAuthSession();

  if (error) {
    console.error("Auth error:", error.message);
    redirect("/sign-in?error=service_unavailable");
  }

  if (!user) {
    redirect("/sign-in");
  }

  return user;
}

/**
 * Require an authenticated staff user (owner or employee).
 * Redirects to sign-in with forbidden error for non-staff roles (CF-10).
 */
export async function requireStaff(): Promise<User> {
  const user = await requireUser();
  const role = (user.app_metadata?.user_role as string) ?? "pending";
  if (role !== "owner" && role !== "employee") {
    redirect("/sign-in?error=forbidden");
  }
  return user;
}

/**
 * Get the cached Supabase client from the auth session.
 * Must be called after requireUser() / requireStaff() in the same request.
 */
export async function getSessionClient(): Promise<SupabaseClient<Database>> {
  const { supabase } = await getAuthSession();
  return supabase;
}
