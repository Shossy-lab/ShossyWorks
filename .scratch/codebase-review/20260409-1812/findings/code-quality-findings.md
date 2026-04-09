# Code Quality Findings

**Analyst:** A4 (Code Quality)
**Scope:** `src/lib/actions/`, `src/lib/types/`, `src/lib/validation/`
**Date:** 2026-04-09

---

## CRITICAL

### CQ-01: `restoreSnapshot` validates `estimateVersion` but never passes it to the RPC

**File:** `src/lib/actions/snapshots.ts:125-163`
**File:** `src/lib/validation/snapshots.ts:23-28`

The `restoreSnapshotSchema` requires `estimateVersion` (a positive integer for optimistic locking), and the action validates it via `safeParse`. However, the validated value `v.estimateVersion` is **never passed to the RPC call**:

```typescript
// snapshots.ts:142-148
const { data: checkpointId, error } = await supabase.rpc(
  "restore_estimate_snapshot",
  {
    p_snapshot_id: v.snapshotId,
    p_restored_by: user.id,
    // v.estimateVersion is MISSING -- never sent to the RPC
  },
);
```

The action then tries to detect version mismatch by string-matching the error message (`error.message?.includes("version")`), but the RPC never receives the version to check against. This means the optimistic lock for snapshot restore is **completely non-functional**. A user can restore a snapshot over concurrent edits without any conflict detection.

**Severity:** CRITICAL -- silently bypasses the optimistic locking mechanism, risking data loss from concurrent overwrites.

---

## HIGH

### CQ-02: `createNode` is non-transactional -- orphaned rows or missing details on partial failure

**File:** `src/lib/actions/nodes.ts:72-162`

The `createNode` function performs a multi-step insert (base node + detail row) without a transaction. If the detail insert fails, it attempts to clean up the base node:

```typescript
// nodes.ts:134-138
if (detailError) {
  await supabase.from("estimate_nodes").delete().eq("id", node.id);
  return handleSupabaseError(detailError);
}
```

Problems:
1. The cleanup `delete()` call itself can fail silently -- its result is never checked.
2. If the server crashes between the base insert and the detail insert, the node exists without its required detail row.
3. The `duplicateNode` function (line 452-562) has the identical pattern, doubling the exposure.

This should use an RPC or a database transaction to make the multi-table insert atomic.

**Severity:** HIGH -- can produce orphaned nodes without detail rows, which will cause runtime errors in `getNode` when it tries to `.single()` on a missing detail row.

### CQ-03: `duplicateNode` does not use its imported `duplicateNodeSchema` for validation

**File:** `src/lib/actions/nodes.ts:17,452-562`

The `duplicateNodeSchema` is imported at line 17 but never called via `.safeParse()`. Instead, the function performs inline validation:

```typescript
// nodes.ts:458-459
if (!nodeId) {
  return err(ERROR_CODE.VALIDATION_ERROR, "Node ID is required.");
}
```

The schema defines `sourceNodeId`, `includeChildren`, `includeNotes`, and `includeDetails` fields, but the action function signature takes `(nodeId: string, includeNotes: boolean = true)` -- a completely different interface. The `includeChildren` and `includeDetails` options from the schema are ignored entirely. This is dead-imported code that indicates an incomplete implementation.

**Severity:** HIGH -- the function signature diverges from the validation schema, meaning the public API does not match the documented contract. The `includeChildren` capability is silently unavailable.

### CQ-04: `nodes.ts` at 623 lines exceeds the 300-line component limit by 2x

**File:** `src/lib/actions/nodes.ts` (623 lines)

Per the architecture rules, files should target <300 lines. `nodes.ts` is over twice that limit with 13 exported functions. The file contains distinct concerns that should be separated:
- CRUD operations (create, get, getNodes, update, delete) -- ~200 lines
- Detail update operations (updateItemDetails, updateAssemblyDetails) -- ~80 lines
- Tree operations (moveNode, duplicateNode) -- ~170 lines
- Visibility/flag operations (flagNode, setNodeVisibility) -- ~60 lines
- Helper function (attachDetails) -- ~30 lines

