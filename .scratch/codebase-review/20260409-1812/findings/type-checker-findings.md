# Type Checker Findings (A3)

**Reviewer:** Type Checker Agent
**Scope:** TypeScript type safety, discriminated unions, Database generic usage, enum alignment, ActionResult patterns
**Date:** 2026-04-09

---

## TSC Status

`npx tsc --noEmit` exits cleanly (exit code 0). Zero compiler errors.

---

## Finding 1: `attachDetails` silently produces invalid discriminated union members when detail rows are missing

**Severity:** HIGH
**Files:** `src/lib/actions/nodes.ts:47-67`

The `attachDetails` helper constructs `NodeWithDetails` objects by looking up detail records from maps. When a detail record is missing for an `item` or `assembly` node, it falls back to `null`:

```ts
// nodes.ts:48-53
if (node.node_type === "item") {
  return {
    ...node,
    node_type: "item" as const,
    details: itemMap.get(node.id) ?? null,  // <-- can be null
  } as NodeWithDetails;
}
```

The `ItemNode` interface in `domain/nodes.ts:103-105` declares `details: ItemDetails` (non-nullable). The `as NodeWithDetails` cast at line 53 silences the type system, but at runtime the `details` field can be `null` for an `item` node -- violating the discriminated union contract. Any downstream code that narrows on `node.node_type === "item"` and accesses `node.details.quantity` (for example) will crash with a `TypeError: Cannot read properties of null`.

This is a data-integrity concern: if the `node_item_details` row is missing (orphaned base node, failed cascade, or race condition during the two-step insert in `createNode`), the type system offers no protection.

**Recommendation:** Either (a) remove the `as NodeWithDetails` cast and let TypeScript enforce correctness (make `details` nullable in the union variant), or (b) filter out nodes whose detail lookup fails and log a warning, or (c) throw a structured error instead of returning silently invalid data.

---

## Finding 2: `setNodeVisibility` accepts untyped `string` parameter, validated at runtime only

**Severity:** HIGH
**Files:** `src/lib/actions/nodes.ts:588-623`

```ts
// nodes.ts:588-592
export async function setNodeVisibility(
  id: string,
  visibility: string,       // <-- untyped string
  applyToChildren: boolean = false,
): Promise<ActionResult<NodeWithDetails>> {
```

Unlike `createNode` and `updateNode` which pass through Zod validation first, `setNodeVisibility` accepts a raw `string` and does its own manual validation (line 599-601) with `includes(visibility as ClientVisibility)`. The `as ClientVisibility` cast is unsafe -- any string passes TypeScript's type checker, and the only guardrail is the runtime `includes` check. This is the only server action that bypasses Zod validation entirely for an enum-like parameter.

Similarly, `flagNode` (line 567-583) and `deleteNode` (line 430-448) accept raw `string` IDs without Zod validation (just an empty-string check). While `deleteNode` is less risky (UUID format would fail at Supabase anyway), the inconsistency means some actions are validated at the boundary and some are not.

**Recommendation:** Change the `visibility` parameter type to `ClientVisibility` (from domain types), or route through a Zod schema like the other actions. Apply the same pattern to `flagNode` and `deleteNode` for consistency.

---

## Finding 3: Five SQL enum types have no corresponding TypeScript enum definitions in `enums.ts`

**Severity:** HIGH
**Files:** `src/lib/types/enums.ts`, `supabase/migrations/20260409000002_enums_and_extensions.sql`

The SQL migrations define 9 enum types:
1. `project_status` -- in enums.ts
2. `estimate_status` -- in enums.ts
3. `node_type` -- in enums.ts
4. `client_visibility` -- in enums.ts
5. `snapshot_type` -- NOT in enums.ts (only in `domain/snapshots.ts` as a re-export)
6. `option_group_type` -- NOT in enums.ts
7. `approval_status` -- NOT in enums.ts
8. `author_type` -- NOT in enums.ts
9. `app_role` -- NOT in enums.ts (from separate migration)

The file header of `enums.ts` says: "These are the ONLY place status values should be referenced in application code." But 5 of 9 DB enums have no representation there. The `snapshot_type` is only accessible via `Database["public"]["Enums"]["snapshot_type"]` from the generated types or from `domain/snapshots.ts`. The Zod schema `snapshotTypeSchema` in `validation/shared.ts:55` uses hardcoded string literals `["milestone", "checkpoint"]` rather than referencing an enum const object, meaning changes to the DB enum would not propagate to validation.

