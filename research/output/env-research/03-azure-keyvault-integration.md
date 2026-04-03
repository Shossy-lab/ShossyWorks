# Azure Key Vault Integration — ShossyWorks

> **Researcher:** azure-vault-researcher
> **Date:** 2026-04-03
> **Scope:** How Azure Key Vault fits into local dev, CI/CD, and production secret management for a solo-developer Next.js + Supabase + Vercel stack.

---

## 1. Current Vault State

**Vault:** `shossyworks-vault`
**Resource Group:** `shossyworks-rg`
**Region:** East US
**Subscription:** `bbcd40ae-efb3-4936-bf37-d7e142f003dd`
**Tenant:** `bcbfa864-cd26-4ff9-a9d9-b475e97eae74`
**RBAC:** Zac has **Key Vault Secrets Officer** at subscription level (confirmed from memory)

### Current Secrets (10)

| Vault Secret Name | Purpose |
|---|---|
| `supabase-project-id` | Supabase project identifier |
| `supabase-db-password` | PostgreSQL database password |
| `supabase-url` | Supabase project URL |
| `supabase-publishable-key` | Supabase publishable/public key |
| `supabase-secret-key` | Supabase secret key |
| `supabase-anon-key` | Supabase anon/public JWT |
| `supabase-service-role-key` | Supabase service role JWT (admin) |
| `supabase-jwt-secret` | Legacy JWT signing secret |
| `supabase-direct-connection` | Direct PostgreSQL connection string |
| `anthropic-api-key` | Anthropic API key for AI features |

---

## 2. Secret-to-Env-Var Mapping

This is the complete mapping from vault secret names to the environment variable names that Next.js / Supabase / application code expects.

### Public (client-exposed, embedded in JS bundle)

| Vault Secret | Env Var Name | Scope | Notes |
|---|---|---|---|
| `supabase-url` | `NEXT_PUBLIC_SUPABASE_URL` | Client + Server | Supabase project URL — safe to expose |
| `supabase-anon-key` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client + Server | Row-level-security scoped, safe to expose |

### Server-only (never in client bundle)

| Vault Secret | Env Var Name | Scope | Notes |
|---|---|---|---|
| `supabase-service-role-key` | `SUPABASE_SERVICE_ROLE_KEY` | Server only | Bypasses RLS — NEVER prefix with `NEXT_PUBLIC_` |
| `supabase-secret-key` | `SUPABASE_SECRET_KEY` | Server only | Same as service role in some SDKs; keep separate |
| `supabase-jwt-secret` | `SUPABASE_JWT_SECRET` | Server only | For custom JWT verification if needed |
| `supabase-db-password` | `SUPABASE_DB_PASSWORD` | Server only | Direct DB access password |
| `supabase-direct-connection` | `DATABASE_URL` | Server only | Full PostgreSQL connection string |
| `supabase-project-id` | `SUPABASE_PROJECT_ID` | Server only | Used by CLI tools and admin APIs |
| `supabase-publishable-key` | `SUPABASE_PUBLISHABLE_KEY` | Server only | New-format key (replaces anon-key eventually) |
| `anthropic-api-key` | `ANTHROPIC_API_KEY` | Server only | AI/Claude API — strictly server |

### Naming Convention Applied

**Rule:** Vault secret names use kebab-case (`supabase-anon-key`). Env vars use UPPER_SNAKE_CASE (`SUPABASE_ANON_KEY`). The mapping script handles this transformation.

**NEXT_PUBLIC_ prefix rule:** Only `supabase-url` and `supabase-anon-key` get the `NEXT_PUBLIC_` prefix. Everything else is server-only. This is a Next.js convention — variables with `NEXT_PUBLIC_` are inlined into the client JavaScript bundle at build time and visible to anyone inspecting the page source.

---

## 3. Pull Script: `scripts/pull-env.sh`

This bash script pulls all secrets from Azure Key Vault and writes a `.env.local` file. It requires `az` CLI and an active login session.

