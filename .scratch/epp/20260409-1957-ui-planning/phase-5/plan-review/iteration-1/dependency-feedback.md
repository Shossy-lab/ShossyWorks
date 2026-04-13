# Dependency Review -- UI Implementation Plan v1.0

**Reviewer:** Dependency Analyst
**Date:** 2026-04-09
**Reviewed:** ui-implementation-plan.md (Phase 4 output)

---

## Verdict: REVISE

The build order has one genuine dependency violation (detail panel before tree context), several under-documented npm package requirements, and a critical gap in Phase 1A dependency verification. The feature reordering (1B-6 before 1B-5 before 1B-2 before 1B-1) is well-reasoned, but the plan does not specify how to verify that Phase 1A deliverables are actually complete before 1B-0.2 starts consuming them.

---

## Issues Found

### CRITICAL: Phase 1A Dependency Verification is Missing

The plan correctly identifies (Section: Dependencies on Phase 1A) that 1B-0.2 requires:
- `projects` table + RLS
- `estimates` table + RLS
- Core server actions (projects, estimates, nodes)
- Generated types + Zod schemas

**Current state of the codebase confirms some but not all of these:**

Exists:
- `src/lib/actions/projects.ts` -- EXISTS
- `src/lib/actions/estimates.ts` -- EXISTS
- `src/lib/actions/nodes.ts` -- EXISTS (803 lines, comprehensive)
- `src/lib/actions/snapshots.ts` -- EXISTS
- `src/lib/types/domain/nodes.ts` -- EXISTS (NodeWithDetails discriminated union)
- `src/lib/validation/nodes.ts` -- EXISTS (Zod schemas)
- `src/lib/validation/projects.ts` -- EXISTS
- `src/lib/validation/estimates.ts` -- EXISTS

Unknown/Unverified:
- Database tables and RLS policies (cannot verify from code alone -- requires Supabase dashboard or migration files)
- `node_notes` table (referenced in plan for 1B-0.4 notes panel)
- Triggers for auto-promotion and sort_order reordering
- `company_settings` or `user_preferences` tables (needed for 1B-6 Settings)
- `catalog_items` table (needed for 1B-2 Catalog)

**The plan says "the data layer is complete and stable" but does not include a verification step.** What if a table is missing or a trigger is not deployed?

**Recommendation:** Add a Phase 1A verification checklist as the FIRST step of 1B-0.2 (or better, at CP-0). This should be a script or manual checklist that confirms:
1. All required tables exist in the remote database
2. RLS policies are applied
3. Triggers are deployed
4. Server actions compile and return expected shapes for basic test cases

### HIGH: 1B-0.4 Detail Panel Cannot Be Built Before Tree Context (1B-0.3)

The plan assigns 1B-0.3 (Tree View Core) and 1B-0.4 (Detail Panel & Node Editing) to consecutive sessions. This ordering is correct in the session timeline. However, the dependency is tighter than the plan acknowledges:

**The detail panel's communication pattern requires the reducer and provider from 1B-0.3:**
- "Tree dispatches SET_SELECTED. Panel reads selected node from state via selector hook."
- "Panel edits dispatch NODE_UPDATE / NODE_UPDATE_DETAILS back through the reducer."

This means 1B-0.4 CANNOT start until 1B-0.3's reducer and provider are COMPLETE and TESTED. If 1B-0.3 runs long (feasibility review flags this risk), 1B-0.4 is blocked.

**The plan assigns 3 parallel agents to 1B-0.4** (item editor, assembly/group editor, notes panel). All three agents need access to the reducer's dispatch function and state selectors. If these interfaces are not stable from 1B-0.3, all three agents produce code that does not compile.

**Recommendation:** 
1. Define the reducer's external interface (dispatch signature, state selector hooks) as part of the `tree-state.contract.md` BEFORE 1B-0.3 starts. This way, 1B-0.4 agents can code against the contract even if the reducer internals are still in progress.
2. Add an explicit gate: "1B-0.4 cannot start until use-estimate-tree-reducer.ts passes TypeScript compilation and exports the documented provider/hooks."

