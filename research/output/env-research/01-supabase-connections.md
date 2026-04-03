# Supabase Connection Requirements & Environment Variables

> Research date: 2026-04-03
> Scope: All Supabase env vars, connection patterns, and configuration for ShossyWorks (Next.js + Supabase + Vercel)

---

## 1. Environment Variables — Complete Inventory

### 1.1 Client-Side Variables (Browser-Exposed)

| Variable | Value Source | Required | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Dashboard > Connect | Yes | Project API URL (`https://<ref>.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Dashboard > API Keys | Yes | Public key for client init (`sb_publishable_...`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Dashboard > Legacy API Keys | Transitional | Legacy anon key (JWT). Being phased out — migrate to publishable key |

**Key rule**: Only `NEXT_PUBLIC_` prefixed vars are exposed to the browser. Never prefix secret/service-role keys with `NEXT_PUBLIC_`.

### 1.2 Server-Side Variables (Never Exposed to Browser)

| Variable | Value Source | Required | Purpose |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Dashboard > Legacy API Keys | Transitional | Legacy service role JWT. Bypasses RLS. Being replaced by secret key |
| `SUPABASE_SECRET_KEY` | Dashboard > API Keys | Yes (new) | New secret key (`sb_secret_...`). Bypasses RLS. Browser-safe (returns 401 if detected in browser) |
| `SUPABASE_JWT_SECRET` | Dashboard > Project Settings > Data API | Conditional | JWT signing secret (HS256). Needed only if verifying JWTs manually outside Supabase client |
| `SUPABASE_DB_PASSWORD` | Dashboard > Database Settings | Yes | Postgres password for direct/pooled connections |
| `DATABASE_URL` | Constructed | Yes | Pooled connection string (transaction mode, port 6543). Used by ORMs in serverless |
| `DIRECT_DATABASE_URL` | Constructed | Conditional | Direct Postgres connection (port 5432). Used for migrations, CLI commands |

### 1.3 Connection String Templates

**Supavisor Transaction Mode (Port 6543)** — for serverless/edge/server actions:
```
postgres://postgres.[PROJECT_REF]:[DB_PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres
```

**Supavisor Session Mode (Port 5432)** — for persistent backends:
```
postgres://postgres.[PROJECT_REF]:[DB_PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres
```

**Direct Connection (Port 5432)** — for migrations, CLI, and admin tasks:
```
postgresql://postgres:[DB_PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres
```

> **IPv4 note**: Direct connections are IPv6 only by default. IPv4 requires the IPv4 Add-On or use Supavisor session mode instead.

### 1.4 Derived / Constructed Variables

These are not stored directly but built from components:

| Variable | Constructed From |
|---|---|
| `DATABASE_URL` | `SUPABASE_PROJECT_REF` + `SUPABASE_DB_PASSWORD` + region |
| `DIRECT_DATABASE_URL` | `SUPABASE_PROJECT_REF` + `SUPABASE_DB_PASSWORD` |

---

## 2. Key System Transition (Legacy → New)

### 2.1 Timeline

| Date | Event |
|---|---|
| June 2025 | New key system launched. New projects get both key types |
| July 2025 | Dashboard focuses on new keys |
| November 2025 | Restored projects no longer include legacy keys. New projects exclude anon/service_role |
| Late 2026 | **Legacy keys deleted. Migration mandatory** |

### 2.2 Key Mapping

| Legacy Key | New Key | Format | Notes |
|---|---|---|---|
| `anon` key | Publishable key | `sb_publishable_...` | Functionally identical. Drop-in replacement |
| `service_role` key | Secret key | `sb_secret_...` | Drop-in replacement. Secret key has browser detection (returns 401 if used in browser) |

### 2.3 Migration Steps

1. Generate new keys in Dashboard > API Keys
2. Replace `NEXT_PUBLIC_SUPABASE_ANON_KEY` with `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
3. Replace `SUPABASE_SERVICE_ROLE_KEY` with `SUPABASE_SECRET_KEY`
4. Test all client initialization
5. Deactivate legacy keys (use "last used" indicators in dashboard)

**Compatibility**: Both old and new keys work simultaneously during transition. Supabase client libraries accept either without code changes beyond the key value itself.

### 2.4 Known Limitations of New Keys

1. Cannot be sent in `Authorization: Bearer` header (non-JWT format)
2. Edge Functions require `--no-verify-jwt` flag; implement custom `apikey` header validation
3. Public Realtime connections limited to 24 hours without authenticated user
4. New keys only available on Supabase hosted platform (not self-hosted)

---

## 3. Client Creation Patterns

### 3.1 Browser Client (`lib/supabase/client.ts`)

Used in Client Components for browser-side operations. Singleton pattern.

```typescript
import { createBrowserClient } from '@supabase/ssr'

export const createClient = () => {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )
}
```

**Packages**: `@supabase/supabase-js`, `@supabase/ssr`

**Behavior**:
- Uses publishable key (or legacy anon key)
- Subject to RLS policies
- User auth state managed via cookies
- Singleton — reuses the same instance across components

### 3.2 Server Client (`lib/supabase/server.ts`)

Used in Server Components, Server Actions, and Route Handlers. Created per-request.

```typescript
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export const createClient = async () => {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet, headers) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch (error) {
            // Silently handle in read-only Server Components
          }
        },
      },
    }
  )
}
```

**Behavior**:
- Uses same publishable key as browser client
- Reads user JWT from cookies — inherits user's RLS context
- Created fresh per-request (not singleton)
- `setAll` may silently fail in Server Components (read-only context)

### 3.3 Admin Client (`lib/supabase/admin.ts`)

Used for operations that need to bypass RLS (webhooks, system tasks, admin operations).

```typescript
import { createClient } from '@supabase/supabase-js'

export const createAdminClient = () => {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,  // or SUPABASE_SERVICE_ROLE_KEY for legacy
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  )
}
```

**Critical rules**:
- **Never** import or use in Client Components
- **Never** prefix the secret key env var with `NEXT_PUBLIC_`
- Uses `@supabase/supabase-js` directly (not `@supabase/ssr`)
- Disables session persistence (no cookies needed)
- Always verify user identity/permissions before executing admin operations

### 3.4 Middleware Client (`middleware.ts`)

Placed at project root. Refreshes auth tokens on every request.

```typescript
import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'

export async function middleware(request: NextRequest) {
  const responseHeaders = new Headers()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return parseCookieHeader(request.headers.get('cookie') ?? '')
        },
        setAll(cookiesToSet, cacheHeaders) {
          cookiesToSet.forEach(({ name, value, options }) => {
            responseHeaders.set(
              'Set-Cookie',
              serializeCookieHeader(name, value, options)
            )
          })
          Object.entries(cacheHeaders).forEach(([key, value]) => {
            responseHeaders.set(key, value)
          })
        },
      },
    }
  )

  // IMPORTANT: Use getClaims(), NOT getSession() for security
  await supabase.auth.getClaims()

  return NextResponse.next({
    request: { headers: responseHeaders },
  })
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

**Key security note**: Always use `supabase.auth.getClaims()` instead of `getSession()` in server code. `getClaims()` revalidates the token; `getSession()` does not.

---

## 4. Realtime Configuration

### 4.1 Channel Types

| Type | Access | Use Case |
|---|---|---|
| **Public** | Anyone can subscribe | General broadcast, non-sensitive updates |
| **Private** | Authenticated users only, governed by RLS | Collaborative editing, user-specific data |

Project-level setting controls whether public channels are enabled (Dashboard > Realtime Settings).

### 4.2 Channel Setup for Broadcast + Presence

```typescript
// Create channel with broadcast and presence
const channel = supabase.channel('estimate-room-123', {
  config: {
    broadcast: {
      self: true,   // Receive own broadcasts
      ack: true,    // Server acknowledges receipt
    },
    presence: {
      key: userId,  // Custom presence key (default: UUIDv1)
    },
  },
})

// Subscribe to broadcast events
channel
  .on('broadcast', { event: 'cursor-move' }, (payload) => {
    // Handle cursor position update
  })
  .on('broadcast', { event: 'field-edit' }, (payload) => {
    // Handle field edit
  })
  .on('presence', { event: 'sync' }, () => {
    const state = channel.presenceState()
    // Update online users list
  })
  .on('presence', { event: 'join' }, ({ key, newPresences }) => {
    // Handle user join
  })
  .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
    // Handle user leave
  })
  .subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      await channel.track({
        user_id: userId,
        user_name: userName,
        online_at: new Date().toISOString(),
      })
    }
  })