```bash
#!/usr/bin/env bash
#
# pull-env.sh — Pull secrets from Azure Key Vault → .env.local
#
# Usage:
#   ./scripts/pull-env.sh                  # writes .env.local (default)
#   ./scripts/pull-env.sh .env.test        # writes to custom file
#   ./scripts/pull-env.sh --dry-run        # prints to stdout, no file write
#
# Prerequisites:
#   - Azure CLI installed (az)
#   - Logged in: az login
#   - Access to shossyworks-vault (Key Vault Secrets User or higher)
#

set -euo pipefail

# ─── Configuration ──────────────────────────────────────────────
VAULT_NAME="shossyworks-vault"
SUBSCRIPTION="bbcd40ae-efb3-4936-bf37-d7e142f003dd"
OUTPUT_FILE="${1:-.env.local}"
DRY_RUN=false

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  OUTPUT_FILE="/dev/null"
fi

# ─── Secret → Env Var mapping ──────────────────────────────────
# Format: "vault-secret-name:ENV_VAR_NAME"
# Order: public vars first, then server-only
declare -a SECRET_MAP=(
  # Public (client-exposed)
  "supabase-url:NEXT_PUBLIC_SUPABASE_URL"
  "supabase-anon-key:NEXT_PUBLIC_SUPABASE_ANON_KEY"
  # Server-only
  "supabase-service-role-key:SUPABASE_SERVICE_ROLE_KEY"
  "supabase-secret-key:SUPABASE_SECRET_KEY"
  "supabase-jwt-secret:SUPABASE_JWT_SECRET"
  "supabase-db-password:SUPABASE_DB_PASSWORD"
  "supabase-direct-connection:DATABASE_URL"
  "supabase-project-id:SUPABASE_PROJECT_ID"
  "supabase-publishable-key:SUPABASE_PUBLISHABLE_KEY"
  "anthropic-api-key:ANTHROPIC_API_KEY"
)

# ─── Pre-flight checks ─────────────────────────────────────────
if ! command -v az &>/dev/null; then
  echo "ERROR: Azure CLI (az) is not installed." >&2
  echo "  Install: https://learn.microsoft.com/en-us/cli/azure/install-azure-cli" >&2
  exit 1
fi

# Check login status
if ! az account show --subscription "$SUBSCRIPTION" &>/dev/null; then
  echo "ERROR: Not logged in to Azure or subscription not accessible." >&2
  echo "  Run: az login" >&2
  exit 1
fi

# ─── Pull secrets ──────────────────────────────────────────────
echo "Pulling secrets from vault: $VAULT_NAME"
echo "Subscription: $SUBSCRIPTION"
echo ""

ENV_CONTENT="# Auto-generated from Azure Key Vault: $VAULT_NAME"
ENV_CONTENT+="\n# Generated: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
ENV_CONTENT+="\n# DO NOT COMMIT THIS FILE\n"
ENV_CONTENT+="\n# ─── Public (client-exposed) ──────────────────────────"

ERRORS=0
SUCCESS=0

for entry in "${SECRET_MAP[@]}"; do
  SECRET_NAME="${entry%%:*}"
  ENV_NAME="${entry##*:}"

  # Add section header before server-only vars
  if [[ "$SECRET_NAME" == "supabase-service-role-key" ]]; then
    ENV_CONTENT+="\n\n# ─── Server-only (never in client bundle) ─────────────"
  fi

  VALUE=$(az keyvault secret show \
    --vault-name "$VAULT_NAME" \
    --name "$SECRET_NAME" \
    --subscription "$SUBSCRIPTION" \
    --query "value" \
    -o tsv 2>/dev/null) || {
    echo "  WARN: Failed to retrieve '$SECRET_NAME'" >&2
    ENV_CONTENT+="\n# MISSING: $ENV_NAME (failed to retrieve $SECRET_NAME)"
    ((ERRORS++))
    continue
  }

  ENV_CONTENT+="\n${ENV_NAME}=\"${VALUE}\""
  echo "  OK: $SECRET_NAME → $ENV_NAME"
  ((SUCCESS++))
done

# ─── Write output ──────────────────────────────────────────────
if [[ "$DRY_RUN" == true ]]; then
  echo ""
  echo "─── DRY RUN OUTPUT ───"
  echo -e "$ENV_CONTENT"
  echo ""
  echo "─── END DRY RUN ──────"
else
  echo -e "$ENV_CONTENT" > "$OUTPUT_FILE"
  echo ""
  echo "Written to: $OUTPUT_FILE"
fi

echo ""
echo "Results: $SUCCESS succeeded, $ERRORS failed (of ${#SECRET_MAP[@]} total)"

if [[ $ERRORS -gt 0 ]]; then
  echo "Some secrets failed — check vault access and secret names." >&2
  exit 1
fi
```

### Script Features