**Recommendation:** Add `SNAPSHOT_TYPE`, `OPTION_GROUP_TYPE`, `APPROVAL_STATUS`, `AUTHOR_TYPE`, and `APP_ROLE` const objects to `enums.ts` with corresponding type exports, type guards, and values arrays. Update `snapshotTypeSchema` to reference the const values.

---

## Finding 4: Duplicate, potentially divergent enum type definitions across 3 layers

**Severity:** MEDIUM
**Files:**
- `src/lib/types/enums.ts:23,76,110,134` (derived from const objects)
- `src/lib/types/domain/nodes.ts:20-21` (re-exported from Database generic)
- `src/lib/types/domain/snapshots.ts:21-23` (re-exported from Database generic)
- `src/lib/actions/nodes.ts:29-30` (locally aliased from Database generic)
- `src/lib/actions/projects.ts:20` (locally aliased from Database generic)
- `src/lib/actions/estimates.ts:24` (locally aliased from Database generic)

The types `NodeType`, `ClientVisibility`, `EstimateStatus`, and `ProjectStatus` are each defined in 2-3 separate places:
- In `enums.ts` derived from hand-written const objects
- In `domain/*.ts` re-exported from `Database["public"]["Enums"]`
- In action files as local type aliases from `Database["public"]["Enums"]`

These currently resolve to the same underlying string union, but the hand-written const objects in `enums.ts` are NOT verified against the generated Supabase types at compile time. If a new enum value is added to the DB and `supabase gen types` is re-run, `supabase.ts` will update automatically but `enums.ts` requires a manual update. There is no compile-time check that catches the drift.

**Recommendation:** Either (a) derive the enums.ts const values FROM the generated Supabase types using a `satisfies` assertion (e.g., `PROJECT_STATUS_VALUES satisfies readonly Database["public"]["Enums"]["project_status"][]`), or (b) add a type-level assertion test that verifies equivalence. This would make enum drift a compile-time error rather than a silent runtime bug.

---

## Finding 5: Zod enum schemas lose type narrowing via `as unknown as [string, ...string[]]` casts

**Severity:** MEDIUM
**Files:** `src/lib/validation/shared.ts:38-51`

```ts
export const projectStatusSchema = z.enum(
  PROJECT_STATUS_VALUES as unknown as [string, ...string[]],
);
```

The `as unknown as [string, ...string[]]` double cast erases the literal string union types. After this cast, `z.infer<typeof projectStatusSchema>` resolves to `string`, not to `"lead" | "in_design" | ...`. This is why the action files need unsafe `as ProjectStatus` / `as EstimateStatus` casts (e.g., `projects.ts:47`, `estimates.ts:51`, `nodes.ts:96,98,293`) when passing validated data to Supabase insert/update calls.

If the Zod schemas preserved the literal types, these casts would be unnecessary and the type system would catch mismatches between validated input and DB column types.

**Recommendation:** Use a typed helper to create the Zod enum without the double cast:
```ts
function zodEnumFromValues<T extends string>(values: readonly T[]): z.ZodEnum<[T, ...T[]]> {
  return z.enum(values as [T, ...T[]]);
}
export const projectStatusSchema = zodEnumFromValues(PROJECT_STATUS_VALUES);
```

---

## Finding 6: `SnapshotData.estimate_status` typed as `string` instead of `EstimateStatus`

**Severity:** MEDIUM
**Files:** `src/lib/types/domain/snapshots.ts:50`

```ts
export interface SnapshotData {
  readonly schema_version: number;
  readonly estimate_name: string;
  readonly estimate_status: string;  // <-- should be EstimateStatus
  ...
}
```

The `estimate_status` field in `SnapshotData` is typed as plain `string` rather than the `EstimateStatus` enum type. The comment at line 60-61 says "Wider string types where noted for forward compatibility" which is a deliberate trade-off, but this design means code consuming `SnapshotData` cannot safely compare `snapshot.estimate_status === ESTIMATE_STATUS.DRAFT` without a type guard or cast. The `SnapshotNodeRecord.node_type` and `client_visibility` fields (lines 67-70) ARE properly narrowed to literal union types, so the `estimate_status` being `string` is inconsistent.

**Recommendation:** Use `EstimateStatus` type or, if forward-compat is needed, use `EstimateStatus | (string & {})` to preserve autocomplete while accepting unknown future values.

