# Implementation Sequence

> **Date:** 2026-04-02
> **Principle:** Strictly bottom-up. Each phase is independently testable and provably stable before the next begins. No parallel layer development — the single biggest lesson from both previous attempts.

---

## Phase 1: Foundation — Schema & Tree Structure

### Scope
Stand up the core database schema and prove that the tree works. No calculations, no catalog, no options — just the ability to create nodes, organize them in a tree, and perform structural operations.

### What Gets Built
- `projects` table (minimal — name, status, dates)
- `estimates` table (minimal — name, project FK, status. Version fields exist but versioning logic deferred)
- `estimate_nodes` base table with all columns
- `node_item_details` table with all columns
- `node_assembly_details` table with all columns
- `units_of_measure` table + seed data (SF, LF, EA, HR, etc.)
- `phases` table
- Database constraints: CHECK constraints, FK cascades, `items_must_have_parent`, `unique_reference_name`
- Database triggers: `updated_at` auto-update, parent-child type validation (items can't have children)
- History tables + tracking triggers for `estimate_nodes`, `node_item_details`, `node_assembly_details`
- Server actions: createNode, updateNode, deleteNode, moveNode (re-parent + reorder), getNodes
- Client-side `buildTree()` — flat array → nested tree structure
- Basic tree UI: render nodes, expand/collapse, add/delete, reorder (move up/down), indent/outdent

### Prerequisites
- Supabase project created and configured
- Next.js project scaffolded
- Auth configured (single user is fine — Supabase Auth with email login)

### Testable Output
- Can create a project with an estimate
- Can add group, assembly, and item nodes in a tree hierarchy
- Can move nodes between parents (indent/outdent)
- Can reorder siblings (move up/down)
- Can delete nodes (subtree cascades)
- Tree renders correctly with proper nesting and ordering
- Invalid operations rejected: item as parent, orphan items, etc.
- History triggers fire on every edit (verify rows in history tables)

### Done Criteria
- All tree operations work correctly with no stale state
- Database constraints prevent all structural invariant violations
- History tables capture every change
- Tree renders identically after page refresh (no client/server state drift)

### Complexity: **Moderate**
The tree itself is straightforward. The complexity is in getting the constraints, triggers, and history tracking right from day one.

---

## Phase 2: Calculation Engine

### Scope
Implement the full calculation chain and prove it produces correct numbers. This is the mathematical heart of the system.

### What Gets Built
- Isomorphic TypeScript calculation module (importable by both client and server)
- Leaf item calculation: `raw_qty → purchasing constraints → qty × unit_cost → subtotal → contingency (compounds) → overhead (compounds on contingency) → total_price → unit_price`
- Parent aggregation: SUM children's subtotal, contingency_amount, overhead_amount, total_price
- Assembly derived unit cost: total_price / assembly_qty
- Markup rate reverse-calculation for parent nodes (display-only percentages)
- Client-side calculation on every edit (instant display)
- Server-side validation on save
- Batch save endpoint: accept all changed nodes in one request, validate, persist in one transaction

### Prerequisites
- Phase 1 complete and stable
- Tree operations proven correct

### Testable Output
- Change an item's quantity → its subtotal, contingency, overhead, total update instantly
- Change an item's cost → same cascade
- Change an item's markup rate → overhead compounds on contingency correctly
- Parent nodes show sum of children's actual amounts (not re-applied global rates)
- Multiple items with different markup rates → parent shows correct blended total
- Save round-trip: client-calculated values match server-validated values exactly
- Batch save: 50 changed nodes saved in one request/transaction

### Done Criteria
- The cedar siding example's manual calculations match the engine's output exactly:
  ```
  1,200 SF siding area
  Siding: 1,200 × 2.88 × 1.15 = 3,974.4 → 3,980 LF (package rounding to 10)
  Furring: 1,200 / 75 = 16 boxes
  Fasteners: 1,200 × 3 = 3,600 → 4,000 (package rounding to 1,000)
  ```
- Overhead compounds on contingency (verified with hand calculation)
- Client and server produce identical results for the same inputs
- No N+1 database calls — batch save is a single transaction

### Complexity: **Moderate-High**
The math is well-defined. The complexity is in the isomorphic module design and ensuring zero drift between client and server.

---

## Phase 3: Assembly System

### Scope
Implement the assembly quantity cascade — child items calculating their quantities relative to the parent assembly's quantity. This is where the system becomes genuinely useful for estimating.

### What Gets Built
- Ratio mode: `item_qty = (assembly_qty × ratio_numerator) / ratio_denominator`
- Direct numeric mode: `item_qty = entered_value` (no relationship to assembly)
- Purchasing constraint cascade: waste → package rounding → minimum order
- Assembly nesting: assemblies containing sub-assemblies, with quantity cascading recursively
- `raw_qty` vs `qty` split in the UI (show the user both pre- and post-constraint values)
- Assembly quantity input: change assembly qty → all children recalculate
- UI for configuring item-assembly relationships (ratio input with natural units: "1 box per 75 SF")

### Prerequisites
- Phase 2 complete — calculation engine proven correct for flat items
- Building ON TOP of the working calculation engine

### Testable Output
- **Cedar siding full example:**
  - Create "Cedar Siding System" assembly, set to 1,200 SF
  - Add siding item: ratio 2.88 LF per 1 SF, 15% waste, package size 10 → final qty = 3,980 LF
  - Add furring strips: ratio 1 box per 75 SF → 16 boxes
  - Add fasteners: ratio 3 per 1 SF, package size 1,000 → 4,000 fasteners
  - Add labor: ratio 1 SF per 1 SF → 1,200 SF
  - Assembly's derived unit cost = total / 1,200 = cost per SF
- **Nested assemblies:**
  - "Complete Exterior Wall" assembly containing "Cedar Siding" sub-assembly + "Weather Barrier" sub-assembly
  - Changing the outer assembly's quantity cascades through all nested assemblies and their items
- **Change assembly qty** → all children update instantly

### Done Criteria
- All three quantity modes work (numeric, ratio, formula-placeholder-for-now)
- Purchasing constraints apply in correct order
- Nested assemblies cascade correctly (2+ levels deep)
- Assembly derived unit cost is accurate
- Changing assembly quantity triggers full recalculation of all descendants

### Complexity: **High**
This is the most mathematically complex phase. The recursive quantity cascade with purchasing constraints has many edge cases (zero quantities, fractional packages, nested waste factors).

---

## Phase 4: Formula Engine

### Scope
Add formula-driven quantities and costs. Items can have formulas that reference project parameters and named node values.

### What Gets Built
- Expression evaluator integration (recommend `expr-eval` library)
- Project parameters CRUD (create/edit/delete named values)
- `project_parameters` table (already designed in Phase 1 schema)
- Formula evaluation in the calculation chain: when `qty_mode = 'formula'`, evaluate `qty_formula` with the parameter context
- Named references: nodes with `reference_name` can be referenced by other formulas
- Basic conditionals via ternary syntax: `roof_pitch > 8 ? base * 1.3 : base`
- Formula validation on save (syntax check, missing variable detection)
- Circular reference detection (build dependency graph, reject cycles)
- UI: formula input field, parameter picker/autocomplete, formula preview (shows evaluated result)

### Prerequisites
- Phase 3 complete — assembly quantity cascade proven
- Formula mode (`qty_mode = 'formula'`) was a placeholder; now it gets implemented

### Testable Output
- Create parameter `wall_area = 1200`
- Create item with formula `= wall_area * 2.88 * 1.15`
- Change `wall_area` to 1500 → item quantity updates
- Conditional formula: `= roof_pitch > 8 ? wall_area * 1.3 : wall_area`
- Named reference: one node's value referenced in another node's formula
- Circular reference detected and rejected with clear error message
- Missing variable in formula → clear error, not a crash

### Done Criteria
- All formula types evaluate correctly (arithmetic, conditionals, variable references)
- Parameter changes cascade to all formula-dependent items
- Circular references are detected before saving
- Formula errors don't crash the calculation engine

### Complexity: **Moderate**
The expression evaluator library handles the hard parsing. The complexity is in the variable resolution (project parameters + named references) and circular reference detection.

---

## Phase 5: Catalog System

### Scope
Build the reusable template library. Items and assemblies can be defined once in the catalog and instantiated into any estimate.

### What Gets Built
- `catalog_items` table + CRUD + full-text search
- `catalog_assemblies` table + CRUD
- `catalog_assembly_components` junction table
- Copy-on-instantiate logic (deep copy for assemblies)
- Catalog source tracking on estimate nodes (breadcrumb reference)
- Sync operations: pull from catalog, push to catalog, check for changes, unlink
- Assembly nesting depth limit enforcement (advisory, default 5 levels)
- Indirect cycle detection for nested assemblies
- Catalog search UI (full-text, category/tag filtering)
- Catalog browser panel in the estimate editor (drag or click to add)

### Prerequisites
- Phases 1-4 complete — items, assemblies, calculations, and formulas all proven
- The item data model must be STABLE before building templates from it
- This is the key sequencing lesson: catalog depends on stable items

### Testable Output
- Create a catalog item with all defaults
- Instantiate into an estimate → creates a fully independent copy with correct defaults
- Modify the estimate copy → catalog unchanged
- Modify the catalog item → estimate copy unchanged
- "Check for changes" → reports differences between estimate node and catalog source
- "Pull from catalog" → updates estimate item (preserves qty)
- "Push to catalog" → updates catalog (increments version)
- "Unlink" → clears catalog reference
- Create a catalog assembly with 5 component items
- Instantiate → creates assembly node with 5 child item nodes, all correctly configured
- Nested catalog assembly → recursive instantiation works

### Done Criteria
- Copy-on-instantiate is truly independent (no shared references)
- Sync operations work correctly in both directions
- Catalog search returns relevant results
- Assembly instantiation handles nesting correctly
- Version tracking accurately identifies when catalog items have changed

### Complexity: **Moderate**
The catalog concept is straightforward. The complexity is in the deep copy logic (especially for nested assemblies) and the sync/diff operations.

---

## Phase 6: Options System

### Scope
Implement the three-layer options system — the primary differentiating feature. This is built last among core features because it touches every other system (tree, calculations, catalog).

### What Gets Built

**Layer 2 first (inline options — subtree swapping):**
- `option_groups` and `option_alternatives` tables
- "Create option" workflow: select a node → create option group → stamp base subtree with alternative_id
- "Add alternative" workflow: create new alternative → deep copy or fresh subtree creation → stamp with new alternative_id
- "Switch selection" → update is_selected, trigger recalculation on active tree
- Active tree query (filter by selected alternatives)
- UI: option indicator on nodes, option panel showing alternatives with cost comparison

**Layer 1 (broad options — parameter overrides):**
- `broad_options` and `broad_option_overrides` tables
- Toggle broad options on/off
- Parameter override application in the formula engine
- Precedence rules for conflicting overrides
- UI: broad options panel, toggle switches, affected parameters display

**Layer 3 (option sets — saved scenarios):**
- `option_sets` and `option_set_selections` tables
- Save current selection state as a named set
- Apply a set (update all selections to match the set's saved state)
- Comparison view: side-by-side totals for different scenarios
- UI: scenario selector, comparison modal/panel

### Prerequisites
- Phases 1-5 complete — tree, calculations, assemblies, formulas, and catalog all proven
- The options system touches EVERY other system. It modifies tree visibility, calculation scope, parameter values, and catalog instantiation. It must be built on a fully stable foundation.

### Testable Output
- Create a Kitchen group with Standard/Mid-Range/Premium alternatives
- Each alternative has different items, quantities, and costs
- Switch between alternatives → tree updates, totals change correctly
- Create a "Budget Scenario" option set → remembers all current selections
- Create a "Premium Scenario" option set → remembers different selections
- Switch between scenarios → all options update simultaneously
- Comparison view shows accurate side-by-side totals
- Broad option: "Upgraded Insulation" changes R-value parameter → formula-driven quantities update
- Combining broad and inline options: both affect the same estimate correctly

### Done Criteria
- Subtree swapping works for items, assemblies, and groups
- Active tree query correctly filters inactive alternatives
- Calculations only include active tree nodes
- Option sets correctly save and restore all selection states
- Broad options correctly override parameters in formula evaluation
- No orphaned nodes when options are deleted

### Complexity: **Very High**
This is the most complex phase. Subtree swapping requires careful coordination between the tree, calculation engine, and UI. The interaction between broad options (parameter overrides) and inline options (subtree swaps) must be correct.

---

## Phase 7: Version Management UI

### Scope
Build the user-facing version management features. The underlying infrastructure (history tables, version columns on estimates) was set up in Phase 1. This phase adds the UI and business logic.

### What Gets Built
- "Create new version" workflow: deep copy entire estimate tree → new version
- Version list panel: see all versions of an estimate
- Version diff view: side-by-side comparison of two versions (node-by-node)
- Change history viewer: timeline of changes to a specific node
- Rollback: "restore this node to its state at time T" (copy from history)
- Version labeling: user-friendly names for versions ("Initial", "Post Value Engineering")
- Immutability enforcement: non-current versions cannot be edited

### Prerequisites
- Phases 1-6 complete — the system is fully functional
- History tables have been accumulating data since Phase 1
- Version columns on estimates have been present since Phase 1

### Testable Output
- Create version 2 of an estimate → complete independent copy
- Edit version 2 → version 1 unchanged
- Diff viewer: shows which nodes changed between versions
- History viewer: shows timeline of changes to a specific item
- Rollback: restore a node to its value from 3 edits ago
- Attempt to edit version 1 → rejected (immutable)

### Done Criteria
- Deep copy produces a complete, independent estimate version
- Diff comparison correctly identifies added, removed, and changed nodes
- History timeline shows all changes with who/when/what
- Rollback correctly restores previous values
- Non-current versions are truly immutable

### Complexity: **Moderate**
The infrastructure exists from Phase 1. The complexity is in the diff algorithm (matching nodes across versions) and the rollback UX.

---

## Phase 8: Client-Facing View

### Scope
Build the filtered client experience — the same application, but with visibility-based content filtering for the client role.

### What Gets Built
- Client role in auth system (separate from builder/admin)
- Visibility filtering: nodes with `client_visibility = 'hidden'` excluded from client view
- Summary mode: nodes with `client_visibility = 'summary_only'` show name + total only (no breakdown)
- Client sees `total_price` and `unit_price` — never `unit_cost`, markup rates, or contingency breakdowns
- Client-specific option interaction: can toggle inline options (if builder enables client selection)
- Progressive disclosure UI: expand/collapse tree with depth-based formatting
- PDF export: generate client-facing proposal from the filtered tree
- Proposal formatting: cover page, scope summary, detailed tree, option selections, total

### Prerequisites
- Phases 1-6 complete — full estimating functionality
- `client_visibility` field has been on every node since Phase 1

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

### Complexity: **Moderate**
The data model supports this from Phase 1 (visibility column). The complexity is in PDF generation and ensuring zero data leakage in the client view.

---

## Phase 9: Vendor Management

### Scope
Build the full vendor management module — CRM-like vendor tracking integrated with the catalog and estimating system.

### What Gets Built
- `vendors`, `vendor_contacts`, `vendor_documents`, `vendor_catalog_items` tables
- Vendor CRUD with full record management
- Contact management (multiple contacts per vendor)
- Document management with Supabase Storage (COIs, contracts, licenses, W-9s)
- Expiration tracking for COIs and licenses (alert when expiring)
- Vendor-item associations: multiple vendors per catalog item with comparative pricing
- Vendor rating and ranking
- Vendor selection in estimate items
- Vendor-grouped views in estimates (group items by assigned vendor)
- Foundation for purchase orders and RFPs (data model supports it, UI later)

### Prerequisites
- Phases 1-5 complete (catalog system in particular)
- Vendor integration points in `node_item_details.vendor_id` and `vendor_catalog_items` are ready

### Testable Output
- Create a vendor record with contacts and documents
- Upload a COI document → stored in Supabase Storage, expiration tracked
- Associate vendor with catalog items (with vendor-specific pricing)
- View price comparison across vendors for a specific item
- Assign vendor to an estimate item
- View estimate items grouped by vendor
- Expiring document alert (COI expires in 30 days)

### Done Criteria
- Full vendor lifecycle management (create, edit, deactivate)
- Document storage and retrieval works
- Vendor-item pricing comparison is accurate
- Vendor assignment integrates with the estimate tree
- Expiration tracking provides timely alerts

### Complexity: **Moderate**
This is a standard entity management module. The complexity is in the file storage integration and the multi-vendor pricing comparison.

---

## Phase 10: Polish, Optimization & Advanced Features

### Scope
UX polish, performance optimization, and advanced features that build on the complete system.

### What Gets Built (prioritize based on need)
- Keyboard navigation (arrow keys, tab, enter for editing)
- Drag-and-drop tree reordering
- Named preset formulas (user-defined formula functions)
- Import utilities (if CSV/Excel import is needed for initial data migration)
- Advanced reporting (cost breakdowns by vendor, by phase, by cost type)
- Purchase order generation (from vendor-grouped estimate items)
- RFP generation
- Estimate duplication (copy estimate to new project)
- Undo/redo (based on history tables)
- Performance optimization for large trees (virtualized rendering, lazy loading)

### Prerequisites
- All previous phases complete

### Complexity: **Variable** (per feature)

---

## Phase Summary

| Phase | Name | Key Deliverable | Depends On | Complexity |
|-------|------|----------------|-----------|-----------|
| 1 | Foundation | Tree CRUD + schema + history tracking | — | Moderate |
| 2 | Calculations | Isomorphic calculation engine | Phase 1 | Moderate-High |
| 3 | Assemblies | Quantity cascade + purchasing constraints | Phase 2 | High |
| 4 | Formulas | Expression evaluator + parameters | Phase 3 | Moderate |
| 5 | Catalog | Copy-on-instantiate templates | Phase 4 | Moderate |
| 6 | Options | Three-layer option system + subtree swapping | Phase 5 | Very High |
| 7 | Versions UI | Version management interface | Phase 6 | Moderate |
| 8 | Client View | Filtered visibility + PDF export | Phase 6 | Moderate |
| 9 | Vendors | Full vendor management module | Phase 5 | Moderate |
| 10 | Polish | Keyboard nav, drag-drop, presets, reports | All | Variable |

**Note on parallelism:** Phases 7, 8, and 9 are largely independent of each other (all depend on Phase 6 or earlier, but not on each other). They could be built in parallel by separate development streams. All other phases are strictly sequential.