- **Explicit mapping array** — no guessing; each vault secret maps to exactly one env var name
- **Section headers** — output `.env.local` has clear public vs. server-only sections
- **Dry run mode** — `--dry-run` prints to stdout without writing a file
- **Custom output path** — pass any filename as argument
- **Pre-flight checks** — verifies `az` CLI is installed and user is logged in
- **Error handling** — warns on individual failures, continues pulling remaining secrets, exits non-zero if any failed
- **Uses `-o tsv`** — avoids the common gotcha of quoted output from `az` CLI
- **Timestamp** — generated file includes when it was last pulled

### Why Not Dynamic Discovery?

You could iterate `az keyvault secret list` and auto-generate env var names by converting kebab-case to UPPER_SNAKE_CASE. We chose an explicit mapping instead because:

1. **`NEXT_PUBLIC_` prefix logic** cannot be auto-detected — you must know which secrets are safe to expose client-side
2. **Naming conventions differ** — `supabase-direct-connection` maps to `DATABASE_URL`, not `SUPABASE_DIRECT_CONNECTION`
3. **Safety** — a new secret added to the vault should not automatically appear in `.env.local` without a deliberate decision about its name and exposure scope
4. **Auditability** — the mapping array serves as documentation of the complete secret surface

---

## 4. Vercel Environment Variable Sync

### The Problem

Vercel stores environment variables in its own system. Azure Key Vault is the source of truth. These need to stay in sync.

### Current Options (2026)

| Approach | Complexity | Automation | Risk |
|---|---|---|---|
| Manual via Vercel Dashboard | None | None | Human error, drift |
| `vercel env add` CLI scripting | Low | Semi-auto | One-at-a-time API calls |
| `vercel-env-push` (npm package) | Low | Good | Third-party dependency |
| GitHub Actions pipeline | Medium | Full | Requires OIDC setup |
| Doppler / external secrets manager | High | Full | Additional service dependency |

### Recommended: Script-Based Push via CLI

For a solo developer, the simplest reliable approach is a companion push script that reads `.env.local` (or pulls directly from vault) and uses `vercel env add` to sync each variable.

```bash
#!/usr/bin/env bash
#
# sync-to-vercel.sh — Push secrets from vault → Vercel env vars
#
# Usage:
#   ./scripts/sync-to-vercel.sh              # sync to all environments
#   ./scripts/sync-to-vercel.sh production   # sync to production only
#
# Prerequisites:
#   - Vercel CLI installed and linked (vercel link)
#   - Azure CLI logged in
#   - Both pull-env.sh and this script in scripts/
#

set -euo pipefail

TARGET_ENV="${1:-production preview development}"

# Use pull-env to get current values
source <(./scripts/pull-env.sh --dry-run 2>/dev/null | grep -E '^[A-Z_]+=')

# Push each variable to Vercel
for env in $TARGET_ENV; do
  echo "Syncing to Vercel environment: $env"
  # Example for each var — in practice, loop the SECRET_MAP
  echo "$NEXT_PUBLIC_SUPABASE_URL" | vercel env add NEXT_PUBLIC_SUPABASE_URL "$env" --force 2>/dev/null || true
  # ... repeat for each variable
done
```

**Important:** Vercel does not have a native "sync from external vault" feature. The `vercel env pull` command pulls FROM Vercel, not TO Vercel. For pushing, you either use `vercel env add` (one at a time) or the community `vercel-env-push` package.

### When to Sync

| Trigger | Action |
|---|---|
| New secret added to vault | Run sync script |
| Secret rotated in vault | Run sync script + trigger Vercel redeploy |
| First project setup | Run sync script for all environments |
| Before production deploy | Verify sync (compare script output to `vercel env ls`) |

---

## 5. GitHub Actions Integration (OIDC)

For CI/CD pipelines that need vault secrets (builds, tests, deployments), the recommended approach is OpenID Connect (OIDC) federation — no stored credentials in GitHub.

### How OIDC Works

1. GitHub Actions requests a signed JWT from GitHub's identity provider
2. Azure validates the JWT against a pre-configured federated credential
3. Azure issues a short-lived access token (valid for ~1 hour)
4. The GitHub Action uses that token to pull secrets from Key Vault
5. Token expires automatically — no cleanup needed

### Setup Steps

#### Step 1: Create a Microsoft Entra App Registration

