# 05 — Comprehensive Environment, Secrets & Connection Test Suite Design

> **Purpose:** Exhaustive test suite specification ensuring ShossyWorks never ships with broken environment variables, leaked secrets, failed connections, or misconfigured services. Every test specifies: name, what it validates, pass/fail criteria, when it runs, and how to run it.
>
> **Stack:** Next.js (App Router) + Supabase + Vercel + Azure Key Vault + TypeScript
>
> **Testing Framework:** Vitest (primary), Playwright (E2E), custom scripts (CI/CD)

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Layer 1 — Build-Time Env Validation (Zod Schemas)](#2-layer-1--build-time-env-validation)
3. [Layer 2 — Connection Smoke Tests](#3-layer-2--connection-smoke-tests)
4. [Layer 3 — Secret Security Tests](#4-layer-3--secret-security-tests)
5. [Layer 4 — Deployment Verification Tests](#5-layer-4--deployment-verification-tests)
6. [Layer 5 — Integration Smoke Tests](#6-layer-5--integration-smoke-tests)
7. [Layer 6 — Runtime Health Monitoring](#7-layer-6--runtime-health-monitoring)
8. [Test Infrastructure & Configuration](#8-test-infrastructure--configuration)
9. [CI/CD Pipeline Integration](#9-cicd-pipeline-integration)
10. [Implementation Priority](#10-implementation-priority)

---

## 1. Architecture Overview

### Test Pyramid for Env/Connection Validation

```
                    ┌──────────────────────┐
                    │  Runtime Monitoring   │  ← Layer 6: Periodic health probes
                    │  (production only)    │     in production
                    ├──────────────────────┤
                    │  Integration Smoke    │  ← Layer 5: E2E flows that exercise
                    │  (post-deploy)        │     full connection paths
                    ├──────────────────────┤
                    │  Deployment Verify    │  ← Layer 4: Health endpoint after
                    │  (post-deploy)        │     each Vercel deployment
                ┌───┴──────────────────────┴───┐
                │  Secret Security Tests       │  ← Layer 3: Verify server-only
                │  (build + unit)              │     vars stay server-only
                ├──────────────────────────────┤
                │  Connection Smoke Tests      │  ← Layer 2: Can we reach each
                │  (unit + integration)        │     service? Auth working?
            ┌───┴──────────────────────────────┴───┐
            │  Build-Time Env Validation (Zod)     │  ← Layer 1: Fail the build if
            │  (build step — zero runtime cost)    │     env vars are wrong/missing
            └──────────────────────────────────────┘
```

### When Each Layer Runs

| Layer | Trigger | Blocks Deploy? | Environment |
|-------|---------|---------------|-------------|
| L1 — Build-time validation | `next build`, `vitest` | **Yes** — build fails | All |
| L2 — Connection smoke | `vitest run --project smoke` | **Yes** — CI fails | CI, Dev |
| L3 — Secret security | `vitest run --project security` | **Yes** — CI fails | CI |
| L4 — Deployment verify | Post-deploy webhook/action | **Yes** — rollback | Preview, Prod |
| L5 — Integration smoke | Post-deploy, on-demand | Advisory | Preview, Prod |
| L6 — Runtime monitoring | Cron (every 5 min) | N/A — alerts only | Prod |

---

## 2. Layer 1 — Build-Time Env Validation

### Philosophy

Use `@t3-oss/env-nextjs` with Zod schemas to validate every environment variable at build time. If a variable is missing, malformed, or has the wrong type, the build fails immediately with a clear error message. No runtime surprises.

### Implementation: `src/env.ts`

This is the single source of truth for all environment variables in the application. Every file that needs an env var imports from here — never from `process.env` directly.

**Key design decisions from research:**
- Uses T3 env `vercel()` preset for auto-validating Vercel system vars
- Uses `experimental__runtimeEnv` (Next.js >= 13.4.4) instead of `runtimeEnv` for client vars
- `emptyStringAsUndefined: true` prevents `""` from passing `.min(1)` checks
- `SKIP_ENV_VALIDATION` escape hatch for Docker/CI builds that don't need all vars
- Supports both legacy keys (`anon`/`service_role`) and new keys (`publishable`/`secret`) during the Supabase key transition (deadline: late 2026)

```typescript
// src/env.ts
import { createEnv } from "@t3-oss/env-nextjs";
import { vercel } from "@t3-oss/env-core/presets-zod";
import { z } from "zod";

export const env = createEnv({
  // Auto-validate Vercel system vars (VERCEL_ENV, VERCEL_URL, etc.)
  extends: [vercel()],

  server: {
    // --- Supabase (server-only) ---
    // Legacy keys (transitional — remove after late 2026 migration)
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
    // New keys (primary after migration)
    SUPABASE_SECRET_KEY: z.string().min(1).optional(),
    // At least one server key must be present
    // (validated in custom test, not expressible in Zod alone)

    // Database connections
    DATABASE_URL: z.string().startsWith("postgres"),  // Pooled (Supavisor transaction mode, port 6543)
    DIRECT_DATABASE_URL: z.string().startsWith("postgres").optional(),  // Direct (port 5432, for migrations)
    SUPABASE_DB_PASSWORD: z.string().min(1).optional(),  // Raw password for constructing connection strings
    SUPABASE_PROJECT_ID: z.string().min(1).optional(),  // Project ref for constructing URLs

    // Auth
    SUPABASE_JWT_SECRET: z.string().min(32).optional(),  // Only needed if manually verifying JWTs

    // Azure Key Vault (optional — only needed if app fetches from vault at runtime)
    AZURE_KEYVAULT_URL: z.string().url().optional(),

    // AI
    ANTHROPIC_API_KEY: z.string().min(1).optional(),

    // App
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    CRON_SECRET: z.string().min(16).optional(),
  },

  client: {
    // --- Supabase (client-safe — RLS protects data) ---
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),  // Legacy anon key
    // NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),  // Enable after key migration

    // --- App Config ---
    NEXT_PUBLIC_APP_URL: z.string().url(),
  },

  // Next.js >= 13.4.4: only need to specify client vars here
  experimental__runtimeEnv: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },

  // Treat "" as undefined — prevents empty strings from passing .min(1)
  emptyStringAsUndefined: true,

  // Escape hatch for Docker/CI builds
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
```

**Trigger validation at build time** by importing in `next.config.ts`:

```typescript
// next.config.ts
import "./src/env";
// ... rest of config
```

### Test: ENV-L1-01 — Build fails on missing required server vars

| Field | Value |
|-------|-------|
| **Name** | `env-validation/missing-server-vars` |
| **What it validates** | Build-time schema rejects missing required server env vars |
| **Pass criteria** | `createEnv()` throws ZodError listing each missing var |
| **Fail criteria** | `createEnv()` succeeds silently or throws a non-descriptive error |
| **When it runs** | Every `next build`, every `vitest` run |
| **How to run** | `vitest run src/env.test.ts --test "missing server vars"` |

```typescript
// src/env.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("env-validation/missing-server-vars", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws when SUPABASE_SERVICE_ROLE_KEY is missing", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(() => {
      // Re-import to trigger validation
      // Implementation: use vi.resetModules() + dynamic import
    }).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("throws when SUPABASE_DB_URL is missing", () => {
    vi.stubEnv("SUPABASE_DB_URL", "");
    expect(() => { /* re-validate */ }).toThrow(/SUPABASE_DB_URL/);
  });

  it("throws when AZURE_TENANT_ID is missing", () => {
    vi.stubEnv("AZURE_TENANT_ID", "");
    expect(() => { /* re-validate */ }).toThrow(/AZURE_TENANT_ID/);
  });

  it("throws when AZURE_KEYVAULT_URL is missing", () => {
    vi.stubEnv("AZURE_KEYVAULT_URL", "");
    expect(() => { /* re-validate */ }).toThrow(/AZURE_KEYVAULT_URL/);
  });
});
```

### Test: ENV-L1-02 — Build fails on missing required client vars

| Field | Value |
|-------|-------|
| **Name** | `env-validation/missing-client-vars` |
| **What it validates** | Build-time schema rejects missing required NEXT_PUBLIC_ vars |
| **Pass criteria** | `createEnv()` throws ZodError for each missing client var |
| **Fail criteria** | Build succeeds with missing client vars |
| **When it runs** | Every `next build`, every `vitest` run |
| **How to run** | `vitest run src/env.test.ts --test "missing client vars"` |

### Test: ENV-L1-03 — Build fails on malformed values

| Field | Value |
|-------|-------|
| **Name** | `env-validation/malformed-values` |
| **What it validates** | Schema rejects wrong formats (non-URL for URL fields, non-UUID for UUID fields, etc.) |
| **Pass criteria** | Throws for: non-URL Supabase URL, non-UUID tenant ID, too-short keys |
| **Fail criteria** | Accepts garbage values |
| **When it runs** | Every `next build`, every `vitest` run |
| **How to run** | `vitest run src/env.test.ts --test "malformed"` |

```typescript
describe("env-validation/malformed-values", () => {
  it("rejects non-URL for NEXT_PUBLIC_SUPABASE_URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "not-a-url");
    expect(() => { /* re-validate */ }).toThrow();
  });

  it("rejects non-UUID for AZURE_TENANT_ID", () => {
    vi.stubEnv("AZURE_TENANT_ID", "not-a-uuid");
    expect(() => { /* re-validate */ }).toThrow();
  });

  it("rejects too-short SUPABASE_SERVICE_ROLE_KEY", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "short");
    expect(() => { /* re-validate */ }).toThrow(/too short/);
  });

  it("rejects SUPABASE_DB_URL without postgres:// prefix", () => {
    vi.stubEnv("SUPABASE_DB_URL", "https://not-postgres.com");
    expect(() => { /* re-validate */ }).toThrow();
  });

  it("rejects AZURE_KEYVAULT_URL without vault.azure.net", () => {
    vi.stubEnv("AZURE_KEYVAULT_URL", "https://random.example.com");
    expect(() => { /* re-validate */ }).toThrow();
  });
});
```

### Test: ENV-L1-04 — Valid env passes validation

| Field | Value |
|-------|-------|
| **Name** | `env-validation/valid-env-passes` |
| **What it validates** | A complete, correctly-formatted .env passes all validations |
| **Pass criteria** | `createEnv()` returns typed object with all expected keys |
| **Fail criteria** | Throws despite valid inputs |
| **When it runs** | Every `next build`, every `vitest` run |
| **How to run** | `vitest run src/env.test.ts --test "valid env"` |

### Test: ENV-L1-05 — Environment-specific defaults work correctly

| Field | Value |
|-------|-------|
| **Name** | `env-validation/env-specific-defaults` |
| **What it validates** | Optional vars with defaults resolve correctly per environment |
| **Pass criteria** | VERCEL_ENV optional in dev, CRON_SECRET optional but validated when present |
| **Fail criteria** | Defaults don't apply or optional vars cause build failure |
| **When it runs** | Every `next build`, every `vitest` run |
| **How to run** | `vitest run src/env.test.ts --test "defaults"` |

---

## 3. Layer 2 — Connection Smoke Tests

### Philosophy

These tests verify that the application can actually reach each external service. They run fast (< 5s each with timeouts) and test the real connection — no mocks. They are safe to run against real services because they perform read-only operations.

### Test: CONN-L2-01 — Supabase REST API reachable

| Field | Value |
|-------|-------|
| **Name** | `connection-smoke/supabase-rest-api` |
| **What it validates** | Supabase REST API responds to requests using the anon key |
| **Pass criteria** | HTTP 200 from Supabase REST endpoint within 3s |
| **Fail criteria** | Timeout, HTTP error, or connection refused |
| **When it runs** | CI pipeline, local `vitest run --project smoke` |
| **How to run** | `vitest run tests/smoke/supabase.test.ts --test "REST API"` |

```typescript
// tests/smoke/supabase.test.ts
import { createClient } from "@supabase/supabase-js";
import { describe, it, expect } from "vitest";
import { env } from "@/env";

describe("connection-smoke/supabase-rest-api", () => {
  it("connects to Supabase REST API with anon key", async () => {
    const supabase = createClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { auth: { persistSession: false } }
    );

    // Attempt a lightweight query — select from a known system view
    const { error } = await supabase
      .from("_test_connection")  // or use a simple RPC
      .select("*")
      .limit(1)
      .abortSignal(AbortSignal.timeout(3000));

    // Even a 404 (table not found) confirms the API is reachable
    // Connection failures throw, not return errors
    expect(error?.code).not.toBe("PGRST301"); // connection error
  }, 5000);
});
```

### Test: CONN-L2-02 — Supabase Auth service reachable

| Field | Value |
|-------|-------|
| **Name** | `connection-smoke/supabase-auth` |
| **What it validates** | Supabase GoTrue (Auth) API responds and accepts requests |
| **Pass criteria** | Auth settings endpoint returns valid JSON within 3s |
| **Fail criteria** | Timeout, connection error, or invalid response |
| **When it runs** | CI pipeline, local `vitest run --project smoke` |
| **How to run** | `vitest run tests/smoke/supabase.test.ts --test "Auth service"` |

```typescript
describe("connection-smoke/supabase-auth", () => {
  it("reaches Supabase Auth settings endpoint", async () => {
    const response = await fetch(
      `${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`,
      {
        headers: {
          apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        },
        signal: AbortSignal.timeout(3000),
      }
    );

    expect(response.ok).toBe(true);
    const settings = await response.json();
    expect(settings).toHaveProperty("external");
  }, 5000);
});
```

### Test: CONN-L2-03 — Supabase Realtime WebSocket connectable

| Field | Value |
|-------|-------|
| **Name** | `connection-smoke/supabase-realtime` |
| **What it validates** | Supabase Realtime WebSocket accepts connection and responds to heartbeat |
| **Pass criteria** | Channel subscribes with status `SUBSCRIBED` within 5s |
| **Fail criteria** | Timeout, `CHANNEL_ERROR`, or `TIMED_OUT` status |
| **When it runs** | CI pipeline, local `vitest run --project smoke` |
| **How to run** | `vitest run tests/smoke/supabase.test.ts --test "Realtime"` |

```typescript
describe("connection-smoke/supabase-realtime", () => {
  it("establishes Realtime WebSocket connection", async () => {
    const supabase = createClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { auth: { persistSession: false } }
    );

    const status = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Realtime timeout")), 5000);

      const channel = supabase.channel("connection-test");
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timeout);
          supabase.removeChannel(channel);
          resolve(status);
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timeout);
          supabase.removeChannel(channel);
          reject(new Error(`Realtime failed: ${status}`));
        }
      });
    });

    expect(status).toBe("SUBSCRIBED");
  }, 10000);
});
```

### Test: CONN-L2-04 — Supabase service role key works (server-only)

| Field | Value |
|-------|-------|
| **Name** | `connection-smoke/supabase-service-role` |
| **What it validates** | Service role key authenticates and bypasses RLS |
| **Pass criteria** | Can query with service role, response is valid |
| **Fail criteria** | Authentication error, RLS block, or connection failure |
| **When it runs** | CI pipeline (server-only tests), local dev |
| **How to run** | `vitest run tests/smoke/supabase-server.test.ts` |

```typescript
// tests/smoke/supabase-server.test.ts
describe("connection-smoke/supabase-service-role", () => {
  it("authenticates with service role key", async () => {
    const supabase = createClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );

    // Service role should be able to list auth users (bypasses RLS)
    const { data, error } = await supabase.auth.admin.listUsers({
      perPage: 1,
    });

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data).toHaveProperty("users");
  }, 5000);
});
```

### Test: CONN-L2-05 — Supabase PostgreSQL pooled connection (Supavisor)

| Field | Value |
|-------|-------|
| **Name** | `connection-smoke/supabase-postgres-pooled` |
| **What it validates** | Pooled connection string (Supavisor transaction mode, port 6543) works for serverless |
| **Pass criteria** | Can execute `SELECT 1` via pooled connection within 5s |
| **Fail criteria** | Connection refused, auth failure, or timeout |
| **When it runs** | CI pipeline, local dev |
| **How to run** | `vitest run tests/smoke/postgres.test.ts` |

```typescript
// tests/smoke/postgres.test.ts
import postgres from "postgres";

describe("connection-smoke/supabase-postgres-pooled", () => {
  it("connects via Supavisor pooled connection (DATABASE_URL)", async () => {
    const sql = postgres(env.DATABASE_URL, {
      connect_timeout: 5,
      idle_timeout: 5,
      max: 1,
      prepare: false, // REQUIRED for Supavisor transaction mode
    });

    try {
      const result = await sql`SELECT 1 as connected`;
      expect(result[0].connected).toBe(1);
    } finally {
      await sql.end();
    }
  }, 10000);
});

describe("connection-smoke/supabase-postgres-direct", () => {
  it("connects via direct PostgreSQL connection (DIRECT_DATABASE_URL)", async () => {
    if (!process.env.DIRECT_DATABASE_URL) {
      console.log("DIRECT_DATABASE_URL not set — skipping direct connection test");
      return;
    }

    const sql = postgres(process.env.DIRECT_DATABASE_URL, {
      connect_timeout: 5,
      idle_timeout: 5,
      max: 1,
    });

    try {
      const result = await sql`SELECT 1 as connected`;
      expect(result[0].connected).toBe(1);
    } finally {
      await sql.end();
    }
  }, 10000);
});
```

### Test: CONN-L2-06 — Azure Key Vault reachable (conditional)

| Field | Value |
|-------|-------|
| **Name** | `connection-smoke/azure-keyvault` |
| **What it validates** | Azure Key Vault is reachable and credentials authenticate |
| **Pass criteria** | Can list secret names (not values) from the vault within 5s |
| **Fail criteria** | Authentication failure, network error, or permission denied |
| **When it runs** | CI pipeline (with Azure credentials), local dev (if AZURE_KEYVAULT_URL set) |
| **How to run** | `vitest run tests/smoke/azure.test.ts` |

```typescript
// tests/smoke/azure.test.ts
import { SecretClient } from "@azure/keyvault-secrets";
import { DefaultAzureCredential } from "@azure/identity";

describe("connection-smoke/azure-keyvault", () => {
  it("authenticates and lists secrets from Azure Key Vault", async () => {
    const vaultUrl = process.env.AZURE_KEYVAULT_URL;
    if (!vaultUrl) {
      console.log("AZURE_KEYVAULT_URL not set — skipping vault test");
      return;
    }

    // DefaultAzureCredential tries: managed identity (Azure) -> az CLI (local) -> env vars (CI)
    const credential = new DefaultAzureCredential();
    const client = new SecretClient(vaultUrl, credential);

    // List secrets (just names, not values) to verify access
    const secrets: string[] = [];
    for await (const secretProperties of client.listPropertiesOfSecrets()) {
      secrets.push(secretProperties.name);
      if (secrets.length >= 1) break; // Just need to prove access
    }

    expect(secrets.length).toBeGreaterThan(0);
  }, 10000);
});
```

### Test: CONN-L2-07 — Supabase Auth settings endpoint reachable

| Field | Value |
|-------|-------|
| **Name** | `connection-smoke/supabase-auth-settings` |
| **What it validates** | The Supabase Auth (GoTrue) server responds and returns valid settings |
| **Pass criteria** | Settings endpoint returns provider configuration (email, etc.) |
| **Fail criteria** | Auth endpoint unreachable or returns invalid response |
| **When it runs** | CI pipeline, local dev |
| **How to run** | `vitest run tests/smoke/supabase.test.ts --test "Auth settings"` |

---

## 4. Layer 3 — Secret Security Tests

### Philosophy

These tests ensure that server-only secrets never leak to the client bundle. They test both the code-level protections (using `server-only` package, `@t3-oss/env-nextjs` separation) and the build output (scanning `.next/` for secret patterns).

### Test: SEC-L3-01 — Server env vars are not in client schema

| Field | Value |
|-------|-------|
| **Name** | `secret-security/server-vars-not-in-client` |
| **What it validates** | Server-only vars (SUPABASE_SERVICE_ROLE_KEY, AZURE_*, SUPABASE_DB_URL, JWT_SECRET) are declared in `server` schema, not `client` |
| **Pass criteria** | None of the server secrets are prefixed with NEXT_PUBLIC_ |
| **Fail criteria** | Any secret appears in the client schema |
| **When it runs** | Every CI run, every `vitest` run |
| **How to run** | `vitest run tests/security/env-separation.test.ts` |

```typescript
// tests/security/env-separation.test.ts
describe("secret-security/server-vars-not-in-client", () => {
  const MUST_BE_SERVER_ONLY = [
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SECRET_KEY",
    "DATABASE_URL",
    "DIRECT_DATABASE_URL",
    "SUPABASE_DB_PASSWORD",
    "SUPABASE_JWT_SECRET",
    "SUPABASE_PROJECT_ID",
    "SUPABASE_PUBLISHABLE_KEY",
    "AZURE_KEYVAULT_URL",
    "ANTHROPIC_API_KEY",
    "CRON_SECRET",
  ];

  for (const varName of MUST_BE_SERVER_ONLY) {
    it(`${varName} is NOT prefixed with NEXT_PUBLIC_`, () => {
      expect(varName).not.toMatch(/^NEXT_PUBLIC_/);
    });

    it(`NEXT_PUBLIC_${varName} is not defined in process.env`, () => {
      expect(process.env[`NEXT_PUBLIC_${varName}`]).toBeUndefined();
    });
  }
});
```

### Test: SEC-L3-02 — Server modules use `server-only` import guard

| Field | Value |
|-------|-------|
| **Name** | `secret-security/server-only-import-guard` |
| **What it validates** | Files that import server secrets include `import "server-only"` |
| **Pass criteria** | All files importing from `@/env` server vars contain the guard |
| **Fail criteria** | A file accesses server env vars without the `server-only` import |
| **When it runs** | CI pipeline (static analysis) |
| **How to run** | `vitest run tests/security/server-only-guard.test.ts` |

```typescript
// tests/security/server-only-guard.test.ts
import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";

describe("secret-security/server-only-import-guard", () => {
  const SRC_DIR = resolve(__dirname, "../../src");

  function findTsFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        files.push(...findTsFiles(full));
      } else if (full.match(/\.(ts|tsx)$/)) {
        files.push(full);
      }
    }
    return files;
  }

  // Files that import server env vars should have "server-only" guard
  it("all server data access files include server-only import", () => {
    const serverPatterns = [
      /env\.SUPABASE_SERVICE_ROLE_KEY/,
      /env\.SUPABASE_SECRET_KEY/,
      /env\.DATABASE_URL/,
      /env\.DIRECT_DATABASE_URL/,
      /env\.SUPABASE_DB_PASSWORD/,
      /env\.SUPABASE_JWT_SECRET/,
      /env\.AZURE_/,
      /env\.ANTHROPIC_API_KEY/,
      /env\.CRON_SECRET/,
    ];

    const violations: string[] = [];

    for (const file of findTsFiles(SRC_DIR)) {
      const content = readFileSync(file, "utf-8");
      const usesServerEnv = serverPatterns.some((p) => p.test(content));

      if (usesServerEnv && !content.includes('import "server-only"')) {
        violations.push(file);
      }
    }

    expect(violations).toEqual([]);
  });
});
```

### Test: SEC-L3-03 — Build output does not contain secrets

| Field | Value |
|-------|-------|
| **Name** | `secret-security/build-output-clean` |
| **What it validates** | The `.next/static/` client bundle contains no server-only secret values |
| **Pass criteria** | No server env var values found in any client-side JS chunk |
| **Fail criteria** | Any secret value appears in a client chunk |
| **When it runs** | After `next build` in CI |
| **How to run** | `node scripts/scan-build-for-secrets.mjs` |

```javascript
// scripts/scan-build-for-secrets.mjs
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

const NEXT_DIR = ".next/static";
const SECRET_NAMES = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY",
  "DATABASE_URL",
  "DIRECT_DATABASE_URL",
  "SUPABASE_DB_PASSWORD",
  "SUPABASE_JWT_SECRET",
  "SUPABASE_PROJECT_ID",
  "AZURE_KEYVAULT_URL",
  "ANTHROPIC_API_KEY",
  "CRON_SECRET",
];

function getJsFiles(dir) {
  const files = [];
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        files.push(...getJsFiles(full));
      } else if (full.endsWith(".js")) {
        files.push(full);
      }
    }
  } catch { /* directory may not exist during unit tests */ }
  return files;
}

let failed = false;
const jsFiles = getJsFiles(NEXT_DIR);

for (const name of SECRET_NAMES) {
  const value = process.env[name];
  if (!value) continue;

  for (const file of jsFiles) {
    const content = readFileSync(file, "utf-8");
    if (content.includes(value)) {
      console.error(`FAIL: ${name} value found in ${file}`);
      failed = true;
    }
    // Also check for the env var name being referenced (process.env.SECRET_NAME)
    if (content.includes(`process.env.${name}`)) {
      console.error(`FAIL: process.env.${name} reference found in ${file}`);
      failed = true;
    }
  }
}

if (failed) {
  console.error("\nSECURITY FAILURE: Server secrets leaked to client bundle!");
  process.exit(1);
} else {
  console.log("PASS: No server secrets found in client bundle.");
}
```

### Test: SEC-L3-04 — Service role key not exposed via NEXT_PUBLIC_ prefix

| Field | Value |
|-------|-------|
| **Name** | `secret-security/service-role-not-public` |
| **What it validates** | The Supabase service role key is NEVER accessible with a NEXT_PUBLIC_ prefix |
| **Pass criteria** | `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` is undefined |
| **Fail criteria** | The service role key is available under any NEXT_PUBLIC_ name |
| **When it runs** | Every CI run |
| **How to run** | `vitest run tests/security/env-separation.test.ts --test "service role"` |

### Test: SEC-L3-05 — `.env.local` is in `.gitignore`

| Field | Value |
|-------|-------|
| **Name** | `secret-security/env-gitignored` |
| **What it validates** | `.env.local`, `.env.*.local`, and `.env` are listed in `.gitignore` |
| **Pass criteria** | All env files with secrets are gitignored |
| **Fail criteria** | Any secret-containing env file is not gitignored |
| **When it runs** | Every CI run |
| **How to run** | `vitest run tests/security/gitignore.test.ts` |

```typescript
// tests/security/gitignore.test.ts
import { readFileSync } from "fs";
import { resolve } from "path";

describe("secret-security/env-gitignored", () => {
  const gitignore = readFileSync(resolve(__dirname, "../../.gitignore"), "utf-8");

  const MUST_BE_IGNORED = [".env", ".env.local", ".env.*.local"];

  for (const pattern of MUST_BE_IGNORED) {
    it(`${pattern} is in .gitignore`, () => {
      expect(gitignore).toContain(pattern);
    });
  }
});
```

### Test: SEC-L3-06 — `.env.example` contains no real values

| Field | Value |
|-------|-------|
| **Name** | `secret-security/env-example-no-real-values` |
| **What it validates** | `.env.example` only contains placeholder/dummy values, no real secrets |
| **Pass criteria** | All values in `.env.example` are clearly placeholders (e.g., `your-key-here`) |
| **Fail criteria** | Any value looks like a real key (long alphanumeric strings, valid UUIDs, real URLs) |
| **When it runs** | Every CI run |
| **How to run** | `vitest run tests/security/env-example.test.ts` |

```typescript
// tests/security/env-example.test.ts
import { readFileSync } from "fs";
import { resolve } from "path";

describe("secret-security/env-example-no-real-values", () => {
  it("contains only placeholder values", () => {
    const content = readFileSync(resolve(__dirname, "../../.env.example"), "utf-8");
    const lines = content.split("\n").filter((l) => l.includes("=") && !l.startsWith("#"));

    const PLACEHOLDER_PATTERNS = [
      /your[-_].*[-_]here/i,
      /^https:\/\/your[-_]/,
      /^placeholder/i,
      /^xxx/i,
      /^change[-_]me/i,
      /^$/,  // empty value is fine
    ];

    const suspicious: string[] = [];
    for (const line of lines) {
      const [, value] = line.split("=", 2);
      if (!value) continue;

      // Skip if it's clearly a placeholder
      if (PLACEHOLDER_PATTERNS.some((p) => p.test(value.trim()))) continue;

      // Flag if it looks like a real key (long base64-ish strings)
      if (value.trim().length > 30 && /^[A-Za-z0-9+/=_-]+$/.test(value.trim())) {
        suspicious.push(line.trim());
      }
    }

    expect(suspicious).toEqual([]);
  });
});
```

### Test: SEC-L3-07 — Middleware uses `getClaims()` not `getSession()`

| Field | Value |
|-------|-------|
| **Name** | `secret-security/middleware-uses-getClaims` |
| **What it validates** | Middleware token validation uses the secure `getClaims()` method (revalidates token) instead of `getSession()` (trusts cached data) |
| **Pass criteria** | `middleware.ts` contains `getClaims()` and does NOT contain `getSession()` |
| **Fail criteria** | `middleware.ts` uses `getSession()` for auth validation |
| **When it runs** | Every CI run |
| **How to run** | `vitest run tests/security/middleware-auth.test.ts` |

```typescript
// tests/security/middleware-auth.test.ts
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

describe("secret-security/middleware-uses-getClaims", () => {
  const middlewarePath = resolve(__dirname, "../../middleware.ts");

  it("middleware file exists", () => {
    expect(existsSync(middlewarePath)).toBe(true);
  });

  it("uses getClaims() for token validation", () => {
    const content = readFileSync(middlewarePath, "utf-8");
    expect(content).toContain("getClaims");
  });

  it("does NOT use getSession() for auth (insecure)", () => {
    const content = readFileSync(middlewarePath, "utf-8");
    // getSession() does not revalidate the JWT — it trusts cached data
    expect(content).not.toMatch(/\.getSession\(\)/);
  });
});
```

### Test: SEC-L3-08 — At least one server key is present (key transition)

| Field | Value |
|-------|-------|
| **Name** | `secret-security/server-key-present` |
| **What it validates** | At least one of `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY` is defined |
| **Pass criteria** | One or both keys are present and non-empty |
| **Fail criteria** | Both keys are undefined or empty |
| **When it runs** | Every CI run, every build |
| **How to run** | `vitest run tests/security/key-transition.test.ts` |

```typescript
// tests/security/key-transition.test.ts
describe("secret-security/server-key-present", () => {
  it("at least one Supabase server key is available", () => {
    const legacyKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const newKey = process.env.SUPABASE_SECRET_KEY;

    const hasKey = (legacyKey && legacyKey.length > 0) ||
                   (newKey && newKey.length > 0);

    expect(hasKey).toBe(true);
  });
});
```

### Test: SEC-L3-09 — Admin client disables session persistence

| Field | Value |
|-------|-------|
| **Name** | `secret-security/admin-client-no-session` |
| **What it validates** | The admin/service-role Supabase client is created with `persistSession: false`, `autoRefreshToken: false`, `detectSessionInUrl: false` |
| **Pass criteria** | Admin client file contains all three disabled options |
| **Fail criteria** | Any session persistence option is missing or enabled |
| **When it runs** | Every CI run |
| **How to run** | `vitest run tests/security/admin-client.test.ts` |

```typescript
// tests/security/admin-client.test.ts
import { readFileSync } from "fs";
import { resolve } from "path";

describe("secret-security/admin-client-no-session", () => {
  const adminPath = resolve(__dirname, "../../src/lib/supabase/admin.ts");

  it("disables persistSession", () => {
    const content = readFileSync(adminPath, "utf-8");
    expect(content).toContain("persistSession: false");
  });

  it("disables autoRefreshToken", () => {
    const content = readFileSync(adminPath, "utf-8");
    expect(content).toContain("autoRefreshToken: false");
  });

  it("disables detectSessionInUrl", () => {
    const content = readFileSync(adminPath, "utf-8");
    expect(content).toContain("detectSessionInUrl: false");
  });
});
```

### Test: SEC-L3-10 — Vault secrets match env var expectations

| Field | Value |
|-------|-------|
| **Name** | `secret-security/vault-env-alignment` |
| **What it validates** | The `pull-env.sh` script's SECRET_MAP covers all required env vars, and no env var is sourced outside the vault without explicit documentation |
| **Pass criteria** | Every required env var in `src/env.ts` has a corresponding vault secret mapping |
| **Fail criteria** | An env var is required but has no vault source |
| **When it runs** | On-demand, during audits |
| **How to run** | `vitest run tests/security/vault-alignment.test.ts` |

---

## 5. Layer 4 — Deployment Verification Tests

### Philosophy

After every Vercel deployment (preview and production), verify the deployment is healthy before routing traffic. Uses a dedicated health check endpoint and post-deploy GitHub Actions.

### Implementation: Health Check Endpoint

```typescript
// src/app/api/health/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CheckResult = {
  name: string;
  status: "pass" | "fail";
  latencyMs: number;
  error?: string;
};

async function checkWithTimeout(
  name: string,
  check: () => Promise<void>,
  timeoutMs = 3000
): Promise<CheckResult> {
  const start = Date.now();
  try {
    await Promise.race([
      check(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), timeoutMs)
      ),
    ]);
    return { name, status: "pass", latencyMs: Date.now() - start };
  } catch (err) {
    return {
      name,
      status: "fail",
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function GET(request: Request) {
  // Optional: require a secret for deep checks
  const authHeader = request.headers.get("authorization");
  const isDeepCheck = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  const checks: CheckResult[] = [];

  // === Shallow check (always runs) ===
  checks.push({
    name: "app",
    status: "pass",
    latencyMs: 0,
  });

  // === Deep checks (only with auth) ===
  if (isDeepCheck) {
    // Check Supabase REST API
    checks.push(
      await checkWithTimeout("supabase-rest", async () => {
        const supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          { auth: { persistSession: false } }
        );
        const { error } = await supabase.from("_health").select("*").limit(1);
        // Table not existing is fine — we're testing connectivity
        if (error && error.code === "PGRST301") throw error;
      })
    );

    // Check Supabase Auth
    checks.push(
      await checkWithTimeout("supabase-auth", async () => {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`,
          {
            headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! },
          }
        );
        if (!res.ok) throw new Error(`Auth API returned ${res.status}`);
      })
    );
  }

  const allPassed = checks.every((c) => c.status === "pass");

  return NextResponse.json(
    {
      status: allPassed ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      environment: process.env.VERCEL_ENV ?? "development",
      checks,
    },
    {
      status: allPassed ? 200 : 503,
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    }
  );
}
```

### Test: DEPLOY-L4-01 — Health endpoint returns 200

| Field | Value |
|-------|-------|
| **Name** | `deployment-verify/health-endpoint-ok` |
| **What it validates** | `/api/health` returns HTTP 200 with valid JSON |
| **Pass criteria** | Status 200, body has `status: "healthy"`, all checks pass |
| **Fail criteria** | Status != 200, body missing required fields, any check fails |
| **When it runs** | After every Vercel deployment (preview + production) |
| **How to run** | `curl -f https://{deployment-url}/api/health` |

### Test: DEPLOY-L4-02 — Deep health check passes (authenticated)

| Field | Value |
|-------|-------|
| **Name** | `deployment-verify/deep-health-check` |
| **What it validates** | `/api/health` with CRON_SECRET auth returns deep dependency checks |
| **Pass criteria** | All dependency checks (supabase-rest, supabase-auth) pass |
| **Fail criteria** | Any dependency check fails |
| **When it runs** | After production deploys, every 5 min via cron |
| **How to run** | `curl -f -H "Authorization: Bearer $CRON_SECRET" https://{url}/api/health` |

### Test: DEPLOY-L4-03 — Preview deployment has correct env scope

| Field | Value |
|-------|-------|
| **Name** | `deployment-verify/preview-env-scope` |
| **What it validates** | Preview deployments use preview env vars, not production |
| **Pass criteria** | `VERCEL_ENV` is `preview`, Supabase URL points to staging/dev project |
| **Fail criteria** | Preview deployment connects to production database |
| **When it runs** | After preview deployments |
| **How to run** | `curl https://{preview-url}/api/health | jq .environment` |

### Test: DEPLOY-L4-04 — Production deployment has all required vars

| Field | Value |
|-------|-------|
| **Name** | `deployment-verify/production-env-complete` |
| **What it validates** | Production deployment loaded all required env vars |
| **Pass criteria** | Health check confirms all services reachable |
| **Fail criteria** | Any connection check fails due to missing env vars |
| **When it runs** | After production deployments |
| **How to run** | GitHub Action post-deploy workflow |

### GitHub Actions Workflow: Post-Deploy Verification

```yaml
# .github/workflows/post-deploy-verify.yml
name: Post-Deploy Verification

on:
  deployment_status:
    # Triggered by Vercel after deploy

jobs:
  verify:
    if: github.event.deployment_status.state == 'success'
    runs-on: ubuntu-latest
    steps:
      - name: Wait for deployment to stabilize
        run: sleep 10

      - name: Shallow health check
        run: |
          URL="${{ github.event.deployment_status.target_url }}"
          STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${URL}/api/health")
          if [ "$STATUS" != "200" ]; then
            echo "FAIL: Health check returned $STATUS"
            exit 1
          fi
          echo "PASS: Health check returned 200"

      - name: Deep health check (production only)
        if: github.event.deployment.environment == 'production'
        run: |
          URL="${{ github.event.deployment_status.target_url }}"
          RESPONSE=$(curl -s -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" "${URL}/api/health")
          STATUS=$(echo "$RESPONSE" | jq -r '.status')
          if [ "$STATUS" != "healthy" ]; then
            echo "FAIL: Deep health check returned: $RESPONSE"
            exit 1
          fi
          echo "PASS: All dependency checks passed"
          echo "$RESPONSE" | jq '.checks[]'

      - name: Verify env scope
        run: |
          URL="${{ github.event.deployment_status.target_url }}"
          RESPONSE=$(curl -s "${URL}/api/health")
          ENV=$(echo "$RESPONSE" | jq -r '.environment')
          EXPECTED="${{ github.event.deployment.environment }}"
          if [ "$ENV" != "$EXPECTED" ]; then
            echo "FAIL: Expected env=$EXPECTED but got env=$ENV"
            exit 1
          fi
          echo "PASS: Environment scope is correct ($ENV)"
```

---

## 6. Layer 5 — Integration Smoke Tests

### Philosophy

These tests exercise complete user flows that touch multiple services. They run after deployment and verify that the full stack works end-to-end. Failures are advisory (don't auto-rollback) but trigger alerts.

### Test: INT-L5-01 — Supabase anon key respects RLS

| Field | Value |
|-------|-------|
| **Name** | `integration-smoke/anon-key-rls` |
| **What it validates** | Anonymous requests via the anon key are properly restricted by RLS |
| **Pass criteria** | Unauthenticated queries return empty/restricted results, not full data |
| **Fail criteria** | Anon key bypasses RLS and returns unrestricted data |
| **When it runs** | Post-deploy, on-demand |
| **How to run** | `vitest run tests/integration/rls.test.ts` |

```typescript
// tests/integration/rls.test.ts
describe("integration-smoke/anon-key-rls", () => {
  it("anon key cannot access admin-only data", async () => {
    const supabase = createClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { auth: { persistSession: false } }
    );

    // Try to read a table that should be restricted
    const { data, error } = await supabase
      .from("estimates")  // or whatever protected table exists
      .select("*")
      .limit(10);

    // Should either error (no access) or return empty (RLS blocks)
    if (error) {
      expect(error.code).toBeDefined(); // Error is expected
    } else {
      // If no error, RLS should have filtered results
      expect(data).toHaveLength(0);
    }
  });
});
```

### Test: INT-L5-02 — Service role can read/write (server-side operations)

| Field | Value |
|-------|-------|
| **Name** | `integration-smoke/service-role-operations` |
| **What it validates** | Server-side operations using service role key work correctly |
| **Pass criteria** | Can insert and delete a test row using service role |
| **Fail criteria** | Service role auth fails or operation errors |
| **When it runs** | Post-deploy (production), on-demand |
| **How to run** | `vitest run tests/integration/service-role.test.ts` |

```typescript
// tests/integration/service-role.test.ts
describe("integration-smoke/service-role-operations", () => {
  it("can perform server-side CRUD with service role", async () => {
    const adminClient = createClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );

    // Insert a test record
    const testId = `test-${Date.now()}`;
    const { error: insertError } = await adminClient
      .from("_health_check")  // dedicated health check table
      .insert({ id: testId, checked_at: new Date().toISOString() });

    expect(insertError).toBeNull();

    // Clean up
    const { error: deleteError } = await adminClient
      .from("_health_check")
      .delete()
      .eq("id", testId);

    expect(deleteError).toBeNull();
  });
});
```

### Test: INT-L5-03 — Auth flow complete cycle

| Field | Value |
|-------|-------|
| **Name** | `integration-smoke/auth-flow-cycle` |
| **What it validates** | Full auth cycle: signUp -> signIn -> getUser -> signOut |
| **Pass criteria** | All auth operations succeed with valid responses |
| **Fail criteria** | Any auth operation fails or returns unexpected data |
| **When it runs** | Post-deploy, on-demand |
| **How to run** | `vitest run tests/integration/auth-flow.test.ts` |

### Test: INT-L5-04 — Supabase client creation works in all contexts

| Field | Value |
|-------|-------|
| **Name** | `integration-smoke/client-contexts` |
| **What it validates** | Supabase clients can be created for browser, server component, server action, route handler, and middleware contexts |
| **Pass criteria** | Each client factory returns a valid client without throwing |
| **Fail criteria** | Any client factory throws or returns undefined |
| **When it runs** | CI pipeline |
| **How to run** | `vitest run tests/integration/client-contexts.test.ts` |

### Test: INT-L5-05 — Azure Key Vault secret retrieval end-to-end

| Field | Value |
|-------|-------|
| **Name** | `integration-smoke/keyvault-secret-retrieval` |
| **What it validates** | Can retrieve a known test secret from Azure Key Vault |
| **Pass criteria** | Secret value is returned and is non-empty |
| **Fail criteria** | Auth failure, permission denied, or empty value |
| **When it runs** | On-demand, CI with Azure credentials |
| **How to run** | `vitest run tests/integration/azure.test.ts` |

### Test: INT-L5-06 — Admin client uses correct package

| Field | Value |
|-------|-------|
| **Name** | `integration-smoke/admin-client-package` |
| **What it validates** | The admin/service-role client uses `@supabase/supabase-js` `createClient` directly, NOT `@supabase/ssr` `createServerClient` |
| **Pass criteria** | Admin client file imports `createClient` from `@supabase/supabase-js` |
| **Fail criteria** | Admin client imports from `@supabase/ssr` (would inject user cookies into service role operations) |
| **When it runs** | Every CI run |
| **How to run** | `vitest run tests/integration/admin-client-import.test.ts` |

```typescript
// tests/integration/admin-client-import.test.ts
import { readFileSync } from "fs";
import { resolve } from "path";

describe("integration-smoke/admin-client-package", () => {
  const adminPath = resolve(__dirname, "../../src/lib/supabase/admin.ts");

  it("imports createClient from @supabase/supabase-js (not @supabase/ssr)", () => {
    const content = readFileSync(adminPath, "utf-8");
    // Must use the base package for admin client
    expect(content).toContain("@supabase/supabase-js");
    // Must NOT use SSR client (it injects user cookies)
    expect(content).not.toContain("createServerClient");
    expect(content).not.toContain("@supabase/ssr");
  });
});
```

### Test: INT-L5-07 — Realtime channels use `private: true` for auth

| Field | Value |
|-------|-------|
| **Name** | `integration-smoke/realtime-private-channels` |
| **What it validates** | All Realtime channel subscriptions for authenticated data use `private: true` |
| **Pass criteria** | Every `supabase.channel()` call for estimate data includes `{ config: { private: true } }` |
| **Fail criteria** | A channel for sensitive data lacks the `private: true` flag (allows any authenticated user to join) |
| **When it runs** | Every CI run (static analysis) |
| **How to run** | `vitest run tests/integration/realtime-auth.test.ts` |

### Test: INT-L5-08 — Server actions independently verify auth

| Field | Value |
|-------|-------|
| **Name** | `integration-smoke/server-actions-verify-auth` |
| **What it validates** | Server actions call `getUser()` or `getClaims()` before performing mutations (never rely on middleware alone) |
| **Pass criteria** | Every server action file with mutations calls auth verification |
| **Fail criteria** | A mutation server action trusts middleware without independent auth check |
| **When it runs** | Every CI run (static analysis) |
| **How to run** | `vitest run tests/integration/server-action-auth.test.ts` |

### Test: INT-L5-09 — Pull script matches env schema

| Field | Value |
|-------|-------|
| **Name** | `integration-smoke/pull-script-env-alignment` |
| **What it validates** | The `scripts/pull-env.sh` SECRET_MAP produces all required env vars defined in `src/env.ts` |
| **Pass criteria** | Every non-optional server env var in the Zod schema has a corresponding mapping in the pull script |
| **Fail criteria** | An env var is required by the schema but missing from the pull script |
| **When it runs** | On-demand, during audits |
| **How to run** | `vitest run tests/integration/env-alignment.test.ts` |

---

## 7. Layer 6 — Runtime Health Monitoring

### Philosophy

Continuous monitoring in production catches issues that only appear under real traffic conditions. These are not test files — they are endpoints and cron jobs built into the application.

### Monitor: HEALTH-L6-01 — Cron-based deep health check

| Field | Value |
|-------|-------|
| **Name** | `runtime-health/cron-deep-check` |
| **What it validates** | All service dependencies are reachable every 5 minutes |
| **Pass criteria** | All dependency checks pass |
| **Fail criteria** | Any dependency unreachable → trigger alert |
| **When it runs** | Every 5 minutes in production (Vercel Cron) |
| **How to run** | Automated via `vercel.json` cron config |

```json
// vercel.json (partial)
{
  "crons": [
    {
      "path": "/api/cron/health-check",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

```typescript
// src/app/api/cron/health-check/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Hit the deep health endpoint
  const healthUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? `https://${process.env.VERCEL_URL}`}/api/health`;
  const response = await fetch(healthUrl, {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  });

  const health = await response.json();

  if (health.status !== "healthy") {
    // TODO: Send alert (email, Slack, PagerDuty, etc.)
    console.error("[HEALTH-ALERT]", JSON.stringify(health));

    // Could also write to a Supabase alerts table
    // or trigger a webhook to external monitoring
  }

  return NextResponse.json({
    checked_at: new Date().toISOString(),
    health,
  });
}
```

### Monitor: HEALTH-L6-02 — Supabase Realtime heartbeat monitoring

| Field | Value |
|-------|-------|
| **Name** | `runtime-health/realtime-heartbeat` |
| **What it validates** | Realtime WebSocket connection stays alive and receives heartbeats |
| **Pass criteria** | Heartbeat received within expected interval (25s default) |
| **Fail criteria** | No heartbeat for 60s → connection degraded |
| **When it runs** | Continuously while app is running |
| **How to run** | Built into Supabase client configuration |

```typescript
// src/lib/supabase/client.ts (monitoring configuration)
const supabase = createBrowserClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  {
    realtime: {
      heartbeatCallback: (status: string) => {
        if (status === "error") {
          console.error("[REALTIME-HEARTBEAT] Connection lost");
          // Optionally report to error tracking (Sentry, etc.)
        }
      },
    },
  }
);
```

### Monitor: HEALTH-L6-03 — Database connection pool monitoring

| Field | Value |
|-------|-------|
| **Name** | `runtime-health/db-pool-monitoring` |
| **What it validates** | PostgreSQL connection pool is not exhausted |
| **Pass criteria** | Active connections < 80% of pool limit |
| **Fail criteria** | Active connections > 80% → warning, > 95% → critical |
| **When it runs** | Every 5 minutes via health cron |
| **How to run** | Query `pg_stat_activity` via service role |

---

## 8. Test Infrastructure & Configuration

### Vitest Configuration

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { loadEnvConfig } from "@next/env";

// Load Next.js env vars for tests
loadEnvConfig(process.cwd());

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    globals: true,
    unstubEnvs: true,  // Reset stubbed env vars between tests

    // Project-based test organization
    projects: [
      {
        // Unit tests (env validation, security checks)
        test: {
          name: "unit",
          include: ["src/**/*.test.ts", "tests/security/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        // Connection smoke tests (require real env vars)
        test: {
          name: "smoke",
          include: ["tests/smoke/**/*.test.ts"],
          environment: "node",
          testTimeout: 15000,
          hookTimeout: 10000,
        },
      },
      {
        // Integration tests (require running services)
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          testTimeout: 30000,
          hookTimeout: 15000,
          // Run sequentially to avoid connection pool issues
          sequence: { concurrent: false },
        },
      },
    ],
  },
});
```

### Directory Structure

```
shossyworks/
├── src/
│   ├── env.ts                           # Single source of truth (Zod + T3 env)
│   ├── env.test.ts                      # L1: Build-time validation tests
│   ├── app/
│   │   └── api/
│   │       ├── health/
│   │       │   └── route.ts             # L4: Health check endpoint
│   │       └── cron/
│   │           └── health-check/
│   │               └── route.ts         # L6: Cron health monitor
│   └── lib/
│       └── supabase/
│           ├── client.ts                # Browser client with monitoring
│           ├── server.ts                # Server client (import "server-only")
│           └── admin.ts                 # Service role client (import "server-only")
├── tests/
│   ├── smoke/
│   │   ├── supabase.test.ts             # L2: Supabase REST, Auth, Realtime
│   │   ├── supabase-server.test.ts      # L2: Service role, direct PG
│   │   ├── postgres.test.ts             # L2: Direct PostgreSQL connection
│   │   └── azure.test.ts               # L2: Azure Key Vault
│   ├── security/
│   │   ├── env-separation.test.ts       # L3: Server/client var separation
│   │   ├── server-only-guard.test.ts    # L3: server-only import check
│   │   ├── gitignore.test.ts            # L3: .env files gitignored
│   │   └── env-example.test.ts          # L3: .env.example has no real values
│   └── integration/
│       ├── rls.test.ts                  # L5: RLS enforcement
│       ├── service-role.test.ts         # L5: Service role CRUD
│       ├── auth-flow.test.ts            # L5: Auth cycle
│       ├── client-contexts.test.ts      # L5: Client creation contexts
│       └── azure.test.ts               # L5: Key Vault retrieval
├── scripts/
│   └── scan-build-for-secrets.mjs       # L3: Post-build secret scanning
├── .github/
│   └── workflows/
│       ├── ci.yml                       # CI pipeline (L1-L3)
│       └── post-deploy-verify.yml       # Post-deploy (L4-L5)
├── .env.example                         # Template with placeholder values
├── .env.local                           # Local dev (gitignored)
└── vercel.json                          # Cron config for L6
```

### Required npm Packages

```json
{
  "dependencies": {
    "@t3-oss/env-nextjs": "^0.11.0",
    "@t3-oss/env-core": "^0.11.0",
    "zod": "^3.23.0",
    "@supabase/supabase-js": "^2.49.0",
    "@supabase/ssr": "^0.6.0",
    "server-only": "^0.0.1"
  },
  "devDependencies": {
    "vitest": "^3.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "vite-tsconfig-paths": "^5.1.0",
    "@azure/keyvault-secrets": "^4.9.0",
    "@azure/identity": "^4.5.0",
    "postgres": "^3.4.0",
    "@playwright/test": "^1.50.0",
    "supabase": "^2.0.0"
  }
}
```

| Package | Purpose |
|---|---|
| `@t3-oss/env-nextjs` | Build-time env validation with Zod schemas |
| `@t3-oss/env-core` | Presets (`vercel()`, `supabaseVercel()`) for auto-validating platform vars |
| `zod` | Schema validation library used by T3 env |
| `@supabase/supabase-js` | Core Supabase client (admin/service role operations) |
| `@supabase/ssr` | SSR-specific client (`createBrowserClient`, `createServerClient`, cookie helpers) |
| `server-only` | Build-time guardrail preventing server modules from being imported in client components |
| `vitest` | Testing framework (unit, smoke, integration, security) |
| `postgres` | Direct PostgreSQL connection for smoke tests |
| `supabase` | Supabase CLI for local dev, migrations, type generation |
```

### `.env.example` Template

```bash
# =============================================================================
# ShossyWorks — Environment Variables
# =============================================================================
# Copy to .env.local and fill in values. NEVER commit .env.local.
# Auto-populate from Azure Key Vault: ./scripts/pull-env.sh
# Auto-populate from Vercel: vercel env pull .env.local
# =============================================================================

# --- Supabase (Client-safe — exposed in browser via NEXT_PUBLIC_ prefix) ---
# RLS protects data even with these exposed
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here

# --- Supabase (Server-only — NEVER prefix with NEXT_PUBLIC_) ---
# Legacy keys (transitional — remove after late 2026)
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
# New keys (enable after migration)
# SUPABASE_SECRET_KEY=your-secret-key-here

# --- Database Connections ---
# Pooled via Supavisor transaction mode (port 6543) — for serverless/server actions/ORMs
DATABASE_URL=postgres://postgres.your-project-ref:your-password@aws-0-us-east-1.pooler.supabase.com:6543/postgres
# Direct connection (port 5432) — for migrations and admin tasks
# DIRECT_DATABASE_URL=postgresql://postgres:your-password@db.your-project-ref.supabase.co:5432/postgres

# --- Auth (optional) ---
# Only needed if manually verifying JWTs (prefer getClaims() instead)
# SUPABASE_JWT_SECRET=your-jwt-secret-here

# --- Azure Key Vault (optional — only needed if fetching secrets at runtime) ---
# AZURE_KEYVAULT_URL=https://shossyworks-vault.vault.azure.net

# --- AI (optional) ---
# ANTHROPIC_API_KEY=your-anthropic-api-key-here

# --- App Config ---
NEXT_PUBLIC_APP_URL=http://localhost:3000
# CRON_SECRET=change-me-to-a-long-random-string-min-16-chars
```

---

## 9. CI/CD Pipeline Integration

### GitHub Actions CI Pipeline

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  # Use test/staging values for CI
  NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.CI_SUPABASE_URL }}
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.CI_SUPABASE_ANON_KEY }}
  SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.CI_SUPABASE_SERVICE_ROLE_KEY }}
  SUPABASE_DB_URL: ${{ secrets.CI_SUPABASE_DB_URL }}
  SUPABASE_JWT_SECRET: ${{ secrets.CI_SUPABASE_JWT_SECRET }}
  AZURE_TENANT_ID: ${{ secrets.AZURE_TENANT_ID }}
  AZURE_CLIENT_ID: ${{ secrets.AZURE_CLIENT_ID }}
  AZURE_CLIENT_SECRET: ${{ secrets.AZURE_CLIENT_SECRET }}
  AZURE_KEYVAULT_URL: ${{ secrets.AZURE_KEYVAULT_URL }}

