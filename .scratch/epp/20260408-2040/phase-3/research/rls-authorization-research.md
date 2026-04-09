# RLS and Authorization Architecture Research

## Problem Statement

No RLS policies exist on any application table. Every table created via migration is immediately exposed to the PostgREST `anon` key. The current auth infrastructure consists of a `user_roles` table with an `app_role` enum (owner/employee/client/pending), a custom access token hook injecting the role into JWT `app_metadata`, and a `handle_new_user()` trigger defaulting new users to `pending`. Phase 1A must establish a complete RLS policy matrix across all core tables, resolve the `user_roles` vs `user_profiles` consolidation, design a `get_user_role()` SECURITY DEFINER helper, handle share link bypass safely, enforce `summary_only` visibility, and secure the trigger bypass mechanism for snapshot copies.

## Recommended Solution

### 1. `get_user_role()` SECURITY DEFINER Helper

This function extracts the user's role from the JWT `app_metadata` claim injected by `custom_access_token_hook`. It never queries a table at RLS evaluation time (avoiding infinite recursion and performance overhead). Falls back to `'anon'` for unauthenticated requests and `'pending'` for authenticated users without a role claim.

```sql
-- ============================================================
-- get_user_role(): Extract role from JWT app_metadata
-- ============================================================
-- SECURITY DEFINER: runs as function owner (postgres), not caller
-- SET search_path = '': prevents search_path injection (CVE-2018-1058)
-- STABLE: does not modify database; safe for RLS evaluation
-- PARALLEL SAFE: can run in parallel query plans
--
-- Returns: 'owner' | 'employee' | 'client' | 'pending' | 'anon'
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'user_role'),
    CASE
      WHEN auth.uid() IS NOT NULL THEN 'pending'
      ELSE 'anon'
    END
  );
$$;

-- Grant to authenticated and anon (needed for RLS policy evaluation)
GRANT EXECUTE ON FUNCTION public.get_user_role() TO authenticated, anon;

-- Revoke from public to prevent non-API access
REVOKE EXECUTE ON FUNCTION public.get_user_role() FROM public;
```

**Why SQL instead of PL/pgSQL:** Pure SQL functions are inlined by the planner when used in RLS policies, avoiding per-row function call overhead. For a function this simple, SQL is 5-10x faster than PL/pgSQL in RLS contexts.

**Why no table lookup:** The role is already in the JWT (via `custom_access_token_hook`). Querying `user_roles`/`user_profiles` inside an RLS policy creates:
- Circular dependency risk (RLS on user_roles references get_user_role which queries user_roles)
- Performance overhead (one query per row evaluated)
- The JWT claim is refreshed on every token issue/refresh, so it is always current within the token lifetime

### 2. `user_roles` vs `user_profiles` Consolidation

**Recommendation: Merge `user_roles` into `user_profiles`.** The comprehensive analysis (Decision 4) recommends this, and no production data exists yet.

#### Migration Path

