# Implementation Sequence (v2)

> **Date:** 2026-04-02
> **Revised:** 2026-04-02 -- Incorporates findings from five review documents: data model review (01), calculation engine review (02), options system review (03), sequence/risk review (04), and industry research review (05). All changes are additive refinements; the fundamental bottom-up sequence is unchanged.
>
> **Principle:** Strictly bottom-up. Each phase is independently testable and provably stable before the next begins. No parallel layer development -- the single biggest lesson from both previous attempts.

---

## Phase 0: Project Scaffolding

### Scope
Stand up the infrastructure before touching any domain logic. Prove the deployment pipeline works end-to-end with a trivial app shell.

### What Gets Built
- Next.js project scaffolded with TypeScript and Tailwind
- Supabase project created, connected, and environment variables wired
- Auth configured (single-user Supabase Auth with email login)
- RLS policy decision made and implemented (enable with permissive single-owner policies, or defer with explicit documentation of the tradeoff)
- `app.current_user_id` session variable for history trigger attribution
- Basic app shell: layout component, navigation skeleton, placeholder pages
- First Vercel deployment -- prove the full pipeline (push to GitHub, Vercel builds, connects to Supabase, auth works in production)
- Environment wiring verified: Supabase URL, anon key, service role key all working in both local dev and Vercel

### Prerequisites
- GitHub repository created
- Supabase account and project provisioned
- Vercel account linked to GitHub

### Testable Output
- `next dev` runs locally with no errors
- Can sign in via Supabase Auth (email/password)
- Vercel deployment succeeds and auth works at the deployed URL
- Environment variables are correctly configured in both local `.env.local` and Vercel dashboard

### Done Criteria
- App shell renders at both localhost and production URL
- Auth flow works end-to-end (sign in, session persists, sign out)
- No infrastructure surprises remaining

### Estimated Sessions: **1**
### Complexity: **Low**
Boilerplate setup. Auth configuration is the only non-trivial part.

---

## Phase 1A: Schema, Constraints, Triggers & Server Actions

### Scope
Stand up the core database schema and prove the data layer works. No UI -- everything is testable via server actions, automated tests, or direct SQL. The schema is frozen once this phase passes.

### What Gets Built

**Core tables:**
- `projects` table (minimal -- name, status, dates)
- `estimates` table (minimal -- name, project FK, status; version fields exist but versioning logic deferred)
- `estimate_nodes` base table with all columns, including:
  - `ltree path` column with GiST index, maintained by a trigger on INSERT/UPDATE of `parent_id` (dual adjacency-list + ltree pattern from data model review)
  - `client_visibility` field (present from day one, exercised in Phase 8)
- `node_item_details` table with all columns, including:
  - `vendor_id` as a plain UUID column with NO foreign key constraint (FK added in Phase 9 when the vendors table is created)
- `node_assembly_details` table with all columns
- `units_of_measure` table + expanded seed data (SF, LF, SY, CF, CY, EA, HR, DAY, PR, SET, BOX, BDL, GAL, LB, TON, LS, SQ, MBF, MSF, BAG, ROLL, SHEET, TUBE, PAIL -- per industry research review)
- `phases` table
- `project_parameters` table (schema only -- formula engine uses it in Phase 4)

**Cost codes table (from industry research review):**
- `cost_codes` table with structured fields: `id`, `code VARCHAR(20)`, `division VARCHAR(2)`, `title VARCHAR(255)`, `parent_code_id UUID FK` (self-ref for hierarchy), `is_system BOOLEAN`
- `estimate_nodes.cost_code_id UUID FK -> cost_codes(id)` replacing the free-text `cost_code VARCHAR(50)`
- Seed data: MasterFormat residential divisions (01, 03, 04, 05, 06, 07, 08, 09, 10, 22, 23, 26, 31, 32) with Level 2 subsections for each

**Database constraints:**
- CHECK constraints on all enum-like fields
- FK cascades (parent_id CASCADE DELETE)
- `items_must_have_parent` constraint
- `unique_reference_name` per estimate
- `CHECK (ratio_denominator IS NULL OR ratio_denominator != 0)` (from calc engine review)

**Database triggers:**
- `updated_at` auto-update trigger on all tables
- Parent-child type validation: items cannot have children (fires on INSERT where parent is an item)
- Node type change prevention: trigger on UPDATE of `node_type` that rejects changing to 'item' if the node has children (from data model review)
- `ltree path` maintenance: trigger on INSERT/UPDATE of `parent_id` that recomputes path for the node and all descendants

