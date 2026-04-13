# ShossyWorks UI Implementation Plan

**Version:** 1.0
**Date:** 2026-04-09
**Authority:** Implementation Review Board (5 analysts, 8 research files, 5 user decisions, 27 INTENT decisions)
**Status:** Pending user approval at CP-0

---

## Context

This plan exists because ShossyWorks has failed at UI twice before. EP coupled UI to an unstable schema and produced a monolithic mess. Soloway built read-only components that crumbled when editing was added. Both attempts produced what Zac calls "generic AI slop" -- visually incoherent interfaces with no design conviction.

What is different this time:
1. **The data layer is complete and stable.** 35+ tables, triggers, typed server actions, RLS on every table. The schema will not change under the UI's feet.
2. **A design system with CSS tokens exists before any UI code.** Every color, spacing, shadow, and radius is a custom property. Zero hardcoded styles are permitted.
3. **This plan was produced by a 5-analyst review board with 8 deep-research files** covering tree rendering, state management, keyboard accessibility, Radix UI wrappers, navigation architecture, Figma integration, realtime/optimistic updates, and documentation strategy. Every major decision has been debated, and disagreements are resolved.
4. **The component architecture is deliberately layered** to prevent the coupling that killed both prior attempts. Tree rendering is separated from node editing. Data ownership is centralized in a reducer. Components communicate through dispatch, not direct calls.

### Failure Modes This Plan Guards Against

| # | Failure Mode | What Killed | How This Plan Prevents It |
|---|---|---|---|
| FM1 | Data/UI coupling | EP | Data layer complete before UI starts. Server actions are the boundary. Client components receive props, never query directly. |
| FM2 | AI slop / design drift | Both | Design tokens enforced via wrapper layer + automated grep checks + CP-1/CP-2 visual checkpoints with Zac. |
| FM3 | Component coupling preventing iteration | Soloway | Three-layer tree (container/renderer/row). Side panel for editing (not inline). Reducer owns all state. Components are replaceable independently. |
| FM4 | Missing foundation in the plan | Current plan | Phase 1B-0 adds 4-4.5 sessions for navigation + tree view that the original plan omitted entirely. |

---

## Architecture Decisions (Resolved by IRB)

These are settled. They do not need re-debate. Implementation agents treat these as constraints.

### Unanimous (All 5 Analysts)

| ID | Decision | Reference |
|---|---|---|
| C1 | **Phase 1B-0 must be added** -- 4-4.5 sessions for core navigation + tree view. The current plan has zero allocation for this. | IRB Finding C1 |
| C2 | **useReducer + Immer for tree state.** Mandated by INTENT Decision #13. Handles local edits + remote broadcasts through the same dispatch. | INTENT #13, IRB C2 |
| C3 | **Custom tree component, not a library.** No existing tree library handles discriminated union node types + inline columns + real-time updates + virtual scrolling + the strict design system. | IRB C3 |
| C4 | **Flat normalized state: `nodesById` + `childrenOf` + `rootIds`.** O(1) lookup, O(1) updates, O(1) re-parenting. The existing `TreeNode` type with recursive `children` is for rendering only. | IRB C4, State Research |
| C5 | **Server component page fetches data; client component manages state.** `page.tsx` is a server component calling `getNodes()`. `EstimateTreeContainer` is a client component receiving `initialNodes` as props. | IRB C5 |
| C6 | **Remote action types in the reducer from day one.** `REMOTE_NODE_UPSERT`, `REMOTE_NODE_DELETE`, `REMOTE_NODES_BULK` exist as no-ops until Realtime is wired. | IRB C6, Realtime Research |
| C7 | **Design system compliance via automated enforcement.** Grep for forbidden patterns on every `.tsx` commit. PostToolUse hook reminders. | IRB C7 |
| C8 | **Side panel (persistent, not modal) for node editing.** Always visible alongside the tree. Matches ProEst/Figma/VS Code. Avoids EP modals and Soloway inline coupling. | IRB C8 |

### Strong Majority (4/5)

| ID | Decision | Reference |
|---|---|---|
| C9 | **Radix UI primitives** for accessible overlays. Not shadcn/ui (copy-paste model fights design system). | IRB C9, Design Components Research |
| C10 | **Virtual scrolling from day one** with `@tanstack/react-virtual`. Fixed 40px row height for Phase 1B. Overscan: 10-15 rows. | IRB C10, Tree-Table Research |
| C11 | **Breadcrumbs** using `usePathname()` + `useParams()` + SWR for entity names. Arrow separators. | IRB C11, Navigation Research |
| C12 | **Desktop-first.** Mobile is not a target for Phase 1B. | IRB C12 |
| C13 | **Immer dependency (~4KB).** Required for ergonomic deep immutable updates on 2000-node trees. `enableMapSet()` for Set support. | IRB C13, State Research |