```sql
-- ============================================================
-- Step 1: Create user_profiles table (replaces user_roles)
-- ============================================================
CREATE TABLE public.user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'pending',
  display_name VARCHAR(255),
  email VARCHAR(255),
  -- PIN auth (deferred to Phase 1B, but schema ready)
  pin_hash VARCHAR(255),
  pin_failed_attempts INTEGER NOT NULL DEFAULT 0,
  pin_locked_until TIMESTAMPTZ,
  device_trust_token_hash VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_user_profile UNIQUE(user_id)
);

-- ============================================================
-- Step 2: Migrate data from user_roles to user_profiles
-- ============================================================
INSERT INTO public.user_profiles (user_id, role, created_at, updated_at)
SELECT user_id, role, created_at, updated_at
FROM public.user_roles
ON CONFLICT (user_id) DO NOTHING;

-- ============================================================
-- Step 3: Update handle_new_user() trigger to use user_profiles
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.user_profiles (user_id, role, display_name, email)
  VALUES (
    NEW.id,
    'pending',
    COALESCE(NEW.raw_user_meta_data ->> 'display_name', NEW.raw_user_meta_data ->> 'full_name'),
    NEW.email
  );
  RETURN NEW;
END;
$$;

-- ============================================================
-- Step 4: Update custom_access_token_hook to read from user_profiles
-- ============================================================
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

  SELECT up.role
  INTO user_role
  FROM public.user_profiles up
  WHERE up.user_id = (event->>'user_id')::UUID;

  IF user_role IS NOT NULL THEN
    claims := jsonb_set(claims, '{app_metadata,user_role}', to_jsonb(user_role::TEXT));
  ELSE
    claims := jsonb_set(claims, '{app_metadata,user_role}', '"pending"');
  END IF;

  RETURN jsonb_build_object('claims', claims);
END;
$$;

-- ============================================================
-- Step 5: RLS on user_profiles
-- ============================================================
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
CREATE POLICY "Users can read own profile"
  ON public.user_profiles FOR SELECT
  USING (user_id = (SELECT auth.uid()));

-- Owners can read all profiles (for user management)
CREATE POLICY "Owners can read all profiles"
  ON public.user_profiles FOR SELECT
  USING (public.get_user_role() = 'owner');

-- Owners can update any profile (role assignment, approval)
CREATE POLICY "Owners can update profiles"
  ON public.user_profiles FOR UPDATE
  USING (public.get_user_role() = 'owner');

-- Users can update their own non-role fields
CREATE POLICY "Users can update own profile"
  ON public.user_profiles FOR UPDATE
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (
    user_id = (SELECT auth.uid())
    -- Prevent self-role-escalation: role must stay the same
    -- This is enforced by a trigger, but defense-in-depth
  );

-- ============================================================
-- Step 6: Prevent self-role-escalation trigger
-- ============================================================
CREATE OR REPLACE FUNCTION public.prevent_role_self_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Only the owner role (checked via JWT) can change roles
  IF OLD.role IS DISTINCT FROM NEW.role THEN
    IF public.get_user_role() != 'owner' THEN
      RAISE EXCEPTION 'Only owners can change user roles';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER prevent_role_self_change
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_role_self_change();

-- ============================================================
-- Step 7: Drop old user_roles table (after verification)
-- ============================================================
-- Drop trigger first (it references auth.users, not user_roles)
-- The on_auth_user_created trigger already points at handle_new_user()
-- which we updated in Step 3 to use user_profiles.

-- Revoke grants on old table
REVOKE ALL ON TABLE public.user_roles FROM supabase_auth_admin, authenticated;

-- Drop the table
DROP TABLE public.user_roles;

-- ============================================================
-- Step 8: Grant permissions for new table
-- ============================================================
GRANT ALL ON TABLE public.user_profiles TO supabase_auth_admin;
GRANT SELECT ON TABLE public.user_profiles TO authenticated;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
```

**Why merge:** Eliminates a JOIN for profile lookups, prevents role existing in two places, and no production data exists yet. The migration is a clean rename-and-extend.

### 3. `client_project_access` Junction Table

Required for client RLS policies -- controls which projects a client user can see.

```sql
CREATE TABLE public.client_project_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  granted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_client_project UNIQUE(client_user_id, project_id)
);

CREATE INDEX idx_cpa_client ON public.client_project_access(client_user_id, project_id);

ALTER TABLE public.client_project_access ENABLE ROW LEVEL SECURITY;

-- Owners and employees can manage client access
CREATE POLICY "Staff can manage client access"
  ON public.client_project_access FOR ALL
  USING (public.get_user_role() IN ('owner', 'employee'));

-- Clients can see their own access records
CREATE POLICY "Clients can see own access"
  ON public.client_project_access FOR SELECT
  USING (client_user_id = (SELECT auth.uid()));
```

### 4. Complete RLS Policy Matrix

#### 4.1 Template Pattern (applied to every table)

Every table follows this template. The `_is_staff()` and `_client_has_project_access()` helpers reduce duplication.

```sql
-- ============================================================
-- Helper: Is the current user owner or employee?
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.get_user_role() IN ('owner', 'employee');
$$;

GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.is_staff() FROM public;

-- ============================================================
-- Helper: Does the current client user have access to a project?
-- ============================================================
CREATE OR REPLACE FUNCTION public.client_has_project_access(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.client_project_access
    WHERE client_user_id = (SELECT auth.uid())
      AND project_id = p_project_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.client_has_project_access(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.client_has_project_access(UUID) FROM anon, public;
```

#### 4.2 `projects` Table

```sql
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- Staff: full CRUD
CREATE POLICY "staff_all_projects"
  ON public.projects FOR ALL
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- Client: read-only on assigned projects
CREATE POLICY "client_read_projects"
  ON public.projects FOR SELECT
  USING (
    public.get_user_role() = 'client'
    AND public.client_has_project_access(id)
  );

-- Pending/anon: no access (implicit deny)
```

