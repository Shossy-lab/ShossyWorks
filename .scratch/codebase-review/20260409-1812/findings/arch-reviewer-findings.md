# Architecture Review Findings

**Reviewer:** A6 - Architecture Reviewer
**Date:** 2026-04-09
**Scope:** Server/client boundaries, data flow, file organization, import hygiene, middleware design, route structure

---

## FINDING A6-01: `duplicateNode` bypasses its own validation schema

**Severity:** HIGH
**Files:** `src/lib/actions/nodes.ts:17, 452-562`

The `duplicateNodeSchema` is imported at line 17 but never used inside the `duplicateNode` function (lines 452-562). The action accepts raw `nodeId: string` and `includeNotes: boolean` parameters without any Zod validation. Every other mutation in this file validates input through a schema first. This is inconsistent and means the `duplicateNode` action:

1. Does not validate that `nodeId` is a valid UUID format (only checks emptiness at line 458).
2. The `duplicateNodeSchema` defines `sourceNodeId`, `includeChildren`, `includeDetails` fields that have no corresponding usage in the action function, which accepts `nodeId` and `includeNotes` -- a naming/signature mismatch.
3. The `includeChildren` functionality from the schema is never implemented -- `duplicateNode` only copies the single node, not its subtree.

This is dead code masking a gap between intended and actual behavior.

---

## FINDING A6-02: `restoreSnapshot` validates `estimateVersion` but never passes it to the RPC

**Severity:** HIGH
**Files:** `src/lib/validation/snapshots.ts:23-26`, `src/lib/actions/snapshots.ts:125-163`

The `restoreSnapshotSchema` requires `estimateVersion` (line 25: `z.number().int().min(1, "Estimate version is required for optimistic locking.")`), but the `restoreSnapshot` action at line 142-148 only passes `p_snapshot_id` and `p_restored_by` to the RPC. The validated `v.estimateVersion` is discarded. This means:

- The schema enforces optimistic locking semantics that the action silently ignores.
- Concurrent restore operations are not protected by the application-level version check, despite the schema advertising that they are.
- The RPC may or may not enforce its own version check (the action has a best-effort error message match at line 152), but the application layer is not doing its part.

---

## FINDING A6-03: Auth pages are entire-page client components, violating server/client boundary rules

**Severity:** HIGH
**Files:** `src/app/(auth)/sign-in/page.tsx:1`, `src/app/(auth)/sign-up/page.tsx:1`, `src/app/pending-approval/page.tsx:1`

The architecture rule states: "Push interactive boundaries down to the smallest leaf component. Never wrap an entire page in client-side rendering when only a button needs interactivity."

All three auth pages are marked `"use client"` at line 1, making the entire page tree a client component. The correct pattern is:

- The page file remains a server component (default).
- The interactive form is extracted to a separate client component file (e.g., `sign-in-form.tsx`).
- The page imports and renders the form as a child.

`sign-in/page.tsx` partially acknowledges this by having a `SignInForm` function, but it is defined in the same file as the page and the entire file is marked `"use client"`. This means the page loses server-rendering benefits (metadata, streaming, reduced JS bundle) for content that could be statically rendered (layout, headings, links).

---

## FINDING A6-04: `_shared.ts` uses `"use server"` directive, making utility functions callable as server actions

**Severity:** HIGH
**Files:** `src/lib/actions/_shared.ts:6`

The `_shared.ts` file has `"use server"` at line 6. In Next.js, this directive marks ALL exported functions as server actions callable from client code. `getAuthenticatedClient()` and `handleSupabaseError()` are utility functions meant only for internal server-side use by other action files. They should NOT be exposed as callable server actions.

- `getAuthenticatedClient()` returns a raw Supabase client handle. If called directly from client code, it would return an authenticated client that could be used to make arbitrary Supabase queries (though it would fail since the return type cannot be serialized -- but the intent is wrong).
- `handleSupabaseError()` is a pure utility function that has no reason to be a server action.

The fix is to remove `"use server"` from `_shared.ts` and instead add `import "server-only"` to prevent client-side import. The `"use server"` directive should only be on files that export actual server actions called from client components.

---

## FINDING A6-05: Server actions centralized in `lib/actions/` but architecture rule says "co-locate with routes"

**Severity:** MEDIUM
**Files:** `src/lib/actions/projects.ts`, `src/lib/actions/estimates.ts`, `src/lib/actions/nodes.ts`, `src/lib/actions/snapshots.ts`

The architecture rule states: "Co-locate mutation handlers with their routes/pages when route-specific. Share in a library directory when used across features."

Currently, ALL server actions live in `src/lib/actions/`. None of these are imported by any page component (`src/app/` has zero imports from `lib/actions/`). The actions are pre-built for future UI but currently orphaned. This is acceptable during Phase 1A buildout, but the pattern is set for centralized actions. When UI pages are built, the team should evaluate whether actions like `createProject` belong in the `projects/` route directory rather than a shared library.

This is a preemptive finding -- the current state is reasonable for the project's phase, but the established pattern will need revisiting.

---