jobs:
  # ---- Phase 1: Build-time validation (L1) ----
  validate-env:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - name: "L1: Build-time env validation"
        run: npx vitest run src/env.test.ts --reporter=verbose

  # ---- Phase 2: Security tests (L3) ----
  security-tests:
    runs-on: ubuntu-latest
    needs: validate-env
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - name: "L3: Secret security tests"
        run: npx vitest run --project security --reporter=verbose
      - name: "L3: Build and scan for leaked secrets"
        run: |
          npm run build
          node scripts/scan-build-for-secrets.mjs

  # ---- Phase 3: Connection smoke tests (L2) ----
  connection-smoke:
    runs-on: ubuntu-latest
    needs: validate-env
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - name: "L2: Connection smoke tests"
        run: npx vitest run --project smoke --reporter=verbose

  # ---- Phase 4: Integration smoke tests (L5) ----
  integration-smoke:
    runs-on: ubuntu-latest
    needs: [security-tests, connection-smoke]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - name: "L5: Integration smoke tests"
        run: npx vitest run --project integration --reporter=verbose
```

### Test Execution Summary

| Command | What Runs | When to Use |
|---------|-----------|-------------|
| `npx vitest run src/env.test.ts` | L1 only (fast, no network) | Quick validation |
| `npx vitest run --project security` | L3 only (fast, no network) | Security audit |
| `npx vitest run --project smoke` | L2 only (needs real env vars) | After env changes |
| `npx vitest run --project integration` | L5 only (needs running services) | After deploys |
| `npx vitest run` | All local tests (L1 + L2 + L3 + L5) | Full local validation |
| `npm run build && node scripts/scan-build-for-secrets.mjs` | L3 build scan | Before deploying |
| `curl https://{url}/api/health` | L4 shallow check | After any deploy |
| `curl -H "Authorization: Bearer $SECRET" https://{url}/api/health` | L4 deep check | After prod deploy |