### Majority (3/5)

| ID | Decision | Reference |
|---|---|---|
| C14 | **Keyboard navigation complete from Phase 1B.** WAI-ARIA tree pattern. Roving tabindex. Arrow keys, Home/End, Enter, Escape. Ctrl+]/[ for indent/outdent. | IRB C14, Keyboard Research |
| C15 | **Drag-and-drop deferred to Phase 2.** Move via keyboard and context menu first. | IRB C15 |
| C16 | **Delete not undoable in Phase 1B.** Confirmation dialog is standard UX. Soft-delete in Phase 2+. | IRB C16 |

### Resolved Disagreements

| Topic | Resolution | Rationale |
|---|---|---|
| Virtualization urgency | Build with virtual scrolling from day one | Retrofitting is 2-3x harder. The tree is the core product. |
| Inline editing in tree rows | Phase 1B: side panel only. Inline name editing as stretch goal in 1B-0.3. Full inline editing Phase 2. | Architecture analyst is right about coupling risk; design analyst is right about UX. Phased approach satisfies both. |
| Context vs direct props for rows | Start with direct props (5-6 per row). Virtual scroller limits rendered rows to 30-50, reducing re-render cascade concern. Migrate to selectors if profiling shows issues. | Simpler first. Optimize when evidence demands it. |
| `flatVisibleRows` computation | Compute in the reducer, not in `useMemo` | Reducer knows when tree structure changes. Pre-computation means the scroller receives a stable array. |
| TanStack Table vs custom tree | Custom tree with `@tanstack/react-virtual` | TanStack Table's column model does not fit discriminated union node types. Groups have 3 fields, items have 20+. |

---

## Phase Overview Table

| Phase | Focus | Sessions | User Input Required | Checkpoint |
|---|---|---|---|---|
| **CP-0** | Review this plan + blocking decisions | -- | YES: Approve plan, confirm D1-D6 | Before any code |
| **1B-0.0** | Component Library Foundation | 1.0 | YES at end: Visual direction approval (CP-1) | CP-1 |
| **1B-0.1** | Navigation & Layout | 0.75 | YES at end: Layout + flow approval (CP-2) | CP-2 |
| **1B-0.2** | Project & Estimate Pages | 0.75 | NO | -- |
| **1B-0.3** | Tree View Core | 1.0 | NO | -- |
| **1B-0.4** | Detail Panel & Node Editing | 1.0 | YES at end: Tree interaction review (CP-3) | CP-3 |
| **1B-0.5** | Tree Polish: Move, Keyboard, Context Menu | 0.75 | NO | -- |
| **1B-6** | Settings & Preferences | 0.5 | NO | -- |
| **1B-5** | Search & Filtering | 1.0 | NO | -- |
| **CP-5** | Feature priority confirmation | -- | YES: Confirm or reorder 1B-1 through 1B-4 | After 1B-0 |
| **1B-2** | Catalog System | 2-3 | NO | -- |
| **1B-1** | Snapshots | 2-3 | NO | -- |
| **1B-3** | Options UI | 2-3 | NO | -- |
| **1B-4** | Client Portal | 3-4 | NO | -- |

**Total: 19-24.5 sessions** (includes 20% buffer for UI unpredictability)

---

## Phase 1B-0: Foundation Layer

### 1B-0.0: Component Library Foundation (1 session)

**Goal:** Build the shared component layer that all subsequent UI work depends on. Every visual property uses design tokens. This is the design system enforcement boundary.

**Blocking Prerequisite:** CP-0 approved. Figma walkthrough complete (D1). Dependencies installed.

#### Dependencies to Install

```bash
npm install immer nanoid @tanstack/react-virtual \
  @radix-ui/react-dialog @radix-ui/react-dropdown-menu \
  @radix-ui/react-select @radix-ui/react-popover \
  @radix-ui/react-tooltip @radix-ui/react-tabs \
  @radix-ui/react-alert-dialog @radix-ui/react-toast \
  @radix-ui/react-collapsible @radix-ui/react-toggle \
  lucide-react
```

Note: `lucide-react` is the recommended icon library pending Zac review at CP-1 (D8). If rejected, swap to Phosphor -- the wrapper pattern isolates the change.

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

**Wrapper Rules:**
- `forwardRef` on every styled export (preserves Radix ref forwarding)
- All colors via `var(--color-*)`, all spacing via `var(--space-*)`
- Sharp corners on all containers (`rounded-none` implicit -- no radius classes)
- Pill shape on buttons within dialogs (`rounded-full`)
- `data-[state=open/closed]` for animation via Tailwind selectors
- `displayName` set for DevTools

**Field Primitives (Layer 0: `src/components/shared/`)**

| File | Purpose |
|---|---|
| `button.tsx` | Primary (pill, solid), Secondary (pill, border), Ghost (no border), Icon (circle) |
| `badge.tsx` | Status badge (pill shape) |
| `text-field.tsx` | Text input with label, error state, sharp corners |
| `number-field.tsx` | Number input with formatting |
| `money-field.tsx` | Currency input ($ prefix, 2dp display, monospace for alignment) |
| `rate-field.tsx` | Percentage input (% suffix) |
| `select-field.tsx` | Labeled select composing the Select wrapper |
| `textarea.tsx` | Auto-resize text area |
| `checkbox.tsx` | Checkbox field |
| `skeleton.tsx` | Loading skeleton (pulse animation on `--color-bg-secondary`) |
| `empty-state.tsx` | "No data" state with CTA |
| `error-state.tsx` | Error display |

**Layout Primitives (Layer 1: `src/components/layout/`)**

| File | Purpose |
|---|---|
| `page-header.tsx` | Title + subtitle + action buttons |
| `split-pane.tsx` | Resizable tree/detail split |
| `panel.tsx` | Bordered content panel with optional header |
| `status-bar.tsx` | Bottom status strip (node count, total, estimate status) |

**Figma Integration Steps (this session):**
1. Share Figma URLs with Zac (or receive them)
2. `get_design_context` + `get_variable_defs` on each Figma page
3. Produce token reconciliation table (Figma value -> existing token -> action)
4. Zac approves mappings (10-15 min)
5. Add any new tokens to `globals.css` + `DESIGN-SYSTEM.md`

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

#### Agent Assignments

| Agent | Task | Write Access |
|---|---|---|
| Agent 1 | Radix wrappers (dialog, alert-dialog, dropdown-menu, context-menu, select) | `src/components/shared/` |
| Agent 2 | Radix wrappers (popover, tooltip, toast, tabs, collapsible, toggle) | `src/components/shared/` |
| Agent 3 | Field primitives (text-field, number-field, money-field, rate-field, select-field, textarea, checkbox) | `src/components/shared/` |
| Agent 4 | Button, badge, skeleton, empty-state, error-state | `src/components/shared/` |
| Agent 5 | Layout primitives (page-header, split-pane, panel, status-bar) | `src/components/layout/` |
| Reviewer | Design system compliance check on all output | Read-only |

**Verification:**
```bash
# All shared components exist
count=$(find src/components/shared -name "*.tsx" | wc -l)
[ "$count" -ge 22 ] && echo "PASS" || echo "FAIL: Expected 22+, got $count"
# Design system check passes
bash scripts/design-system-check.sh
# TypeScript compiles
npx tsc --noEmit
```

**Checkpoint CP-1:** Zac reviews deployed shared components. "Does this design language feel right? Icons, spacing, field styles." Blocking -- visual direction rejection blocks all feature work.

---

### 1B-0.1: Navigation & Layout (0.75 session)

**Goal:** Fix the sidebar (add icons for collapsed state), add breadcrumbs, finalize route structure, create skeleton layouts for all route levels.

#### Deliverables

**Sidebar Enhancement:**
- Add Lucide icons to all 4 nav items (Dashboard, Projects, Catalog, Settings)
- Collapsed state shows icons only. Expanded shows icon + label.
- Active item: left accent border + `--color-surface-active` background
- Hover: `--color-surface-hover` background

**Breadcrumbs Component (`src/components/nav/breadcrumbs.tsx`):**
- Client component using `usePathname()` + `useParams()`
- SWR-based entity name fetching with caching for dynamic segments (projectId, estimateId)
- Arrow/chevron separators between segments
- Static labels for known segments (Dashboard, Projects, Settings, etc.)
- Renders in the header area between logo and UserMenu

**Route Layouts:**

| File | Creates | Purpose |
|---|---|---|
| `src/app/(protected)/projects/[projectId]/layout.tsx` | NEW | Fetches project by ID, contributes breadcrumb segment |
| `src/app/(protected)/projects/[projectId]/estimates/[estimateId]/layout.tsx` | NEW | Fetches estimate metadata, breadcrumb segment, negative-margin override for full-bleed workspace |

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
# Sidebar renders icons when collapsed
# Breadcrumbs render on all protected pages
# TypeScript compiles
npx tsc --noEmit
```

**Checkpoint CP-2:** Zac looks at the deployed preview for 5 minutes. "Does this feel like ShossyWorks or generic AI output?" Blocking -- rejection means visual direction adjustment needed.

---

### 1B-0.2: Project & Estimate Pages (0.75 session)

**Goal:** Build the project list, project detail, estimate list, and create/edit flows using the shared component library.

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
- Server action mutations with optimistic UI
- Error handling via toast notifications

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

### 1B-0.3: Tree View Core (1 session)

**This is the most critical session in the entire plan.** The tree view is the product. Everything else is supporting infrastructure.

**Goal:** Render the estimate tree from server-fetched data with expand/collapse, type-differentiated rows, inline cost totals, and virtual scrolling.

#### State Architecture

Create `src/components/estimate/tree/hooks/use-estimate-tree-reducer.ts`:

```typescript
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
  undoStack: UndoEntry[];  // cap at 50
  redoStack: UndoEntry[];

  // Sync state
  lastSyncedAt: string | null;
  conflictIds: Set<string>;

  // Derived (computed in reducer, not in render)
  flatVisibleRows: FlatRow[];
  totalCount: number;
}
```

Call `enableMapSet()` once at app initialization for Set support in Immer.

**Reducer action types (complete union from day one):**
- Data mutations: `NODE_CREATE`, `NODE_UPDATE`, `NODE_UPDATE_DETAILS`, `NODE_DELETE`, `NODE_MOVE`, `NODE_DUPLICATE`, `NODE_FLAG`, `NODE_SET_VISIBILITY`
- Optimistic resolution: `MUTATION_CONFIRMED`, `MUTATION_CONFIRMED_VOID`, `MUTATION_FAILED`
- Remote (no-ops for now): `REMOTE_NODE_UPSERT`, `REMOTE_NODE_DELETE`, `REMOTE_NODES_BULK`
- UI: `TOGGLE_EXPAND`, `EXPAND_ALL`, `COLLAPSE_ALL`, `SET_SELECTED`, `SET_FOCUSED`, `SET_EDITING`
- Lifecycle: `HYDRATE`, `UNDO`, `REDO`

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

#### Tree Row Layout

CSS Grid with two columns for Phase 1B-0 MVP:
- **Name** (tree column, flex: 1, min 200px): Indentation + chevron + type icon + name
- **Total** (120px fixed): Right-aligned currency, `--font-mono`

Indentation: 20px per depth level, capped at depth 6 (120px max visual indent).

Row height: Fixed 40px for all node types.

Visual differentiation by type:
- Groups: `--font-semibold`, `--color-text-primary`
- Assemblies: `--font-medium`, `--color-text-primary`
- Items: `--font-normal`, `--color-text-secondary`
- Empty cells for inapplicable columns (not "N/A" or "-")

#### ARIA Implementation

- Container: `role="tree"` with `aria-label="Estimate items"`
- Each row: `role="treeitem"` with roving tabindex
- Required attributes on every row (mandatory for virtualized trees): `aria-level`, `aria-setsize`, `aria-posinset`
- Parent rows: `aria-expanded="true|false"`
- `aria-live="polite"` region for screen reader announcements (expand/collapse, add/delete)

#### Deliverables Checklist

- [ ] `use-estimate-tree-reducer.ts` with complete action union and HYDRATE logic
- [ ] `estimate-tree-container.tsx` client component with provider
- [ ] `virtual-tree-renderer.tsx` with `useVirtualizer`
- [ ] `tree-row.tsx` with `React.memo` and type-differentiated rendering
- [ ] `tree-cell.tsx` with depth-based indentation
- [ ] `tree-toolbar.tsx` with "Add Group", "Add Assembly", "Add Item" buttons
- [ ] `status-bar.tsx` showing node count + total
- [ ] `flatten-tree.ts` utility for computing `flatVisibleRows`
- [ ] Server component page wiring (`page.tsx` fetches nodes, passes to container)
- [ ] Tree renders with proper nesting from server-fetched data
- [ ] Expand/collapse works
- [ ] All 3 node types display correctly with type-specific formatting
- [ ] Add node (group/assembly/item) works via toolbar buttons
- [ ] Delete node works with AlertDialog confirmation

**Verification:**
```bash
npx tsc --noEmit
bash scripts/design-system-check.sh
# Tree renders with 3+ levels of nesting
# Expand/collapse toggles work
# Add/delete nodes work
# Virtual scrolling renders only 30-50 DOM nodes regardless of data size
```

---

### 1B-0.4: Detail Panel & Node Editing (1 session)

**Goal:** Build the persistent side panel for editing the selected node. Type-specific editors for item, assembly, and group nodes. Zod validation on blur. Optimistic save via server actions.

#### Detail Panel Architecture

```
NodeDetailPanel (switches editor by node_type)
  -> GroupEditor (name, description)
  -> AssemblyEditor (name, quantity, unit, ratio, specifications)
  -> ItemEditor (20+ fields from node_item_details)
     Sections:
       Basic: name, description, quantity, unit, unit_cost
       Cost Breakdown: material_cost, labor_cost, equipment_cost, subcontractor_cost
       Markup: markup_rate, overhead_rate, contingency_rate, tax_rate
       Vendor: vendor_id, lead_time, delivery_notes
       Allowance: is_allowance, allowance_budget, allowance_status
       Classification: cost_code_id, phase_id
  -> NotesPanel (node_notes CRUD, markdown support, client_visible toggle)
