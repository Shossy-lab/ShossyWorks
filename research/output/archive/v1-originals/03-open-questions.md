# Answers to Open Questions

> **Date:** 2026-04-02
> **Source:** Part 7 of RESEARCH-SESSION-BRIEF.md
> **Note:** Answers informed by the data architecture in `01-data-architecture.md`. Read that first for full context.

---

## Question 1: Do I need both "categories" and "sections," or is one generic "group" sufficient?

### Recommendation: One generic `group` type. No categories. No sections.

**Reasoning:**

In the old system, the only functional difference between a "category" and a "section" was that categories could be root nodes and sections couldn't. But both behaved identically — they're containers that aggregate children's costs. Having two types for this one distinction added type-checking complexity throughout the codebase without providing meaningful value.

A single `group` type with the rule "root nodes must be groups" achieves the same hierarchy:

```
Group (root — "Division 03: Concrete")
  └── Group (nested — "Foundation Walls")
        ├── Item (Concrete material)
        ├── Item (Rebar)
        └── Item (Forming labor)
```

Groups can nest to arbitrary depth, allowing the user to organize as deeply as the project demands. The distinction between "root group" and "nested group" is positional (is `parent_id` NULL?), not type-based.

**What you lose:** The ability to enforce "sections can't be root" at the type level. But this is a minor rule that's easily enforced by the UI (don't offer "add section at root level") and the parent-child validation trigger.

**What you gain:** One fewer node type to manage everywhere — type checks, valid child matrices, UI rendering, calculation logic. Simpler codebase.

---

## Question 2: How should phases work — structural or classificatory?

### Recommendation: Classificatory (a tag on nodes, not part of the tree hierarchy).

**Reasoning:**

In construction, phases (Foundation, Framing, Rough-In, Finishes) are a way of viewing the SAME work organized by time/sequence. But the estimate tree is organized by SCOPE/TRADE (Concrete, Framing, Electrical). These two organizing principles often don't align:

- A "Foundation" phase includes concrete footings (from the Concrete category) AND anchor bolts (from the Metals category) AND underground plumbing (from the Plumbing category). Making "Foundation" a structural tree node would require duplicating items across both the trade tree and the phase tree.

- A single category like "Electrical" spans multiple phases — rough-in during framing, finish during trim. Making phases structural would force splitting Electrical into multiple groups.

**The classificatory approach:** Each node has an optional `phase_id` FK. The `phases` table holds phase definitions for the project (Foundation, Framing, Rough-In, Finishes, Closeout). The tree structure remains organized by trade/scope, but any view can GROUP BY phase to show costs by phase.

```
Estimate Tree (structural — organized by trade):        Phase View (classificatory — grouped by phase):
├── Concrete                                            ├── Foundation Phase
│   ├── Footings (phase: Foundation) ─────────────────► │   ├── Concrete: Footings
│   └── Slab (phase: Rough-In) ───────────────────────► │   ├── Metals: Anchor Bolts
├── Metals                                              │   └── Plumbing: Underground
│   └── Anchor Bolts (phase: Foundation) ─────────────► ├── Framing Phase
├── Plumbing                                            │   ├── Framing: Walls
│   ├── Underground (phase: Foundation) ──────────────► │   └── Electrical: Rough-In
│   └── Fixtures (phase: Finishes) ───────────────────► └── Finishes Phase
└── Electrical                                              ├── Plumbing: Fixtures
    ├── Rough-In (phase: Rough-In) ───────────────────►     └── Electrical: Trim
    └── Trim (phase: Finishes) ───────────────────────►
```

**Benefits:**
- No data duplication — each item exists once in the tree
- Phase assignment can change without moving nodes in the tree
- Phase view is a query/grouping operation, not a structural constraint
- Items can have no phase (not yet assigned) — the tree still works

**One item, one phase:** An item belongs to at most one phase. If an item genuinely spans phases, split it into two items or assign it to the phase where most of its work occurs. This keeps the model simple.

---

## Question 3: Where should assembly-specific parameters live?

### Recommendation: On the `node_item_details` row of the child item within the estimate.

**Reasoning:**

Assembly-specific parameters (waste factors, minimum quantities, package sizes, ratio relationships) describe how an item behaves WITHIN a specific assembly context. The same catalog item might have different waste factors in different assemblies:
- Cedar siding in a "Standard Wall" assembly: 15% waste
- Cedar siding in a "Complex Gable Wall" assembly: 22% waste (more cuts)

