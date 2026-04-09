# Research: Clusters A, B, C — Auth, Data Integrity, Validation

**Date:** 2026-04-09
**Researcher:** Agent (auth-data-validation)
**Source:** consolidated-findings.md clusters A, B, C

---

## Cluster A: Authorization & RLS Bypass

### A1. SECURITY DEFINER RPC functions have no internal authorization checks (CF-01)

**Problem summary:** All five SECURITY DEFINER functions (`deep_copy_estimate`, `create_estimate_snapshot`, `restore_estimate_snapshot`, `create_estimate_from_snapshot`, `set_subtree_visibility`) are granted EXECUTE to the `authenticated` role but contain zero internal auth checks. Since SECURITY DEFINER runs as the function owner (postgres), all RLS is bypassed. Any authenticated user — including `pending` and `client` role users — can call these directly via Supabase JS SDK.

**Root cause:** The functions were written for functionality first. The GRANT statements give broad `authenticated` access without matching internal guards. The `is_staff()` helper exists (in `20260409000001_security_foundation.sql`) but is never called inside these functions.

**Recommended fix:** Add staff authorization as the first operation in every SECURITY DEFINER function body. Create a new migration file:

```sql
-- File: supabase/migrations/20260410000001_rpc_auth_guards.sql

-- Add auth guard to set_subtree_visibility
CREATE OR REPLACE FUNCTION public.set_subtree_visibility(
  p_node_id    UUID,
  p_visibility public.client_visibility
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_path  public.ltree;
  v_count INTEGER;
BEGIN
  -- ★ AUTH GUARD: staff only
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'Permission denied: staff role required';
  END IF;

  SELECT path INTO v_path
  FROM public.estimate_nodes
  WHERE id = p_node_id;

  IF v_path IS NULL THEN
    RAISE EXCEPTION 'Node not found or has no path: %', p_node_id;
  END IF;

  UPDATE public.estimate_nodes
  SET client_visibility = p_visibility,
      updated_at = now()
  WHERE path <@ v_path;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Same pattern for the other 4 functions:
-- deep_copy_estimate: add IF NOT public.is_staff() guard after DECLARE block
-- create_estimate_snapshot: add guard after BEGIN
-- restore_estimate_snapshot: add guard after BEGIN  
-- create_estimate_from_snapshot: add guard after BEGIN
```

The pattern is identical for all five: insert `IF NOT public.is_staff() THEN RAISE EXCEPTION 'Permission denied: staff role required'; END IF;` as the first executable statement after `BEGIN`.

**Effort estimate:** 1-2 hours. Straightforward SQL addition, but each function must be fully re-stated in a CREATE OR REPLACE migration. Test with `client` and `pending` role users to verify rejection.

**Dependencies:** None. `is_staff()` already exists and works correctly.

---

### A2. `deleteSnapshot` admin client bypasses all RLS with insufficient guards (CF-06, CF-04-CRIT)

**Problem summary:** The `deleteSnapshot` server action uses `createAdminClient()` (service_role) to bypass RLS AND the immutability trigger. However, migration 007 replaced the immutability trigger to be unconditionally blocking (no bypass variable). The service_role bypasses RLS but NOT PostgreSQL triggers. Result: the admin DELETE either (a) always fails silently, or (b) throws an unhandled exception from the trigger. Additionally, no role-based check prevents `client` users from reaching this code path — only ownership (`created_by === user.id`) is checked.

**Root cause:** Two competing designs: migration 006 added a bypass variable (`app.allow_snapshot_mutation`), migration 007 removed it to make immutability unconditional. The server action was written assuming the bypass still exists. The `createAdminClient()` call also throws if the service role key is missing (line 229), and no try-catch wraps it.

**Recommended fix:** Re-add a controlled bypass mechanism in the trigger, and add role + error handling in the action:

**Step 1: SQL — Restore controlled bypass in trigger (new migration):**

```sql
-- File: supabase/migrations/20260410000002_snapshot_delete_bypass.sql

CREATE OR REPLACE FUNCTION public.prevent_snapshot_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Allow controlled mutation bypass for milestone deletion by staff
  -- Only settable via SET LOCAL in a trusted server action context
  IF current_setting('app.allow_snapshot_delete', true) = 'true'
     AND TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Snapshots are immutable';
END;
$$;
```

**Step 2: Server action — Add role check, try-catch, and set bypass variable:**

```typescript
// src/lib/actions/snapshots.ts — deleteSnapshot (lines 197-241)

export async function deleteSnapshot(
  id: string,
): Promise<ActionResult<void>> {
  const { user, supabase } = await getAuthenticatedClient();

  if (!id) {
    return err(ERROR_CODE.VALIDATION_ERROR, "Snapshot ID is required.");
  }

  // ★ ROLE CHECK: only staff can delete snapshots
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("user_id", user.id)
    .single();

  if (!profile || !["owner", "employee"].includes(profile.role)) {
    return forbidden();
  }

  // Fetch snapshot to verify type and ownership
  const { data: snapshot, error: fetchError } = await supabase
    .from("estimate_snapshots")
    .select("id, snapshot_type, created_by")
    .eq("id", id)
    .single();

  if (fetchError) return handleSupabaseError(fetchError);

  if (snapshot.snapshot_type !== "milestone") {
    return err(
      ERROR_CODE.FORBIDDEN,
      "Only milestone snapshots can be deleted. Checkpoints are system-managed.",
    );
  }

  if (snapshot.created_by !== user.id) {
    return forbidden();
  }

  // Use admin client with try-catch
  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    console.error("Failed to create admin client:", e);
    return err(ERROR_CODE.SERVER_ERROR, "Service configuration error.");
  }

  // Set the bypass variable, then delete within same connection
  // Note: admin client runs with service_role, SET LOCAL scopes to transaction
  const { error: deleteError } = await admin.rpc("run_admin_snapshot_delete", {
    p_snapshot_id: id,
  });

  if (deleteError) {
    console.error("Admin delete snapshot error:", deleteError);
    return err(ERROR_CODE.SERVER_ERROR, "Failed to delete snapshot.");
  }

  return ok();
}
```

**Alternative (simpler):** Create a SECURITY DEFINER RPC for snapshot deletion that handles the bypass internally:

```sql
CREATE OR REPLACE FUNCTION public.delete_milestone_snapshot(
  p_snapshot_id UUID,
  p_deleted_by  UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'Permission denied: staff role required';
  END IF;

  -- Verify it's a milestone and ownership
  IF NOT EXISTS (
    SELECT 1 FROM public.estimate_snapshots
    WHERE id = p_snapshot_id
      AND snapshot_type = 'milestone'
      AND created_by = p_deleted_by
  ) THEN
    RAISE EXCEPTION 'Snapshot not found, not a milestone, or not owned by caller';
  END IF;

  -- Bypass immutability for this operation only
  SET LOCAL app.allow_snapshot_delete = 'true';

  DELETE FROM public.estimate_snapshots WHERE id = p_snapshot_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_milestone_snapshot(UUID, UUID) TO authenticated;
```

Then the server action becomes a simple RPC call with no admin client needed.

**Effort estimate:** 3-4 hours. Involves SQL migration + server action rewrite + testing the trigger bypass in both directions.

**Dependencies:** Must coordinate with the immutability trigger fix (CF-06-CRIT, CF-12).

---

### A3. Server actions perform NO role-based authorization (CF-10)

**Problem summary:** `getAuthenticatedClient()` calls `requireUser()` which only checks that a user is logged in, not their role. A `client` or `pending` user can call any server action. The only defense is RLS, which is already bypassable via SECURITY DEFINER functions (CF-01).

**Root cause:** `requireUser()` in `src/lib/auth/get-user.ts` (line 17-30) only checks `user !== null`. No role extraction or verification occurs. The `_shared.ts` file (line 6) has `"use server"` which also exposes `getAuthenticatedClient` itself as a callable server action.

**Recommended fix:** Add a `requireStaff()` function and use it in mutation actions:

```typescript
// src/lib/auth/get-user.ts — add after requireUser()

export async function requireStaff() {
  const user = await requireUser();

  // Extract role from app_metadata (set by auth hook)
  const role = user.app_metadata?.user_role as string | undefined;

  if (!role || !["owner", "employee"].includes(role)) {
    redirect("/pending-approval");
  }

  return user;
}
```

Then update `_shared.ts`:

```typescript
// src/lib/actions/_shared.ts — replace "use server" with server-only import

import "server-only"; // ★ FIX: prevents exposing utilities as callable actions

import { createClient } from "@/lib/supabase/server";
import { requireUser, requireStaff } from "@/lib/auth/get-user";
import { err } from "@/lib/types/action-result";
import { ERROR_CODE } from "@/lib/types/action-result";

import type { ActionResult } from "@/lib/types/action-result";

export async function getAuthenticatedClient() {
  const user = await requireUser();
  const supabase = await createClient();
  return { user, supabase };
}

/** For mutation actions that require staff access */
export async function getStaffClient() {
  const user = await requireStaff();
  const supabase = await createClient();
  return { user, supabase };
}
```

Then convert mutation actions (create, update, delete) to use `getStaffClient()` while read actions can remain with `getAuthenticatedClient()` (where RLS provides row-level filtering).

**Also fixes CF-22:** Replacing `"use server"` with `import "server-only"` prevents `getAuthenticatedClient` and `handleSupabaseError` from being exposed as callable server actions.

**Effort estimate:** 2-3 hours. Create the helper, audit all 28 server actions to determine which need staff vs authenticated, update imports.

**Dependencies:** Requires CF-01 (SQL guards) for defense-in-depth. Should be done together.

---

### A4. `_shared.ts` uses `"use server"` exposing utilities (CF-22)

**Problem summary:** The `"use server"` directive on line 6 of `_shared.ts` marks ALL exported functions as callable server actions from client code. `getAuthenticatedClient()` and `handleSupabaseError()` are internal utilities.

**Root cause:** Misunderstanding of Next.js `"use server"` semantics. It should only be on files that export actual server actions, not shared utility modules.

**Recommended fix:** Already covered in A3 above. Replace `"use server"` with `import "server-only"` in `_shared.ts`. The actual action files (`projects.ts`, `nodes.ts`, etc.) already have their own `"use server"` directives.

**Effort estimate:** 5 minutes. Single line change.

**Dependencies:** None. But verify that no client component imports from `_shared.ts` directly.

---

### A5. History `changed_by` always NULL (CF-17)

**Problem summary:** History triggers use `current_setting('app.current_user_id', true)` to capture who made changes. No server action or middleware ever sets this GUC. Every history record has `changed_by = NULL`.

**Root cause:** The GUC was designed to be set by the application layer but never implemented.

**Recommended fix:** Set the GUC in `getAuthenticatedClient()`:

```typescript
// src/lib/actions/_shared.ts — update getAuthenticatedClient

export async function getAuthenticatedClient() {
  const user = await requireUser();
  const supabase = await createClient();

  // Set user context for history triggers
  await supabase.rpc("set_config", {
    // Supabase doesn't expose raw SET, use this pattern instead:
  });

  return { user, supabase };
}
```

Since Supabase JS SDK doesn't directly expose `SET LOCAL`, the best approach is a small RPC:

```sql
-- File: supabase/migrations/20260410000003_set_user_context.sql

CREATE OR REPLACE FUNCTION public.set_user_context(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM set_config('app.current_user_id', p_user_id::text, true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_user_context(UUID) TO authenticated;
```

Then in the action:

```typescript
export async function getAuthenticatedClient() {
  const user = await requireUser();
  const supabase = await createClient();

  // Set user context for history triggers (fire-and-forget, non-blocking)
  await supabase.rpc("set_user_context", { p_user_id: user.id });

  return { user, supabase };
}
```

**Effort estimate:** 1-2 hours. SQL migration + shared utility update + verification that history rows populate correctly.

**Dependencies:** Relies on fix A3 (the `_shared.ts` refactor). Can be done in the same PR.

---

### A6. `handleSupabaseError` does not log known error codes (CF-20)

**Problem summary:** When error codes 23505, 23503, or PGRST116 occur, the function returns a user-friendly message but logs nothing server-side. Only the `else` branch logs. Constraint violations are invisible in logs.

**Root cause:** The early returns bypass the `console.error` at line 43.

**Recommended fix:**

```typescript
// src/lib/actions/_shared.ts — lines 29-45

export function handleSupabaseError(error: {
  message: string;
  code?: string;
}): ActionResult<never> {
  // ★ Always log the raw error for observability
  console.error("Supabase error:", { code: error.code, message: error.message });

  if (error.code === "23505") {
    return err(ERROR_CODE.CONFLICT, "A record with this value already exists.");
  }
  if (error.code === "23503") {
    return err(ERROR_CODE.NOT_FOUND, "Referenced record not found.");
  }
  if (error.code === "PGRST116") {
    return err(ERROR_CODE.NOT_FOUND, "Record not found.");
  }

  return err(ERROR_CODE.SERVER_ERROR, "An unexpected error occurred.");
}
```

