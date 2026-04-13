# Risk Review -- UI Implementation Plan v1.0

**Reviewer:** Risk Analyst
**Date:** 2026-04-09
**Reviewed:** ui-implementation-plan.md (Phase 4 output)

---

## Verdict: REVISE

The plan's risk mitigation matrix is strong for the three identified failure modes (data/UI coupling, AI slop, component coupling). However, it underestimates the risk of schedule blowout on the tree view, does not adequately plan for Figma-architecture misalignment, lacks a fallback for @tanstack/react-virtual limitations, and has no performance fallback if useReducer+Immer proves slow at scale. The plan also has no contingency for what happens if a checkpoint is REJECTED.

---

## Issues Found

### CRITICAL: No Checkpoint Rejection Contingency

The plan has 4 blocking checkpoints (CP-0, CP-1, CP-2, CP-3). For each, "blocking" means work stops until Zac approves. But the plan never addresses:

1. **What happens if CP-1 is rejected?** "Visual direction rejected" is listed as a risk, but the plan does not say how much rework is budgeted, who does it, or how the schedule adjusts. If Zac says "the buttons feel wrong" or "the spacing is too tight," that could mean rewriting every shared component -- the entire 1B-0.0 output.

2. **What happens if CP-3 is rejected?** This is "the most important checkpoint" per the plan. The tree interaction model is being validated. If Zac says "the side panel feels wrong, I want inline editing" or "the tree indentation is confusing," that could invalidate the three-layer architecture. The plan has no fallback for this scenario.

3. **What is the maximum number of revision cycles at each checkpoint?** Without this, a checkpoint can become an infinite loop. Zac might reject CP-1 three times, each time with different feedback, consuming 1.5 sessions of rework.

**Recommendation:** Add a "Checkpoint Failure Protocol" section:
- CP-1 rejection: Budget 0.5 session for rework. If rejected twice, escalate to a design workshop (Zac + Claude, 1 hour, screen-share) to align before third attempt.
- CP-2 rejection: Budget 0.25 session for rework (navigation changes are lower effort).
- CP-3 rejection: Budget 1.0 session for rework. If the rejection challenges the three-layer architecture itself (not just visual polish), STOP and re-run the IRB analysis on the specific concern before implementing.
- Maximum 2 rejection cycles per checkpoint before escalating to a structured design conversation.

### CRITICAL: Tree View 2x Overrun Scenario Not Addressed

The feasibility review flags that 1B-0.3 may take 1.5 sessions instead of 1. But the risk analysis should go further: **what if the tree view takes 2x the estimate (2 full sessions instead of 1)?**

This is not unlikely. The tree view combines:
- A complex reducer with 18+ action types
- Immer integration with enableMapSet
- @tanstack/react-virtual integration (first-time use in this codebase)
- Custom ARIA implementation for virtualized trees (uncommon pattern, limited examples)
- Three discriminated union node type renderers
- Flat normalized state hydration from server data

Any ONE of these could produce unexpected complexity. Together, a 2x overrun is a realistic scenario.

**Impact of 2x overrun:**
- 1B-0 foundation goes from 4.25 to 5.25 sessions
- The 20% buffer (3-4 sessions) absorbs this, but only barely
- If the overrun also pushes 1B-0.4 and 1B-0.5 back, the cascading delay could consume the entire buffer before any 1B features begin

**Recommendation:** Add a "tree view overrun protocol":
1. If 1B-0.3 hits 1.5 sessions: Continue. This is within acceptable range.
2. If 1B-0.3 hits 2.0 sessions: STOP and evaluate. Is the reducer the bottleneck? Is the virtualizer the bottleneck? Is the ARIA implementation the bottleneck? Identify the specific cause and decide whether to simplify (e.g., defer ARIA to 1B-0.5, defer undo/redo to 1B-0.5) or continue.
3. If 1B-0.3 hits 2.5 sessions: The tree architecture may have a fundamental issue. Convene with Zac to discuss scope reduction (e.g., remove virtual scrolling and use simple list for Phase 1B, add virtualization in Phase 2 when it is proven needed).

### HIGH: Figma-Architecture Misalignment Risk

The plan says Figma prototypes are "INPUT to the token system, not overrides." This is correct in principle. But the risk is more specific:

**What if Zac's Figma designs show a fundamentally different layout than sidebar + tree + side panel?**

For example:
- Figma shows a top toolbar with a tabbed workspace (like Google Sheets) instead of a sidebar
- Figma shows inline editing in tree rows (the pattern the IRB explicitly rejected)
- Figma shows a modal-based editing flow (the EP anti-pattern)
- Figma shows a completely different information hierarchy (e.g., catalog-first instead of project-first)

The plan says D1 (Figma review) is blocking. But it does not specify: **what is the decision framework if Figma contradicts the IRB architecture?**

