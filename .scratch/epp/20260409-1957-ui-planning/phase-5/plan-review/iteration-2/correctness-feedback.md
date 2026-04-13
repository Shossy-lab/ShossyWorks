# Correctness Review -- Iteration 2

## Verdict: APPROVE

Note: Iteration 1 verdict was already APPROVE (with minor fixes). Checking that the minor fixes were applied.

## Issues Resolved from Iteration 1

### HIGH: Contradiction Between IRB Analysis and Plan on flatVisibleRows
**Status: RESOLVED.** Changelog #13. The plan now clearly states: "`flatten-tree.ts` exports a pure function `computeFlatVisibleRows(nodesById, childrenOf, rootIds, expandedIds): FlatRow[]` that is called FROM WITHIN the reducer on every action that changes tree structure or expanded state. It is NOT a hook. It is NOT called from components. It is a reducer helper." This eliminates ambiguity for implementation agents.

### HIGH: Set Serialization Issue with useReducer
**Status: RESOLVED.** Changelog #14. The plan now includes a dedicated note: "For view state persistence (1B-6), convert `Set -> Array` at the serialization boundary. The Set remains the runtime type." This appears in both the state architecture section (under the state interface) and in the tree-state contract description (Set serialization rule). The 1B-6 section also references this pattern explicitly. The choice of Set over `Record<string, true>` is intentional for clarity and O(1) semantics; the serialization boundary is clearly documented.

### MEDIUM: Variable-Height Rows Not Future-Proofed
**Status: RESOLVED.** Changelog #22. The row height section now states: "Phase 2 note: If density modes (D9) or inline editing require variable row heights, switch to `estimateSize` + `measureElement` in the virtualizer." The D9 specification section repeats this: "Phase 2 impact: Variable row heights require switching the virtualizer from fixed `size` to `estimateSize` + `measureElement`."

### MEDIUM: Missing @radix-ui/react-context-menu in npm install
**Status: RESOLVED.** Changelog #7. Added to install command.

### MEDIUM: Consider @radix-ui/react-scroll-area and react-separator
**Status: RESOLVED.** Changelog #24. Both `@radix-ui/react-scroll-area` and `@radix-ui/react-separator` are now in the npm install command with explicit rationale: "provides cross-browser scrollbar styling for the detail panel (20+ fields)" and "provides `role=\"separator\"` ARIA handling for editor sections." Wrapper files `scroll-area.tsx` (~50 lines) and `separator.tsx` (~20 lines) are in the 1B-0.0a deliverables table. The detail panel architecture references ScrollArea and Separator in the component hierarchy.

### LOW: startTransition vs useTransition
**Status: RESOLVED.** Changelog #23. The detail panel communication pattern now specifies: "Panel saves via `useTransition` (not standalone `startTransition`) + server action." The rationale is stated: "The `isPending` flag from `useTransition` drives the 'unsaved indicator' on fields with pending mutations."

### LOW: Breadcrumb SWR Usage
**Status: RESOLVED.** Changelog #25. The breadcrumbs component now specifies: "Client-side `Map<string, string>` cache for entity name fetching (no SWR dependency). Fetches entity names via lightweight API calls, caches results in a Map for the session." This eliminates the SWR dependency gap.

## Remaining Issues

None. All issues from iteration 1 are resolved.

## New Issues Found

### INFO: enablePatches() addition is correct
The v2 plan adds `enablePatches()` alongside `enableMapSet()` at module level in the reducer. This is technically correct -- Immer's `enablePatches()` enables the patches/inversePatches return from `produce()` calls. The undo stack stores `Patch[][]` (inverse patches). This is the most memory-efficient undo strategy for large trees. No issue.

### INFO: Scroll-area and separator integration is consistent
The detail panel architecture now references ScrollArea for overflow and Separator between editor sections. The 1B-0.4 deliverables checklist includes "ScrollArea for overflow" and "Separator between sections." The wrapper layer (1B-0.0a) creates these wrappers. The dependency chain is correct: wrappers first (1B-0.0a), then consumed by detail panel (1B-0.4). No issue.

## Final Assessment

All technical inaccuracies and contradictions from iteration 1 have been corrected. The plan is technically sound across all sections. The state architecture, component hierarchy, dependency list, route structure, and API patterns are internally consistent and compatible with Next.js 16 + React 19 + Immer + @tanstack/react-virtual. No new technical issues introduced in v2.
