# Sequencing & Risk Analysis

**Analyst:** Sequencing & Risk Review Board Member
**Date:** 2026-04-09
**Scope:** Build order, plan integration, research documentation, feedback checkpoints, risk analysis, session planning

---

## 1. Build Order — Minimum Viable Sequence

### The Core Dependency Chain

The tree view is the heart of the product, but it cannot be the FIRST thing built. A tree view with no projects and no estimates to navigate into is useless. The minimum viable sequence must be built bottom-up through the navigation hierarchy:

```
Layer 0: Layout shell (EXISTS — sidebar, header, main content area)
Layer 1: Project list + project detail/create
Layer 2: Estimate list + estimate create (within a project)
Layer 3: Tree view — the core interaction
Layer 4: Node editing — inline name editing + detail panel
Layer 5: Node operations — add/delete/move/indent/outdent/reorder
```

**Critical insight: Layers 1-2 are thin.** The server actions already exist (`createProject`, `getProjects`, `createEstimate`, `getEstimates`, `createNode`, `updateNode`, `deleteNode`, `moveNode`). The UI for Layers 1-2 is straightforward CRUD — project list, project detail page, estimate list within project. These can be built in half a session each. The real complexity starts at Layer 3.

### What "Minimum Viable Tree View" Actually Means

The tree view is not one component — it is a system of components:

```
TreeContainer (state management, data fetching)
  TreeToolbar (add node, search, filters)
  TreeList (scrollable, virtualized for 500+ nodes)
    TreeRow (single node — expand/collapse, type icon, name, actions)
      TreeIndent (visual nesting depth indicators)
      NodeName (inline editable text)
      NodeActions (context menu: edit, delete, move, duplicate)
  DetailPanel (right side — selected node's full details)
    ItemDetailForm (quantity, unit, cost, markup fields)
    AssemblyDetailForm (quantity, unit, ratio config)
    GroupDetailForm (minimal — name, description)
```

The MVP tree view needs: render, expand/collapse, add node, delete node, inline name editing. Move/indent/outdent can come in the same session but are a stretch goal. Detail panel editing is critical but can land in the session immediately after the tree structure is working.

### Recommended Build Sequence (Pre-1B Features)

| Step | What | Session Budget | Depends On |
|------|------|---------------|------------|
| 1 | Project list page + create/edit dialogs | 0.5 session | Server actions (exist) |
| 2 | Estimate list page + create dialog (within project) | 0.5 session | Step 1 |
| 3 | Tree view — render + expand/collapse + add/delete | 1.0 session | Step 2, state mgmt decision |
| 4 | Tree view — node editing (inline name + detail panel) | 1.0 session | Step 3 |
| 5 | Tree view — move/indent/outdent/reorder | 0.5-1.0 session | Step 4 |
| 6 | Tree view — keyboard navigation + polish | 0.5 session | Step 5 |

**Total: 4-4.5 sessions for core navigation + tree**

This is the "Phase 1B-0" that does NOT exist in the current plan. The current plan jumps straight to 1B-1 (Snapshots) which assumes "estimate tree UI exists" as a dependency. Where does the tree get built? This is a critical gap.

---

## 2. Integration with Existing Phase 1B Plan — Gap Analysis

### Current Plan Structure (from indexed-tumbling-wilkes.md)

| Sub-Phase | Focus | Sessions | Dependency |
|-----------|-------|----------|------------|
| 1B-1 | Snapshot UI | 2-3 | "Phase 1A complete, estimate tree UI exists" |
| 1B-2 | Catalog System | 2-3 | "Phase 1A complete, node CRUD UI exists" |
| 1B-3 | Options UI | 2-3 | "Phase 1A complete" |
| 1B-4 | Client Portal | 3-4 | "Phase 1A complete" |
| 1B-5 | Search & Filtering | 1-2 | "Phase 1A complete (GIN indexes exist)" |
| 1B-6 | Preferences & Settings | 1 | "Phase 1A complete" |
| **Total** | | **12-16** | |

### CRITICAL GAP: No "1B-0" for Core Navigation + Tree UI