```bash
# Create the app registration
az ad app create --display-name "github-actions-shossyworks"

# Note the appId from output — you'll need it
APP_ID="<appId from output>"

# Create a service principal for the app
az ad sp create --id "$APP_ID"
```

#### Step 2: Add Federated Credential for GitHub

```bash
az ad app federated-credential create \
  --id "$APP_ID" \
  --parameters '{
    "name": "github-main-branch",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:Shossy-lab/ShossyWorks:ref:refs/heads/main",
    "description": "GitHub Actions for ShossyWorks main branch",
    "audiences": ["api://AzureADTokenExchange"]
  }'
```

For PR-based deployments, add another credential:

```bash
az ad app federated-credential create \
  --id "$APP_ID" \
  --parameters '{
    "name": "github-pull-request",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:Shossy-lab/ShossyWorks:environment:preview",
    "description": "GitHub Actions for ShossyWorks PRs",
    "audiences": ["api://AzureADTokenExchange"]
  }'
```

#### Step 3: Grant Vault Access

```bash
SP_OBJECT_ID=$(az ad sp show --id "$APP_ID" --query id -o tsv)

az role assignment create \
  --role "Key Vault Secrets User" \
  --assignee-object-id "$SP_OBJECT_ID" \
  --scope "/subscriptions/bbcd40ae-efb3-4936-bf37-d7e142f003dd/resourceGroups/shossyworks-rg/providers/Microsoft.KeyVault/vaults/shossyworks-vault"
```

**Note:** Use `Key Vault Secrets User` (read-only), NOT `Key Vault Secrets Officer` — CI/CD should never write to the vault.

#### Step 4: Configure GitHub Repository Secrets

Store these three values as GitHub repository secrets (Settings > Secrets > Actions):

| GitHub Secret | Value |
|---|---|
| `AZURE_CLIENT_ID` | The `appId` from step 1 |
| `AZURE_TENANT_ID` | `bcbfa864-cd26-4ff9-a9d9-b475e97eae74` |
| `AZURE_SUBSCRIPTION_ID` | `bbcd40ae-efb3-4936-bf37-d7e142f003dd` |

#### Step 5: GitHub Actions Workflow

```yaml
name: Deploy
on:
  push:
    branches: [main]

permissions:
  id-token: write   # Required for OIDC
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Azure Login (OIDC)
        uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Pull secrets from Key Vault
        uses: Azure/get-keyvault-secrets@v1
        with:
          keyvault: shossyworks-vault
          secrets: >-
            supabase-url,
            supabase-anon-key,
            supabase-service-role-key,
            supabase-db-password,
            supabase-direct-connection,
            supabase-project-id,
            supabase-publishable-key,
            supabase-secret-key,
            supabase-jwt-secret,
            anthropic-api-key
        id: vault-secrets

      - name: Build with secrets
        run: npm run build
        env:
          NEXT_PUBLIC_SUPABASE_URL: ${{ steps.vault-secrets.outputs.supabase-url }}
          NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ steps.vault-secrets.outputs.supabase-anon-key }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ steps.vault-secrets.outputs.supabase-service-role-key }}
          DATABASE_URL: ${{ steps.vault-secrets.outputs.supabase-direct-connection }}
          ANTHROPIC_API_KEY: ${{ steps.vault-secrets.outputs.anthropic-api-key }}
          # ... remaining vars
```

### Security Benefits of OIDC Over Service Principal + Secret

| | Service Principal + Secret | OIDC Federation |
|---|---|---|
| Stored credentials | Client ID + client secret in GitHub | Client ID only (no secret) |
| Credential rotation | Manual every 1-2 years | Not needed — tokens are ephemeral |
| Blast radius if leaked | Full vault access until rotated | Token expires in ~1 hour |
| Setup complexity | Lower | Slightly higher (one-time) |
| Maintenance | Ongoing rotation | Zero after initial setup |

**For a solo developer, OIDC is still the recommended approach** — the one-time setup cost is 15 minutes, and then you never think about credential rotation for CI/CD again.

---

## 6. RBAC Configuration

### Current State

Zac has **Key Vault Secrets Officer** at the **subscription level**. This is broader than needed but acceptable for a sole developer who owns all vaults in the subscription.

### Recommended RBAC for ShossyWorks

| Identity | Role | Scope | Purpose |
|---|---|---|---|
| Zac (personal) | Key Vault Secrets Officer | `shossyworks-vault` | Full secret CRUD for dev workflow |
| GitHub Actions SP | Key Vault Secrets User | `shossyworks-vault` | Read-only for CI/CD builds |
| Vercel (if OIDC) | Key Vault Secrets User | `shossyworks-vault` | Read-only for deploy-time |

