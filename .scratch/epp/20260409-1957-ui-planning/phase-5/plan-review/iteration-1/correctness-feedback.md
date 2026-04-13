# Correctness Review -- UI Implementation Plan v1.0

**Reviewer:** Correctness Analyst
**Date:** 2026-04-09
**Reviewed:** ui-implementation-plan.md (Phase 4 output)

---

## Verdict: APPROVE (with minor fixes)

The technical architecture is sound. The useReducer+Immer recommendation is correct for this use case. The flat normalized state shape works with @tanstack/react-virtual. The Radix UI selections are nearly complete. The route structure is valid for Next.js 16 App Router. There are a few technical inaccuracies and one contradiction that should be fixed before implementation begins, but nothing requires architectural rethinking.

---

## Issues Found

### HIGH: Contradiction Between IRB Analysis and Plan on flatVisibleRows

The IRB analysis (Section 5.2) includes `flatVisibleRows: FlatRow[]` as a field in `EstimateTreeState` and states it should be "computed in the reducer" (Disagreement #4 resolution). The implementation plan repeats this in the state interface (line 369) and also lists a separate deliverable: `flatten-tree.ts` utility (line 430).

**The contradiction:** If `flatVisibleRows` is computed inside the reducer (as both documents recommend), then `flatten-tree.ts` is a helper function called BY the reducer, not a standalone utility. This is fine architecturally, but the plan's deliverable list presents it as if it is a separate concern. An implementation agent might build it as an independent module that re-computes outside the reducer.

**Recommendation:** Clarify that `flatten-tree.ts` exports a pure function `computeFlatVisibleRows(nodesById, childrenOf, rootIds, expandedIds): FlatRow[]` that is called from within the reducer on every action that changes tree structure or expanded state. It is not a hook and is not called from components.

### HIGH: Set Serialization Issue with useReducer

The state interface uses `Set<string>` for `expandedIds`, `selectedIds`, and `conflictIds`. The plan correctly calls for `enableMapSet()` for Immer support. However, there is an issue with React's useReducer:

**React 19's useReducer does NOT serialize state for devtools by default**, but if any code attempts to serialize the state (e.g., for view state persistence, which the settings section mentions), JavaScript Sets are not JSON-serializable. The plan says "Estimate view state persistence (expand/collapse state)" in 1B-6 -- this means `expandedIds: Set<string>` must be serialized to persist.

**Recommendation:** Add a note that view state persistence requires `Set -> Array` conversion at the serialization boundary. The Set remains the runtime type in the reducer (O(1) lookups), but persistence functions convert to/from arrays. Alternatively, consider whether expandedIds should be a plain object `Record<string, true>` instead of a Set, which is natively JSON-serializable and has similar O(1) characteristics. The Immer enableMapSet() call would still be needed for conflictIds.

### MEDIUM: @tanstack/react-virtual Row Height and FlatRow Compatibility

The plan specifies "Fixed 40px row height for all node types" (line 405) and uses `@tanstack/react-virtual`. This is correct -- fixed row heights are the simplest virtualizer configuration and perform best. However, the plan also mentions `aria-setsize` and `aria-posinset` (line 417-418) which require the virtualizer to know the TOTAL number of items, not just the visible window.

**This works correctly with @tanstack/react-virtual's `count` prop**, which takes `flatVisibleRows.length`. The virtualizer handles the rest. No issue here -- just confirming the plan is technically correct on this point.

**One concern:** If variable-height rows are needed later (e.g., for inline editing in Phase 2, or for the "comfortable" density mode from D9), the virtualizer will need `estimateSize` + `measureElement` instead of a fixed `size`. The plan should note this as a future-proofing consideration but does not need to implement it now.

**Recommendation:** Add a one-line note that the fixed 40px row height simplifies Phase 1B but that Phase 2 features (inline editing, density modes) may require variable-height virtualization via measureElement.

### MEDIUM: Radix UI Selections -- Missing @radix-ui/react-scroll-area

The plan lists 11 Radix primitives to install and wrap. Reviewing the use cases:

| Radix Primitive | Listed? | Needed For |
|----------------|---------|------------|
| react-dialog | YES | Create/edit dialogs |
| react-alert-dialog | YES | Delete confirmations |
| react-dropdown-menu | YES | General dropdowns |
| react-context-menu | In wrapper list but NOT in npm install | Right-click context menu on tree rows |
| react-select | YES | Select fields |
| react-popover | YES | Popovers |
| react-tooltip | YES | Tooltips |
| react-toast | YES | Notifications |
| react-tabs | YES | Detail panel sections |
| react-collapsible | YES | Expandable sections |
| react-toggle | YES | Toggle fields |
| react-scroll-area | NO | Detail panel scrolling (20+ fields in item editor) |
| react-separator | NO | Visual dividers between editor sections |

**Missing `@radix-ui/react-scroll-area`:** The item editor has 6 sections with 20+ fields. The detail panel will need scrollable content when the panel height is insufficient. While native CSS `overflow-y: auto` works, Radix ScrollArea provides consistent cross-browser scrollbar styling that matches the design system.

**Missing `@radix-ui/react-separator`:** The editor sections (Basic, Cost Breakdown, Markup, Vendor, Allowance, Classification) need visual dividers. Radix Separator handles ARIA `role="separator"` correctly.

**Recommendation:** Consider adding these two primitives. They are small (~5KB each) and prevent the need for manual ARIA handling. However, if the plan's intent is to use simple CSS for scrolling and `<hr>` for dividers, that is also acceptable -- just make it explicit.

### MEDIUM: Route Structure and Next.js 16 App Router Compatibility

The proposed route structure:

```
src/app/
  (auth)/
  (protected)/
    dashboard/
    projects/
      [projectId]/
        layout.tsx
        estimates/
          [estimateId]/
            layout.tsx
            page.tsx
            settings/
            snapshots/[snapshotId]/
    catalog/
    settings/
  (client)/
    share/[token]/
```

**Verification against Next.js 16:**
- Route groups `(auth)`, `(protected)`, `(client)` -- VALID. Route groups are fully supported.
- Dynamic segments `[projectId]`, `[estimateId]`, `[snapshotId]`, `[token]` -- VALID.
- Nested layouts at `[projectId]/layout.tsx` and `[estimateId]/layout.tsx` -- VALID.
- Server components as default page.tsx -- VALID.
- Client components as children of server components -- VALID.

**One concern:** The plan shows `(client)/share/[token]/` as a route group, but the current codebase has NO `(client)` route group. The `(auth)` group exists with sign-in/sign-up pages. Creating a new route group with a different layout (no sidebar, PIN auth) is valid but requires its own `layout.tsx`.

**No issue found.** The route structure is correct for Next.js 16 App Router.

### LOW: `startTransition` Usage Pattern

The plan says the detail panel "saves via `startTransition` + server action, dispatches `MUTATION_CONFIRMED` / `MUTATION_FAILED` on completion."

In Next.js 16 with React 19, `startTransition` is the correct pattern for non-form server action calls. However, the plan does not specify whether this uses `useTransition` (which provides an `isPending` state) or the standalone `startTransition` import from React.

**Recommendation:** Specify `useTransition` (not standalone `startTransition`) because the `isPending` flag is needed for the "unsaved indicator" mentioned in the field behavior section. The hook version is the correct choice.

### LOW: Breadcrumb SWR Usage

The plan says breadcrumbs use "SWR-based entity name fetching with caching for dynamic segments." SWR is not in the dependency list (package.json), and the plan does not add it as a dependency.

**Options:**
1. Add `swr` as a dependency
2. Use React's built-in `cache()` function (server-side) + client-side fetch with `useSyncExternalStore` or a simple state hook
3. Use Next.js `fetch()` with built-in caching

Since breadcrumbs are a client component using `usePathname()`, server-side `cache()` is not available. SWR or a manual fetch cache is needed.

**Recommendation:** Either add `swr` to the dependency list or specify an alternative caching strategy for breadcrumb entity names. Given the project's minimalist dependency philosophy, a simple `Map<string, string>` cache in a client-side hook may be preferable to adding SWR.

### LOW: NodeWithDetails readonly Fields vs Immer

All fields in `NodeWithDetails` are marked `readonly` in the existing type definitions (`src/lib/types/domain/nodes.ts`). Immer's `produce()` function works by creating a draft that temporarily lifts readonly constraints. This is compatible -- Immer handles TypeScript readonly correctly. No issue, just confirming.

### INFO: No Technical Contradictions Between Sections

I verified the following cross-section consistency:
- State interface (Section on 1B-0.3) matches IRB analysis (Section 5.2) -- CONSISTENT
- Route structure (plan) matches IRB analysis (Section 5.3) -- CONSISTENT
- Action types list (plan) covers all features mentioned in all phases -- CONSISTENT
- Dependency list (plan) matches IRB analysis (Section 5.4) except for context-menu omission -- NOTED ABOVE
- Component hierarchy (plan Section 1B-0.3) matches IRB three-layer architecture (Section 5.1) -- CONSISTENT
- Checkpoint timing (plan) matches IRB recommendations (Section 7) -- CONSISTENT

---

## Summary of Recommendations

| Priority | Issue | Fix |
|----------|-------|-----|
| HIGH | flatten-tree.ts role unclear | Clarify it is a reducer helper function, not a standalone utility |
| HIGH | Set serialization for view state persistence | Note Set->Array conversion at persistence boundary; consider Record<string, true> alternative |
| MEDIUM | Variable-height rows not future-proofed | Add note about measureElement for Phase 2 |
| MEDIUM | Missing @radix-ui/react-context-menu in npm install | Add to install command |
| MEDIUM | Consider @radix-ui/react-scroll-area and react-separator | Add or explicitly decide against |
| LOW | startTransition vs useTransition | Specify useTransition for isPending flag |
| LOW | SWR not in dependencies for breadcrumb caching | Add swr or specify alternative |
