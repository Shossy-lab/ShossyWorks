# Comprehensive UI Planning Analysis -- Synthesis

**Produced by:** Synthesis Agent (Review Board Phase 1)
**Date:** 2026-04-09
**Sources:** Page Architecture, Component Architecture, State Management, Design & UX, Sequencing & Risk analyses + Historical Context brief

---

## 1. Executive Summary

The five-analyst review board has reached strong consensus on the architecture for ShossyWorks' UI layer. The estimate tree editor is unanimously identified as the product's center of gravity -- consuming 40-60% of Phase 1B development effort and requiring the most careful architectural decisions. All analysts agree on `useReducer` with Immer for tree state, Radix UI primitives (not shadcn/ui) for accessible overlays, and a custom tree component built on `@tanstack/react-virtual` for virtualized scrolling. The most critical finding across all analyses is that the current Phase 1B plan has no session allocation for building the tree view or core navigation -- a gap of 4-4.5 sessions that must be added as "Phase 1B-0" before any feature work begins. The board also identifies three categories of decisions requiring Zac's input before implementation: foundational architecture choices (blocking), visual direction (review after first build), and surface-level polish (inform only). The historical context makes clear that component coupling and premature UI work killed previous attempts; the architecture proposed here is explicitly designed to avoid those failure modes through strict separation of tree rendering, node editing, and data ownership.

---

## 2. Consensus Findings (Sorted by Importance)

### UNANIMOUS (All 5 analysts agree)

| # | Finding | Analysts | Impact |
|---|---------|----------|--------|
| C1 | **Phase 1B plan is missing a "1B-0" phase for core navigation + tree view.** The plan lists "estimate tree UI exists" as a dependency for 1B-1 (Snapshots) but never allocates sessions to build it. This is a 4-4.5 session gap. | Page, Component, Sequencing, State, Design | CRITICAL -- blocks all Phase 1B work |
| C2 | **useReducer (not Zustand/Jotai) for tree state.** INTENT Decision #13 mandates this. The reducer must handle two mutation sources (local edits + Supabase Realtime broadcasts) through the same action dispatch. | State, Component, Sequencing | BLOCKING -- determines all client-side patterns |
| C3 | **The tree component must be custom-built, not adopted from a library.** No existing tree library (react-arborist, react-complex-tree) handles the combination of discriminated union node types, inline editing of 20+ fields, real-time collaborative updates, virtual scrolling at 2000 nodes, and the strict design system. | Component, Design, State | BLOCKING -- foundation of entire estimate UI |
| C4 | **Flat normalized state (nodesById + childrenOf + rootIds), NOT nested TreeNode[].** O(1) lookup, O(1) updates, O(1) re-parenting. The existing `TreeNode` type with recursive `children: TreeNode[]` is for rendering only, never for state storage. | State, Component | BLOCKING -- wrong shape makes everything downstream harder |
| C5 | **Server component page fetches data; client component manages state.** The page.tsx is a server component calling `getNodes()`. `EstimateTreeProvider`/`EstimateTreeContainer` is a client component receiving `initialNodes` as props. | Page, State, Component | BLOCKING -- wrong boundary means no SSR or no interactivity |
| C6 | **Reducer action types must include remote/real-time variants from day one.** Even though Realtime is Phase 1B+, `REMOTE_NODE_CHANGED`, `REMOTE_UPSERT`, `REMOTE_REMOVE` must be in the action union now. Retrofitting is the exact failure mode Decision #13 warns against. | State, Component, Sequencing | HIGH -- prevents costly refactor later |
| C7 | **Design system compliance requires active enforcement, not just documentation.** Automated grep for forbidden patterns (`rounded-sm`, `rounded-md`, `bg-white`, `bg-gray-*`, hardcoded hex values). Every `.tsx` commit checked. | Design, Component, Sequencing | HIGH -- "AI slop" accumulation is the #2 failure mode |
| C8 | **Side panel (persistent, not modal) for node editing.** The detail panel is always visible alongside the tree. Different from EP (modals -- broke flow) and Soloway (inline -- coupled tree and form state). Matches ProEst, Figma, VS Code pattern. | Component, Design, Page | HIGH -- gets editing UX right from the start |

### STRONG MAJORITY (4 of 5 agree)

