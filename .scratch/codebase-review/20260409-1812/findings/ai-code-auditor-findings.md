# AI Code Auditor Findings

**Reviewer:** A13 - AI Code Auditor
**Scope:** Classic AI-generated code failure modes: hallucinated APIs, type mismatches, contradictory logic, dead code, copy-paste drift, Zod/DB schema disagreements
**Date:** 2026-04-09

---

## Finding 1: SnapshotData TypeScript type is completely misaligned with actual SQL JSONB structure

**Severity:** HIGH
**Files:**
- `src/lib/types/domain/snapshots.ts:47-56` (SnapshotData interface)
- `supabase/migrations/20260409000011_functions.sql:767-782` (actual JSONB assembly)

**Evidence:**

The SQL `create_estimate_snapshot()` function assembles snapshot_data with these top-level keys:
```
schema_version, serialized_at, nodes, item_details, assembly_details,
node_notes, option_groups, option_alternatives, option_memberships,
option_sets, option_set_selections, broad_options, broad_option_overrides,
option_set_broad_selections
```

The TypeScript `SnapshotData` interface declares:
```
schema_version, estimate_name, estimate_status, nodes, notes,
option_groups, option_alternatives, option_memberships
```

Specific mismatches:
1. **Hallucinated fields:** `estimate_name` and `estimate_status` exist in the TS type but are NEVER produced by the SQL function. Any code reading these fields from snapshot_data will get `undefined`.
2. **Wrong key name:** TS uses `notes` but SQL produces `node_notes`. Code that accesses `snapshot_data.notes` will miss all note data.
3. **8 missing keys:** `serialized_at`, `item_details`, `assembly_details`, `option_sets`, `option_set_selections`, `broad_options`, `broad_option_overrides`, `option_set_broad_selections` are produced by SQL but absent from the TS type.
4. The TS type has `nodes` typed as `SnapshotNodeRecord[]` which includes inline `item_details` and `assembly_details` per node, but the SQL serializes them as separate top-level arrays with `node_id` foreign keys -- a fundamentally different structure.

**Impact:** Any TypeScript code that reads snapshot_data using the `SnapshotData` type will operate on an incorrect shape. The type provides false confidence -- all accesses will succeed at compile time but fail at runtime. This is the classic AI hallucination pattern: generating a plausible-looking type that does not match the actual data producer.

---

## Finding 2: restoreSnapshot action validates and requires `estimateVersion` but never passes it to the RPC

**Severity:** HIGH
**Files:**
- `src/lib/validation/snapshots.ts:23-28` (restoreSnapshotSchema)
- `src/lib/actions/snapshots.ts:125-163` (restoreSnapshot action)
- `supabase/migrations/20260409000011_functions.sql:825-829` (restore_estimate_snapshot signature)

**Evidence:**

The Zod schema requires `estimateVersion`:
```typescript
// src/lib/validation/snapshots.ts:25
estimateVersion: z.number().int().min(1, "Estimate version is required for optimistic locking.")
```

The action validates the input against this schema (line 131), extracts `v = parsed.data`, but then calls the RPC with ONLY two parameters:
```typescript
// src/lib/actions/snapshots.ts:142-148
const { data: checkpointId, error } = await supabase.rpc(
  "restore_estimate_snapshot",
  {
    p_snapshot_id: v.snapshotId,
    p_restored_by: user.id,
  },
);
```

`v.estimateVersion` is never used. The SQL function `restore_estimate_snapshot(UUID, UUID, BOOLEAN)` has no version parameter at all.

Furthermore, at lines 152-157, the action checks for version-related error messages from the RPC:
```typescript
if (error.message?.includes("version") || error.message?.includes("modified")) {
```

But the SQL function NEVER raises errors containing "version" or "modified". It raises errors about status guards ("Cannot restore snapshot over a complete estimate", "Estimate is active. Pass p_force...") and schema version mismatches. This error matching logic is dead code -- it can never trigger.