---

## 10. Implementation Priority

### Phase 1 — Foundation (Implement First)
1. **`src/env.ts`** — T3 env with Zod schemas (L1). This is the single most impactful test. Once this exists, builds fail immediately on missing/malformed vars.
2. **`src/env.test.ts`** — Unit tests for the env schema (L1).
3. **`.env.example`** — Template with placeholder values.

### Phase 2 — Security Guardrails
4. **`tests/security/env-separation.test.ts`** — Verify server/client separation (L3).
5. **`tests/security/gitignore.test.ts`** — Verify env files are gitignored (L3).
6. **`scripts/scan-build-for-secrets.mjs`** — Post-build secret scanner (L3).

### Phase 3 — Connection Verification
7. **`tests/smoke/supabase.test.ts`** — REST, Auth, Realtime smoke tests (L2).
8. **`tests/smoke/supabase-server.test.ts`** — Service role smoke tests (L2).
9. **`tests/smoke/postgres.test.ts`** — Direct PG connection test (L2).
10. **`tests/smoke/azure.test.ts`** — Key Vault connection test (L2).

### Phase 4 — Deployment Pipeline
11. **`src/app/api/health/route.ts`** — Health check endpoint (L4).
12. **`.github/workflows/ci.yml`** — CI pipeline (L1-L3).
13. **`.github/workflows/post-deploy-verify.yml`** — Post-deploy checks (L4).