| # | Finding | Analysts | Impact |
|---|---------|----------|--------|
| C9 | **Radix UI primitives for accessible overlays (dialog, dropdown, select, tooltip, toast).** Not shadcn/ui (copy-paste model fights the strict design system). Radix has zero styling opinions and handles WCAG focus management. | Component, Design, State, Page | HIGH -- 2-4 weeks saved vs building a11y from scratch |
| C10 | **Virtual scrolling from day one, not as a retrofit.** Using `@tanstack/react-virtual` to render only visible rows (30-50 in viewport vs 2000 total). | Component, Sequencing, State, Design | HIGH -- performance retrofit is 2-3x harder than designing upfront |
| C11 | **Breadcrumbs are essential for the deep nesting pattern.** Client-side `<Breadcrumbs>` component using `usePathname()` + `useParams()`, with lightweight caching for entity names. | Page, Design, Sequencing, Component | MEDIUM -- users need to know where they are at 5 URL levels |
| C12 | **Desktop-first is correct. Mobile is not a target for Phase 1B.** Construction estimating is overwhelmingly desktop. Tablet support deferred to Phase 2E. Client portal is the exception (tablet-responsive for read-only viewing). | Design, Sequencing, Page, Component | MEDIUM -- prevents wasted effort on responsive layouts |
| C13 | **Add Immer as a dependency (~4KB).** Deep immutable updates on 2000-node tree without Immer will produce bugs. Standard approach for complex reducer state. | State, Component, Sequencing, Design | HIGH -- reducer code quality and correctness |

### MAJORITY (3 of 5 agree)

| # | Finding | Analysts | Impact |
|---|---------|----------|--------|
| C14 | **Keyboard navigation must be complete from Phase 1B.** Arrow keys, Enter, Escape, Tab/Shift+Tab for indent/outdent. This is the accessible equivalent of drag-and-drop and must exist before any drag-and-drop is added. | Component, Design, Sequencing | HIGH -- pro users expect keyboard-driven navigation |
| C15 | **Drag-and-drop deferred to Phase 2.** Move via keyboard and context menu first. Add `@dnd-kit/core` later. Architecture supports it (MOVE_NODE and REORDER_SIBLINGS actions already in reducer). | Component, Design, Sequencing | MEDIUM -- avoids early complexity spike |
| C16 | **Delete should NOT be undoable in Phase 1B.** Full delete undo requires either soft-delete schema changes or complex subtree snapshot/replay. Confirmation dialog is standard UX. Migrate to soft-delete in Phase 2+. | State, Sequencing, Component | MEDIUM -- scope control |

---

## 3. Topic Clusters for Research (with Specific Research Questions)

### Cluster 1: Tree-Table Rendering Architecture
- How do professional estimating tools (ProEst, Cubit) render hierarchical cost data alongside tabular columns?
- What is the optimal column set for Phase 1B (minimum columns vs full data display)?
- Should cost totals appear inline in tree rows or only in the detail panel?
- What are the performance characteristics of `@tanstack/react-virtual` with variable-height rows and ResizeObserver measurement?
- How do tree-table hybrids handle column resizing alongside hierarchical indentation?

### Cluster 2: State Management Patterns for Complex Trees
- What is the optimal Immer-based reducer pattern for a flat normalized tree with 2000 nodes?
- How should the reducer compute `flatVisibleRows` -- in the reducer itself or via `useMemo`?
- What is the correct optimistic update pattern when server-generated IDs differ from client temp IDs?
- How should `startTransition` be used with server actions triggered by non-form interactions (blur, keyboard, drag)?
- What is the performance impact of `React.memo` on 50-100 visible TreeRow components with context-based state?

### Cluster 3: Keyboard Navigation and Accessibility
- What ARIA roles and attributes does a custom tree view need for screen reader support?
- How do spreadsheet-like keyboard patterns (Tab between cells, Enter to edit/commit) interact with tree expand/collapse?
- What keyboard shortcuts do professional estimating tools (Cubit, ProEst) use for common operations?
- How should focus management work when nodes are added, deleted, or moved?
- What is the correct `role="tree"` / `role="treeitem"` pattern for a virtualized tree?