```

### 4.3 Realtime RLS Policies

For private channels, create RLS policies on `realtime.messages`:

```sql
-- Allow authenticated users to receive broadcasts
CREATE POLICY "authenticated can receive broadcasts"
ON "realtime"."messages"
FOR SELECT
TO authenticated
USING ( true );

-- Restrict to specific users/roles
CREATE POLICY "team members can receive broadcasts"
ON "realtime"."messages"
FOR SELECT
TO authenticated
USING (
  (SELECT auth.uid()) IN (
    SELECT user_id FROM team_members
    WHERE team_id = (realtime.messages.extension::jsonb->>'team_id')::uuid
  )
);
```

### 4.4 Database-Triggered Broadcasts

Use `realtime.broadcast_changes()` for automatic broadcasts on table changes:

```sql
CREATE OR REPLACE TRIGGER broadcast_estimate_changes
AFTER INSERT OR UPDATE OR DELETE ON estimates
FOR EACH ROW
EXECUTE FUNCTION realtime.broadcast_changes(
  'estimate-updates',    -- channel topic
  'estimate-change',     -- event name
  'id',                  -- primary key column
  false                  -- public channel?
);
```

### 4.5 Realtime Limits

| Compute Size | Auth Pool Size | Max Channels | Max Users/Channel | Max Events/sec |
|---|---|---|---|---|
| Nano/Micro | 2 | 100 | 200 | 100 |
| Small-Large | 5 | 100 | 200 | 100 |
| XL-4XL | 10 | 100 | 200 | 100 |
| 8XL+ | 15 | 100 | 200 | 100 |

> These are defaults; channels and events/sec can be configured. Messages in `realtime.messages` table auto-delete after 3 days.

### 4.6 Realtime Environment Variables

No additional environment variables needed for Realtime beyond `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Realtime uses the same Supabase client and connects via WebSocket to the project URL automatically.