### Phase 5 — Integration & Monitoring
14. **Integration smoke tests** — RLS, auth flow, client contexts (L5).
15. **`src/app/api/cron/health-check/route.ts`** — Runtime monitoring (L6).
16. **`vercel.json`** cron configuration (L6).

---

## Appendix A — Complete Environment Variable Inventory

### A.1 — Client-Side Variables (NEXT_PUBLIC_ prefix, embedded in JS bundle)

| Variable | Required | Source | Vault Secret | Validates |
|----------|----------|--------|-------------|-----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase Dashboard | `supabase-url` | URL format |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes (transitional) | Supabase Dashboard | `supabase-anon-key` | String, min 20 chars |
| `NEXT_PUBLIC_APP_URL` | Yes | Manual/Vercel | N/A | URL format |

### A.2 — Server-Side Variables (never in client bundle)

| Variable | Required | Source | Vault Secret | Validates |
|----------|----------|--------|-------------|-----------|
| `SUPABASE_SERVICE_ROLE_KEY` | Transitional* | Supabase Dashboard | `supabase-service-role-key` | String, min 20 chars |
| `SUPABASE_SECRET_KEY` | Transitional* | Supabase Dashboard | `supabase-secret-key` | Non-empty string |
| `DATABASE_URL` | Yes | Constructed | `supabase-direct-connection` | Starts with "postgres" |
| `DIRECT_DATABASE_URL` | Conditional | Constructed | N/A | Starts with "postgres" |
| `SUPABASE_DB_PASSWORD` | Conditional | Supabase Dashboard | `supabase-db-password` | Non-empty string |
| `SUPABASE_PROJECT_ID` | Conditional | Supabase Dashboard | `supabase-project-id` | Non-empty string |
| `SUPABASE_JWT_SECRET` | Conditional | Supabase Dashboard | `supabase-jwt-secret` | String, min 32 chars |
| `SUPABASE_PUBLISHABLE_KEY` | Future | Supabase Dashboard | `supabase-publishable-key` | Non-empty string |
| `AZURE_KEYVAULT_URL` | No | Azure Portal | N/A | URL, contains "vault.azure.net" |
| `ANTHROPIC_API_KEY` | No | Anthropic Console | `anthropic-api-key` | Non-empty string |
| `CRON_SECRET` | No** | Manual | N/A | String, min 16 chars |
| `NODE_ENV` | Auto | Framework | N/A | "development" / "test" / "production" |