#### 4.3 `estimates` Table

```sql
ALTER TABLE public.estimates ENABLE ROW LEVEL SECURITY;

-- Staff: full CRUD
CREATE POLICY "staff_all_estimates"
  ON public.estimates FOR ALL
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- Client: read-only on estimates belonging to their projects
CREATE POLICY "client_read_estimates"
  ON public.estimates FOR SELECT
  USING (
    public.get_user_role() = 'client'
    AND public.client_has_project_access(project_id)
  );

-- Pending/anon: no access (implicit deny)
```

#### 4.4 `estimate_nodes` Table

```sql
ALTER TABLE public.estimate_nodes ENABLE ROW LEVEL SECURITY;

-- Staff: full CRUD
CREATE POLICY "staff_all_nodes"
  ON public.estimate_nodes FOR ALL
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- Client: read-only, filtered by client_visibility
CREATE POLICY "client_read_visible_nodes"
  ON public.estimate_nodes FOR SELECT
  USING (
    public.get_user_role() = 'client'
    AND client_visibility != 'hidden'
    AND EXISTS (
      SELECT 1 FROM public.estimates e
      WHERE e.id = estimate_id
        AND public.client_has_project_access(e.project_id)
    )
  );

-- Pending/anon: no access (implicit deny)
```

**Note on `summary_only`:** The RLS policy for `estimate_nodes` allows clients to SEE nodes with `summary_only` visibility. The field-level restriction (hiding cost breakdowns, detail fields) is handled separately -- see Section 5 below.

#### 4.5 `node_item_details` Table

```sql
ALTER TABLE public.node_item_details ENABLE ROW LEVEL SECURITY;

-- Staff: full CRUD
CREATE POLICY "staff_all_item_details"
  ON public.node_item_details FOR ALL
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- Client: read-only, ONLY for nodes where client_visibility = 'visible'
-- summary_only nodes do NOT expose item details (qty, unit_cost, etc.)
CREATE POLICY "client_read_visible_item_details"
  ON public.node_item_details FOR SELECT
  USING (
    public.get_user_role() = 'client'
    AND EXISTS (
      SELECT 1 FROM public.estimate_nodes en
      JOIN public.estimates e ON e.id = en.estimate_id
      WHERE en.id = node_id
        AND en.client_visibility = 'visible'
        AND public.client_has_project_access(e.project_id)
    )
  );

-- Pending/anon: no access (implicit deny)
```

#### 4.6 `node_assembly_details` Table

```sql
ALTER TABLE public.node_assembly_details ENABLE ROW LEVEL SECURITY;

-- Staff: full CRUD
CREATE POLICY "staff_all_assembly_details"
  ON public.node_assembly_details FOR ALL
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- Client: read-only, ONLY for nodes where client_visibility = 'visible'
CREATE POLICY "client_read_visible_assembly_details"
  ON public.node_assembly_details FOR SELECT
  USING (
    public.get_user_role() = 'client'
    AND EXISTS (
      SELECT 1 FROM public.estimate_nodes en
      JOIN public.estimates e ON e.id = en.estimate_id
      WHERE en.id = node_id
        AND en.client_visibility = 'visible'
        AND public.client_has_project_access(e.project_id)
    )
  );

-- Pending/anon: no access (implicit deny)
```

#### 4.7 `node_notes` Table

```sql
ALTER TABLE public.node_notes ENABLE ROW LEVEL SECURITY;

-- Staff: full CRUD (can see internal and client-visible notes)
CREATE POLICY "staff_all_notes"
  ON public.node_notes FOR ALL
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- Client: read-only, only client-visible notes on non-hidden nodes
CREATE POLICY "client_read_visible_notes"
  ON public.node_notes FOR SELECT
  USING (
    public.get_user_role() = 'client'
    AND is_client_visible = TRUE
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.estimate_nodes en
      JOIN public.estimates e ON e.id = en.estimate_id
      WHERE en.id = node_id
        AND en.client_visibility != 'hidden'
        AND public.client_has_project_access(e.project_id)
    )
  );

-- Pending/anon: no access (implicit deny)
```

#### 4.8 `estimate_snapshots` Table

