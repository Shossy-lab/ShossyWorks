# Risk Review -- Iteration 2

## Verdict: APPROVE

## Issues Resolved from Iteration 1

### CRITICAL: No Checkpoint Rejection Contingency
**Status: RESOLVED.** Changelog #2. The plan now has a dedicated "Checkpoint Failure Protocol" section with:
- Rework budgets per checkpoint: CP-1 (0.5 session), CP-2 (0.25 session), CP-3 (1.0 session; 0.5 if only panel editing is rejected).
- Maximum 2 rejection cycles per checkpoint before escalation to a structured design conversation (Zac + Claude, screen-share, 1 hour).
- Architecture rejection protocol for CP-3: if feedback challenges the three-layer architecture, STOP implementation, present IRB reasoning, and refuse to implement inline editing in Phase 1B.
- Total rework budget: 3 sessions allocated across Phase 1B-0.
This is exactly what was recommended. The rework budgets are reasonable and the escalation path prevents infinite loops.

### CRITICAL: Tree View 2x Overrun Scenario Not Addressed
**Status: RESOLVED.** Changelog #5. The plan now has a dedicated "Tree View Overrun Protocol" with decision triggers at three levels:
- 1.5 sessions: Continue normally (within plan budget).
- 2.0 sessions: STOP and evaluate. Identify bottleneck (reducer, virtualizer, ARIA). If ARIA is the bottleneck, defer full ARIA to 1B-0.5. If virtualizer is the bottleneck, evaluate Virtualization Fallback Plan.
- 2.5 sessions: The tree architecture may have a fundamental issue. Convene with Zac to discuss scope reduction (remove virtual scrolling for Phase 1B, use simple list with React.memo).
This provides clear decision criteria at each escalation level. The tiered deliverables (Tier 1 and Tier 2) also help: if Tier 1 completes in session 1 but Tier 2 overruns, the core tree rendering is already working.

### HIGH: Figma-Architecture Misalignment Risk
**Status: RESOLVED.** Changelog #15. The plan now has a dedicated "Figma-Architecture Conflict Resolution Protocol" with four conflict types and their resolutions:
- Different LAYOUT: discuss with Zac at CP-0, present IRB rationale.
- INLINE EDITING: do not implement, show IRB reasoning, Phase 2.
- Different INFORMATION HIERARCHY: defer to Zac as product decision.
- VISUAL STYLING conflicts: map to tokens, add new tokens if needed, never hardcode.
The rule "Figma values are INPUT to the token system, not overrides" is clearly stated.

### HIGH: @tanstack/react-virtual Limitation Discovery
**Status: RESOLVED.** Changelog #8. The plan now has a dedicated "Virtualization Fallback Plan" with three tiers:
- Primary: `@tanstack/react-virtual` with fixed 40px rows.
- Fallback 1: `@tanstack/react-virtual` with `estimateSize` + `measureElement` (for dynamic heights).
- Fallback 2: No virtualization, simple list with `React.memo` on TreeNodeRow (viable for Phase 1B if estimates stay under 500 visible rows).
- Decision trigger: if virtualizer integration takes >4 hours.
The plan also addresses the specific concern about virtualized focus management: "When a focused node scrolls out of view and its DOM element is removed, focus state is tracked in the reducer (`focusedId`), not in the DOM." This is the correct approach.

### HIGH: useReducer+Immer Performance at 2000 Nodes
**Status: RESOLVED.** Changelog #16. The plan now has a dedicated "Performance Testing Protocol" within the 1B-0.3 section:
1. Generate 2000 synthetic nodes.
2. Measure time for TOGGLE_EXPAND, NODE_CREATE, NODE_DELETE, NODE_MOVE.
3. Target: <16ms per action.
4. If exceeded: profile to identify bottleneck.
5. If `flatVisibleRows` is bottleneck: move to `useMemo`.
6. If `produce()` is bottleneck: evaluate `enablePatches()` overhead.
The reducer unit tests in 1B-T1 also include a "Performance: 2000-node TOGGLE_EXPAND completes in <16ms" test case. The undo/redo strategy is specified as Immer patches (not full state snapshots), which addresses the memory concern.

### MEDIUM: Real-Time Action Types as No-Ops
**Status: RESOLVED.** Changelog #29. The plan now specifies: "implemented with complete state mutations so the reducer logic is tested and type-checked, but not wired to any event source until Realtime is connected." The action types section explicitly states: "Remote (full logic, unwired): REMOTE_NODE_UPSERT, REMOTE_NODE_DELETE, REMOTE_NODES_BULK -- implemented with complete state mutations..." The 1B-T1 reducer unit tests include "REMOTE_NODE_UPSERT: Merges remote node into state (full logic, not no-op)."

### MEDIUM: Undo/Redo Complexity
**Status: RESOLVED.** Changelog #30. The plan now specifies the undo strategy: "Uses Immer's `enablePatches()`. Each `produce()` call returns patches and inverse patches. The undo stack stores inverse patches (not full state snapshots). This is memory-efficient: 50 undo entries store only the changed fields, not 50 copies of a 2000-node state." Undoable actions are listed: NODE_UPDATE, NODE_UPDATE_DETAILS, NODE_MOVE, NODE_CREATE. Delete is NOT undoable. The state interface shows `undoStack: Patch[][]` and `redoStack: Patch[][]`. This is documented for inclusion in `tree-state.contract.md`.

### LOW: Context Window Exhaustion During Tree Build
**Status: RESOLVED.** The Documentation & Research Management section now states: "Context management for tree sessions (1B-0.3 through 1B-0.5): Each session starts fresh with only L1 + the specific tree contract + the previous session's handoff doc. Do not carry over the full tree codebase in context across sessions."

### LOW: Design System Enforcement Script Limitations
**Status: RESOLVED.** Changelog #34. The design system enforcement section now explicitly acknowledges: "Script limitations (acknowledged): This catches ~80% of violations... It does NOT catch: hardcoded pixel values in inline styles, incorrect token usage, or missing more-specific tokens. The reviewer agent and checkpoint reviews cover the remaining 20%."

## Remaining Issues

None blocking. All CRITICAL and HIGH issues are resolved.

## New Issues Found

### MINOR: Overrun protocol does not address 1B-0.4 cascading delay
The tree overrun protocol addresses 1B-0.3 specifically but does not explicitly state what happens to 1B-0.4 if 1B-0.3 hits 2.0 sessions. The implicit answer is that 1B-0.4 shifts by the overrun amount, which comes from the 3-session rework buffer. This is adequate but could be stated more explicitly. Not blocking.

## Final Assessment

All risk mitigation gaps from iteration 1 have been filled. The plan now has contingency protocols for checkpoint rejection, tree view overrun, Figma-architecture conflicts, virtualization limitations, and reducer performance. The undo/redo strategy is specified (Immer patches). Remote action types are full implementations (not no-ops). Performance testing has specific targets and fallbacks. The risk matrix in the plan is now comprehensive and actionable. Every identified risk has a mitigation strategy with a decision trigger and fallback options.