```

**Communication Pattern:** Tree dispatches `SET_SELECTED`. Panel reads selected node from state via selector hook. Panel edits dispatch `NODE_UPDATE` / `NODE_UPDATE_DETAILS` back through the reducer. Panel saves via `startTransition` + server action, dispatches `MUTATION_CONFIRMED` / `MUTATION_FAILED` on completion.

**The panel and tree never communicate directly. They share state through the reducer. Either can be replaced without touching the other.**

#### Field Behavior

- Text fields: save on blur (debounced 500ms)
- Number fields: save on blur, format on blur (show raw during edit)
- Currency fields: monospace font, $ prefix, 2dp display, 4dp internal precision
- Select fields: save on change
- Validation: Zod schema validation on blur, inline error messages below fields
- Unsaved indicator: subtle dot or border change on fields with pending mutations

#### Notes Panel

- List of notes for selected node (from `node_notes` table)
- Create new note (markdown editor -- simple textarea for Phase 1B)
- `is_client_visible` toggle per note
- `is_internal` toggle per note
- Soft-delete (archived, not destroyed)
- Server actions: `notes.ts` (create, update, delete)

#### Deliverables Checklist

- [ ] `node-detail-panel.tsx` with type-based editor switching
- [ ] `group-editor.tsx`
- [ ] `assembly-editor.tsx`
- [ ] `item-editor.tsx` with sectioned layout
- [ ] `notes-panel.tsx` with CRUD
- [ ] `use-tree-mutation.ts` hook (dispatch + startTransition + server action pattern)
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
```