```sql
ALTER TABLE public.estimate_snapshots ENABLE ROW LEVEL SECURITY;

-- Staff: SELECT and INSERT only (snapshots are immutable)
CREATE POLICY "staff_read_snapshots"
  ON public.estimate_snapshots FOR SELECT
  USING (public.is_staff());

CREATE POLICY "staff_create_snapshots"
  ON public.estimate_snapshots FOR INSERT
  WITH CHECK (public.is_staff());

-- No UPDATE or DELETE policies for anyone via RLS
-- Additional immutability enforcement via trigger (defense-in-depth)

-- Client: read-only on snapshots for their projects
CREATE POLICY "client_read_snapshots"
  ON public.estimate_snapshots FOR SELECT
  USING (
    public.get_user_role() = 'client'
    AND EXISTS (
      SELECT 1 FROM public.estimates e
      WHERE e.id = estimate_id
        AND public.client_has_project_access(e.project_id)
    )
  );

-- Pending/anon: no access (implicit deny)
```

**Immutability trigger (defense-in-depth):**

```sql
CREATE OR REPLACE FUNCTION public.prevent_snapshot_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Only allow deletion/update via service_role (bypasses RLS entirely)
  -- or via the restore function using SET LOCAL
  IF current_setting('app.allow_snapshot_mutation', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'Snapshots are immutable. Cannot % estimate_snapshots.',
    TG_OP;
END;
$$;

CREATE TRIGGER enforce_snapshot_immutability
  BEFORE UPDATE OR DELETE ON public.estimate_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_snapshot_mutation();
```

#### 4.9 `estimate_shares` Table

```sql
ALTER TABLE public.estimate_shares ENABLE ROW LEVEL SECURITY;

-- Staff: full CRUD (create, view, revoke share links)
CREATE POLICY "staff_all_shares"
  ON public.estimate_shares FOR ALL
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- No client access via RLS -- share link validation uses server-side
-- admin client, bypassing RLS entirely (see Section 6 below)

-- Pending/anon: no access (implicit deny)
```

### 5. `summary_only` Enforcement Strategy

**Recommendation: RLS on detail tables, NOT a PostgreSQL VIEW.**

The `summary_only` enforcement works at two levels:

1. **RLS level (database-enforced):** When `client_visibility = 'summary_only'` on an `estimate_nodes` row, the detail tables (`node_item_details`, `node_assembly_details`) are invisible to clients. The client RLS policies above already enforce this -- they require `client_visibility = 'visible'` (not just `!= 'hidden'`).

2. **Application level (TypeScript-enforced):** When loading nodes for client views, the application strips sensitive base-table fields from `summary_only` nodes before sending to the client. The fields a client sees per visibility state:

| Field on `estimate_nodes` | `visible` | `summary_only` | `hidden` |
|---------------------------|-----------|-----------------|----------|
| `name` | Yes | Yes | No (row filtered by RLS) |
| `description` | Yes | No | No |
| `total_price` | Yes | Yes | No |
| `subtotal` | Yes | No | No |
| `contingency_amount` | Yes | No | No |
| `overhead_amount` | Yes | No | No |
| `node_type` | Yes | Yes | No |
| `sort_order` | Yes | Yes | No |
| `parent_id` | Yes | Yes | No |
| `cost_code_id` | Yes | No | No |
| `phase_id` | Yes | No | No |
| Detail table (item/assembly) | Yes | **No (RLS blocks)** | No |

**Why not a VIEW:** A PostgreSQL VIEW for client access would:
- Duplicate column definitions (must enumerate every column)
- Require maintenance whenever `estimate_nodes` schema changes
- Not work well with Supabase's auto-generated TypeScript types
- Add complexity to the PostgREST routing

Instead, the RLS policy on the base table allows the row through (for `summary_only`), and a server action / API function strips the sensitive fields before returning to the client. This is a single TypeScript function:

```typescript
// File: src/lib/utils/client-visibility-filter.ts

import type { EstimateNode } from '@/types/database';

const SUMMARY_ONLY_ALLOWED_FIELDS = [
  'id', 'estimate_id', 'parent_id', 'sort_order',
  'node_type', 'name', 'total_price', 'client_visibility',
  'created_at', 'updated_at',
] as const;

type SummaryOnlyNode = Pick<EstimateNode, typeof SUMMARY_ONLY_ALLOWED_FIELDS[number]>;

export function filterForClientVisibility(
  nodes: EstimateNode[]
): (EstimateNode | SummaryOnlyNode)[] {
  return nodes
    .filter(node => node.client_visibility !== 'hidden')
    .map(node => {
      if (node.client_visibility === 'summary_only') {
        // Strip all fields except the allowed set
        const filtered: Record<string, unknown> = {};
        for (const field of SUMMARY_ONLY_ALLOWED_FIELDS) {
          filtered[field] = node[field];
        }
        return filtered as SummaryOnlyNode;
      }
      return node;
    });
}
```

**Defense-in-depth:** The RLS policy blocks detail table access at the database level. The TypeScript filter strips base table fields at the application level. Even if the TypeScript filter has a bug, the client cannot access `unit_cost`, `qty`, `waste_factor`, etc. because those live in `node_item_details` which is RLS-blocked for `summary_only` nodes.

### 6. Share Link Bypass Architecture

Share links allow unauthenticated access to estimates via a unique token + PIN. This MUST NOT go through RLS/PostgREST.

**Architecture:**

```
Client browser
  -> POST /api/share/validate { token, pin }
  -> Next.js API route (server-side)
    -> Creates Supabase admin client (bypasses RLS)
    -> Validates token, checks PIN hash, enforces rate limiting
    -> If valid: returns filtered estimate data (client_visibility applied)
    -> If invalid: returns 401/429
```

**Why server-side API route with admin client:**
- Share links are unauthenticated -- no JWT, no `auth.uid()`, no RLS context
- The `anon` key must NEVER be used to query `estimate_shares` (exposes all share tokens)
- Rate limiting happens at the API route level, not the database level
- The admin client bypasses RLS, queries the share record, validates the PIN, then fetches the estimate data with client visibility filtering applied in TypeScript

```typescript
// File: src/app/api/share/validate/route.ts

import { createClient } from '@supabase/supabase-js';
import { compare } from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes

export async function POST(request: NextRequest) {
  const { token, pin } = await request.json();

  if (!token || !pin || typeof pin !== 'string' || pin.length !== 6) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  // Admin client -- bypasses RLS
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Fetch share record
  const { data: share, error } = await supabase
    .from('estimate_shares')
    .select('*')
    .eq('share_token', token)
    .eq('is_revoked', false)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (error || !share) {
    return NextResponse.json({ error: 'Invalid or expired link' }, { status: 404 });
  }

  // Check lockout
  if (share.locked_until && new Date(share.locked_until) > new Date()) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
  }

  // Validate PIN
  const pinValid = await compare(pin, share.pin_hash);

  if (!pinValid) {
    const newAttempts = (share.failed_attempts || 0) + 1;
    const updates: Record<string, unknown> = { failed_attempts: newAttempts };

    if (newAttempts >= MAX_FAILED_ATTEMPTS) {
      updates.locked_until = new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString();
    }

    await supabase
      .from('estimate_shares')
      .update(updates)
      .eq('id', share.id);

    return NextResponse.json({ error: 'Invalid PIN' }, { status: 401 });
  }

  // Reset failed attempts on success
  await supabase
    .from('estimate_shares')
    .update({
      failed_attempts: 0,
      locked_until: null,
      last_accessed_at: new Date().toISOString(),
      access_count: (share.access_count || 0) + 1,
    })
    .eq('id', share.id);

  // Fetch estimate data with client visibility filtering
  // (uses admin client, applies filtering in TypeScript)
  const estimateData = await fetchEstimateForShare(supabase, share.estimate_id);

  return NextResponse.json({ data: estimateData });
}
```

**Security properties:**
- No RLS involved -- admin client bypasses entirely
- Token is `crypto.randomBytes(32).toString('hex')` (64 chars), not UUID
- PIN is bcrypt-hashed (cost 12)
- 5 failed attempts per share link triggers 30-minute lockout
- Global IP rate limiting via middleware (20 attempts/hour/IP across all share links)
- Share links have mandatory `expires_at` (no permanent links)
- `is_revoked` flag for immediate revocation

### 7. Trigger Bypass Mechanism for Snapshot Copies

The `deep_copy_estimate()` and `restore_estimate_snapshot()` functions need to bypass certain triggers during bulk operations (history logging, path maintenance, option inheritance). The mechanism uses PostgreSQL `SET LOCAL` within a transaction.

**Securing the bypass:**