## FINDING A6-06: Dead imports across action and validation files

**Severity:** MEDIUM
**Files:**
- `src/lib/actions/nodes.ts:9` -- `notFound` imported, never called
- `src/lib/actions/projects.ts:9` -- `notFound` imported, never called
- `src/lib/validation/nodes.ts:14-16` -- `costTypeSchema`, `qtyModeSchema`, `bidTypeSchema` imported from `./shared`, never used in any schema definition
- `src/lib/validation/shared.ts:75` -- `noteFormatSchema` exported, never imported by any file

Multiple unused imports indicate schemas and error constructors that were planned but not wired up. The `costTypeSchema`, `qtyModeSchema`, and `bidTypeSchema` suggest node detail schemas were intended to be more constrained but currently accept raw types instead. This is tech debt that will confuse future developers about intended validation coverage.

---

## FINDING A6-07: `nodes.ts` at 623 lines exceeds the 300-line component/file target

**Severity:** MEDIUM
**Files:** `src/lib/actions/nodes.ts` (623 lines)

The architecture rule specifies: "Target: <300 lines per component file. When exceeded, extract sub-components or custom hooks."

`nodes.ts` is more than double the target at 623 lines. It contains 10 exported functions handling create, read, update (base + item details + assembly details), delete, duplicate, move, flag, and set-visibility operations. This file should be split by operation type:

- `nodes/read.ts` -- `getNode`, `getNodes`
- `nodes/write.ts` -- `createNode`, `updateNode`, `updateItemDetails`, `updateAssemblyDetails`
- `nodes/tree-ops.ts` -- `moveNode`, `duplicateNode`, `deleteNode`
- `nodes/flags.ts` -- `flagNode`, `setNodeVisibility`

The `attachDetails` helper (lines 39-68) is duplicated in spirit -- the same node-with-details assembly logic runs in both `getNode` and `getNodes`, which is good, but the 623-line monolith makes it harder to maintain.

---

## FINDING A6-08: No data fetching in any page component -- missed server component data flow pattern

**Severity:** MEDIUM
**Files:** `src/app/(protected)/projects/page.tsx`, `src/app/(protected)/dashboard/page.tsx`, `src/app/(protected)/settings/page.tsx`

The architecture rule states: "Fetch data in server/parent components, pass down as props" and "Co-locate data fetching with the component that consumes it."

The `projects/page.tsx` displays static placeholder text ("Project management coming in Phase 1A"). The dashboard shows static cards. No page fetches data from server actions. While this is understandable for Phase 1A, the established pattern has zero examples of the correct data flow pattern (server component fetches -> passes as props to client component). When UI is built, there is no reference implementation in the codebase to follow.

This contrasts with the protected layout (`src/app/(protected)/layout.tsx:7-8`) which correctly fetches user data server-side and passes it to client components as props. That layout is the only example of the correct pattern.

---

## FINDING A6-09: Empty `components/ui/` directory

**Severity:** LOW
**Files:** `src/components/ui/` (empty directory)

The directory exists but contains no files. This is a vestigial directory that should either be removed or populated. It suggests a shared UI component library was planned but not implemented. The architecture rule calls for `components/shared/` for reusable UI components, which does exist (containing `skip-link.tsx`). Having both `components/shared/` and `components/ui/` without clear boundaries will cause confusion about where to place new components.

---

## Summary

| ID | Severity | Category | Summary |
|----|----------|----------|---------|
| A6-01 | HIGH | Data Flow / Validation | `duplicateNode` bypasses its validation schema entirely; schema/action signature mismatch |
| A6-02 | HIGH | Data Flow / Integrity | `restoreSnapshot` validates `estimateVersion` but discards it before RPC call |
| A6-03 | HIGH | Server/Client Boundary | Auth pages are full client components instead of server pages with client form children |
| A6-04 | HIGH | Server/Client Boundary | `_shared.ts` uses `"use server"`, exposing internal utilities as callable server actions |
| A6-05 | MEDIUM | File Organization | All actions centralized in `lib/actions/` vs architecture rule to co-locate with routes |
| A6-06 | MEDIUM | Import Hygiene | Dead imports in 3 files (unused error constructors, unused validation schemas) |
| A6-07 | MEDIUM | File Organization | `nodes.ts` at 623 lines is 2x the 300-line target |
| A6-08 | MEDIUM | Data Flow | No page demonstrates the server-fetch-pass-as-props pattern |
| A6-09 | LOW | File Organization | Empty `components/ui/` directory alongside `components/shared/` |

**Strengths observed:**
- Middleware design is solid: public route check before Supabase call, `getUser()` (not `getSession()`), defense-in-depth role check in layout.
- Error boundary coverage is thorough: root, global, protected, and auth each have dedicated error boundaries.
- ActionResult discriminated union is well-designed and consistently used across all action files.
- No import cycles detected. Dependency graph flows cleanly: pages -> components -> lib.
- `"server-only"` guard on admin client and auth helper correctly prevents accidental client import.
- Import ordering follows the documented convention in all files inspected.
- Type system properly derives from generated Supabase types as single source of truth.