---

## 5. RLS Session Variables & Auth Helpers

### 5.1 Built-in Auth Functions

| Function | Returns | Use In |
|---|---|---|
| `auth.uid()` | Current user's UUID | RLS policies |
| `auth.jwt()` | Complete decoded JWT object | RLS policies — access claims |
| `auth.role()` | Current Postgres role (`anon` or `authenticated`) | RLS policies |

### 5.2 How Keys Affect RLS

| Key Used | User Signed In | Postgres Role | RLS Applied |
|---|---|---|---|
| Publishable / `anon` | No | `anon` | Yes — anon policies only |
| Publishable / `anon` | Yes | `authenticated` | Yes — authenticated policies |
| Secret / `service_role` | N/A | `service_role` | **No — bypasses all RLS** |

### 5.3 Accessing JWT Claims in RLS

```sql
-- User ID
(SELECT auth.uid()) = user_id

-- App metadata (server-controlled, safe for authorization)
(SELECT auth.jwt()->'app_metadata'->>'role') = 'owner'

-- User metadata (user-modifiable, NOT safe for authorization)
(SELECT auth.jwt()->'user_metadata'->>'name')

-- MFA enforcement
(SELECT auth.jwt()->>'aal') = 'aal2'
```

**Performance optimization**: Always wrap auth functions in `(SELECT ...)` to enable query planner caching (99.97% improvement in benchmarks):

```sql
-- SLOW: called per row
USING ( auth.uid() = user_id )

-- FAST: cached per statement
USING ( (SELECT auth.uid()) = user_id )
```

### 5.4 Custom Claims for Roles

For ShossyWorks' role system (owner/employee/client), use `app_metadata` with a Custom Access Token Hook:

```sql
-- Example RLS policy using custom role claim
CREATE POLICY "owners can manage estimates"
ON estimates
FOR ALL
TO authenticated
USING (
  (SELECT auth.jwt()->'app_metadata'->>'role') = 'owner'
  OR
  (SELECT auth.uid()) = created_by
);
```

**Important**: `app_metadata` changes don't take effect until the JWT refreshes. Plan for eventual consistency in role changes.

### 5.5 Direct Connection RLS Setup

When using direct Postgres connections (not through Supabase API), you must manually set session variables for RLS:

```sql
-- Set the JWT claims for the session
SELECT set_config('request.jwt.claims', '{"sub": "user-uuid", "role": "authenticated"}', false);
SELECT set_config('request.jwt.claim.sub', 'user-uuid', false);
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
```

The third argument (`false`) ensures the setting applies to the entire session, not just the current transaction.

---

## 6. Supabase CLI & Local Development

### 6.1 Local Development Defaults

After running `supabase init` and `supabase start`:

| Service | Local URL |
|---|---|
| API URL | `http://127.0.0.1:54321` |
| GraphQL URL | `http://127.0.0.1:54321/graphql/v1` |
| Database URL | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| Studio URL | `http://127.0.0.1:54323` |
| Inbucket (email) | `http://127.0.0.1:54324` |

| Secret | Local Default Value |
|---|---|
| JWT Secret | `super-secret-jwt-token-with-at-least-32-characters-long` |
| Anon Key | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0` |
| Service Role Key | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU` |

Export as env vars: `supabase status -o env`

### 6.2 config.toml Structure

Generated by `supabase init` in `supabase/config.toml`:

```toml
[project]
id = "your-project-ref"

[api]
enabled = true
port = 54321
schemas = ["public", "graphql_public"]
extra_search_path = ["public", "extensions"]

[db]
port = 54322
shadow_port = 54320
major_version = 15

[studio]
enabled = true
port = 54323

[inbucket]
enabled = true
port = 54324

[auth]
enabled = true
site_url = "http://127.0.0.1:3000"
additional_redirect_urls = ["https://127.0.0.1:3000"]

[auth.email]
enable_signup = true
double_confirm_changes = true
enable_confirmations = false

# Use env() to reference .env secrets
[auth.external.github]
enabled = true
client_id = "env(GITHUB_CLIENT_ID)"
secret = "env(GITHUB_SECRET)"

[realtime]
enabled = true
```

### 6.3 Local `.env.local` for Next.js

```bash
# Supabase — Local Development
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
SUPABASE_SECRET_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

---

## 7. Connection Pooling — When to Use What

### 7.1 Decision Matrix

| Scenario | Connection Type | Port | Why |
|---|---|---|---|
| Server Actions (Next.js) | Supavisor Transaction Mode | 6543 | Serverless = many short-lived connections |
| Server Components (data fetch) | Supabase Client (API) | 443 (HTTPS) | Use REST API, not direct Postgres |
| Client Components | Supabase Client (API) | 443 (HTTPS) | Always use API, never direct DB |
| Database migrations | Direct connection | 5432 | Migrations need DDL, prepared statements |
| Supabase CLI commands | Direct connection | 5432 | CLI manages its own connection |
| ORM queries (Drizzle/Prisma) in serverless | Supavisor Transaction Mode | 6543 | Pool + disable prepared statements |
| ORM queries in persistent server | Direct or Session Mode | 5432 | Can use prepared statements |
| Realtime subscriptions | WebSocket via API | 443 | Handled by Supabase client automatically |
| Edge Functions | Supabase Client (API) | 443 | Use client library, not direct DB |

### 7.2 ORM Configuration

**Drizzle with Supabase (serverless)**:
```typescript
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

const client = postgres(process.env.DATABASE_URL!, {
  prepare: false,  // REQUIRED for transaction mode pooling
})
const db = drizzle(client)
```

**Prisma with Supabase**:
```prisma
// schema.prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")        // Pooled (transaction mode)
  directUrl = env("DIRECT_DATABASE_URL") // Direct (for migrations)
}
```

### 7.3 Supavisor Pool Sizing

- If heavy PostgREST API usage: keep pool size under 40% of max connections
- Otherwise: allocate up to 80% to pool
- Reserve capacity for auth, realtime, and storage services

---

## 8. Vault Secrets Audit — Gap Analysis

### 8.1 Current Vault Secrets (shossyworks-vault)

| Vault Secret | Maps To | Status |
|---|---|---|
| `supabase-project-id` | Project reference ID | Needed — used to construct connection strings |
| `supabase-url` | `NEXT_PUBLIC_SUPABASE_URL` | Needed |
| `supabase-anon-key` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Transitional** — replace with publishable key by late 2026 |
| `supabase-service-role-key` | `SUPABASE_SERVICE_ROLE_KEY` | **Transitional** — replace with secret key by late 2026 |
| `supabase-jwt-secret` | `SUPABASE_JWT_SECRET` | **Conditional** — only needed if manually verifying JWTs. Prefer `getClaims()` |
| `supabase-db-password` | `SUPABASE_DB_PASSWORD` | Needed — used to construct `DATABASE_URL` |
| `supabase-direct-connection` | `DIRECT_DATABASE_URL` | Needed — for migrations and admin |
| `supabase-publishable-key` | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Needed — new primary client key |
| `supabase-secret-key` | `SUPABASE_SECRET_KEY` | Needed — new primary server key |

### 8.2 Missing Secrets (Should Add to Vault)

| Secret | Env Var | Reason |
|---|---|---|
| `supabase-pooled-connection` | `DATABASE_URL` | Pooled connection string for serverless ORMs. Currently must be constructed manually from project-id + db-password + region |

### 8.3 Redundant Secrets (Can Remove After Migration)

| Secret | When Safe to Remove |
|---|---|
| `supabase-anon-key` | After migrating all clients to publishable key and verifying via dashboard "last used" |
| `supabase-service-role-key` | After migrating all server code to secret key |
| `supabase-jwt-secret` | After confirming no code manually verifies JWTs (use `getClaims()` instead) |

### 8.4 Recommended Final Vault State

After migration completes (target: before late 2026 deadline):

| Vault Secret | Env Var | Purpose |
|---|---|---|
| `supabase-project-id` | `SUPABASE_PROJECT_REF` | Project reference for constructing URLs |
| `supabase-url` | `NEXT_PUBLIC_SUPABASE_URL` | API endpoint |
| `supabase-publishable-key` | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Client key |
| `supabase-secret-key` | `SUPABASE_SECRET_KEY` | Server key (RLS bypass) |
| `supabase-db-password` | `SUPABASE_DB_PASSWORD` | Database password |
| `supabase-pooled-connection` | `DATABASE_URL` | Supavisor transaction mode connection |
| `supabase-direct-connection` | `DIRECT_DATABASE_URL` | Direct Postgres connection |

---

## 9. Complete `.env.local` Template

```bash
# =============================================================================
# SUPABASE — ShossyWorks
# =============================================================================