### Cluster 4: Design System Component Wrappers
- What is the minimal set of Radix UI primitives needed for Phase 1B?
- How should Radix `data-[state=*]` attributes be combined with Tailwind + CSS custom properties?
- What is the correct Radix Dialog focus trap behavior when a side panel (not modal) is used for editing?
- How should toast/notification positioning work with the sidebar + tree + detail panel layout?
- What icon library (Lucide vs Phosphor) best matches the sharp-corner / monochrome design language?

### Cluster 5: Figma Prototype Integration
- What pages do the existing Figma prototypes cover?
- Are the Figma designs layout/structure references, visual style references, or both?
- Do the Figma prototypes include a tree view design specifically?
- Do the Figma designs use the current design token values or predate the token system?
- What patterns from Figma should be extracted as "information architecture" vs "visual styling"?

### Cluster 6: Real-Time Collaboration Architecture (Design-Only for Phase 1B)
- How should the reducer distinguish local vs remote mutations using `updated_at` timestamps?
- What is the correct Supabase Realtime channel pattern for per-estimate subscriptions?
- How should presence state (who is editing which node) be stored -- separate useState vs Zustand?
- What happens when a WebSocket disconnects and reconnects mid-editing session?
- How should optimistic updates interact with incoming remote broadcasts for the same node?

### Cluster 7: Optimistic Updates and Error Recovery
- What is the best pattern for tracking pending mutations alongside confirmed state?
- How should mutation failure rollback work when multiple dependent mutations are queued (e.g., move + rename)?
- When should node creation be optimistic (temp ID) vs non-optimistic (loading state)?
- How should the undo stack interact with server-confirmed vs pending states?
- What user feedback is appropriate for mutation failure in a tree context (toast vs inline error vs row highlight)?

### Cluster 8: Navigation and Layout Architecture
- Should the `[projectId]/layout.tsx` and `[estimateId]/layout.tsx` fetch data, or should pages re-fetch with React `cache()` deduplication?
- What is the correct breadcrumb implementation for App Router when entity names require data fetching?
- Should the sidebar show contextual items (current project, recent estimates) or remain static?
- What is the optimal split-pane ratio between tree panel and detail panel (50/50? 60/40? resizable)?
- Should intercepting routes be used for create dialogs, or should simple `<dialog>` elements be used first?

---

## 4. Key Decisions Needing User Input

### BLOCKING Decisions (Must resolve before any Phase 1B implementation)

| # | Decision | Options | Analysts' Recommendation | Time to Decide |
|---|----------|---------|--------------------------|----------------|
| D1 | **Figma prototype review** | Zac shares links and discusses what to extract | Cannot recommend without seeing designs | 30-60 min conversation |
| D2 | **Tree-table component strategy** | (a) Custom tree + @tanstack/react-virtual (b) TanStack Table with tree expansion (c) AG Grid community edition | **(a) Custom tree + virtual.** Full design control, no vendor styling conflicts. All 5 analysts agree. | 15 min briefing |
| D3 | **State management pattern** | (a) useReducer + Immer (b) Zustand (c) Jotai | **(a) useReducer + Immer.** INTENT Decision #13 mandates useReducer. Immer for ergonomic deep updates. All 5 analysts agree. | 10 min briefing |
| D4 | **Layout wireframe approval** | Sidebar + tree panel + persistent detail panel (see wireframe in Design analysis Section 3) | **Approve the sidebar + tree + side panel layout.** Matches ProEst/Figma/VS Code and avoids the modal-per-edit (EP) and inline-edit (Soloway) anti-patterns. | 10 min review |
| D5 | **Headless UI library** | (a) Radix UI primitives (b) Ark UI (c) Build from scratch | **(a) Radix UI.** Zero styling opinions, proven a11y, largest ecosystem. shadcn/ui explicitly rejected -- its copy-paste model and default rounded corners fight the design system. | 10 min briefing |
| D6 | **Phase 1B-0 addition** | (a) Add 4-4.5 session 1B-0 phase for navigation + tree (b) Absorb into existing 1B-1 allocation | **(a) Add 1B-0.** The tree view is 4-4.5 sessions of work that the current plan does not account for. Without this, 1B-1 through 1B-6 have no foundation. | 5 min confirm |

### REVIEW Decisions (Implement first, then Zac validates)

