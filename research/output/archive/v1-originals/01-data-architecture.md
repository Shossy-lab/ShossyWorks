# Data Architecture Recommendation

> **Date:** 2026-04-02
> **Scope:** Complete data architecture for the ShossyWorks construction estimating platform.
> **Audience:** Future Claude Code implementation sessions and Zac (for review).
> **Important:** This document recommends an architecture from first principles. It is NOT derived from previous attempts. Where old patterns happen to match, it's because independent analysis reached the same conclusion.

---

## 1. Design Principles

These principles guide every decision in this document:

1. **Bottom-up stability.** Each layer must be provably correct before anything is built on top of it. The tree must work before calculations. Calculations before catalog. Catalog before options.

2. **The database enforces invariants.** If a rule must NEVER be violated (items are always leaves, calculations always compound correctly, options never orphan), encode it in constraints, triggers, or CHECK clauses — not just application code. Application code has bugs. Database constraints don't.

3. **Single-user simplicity.** No multi-tenancy, no complex role hierarchy. One company, one builder, with a filtered client view. Every architectural decision should be evaluated against "does a single-user tool need this?"

4. **Estimates own their data.** Copy-on-instantiate from catalog. No live references that could silently change approved estimates. The catalog is a template library; estimates are independent documents.

5. **Calculations are deterministic and isomorphic.** The same calculation logic runs client-side (for instant feedback) and server-side (for validation on save). One TypeScript module, imported by both. No drift possible.

6. **Schema clarity over storage optimization.** Every column on a table should be relevant to every row in that table. No 36-column NULL density like the old monolithic table. If a column only applies to items, it goes on the items table.

---

## 2. Tree Model: Adjacency List

### Recommendation

Use a **self-referencing `parent_id` foreign key** (adjacency list) for the tree structure. This is the simplest model that meets all requirements.

### Why This Over Alternatives

| Model | Read Performance | Write Performance | Move/Re-parent | Complexity | Verdict |
|-------|-----------------|-------------------|-----------------|------------|---------|
| **Adjacency List** | Requires recursive CTE for subtree queries | O(1) — update one row | O(1) — update parent_id | Simple | **Recommended** |
| Materialized Path | O(1) subtree via LIKE prefix | O(k) — update moved node + all descendants | O(k) — rewrite paths for subtree | Moderate | Deferred enhancement |
| Closure Table | O(1) subtree via JOIN | O(d) — insert rows for each ancestor | O(d²) — delete + re-insert closures | High | Overkill for this scale |
| Nested Sets | O(1) subtree via range query | O(n) — renumber half the tree on insert | O(n) — renumber on every move | High | **Rejected** — too expensive for frequent edits |

### Why Adjacency List Is Sufficient

The primary access pattern is: **load the entire estimate tree in one query, build it in memory, work with it client-side.** We never need to query "just the subtree under node X" from the database in normal operation — we always load everything and filter in TypeScript.

For a tree of 200–1,000 nodes, a single `SELECT * FROM estimate_nodes WHERE estimate_id = $1 ORDER BY sort_order` returns the entire tree. The `buildTree()` algorithm assembles it in memory in O(n log n) time. This is fast enough that no indexing tricks are needed.

**Recursive CTEs** handle the rare server-side subtree operations (e.g., stamping option_alternative_id on a subtree, cascading deletes). PostgreSQL handles recursive CTEs efficiently at this scale.

### Optional Future Enhancement: Materialized Path Column

If server-side subtree queries become a bottleneck (unlikely at this scale), add a `path TEXT` column storing the ancestor chain (e.g., `/<root-id>/<parent-id>/<this-id>`). Subtree queries become `WHERE path LIKE '/<target-id>/%'`. This requires updating all descendant paths on move operations — acceptable for moderate trees but adds maintenance overhead. **Defer until proven necessary.**

### Sibling Ordering

Use an `INTEGER sort_order` column for ordering siblings within a parent. Operations:

- **Insert:** New node gets `MAX(sort_order) + 1` among siblings.
- **Move up/down:** Swap sort_order with adjacent sibling.
- **Re-parent:** Node gets `MAX(sort_order) + 1` in new parent's children.
- **Reorder (drag-and-drop):** Renumber all siblings sequentially (1, 2, 3...) after the operation. This avoids fractional sort_order drift (a problem in the old system's midpoint calculation).

---

## 3. Node Type Architecture: Hybrid Base + Detail Tables

### Recommendation

Use a **shared base table** (`estimate_nodes`) for all tree-structural and universally-applicable columns, with **type-specific detail tables** (`node_item_details`, `node_assembly_details`) joined 1:1 for type-specific data.

### The Three Node Types

| Type | Purpose | Has Detail Table? | Can Be Root? | Can Have Children? |
|------|---------|-------------------|-------------|-------------------|
| `group` | Organizational container (replaces old category + section) | No — base table is sufficient | Yes | Yes (groups, assemblies) |
| `assembly` | Reusable component with own quantity, children calculate relative to it | Yes (`node_assembly_details`) | No | Yes (assemblies, items) |
| `item` | Atomic cost entry — always a leaf | Yes (`node_item_details`) | No | **No — always a leaf** |

### Valid Parent-Child Relationships

```
group
  ├── group        (nesting groups for deep organization)
  ├── assembly
  │     ├── assembly  (recursive nesting)
  │     └── item      (leaf)
  └── item            (leaf, direct under group without assembly)
```

**Enforced in the database** via a trigger on INSERT/UPDATE that validates:
- `item` nodes cannot have children (reject INSERT where parent is an item)
- `assembly` nodes cannot be root (parent_id must not be NULL)
- `group` nodes can be root or nested

### Why Hybrid Over Monolithic

| Concern | Monolithic (old approach) | Hybrid (recommended) |
|---------|--------------------------|----------------------|
| NULL density | ~36 of 46 columns NULL on non-leaf nodes | Zero irrelevant NULLs — each table has only relevant columns |
| Schema clarity | Must know externally which columns apply per type | Table name tells you what columns exist |
| Tree operations | Update one row regardless of type | Update base table only — detail tables untouched for move/reorder |
| Query complexity | Single SELECT | JOIN for full item data — but base table alone is sufficient for tree structure |
| Type change | Column update | Rare — and would require deliberate migration between detail tables |

**The JOIN cost is minimal:** loading an estimate already requires fetching all nodes. A LEFT JOIN to both detail tables in the same query adds negligible overhead. Alternatively, fetch the base tree first, then fetch details only for visible/expanded nodes (lazy loading for performance).

### Why Hybrid Over Full Table-Per-Type

A full table-per-type approach (separate `groups`, `assemblies`, `items` tables with no shared base table) would make tree traversal require UNION queries across three tables. Every tree operation (find parent, find children, find siblings) would need to check all three tables. This is far more complex than a single base table with JOINs for details.

---

## 4. Core Schema

### 4.1 `estimate_nodes` — The Base Table (~20 columns)

Every node in the estimate tree, regardless of type.

| Column | Type | Nullable | Default | Purpose |
|--------|------|----------|---------|---------|
| `id` | UUID | NO | `gen_random_uuid()` | Primary key |
| `estimate_id` | UUID | NO | — | FK → `estimates`. ON DELETE CASCADE |
| `parent_id` | UUID | YES | — | FK → `estimate_nodes(id)`. NULL = root node. ON DELETE CASCADE |
| `sort_order` | INTEGER | NO | `0` | Sibling ordering |
| `node_type` | VARCHAR(20) | NO | — | CHECK: `('group','assembly','item')` |
| `name` | VARCHAR(255) | NO | — | Display name |
| `description` | TEXT | YES | — | Extended description (all types) |
| `notes` | TEXT | YES | — | Internal notes (builder-only) |
| `client_notes` | TEXT | YES | — | Client-visible notes |
| `phase_id` | UUID | YES | — | FK → `phases`. Classification, not structural |
| `cost_code` | VARCHAR(50) | YES | — | Industry cost code (CSI MasterFormat etc.) |
| `client_visibility` | VARCHAR(20) | NO | `'visible'` | CHECK: `('visible','hidden','summary_only')` |
| `option_alternative_id` | UUID | YES | — | FK → `option_alternatives`. NULL = always visible |
| `subtotal` | DECIMAL(15,2) | YES | `0` | Calculated: items=qty×cost, parents=SUM(children) |
| `contingency_amount` | DECIMAL(15,2) | YES | `0` | Calculated |
| `overhead_amount` | DECIMAL(15,2) | YES | `0` | Calculated |
| `total_price` | DECIMAL(15,2) | YES | `0` | subtotal + contingency + overhead |
| `catalog_source_id` | UUID | YES | — | Soft reference to catalog item/assembly |
| `catalog_source_type` | VARCHAR(20) | YES | — | CHECK: `('item','assembly')` |
| `catalog_version` | INTEGER | YES | — | Version at time of instantiation |
| `reference_name` | VARCHAR(100) | YES | — | If set, this node's value can be referenced in formulas. UNIQUE per estimate. |
| `created_at` | TIMESTAMPTZ | NO | `NOW()` | — |
| `updated_at` | TIMESTAMPTZ | NO | `NOW()` | Auto-updated via trigger |
| `created_by` | UUID | YES | — | FK → `auth.users(id)` |

**Key design decisions:**
- **Calculated cost fields on all nodes.** Every node has a total — items derive from qty×cost, parents aggregate from children. Storing these enables direct querying for reports and captures point-in-time values in history.
- **`reference_name` replaces `is_active_reference` + `reference_name` combo.** NULL means "not a reference" — no separate boolean needed. UNIQUE constraint per estimate prevents name collisions.
- **`catalog_source_id` is a soft reference** (no FK). Deleting a catalog entry never breaks estimates. This was correctly done in the old system.
- **No `row_number` column.** Row numbering (1, 1.1, 1.1.2) is derived from tree position at render time. Storing it was redundant in the old system.

**Named constraints:**
```sql
CONSTRAINT valid_node_type CHECK (node_type IN ('group', 'assembly', 'item'))
CONSTRAINT valid_visibility CHECK (client_visibility IN ('visible', 'hidden', 'summary_only'))
CONSTRAINT valid_catalog_type CHECK (catalog_source_type IN ('item', 'assembly') OR catalog_source_type IS NULL)
CONSTRAINT unique_reference_name UNIQUE (estimate_id, reference_name)
-- Deferrable constraint: items must have a parent
CONSTRAINT items_must_have_parent CHECK (node_type != 'item' OR parent_id IS NOT NULL)
```

**Indexes:**
```sql
CREATE INDEX idx_nodes_estimate ON estimate_nodes(estimate_id);
CREATE INDEX idx_nodes_parent ON estimate_nodes(parent_id);
CREATE INDEX idx_nodes_tree_order ON estimate_nodes(estimate_id, parent_id, sort_order);
CREATE INDEX idx_nodes_option ON estimate_nodes(option_alternative_id) WHERE option_alternative_id IS NOT NULL;
CREATE INDEX idx_nodes_phase ON estimate_nodes(phase_id) WHERE phase_id IS NOT NULL;
CREATE INDEX idx_nodes_reference ON estimate_nodes(estimate_id, reference_name) WHERE reference_name IS NOT NULL;
```

### 4.2 `node_item_details` — Item-Specific Data (~20 columns)

One row per item node. PK = FK to `estimate_nodes.id`.

| Column | Type | Nullable | Default | Purpose |
|--------|------|----------|---------|---------|
| `node_id` | UUID | NO | — | PK, FK → `estimate_nodes(id)` ON DELETE CASCADE |
| `qty` | DECIMAL(15,4) | YES | `0` | Final calculated quantity (after waste, rounding) |
| `raw_qty` | DECIMAL(15,4) | YES | `0` | Pre-constraint quantity (before waste/rounding) |
| `qty_mode` | VARCHAR(20) | NO | `'numeric'` | CHECK: `('numeric','formula','ratio')` |
| `qty_formula` | TEXT | YES | — | Formula string (when qty_mode = 'formula') |
| `ratio_numerator` | DECIMAL(15,4) | YES | — | e.g., 1 (1 box per 75 SF) |
| `ratio_denominator` | DECIMAL(15,4) | YES | — | e.g., 75 |
| `unit_id` | UUID | YES | — | FK → `units_of_measure(id)` |
| `unit_cost` | DECIMAL(15,4) | YES | `0` | Cost per unit (builder's cost) |
| `cost_formula` | TEXT | YES | — | Optional formula for cost |
| `cost_type` | VARCHAR(20) | YES | — | CHECK: `('material','labor','equipment','subcontractor','other')` |
| `contingency_rate` | DECIMAL(5,4) | NO | `0` | e.g., 0.0500 = 5% |
| `overhead_rate` | DECIMAL(5,4) | NO | `0` | e.g., 0.1000 = 10% |
| `unit_price` | DECIMAL(15,2) | YES | — | total_price / qty (client-facing) |
| `waste_factor` | DECIMAL(5,4) | NO | `0` | e.g., 0.1500 = 15% waste |
| `min_order_qty` | DECIMAL(15,4) | YES | — | Can't buy less than this |
| `package_size` | DECIMAL(15,4) | YES | — | Rounds up to multiples of this |
| `package_unit_id` | UUID | YES | — | FK → `units_of_measure(id)` |
| `bid_type` | VARCHAR(20) | YES | `'estimate'` | CHECK: `('bid','allowance','estimate')` |
| `vendor_id` | UUID | YES | — | FK → `vendors(id)` |
| `instructions` | TEXT | YES | — | Installation/usage instructions |
| `specifications` | TEXT | YES | — | Material specifications |

**Why `raw_qty` and `qty` are separate:** The purchasing constraint cascade is: `raw_qty` (from formula/ratio/direct entry) → apply waste factor → round to package size → enforce minimum → `qty` (final). Storing both lets the user see "you need 3,456 LF of siding, which rounds up to 3,460 LF due to 10-foot lengths." The intermediate calculation is visible, not hidden.

**Note on ratios:** `ratio_numerator` and `ratio_denominator` express the natural relationship (e.g., 1 box per 75 SF). The system calculates: `raw_qty = (assembly_qty × ratio_numerator) / ratio_denominator`. This preserves the natural expression "1 per 75" rather than forcing the unintuitive "0.01333 per 1."

### 4.3 `node_assembly_details` — Assembly-Specific Data (~5 columns)

One row per assembly node. PK = FK to `estimate_nodes.id`.

| Column | Type | Nullable | Default | Purpose |
|--------|------|----------|---------|---------|
| `node_id` | UUID | NO | — | PK, FK → `estimate_nodes(id)` ON DELETE CASCADE |
| `assembly_unit_id` | UUID | YES | — | FK → `units_of_measure(id)`. The unit this assembly measures (e.g., SF) |
| `assembly_qty` | DECIMAL(15,4) | YES | `0` | How much of this assembly (e.g., 1200 SF of wall) |
| `derived_unit_cost` | DECIMAL(15,4) | YES | — | total_price / assembly_qty. Display-only, auto-calculated. |
| `qty_formula` | TEXT | YES | — | Optional formula for assembly quantity |

Assemblies are lean. Their cost fields (subtotal, contingency, overhead, total) live on the base table and are SUM aggregations of children. The assembly-specific data is just the quantity and unit that child items calculate relative to.

---

## 5. Supporting Tables

### 5.1 `projects`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | — |
| `name` | VARCHAR(255) | Project name |
| `project_number` | VARCHAR(50) | Optional project identifier |
| `client_name` | VARCHAR(255) | — |
| `client_email` | VARCHAR(255) | — |
| `client_phone` | VARCHAR(50) | — |
| `address` | TEXT | Full project address |
| `status` | VARCHAR(50) | `'active','on_hold','completed','archived'` |
| `start_date` | DATE | — |
| `target_completion_date` | DATE | — |
| `created_at` / `updated_at` | TIMESTAMPTZ | — |

No `organization_id` — single company, no multi-tenancy.

### 5.2 `estimates`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | — |
| `project_id` | UUID FK → projects | — |
| `name` | VARCHAR(255) | e.g., "Main Estimate" |
| `version_group_id` | UUID | Shared across all versions of the same estimate |
| `version_number` | INTEGER | Incrementing: 1, 2, 3... |
| `version_label` | VARCHAR(255) | User-friendly label: "Initial", "Post-VE", "Final" |
| `is_current` | BOOLEAN | Only one per version_group is TRUE |
| `status` | VARCHAR(50) | `'draft','in_review','approved','sent','accepted','archived'` |
| `default_contingency_rate` | DECIMAL(5,4) | Default for new items (e.g., 0.05) |
| `default_overhead_rate` | DECIMAL(5,4) | Default for new items |
| `column_config` | JSONB | UI column visibility preferences |
| `view_settings` | JSONB | UI display preferences (expand state, etc.) |
| `created_at` / `updated_at` | TIMESTAMPTZ | — |
| `created_by` | UUID FK → auth.users | — |

**Version model:** All versions of the same estimate share a `version_group_id`. When creating a new version, deep-copy the entire tree (all nodes + detail rows) into a new estimate with an incremented `version_number`. The previous version's `is_current` flips to FALSE and becomes immutable (enforced by application logic — edits to non-current versions are rejected).

This means each version is a complete, independently queryable estimate. No temporal reconstruction needed. Trade-off: storage duplication. For 500 nodes × 5 versions = 2,500 rows — trivial for PostgreSQL.

### 5.3 `phases`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | — |
| `project_id` | UUID FK → projects | — |
| `name` | VARCHAR(255) | e.g., "Foundation", "Framing", "Rough-In" |
| `sort_order` | INTEGER | Display ordering |
| `color` | VARCHAR(7) | Hex color for UI grouping (optional) |

Phases are **classificatory, not structural.** Nodes reference a phase via `phase_id` on the base table, but phases don't affect tree hierarchy. A single category can span multiple phases, and a phase can include nodes from multiple categories. This is the correct model for construction (see Open Questions for detailed reasoning).

### 5.4 `units_of_measure`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | — |
| `symbol` | VARCHAR(20) | Canonical symbol: `SF`, `LF`, `EA`, `HR`, etc. UNIQUE |
| `name` | VARCHAR(100) | Full name: "Square Feet", "Linear Feet" |
| `category` | VARCHAR(50) | `'length','area','volume','weight','count','time'` |
| `is_system` | BOOLEAN | TRUE for built-in units, FALSE for custom |

**No self-referential `base_unit_id`.** The old system's unit hierarchy was over-engineered. Conversions are handled by the `unit_conversions` table directly.

**Seed data:** LF, SF, SY, CF, CY, EA, HR, DAY, PR, SET, BOX, BDL, GAL, LB, TON, LS (lump sum).

### 5.5 `unit_conversions`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | — |
| `from_unit_id` | UUID FK → units | — |
| `to_unit_id` | UUID FK → units | — |
| `factor` | DECIMAL(15,8) | Multiply from × factor = to |

UNIQUE on `(from_unit_id, to_unit_id)`. CHECK: `from_unit_id != to_unit_id`.

### 5.6 `project_parameters`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | — |
| `project_id` | UUID FK → projects | — |
| `name` | VARCHAR(100) | Identifier-safe: CHECK `name ~ '^[A-Za-z_][A-Za-z0-9_]*$'` |
| `display_name` | VARCHAR(255) | Human-readable label |
| `value` | DECIMAL(15,4) | The parameter value |
| `unit_id` | UUID FK → units | Optional unit |
| `description` | TEXT | What this parameter represents |

UNIQUE on `(project_id, name)`. These are the named values that formulas reference (e.g., `wall_area`, `roof_pitch`, `total_perimeter`).

---

## 6. Catalog System

### 6.1 Design Principle: Copy-on-Instantiate

This is confirmed correct and non-negotiable. The catalog is a template library. When an item or assembly is pulled into an estimate, ALL values are deep-copied. The estimate owns its data. No live references.

### 6.2 `catalog_items`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | — |
| `name` | VARCHAR(255) | — |
| `description` | TEXT | — |
| `sku` | VARCHAR(100) | Product identifier |
| `category` | VARCHAR(100) | Classification |
| `subcategory` | VARCHAR(100) | Classification |
| `default_unit_id` | UUID FK → units | — |
| `default_unit_cost` | DECIMAL(15,4) | — |
| `default_cost_type` | VARCHAR(20) | material/labor/equipment/subcontractor/other |
| `default_waste_factor` | DECIMAL(5,4) | — |
| `default_contingency_rate` | DECIMAL(5,4) | — |
| `default_overhead_rate` | DECIMAL(5,4) | — |
| `default_min_order_qty` | DECIMAL(15,4) | — |
| `default_package_size` | DECIMAL(15,4) | — |
| `default_package_unit_id` | UUID FK → units | — |
| `instructions` | TEXT | — |
| `specifications` | TEXT | — |
| `manufacturer` | VARCHAR(255) | — |
| `manufacturer_url` | TEXT | — |
| `version` | INTEGER | Incrementing version counter |
| `is_active` | BOOLEAN | Soft-delete flag |
| `tags` | JSONB | Array of string tags for search |
| `created_at` / `updated_at` | TIMESTAMPTZ | — |

**Full-text search index:**
```sql
CREATE INDEX idx_catalog_items_search ON catalog_items
  USING gin(to_tsvector('english', name || ' ' || COALESCE(description, '') || ' ' || COALESCE(sku, '')));
```

### 6.3 `catalog_assemblies`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | — |
| `name` | VARCHAR(255) | — |
| `description` | TEXT | — |
| `output_unit_id` | UUID FK → units | The unit this assembly measures |
| `default_qty` | DECIMAL(15,4) | Default quantity when instantiated |
| `version` | INTEGER | — |
| `is_active` | BOOLEAN | — |
| `tags` | JSONB | — |
| `created_at` / `updated_at` | TIMESTAMPTZ | — |

### 6.4 `catalog_assembly_components`

Junction table — what items/sub-assemblies compose a catalog assembly.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | — |
| `assembly_id` | UUID FK → catalog_assemblies | Parent assembly |
| `catalog_item_id` | UUID FK → catalog_items | Nullable — XOR with nested_assembly_id |
| `nested_assembly_id` | UUID FK → catalog_assemblies | Nullable — XOR with catalog_item_id |
| `sort_order` | INTEGER | — |
| `qty_mode` | VARCHAR(20) | `'numeric','formula','ratio'` |
| `qty_value` | DECIMAL(15,4) | Direct quantity (numeric mode) |
| `qty_formula` | TEXT | Formula (formula mode) |
| `ratio_numerator` | DECIMAL(15,4) | e.g., 1 |
| `ratio_denominator` | DECIMAL(15,4) | e.g., 75 |
| `waste_factor_override` | DECIMAL(5,4) | Override catalog item's default |
| `name_override` | VARCHAR(255) | Override catalog item's name |
| `cost_override` | DECIMAL(15,4) | Override catalog item's cost |

**XOR constraint:**
```sql
CONSTRAINT component_type_xor CHECK (
  (catalog_item_id IS NOT NULL AND nested_assembly_id IS NULL)
  OR (catalog_item_id IS NULL AND nested_assembly_id IS NOT NULL)
)
```

**Self-reference guard:** CHECK `nested_assembly_id != assembly_id`. Note: this prevents direct self-nesting but NOT indirect cycles (A→B→A). Indirect cycle detection requires application-level validation during assembly creation (walk the nesting chain and reject if a cycle forms).

### 6.5 Instantiation Flow

When adding a catalog item to an estimate:
1. Create `estimate_nodes` row (node_type='item', copy name, catalog_source_id, catalog_version)
2. Create `node_item_details` row (copy all defaults from catalog_items)
3. Trigger recalculation

When adding a catalog assembly:
1. Create `estimate_nodes` row (node_type='assembly')
2. Create `node_assembly_details` row (copy output_unit_id, default_qty)
3. For each `catalog_assembly_components` entry:
   - If item: instantiate as child item (recursive step 1-2)
   - If nested assembly: recursively instantiate (step 1-3)
   - Copy ratio/formula/override values to the child's detail row
4. Enforce max nesting depth (advisory limit, default 5)
5. Trigger recalculation

### 6.6 Sync Operations

| Operation | Direction | Behavior |
|-----------|-----------|----------|
| Pull from catalog | Catalog → Node | Update item details from latest catalog version. **Preserve qty.** |
| Push to catalog | Node → Catalog | Update catalog item from estimate node values. Increment catalog version. |
| Check for changes | Read-only | Compare node details with catalog source. Report differences. |
| Unlink | — | Clear `catalog_source_id`, `catalog_version`. Node becomes fully independent. |

---

## 7. Options System

This is the most architecturally complex feature and the primary differentiator. Three layers, each independently useful.

### 7.1 Layer 1: Broad Options (Parameter Overrides)

**Purpose:** Toggle estimate-wide parameter changes that cascade through formulas. Example: "Upgraded Insulation Package" changes the R-value parameter from R-19 to R-38, affecting all insulation quantity formulas.

#### `broad_options`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | — |
| `estimate_id` | UUID FK → estimates | — |
| `name` | VARCHAR(255) | UNIQUE per estimate |
| `description` | TEXT | — |
| `is_active` | BOOLEAN | Currently enabled? |
| `sort_order` | INTEGER | — |
| `created_at` / `updated_at` | TIMESTAMPTZ | — |

#### `broad_option_overrides`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | — |
| `broad_option_id` | UUID FK → broad_options ON DELETE CASCADE | — |
| `parameter_id` | UUID FK → project_parameters | Which parameter to override |
| `override_value` | DECIMAL(15,4) | Replacement value when active |

**Normalized** (not JSONB). This enables FK integrity to `project_parameters` — if a parameter is deleted, the override is cleaned up. The old system stored these as JSONB with no referential integrity.

**Multiple active broad options:** When multiple broad options override the same parameter, the one with the highest `sort_order` wins (deterministic precedence instead of last-writer-wins ambiguity).

### 7.2 Layer 2: Inline Options (Subtree Swapping)

**Purpose:** At any point in the estimate tree, offer alternatives. Can replace a single item, an assembly, or an entire group section. Unlimited alternatives per option point.

#### `option_groups`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | — |
| `estimate_id` | UUID FK → estimates | — |
| `name` | VARCHAR(255) | e.g., "Kitchen Package" |
| `description` | TEXT | — |
| `created_at` / `updated_at` | TIMESTAMPTZ | — |

An option group represents a choice point — "here, there are alternatives."

#### `option_alternatives`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | — |
| `option_group_id` | UUID FK → option_groups ON DELETE CASCADE | — |
| `name` | VARCHAR(255) | e.g., "Standard", "Mid-Range", "Premium" |
| `description` | TEXT | — |
| `is_selected` | BOOLEAN | Exactly one per group must be TRUE |
| `sort_order` | INTEGER | Display ordering |
| `created_at` / `updated_at` | TIMESTAMPTZ | — |

#### How Subtree Swapping Works

1. **User creates an option** for a node (item, assembly, or group). System creates:
   - An `option_group` record
   - An `option_alternative` for the "base" version (is_selected = TRUE)
   - Stamps the existing node (and all its descendants, if it has children) with `option_alternative_id` = base alternative's ID

2. **User creates additional alternatives.** For each:
   - Create a new `option_alternative` record (is_selected = FALSE)
   - Create new `estimate_nodes` (and detail rows) for the alternative's subtree
   - All nodes in the alternative share the same `parent_id` as the base (they occupy the same tree position)
   - All nodes in the alternative's subtree are stamped with the new alternative's ID

3. **User switches selection.** System:
   - Sets `is_selected = FALSE` on the old alternative
   - Sets `is_selected = TRUE` on the new alternative
   - Triggers recalculation of the active tree

4. **Active tree query** (the "what you see" query):
```sql
SELECT * FROM estimate_nodes
WHERE estimate_id = $1
AND (
  option_alternative_id IS NULL                              -- Always visible
  OR option_alternative_id IN (
    SELECT id FROM option_alternatives WHERE is_selected = TRUE
  )
)
ORDER BY parent_id, sort_order;
```

Nodes with `option_alternative_id = NULL` are always part of the active tree. Nodes with a non-NULL value are only visible when their alternative is selected. **All nodes in an alternative's subtree are stamped** — this makes the query simple (a single WHERE clause) at the cost of stamping descendants on creation.

#### Design Decision: No Nested Options (Initially)

An item can only belong to one option group. If an option alternative's subtree itself contained an inner option group, a single node would need to belong to multiple alternatives simultaneously — the `option_alternative_id` column can't hold two values.

**Recommendation:** Disallow nested options in the initial implementation. This keeps the model clean and the query simple. If nested options become necessary, upgrade to a junction table (`node_option_memberships`) that allows many-to-many relationships between nodes and alternatives. This is a forward-compatible upgrade path — it adds a table, not a redesign.

### 7.3 Layer 3: Option Sets (Saved Scenarios)

**Purpose:** Save and recall named combinations of option selections. "Budget Scenario" remembers that Kitchen=Standard, Flooring=Vinyl, Siding=Fiber Cement. Switch between scenarios instantly.

#### `option_sets`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | — |
| `estimate_id` | UUID FK → estimates | — |
| `name` | VARCHAR(255) | "Budget", "Mid-Range", "Premium" |
| `description` | TEXT | — |
| `is_default` | BOOLEAN | One per estimate |
| `sort_order` | INTEGER | — |
| `created_at` / `updated_at` | TIMESTAMPTZ | — |

#### `option_set_selections`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | — |
| `option_set_id` | UUID FK → option_sets ON DELETE CASCADE | — |
| `option_group_id` | UUID FK → option_groups | Which choice point |
| `selected_alternative_id` | UUID FK → option_alternatives | Which alternative is selected in this scenario |

UNIQUE on `(option_set_id, option_group_id)` — one selection per group per set.

**Applying an option set:** Update `option_alternatives.is_selected` for each group according to the set's selections. Then recalculate.

**Comparison view:** For each option set, temporarily apply its selections (in memory, not persisted), calculate the tree total, and present side-by-side comparisons. This is computationally cheap for 200–1,000 node trees.

**Broad option selections in sets:** Add `broad_option_ids` to `option_set_selections` or a separate junction table. Option sets capture BOTH inline and broad option selections for complete scenario recall.

---

## 8. Version Management and Audit Trail

### 8.1 Two-Level Version System

| Level | Mechanism | Purpose | User-Triggered? |
|-------|-----------|---------|-----------------|
| **Explicit Versions** | Deep-copy estimate + full tree | Named milestones: "Initial", "Post-VE", "Final" | Yes |
| **Change History** | History tables with triggers | Every individual edit: who changed what, when, old values | Automatic |

### 8.2 Explicit Versions (Estimate Snapshots)

When the user creates a new version:
1. Deep-copy the `estimates` row with new ID, incremented `version_number`, new `version_label`
2. Deep-copy all `estimate_nodes` rows (update estimate_id, preserve parent_id relationships via ID remapping)
3. Deep-copy all `node_item_details` and `node_assembly_details` rows (update node_ids via the same remapping)
4. Deep-copy all option groups, alternatives, and sets
5. Flip old version's `is_current` to FALSE

Each version is a complete, independent snapshot. Old versions are effectively immutable. This means:
- "What did Version 2 look like?" → Query that version's estimate_id directly
- "Diff between Version 2 and Version 3" → Compare node-by-node (match by `catalog_source_id` or position)
- "Roll back to Version 2" → Create Version 4 as a copy of Version 2

### 8.3 Change History (Automatic Audit Trail)

For each table that needs tracking, create a corresponding `_history` table:

- `estimate_nodes_history`
- `node_item_details_history`
- `node_assembly_details_history`

Each history table has ALL columns from the source table PLUS:

| Column | Type | Purpose |
|--------|------|---------|
| `history_id` | UUID PK | History entry identifier |
| `change_type` | VARCHAR(10) | `'insert'`, `'update'`, `'delete'` |
| `changed_at` | TIMESTAMPTZ | When the change occurred |
| `changed_by` | UUID | Who made the change |

**Trigger-based population:**
```sql
CREATE OR REPLACE FUNCTION track_node_changes()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    INSERT INTO estimate_nodes_history
    SELECT gen_random_uuid(), 'update', NOW(), current_setting('app.current_user_id', true)::uuid,
           OLD.*;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO estimate_nodes_history
    SELECT gen_random_uuid(), 'delete', NOW(), current_setting('app.current_user_id', true)::uuid,
           OLD.*;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

This captures the OLD row values on every UPDATE and DELETE — transparently, without any application code changes. The application sets `app.current_user_id` at the start of each request for attribution.

**Querying history:**
- "What did this node look like yesterday?" → `SELECT * FROM estimate_nodes_history WHERE node_id = $1 AND changed_at <= $2 ORDER BY changed_at DESC LIMIT 1`
- "Who changed the siding quantity?" → `SELECT * FROM estimate_nodes_history WHERE node_id = $1 ORDER BY changed_at DESC`
- "What changed today?" → `SELECT * FROM estimate_nodes_history WHERE changed_at >= CURRENT_DATE`
- "Roll back this specific change" → Copy the history row's values back to the live table

### 8.4 History Table Architecture Decision

**Start history tracking from Phase 1.** Even though the UI for browsing history comes later, the triggers should capture data from day one. History for data that existed before tracking was enabled is lost forever — retroactively adding tracking is painful.

The triggers add negligible overhead (one INSERT per UPDATE/DELETE). Storage grows linearly with edit frequency. For a single user editing ~100 nodes/day, that's ~3,000 history rows/month — trivial.

---

## 9. Calculation Architecture

### 9.1 Recommendation: Isomorphic Hybrid

Write the calculation engine ONCE in TypeScript. Import it in both the client (for instant display feedback) and the server (for validation on save).

| Concern | Client-Side | Server-Side |
|---------|------------|-------------|
| When it runs | On every keystroke/edit | On save/commit |
| Purpose | Instant visual feedback | Source of truth validation |
| What it updates | In-memory tree state | Database rows |
| Latency | Instant | Network round-trip |

**Why not server-only?** The old system required a server round-trip for every edit. Users saw stale values until the server responded. For a tree with 500 nodes, recalculating and updating N ancestors via N database calls was noticeably slow. Client-side calculation eliminates this latency.

**Why not client-only?** Client-side-only risks calculation drift (browser JS differences, floating point quirks, stale client code). The server validates on save to ensure the stored values are correct.

**Why isomorphic?** One TypeScript module means the calculation logic is identical on both sides. No drift by construction.

### 9.2 The Calculation Chain

For leaf items (the atomic level):
```
raw_qty = (depends on qty_mode)
  numeric: direct value
  ratio: (parent_assembly_qty × ratio_numerator) / ratio_denominator
  formula: evaluate(qty_formula, parameters)

qty = applyPurchasingConstraints(raw_qty, waste_factor, package_size, min_order_qty)

subtotal = qty × unit_cost
contingency_amount = subtotal × contingency_rate
overhead_amount = (subtotal + contingency_amount) × overhead_rate   // COMPOUNDS
total_price = subtotal + contingency_amount + overhead_amount
unit_price = total_price / qty   (null if qty = 0)
```

For parent nodes (groups and assemblies):
```
subtotal = SUM(active_children.subtotal)
contingency_amount = SUM(active_children.contingency_amount)
overhead_amount = SUM(active_children.overhead_amount)
total_price = SUM(active_children.total_price)

// Assembly-specific:
derived_unit_cost = total_price / assembly_qty
```

**"Active children"** = children whose `option_alternative_id` is NULL or points to a selected alternative.

### 9.3 Purchasing Constraint Cascade

```typescript
function applyPurchasingConstraints(
  rawQty: number,
  wasteFactor: number,
  packageSize: number | null,
  minOrderQty: number | null
): number {
  let qty = rawQty;

  // 1. Apply waste factor
  if (wasteFactor > 0) {
    qty = qty * (1 + wasteFactor);
  }

  // 2. Round up to package size
  if (packageSize && packageSize > 0) {
    qty = Math.ceil(qty / packageSize) * packageSize;
  }

  // 3. Enforce minimum order
  if (minOrderQty && qty < minOrderQty) {
    qty = minOrderQty;
  }

  return qty;
}
```

Order matters: waste FIRST (you waste material regardless of packaging), package rounding SECOND (you buy whole packages), minimum LAST (you must meet the minimum even after rounding).

### 9.4 Batch Save Strategy

On save, send ALL changed nodes in a single request. The server:
1. Validates all changes
2. Runs the calculation engine on the full tree (from scratch, not incremental)
3. Compares server-calculated values with client-submitted values
4. If they match: bulk UPDATE all changed nodes in a single transaction
5. If they don't match: use server values and return them to the client (self-correcting)

This eliminates the N+1 update problem from the old system. One transaction, one round-trip.

---

## 10. Formula Engine

### 10.1 Recommendation: Library-Based Expression Evaluator

Use a proven JavaScript expression evaluation library rather than building a custom parser. Recommended options:

| Library | Syntax | IF Support | Custom Functions | Size |
|---------|--------|-----------|-----------------|------|
| **expr-eval** | `a * b + c` | Ternary: `condition ? a : b` | Yes | ~15KB |
| **hot-formula-parser** | `=A1 * B2` | `IF(cond, true, false)` | Yes | ~50KB |
| **mathjs** | `a * b + c` | Built-in | Yes | ~200KB |

**Recommendation: `expr-eval`** for the initial implementation. It's lightweight, supports custom variables and functions, handles basic conditionals via ternary operators, and is well-tested. If Excel-like syntax is desired later, consider `hot-formula-parser` as an upgrade.

### 10.2 How Formulas Resolve

When evaluating a formula like `=wall_area * 2.88 * 1.15`:

1. Build the variable context:
   - Project parameters: `{ wall_area: 1200, roof_pitch: 8, total_perimeter: 240 }`
   - Named references: `{ siding_area: <value of node with reference_name='siding_area'> }`
2. Pass the formula string and variable context to the evaluator
3. Return the numeric result

### 10.3 Named Preset Formulas (Future Enhancement)

User-defined formula functions like `STUD_COUNT_16OC(length)` that encapsulate common calculations. These would be registered as custom functions with the expression evaluator:

```typescript
// Future: user creates this preset
// Name: STUD_COUNT_16OC
// Formula: CEIL(length / 1.333) + 1

evaluator.registerFunction('STUD_COUNT_16OC', (length: number) => {
  return Math.ceil(length / 1.333) + 1;
});

// Then used in item formulas:
// qty_formula = "STUD_COUNT_16OC(wall_length)"
```

Architecture supports this by design — the expression evaluator accepts custom function registrations. The UI for creating/managing presets is a later phase, but the engine is ready for it.

### 10.4 Formula Safety

- Formulas are evaluated in a sandboxed context (only allowed variables and functions, no access to DOM/Node APIs)
- Circular references: detect at save time by building a dependency graph from formula references. If a cycle is found, reject the formula.
- Error handling: if a formula fails to evaluate (missing variable, division by zero), return null/0 and flag the node with a validation warning — never crash the calculation engine.

---

## 11. JSONB vs. Normalized Tables

### Where JSONB Is Appropriate

| Data | Why JSONB | Example |
|------|-----------|---------|
| `column_config` | Opaque UI preference, never queried by structure | `{"showCostCode": true, "showVendor": false}` |
| `view_settings` | Opaque UI preference | `{"expandedIds": [...], "sortColumn": "name"}` |
| `tags` | Simple array, rarely queried individually | `["siding", "exterior", "cedar"]` |

### Where JSONB Is NOT Appropriate (Use Normalized Tables)

| Data | Why Normalized | Old System's JSONB Mistake |
|------|---------------|---------------------------|
| `parameter_overrides` | Need FK integrity to parameters | JSONB array with embedded parameter IDs — no referential integrity |
| `inline_selections` | Need FK integrity to alternatives | JSONB map with option IDs — no type checking |
| `attachments` | Need proper file management, querying | JSONB array of metadata objects — no structured queries |
| `links` | Could go either way, but normalized enables better querying | JSONB array |
| `unit_parameters` / `assembly_parameters` | Need type safety and queryability | JSONB objects — opaque to the database |

**The rule:** If you need to JOIN on it, query inside it, or enforce referential integrity on its contents, it should be a normalized table. If it's an opaque blob that the application reads/writes as a whole, JSONB is fine.

---

## 12. Database vs. Application Enforcement

### Database-Level (Constraints, Triggers, CHECK Clauses)

| Rule | Mechanism | Why DB-Level |
|------|-----------|-------------|
| Items are always leaves | Trigger: reject INSERT where parent is an item | Structural invariant — violation corrupts the tree |
| Node type is valid | CHECK constraint | Prevent typos/invalid types |
| Items must have a parent | CHECK constraint | Orphan items are meaningless |
| One selected alternative per option group | Trigger on UPDATE of is_selected | Data integrity — multiple selections = undefined behavior |
| Unique reference names per estimate | UNIQUE constraint | Formula resolution depends on unique names |
| Sort order is integer | Column type | Prevent fractional drift |
| Cascade deletes | FK ON DELETE CASCADE | Subtree deletion must be atomic |
| History tracking | Triggers on UPDATE/DELETE | Must capture EVERY change, can't rely on app to remember |
| updated_at timestamps | Trigger | Must fire on EVERY update, not just ones the app remembers |

### Application-Level (Server-Side Validation)

| Rule | Why App-Level |
|------|--------------|
| Valid parent-child type combinations (groups can contain groups/assemblies/items, assemblies can contain assemblies/items, items can't contain anything) | Complex multi-column logic that's clearer in TypeScript. Also enforced by the items-are-leaves DB trigger as a safety net. |
| Circular reference prevention in nested assemblies | Requires graph traversal — not expressible in simple constraints |
| Formula syntax validation | Requires parsing — the DB can't validate expression syntax |
| Estimate version immutability (non-current versions can't be edited) | Business rule that may have exceptions (admin override) |
| Option set consistency (all groups have a selection) | Validation that crosses multiple tables |
| Purchasing constraint logic (waste → package → minimum order) | Complex sequential calculation |

### The Principle

If violating the rule would corrupt data structure (orphans, broken trees, lost references), enforce it in the database. If violating the rule would produce incorrect RESULTS but not structural corruption, enforce it in the application.

---

## 13. Vendor System (High-Level Architecture)

Vendor management is a major feature but architecturally independent from the core estimating engine. This section provides the high-level table design. Detailed design happens during the vendor implementation phase.

### Core Tables

#### `vendors`
| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | — |
| `company_name` | VARCHAR(255) | — |
| `trade_type` | VARCHAR(100) | e.g., "Electrical", "Plumbing", "Lumber Supply" |
| `status` | VARCHAR(50) | `'active','inactive','preferred','blacklisted'` |
| `rating` | INTEGER | 1-5 star rating |
| `notes` | TEXT | — |
| `website` | TEXT | — |
| `created_at` / `updated_at` | TIMESTAMPTZ | — |

#### `vendor_contacts`
| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | — |
| `vendor_id` | UUID FK → vendors | — |
| `name` | VARCHAR(255) | — |
| `role` | VARCHAR(100) | e.g., "Sales Rep", "Project Manager" |
| `email` | VARCHAR(255) | — |
| `phone` | VARCHAR(50) | — |
| `is_primary` | BOOLEAN | Primary contact flag |

#### `vendor_documents`
| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | — |
| `vendor_id` | UUID FK → vendors | — |
| `document_type` | VARCHAR(50) | `'coi','contract','license','w9','other'` |
| `name` | VARCHAR(255) | — |
| `file_path` | TEXT | Supabase Storage path |
| `expiration_date` | DATE | For COIs and licenses |
| `uploaded_at` | TIMESTAMPTZ | — |

#### `vendor_catalog_items` (Vendor-Item Association)
| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | — |
| `vendor_id` | UUID FK → vendors | — |
| `catalog_item_id` | UUID FK → catalog_items | — |
| `vendor_price` | DECIMAL(15,4) | This vendor's price for this item |
| `vendor_sku` | VARCHAR(100) | Vendor's product code |
| `lead_time_days` | INTEGER | Delivery lead time |
| `is_preferred` | BOOLEAN | Preferred vendor for this item |
| `last_quoted` | DATE | When this price was last confirmed |

### Integration Points

- **Catalog items** reference vendors via `vendor_catalog_items` (many-to-many with pricing)
- **Estimate items** reference a single selected vendor via `node_item_details.vendor_id`
- **Vendor comparison** queries `vendor_catalog_items` to show all vendors for a catalog item with their pricing
- **Purchase orders, RFPs** generated from estimate items grouped by vendor (future feature, built on this foundation)

---

## 14. Node Attachments

For managing files attached to estimate nodes (bid documents, specifications, photos):

#### `node_attachments`
| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | — |
| `node_id` | UUID FK → estimate_nodes ON DELETE CASCADE | — |
| `file_name` | VARCHAR(255) | Original file name |
| `file_path` | TEXT | Supabase Storage path |
| `file_size` | INTEGER | Bytes |
| `file_type` | VARCHAR(100) | MIME type |
| `attachment_type` | VARCHAR(50) | `'bid_document','specification','photo','other'` |
| `uploaded_at` | TIMESTAMPTZ | — |
| `uploaded_by` | UUID FK → auth.users | — |

This replaces the old system's JSONB `links`, `attachments`, and `bid_file` columns with a proper normalized table.

---

## 15. Complete Table Summary

| # | Table | Rows (typical) | Purpose |
|---|-------|---------------|---------|
| 1 | `projects` | 5-20 | Project containers |
| 2 | `estimates` | 2-5 per project | Versioned estimates |
| 3 | `estimate_nodes` | 200-1000 per estimate | Tree structure (all node types) |
| 4 | `node_item_details` | ~60% of nodes | Item-specific data |
| 5 | `node_assembly_details` | ~10% of nodes | Assembly-specific data |
| 6 | `estimate_nodes_history` | Grows over time | Audit trail |
| 7 | `node_item_details_history` | Grows over time | Audit trail |
| 8 | `node_assembly_details_history` | Grows over time | Audit trail |
| 9 | `phases` | 5-10 per project | Classification tags |
| 10 | `units_of_measure` | ~20 (mostly seed data) | Standardized units |
| 11 | `unit_conversions` | ~30 | Conversion factors |
| 12 | `project_parameters` | 10-30 per project | Named values for formulas |
| 13 | `catalog_items` | 100-500 (growing) | Reusable item templates |
| 14 | `catalog_assemblies` | 20-100 | Reusable assembly templates |
| 15 | `catalog_assembly_components` | ~5 per assembly | Assembly composition |
| 16 | `option_groups` | 5-30 per estimate | Choice points |
| 17 | `option_alternatives` | 2-5 per group | Alternatives per choice |
| 18 | `option_sets` | 2-5 per estimate | Saved scenarios |
| 19 | `option_set_selections` | groups × sets | Scenario selections |
| 20 | `broad_options` | 1-10 per estimate | Parameter override toggles |
| 21 | `broad_option_overrides` | 1-5 per broad option | What each toggle overrides |
| 22 | `vendors` | 20-100 | Vendor records |
| 23 | `vendor_contacts` | 1-3 per vendor | Contact info |
| 24 | `vendor_documents` | 2-5 per vendor | COIs, contracts, etc. |
| 25 | `vendor_catalog_items` | Many-to-many | Vendor pricing per item |
| 26 | `node_attachments` | Variable | Files attached to nodes |

**Total: 26 tables** (vs. 14 in the old system). More tables, but each table is focused, normalized, and clear about what it contains. No 46-column monoliths. No JSONB for things that need referential integrity.
