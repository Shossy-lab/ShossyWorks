import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("secret-security", () => {
  it("SEC-L3-01: admin client is guarded by server-only import", () => {
    const adminFile = readFileSync(
      resolve(__dirname, "../../src/lib/supabase/admin.ts"),
      "utf-8",
    );
    expect(adminFile).toContain('import "server-only"');
  });

  it("SEC-L3-02: middleware uses getUser() not getSession() for auth checks", () => {
    const middlewareFile = readFileSync(
      resolve(__dirname, "../../src/lib/supabase/middleware.ts"),
      "utf-8",
    );
    expect(middlewareFile).toContain("getUser()");
    // Check for actual getSession() calls, not comments mentioning it
    expect(middlewareFile).toMatch(/\.auth\.getUser\(\)/);
    expect(middlewareFile).not.toMatch(/\.auth\.getSession\(\)/);
  });

  it("SEC-L3-03: server-only env vars do NOT have NEXT_PUBLIC_ prefix", () => {
    const envFile = readFileSync(resolve(__dirname, "../../src/env.ts"), "utf-8");

    // These must be in the `server` block, not `client`
    const serverOnlyVars = [
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_SECRET_KEY",
      "DATABASE_URL",
      "SUPABASE_DB_PASSWORD",
      "SUPABASE_JWT_SECRET",
      "ANTHROPIC_API_KEY",
    ];

    for (const varName of serverOnlyVars) {
      expect(envFile).not.toContain(`NEXT_PUBLIC_${varName}`);
    }
  });

  it("SEC-L3-04: .env.local.example does not contain real secrets", () => {
    const exampleFile = readFileSync(resolve(__dirname, "../../.env.local.example"), "utf-8");

    // Should contain placeholder text, not real values
    expect(exampleFile).not.toMatch(/eyJhbGciOi/); // JWT token prefix
    expect(exampleFile).not.toMatch(/sb_secret_/); // Supabase secret key prefix
    expect(exampleFile).not.toMatch(/sk-ant-/); // Anthropic key prefix
  });
});