**Impact:** The schema forces callers to provide an `estimateVersion` that is silently discarded, creating a false sense of optimistic locking protection for snapshot restores. Additionally, the `p_force` parameter that the SQL function uses for active estimate restores is never passed from the server action, meaning active estimates can NEVER be restored via the API (the RPC will always reject).

---

## Finding 3: SnapshotOptionGroupRecord type references non-existent `anchor_node_id` column

**Severity:** HIGH
**Files:**
- `src/lib/types/domain/snapshots.ts:113-118` (SnapshotOptionGroupRecord)
- `supabase/migrations/20260409000005_catalog_options_vendors.sql:143-152` (option_groups table)
- `supabase/migrations/20260409000011_functions.sql:655-667` (snapshot serialization)

**Evidence:**

The TS type declares:
```typescript
// src/lib/types/domain/snapshots.ts:115
export interface SnapshotOptionGroupRecord {
  readonly id: string;
  readonly anchor_node_id: string;   // <-- hallucinated field
  readonly name: string;
  readonly description: string | null;
}
```

The actual `option_groups` SQL table has columns: `id, estimate_id, name, description, group_type, sort_order, created_at, updated_at`. There is NO `anchor_node_id` column. The SQL snapshot serialization of option_groups (lines 655-667) also does not include any `anchor_node_id`.

Additionally, the TS type is missing `group_type` and `sort_order` which ARE serialized by the SQL function.

**Impact:** This is a hallucinated field -- the AI generated a plausible column name that does not exist anywhere in the database schema. Code that reads `record.anchor_node_id` will always get `undefined`.

---

## Finding 4: `duplicateNode` imports `duplicateNodeSchema` but never uses it

**Severity:** MEDIUM
**Files:**
- `src/lib/actions/nodes.ts:17` (import)
- `src/lib/actions/nodes.ts:452-562` (duplicateNode function)

**Evidence:**

Line 17 imports `duplicateNodeSchema`:
```typescript
import {
  ...
  duplicateNodeSchema,
} from "@/lib/validation/nodes";
```

But the `duplicateNode` function (lines 452-562) performs manual validation (`if (!nodeId)`) instead of using the imported schema. The function signature takes `(nodeId: string, includeNotes: boolean = true)` which does not match the schema's shape `{ sourceNodeId, includeChildren, includeDetails, includeNotes }`.

This is a copy-paste pattern where the schema was created but the action was written independently with a different interface. The `includeChildren` and `includeDetails` options from the schema are never implemented.

---

## Finding 5: Three Zod enum schemas imported into nodes.ts but never used

**Severity:** MEDIUM
**Files:**
- `src/lib/validation/nodes.ts:14-16` (imports)

**Evidence:**

```typescript
import {
  ...
  costTypeSchema,   // UNUSED
  qtyModeSchema,    // UNUSED
  bidTypeSchema,    // UNUSED
  ...
} from "./shared";
```

These three schemas are imported but never referenced anywhere in `nodes.ts`. They are also not exported or re-exported. These appear to be pre-generated for a future feature that was never implemented in Phase 1A.

Similarly, `noteFormatSchema` is defined in `shared.ts:75` but never imported or used anywhere in the codebase.

---

## Finding 6: `createVersionSchema` defined but has no corresponding server action

**Severity:** MEDIUM
**Files:**
- `src/lib/validation/estimates.ts:68-73` (schema definition)
- `src/lib/actions/estimates.ts` (no matching action)

**Evidence:**

The validation file defines:
```typescript
export const createVersionSchema = z.object({
  sourceEstimateId: uuidSchema,
  versionLabel: z.string().min(1, "Version label is required.").max(255),
});
```

But no server action uses this schema. There is no `createVersion` function in `estimates.ts`. The `deep_copy_estimate` RPC is invoked by `duplicateEstimate`, but that function takes `(id, newName)` and does not use `createVersionSchema`. The schema's `versionLabel` field has no path to the database.