**History tracking:**
- `estimate_nodes_history`, `node_item_details_history`, `node_assembly_details_history` tables
- History triggers that capture OLD row values on every UPDATE/DELETE
- Rule documented as contract: every future migration on a tracked table must also touch its history table

**Server actions:**
- `createNode`, `updateNode`, `deleteNode`, `moveNode` (re-parent + reorder), `getNodes`
- `createProject`, `getProjects`, `createEstimate`, `getEstimates`
- Batch operations where appropriate

### Prerequisites
- Phase 0 complete -- infrastructure working

### Testable Output
- Can create a project with an estimate via server actions
- Can add group, assembly, and item nodes
- Can move nodes between parents (re-parent operation)
- Can reorder siblings
- Can delete nodes (subtree cascades)
- Invalid operations rejected: item as parent, orphan items, node_type change to 'item' when children exist
- History triggers fire on every edit (verify rows in history tables)
- ltree paths are correct after all tree operations (moves, inserts, deletes)
- Cost code FK references work, seed data is present

### Done Criteria
- All CRUD operations work correctly via server actions
- Database constraints prevent all structural invariant violations
- History tables capture every change with correct attribution
- ltree paths are consistent with adjacency-list parent_id
- Schema is frozen -- Phase 1B builds on top without changing tables

### Estimated Sessions: **1-2**
### Complexity: **Moderate**
Well-defined scope. The ltree trigger and node_type change prevention trigger add modest complexity.

---

## Phase 1B: Tree UI & Project Navigation

### Scope
Build the visual tree editor and project navigation on top of the proven schema. Since the data layer is frozen from Phase 1A, UI bugs cannot introduce schema changes.

### What Gets Built
- Project list page: list projects, create project, select project
- Estimate list page: list estimates for a project, create estimate, select estimate, rename, delete
- Basic project navigation flow: projects -> estimates -> tree editor
- Client-side `buildTree()` -- flat array to nested tree structure
- Tree UI: render nodes, expand/collapse, add/delete, reorder (move up/down), indent/outdent
- Node editing: inline editing of node name, basic field editing panel
- UI state management pattern established (React context + useReducer, or Zustand -- decide and commit here, used for all subsequent phases)

### Prerequisites
- Phase 1A complete and stable -- schema frozen, server actions proven

### Testable Output
- Can navigate from project list to estimate list to tree editor
- Can create a project and estimate through the UI
- Tree renders correctly with proper nesting and ordering
- Can add nodes via UI
- Can move nodes between parents (indent/outdent via UI)
- Can reorder siblings (move up/down via UI)
- Can delete nodes via UI (subtree cascades)
- Tree renders identically after page refresh (no client/server state drift)

### Done Criteria
- All tree operations work correctly through the UI with no stale state
- Tree renders identically after page refresh
- Project/estimate navigation is functional (not polished -- functional)
- UI state management pattern is established and documented

### Estimated Sessions: **2-3**
### Complexity: **Moderate**
Tree rendering and state management are the primary challenges. UI always takes longer than expected.

### Deployment
First deployment to Vercel at the end of Phase 1B. Get the basics live early. Each subsequent phase deploys as part of its completion.

---

## Phase 2: Calculation Engine

### Scope
Implement the full calculation chain and prove it produces correct numbers. This is the mathematical heart of the system.

### Prerequisites -- Design Decisions Required BEFORE Implementation
Two design decisions must be made and documented before writing calculation code:

1. **Floating-point precision strategy (from calc engine review):** All monetary intermediate calculations use DECIMAL(15,4) precision. Round to 2 decimal places for DISPLAY ONLY, never for storage of intermediates. The calculation module must use explicit `roundToDisplay()` calls only at the UI boundary. The database stores calculated totals as DECIMAL(15,4). This prevents cumulative rounding errors across hundreds of items.

   Alternatively, if cent-based integer arithmetic is chosen, document that decision and implement consistently.

2. **Formula-across-options semantics (from sequence risk review, promoted to P1):** Decide and document: "What does a formula do when its named reference is in an inactive option alternative?" Options: (a) use the value from the inactive alternative, (b) return 0, (c) return an error/NaN. This decision affects the calculation engine design and must be encoded from day one, not discovered in Phase 6.