**Effort estimate:** 10 minutes. Move the log statement to the top.

**Dependencies:** None.

---

### A7. `getAuthenticatedClient()` creates two Supabase clients (CF-21)

**Problem summary:** `requireUser()` internally creates Supabase client #1 (via `getUser()` at `get-user.ts:8-15`), then `getAuthenticatedClient()` creates client #2. Each `createClient()` reads the cookie store. Client #1 is discarded.

**Root cause:** `getUser()` is `cache()`-wrapped but `createClient()` is not. The cached `getUser` always creates its own client internally.

**Recommended fix:** Refactor to share the client:

```typescript
// src/lib/auth/get-user.ts

import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * Get the authenticated user and Supabase client in one call.
 * Cached per-request to avoid duplicate client creation.
 */
export const getAuthSession = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  return { supabase, user, error };
});

// Keep backward compat
export const getUser = cache(async () => {
  const { user, error } = await getAuthSession();
  return { user, error };
});

export async function requireUser() {
  const { user, error } = await getAuthSession();

  if (error) {
    console.error("Auth error:", error.message);
    redirect("/sign-in?error=service_unavailable");
  }

  if (!user) {
    redirect("/sign-in");
  }

  return user;
}
```

Then in `_shared.ts`:

```typescript
import { getAuthSession } from "@/lib/auth/get-user";

export async function getAuthenticatedClient() {
  const { supabase, user, error } = await getAuthSession();
  if (error || !user) {
    // requireUser handles redirect, but for type safety:
    const { redirect } = await import("next/navigation");
    redirect("/sign-in");
  }
  return { user, supabase };
}
```

**Effort estimate:** 1-2 hours. Careful refactor to ensure `cache()` scoping works correctly with the shared client. Must verify middleware doesn't break.

**Dependencies:** Should be coordinated with A3 (`_shared.ts` refactor).

---

## Cluster B: Data Integrity & Transaction Safety

### B1. `restoreSnapshot` validates `estimateVersion` but silently discards it (CF-02)

**Problem summary:** `restoreSnapshotSchema` requires `estimateVersion` (described as "required for optimistic locking"), validates it via Zod, then never passes it to the RPC call. The DB function `restore_estimate_snapshot()` has no version parameter. The error matching for "version" or "modified" at line 152 catches messages the SQL never raises. Optimistic locking is completely non-functional.

**Root cause:** The schema was designed with optimistic locking in mind, but the RPC function was implemented without a version parameter. The server action bridges the gap with dead code.

**Recommended fix — Option A (implement in SQL):**

Add a version check parameter to the RPC:

```sql
-- In the restore_estimate_snapshot function, add after status guards (step 3):

  -- ── 3b. Optimistic lock check ──────────────────────────────
  IF p_expected_version IS NOT NULL THEN
    DECLARE v_current_version INTEGER;
    BEGIN
      SELECT version INTO v_current_version
        FROM public.estimates
       WHERE id = v_estimate_id;

      IF v_current_version <> p_expected_version THEN
        RAISE EXCEPTION 'Estimate has been modified (expected version %, current version %). Refresh and try again.',
          p_expected_version, v_current_version;
      END IF;
    END;
  END IF;
```

Then update the function signature to add `p_expected_version INTEGER DEFAULT NULL` and update the server action to pass it:

```typescript
// src/lib/actions/snapshots.ts — restoreSnapshot (line 142-148)

const { data: checkpointId, error } = await supabase.rpc(
  "restore_estimate_snapshot",
  {
    p_snapshot_id: v.snapshotId,
    p_restored_by: user.id,
    p_expected_version: v.estimateVersion, // ★ Now actually passed
  },
);
```

**Recommended fix — Option B (implement in action, simpler):**

Check version before calling the RPC:

```typescript
// src/lib/actions/snapshots.ts — before the RPC call (after line 139)

// Optimistic lock check: verify estimate hasn't been modified
const { data: estimate, error: estError } = await supabase
  .from("estimates")
  .select("version")
  .eq("id", /* need estimate_id from snapshot */)
  .single();

if (estError) return handleSupabaseError(estError);
if (estimate.version !== v.estimateVersion) {
  return err(
    ERROR_CODE.OPTIMISTIC_LOCK_FAILED,
    "This estimate was modified since you last loaded it. Please refresh and try again.",
  );
}
```

Option A is preferred because it's atomic (the check and the restore happen in the same transaction, preventing TOCTOU race).

**Effort estimate:** 2-3 hours (Option A) or 1 hour (Option B). Option A requires full function replacement in a new migration.

**Dependencies:** None for Option B. Option A requires coordinating with the CF-03-CRIT EXCEPTION block fix (they both modify `restore_estimate_snapshot`).

---

### B2. `restore_estimate_snapshot()` missing EXCEPTION block (CF-03-CRIT)

**Problem summary:** `deep_copy_estimate()` and `create_estimate_from_snapshot()` both have `EXCEPTION WHEN OTHERS THEN RESET app.is_snapshot_copy; RAISE;` blocks. `restore_estimate_snapshot()` does not. If an error occurs during restore, `SET LOCAL app.is_snapshot_copy = 'true'` may leak if Supabase client libraries use savepoints.

**Root cause:** Inconsistency in implementation. The flag is reset on the happy path (line 1227: `RESET app.is_snapshot_copy;`) but not on error paths.

**Recommended fix:** Add the EXCEPTION block to `restore_estimate_snapshot()`. In the new migration that replaces this function, wrap the body:

```sql
-- At the end of restore_estimate_snapshot, before the final RETURN:
-- Replace lines 1226-1229:

  -- ── 21. Reset trigger bypass ─────────────────────────────────
  RESET app.is_snapshot_copy;

  RETURN v_checkpoint_id;

EXCEPTION
  WHEN OTHERS THEN
    RESET app.is_snapshot_copy;
    RAISE;
END;
$$;
```

**Effort estimate:** 30 minutes. Must be done as part of the full function replacement in a migration (combine with B1).

**Dependencies:** Should be done in the same migration as B1 (they both modify `restore_estimate_snapshot`).

---

### B3. Non-atomic two-step insert in `createNode`/`duplicateNode` (CF-04)