```sql
-- ============================================================
-- Trigger bypass mechanism using SET LOCAL
-- ============================================================
-- SET LOCAL scopes the setting to the current transaction.
-- When the transaction ends (COMMIT or ROLLBACK), the setting
-- reverts to its default. This is inherently safe because:
--
-- 1. PostgREST wraps each API call in its own transaction
-- 2. SET LOCAL in one transaction cannot affect another
-- 3. The setting has no effect outside trigger functions
-- 4. Even if a malicious client calls SET LOCAL, it only
--    affects THEIR transaction (which has RLS applied)
-- ============================================================

-- The bypass flag (checked by triggers)
-- Default is empty string / NULL = triggers fire normally
-- 'true' = triggers skip their work

-- Example: history trigger with bypass check
CREATE OR REPLACE FUNCTION public.log_node_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Skip history logging during snapshot/copy operations
  IF current_setting('app.bypass_triggers', true) = 'true' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.estimate_nodes_history (
    original_node_id, estimate_id, node_type, name,
    changed_fields, changed_by, changed_at
  ) VALUES (
    OLD.id, OLD.estimate_id, OLD.node_type, OLD.name,
    jsonb_build_object(
      'old', to_jsonb(OLD),
      'new', to_jsonb(NEW)
    ),
    (SELECT auth.uid()),
    now()
  );

  RETURN NEW;
END;
$$;

-- Example: path maintenance trigger with bypass check
CREATE OR REPLACE FUNCTION public.maintain_node_path()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Skip path maintenance during copy (paths are set explicitly)
  IF current_setting('app.bypass_triggers', true) = 'true' THEN
    RETURN NEW;
  END IF;

  -- ... normal path maintenance logic ...
  RETURN NEW;
END;
$$;
```

**The copy function sets the bypass:**

```sql
CREATE OR REPLACE FUNCTION public.deep_copy_estimate(
  p_source_estimate_id UUID,
  p_created_by UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_new_estimate_id UUID;
BEGIN
  -- Bypass triggers for bulk copy
  PERFORM set_config('app.bypass_triggers', 'true', true);
  -- The 'true' third argument makes it transaction-local (SET LOCAL)

  -- ... copy logic (ID remapping via temp table) ...

  -- Re-enable triggers (automatic on transaction end, but explicit is clearer)
  PERFORM set_config('app.bypass_triggers', '', true);

  RETURN v_new_estimate_id;
END;
$$;
```

**Why this is safe:**

1. **Transaction isolation:** `set_config(..., true)` is equivalent to `SET LOCAL`. It is scoped to the current transaction. When the function returns and the transaction commits, the setting disappears.

2. **RLS still applies:** Even if a malicious client somehow calls `SET LOCAL app.bypass_triggers = 'true'` via PostgREST, RLS policies still evaluate normally. The bypass flag only affects trigger behavior (history logging, path updates), not row visibility. The client can at most suppress history logging in their own transaction -- which is a logging gap, not a data access gap.

3. **SECURITY DEFINER on the copy function:** The copy function itself runs as the function owner (postgres), bypassing RLS for the copy operation. But it can only be called by authorized users (controlled via GRANT).

4. **Additional safeguard -- restrict SET to trusted functions only:**

```sql
-- Revoke ability for authenticated users to call set_config directly
-- (PostgREST doesn't expose set_config, but defense-in-depth)
-- Note: This is already the default in Supabase -- users cannot
-- call set_config via PostgREST RPC unless explicitly granted.

-- Only grant execute on copy/restore functions to authenticated
GRANT EXECUTE ON FUNCTION public.deep_copy_estimate(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_estimate_snapshot(UUID, UUID) TO authenticated;

-- The functions themselves check role before proceeding
-- (owner/employee only, not client/pending)
```

### 8. Full RLS Policy Matrix Summary