The plan lists "estimate tree UI exists" as a dependency for 1B-1 and "node CRUD UI exists" for 1B-2, but NEITHER of these is delivered by any Phase 1B sub-phase. The plan assumes they materialize from thin air.

**This is the same sequencing mistake that killed the previous attempts.** The tree view is the single most complex UI component in the entire application, and the plan doesn't allocate sessions for it.

### Proposed Revised Phase 1B Structure

| Sub-Phase | Focus | Sessions | Dependency |
|-----------|-------|----------|------------|
| **1B-0** | **Project/Estimate navigation + Tree View + Node CRUD** | **4-4.5** | Phase 1A complete |
| 1B-1 | Snapshot UI | 2-3 | 1B-0 (tree exists) |
| 1B-2 | Catalog System | 2-3 | 1B-0 (node CRUD exists) |
| 1B-3 | Options UI | 2-3 | 1B-0 (tree exists) |
| 1B-4 | Client Portal | 3-4 | 1B-0 (tree exists for client view) |
| 1B-5 | Search & Filtering | 1-2 | 1B-0 (tree exists to filter within) |
| 1B-6 | Preferences & Settings | 1 | 1B-0 (estimate view to remember state for) |
| **Revised Total** | | **16.5-21.5** | |

### Interleaving Order Within 1B

After 1B-0, the 6 features can be sequenced based on user value and technical dependency:

**Tier 1 — Immediately useful after tree view:**
- 1B-6 Settings & Preferences (1 session) — small scope, enables company defaults used by everything else
- 1B-5 Search & Filtering (1-2 sessions) — makes the tree usable for real estimates with 100+ nodes

**Tier 2 — Core workflow features:**
- 1B-2 Catalog (2-3 sessions) — makes data entry practical (populate from templates)
- 1B-1 Snapshots (2-3 sessions) — safety net before making changes

**Tier 3 — Advanced features:**
- 1B-3 Options UI (2-3 sessions) — builds on catalog for alternatives
- 1B-4 Client Portal (3-4 sessions) — requires tree + options for meaningful client interaction

**Rationale:** Settings enables defaults. Search makes the tree navigable. Catalog makes data entry fast. Snapshots add safety. Options and client portal build on everything below them.

### State Management Decision Point

The plan mentions "React context + useReducer, or Zustand -- decide and commit here" in the original Phase 1B scope. This decision MUST happen before any tree code is written. It cannot be deferred.

**Recommendation:** useReducer for tree state (INTENT.md Decision 13 already says this). The tree reducer needs to handle two mutation sources: local edits and Supabase Realtime broadcasts. useReducer with a well-typed action union is the right primitive for this. Zustand adds a dependency for minimal benefit when the state is already scoped to one estimate view.

---

## 3. Research Documentation Strategy

### Problem

UI research needs to be usable DURING implementation, not just before it. If findings live in scattered files that implementers don't read, the research is wasted.

### Recommended Structure

```
research/
  output/                           # Existing — high-level architecture
    01-data-architecture.md
    02-implementation-sequence.md
  ui/                               # NEW — UI-specific research
    component-inventory.md          # What components exist, what needs building
    tree-view-architecture.md       # Tree component design decisions
    state-management.md             # useReducer design, action types, Realtime integration
    interaction-patterns.md         # Keyboard nav, drag-drop, inline editing patterns
    prototype-extraction.md         # What was extracted from EP/Soloway/Figma

.scratch/epp/                       # Working scratch (not committed)
  [session-specific analysis files]
```

### Documentation Rules for UI Research

1. **Component specs go in `research/ui/`** — committed to git, referenced by implementers
2. **Each spec includes "Implementation Contract" section** — the concrete interface (props, state shape, events) that the component must satisfy
3. **Specs reference design tokens explicitly** — no "use a gray background," always "use `var(--color-bg-secondary)`"
4. **Specs include a "NOT in scope" section** — prevent scope creep during implementation
5. **Figma extraction decisions** are recorded in `research/ui/prototype-extraction.md` with screenshot references and per-element decisions (keep/modify/reject)

### How Implementers Reference Research