### A.3 — Vercel System Variables (auto-exposed)

| Variable | Available At | Description |
|----------|-------------|-------------|
| `VERCEL` | Build + Runtime | Indicator that system vars are exposed (`1`) |
| `VERCEL_ENV` | Build + Runtime | `production`, `preview`, `development` |
| `VERCEL_URL` | Build + Runtime | Deployment URL (no `https://`) |
| `VERCEL_PROJECT_PRODUCTION_URL` | Build + Runtime | Shortest production domain |
| `VERCEL_REGION` | Runtime only | Server region ID |
| `VERCEL_GIT_COMMIT_SHA` | Build + Runtime | Commit SHA |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Build + Runtime | Protection bypass for automated testing |
| `CI` | Build | Continuous Integration indicator (`1`) |

### A.4 — Key Transition Notes

\* **Transitional**: Supabase is migrating from legacy keys (`anon`/`service_role`) to new keys (`publishable`/`secret`). Both work during the transition period. Legacy keys will be deleted **late 2026**. At least one server key (`SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY`) must be present.

\** CRON_SECRET is optional in development but required in production for health monitoring.

### A.5 — Azure Key Vault Secret Inventory (shossyworks-vault)

| Vault Secret Name | Maps To Env Var | Exposure |
|---|---|---|
| `supabase-url` | `NEXT_PUBLIC_SUPABASE_URL` | Client |
| `supabase-anon-key` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client |
| `supabase-service-role-key` | `SUPABASE_SERVICE_ROLE_KEY` | Server only |
| `supabase-secret-key` | `SUPABASE_SECRET_KEY` | Server only |
| `supabase-jwt-secret` | `SUPABASE_JWT_SECRET` | Server only |
| `supabase-db-password` | `SUPABASE_DB_PASSWORD` | Server only |
| `supabase-direct-connection` | `DATABASE_URL` | Server only |
| `supabase-project-id` | `SUPABASE_PROJECT_ID` | Server only |
| `supabase-publishable-key` | `SUPABASE_PUBLISHABLE_KEY` | Server only |
| `anthropic-api-key` | `ANTHROPIC_API_KEY` | Server only |