### What Gets Built
- Isomorphic TypeScript calculation module (importable by both client and server)
- Leaf item calculation: `raw_qty -> purchasing constraints -> qty x unit_cost -> subtotal -> contingency (compounds) -> overhead (compounds on contingency) -> total_price -> unit_price`
- Parent aggregation: SUM children's subtotal, contingency_amount, overhead_amount, total_price
- Assembly derived unit cost: total_price / assembly_qty (with division-by-zero guard)
- Markup rate reverse-calculation for parent nodes (display-only percentages, with division-by-zero guard returning "N/A")
- **Active children filtering designed to accept BOTH option filtering AND visibility filtering from day one** (from sequence risk review). The calc engine takes a "node filter" function parameter that determines which children count toward aggregation. Initially this is a pass-through; Phase 6 plugs in option filtering, Phase 8 plugs in visibility filtering.
- Client-side calculation on every edit (instant display)
- Server-side recalculation on save (server is authoritative -- client calculates for display, server always recalculates from scratch and stores its values)
- Batch save endpoint: accept all changed nodes in one request, server recalculates, persists in one transaction, returns authoritative values to client
- Zero-quantity guard in purchasing constraints: if `rawQty <= 0`, skip all constraints and return 0

### Testable Output
- Change an item's quantity -> its subtotal, contingency, overhead, total update instantly
- Change an item's cost -> same cascade
- Change an item's markup rate -> overhead compounds on contingency correctly
- Parent nodes show sum of children's actual amounts (not re-applied global rates)
- Multiple items with different markup rates -> parent shows correct blended total
- Save round-trip: server recalculates and returns values; client updates display to match
- Batch save: 50 changed nodes saved in one request/transaction
- Zero-quantity items produce $0 totals (minimum order constraint does NOT force purchase)

### Done Criteria
- The cedar siding example's manual calculations match the engine's output exactly:
  ```
  1,200 SF siding area
  Siding: 1,200 x 2.88 x 1.15 = 3,974.4 -> 3,980 LF (package rounding to 10)
  Furring: 1,200 / 75 = 16 boxes
  Fasteners: 1,200 x 3 = 3,600 -> 4,000 (package rounding to 1,000)
  ```
- Overhead compounds on contingency (verified with hand calculation)
- Server is authoritative: values stored in DB always match server calculation
- No N+1 database calls -- batch save is a single transaction
- Precision strategy is implemented and documented as a contract

### Estimated Sessions: **2**
### Complexity: **Moderate-High**
The math is well-defined. The complexity is in the isomorphic module design, precision strategy, and the node-filter abstraction for future option/visibility filtering.

---

## Phase 3: Assembly System

### Scope
Implement the assembly quantity cascade -- child items calculating their quantities relative to the parent assembly's quantity. This is where the system becomes genuinely useful for estimating.

### What Gets Built
- Ratio mode: `item_qty = (assembly_qty x ratio_numerator) / ratio_denominator`
- Direct numeric mode: `item_qty = entered_value` (no relationship to assembly)
- Purchasing constraint cascade: waste -> package rounding -> minimum order
- Assembly nesting: assemblies containing sub-assemblies, with quantity cascading recursively
- `raw_qty` vs `qty` split in the UI (show the user both pre- and post-constraint values)
- Assembly quantity input: change assembly qty -> all children recalculate
- UI for configuring item-assembly relationships (ratio input with natural units: "1 box per 75 SF")

### Prerequisites
- Phase 2 complete -- calculation engine proven correct for flat items
- Building ON TOP of the working calculation engine

### Testable Output
- **Cedar siding full example:**
  - Create "Cedar Siding System" assembly, set to 1,200 SF
  - Add siding item: ratio 2.88 LF per 1 SF, 15% waste, package size 10 -> final qty = 3,980 LF
  - Add furring strips: ratio 1 box per 75 SF -> 16 boxes
  - Add fasteners: ratio 3 per 1 SF, package size 1,000 -> 4,000 fasteners
  - Add labor: ratio 1 SF per 1 SF -> 1,200 SF
  - Assembly's derived unit cost = total / 1,200 = cost per SF
- **Nested assemblies:**
  - "Complete Exterior Wall" assembly containing "Cedar Siding" sub-assembly + "Weather Barrier" sub-assembly
  - Changing the outer assembly's quantity cascades through all nested assemblies and their items
