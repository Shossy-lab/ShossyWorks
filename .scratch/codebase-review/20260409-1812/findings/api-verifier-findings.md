# API Verifier Findings (A7)

**Scope:** Server actions interface consistency, input validation patterns, Supabase RPC signature matching, env.ts schema vs pull-env.sh alignment.

**Files reviewed:**
- `src/lib/actions/_shared.ts`, `projects.ts`, `estimates.ts`, `snapshots.ts`, `nodes.ts`
- `src/lib/validation/shared.ts`, `projects.ts`, `estimates.ts`, `nodes.ts`, `snapshots.ts`, `format-error.ts`
- `src/lib/types/action-result.ts`, `enums.ts`, `domain/nodes.ts`
- `src/lib/supabase/server.ts`, `admin.ts`, `client.ts`, `middleware.ts`
- `src/lib/auth/get-user.ts`
- `src/env.ts`, `scripts/pull-env.sh`
- `supabase/migrations/20260409000011_functions.sql`

---

## Finding 1: restoreSnapshot validates estimateVersion but never uses it

**Severity: HIGH**

**File:** `src/lib/validation/snapshots.ts:24-25`, `src/lib/actions/snapshots.ts:131-148`

The `restoreSnapshotSchema` requires `estimateVersion` (an integer >= 1, described as "required for optimistic locking"):

```typescript
// src/lib/validation/snapshots.ts:23-25
export const restoreSnapshotSchema = z.object({
  snapshotId: uuidSchema,
  estimateVersion: z.number().int().min(1, "Estimate version is required for optimistic locking."),
});
```

But the `restoreSnapshot` action at `snapshots.ts:142-148` passes only `p_snapshot_id` and `p_restored_by` to the RPC. The validated `v.estimateVersion` is never referenced after parsing. The DB function `restore_estimate_snapshot` has no version parameter either (it takes `p_snapshot_id`, `p_restored_by`, `p_force`).

This means the caller must provide a valid version number that is validated then silently discarded. There is no actual optimistic locking on snapshot restore. Either the schema is lying about what it validates, or the implementation forgot to use the version.

**Impact:** Users believe optimistic locking protects restore operations, but it does not. Concurrent restores are only guarded by an advisory lock in the DB, not by version checking.

---

## Finding 2: duplicateNode imports duplicateNodeSchema but never uses it

**Severity: HIGH**

**File:** `src/lib/actions/nodes.ts:17` (import), `src/lib/actions/nodes.ts:452-460` (action)

The `duplicateNodeSchema` is imported at line 17 but never called. Instead, `duplicateNode` takes direct parameters `(nodeId: string, includeNotes: boolean)` and does a manual `if (!nodeId)` check:

```typescript
// nodes.ts:452-460
export async function duplicateNode(
  nodeId: string,
  includeNotes: boolean = true,
): Promise<ActionResult<NodeWithDetails>> {
  ...
  if (!nodeId) {
    return err(ERROR_CODE.VALIDATION_ERROR, "Node ID is required.");
  }
```

Meanwhile the schema validates UUID format, plus `includeChildren` and `includeDetails` fields:

```typescript
// validation/nodes.ts:177-183
export const duplicateNodeSchema = z.object({
  sourceNodeId: uuidSchema,
  includeChildren: z.boolean().default(true),
  includeNotes: z.boolean().default(true),
  includeDetails: z.boolean().default(true),
});
```

Two problems: (1) the action accepts any string as `nodeId` without UUID validation, and (2) the schema supports `includeChildren` and `includeDetails` options that the action ignores -- it always copies children and always copies details. The dead import is a dead code smell masking a real feature gap.

**Impact:** Malformed UUIDs pass validation and reach the database. Schema documents capabilities (selective duplication) that don't exist. Unused import wastes bundle space.

---

## Finding 3: Inconsistent input validation -- some actions use Zod, others use manual checks

**Severity: HIGH**

**File:** Multiple action files

Actions split into two patterns with no clear rule:

| Pattern | Actions | ID Validation |
|---------|---------|--------------|
| **Zod schema** | `createProject`, `updateProject`, `createEstimate`, `getEstimates`, `getEstimate`, `updateEstimate`, `createNode`, `updateNode`, `updateItemDetails`, `updateAssemblyDetails`, `moveNode`, `createSnapshot`, `restoreSnapshot` | UUID format validated |
| **Manual `if (!id)` only** | `getProject`, `deleteProject`, `deleteEstimate`, `deleteNode`, `getNodes`, `getNode`, `getSnapshot`, `listSnapshots`, `deleteSnapshot`, `duplicateEstimate`, `createEstimateFromSnapshot`, `duplicateNode`, `flagNode`, `setNodeVisibility` | Only falsy check -- empty string fails, but "not-a-uuid" passes |

This means 15 actions accept any non-empty string as a UUID and send it to Supabase, where it will fail with a cryptic PostgREST error rather than a clean validation error. Validation schemas exist for some of these (`deleteProjectSchema`, `getProjectSchema`, `deleteEstimateSchema`, `deleteNodeSchema`, `getSnapshotSchema`, `listSnapshotsSchema`, `deleteSnapshotSchema`) but are never imported or used in the action files.

**Evidence:** `src/lib/validation/projects.ts:62-67` defines `deleteProjectSchema` with UUID validation, but `src/lib/actions/projects.ts:155-162` uses `if (!id)` instead.

**Impact:** Inconsistent error messages for malformed input. Some callers get "Invalid ID format" (Zod), others get "Record not found" or raw PostgREST errors.

---

## Finding 4: env.ts has server vars that pull-env.sh does not provide

**Severity: MEDIUM**

**File:** `src/env.ts:14-15,27`, `scripts/pull-env.sh:30-42`

The `env.ts` schema defines two server variables not present in `pull-env.sh`:

| env.ts variable | In pull-env.sh? | Status |
|----------------|----------------|--------|
| `DIRECT_DATABASE_URL` | No | Optional in schema, never pulled |
| `CRON_SECRET` | No | Optional in schema, never pulled |

Both are `.optional()` so this won't break at startup, but it means:
- `DIRECT_DATABASE_URL` will always be `undefined` -- any code using it will silently fall back or fail
- `CRON_SECRET` will always be `undefined` -- any cron endpoint checking it will reject all requests

**Also:** `pull-env.sh` maps `supabase-direct-connection` to `DATABASE_URL`, but `env.ts` also has `DIRECT_DATABASE_URL`. These likely represent the same Supabase pooler vs direct connection concept but the naming is inconsistent.

**Impact:** Env configuration drift. If cron jobs or direct DB connections are added in Phase 1B, they will fail until pull-env.sh is updated.

---

## Finding 5: createNode uses non-atomic two-step insert without transaction

**Severity: HIGH**

**File:** `src/lib/actions/nodes.ts:88-162`

`createNode` inserts a base node, then inserts the detail row as a separate query. If the detail insert fails, the code manually deletes the base node:

```typescript
// nodes.ts:134-138
if (detailError) {
  // Clean up the base node if detail insert fails
  await supabase.from("estimate_nodes").delete().eq("id", node.id);
  return handleSupabaseError(detailError);
}
```

This is a manual compensating transaction. Problems:
1. If the cleanup `delete` also fails (network error, RLS denial, concurrent modification), the orphan node persists with no detail row.
2. Between insert and delete, other queries could observe the orphan node.
3. The `duplicateNode` function at lines 514-516 has the same pattern.
4. The cleanup `delete` result is not checked -- errors are silently swallowed.

The DB function `deep_copy_estimate` handles this correctly via a real transaction. The server actions do not use `supabase.rpc()` for transactional guarantees.

**Impact:** Under failure conditions, orphan `estimate_nodes` rows can exist without their required detail rows, violating the domain invariant that item nodes always have item details and assembly nodes always have assembly details.

---

## Finding 6: restoreSnapshot does not pass p_force parameter

**Severity: MEDIUM**

**File:** `src/lib/actions/snapshots.ts:142-148`, `supabase/migrations/20260409000011_functions.sql:825-891`

The DB function `restore_estimate_snapshot` has a `p_force BOOLEAN DEFAULT FALSE` parameter that controls whether active estimates can be restored. The action never passes it:

```typescript
const { data: checkpointId, error } = await supabase.rpc(
  "restore_estimate_snapshot",
  {
    p_snapshot_id: v.snapshotId,
    p_restored_by: user.id,
  },
);
```