## Appendix B — Failure Scenarios & What Catches Them

| Failure Scenario | Caught By | Layer | When |
|-----------------|-----------|-------|------|
| Developer forgets to add new env var to `.env.local` | L1 (Zod schema) | Build | Immediately |
| Typo in Supabase URL | L1 (URL validation) | Build | Immediately |
| Empty string set for a required var | L1 (`emptyStringAsUndefined`) | Build | Immediately |
| Service role key accidentally prefixed with NEXT_PUBLIC_ | L3 (separation test) | CI | Before merge |
| Secret leaked to client JS bundle | L3 (build scan) | CI | Before deploy |
| `.env.local` accidentally committed | L3 (gitignore test) | CI | Before merge |
| Middleware uses insecure `getSession()` | L3 (getClaims test) | CI | Before merge |
| Admin client persists sessions | L3 (admin client test) | CI | Before merge |
| Neither legacy nor new Supabase server key present | L3 (key transition test) | CI | Before merge |
| Supabase project paused/deleted | L2 (REST smoke) | CI | On PR |
| Wrong Supabase project for environment | L4 (env scope) | Deploy | After deploy |
| Azure Key Vault OIDC credentials expired | L2 (KV smoke) | CI | On PR |
| Database connection string changed | L2 (PG direct) | CI | On PR |
| Supavisor pooled connection fails | L2 (PG pooled test) | CI | On PR |
| RLS policies misconfigured | L5 (RLS test) | Deploy | After deploy |
| Vercel env var deleted/renamed | L1 + L4 | Build + Deploy | Immediately |
| Production Supabase goes down | L6 (cron health) | Runtime | Within 5 min |
| Realtime WebSocket connection drops | L6 (heartbeat) | Runtime | Within 30s |
| Connection pool exhausted | L6 (pool monitor) | Runtime | Within 5 min |
| Preview deployment using prod database | L4 (scope check) | Deploy | After deploy |
| Vault secret rotated but not synced to Vercel | L2 (connection failures) | CI | On next deploy |
| Legacy Supabase keys deleted (late 2026) | L3 (key transition test) | CI | Before merge |
| `pull-env.sh` mapping out of sync with `src/env.ts` | L3 (vault alignment test) | Audit | On demand |
| Anthropic API key expired/revoked | L2 (connection smoke) | CI | On PR |
| Real secret value in `.env.example` | L3 (env example test) | CI | Before merge |

## Appendix C — Database Support Table

Create a `_health_check` table in Supabase for integration tests:

```sql
-- Migration: create health check support table
CREATE TABLE IF NOT EXISTS public._health_check (
  id TEXT PRIMARY KEY,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Allow service role only (no anon access)
ALTER TABLE public._health_check ENABLE ROW LEVEL SECURITY;

-- No RLS policies = service role only access
COMMENT ON TABLE public._health_check IS 'Used by automated health checks and integration tests. Service role access only.';
```

---

> **Design completed:** 2026-04-03
> **Next steps:** Implement in priority order (Phase 1 first). Each phase should be committed atomically.
> **Estimated implementation effort:** Phase 1 (1 session), Phase 2 (1 session), Phases 3-5 (2-3 sessions total).