Each implementation session starts by reading:
- L1: CLAUDE.md imports, INTENT.md, CODEBASE_MAP.md, CONTRACT-INDEX.md
- L2: The specific `research/ui/*.md` file for the component being built
- L2: The design system (DESIGN-SYSTEM.md, already auto-loaded)

Research docs should be concise (<3KB each). If a component spec exceeds this, it is trying to document too many components in one file — split it.

---

## 4. Feedback Checkpoint Schedule

### Decision Types and Their Timing

| Decision Type | When | How | Example |
|---------------|------|-----|---------|
| **Layout choice** | Before building, with mockup/wireframe | Screenshot or Figma link + 2-3 options | "Sidebar nav or top nav?" "Detail panel right-side or bottom?" |
| **Component library** | Once, before any UI work | Written recommendation + tradeoffs | "Custom components vs Radix UI headless primitives" |
| **Visual direction** | After first component lands | Deploy to Vercel preview, review in browser | "Does this feel right? Too sparse? Too dense?" |
| **Interaction pattern** | Before implementing each major interaction | Written description + reference example | "Indent via Tab key or drag handle?" |
| **Feature priority** | Between 1B tiers | Bullet list of what's next | "Catalog or snapshots first?" |
| **Color/type refinement** | After MVP tree view ships | Live review on device | "Adjust spacing, font weight, contrast" |

### Proposed Checkpoint Schedule

| Checkpoint | Timing | Decision Needed | Blocking? |
|------------|--------|----------------|-----------|
| **CP-1** | Before 1B-0 starts | Component library approach (custom vs headless), state management pattern, tree layout (sidebar tree vs full-width) | YES — blocks all UI work |
| **CP-2** | After project list page ships | Visual direction approval: "Does this look/feel right?" | YES — blocks further UI if rejected |
| **CP-3** | After tree view MVP renders | Tree interaction model: keyboard shortcuts, context menu design, detail panel position | YES — blocks node editing |
| **CP-4** | After node editing works end-to-end | Figma prototype review: what to extract from existing designs | NO — informs polish, not blocking |
| **CP-5** | After 1B-0 completes | Feature priority for 1B-1 through 1B-6 ordering | YES — determines next work |
| **CP-6** | After first 1B feature ships | Mid-build review: is the architecture scaling? Any pain points? | NO — course correction |

### What Zac Must Bring to Each Checkpoint

- **CP-1:** Opinions on headless UI libraries, Figma prototype links if ready
- **CP-2:** 5 minutes looking at the deployed preview, verbal feedback
- **CP-3:** Try the tree on his own device, report what feels wrong
- **CP-4:** Figma file access, 30-minute discussion session
- **CP-5:** Business priority ranking (what does he need first for actual estimates?)
- **CP-6:** Any real estimates he's tried to build, friction reports

---

## 5. Risk Analysis

### RISK 1: Tree View Performance at Scale (SEVERITY: HIGH)

**The problem:** Estimates can have 500-2,000 nodes. A naive React tree rendering 2,000 DOM elements with expand/collapse state, inline editing, and drag-drop will be slow.

**Why it matters:** If the tree feels sluggish, the entire product fails. Construction estimators switch between line items rapidly — 200ms+ latency on expand/collapse is unacceptable.

**Mitigation:**
- Use virtual scrolling (TanStack Virtual or similar) from day one, not as a retrofit
- Only render visible rows + small buffer (50-100 rows in viewport vs 2,000 total)
- Flatten the tree for rendering (array of {node, depth, expanded} tuples) — do not use recursive React components
- Memoize aggressively: each row should only re-render when its own data changes

**Risk if ignored:** Performance retrofit after the tree is built is 2-3x harder than designing for it upfront. The Soloway attempt had no performance issues because it was read-only with ~500 nodes. ShossyWorks needs to handle 2,000 nodes with real-time edits.

### RISK 2: Component Architecture That Doesn't Scale to Phase 2 (SEVERITY: HIGH)

**The problem:** Phase 2 adds the calculation engine (isomorphic calc module, formula evaluation, assembly cascades). If the tree component directly manages its own data fetching and mutation, integrating the calc engine requires a major refactor.

