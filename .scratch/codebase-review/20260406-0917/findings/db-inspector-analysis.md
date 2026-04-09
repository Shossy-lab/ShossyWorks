# A8 -- Database Inspector Analysis

**Agent:** A8 (db-inspector)
**Domain:** Database -- Supabase migrations, RLS policies, SQL injection, trigger security, index coverage, constraint completeness, SECURITY DEFINER functions, grant/revoke patterns
**Key file:** `supabase/migrations/00000000000001_auth_roles.sql`
**Date:** 2026-04-06
**Review depth:** standard (CRITICAL + HIGH, noteworthy MEDIUM)

---

## Executive Summary

The single migration file (`00000000000001_auth_roles.sql`) establishes the auth roles system: an `app_role` enum, a `user_roles` table with RLS, and a `custom_access_token_hook` PL/pgSQL function that injects the user's role into the JWT on every token issue/refresh. The codebase is early-stage (Phase 0) so there is only one migration and one table. Despite the small surface area, I found **2 CRITICAL**, **5 HIGH**, and **3 MEDIUM** findings. The most severe issues are the missing `search_path` on the hook function (a known Supabase security requirement for hook functions) and the "Service role can manage all roles" RLS policy that grants universal access to any role, including `anon` in some edge cases.

---

## Findings

---

### Finding 1: custom_access_token_hook lacks SECURITY DEFINER and search_path pinning

**Severity: CRITICAL**
**Checklist item:** #170 -- Database functions & triggers: SECURITY DEFINER functions must set search_path
**File:** `supabase/migrations/00000000000001_auth_roles.sql`, lines 39-64

**Evidence:**

```sql
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
```

The function is created with the default security context (`SECURITY INVOKER`). It has no `SET search_path` clause.

**Why this is CRITICAL:**

1. **Missing `search_path` pinning.** Without `SET search_path = public` (or preferably `SET search_path = ''` with fully-qualified table references), the function resolves table names against the session's current `search_path`. An attacker who can manipulate the search path (e.g., via `SET search_path = attacker_schema, public;` in a connection that reaches this function) could cause `public.user_roles` to resolve to `attacker_schema.user_roles`, returning an attacker-controlled role. This is the canonical Postgres search_path injection attack vector (CVE-2018-1058 class).

2. **Missing explicit security qualifier.** The function currently runs as `SECURITY INVOKER` (the default). When called as a Supabase auth hook, it executes in the context of `supabase_auth_admin`, which happens to have the required `GRANT ALL` on `user_roles`. However, if the security model changes or if the function is ever called in another context, it could silently fail or expose data. Supabase's own documentation for custom access token hooks explicitly recommends either `SECURITY DEFINER` with `SET search_path = ''` or at minimum pinning the search_path. The project's own research file at `research/output/research-pin-auth.md` line 398 shows the correct pattern: `security definer set search_path = ''`. The previous iteration of this project (documented in `research/references/attempt-1-ep-table-structure-spec.md` line 863-864) also used `SECURITY DEFINER` with `SET search_path = public` for similar functions.

3. **The function reads from `user_roles` without schema qualification inside the body.** Line 51 uses `FROM public.user_roles ur` which is correctly schema-qualified within the function body. However, the function itself lacks the `SET search_path` directive, which means other unqualified references in future modifications would be vulnerable.

**Recommended fix:**

```sql
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  claims JSONB;
  user_role public.app_role;
BEGIN
  claims := event->'claims';

  SELECT ur.role
  INTO user_role
  FROM public.user_roles ur
  WHERE ur.user_id = (event->>'user_id')::UUID;
  -- rest unchanged, all table references already use public. prefix
```

Note: When using `SET search_path = ''`, ensure all table/type references use explicit `public.` prefix (which is already the case in the current function body for the table reference, and `public.app_role` is used for the variable type).

---

### Finding 2: "Service role can manage all roles" RLS policy is overly permissive

**Severity: CRITICAL**
**Checklist item:** #158 -- Row-Level Security (RLS): every table must have appropriate policies
**File:** `supabase/migrations/00000000000001_auth_roles.sql`, lines 32-35

**Evidence:**

```sql
CREATE POLICY "Service role can manage all roles"
  ON public.user_roles FOR ALL
  USING (true)
  WITH CHECK (true);
```