**Severity:** HIGH -- maintainability impact. Changes to one operation require reasoning about all 13, increasing risk of regressions.

### CQ-05: Unused imports across multiple action files

**File:** `src/lib/actions/projects.ts:9` -- `notFound` imported, never used
**File:** `src/lib/actions/nodes.ts:9` -- `notFound` imported, never used
**File:** `src/lib/actions/nodes.ts:17` -- `duplicateNodeSchema` imported, never used
**File:** `src/lib/actions/snapshots.ts:8` -- `notFound` imported, never used

Four instances of imported symbols that are never referenced in the function bodies. These are not just style issues -- unused imports from `"use server"` files increase the server action bundle and indicate copy-paste drift between action files.

**Severity:** HIGH -- indicates incomplete implementations (especially `duplicateNodeSchema`) and copy-paste patterns without cleanup.

---

## MEDIUM

### CQ-06: Inconsistent validation patterns -- some actions use Zod schemas, others use inline checks

**File:** `src/lib/actions/projects.ts:90-91` -- `getProject` uses inline `if (!id)` check
**File:** `src/lib/actions/projects.ts:160-161` -- `deleteProject` uses inline `if (!id)` check
**File:** `src/lib/actions/estimates.ts:176-178` -- `duplicateEstimate` uses inline checks
**File:** `src/lib/actions/snapshots.ts:86-88` -- `listSnapshots` uses inline check
**File:** `src/lib/actions/snapshots.ts:109-111` -- `getSnapshot` uses inline check
**File:** `src/lib/actions/snapshots.ts:173-176` -- `createEstimateFromSnapshot` uses inline checks
**File:** `src/lib/actions/nodes.ts:170-172` -- `getNodes` uses inline check
**File:** `src/lib/actions/nodes.ts:215-217` -- `getNode` uses inline check
**File:** `src/lib/actions/nodes.ts:435-437` -- `deleteNode` uses inline check
**File:** `src/lib/actions/nodes.ts:458-459` -- `duplicateNode` uses inline check
**File:** `src/lib/actions/nodes.ts:574-576` -- `flagNode` uses inline check
**File:** `src/lib/actions/nodes.ts:597-598` -- `setNodeVisibility` uses inline check

Corresponding Zod schemas (`deleteProjectSchema`, `getProjectSchema`, `deleteSnapshotSchema`, `getSnapshotSchema`, `listSnapshotsSchema`, `deleteNodeSchema`) exist in the validation files but are **never imported or used** by the action functions. The actions perform bare `if (!id)` checks instead, which miss UUID format validation that the schemas provide.

For example, `getProject("not-a-uuid")` passes the inline check but would fail the `getProjectSchema` validation. This means the API accepts malformed IDs and sends them to the database.

**Severity:** MEDIUM -- inconsistent boundary validation. The Zod schemas exist specifically for this purpose but are bypassed. Not critical because Supabase/Postgres will reject invalid UUIDs, but it wastes a database round-trip and returns a less helpful error message.

### CQ-07: Massive dead code in validation schemas -- 11 exported schemas/types never imported

**Files:** `src/lib/validation/projects.ts`, `src/lib/validation/estimates.ts`, `src/lib/validation/nodes.ts`, `src/lib/validation/snapshots.ts`, `src/lib/validation/shared.ts`

The following exported schemas and types are defined but never imported anywhere in the codebase:

From `projects.ts`: `deleteProjectSchema`, `DeleteProjectInput`, `getProjectSchema`, `GetProjectInput`
From `estimates.ts`: `createVersionSchema`, `CreateVersionInput`
From `nodes.ts`: `createItemNodeSchema`, `CreateItemNodeInput`, `createAssemblyNodeSchema`, `CreateAssemblyNodeInput`, `deleteNodeSchema`, `DeleteNodeInput`, `convertNodeTypeSchema`, `ConvertNodeTypeInput`, `reorderSiblingsSchema`, `ReorderSiblingsInput`
From `snapshots.ts`: `deleteSnapshotSchema`, `DeleteSnapshotInput`, `getSnapshotSchema`, `GetSnapshotInput`, `listSnapshotsSchema`, `ListSnapshotsInput`, `compareSnapshotsSchema`, `CompareSnapshotsInput`
From `shared.ts`: `paginationSchema`, `costTypeSchema`, `qtyModeSchema`, `bidTypeSchema`, `noteFormatSchema` (last 3 imported by nodes.ts but unused within it)

That is ~22 unused exports. Some are pre-built for future use, which is reasonable, but `costTypeSchema`, `qtyModeSchema`, and `bidTypeSchema` are imported into `nodes.ts` validation (line 14-16) and never referenced in any schema definition -- pure dead imports.

**Severity:** MEDIUM -- dead code increases maintenance burden and gives a false sense of validation coverage.

### CQ-08: Duplicated detail-insert logic between `createNode` and `duplicateNode`

**File:** `src/lib/actions/nodes.ts:108-158` (createNode detail inserts)
**File:** `src/lib/actions/nodes.ts:488-537` (duplicateNode detail inserts)

The item detail and assembly detail insert blocks are repeated almost identically in both functions. The only differences are the field name style (camelCase from validated input vs snake_case from the source row). Both functions also share the same cleanup pattern on failure. This is ~100 lines of duplicated logic that should be extracted into helper functions like `insertItemDetails(supabase, nodeId, details)`.

**Severity:** MEDIUM -- violation of DRY. If a new field is added to item_details, two code paths must be updated independently.

### CQ-09: `attachDetails` and `getNode` contain duplicated node-type dispatching logic

**File:** `src/lib/actions/nodes.ts:39-68` (attachDetails helper)
**File:** `src/lib/actions/nodes.ts:228-266` (getNode inline construction)

Both locations construct `NodeWithDetails` objects by checking `node_type` and attaching the appropriate detail record, using `as NodeWithDetails` type assertions. The `attachDetails` helper is only used by `getNodes` (list), while `getNode` (single) rebuilds the same logic inline. They should share a common construction path.

**Severity:** MEDIUM -- duplicated construction logic with type assertions. If the discriminated union changes, both paths must be updated.

### CQ-10: `snapshotType` and `allowanceStatus` enums defined inline in `shared.ts` rather than in `enums.ts`

**File:** `src/lib/validation/shared.ts:55-73`
**File:** `src/lib/types/enums.ts` (no `snapshotType` or `allowanceStatus` definitions)

The `enums.ts` file declares itself as "the ONLY place status values should be referenced in application code." However, `snapshot_type`, `cost_type`, `qty_mode`, `bid_type`, `allowance_status`, and `note_format` are all DB enums (confirmed in `supabase.ts` generated types) that are defined only as inline Zod schemas in `shared.ts`, bypassing the established enum pattern. This creates a split authority for enum values.

**Severity:** MEDIUM -- violates the single-source-of-truth principle stated in `enums.ts` header comment.

### CQ-11: Excessive type assertions (`as`) instead of proper type narrowing

**File:** `src/lib/actions/nodes.ts` -- 6 instances of `as NodeWithDetails`
**File:** `src/lib/actions/nodes.ts` -- 6 instances of `as NodeType` / `as ClientVisibility`
**File:** `src/lib/actions/projects.ts` -- 2 instances of `as ProjectStatus`
**File:** `src/lib/actions/estimates.ts` -- 2 instances of `as EstimateStatus`

The action files use `as` type assertions to coerce Zod-validated strings into DB enum types. While the runtime values are correct (Zod already validated them), the `as` casts suppress type checking. A safer approach would be to type the Zod schemas to infer the DB enum types directly, or use a validated cast helper that throws on mismatch.

The `as NodeWithDetails` assertions on object literals (nodes.ts:53,60,66,241,257,265) are more concerning -- they bypass the discriminated union's structural checks and could mask missing fields.