**Why it matters:** This is EXACTLY what killed Attempt 1 — tightly coupled components that couldn't accommodate new features without rewriting.

**Mitigation:**
- Strict separation: tree RENDERS data, it does not OWN data
- Data flows through a reducer/store, not through component state
- Mutations go through server actions, never direct Supabase calls from components
- The calc engine will plug into the reducer as a middleware/effect — plan the reducer's action types with this in mind
- Reserve action types like `CALC_RESULT_RECEIVED`, `FORMULA_EVALUATED` even if they're no-ops in Phase 1B

**Required architecture:**
```
Server Actions (data mutations)
  |
  v
Reducer (single source of truth for tree state)
  |
  v
Tree Component (pure rendering, receives state via context/props)
  |
  v
Detail Panel (pure rendering, receives selected node via context/props)
```

### RISK 3: Real-Time Collaboration Conflicts (SEVERITY: MEDIUM)

**The problem:** Two users editing the same estimate simultaneously. User A moves a node while User B edits its name. Supabase Realtime broadcasts arrive out of order.

**Why it matters:** Decision 9 in INTENT.md commits to "presence-guided last-writer-wins (matches Google Sheets)." The reducer must handle remote actions cleanly.

**Mitigation:**
- Design the reducer action union with both local and remote variants from day one
- `LOCAL_NODE_UPDATED` vs `REMOTE_NODE_UPDATED` — same payload, different sources
- Remote actions skip optimistic UI (they represent already-committed state)
- Presence tracking: show who's editing which node (colored border/avatar)
- Don't build real-time in Phase 1B but DESIGN the reducer to accept it

**Risk if ignored:** Retrofitting dual-source state management is the most expensive refactor possible. Decision 13 in INTENT.md explicitly warns about this.

### RISK 4: Design Drift / "AI Slop" Accumulation (SEVERITY: HIGH)

**The problem:** Each session generates UI. Without active design governance, components will drift from the design system. Rounded corners sneak in. Hardcoded colors appear. Spacing becomes inconsistent.

**Why it matters:** This was explicitly identified as Failure Mode #2 from previous attempts. The design system exists (DESIGN-SYSTEM.md), but enforcement during rapid UI development requires discipline.

**Mitigation:**
- Every PR/commit touching `.tsx` files gets a design system compliance check
- Create a `design-system-check.sh` script that greps for forbidden patterns
- Forbidden pattern list: `rounded-sm`, `rounded-md`, `rounded-lg`, `rounded-xl`, `bg-white`, `bg-gray-`, `text-gray-`, hardcoded hex values
- CP-2 (visual direction checkpoint) is explicitly a design review, not just a feature review
- Consider extracting common patterns into reusable components early (Button, Input, Card, Panel) to prevent drift

### RISK 5: Estimate View State Complexity (SEVERITY: MEDIUM)

**The problem:** Each user needs their own view state per estimate: which nodes are expanded, which columns are visible, sort order, scroll position. This state must persist across page refreshes and sessions.

**Why it matters:** If the tree resets to fully-collapsed every time the page loads, the UX is terrible. Decision 21 says "app remembers last-used settings per estimate."

**Mitigation:**
- `estimate_view_state` table already exists in the schema
- Debounced saves: update view state on collapse/expand/scroll, debounced to avoid excessive writes
- Load view state on page mount, apply to tree before first render
- Consider localStorage as fast cache with Supabase as authoritative store
- This is 1B-6 scope but the reducer must account for it from 1B-0

### RISK 6: Tree View State Management Complexity (SEVERITY: HIGH)

**The problem:** The tree state is the most complex piece of client-side state in the entire application. It must track: node data (from server), expanded/collapsed state (per user), selected node, editing state (which field is being edited), pending mutations (optimistic updates), and eventually real-time presence.

**Why it matters:** If the state model is wrong, every feature built on top of it inherits the problem. This compounds across 1B-1 through 1B-6.

**Mitigation:**
- Define the complete state shape BEFORE writing any components
- Document the state shape as a contract in `contracts/`
- State shape must include slots for: tree data, view state, selection, editing, pending operations, and (future) real-time
- Write the reducer with exhaustive action type matching (TypeScript discriminated union)
- Test the reducer independently of React (pure function, unit testable)