---

## Finding 7: `deleteSnapshot` uses admin client to bypass immutability trigger but does NOT bypass RLS

**Severity:** MEDIUM
**Files:**
- `src/lib/actions/snapshots.ts:197-241` (deleteSnapshot)
- `supabase/migrations/20260409000007_triggers.sql:264-282` (immutability trigger)

**Evidence:**

The `deleteSnapshot` action correctly uses `createAdminClient()` to bypass the `trg_prevent_snapshot_mutation` trigger (which unconditionally raises an exception on UPDATE or DELETE). However, the admin client (service_role key) bypasses ALL RLS policies, not just the immutability trigger.

The action does verify `snapshot_type === "milestone"` and `created_by === user.id` before deletion (lines 216-226), but the first query that fetches the snapshot (lines 207-213) uses the regular user's Supabase client, which is subject to RLS. If RLS is misconfigured, this could leak snapshot existence information.

More critically, the admin client DELETE at line 230-233 has no `.eq("snapshot_type", "milestone")` guard -- it relies entirely on the application-level check at line 216. If the application check is bypassed (e.g., a race condition where the snapshot type changes between read and delete, though unlikely given immutability), the admin client would delete any snapshot type.

---

## Finding 8: `notFound` imported but never called in snapshots.ts

**Severity:** LOW
**Files:**
- `src/lib/actions/snapshots.ts:8` (import)

**Evidence:**

```typescript
import { ok, err, validationError, notFound, forbidden } from "@/lib/types/action-result";
```

`notFound` is imported but never called anywhere in the file. The action uses `handleSupabaseError` for PGRST116 (not found) instead.

---

## Finding 9: `allowance_status` is VARCHAR(50) in DB but treated as enum in Zod

**Severity:** LOW
**Files:**
- `supabase/migrations/20260409000003_reference_and_core_tables.sql:280` (VARCHAR(50) DEFAULT 'pending')
- `src/lib/validation/shared.ts:69-73` (allowanceStatusSchema as z.enum)
- `src/lib/types/supabase.ts:844` (typed as `string | null`)

**Evidence:**

The database column `node_item_details.allowance_status` is declared as `VARCHAR(50) DEFAULT 'pending'` -- it is a free-text string column with no database-level enum constraint.

The Zod schema restricts it to:
```typescript
export const allowanceStatusSchema = z.enum([
  "pending_selection",
  "selected",
  "finalized",
]);
```

Note the DB default is `'pending'` but the Zod enum uses `'pending_selection'` -- a value mismatch. Any row with the DB default `'pending'` would fail Zod validation. The generated Supabase types correctly type this as `string | null`, but the Zod schema adds constraints the database does not enforce.

**Impact:** If a row is inserted with the DB default and then read through a validation path, it will fail. The Zod enum values may not match what is actually in the database.

---

## Summary

| # | Finding | Severity | Category |
|---|---------|----------|----------|
| 1 | SnapshotData TS type fully misaligned with SQL JSONB | HIGH | Hallucinated types |
| 2 | restoreSnapshot validates but discards estimateVersion, dead error matching | HIGH | Dead code, false safety |
| 3 | SnapshotOptionGroupRecord has hallucinated anchor_node_id | HIGH | Hallucinated field |
| 4 | duplicateNodeSchema imported but never used, interface mismatch | MEDIUM | Dead import, drift |
| 5 | Three unused Zod enum imports in nodes.ts validation | MEDIUM | Dead imports |
| 6 | createVersionSchema defined but no server action exists | MEDIUM | Dead schema |
| 7 | deleteSnapshot admin client bypass broader than necessary | MEDIUM | Security pattern |
| 8 | notFound imported but unused in snapshots.ts | LOW | Dead import |
| 9 | allowance_status VARCHAR vs Zod enum with value mismatch | LOW | Schema disagreement |
