# ShossyWorks UI Implementation Plan

**Version:** 2.0
**Date:** 2026-04-09
**Authority:** Implementation Review Board (5 analysts, 8 research files, 5 user decisions, 27 INTENT decisions) + Plan Review Board (5 reviewers, iteration 1)
**Status:** Pending user approval at CP-0

---

## Changelog from v1

| # | Source | Severity | Change |
|---|--------|----------|--------|
| 1 | Completeness | CRITICAL | Added **Testing Strategy** section with reducer unit tests, component smoke tests, and accessibility audit plan |
| 2 | Risk | CRITICAL | Added **Checkpoint Failure Protocol** with rework budgets, max revision cycles, and escalation triggers |
| 3 | Dependency | CRITICAL | Added **Phase 1A Verification Checklist** as the first step of CP-0, with script to confirm tables, RLS, triggers, and server actions |
| 4 | Feasibility | CRITICAL | Split **1B-0.0** into two sub-phases: 1B-0.0a (Radix wrappers + enforcement, 0.5 session) and 1B-0.0b (field primitives + layout primitives, 0.5 session). Moved Figma walkthrough to CP-0 so it does not block agent work |
| 5 | Risk | CRITICAL | Added **Tree View Overrun Protocol** with decision triggers at 1.5x, 2.0x, and 2.5x |
| 6 | Feasibility | HIGH | Increased **1B-0.3** from 1.0 to 1.5 sessions. Moved ARIA implementation and add/delete to explicit deliverable tiers |
| 7 | Feasibility, Correctness, Dependency | HIGH | Added `@radix-ui/react-context-menu` to npm install command |
| 8 | Risk | HIGH | Added **Virtualization Fallback Plan** with decision trigger at 4 hours |
| 9 | Dependency | HIGH | Added explicit **interface contract gate** between 1B-0.3 and 1B-0.4: reducer external interface defined in `tree-state.contract.md` BEFORE 1B-0.3; 1B-0.4 cannot start until reducer passes TypeScript compilation |
| 10 | Completeness | HIGH | Added **Dashboard page** explicit deferral to Phase 2 (stated at CP-0 for Zac approval) |
| 11 | Completeness | HIGH | Added **Settings page specification**: schema references, form fields, database dependencies, and flagged missing tables |
| 12 | Completeness | HIGH | Added **Error & Loading States** subsection covering tree error boundary, empty states, toast content mapping, and existing error boundary disposition |
| 13 | Correctness | HIGH | Clarified `flatten-tree.ts` as a pure helper function called BY the reducer, not a standalone utility |
| 14 | Correctness | HIGH | Added Set serialization note: `Set -> Array` at persistence boundary. Runtime type remains Set for O(1) lookups |
| 15 | Risk | HIGH | Added **Figma-Architecture Conflict Resolution** protocol for layout, editing, hierarchy, and styling conflicts |
| 16 | Risk | HIGH | Added **Performance Testing Protocol** for reducer at 2000 nodes with <16ms target and specific fallbacks |
| 17 | Dependency | MEDIUM | Specified contract creation timing: who creates each contract and at what point in the session |
| 18 | Dependency | MEDIUM | Added catalog placeholder page creation to 1B-0.1 |
| 19 | Completeness | MEDIUM | Added **D9 (Information Density Modes)** specification: what changes, where preference is set |
| 20 | Completeness | MEDIUM | Consolidated documentation location to `docs/ui/` (removed `research/ui/` duplication) |
| 21 | Completeness | MEDIUM | Added **"NOT in scope"** lists to each 1B-0.x phase section |
| 22 | Correctness | MEDIUM | Added note on variable-height rows for Phase 2 (measureElement future-proofing) |
| 23 | Correctness | MEDIUM | Specified `useTransition` (not standalone `startTransition`) for `isPending` flag |
| 24 | Correctness | MEDIUM | Added consideration for `@radix-ui/react-scroll-area` and `react-separator` |
| 25 | Correctness | LOW | Specified breadcrumb caching strategy: `Map<string, string>` client-side cache hook (no SWR dependency) |
| 26 | Correctness | LOW | Specified `enableMapSet()` location: module-level call at top of reducer file |
| 27 | Dependency | LOW | Pinned `@tanstack/react-virtual` to `^3.13.0` |
| 28 | Dependency | LOW | Added "New packages" line to each post-1B-0 phase section |
| 29 | Risk | MEDIUM | Changed remote action types from true no-ops to full logic implementations (unwired from event sources) |
| 30 | Risk | MEDIUM | Specified undo/redo strategy: Immer patches via `enablePatches()` for efficient undo |
| 31 | Completeness | LOW | Added catalog save behavior specification (subtree copy, catalog browser location) |
| 32 | Completeness | MEDIUM | Noted CP-3 covers both tree navigation AND panel editing; added explicit dual-coverage note |
| 33 | Feasibility | MEDIUM | Added per-phase buffer statements and explicit total budget adjustment to 21-27 sessions |
| 34 | Risk | LOW | Acknowledged design system enforcement script limitations; reviewer agent covers remaining 20% |
| 35 | Dependency | MEDIUM | Stated Settings-before-Snapshots rationale (company defaults affect snapshot baseline accuracy) |

**Total budget adjusted:** 19-24.5 sessions (v1) -> 21-27 sessions (v2). The increase reflects realistic tree view estimates, checkpoint rework budgets, and testing phases.

---

## Context

This plan exists because ShossyWorks has failed at UI twice before. EP coupled UI to an unstable schema and produced a monolithic mess. Soloway built read-only components that crumbled when editing was added. Both attempts produced what Zac calls "generic AI slop" -- visually incoherent interfaces with no design conviction.

What is different this time:
1. **The data layer is complete and stable.** 35+ tables, triggers, typed server actions, RLS on every table. The schema will not change under the UI's feet.
2. **A design system with CSS tokens exists before any UI code.** Every color, spacing, shadow, and radius is a custom property. Zero hardcoded styles are permitted.
3. **This plan was produced by a 5-analyst review board with 8 deep-research files** covering tree rendering, state management, keyboard accessibility, Radix UI wrappers, navigation architecture, Figma integration, realtime/optimistic updates, and documentation strategy. Every major decision has been debated, and disagreements are resolved.
4. **The component architecture is deliberately layered** to prevent the coupling that killed both prior attempts. Tree rendering is separated from node editing. Data ownership is centralized in a reducer. Components communicate through dispatch, not direct calls.
5. **A 5-reviewer Plan Review Board scrutinized this plan** across feasibility, completeness, correctness, dependency ordering, and risk. Every CRITICAL and HIGH issue has been addressed in this revision.

### Failure Modes This Plan Guards Against

| # | Failure Mode | What Killed | How This Plan Prevents It |
|---|---|---|---|
| FM1 | Data/UI coupling | EP | Data layer complete before UI starts. Server actions are the boundary. Client components receive props, never query directly. |
| FM2 | AI slop / design drift | Both | Design tokens enforced via wrapper layer + automated grep checks + CP-1/CP-2 visual checkpoints with Zac. |
| FM3 | Component coupling preventing iteration | Soloway | Three-layer tree (container/renderer/row). Side panel for editing (not inline). Reducer owns all state. Components are replaceable independently. |
| FM4 | Missing foundation in the plan | Current plan | Phase 1B-0 adds 5-5.5 sessions for navigation + tree view that the original plan omitted entirely. |
| FM5 | No testing leads to silent regressions | NEW | Testing strategy with reducer unit tests, component smoke tests, and performance benchmarks. |
| FM6 | Checkpoint rejection loops | NEW | Checkpoint failure protocol with rework budgets, max revision cycles, and escalation triggers. |

---

## Architecture Decisions (Resolved by IRB)

These are settled. They do not need re-debate. Implementation agents treat these as constraints.

### Unanimous (All 5 Analysts)

| ID | Decision | Reference |
|---|---|---|
| C1 | **Phase 1B-0 must be added** -- 5-5.5 sessions for core navigation + tree view. The current plan has zero allocation for this. | IRB Finding C1 |
| C2 | **useReducer + Immer for tree state.** Mandated by INTENT Decision #13. Handles local edits + remote broadcasts through the same dispatch. | INTENT #13, IRB C2 |
| C3 | **Custom tree component, not a library.** No existing tree library handles discriminated union node types + inline columns + real-time updates + virtual scrolling + the strict design system. | IRB C3 |
| C4 | **Flat normalized state: `nodesById` + `childrenOf` + `rootIds`.** O(1) lookup, O(1) updates, O(1) re-parenting. The existing `TreeNode` type with recursive `children` is for rendering only. | IRB C4, State Research |
| C5 | **Server component page fetches data; client component manages state.** `page.tsx` is a server component calling `getNodes()`. `EstimateTreeContainer` is a client component receiving `initialNodes` as props. | IRB C5 |
| C6 | **Remote action types in the reducer from day one.** `REMOTE_NODE_UPSERT`, `REMOTE_NODE_DELETE`, `REMOTE_NODES_BULK` implemented with full state mutation logic but unwired from event sources until Realtime is connected. | IRB C6, Realtime Research |
| C7 | **Design system compliance via automated enforcement.** Grep for forbidden patterns on every `.tsx` commit. PostToolUse hook reminders. Reviewer agent catches remaining ~20% that automated grep cannot detect (inline styles, incorrect token usage). | IRB C7 |
| C8 | **Side panel (persistent, not modal) for node editing.** Always visible alongside the tree. Matches ProEst/Figma/VS Code. Avoids EP modals and Soloway inline coupling. | IRB C8 |

### Strong Majority (4/5)

| ID | Decision | Reference |
|---|---|---|
| C9 | **Radix UI primitives** for accessible overlays. Not shadcn/ui (copy-paste model fights design system). | IRB C9, Design Components Research |
| C10 | **Virtual scrolling from day one** with `@tanstack/react-virtual@^3.13.0`. Fixed 40px row height for Phase 1B. Overscan: 10-15 rows. Phase 2 features (inline editing, density modes) may require variable-height virtualization via `measureElement`. | IRB C10, Tree-Table Research |
| C11 | **Breadcrumbs** using `usePathname()` + `useParams()` + client-side `Map<string, string>` cache for entity names. Arrow separators. No SWR dependency. | IRB C11, Navigation Research |
| C12 | **Desktop-first.** Mobile is not a target for Phase 1B. | IRB C12 |
| C13 | **Immer dependency (~4KB).** Required for ergonomic deep immutable updates on 2000-node trees. `enableMapSet()` called at module level in the reducer file. `enablePatches()` called alongside for efficient undo via inverse patches. | IRB C13, State Research |

