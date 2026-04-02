# Answers to Open Questions (Revised)

> **Date:** 2026-04-02
> **Source:** Part 7 of RESEARCH-SESSION-BRIEF.md
> **Note:** Answers informed by the data architecture in `01-data-architecture.md`. Read that first for full context.
>
> **Revision Note (v2):** This revision incorporates findings from five review documents:
> - `01-data-model-review.md` -- affects Q1 (group type), Q4 (field balance), Q7 (tree model)
> - `02-calc-engine-review.md` -- affects Q5 (calculation precision), Q8 (formula library)
> - `03-options-system-review.md` -- affects Q6 (options modeling)
> - `04-sequence-risk-review.md` -- general context
> - `05-industry-research.md` -- affects Q2 (phases), Q9 (units), plus new Q10 (allowances), Q11 (cost codes)
>
> Changes from v1: Q4 acknowledges pragmatic base-table tradeoff; Q5 adds floating-point precision strategy and server-authoritative save; Q6 revised to junction table instead of column stamping; Q7 upgraded to adjacency list + ltree dual column; Q8 replaces expr-eval with math.js; Q9 expands seed data; Q10 (allowances) and Q11 (cost codes) are new questions surfaced by industry research.

---

## Question 1: Do I need both "categories" and "sections," or is one generic "group" sufficient?

### Recommendation: One generic `group` type. No categories. No sections.

**Reasoning:**

In the old system, the only functional difference between a "category" and a "section" was that categories could be root nodes and sections couldn't. But both behaved identically -- they're containers that aggregate children's costs. Having two types for this one distinction added type-checking complexity throughout the codebase without providing meaningful value.

A single `group` type with the rule "root nodes must be groups" achieves the same hierarchy:

```
Group (root -- "Division 03: Concrete")
  +-- Group (nested -- "Foundation Walls")
        +-- Item (Concrete material)
        +-- Item (Rebar)
        +-- Item (Forming labor)
```

Groups can nest to arbitrary depth, allowing the user to organize as deeply as the project demands. The distinction between "root group" and "nested group" is positional (is `parent_id` NULL?), not type-based.

**What you lose:** The ability to enforce "sections can't be root" at the type level. But this is a minor rule that's easily enforced by the UI (don't offer "add section at root level") and the parent-child validation trigger.

**What you gain:** One fewer node type to manage everywhere -- type checks, valid child matrices, UI rendering, calculation logic. Simpler codebase. This is validated by industry practice: most tools (ProEst, STACK, PlanSwift) use a single container concept with flexible nesting, not two distinct container types.

**Guardrail (from data model review):** Consider an advisory depth limit for groups -- UI warns at depth > 3, hard limit at depth > 5 -- to prevent pathologically deep organizational structures. This is application-level guidance, not a database constraint.

---

## Question 2: How should phases work -- structural or classificatory?

### Recommendation: Classificatory (a tag on nodes, not part of the tree hierarchy).

**Reasoning:**

In construction, phases (Foundation, Framing, Rough-In, Finishes) are a way of viewing the SAME work organized by time/sequence. But the estimate tree is organized by SCOPE/TRADE (Concrete, Framing, Electrical). These two organizing principles often don't align:

- A "Foundation" phase includes concrete footings (from the Concrete category) AND anchor bolts (from the Metals category) AND underground plumbing (from the Plumbing category). Making "Foundation" a structural tree node would require duplicating items across both the trade tree and the phase tree.

- A single category like "Electrical" spans multiple phases -- rough-in during framing, finish during trim. Making phases structural would force splitting Electrical into multiple groups.

**Industry validation:** This classificatory approach is well-validated by industry practice. Sage Estimating uses the exact same pattern: phases are structural containers in the database, but WBS (Work Breakdown Structure) codes provide up to 40 classificatory tags that can be attached to any item for cross-cutting organization. RSMeans uses dual classification -- MasterFormat for trade/material and UNIFORMAT II for building system/element -- both orthogonal to the tree structure.

**The classificatory approach:** Each node has an optional `phase_id` FK. The `phases` table holds phase definitions for the project (Foundation, Framing, Rough-In, Finishes, Closeout). The tree structure remains organized by trade/scope, but any view can GROUP BY phase to show costs by phase.