- **Change assembly qty** -> all children update instantly
- **Edge case test matrix** (from calc engine review):
  - Zero quantities -> purchasing constraints return 0
  - Fractional packages -> ceil behavior correct
  - 3+ levels of nesting -> cascade is correct
  - Mixed units across nesting levels -> ratios resolve correctly
  - Waste factor interaction with package rounding on boundary values

### Done Criteria
- All three quantity modes work (numeric, ratio, formula-placeholder-for-now)
- Purchasing constraints apply in correct order
- Nested assemblies cascade correctly (2+ levels deep)
- Assembly derived unit cost is accurate (with zero-qty guard)
- Changing assembly quantity triggers full recalculation of all descendants
- Edge case test matrix passes

### Estimated Sessions: **2-3**
### Complexity: **High**
This is the most mathematically complex phase. The recursive quantity cascade with purchasing constraints has many edge cases.

---

## Phase 4: Formula Engine

### Scope
Add formula-driven quantities and costs. Items can have formulas that reference project parameters and named node values.

### What Gets Built
- **math.js** integration (replacing the originally proposed expr-eval, which has CVE-2025-12735 CVSS 9.8 and is abandoned -- per calc engine review). Configured with restricted scope:
  - **IN SCOPE:** Arithmetic operators, ternary conditionals, project parameter references, named node value references
  - **EXPLICITLY OUT OF SCOPE (hard boundary):** Aggregation functions (SUM, AVG), cross-node queries, loops, string operations, date math. If the user needs something more complex, the answer is "add a project parameter and compute it externally." This boundary is a contract, not a suggestion.
- Project parameters CRUD (create/edit/delete named values)
- Formula evaluation in the calculation chain: when `qty_mode = 'formula'`, evaluate `qty_formula` with the parameter context
- Named references: nodes with `reference_name` can be referenced by other formulas
- Basic conditionals via ternary syntax: `roof_pitch > 8 ? base * 1.3 : base`
- Formula validation on save (syntax check, missing variable detection)
- Circular reference detection:
  - Server-side: build dependency graph, reject cycles at save time
  - Client-side: max-iteration guard to prevent browser freezing (from data model review)
- UI: formula input field, parameter picker/autocomplete, formula preview (shows evaluated result)

### Prerequisites
- Phase 3 complete -- assembly quantity cascade proven
- Formula mode (`qty_mode = 'formula'`) was a stub returning 0 in Phase 2; now it gets implemented

### Testable Output
- Create parameter `wall_area = 1200`
- Create item with formula `= wall_area * 2.88 * 1.15`
- Change `wall_area` to 1500 -> item quantity updates
- Conditional formula: `= roof_pitch > 8 ? wall_area * 1.3 : wall_area`
- Named reference: one node's value referenced in another node's formula
- Circular reference detected and rejected with clear error message (both client and server)
- Missing variable in formula -> clear error, not a crash
- Attempt to use SUM/aggregation -> clear error explaining this is out of scope

### Done Criteria
- All formula types evaluate correctly (arithmetic, conditionals, variable references)
- Parameter changes cascade to all formula-dependent items
- Circular references are detected before saving (server) and before freezing the browser (client)
- Formula errors don't crash the calculation engine
- Formula scope boundary is enforced and documented

### Estimated Sessions: **1-2**
### Complexity: **Moderate**
math.js handles the parsing. The complexity is in variable resolution and circular reference detection. Bounded by the hard scope limit.

---

## Phase 5: Catalog System

### Scope
Build the reusable template library. Items and assemblies can be defined once in the catalog and instantiated into any estimate. Includes initial data population via CSV import.

### What Gets Built
- `catalog_items` table + CRUD + full-text search
- `catalog_assemblies` table + CRUD
- `catalog_assembly_components` junction table
- Copy-on-instantiate logic (deep copy for assemblies)
- Catalog source tracking on estimate nodes (breadcrumb reference, soft FK)
- Sync operations: pull from catalog, push to catalog, check for changes, unlink
- Assembly nesting depth limit enforcement (advisory, default 5 levels)
- Indirect cycle detection for nested assemblies (bounded chain-walk at INSERT/UPDATE time)
- Catalog search UI (full-text, category/tag filtering)
- Catalog browser panel in the estimate editor (drag or click to add)
- **Catalog seeding capability (from sequence risk review + industry research):** CSV import for initial data population. Basic "paste a CSV, map columns, import" workflow for populating catalog items from existing spreadsheet data. This makes the catalog immediately useful instead of requiring manual entry of 100+ items.