| # | Decision | When | Deliverable for Review |
|---|----------|------|----------------------|
| D7 | **Font choice** (Inter vs IBM Plex Sans vs Geist) | After first components land | Side-by-side screenshot of an estimate tree in each font |
| D8 | **Icon library** (Lucide vs Phosphor) | After shared component layer | 10 common icons rendered with each library |
| D9 | **Information density modes** (compact/default/comfortable) | After tree view MVP | Same estimate at three densities |
| D10 | **Side panel width** (fixed 400px vs resizable) | After detail panel implemented | Working prototype with both options |
| D11 | **Inline cost totals** (show in tree rows or only in detail panel) | After tree rows render | Screenshot with/without inline costs |

### INFORM Decisions (Document choice, no explicit review needed)

| # | Decision | Analyst Recommendation |
|---|----------|----------------------|
| D12 | Animation timing values | Use existing tokens: 100ms fast, 200ms normal, 300ms slow |
| D13 | Expand/collapse animation | 200ms height transition, 90-degree chevron rotation |
| D14 | Hover/focus states | Border color change to `--color-border-focus`, no background change |
| D15 | Loading skeletons | Pulse animation on `--color-bg-secondary` rectangles matching content shapes |
| D16 | Multi-select in detail panel | Phase 1B: show first selected node. Batch edit is Phase 2. |

---

## 5. Architecture Recommendations

### 5.1 Component Architecture

**Three-layer tree (all analysts agree):**

```
Layer 1: EstimateTreeContainer (state owner)
  - useReducer with Immer for tree state
  - Flat normalized state: nodesById + childrenOf + rootIds
  - Receives NodeWithDetails[] from server component
  - Dispatches to server actions via startTransition
  - Subscribes to Realtime channel (Phase 1B+)

Layer 2: VirtualTreeRenderer (scroll management)
  - @tanstack/react-virtual for viewport rendering
  - Flattened visible rows computed in reducer
  - Only 30-50 DOM nodes in viewport at any time

Layer 3: TreeNodeRow (individual row)
  - Pure component (React.memo)
  - Three sub-renderers: GroupRow, AssemblyRow, ItemRow
  - Does NOT handle editing -- dispatches selection
```

**Side panel for editing (not inline, not modal):**

```
NodeDetailPanel (switches editor by node_type)
  -> ItemEditor (20+ fields: qty, unit, cost, markup, labor, materials...)
  -> AssemblyEditor (qty, unit, ratio, specifications)
  -> GroupEditor (name, description, visibility)
```

Communication boundary: Tree dispatches `SET_SELECTED`; panel reads selected node from state; panel saves via server actions and dispatches `UPSERT_NODE` back to state.

### 5.2 State Architecture

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

### 5.3 Route Architecture

```
src/app/
  (auth)/                 # Centered card layout, no sidebar
  (protected)/            # Sidebar + header, auth required
    dashboard/
    projects/
      [projectId]/
        layout.tsx        # Fetches project, provides breadcrumb
        estimates/
          [estimateId]/
            layout.tsx    # Fetches estimate metadata
            page.tsx      # THE TREE EDITOR (server fetches nodes -> client tree)
            settings/
            snapshots/[snapshotId]/
    catalog/
    settings/
  (client)/               # Client portal, no sidebar, PIN auth
    share/[token]/
```

### 5.4 Dependencies to Add

| Package | Purpose | Size |
|---------|---------|------|
| `immer` | Ergonomic immutable updates in reducer | ~4KB |
| `nanoid` | Mutation IDs for optimistic updates | ~1KB |
| `@tanstack/react-virtual` | Virtual scrolling for tree | ~15KB |
| `@radix-ui/react-dialog` | Accessible modals | ~12KB |
| `@radix-ui/react-dropdown-menu` | Context menus | ~15KB |
| `@radix-ui/react-select` | Select dropdowns | ~18KB |
| `@radix-ui/react-popover` | Popovers | ~10KB |
| `@radix-ui/react-tooltip` | Tooltips | ~8KB |
| `@radix-ui/react-tabs` | Tab panels | ~6KB |
| `@radix-ui/react-alert-dialog` | Delete confirmations | ~10KB |
| `@radix-ui/react-toast` | Notifications | ~10KB |
| Lucide React (recommended, pending Zac review) | Icons | Tree-shakeable |