**Checkpoint CP-3:** Zac uses the tree on his own device for 15-30 minutes. Reports what feels wrong. **This is the most important checkpoint.** If the tree interaction model is rejected here, we catch it before building features on top of it.

---

### 1B-0.5: Tree Polish -- Move, Keyboard, Context Menu (0.75 session)

**Goal:** Complete keyboard navigation, indent/outdent, context menu, and inline name editing.

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
- [ ] Undo/redo (capped at 50 entries)
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
```

---

## Phase 1B Features (Post-Foundation)

After Phase 1B-0 completes, the feature phases from the existing plan are resequenced based on business priority and dependency analysis:

### Tier 1: Immediate (enables real usage)

#### 1B-6: Settings & Preferences (0.5 session)

**Why first:** Company defaults (markup rates, overhead percentages, tax rates) are used by all other features. Small scope, quick win.

**Deliverables:**
- Company settings form (rates as columns, info as JSONB)
- User preferences panel (UI state, sidebar, theme)
- Estimate view state persistence (expand/collapse state, column visibility)
- Server actions: `settings.ts`, `preferences.ts`

#### 1B-5: Search & Filtering (1 session)

**Why second:** Makes the tree navigable for real estimates with 100+ nodes.

**Deliverables:**
- Search box in tree toolbar with live filtering
- Scope selector: current estimate (default), current project, global
- Current-estimate search: client-side filtering via `flatVisibleRows`
- Cross-estimate search: server-side full-text via tsvector + GIN indexes
- Filter bar: node type, cost code, phase, cost range, flagged status
- Server actions: `search.ts`

### Tier 2: Core Features

#### 1B-2: Catalog System (2-3 sessions)

**Deliverables:**
- "Add to Catalog" -- save node as reusable template
- Catalog browser panel with search
- "Insert from Catalog" (copy-on-insert, per INTENT Decision #4)
- Server actions: `catalog.ts`

#### 1B-1: Snapshots (2-3 sessions)

**Deliverables:**
- "Create Snapshot" dialog (name, description, auto-detect status)
- Snapshot browser panel (milestones vs checkpoints)
- Snapshot viewer (read-only tree render)
- "Restore from Snapshot" with confirmation + auto-checkpoint
- "Create Estimate from Snapshot"

### Tier 3: Differentiators

#### 1B-3: Options UI (2-3 sessions)

**Deliverables:**
- Option group/alternative management
- Visual indicators for option-owned nodes in tree
- Option set management + comparison table
- Selection AND toggle group types (INTENT Decision #19)

#### 1B-4: Client Portal (3-4 sessions)

**Deliverables:**
- Share link generation with PIN
- Client estimate viewer (filtered by `client_visibility`)
- Client commenting + approval workflow
- Per-IP rate limiting

**CP-5 (after 1B-0 completes):** Zac confirms or reorders Tiers 1/2/3 based on business priority.

---

## Figma Prototype Integration Plan

### When to Share Figma Links

**At CP-0 (before any code).** Zac shares Figma URLs. No export needed -- the Figma MCP reads directly from URLs.

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

**Rule:** Figma values are INPUT to the token system, not overrides. The token system is the source of truth. At no point does a raw Figma value appear in a component file.

---

## Research Schedule

Research that happens DURING development, not before it:

| When | Topic | Method | Output |
|---|---|---|---|
| 1B-0.0 start | Figma token extraction | `get_design_context` + `get_variable_defs` | `docs/ui/feedback/prototype-extraction.md` |
| 1B-0.3 start | Tree performance profiling | Build + measure with 500/1000/2000 nodes | Performance baseline documented in `docs/ui/specs/tree-view.md` |
| 1B-0.4 mid | Form pattern validation | Test Zod-on-blur with real field types | Pattern documented in `docs/ui/patterns/form-patterns.md` |
| 1B-5 start | Full-text search performance | Test tsvector queries on real data | Query plan analysis in session doc |
| 1B-3 start | Option overlay rendering | Evaluate subtree swapping UX approaches | Research doc in `docs/ui/specs/options.md` |

Research is documented in `docs/ui/` (committed to git, persistent). Each spec file targets <3KB. The `docs/ui/index.md` serves as a routing table so agents load only relevant specs.

---

## User Feedback Checkpoint Schedule

| Checkpoint | Phase | What Zac Sees | Decision Type | Time Required | Impact if Skipped |
|---|---|---|---|---|---|
| **CP-0** | Before any code | This plan + blocking decisions D1-D6 | Approve plan, confirm architecture | 30-60 min | Cannot start. Everything is blocked. |
| **CP-1** | After 1B-0.0 | Deployed shared components: buttons, inputs, cards, icons, dialog | "Does this design language feel right?" | 10 min | Visual direction may be wrong. All subsequent UI inherits the mistake. |
| **CP-2** | After 1B-0.1 | Deployed preview: sidebar with icons, breadcrumbs, navigation flow | "Does this feel like ShossyWorks?" | 5 min | Navigation UX may be wrong. Users interact with nav on every page. |
| **CP-3** | After 1B-0.4 | Working tree on Zac's device: select nodes, edit in panel, add/delete | 15-30 min actually using it | 15-30 min | The core product interaction is unvalidated. This is where EP and Soloway died. |
| **CP-4** | After 1B-0 complete | Figma prototype deep-dive + feature priority for 1B-1 through 1B-4 | Confirm or reorder Tier 1/2/3 | 30 min | Building features in wrong order wastes sessions. |
| **CP-5** | After first 1B feature ships | Mid-build review: architecture scaling? Pain points from real estimates? | Course correction | 15 min | Systemic issues compound across remaining features. |

### What Zac Must Bring

| Checkpoint | Required from Zac |
|---|---|
| CP-0 | Opinions on D1-D6, Figma file URLs if ready |
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
| D6 | Phase 1B-0 addition | (a) Add 4-4.5 session foundation (b) Absorb into existing | **(a) Add 1B-0.** Without it, all features have no foundation. | 5 min |

### Review Decisions (Build First, Then Validate)

| # | Decision | When | Deliverable |
|---|---|---|---|
| D7 | Font choice (Inter vs alternatives) | After first components | Side-by-side screenshots |
| D8 | Icon library (Lucide vs Phosphor) | After shared layer | 10 common icons rendered with each |
| D9 | Information density modes | After tree MVP | Same estimate at 3 densities |
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
  patterns/
    state-management.md       -- Reducer patterns, optimistic updates
    interaction-patterns.md   -- Keyboard nav, context menus
    form-patterns.md          -- Validation, error display, field behavior
  feedback/
    zac-approvals.md          -- Zac's feedback log (chronological)
    prototype-extraction.md   -- Figma -> token mapping decisions
```