**Recommendation:** Add a "Figma-Architecture Conflict Resolution" protocol:
1. If Figma shows a different LAYOUT (sidebar vs top nav, panel placement): Discuss with Zac at CP-0. The IRB recommendation has technical rationale (matches ProEst/VS Code, avoids coupling). Zac can override but must understand the trade-offs.
2. If Figma shows INLINE EDITING: Do not implement. The IRB unanimously rejected this for Phase 1B due to Soloway failure mode. Show Zac the IRB reasoning. Inline editing is Phase 2.
3. If Figma shows a different INFORMATION HIERARCHY: This is a product decision, not an architecture decision. Defer to Zac. Adjust route structure accordingly.
4. If Figma shows VISUAL STYLING that conflicts with design tokens: Map Figma values to tokens. If no close token exists, ADD a token. Never hardcode a Figma value.

### HIGH: @tanstack/react-virtual Limitation Discovery

The plan assumes @tanstack/react-virtual will work for a custom tree view. This is a reasonable assumption -- the library is widely used for flat lists and grids. However, tree views have unique characteristics:

**Known potential limitations:**
1. **Dynamic row visibility:** When a node is collapsed, its children disappear from flatVisibleRows. The virtualizer's `count` changes. If the virtualizer does not handle `count` changes smoothly (scroll position jumps), the expand/collapse UX will be jarring.
2. **Focus management after virtualization:** When a node is focused via keyboard and then scrolled out of view, the DOM element is removed. The focus must be managed separately from the DOM. The plan mentions "roving tabindex" but does not address what happens when the focused element is virtualized away.
3. **ARIA on virtualized elements:** Screen readers expect `aria-setsize` to reflect the TOTAL visible tree size, not just the rendered window. This requires `flatVisibleRows.length` to be passed correctly. The plan handles this, but it has not been tested.

**Fallback options if @tanstack/react-virtual proves problematic:**
- Use `react-window` (simpler API, less flexible, but battle-tested for variable scenarios)
- Use native `IntersectionObserver` with manual windowing (most control, most effort)
- Remove virtualization entirely for Phase 1B (the State Management analyst originally argued 50-200 visible rows do not need virtualization)

**The plan has no fallback specified.**

**Recommendation:** Add a "Virtualization Fallback" decision:
- Primary: @tanstack/react-virtual with fixed 40px rows
- Fallback 1: @tanstack/react-virtual with estimateSize + measureElement (if dynamic heights needed)
- Fallback 2: No virtualization with React.memo on TreeRow (if virtualizer causes more problems than it solves). This is viable for Phase 1B if estimates stay under 500 visible rows.
- Decision trigger: If virtualizer integration takes >4 hours in 1B-0.3, evaluate whether the complexity is justified for the Phase 1B use case.

### HIGH: useReducer+Immer Performance at 2000 Nodes

The plan targets 2000 nodes as the scale benchmark. The state shape has `nodesById: Record<string, NodeWithDetails>`. Each `NodeWithDetails` (specifically `ItemNode`) has ~25 fields in the details object.

**Rough calculation:**
- 2000 nodes x ~30 fields average = ~60,000 field values in state
- Each `produce()` call (Immer) creates a structural sharing proxy over the entire state
- For a single NODE_UPDATE action, Immer traces which fields are accessed and only copies modified subtrees
- For flatVisibleRows recomputation: iterates `nodesById` keys, checks `expandedIds`, and builds a flat array. With 2000 nodes and ~50% expanded, this is ~1000 iterations per action that changes tree structure.