### Built-in Key Vault Roles (Reference)

| Role | Permissions | Use Case |
|---|---|---|
| Key Vault Administrator | Full management plane + data plane | Vault infrastructure management |
| Key Vault Secrets Officer | CRUD on secrets | Developer managing secrets |
| Key Vault Secrets User | Read secrets only | Applications, CI/CD pipelines |
| Key Vault Reader | Read vault metadata (not secret values) | Monitoring, audit tools |

### Why Not Vault Access Policies?

Azure supports two access control models: RBAC and access policies. As of 2026, **Azure RBAC is the default and recommended model** (access policies are legacy). Starting with API version 2026-02-01, RBAC is the default for new vaults. Key advantages:

- Unified access management across Azure resources
- Fine-grained scope control (subscription → resource group → vault)
- Conditional access integration
- Audit log consistency with the rest of Azure

---

## 7. Secret Rotation Strategy

### Which Secrets Need Rotation?

| Secret | Rotation Frequency | Method |
|---|---|---|
| `supabase-db-password` | Every 90 days | Manual via Supabase dashboard + update vault |
| `supabase-anon-key` | Rarely (on compromise) | Regenerate via Supabase dashboard |
| `supabase-service-role-key` | Rarely (on compromise) | Regenerate via Supabase dashboard |
| `supabase-jwt-secret` | Rarely (on compromise) | Regenerate via Supabase dashboard |
| `anthropic-api-key` | Every 90 days or on compromise | Regenerate via Anthropic console |
| `supabase-url` | Never | Fixed per project |
| `supabase-project-id` | Never | Fixed per project |
| `supabase-direct-connection` | When DB password rotates | Rebuild connection string |

### Rotation Workflow (Manual — Appropriate for Solo Dev)

1. Generate new credential in the source service (Supabase, Anthropic)
2. Update the secret in Azure Key Vault:
   ```bash
   az keyvault secret set \
     --vault-name shossyworks-vault \
     --name "supabase-db-password" \
     --value "new-password-here" \
     --subscription bbcd40ae-efb3-4936-bf37-d7e142f003dd
   ```
3. Run `pull-env.sh` to update local `.env.local`
4. Run `sync-to-vercel.sh` to push to Vercel
5. Trigger a Vercel redeploy to pick up new values
6. Verify the app works with the new credentials

### Automated Rotation — When to Consider It

For a solo dev with 10 secrets, manual rotation is fine. Automated rotation (via Azure Functions + Event Grid) becomes worth the setup cost when:
- You have 20+ secrets across multiple vaults
- Compliance requires provable rotation schedules
- You're managing multiple environments (staging, production) with independent secrets

**Not recommended for ShossyWorks at this stage** — the overhead of Azure Functions + Event Grid subscriptions exceeds the value for a single developer.

---

## 8. Local Development Workflow

### Recommended Daily Workflow

```
Developer machine (Windows 11, Git Bash)
    │
    ├── az login (once per session, token cached ~1 hour)
    │
    ├── ./scripts/pull-env.sh
    │       ├── Reads SECRET_MAP (vault-name → env-var mapping)
    │       ├── Calls az keyvault secret show for each
    │       └── Writes .env.local (gitignored)
    │
    └── npm run dev (Next.js reads .env.local automatically)
```

### First-Time Setup

1. Install Azure CLI: `winget install Microsoft.AzureCLI`
2. Login: `az login`
3. Clone repo, run `./scripts/pull-env.sh`
4. Verify: `npm run dev` starts without missing env errors

### `.gitignore` Entries Required

```
# Environment files (secrets)
.env
.env.local
.env.*.local

# Never commit these
.env.production
.env.staging
```

### `.env.example` (Committed — No Secrets)

An `.env.example` file should be committed to the repo showing the expected variable names without values:

```bash
# Public (embedded in client bundle)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Server-only
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_SECRET_KEY=
SUPABASE_JWT_SECRET=
SUPABASE_DB_PASSWORD=
DATABASE_URL=
SUPABASE_PROJECT_ID=
SUPABASE_PUBLISHABLE_KEY=
ANTHROPIC_API_KEY=
```

This serves as documentation of the required variables without exposing values.

---

