# Next.js + Vercel Environment Variable Patterns

> Research output for ShossyWorks env/secrets architecture  
> Date: 2026-04-03

---

## Table of Contents

1. [Next.js Env Var System](#1-nextjs-env-var-system)
2. [Build-Time vs Runtime Variables](#2-build-time-vs-runtime-variables)
3. [Vercel Environment Configuration](#3-vercel-environment-configuration)
4. [Vercel System Environment Variables](#4-vercel-system-environment-variables)
5. [T3 Env Validation Pattern (Zod)](#5-t3-env-validation-pattern-zod)
6. [Security Best Practices](#6-security-best-practices)
7. [Azure Key Vault to Vercel Pipeline](#7-azure-key-vault-to-vercel-pipeline)
8. [Recommended .env.local.example](#8-recommended-envlocalexample)
9. [Recommendations for ShossyWorks](#9-recommendations-for-shossyworks)

---

## 1. Next.js Env Var System

### The NEXT_PUBLIC_ Prefix

Next.js has a strict two-tier system for environment variables:

| Prefix | Available In | Bundled Into Client JS | Security Level |
|--------|-------------|----------------------|----------------|
| `NEXT_PUBLIC_*` | Server + Client | **Yes** -- inlined at build time | Public only |
| No prefix | Server only | **No** -- never reaches browser | Private/secret |

**How it works:** At `next build` time, Next.js performs a **static string replacement** of all `process.env.NEXT_PUBLIC_*` references with their literal values. This means:

- The values are **frozen at build time** into the JavaScript bundle
- Anyone who downloads the page source can read these values
- They cannot change between deployments without rebuilding

**Variables without the prefix** remain available only in Node.js server contexts (Server Components, Route Handlers, Server Actions, Middleware). They are read from `process.env` at runtime and never appear in client bundles.

### .env File Loading Order

Next.js loads environment variables from `.env` files in a specific order. **First match wins** -- if a variable is defined in an earlier file, later files do not override it.

**Development** (`next dev`, NODE_ENV=development):
```
1. .env.development.local   (highest priority, gitignored)
2. .env.local                (gitignored)
3. .env.development
4. .env                      (lowest priority)
```

**Production** (`next build` / `next start`, NODE_ENV=production):
```
1. .env.production.local     (highest priority, gitignored)
2. .env.local                (gitignored)
3. .env.production
4. .env                      (lowest priority)
```

**Test** (NODE_ENV=test):
```
1. .env.test.local           (highest priority, gitignored)
2. .env.test
3. .env                      (lowest priority)
```
Note: `.env.local` is NOT loaded in test environments.

**Key rules:**
- `.env.local` files should be added to `.gitignore` -- they contain local overrides and secrets
- `.env`, `.env.development`, `.env.production` can be checked into version control (for non-secret defaults)
- Environment variables set in the actual shell/process always take precedence over `.env` files
- On Vercel, `.env` files are not used -- Vercel's own env var system takes over at build time

### next.config.js env Option

You can also define env vars in `next.config.js`, but this is **not recommended** for secrets:

```typescript
// next.config.ts
const nextConfig: NextConfig = {
  env: {
    CUSTOM_VAR: 'value', // Available as process.env.CUSTOM_VAR
  },
};
```

This inlines values at build time (similar to NEXT_PUBLIC_). Use sparingly -- prefer `.env` files or Vercel dashboard.

---

## 2. Build-Time vs Runtime Variables

This distinction is **critical** for the App Router and deployment flexibility.

### Build-Time Variables (Frozen at `next build`)

- All `NEXT_PUBLIC_*` variables -- inlined as string literals into the JS bundle
- Any `process.env.*` read during **static rendering** (pages/components that are pre-rendered at build)
- Values in `next.config.js` `env` key

**Impact:** If you build once and deploy to multiple environments (staging, production), build-time values will be **identical** across all environments. They reflect the env at build time, not deploy time.

### Runtime Variables (Read per-request)

- Server-side `process.env.*` reads in **dynamically rendered** routes
- Route Handlers, Server Actions, Middleware
- Server Components that opt into dynamic rendering (by using `cookies()`, `headers()`, or `searchParams`)

**How to ensure runtime reading in App Router:**

```typescript
// This Server Component reads env at request time (dynamic rendering)
import { cookies } from 'next/headers';

export default async function Page() {
  cookies(); // Forces dynamic rendering
  const apiKey = process.env.INTERNAL_API_KEY; // Read at runtime
  // ...
}
```

```typescript
// Route Handler -- always runtime
export async function GET() {
  const secret = process.env.SERVICE_SECRET; // Read at runtime per request
  // ...
}
```

**Warning for Server Components:** Default Server Components can be **statically rendered**, which means env vars may be read during build, not at request time. If you need per-request env values in a Server Component, ensure the component opts into dynamic rendering.

### ShossyWorks Impact

For ShossyWorks on Vercel, this is less of a concern because:
- Vercel builds per-deployment, so build-time vars match the target environment
- But still important for Preview deployments (which may use different Supabase instances)

---

## 3. Vercel Environment Configuration

### Dashboard Configuration

Vercel provides three built-in environment scopes:

| Scope | When Applied | Use Case |
|-------|-------------|----------|
| **Production** | Deployments from the production branch (usually `main`) | Live site with production Supabase |
| **Preview** | Deployments from any non-production branch, PRs | Staging/testing with preview Supabase |
| **Development** | Local dev via `vercel dev` or `vercel env pull` | Local development |

**Setting variables:**
1. Navigate to Project -> Settings -> Environment Variables
2. Add variable name, value, and select which environments it applies to
3. Use the `Sensitive` checkbox for secrets (values hidden in dashboard after creation)

**Branch-specific preview vars:** Preview env vars can be scoped to specific Git branches, useful for long-running feature branches that need their own config.

### Vercel CLI Commands

```bash
# Link local project to Vercel (one-time)
vercel link

# Pull development env vars into .env.local
vercel env pull .env.local

# Pull production env vars (for debugging)
vercel env pull .env.production.local --environment production

# List all env vars for an environment
vercel env ls production
vercel env ls preview
vercel env ls development

# Add a new env var
vercel env add MY_SECRET production
vercel env add MY_SECRET preview
vercel env add MY_SECRET development

# Add a sensitive env var (hidden in dashboard)
vercel env add MY_SECRET production --sensitive

# Remove an env var
vercel env rm MY_SECRET production

# Run a command with env vars loaded (without writing to file)
vercel env run -- npm run test
```

### Local Development Workflow

**Option A: `vercel env pull` (Recommended for ShossyWorks)**
```bash
# One-time: link project
vercel link

# Pull development env vars into .env.local
vercel env pull .env.local

# Run Next.js dev server normally
npm run dev
```
The `.env.local` file is gitignored. Developers run `vercel env pull` to get current secrets. This keeps secrets out of version control while ensuring everyone has the same variables.

**Option B: `vercel dev`**
```bash
# Automatically loads Development env vars into memory
vercel dev
```
No `.env.local` file needed -- vars are loaded directly. However, this uses Vercel's dev server instead of `next dev`, which may behave differently.

**Option C: Manual `.env.local`**
Developers manually create `.env.local` from the `.env.local.example` template and fill in values from Azure Key Vault or team documentation.

---

## 4. Vercel System Environment Variables

Vercel automatically provides these variables when "Automatically expose System Environment Variables" is enabled in Project Settings:

### Core Variables

| Variable | Available At | Description | Example |
|----------|-------------|-------------|---------|
| `VERCEL` | Build + Runtime | Indicator that system env vars are exposed | `1` |
| `CI` | Build | Continuous Integration indicator | `1` |
| `VERCEL_ENV` | Build + Runtime | Environment: `production`, `preview`, `development` | `production` |
| `VERCEL_TARGET_ENV` | Build + Runtime | Includes custom environment names | `production` |
| `VERCEL_URL` | Build + Runtime | Deployment URL (no `https://`) | `my-site-abc123.vercel.app` |
| `VERCEL_BRANCH_URL` | Build + Runtime | Git branch URL | `my-site-git-feature.vercel.app` |
| `VERCEL_PROJECT_PRODUCTION_URL` | Build + Runtime | Shortest production domain | `shossyworks.com` |
| `VERCEL_REGION` | Runtime only | Server region ID | `iad1` |
| `VERCEL_DEPLOYMENT_ID` | Build + Runtime | Unique deployment ID (for Skew Protection) | `dpl_7Gw5ZMBp...` |
| `VERCEL_PROJECT_ID` | Build + Runtime | Project identifier | `prj_Rej9WaMN...` |

### Git-Related Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `VERCEL_GIT_PROVIDER` | Git provider | `github` |
| `VERCEL_GIT_REPO_SLUG` | Repository name | `shossyworks` |
| `VERCEL_GIT_REPO_OWNER` | Repository owner | `Shossy-lab` |
| `VERCEL_GIT_COMMIT_REF` | Branch name | `main` |
| `VERCEL_GIT_COMMIT_SHA` | Commit SHA | `fa1eade4...` |
| `VERCEL_GIT_COMMIT_MESSAGE` | Commit message (max 2048 bytes) | `feat: add auth` |
| `VERCEL_GIT_PULL_REQUEST_ID` | PR number (empty if no PR) | `23` |

### Security & Advanced

| Variable | Description |
|----------|-------------|
| `VERCEL_SKEW_PROTECTION_ENABLED` | `1` when Skew Protection is active |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Protection bypass secret for automated testing |
| `VERCEL_OIDC_TOKEN` | OIDC token for Secure Backend Access (build time) |

**Important for ShossyWorks:** `VERCEL_PROJECT_PRODUCTION_URL` is useful for generating canonical URLs and OG images. `VERCEL_ENV` is useful for conditional behavior (e.g., different logging levels).

---

## 5. T3 Env Validation Pattern (Zod)

This is the **gold standard** for env var validation in Next.js. It catches missing or malformed variables at **build time** instead of failing silently at runtime.

### Package: `@t3-oss/env-nextjs`

```bash
npm install @t3-oss/env-nextjs zod
```

### Full Implementation for ShossyWorks

Create `src/env.ts`:

```typescript
import { createEnv } from "@t3-oss/env-nextjs";
import { vercel } from "@t3-oss/env-core/presets-zod";
import { z } from "zod";

export const env = createEnv({
  // Extend with Vercel system variables preset
  extends: [vercel()],

  /**
   * Server-side environment variables schema.
   * These NEVER reach the client bundle.
   */
  server: {
    // Supabase (server-only)
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    SUPABASE_DB_URL: z.string().url(),

    // Auth
    SUPABASE_JWT_SECRET: z.string().min(1),

    // Azure
    AZURE_KEY_VAULT_URL: z.string().url().optional(),

    // App
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  },

  /**
   * Client-side environment variables schema.
   * Must be prefixed with NEXT_PUBLIC_.
   * These ARE included in the client bundle.
   */
  client: {
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
    NEXT_PUBLIC_APP_URL: z.string().url(),
  },

  /**
   * Map process.env to the schema.
   * For Next.js >= 13.4.4, you can use experimental__runtimeEnv
   * for client vars and let server vars be read from process.env.
   */
  experimental__runtimeEnv: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },

  /**
   * Skip validation in CI/Docker builds where not all vars are present.
   * Default: false. Set SKIP_ENV_VALIDATION=1 to bypass.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,

  /**
   * Treat empty strings as undefined.
   * Prevents "" from passing .min(1) checks.
   */
  emptyStringAsUndefined: true,
});
```

### Trigger Validation at Build Time

In `next.config.ts`:

```typescript
import "./src/env";

const nextConfig: NextConfig = {
  // ... your config
};

export default nextConfig;
```

By importing `src/env` at the top of `next.config.ts`, the Zod schemas are validated **before the build proceeds**. If any variable is missing or malformed, the build fails immediately with a clear error message.

### Usage Throughout the App

```typescript
// Server Component or Route Handler
import { env } from "@/env";

export async function GET() {
  // Type-safe, validated at build time
  const response = await fetch(env.SUPABASE_DB_URL, {
    headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
  });
  return Response.json(await response.json());
}
```

```typescript
// Client Component
"use client";
import { env } from "@/env";

export function SupabaseProvider({ children }: { children: React.ReactNode }) {
  // Only NEXT_PUBLIC_ vars are accessible here
  // Accessing env.SUPABASE_SERVICE_ROLE_KEY would throw at build time
  const client = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  return <Provider value={client}>{children}</Provider>;
}
```

### Built-In Presets

`@t3-oss/env-core` provides presets that auto-validate platform-specific variables:

```typescript
import { vercel } from "@t3-oss/env-core/presets-zod";
import { supabaseVercel } from "@t3-oss/env-core/presets-zod";

export const env = createEnv({
  extends: [vercel(), supabaseVercel()],
  // vercel() validates: VERCEL_URL, VERCEL_ENV, etc.
  // supabaseVercel() validates Supabase integration vars
  // ... your custom vars
});
```

Available presets: `vercel`, `supabaseVercel`, `neonVercel`, `uploadthing`, `render`, `railway`, `fly`, `netlify`, `upstashRedis`, `coolify`.

### Error Handling Customization

```typescript
export const env = createEnv({
  // ...
  onValidationError: (issues) => {
    console.error("Invalid environment variables:", issues);
    throw new Error("Invalid environment variables");
  },
  onInvalidAccess: (variable) => {
    throw new Error(
      `Attempted to access server-side env var '${variable}' on the client`
    );
  },
});
```

---

## 6. Security Best Practices

### What NEVER Goes in NEXT_PUBLIC_ Variables

| Variable Type | NEXT_PUBLIC_? | Reason |
|--------------|---------------|--------|
| Supabase URL | **Yes** | Already public (Row Level Security protects data) |
| Supabase Anon Key | **Yes** | Designed to be public (RLS enforces access) |
| Supabase Service Role Key | **NEVER** | Bypasses RLS, full database access |
| Supabase JWT Secret | **NEVER** | Can forge auth tokens |
| Database connection string | **NEVER** | Direct database access |
| Azure Key Vault URL/credentials | **NEVER** | Access to all secrets |
| API keys for paid services | **NEVER** | Financial exposure |
| SMTP credentials | **NEVER** | Can send email as you |
| Webhook secrets | **NEVER** | Can forge webhook payloads |

### The `server-only` Package

Install `server-only` and import it in any file that must never be bundled for the client:

```bash
npm install server-only
```

```typescript
// lib/supabase-admin.ts
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/env";

// This file will cause a BUILD ERROR if imported from a Client Component
export const supabaseAdmin = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY
);
```

If any Client Component (directly or transitively) imports this file, the build fails with:
> "This module cannot be imported from a Client Component module. It should only be used from a Server Component."

**Recommendation:** Use `import "server-only"` in every file that touches secrets or admin clients.

### Preventing Leakage in Error Messages

```typescript
// BAD: Error message might contain secret in stack trace
try {
  const result = await fetch(process.env.SECRET_API_URL);
} catch (error) {
  throw error; // Full error with URL goes to client error boundary
}

// GOOD: Sanitize before returning to client
try {
  const result = await fetch(process.env.SECRET_API_URL);
} catch (error) {
  console.error("API call failed:", error); // Log full error server-side
  throw new Error("Service temporarily unavailable"); // Safe message to client
}
```

### Defense-in-Depth Layers

1. **No prefix = no exposure**: Don't add `NEXT_PUBLIC_` unless required by client code
2. **`server-only` package**: Build-time guardrail against accidental imports
3. **T3 env validation**: Type-safe access, build-time validation, client/server boundary enforcement
4. **Supabase RLS**: Even if the anon key is public, RLS ensures users only access their own data
5. **Error sanitization**: Never pass raw errors containing secrets to clients

---

## 7. Azure Key Vault to Vercel Pipeline

### Option A: GitHub Actions CI/CD Pipeline (Recommended)

Use OIDC federation -- no static credentials stored in GitHub.

**Setup Steps:**

1. **Create Azure AD App Registration** with federated credentials for GitHub Actions
2. **Grant Key Vault read access** to the service principal
3. **Configure GitHub Actions workflow** to pull secrets and push to Vercel

```yaml
# .github/workflows/sync-secrets.yml
name: Sync Secrets to Vercel

on:
  workflow_dispatch:  # Manual trigger
  schedule:
    - cron: '0 6 * * 1'  # Weekly Monday 6am

permissions:
  id-token: write
  contents: read

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Azure Login (OIDC)
        uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Get Secrets from Key Vault
        uses: Azure/get-keyvault-secrets@v1
        with:
          keyvault: shossyworks-vault
          secrets: >
            supabase-service-role-key,
            supabase-jwt-secret,
            supabase-db-url
        id: vault

      - name: Push to Vercel (Production)
        env:
          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
          VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
        run: |
          # Install Vercel CLI
          npm i -g vercel

          # Set each secret in Vercel production environment
          echo "${{ steps.vault.outputs.supabase-service-role-key }}" | \
            vercel env add SUPABASE_SERVICE_ROLE_KEY production --token=$VERCEL_TOKEN
          echo "${{ steps.vault.outputs.supabase-jwt-secret }}" | \
            vercel env add SUPABASE_JWT_SECRET production --token=$VERCEL_TOKEN
          echo "${{ steps.vault.outputs.supabase-db-url }}" | \
            vercel env add SUPABASE_DB_URL production --token=$VERCEL_TOKEN
```

**Advantages:**
- No long-lived credentials (OIDC federation)
- Auditable: every secret retrieval is logged in both Azure and GitHub
- Can be triggered manually or on schedule
- Supports different secrets per Vercel environment (production/preview/development)

### Option B: Manual Dashboard Sync

For initial setup or small teams:

1. Retrieve secrets from Azure Key Vault:
   ```bash
   az keyvault secret show \
     --vault-name shossyworks-vault \
     --name supabase-service-role-key \
     --subscription bbcd40ae-efb3-4936-bf37-d7e142f003dd \
     --query value -o tsv
   ```

2. Paste into Vercel Dashboard -> Settings -> Environment Variables

3. Select appropriate environment scope (Production, Preview, Development)

**Advantages:** Simple, no CI/CD setup needed  
**Disadvantages:** Manual rotation, no audit trail, easy to forget an environment

### Option C: Vercel OIDC + Azure (Advanced)

Vercel provides `VERCEL_OIDC_TOKEN` at build time, which can authenticate directly against Azure:

1. Configure Azure to trust Vercel's OIDC provider
2. At build time, use the OIDC token to authenticate and fetch secrets
3. Secrets are never stored in Vercel's env var system

This is the most secure option but requires more complex setup. Best suited for organizations with strict compliance requirements.

### Local Development Workflow

**Recommended approach:**

1. Developer authenticates to Azure CLI: `az login`
2. Pull secrets from Key Vault into `.env.local`:
   ```bash
   # Script: scripts/pull-secrets.sh
   #!/bin/bash
   VAULT="shossyworks-vault"
   SUB="bbcd40ae-efb3-4936-bf37-d7e142f003dd"

   echo "SUPABASE_SERVICE_ROLE_KEY=$(az keyvault secret show --vault-name $VAULT --name supabase-service-role-key --subscription $SUB --query value -o tsv)" >> .env.local
   echo "SUPABASE_JWT_SECRET=$(az keyvault secret show --vault-name $VAULT --name supabase-jwt-secret --subscription $SUB --query value -o tsv)" >> .env.local
   echo "SUPABASE_DB_URL=$(az keyvault secret show --vault-name $VAULT --name supabase-db-url --subscription $SUB --query value -o tsv)" >> .env.local
   ```

3. Alternatively, use `vercel env pull .env.local` if secrets are already in Vercel's Development environment

---

## 8. Recommended .env.local.example

This template should be committed to the repo. Developers copy it to `.env.local` and fill in values.

```bash
# ==============================================================================
# ShossyWorks Environment Variables
# ==============================================================================
# Copy this file to .env.local and fill in the values.
# NEVER commit .env.local to version control.
#
# To auto-populate from Azure Key Vault:
#   ./scripts/pull-secrets.sh
#
# To auto-populate from Vercel:
#   vercel env pull .env.local
# ==============================================================================

# ------------------------------------------------------------------------------
# Supabase (Public -- safe for client bundle)
# These are designed to be public. Row Level Security protects your data.
# Get from: https://supabase.com/dashboard/project/YOUR_PROJECT/settings/api
# ------------------------------------------------------------------------------
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# ------------------------------------------------------------------------------
# Supabase (Private -- NEVER prefix with NEXT_PUBLIC_)
# Service role key bypasses Row Level Security. Keep server-side only.
# Get from: Supabase Dashboard > Settings > API > Service Role Key
# Or from: Azure Key Vault (shossyworks-vault)
# ------------------------------------------------------------------------------
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_JWT_SECRET=your-jwt-secret-from-supabase-dashboard

# ------------------------------------------------------------------------------
# Database (Private -- direct connection)
# Used for migrations and server-side database operations.
# Get from: Supabase Dashboard > Settings > Database > Connection String
# Or from: Azure Key Vault (shossyworks-vault)
# ------------------------------------------------------------------------------
SUPABASE_DB_URL=postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres

# ------------------------------------------------------------------------------
# Application URLs
# Adjust for your local dev setup. Vercel sets these automatically in production.
# ------------------------------------------------------------------------------
NEXT_PUBLIC_APP_URL=http://localhost:3000

# ------------------------------------------------------------------------------
# Azure Key Vault (Private -- optional for local dev)
# Only needed if the app fetches secrets from Key Vault at runtime.
# Most deployments use Vercel env vars instead.
# ------------------------------------------------------------------------------
# AZURE_KEY_VAULT_URL=https://shossyworks-vault.vault.azure.net/

# ------------------------------------------------------------------------------
# Build Flags (optional)
# ------------------------------------------------------------------------------
# SKIP_ENV_VALIDATION=1    # Skip Zod env validation (for Docker/CI builds)
# ANALYZE=true             # Enable bundle analyzer
```

---

## 9. Recommendations for ShossyWorks

### Architecture Decision: Use T3 Env Validation

**Install and configure `@t3-oss/env-nextjs`** as the single source of truth for all environment variables. This gives:

- **Build-time validation**: Missing vars fail the build, not production
- **Type safety**: `env.SUPABASE_SERVICE_ROLE_KEY` is typed as `string`, not `string | undefined`
- **Client/server boundary enforcement**: Accessing a server var from a client component throws at build time
- **Presets**: `vercel()` and `supabaseVercel()` presets auto-validate platform variables

### Architecture Decision: Secrets Flow

```
Azure Key Vault (source of truth)
  |
  |-- GitHub Actions (OIDC) --> Vercel Env Vars (production/preview)
  |                                |
  |                                +--> next build (inlined for NEXT_PUBLIC_)
  |                                +--> runtime (process.env for server vars)
  |
  |-- az CLI --> .env.local (local development)
  |                |
  |                +--> next dev (loaded by Next.js .env system)
  |
  +-- Vercel CLI --> vercel env pull .env.local (alternative local dev)
```

### Variable Classification for ShossyWorks

| Variable | Prefix | Reason |
|----------|--------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | NEXT_PUBLIC_ | Client needs it to initialize Supabase client |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | NEXT_PUBLIC_ | Client auth requires it; RLS protects data |
| `NEXT_PUBLIC_APP_URL` | NEXT_PUBLIC_ | Client needs it for absolute URLs, OAuth redirects |
| `SUPABASE_SERVICE_ROLE_KEY` | None | Bypasses RLS -- server-only, admin operations |
| `SUPABASE_JWT_SECRET` | None | Can forge tokens -- server-only verification |
| `SUPABASE_DB_URL` | None | Direct DB access -- server-only migrations/queries |
| `AZURE_KEY_VAULT_URL` | None | Access to all secrets -- server-only |

### File Structure

```
src/
  env.ts              -- T3 env validation schema (single source of truth)
  lib/
    supabase/
      client.ts       -- Browser Supabase client (uses NEXT_PUBLIC_ vars)
      server.ts       -- Server Supabase client (uses anon key + cookies)
      admin.ts        -- Admin Supabase client (uses service role key)
                         Must include `import "server-only"`
```

### Checklist Before First Deploy

- [ ] Install `@t3-oss/env-nextjs`, `zod`, `server-only`
- [ ] Create `src/env.ts` with full schema
- [ ] Import `src/env` in `next.config.ts` for build-time validation
- [ ] Create `.env.local.example` (committed) and `.env.local` (gitignored)
- [ ] Add `.env.local` and `.env*.local` to `.gitignore`
- [ ] Set all variables in Vercel Dashboard (Production + Preview + Development)
- [ ] Enable "Automatically expose System Environment Variables" in Vercel
- [ ] Add `import "server-only"` to all files using `SUPABASE_SERVICE_ROLE_KEY`
- [ ] Set up GitHub Actions workflow for Azure Key Vault -> Vercel sync
- [ ] Create `scripts/pull-secrets.sh` for local dev Key Vault retrieval
- [ ] Verify: run `next build` locally with `.env.local` to confirm validation passes

---

## Sources

- [Next.js Environment Variables Guide](https://nextjs.org/docs/pages/guides/environment-variables)
- [Next.js next.config.js env](https://nextjs.org/docs/app/api-reference/config/next-config-js/env)
- [Next.js Data Security Guide](https://nextjs.org/docs/app/guides/data-security)
- [Next.js Security Blog - Server Components](https://nextjs.org/blog/security-nextjs-server-components-actions)
- [Vercel Environment Variables](https://vercel.com/docs/environment-variables)
- [Vercel System Environment Variables](https://vercel.com/docs/environment-variables/system-environment-variables)
- [Vercel CLI env Commands](https://vercel.com/docs/cli/env)
- [T3 Env - Next.js Setup](https://env.t3.gg/docs/nextjs)
- [T3 Env - Customization & Presets](https://env.t3.gg/docs/customization)
- [T3 Env GitHub](https://github.com/t3-oss/t3-env)
- [Create T3 App - Environment Variables](https://create.t3.gg/en/usage/env-variables)
- [Azure Key Vault GitHub Actions](https://github.com/Azure/get-keyvault-secrets)
- [Microsoft: Use Azure Key Vault in GitHub Actions](https://learn.microsoft.com/en-us/azure/developer/github/github-actions-key-vault)
- [Supabase + Next.js Quickstart](https://supabase.com/docs/guides/getting-started/quickstarts/nextjs)
- [next-runtime-env (for Docker/multi-env deployments)](https://github.com/expatfile/next-runtime-env)