# -- Client-side (exposed to browser via NEXT_PUBLIC_ prefix) --
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...

# -- Server-side (NEVER exposed to browser) --
SUPABASE_SECRET_KEY=sb_secret_...

# -- Database Connections --
# Supavisor transaction mode — for serverless/server actions/ORMs
DATABASE_URL=postgres://postgres.<project-ref>:<db-password>@aws-0-<region>.pooler.supabase.com:6543/postgres

# Direct connection — for migrations and admin tasks
DIRECT_DATABASE_URL=postgresql://postgres:<db-password>@db.<project-ref>.supabase.co:5432/postgres

# -- Legacy (remove after migration) --
# NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
# SUPABASE_SERVICE_ROLE_KEY=eyJ...
# SUPABASE_JWT_SECRET=your-jwt-secret
```

---

## 10. Package Dependencies

```json
{
  "dependencies": {
    "@supabase/supabase-js": "^2.49.x",
    "@supabase/ssr": "^0.6.x"
  },
  "devDependencies": {
    "supabase": "^2.x"
  }
}
```

| Package | Purpose |
|---|---|
| `@supabase/supabase-js` | Core client library. Used for admin client (service role) and standalone operations |
| `@supabase/ssr` | SSR-specific client. Provides `createBrowserClient`, `createServerClient`, cookie helpers |
| `supabase` (CLI) | Local development, migrations, type generation, project management |

---

## 11. Security Checklist

- [ ] `SUPABASE_SECRET_KEY` / `SUPABASE_SERVICE_ROLE_KEY` never has `NEXT_PUBLIC_` prefix
- [ ] `.env.local` is in `.gitignore`
- [ ] RLS is enabled on ALL tables
- [ ] All RLS policies use `(SELECT auth.uid())` pattern (cached) not bare `auth.uid()`
- [ ] Admin client disables `persistSession`, `autoRefreshToken`, `detectSessionInUrl`
- [ ] Middleware uses `getClaims()` not `getSession()` for token validation
- [ ] `app_metadata` (server-controlled) used for authorization, not `user_metadata` (user-editable)
- [ ] Separate secret keys per deployment environment (dev, staging, prod)
- [ ] GitHub Secret Scanning enabled (Supabase auto-revokes leaked `sb_secret_` keys)
- [ ] ORM connections use `prepare: false` when going through Supavisor transaction mode

---

## Sources

- [Supabase API Keys Documentation](https://supabase.com/docs/guides/api/api-keys)
- [Supabase SSR Client Creation](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
- [Supabase Next.js Auth Setup](https://supabase.com/docs/guides/auth/server-side/nextjs)
- [Supabase Connection Management](https://supabase.com/docs/guides/database/connection-management)
- [Supabase Connecting to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase JWT Documentation](https://supabase.com/docs/guides/auth/jwts)
- [Supabase Signing Keys](https://supabase.com/docs/guides/auth/signing-keys)
- [Supabase Realtime Broadcast](https://supabase.com/docs/guides/realtime/broadcast)
- [Supabase Realtime Concepts](https://supabase.com/docs/guides/realtime/concepts)
- [Supabase CLI Config](https://supabase.com/docs/guides/local-development/managing-config)
- [Supabase CLI Start Reference](https://supabase.com/docs/reference/cli/v1/supabase-start)
- [API Keys Migration Discussion](https://github.com/orgs/supabase/discussions/29260)
- [New API Keys Migration Discussion](https://github.com/orgs/supabase/discussions/40300)
- [Supabase Connection String Guide (2026)](https://www.weweb.io/blog/supabase-connection-string-guide-ports-pooling)
- [Drizzle ORM + Supabase](https://orm.drizzle.team/docs/tutorials/drizzle-with-supabase)
- [Prisma + Supabase](https://supabase.com/docs/guides/database/prisma)