| Table | Owner | Employee | Client | Pending | Anon |
|-------|-------|----------|--------|---------|------|
| `projects` | ALL | ALL | SELECT (assigned) | DENY | DENY |
| `estimates` | ALL | ALL | SELECT (via project) | DENY | DENY |
| `estimate_nodes` | ALL | ALL | SELECT (visible+summary_only, via project) | DENY | DENY |
| `node_item_details` | ALL | ALL | SELECT (visible only, via node+project) | DENY | DENY |
| `node_assembly_details` | ALL | ALL | SELECT (visible only, via node+project) | DENY | DENY |
| `node_notes` | ALL | ALL | SELECT (client_visible, non-deleted, via node+project) | DENY | DENY |
| `estimate_snapshots` | SELECT, INSERT | SELECT, INSERT | SELECT (via project) | DENY | DENY |
| `estimate_shares` | ALL | ALL | DENY | DENY | DENY |
| `estimate_comments` | ALL | ALL | SELECT, INSERT (via share or project) | DENY | DENY |
| `estimate_approvals` | ALL | ALL | SELECT, INSERT (via share or project) | DENY | DENY |
| `user_profiles` | ALL | SELECT (own) | SELECT (own) | SELECT (own) | DENY |
| `client_project_access` | ALL | ALL | SELECT (own) | DENY | DENY |
| `phases` | ALL | ALL | SELECT (via project) | DENY | DENY |
| `cost_codes` | ALL | ALL | SELECT | DENY | DENY |
| `units_of_measure` | ALL | ALL | SELECT | DENY | DENY |
| `company_settings` | ALL | SELECT | DENY | DENY | DENY |
| `user_preferences` | ALL (own) | ALL (own) | ALL (own) | DENY | DENY |
| `estimate_view_state` | ALL (own) | ALL (own) | DENY | DENY | DENY |
| `catalog_items` | ALL | ALL | DENY | DENY | DENY |
| `catalog_assemblies` | ALL | ALL | DENY | DENY | DENY |

**Key principles:**
- Owner and Employee have identical access (single-company model; employee restrictions are Phase 2+)
- Client access always flows through `client_project_access` junction
- `summary_only` nodes are visible at the base table level but detail tables are blocked
- `hidden` nodes are invisible entirely (filtered by RLS)
- Pending users have no access to any application data (only own profile)
- Anon has no access to anything (share links bypass RLS via admin client)
- Snapshot immutability enforced by RLS (no UPDATE/DELETE policies) + trigger

### File Paths

| File | Purpose |
|------|---------|
| `supabase/migrations/20260408000001_user_profiles.sql` | Consolidate user_roles into user_profiles, update hooks |
| `supabase/migrations/20260408000002_rls_helpers.sql` | `get_user_role()`, `is_staff()`, `client_has_project_access()` |
| `supabase/migrations/20260408000003_client_project_access.sql` | Junction table for client-project assignment |
| `supabase/migrations/20260408XXXXXX_rls_policies.sql` | RLS policies for all tables (runs after all CREATE TABLE migrations) |
| `src/lib/utils/client-visibility-filter.ts` | TypeScript `summary_only` field stripping |
| `src/app/api/share/validate/route.ts` | Share link validation API route |
| `src/types/roles.ts` | TypeScript role types and guards |

### TypeScript Types

```typescript
// File: src/types/roles.ts

export type AppRole = 'owner' | 'employee' | 'client' | 'pending';

export type StaffRole = Extract<AppRole, 'owner' | 'employee'>;

export type ClientVisibility = 'visible' | 'hidden' | 'summary_only';

export function isStaff(role: AppRole): role is StaffRole {
  return role === 'owner' || role === 'employee';
}

export function isAuthenticated(role: string | null | undefined): role is AppRole {
  return role === 'owner' || role === 'employee' || role === 'client' || role === 'pending';
}
```

## Trade-offs Considered

### 1. JWT-based role extraction vs table lookup in `get_user_role()`
- **Chosen:** JWT extraction (no table query)
- **Trade-off:** Role changes don't take effect until the JWT is refreshed (max 1 hour with default Supabase settings). Acceptable because role changes are rare (owner approves a pending user once) and the user can force-refresh by re-logging in.
- **Alternative:** Table lookup with `SECURITY DEFINER` to bypass RLS. Rejected because it adds a query per RLS evaluation and risks circular dependency.

### 2. RLS on detail tables vs PostgreSQL VIEW for `summary_only`
- **Chosen:** RLS blocking detail tables + TypeScript field stripping on base table
- **Trade-off:** Two layers of defense (database + application), slightly more complex. But the database layer is the one that matters -- application bugs cannot expose cost breakdowns.
- **Alternative:** A `client_estimate_nodes_view` that omits sensitive columns. Rejected because views add schema maintenance burden and don't integrate well with Supabase auto-generated types.