### Component Contracts

Create three UI-boundary contracts in `contracts/`:

| Contract | Governs | Key Rule |
|---|---|---|
| `tree-state.contract.md` | Reducer state shape, action types, provider interface | State must include slots for remote actions; `nodesById` is flat normalized map; `flatVisibleRows` computed in reducer |
| `tree-component.contract.md` | Container / renderer / row / panel boundaries | Tree renders data it does not own; panel communicates via dispatch only; no direct function calls between tree and panel |
| `shared-components.contract.md` | Design system wrapper layer | All Radix imports go through wrappers; zero direct `@radix-ui/*` imports in feature components; every visual property via CSS custom properties |

### Agent Research Reference Pattern

Each implementation session reads:
- **L1 (always):** CLAUDE.md imports, INTENT.md, CODEBASE_MAP.md, CONTRACT-INDEX.md
- **L2 (per-task):** The specific `docs/ui/specs/*.md` file + relevant `docs/ui/patterns/*.md`
- **L2 (always):** DESIGN-SYSTEM.md (auto-loaded via CLAUDE.md import)

Agents read `docs/ui/index.md` to identify which spec files are relevant. Load only those files. Maximum L2 load: ~6KB per task.

---

## Risk Mitigation Matrix

| Risk | Previous Failure Mode | Mitigation Strategy | Verification |
|---|---|---|---|
| **Schema changes break UI** | EP: UI coupled to unstable schema | Data layer is complete and stable. Server actions are the boundary. Client components receive props. | TypeScript catches all consumer breakage at compile time. |
| **"AI slop" visual incoherence** | Both: raw Tailwind with no design system | CSS tokens + Radix wrappers + automated grep + CP-1/CP-2 checkpoints | `design-system-check.sh` runs on every commit. Zac reviews deployed output. |
| **Component coupling prevents iteration** | Soloway: inline editing coupled tree to form state | Three-layer tree. Side panel editing. Reducer owns all state. Components communicate only through dispatch. | `tree-component.contract.md` enforces boundaries. |
| **Tree performance at scale** | N/A (never reached this stage) | Virtual scrolling from day one. Fixed row heights. `React.memo`. Only 30-50 DOM nodes. | Performance test with 2000 nodes during 1B-0.3. Target: 60fps scroll, <16ms initial render. |
| **Keyboard accessibility gaps** | N/A | Full WAI-ARIA tree pattern. Roving tabindex. Screen reader announcements. | Accessibility test matrix (NVDA/Chrome, VoiceOver/Safari). |
| **Figma intent lost in translation** | N/A | Structured extraction workflow. Token reconciliation table. Visual checkpoints. | `prototype-extraction.md` traces every Figma element to its token. |
| **Scope creep in tree features** | Soloway: editing bolted on after read-only | Each phase has explicit "NOT in scope" list. Contracts document what is deferred. | Contract `NOT in scope` sections reviewed before each phase. |
| **Context window exhaustion during tree build** | N/A | Research subagents for exploration. Compact at 70%. Session handoffs. | Research docs stay under 3KB. Agent context budget enforced. |
| **Undo/redo complexity explosion** | N/A | Phase 1B: undo capped at 50 entries, no cross-node undo. Delete is not undoable. | Explicit scope limit in state architecture. |
| **Remote action retrofit** | INTENT #13 warns against this explicitly | Remote action types exist as no-ops from day one. Channel structure designed. Conflict resolution documented. | `REMOTE_NODE_UPSERT` in action union from first commit. |