**Problem summary:** Both functions insert a base node then insert a detail row as separate queries. If the detail insert fails, manual cleanup deletes the base node — but cleanup result is never checked. If cleanup also fails, orphaned nodes persist with no detail row.

**Root cause:** Supabase JS SDK doesn't support multi-statement transactions. The manual cleanup pattern is a best-effort workaround.

**Recommended fix — Option A (RPC, most robust):**

Create a SECURITY DEFINER RPC for atomic node creation:

```sql
-- File: supabase/migrations/20260410000004_atomic_node_create.sql

CREATE OR REPLACE FUNCTION public.create_node_with_details(
  p_estimate_id      UUID,
  p_parent_id        UUID,
  p_name             TEXT,
  p_description      TEXT,
  p_node_type        public.node_type,
  p_sort_order       INTEGER,
  p_visibility       public.client_visibility,
  p_catalog_source_id UUID,
  p_created_by       UUID,
  p_item_details     JSONB DEFAULT NULL,
  p_assembly_details JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_node_id UUID;
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'Permission denied: staff role required';
  END IF;

  -- Insert base node
  INSERT INTO public.estimate_nodes (
    estimate_id, parent_id, name, description,
    node_type, sort_order, client_visibility,
    catalog_source_id, created_by
  ) VALUES (
    p_estimate_id, p_parent_id, p_name, p_description,
    p_node_type, p_sort_order, p_visibility,
    p_catalog_source_id, p_created_by
  )
  RETURNING id INTO v_node_id;

  -- Insert detail row (atomically, same transaction)
  IF p_node_type = 'item' AND p_item_details IS NOT NULL THEN
    INSERT INTO public.node_item_details (
      node_id, quantity, unit_id, unit_cost,
      labor_rate, labor_hours, labor_cost,
      material_cost, equipment_cost, subcontractor_cost,
      overhead_rate, markup_rate, tax_rate,
      is_allowance, allowance_budget, allowance_status,
      vendor_id, purchasing_notes, specifications
    ) VALUES (
      v_node_id,
      COALESCE((p_item_details->>'quantity')::decimal, 0),
      (p_item_details->>'unit_id')::uuid,
      COALESCE((p_item_details->>'unit_cost')::decimal, 0),
      (p_item_details->>'labor_rate')::decimal,
      (p_item_details->>'labor_hours')::decimal,
      (p_item_details->>'labor_cost')::decimal,
      (p_item_details->>'material_cost')::decimal,
      (p_item_details->>'equipment_cost')::decimal,
      (p_item_details->>'subcontractor_cost')::decimal,
      (p_item_details->>'overhead_rate')::decimal,
      (p_item_details->>'markup_rate')::decimal,
      (p_item_details->>'tax_rate')::decimal,
      COALESCE((p_item_details->>'is_allowance')::boolean, false),
      (p_item_details->>'allowance_budget')::decimal,
      p_item_details->>'allowance_status',
      (p_item_details->>'vendor_id')::uuid,
      p_item_details->>'purchasing_notes',
      p_item_details->>'specifications'
    );
  ELSIF p_node_type = 'assembly' AND p_assembly_details IS NOT NULL THEN
    INSERT INTO public.node_assembly_details (
      node_id, quantity, unit_id, assembly_unit_cost,
      ratio_base, specifications
    ) VALUES (
      v_node_id,
      (p_assembly_details->>'quantity')::decimal,
      (p_assembly_details->>'unit_id')::uuid,
      (p_assembly_details->>'assembly_unit_cost')::decimal,
      p_assembly_details->>'ratio_base',
      p_assembly_details->>'specifications'
    );
  END IF;

  RETURN v_node_id;
END;
$$;
```

**Recommended fix — Option B (check cleanup, minimal change):**

If RPC is too heavy, at minimum check cleanup results:

```typescript
// src/lib/actions/nodes.ts — lines 134-137, 154-157, 514-517, 533-536

if (detailError) {
  const { error: cleanupError } = await supabase
    .from("estimate_nodes")
    .delete()
    .eq("id", node.id);

  if (cleanupError) {
    console.error("ORPHANED NODE: Failed to clean up node after detail insert failure:", {
      nodeId: node.id,
      detailError,
      cleanupError,
    });
  }
  return handleSupabaseError(detailError);
}
```

**Effort estimate:** Option A: 4-6 hours (SQL + refactor action + tests). Option B: 30 minutes.

**Dependencies:** Option A should include the auth guard from A1. Option B has no dependencies.

---

### B4. `updateItemDetails`/`updateAssemblyDetails` silently succeed on zero-row updates (CF-05)

**Problem summary:** These functions use `.update().eq("node_id", nodeId)` without `.select().single()`. If no rows match (wrong node type or non-existent ID), the update is a silent no-op. The action returns the unchanged node from `getNode()`, making it appear the update succeeded.

**Root cause:** Missing row count verification after UPDATE. Compare with `updateNode` which correctly uses `.select().single()` (nodes.ts line 297-303).

**Recommended fix:**

```typescript
// src/lib/actions/nodes.ts — updateItemDetails (lines 349-356)

  const { data: updated, error } = await supabase
    .from("node_item_details")
    .update(updates)
    .eq("node_id", nodeId)
    .select()        // ★ Return the updated row
    .single();       // ★ Fail if no row matched

  if (error) {
    // PGRST116 = "not found" when .single() matches 0 rows
    if (error.code === "PGRST116") {
      return err(
        ERROR_CODE.NOT_FOUND,
        "No item details found for this node. Verify the node is an item type.",
      );
    }
    return handleSupabaseError(error);
  }

  return getNode(nodeId);
```

Same pattern for `updateAssemblyDetails` (lines 385-392).

**Effort estimate:** 30 minutes. Simple change to both functions.

**Dependencies:** None.

---

### B5. `restoreSnapshot` does not pass `p_force` parameter (CF-13)

**Problem summary:** The server action calls `restore_estimate_snapshot` with only `p_snapshot_id` and `p_restored_by`. The SQL function has `p_force BOOLEAN DEFAULT FALSE`. When the estimate status is `active`, the restore always fails with "Estimate is active. Pass p_force := true to confirm."

**Root cause:** The `restoreSnapshotSchema` doesn't include a `force` field, and the action doesn't pass it.

**Recommended fix:**

```typescript
// src/lib/validation/snapshots.ts — update restoreSnapshotSchema

export const restoreSnapshotSchema = z.object({
  snapshotId: uuidSchema,
  estimateVersion: z.number().int().min(1, "Estimate version is required for optimistic locking."),
  force: z.boolean().default(false), // ★ Add force parameter
});
```