```
Estimate Tree (structural -- organized by trade):        Phase View (classificatory -- grouped by phase):
+-- Concrete                                            +-- Foundation Phase
|   +-- Footings (phase: Foundation) -----------------> |   +-- Concrete: Footings
|   +-- Slab (phase: Rough-In) -----------------------> |   +-- Metals: Anchor Bolts
+-- Metals                                              |   +-- Plumbing: Underground
|   +-- Anchor Bolts (phase: Foundation) -------------> +-- Framing Phase
+-- Plumbing                                            |   +-- Framing: Walls
|   +-- Underground (phase: Foundation) --------------> |   +-- Electrical: Rough-In
|   +-- Fixtures (phase: Finishes) ------------------->  +-- Finishes Phase
+-- Electrical                                              +-- Plumbing: Fixtures
    +-- Rough-In (phase: Rough-In) ------------------->     +-- Electrical: Trim
    +-- Trim (phase: Finishes) ----------------------->
```

**Benefits:**
- No data duplication -- each item exists once in the tree
- Phase assignment can change without moving nodes in the tree
- Phase view is a query/grouping operation, not a structural constraint
- Items can have no phase (not yet assigned) -- the tree still works

**One item, one phase:** An item belongs to at most one phase. If an item genuinely spans phases, split it into two items or assign it to the phase where most of its work occurs. This keeps the model simple.

---

## Question 3: Where should assembly-specific parameters live?

### Recommendation: On the `node_item_details` row of the child item within the estimate.

**Reasoning:**

Assembly-specific parameters (waste factors, minimum quantities, package sizes, ratio relationships) describe how an item behaves WITHIN a specific assembly context. The same catalog item might have different waste factors in different assemblies:
- Cedar siding in a "Standard Wall" assembly: 15% waste
- Cedar siding in a "Complex Gable Wall" assembly: 22% waste (more cuts)

These values can't live on the catalog item (they'd apply globally). They can't live on the assembly (they're per-child, not per-assembly). They live on the RELATIONSHIP -- the specific instance of this item within this specific assembly.

In the catalog, this relationship data lives on `catalog_assembly_components` (the junction table). When instantiated into an estimate, it's copied to the child's `node_item_details` row -- specifically the `waste_factor`, `min_order_qty`, `package_size`, `ratio_numerator`, `ratio_denominator` columns.

**Why not a separate junction table in the estimate?** Because estimate items are already copies (instantiated from catalog). Each item instance has its own `node_item_details` row that's fully independent. The relationship data (ratio, waste) is a property of THIS instance in THIS context. Storing it directly on the detail row is simpler than maintaining a separate relationship table.

**What about items NOT in assemblies?** Items directly under a group don't use ratio fields -- they use `qty_mode = 'numeric'` or `'formula'` instead. The ratio fields are simply NULL. This is a small number of nullable columns (4-5), not a 36-column monolith problem.

**Ratio unit semantics (from data model review):** The ratio is ALWAYS expressed as `ratio_numerator [item units] per ratio_denominator [assembly units]`. For "2.88 LF of siding per 1 SF of wall area," the item's `unit_id` gives the numerator unit (LF) and the parent assembly's `assembly_unit_id` gives the denominator unit (SF). This relationship must be documented as a contract and validated at save time.

---

## Question 4: How many fields belong on an item vs. in related tables?

### Recommendation: Split into base table (~20 columns, all types) + item detail table (~20 columns, items only). Total ~40 columns for a fully specified item, but split across two focused tables with zero irrelevant NULLs on the detail table.

**The balance point:**

| Category | Where | Columns | Why |
|----------|-------|---------|-----|
| Tree structure (id, parent, sort, type) | Base table | 6 | All node types need these |
| Display (name, description, notes) | Base table | 4 | All node types have names/notes |
| Classification (phase, cost_code, visibility) | Base table | 3 | See tradeoff note below |
| Calculated costs (subtotal, contingency, overhead, total) | Base table | 4 | All node types have totals |
| Catalog reference | Base table | 3 | All node types can come from catalog |
| Options (alternative_id) | Base table | 1 | All node types can be part of options |
| **Item quantities** (qty, mode, formula, ratios) | Item detail | 7 | Only items have quantities |
| **Item costs** (unit_cost, cost_type, markup rates) | Item detail | 5 | Only items have unit costs |
| **Purchasing** (waste, min_order, package) | Item detail | 4 | Only items are purchased |
| **Item classification** (bid_type, vendor) | Item detail | 2 | Only items have vendors |
| **Item documentation** (instructions, specs) | Item detail | 2 | Item-specific docs |

