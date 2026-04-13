# Feasibility Review -- UI Implementation Plan v1.0

**Reviewer:** Feasibility Analyst
**Date:** 2026-04-09
**Reviewed:** ui-implementation-plan.md (Phase 4 output)

---

## Verdict: REVISE

The plan is architecturally sound but has significant session estimate risks that could cause schedule blowouts in exactly the sessions that matter most. The tree view sessions (1B-0.3 through 1B-0.5) are underestimated, the component library session (1B-0.0) is overloaded for 5 parallel agents, and the total 19-24.5 session budget relies on optimistic assumptions about first-pass success at checkpoints.

---

## Issues Found

### CRITICAL: 1B-0.0 Component Library in 1 Session with 5 Agents is Aggressive

**The plan asks 5 agents to build 22+ shared components in a single session.** This includes:
- 11 Radix wrappers (dialog, alert-dialog, dropdown-menu, context-menu, select, popover, tooltip, toast, tabs, collapsible, toggle)
- 12 field/UI primitives (button, badge, text-field, number-field, money-field, rate-field, select-field, textarea, checkbox, skeleton, empty-state, error-state)
- 4 layout primitives (page-header, split-pane, panel, status-bar)
- Design system enforcement script
- Figma token reconciliation

**Problems:**
1. The Figma walkthrough and token reconciliation are BLOCKING prerequisites listed in the same session. This means agents cannot start writing components until Figma mapping is complete. The session effectively loses 30-60 minutes of parallel agent time waiting for D1.
2. The Radix wrappers require forwardRef, displayName, data-state animation handling, and strict token compliance. Each is ~60-120 lines. The estimate of "~80 lines" for dialog.tsx is plausible, but getting the token mapping RIGHT (especially for Radix's data-attribute-driven states) requires iteration, not just first-pass output.
3. Money-field and rate-field are not trivial -- they involve formatting, prefix/suffix rendering, monospace alignment, and precision handling. These are the fields most likely to need rework.
4. split-pane.tsx (resizable panels) is a genuinely complex component. The plan lists it as a layout primitive but does not acknowledge that resizable split panes require pointer event handling, min/max constraints, and persistence of user-set widths. This is 150-250 lines minimum.

**Risk:** The session runs long, the reviewer agent finds design system violations, and fixes cascade. CP-1 gets delayed.

**Recommendation:**
- Split 1B-0.0 into 1B-0.0a (Radix wrappers + enforcement script, 0.5 session) and 1B-0.0b (field primitives + layout primitives, 0.5 session). This is still 1 session total but structures the work sequentially: wrappers first (they are dependencies), then primitives that compose them.
- Move the Figma walkthrough to a pre-session activity or the first 30 minutes of CP-0 so it does not block agent work.
- Explicitly estimate split-pane.tsx at 200+ lines and flag it as the highest-risk layout primitive.

### HIGH: Tree View Complexity Underestimated (1B-0.3 at 1 session)

**1B-0.3 is labeled "the most critical session in the entire plan" -- and then given exactly 1 session.** This session must deliver:
- Complete reducer with 18+ action types
- HYDRATE logic for converting server data to flat normalized state
- flatVisibleRows computation
- EstimateTreeContainer with provider
- VirtualTreeRenderer with @tanstack/react-virtual
- TreeNodeRow with React.memo and 3 sub-renderers
- TreeCell with depth-based indentation
- TreeToolbar
- StatusBar
- flatten-tree.ts utility
- Server component page wiring
- Expand/collapse
- Add/delete nodes with AlertDialog confirmation
- ARIA implementation (role="tree", role="treeitem", aria-level, aria-setsize, aria-posinset, aria-expanded, aria-live)

**This is 12-15 files and ~2000-3000 lines of code in a single session.** The reducer alone (with complete action union, HYDRATE, flatVisibleRows, undo stack initialization, and Immer integration with enableMapSet) is likely 300-500 lines. The virtual scroller integration with a custom tree is notoriously tricky -- variable aria attributes on virtualized rows require careful measurement/observer patterns.

**Historical parallel:** The IRB analysis itself says the tree view is "40-60% of Phase 1B development effort." Phase 1B-0 is 4-4.5 sessions. 40-60% of that is 1.6-2.7 sessions for the tree. Yet the plan allocates exactly 2.75 sessions (1B-0.3 + 1B-0.4 + 1B-0.5). The tree rendering core (1B-0.3) gets only 1.0 of those.

**Recommendation:**
- Increase 1B-0.3 to 1.5 sessions. The reducer + virtual tree + ARIA is legitimately 1.5 sessions of work.
- Alternatively, move "Add/delete nodes" and "ARIA implementation" to 1B-0.4 and expand that session to absorb the overlap.
- The total 1B-0 budget goes from 4.25 to 4.75 sessions, which is within the stated 4-4.5 range's upper bound.

### MEDIUM: 1B-0.4 Detail Panel Estimates are Reasonable but Tight

The item editor alone has 6 field sections with 20+ fields. With Zod validation, optimistic updates, and the startTransition pattern, this is substantial. However, the plan correctly assigns 3 parallel agents (item editor, assembly/group editor, notes panel) which makes 1 session feasible IF the shared field primitives from 1B-0.0 are solid.

**Risk:** If money-field, rate-field, or number-field have bugs from 1B-0.0, every agent in 1B-0.4 is blocked simultaneously.

**Recommendation:** Add explicit verification of field primitive correctness between 1B-0.0 and 1B-0.4. The plan has verification scripts but they only check existence and TypeScript compilation, not functional correctness.

### MEDIUM: Total Budget of 19-24.5 Sessions

The 19-24.5 range is realistic IF:
1. No checkpoint requires significant rework (each CP rejection adds 0.5-1 session)
2. The tree view works on first or second attempt
3. Figma designs do not require new tokens beyond the anticipated 6

The 20% buffer (3-4 sessions) covers roughly 2 checkpoint rejections or 1 major tree rework. This is adequate for the 1B-0 foundation but thin for 1B-1 through 1B-4 combined.

**Recommendation:** State explicitly that the 20% buffer applies primarily to 1B-0. For 1B-1 through 1B-4, each phase should carry its own 10-15% padding in the session range (the "2-3" ranges already imply this, but it should be stated).

### LOW: Hidden Dependency -- @radix-ui/react-context-menu

The plan lists `context-menu.tsx` as a wrapper in 1B-0.0 (line 133) but `@radix-ui/react-context-menu` is NOT in the npm install command (line 112). It is missing from the dependency list.

**Recommendation:** Add `@radix-ui/react-context-menu` to the install command.

### LOW: enableMapSet() Call Location

The plan says "Call enableMapSet() once at app initialization" but does not specify WHERE. In a Next.js 16 App Router project, there is no single app initialization file for client-side code. It needs to go in the EstimateTreeContainer or a shared provider that loads before any Immer-using code runs.

**Recommendation:** Specify that enableMapSet() goes in a client-side provider component or at the top of the reducer module (lazy-initialized via module scope in the client bundle).

---

## Summary of Recommendations

| Priority | Issue | Fix |
|----------|-------|-----|
| CRITICAL | 1B-0.0 overloaded + Figma blocking | Restructure into two sub-phases; decouple Figma from agent work |
| HIGH | 1B-0.3 tree view underestimated at 1 session | Increase to 1.5 sessions or redistribute ARIA + add/delete to 1B-0.4 |
| MEDIUM | Field primitive bugs could cascade | Add functional verification between 1B-0.0 and 1B-0.4 |
| MEDIUM | Buffer thin for post-MVP phases | State per-phase padding explicitly |
| LOW | Missing @radix-ui/react-context-menu in install | Add to npm install command |
| LOW | enableMapSet() location unspecified | Specify module-level call in reducer file |