## 9. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                   Azure Key Vault                           │
│                (shossyworks-vault)                          │
│                                                             │
│  supabase-url  supabase-anon-key  supabase-service-role-key │
│  supabase-db-password  supabase-direct-connection           │
│  supabase-jwt-secret  supabase-secret-key  ...              │
│  anthropic-api-key                                          │
└────┬──────────────────┬──────────────────┬──────────────────┘
     │                  │                  │
     │ az CLI           │ OIDC             │ Script
     │ (pull-env.sh)    │ (federated)      │ (sync-to-vercel)
     ▼                  ▼                  ▼
┌──────────┐    ┌──────────────┐    ┌──────────────┐
│ .env.local│    │ GitHub Actions│    │    Vercel    │
│ (local   │    │ (CI/CD)      │    │ (env vars)   │
│  dev)    │    │              │    │              │
└──────────┘    └──────────────┘    └──────────────┘
     │                  │                  │
     ▼                  ▼                  ▼
┌──────────┐    ┌──────────────┐    ┌──────────────┐
│ next dev │    │  Build/Test  │    │  Production  │
│ (local)  │    │  (CI)        │    │  Deployment  │
└──────────┘    └──────────────┘    └──────────────┘
```

**Single source of truth:** Azure Key Vault. All other locations (`.env.local`, GitHub Actions, Vercel) are consumers that pull from the vault. Never edit secrets in Vercel or GitHub directly — always update the vault first, then sync.

---

## 10. Key Recommendations

### Do Now (Project Setup)

1. **Create `scripts/pull-env.sh`** with the mapping table from Section 3
2. **Add `.env.local` and `.env` to `.gitignore`** before any secrets touch the repo
3. **Create `.env.example`** with variable names only (committed)
4. **Verify all 10 secrets are retrievable** with a dry-run pull

### Do When CI/CD is Needed

5. **Set up OIDC federation** for GitHub Actions (Section 5, steps 1-4)
6. **Create deploy workflow** using the vault secrets action
7. **Grant `Key Vault Secrets User`** to the GitHub Actions service principal (not Officer)

### Do When Deploying to Vercel

8. **Run `sync-to-vercel.sh`** to push all env vars to Vercel
9. **Verify `vercel env ls`** matches the vault contents
10. **Set up Vercel deploy hooks** to trigger on main branch pushes

### Do Quarterly

11. **Rotate `supabase-db-password` and `anthropic-api-key`** (90-day cycle)
12. **Run `pull-env.sh --dry-run`** to verify all secrets are still accessible
13. **Review vault access logs** in Azure Portal for unexpected access

---

## Sources

- [Azure Key Vault developer's guide](https://learn.microsoft.com/en-us/azure/key-vault/general/developers-guide)
- [Best practices for using Azure Key Vault](https://learn.microsoft.com/en-us/azure/key-vault/general/best-practices)
- [Best practices for secrets management](https://learn.microsoft.com/en-us/azure/key-vault/secrets/secrets-best-practices)
- [Use Azure Key Vault secrets in GitHub Actions](https://learn.microsoft.com/en-us/azure/developer/github/github-actions-key-vault)
- [Azure Key Vault RBAC guide](https://learn.microsoft.com/en-us/azure/key-vault/general/rbac-guide)
- [Secure your Azure Key Vault](https://learn.microsoft.com/en-us/azure/key-vault/general/secure-key-vault)
- [Azure Key Vault auto-rotation](https://learn.microsoft.com/en-us/azure/key-vault/general/autorotation)
- [Vercel CLI — vercel env](https://vercel.com/docs/cli/env)
- [Vercel CLI — vercel pull](https://vercel.com/docs/cli/pull)
- [Vercel OIDC with Azure](https://vercel.com/docs/oidc/azure)
- [Get secrets from Azure Key Vault (GitHub Action)](https://github.com/marketplace/actions/get-secrets-from-azure-key-vault)
- [Azure Keyvault Env File Sync (community script)](https://gist.github.com/PatrickMunsey/4e5b0fcf88ac28660bbaa9624ebe9ec8)
- [Build a User Management App with Next.js (Supabase)](https://supabase.com/docs/guides/getting-started/tutorials/with-nextjs)
- [Supabase Next.js Quickstart](https://supabase.com/docs/guides/getting-started/quickstarts/nextjs)
- [vercel-env-push (community npm package)](https://github.com/HiDeoo/vercel-env-push)
