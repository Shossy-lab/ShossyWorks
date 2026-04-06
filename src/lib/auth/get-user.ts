import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export const getUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  return { user, error };
});

export async function requireUser() {
  const { user, error } = await getUser();

  if (error) {
    console.error("Auth error:", error.message);
    redirect("/sign-in?error=service_unavailable");
  }

  if (!user) {
    redirect("/sign-in");
  }

  return user;
}