**Why this is CRITICAL:**

This policy allows **any authenticated Postgres role** that has table-level grants to read and write all rows in `user_roles` -- it applies unconditionally (`USING (true)`, `WITH CHECK (true)`). The name implies it is for the "service role," but RLS policies do not filter by Postgres role -- they apply to all roles unless qualified with a role check in the `USING` clause.

The only thing preventing arbitrary access is the combination of:
- Line 72: `REVOKE ALL ON TABLE public.user_roles FROM authenticated, anon, public;`
- Line 76: `GRANT SELECT ON TABLE public.user_roles TO authenticated;`

So `authenticated` users can only `SELECT`, and the RLS policy lets them see **all** rows. But the other policy at line 28-30 also allows SELECT with `user_id = auth.uid()`. When multiple policies exist for the same operation and role, Postgres ORs them together. This means:

- **The "Users can read their own role" policy is effectively dead code.** Because the "Service role can manage all roles" policy has `USING (true)` for ALL operations (including SELECT), any authenticated user who has SELECT privilege sees ALL rows, not just their own. The restrictive policy is completely overridden by the permissive one.

- **Any authenticated user can see every other user's role.** This is a data leak. In a construction estimating platform, users should not be able to enumerate who has `owner`, `employee`, or `client` roles.

- **If any future migration inadvertently grants INSERT/UPDATE/DELETE to `authenticated`, users could escalate their own role to `owner`.** The `WITH CHECK (true)` would allow it.

**The correct pattern** for a service-role-only policy uses a role check:

```sql
CREATE POLICY "Service role can manage all roles"
  ON public.user_roles FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
```

Or, since `supabase_auth_admin` bypasses RLS by default when using the service role key, and the `GRANT ALL` on line 68 already gives it full access, this blanket policy may not even be needed. The service role connection bypasses RLS entirely in Supabase.

**Impact right now:** All authenticated users can read all rows in `user_roles` (role enumeration). The privilege escalation path is dormant but becomes active the moment any future migration adds broader grants.

**Recommended fix:**