```typescript
// src/lib/actions/snapshots.ts — restoreSnapshot (lines 142-148)

const { data: checkpointId, error } = await supabase.rpc(
  "restore_estimate_snapshot",
  {
    p_snapshot_id: v.snapshotId,
    p_restored_by: user.id,
    p_force: v.force,  // ★ Pass the force parameter
  },
);
```

**Effort estimate:** 15 minutes.

**Dependencies:** None, but should be combined with B1 (both modify `restoreSnapshot`).

---

### B6. `SnapshotData` TypeScript type misaligned with SQL JSONB structure (CF-15)

**Problem summary:** The TS `SnapshotData` interface (snapshots.ts:47-56) declares fields the SQL never produces and is missing 8 keys the SQL does produce. Specifically:

| TS declares (wrong) | SQL produces (correct) |
|---------------------|----------------------|
| `estimate_name` | (not serialized) |
| `estimate_status` | (not serialized) |
| `notes` | `node_notes` |
| `nodes[].item_details` (inline) | `item_details` (top-level array with `node_id` FK) |
| `nodes[].assembly_details` (inline) | `assembly_details` (top-level array with `node_id` FK) |
| (missing) | `serialized_at` |
| (missing) | `item_details` |
| (missing) | `assembly_details` |
| (missing) | `option_sets` |
| (missing) | `option_set_selections` |
| (missing) | `broad_options` |
| (missing) | `broad_option_overrides` |
| (missing) | `option_set_broad_selections` |

Also: `SnapshotOptionGroupRecord` has `anchor_node_id` (hallucinated) but is missing `group_type` and `sort_order` (CF-24).

**Root cause:** The TS types were written speculatively before the SQL was finalized.

**Recommended fix:** Rewrite the SnapshotData type to match the actual SQL serialization output (from `create_estimate_snapshot`, lines 767-782):

```typescript
// src/lib/types/domain/snapshots.ts — replace SnapshotData and sub-records

export interface SnapshotData {
  readonly schema_version: number;
  readonly serialized_at: string;
  readonly nodes: ReadonlyArray<SnapshotNodeRecord>;
  readonly item_details: ReadonlyArray<SnapshotItemDetailRecord>;
  readonly assembly_details: ReadonlyArray<SnapshotAssemblyDetailRecord>;
  readonly node_notes: ReadonlyArray<SnapshotNoteRecord>;
  readonly option_groups: ReadonlyArray<SnapshotOptionGroupRecord>;
  readonly option_alternatives: ReadonlyArray<SnapshotOptionAlternativeRecord>;
  readonly option_memberships: ReadonlyArray<SnapshotOptionMembershipRecord>;
  readonly option_sets: ReadonlyArray<SnapshotOptionSetRecord>;
  readonly option_set_selections: ReadonlyArray<SnapshotOptionSetSelectionRecord>;
  readonly broad_options: ReadonlyArray<SnapshotBroadOptionRecord>;
  readonly broad_option_overrides: ReadonlyArray<SnapshotBroadOptionOverrideRecord>;
  readonly option_set_broad_selections: ReadonlyArray<SnapshotOptionSetBroadSelectionRecord>;
}

// Nodes — flat records, NO inline details
export interface SnapshotNodeRecord {
  readonly id: string;
  readonly parent_id: string | null;
  readonly sort_order: number;
  readonly node_type: "group" | "assembly" | "item";
  readonly name: string;
  readonly description: string | null;
  readonly client_visibility: "visible" | "hidden" | "summary_only";
  readonly flagged: boolean;
  readonly was_auto_promoted: boolean;
  readonly catalog_source_id: string | null;
  readonly total_price: number | null;
  readonly created_by: string | null;
  readonly created_at: string;
}

// Item details — separate array with node_id FK
export interface SnapshotItemDetailRecord {
  readonly id: string;
  readonly node_id: string;
  readonly quantity: number;
  readonly unit_id: string | null;
  readonly unit_cost: number;
  readonly material_cost: number;
  readonly labor_cost: number;
  readonly labor_hours: number;
  readonly labor_rate: number;
  readonly equipment_cost: number;
  readonly subcontractor_cost: number;
  readonly markup_rate: number | null;
  readonly overhead_rate: number | null;
  readonly tax_rate: number | null;
  readonly is_allowance: boolean;
  readonly allowance_budget: number | null;
  readonly allowance_status: string | null;
  readonly specifications: string | null;
  readonly purchasing_notes: string | null;
  readonly vendor_id: string | null;
  readonly archived_at: string | null;
}

// Assembly details — separate array with node_id FK
export interface SnapshotAssemblyDetailRecord {
  readonly id: string;
  readonly node_id: string;
  readonly quantity: number | null;
  readonly unit_id: string | null;
  readonly assembly_unit_cost: number | null;
  readonly ratio_base: string | null;
  readonly specifications: string | null;
  readonly archived_at: string | null;
}

export interface SnapshotNoteRecord {
  readonly id: string;
  readonly node_id: string;
  readonly body: string;
  readonly format: string;
  readonly is_internal: boolean;
  readonly is_client_visible: boolean;
  readonly created_by: string | null;
  readonly created_at: string;
}

export interface SnapshotOptionGroupRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly group_type: string;
  readonly sort_order: number;
  readonly created_at: string;
}

export interface SnapshotOptionAlternativeRecord {
  readonly id: string;
  readonly group_id: string;
  readonly name: string;
  readonly description: string | null;
  readonly is_selected: boolean;
  readonly price_adjustment: number;
  readonly sort_order: number;
}

export interface SnapshotOptionMembershipRecord {
  readonly id: string;
  readonly node_id: string;
  readonly alternative_id: string;
}

export interface SnapshotOptionSetRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly created_by: string | null;
}

export interface SnapshotOptionSetSelectionRecord {
  readonly id: string;
  readonly option_set_id: string;
  readonly alternative_id: string;
}

export interface SnapshotBroadOptionRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly sort_order: number;
}

export interface SnapshotBroadOptionOverrideRecord {
  readonly id: string;
  readonly broad_option_id: string;
  readonly target_node_id: string;
  readonly override_type: string;
  readonly override_value: unknown; // JSONB
}

export interface SnapshotOptionSetBroadSelectionRecord {
  readonly option_set_id: string;
  readonly broad_option_id: string;
}
```

**Effort estimate:** 2-3 hours. Type rewrite + search for all consumers of the old type and update them.