**Honest tradeoff on the base table:** The base table has approximately 5 columns that are "pragmatically universal" rather than "truly universal." Specifically, `phase_id`, `cost_code_id`, `reference_name`, and `client_visibility` are overwhelmingly item/assembly concerns -- groups rarely have cost codes, groups don't have `reference_name` values that formulas reference, and groups are typically set to summary_only visibility rather than having meaningful individual visibility settings. These columns are kept on the base table for query simplicity: every tree-rendering query that needs to display cost codes or visibility icons would otherwise require JOINing detail tables just to render the node list.

This is a justified pragmatic choice, but it means the base table's "zero irrelevant NULLs" claim is slightly overstated. Approximately 5 columns will be NULL on most group nodes. The alternative -- moving them to detail tables -- would force JOINs on every tree render, which is worse. The detail tables (`node_item_details`, `node_assembly_details`) DO achieve true zero-irrelevant-NULLs: every column on those tables is relevant to every row.

**Compared to the old system:** The old monolithic table had 46 columns where ~36 were NULL on non-leaf nodes. This hybrid has ~20 base columns (most relevant to most types, ~5 pragmatically placed) and ~20 detail columns (all relevant to items). The JOINs required to fully load an item are trivially cheap for PostgreSQL.

---

## Question 5: Should calculations happen client-side, server-side, or both?

### Recommendation: Both -- client-side for instant display, server-side as the authoritative source of truth. One shared isomorphic TypeScript module.

**Why hybrid is the right answer:**

| Approach | Latency | Accuracy | Drift Risk | UX |
|----------|---------|----------|-----------|-----|
| Server-only (old system) | High -- round trip per edit | Perfect | None | Poor -- delay after every change |
| Client-only | None | Good | High -- stale code, browser quirks | Great instant feedback |
| **Hybrid (recommended)** | None for display, one trip on save | Perfect | **None -- server is authoritative** | Great feedback + trustworthy persistence |

**How it works:**
1. User edits a value -> client recalculates the entire tree in memory -> display updates instantly
2. User saves -> all changed nodes sent in one batch request -> server recalculates the full tree from scratch -> persists the server's values -> returns them to the client
3. The client updates its display to match the server's response. The server is ALWAYS authoritative -- it does not compare or negotiate with client values.

**Server-authoritative save model (revised from v1):** The original design proposed a "match/don't match" comparison between client and server values on save. Based on the calc engine review, this is revised to a simpler and more robust model: the server always recalculates and stores its own values. The client's role is display-only (optimistic UI). On save response, the client silently adopts the server's values. If there is a discrepancy (from floating-point noise, stale client state, or browser engine differences), the user never sees it -- the server's values simply overwrite the client's. Logging of client-vs-server discrepancies provides telemetry for diagnosing drift if it occurs.

**Floating-point precision strategy (new in v2):**

The calc engine review identified that JavaScript's IEEE 754 double-precision floating-point creates cumulative rounding errors across chained operations (qty * cost * markup * sum-across-hundreds-of-nodes). The precision strategy is:

1. **Database storage:** Use `DECIMAL(15,4)` for ALL intermediate and calculated values (subtotal, contingency_amount, overhead_amount, total_price, unit_price). Only round to 2 decimal places at display time. This absorbs rounding errors that would compound if truncated to 2dp at each step.

2. **Calculation module:** Apply explicit rounding at each monetary calculation step using a shared `roundTo4(value)` utility:
   ```
   subtotal = roundTo4(qty * unitCost)
   contingencyAmount = roundTo4(subtotal * contingencyRate)
   overheadAmount = roundTo4((subtotal + contingencyAmount) * overheadRate)
   totalPrice = subtotal + contingencyAmount + overheadAmount
   ```

3. **Rounding convention:** Standard rounding (round half up), NOT banker's rounding. This is consistent with construction industry practice and user expectations.

4. **Display:** Format to 2 decimal places in the UI. The extra precision (4dp) exists only for intermediate accuracy.

**Batch save eliminates N+1:** Instead of N database round-trips (one per changed ancestor), send all changed nodes in one request. Server validates and persists in a single transaction. One round-trip, one transaction.

---

## Question 6: How should the options system model "swap entire sections"?