**Not adding yet:** `@dnd-kit/core` (drag-drop is Phase 2+), `cmdk` (command palette is Phase 2+), Zustand (not for tree state; revisit for global UI if needed).

---

## 6. Build Sequence Recommendation

### Phase 1B-0: Foundation (4-4.5 sessions)

| Session | Deliverable | Done When | Checkpoint |
|---------|------------|-----------|------------|
| **1B-0.0** | Shared component layer: Radix wrappers (dialog, dropdown, select, tooltip, toast, tabs, alert-dialog, collapsible, toggle) + field primitives (TextField, NumberField, MoneyField, RateField, SelectField, TextArea, Toggle) + layout primitives (page-header, split-pane, panel) + sidebar icons + breadcrumbs | All shared components exist, styled with design tokens. Sidebar works when collapsed. Breadcrumbs render from URL. | **CP-1: Zac approves shared components (design direction).** |
| **1B-0.1** | Project list page + create/edit dialogs + estimate list + create dialog | Can navigate Dashboard -> Projects -> Project -> Estimates. Can create a project and estimate through the UI. Empty states with CTAs. | **CP-2: Visual direction approval.** "Does this look/feel right?" |
| **1B-0.2** | Tree view: render + expand/collapse + add/delete nodes | Tree renders from server-fetched data with proper nesting. All 3 node types display correctly. Expand/collapse works. Add and delete nodes work. | |
| **1B-0.3** | Tree view: detail panel + node editing + inline name editing | Selecting a node shows its type-specific editor in the side panel. Can edit item details (qty, unit, cost). Zod validation on blur. Save via server action with optimistic update. | **CP-3: Tree interaction model review.** Zac uses the tree on his own device. |
| **1B-0.4** | Tree view: move/indent/outdent + keyboard navigation + polish | Tab/Shift+Tab for indent/outdent. Arrow keys for navigation. Enter to select. Context menu for actions. Status bar showing node count + total. | |

### Phase 1B Features (Reordered from current plan)

| Priority | Sub-Phase | Sessions | Rationale |
|----------|-----------|----------|-----------|
| Tier 1 | **1B-6: Settings & Preferences** | 1 | Small scope. Enables company defaults used by all other features. |
| Tier 1 | **1B-5: Search & Filtering** | 1.5-2 | Makes the tree navigable for real estimates with 100+ nodes. |
| Tier 2 | **1B-2: Catalog** | 2-3 | Makes data entry practical via reusable templates. |
| Tier 2 | **1B-1: Snapshots** | 2-3 | Safety net before making changes. |
| Tier 3 | **1B-3: Options** | 2-3 | Builds on catalog. ShossyWorks' key differentiator. |
| Tier 3 | **1B-4: Client Portal** | 3-4 | Requires tree + options for meaningful client interaction. |

**CP-5 (after 1B-0 completes):** Zac confirms or reorders Tier 1/2/3 based on business priority.

### MVP Definition

**MVP = 1B-0 + 1B-6 (Settings) + 1B-5 part 1 (Basic Search) = ~6 sessions**

After MVP, Zac has: working project/estimate navigation, a functional tree editor with full CRUD and keyboard navigation, company defaults configured, and basic search within estimates. This is enough to START entering real estimates and discover usability issues before building catalog, snapshots, options, and client portal.

### Total Budget

| Phase | Sessions | Cumulative |
|-------|----------|------------|
| 1B-0 (Foundation) | 4-4.5 | 4-4.5 |
| 1B Features | 12-16 | 16-20.5 |
| Buffer (20%) | 3-4 | **19-24.5** |

This is larger than the current plan's 12-16 because the current plan does not account for the tree view build. The 20% buffer accounts for UI work's inherent unpredictability (empty states, loading states, error states, responsive adjustments all take more time than expected).

---

## 7. Feedback Checkpoint Schedule