### 3. Merging `user_roles` into `user_profiles` vs keeping separate
- **Chosen:** Merge
- **Trade-off:** Requires updating `custom_access_token_hook` and `handle_new_user` in the same migration. But no production data exists, so the migration is clean.
- **Alternative:** Keep `user_roles` separate, add `user_profiles` alongside. Rejected because it creates a consistency risk (role in two places) and an unnecessary JOIN.

### 4. Share link via admin client vs custom RLS for anon
- **Chosen:** Server-side admin client, no RLS involvement
- **Trade-off:** Share link access is not auditable via Supabase's built-in RLS logs. Acceptable because we log access explicitly (last_accessed_at, access_count).
- **Alternative:** Create a special `share_session` role with custom RLS. Rejected because it requires a custom Supabase auth flow and complicates the RLS matrix significantly.

## Effort Estimate

| Task | Estimate |
|------|----------|
| `get_user_role()` + helper functions | 0.5 hours |
| `user_profiles` migration (consolidation) | 1 hour |
| `client_project_access` table + RLS | 0.5 hours |
| RLS policies for all Phase 1A tables | 2-3 hours |
| Snapshot immutability trigger | 0.5 hours |
| Trigger bypass mechanism | 0.5 hours |
| TypeScript role types + visibility filter | 1 hour |
| Share link API route | 1-2 hours |
| RLS test suite (10+ tests) | 2-3 hours |
| **Total** | **9-12 hours** |

## Dependencies

1. **`get_user_role()` must be created BEFORE any RLS policy** -- every policy references it
2. **`user_profiles` migration must run BEFORE `client_project_access`** -- the junction table references `auth.users`, not `user_profiles`, so no hard dependency, but the `client_has_project_access()` helper must exist before client RLS policies
3. **All `CREATE TABLE` migrations must run BEFORE the RLS policy migration** -- policies reference tables that must exist
4. **`custom_access_token_hook` update must coordinate with Supabase Dashboard** -- the hook must be re-registered after changing its source table from `user_roles` to `user_profiles`
5. **Share link API route depends on `estimate_shares` table existing** -- but the route is Phase 1B+; schema is Phase 1A

## Test Cases

### RLS Policy Tests (minimum 15)

| # | Test | Expected |
|---|------|----------|
| 1 | Owner can SELECT all projects | Pass |
| 2 | Owner can INSERT/UPDATE/DELETE projects | Pass |
| 3 | Employee can SELECT all projects | Pass |
| 4 | Employee can INSERT/UPDATE/DELETE projects | Pass |
| 5 | Client can SELECT only assigned projects | Pass (assigned), Fail (unassigned) |
| 6 | Client cannot INSERT/UPDATE/DELETE projects | Fail |
| 7 | Pending user cannot SELECT any projects | Fail |
| 8 | Anon cannot SELECT any projects | Fail |
| 9 | Client can SELECT visible nodes on assigned estimate | Pass |
| 10 | Client cannot SELECT hidden nodes | Fail (0 rows) |
| 11 | Client can SELECT summary_only nodes (base table) | Pass |
| 12 | Client cannot SELECT node_item_details for summary_only nodes | Fail (0 rows) |
| 13 | Client CAN SELECT node_item_details for visible nodes | Pass |
| 14 | Staff can INSERT snapshot, but not UPDATE/DELETE via RLS | Pass (INSERT), Fail (UPDATE/DELETE) |
| 15 | Client can SELECT client-visible notes but not internal notes | Pass (visible), Fail (internal) |
| 16 | User cannot change own role via user_profiles UPDATE | Trigger raises exception |
| 17 | Owner CAN change another user's role | Pass |
| 18 | Share link validation works with correct PIN | Pass (returns data) |
| 19 | Share link locks after 5 failed PIN attempts | Pass (returns 429) |
| 20 | Trigger bypass flag resets after transaction | `current_setting('app.bypass_triggers')` returns '' |

### Role Isolation Tests

| # | Test | Expected |
|---|------|----------|
| 21 | `get_user_role()` returns 'anon' for unauthenticated request | Pass |
| 22 | `get_user_role()` returns 'pending' for user without role claim | Pass |
| 23 | `get_user_role()` returns correct role from JWT | Pass |
| 24 | `is_staff()` returns TRUE for owner, TRUE for employee, FALSE for client | Pass |
| 25 | `client_has_project_access()` returns FALSE for unassigned project | Pass |