### Recommendation: All alternatives stored as complete subtrees in `estimate_nodes`, with option membership tracked via a `node_option_memberships` junction table. The active tree is determined by excluding nodes that belong to any non-selected alternative.

**Revised from v1:** The original design used a single `option_alternative_id` column stamped on every node in each alternative's subtree. The options system review identified critical data integrity problems with column stamping that make the junction table approach necessary from day one.

**Architecture:**

1. An `option_group` defines a choice point ("Kitchen Package") and has an `anchor_node_id` FK pointing to the tree node where the option lives.
2. Each `option_alternative` is one choice ("Standard", "Mid-Range", "Premium"). A partial unique index enforces exactly one selected alternative per group.
3. A `node_option_memberships` junction table tracks which nodes belong to which alternatives, with columns `(node_id, option_alternative_id)` and UNIQUE on the pair.
4. The active tree query excludes nodes that belong to any non-selected alternative:
   ```sql
   WHERE NOT EXISTS (
     SELECT 1 FROM node_option_memberships nom
     JOIN option_alternatives oa ON nom.option_alternative_id = oa.id
     WHERE nom.node_id = n.id AND oa.is_selected = FALSE
   )
   ```
5. Nodes with no memberships (the majority of the tree) are always visible.

**Why junction table instead of column stamping:**

| Concern | Column Stamp | Junction Table |
|---------|-------------|----------------|
| Tree move corruption | Moving a node into an option subtree leaves it with NULL/wrong stamp. Every drag-and-drop is a potential stamp corruption event. | Memberships are explicit records. A trigger on `parent_id` UPDATE can add the moved node to the parent's option memberships. |
| Nested options (future) | Single column can only hold one alternative ID. Nested options require a schema migration. | A node can have multiple membership rows, one per alternative at each nesting level. Future nesting is a feature addition, not a breaking change. |
| Membership clarity | Implicit: "this node has an alternative_id, therefore it belongs to that alternative." Inherited stamps can become stale. | Explicit: a row in the junction table IS the membership. No inheritance ambiguity. |
| Query cost | Slightly cheaper (single column WHERE clause). | One additional JOIN/subquery. At 200-1,000 nodes, the performance difference is negligible. |

**Why alternatives are complete subtrees (not diff/patch):**
- Each alternative is independently editable -- you can change any item in any alternative without affecting others
- No merge conflicts -- alternatives don't share nodes
- Simple deletion -- remove an alternative = delete its nodes and membership rows
- The storage cost of storing complete subtrees is negligible at this scale (a "Kitchen" section might have 20-40 nodes x 3 alternatives = 60-120 nodes -- trivial)

**Additional safeguards (from options review):**
- Partial unique index ensures at most one `is_selected = TRUE` per group
- `anchor_node_id` on `option_groups` enables cascade delete when the anchor node is removed
- Option switching (deselect old + select new) wrapped in a serializable transaction to prevent corruption from double-clicks or retries

---

## Question 7: What's the right tree model?

### Recommendation: Adjacency list (`parent_id` self-referencing FK) + trigger-maintained `ltree` path column (dual column approach).

**Revised from v1:** The original recommendation was adjacency list alone with materialized path as a deferred enhancement. The data model review makes a compelling case for adding the `ltree` column from day one.

**Why adjacency list as the primary model:**