These values can't live on the catalog item (they'd apply globally). They can't live on the assembly (they're per-child, not per-assembly). They live on the RELATIONSHIP — the specific instance of this item within this specific assembly.

In the catalog, this relationship data lives on `catalog_assembly_components` (the junction table). When instantiated into an estimate, it's copied to the child's `node_item_details` row — specifically the `waste_factor`, `min_order_qty`, `package_size`, `ratio_numerator`, `ratio_denominator` columns.

**Why not a separate junction table in the estimate?** Because estimate items are already copies (instantiated from catalog). Each item instance has its own `node_item_details` row that's fully independent. The relationship data (ratio, waste) is a property of THIS instance in THIS context. Storing it directly on the detail row is simpler than maintaining a separate relationship table.

**What about items NOT in assemblies?** Items directly under a group don't use ratio fields — they use `qty_mode = 'numeric'` or `'formula'` instead. The ratio fields are simply NULL. This is a small number of nullable columns (4-5), not a 36-column monolith problem.

---

## Question 4: How many fields belong on an item vs. in related tables?

### Recommendation: Split into base table (~20 columns, all types) + item detail table (~20 columns, items only). Total ~40 columns for a fully specified item, but split across two focused tables with zero irrelevant NULLs.

**The balance point:**

| Category | Where | Columns | Why |
|----------|-------|---------|-----|
| Tree structure (id, parent, sort, type) | Base table | 6 | All node types need these |
| Display (name, description, notes) | Base table | 4 | All node types have names/notes |
| Classification (phase, cost_code, visibility) | Base table | 3 | All node types can be classified |
| Calculated costs (subtotal, contingency, overhead, total) | Base table | 4 | All node types have totals |
| Catalog reference | Base table | 3 | All node types can come from catalog |
| Options (alternative_id) | Base table | 1 | All node types can be part of options |
| **Item quantities** (qty, mode, formula, ratios) | Item detail | 7 | Only items have quantities |
| **Item costs** (unit_cost, cost_type, markup rates) | Item detail | 5 | Only items have unit costs |
| **Purchasing** (waste, min_order, package) | Item detail | 4 | Only items are purchased |
| **Item classification** (bid_type, vendor) | Item detail | 2 | Only items have vendors |
| **Item documentation** (instructions, specs) | Item detail | 2 | Item-specific docs |

**Compared to the old system:** The old monolithic table had 46 columns where ~36 were NULL on non-leaf nodes. This hybrid has ~20 base columns (all relevant to all types) and ~20 detail columns (all relevant to items). Zero wasted columns. The JOINs required to fully load an item are trivially cheap for PostgreSQL.

---

## Question 5: Should calculations happen client-side, server-side, or both?

### Recommendation: Both — client-side for instant display, server-side for validation. One shared isomorphic TypeScript module.

**Why hybrid is the right answer:**

| Approach | Latency | Accuracy | Drift Risk | UX |
|----------|---------|----------|-----------|-----|
| Server-only (old system) | High — round trip per edit | Perfect | None | Poor — delay after every change |
| Client-only | None | Good | High — stale code, browser quirks | Great instant feedback |
| **Hybrid (recommended)** | None for display, one trip on save | Perfect | **None — identical code on both sides** | Great feedback + trustworthy persistence |

**How it works:**
1. User edits a value → client recalculates the entire tree in memory → display updates instantly
2. User saves → all changed nodes sent in one batch request → server recalculates the full tree → compares with client values → persists server's values → returns any corrections
3. If client and server disagree, server wins and client state is corrected

**Why drift is impossible:** The calculation module is a single TypeScript file imported by both the Next.js client bundle and the server actions. Same code, same math, same rounding. The only possible drift source is floating point differences between V8 engines (browser vs. Node.js), which are identical for IEEE 754 arithmetic.

**Batch save eliminates N+1:** Instead of N database round-trips (one per changed ancestor), send all changed nodes in one request. Server validates and persists in a single transaction. One round-trip, one transaction.

---

## Question 6: How should the options system model "swap entire sections"?

### Recommendation: All alternatives stored as complete subtrees in `estimate_nodes`, with an `option_alternative_id` stamp on every node in each alternative's subtree. The active tree is a simple WHERE clause filter.

**See the full design in `01-data-architecture.md`, Section 7.2.** Summary:

1. An `option_group` defines a choice point ("Kitchen Package")
2. Each `option_alternative` is one choice ("Standard", "Mid-Range", "Premium")
3. All nodes belonging to an alternative are stamped with its `option_alternative_id`
4. The active tree query filters: `WHERE option_alternative_id IS NULL OR option_alternative_id IN (selected alternatives)`
5. Inactive alternatives' subtrees exist in the database but are invisible to the tree and calculations

**Why stamping ALL nodes in a subtree (not just the root):**
- Makes the active tree query a simple WHERE clause — no recursive exclusion logic
- The cost is minimal: stamping is a one-time operation when the alternative is created
- New nodes added to an alternative's subtree inherit the stamp from their parent (enforced by application logic)

**Why alternatives are complete subtrees (not diff/patch):**
- Each alternative is independently editable — you can change any item in any alternative without affecting others
- No merge conflicts — alternatives don't share nodes
- Simple deletion — remove an alternative = delete its nodes
- The storage cost of storing complete subtrees is negligible at this scale (a "Kitchen" section might have 20-40 nodes × 3 alternatives = 60-120 nodes — trivial)

---

## Question 7: What's the right tree model?

### Recommendation: Adjacency list (`parent_id` self-referencing FK).

**Full analysis in `01-data-architecture.md`, Section 2.** The short version:

For an estimate tree of 200–1,000 nodes that is always fully loaded into client memory, the adjacency list is the simplest model that works. The primary access pattern is "load everything, build in memory" — not "query a specific subtree from the database." Adjacency list is O(1) for writes (move = update one row's parent_id) and O(n) for full load (single SELECT).

Materialized paths, closure tables, and nested sets all optimize for partial tree queries at the cost of write complexity. Since we never do partial tree queries in normal operation, the optimization is wasted.

**If partial queries become needed later:** Add a `path TEXT` column (materialized path) as an index enhancement. This is an additive change that doesn't affect the existing adjacency list model.

---

## Question 8: How should formulas work?

### Recommendation: Use a proven expression evaluation library (`expr-eval`) with custom variable injection and basic conditional support.

**Why a library, not a custom parser:**
- Parsing math expressions correctly is a solved problem — don't re-solve it
- Libraries handle operator precedence, parentheses, unary operators, and edge cases
- `expr-eval` is ~15KB, well-tested, supports custom functions and variables, handles ternary conditionals

**How formulas resolve:**
1. Build variable context from project parameters (`wall_area`, `roof_pitch`) and named references
2. Evaluate the formula string against the context
3. Return numeric result (or null + error flag on failure)

**Named preset formulas** (like `STUD_COUNT_16OC`) are implemented as custom functions registered with the evaluator. The architecture supports this from day one — the `expr-eval` library accepts function registrations. The UI for creating/managing presets is a Phase 10 feature, but the engine is ready whenever you want to add them.

**Formula syntax:** Standard math notation that Zac is already familiar with from Excel: `= wall_area * 2.88 * 1.15`. Conditionals use ternary: `= roof_pitch > 8 ? base * 1.3 : base`. Named presets use function call syntax: `= STUD_COUNT_16OC(wall_length)`.

---

## Question 9: What's the best approach for units of measure and conversion?

### Recommendation: Normalized `units_of_measure` table with FK references from all unit fields. No free-text unit strings.

**The problem with the old approach:** The old system had a `units_of_measure` table but the item's `unit` field was a free-text VARCHAR with no FK. This meant "sqft", "SF", "sq ft", and "Square Feet" could all coexist as different "units" with no conversion between them. The units table existed but was disconnected from the data it was supposed to standardize.

**The fix:**
- All unit fields (`node_item_details.unit_id`, `node_assembly_details.assembly_unit_id`, `catalog_items.default_unit_id`, etc.) are UUID FKs to `units_of_measure(id)`
- The `units_of_measure` table has a canonical `symbol` (e.g., "SF") and a `name` (e.g., "Square Feet")
- Seed data covers all common construction units: LF, SF, SY, CF, CY, EA, HR, DAY, BOX, BDL, GAL, LB, TON, LS
- The `unit_conversions` table stores factors between compatible units (1 SY = 9 SF)
- Users can add custom units (`is_system = FALSE`) for project-specific needs

**Display:** The UI shows the unit's `symbol` everywhere. The full `name` is shown in tooltips or selection dropdowns. No ambiguity, no duplicates.

**Conversion in formulas:** When a formula references a value in different units (e.g., assembly quantity is in SF but item quantity needs LF), the calculation engine can look up the conversion factor. This is automatic and transparent — the user enters natural units, the system converts.