**Dependencies:** None, but should add runtime validation for snapshot_data when deserializing (CF-56 — Cluster C overlap).

---

## Cluster C: Validation & Type Safety

### C1. `duplicateNode` imports `duplicateNodeSchema` but never uses it (CF-03)

**Problem summary:** The schema defines `sourceNodeId`, `includeChildren`, `includeDetails`, `includeNotes` fields. The action takes `(nodeId: string, includeNotes: boolean)` — a completely different interface. No UUID validation occurs.

**Root cause:** The schema was designed for a richer API that was never implemented. The action was written with a simpler signature.

**Recommended fix — Option A (use the schema):**

```typescript
// src/lib/actions/nodes.ts — replace duplicateNode signature (lines 452-455)

export async function duplicateNode(
  input: unknown,
): Promise<ActionResult<NodeWithDetails>> {
  const { user, supabase } = await getAuthenticatedClient();

  const parsed = duplicateNodeSchema.safeParse(input);
  if (!parsed.success) {
    return validationError(
      "Invalid duplicate data.",
      formatZodError(parsed.error),
    );
  }

  const v = parsed.data;
  const nodeId = v.sourceNodeId;
  const includeNotes = v.includeNotes;
  // v.includeChildren and v.includeDetails available for future use

  // ... rest of function unchanged
```

**Recommended fix — Option B (simplify schema to match action):**

If the richer API isn't needed yet, update the schema to match:

```typescript
// src/lib/validation/nodes.ts — replace duplicateNodeSchema (lines 177-183)

export const duplicateNodeSchema = z.object({
  nodeId: uuidSchema,
  includeNotes: z.boolean().default(true),
});
```

Then use it in the action:

```typescript
export async function duplicateNode(
  input: unknown,
): Promise<ActionResult<NodeWithDetails>> {
  const { user, supabase } = await getAuthenticatedClient();

  const parsed = duplicateNodeSchema.safeParse(input);
  if (!parsed.success) {
    return validationError("Invalid duplicate data.", formatZodError(parsed.error));
  }

  const { nodeId, includeNotes } = parsed.data;
  // ... rest unchanged, but now nodeId is UUID-validated
```

Option B is simpler and eliminates the dead schema fields. Option A preserves them for future use.

**Also:** Remove `duplicateNodeSchema` from the import at nodes.ts line 17 if choosing Option B (or actually use it if choosing Option A). Currently it's imported but unused.

**Effort estimate:** 30 minutes (Option B) to 1 hour (Option A).

**Dependencies:** None.

---

### C2. Inconsistent validation — 13-15 actions use manual `if (!id)` instead of Zod (CF-07)

**Problem summary:** 15 action functions accept string parameters (like `id`, `estimateId`, `nodeId`) and only check `if (!id)` — which accepts any non-empty string including `"hello"` or `"<script>"`. Zod schemas with UUID validation exist for many of these but are never imported or used.

**Affected functions (with existing unused schemas):**

| Action | File:Line | Existing Unused Schema |
|--------|-----------|----------------------|
| `getProject` | projects.ts:90 | `getProjectSchema` |
| `deleteProject` | projects.ts:160 | `deleteProjectSchema` |
| `getEstimate` | estimates.ts:176 | `getEstimateSchema` |
| `deleteEstimate` | estimates.ts:200 | `deleteEstimateSchema` |
| `getNodes` | nodes.ts:171 | (needs new schema or inline) |
| `getNode` | nodes.ts:215 | (needs new schema or inline) |
| `deleteNode` | nodes.ts:435 | `deleteNodeSchema` |
| `duplicateNode` | nodes.ts:458 | `duplicateNodeSchema` |
| `flagNode` | nodes.ts:572 | (needs inline) |
| `setNodeVisibility` | nodes.ts:595 | (needs inline) |
| `listSnapshots` | snapshots.ts:86 | `listSnapshotsSchema` |
| `getSnapshot` | snapshots.ts:109 | `getSnapshotSchema` |
| `createEstimateFromSnapshot` | snapshots.ts:173 | (needs new schema) |
| `deleteSnapshot` | snapshots.ts:202 | `deleteSnapshotSchema` |

**Root cause:** The simpler ID-only actions were written with manual checks for speed. The schemas were added later but never wired up.

**Recommended fix:** Standardize all actions to use Zod. For ID-only actions, inline validation is cleaner than importing a schema:

```typescript
// Pattern for simple ID validation (replaces if (!id) checks):

export async function deleteProject(id: string): Promise<ActionResult<void>> {
  const { supabase } = await getAuthenticatedClient();

  // ★ UUID validation instead of just truthiness check
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) {
    return validationError("Invalid project ID format.");
  }

  // ... rest unchanged, using parsed.data instead of id
```

Or for functions that already have schemas, use them:

```typescript
// Pattern for functions with existing schemas:

export async function deleteProject(id: string): Promise<ActionResult<void>> {
  const { supabase } = await getAuthenticatedClient();

  const parsed = deleteProjectSchema.safeParse({ id });
  if (!parsed.success) {
    return validationError("Invalid project ID.", formatZodError(parsed.error));
  }

  // Use parsed.data.id
```

**Effort estimate:** 2-3 hours. Mechanical change across 14-15 functions, but needs testing for each.

**Dependencies:** None. Can be done independently of other fixes.

---

### C3. Zod enum double-cast erases literal types (CF-54)

**Problem summary:** In `src/lib/validation/shared.ts`, enum schemas use `as unknown as [string, ...string[]]` casts which erase the literal type information. Downstream, this forces unsafe `as` casts at usage sites (e.g., `v.status as ProjectStatus`).

**Root cause:** `z.enum()` requires a `[string, ...string[]]` tuple. The `PROJECT_STATUS_VALUES` array is `readonly ProjectStatus[]` which doesn't match. The double cast works at runtime but loses compile-time type narrowing.

**Recommended fix:** Use a helper function that preserves literal types:

```typescript
// src/lib/validation/shared.ts — replace enum definitions

/**
 * Create a Zod enum schema from a readonly array of string literals.
 * Preserves literal types without the double-cast hack.
 */
function zodEnumFromValues<T extends string>(values: readonly T[]): z.ZodEnum<[T, ...T[]]> {
  if (values.length === 0) throw new Error("zodEnumFromValues requires at least one value");
  return z.enum(values as [T, ...T[]]);
}

export const projectStatusSchema = zodEnumFromValues(PROJECT_STATUS_VALUES);
export const estimateStatusSchema = zodEnumFromValues(ESTIMATE_STATUS_VALUES);
export const nodeTypeSchema = zodEnumFromValues(NODE_TYPE_VALUES);
export const clientVisibilitySchema = zodEnumFromValues(CLIENT_VISIBILITY_VALUES);
```

