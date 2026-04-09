import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Skip if required env vars are missing instead of throwing at module level
const SKIP = !url || !anonKey;

describe.skipIf(SKIP)("connection-smoke/supabase", () => {
  it("CONN-L2-01: Supabase REST API is reachable", async () => {
    const response = await fetch(`${url!}/rest/v1/`, {
      headers: {
        apikey: anonKey!,
        Authorization: `Bearer ${anonKey!}`,
      },
    });
    expect(response.status).toBeLessThan(500);
  }, 10_000);

  it("CONN-L2-02: Supabase Auth service is reachable", async () => {
    const response = await fetch(`${url!}/auth/v1/settings`, {
      headers: { apikey: anonKey! },
    });
    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data).toHaveProperty("external");
  }, 10_000);

  it("CONN-L2-04: Service role key works for admin operations", async () => {
    if (!serviceKey) {
      console.warn("Skipping: SUPABASE_SERVICE_ROLE_KEY not set");
      return;
    }

    const admin = createClient(url!, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await admin.auth.admin.listUsers({ perPage: 1 });
    expect(error).toBeNull();
    expect(data).toHaveProperty("users");
  }, 10_000);

  it("CONN-L2-05: user_profiles table exists and is queryable", async () => {
    if (!serviceKey) {
      console.warn("Skipping: SUPABASE_SERVICE_ROLE_KEY not set");
      return;
    }

    const admin = createClient(url!, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error } = await admin.from("user_profiles").select("id").limit(1);
    expect(error).toBeNull();
  }, 10_000);
});
