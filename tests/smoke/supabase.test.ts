import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

describe("connection-smoke/supabase", () => {
  it("CONN-L2-01: Supabase REST API is reachable", async () => {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
      },
    });
    expect(response.status).toBeLessThan(500);
  }, 10_000);

  it("CONN-L2-02: Supabase Auth service is reachable", async () => {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: ANON_KEY },
    });
    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data).toHaveProperty("external");
  }, 10_000);

  it("CONN-L2-04: Service role key works for admin operations", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await admin.auth.admin.listUsers({ perPage: 1 });
    expect(error).toBeNull();
    expect(data).toHaveProperty("users");
  }, 10_000);

  it("CONN-L2-05: user_roles table exists and is queryable", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error } = await admin.from("user_roles").select("id").limit(1);
    expect(error).toBeNull();
  }, 10_000);
});