**Severity:** MEDIUM -- weakens type safety at the boundary between validation and database layers.

### CQ-12: Domain types `FrozenNode`, `TreeNode`, type guards, and ordinal helpers are defined but unused

**File:** `src/lib/types/domain/snapshots.ts:138-142` -- `FrozenNode` only defined here, never imported elsewhere
**File:** `src/lib/types/domain/nodes.ts:113-115` -- `TreeNode` only defined here, never imported elsewhere
**File:** `src/lib/types/domain/nodes.ts:119-135` -- `isGroupNode`, `isAssemblyNode`, `isItemNode`, `isClientVisible` only defined here, never used
**File:** `src/lib/types/enums.ts:153-170` -- `isProjectStatus`, `isEstimateStatus`, `isNodeType`, `isClientVisibility` only defined here, never used
**File:** `src/lib/types/enums.ts:178-187` -- `projectStatusOrdinal`, `estimateStatusOrdinal` only defined here, never used
**File:** `src/lib/types/enums.ts:54-65` -- `PROJECT_STATUS_DESCRIPTIONS` only used in enums.ts itself
**File:** `src/lib/types/enums.ts:95-100` -- `ESTIMATE_STATUS_DESCRIPTIONS` only used in enums.ts itself
**File:** `src/lib/types/domain/snapshots.ts:47-131` -- `SnapshotData`, all sub-record types never imported outside their definition file

This is substantial pre-built infrastructure for features that have not yet been implemented. While pre-planning types is a valid strategy, the volume (20+ unused exports across type files) blurs the line between preparation and dead code.

**Severity:** MEDIUM -- large surface area of untested, unused types that may drift from the actual implementation when those features arrive.

---

## LOW

### CQ-13: Inconsistent variable naming for validated data

Across all action files, the validated data from `safeParse` is consistently stored as `v` (e.g., `const v = parsed.data`). This is concise but loses semantic meaning -- `v` could mean anything. In longer functions like `createNode` (90+ lines after validation), readers must scroll back to understand what `v.estimateId` refers to. A name like `input` or `validated` would be clearer.

**Severity:** LOW -- style preference, but with 28 server actions all using `v`, it is a consistent pattern.

### CQ-14: Split imports from same module

**File:** `src/lib/actions/projects.ts:9-10` -- Two separate import statements from `@/lib/types/action-result`
**File:** `src/lib/actions/estimates.ts:9-10` -- Same pattern
**File:** `src/lib/actions/snapshots.ts:8-9` -- Same pattern
**File:** `src/lib/actions/nodes.ts:9-10` -- Same pattern
**File:** `src/lib/actions/_shared.ts:10-11` -- Same pattern

All 5 action files import named exports and then separately import `ERROR_CODE` from the same module:
```typescript
import { ok, err, validationError, notFound } from "@/lib/types/action-result";
import { ERROR_CODE } from "@/lib/types/action-result";
```

These should be consolidated into a single import statement.

**Severity:** LOW -- style issue, but repeated across every action file.

---

## Summary

| Severity | Count | Key Theme |
|----------|-------|-----------|
| CRITICAL | 1 | Optimistic lock data silently dropped (CQ-01) |
| HIGH | 4 | Non-transactional multi-table inserts, unused/mismatched validation schemas, oversized file, dead imports |
| MEDIUM | 7 | Inconsistent validation patterns, heavy dead code, duplicated logic, split enum authority, excessive type assertions |
| LOW | 2 | Naming, import style |

The most urgent fix is CQ-01 (the dropped `estimateVersion` in snapshot restore), which renders the optimistic lock for snapshot restore non-functional. CQ-02 (non-transactional node creation) and CQ-03 (diverged duplicate function) should follow. The MEDIUM findings indicate systematic patterns -- particularly the validation schema bypass (CQ-06) and large dead code surface (CQ-07, CQ-12) -- that should be addressed as cleanup tasks.