### Prerequisites
- Phases 1-4 complete -- items, assemblies, calculations, and formulas all proven
- The item data model must be STABLE before building templates from it
- This is the key sequencing lesson: catalog depends on stable items

### Testable Output
- Create a catalog item with all defaults
- Instantiate into an estimate -> creates a fully independent copy with correct defaults
- Modify the estimate copy -> catalog unchanged
- Modify the catalog item -> estimate copy unchanged
- "Check for changes" -> reports differences between estimate node and catalog source
- "Pull from catalog" -> updates estimate item (preserves qty)
- "Push to catalog" -> updates catalog (increments version)
- "Unlink" -> clears catalog reference
- Create a catalog assembly with 5 component items
- Instantiate -> creates assembly node with 5 child item nodes, all correctly configured
- Nested catalog assembly -> recursive instantiation works
- CSV import: upload a CSV file, map columns to catalog fields, import 50+ items in one operation

### Done Criteria
- Copy-on-instantiate is truly independent (no shared references)
- Sync operations work correctly in both directions
- Catalog search returns relevant results
- Assembly instantiation handles nesting correctly
- Version tracking accurately identifies when catalog items have changed
- CSV import works for bulk catalog population

### Estimated Sessions: **2-3**
### Complexity: **Moderate**
The catalog concept is straightforward. The complexity is in the deep copy logic (especially for nested assemblies), the sync/diff operations, and the CSV import mapping.

---

## Phase 6: Options System

### Scope
Implement the three-layer options system -- the primary differentiating feature. This is built last among core features because it touches every other system (tree, calculations, catalog).

### Architecture Note -- Junction Table Approach (from options system review)
The original design used a single `option_alternative_id` column on `estimate_nodes` for stamping. Based on the options system review, this phase uses a **junction table (`node_option_memberships`)** instead. This adds one JOIN to the active tree query but enables future nested options without a breaking migration.

### What Gets Built

**Schema:**
- `option_groups` table with `anchor_node_id UUID FK -> estimate_nodes` (the node where the option "lives" -- from options review issue 3.2). Cascade delete: deleting the anchor node cascade-deletes the option group.
- `option_alternatives` table with `is_selected BOOLEAN`
- **Partial unique index** enforcing exactly-one-selected per group (from options review issue 2.2):
  ```sql
  CREATE UNIQUE INDEX idx_one_selected_per_group
  ON option_alternatives (option_group_id)
  WHERE is_selected = TRUE;
  ```
- `node_option_memberships` junction table (`node_id, option_alternative_id`, UNIQUE on the pair) replacing the single-column stamp approach
- Database trigger on `parent_id` UPDATE that propagates option membership to moved nodes and their descendants (from options review issue 2.1)

**Layer 2 first (inline options -- subtree swapping):**
- "Create option" workflow: select a node -> create option group (with anchor_node_id) -> assign base subtree to junction table with alternative_id
- "Add alternative" workflow: create new alternative -> deep copy or fresh subtree creation -> assign to junction table with new alternative_id
- "Switch selection" -> atomic transaction: deselect old + select new -> trigger recalculation on active tree
- Active tree query (filter via junction table: exclude nodes belonging to any non-selected alternative)
- UI: option indicator on anchor nodes, option panel showing alternatives with cost comparison

**Layer 1 (broad options -- parameter overrides):**
- `broad_options` and `broad_option_overrides` tables
- Toggle broad options on/off
- Parameter override application in the formula engine
- Precedence rules for conflicting overrides
- UI: broad options panel, toggle switches, affected parameters display