| Checkpoint | Timing | Zac's Action | Blocking? |
|------------|--------|-------------|-----------|
| **CP-0** | Before any code | Review this comprehensive analysis. Confirm or modify architectural decisions (D1-D6). | YES |
| **CP-1** | After shared component layer (1B-0.0) | Review deployed shared components. Does the design language feel right? Icons, spacing, field styles. | YES -- blocks feature work if visual direction rejected |
| **CP-2** | After project list ships (1B-0.1) | 5 minutes looking at the deployed preview. Does this feel like ShossyWorks or generic AI output? | YES -- blocks further UI if rejected |
| **CP-3** | After tree view has editing (1B-0.3) | Try the tree on his own device. Report what feels wrong. This is the most important checkpoint. | YES -- blocks remaining tree work |
| **CP-4** | After 1B-0 completes | Figma prototype review: what to extract from existing designs. Feature priority for 1B-1 through 1B-6. | YES for priority; NO for Figma (informs polish) |
| **CP-5** | After first 1B feature ships | Mid-build review: is the architecture scaling? Any pain points from entering real estimates? | NO -- course correction |

### What Zac Must Bring to Each Checkpoint

- **CP-0:** Opinions on blocking decisions (D1-D6), Figma file access if ready
- **CP-1:** 10 minutes reviewing deployed components in browser
- **CP-2:** 5 minutes reviewing project list UI
- **CP-3:** 15-30 minutes actually using the tree editor. This is the critical checkpoint.
- **CP-4:** Figma links ready for discussion (30-min session), business priority ranking
- **CP-5:** Any real estimates attempted in the tool, friction reports

---

## 8. Research Documentation Strategy

### Structure

```
research/
  output/                           # Existing high-level architecture research
    01-data-architecture.md
    02-implementation-sequence.md
  ui/                               # NEW: UI-specific research (committed to git)
    component-inventory.md          # What exists, what needs building
    tree-view-architecture.md       # Tree component design, state shape, action types
    state-management.md             # Reducer design, optimistic updates, Realtime prep
    interaction-patterns.md         # Keyboard nav, context menus, drag-drop patterns
    prototype-extraction.md         # What was extracted from EP/Soloway/Figma
```

### Rules

1. **Component specs go in `research/ui/`** -- committed to git, referenced by implementers.
2. **Each spec includes an "Implementation Contract" section** -- the concrete interface (props, state shape, events) that the component must satisfy.
3. **Specs reference design tokens explicitly** -- never "use a gray background," always "use `var(--color-bg-secondary)`."
4. **Specs include a "NOT in scope" section** -- prevents scope creep during implementation.
5. **Keep each file under 3KB.** If a component spec exceeds this, split it.
6. **Figma extraction decisions** are recorded in `research/ui/prototype-extraction.md` with per-element decisions (keep/modify/reject).

### How Implementers Reference Research

Each implementation session reads:
- **L1 (always):** CLAUDE.md imports, INTENT.md, CODEBASE_MAP.md, CONTRACT-INDEX.md
- **L2 (per-task):** The specific `research/ui/*.md` file for the component being built
- **L2 (always):** DESIGN-SYSTEM.md (auto-loaded via CLAUDE.md import)

### Contracts for UI Architecture

Create contracts for the critical UI boundaries:

| Contract | Governs | Key Rule |
|----------|---------|----------|
| `tree-state.contract.md` | Reducer state shape, action types, provider interface | State shape must include slots for remote actions; nodesById is flat normalized map |
| `tree-component.contract.md` | Tree container / tree row / detail panel boundaries | Tree renders data it does not own; panel communicates via dispatch only |
| `shared-components.contract.md` | Design system wrapper layer | All Radix imports go through wrappers; zero direct `@radix-ui/*` imports in feature components |

---

## 9. Risk Mitigation -- The Three Failure Modes

### Failure Mode 1: Data/UI coupling (killed EP)

**What went wrong:** EP built UI simultaneously with the data layer. Every schema change broke the frontend. Components directly accessed the database.

**How this architecture prevents it:**
- Data layer is COMPLETE and STABLE before any UI work starts (35+ tables, triggers, typed actions).
- Server components fetch data via server actions; client components receive props. Zero direct Supabase calls from client components (except Realtime subscriptions).
- All mutations flow through server actions that validate with Zod and return structured `ActionResult<T>`.
- The reducer is the ONLY state owner for tree data on the client. Components never mutate data directly.

**Specific safeguards:**
- Server action functions are the contract boundary between data and UI layers.
- If a server action signature changes, TypeScript catches every consumer at compile time.
- The `NodeWithDetails` discriminated union type ensures components handle all node types explicitly.

