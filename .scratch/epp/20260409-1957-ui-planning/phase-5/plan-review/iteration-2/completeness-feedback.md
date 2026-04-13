# Completeness Review -- Iteration 2

## Verdict: APPROVE

## Issues Resolved from Iteration 1

### CRITICAL: No Testing Strategy
**Status: RESOLVED.** Changelog #1. The plan now contains a dedicated "Testing Strategy" section and a full 1B-T1 phase (0.5 session). Includes:
- Reducer unit tests with 11 specific test cases covering HYDRATE, NODE_CREATE, NODE_DELETE, NODE_MOVE, TOGGLE_EXPAND, EXPAND_ALL/COLLAPSE_ALL, UNDO/REDO, flatVisibleRows, NODE_UPDATE, REMOTE_NODE_UPSERT, and a 2000-node performance benchmark.
- Component smoke tests covering Button variants, money-field formatting, rate-field formatting, Dialog open/close, empty-state CTA, and error-state retry.
- Accessibility audit plan with NVDA/Chrome and VoiceOver/Safari at CP-3.
- Design system compliance and TypeScript checking on every commit.
This is thorough and directly addresses the concern.

### HIGH: Dashboard Page Has No Specification
**Status: RESOLVED.** Changelog #10. The plan now has a dedicated "Dashboard Page (Explicit Deferral)" section. It states clearly: "The plan does NOT build a full dashboard in Phase 1B. The tree editor is the priority." Phase 2 dashboard specification is sketched (stat cards, recent items, server-rendered). The deferral must be approved by Zac at CP-0. If Zac requires a functional dashboard in Phase 1B, the plan specifies adding 0.5 sessions to 1B-0.2. This is exactly what was recommended (option b: explicitly defer and get approval).

### HIGH: Settings Page Underspecified (1B-6)
**Status: RESOLVED.** Changelog #11. The 1B-6 section now includes:
- Database dependencies with full table schemas for `company_settings` and `user_preferences` (columns, types, defaults specified).
- Form fields listed explicitly: Company Info section (company name, address x4) and Default Rates section (markup rate, overhead rate, tax rate, contingency rate).
- User preferences panel: sidebar collapsed, theme selection, default density.
- View state persistence mechanism: `Set -> Array` serialization, localStorage cache with database sync on blur/unload.
This provides enough specification for an implementation agent to work without ambiguity.

### HIGH: Error and Loading State Strategy Incomplete
**Status: RESOLVED.** Changelog #12. The plan now has a dedicated "Error & Loading States" section covering:
- Existing error boundaries (`error.tsx`, `global-error.tsx`) are kept.
- Tree-specific error handling: `getNodes()` failure, zero-node empty state, individual mutation failure, WebSocket disconnect (explicitly stated as "no Realtime wired" in Phase 1B).
- Server action error-to-toast mapping table with 6 error codes and their user-facing messages.
- Loading skeletons with specific patterns for each route.
This is comprehensive and addresses all 5 sub-concerns from iteration 1.

### MEDIUM: D9 Information Density Modes
**Status: RESOLVED.** Changelog #19. A dedicated "Information Density Modes (D9)" section specifies: row height (30/40/50px), font size (13/14/15px), vertical padding (4/8/12px) for Compact/Default/Comfortable modes. Design token plan: `--tree-row-height`, `--tree-font-size`, `--tree-row-padding`. Preference location: Settings page under User Preferences + toolbar toggle. Phase 2 impact noted (variable row heights require measureElement).

### MEDIUM: CP-3 Covers Both Tree and Panel
**Status: RESOLVED.** Changelog #32. CP-3 description now explicitly states: "Covers BOTH tree navigation AND panel editing." A note clarifies: "If CP-3 results in tree navigation approval but panel editing rejection, the panel can be reworked independently (that is the point of the three-layer architecture)." This addresses the concern about dual-coverage without adding checkpoint overhead.

### MEDIUM: Documentation Location Inconsistency
**Status: RESOLVED.** Changelog #20. Research documentation consolidated to `docs/ui/`. The v2 note in the Research Schedule section explicitly states: "All research documentation consolidated to `docs/ui/`. The `research/ui/` location from v1 is removed."

### LOW: Catalog Save Behavior Unspecified
**Status: RESOLVED.** Changelog #31. The 1B-2 Catalog section now specifies: saves a node "or subtree including children" as a reusable template, "copies all node data (not a reference)", stored in `catalog_items` table. Insert is "copy-on-insert, per INTENT Decision #4." Catalog browser is accessible from sidebar "Catalog" link (placeholder page created in 1B-0.1).

### LOW: No "NOT in Scope" Sections
**Status: RESOLVED.** Changelog #21. Every 1B-0.x phase section now has an explicit "NOT in scope" list. For example, 1B-0.0a says "NOT in scope: Field primitives, layout primitives, feature components. Those are 1B-0.0b." 1B-0.3 says "NOT in scope: Detail panel editing (1B-0.4), keyboard shortcuts beyond expand/collapse (1B-0.5), context menu (1B-0.5), inline name editing (1B-0.5)."

## Remaining Issues

None blocking. All CRITICAL and HIGH issues are resolved.

## New Issues Found

### MINOR: 1B-T1 placement after 1B-0.5 means 7 sessions of untested code
The testing phase is after 1B-0.5 (session 8). The reducer is built in session 4-5 but not formally tested until session 8. The performance testing protocol during 1B-0.3 partially mitigates this, but reducer unit tests for correctness (not just performance) are delayed. This is acceptable given session budget constraints but worth noting: if the reducer has a subtle bug in HYDRATE or NODE_MOVE, it may not be caught until session 8. Mitigation: the 1B-0.4 and 1B-0.5 sessions will exercise the reducer extensively in practice.

## Final Assessment

All completeness gaps from iteration 1 have been filled. The plan now covers testing strategy, dashboard deferral, settings specification, error/loading states, density modes, scope boundaries, documentation locations, and catalog behavior. No area of the plan is underspecified to the point of blocking implementation.