The key insight: `[T, ...T[]]` is valid when `T` is the literal union type, and `values as [T, ...T[]]` is a safe single cast (not a double cast through `unknown`) because the only difference is the tuple vs array shape — the element types are identical.

After this change, `z.infer<typeof projectStatusSchema>` will correctly produce `"lead" | "in_design" | ...` instead of `string`, and the `as ProjectStatus` casts in action files become unnecessary.

**Effort estimate:** 1 hour. Helper function + update 4 enum schemas + remove downstream `as` casts in action files.

**Dependencies:** None.

---

### C4. 5 of 9 SQL enum types missing from `enums.ts` (CF-26)

**Problem summary:** `enums.ts` header claims to be the "single source of truth for enum values" but is missing: `snapshot_type`, `option_group_type`, `approval_status`, `author_type`, and `app_role`. Some of these are defined inline in `shared.ts` (e.g., `snapshotTypeSchema = z.enum(["milestone", "checkpoint"])`) without using a centralized const.

**Root cause:** `enums.ts` was written with the initial 4 enums. Later enums were added to SQL but not propagated to the TS file.

**Recommended fix:** Add the missing enums to `enums.ts`:

```typescript
// src/lib/types/enums.ts — add after existing enums

// ── Snapshot Type ──────────────────────────────────────────

export const SNAPSHOT_TYPE = {
  MILESTONE: 'milestone',
  CHECKPOINT: 'checkpoint',
} as const;

export type SnapshotType = (typeof SNAPSHOT_TYPE)[keyof typeof SNAPSHOT_TYPE];

export const SNAPSHOT_TYPE_VALUES: readonly SnapshotType[] = [
  SNAPSHOT_TYPE.MILESTONE,
  SNAPSHOT_TYPE.CHECKPOINT,
] as const;

// ── Option Group Type ──────────────────────────────────────

export const OPTION_GROUP_TYPE = {
  SELECTION: 'selection',
  TOGGLE: 'toggle',
} as const;

export type OptionGroupType = (typeof OPTION_GROUP_TYPE)[keyof typeof OPTION_GROUP_TYPE];

export const OPTION_GROUP_TYPE_VALUES: readonly OptionGroupType[] = [
  OPTION_GROUP_TYPE.SELECTION,
  OPTION_GROUP_TYPE.TOGGLE,
] as const;

// ── Approval Status ────────────────────────────────────────

export const APPROVAL_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
} as const;

export type ApprovalStatus = (typeof APPROVAL_STATUS)[keyof typeof APPROVAL_STATUS];

export const APPROVAL_STATUS_VALUES: readonly ApprovalStatus[] = [
  APPROVAL_STATUS.PENDING,
  APPROVAL_STATUS.APPROVED,
  APPROVAL_STATUS.REJECTED,
] as const;

// ── Author Type ────────────────────────────────────────────

export const AUTHOR_TYPE = {
  STAFF: 'staff',
  CLIENT: 'client',
} as const;

export type AuthorType = (typeof AUTHOR_TYPE)[keyof typeof AUTHOR_TYPE];

export const AUTHOR_TYPE_VALUES: readonly AuthorType[] = [
  AUTHOR_TYPE.STAFF,
  AUTHOR_TYPE.CLIENT,
] as const;

// ── App Role ───────────────────────────────────────────────

export const APP_ROLE = {
  OWNER: 'owner',
  EMPLOYEE: 'employee',
  CLIENT: 'client',
  PENDING: 'pending',
} as const;

export type AppRole = (typeof APP_ROLE)[keyof typeof APP_ROLE];

export const APP_ROLE_VALUES: readonly AppRole[] = [
  APP_ROLE.OWNER,
  APP_ROLE.EMPLOYEE,
  APP_ROLE.CLIENT,
  APP_ROLE.PENDING,
] as const;
```

Then update `shared.ts` to derive from the centralized values:

```typescript
// src/lib/validation/shared.ts — replace inline definitions

import {
  PROJECT_STATUS_VALUES,
  ESTIMATE_STATUS_VALUES,
  NODE_TYPE_VALUES,
  CLIENT_VISIBILITY_VALUES,
  SNAPSHOT_TYPE_VALUES,
  OPTION_GROUP_TYPE_VALUES,
  APPROVAL_STATUS_VALUES,
  AUTHOR_TYPE_VALUES,
  APP_ROLE_VALUES,
} from "@/lib/types/enums";

// ... use zodEnumFromValues helper for all of them

export const snapshotTypeSchema = zodEnumFromValues(SNAPSHOT_TYPE_VALUES);
// Remove the inline z.enum(["milestone", "checkpoint"])
```

**Effort estimate:** 1-2 hours. Add to enums.ts, update shared.ts, verify no inline enum definitions remain in validation files.

**Dependencies:** Should be combined with C3 (Zod enum helper) for consistency.

---

### C5. `attachDetails` produces invalid discriminated union members (CF-25)

**Problem summary:** When a detail record is missing, `details` is set to `null` via `?? null`, then cast with `as NodeWithDetails`. The `ItemNode` interface declares `details: ItemDetails` (non-nullable). The cast silences TypeScript but `node.details.quantity` will crash at runtime.

**Root cause:** The `?? null` fallback combined with `as NodeWithDetails` bypasses the type system. The discriminated union requires `item` nodes to have non-null `ItemDetails`.

**Recommended fix:**

```typescript
// src/lib/actions/nodes.ts — attachDetails function (lines 39-68)

function attachDetails(
  nodes: EstimateNode[],
  itemDetails: NodeItemDetails[],
  assemblyDetails: NodeAssemblyDetails[],
): NodeWithDetails[] {
  const itemMap = new Map(itemDetails.map((d) => [d.node_id, d]));
  const assemblyMap = new Map(assemblyDetails.map((d) => [d.node_id, d]));

  return nodes.map((node): NodeWithDetails => {
    if (node.node_type === "item") {
      const details = itemMap.get(node.id);
      if (!details) {
        // ★ Data integrity issue: item node without details
        console.error(`Item node ${node.id} has no detail record — treating as group`);
        return { ...node, node_type: "group" as const, details: null };
      }
      return { ...node, node_type: "item" as const, details };
    }
    if (node.node_type === "assembly") {
      const details = assemblyMap.get(node.id);
      if (!details) {
        console.error(`Assembly node ${node.id} has no detail record — treating as group`);
        return { ...node, node_type: "group" as const, details: null };
      }
      return { ...node, node_type: "assembly" as const, details };
    }
    return { ...node, node_type: "group" as const, details: null };
  });
}
```