Either remove the blanket policy entirely (relying on the service role key bypassing RLS, which is Supabase's default behavior) or qualify it:

```sql
-- Option A: Remove the blanket policy
DROP POLICY "Service role can manage all roles" ON public.user_roles;

-- Option B: Scope it properly
CREATE POLICY "Service role can manage all roles"
  ON public.user_roles FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
```

---

### Finding 3: No updated_at trigger -- column will contain stale data

**Severity: HIGH**
**Checklist item:** #168 -- Temporal data handling: tables need updated_at with automatic triggers
**File:** `supabase/migrations/00000000000001_auth_roles.sql`, line 18

**Evidence:**

```sql
CREATE TABLE public.user_roles (
  ...
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ...
);
```

The `updated_at` column is declared with a default of `now()` for INSERTs, but there is no `BEFORE UPDATE` trigger to automatically set it on updates. If a role is changed (e.g., from `employee` to `owner`), the `updated_at` column will still reflect the original insert time.

The project's own research documents this as a known pattern. The previous iteration (`research/references/attempt-1-ep-table-structure-spec.md`, line 901-905) explicitly used an `update_updated_at_column()` trigger on every table.

The standard Supabase pattern is:

```sql
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_user_roles_updated_at
  BEFORE UPDATE ON public.user_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();
```

Alternatively, the `moddatetime` extension can be used. Without this trigger, any auditing, caching, or replication logic that depends on `updated_at` will be silently broken.

---

### Finding 4: Missing schema usage grant for supabase_auth_admin

**Severity: HIGH**
**Checklist item:** #170 -- Database functions & triggers: grant/revoke correctness
**File:** `supabase/migrations/00000000000001_auth_roles.sql`, lines 67-76

**Evidence:**

The migration grants table and function access:

```sql
GRANT ALL ON TABLE public.user_roles TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
```

But it is missing:

```sql
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
```

The project's own research at `research/output/research-pin-auth.md` line 266 includes this grant as part of the correct setup. Without `USAGE` on the schema, the `supabase_auth_admin` role may not be able to see objects in the `public` schema at all, depending on the Postgres version and default privileges.

In practice, Supabase's hosted platform currently grants `USAGE ON SCHEMA public` to most roles by default (inherited from the `public` role). However:

1. This default can be revoked (Postgres 15+ changed the default to not grant `CREATE` on `public` schema to the `public` role, and some hardening guides revoke `USAGE` too).
2. The migration explicitly revokes from `public` on line 72 (`REVOKE ALL ... FROM ... public`), which is a table-level revoke and does not affect schema-level grants. But it signals an intent to lock things down.
3. Relying on implicit grants is fragile and violates the principle of explicit security.

**Recommended fix:** Add `GRANT USAGE ON SCHEMA public TO supabase_auth_admin;` to the permissions section.

---

### Finding 5: No generated TypeScript types for database schema

**Severity: HIGH**
**Checklist item:** #156 -- Schema-code mismatch: TypeScript types are stale or hand-written
**File:** N/A (no `types/database.ts` or `types/supabase.ts` exists)

**Evidence:**

```
$ Glob("**/types/database*.ts")  -> No files found
$ Grep("Database|Tables|user_roles" in src/) -> only src/env.ts (for DATABASE_URL)
```

The codebase has no generated database types. Supabase provides `supabase gen types typescript` which generates a `Database` type that keeps TypeScript in sync with the actual schema. Without this:

1. Any future code that queries `user_roles` will use untyped responses (`any` or manual types).
2. Column renames, type changes, or new columns in migrations will not produce TypeScript compilation errors.
3. The `createClient()` calls in `src/lib/supabase/client.ts`, `server.ts`, and `admin.ts` all use the unparameterized `createClient()` without a `Database` generic, meaning all queries return untyped data.

At this early stage (only one table), the impact is limited. But this should be set up before Phase 1A (database schema) begins, or it will become a significant source of type-safety gaps.

**Recommended fix:**

```bash
npx supabase gen types typescript --project-id "$SUPABASE_PROJECT_ID" > src/types/database.ts
```

Then use the generated type:

```typescript
import type { Database } from "@/types/database";
createClient<Database>(url, key, ...);
```

---

### Finding 6: Redundant index on user_id (already covered by UNIQUE constraint)

**Severity: HIGH**
**Checklist item:** #159 -- Index optimization: detect unused indexes
**File:** `supabase/migrations/00000000000001_auth_roles.sql`, lines 22-23

**Evidence:**

```sql
UNIQUE(user_id)
...
CREATE INDEX idx_user_roles_user_id ON public.user_roles(user_id);
```

The comment on line 22 even acknowledges this: "already covered by UNIQUE, but explicit." However, this is not just unnecessary -- it is actively harmful:

1. **Double write amplification.** Every INSERT and UPDATE to `user_roles` must update both the unique index and the redundant B-tree index. For a small table this is negligible, but it sets a bad precedent for the ~20+ tables coming in Phase 1A.
2. **Double storage cost.** Two identical index structures on the same column.
3. **Planner confusion.** The query planner may choose the non-unique index over the unique index in some cases, producing a slightly less optimal plan (the unique index provides stronger cardinality guarantees to the planner).

Postgres automatically creates a unique B-tree index to enforce a `UNIQUE` constraint. The explicit index is exact duplication.

**Recommended fix:** Remove line 23 (`CREATE INDEX idx_user_roles_user_id ...`).

---

### Finding 7: custom_access_token_hook not enabled in config.toml

**Severity: HIGH**
**Checklist item:** #170 -- Database functions & triggers: triggers must not have unintended side effects
**File:** `supabase/config.toml`, lines 274-276

**Evidence:**

```toml
# This hook runs before a token is issued and allows you to add additional claims based on the authentication method used.
# [auth.hook.custom_access_token]
# enabled = true
# uri = "pg-functions://<database>/<schema>/<hook_name>"
```

The hook configuration is entirely commented out. This means:

1. **In local development (supabase start), the hook is not active.** Tokens will not contain the `user_role` claim in `app_metadata`. Any frontend or RLS logic that depends on `auth.jwt() -> 'app_metadata' ->> 'user_role'` will silently get `null`.
2. **The migration creates the function and permissions, but the hook is never wired up locally.** This creates a discrepancy between local and production if the hook is enabled in the production dashboard but not in `config.toml`.
3. **Future developers running `supabase start` will have a different auth behavior than production**, leading to hard-to-debug issues.

**Recommended fix:**

```toml
[auth.hook.custom_access_token]
enabled = true
uri = "pg-functions://postgres/public/custom_access_token_hook"
```

---

### Finding 8: No role assignment on user signup (orphan users get silently defaulted)

**Severity: HIGH**
**Checklist item:** #160 -- Foreign key integrity: missing foreign keys allow orphaned records; #161 -- Data validation constraints
**File:** `supabase/migrations/00000000000001_auth_roles.sql`, lines 39-64

**Evidence:**

The `custom_access_token_hook` handles the case where no `user_roles` record exists:

```sql
  IF user_role IS NOT NULL THEN
    claims := jsonb_set(claims, '{app_metadata,user_role}', to_jsonb(user_role::TEXT));
  ELSE
    -- Default to 'employee' if no role record exists
    claims := jsonb_set(claims, '{app_metadata,user_role}', '"employee"');
  END IF;
```

But there is no mechanism to create a `user_roles` row when a new user signs up. There is no:
- `handle_new_user()` trigger on `auth.users`
- Server-side signup handler that inserts into `user_roles`
- Any application code referencing `user_roles` (confirmed by grep)

This means:

1. **Every new user silently gets `employee` role** via the JWT hook fallback, but they have no actual row in `user_roles`. This is a phantom role -- it exists only in the JWT, not in the database.
2. **If any RLS policy or application query checks `user_roles` directly** (which they will in Phase 1A), it will find no row and deny access, even though the JWT says `employee`.
3. **The `user_id` foreign key on `user_roles` references `auth.users(id) ON DELETE CASCADE`**, but there is no reverse guarantee: creating a user does not create a role row. This is an FK integrity gap in the domain model.

The previous iteration of this project (documented in `research/references/attempt-1-ep-table-structure-spec.md`, line 902) had a `handle_new_user()` trigger that auto-created profile rows on signup. This was not carried forward.

**Recommended fix:** Add a trigger on `auth.users` that creates a default `user_roles` row on INSERT:

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'employee');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
```

---

### Finding 9: Migration lacks idempotency guards

**Severity: MEDIUM**
**Checklist item:** #157 -- Migration quality: migrations should be idempotent where possible, with IF NOT EXISTS/IF EXISTS guards
**File:** `supabase/migrations/00000000000001_auth_roles.sql`

**Evidence:**

```sql
CREATE EXTENSION IF NOT EXISTS ltree;                    -- guarded (good)
CREATE TYPE public.app_role AS ENUM (...);               -- NOT guarded
CREATE TABLE public.user_roles (...);                    -- NOT guarded
CREATE INDEX idx_user_roles_user_id ON public.user_roles; -- NOT guarded
CREATE POLICY "Users can read their own role" ...;       -- NOT guarded
CREATE POLICY "Service role can manage all roles" ...;   -- NOT guarded
```

Only the extension creation has an `IF NOT EXISTS` guard. The type, table, index, and policy creations will all fail if run a second time. While Supabase migrations are tracked and should only run once, idempotency guards are a defense-in-depth measure for:

1. Development resets where migration state may be inconsistent.
2. Manual re-application during debugging.
3. Future migration squashing where multiple migrations are combined.

The function creation is idempotent (`CREATE OR REPLACE FUNCTION`), which is correct.

**Recommended fix:** Add `IF NOT EXISTS` to `CREATE TABLE` and `CREATE INDEX`. For `CREATE TYPE`, use a conditional block:

```sql
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('owner', 'employee', 'client');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
```

---

### Finding 10: Weak password requirements in local auth config

**Severity: MEDIUM**
**Checklist item:** #161 -- Data validation constraints (auth configuration)
**File:** `supabase/config.toml`, line 175-178

**Evidence:**

```toml
minimum_password_length = 6
password_requirements = ""
```

The minimum password length is set to 6 characters with no complexity requirements. This is the Supabase default but is below modern security standards, especially for a business application handling construction estimates (potentially sensitive financial data).

NIST SP 800-63B recommends a minimum of 8 characters. For a business application, 8+ characters with `letters_digits` is a reasonable baseline.

**Recommended fix:**

```toml
minimum_password_length = 8
password_requirements = "letters_digits"
```

---

### Finding 11: Email confirmation disabled -- accounts cannot be verified

**Severity: MEDIUM**
**Checklist item:** #161 -- Data validation constraints (auth configuration)
**File:** `supabase/config.toml`, line 216

**Evidence:**

```toml
enable_confirmations = false
```

Email confirmation is disabled, meaning anyone can sign up with any email address (including addresses they do not own) and immediately access the application. For a construction estimating platform:

1. Users could sign up with fake/misspelled emails and lose access to their accounts.
2. There is no verification that the user owns the email, which is a prerequisite for any password reset flow.
3. A malicious user could sign up with someone else's email to block them from registering.

This is acceptable for local development but should not carry through to production. Since `config.toml` is often used as a template for production configuration, this should be documented or conditionally configured.

**Note:** This may be intentional for development speed during Phase 0. Flag for review before production deployment.

---

## Checklist Coverage Summary

| Item | Description | Status | Finding |
|------|------------|--------|---------|
| #156 | Schema-code mismatch | FLAGGED | Finding 5: No generated TypeScript types |
| #157 | Migration quality | FLAGGED | Finding 9: Missing idempotency guards |
| #158 | Row-Level Security (RLS) | FLAGGED | Finding 2: Overly permissive blanket policy |
| #159 | Index optimization | FLAGGED | Finding 6: Redundant index |
| #160 | Foreign key integrity | FLAGGED | Finding 8: No auto-creation of role rows |
| #161 | Data validation constraints | FLAGGED | Finding 10, 11: Weak passwords, no email confirm |
| #162 | N+1 query detection | PASS | No application queries against DB yet |
| #163 | Storage policies | N/A | No storage buckets configured |
| #164 | Realtime configuration | PASS | No realtime subscriptions configured |
| #165 | Edge function database access | N/A | No edge functions |
| #166 | Seed data & fixtures | N/A | No seed.sql exists (config references it but file not found) |
| #167 | Schema naming conventions | PASS | snake_case consistently used |
| #168 | Temporal data handling | FLAGGED | Finding 3: No updated_at trigger |
| #169 | Soft delete vs hard delete | N/A | No soft delete columns |
| #170 | Database functions & triggers | FLAGGED | Finding 1: Missing search_path; Finding 4: Missing schema grant; Finding 7: Hook not enabled |

---

## Priority Remediation Order

1. **Finding 1** (CRITICAL): Add `SECURITY DEFINER SET search_path = ''` to `custom_access_token_hook`. This is a security hardening requirement that Supabase documents as mandatory for hook functions.

2. **Finding 2** (CRITICAL): Fix or remove the blanket RLS policy. Currently leaks all user roles to any authenticated user and creates a latent privilege escalation vector.

3. **Finding 7** (HIGH): Enable the hook in `config.toml` for local dev parity with production.

4. **Finding 8** (HIGH): Add a `handle_new_user()` trigger to auto-create role rows on signup, eliminating phantom JWT roles.

5. **Finding 3** (HIGH): Add `updated_at` trigger before Phase 1A adds more tables.

6. **Finding 5** (HIGH): Generate TypeScript database types before Phase 1A schema work begins.

7. **Finding 4** (HIGH): Add explicit `GRANT USAGE ON SCHEMA public TO supabase_auth_admin`.

8. **Finding 6** (HIGH): Remove redundant index to set correct precedent for Phase 1A.

9. **Findings 9-11** (MEDIUM): Address idempotency, password policy, and email confirmation as part of Phase 1A hardening.

---

## Positive Observations

- **RLS is enabled** on the only table. This is the #1 missed item in Supabase applications (checklist #158 notes CVE-2025-48757 affecting 170+ apps).
- **TIMESTAMPTZ used correctly** (not TIMESTAMP WITHOUT TIME ZONE).
- **ON DELETE CASCADE** on the FK to `auth.users` is correct for user cleanup.
- **REVOKE pattern is present** -- the migration explicitly revokes from `authenticated`, `anon`, and `public`, then grants back only `SELECT` to `authenticated`. This is the correct layered approach.
- **Function body uses schema-qualified references** (`public.user_roles`, `public.app_role`), which would survive a search_path change if the function-level `SET search_path` is added.
- **The function uses `(event->>'user_id')::UUID`** with proper casting -- no SQL injection vector here since the input comes from Supabase's auth system as a typed JSONB parameter, not user-supplied strings.