### RISK 7: Session Scope Creep (SEVERITY: MEDIUM)

**The problem:** UI work is notoriously hard to estimate. "Build the project list page" sounds like 2 hours but becomes 6 when you add create dialogs, validation feedback, empty states, loading states, error states, and responsive layout.

**Mitigation:**
- Each session has an explicit "done when" checklist
- "Functional, not polished" is the standard for 1B-0 (like the original plan says for Phase 1B tree)
- Polish sessions are scheduled explicitly (not "we'll clean it up later")
- If a session runs long, cut the stretch goals, not the testing

---

## 6. Session Planning — Full UI Build

### Phase 1B-0: Core Navigation + Tree View (4-4.5 sessions)

| Session | Deliverable | Done When |
|---------|------------|-----------|
| 1B-0.1 | Project list + create/edit + estimate list + create | Can navigate from dashboard to project to estimate list. Can create a project and estimate through the UI. |
| 1B-0.2 | Tree view — render + expand/collapse + add node + delete node | Tree renders with proper nesting. Can add nodes of all 3 types. Can delete nodes (subtree cascades). Expand/collapse works. |
| 1B-0.3 | Tree view — inline name editing + detail panel | Can edit node name inline. Detail panel shows selected node's type-specific fields. Can edit item details (qty, unit, cost). |
| 1B-0.4 | Tree view — move/indent/outdent + keyboard nav | Can reorder siblings. Can indent/outdent (re-parent). Basic keyboard navigation (arrow keys to move selection, Enter to edit, Escape to cancel). |

### Phase 1B Features (12-16 sessions)

| Session | Sub-Phase | Deliverable |
|---------|-----------|-------------|
| 1B-6.1 | Settings & Preferences | Company settings form + user preferences panel + estimate view state persistence |
| 1B-5.1 | Search & Filtering (part 1) | Search box in tree toolbar with live ILIKE filtering within current estimate |
| 1B-5.2 | Search & Filtering (part 2) | Full-text search with scope selector (estimate/project/global) + filter bar |
| 1B-2.1 | Catalog (part 1) | "Add to Catalog" + catalog browser panel + search |
| 1B-2.2 | Catalog (part 2) | "Insert from Catalog" + "Update from Catalog" + CSV import |
| 1B-1.1 | Snapshots (part 1) | Create snapshot dialog + snapshot browser panel |
| 1B-1.2 | Snapshots (part 2) | Snapshot viewer (read-only) + restore + comparison view |
| 1B-3.1 | Options (part 1) | Option group/alternative creation + visual indicators in tree |
| 1B-3.2 | Options (part 2) | Option set management + comparison table + active tree filtering |
| 1B-4.1 | Client Portal (part 1) | Share link generation + validation endpoint + rate limiting |
| 1B-4.2 | Client Portal (part 2) | Client estimate viewer (filtered) + commenting |
| 1B-4.3 | Client Portal (part 3) | Approval workflow + PIN auth flow |

### Total Session Budget

| Phase | Sessions | Cumulative |
|-------|----------|------------|
| 1B-0 Core Navigation + Tree | 4-4.5 | 4-4.5 |
| 1B-6 Settings | 1 | 5-5.5 |
| 1B-5 Search | 1.5-2 | 6.5-7.5 |
| 1B-2 Catalog | 2-3 | 8.5-10.5 |
| 1B-1 Snapshots | 2-3 | 10.5-13.5 |
| 1B-3 Options | 2-3 | 12.5-16.5 |
| 1B-4 Client Portal | 3-4 | 15.5-20.5 |
| **Buffer (20%)** | 3-4 | **18.5-24.5** |

### MVP Definition

**MVP = 1B-0 + 1B-6 + 1B-5 (part 1) = 5.5-6.5 sessions**

After these sessions, Zac has:
- A working project/estimate navigation flow
- A functional tree view with CRUD, editing, move/indent/outdent
- Company defaults configured
- Basic search within estimates