### HIGH: Missing npm Packages Per Phase

The plan lists all npm packages in 1B-0.0 but some are not needed until later phases, and some later phases need packages not listed:

**Phase 1B-0.0 installs:**
- immer, nanoid, @tanstack/react-virtual -- Correct, all needed
- 11 Radix packages -- Mostly correct (context-menu missing from install command)
- lucide-react -- Correct

**Phase 1B-0.1 needs:**
- No new packages (uses existing Next.js APIs + shared components)

**Phase 1B-0.3 needs:**
- All packages already installed -- OK

**Phase 1B-5 (Search) may need:**
- `cmdk` or equivalent for command-palette-style search? The plan says "search box in tree toolbar" which does not require cmdk, but if cross-estimate search is added, a more sophisticated search UI may be warranted.
- No new packages explicitly listed.

**Phase 1B-4 (Client Portal) needs:**
- Rate limiting library? The plan mentions "Per-IP rate limiting" but does not specify if this is middleware-level (Next.js built-in) or application-level (requires a package like `express-rate-limit` or custom implementation).
- QR code generation for share links? Not mentioned but common for PIN-based sharing flows.

**Recommendation:** Add a "New packages" line to each post-1B-0 phase section, even if the answer is "None." This prevents implementation agents from guessing.

### MEDIUM: Feature Order Dependencies are Correct

The reordered feature sequence:
1. **1B-6 (Settings)** first -- correct, company defaults are used by item editor's default rates
2. **1B-5 (Search)** second -- correct, enables navigation for real usage
3. **1B-2 (Catalog)** third -- correct, depends on tree CRUD working
4. **1B-1 (Snapshots)** fourth -- correct, depends on tree + settings
5. **1B-3 (Options)** fifth -- correct, depends on catalog for option group templates
6. **1B-4 (Client Portal)** last -- correct, depends on tree + options + visibility

**One subtle dependency the plan handles correctly:** Options (1B-3) depends on Catalog (1B-2) because option groups can reference catalog items. The plan puts Catalog before Options. This is correct.

**One subtle dependency the plan does NOT call out:** Snapshots (1B-1) does not technically depend on Settings (1B-6), but Settings provides company defaults that populate new estimate fields -- which matters for snapshot baseline accuracy. The plan's ordering (Settings before Snapshots) handles this implicitly, but the rationale should be stated.

### MEDIUM: Contract Creation Timing

The plan specifies three contracts:
1. `tree-state.contract.md` -- "Before 1B-0.3"
2. `tree-component.contract.md` -- "Before 1B-0.3"
3. `shared-components.contract.md` -- "Before 1B-0.0"

**Dependencies:**
- 1B-0.0 agents need `shared-components.contract.md` to know the wrapper rules. Creating it "Before 1B-0.0" means it must be created during CP-0 or as the first step of 1B-0.0. The plan does not specify who creates it or when in the session it happens.
- 1B-0.3 and 1B-0.4 agents need the tree contracts. These must be created BETWEEN 1B-0.2 and 1B-0.3, not "before 1B-0.3" as a vague timing.

**Recommendation:** Add explicit agent assignments for contract creation:
- `shared-components.contract.md`: Created by the research subagent in the first 15 minutes of 1B-0.0, BEFORE wrapper agents start.
- `tree-state.contract.md` and `tree-component.contract.md`: Created by the research subagent at the START of 1B-0.3, before the main implementation begins. Alternatively, created as the LAST step of 1B-0.2.

### MEDIUM: 1B-0.1 Navigation Has Implicit Dependency on Sidebar Refactor

The current sidebar (`src/components/nav/sidebar.tsx`) has NO icons. The plan says 1B-0.1 adds Lucide icons. This means 1B-0.1 depends on:
1. `lucide-react` being installed (happens in 1B-0.0) -- OK
2. The sidebar component being refactored to accept icons -- the plan says "Add Lucide icons to all 4 nav items" but the current sidebar only has 3 nav items (Dashboard, Projects, Settings). The plan adds "Catalog" as a 4th item.