The DB function at line 888 does:
```sql
IF v_estimate_status = 'active' AND NOT p_force THEN
  RAISE EXCEPTION 'Estimate is active. Pass p_force := true to confirm...';
END IF;
```

This means restoring a snapshot on an active estimate will always fail with an exception that the action catches as a generic error. There is no way for the caller to force the restore through the server action API.

**Impact:** Active estimates cannot have snapshots restored. Users see a generic error message instead of a clear prompt to force the operation.

---

## Finding 7: updateItemDetails and updateAssemblyDetails don't verify the update affected a row

**Severity: MEDIUM**

**File:** `src/lib/actions/nodes.ts:349-356`, `src/lib/actions/nodes.ts:385-392`

Both functions call `.update().eq("node_id", nodeId)` without `.select().single()`. If the `node_id` doesn't match any detail row (wrong node type, or orphan state), the update silently succeeds with zero rows affected. Then `getNode(nodeId)` is called, which may return a node with stale or missing details.

Compare with `updateNode` at line 297-302, which correctly uses `.select().single()` to verify the update returned a row.

```typescript
// nodes.ts:349-352 -- no row-count check
const { error } = await supabase
  .from("node_item_details")
  .update(updates)
  .eq("node_id", nodeId);
```

**Impact:** Calling `updateItemDetails` on an assembly node ID silently does nothing and returns the unchanged assembly node. No error is surfaced to the user.

---

## Finding 8: RPC calls match DB function signatures correctly

**Severity: N/A (Positive finding)**

All five RPC calls in the actions match their PostgreSQL function signatures:

| Action | RPC Name | Params Match? |
|--------|----------|--------------|
| `duplicateEstimate` | `deep_copy_estimate(p_source_estimate_id, p_new_name, p_created_by)` | Yes |
| `createSnapshot` | `create_estimate_snapshot(p_estimate_id, p_name, p_snapshot_type, p_created_by)` | Yes |
| `restoreSnapshot` | `restore_estimate_snapshot(p_snapshot_id, p_restored_by)` | Yes (p_force omitted, uses default) |
| `createEstimateFromSnapshot` | `create_estimate_from_snapshot(p_snapshot_id, p_new_name, p_created_by)` | Yes |
| `setNodeVisibility` | `set_subtree_visibility(p_node_id, p_visibility)` | Yes |

---

## Finding 9: Admin client used for snapshot deletion bypasses RLS and audit trail

**Severity: MEDIUM**

**File:** `src/lib/actions/snapshots.ts:229-233`

`deleteSnapshot` uses `createAdminClient()` (service role key) to bypass the immutability trigger. While the action performs ownership and type checks first, the admin client bypasses ALL RLS policies, not just the immutability trigger. This means:
- No RLS policy verifies the user owns the parent estimate
- The action's manual `snapshot.created_by !== user.id` check is the only authorization gate
- If the application-level check has a bug, the admin client provides no safety net

The ownership check also has a subtle issue: it verifies `created_by` on the snapshot, but in a multi-user scenario, other team members who have RLS access to the estimate should potentially be able to delete milestones they didn't create. The current logic is overly restrictive for teams but also bypasses RLS protections.

---

## Summary

| # | Severity | Finding |
|---|----------|---------|
| 1 | HIGH | `restoreSnapshot` validates `estimateVersion` then discards it -- no actual optimistic locking |
| 2 | HIGH | `duplicateNode` imports schema but never uses it; accepts any string as ID |
| 3 | HIGH | 15 actions use manual `if (!id)` instead of available Zod schemas -- inconsistent UUID validation |
| 4 | MEDIUM | `env.ts` defines `DIRECT_DATABASE_URL` and `CRON_SECRET` not in `pull-env.sh` |
| 5 | HIGH | `createNode` / `duplicateNode` non-atomic two-step insert with fragile manual cleanup |
| 6 | MEDIUM | `restoreSnapshot` never passes `p_force` -- active estimate restore always fails |
| 7 | MEDIUM | `updateItemDetails` / `updateAssemblyDetails` don't verify update affected any rows |
| 8 | N/A | RPC parameter names and types correctly match all 5 PostgreSQL function signatures |
| 9 | MEDIUM | `deleteSnapshot` admin client bypasses all RLS, relies solely on app-level auth check |