This is enough to START entering real estimates and discover real usability issues before building catalog, snapshots, options, and client portal.

---

## 7. Construction SaaS Industry Patterns

### How Successful Products Sequenced Their Features

Based on research into Procore, Buildertrend, PlanGrid, Buildxact, and STACK:

1. **All start with project organization** — every tool requires creating a project before doing anything else
2. **Estimate entry (line items) comes before everything** — the core data entry experience is the MVP
3. **Templates/catalog comes early** — repetitive estimation requires reusable items (Buildxact emphasizes this for residential builders)
4. **Reporting/export comes after data entry is solid** — you can't report on data that doesn't exist
5. **Client sharing is a differentiator, not a foundation** — Procore's estimating focuses on bid management before client visibility; Buildertrend adds client-facing features on top of working estimates
6. **Mobile/responsive is deferred** — all platforms were desktop-first, mobile was added later

**Key lesson:** The industry confirms the bottom-up sequence. Project -> Estimate -> Line Items -> Templates -> Reports -> Client Features. ShossyWorks' proposed order aligns with this, with the addition of the options system (a differentiator) between templates and client features.

### Competitive Differentiators That Matter

- Ease of learning (1-3 day onboarding for simple tools vs 1-2 weeks for complex ones)
- Integration with accounting (QuickBooks) — deferred, not Phase 1B
- The options system with saved scenarios is ShossyWorks' unique advantage — no competitor does full subtree swapping with additive toggles

---

## 8. Previously Overlooked Concerns

### The Sidebar Needs to Evolve

The current sidebar has 3 items: Dashboard, Projects, Settings. As the tree view is built, the sidebar needs project-level and estimate-level context. When viewing an estimate tree, the sidebar should show the project hierarchy (like a file explorer). This is a design decision that affects the layout architecture and should be part of CP-1.

### The Header Needs Contextual Information

The header currently shows "ShossyWorks" and a user menu. When inside an estimate, it should show breadcrumbs: Projects > Project Name > Estimate Name. This is a small detail but affects the layout component architecture. Build it during 1B-0.1, not as an afterthought.

### Empty States Are Not Optional

Every list page needs an empty state: "No projects yet. Create your first project." Every tree needs an empty state: "This estimate has no items. Add your first group." Empty states with clear CTAs are the difference between "this feels broken" and "this guides me." Budget time for them in 1B-0.

### Error States on Mutations Need Design

When a server action fails (network error, validation error, RLS denial), the tree must show feedback without destroying the user's context. This means: toast/notification system, not full-page error boundaries. The error boundary architecture exists at route level, but tree-level mutation errors need a different pattern.

---

## Summary of Findings

| # | Finding | Severity | Action Required |
|---|---------|----------|----------------|
| 1 | Phase 1B plan has no session allocation for tree view / core navigation | **CRITICAL** | Add 1B-0 phase (4-4.5 sessions) before any 1B features |
| 2 | State management decision is undocumented and unresolved | **HIGH** | Decide at CP-1, document as contract, before any UI code |
| 3 | Tree view performance requires virtual scrolling from day one | **HIGH** | Architect for TanStack Virtual or equivalent, no retrofit |
| 4 | Component architecture must separate data ownership from rendering | **HIGH** | Reducer owns state, components are pure renderers |
| 5 | Real-time support must be designed in (not built, but designed) | **HIGH** | Reducer action types include remote variants from 1B-0 |
| 6 | Design drift risk is highest during rapid UI development | **HIGH** | Automated checks, CP-2 as explicit design review |
| 7 | Feature ordering should be: Settings, Search, Catalog, Snapshots, Options, Client | **MEDIUM** | Reorder from current plan's implicit parallelism |
| 8 | Total session budget is 18.5-24.5 (not the plan's 12-16) | **MEDIUM** | Update plan with realistic tree view allocation |
| 9 | Sidebar/header/breadcrumbs need architectural planning in 1B-0 | **LOW** | Include in CP-1 layout decisions |
| 10 | MVP = 1B-0 + Settings + Basic Search = ~6 sessions of usable product | **INFO** | Defines the minimum for real estimate entry |