**Performance concern:** This is likely fine for individual updates (Immer's structural sharing is O(modified fields)). But UNDO/REDO is different -- restoring a snapshot means replacing large portions of `nodesById`, which causes Immer to create a new proxy for every replaced node.

**A more serious concern:** `flatVisibleRows` is recomputed on EVERY action that changes tree structure (TOGGLE_EXPAND, NODE_CREATE, NODE_DELETE, NODE_MOVE). With 2000 nodes and frequent expand/collapse operations, this could cause noticeable lag.

**Fallback options if performance is insufficient:**
1. Move flatVisibleRows to a `useMemo` (contradicts the IRB recommendation but avoids re-computation when non-structure actions fire)
2. Use `startTransition` for expand/collapse actions to make them interruptible
3. Move to Zustand with selectors (contradicts INTENT Decision #13)
4. Use a Web Worker for flatVisibleRows computation

**Recommendation:** Add a performance testing protocol for 1B-0.3:
1. After the reducer is built, generate 2000 synthetic nodes
2. Measure time for: TOGGLE_EXPAND, NODE_CREATE, NODE_DELETE, NODE_MOVE
3. Target: <16ms per action (one frame budget at 60fps)
4. If any action exceeds 16ms at 2000 nodes: Profile to identify whether Immer produce() or flatVisibleRows is the bottleneck
5. If flatVisibleRows is the bottleneck: Move to useMemo (defer the IRB recommendation for this specific computation)
6. If Immer produce() is the bottleneck: Consider `enablePatches()` for more efficient undo (record patches instead of full snapshots)

### MEDIUM: Real-Time Action Types as No-Ops

The plan includes REMOTE_NODE_UPSERT, REMOTE_NODE_DELETE, and REMOTE_NODES_BULK as no-op actions "from day one." This is correct for future-proofing. However:

**Risk:** If the no-op implementations are truly empty (just return state unchanged), they will never be tested or type-checked against the actual Realtime payload shape. When Realtime is actually wired up (Phase 1B+), the action payloads may not match what the channel actually sends.

**Recommendation:** Instead of true no-ops, implement the remote actions with the correct state mutations but do not wire them to any event source. This way:
1. The reducer logic is tested and type-checked
2. When Realtime is added, only the event subscription needs to be wired -- not the reducer logic
3. Unit tests can verify remote action handling independently

### MEDIUM: Undo/Redo Complexity

The plan caps undo at 50 entries and says "delete is not undoable." However, it does not specify:
1. What IS undoable? NODE_UPDATE? NODE_MOVE? NODE_CREATE?
2. What is the undo entry shape? Full state snapshot? Or action + inverse action?
3. If using state snapshots: 50 snapshots of a 2000-node tree is ~3 million field values in memory. This is manageable but not trivial.
4. If using inverse actions: How do you invert a NODE_MOVE that shifted multiple sibling sort_orders?

**Recommendation:** Specify the undo implementation strategy:
- **Recommended:** Partial state snapshots (only the changed nodes, not the entire state). On undo, patch only the affected nodes back.
- **Alternative:** Immer patches via `enablePatches()`. Each produce() call can optionally return patches and inverse patches. Store the inverse patches for undo. This is Immer's native undo mechanism and is highly efficient.
- Add this specification to `tree-state.contract.md`.

### LOW: Context Window Exhaustion During Tree Build

The plan mentions "context window exhaustion" as a risk and recommends "research subagents, compact at 70%, session handoffs." This is adequate.

However, the tree implementation sessions (1B-0.3 through 1B-0.5) are the most context-intensive because the reducer, container, renderer, and row components are deeply interdependent. A single session working on all of them will hit context limits.

**Recommendation:** The plan already structures tree work across 3 sessions (1B-0.3, 1B-0.4, 1B-0.5). Ensure each session starts fresh with only the relevant context loaded (L1 + the specific tree contract + the previous session's handoff doc). Do not attempt to carry over the full tree codebase in context across sessions.

### LOW: Design System Enforcement Script Limitations

The `design-system-check.sh` script greps for forbidden patterns. This catches:
- Direct Tailwind color classes (bg-white, bg-gray-*, text-gray-*)
- Forbidden border-radius values (rounded-sm/md/lg/xl)
- Hardcoded hex in className

It does NOT catch:
- Hardcoded pixel values in inline styles (`style={{ width: '400px' }}`)
- Missing design tokens (e.g., using `var(--color-border)` when a more specific token like `var(--color-border-focus)` should be used)
- Incorrect token usage (e.g., using `--color-text-primary` for a background)

**Recommendation:** Acknowledge these limitations. The script catches the most common violations (direct Tailwind colors account for ~80% of "AI slop"). The remaining 20% requires code review, which is what the reviewer agent and checkpoints provide.

---

## Risk Matrix Summary

| Risk | Plan's Mitigation | Adequate? | Additional Mitigation Needed |
|------|-------------------|-----------|------------------------------|
| Data/UI coupling (FM1) | Server actions as boundary, data layer complete | YES | None |
| AI slop (FM2) | Design tokens, automated grep, checkpoints | YES | Acknowledge script limitations |
| Component coupling (FM3) | Three-layer tree, side panel, reducer | YES | None |
| Tree view overrun | 20% buffer | PARTIAL | Add overrun protocol with decision triggers |
| Checkpoint rejection | None specified | NO | Add checkpoint failure protocol with budgets |
| Figma-architecture mismatch | "Figma is input, not override" | PARTIAL | Add conflict resolution protocol |
| @tanstack/react-virtual limitations | None specified | NO | Add fallback plan with decision trigger |
| useReducer+Immer performance | Performance test at 2000 nodes | PARTIAL | Add specific benchmarks and fallback options |
| Undo/redo complexity | Cap at 50, delete not undoable | PARTIAL | Specify implementation strategy (patches vs snapshots) |
| Remote action types correctness | No-ops from day one | PARTIAL | Implement with full logic, just unwired |

---

## Summary of Recommendations

| Priority | Issue | Fix |
|----------|-------|-----|
| CRITICAL | No checkpoint rejection contingency | Add failure protocol with session budgets and max revision cycles |
| CRITICAL | Tree view 2x overrun not addressed | Add overrun protocol with simplification triggers at 1.5x and 2x |
| HIGH | Figma-architecture misalignment | Add conflict resolution protocol for layout, editing, and hierarchy conflicts |
| HIGH | No @tanstack/react-virtual fallback | Add fallback plan with decision trigger at 4 hours |
| HIGH | useReducer+Immer performance unvalidated | Add performance testing protocol with <16ms target and specific fallbacks |
| MEDIUM | Remote action types as true no-ops | Implement full logic unwired instead of empty no-ops |
| MEDIUM | Undo/redo implementation strategy missing | Specify Immer patches vs partial snapshots; add to tree-state contract |
| LOW | Context exhaustion during tree sessions | Ensure fresh session starts with minimal context |
| LOW | Design system script has blind spots | Acknowledge limitations; rely on reviewer agent for remaining 20% |