---

## Session Breakdown

| Session | Phase | Primary Deliverables | Checkpoint | Agent Strategy |
|---|---|---|---|---|
| **S1** | CP-0 + 1B-0.0 start | Figma walkthrough, token reconciliation, dependency install, Radix wrappers begin | CP-0 at start | Main thread for Figma; 5 parallel agents for wrappers |
| **S2** | 1B-0.0 finish + 1B-0.1 | Field primitives, layout primitives, sidebar fix, breadcrumbs, route layouts | CP-1 at start, CP-2 at end | 3 parallel agents (fields, layout, nav) |
| **S3** | 1B-0.2 | Project list, project detail, estimate list, create/edit dialogs | -- | 2 parallel agents (project pages, estimate pages) |
| **S4** | 1B-0.3 | Tree reducer, container, virtual renderer, tree rows, add/delete | -- | Research subagent first (verify state shape against contract). Main thread implements. |
| **S5** | 1B-0.4 | Detail panel, type-specific editors, notes panel, Zod validation | CP-3 at end | 3 parallel agents (item editor, assembly/group editor, notes) |
| **S6** | 1B-0.5 | Keyboard nav, context menu, inline name edit, indent/outdent, undo | -- | Main thread (keyboard handling is sequential) |
| **S7** | 1B-6 + 1B-5 start | Settings form, preferences panel, search box, filter bar | -- | 2 parallel agents (settings, search) |
| **S8** | 1B-5 finish + CP-4 | Cross-estimate search, filter bar polish, Figma deep-dive, priority confirm | CP-4 at end | -- |
| **S9-S10** | 1B-2: Catalog | Catalog browser, add-to/insert-from catalog | -- | 2 parallel agents (catalog UI, catalog server actions) |
| **S11-S12** | 1B-1: Snapshots | Snapshot CRUD, viewer, restore, comparison | -- | 3 parallel agents (create/browser, viewer, restore) |
| **S13-S15** | 1B-3: Options | Option groups, indicators, option sets, comparison | -- | Research subagent (option UX from Soloway). Then implementation. |
| **S16-S19** | 1B-4: Client Portal | Share links, client viewer, comments, approval | CP-5 mid-way | 3 parallel agents (share flow, viewer, approval) |