For an estimate tree of 200-1,000 nodes that is always fully loaded into client memory, the adjacency list is the simplest model that works. The primary access pattern is "load everything, build in memory" -- not "query a specific subtree from the database." Adjacency list is O(1) for writes (move = update one row's parent_id) and O(n) for full load (single SELECT).

**Why add `ltree` from day one:**

PostgreSQL's `ltree` extension is purpose-built for hierarchical data. It provides GiST-indexable path operations (`<@`, `@>`, `~`, `?`), ancestor/descendant queries without recursive CTEs, and built-in depth/level functions (`nlevel()`, `subpath()`, `lca()` for least common ancestor).

The dual-column approach gives the best of both worlds:

| Operation | Model Used | Performance |
|-----------|-----------|-------------|
| Move/re-parent a node | Adjacency list (`parent_id` UPDATE) | O(1) |
| Full tree load | Adjacency list (single SELECT) | O(n) |
| "Everything under Framing" subtree query | `ltree` path (`WHERE path <@ 'root.framing'`) | O(log n) via GiST index |
| Node depth | `ltree` (`nlevel(path)`) | O(1) |
| Ancestor chain | `ltree` (`subpath(path, 0, k)`) | O(1) |

**How the `ltree` path stays in sync:**

A database trigger fires on INSERT and UPDATE of `parent_id` on `estimate_nodes`. The trigger:
1. Looks up the parent's `path` value
2. Appends the current node's ID (or a label derived from it) to form the new path
3. Recursively updates all descendants' paths

Application code never manages paths manually. The trigger handles everything. Cost: one trigger, one column, one GiST index. Benefit: server-side subtree queries without recursive CTEs, forever.

**The subtree update cost on move:** Moving a subtree requires updating every descendant's path -- O(k) where k is the subtree size. For a 200-1,000 node tree where the largest subtree might be 100 nodes, this is ~100 UPDATEs in a single transaction. Trivially fast at this scale. The adjacency list's O(1) re-parenting handles the move itself; the trigger-maintained path update is a background consequence that the application doesn't need to manage.

---

## Question 8: How should formulas work?

### Recommendation: Use math.js (with constrained configuration) for expression evaluation, with custom variable injection and conditional support.

**Revised from v1:** The original recommendation was `expr-eval`. This is replaced with `math.js` based on the calc engine review's findings.

**Why math.js instead of expr-eval:**

The `expr-eval` library has a critical security vulnerability (CVE-2025-12735, CVSS 9.8) -- a prototype pollution attack that enables remote code execution through crafted expression strings. The library's last release was over 6 years ago (v2.0.2), and the maintainer has been unresponsive to security pull requests. Since ShossyWorks stores user-entered formula strings in the database and evaluates them on both client and server, this vulnerability is directly relevant even in a single-user context.

| Criterion | expr-eval | math.js |
|-----------|-----------|---------|
| Maintenance | Abandoned (6+ years, no security patches) | Active, regular releases |
| CVEs | CVE-2025-12735 (CVSS 9.8 Critical RCE) | None known |
| Sandbox security | Broken -- prototype pollution | Actively prevents `eval` and `new Function` |
| Custom functions | Yes | Yes |
| Ternary/conditionals | Yes | Yes (plus if/else) |
| Unit support | None | Built-in (relevant for construction) |
| Bundle size | ~15KB | ~200KB |
| TypeScript support | @types package (third-party) | Built-in |

**Why math.js over alternatives:** math.js has built-in unit support (relevant for a construction estimating tool), active maintenance with a security-conscious development approach, and native TypeScript support. The 200KB bundle size is acceptable for a construction estimating application -- this is a full desktop-class tool, not a lightweight widget.

**How formulas resolve:**
1. Build variable context from project parameters (`wall_area`, `roof_pitch`) and named references
2. Evaluate the formula string against the context using math.js
3. Return numeric result (or null + error flag on failure)

**Named preset formulas** (like `STUD_COUNT_16OC`) are implemented as custom functions registered with the evaluator. The architecture supports this from day one -- math.js accepts function registrations. The UI for creating/managing presets is a Phase 10 feature, but the engine is ready whenever you want to add them.

**Formula syntax:** Standard math notation that Zac is already familiar with from Excel: `= wall_area * 2.88 * 1.15`. Conditionals use ternary: `= roof_pitch > 8 ? base * 1.3 : base`. Named presets use function call syntax: `= STUD_COUNT_16OC(wall_length)`.

**Client-side cycle detection:** The formula engine must guard against circular references on both client and server. The client needs a max-iteration guard (or pre-evaluation dependency graph check) to prevent the browser from freezing if a formula creates a cycle. The server rejects circular formulas at save time, but the client must not infinite-loop before the save occurs.

---

## Question 9: What's the best approach for units of measure and conversion?

### Recommendation: Normalized `units_of_measure` table with FK references from all unit fields. No free-text unit strings.

**The problem with the old approach:** The old system had a `units_of_measure` table but the item's `unit` field was a free-text VARCHAR with no FK. This meant "sqft", "SF", "sq ft", and "Square Feet" could all coexist as different "units" with no conversion between them. The units table existed but was disconnected from the data it was supposed to standardize.

**The fix:**
- All unit fields (`node_item_details.unit_id`, `node_assembly_details.assembly_unit_id`, `catalog_items.default_unit_id`, etc.) are UUID FKs to `units_of_measure(id)`
- The `units_of_measure` table has a canonical `symbol` (e.g., "SF") and a `name` (e.g., "Square Feet")
- The `unit_conversions` table stores factors between compatible units (1 SY = 9 SF)
- Users can add custom units (`is_system = FALSE`) for project-specific needs

**Seed data (expanded in v2):** Industry research validated the initial seed list and identified several missing units that are standard in residential construction. The full seed list:

| Symbol | Name | Category | Usage |
|--------|------|----------|-------|
| LF | Linear Feet | Length | Framing lumber, trim, siding |
| SF | Square Feet | Area | Flooring, drywall, roofing, siding |
| SY | Square Yards | Area | Carpet, grading |
| SQ | Square (100 SF) | Area | Roofing (industry-standard roofing unit) |
| CF | Cubic Feet | Volume | Insulation |
| CY | Cubic Yards | Volume | Concrete, gravel, fill |
| MBF | Thousand Board Feet | Volume | Lumber pricing from suppliers |
| EA | Each | Count | Fixtures, doors, windows |
| PR | Pair | Count | Specific hardware |
| SET | Set | Count | Hardware sets |
| HR | Hour | Time | Labor |
| DAY | Day | Time | Equipment rental |
| BOX | Box | Package | Fasteners, tile |
| BDL | Bundle | Package | Shingles, lumber |
| BAG | Bag | Package | Concrete mix, mortar |
| ROLL | Roll | Package | Building paper, membrane, flashing |
| SHEET | Sheet | Package | Plywood, drywall (4x8 etc.) |
| GAL | Gallon | Volume | Paint, stain, sealants |
| TUBE | Tube | Package | Caulk, sealant |
| PAIL | Pail | Package | Adhesive, joint compound |
| LB | Pound | Weight | Rebar, nails sold by weight |
| TON | Ton | Weight | Aggregate, steel |
| LS | Lump Sum | Fixed | Subcontractor bids, fixed-price items |

Units added in v2: SQ, MBF, BAG, ROLL, SHEET, TUBE, PAIL. Getting the initial unit list right prevents early friction when the builder starts entering items and doesn't find their unit.

**Display:** The UI shows the unit's `symbol` everywhere. The full `name` is shown in tooltips or selection dropdowns. No ambiguity, no duplicates.

**Conversion in formulas:** When a formula references a value in different units (e.g., assembly quantity is in SF but item quantity needs LF), the calculation engine can look up the conversion factor. This is automatic and transparent -- the user enters natural units, the system converts.

---

## Question 10: How should allowances work?

### NEW in v2. Surfaced by industry research.

### Recommendation: Allowances are items with `bid_type = 'allowance'` plus two additional fields on `node_item_details`: `allowance_budget` and `allowance_status`.

**What is an allowance?**

An allowance is a budget placeholder for items not yet fully specified. The builder includes a dollar amount in the contract for a category of work (e.g., "Lighting Fixtures: $8,000 allowance"). When the client makes their selection, the actual cost may differ. The difference (overage or underage) adjusts the contract price.

Allowances are ubiquitous in residential construction. A typical custom home estimate might have 20-40 allowance items: flooring, lighting fixtures, plumbing fixtures, countertops, hardware, appliances, tile, paint colors, etc. Every competitor platform (CoConstruct, Buildertrend, Clear Estimates) treats allowances as a first-class concept.

**How allowances differ from options:**

| Concern | Allowance | Option (Inline) |
|---------|-----------|-----------------|
| Purpose | Budget placeholder for unfinalized selection | Pre-priced alternative configurations |
| Pricing | Builder estimates a budget; actual cost TBD | Each alternative is fully priced upfront |
| Workflow | Client selects a product later; overage/underage calculated | Client chooses between pre-defined alternatives |
| Tree impact | Single item, cost changes when selection is made | Entire subtree swaps |
| Contract impact | Generates change orders for overages/underages | Price difference shown upfront before contract |

**Data model:**

Two fields added to `node_item_details`:

- `allowance_budget DECIMAL(15,4)` -- The original budgeted dollar amount included in the contract. This is separate from the item's `unit_cost * qty` total, which represents the ACTUAL cost once a selection is made.
- `allowance_status VARCHAR(20)` -- One of: `'pending_selection'` (client hasn't chosen yet), `'selected'` (client has chosen, actual cost entered), `'finalized'` (selection confirmed, no further changes expected).

**Overage/underage calculation:**

```
variance = total_price - allowance_budget
```

Where `total_price` is the item's calculated total (qty * unit_cost with markups). If positive, the client owes more. If negative, the client gets a credit.

A view or computed field aggregates all allowance variances across the estimate, providing the net contract adjustment.

**Why fields on `node_item_details` instead of a separate table:** For a single-user tool, two additional columns on the detail table are simpler than a dedicated `allowances` table with its own CRUD operations, junction relationships, and UI. The allowance is a property of the item, not a separate entity. If allowance management becomes more complex later (selection workflows, change order generation, client approval), a separate table can be introduced at that point.

**Interaction with options:** An allowance item CAN exist inside an option alternative's subtree. For example, the "Premium Kitchen" option might include a $12,000 countertop allowance while the "Standard Kitchen" has a $6,000 countertop allowance. The allowance budget tracks independently within each alternative.

---

## Question 11: Should cost codes be structured or free-text?

### NEW in v2. Surfaced by industry research.

### Recommendation: Structured. FK to a `cost_codes` table seeded with CSI MasterFormat divisions.

**The problem with free-text cost codes:**

The original architecture defined `cost_code VARCHAR(50)` on `estimate_nodes` as a free-text field. This repeats the exact mistake the old system made with units of measure -- where "sqft", "SF", "sq ft", and "Square Feet" could all coexist as different entries. Free-text cost codes will inevitably produce inconsistencies: "06 10 00" vs "061000" vs "Rough Carpentry" vs "rough carpentry" all representing the same code.

**The structured approach:**

```
cost_codes table:
  id UUID PK
  code VARCHAR(20)         -- e.g., "06 10 00"
  division VARCHAR(2)      -- e.g., "06" (top-level grouping)
  title VARCHAR(255)       -- e.g., "Rough Carpentry"
  parent_code_id UUID FK   -- self-referencing for hierarchy
  is_system BOOLEAN        -- TRUE for MasterFormat seeds, FALSE for user-added
  created_at TIMESTAMPTZ
```

Then `estimate_nodes.cost_code_id UUID FK -> cost_codes(id)` instead of free text.

**CSI MasterFormat as the seed standard:**

CSI MasterFormat is the industry standard in North America for organizing construction work. The current edition uses a 50-division structure with three levels of depth:

- Level 1 -- Division (2 digits): e.g., `03` = Concrete
- Level 2 -- Section (4 digits): e.g., `03 30` = Cast-in-Place Concrete
- Level 3 -- Subsection (6 digits): e.g., `03 30 00` = Cast-in-Place Concrete (general)

For a residential builder, only ~15-20 of the 50 divisions are relevant. The seed data should focus on residential divisions:

| Division | Title | Residential Relevance |
|----------|-------|-----------------------|
| 01 | General Requirements | Insurance, permits, temp facilities |
| 03 | Concrete | Foundations, slabs, flatwork |
| 04 | Masonry | Fireplaces, veneer, retaining walls |
| 05 | Metals | Structural steel, railings, misc metals |
| 06 | Wood, Plastics, Composites | Framing, trim, cabinetry |
| 07 | Thermal and Moisture Protection | Roofing, siding, insulation, waterproofing |
| 08 | Openings | Doors, windows, skylights |
| 09 | Finishes | Drywall, paint, flooring, tile |
| 10 | Specialties | Mirrors, toilet accessories, fireplaces |
| 22 | Plumbing | Piping, fixtures, water heaters |
| 23 | HVAC | Heating, cooling, ductwork |
| 26 | Electrical | Wiring, fixtures, panels, low voltage |
| 31 | Earthwork | Excavation, grading, fill |
| 32 | Exterior Improvements | Driveways, landscaping, fencing |

**Benefits of structured codes:**
- Prevents inconsistency -- one canonical code per work type
- Enables grouping/reporting by division with reliable aggregation
- Enables filtering/searching by standard divisions
- Allows custom codes alongside MasterFormat standards (`is_system = false`)
- Aligns with RSMeans cost data and subcontractor bid packages, which use MasterFormat
- Seed data from MasterFormat residential divisions provides immediate value

**User experience:** The UI presents a searchable dropdown of cost codes (code + title). Users can assign codes to items and assemblies. Reports can group costs by division. Custom codes can be added for project-specific or company-specific categorization.