---

## Finding 7: `snapshot_data` column typed as `Json` in generated types -- no runtime validation on read

**Severity:** MEDIUM
**Files:** `src/lib/types/supabase.ts:652`, `src/lib/actions/snapshots.ts:68-76`, `src/lib/types/domain/snapshots.ts:27-41`

The `estimate_snapshots.snapshot_data` column is typed as `Json` in the generated Supabase types (a very broad type: `string | number | boolean | null | { [key: string]: Json | undefined } | Json[]`). The `EstimateSnapshot` interface in `domain/snapshots.ts:35` declares `snapshot_data: SnapshotData` (a narrow, structured type), but the `getSnapshot` action at `snapshots.ts:68-76` returns the raw DB row (`EstimateSnapshotRow`) directly:

```ts
const { data, error } = await supabase
  .from("estimate_snapshots")
  .select("*")
  .eq("id", id)
  .single();

if (error) return handleSupabaseError(error);
return ok(data);  // data.snapshot_data is Json, not SnapshotData
```

There is no runtime validation or parsing of the JSONB blob into `SnapshotData`. Any consumer that casts `data.snapshot_data` to `SnapshotData` is trusting the DB contents blindly. If a snapshot was created with an older `schema_version` or the JSONB was corrupted/migrated incorrectly, the type assertion would silently succeed while the data is actually malformed.

**Recommendation:** Add a Zod schema for `SnapshotData` and validate the JSONB blob on read, or at minimum add a `schema_version` check before casting.

---

## Finding 8: `noUncheckedIndexedAccess` is not enabled in `tsconfig.json`

**Severity:** MEDIUM
**Files:** `tsconfig.json`

While `strict: true` is enabled (good), `noUncheckedIndexedAccess` is not. This means array index access and `Record` property access do not include `undefined` in the type. For example, in `attachDetails` (nodes.ts:44-45):

```ts
const itemMap = new Map(itemDetails.map((d) => [d.node_id, d]));
// itemMap.get(node.id) correctly returns T | undefined (Map.get is always safe)
```

Maps are safe, but any direct array indexing (`arr[i]`) or `Record` lookups assume non-undefined values. This is especially relevant for the `PROJECT_STATUS_LABELS`, `ESTIMATE_STATUS_LABELS`, etc. (enums.ts) which are typed as `Record<ProjectStatus, string>` -- technically safe since the key is constrained, but the pattern could mask bugs in less constrained contexts.

**Recommendation:** Enable `noUncheckedIndexedAccess: true` in `tsconfig.json` for stricter null safety on index signatures.

---

## Finding 9: Unused Zod schema imports in nodes validation

**Severity:** LOW
**Files:** `src/lib/validation/nodes.ts:14-16`

```ts
import {
  ...
  costTypeSchema,
  qtyModeSchema,
  bidTypeSchema,
  ...
} from "./shared";
```

`costTypeSchema`, `qtyModeSchema`, and `bidTypeSchema` are imported but never used in any schema definition in `nodes.ts`. These appear to be forward-declared for future use but create dead imports. The corresponding schemas in `shared.ts` (`costTypeSchema`, `qtyModeSchema`, `bidTypeSchema`, `noteFormatSchema`) also have no DB enum counterparts -- they reference concepts that may not exist in the current schema.

**Recommendation:** Remove unused imports. If these are planned for future use, add a `// TODO(phase-X)` comment.

---

## Summary

| # | Severity | Finding |
|---|----------|---------|
| 1 | HIGH | `attachDetails` casts nullable details to non-nullable discriminated union via `as NodeWithDetails` |
| 2 | HIGH | `setNodeVisibility` accepts untyped `string` parameter, bypasses Zod validation |
| 3 | HIGH | 5 of 9 SQL enum types have no `enums.ts` representation |
| 4 | MEDIUM | Duplicate enum type definitions across 3 layers with no compile-time drift guard |
| 5 | MEDIUM | Zod enum double-cast erases literal types, forcing unsafe `as` casts in actions |
| 6 | MEDIUM | `SnapshotData.estimate_status` typed as `string` instead of enum type |
| 7 | MEDIUM | `snapshot_data` JSONB returned from DB without runtime validation |
| 8 | MEDIUM | `noUncheckedIndexedAccess` not enabled |
| 9 | LOW | Unused Zod schema imports in nodes validation |