### Majority (3/5)

| ID | Decision | Reference |
|---|---|---|
| C14 | **Keyboard navigation complete from Phase 1B.** WAI-ARIA tree pattern. Roving tabindex. Arrow keys, Home/End, Enter, Escape. Ctrl+]/[ for indent/outdent. | IRB C14, Keyboard Research |
| C15 | **Drag-and-drop deferred to Phase 2.** Move via keyboard and context menu first. | IRB C15 |
| C16 | **Delete not undoable in Phase 1B.** Confirmation dialog is standard UX. Soft-delete in Phase 2+. | IRB C16 |

### Resolved Disagreements

| Topic | Resolution | Rationale |
|---|---|---|
| Virtualization urgency | Build with virtual scrolling from day one | Retrofitting is 2-3x harder. The tree is the core product. Fallback plan exists if virtualizer proves problematic. |
| Inline editing in tree rows | Phase 1B: side panel only. Inline name editing as stretch goal in 1B-0.3. Full inline editing Phase 2. | Architecture analyst is right about coupling risk; design analyst is right about UX. Phased approach satisfies both. |
| Context vs direct props for rows | Start with direct props (5-6 per row). Virtual scroller limits rendered rows to 30-50, reducing re-render cascade concern. Migrate to selectors if profiling shows issues. | Simpler first. Optimize when evidence demands it. |
| `flatVisibleRows` computation | Compute in the reducer, not in `useMemo` | Reducer knows when tree structure changes. Pre-computation means the scroller receives a stable array. If profiling at 2000 nodes shows this is the bottleneck, move to `useMemo` as fallback. |
| TanStack Table vs custom tree | Custom tree with `@tanstack/react-virtual` | TanStack Table's column model does not fit discriminated union node types. Groups have 3 fields, items have 20+. |

---

## Phase Overview Table

| Phase | Focus | Sessions | User Input Required | Checkpoint |
|---|---|---|---|---|
| **CP-0** | Review this plan + blocking decisions + Phase 1A verification + Figma walkthrough | -- | YES: Approve plan, confirm D1-D6 | Before any code |
| **1B-0.0a** | Radix Wrappers + Enforcement Script | 0.5 | NO | -- |
| **1B-0.0b** | Field Primitives + Layout Primitives | 0.5 | YES at end: Visual direction approval (CP-1) | CP-1 |
| **1B-0.1** | Navigation & Layout | 0.75 | YES at end: Layout + flow approval (CP-2) | CP-2 |
| **1B-0.2** | Project & Estimate Pages | 0.75 | NO | -- |
| **1B-0.3** | Tree View Core | 1.5 | NO | -- |
| **1B-0.4** | Detail Panel & Node Editing | 1.0 | YES at end: Tree interaction review (CP-3) | CP-3 |
| **1B-0.5** | Tree Polish: Move, Keyboard, Context Menu | 0.75 | NO | -- |
| **1B-T1** | Reducer + Component Testing | 0.5 | NO | -- |
| **1B-6** | Settings & Preferences | 0.75 | NO | -- |
| **1B-5** | Search & Filtering | 1.0 | NO | -- |
| **CP-5** | Feature priority confirmation | -- | YES: Confirm or reorder 1B-1 through 1B-4 | After 1B-0 |
| **1B-2** | Catalog System | 2-3 | NO | -- |
| **1B-1** | Snapshots | 2-3 | NO | -- |
| **1B-3** | Options UI | 2-3 | NO | -- |
| **1B-4** | Client Portal | 3-4 | NO | -- |

**Total: 21-27 sessions** (includes 20% buffer for UI unpredictability + checkpoint rework budget)

**Buffer allocation:**
- Phase 1B-0 (foundation): 3 sessions of buffer for tree overrun + checkpoint rework
- Phase 1B-1 through 1B-4: each carries 10-15% padding within its session range (the "2-3" and "3-4" ranges encode this)

---

## Phase 1A Verification (at CP-0)

**v2 addition.** Before any UI code is written, verify that the data layer is complete. Run this at CP-0 or at the very start of 1B-0.2.

### Verification Checklist

| Category | Check | How to Verify |
|----------|-------|---------------|
| Tables exist | `projects`, `estimates`, `estimate_nodes`, `node_item_details`, `node_assembly_details`, `node_group_details`, `node_notes` | `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'` via Supabase dashboard or migration check |
| RLS active | All 7 tables have row-level security enabled | `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public'` |
| Triggers deployed | Auto-promotion trigger, sort_order reordering trigger | `SELECT trigger_name FROM information_schema.triggers WHERE trigger_schema = 'public'` |
| Server actions compile | `projects.ts`, `estimates.ts`, `nodes.ts`, `snapshots.ts` | `npx tsc --noEmit` (already covers this) |
| Server actions return expected shapes | Basic test: `getProjects()` returns `ActionResult<Project[]>` | Manual test or brief integration script |
| Validation schemas exist | `src/lib/validation/projects.ts`, `estimates.ts`, `nodes.ts` | File existence check |
| Missing tables flagged | `company_settings`, `user_preferences`, `catalog_items` -- needed for 1B-6, 1B-2 | Check existence; if missing, add to 1B-6/1B-2 prerequisites |

**Verification script:**
```bash
#!/bin/bash
echo "=== Phase 1A Verification ==="
# Server actions exist
for f in projects estimates nodes snapshots; do
  [ -f "src/lib/actions/$f.ts" ] && echo "PASS: actions/$f.ts" || echo "FAIL: actions/$f.ts missing"
done
# Validation schemas exist
for f in projects estimates nodes; do
  [ -f "src/lib/validation/$f.ts" ] && echo "PASS: validation/$f.ts" || echo "FAIL: validation/$f.ts missing"
done
# Domain types exist
[ -f "src/lib/types/domain/nodes.ts" ] && echo "PASS: domain/nodes.ts" || echo "FAIL: domain/nodes.ts missing"
# TypeScript compiles
npx tsc --noEmit && echo "PASS: TypeScript" || echo "FAIL: TypeScript"
echo "=== Manual checks needed: database tables, RLS, triggers (Supabase dashboard) ==="
```

**If any check fails:** Stop and fix the data layer issue before proceeding. Do not attempt to build UI on incomplete infrastructure.

---

## Phase 1B-0: Foundation Layer

### 1B-0.0a: Radix Wrappers + Enforcement Script (0.5 session)

**Goal:** Install all dependencies, build the Radix wrapper layer and design system enforcement script. This sub-phase produces the components that all other components compose.

**Blocking Prerequisite:** CP-0 approved. Figma walkthrough complete at CP-0 (moved from 1B-0.0). Dependencies installed.

**NOT in scope:** Field primitives, layout primitives, feature components. Those are 1B-0.0b.

#### Dependencies to Install

```bash
npm install immer nanoid @tanstack/react-virtual@^3.13.0 \
  @radix-ui/react-dialog @radix-ui/react-dropdown-menu \
  @radix-ui/react-select @radix-ui/react-popover \
  @radix-ui/react-tooltip @radix-ui/react-tabs \
  @radix-ui/react-alert-dialog @radix-ui/react-toast \
  @radix-ui/react-collapsible @radix-ui/react-toggle \
  @radix-ui/react-context-menu \
  @radix-ui/react-scroll-area @radix-ui/react-separator \
  lucide-react
```

Note: `lucide-react` is the recommended icon library pending Zac review at CP-1 (D8). If rejected, swap to Phosphor -- the wrapper pattern isolates the change.

Note: `@radix-ui/react-scroll-area` provides cross-browser scrollbar styling for the detail panel (20+ fields). `@radix-ui/react-separator` provides `role="separator"` ARIA handling for editor sections. Both are small (~5KB each).

#### Contract Creation (First 15 Minutes)

A research subagent creates `shared-components.contract.md` BEFORE wrapper agents start. This contract defines:
- Wrapper rules (forwardRef, displayName, token-only styling)
- Import restrictions (no direct @radix-ui imports outside `src/components/shared/`)
- Shape rules (sharp corners on containers, pill on buttons)

#### Deliverables

**Radix UI Wrappers (Layer 0: `src/components/shared/`)**

| File | Wraps | Lines (est.) |
|---|---|---|
| `dialog.tsx` | `@radix-ui/react-dialog` | ~80 |
| `alert-dialog.tsx` | `@radix-ui/react-alert-dialog` | ~70 |
| `dropdown-menu.tsx` | `@radix-ui/react-dropdown-menu` | ~100 |
| `context-menu.tsx` | `@radix-ui/react-context-menu` | ~90 |
| `select.tsx` | `@radix-ui/react-select` | ~120 |
| `popover.tsx` | `@radix-ui/react-popover` | ~60 |
| `tooltip.tsx` | `@radix-ui/react-tooltip` | ~50 |
| `toast.tsx` | `@radix-ui/react-toast` | ~100 |
| `tabs.tsx` | `@radix-ui/react-tabs` | ~60 |
| `collapsible.tsx` | `@radix-ui/react-collapsible` | ~40 |
| `toggle.tsx` | `@radix-ui/react-toggle` | ~30 |
| `scroll-area.tsx` | `@radix-ui/react-scroll-area` | ~50 |
| `separator.tsx` | `@radix-ui/react-separator` | ~20 |

**Wrapper Rules:**
- `forwardRef` on every styled export (preserves Radix ref forwarding)
- All colors via `var(--color-*)`, all spacing via `var(--space-*)`
- Sharp corners on all containers (`rounded-none` implicit -- no radius classes)
- Pill shape on buttons within dialogs (`rounded-full`)
- `data-[state=open/closed]` for animation via Tailwind selectors
- `displayName` set for DevTools

#### Design System Enforcement Setup

Create `scripts/design-system-check.sh`:
```bash
#!/bin/bash
VIOLATIONS=0
# Direct Radix imports outside shared/
grep -r "from '@radix-ui/" src/components/ --include="*.tsx" \
  | grep -v "src/components/shared/" && VIOLATIONS=$((VIOLATIONS+1))
# Forbidden border-radius
grep -rn "rounded-sm\|rounded-md\|rounded-lg\|rounded-xl" src/ \
  --include="*.tsx" && VIOLATIONS=$((VIOLATIONS+1))
# Direct Tailwind colors
grep -rn "bg-white\|bg-gray-\|text-gray-\|bg-blue-\|text-blue-" src/ \
  --include="*.tsx" && VIOLATIONS=$((VIOLATIONS+1))
# Hardcoded hex in className
grep -rn 'className=.*#[0-9a-fA-F]\{3,6\}' src/ \
  --include="*.tsx" && VIOLATIONS=$((VIOLATIONS+1))
[ $VIOLATIONS -eq 0 ] && echo "PASS" || echo "FAIL: $VIOLATIONS categories"
```

**Script limitations (acknowledged):** This catches ~80% of violations (direct Tailwind colors, forbidden radii, hardcoded hex). It does NOT catch: hardcoded pixel values in inline styles, incorrect token usage (e.g., text token for background), or missing more-specific tokens. The reviewer agent and checkpoint reviews cover the remaining 20%.

#### Agent Assignments

| Agent | Task | Write Access |
|---|---|---|
| Research | Create `shared-components.contract.md` (first 15 min) | `contracts/` |
| Agent 1 | Radix wrappers: dialog, alert-dialog, dropdown-menu, context-menu, select | `src/components/shared/` |
| Agent 2 | Radix wrappers: popover, tooltip, toast, tabs, collapsible, toggle, scroll-area, separator | `src/components/shared/` |
| Agent 3 | Design system enforcement script + verification harness | `scripts/` |
| Reviewer | Design system compliance check on all output | Read-only |

**Verification:**
```bash
# All Radix wrappers exist
count=$(find src/components/shared -name "*.tsx" | wc -l)
[ "$count" -ge 13 ] && echo "PASS" || echo "FAIL: Expected 13+, got $count"
# Design system check passes
bash scripts/design-system-check.sh
# TypeScript compiles
npx tsc --noEmit
```

---

### 1B-0.0b: Field Primitives + Layout Primitives (0.5 session)

**Goal:** Build field primitives and layout primitives that compose the Radix wrappers from 1B-0.0a. These are the building blocks for all feature pages.

**Blocking Prerequisite:** 1B-0.0a complete and passing verification.

**NOT in scope:** Feature-specific components, tree components, page-level layouts. Radix wrappers are done (1B-0.0a).

#### Deliverables

**Field Primitives (Layer 0: `src/components/shared/`)**

| File | Purpose |
|---|---|
| `button.tsx` | Primary (pill, solid), Secondary (pill, border), Ghost (no border), Icon (circle) |
| `badge.tsx` | Status badge (pill shape) |
| `text-field.tsx` | Text input with label, error state, sharp corners |
| `number-field.tsx` | Number input with formatting |
| `money-field.tsx` | Currency input ($ prefix, 2dp display, monospace for alignment). Non-trivial: formatting, prefix rendering, precision handling. Budget extra review time. |
| `rate-field.tsx` | Percentage input (% suffix). Similar complexity to money-field. |
| `select-field.tsx` | Labeled select composing the Select wrapper |
| `textarea.tsx` | Auto-resize text area |
| `checkbox.tsx` | Checkbox field |
| `skeleton.tsx` | Loading skeleton (pulse animation on `--color-bg-secondary`) |
| `empty-state.tsx` | "No data" state with CTA |
| `error-state.tsx` | Error display with retry action |

**Layout Primitives (Layer 1: `src/components/layout/`)**

| File | Purpose | Complexity Note |
|---|---|---|
| `page-header.tsx` | Title + subtitle + action buttons | Standard |
| `split-pane.tsx` | Resizable tree/detail split | **HIGH complexity:** Pointer event handling, min/max constraints, user-width persistence. Budget 200+ lines. |
| `panel.tsx` | Bordered content panel with optional header | Standard |
| `status-bar.tsx` | Bottom status strip (node count, total, estimate status) | Standard |

#### Agent Assignments

| Agent | Task | Write Access |
|---|---|---|
| Agent 1 | Field primitives: text-field, number-field, money-field, rate-field, select-field, textarea, checkbox | `src/components/shared/` |
| Agent 2 | Button, badge, skeleton, empty-state, error-state | `src/components/shared/` |
| Agent 3 | Layout primitives: page-header, split-pane, panel, status-bar | `src/components/layout/` |
| Reviewer | Design system compliance + functional correctness check (verify token usage, prop forwarding, formatting behavior on money-field and rate-field) | Read-only |

**Verification:**
```bash
# All field + layout primitives exist
field_count=$(find src/components/shared -name "*.tsx" | wc -l)
layout_count=$(find src/components/layout -name "*.tsx" | wc -l)
[ "$field_count" -ge 22 ] && echo "PASS: shared" || echo "FAIL: Expected 22+, got $field_count"
[ "$layout_count" -ge 4 ] && echo "PASS: layout" || echo "FAIL: Expected 4+, got $layout_count"
# Design system check passes
bash scripts/design-system-check.sh
# TypeScript compiles
npx tsc --noEmit
```

**Functional verification (manual):**
- money-field renders `$1,234.56` correctly with monospace alignment
- rate-field renders `12.5%` correctly
- split-pane resizes with pointer drag and respects min/max constraints

**Checkpoint CP-1:** Zac reviews deployed shared components. "Does this design language feel right? Icons, spacing, field styles." Blocking -- visual direction rejection blocks all feature work.

---

### 1B-0.1: Navigation & Layout (0.75 session)

**Goal:** Fix the sidebar (add icons for collapsed state), add breadcrumbs, finalize route structure, create skeleton layouts for all route levels, add catalog placeholder page.

**NOT in scope:** Project/estimate data pages (1B-0.2), tree components (1B-0.3), settings functionality (1B-6).

#### Deliverables

**Sidebar Enhancement:**
- Add Lucide icons to all 4 nav items (Dashboard, Projects, Catalog, Settings)
- Collapsed state shows icons only. Expanded shows icon + label.
- Active item: left accent border + `--color-surface-active` background
- Hover: `--color-surface-hover` background

**Breadcrumbs Component (`src/components/nav/breadcrumbs.tsx`):**
- Client component using `usePathname()` + `useParams()`
- Client-side `Map<string, string>` cache for entity name fetching (no SWR dependency). Fetches entity names via lightweight API calls, caches results in a Map for the session.
- Arrow/chevron separators between segments
- Static labels for known segments (Dashboard, Projects, Settings, etc.)
- Renders in the header area between logo and UserMenu

**Route Layouts:**

| File | Creates | Purpose |
|---|---|---|
| `src/app/(protected)/projects/[projectId]/layout.tsx` | NEW | Fetches project by ID, contributes breadcrumb segment |
| `src/app/(protected)/projects/[projectId]/estimates/[estimateId]/layout.tsx` | NEW | Fetches estimate metadata, breadcrumb segment, negative-margin override for full-bleed workspace |

**Catalog Placeholder:**

| File | Creates | Purpose |
|---|---|---|
| `src/app/(protected)/catalog/page.tsx` | NEW | Placeholder page with empty-state CTA: "Catalog coming soon. Add items to the catalog from the estimate tree." Actual catalog functionality comes in 1B-2. |

**React `cache()` Data Functions:**

| File | Functions |
|---|---|
| `src/lib/data/projects.ts` | `getProjectCached(projectId)` |
| `src/lib/data/estimates.ts` | `getEstimateCached(estimateId)`, `getNodesCached(estimateId)`, `getViewStateCached(estimateId)` |

**Loading Skeletons:**

| Route | Skeleton Shape |
|---|---|
| `dashboard/loading.tsx` | Stat cards + recent items |
| `projects/loading.tsx` | Table/list skeleton rows |
| `[projectId]/loading.tsx` | Project header + tabs |
| `[estimateId]/loading.tsx` | Tree panel + detail panel with placeholder rows |

**Verification:**
```bash
# Route layouts exist
[ -f "src/app/(protected)/projects/[projectId]/layout.tsx" ] && echo "PASS" || echo "FAIL"
[ -f "src/app/(protected)/projects/[projectId]/estimates/[estimateId]/layout.tsx" ] && echo "PASS" || echo "FAIL"
# Catalog placeholder exists
[ -f "src/app/(protected)/catalog/page.tsx" ] && echo "PASS" || echo "FAIL"
# Sidebar renders icons when collapsed
# Breadcrumbs render on all protected pages
# TypeScript compiles
npx tsc --noEmit
```

**Checkpoint CP-2:** Zac looks at the deployed preview for 5 minutes. "Does this feel like ShossyWorks or generic AI output?" Blocking -- rejection means visual direction adjustment needed.

---

### 1B-0.2: Project & Estimate Pages (0.75 session)

**Goal:** Build the project list, project detail, estimate list, and create/edit flows using the shared component library.

**Blocking Prerequisite:** Phase 1A verification passed (tables, RLS, triggers, server actions confirmed).

**NOT in scope:** Tree view (1B-0.3), dashboard content (deferred to Phase 2), settings page (1B-6).

#### Deliverables

**Project List Page (`src/app/(protected)/projects/page.tsx`):**
- Server component fetching projects via `getProjectsCached()`
- Data table with columns: Name, Status (badge), Estimate Count, Last Modified
- Empty state with "Create Project" CTA
- "New Project" button in page header

**Project Detail Page (`src/app/(protected)/projects/[projectId]/page.tsx`):**
- Server component fetching project details
- Project info display (status badge, dates, description)
- Estimate list section below project info
- "New Estimate" button

**Create/Edit Dialogs:**
- `CreateProjectDialog` using shared Dialog wrapper + form fields
- `EditProjectDialog` pre-populated with project data
- `CreateEstimateDialog` with name, description, status (Draft default)
- All mutations via server actions returning `ActionResult<T>`
- Zod validation on form submission

**Estimate List (within project detail):**
- Table: Name, Status, Node Count, Total, Last Modified
- Click to navigate to estimate editor
- Empty state with "Create Estimate" CTA

**Key Patterns Established:**
- Server component data fetching -> client component rendering
- Dialog-based create/edit (not separate pages)
- Server action mutations with optimistic UI using `useTransition` (provides `isPending` for loading indicators)
- Error handling via toast notifications (see Error & Loading States section below)

**Verification:**
```bash
# Can navigate Dashboard -> Projects -> Project -> Estimates
# Can create a project through the UI
# Can create an estimate through the UI
# Empty states render with CTAs
npx tsc --noEmit
bash scripts/design-system-check.sh
```

---

### 1B-0.3: Tree View Core (1.5 sessions)

**This is the most critical phase in the entire plan.** The tree view is the product. Everything else is supporting infrastructure.

**v2 change:** Increased from 1.0 to 1.5 sessions based on feasibility review. The reducer alone (18+ action types, HYDRATE, flatVisibleRows, undo initialization, Immer+enableMapSet) is 300-500 lines. Virtual scroller integration with custom ARIA is a known complexity area.

**Goal:** Render the estimate tree from server-fetched data with expand/collapse, type-differentiated rows, inline cost totals, and virtual scrolling.

**NOT in scope:** Detail panel editing (1B-0.4), keyboard shortcuts beyond expand/collapse (1B-0.5), context menu (1B-0.5), inline name editing (1B-0.5).

#### Contract Creation (Start of 1B-0.3)

A research subagent creates `tree-state.contract.md` and `tree-component.contract.md` as the FIRST step, BEFORE the main implementation begins. These contracts define:

**tree-state.contract.md:**
- Complete state shape interface
- Action union type
- HYDRATE semantics
- `flatVisibleRows` computation rule (computed BY the reducer, via the `computeFlatVisibleRows` helper)
- Pending mutation tracking
- **External interface for 1B-0.4:** dispatch signature, state selector hooks (`useTreeState()`, `useTreeDispatch()`), provider component API
- Set serialization rule: runtime type is `Set<string>` for O(1) lookups; persistence functions convert `Set -> Array` at serialization boundary
- Undo strategy: Immer patches via `enablePatches()` -- store inverse patches, cap at 50 entries

**tree-component.contract.md:**
- Three-layer architecture (container/renderer/row)
- Prop interfaces for each layer
- Dispatch-only communication rule: panel and tree never call each other directly
- No direct Supabase from client components

#### State Architecture

Create `src/components/estimate/tree/hooks/use-estimate-tree-reducer.ts`:

```typescript
// enableMapSet() and enablePatches() called at module level (top of file)
import { enableMapSet, enablePatches } from 'immer';
enableMapSet();
enablePatches();

interface EstimateTreeState {
  // Data (server-authoritative)
  nodesById: Record<string, NodeWithDetails>;
  childrenOf: Record<string, string[]>;
  rootIds: string[];

  // UI state (client-only)
  expandedIds: Set<string>;
  selectedIds: Set<string>;
  focusedId: string | null;
  editingId: string | null;

  // Mutation tracking
  pendingMutations: PendingMutation[];
  undoStack: Patch[][];   // Immer inverse patches, capped at 50
  redoStack: Patch[][];

  // Sync state
  lastSyncedAt: string | null;
  conflictIds: Set<string>;

  // Derived (computed in reducer, not in render)
  flatVisibleRows: FlatRow[];
  totalCount: number;
}
```

**Note on Set serialization:** `expandedIds` and `selectedIds` use `Set<string>` for O(1) runtime lookups. For view state persistence (1B-6), convert `Set -> Array` at the serialization boundary. The Set remains the runtime type.

**Reducer action types (complete union from day one):**
- Data mutations: `NODE_CREATE`, `NODE_UPDATE`, `NODE_UPDATE_DETAILS`, `NODE_DELETE`, `NODE_MOVE`, `NODE_DUPLICATE`, `NODE_FLAG`, `NODE_SET_VISIBILITY`
- Optimistic resolution: `MUTATION_CONFIRMED`, `MUTATION_CONFIRMED_VOID`, `MUTATION_FAILED`
- Remote (full logic, unwired): `REMOTE_NODE_UPSERT`, `REMOTE_NODE_DELETE`, `REMOTE_NODES_BULK` -- implemented with complete state mutations so the reducer logic is tested and type-checked, but not wired to any event source until Realtime is connected
- UI: `TOGGLE_EXPAND`, `EXPAND_ALL`, `COLLAPSE_ALL`, `SET_SELECTED`, `SET_FOCUSED`, `SET_EDITING`
- Lifecycle: `HYDRATE`, `UNDO`, `REDO`

**Undo/redo strategy:** Uses Immer's `enablePatches()`. Each `produce()` call returns patches and inverse patches. The undo stack stores inverse patches (not full state snapshots). This is memory-efficient: 50 undo entries store only the changed fields, not 50 copies of a 2000-node state. Undoable actions: `NODE_UPDATE`, `NODE_UPDATE_DETAILS`, `NODE_MOVE`, `NODE_CREATE`. Delete is NOT undoable (confirmation dialog is standard UX).

#### Component Hierarchy

```
src/app/(protected)/projects/[projectId]/estimates/[estimateId]/page.tsx
  (Server component: fetches nodes via getNodesCached)
  -> EstimateTreeContainer (client component: useReducer + Immer)
     -> TreeToolbar (add node buttons, search, view toggles)
     -> SplitPane (resizable, tree left / panel right)
        -> VirtualTreeRenderer (@tanstack/react-virtual)
           -> TreeNodeRow (React.memo, 5-6 direct props)
              -> TreeCell (depth-based indentation + toggle + type icon + name)
              -> TotalCell (right-aligned, monospace, formatted currency)
        -> NodeDetailPanel (placeholder -- implemented in 1B-0.4)
     -> StatusBar (node count, estimate total, status)
```

#### flatten-tree.ts

`src/components/estimate/tree/utils/flatten-tree.ts` exports a **pure function** `computeFlatVisibleRows(nodesById, childrenOf, rootIds, expandedIds): FlatRow[]`. This function is called FROM WITHIN the reducer on every action that changes tree structure or expanded state. It is NOT a hook. It is NOT called from components. It is a reducer helper.

#### Tree Row Layout

CSS Grid with two columns for Phase 1B-0 MVP:
- **Name** (tree column, flex: 1, min 200px): Indentation + chevron + type icon + name
- **Total** (120px fixed): Right-aligned currency, `--font-mono`

Indentation: 20px per depth level, capped at depth 6 (120px max visual indent).

Row height: Fixed 40px for all node types. **Phase 2 note:** If density modes (D9) or inline editing require variable row heights, switch to `estimateSize` + `measureElement` in the virtualizer.

Visual differentiation by type:
- Groups: `--font-semibold`, `--color-text-primary`
- Assemblies: `--font-medium`, `--color-text-primary`
- Items: `--font-normal`, `--color-text-secondary`
- Empty cells for inapplicable columns (not "N/A" or "-")

#### ARIA Implementation

- Container: `role="tree"` with `aria-label="Estimate items"`
- Each row: `role="treeitem"` with roving tabindex
- Required attributes on every row (mandatory for virtualized trees): `aria-level`, `aria-setsize` (uses `flatVisibleRows.length` via virtualizer `count` prop), `aria-posinset`
- Parent rows: `aria-expanded="true|false"`
- `aria-live="polite"` region for screen reader announcements (expand/collapse, add/delete)

**Note on virtualized focus:** When a focused node scrolls out of view and its DOM element is removed, focus state is tracked in the reducer (`focusedId`), not in the DOM. When the node scrolls back into view, `tabindex="0"` is restored from `focusedId`. This is critical for keyboard navigation with virtualization.

#### Deliverables -- Tiered

**Tier 1 (must complete in session 1 of 1.5):**
- [ ] `use-estimate-tree-reducer.ts` with complete action union and HYDRATE logic
- [ ] `computeFlatVisibleRows` helper in `flatten-tree.ts`
- [ ] `estimate-tree-container.tsx` client component with provider
- [ ] `virtual-tree-renderer.tsx` with `useVirtualizer`
- [ ] `tree-row.tsx` with `React.memo` and type-differentiated rendering
- [ ] `tree-cell.tsx` with depth-based indentation
- [ ] Server component page wiring (`page.tsx` fetches nodes, passes to container)
- [ ] Tree renders with proper nesting from server-fetched data
- [ ] Expand/collapse works

**Tier 2 (session 2 of 1.5):**
- [ ] `tree-toolbar.tsx` with "Add Group", "Add Assembly", "Add Item" buttons
- [ ] `status-bar.tsx` showing node count + total
- [ ] All 3 node types display correctly with type-specific formatting
- [ ] Add node (group/assembly/item) works via toolbar buttons
- [ ] Delete node works with AlertDialog confirmation
- [ ] Full ARIA implementation (role="tree", aria-level, aria-setsize, aria-posinset, aria-expanded, aria-live)

#### Performance Testing Protocol

After the reducer is built (end of Tier 1 or start of Tier 2):
1. Generate 2000 synthetic nodes (mix of groups, assemblies, items at various depths)
2. Measure time for: `TOGGLE_EXPAND`, `NODE_CREATE`, `NODE_DELETE`, `NODE_MOVE`
3. **Target: <16ms per action** (one frame budget at 60fps)
4. If any action exceeds 16ms at 2000 nodes: Profile to identify bottleneck
5. If `flatVisibleRows` is the bottleneck: Move computation to `useMemo` (defer the IRB recommendation for this specific computation)
6. If Immer `produce()` is the bottleneck: Evaluate whether `enablePatches()` overhead is contributing; consider smaller draft scopes

#### Tree View Overrun Protocol

| Overrun Level | Trigger | Action |
|---|---|---|
| 1.5 sessions | Within plan budget | Continue normally. This is the expected completion time. |
| 2.0 sessions | Budget exceeded by 0.5 | STOP and evaluate. Identify bottleneck: reducer? virtualizer? ARIA? If ARIA is the bottleneck, defer full ARIA to 1B-0.5 and ship with basic `role="tree"` only. If virtualizer is the bottleneck, evaluate Virtualization Fallback Plan. |
| 2.5 sessions | Budget exceeded by 1.0 | The tree architecture may have a fundamental issue. Convene with Zac to discuss scope reduction: remove virtual scrolling for Phase 1B (use simple list with `React.memo` on rows; add virtualization in Phase 2 when it is proven needed for real data sizes). |

#### Virtualization Fallback Plan

If `@tanstack/react-virtual` integration takes >4 hours in 1B-0.3:

| Priority | Strategy | Trade-off |
|---|---|---|
| Primary | `@tanstack/react-virtual` with fixed 40px rows | Best performance, more integration effort |
| Fallback 1 | `@tanstack/react-virtual` with `estimateSize` + `measureElement` | Needed if dynamic heights emerge; more complex |
| Fallback 2 | No virtualization: simple list with `React.memo` on `TreeNodeRow` | Viable for Phase 1B if estimates stay under 500 visible rows. Simplest. Add virtualization in Phase 2 when it is proven needed. |
| Decision trigger | If virtualizer integration takes >4 hours, evaluate whether complexity is justified for Phase 1B data volumes |

**Verification:**
```bash
npx tsc --noEmit
bash scripts/design-system-check.sh
# Tree renders with 3+ levels of nesting
# Expand/collapse toggles work
# Add/delete nodes work
# Virtual scrolling renders only 30-50 DOM nodes regardless of data size
# Performance: <16ms per reducer action at 2000 nodes
```

**Gate for 1B-0.4:** `use-estimate-tree-reducer.ts` MUST pass TypeScript compilation and export the documented provider (`EstimateTreeProvider`), state hook (`useTreeState`), and dispatch hook (`useTreeDispatch`) before 1B-0.4 agents begin work. If the reducer interface is not stable, 1B-0.4 is blocked.

---

### 1B-0.4: Detail Panel & Node Editing (1 session)

**Goal:** Build the persistent side panel for editing the selected node. Type-specific editors for item, assembly, and group nodes. Zod validation on blur. Optimistic save via server actions.

**Blocking Prerequisite:** 1B-0.3 reducer interface complete and stable. Specifically: `EstimateTreeProvider`, `useTreeState()`, `useTreeDispatch()` exported and compiling. 1B-0.4 agents code against the `tree-state.contract.md` interface.

**NOT in scope:** Keyboard shortcuts (1B-0.5), context menu (1B-0.5), inline name editing (1B-0.5), drag-and-drop (Phase 2).

#### Detail Panel Architecture

```
NodeDetailPanel (switches editor by node_type, uses ScrollArea wrapper for overflow)
  -> GroupEditor (name, description)
  -> AssemblyEditor (name, quantity, unit, ratio, specifications)
  -> ItemEditor (20+ fields from node_item_details)
     Sections (separated by Separator wrapper):
       Basic: name, description, quantity, unit, unit_cost
       Cost Breakdown: material_cost, labor_cost, equipment_cost, subcontractor_cost
       Markup: markup_rate, overhead_rate, contingency_rate, tax_rate
       Vendor: vendor_id, lead_time, delivery_notes
       Allowance: is_allowance, allowance_budget, allowance_status
       Classification: cost_code_id, phase_id
  -> NotesPanel (node_notes CRUD, markdown support, client_visible toggle)
```

**Communication Pattern:** Tree dispatches `SET_SELECTED`. Panel reads selected node from state via `useTreeState()` selector hook. Panel edits dispatch `NODE_UPDATE` / `NODE_UPDATE_DETAILS` back through the reducer via `useTreeDispatch()`. Panel saves via `useTransition` (not standalone `startTransition`) + server action, dispatches `MUTATION_CONFIRMED` / `MUTATION_FAILED` on completion. The `isPending` flag from `useTransition` drives the "unsaved indicator" on fields with pending mutations.

**The panel and tree never communicate directly. They share state through the reducer. Either can be replaced without touching the other.**

#### Field Behavior

- Text fields: save on blur (debounced 500ms)
- Number fields: save on blur, format on blur (show raw during edit)
- Currency fields: monospace font, $ prefix, 2dp display, 4dp internal precision
- Select fields: save on change
- Validation: Zod schema validation on blur, inline error messages below fields
- Unsaved indicator: subtle dot or border change on fields with pending mutations (driven by `useTransition`'s `isPending`)

#### Notes Panel

- List of notes for selected node (from `node_notes` table)
- Create new note (markdown editor -- simple textarea for Phase 1B)
- `is_client_visible` toggle per note
- `is_internal` toggle per note
- Soft-delete (archived, not destroyed)
- Server actions: `notes.ts` (create, update, delete)

#### Deliverables Checklist

- [ ] `node-detail-panel.tsx` with type-based editor switching + ScrollArea for overflow
- [ ] `group-editor.tsx`
- [ ] `assembly-editor.tsx`
- [ ] `item-editor.tsx` with sectioned layout (Separator between sections)
- [ ] `notes-panel.tsx` with CRUD
- [ ] `use-tree-mutation.ts` hook (dispatch + `useTransition` + server action pattern)
- [ ] Zod validation schemas for all node types
- [ ] Server actions for notes CRUD
- [ ] Selecting a node in tree shows its editor in panel
- [ ] Editing fields saves via server action with optimistic update
- [ ] Validation errors display inline

**Verification:**
```bash
npx tsc --noEmit
bash scripts/design-system-check.sh
# Select node in tree -> editor appears in panel
# Edit item details -> saves to database
# Validation errors show for invalid input
# Notes CRUD works
# isPending indicator shows during save
```

**Checkpoint CP-3:** Zac uses the tree on his own device for 15-30 minutes. Reports what feels wrong. **This is the most important checkpoint.** It covers BOTH tree navigation AND panel editing. If either aspect is rejected, we catch it before building features on top.

**Note:** If CP-3 results in tree navigation approval but panel editing rejection, the panel can be reworked independently (that is the point of the three-layer architecture). If tree navigation itself is rejected, see Checkpoint Failure Protocol.

---

### 1B-0.5: Tree Polish -- Move, Keyboard, Context Menu (0.75 session)

**Goal:** Complete keyboard navigation, indent/outdent, context menu, and inline name editing.

**NOT in scope:** Search/filtering (1B-5), settings (1B-6), drag-and-drop (Phase 2), full inline editing beyond name (Phase 2).

#### Keyboard Navigation (Full WAI-ARIA Tree Pattern)

| Key | Action |
|---|---|
| Arrow Down | Focus next visible row |
| Arrow Up | Focus previous visible row |
| Arrow Right | Expand collapsed parent / focus first child / no-op on leaf |
| Arrow Left | Collapse expanded parent / focus parent / no-op on collapsed root |
| Home | Focus first row |
| End | Focus last visible row |
| Enter | Select focused row (open in detail panel) |
| Space | Toggle selection (multi-select) |
| Escape | Clear selection / exit edit mode |
| F2 | Start inline name editing on focused row |
| Delete | Delete focused node (with confirmation) |
| Ctrl+] | Indent: move node under previous sibling |
| Ctrl+[ | Outdent: move node to parent's parent |
| Ctrl+D | Duplicate focused node |
| Ctrl+Z | Undo |
| Ctrl+Shift+Z | Redo |

#### Context Menu

Right-click on a tree row shows a dropdown menu (using shared ContextMenu wrapper):
- Add Child (Group / Assembly / Item)
- Duplicate
- Indent / Outdent
- Toggle Client Visibility
- Flag/Unflag
- Delete (with confirmation)

#### Inline Name Editing

- F2 or double-click activates edit mode on the name cell
- Enter commits and returns focus to row
- Escape cancels and restores original value
- Tab commits and moves to next row
- Single text field only -- not full inline editing

#### Move Operations

- `NODE_MOVE` action in reducer: updates `childrenOf`, `sort_order`, recomputes `flatVisibleRows`
- Server action: `moveNode(id, newParentId, newIndex)`
- Focus stays on the moved node after indent/outdent
- Screen reader announcement: "Node moved to level N"

#### Deliverables Checklist

- [ ] `use-tree-keyboard.ts` hook with full keyboard map
- [ ] Context menu on right-click
- [ ] Inline name editing (F2 / double-click)
- [ ] Indent/outdent via Ctrl+]/[
- [ ] Undo/redo via Immer patches (capped at 50 entries)
- [ ] Focus management: node deletion moves focus to sibling/parent
- [ ] `aria-live` announcements for all state changes

**Verification:**
```bash
npx tsc --noEmit
bash scripts/design-system-check.sh
# Arrow keys navigate between rows
# Right/Left expand/collapse
# Tab exits tree to next UI element
# Ctrl+]/[ indents/outdents
# Context menu shows all actions
# F2 activates inline name editing
# Undo/redo works for NODE_UPDATE and NODE_MOVE
```

---

### 1B-T1: Reducer + Component Testing (0.5 session)

**v2 addition.** The tree reducer is the single most testable and test-worthy piece of code in the project. For a product where two prior UI attempts FAILED, automated tests on the core state management are essential.

**Goal:** Write unit tests for the reducer and smoke tests for the shared component layer.

**NOT in scope:** E2E tests, visual regression tests, full component integration tests.

#### Reducer Unit Tests

File: `src/components/estimate/tree/hooks/__tests__/use-estimate-tree-reducer.test.ts`

| Test Case | What It Verifies |
|-----------|-----------------|
| HYDRATE | Correctly converts server `NodeWithDetails[]` to flat normalized state (`nodesById`, `childrenOf`, `rootIds`) |
| NODE_CREATE | Adds node to `nodesById`, updates `childrenOf`, recomputes `flatVisibleRows` |
| NODE_DELETE | Removes node and descendants from state, updates parent's `childrenOf` |
| NODE_MOVE | Re-parents node, updates `childrenOf` for old and new parent, updates `sort_order` |
| TOGGLE_EXPAND | Toggles node in `expandedIds`, recomputes `flatVisibleRows` |
| EXPAND_ALL / COLLAPSE_ALL | All parent nodes expanded/collapsed |
| UNDO / REDO | Inverse patches restore previous state correctly |
| flatVisibleRows | Correct ordering: respects depth, expanded state, sort_order |
| NODE_UPDATE | Updates node fields in `nodesById` |
| REMOTE_NODE_UPSERT | Merges remote node into state (full logic, not no-op) |
| Performance | 2000-node TOGGLE_EXPAND completes in <16ms |

#### Component Smoke Tests

File: `src/components/shared/__tests__/shared-components.test.tsx`

| Test | What It Verifies |
|------|-----------------|
| Button renders all 4 variants | Primary, Secondary, Ghost, Icon all render without error |
| money-field formats correctly | `$1,234.56` rendering, monospace className |
| rate-field formats correctly | `12.5%` rendering |
| Dialog opens and closes | Radix wrapper renders overlay and content |
| Empty-state renders CTA | CTA button present with correct text |
| error-state renders retry | Retry action button present |

#### Accessibility Audit Plan

Not automated tests, but a documented audit protocol run manually at CP-3:

| Screen Reader | Browser | What to Test |
|---|---|---|
| NVDA | Chrome | Tree navigation (arrow keys, expand/collapse, focus announcements) |
| VoiceOver | Safari | Tree navigation + detail panel field labels |

Results recorded in `docs/ui/feedback/accessibility-audit.md`.

**Verification:**
```bash
# All tests pass
npx vitest run --reporter=verbose
# Test count
test_count=$(find src -name "*.test.ts" -o -name "*.test.tsx" | wc -l)
[ "$test_count" -ge 2 ] && echo "PASS" || echo "FAIL: Expected 2+ test files"
```

---

## Phase 1B Features (Post-Foundation)

After Phase 1B-0 completes, the feature phases from the existing plan are resequenced based on business priority and dependency analysis:

### Tier 1: Immediate (enables real usage)

#### 1B-6: Settings & Preferences (0.75 session)

**v2 change:** Increased from 0.5 to 0.75 sessions. Added schema references and form field specification.

**Why first:** Company defaults (markup rates, overhead percentages, tax rates) are used by all other features. Small scope, quick win. Also, company defaults affect snapshot baseline accuracy, so Settings must come before Snapshots.

**New packages:** None.

**Database dependencies (verify before starting):**
- `company_settings` table: If it does not exist, create migration for: `id`, `company_name` (text), `address` (JSONB: street, city, state, zip), `logo_url` (text, nullable), `default_markup_rate` (numeric), `default_overhead_rate` (numeric), `default_tax_rate` (numeric), `default_contingency_rate` (numeric), `settings_json` (JSONB, extensible). Single row per organization.
- `user_preferences` table: If it does not exist, create migration for: `id`, `user_id` (FK), `sidebar_collapsed` (boolean), `theme` (text, default 'system'), `default_density` (text, default 'default'), `preferences_json` (JSONB, extensible). One row per user.

**Deliverables:**
- Company settings form:
  - **Company Info section:** Company name (text-field), address fields (text-field x4)
  - **Default Rates section:** Markup rate (rate-field), overhead rate (rate-field), tax rate (rate-field), contingency rate (rate-field)
  - Save via server action, toast on success/failure
- User preferences panel:
  - Sidebar collapsed default (checkbox)
  - Theme selection (select-field: System, Light, Dark)
  - Default information density (select-field: Compact, Default, Comfortable) -- preview only, actual density implementation in Phase 2
- Estimate view state persistence:
  - Expand/collapse state saved to `user_preferences.preferences_json` via `Set -> Array` serialization
  - Restored on page load via HYDRATE action
  - Uses `localStorage` as immediate cache, syncs to database on blur/unload
- Server actions: `settings.ts`, `preferences.ts`

#### 1B-5: Search & Filtering (1 session)

**Why second:** Makes the tree navigable for real estimates with 100+ nodes.

**New packages:** None. Client-side filtering uses `flatVisibleRows` from reducer. Server-side search uses existing tsvector + GIN indexes.

**Deliverables:**
- Search box in tree toolbar with live filtering
- Scope selector: current estimate (default), current project, global
- Current-estimate search: client-side filtering via `flatVisibleRows`
- Cross-estimate search: server-side full-text via tsvector + GIN indexes
- Filter bar: node type, cost code, phase, cost range, flagged status
- Server actions: `search.ts`

### Tier 2: Core Features

#### 1B-2: Catalog System (2-3 sessions)

**New packages:** None.

**Deliverables:**
- "Add to Catalog" -- saves a node (or subtree including children) as a reusable template. Copies all node data (not a reference). Stored in `catalog_items` table.
- Catalog browser panel: accessible from sidebar "Catalog" link (placeholder page created in 1B-0.1). Search/filter catalog items by name, type, cost code.
- "Insert from Catalog" (copy-on-insert, per INTENT Decision #4): inserts a deep copy of the catalog item into the current tree at the selected position.
- Server actions: `catalog.ts`

#### 1B-1: Snapshots (2-3 sessions)

**New packages:** None.

**Deliverables:**
- "Create Snapshot" dialog (name, description, auto-detect status)
- Snapshot browser panel (milestones vs checkpoints)
- Snapshot viewer (read-only tree render)
- "Restore from Snapshot" with confirmation + auto-checkpoint
- "Create Estimate from Snapshot"

### Tier 3: Differentiators

#### 1B-3: Options UI (2-3 sessions)

**New packages:** None.

**Deliverables:**
- Option group/alternative management
- Visual indicators for option-owned nodes in tree
- Option set management + comparison table
- Selection AND toggle group types (INTENT Decision #19)

#### 1B-4: Client Portal (3-4 sessions)

**New packages:** Rate limiting handled at middleware level via Next.js built-in headers/middleware (no additional package). QR code generation deferred to Phase 2 if needed.

**Deliverables:**
- Share link generation with PIN
- Client estimate viewer (filtered by `client_visibility`)
- Client commenting + approval workflow
- Per-IP rate limiting (middleware-level, using Next.js headers)
- Route: `(client)/share/[token]/` with its own `layout.tsx` (no sidebar, PIN auth)

**CP-5 (after 1B-0 completes):** Zac confirms or reorders Tiers 1/2/3 based on business priority.

---

## Dashboard Page (Explicit Deferral)

**v2 addition.** The dashboard (`src/app/(protected)/dashboard/page.tsx`) currently shows two links. The plan does NOT build a full dashboard in Phase 1B. The tree editor is the priority.

**Phase 1B dashboard state:** Remains a link hub with navigation to Projects and Catalog. Loading skeleton exists (from 1B-0.1) but content is minimal.

**Phase 2 dashboard specification (deferred):**
- Stat cards: Active projects count, total estimates, recent activity count
- Recent items: last 10 edited estimates with quick-nav links
- Server-rendered with `cache()` data functions

**This deferral must be approved by Zac at CP-0.** If Zac requires a functional dashboard in Phase 1B, add 0.5 sessions to 1B-0.2 for dashboard content.

---

## Error & Loading States

**v2 addition.** Comprehensive error handling strategy covering all UI layers.

### Existing Error Boundaries

The codebase already has `error.tsx` and `global-error.tsx` error boundaries. **These are kept.** They catch unhandled errors at the route level. The plan does not replace them.

### Tree-Specific Error Handling

| Scenario | What the User Sees |
|----------|-------------------|
| `getNodes()` fails on page load | Tree-specific error boundary: "Failed to load estimate data. [Retry]" button. Uses `error-state.tsx` component within the estimate layout. |
| Tree renders with zero nodes (new estimate) | Empty state: "This estimate has no items yet. [Add Group] [Add Item]" using `empty-state.tsx` with two CTAs. |
| Individual node mutation fails | Toast notification with mapped error message (see table below). Field reverts to server value. `MUTATION_FAILED` dispatched to reducer. |
| WebSocket/Realtime disconnects | Phase 1B: no Realtime wired. `lastSyncedAt` and `conflictIds` in state are unused. No disconnect UI needed until Realtime is connected. |

### Server Action Error -> Toast Mapping

Server actions return `ActionResult<T>` with error codes. Map to user-facing messages:

| Error Code | Toast Message |
|-----------|---------------|
| `VALIDATION_ERROR` | "Invalid input: {field-specific message from Zod}" |
| `NOT_FOUND` | "This item was not found. It may have been deleted." |
| `PERMISSION_DENIED` | "You don't have permission to perform this action." |
| `CONFLICT` | "This item was modified by someone else. Please refresh." |
| `RATE_LIMITED` | "Too many requests. Please wait a moment." |
| `UNKNOWN` / unhandled | "Something went wrong. Please try again." |

### Loading States

| Route | Skeleton Pattern |
|-------|-----------------|
| Dashboard | 4 stat card skeletons + 5 list item skeletons |
| Projects list | 8 table row skeletons with column alignment |
| Project detail | Header skeleton + 4 estimate list row skeletons |
| Estimate editor | Split pane: left panel with 15 tree row skeletons, right panel with 6 field skeletons |

---

## Information Density Modes (D9)

**v2 addition.** Specification for what density modes change and where the preference is set.

**Implementation timing:** After tree view MVP (review decision, not blocking).

| Mode | Row Height | Font Size | Vertical Padding |
|------|-----------|-----------|-----------------|
| Compact | 30px | 13px | 4px |
| Default | 40px | 14px | 8px |
| Comfortable | 50px | 15px | 12px |

**Design token plan:** Add `--tree-row-height`, `--tree-font-size`, `--tree-row-padding` tokens. The density mode sets all three from a single preference.

**Preference location:** Set in Settings page (1B-6) under User Preferences. Also available as a toolbar toggle in the tree view (compact icon button group).

**Phase 2 impact:** Variable row heights require switching the virtualizer from fixed `size` to `estimateSize` + `measureElement`.

---

## Testing Strategy

**v2 addition.** Testing approach for Phase 1B.

| Layer | What | When | Tool |
|-------|------|------|------|
| Reducer unit tests | All action types, HYDRATE, flatVisibleRows, undo/redo | 1B-T1 (after 1B-0.5) | Vitest |
| Component smoke tests | Shared component rendering, prop forwarding, token usage | 1B-T1 (after 1B-0.5) | Vitest + @testing-library/react |
| Performance benchmarks | Reducer actions at 2000 nodes (<16ms target) | During 1B-0.3 | Custom benchmark script |
| Accessibility audit | NVDA/Chrome + VoiceOver/Safari on tree navigation | At CP-3 | Manual |
| Design system compliance | Forbidden patterns grep | Every commit | `design-system-check.sh` |
| TypeScript | Full type checking | Every commit | `npx tsc --noEmit` |

---

## Checkpoint Failure Protocol

**v2 addition.** What happens when a checkpoint is rejected.

### Rework Budgets

| Checkpoint | Rework Budget | What Rework Involves |
|-----------|--------------|---------------------|
| CP-1 (visual direction) | 0.5 session | Adjust shared component styling: colors, spacing, button feel. Wrappers are isolated so changes don't cascade. |
| CP-2 (navigation feel) | 0.25 session | Navigation changes are lower effort: sidebar styling, breadcrumb format, layout proportions. |
| CP-3 (tree interaction) | 1.0 session | Tree or panel adjustments. If only panel editing is rejected, rework is 0.5 session (panel is independent of tree). |

### Maximum Revision Cycles

**Maximum 2 rejection cycles per checkpoint.** After 2 rejections:
- Escalate to a structured design conversation: Zac + Claude, screen-share, 1 hour.
- Walk through specific friction points with mockups/alternatives.
- Agree on direction before third implementation attempt.

### Architecture Rejection Protocol

If CP-3 feedback challenges the three-layer architecture itself (e.g., "I want inline editing, not a side panel"):
1. **STOP implementation.**
2. Re-read the IRB analysis on why inline editing was rejected for Phase 1B (Soloway failure mode, coupling risk).
3. Present the IRB reasoning to Zac.
4. If Zac still wants inline editing after understanding the trade-offs, re-scope Phase 1B: side panel remains for Phase 1B, inline editing becomes the Phase 2 priority.
5. Do not implement inline editing in Phase 1B under any circumstances.

### Total Rework Budget

3 sessions of buffer allocated to checkpoint rework across all of Phase 1B-0. If all 3 sessions are consumed by rework, the remaining Phase 1B features shift by 3 sessions (total becomes 24-30 sessions).

---

## Figma Prototype Integration Plan

### Figma Walkthrough (at CP-0)

**v2 change:** Moved from 1B-0.0 to CP-0 so it does not block agent work during 1B-0.0a.

Zac shares Figma URLs at CP-0. No export needed -- the Figma MCP reads directly from URLs.

Steps:
1. Share Figma URLs with Zac (or receive them)
2. `get_design_context` + `get_variable_defs` on each Figma page
3. Produce token reconciliation table (Figma value -> existing token -> action)
4. Zac approves mappings (10-15 min)
5. Add any new tokens to `globals.css` + `DESIGN-SYSTEM.md`

### Figma-Architecture Conflict Resolution Protocol

**v2 addition.** What to do if Figma designs conflict with the IRB architecture.

| Conflict Type | Resolution |
|---------------|-----------|
| **Different LAYOUT** (sidebar vs top nav, panel placement) | Discuss with Zac at CP-0. The IRB recommendation has technical rationale (matches ProEst/VS Code, avoids coupling). Zac can override but must understand the trade-offs documented in the IRB analysis. |
| **INLINE EDITING** in tree rows | Do not implement. The IRB unanimously rejected this for Phase 1B due to Soloway failure mode. Show Zac the IRB reasoning. Inline editing is Phase 2. |
| **Different INFORMATION HIERARCHY** (e.g., catalog-first instead of project-first) | This is a product decision, not an architecture decision. Defer to Zac. Adjust route structure accordingly. |
| **VISUAL STYLING** conflicts with tokens | Map Figma values to tokens. If no close token exists, ADD a token to `globals.css` + `DESIGN-SYSTEM.md`. Never hardcode a Figma value in a component. |

**Rule:** Figma values are INPUT to the token system, not overrides. The token system is the source of truth. At no point does a raw Figma value appear in a component file.

### What to Extract from Each Source

| Source | Extract | Do NOT Extract |
|---|---|---|
| **EP (Attempt 1)** | Nothing except scope awareness (breadth of fields an estimating UI needs) | Everything. Wrong architecture. Zero lines reusable. |
| **Soloway (Attempt 2)** | Tree UX patterns: progressive disclosure, option bubble-up indicators, real-time sync patterns, per-row aggregation | Code, components, state management, schema references |
| **Figma** | Visual direction, layout proportions, information hierarchy, navigation structure, component styling intent | Raw pixel values, hardcoded colors, specific spacing numbers |

### The Feedback Process

**Step 1 (30-60 min, one-time):** For each Figma screen, Zac classifies every element as Binding ("exactly this"), Directional ("this vibe"), or Exploratory ("trying something, not sure").

**Step 2 (10-15 min):** Claude produces token reconciliation table. Figma value -> closest existing token -> proposed action. Zac approves mappings.

**Step 3 (ongoing):** Implementation uses tokens, references Figma for proportion/hierarchy/layout. Deployed previews compared against Figma intent at each checkpoint.

---

## Research Schedule

Research that happens DURING development, not before it:

| When | Topic | Method | Output |
|---|---|---|---|
| CP-0 | Figma token extraction | `get_design_context` + `get_variable_defs` | `docs/ui/feedback/prototype-extraction.md` |
| 1B-0.3 start | Tree performance profiling | Build + measure with 500/1000/2000 nodes | Performance baseline documented in `docs/ui/specs/tree-view.md` |
| 1B-0.4 mid | Form pattern validation | Test Zod-on-blur with real field types | Pattern documented in `docs/ui/patterns/form-patterns.md` |
| 1B-5 start | Full-text search performance | Test tsvector queries on real data | Query plan analysis in session doc |
| 1B-3 start | Option overlay rendering | Evaluate subtree swapping UX approaches | Research doc in `docs/ui/specs/options.md` |

Research is documented in `docs/ui/` (committed to git, persistent). Each spec file targets <3KB. The `docs/ui/index.md` serves as a routing table so agents load only relevant specs.

**v2 note:** All research documentation consolidated to `docs/ui/`. The `research/ui/` location from v1 is removed. Files originally planned for `research/ui/` (component-inventory, tree-view-architecture, state-management, interaction-patterns, prototype-extraction) go to `docs/ui/specs/` where they fit naturally.

---

## User Feedback Checkpoint Schedule

| Checkpoint | Phase | What Zac Sees | Decision Type | Time Required | Impact if Skipped |
|---|---|---|---|---|---|
| **CP-0** | Before any code | This plan + blocking decisions D1-D6 + Phase 1A verification + Figma walkthrough | Approve plan, confirm architecture, approve dashboard deferral | 45-75 min | Cannot start. Everything is blocked. |
| **CP-1** | After 1B-0.0b | Deployed shared components: buttons, inputs, cards, icons, dialog | "Does this design language feel right?" | 10 min | Visual direction may be wrong. All subsequent UI inherits the mistake. |
| **CP-2** | After 1B-0.1 | Deployed preview: sidebar with icons, breadcrumbs, navigation flow | "Does this feel like ShossyWorks?" | 5 min | Navigation UX may be wrong. Users interact with nav on every page. |
| **CP-3** | After 1B-0.4 | Working tree on Zac's device: select nodes, edit in panel, add/delete | 15-30 min actually using it. **Covers BOTH tree navigation AND panel editing.** | 15-30 min | The core product interaction is unvalidated. This is where EP and Soloway died. |
| **CP-4** | After 1B-0 complete | Figma prototype deep-dive + feature priority for 1B-1 through 1B-4 | Confirm or reorder Tier 1/2/3 | 30 min | Building features in wrong order wastes sessions. |
| **CP-5** | After first 1B feature ships | Mid-build review: architecture scaling? Pain points from real estimates? | Course correction | 15 min | Systemic issues compound across remaining features. |

### What Zac Must Bring

| Checkpoint | Required from Zac |
|---|---|
| CP-0 | Opinions on D1-D6, Figma file URLs if ready, approve dashboard deferral to Phase 2 |
| CP-1 | 10 minutes reviewing deployed components in browser |
| CP-2 | 5 minutes reviewing navigation/layout in browser |
| CP-3 | 15-30 minutes actually using the tree editor. Type in real estimate data if possible. |
| CP-4 | Figma links for discussion, business priority ranking for remaining features |
| CP-5 | Any real estimates attempted in the tool, friction reports |

### Blocking Decisions (Resolve at CP-0)

| # | Decision | Options | Recommendation | Time |
|---|---|---|---|---|
| D1 | Figma prototype review | Zac shares links, classifies elements | Cannot proceed without seeing designs | 30-60 min |
| D2 | Tree component strategy | (a) Custom + virtual (b) TanStack Table (c) AG Grid | **(a) Custom.** Unanimous. Full design control. | 10 min |
| D3 | State management | (a) useReducer+Immer (b) Zustand (c) Jotai | **(a) useReducer+Immer.** INTENT #13 mandates. | 10 min |
| D4 | Layout wireframe | Sidebar + tree + persistent side panel | **Approve.** Matches ProEst/VS Code. | 10 min |
| D5 | Headless UI library | (a) Radix (b) Ark UI (c) Build from scratch | **(a) Radix.** Zero styling opinions, proven a11y. | 10 min |
| D6 | Phase 1B-0 addition | (a) Add 5-5.5 session foundation (b) Absorb into existing | **(a) Add 1B-0.** Without it, all features have no foundation. | 5 min |
| D6b | Dashboard deferral | (a) Defer dashboard to Phase 2 (b) Build in 1B-0.2 | **(a) Defer.** Tree editor is the priority. Dashboard is a link hub. | 2 min |

### Review Decisions (Build First, Then Validate)

| # | Decision | When | Deliverable |
|---|---|---|---|
| D7 | Font choice (Inter vs alternatives) | After first components | Side-by-side screenshots |
| D8 | Icon library (Lucide vs Phosphor) | After shared layer | 10 common icons rendered with each |
| D9 | Information density modes | After tree MVP | Same estimate at 3 densities (see D9 spec above) |
| D10 | Side panel width (fixed vs resizable) | After panel built | Working prototype with both options |
| D11 | Inline cost totals | After tree rows render | Screenshot with/without inline costs |

---

## Documentation & Research Management

### Where UI Decisions Are Recorded

```
docs/ui/
  index.md                    -- Routing table for agents
  decisions/
    decision-log.md           -- Chronological UI decision log (UID-NNN format)
  specs/
    tree-view.md              -- Tree component spec
    detail-panel.md           -- Node editing panel spec
    shared-components.md      -- Design system wrapper spec
    navigation.md             -- Sidebar, breadcrumbs, routing
    component-inventory.md    -- Full component list with status
    state-management.md       -- Reducer patterns, state shape
    interaction-patterns.md   -- Keyboard nav, context menus, density modes
  patterns/
    form-patterns.md          -- Validation, error display, field behavior
  feedback/
    zac-approvals.md          -- Zac's feedback log (chronological)
    prototype-extraction.md   -- Figma -> token mapping decisions
    accessibility-audit.md    -- Screen reader test results
```

### Component Contracts

Create three UI-boundary contracts in `contracts/`:

| Contract | Governs | Key Rule | Created By | Created When |
|---|---|---|---|---|
| `shared-components.contract.md` | Design system wrapper layer | All Radix imports go through wrappers; zero direct `@radix-ui/*` imports in feature components; every visual property via CSS custom properties | Research subagent | First 15 min of 1B-0.0a |
| `tree-state.contract.md` | Reducer state shape, action types, provider interface | State must include slots for remote actions; `nodesById` is flat normalized map; `flatVisibleRows` computed in reducer; external interface defines dispatch signature and selector hooks; Set serialization at persistence boundary; undo via Immer patches | Research subagent | First step of 1B-0.3 |
| `tree-component.contract.md` | Container / renderer / row / panel boundaries | Tree renders data it does not own; panel communicates via dispatch only; no direct function calls between tree and panel | Research subagent | First step of 1B-0.3 |

### Agent Research Reference Pattern

Each implementation session reads:
- **L1 (always):** CLAUDE.md imports, INTENT.md, CODEBASE_MAP.md, CONTRACT-INDEX.md
- **L2 (per-task):** The specific `docs/ui/specs/*.md` file + relevant `docs/ui/patterns/*.md`
- **L2 (always):** DESIGN-SYSTEM.md (auto-loaded via CLAUDE.md import)

Agents read `docs/ui/index.md` to identify which spec files are relevant. Load only those files. Maximum L2 load: ~6KB per task.

**Context management for tree sessions (1B-0.3 through 1B-0.5):** Each session starts fresh with only L1 + the specific tree contract + the previous session's handoff doc. Do not carry over the full tree codebase in context across sessions.

---

## Risk Mitigation Matrix

| Risk | Previous Failure Mode | Mitigation Strategy | Verification |
|---|---|---|---|
| **Schema changes break UI** | EP: UI coupled to unstable schema | Data layer is complete and stable. Server actions are the boundary. Client components receive props. Phase 1A verification at CP-0. | TypeScript catches all consumer breakage at compile time. |
| **"AI slop" visual incoherence** | Both: raw Tailwind with no design system | CSS tokens + Radix wrappers + automated grep + CP-1/CP-2 checkpoints. Script catches ~80%; reviewer agent catches remaining 20%. | `design-system-check.sh` runs on every commit. Zac reviews deployed output. |
| **Component coupling prevents iteration** | Soloway: inline editing coupled tree to form state | Three-layer tree. Side panel editing. Reducer owns all state. Components communicate only through dispatch. | `tree-component.contract.md` enforces boundaries. |
| **Tree performance at scale** | N/A (never reached this stage) | Virtual scrolling from day one. Fixed row heights. `React.memo`. Only 30-50 DOM nodes. Performance testing protocol with <16ms target. | Performance test with 2000 nodes during 1B-0.3. Fallback: `useMemo` for flatVisibleRows or remove virtualization. |
| **Tree view schedule overrun** | N/A | 1.5 session allocation (up from 1.0). Overrun protocol with decision triggers at 2.0x and 2.5x. | Tiered deliverables allow partial completion assessment. |
| **Checkpoint rejection loops** | N/A | Failure protocol with rework budgets (0.25-1.0 session per CP), max 2 rejections before escalation, architecture rejection protocol. | 3 sessions of rework buffer in total budget. |
| **Keyboard accessibility gaps** | N/A | Full WAI-ARIA tree pattern. Roving tabindex. Screen reader announcements. Manual accessibility audit at CP-3. | Accessibility test matrix (NVDA/Chrome, VoiceOver/Safari). |
| **Figma intent lost in translation** | N/A | Structured extraction workflow at CP-0. Token reconciliation table. Visual checkpoints. Figma-architecture conflict resolution protocol. | `prototype-extraction.md` traces every Figma element to its token. |
| **Scope creep in tree features** | Soloway: editing bolted on after read-only | Each phase has explicit "NOT in scope" list. Contracts document what is deferred. | NOT in scope sections reviewed before each phase. |
| **Context window exhaustion during tree build** | N/A | Research subagents for exploration. Compact at 70%. Session handoffs. Fresh session starts with minimal context. | Research docs stay under 3KB. Agent context budget enforced. |
| **Undo/redo complexity explosion** | N/A | Immer patches via `enablePatches()` -- efficient inverse patches instead of full state snapshots. Phase 1B: capped at 50 entries, delete not undoable. | Explicit scope limit. Patch-based undo documented in tree-state contract. |
| **Remote action retrofit** | INTENT #13 warns against this explicitly | Remote action types implemented with full logic (not no-ops) from day one but unwired from event sources. Tested via unit tests. | `REMOTE_NODE_UPSERT` tested in reducer unit tests. |
| **@tanstack/react-virtual limitations** | N/A | Fallback plan with 3 tiers (fixed rows, dynamic rows, no virtualization). Decision trigger at 4 hours. | Virtualization fallback plan documented with decision criteria. |
| **useReducer+Immer performance at 2000 nodes** | N/A | Performance testing protocol with <16ms target. Specific fallbacks: `useMemo` for flatVisibleRows, `enablePatches()` for undo, `startTransition` for expand/collapse. | Benchmark during 1B-0.3 with 2000 synthetic nodes. |
| **No tests lead to silent regressions** | N/A | 1B-T1 testing phase: reducer unit tests (11+ cases), component smoke tests, performance benchmarks. | `npx vitest run` on every commit after 1B-T1. |

---

## Session Breakdown

| Session | Phase | Primary Deliverables | Checkpoint | Agent Strategy |
|---|---|---|---|---|
| **S1** | CP-0 + 1B-0.0a | Figma walkthrough (at CP-0), token reconciliation, Phase 1A verification, dependency install, Radix wrappers, enforcement script, `shared-components.contract.md` | CP-0 at start | Main thread for CP-0/Figma; research subagent for contract; 3 parallel agents for wrappers |
| **S2** | 1B-0.0b + 1B-0.1 start | Field primitives, layout primitives, sidebar fix, breadcrumbs begin | CP-1 at end of 1B-0.0b | 3 parallel agents (fields, layout, nav) |
| **S3** | 1B-0.1 finish + 1B-0.2 | Route layouts, loading skeletons, project list, project detail, estimate list, create/edit dialogs, catalog placeholder | CP-2 at start | 2 parallel agents (project pages, estimate pages) |
| **S4** | 1B-0.3 (session 1/1.5) | Tree reducer, container, virtual renderer, tree rows, `tree-state.contract.md`, `tree-component.contract.md` (Tier 1 deliverables) | -- | Research subagent first (verify state shape, create contracts). Main thread implements. |
| **S5** | 1B-0.3 (session 2/1.5) | Toolbar, status bar, add/delete, ARIA, performance benchmarks (Tier 2 deliverables) | -- | Main thread. Performance benchmark at end. |
| **S6** | 1B-0.4 | Detail panel, type-specific editors, notes panel, Zod validation | CP-3 at end | 3 parallel agents (item editor, assembly/group editor, notes). Gate: reducer interface must be stable. |
| **S7** | 1B-0.5 | Keyboard nav, context menu, inline name edit, indent/outdent, undo | -- | Main thread (keyboard handling is sequential) |
| **S8** | 1B-T1 + 1B-6 start | Reducer unit tests, component smoke tests, settings form begin | -- | 2 parallel agents (tests, settings) |
| **S9** | 1B-6 finish + 1B-5 | Settings completion, preferences, search box, filter bar | -- | 2 parallel agents (settings, search) |
| **S10** | 1B-5 finish + CP-4 | Cross-estimate search, filter bar polish, Figma deep-dive, priority confirm | CP-4 at end | -- |
| **S11-S12** | 1B-2: Catalog | Catalog browser, add-to/insert-from catalog | -- | 2 parallel agents (catalog UI, catalog server actions) |
| **S13-S14** | 1B-1: Snapshots | Snapshot CRUD, viewer, restore, comparison | -- | 3 parallel agents (create/browser, viewer, restore) |
| **S15-S17** | 1B-3: Options | Option groups, indicators, option sets, comparison | -- | Research subagent (option UX from Soloway). Then implementation. |
| **S18-S21** | 1B-4: Client Portal | Share links, client viewer, comments, approval | CP-5 mid-way | 3 parallel agents (share flow, viewer, approval) |

### MVP Definition

**MVP = 1B-0 + 1B-T1 + 1B-6 + 1B-5 part 1 = ~10 sessions (S1-S10)**

After MVP, Zac has:
- Working project/estimate navigation with breadcrumbs
- A functional tree editor with full CRUD, keyboard navigation, and inline name editing
- Type-specific detail panel editors with Zod validation
- Reducer unit tests and component smoke tests
- Company defaults configured
- Basic search within estimates

This is enough to START entering real estimates and discover usability issues before building catalog, snapshots, options, and client portal.

### Session Handoff Protocol

Every session produces `docs/sessions/phase-1b-state.md` with:
- Components created so far
- Contracts updated
- Decisions locked in
- Visual direction feedback from Zac (if checkpoint occurred)
- Known issues and tech debt
- What the next session should start with

---

## Contracts to Create Before Implementation

| Contract | Create When | Created By | Key Contents |
|---|---|---|---|
| `shared-components.contract.md` | First 15 min of 1B-0.0a | Research subagent | Wrapper rules, import restrictions, token-only styling, shape rules |
| `tree-state.contract.md` | First step of 1B-0.3 (S4) | Research subagent | State shape, action union, HYDRATE semantics, flatVisibleRows computation rule, external interface (dispatch + selectors for 1B-0.4), pending mutation tracking, Set serialization rule, undo via Immer patches |
| `tree-component.contract.md` | First step of 1B-0.3 (S4) | Research subagent | Three-layer architecture, prop interfaces, dispatch-only communication, no direct Supabase from client components |

---

## Dependencies on Phase 1A

This plan assumes Phase 1A is **complete** before Phase 1B-0.2 (the first session that creates/reads real data). Phase 1A verification runs at CP-0 (see Phase 1A Verification section above).

| 1A Deliverable | Used By | What Happens If Missing |
|---|---|---|
| `projects` table + RLS | 1B-0.2 (project list) | Cannot render project data |
| `estimates` table + RLS | 1B-0.2 (estimate list) | Cannot render estimates |
| `estimate_nodes` + detail tables + RLS | 1B-0.3 (tree view) | Cannot render tree |
| Core server actions (projects, estimates, nodes) | 1B-0.2+ (all CRUD) | Cannot create/edit data |
| Generated types + Zod schemas | 1B-0.2+ (all forms) | Cannot validate input |
| `node_notes` table + RLS | 1B-0.4 (notes panel) | Cannot manage notes |
| Triggers (auto-promotion, sort_order) | 1B-0.5 (indent/outdent) | Tree operations fail silently |
| `company_settings` table | 1B-6 (settings) | Must create migration as part of 1B-6 |
| `user_preferences` table | 1B-6 (settings) | Must create migration as part of 1B-6 |
| `catalog_items` table | 1B-2 (catalog) | Must create migration as part of 1B-2 |

**Phase 1B-0.0a, 1B-0.0b, and 1B-0.1 can proceed without a complete Phase 1A** because they build UI components and navigation structure that do not require real data. They use mock data for visual development.

---

## Appendix: New Design Tokens (Anticipated)

These tokens should be added during CP-0 Figma walkthrough after reconciliation confirms their values:

| Token | Purpose | Anticipated Value |
|---|---|---|
| `--tree-row-height` | Tree row height (single value for Phase 1B) | 40px (2.5rem) |
| `--tree-indent-width` | Per-level indentation | 20px (1.25rem) |
| `--detail-panel-width` | Side panel default width | 400px (25rem) |
| `--detail-panel-min-width` | Side panel minimum | 300px (18.75rem) |
| `--color-row-selected` | Selected tree row background | Maps to `--color-surface-active` unless Figma differs |
| `--color-row-hover` | Hovered tree row background | Maps to `--color-surface-hover` unless Figma differs |
| `--tree-font-size` | Tree row font size (density-dependent) | 14px default |
| `--tree-row-padding` | Tree row vertical padding (density-dependent) | 8px default |

Do NOT add these speculatively. Add only after Figma walkthrough confirms or provides values.

---