**The plan needs to specify:** Is the `catalog/` route and page created in 1B-0.1 (navigation) or 1B-2 (catalog feature)? The sidebar link should point somewhere. If `catalog/` is just a placeholder page in 1B-0.1, that is fine but should be stated.

**Recommendation:** Add a note that 1B-0.1 creates a placeholder `src/app/(protected)/catalog/page.tsx` with an empty state CTA. The actual catalog functionality comes in 1B-2.

### LOW: @tanstack/react-virtual Version Compatibility

The plan does not specify package versions. `@tanstack/react-virtual` v3 (current) works with React 19. However, some v3 API changes between minor versions have broken virtualizer behavior (particularly around `getScrollElement` ref handling). 

**Recommendation:** Pin `@tanstack/react-virtual` to a specific minor version (e.g., `^3.13.0`) rather than using an unpinned caret range.

### LOW: Immer + React 19 Strict Mode

React 19 in development mode runs reducers twice (strict mode) to detect impure reducers. Immer's `produce()` is safe under strict mode because it creates fresh drafts each time. No issue, just confirming.

### LOW: Missing Dependency -- `@radix-ui/react-context-menu`

Already noted in other reviews. The wrapper `context-menu.tsx` is listed as a deliverable but the package is not in the install command.

---

## Build Order Dependency Graph

```
CP-0 (plan approval)
  |
  v
1B-0.0 (shared components) -- DEPENDS ON: npm install, shared-components.contract.md
  |
  v
CP-1 (visual direction) -- BLOCKING
  |
  v
1B-0.1 (navigation) -- DEPENDS ON: 1B-0.0 (icons, layout primitives)
  |
  v
CP-2 (layout feel) -- BLOCKING
  |
  v
1B-0.2 (project/estimate pages) -- DEPENDS ON: 1B-0.0 (field primitives, dialogs), 
  |                                  1B-0.1 (route layouts, breadcrumbs),
  |                                  Phase 1A (database tables, server actions)
  v
1B-0.3 (tree core) -- DEPENDS ON: 1B-0.0 (field primitives, button),
  |                     1B-0.2 (estimate page route exists),
  |                     tree-state.contract.md, tree-component.contract.md
  v
1B-0.4 (detail panel) -- DEPENDS ON: 1B-0.3 (reducer, provider, dispatch interface)
  |                       TIGHT COUPLING -- cannot parallelize
  v
CP-3 (tree interaction) -- BLOCKING
  |
  v
1B-0.5 (keyboard, move) -- DEPENDS ON: 1B-0.3 + 1B-0.4 (complete tree)
  |
  v
1B-6 (settings) -- DEPENDS ON: 1B-0.0 (field primitives)
  |                  PARALLEL with 1B-5 OK
  |
1B-5 (search) -- DEPENDS ON: 1B-0.3 (flatVisibleRows for client-side filter)
  |
  v
CP-4/CP-5
  |
  v
1B-2 (catalog) -> 1B-1 (snapshots) -> 1B-3 (options) -> 1B-4 (client portal)
```

**This graph confirms the plan's ordering is correct.** The only risk is the tight coupling between 1B-0.3 and 1B-0.4 where the reducer interface is the critical handoff point.

---

## Summary of Recommendations

| Priority | Issue | Fix |
|----------|-------|-----|
| CRITICAL | Phase 1A verification missing | Add verification checklist/script at CP-0 or start of 1B-0.2 |
| HIGH | 1B-0.4 depends on 1B-0.3 reducer interface | Define reducer external interface in contract BEFORE 1B-0.3; add explicit gate |
| HIGH | Missing npm packages per phase | Add "New packages" line to each phase section |
| MEDIUM | Contract creation timing vague | Specify who creates each contract and when in the session |
| MEDIUM | Catalog placeholder page for sidebar link | Add catalog placeholder creation to 1B-0.1 |
| LOW | @tanstack/react-virtual version pinning | Pin to specific minor version |
| LOW | Missing @radix-ui/react-context-menu | Add to install command |