### MVP Definition

**MVP = 1B-0 + 1B-6 + 1B-5 part 1 = ~7 sessions (S1-S8)**

After MVP, Zac has:
- Working project/estimate navigation with breadcrumbs
- A functional tree editor with full CRUD, keyboard navigation, and inline name editing
- Type-specific detail panel editors with Zod validation
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

| Contract | Create When | Key Contents |
|---|---|---|
| `tree-state.contract.md` | Before 1B-0.3 | State shape, action union, HYDRATE semantics, flatVisibleRows computation rule, pending mutation tracking |
| `tree-component.contract.md` | Before 1B-0.3 | Three-layer architecture, prop interfaces, dispatch-only communication, no direct Supabase from client components |
| `shared-components.contract.md` | Before 1B-0.0 | Wrapper rules, import restrictions, token-only styling, shape rules |

---

## Dependencies on Phase 1A

This plan assumes Phase 1A is **complete** before Phase 1B-0.2 (the first session that creates/reads real data). Specifically:

| 1A Deliverable | Used By | What Happens If Missing |
|---|---|---|
| `projects` table + RLS | 1B-0.2 (project list) | Cannot render project data |
| `estimates` table + RLS | 1B-0.2 (estimate list) | Cannot render estimates |
| `estimate_nodes` + detail tables + RLS | 1B-0.3 (tree view) | Cannot render tree |
| Core server actions (projects, estimates, nodes) | 1B-0.2+ (all CRUD) | Cannot create/edit data |
| Generated types + Zod schemas | 1B-0.2+ (all forms) | Cannot validate input |
| `node_notes` table + RLS | 1B-0.4 (notes panel) | Cannot manage notes |
| Triggers (auto-promotion, sort_order) | 1B-0.5 (indent/outdent) | Tree operations fail silently |

**Phase 1B-0.0 and 1B-0.1 can proceed without a complete Phase 1A** because they build UI components and navigation structure that do not require real data. They use mock data for visual development.

---

## Appendix: New Design Tokens (Anticipated)

These tokens should be added during Phase 1B-0.0 after Figma reconciliation confirms their values:

| Token | Purpose | Anticipated Value |
|---|---|---|
| `--tree-row-height` | Tree row height (single value for Phase 1B) | 40px (2.5rem) |
| `--tree-indent-width` | Per-level indentation | 20px (1.25rem) |
| `--detail-panel-width` | Side panel default width | 400px (25rem) |
| `--detail-panel-min-width` | Side panel minimum | 300px (18.75rem) |
| `--color-row-selected` | Selected tree row background | Maps to `--color-surface-active` unless Figma differs |
| `--color-row-hover` | Hovered tree row background | Maps to `--color-surface-hover` unless Figma differs |

Do NOT add these speculatively. Add only after Figma walkthrough confirms or provides values.

---

*This plan is the blueprint for everything that follows. Every ambiguity has been resolved or marked as a user decision point. Every risk has a mitigation strategy. Every session has clear deliverables. The plan succeeds or fails at CP-3 -- the moment Zac uses the tree editor for the first time.*
