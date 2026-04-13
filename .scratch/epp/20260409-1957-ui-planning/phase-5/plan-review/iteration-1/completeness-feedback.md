# Completeness Review -- UI Implementation Plan v1.0

**Reviewer:** Completeness Analyst
**Date:** 2026-04-09
**Reviewed:** ui-implementation-plan.md (Phase 4 output)

---

## Verdict: REVISE

The plan is impressively thorough on the tree editor, state management, and checkpoint schedule. However, it has notable gaps in several areas: the dashboard page is left as a placeholder with no session allocation, the settings page has no specification beyond "company settings form," the error/loading state strategy is underspecified, and there is no testing strategy whatsoever. Additionally, several user workflows have no corresponding UI deliverable.

---

## Issues Found

### CRITICAL: No Testing Strategy

The plan contains zero mention of testing. No unit tests for the reducer. No integration tests for server actions (which already exist in `src/lib/actions/`). No component tests for the shared component layer. No accessibility testing methodology beyond "accessibility test matrix (NVDA/Chrome, VoiceOver/Safari)" mentioned once in the risk table with no corresponding deliverable.

For a project where previous UI attempts FAILED, and where the tree reducer is handling 18+ action types with undo/redo, optimistic updates, and flat normalized state transformations, the reducer is the single most testable and test-worthy piece of code in the entire plan.

**Recommendation:**
- Add explicit reducer unit test deliverables to 1B-0.3: at minimum, tests for HYDRATE, NODE_CREATE, NODE_DELETE, NODE_MOVE, TOGGLE_EXPAND, UNDO/REDO, and flatVisibleRows computation.
- Add component rendering tests for the shared component layer in 1B-0.0 (can be simple smoke tests verifying token usage and prop forwarding).
- Add a "Testing Strategy" section to the plan specifying: reducer tests (unit), server action tests (integration, already partially exist), component smoke tests, and accessibility audits.

### HIGH: Dashboard Page Has No Specification

The current dashboard (`src/app/(protected)/dashboard/page.tsx`) is a placeholder with two links. The plan mentions "stat cards + recent items" in the loading skeleton description (1B-0.1) but never specifies what the dashboard page should actually show, never allocates a session for building it, and never lists it as a deliverable.

**Missing specification:**
- What stats appear on the dashboard? (Active projects? Total estimates? Recent activity?)
- Does the dashboard pull data from server actions? Which ones?
- Is it server-rendered or does it need client-side state?
- What does "recent items" mean? Recent estimates? Recent edits? Recent snapshots?

The user workflow "I open ShossyWorks and want to see my overview" has no implementation plan.

**Recommendation:** Either (a) add dashboard specification to 1B-0.2 alongside project pages (expanding it to 1 session), or (b) explicitly state that the dashboard remains a placeholder/link-hub through Phase 1B and will be specified in Phase 2. Option (b) is acceptable -- the tree editor is the priority -- but it must be stated explicitly so Zac can approve the deferral at CP-0.

### HIGH: Settings Page Underspecified (1B-6)

The settings section says:
- "Company settings form (rates as columns, info as JSONB)"
- "User preferences panel (UI state, sidebar, theme)"
- "Estimate view state persistence"

But it does not specify:
1. What rates? Markup rate, overhead rate, tax rate, contingency rate? Where do these come from? Is there a `company_settings` table?
2. What JSONB info fields? Company name, address, logo?
3. What user preferences? Sidebar collapsed state, theme selection, default view mode?
4. How does "estimate view state persistence" work? Is this saving expand/collapse state to a database table? To localStorage? To a user_preferences JSONB column?
5. Where are the server actions? The plan says "Server actions: settings.ts, preferences.ts" but these files do not currently exist in `src/lib/actions/`.

For a feature labeled "Tier 1: Immediate (enables real usage)" with only 0.5 sessions allocated, this needs far more specificity.

**Recommendation:** Add a schema reference for what database tables/columns the settings page reads from and writes to. Specify the form fields. If `company_settings` or `user_preferences` tables do not exist in the current schema, this is a data layer dependency that must be flagged.

### HIGH: Error and Loading State Strategy Incomplete

The plan mentions:
- Loading skeletons in 1B-0.1 (4 routes)
- Error states in 1B-0.0 (error-state.tsx component)
- Toast notifications for mutation errors

But it does not address:
1. What happens when `getNodes()` fails in the tree page? Is there a tree-specific error boundary?
2. What happens when the WebSocket (Realtime) disconnects? (Even though Realtime is Phase 1B+, the reducer has `lastSyncedAt` and `conflictIds` -- what shows in the UI?)
3. What error toast content is shown for each type of server action failure? The server actions return structured `ActionResult<T>` with error codes -- the plan should specify how these map to user-facing messages.
4. The current codebase already has `error.tsx` and `global-error.tsx` (error boundaries). Does the plan intend to keep these or replace them?
5. What is the empty state for the tree view when a new estimate has zero nodes?

**Recommendation:** Add an "Error & Loading States" subsection to the plan, or at minimum add error state deliverables to each phase. The tree view empty state is especially important -- it is the first thing a user sees after creating an estimate.

### MEDIUM: All 5 Interaction Decisions Coverage

The IRB identified 5 interaction decisions (D7-D11). Let me verify each has a corresponding UI component:

| Decision | UI Component | Covered? |
|----------|-------------|----------|
| D7: Font choice | Global CSS / font stack | YES -- mentioned as review decision |
| D8: Icon library | Lucide wrappers in shared components | YES -- installed, wrapper pattern mentioned |
| D9: Info density modes | Not specified anywhere as a deliverable | NO |
| D10: Side panel width | split-pane.tsx | PARTIAL -- split-pane listed but resizable behavior not detailed |
| D11: Inline cost totals | TotalCell in tree row | YES -- two-column layout with total |

**D9 (Information density modes)** is listed as a review decision ("After tree view MVP") but has zero implementation specification. What CSS changes create compact/default/comfortable? Is it just row height (30/40/50px)? Font size? Padding? This needs at least a design token plan.

**Recommendation:** Add 2-3 sentences specifying what information density modes change (row height, font size, padding) and where the user sets the preference (settings page? toolbar toggle?).

### MEDIUM: Checkpoint Schedule Missing One Scenario

The checkpoints cover:
- CP-0: Plan approval
- CP-1: Visual direction
- CP-2: Navigation/layout feel
- CP-3: Tree interaction model
- CP-4: Figma deep-dive + priority
- CP-5: Mid-build course correction

**Missing:** There is no checkpoint for the detail panel editing experience specifically. CP-3 covers tree interaction but is timed "after 1B-0.4" (detail panel). This means Zac is reviewing BOTH the tree AND the detail panel at CP-3. If the tree interaction is approved but the panel editing UX is rejected, the plan has no mechanism to handle this separately.

**Recommendation:** Consider splitting CP-3 into CP-3a (tree navigation: after 1B-0.3) and CP-3b (tree + editing: after 1B-0.4). This catches tree-only issues one session earlier. However, if this adds too much user overhead, keep CP-3 as-is but explicitly note that it covers both tree navigation AND panel editing.

### MEDIUM: Research Documentation Strategy is Complete but Location Inconsistency

The plan specifies two different locations for UI documentation:
- Section 8 (Research): `research/ui/` (5 files)
- Section on Documentation: `docs/ui/` (12+ files in 4 subdirectories)

Neither directory currently exists. The plan should pick one location. Having both `research/ui/` and `docs/ui/` creates confusion about which is the canonical source.

**Recommendation:** Consolidate to `docs/ui/` since that is the more detailed specification. Change the 5 files originally placed in `research/ui/` (component-inventory, tree-view-architecture, state-management, interaction-patterns, prototype-extraction) to `docs/ui/specs/` where they fit naturally.

### LOW: Catalog "Add to Catalog" Workflow Needs More Detail

The catalog section (1B-2) says "Add to Catalog -- save node as reusable template" but does not specify:
- What data is captured? Just the node, or node + children (subtree)?
- Does it copy or reference the node?
- Where does the catalog browser appear? Sidebar panel? Modal? New page?

The IRB analysis mentions INTENT Decision #4 (copy-on-insert) which answers the reference question, but the save-to-catalog direction is not covered.

**Recommendation:** Add 3-4 sentences specifying catalog save behavior. This does not need to be detailed now but should be enough for an implementation agent to start without ambiguity.

### LOW: Missing "Not in Scope" Sections

The IRB recommended that every phase spec include a "NOT in scope" section. The implementation plan does not include these for any phase. While the overall plan does identify deferred items (drag-drop, mobile, undo on delete), each phase section should explicitly state what it does NOT include to prevent scope creep during implementation.

**Recommendation:** Add a 3-5 bullet "NOT in scope" list to each 1B-0.x phase section.

---

## Completeness Checklist

| Area | Status | Notes |
|------|--------|-------|
| User workflows mapped to pages | PARTIAL | Dashboard workflow missing. Settings underspecified. |
| All interaction decisions have UI components | PARTIAL | D9 (density modes) has no implementation spec |
| Checkpoint schedule covers blocking decisions | YES | 6 checkpoints with clear blocking/non-blocking classification |
| Research documentation strategy | PARTIAL | Location inconsistency (research/ui/ vs docs/ui/) |
| Figma extraction steps | YES | Three-step process clearly specified |
| Error/loading/empty states | PARTIAL | Loading skeletons listed but error handling strategy incomplete |
| Testing strategy | NO | Complete gap |
| "NOT in scope" per phase | NO | Missing from all phases |

## Summary of Recommendations

| Priority | Issue | Fix |
|----------|-------|-----|
| CRITICAL | No testing strategy | Add reducer unit tests, component smoke tests, accessibility audit plan |
| HIGH | Dashboard page unspecified | Either spec it in 1B-0.2 or explicitly defer to Phase 2 |
| HIGH | Settings page underspecified | Add schema reference and form field specification |
| HIGH | Error/loading state strategy incomplete | Add error handling subsection covering tree error boundary, empty states, toast content |
| MEDIUM | D9 density modes unspecified | Add token plan and UI toggle location |
| MEDIUM | CP-3 covers both tree and panel | Consider splitting or explicitly noting dual coverage |
| MEDIUM | research/ui/ vs docs/ui/ location conflict | Consolidate to docs/ui/ |
| LOW | Catalog save behavior unspecified | Add 3-4 sentences on save-to-catalog flow |
| LOW | No "NOT in scope" sections per phase | Add to each 1B-0.x phase |