This handles missing details gracefully (logging and degrading to group) rather than producing an invalid discriminated union member that will crash downstream.

**Effort estimate:** 30 minutes. Self-contained change.

**Dependencies:** None.

---

### C6. `setNodeVisibility` accepts untyped `string` parameter (CF-27)

**Problem summary:** Unlike other actions that use Zod validation, `setNodeVisibility` accepts a raw `string` for `visibility` and does manual `includes` check with an unsafe `as ClientVisibility` cast.

**Root cause:** The function was written with a simpler manual pattern instead of using the existing `clientVisibilitySchema`.

**Recommended fix:**

```typescript
// src/lib/actions/nodes.ts — setNodeVisibility (lines 588-623)

export async function setNodeVisibility(
  input: unknown,
): Promise<ActionResult<NodeWithDetails>> {
  const { supabase } = await getAuthenticatedClient();

  // ★ Use Zod validation instead of manual checks
  const schema = z.object({
    id: uuidSchema,
    visibility: clientVisibilitySchema,
    applyToChildren: z.boolean().default(false),
  });

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return validationError("Invalid visibility data.", formatZodError(parsed.error));
  }

  const { id, visibility, applyToChildren } = parsed.data;

  if (applyToChildren) {
    const { error } = await supabase.rpc("set_subtree_visibility", {
      p_node_id: id,
      p_visibility: visibility,
    });
    if (error) return handleSupabaseError(error);
  } else {
    const { error } = await supabase
      .from("estimate_nodes")
      .update({ client_visibility: visibility })
      .eq("id", id);
    if (error) return handleSupabaseError(error);
  }

  return getNode(id);
}
```

This changes the function signature from `(id: string, visibility: string, applyToChildren: boolean)` to `(input: unknown)`, matching the pattern used by all other validated actions. Callers must update to pass an object.

**Effort estimate:** 30 minutes. Need to update any callers of this function.

**Dependencies:** C3 (Zod enum fix) for best type inference, but works without it.

---

### C7. Unused Zod imports and schemas (CF-08, CF-14, CF-18)

**Problem summary:** Multiple dead imports exist:
- `notFound` imported but unused in projects.ts, estimates.ts, nodes.ts (line 9)
- `costTypeSchema`, `qtyModeSchema`, `bidTypeSchema` imported but unused in nodes.ts validation (line 14-16)
- `createVersionSchema` and 20+ other schemas defined but never imported anywhere

**Root cause:** Over-eager upfront design creating schemas/types for features not yet implemented.

**Recommended fix:**

1. **Remove dead imports immediately** (they cost nothing to re-add later):

```typescript
// src/lib/actions/nodes.ts — line 9, remove notFound:
import { ok, err, validationError } from "@/lib/types/action-result";

// src/lib/validation/nodes.ts — lines 14-16, remove unused schema imports:
import {
  uuidSchema,
  nodeTypeSchema,
  clientVisibilitySchema,
  allowanceStatusSchema,
  sortOrderSchema,
  rateSchema,
} from "./shared";
// Removed: costTypeSchema, qtyModeSchema, bidTypeSchema
```

2. **Keep unused schemas/types that represent planned features** (like `createVersionSchema`, `convertNodeTypeSchema`, `reorderSiblingsSchema`) but add a `// TODO(future):` comment so they're discoverable.

3. **Delete unused schemas that duplicate existing functionality** (like `createItemNodeSchema`, `createAssemblyNodeSchema` which are convenience aliases for the discriminated union that no code uses).

**Effort estimate:** 30 minutes. Mechanical cleanup.

**Dependencies:** None.

---

## Summary: Priority-Ordered Fix Sequence

| Priority | Fix | Cluster | Effort | Impact |
|----------|-----|---------|--------|--------|
| 1 | A1: Auth guards in SECURITY DEFINER RPCs | A | 1-2h | CRITICAL security |
| 2 | A3+A4: `requireStaff()` + fix `_shared.ts` directive | A | 2-3h | CRITICAL defense-in-depth |
| 3 | B2: EXCEPTION block in `restore_estimate_snapshot` | B | 30min | CRITICAL data safety |
| 4 | A2: Fix `deleteSnapshot` trigger/admin conflict | A | 3-4h | CRITICAL functionality |
| 5 | B1+B5: Fix optimistic locking + pass `p_force` | B | 2-3h | CRITICAL data integrity |
| 6 | B6: Align `SnapshotData` type with SQL | B | 2-3h | HIGH correctness |
| 7 | C1: Wire up `duplicateNodeSchema` | C | 30min | HIGH validation |
| 8 | C2: Standardize all actions to Zod validation | C | 2-3h | HIGH security |
| 9 | B4: Fix silent zero-row updates | B | 30min | HIGH data integrity |
| 10 | C5: Fix `attachDetails` invalid union members | C | 30min | HIGH runtime safety |
| 11 | A6: Log all Supabase errors | A | 10min | MEDIUM observability |
| 12 | A5: Set `app.current_user_id` for history | A | 1-2h | MEDIUM audit trail |
| 13 | A7: Eliminate duplicate Supabase client | A | 1-2h | MEDIUM performance |
| 14 | C3+C4: Fix Zod enum types + add missing enums | C | 2-3h | MEDIUM type safety |
| 15 | C6: Validate `setNodeVisibility` with Zod | C | 30min | MEDIUM consistency |
| 16 | B3: Atomic node creation (Option B minimum) | B | 30min | MEDIUM integrity |
| 17 | C7: Clean up dead imports | C | 30min | LOW hygiene |

**Recommended grouping for PRs:**
- **PR 1 (Security):** A1 + A3 + A4 + A2 (all authorization fixes together)
- **PR 2 (Data Integrity):** B1 + B2 + B5 (all `restore_estimate_snapshot` fixes in one migration)
- **PR 3 (Validation):** C1 + C2 + C5 + C6 + C7 (all validation standardization)
- **PR 4 (Types):** B6 + C3 + C4 (all type alignment)
- **PR 5 (Observability):** A5 + A6 + A7 (logging, audit, performance)
- **PR 6 (Remaining):** B3 + B4 (data integrity edge cases)