**Layer 3 (option sets -- saved scenarios):**
- `option_sets` table
- `option_set_selections` junction table (for inline option selections)
- `option_set_broad_selections` junction table (for broad option toggles -- from options review issue 4.1)
- Save current selection state as a named set
- Apply a set (update all selections to match the set's saved state)
- Comparison view: side-by-side totals for different scenarios
- UI: scenario selector, comparison modal/panel

**Calculation order (explicit, from options review Part 8):**
1. Determine which broad options are active -> resolve all parameter values
2. Determine which inline alternatives are selected -> resolve the active tree
3. Calculate the active tree using the resolved parameters

### Prerequisites
- Phases 1-5 complete -- tree, calculations, assemblies, formulas, and catalog all proven
- **Pre-Phase-6 Options Implementation Contract:** Before starting, write a focused contract (<1KB) summarizing the interfaces of Phases 1-5 that the options system touches. The implementing context loads this contract, not the full code of previous phases. (from sequence risk review)
- Formula-across-options semantics decided in Phase 2 are applied here

### Testable Output
- Create a Kitchen group with Standard/Mid-Range/Premium alternatives
- Each alternative has different items, quantities, and costs
- Switch between alternatives -> tree updates, totals change correctly
- Partial unique index prevents two alternatives from being selected simultaneously
- Move a node INTO an option subtree -> junction table membership propagates automatically
- Create a "Budget Scenario" option set -> remembers all current selections (inline + broad)
- Create a "Premium Scenario" option set -> remembers different selections
- Switch between scenarios -> all options update simultaneously
- Comparison view shows accurate side-by-side totals
- Broad option: "Upgraded Insulation" changes R-value parameter -> formula-driven quantities update
- Combining broad and inline options: both affect the same estimate correctly
- Delete an anchor node -> option group and all alternatives cascade-delete cleanly

### Done Criteria
- Junction table approach works for all subtree operations
- Active tree query correctly filters inactive alternatives
- Calculations only include active tree nodes (using the node-filter abstraction from Phase 2)
- Option sets correctly save and restore all selection states (inline + broad)
- Broad options correctly override parameters in formula evaluation
- No orphaned nodes when options or anchor nodes are deleted
- Stamp propagation trigger works correctly for all tree mutations

### Estimated Sessions: **3-5**
### Complexity: **Very High**
This is the most complex phase. The junction table approach, subtree management, calculation filtering, and three-layer interaction require careful coordination. This phase is as large as Phases 0 + 1A + 4 combined.

---

## Phase 7: Version Management UI

### Scope
Build the user-facing version management features. The underlying infrastructure (history tables, version columns on estimates) was set up in Phase 1A. This phase adds the UI and business logic.

### What Gets Built
- "Create new version" workflow: deep copy entire estimate tree -> new version (implemented as a single PostgreSQL function handling all ID remapping, including option group/alternative/membership remapping -- from data model review)
- Version list panel: see all versions of an estimate
- Version diff view: side-by-side comparison of two versions (node-by-node)
- Change history viewer: timeline of changes to a specific node
- Rollback: "restore this node to its state at time T" (copy from history)
- Version labeling: user-friendly names for versions ("Initial", "Post Value Engineering")
- Immutability enforcement: non-current versions cannot be edited

### Prerequisites
- Phase 6 complete -- the system is fully functional with options
- History tables have been accumulating data since Phase 1A
- Version columns on estimates have been present since Phase 1A

### Testable Output
- Create version 2 of an estimate -> complete independent copy (including all options, alternatives, memberships)
- Edit version 2 -> version 1 unchanged
- Diff viewer: shows which nodes changed between versions
- History viewer: shows timeline of changes to a specific item
- Rollback: restore a node to its value from 3 edits ago
- Attempt to edit version 1 -> rejected (immutable)
- Option groups in version 2 are fully independent from version 1

### Done Criteria
- Deep copy produces a complete, independent estimate version (including all option data)
- Diff comparison correctly identifies added, removed, and changed nodes
- History timeline shows all changes with who/when/what
- Rollback correctly restores previous values
- Non-current versions are truly immutable

### Estimated Sessions: **1-2**
### Complexity: **Moderate**
The infrastructure exists from Phase 1A. The complexity is in the diff algorithm (matching nodes across versions) and the deep-copy function with full option remapping.

---

## Phase 8: Client-Facing View

### Scope
Build the filtered client experience -- the same application, but with visibility-based content filtering for the client role.

### What Gets Built
- Client role in auth system (separate from builder/admin)
- Visibility filtering: nodes with `client_visibility = 'hidden'` excluded from client view (plugs into the node-filter abstraction from Phase 2)
- Summary mode: nodes with `client_visibility = 'summary_only'` show name + total only (no breakdown)
- Client sees `total_price` and `unit_price` -- never `unit_cost`, markup rates, or contingency breakdowns
- Client-specific option interaction: can toggle inline options (if builder enables client selection)
- Progressive disclosure UI: expand/collapse tree with depth-based formatting
- PDF export: generate client-facing proposal from the filtered tree
- Proposal formatting: cover page, scope summary, detailed tree, option selections, total

### Prerequisites
- Phase 6 complete -- full estimating functionality with options
- `client_visibility` field has been on every node since Phase 1A
- Calc engine node-filter abstraction accepts visibility filtering (designed in Phase 2)

### Testable Output
- Client login sees only visible/summary nodes
- Hidden nodes excluded entirely (no data leakage)
- Summary nodes show name + total, expand disabled
- Client cannot see: unit costs, markup percentages, contingency/overhead breakdowns
- Client can toggle options (where enabled by builder)
- PDF export generates a clean proposal document
- PDF preserves tree hierarchy visually

### Done Criteria
- Zero data leakage: client view never exposes builder-only data
- Summary mode correctly hides detail while showing totals
- PDF export is professional quality
- Client role cannot access builder-only features

### Estimated Sessions: **2-3**
### Complexity: **Moderate**
The data model supports this from Phase 1A (visibility column). The complexity is in PDF generation and ensuring zero data leakage in the client view.

---

## Phase 9: Vendor MVP

### Scope
Build a focused vendor management module -- vendor records, pricing integration with catalog and estimates. Scoped to MVP per the sequence risk review's recommendation to prevent scope creep.

### MVP Scope (Phase 9)
- `vendors` table + basic CRUD (name, trade, status, notes, contact info)
- `vendor_catalog_items` table (vendor-item associations with vendor-specific pricing)
- Vendor selection on estimate items (`vendor_id` FK constraint added to `node_item_details` -- the column has existed as a plain UUID since Phase 1A)
- Vendor-grouped view in estimates (group items by assigned vendor)
- Price comparison across vendors for a specific catalog item

### Deferred to Phase 10+
- `vendor_contacts` table (multiple contacts per vendor)
- `vendor_documents` table + Supabase Storage integration
- Document management (COIs, contracts, licenses, W-9s)
- Expiration tracking and alerts for COIs and licenses
- Purchase order generation from vendor-grouped estimate items
- RFP generation

### Prerequisites
- Phase 5 complete (catalog system -- vendors integrate with catalog items)
- **Note:** Vendors do NOT depend on Phase 6 (Options). This phase can begin as soon as Phase 5 is stable, potentially in parallel with Phase 6.

### Testable Output
- Create a vendor record with trade classification
- Associate vendor with catalog items (with vendor-specific pricing)
- View price comparison across vendors for a specific item
- Assign vendor to an estimate item
- View estimate items grouped by vendor
- vendor_id FK constraint works correctly on node_item_details

### Done Criteria
- Vendor CRUD works (create, edit, deactivate)
- Vendor-item pricing comparison is accurate
- Vendor assignment integrates with the estimate tree
- vendor_id FK is properly enforced

### Estimated Sessions: **1-2**
### Complexity: **Low-Moderate**
With MVP scope, this is a straightforward entity management module with catalog integration.

---

## Phase 10: Polish, Optimization & Advanced Features

### Scope
UX polish, performance optimization, deferred vendor features, and advanced features that build on the complete system.

### What Gets Built (prioritize based on need)

**Vendor completion (deferred from Phase 9):**
- Contact management (multiple contacts per vendor)
- Document management with Supabase Storage (COIs, contracts, licenses, W-9s)
- Expiration tracking for COIs and licenses
- Purchase order generation
- RFP generation

**UX polish:**
- Keyboard navigation (arrow keys, tab, enter for editing)
- Drag-and-drop tree reordering
- Named preset formulas (user-defined formula functions)

**Data & reporting:**
- Advanced reporting (cost breakdowns by vendor, by phase, by cost type)
- Estimate duplication (copy estimate to new project)

**Performance:**
- Performance optimization for large trees (virtualized rendering, lazy loading)

**History:**
- Undo/redo (based on history tables)

### Prerequisites
- All previous phases complete (except where individual features have earlier prerequisites)

### Estimated Sessions: **Ongoing**
### Complexity: **Variable** (per feature)

---

## Phase Summary

| Phase | Name | Key Deliverable | Depends On | Complexity | Est. Sessions |
|-------|------|----------------|-----------|-----------|---------------|
| 0 | Scaffolding | App shell + auth + first deploy | -- | Low | 1 |
| 1A | Schema | Tables + constraints + triggers + server actions + history | Phase 0 | Moderate | 1-2 |
| 1B | Tree UI | Tree CRUD + project navigation + state mgmt pattern | Phase 1A | Moderate | 2-3 |
| 2 | Calculations | Isomorphic calc engine + precision strategy + node-filter abstraction | Phase 1B | Moderate-High | 2 |
| 3 | Assemblies | Quantity cascade + purchasing constraints + edge case matrix | Phase 2 | High | 2-3 |
| 4 | Formulas | math.js + parameters + scope boundary | Phase 3 | Moderate | 1-2 |
| 5 | Catalog | Copy-on-instantiate templates + CSV import | Phase 4 | Moderate | 2-3 |
| 6 | Options | Three-layer option system + junction table + anchor nodes | Phase 5 | Very High | 3-5 |
| 7 | Versions UI | Version management interface + deep-copy function | Phase 6 | Moderate | 1-2 |
| 8 | Client View | Filtered visibility + PDF export | Phase 6 | Moderate | 2-3 |
| 9 | Vendor MVP | Vendor CRUD + pricing + estimate integration | Phase 5 | Low-Moderate | 1-2 |
| 10 | Polish | Keyboard nav, drag-drop, vendor completion, reports | All | Variable | Ongoing |

**Total estimate: 18-28 sessions for Phases 0-9** (from sequence risk review timeline analysis). Phase 6 (Options) at 3-5 sessions is as large as Phases 0 + 1A + 4 combined. If Phase 6 hits problems, it dominates the timeline.

**Note on parallelism:** Phases 7 and 8 both depend on Phase 6. Phase 9 (Vendors) depends on Phase 5 only -- it can begin as soon as Phase 5 is stable, in parallel with Phase 6. This is a real scheduling opportunity: vendor work can proceed while the options system is being built. Phases 7, 8, and 9 are otherwise independent of each other.

**Note on discovery:** The biggest timeline risk is NOT implementation speed -- it's discovery. Each phase will surface things the brief didn't anticipate. Budget 20-30% of sessions for mid-course correction. The strict sequencing helps: corrections to Phase 1 during Phase 1 are cheap; corrections to Phase 1 during Phase 6 are expensive.

---

## Appendix: Key Design Decisions Encoded in This Sequence

These decisions were surfaced by the review process and are baked into specific phases:

| Decision | Source | Phase | Summary |
|----------|--------|-------|---------|
| ltree path column from day one | Data model review #1 | 1A | Dual parent_id + ltree with trigger maintenance |
| Structured cost codes table | Industry research #7 | 1A | FK reference instead of free-text, MasterFormat seed data |
| vendor_id as plain UUID initially | Sequence review #12 | 1A | No FK until vendors table exists in Phase 9 |
| node_type change prevention trigger | Data model review #17 | 1A | Cannot change to 'item' if node has children |
| DECIMAL(15,4) intermediates | Calc engine review #2 | 2 | Round to 2dp at display only |
| Formula-across-options semantics | Sequence review #3 | 2 (prerequisite) | Decided before calc engine is built |
| Node-filter abstraction in calc engine | Sequence review #13 | 2 | Accepts option + visibility filtering |
| Server-authoritative calculation | Calc engine review #3 | 2 | Server always recalculates; client is display-only |
| math.js instead of expr-eval | Calc engine review #1 | 4 | expr-eval has CVE-2025-12735, abandoned |
| Hard formula scope boundary | Sequence review (formula creep) | 4 | No aggregation, cross-node queries, or loops |
| CSV catalog seeding | Sequence review #5, Industry research | 5 | Bulk import for initial data population |
| Junction table for option memberships | Options review #3.1 | 6 | Replaces single-column stamp; enables future nesting |
| anchor_node_id on option_groups | Options review #3.2 | 6 | Explicit ownership for UI, cascading, and moves |
| Partial unique index for one-selected | Options review #2.2 | 6 | Database-enforced exactly-one-selected per group |
| Stamp propagation trigger | Options review #2.1 | 6 | Auto-propagate membership on tree mutations |
| Vendor MVP scope | Sequence review (scope creep) | 9 | Defer doc management, COI tracking, PO generation |