### Failure Mode 2: AI slop / design drift (Zac's explicit concern)

**What went wrong:** Previous attempts used raw Tailwind with no design system. Each component made ad-hoc style decisions. The result was visually incoherent, felt like generic AI output.

**How this architecture prevents it:**
- DESIGN-SYSTEM.md with CSS custom properties is established before any UI work.
- The Radix wrapper layer (`src/components/shared/`) is the ONLY place visual styling is defined for overlays. Feature components compose wrappers, never style from scratch.
- PostToolUse hook checks every `.tsx` edit for design system violations.
- Automated `design-system-check.sh` script greps for forbidden patterns: `rounded-sm`, `rounded-md`, `rounded-lg`, `rounded-xl`, `bg-white`, `bg-gray-*`, `text-gray-*`, hardcoded hex values.
- CP-2 is an explicit visual direction checkpoint -- Zac reviews the look and feel before feature work proceeds.

**Specific safeguards:**
- Build the shared component layer FIRST (1B-0.0) and get Zac's approval before any feature components.
- Every color is `var(--color-*)`, every spacing is `var(--space-*)`, every shadow is `var(--shadow-*)`.
- Sharp corners on all rectangles (containers, cards, inputs, panels). Pill shape on buttons and badges. Zero in-between.

### Failure Mode 3: Component coupling that prevents iteration (killed Soloway)

**What went wrong:** Soloway's tree rows were editable inline, coupling tree rendering with form state. When editing features were added later, the architecture could not accommodate it without rewriting. Components owned their data and could not accept external mutations.

**How this architecture prevents it:**
- **Tree rendering is separated from node editing.** Tree rows display data and dispatch selection events. The detail panel is a completely independent component that reads from the same state and dispatches mutations back. Either can be replaced without touching the other.
- **Data ownership is centralized in the reducer.** No component "owns" data. All components read from the reducer state and dispatch actions. The reducer is the single source of truth.
- **The compound component pattern with context/reducer** means new features (snapshots, catalog, options) plug in as panels that dispatch to the same reducer. They do not require modifying the tree component.
- **Each layer in the three-layer tree (container, virtual renderer, row) has a narrow interface.** Changing the row rendering (e.g., adding inline cost columns) does not affect the virtual scroller or the state container.

**Specific safeguards:**
- Action types for future features (`REMOTE_UPSERT`, `REMOTE_REMOVE`, future `CALC_RESULT_RECEIVED`) exist as no-ops in the reducer from day one.
- The detail panel and tree communicate only through the shared state -- no direct function calls, no event emitters, no prop drilling of callbacks.
- The virtual scroller is a separate layer that only knows about `FlatRow[]` -- it has zero knowledge of node types, editing, or business logic.

---

## 10. Disagreements Between Analysts

### Disagreement 1: Virtualization Urgency

**State Management analyst** says virtualization is "NOT needed at launch" -- with expand/collapse, typically only 50-200 rows are visible, and `React.memo` on TreeRow should suffice. Monitor first, add later.

**Component Architecture analyst** and **Sequencing analyst** say virtual scrolling is mandatory from day one and "a retrofit is 2-3x harder than designing for it upfront."

**Design analyst** recommends TanStack Table + `@tanstack/virtual` specifically.

**Resolution:** Side with the majority. **Build with `@tanstack/react-virtual` from day one.** The architectural cost of adding it upfront is minimal (it is a rendering layer, not a state change). The cost of retrofitting a working tree to use virtual scrolling is significant because it requires changing from recursive React component rendering to flat-list-with-depth rendering. Do it right the first time. The State Management analyst's concern about premature optimization is valid for most cases, but the tree is the core product -- it must perform well at scale from launch.

### Disagreement 2: Inline Editing in Tree Rows

**Design/UX analyst** advocates for inline editing as a micro-interaction priority (double-click cell to edit, Tab between cells, spreadsheet-like behavior), calling it "the most common interaction" that "must be zero-friction."

**Component Architecture analyst** explicitly warns against inline editing in tree rows as an anti-pattern from day one: "The Soloway attempt did this and it coupled tree rendering with form state. Start with selection + side panel."

**Resolution:** This is a genuine tension. The correct phased approach:

1. **Phase 1B-0:** Side panel editing ONLY. Tree rows are display-only. This establishes the clean separation.
2. **Phase 1B-0.3 stretch goal:** Inline NAME editing only (single text field, not full form) in tree rows. This is low-risk because it is one field.
3. **Phase 2:** Full inline cell editing (quantity, cost) as a polish feature. By this point the architecture is stable enough to handle the coupling.

The Component analyst is right about architecture; the Design analyst is right about UX. The phased approach satisfies both.

### Disagreement 3: Context vs Direct Props for Tree Rows

**Component Architecture analyst** initially proposes a `EstimateTreeContext` with `getNode()`, `isExpanded()` etc., then self-corrects to recommend direct props for Phase 1 (5 props per row, not prop drilling) with context + `useSyncExternalStore` as a Phase 2 optimization.

**State Management analyst** recommends selector hooks (`useNode(id)`, `useChildren(parentId)`) via context from the start to prevent re-render cascades.

**Resolution:** Start with **direct props** (the simpler approach). The virtual scroller already provides the mapping from flat rows to components. Each row gets 5-6 props. `React.memo` prevents unnecessary re-renders. If profiling shows performance issues with 2000 nodes, migrate to selector hooks. The State Management analyst's concern is valid but the virtual scroller already limits the number of rendered components to 30-50, making the re-render cascade concern less severe than in a fully-rendered tree.

### Disagreement 4: Reducer's `flatVisibleRows` Computation

**Component Architecture analyst** says `flatVisibleRows` should be computed in the reducer (not in `useMemo`): "the reducer must own this computation to avoid render-time recalculation."

**State Management analyst** does not address this specific point but implies the reducer should be lean and derived state should be computed separately.

**Resolution:** Compute `flatVisibleRows` **in the reducer** (on every expand/collapse or node add/remove action). This pre-computation means the virtual scroller receives a stable array without triggering additional renders. The reducer is the right place because it already knows when the tree structure or expanded set changes. A `useMemo` approach would recompute on every render cycle, which is wasteful.

### Disagreement 5: TanStack Table vs Custom Tree

**Design/UX analyst** recommends "TanStack Table for the data grid foundation + `@tanstack/virtual` for row virtualization," treating the tree as a tree-table hybrid with columns.

**Component Architecture analyst** says TanStack Table is "designed for tabular data, not tree structures" and recommends a custom tree with `@tanstack/react-virtual` only.

**Resolution:** Side with the **Component Architecture analyst**. TanStack Table's column model does not fit the tree use case well -- groups have 3 fields, items have 20+. Forcing discriminated union node types into a uniform column grid creates the wrong UX. Use `@tanstack/react-virtual` for scrolling, but build the tree layout as a custom component with type-specific row renderers. If a true tree-table (with sortable/resizable columns showing cost data) is needed later, it can be added as a Phase 2 enhancement -- but the primary interaction is the tree hierarchy with a side panel, not a spreadsheet.

---

## Appendix: Cross-Reference Matrix

This table shows which analysts contributed to each major finding, making the synthesis auditable.

| Finding | Page Arch | Component Arch | State Mgmt | Design/UX | Sequencing |
|---------|:---------:|:--------------:|:----------:|:---------:|:----------:|
| 1B-0 missing from plan | x | | | | x |
| useReducer for tree | | x | x | | x |
| Custom tree component | | x | | x | x |
| Flat normalized state | | x | x | | |
| Server/client boundary | x | x | x | | |
| Remote action types from day 1 | | x | x | | x |
| Design system enforcement | | x | | x | x |
| Side panel editing | | x | | x | x |
| Radix UI primitives | | x | | x | |
| Virtual scrolling | | x | x | x | x |
| Breadcrumbs essential | x | | | x | x |
| Desktop-first | x | | | x | x |
| Immer dependency | | x | x | | |
| Keyboard navigation | | x | | x | x |
| Drag-drop deferred | | x | | x | x |
| Delete not undoable in 1B | | | x | | x |

---

*This synthesis drives the research phase. All topic clusters (Section 3) must be researched before implementation begins. All blocking decisions (Section 4) must be resolved at CP-0. The build sequence (Section 6) replaces the current plan's Phase 1B structure.*
