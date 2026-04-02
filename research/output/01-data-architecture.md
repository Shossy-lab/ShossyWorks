# Data Architecture Recommendation (v2)

> **Date:** 2026-04-02 (revised)
> **Scope:** Complete data architecture for the ShossyWorks construction estimating platform.
> **Audience:** Future Claude Code implementation sessions and Zac (for review).
> **Important:** This document recommends an architecture from first principles. It is NOT derived from previous attempts. Where old patterns happen to match, it's because independent analysis reached the same conclusion.

---

### Revision Notes (v1 -> v2)

This revision incorporates findings from four independent reviews: data model critique, calculation engine critique, options system critique, and industry research. The following material changes were made:

1. **Tree model:** Added `ltree` path column from day one (trigger-maintained alongside `parent_id`) instead of deferring materialized path.
2. **Formula library:** Replaced `expr-eval` with `math.js` as the recommended expression evaluator (CVE-2025-12735 on expr-eval, abandoned maintenance).
3. **Options system -- junction table:** Replaced `option_alternative_id` column on `estimate_nodes` with `node_option_memberships` junction table, enabling future nested options without schema migration.
4. **Options system -- anchor node:** Added `anchor_node_id` to `option_groups` for explicit tree attachment.
5. **Options system -- selection constraint:** Added partial unique index enforcing "exactly one selected" per option group.
6. **Options system -- broad selections:** Added `option_set_broad_selections` junction table for broad options in option sets.
7. **Decimal precision:** Changed calculated total columns from `DECIMAL(15,2)` to `DECIMAL(15,4)`. Only round to 2dp at display time.
8. **Allowance tracking:** Added `allowance_budget` and `allowance_status` to `node_item_details`.
9. **Structured cost codes:** Replaced `cost_code VARCHAR(50)` with FK to a `cost_codes` table based on CSI MasterFormat.
10. **Proposals table:** Added `proposals` table for structured client-facing documents.
11. **RLS policies:** Added Row-Level Security recommendations for all tables.
12. **Node type change trigger:** Added UPDATE trigger preventing change to 'item' if node has children.
13. **Base table tradeoff acknowledged:** Documented that some base table columns are not relevant to all node types (pragmatic tradeoff, not a design flaw).
14. **Unit seed data expanded:** Added SQ, MBF, MSF, BAG, ROLL, SHEET, TUBE, PAIL.

---

## 1. Design Principles

These principles guide every decision in this document:

1. **Bottom-up stability.** Each layer must be provably correct before anything is built on top of it. The tree must work before calculations. Calculations before catalog. Catalog before options.

2. **The database enforces invariants.** If a rule must NEVER be violated (items are always leaves, calculations always compound correctly, options never orphan), encode it in constraints, triggers, or CHECK clauses -- not just application code. Application code has bugs. Database constraints don't.

3. **Single-user simplicity.** No multi-tenancy, no complex role hierarchy. One company, one builder, with a filtered client view. Every architectural decision should be evaluated against "does a single-user tool need this?"

4. **Estimates own their data.** Copy-on-instantiate from catalog. No live references that could silently change approved estimates. The catalog is a template library; estimates are independent documents.

5. **Calculations are deterministic and isomorphic.** The same calculation logic runs client-side (for instant feedback) and server-side (for validation on save). One TypeScript module, imported by both. No drift possible.

6. **Schema clarity over storage optimization.** Every column on a table should be relevant to every row in that table where possible. No 36-column NULL density like the old monolithic table. If a column only applies to items, it goes on the items table. Where pragmatic exceptions exist (see Section 3), they are documented and justified.

---

## 2. Tree Model: Adjacency List + ltree Path

### Recommendation

Use a **self-referencing `parent_id` foreign key** (adjacency list) as the primary tree model, with a **trigger-maintained `ltree` path column** for server-side subtree queries. This dual-column approach gives O(1) re-parenting via `parent_id` AND instant GiST-indexed subtree queries via `ltree`, with no application-level path management.

### Why This Over Alternatives

| Model | Read Performance | Write Performance | Move/Re-parent | Complexity | Verdict |
|-------|-----------------|-------------------|-----------------|------------|---------|
| **Adjacency List + ltree** | O(1) subtree via ltree GiST index; recursive CTE also available | O(1) parent_id update + trigger updates descendant paths | O(1) for parent_id; trigger handles O(k) path updates | Moderate | **Recommended** |
| Adjacency List (alone) | Requires recursive CTE for subtree queries | O(1) -- update one row | O(1) -- update parent_id | Simple | Insufficient for server-side subtree queries |
| Closure Table | O(1) subtree via JOIN | O(d) -- insert rows for each ancestor | O(d squared) -- delete + re-insert closures | High | Overkill for this scale |
| Nested Sets | O(1) subtree via range query | O(n) -- renumber half the tree on insert | O(n) -- renumber on every move | High | **Rejected** -- too expensive for frequent edits |

### Why Adjacency List Is Sufficient as the Primary Model

The primary access pattern is: **load the entire estimate tree in one query, build it in memory, work with it client-side.** We never need to query "just the subtree under node X" from the database in normal operation -- we always load everything and filter in TypeScript.

For a tree of 200-1,000 nodes, a single `SELECT * FROM estimate_nodes WHERE estimate_id = $1 ORDER BY sort_order` returns the entire tree. The `buildTree()` algorithm assembles it in memory in O(n log n) time. This is fast enough that no indexing tricks are needed.

### Why the ltree Column from Day One

PostgreSQL's `ltree` extension is purpose-built for hierarchical data. It provides GiST-indexable path operations (`<@`, `@>`, `~`, `?`), ancestor/descendant queries without recursive CTEs, and built-in depth/level functions (`subpath()`, `nlevel()`, `lca()`). For server-side operations like "stamp all descendants of this node with an option alternative ID," ltree queries are trivial and efficient.

The path column is maintained by a trigger that fires on INSERT/UPDATE of `parent_id`. Application code never manages paths manually. The trigger rebuilds the path for the affected node and all its descendants in a single recursive UPDATE.

```sql
-- Enable the extension
CREATE EXTENSION IF NOT EXISTS ltree;

-- Trigger function to maintain path column
CREATE OR REPLACE FUNCTION maintain_node_path()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.path = NEW.id::text::ltree;
  ELSE
    SELECT path || NEW.id::text INTO NEW.path
    FROM estimate_nodes WHERE id = NEW.parent_id;
  END IF;

  -- Update all descendants if parent changed
  IF TG_OP = 'UPDATE' AND OLD.parent_id IS DISTINCT FROM NEW.parent_id THEN
    WITH RECURSIVE descendants AS (
      SELECT id, parent_id FROM estimate_nodes WHERE parent_id = NEW.id
      UNION ALL
      SELECT en.id, en.parent_id FROM estimate_nodes en
      JOIN descendants d ON en.parent_id = d.id
    )
    UPDATE estimate_nodes SET path = NEW.path || subpath(path, nlevel(OLD.path))
    WHERE id IN (SELECT id FROM descendants);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

**Cost:** One trigger, one column, one GiST index. **Benefit:** Server-side subtree queries without recursive CTEs, forever. For a 200-1,000 node tree, the O(k) path update on subtree moves (where k is the subtree size) is fast -- a 100-node subtree update is ~100 UPDATEs in a single transaction.

### Sibling Ordering

Use an `INTEGER sort_order` column for ordering siblings within a parent. Operations:

- **Insert:** New node gets `MAX(sort_order) + 1` among siblings.
- **Move up/down:** Swap sort_order with adjacent sibling.
- **Re-parent:** Node gets `MAX(sort_order) + 1` in new parent's children.
- **Reorder (drag-and-drop):** Renumber all siblings sequentially (1, 2, 3...) after the operation. This avoids fractional sort_order drift (a problem in the old system's midpoint calculation).

**Concurrency note:** For a single-user app, sort_order conflicts are unlikely but possible (two browser tabs). Optimistic locking via a `version` column on `estimate_nodes` or gap-tolerant sort values (100, 200, 300) can mitigate this if needed.

---

## 3. Node Type Architecture: Hybrid Base + Detail Tables

### Recommendation

Use a **shared base table** (`estimate_nodes`) for all tree-structural and universally-applicable columns, with **type-specific detail tables** (`node_item_details`, `node_assembly_details`) joined 1:1 for type-specific data.

### The Three Node Types

| Type | Purpose | Has Detail Table? | Can Be Root? | Can Have Children? |
|------|---------|-------------------|-------------|-------------------|
| `group` | Organizational container (replaces old category + section) | No -- base table is sufficient | Yes | Yes (groups, assemblies) |
| `assembly` | Reusable component with own quantity, children calculate relative to it | Yes (`node_assembly_details`) | No | Yes (assemblies, items) |
| `item` | Atomic cost entry -- always a leaf | Yes (`node_item_details`) | No | **No -- always a leaf** |

### Valid Parent-Child Relationships

```
group
  +-- group        (nesting groups for deep organization)
  +-- assembly
  |     +-- assembly  (recursive nesting)
  |     +-- item      (leaf)
  +-- item            (leaf, direct under group without assembly)
```

**Enforced in the database** via triggers on INSERT and UPDATE that validate:
- `item` nodes cannot have children (reject INSERT where parent is an item)
- Changing `node_type` to `'item'` is rejected if the node has any children (UPDATE trigger)
- `assembly` nodes cannot be root (parent_id must not be NULL)
- `group` nodes can be root or nested

```sql
-- Trigger: prevent node_type change to 'item' if node has children
CREATE OR REPLACE FUNCTION prevent_item_with_children()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.node_type = 'item' AND (OLD.node_type IS NULL OR OLD.node_type != 'item') THEN
    IF EXISTS (SELECT 1 FROM estimate_nodes WHERE parent_id = NEW.id LIMIT 1) THEN
      RAISE EXCEPTION 'Cannot change node type to item: node has children';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### Why Hybrid Over Alternatives

**Why not monolithic?**

| Concern | Monolithic (old approach) | Hybrid (recommended) |
|---------|--------------------------|----------------------|
| NULL density | ~36 of 46 columns NULL on non-leaf nodes | Minimal irrelevant NULLs -- each detail table has only relevant columns |
| Schema clarity | Must know externally which columns apply per type | Table name tells you what columns exist |
| Tree operations | Update one row regardless of type | Update base table only -- detail tables untouched for move/reorder |
| Query complexity | Single SELECT | JOIN for full item data -- but base table alone is sufficient for tree structure |

**Why not PostgreSQL table inheritance (INHERITS)?** PostgreSQL has a native feature for this pattern (`CREATE TABLE node_item_details () INHERITS (estimate_nodes)`), but it has critical limitations: UNIQUE constraints and FOREIGN KEYS do not propagate to child tables, PostgREST (Supabase) has documented issues with inheritance hierarchies, and INSERTs don't auto-route to child tables. The hybrid approach (base table + JOINed detail tables) is strictly better for this use case.

**Why not full table-per-type?** Separate `groups`, `assemblies`, `items` tables with no shared base table would require UNION queries for tree traversal. Every tree operation would need to check all three tables. Far more complex than a single base table.

### Acknowledged Tradeoff: Base Table Column Applicability

The base table has columns like `phase_id`, `cost_code_id`, `client_visibility`, and `reference_name` that are operationally meaningful primarily for items and sometimes assemblies. Groups typically don't have cost codes or reference names. The design principle says "every column should be relevant to every row" -- this is a pragmatic violation.

**Why it stays this way:** Moving these to detail tables would require JOINs for every tree-rendering query that needs to display cost codes or visibility icons. The base table alone must be sufficient for rendering the tree UI. The cost of a few nullable columns on group rows is far less than the cost of mandatory JOINs on every tree load.

---

## 4. Core Schema

### 4.1 `estimate_nodes` -- The Base Table

Every node in the estimate tree, regardless of type.

| Column | Type | Nullable | Default | Purpose |
|--------|------|----------|---------|---------|
| `id` | UUID | NO | `gen_random_uuid()` | Primary key |
| `estimate_id` | UUID | NO | -- | FK -> `estimates`. ON DELETE CASCADE |
| `parent_id` | UUID | YES | -- | FK -> `estimate_nodes(id)`. NULL = root node. ON DELETE CASCADE |
| `path` | LTREE | YES | -- | Trigger-maintained materialized path. GiST-indexed. |
| `sort_order` | INTEGER | NO | `0` | Sibling ordering |
| `node_type` | VARCHAR(20) | NO | -- | CHECK: `('group','assembly','item')` |
| `name` | VARCHAR(255) | NO | -- | Display name |
| `description` | TEXT | YES | -- | Extended description (all types) |
| `notes` | TEXT | YES | -- | Internal notes (builder-only) |
| `client_notes` | TEXT | YES | -- | Client-visible notes |
| `phase_id` | UUID | YES | -- | FK -> `phases`. Classification, not structural |
| `cost_code_id` | UUID | YES | -- | FK -> `cost_codes(id)`. Structured cost code reference |
| `client_visibility` | VARCHAR(20) | NO | `'visible'` | CHECK: `('visible','hidden','summary_only')` |
| `subtotal` | DECIMAL(15,4) | YES | `0` | Calculated: items=qty*cost, parents=SUM(children). 4dp for intermediate precision. |
| `contingency_amount` | DECIMAL(15,4) | YES | `0` | Calculated. 4dp for intermediate precision. |
| `overhead_amount` | DECIMAL(15,4) | YES | `0` | Calculated. 4dp for intermediate precision. |
| `total_price` | DECIMAL(15,4) | YES | `0` | subtotal + contingency + overhead. 4dp; round to 2dp at display only. |
| `catalog_source_id` | UUID | YES | -- | Soft reference to catalog item/assembly |
| `catalog_source_type` | VARCHAR(20) | YES | -- | CHECK: `('item','assembly')` |
| `catalog_version` | INTEGER | YES | -- | Version at time of instantiation |
| `reference_name` | VARCHAR(100) | YES | -- | If set, this node's value can be referenced in formulas. UNIQUE per estimate. |
| `created_at` | TIMESTAMPTZ | NO | `NOW()` | -- |
| `updated_at` | TIMESTAMPTZ | NO | `NOW()` | Auto-updated via trigger |
| `created_by` | UUID | YES | -- | FK -> `auth.users(id)` |

**Key design decisions:**
- **Calculated cost fields on all nodes at DECIMAL(15,4).** Carry at least 4 decimal places through ALL intermediate calculations to prevent cumulative rounding error across hundreds of items. Only round to 2dp for display. Per GAAP best practice, intermediate precision prevents compounding rounding errors that could reach multiple cents on large estimates.
- **`path` column is ltree, trigger-maintained.** Application code updates `parent_id`; the trigger maintains `path` automatically. Server-side subtree queries use the ltree GiST index. Client-side code ignores this column entirely.
- **`cost_code_id` references a structured `cost_codes` table** instead of free-text VARCHAR. Prevents inconsistency ("06 10 00" vs "061000" vs "Rough Carpentry") and enables reliable reporting by division.
- **`reference_name` replaces `is_active_reference` + `reference_name` combo.** NULL means "not a reference" -- no separate boolean needed. UNIQUE constraint per estimate prevents name collisions.
- **`catalog_source_id` is a soft reference** (no FK). Deleting a catalog entry never breaks estimates.
- **No `option_alternative_id` column.** Option membership is handled by the `node_option_memberships` junction table (see Section 7.2). This supports future nested options without schema migration.
- **No `row_number` column.** Row numbering (1, 1.1, 1.1.2) is derived from tree position at render time.

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
CREATE INDEX idx_nodes_phase ON estimate_nodes(phase_id) WHERE phase_id IS NOT NULL;
CREATE INDEX idx_nodes_reference ON estimate_nodes(estimate_id, reference_name) WHERE reference_name IS NOT NULL;
CREATE INDEX idx_nodes_path ON estimate_nodes USING gist(path);
CREATE INDEX idx_nodes_cost_code ON estimate_nodes(cost_code_id) WHERE cost_code_id IS NOT NULL;
```

### 4.2 `node_item_details` -- Item-Specific Data

One row per item node. PK = FK to `estimate_nodes.id`.

| Column | Type | Nullable | Default | Purpose |
|--------|------|----------|---------|---------|
| `node_id` | UUID | NO | -- | PK, FK -> `estimate_nodes(id)` ON DELETE CASCADE |
| `qty` | DECIMAL(15,4) | YES | `0` | Final calculated quantity (after waste, rounding) |
| `raw_qty` | DECIMAL(15,4) | YES | `0` | Pre-constraint quantity (before waste/rounding) |
| `qty_mode` | VARCHAR(20) | NO | `'numeric'` | CHECK: `('numeric','formula','ratio')` |
| `qty_formula` | TEXT | YES | -- | Formula string (when qty_mode = 'formula') |
| `ratio_numerator` | DECIMAL(15,4) | YES | -- | e.g., 1 (1 box per 75 SF) |
| `ratio_denominator` | DECIMAL(15,4) | YES | -- | e.g., 75. CHECK: cannot be zero. |
| `unit_id` | UUID | YES | -- | FK -> `units_of_measure(id)` |
| `unit_cost` | DECIMAL(15,4) | YES | `0` | Cost per unit (builder's cost) |
| `cost_formula` | TEXT | YES | -- | Optional formula for cost |
| `cost_type` | VARCHAR(20) | YES | -- | CHECK: `('material','labor','equipment','subcontractor','other')` |
| `contingency_rate` | DECIMAL(5,4) | NO | `0` | e.g., 0.0500 = 5% |
| `overhead_rate` | DECIMAL(5,4) | NO | `0` | e.g., 0.1000 = 10% |
| `unit_price` | DECIMAL(15,4) | YES | -- | total_price / qty (client-facing). 4dp storage, 2dp display. |
| `waste_factor` | DECIMAL(5,4) | NO | `0` | e.g., 0.1500 = 15% waste |
| `min_order_qty` | DECIMAL(15,4) | YES | -- | Can't buy less than this |
| `package_size` | DECIMAL(15,4) | YES | -- | Rounds up to multiples of this |
| `package_unit_id` | UUID | YES | -- | FK -> `units_of_measure(id)` |
| `bid_type` | VARCHAR(20) | YES | `'estimate'` | CHECK: `('bid','allowance','estimate')` |
| `allowance_budget` | DECIMAL(15,4) | YES | -- | Original budgeted amount for allowance items |
| `allowance_status` | VARCHAR(20) | YES | -- | CHECK: `('pending_selection','selected','finalized')`. NULL if bid_type != 'allowance'. |
| `vendor_id` | UUID | YES | -- | FK -> `vendors(id)` |
| `instructions` | TEXT | YES | -- | Installation/usage instructions |
| `specifications` | TEXT | YES | -- | Material specifications |

**Additional constraint:**
```sql
CONSTRAINT ratio_denominator_not_zero CHECK (ratio_denominator IS NULL OR ratio_denominator != 0)
```

**Why `raw_qty` and `qty` are separate:** The purchasing constraint cascade is: `raw_qty` (from formula/ratio/direct entry) -> apply waste factor -> round to package size -> enforce minimum -> `qty` (final). Storing both lets the user see "you need 3,456 LF of siding, which rounds up to 3,460 LF due to 10-foot lengths." The intermediate calculation is visible, not hidden.

**Note on ratios:** `ratio_numerator` and `ratio_denominator` express the natural relationship (e.g., 1 box per 75 SF). The system calculates: `raw_qty = (assembly_qty * ratio_numerator) / ratio_denominator`. The ratio is ALWAYS expressed as: `ratio_numerator` [item units] per `ratio_denominator` [parent assembly units]. The item's `unit_id` gives the numerator unit; the parent assembly's `assembly_unit_id` gives the denominator unit. This contract must be validated at save time.

**Note on allowances:** When `bid_type = 'allowance'`, the `allowance_budget` records the original budgeted amount for the allowance item. The overage/underage is simply `total_price - allowance_budget`. A view or computed field can aggregate all allowance variances across the estimate. The `allowance_status` tracks whether the client has made their selection. This is a fundamental concept in residential construction -- a typical custom home has 20-40 allowance items.

### 4.3 `node_assembly_details` -- Assembly-Specific Data

One row per assembly node. PK = FK to `estimate_nodes.id`.

| Column | Type | Nullable | Default | Purpose |
|--------|------|----------|---------|---------|
| `node_id` | UUID | NO | -- | PK, FK -> `estimate_nodes(id)` ON DELETE CASCADE |
| `assembly_unit_id` | UUID | YES | -- | FK -> `units_of_measure(id)`. The unit this assembly measures (e.g., SF) |
| `assembly_qty` | DECIMAL(15,4) | YES | `0` | How much of this assembly (e.g., 1200 SF of wall) |
| `derived_unit_cost` | DECIMAL(15,4) | YES | -- | total_price / assembly_qty. Display-only, auto-calculated. Guard against division by zero. |
| `qty_formula` | TEXT | YES | -- | Optional formula for assembly quantity |

Assemblies are lean. Their cost fields (subtotal, contingency, overhead, total) live on the base table and are SUM aggregations of children. The assembly-specific data is just the quantity and unit that child items calculate relative to.

---

## 5. Supporting Tables

### 5.1 `projects`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | -- |
| `name` | VARCHAR(255) | Project name |
| `project_number` | VARCHAR(50) | Optional project identifier |
| `client_name` | VARCHAR(255) | -- |
| `client_email` | VARCHAR(255) | -- |
| `client_phone` | VARCHAR(50) | -- |
| `address` | TEXT | Full project address |
| `status` | VARCHAR(50) | `'active','on_hold','completed','archived'` |
| `start_date` | DATE | -- |
| `target_completion_date` | DATE | -- |
| `created_at` / `updated_at` | TIMESTAMPTZ | -- |

No `organization_id` -- single company, no multi-tenancy.

### 5.2 `estimates`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | -- |
| `project_id` | UUID FK -> projects | -- |
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
| `created_at` / `updated_at` | TIMESTAMPTZ | -- |
| `created_by` | UUID FK -> auth.users | -- |

**Version model:** All versions of the same estimate share a `version_group_id`. When creating a new version, deep-copy the entire tree (all nodes + detail rows) into a new estimate with an incremented `version_number`. The previous version's `is_current` flips to FALSE and becomes immutable (enforced by application logic -- edits to non-current versions are rejected).

This means each version is a complete, independently queryable estimate. No temporal reconstruction needed. Trade-off: storage duplication. For 500 nodes x 5 versions = 2,500 rows -- trivial for PostgreSQL.

### 5.3 `phases`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | -- |
| `project_id` | UUID FK -> projects | -- |
| `name` | VARCHAR(255) | e.g., "Foundation", "Framing", "Rough-In" |
| `sort_order` | INTEGER | Display ordering |
| `color` | VARCHAR(7) | Hex color for UI grouping (optional) |

Phases are **classificatory, not structural.** Nodes reference a phase via `phase_id` on the base table, but phases don't affect tree hierarchy. A single category can span multiple phases, and a phase can include nodes from multiple categories. This is the correct model for construction -- validated by industry practice (Sage Estimating's WBS codes use the same pattern).

### 5.4 `cost_codes`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | -- |
| `code` | VARCHAR(20) | e.g., "06 10 00". UNIQUE. |
| `division` | VARCHAR(2) | e.g., "06" |
| `title` | VARCHAR(255) | e.g., "Rough Carpentry" |
| `parent_code_id` | UUID FK -> cost_codes(id) | Self-referencing for hierarchy |
| `is_system` | BOOLEAN | TRUE for MasterFormat seeds, FALSE for custom codes |
| `created_at` / `updated_at` | TIMESTAMPTZ | -- |

Replaces the old free-text `cost_code VARCHAR(50)`. Structured cost codes prevent inconsistency, enable grouping/reporting by division, and allow custom codes alongside MasterFormat standards.

**Seed data:** Focus on the ~15-20 CSI MasterFormat divisions relevant to residential construction (01 General Requirements, 03 Concrete, 04 Masonry, 05 Metals, 06 Wood/Plastics/Composites, 07 Thermal/Moisture Protection, 08 Openings, 09 Finishes, 10 Specialties, 22 Plumbing, 23 HVAC, 26 Electrical, 31 Earthwork, 32 Exterior Improvements). The full 50-division commercial specification is unnecessary.

### 5.5 `units_of_measure`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | -- |
| `symbol` | VARCHAR(20) | Canonical symbol: `SF`, `LF`, `EA`, `HR`, etc. UNIQUE |
| `name` | VARCHAR(100) | Full name: "Square Feet", "Linear Feet" |
| `category` | VARCHAR(50) | `'length','area','volume','weight','count','time','package'` |
| `is_system` | BOOLEAN | TRUE for built-in units, FALSE for custom |

**No self-referential `base_unit_id`.** The old system's unit hierarchy was over-engineered. Conversions are handled by the `unit_conversions` table directly.

**Seed data:** LF, SF, SY, CF, CY, EA, HR, DAY, PR, SET, BOX, BDL, GAL, LB, TON, LS (lump sum), SQ (square = 100 SF, standard roofing unit), MBF (thousand board feet), MSF (thousand square feet), BAG, ROLL, SHEET, TUBE, PAIL.

### 5.6 `unit_conversions`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | -- |
| `from_unit_id` | UUID FK -> units | -- |
| `to_unit_id` | UUID FK -> units | -- |
| `factor` | DECIMAL(15,8) | Multiply from * factor = to |

UNIQUE on `(from_unit_id, to_unit_id)`. CHECK: `from_unit_id != to_unit_id`.

### 5.7 `project_parameters`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | -- |
| `project_id` | UUID FK -> projects | -- |
| `name` | VARCHAR(100) | Identifier-safe: CHECK `name ~ '^[A-Za-z_][A-Za-z0-9_]*$'` |
| `display_name` | VARCHAR(255) | Human-readable label |
| `value` | DECIMAL(15,4) | The parameter value |
| `unit_id` | UUID FK -> units | Optional unit |
| `description` | TEXT | What this parameter represents |

UNIQUE on `(project_id, name)`. These are the named values that formulas reference (e.g., `wall_area`, `roof_pitch`, `total_perimeter`).

---

## 6. Catalog System

### 6.1 Design Principle: Copy-on-Instantiate

This is confirmed correct and non-negotiable. The catalog is a template library. When an item or assembly is pulled into an estimate, ALL values are deep-copied. The estimate owns its data. No live references.

### 6.2 `catalog_items`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | -- |
| `name` | VARCHAR(255) | -- |
| `description` | TEXT | -- |
| `sku` | VARCHAR(100) | Product identifier |
| `category` | VARCHAR(100) | Classification |
| `subcategory` | VARCHAR(100) | Classification |
| `default_unit_id` | UUID FK -> units | -- |
| `default_unit_cost` | DECIMAL(15,4) | -- |
| `default_cost_type` | VARCHAR(20) | material/labor/equipment/subcontractor/other |
| `default_waste_factor` | DECIMAL(5,4) | -- |
| `default_contingency_rate` | DECIMAL(5,4) | -- |
| `default_overhead_rate` | DECIMAL(5,4) | -- |
| `default_min_order_qty` | DECIMAL(15,4) | -- |
| `default_package_size` | DECIMAL(15,4) | -- |
| `default_package_unit_id` | UUID FK -> units | -- |
| `instructions` | TEXT | -- |
| `specifications` | TEXT | -- |
| `manufacturer` | VARCHAR(255) | -- |
| `manufacturer_url` | TEXT | -- |
| `version` | INTEGER | Incrementing version counter |
| `is_active` | BOOLEAN | Soft-delete flag |
| `tags` | JSONB | Array of string tags for search. GIN-indexed. Acceptable as JSONB for now; if tags grow into a complex taxonomy, migrate to a junction table. |
| `created_at` / `updated_at` | TIMESTAMPTZ | -- |

**Full-text search index:**
```sql
CREATE INDEX idx_catalog_items_search ON catalog_items
  USING gin(to_tsvector('english', name || ' ' || COALESCE(description, '') || ' ' || COALESCE(sku, '')));
```

### 6.3 `catalog_assemblies`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | -- |
| `name` | VARCHAR(255) | -- |
| `description` | TEXT | -- |
| `output_unit_id` | UUID FK -> units | The unit this assembly measures |
| `default_qty` | DECIMAL(15,4) | Default quantity when instantiated |
| `version` | INTEGER | -- |
| `is_active` | BOOLEAN | -- |
| `tags` | JSONB | -- |
| `created_at` / `updated_at` | TIMESTAMPTZ | -- |

### 6.4 `catalog_assembly_components`

Junction table -- what items/sub-assemblies compose a catalog assembly.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | -- |
| `assembly_id` | UUID FK -> catalog_assemblies | Parent assembly |
| `catalog_item_id` | UUID FK -> catalog_items | Nullable -- XOR with nested_assembly_id |
| `nested_assembly_id` | UUID FK -> catalog_assemblies | Nullable -- XOR with catalog_item_id |
| `sort_order` | INTEGER | -- |
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

**Self-reference guard:** CHECK `nested_assembly_id != assembly_id`. Note: this prevents direct self-nesting but NOT indirect cycles (A->B->A). Indirect cycle detection requires application-level validation during assembly creation: at INSERT/UPDATE time, walk the chain of `nested_assembly_id` references (bounded by a max depth of 10) and reject if a cycle is detected. This is a finite traversal because catalog assemblies are expected to nest at most 3-5 levels deep.

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
| Pull from catalog | Catalog -> Node | Update item details from latest catalog version. **Preserve qty.** |
| Push to catalog | Node -> Catalog | Update catalog item from estimate node values. Increment catalog version. |
| Check for changes | Read-only | Compare node details with catalog source. Report differences. |
| Unlink | -- | Clear `catalog_source_id`, `catalog_version`. Node becomes fully independent. |

---

## 7. Options System

This is the most architecturally complex feature and the primary differentiator. Three layers, each independently useful.

### 7.1 Layer 1: Broad Options (Parameter Overrides)

**Purpose:** Toggle estimate-wide parameter changes that cascade through formulas. Example: "Upgraded Insulation Package" changes the R-value parameter from R-19 to R-38, affecting all insulation quantity formulas.

#### `broad_options`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | -- |
| `estimate_id` | UUID FK -> estimates | -- |
| `name` | VARCHAR(255) | UNIQUE per estimate |
| `description` | TEXT | -- |
| `is_active` | BOOLEAN | Currently enabled? |
| `sort_order` | INTEGER | -- |
| `created_at` / `updated_at` | TIMESTAMPTZ | -- |

#### `broad_option_overrides`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | -- |
| `broad_option_id` | UUID FK -> broad_options ON DELETE CASCADE | -- |
| `parameter_id` | UUID FK -> project_parameters | Which parameter to override |
| `override_value` | DECIMAL(15,4) | Replacement value when active |

**Normalized** (not JSONB). This enables FK integrity to `project_parameters` -- if a parameter is deleted, the override is cleaned up. The old system stored these as JSONB with no referential integrity.

**Multiple active broad options:** When multiple broad options override the same parameter, the one with the highest `sort_order` wins (deterministic precedence instead of last-writer-wins ambiguity).

### 7.2 Layer 2: Inline Options (Subtree Swapping)

**Purpose:** At any point in the estimate tree, offer alternatives. Can replace a single item, an assembly, or an entire group section. Unlimited alternatives per option point.

#### `option_groups`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | -- |
| `estimate_id` | UUID FK -> estimates | -- |
| `anchor_node_id` | UUID FK -> estimate_nodes ON DELETE CASCADE | The node in the tree where this option "lives." Enables direct lookup, UI indicators, and cascade deletes. |
| `name` | VARCHAR(255) | e.g., "Kitchen Package" |
| `description` | TEXT | -- |
| `created_at` / `updated_at` | TIMESTAMPTZ | -- |

**`anchor_node_id`** is the critical addition from v1. This is the node at which the option was created. It enables:
- Direct lookup: "which node has options?" -> `SELECT * FROM option_groups WHERE anchor_node_id = $1`
- UI rendering: show option indicator on anchor nodes
- Move operations: when the anchor node moves, the option group follows naturally via FK
- Cascade: when the anchor node is deleted, cascade-delete the option group and all its alternatives

#### `option_alternatives`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | -- |
| `option_group_id` | UUID FK -> option_groups ON DELETE CASCADE | -- |
| `name` | VARCHAR(255) | e.g., "Standard", "Mid-Range", "Premium" |
| `description` | TEXT | -- |
| `is_selected` | BOOLEAN | Exactly one per group must be TRUE |
| `sort_order` | INTEGER | Display ordering |
| `created_at` / `updated_at` | TIMESTAMPTZ | -- |

**Exactly-one-selected constraint:**
```sql
-- At most one selected per group (database-enforced)
CREATE UNIQUE INDEX idx_one_selected_per_group
ON option_alternatives (option_group_id)
WHERE is_selected = TRUE;
```

This partial unique index ensures at most one alternative per group can be `is_selected = TRUE`. Combined with application-level logic that ensures exactly one (not zero) is selected, this makes the invariant database-enforced. The switching operation must be atomic: deselect old + select new in a single transaction.

#### `node_option_memberships` -- Junction Table for Option Membership

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | -- |
| `node_id` | UUID FK -> estimate_nodes ON DELETE CASCADE | The estimate node |
| `option_alternative_id` | UUID FK -> option_alternatives ON DELETE CASCADE | Which alternative this node belongs to |

UNIQUE on `(node_id, option_alternative_id)`.

**Why a junction table instead of a column on `estimate_nodes`:** The v1 design used a single `option_alternative_id` column on the base table. This prevented a node from belonging to multiple option alternatives (needed for nested options -- options within options). Nested options are a real construction estimating workflow: "Premium Kitchen" is an option, and within it, "Granite vs. Quartz Countertops" is a sub-option.

The junction table costs one additional JOIN in the active tree query. For 200-1,000 node trees, this is negligible. The benefit is that nested options become a feature addition (additional rows in the junction table), not a breaking schema migration. The first release enforces "one option group per node" in application logic; the schema supports lifting that restriction later.

#### How Subtree Swapping Works

1. **User creates an option** for a node (item, assembly, or group). System creates:
   - An `option_group` record with `anchor_node_id` pointing to the target node
   - An `option_alternative` for the "base" version (is_selected = TRUE)
   - Rows in `node_option_memberships` stamping the existing node (and all its descendants) with the base alternative's ID

2. **User creates additional alternatives.** For each:
   - Create a new `option_alternative` record (is_selected = FALSE)
   - Create new `estimate_nodes` (and detail rows) for the alternative's subtree
   - All nodes in the alternative share the same `parent_id` as the base (they occupy the same tree position)
   - Create rows in `node_option_memberships` linking all nodes in the alternative's subtree to the new alternative's ID

3. **User switches selection.** System (in a single transaction):
   - Sets `is_selected = FALSE` on the old alternative
   - Sets `is_selected = TRUE` on the new alternative
   - Triggers recalculation of the active tree

4. **Active tree query** (the "what you see" query):
```sql
SELECT n.* FROM estimate_nodes n
WHERE n.estimate_id = $1
AND NOT EXISTS (
  SELECT 1 FROM node_option_memberships nom
  JOIN option_alternatives oa ON nom.option_alternative_id = oa.id
  WHERE nom.node_id = n.id AND oa.is_selected = FALSE
)
ORDER BY n.parent_id, n.sort_order;
```

This reads: "show nodes that do NOT belong to any deselected alternative." Nodes with no membership rows are always visible. Nodes belonging to selected alternatives are visible. Nodes belonging to deselected alternatives are excluded.

**Stamp propagation trigger:** When a node is moved (parent_id UPDATE) into a subtree that has option memberships, a trigger must propagate the membership to the moved node and its descendants. This prevents stamp corruption where a moved node becomes an orphan that appears regardless of which alternative is selected.

```sql
-- Trigger on estimate_nodes UPDATE of parent_id
-- If new parent has option memberships, propagate to moved node + descendants
CREATE OR REPLACE FUNCTION propagate_option_membership()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.parent_id IS DISTINCT FROM NEW.parent_id THEN
    -- Check if new parent has option memberships
    -- If so, add matching memberships to moved node and all descendants
    INSERT INTO node_option_memberships (id, node_id, option_alternative_id)
    SELECT gen_random_uuid(), d.id, nom.option_alternative_id
    FROM node_option_memberships nom
    JOIN (
      -- Get moved node and all its descendants
      WITH RECURSIVE desc AS (
        SELECT NEW.id AS id
        UNION ALL
        SELECT en.id FROM estimate_nodes en JOIN desc d ON en.parent_id = d.id
      )
      SELECT id FROM desc
    ) d ON TRUE
    WHERE nom.node_id = NEW.parent_id
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

#### Design Decision: No Nested Options (Initially)

The junction table schema supports nested options (a node belonging to multiple alternatives), but the initial implementation will enforce "one option group per node" in application logic. When nested options are needed, the constraint is relaxed in application code -- no schema migration required.

### 7.3 Layer 3: Option Sets (Saved Scenarios)

**Purpose:** Save and recall named combinations of option selections. "Budget Scenario" remembers that Kitchen=Standard, Flooring=Vinyl, Siding=Fiber Cement. Switch between scenarios instantly.

#### `option_sets`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | -- |
| `estimate_id` | UUID FK -> estimates | -- |
| `name` | VARCHAR(255) | "Budget", "Mid-Range", "Premium" |
| `description` | TEXT | -- |
| `is_default` | BOOLEAN | One per estimate |
| `sort_order` | INTEGER | -- |
| `created_at` / `updated_at` | TIMESTAMPTZ | -- |

#### `option_set_selections`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | -- |
| `option_set_id` | UUID FK -> option_sets ON DELETE CASCADE | -- |
| `option_group_id` | UUID FK -> option_groups | Which choice point |
| `selected_alternative_id` | UUID FK -> option_alternatives | Which alternative is selected in this scenario |

UNIQUE on `(option_set_id, option_group_id)` -- one selection per group per set.

#### `option_set_broad_selections`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | -- |
| `option_set_id` | UUID FK -> option_sets ON DELETE CASCADE | -- |
| `broad_option_id` | UUID FK -> broad_options | Which broad option |
| `is_active` | BOOLEAN | Whether this broad option is active in this scenario |

UNIQUE on `(option_set_id, broad_option_id)`.

This table captures broad option toggle states within option sets, cleanly separated from inline option selections. Option sets record BOTH inline and broad option selections for complete scenario recall.

**Applying an option set:** Update `option_alternatives.is_selected` for each group according to the set's inline selections, and update `broad_options.is_active` according to the set's broad selections. Then recalculate.

**Comparison view:** For each option set, temporarily apply its selections (in memory, not persisted), calculate the tree total, and present side-by-side comparisons. For 200-1,000 node trees, the per-scenario recalculation is manageable but should be benchmarked -- 5-6 scenarios times full tree calculation is not free.

**Calculation order for option interactions:** When broad options and inline options interact (a broad option changes a parameter that affects formulas within an inline alternative), the calculation order is:
1. Determine which broad options are active -> resolve all parameter values
2. Determine which inline alternatives are selected -> resolve the active tree
3. Calculate the active tree using the resolved parameters

This order must be explicit and tested. The interaction is multiplicative, not additive -- the comparison view must account for the combinatorial space.

---

## 8. Version Management and Audit Trail

### 8.1 Two-Level Version System

| Level | Mechanism | Purpose | User-Triggered? |
|-------|-----------|---------|-----------------|
| **Explicit Versions** | Deep-copy estimate + full tree | Named milestones: "Initial", "Post-VE", "Final" | Yes |
| **Change History** | History tables with triggers | Every individual edit: who changed what, when, old values | Automatic |

### 8.2 Explicit Versions (Estimate Snapshots)

When the user creates a new version, the deep-copy must be implemented as a **single PostgreSQL function** (`deep_copy_estimate(source_estimate_id)`) that handles all remapping in one atomic transaction. Do not implement in application code with multiple round-trips.

The function performs:
1. Deep-copy the `estimates` row with new ID, incremented `version_number`, new `version_label`
2. Deep-copy all `estimate_nodes` rows (update estimate_id, remap parent_id via an ID remapping table)
3. Deep-copy all `node_item_details` and `node_assembly_details` rows (remap node_ids)
4. Deep-copy all `option_groups` (remap estimate_id, remap anchor_node_id)
5. Deep-copy all `option_alternatives` (remap option_group_id)
6. Deep-copy all `node_option_memberships` (remap node_id AND option_alternative_id using both remapping tables)
7. Deep-copy all `option_sets` and `option_set_selections` (remap all FKs)
8. Deep-copy all `option_set_broad_selections` (remap FKs)
9. Deep-copy all broad options and overrides
10. Flip old version's `is_current` to FALSE

**Step 6 is critical.** If node_option_memberships rows are copied without remapping `option_alternative_id`, the copied nodes point to the OLD version's alternatives. Switching options on one version would affect the other. The two versions must be completely independent.

Each version is a complete, independent snapshot. Old versions are effectively immutable. This means:
- "What did Version 2 look like?" -> Query that version's estimate_id directly
- "Diff between Version 2 and Version 3" -> Compare node-by-node (match by `catalog_source_id` or position)
- "Roll back to Version 2" -> Create Version 4 as a copy of Version 2

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

**Important:** Every schema migration on source tables must also update the corresponding history table. Document this as a contract: "every migration touches history tables too."

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

This captures the OLD row values on every UPDATE and DELETE -- transparently, without any application code changes. The application sets `app.current_user_id` at the start of each request for attribution.

**Querying history:**
- "What did this node look like yesterday?" -> `SELECT * FROM estimate_nodes_history WHERE node_id = $1 AND changed_at <= $2 ORDER BY changed_at DESC LIMIT 1`
- "Who changed the siding quantity?" -> `SELECT * FROM estimate_nodes_history WHERE node_id = $1 ORDER BY changed_at DESC`
- "What changed today?" -> `SELECT * FROM estimate_nodes_history WHERE changed_at >= CURRENT_DATE`
- "Roll back this specific change" -> Copy the history row's values back to the live table

### 8.4 History Table Architecture Decision

**Start history tracking from Phase 1.** Even though the UI for browsing history comes later, the triggers should capture data from day one. History for data that existed before tracking was enabled is lost forever -- retroactively adding tracking is painful.

The triggers add negligible overhead (one INSERT per UPDATE/DELETE). Storage grows linearly with edit frequency. For a single user editing ~100 nodes/day, that's ~3,000 history rows/month -- trivial.

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

**Why isomorphic?** One TypeScript module means the calculation logic is identical on both sides. No drift by construction. The module must be a pure function with no side effects or environment-dependent behavior (no `Date.now()`, no `Math.random()`, no conditional code paths based on `typeof window`).

**Drift mitigation:** Pin all calculation dependencies in a lockfile. Write a comprehensive test suite that runs the same test cases in both Node.js and browser (via Playwright or similar). Consider making the server the SOLE authoritative calculator for the save path: the client calculates for display only; the server always recalculates from scratch on save and ALWAYS uses its own values.

### 9.2 The Calculation Chain

For leaf items (the atomic level):
```
raw_qty = (depends on qty_mode)
  numeric: direct value
  ratio: (parent_assembly_qty * ratio_numerator) / ratio_denominator
  formula: evaluate(qty_formula, parameters)

qty = applyPurchasingConstraints(raw_qty, waste_factor, package_size, min_order_qty)

subtotal = qty * unit_cost
contingency_amount = subtotal * contingency_rate
overhead_amount = (subtotal + contingency_amount) * overhead_rate   // COMPOUNDS
total_price = subtotal + contingency_amount + overhead_amount
unit_price = total_price / qty   (null if qty = 0)
```

**All intermediate values are calculated at DECIMAL(15,4) precision.** Only round to 2 decimal places for client-facing display. This prevents cumulative rounding errors that could reach multiple cents on large estimates with hundreds of items.

For parent nodes (groups and assemblies):
```
subtotal = SUM(active_children.subtotal)
contingency_amount = SUM(active_children.contingency_amount)
overhead_amount = SUM(active_children.overhead_amount)
total_price = SUM(active_children.total_price)

// Assembly-specific:
derived_unit_cost = total_price / assembly_qty   (guard: null if assembly_qty = 0)
```

**"Active children"** = children that do NOT belong to any deselected alternative (determined via the `node_option_memberships` junction table query).

**Stored totals consistency obligation:** Every mutation that changes a quantity, cost, rate, or tree structure MUST trigger a bottom-up recalculation that updates every ancestor of every changed node. This is a formal invariant. The batch save strategy (Section 9.4) enforces this by recalculating the full tree from scratch on every save.

**Reverse-calculated display rates for parent nodes:** The effective contingency/overhead rate displayed on parent nodes is derived: `effective_rate = amount / subtotal`. When `subtotal = 0`, display "N/A" or "--" for the rate. Blended rates (where children have different individual rates) should include a tooltip showing the range.

### 9.3 Purchasing Constraint Cascade

```typescript
function applyPurchasingConstraints(
  rawQty: number,
  wasteFactor: number,
  packageSize: number | null,
  minOrderQty: number | null
): number {
  // Guard: zero or negative quantity means "do not purchase"
  if (rawQty <= 0) return 0;

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

**Zero-quantity guard:** If `rawQty <= 0`, skip all constraints and return 0. Zero means "exclude this item from purchasing." Without this guard, a zero quantity with a minimum order constraint would incorrectly produce a non-zero final quantity.

### 9.4 Batch Save Strategy

On save, send ALL changed nodes in a single request. The server:
1. Validates all changes
2. Runs the calculation engine on the full tree (from scratch, not incremental)
3. Stores the server-calculated values as the authoritative result
4. Returns the server values to the client for display update

**Server-authoritative model:** The server always recalculates from scratch and always uses its own values. The client calculates for instant feedback (optimistic UI), but the server's values are what gets stored. Mismatches between client and server calculations are logged as telemetry for detecting drift, but do not gate the save operation.

**Comparison semantics:** When logging client/server mismatches, define "match" as equality after rounding to DECIMAL(15,4) -- the database storage precision. For quantities, use a tolerance of 1e-10 to absorb floating-point noise. Log every mismatch so patterns can be identified.

This eliminates the N+1 update problem from the old system. One transaction, one round-trip.

---

## 10. Formula Engine

### 10.1 Recommendation: math.js with Constrained Configuration

Use **math.js** as the expression evaluation library. It is actively maintained, has built-in security measures that prevent `eval()` and `new Function()`, native TypeScript support, and built-in unit conversion features relevant to construction estimating.

**Why not expr-eval:** The `expr-eval` library (v2.0.2) has CVE-2025-12735, a CVSS 9.8 Critical remote code execution vulnerability via prototype pollution. The package has been effectively abandoned (last release over 6 years ago, maintainer unresponsive to security PRs). Forks exist but have uncertain maintenance trajectories.

**Why not filtrex:** filtrex is an excellent lightweight alternative (compiles to functions without `eval()`, immune to injection by design), but lacks math.js's unit conversion features and active maintenance. It remains a viable fallback if math.js's 200KB bundle size becomes a concern.

| Criterion | math.js | expr-eval | filtrex |
|-----------|---------|-----------|---------|
| Maintenance | Active, regular releases | Abandoned (6+ years) | Low activity |
| CVEs | None known | CVE-2025-12735 (9.8 Critical) | None known |
| Sandbox security | Prevents eval/new Function | Broken (prototype pollution) | Compiles to function, no eval |
| Custom functions | Yes | Yes | Yes |
| Unit support | Built-in | None | None |
| Bundle size | ~200KB | ~15KB | ~8KB |
| TypeScript | Built-in | @types package | Limited |

### 10.2 How Formulas Resolve

When evaluating a formula like `=wall_area * 2.88 * 1.15`:

1. Build the variable context:
   - Project parameters: `{ wall_area: 1200, roof_pitch: 8, total_perimeter: 240 }`
   - Named references: `{ siding_area: <value of node with reference_name='siding_area'> }`
2. Pass the formula string and variable context to math.js
3. Return the numeric result

### 10.3 Named Preset Formulas (Future Enhancement)

User-defined formula functions like `STUD_COUNT_16OC(length)` that encapsulate common calculations. These would be registered as custom functions with math.js:

```typescript
// Future: user creates this preset
// Name: STUD_COUNT_16OC
// Formula: CEIL(length / 1.333) + 1

math.import({
  STUD_COUNT_16OC: function(length: number) {
    return Math.ceil(length / 1.333) + 1;
  }
});

// Then used in item formulas:
// qty_formula = "STUD_COUNT_16OC(wall_length)"
```

Architecture supports this by design -- math.js accepts custom function registrations.

### 10.4 Formula Safety

- Formulas are evaluated in a sandboxed context (only allowed variables and functions, no access to DOM/Node APIs). math.js's `evaluate()` function operates in a restricted scope by default.
- **Circular references -- both client and server:** At save time, build a dependency graph from formula references. If a cycle is found, reject the formula. On the client, the formula evaluator must also have a max-iteration guard to prevent the browser from freezing if a cycle is entered before save validation runs.
- Error handling: if a formula fails to evaluate (missing variable, division by zero), return null/0 and flag the node with a validation warning -- never crash the calculation engine.

---

## 11. Proposals Table

### `proposals`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | -- |
| `estimate_id` | UUID FK -> estimates | -- |
| `name` | VARCHAR(255) | e.g., "Initial Proposal", "Revised Proposal" |
| `detail_level` | VARCHAR(20) | `'lump_sum','category_summary','line_item'` |
| `option_set_id` | UUID FK -> option_sets | Which scenario to present. Nullable for base scenario. |
| `cover_letter` | TEXT | -- |
| `terms` | TEXT | -- |
| `status` | VARCHAR(20) | `'draft','sent','viewed','approved','declined'` |
| `sent_at` | TIMESTAMPTZ | -- |
| `approved_at` | TIMESTAMPTZ | -- |
| `created_at` / `updated_at` | TIMESTAMPTZ | -- |

This table provides the structured client-facing presentation layer that industry tools (CoConstruct, Buildertrend) all provide. The architecture's existing `client_visibility` flags on nodes control item-level visibility; the proposals table adds document-level presentation settings (detail level, cover letter, terms, status tracking).

Not needed for Phase 1, but including it in the schema design signals that client-facing proposals are a planned feature and ensures other tables (like `option_sets`) are designed to support it.

---

## 12. JSONB vs. Normalized Tables

### Where JSONB Is Appropriate

| Data | Why JSONB | Example |
|------|-----------|---------|
| `column_config` | Opaque UI preference, never queried by structure | `{"showCostCode": true, "showVendor": false}` |
| `view_settings` | Opaque UI preference | `{"expandedIds": [...], "sortColumn": "name"}` |
| `tags` | Simple array, rarely queried individually. GIN-indexed for containment queries. | `["siding", "exterior", "cedar"]` |

### Where JSONB Is NOT Appropriate (Use Normalized Tables)

| Data | Why Normalized | Old System's JSONB Mistake |
|------|---------------|---------------------------|
| `parameter_overrides` | Need FK integrity to parameters | JSONB array with embedded parameter IDs -- no referential integrity |
| `inline_selections` | Need FK integrity to alternatives | JSONB map with option IDs -- no type checking |
| `attachments` | Need proper file management, querying | JSONB array of metadata objects -- no structured queries |
| `links` | Could go either way, but normalized enables better querying | JSONB array |
| `unit_parameters` / `assembly_parameters` | Need type safety and queryability | JSONB objects -- opaque to the database |

**The rule:** If you need to JOIN on it, query inside it, or enforce referential integrity on its contents, it should be a normalized table. If it's an opaque blob that the application reads/writes as a whole, JSONB is fine.

**Note on tags:** Catalog tags use JSONB with a GIN index. PostgreSQL's `@>` containment queries on GIN-indexed JSONB handle tag filtering efficiently. If tags grow into a complex taxonomy (hierarchical tags, tag categories), migrate to a `catalog_item_tags` junction table.

---

## 13. Database vs. Application Enforcement

### Database-Level (Constraints, Triggers, CHECK Clauses)

| Rule | Mechanism | Why DB-Level |
|------|-----------|-------------|
| Items are always leaves | Trigger: reject INSERT where parent is an item | Structural invariant -- violation corrupts the tree |
| Items cannot gain children via type change | Trigger: reject UPDATE of node_type to 'item' if node has children | Structural invariant |
| Node type is valid | CHECK constraint | Prevent typos/invalid types |
| Items must have a parent | CHECK constraint | Orphan items are meaningless |
| One selected alternative per option group | Partial unique index on is_selected = TRUE | Data integrity -- multiple selections = undefined behavior |
| Unique reference names per estimate | UNIQUE constraint | Formula resolution depends on unique names |
| Sort order is integer | Column type | Prevent fractional drift |
| Cascade deletes | FK ON DELETE CASCADE | Subtree deletion must be atomic |
| History tracking | Triggers on UPDATE/DELETE | Must capture EVERY change, can't rely on app to remember |
| updated_at timestamps | Trigger | Must fire on EVERY update |
| ltree path maintenance | Trigger on parent_id INSERT/UPDATE | Path must always reflect current tree structure |
| Option stamp propagation | Trigger on parent_id UPDATE | Moved nodes must inherit parent's option membership |
| Ratio denominator not zero | CHECK constraint | Prevent division by zero in ratio calculations |

### Application-Level (Server-Side Validation)

| Rule | Why App-Level |
|------|--------------|
| Valid parent-child type combinations (groups can contain groups/assemblies/items, assemblies can contain assemblies/items, items can't contain anything) | Complex multi-column logic that's clearer in TypeScript. Also enforced by the items-are-leaves DB trigger as a safety net. |
| Circular reference prevention in nested assemblies | Requires graph traversal -- bounded chain-walk algorithm at INSERT/UPDATE time |
| Formula syntax validation | Requires parsing -- the DB can't validate expression syntax |
| Client-side cycle detection | Max-iteration guard to prevent browser freeze before server validates |
| Estimate version immutability (non-current versions can't be edited) | Business rule that may have exceptions (admin override) |
| Option set consistency (all groups have a selection) | Validation that crosses multiple tables |
| Purchasing constraint logic (waste -> package -> minimum order) | Complex sequential calculation |
| Exactly one option alternative selected (not zero) | Application enforces "at least one"; DB partial index enforces "at most one" |
| Advisory group depth limit | UI warns at depth > 3, application rejects at depth > 5 |

### The Principle

If violating the rule would corrupt data structure (orphans, broken trees, lost references), enforce it in the database. If violating the rule would produce incorrect RESULTS but not structural corruption, enforce it in the application.

---

## 14. Row-Level Security (RLS)

Supabase applications must use RLS policies. Without RLS enabled, the auto-generated PostgREST API exposes all data to any authenticated user.

### Policy Recommendations

**Builder role (full access):**
```sql
-- Enable RLS on all tables
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimate_nodes ENABLE ROW LEVEL SECURITY;
-- ... (all tables)

-- Builder has full access to their own data
CREATE POLICY builder_all ON projects
  FOR ALL
  USING (created_by = auth.uid() OR EXISTS (
    SELECT 1 FROM auth.users WHERE id = auth.uid()
    AND raw_user_meta_data->>'role' = 'builder'
  ));
```

**Client role (filtered by visibility):**
```sql
-- Clients see only visible nodes on estimates shared with them
CREATE POLICY client_read ON estimate_nodes
  FOR SELECT
  USING (
    client_visibility != 'hidden'
    AND estimate_id IN (
      SELECT id FROM estimates WHERE project_id IN (
        SELECT project_id FROM project_clients WHERE client_user_id = auth.uid()
      )
    )
  );
```

For a single-user app, the simplest viable policy is a builder-owns-everything check. If client portal access is added later, layer client visibility policies on top. The key requirement is that RLS is ENABLED from day one -- adding it later to tables with existing data and API consumers is painful.

---

## 15. Vendor System (High-Level Architecture)

Vendor management is a major feature but architecturally independent from the core estimating engine. This section provides the high-level table design. Detailed design happens during the vendor implementation phase.

### Core Tables

#### `vendors`
| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | -- |
| `company_name` | VARCHAR(255) | -- |
| `trade_type` | VARCHAR(100) | e.g., "Electrical", "Plumbing", "Lumber Supply" |
| `status` | VARCHAR(50) | `'active','inactive','preferred','blacklisted'` |
| `rating` | INTEGER | 1-5 star rating |
| `notes` | TEXT | -- |
| `website` | TEXT | -- |
| `created_at` / `updated_at` | TIMESTAMPTZ | -- |

#### `vendor_contacts`
| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | -- |
| `vendor_id` | UUID FK -> vendors | -- |
| `name` | VARCHAR(255) | -- |
| `role` | VARCHAR(100) | e.g., "Sales Rep", "Project Manager" |
| `email` | VARCHAR(255) | -- |
| `phone` | VARCHAR(50) | -- |
| `is_primary` | BOOLEAN | Primary contact flag |

#### `vendor_documents`
| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | -- |
| `vendor_id` | UUID FK -> vendors | -- |
| `document_type` | VARCHAR(50) | `'coi','contract','license','w9','other'` |
| `name` | VARCHAR(255) | -- |
| `file_path` | TEXT | Supabase Storage path |
| `expiration_date` | DATE | For COIs and licenses |
| `uploaded_at` | TIMESTAMPTZ | -- |

#### `vendor_catalog_items` (Vendor-Item Association)
| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | -- |
| `vendor_id` | UUID FK -> vendors | -- |
| `catalog_item_id` | UUID FK -> catalog_items | -- |
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

## 16. Node Attachments

For managing files attached to estimate nodes (bid documents, specifications, photos):

#### `node_attachments`
| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | -- |
| `node_id` | UUID FK -> estimate_nodes ON DELETE CASCADE | -- |
| `file_name` | VARCHAR(255) | Original file name |
| `file_path` | TEXT | Supabase Storage path |
| `file_size` | INTEGER | Bytes |
| `file_type` | VARCHAR(100) | MIME type |
| `attachment_type` | VARCHAR(50) | `'bid_document','specification','photo','other'` |
| `uploaded_at` | TIMESTAMPTZ | -- |
| `uploaded_by` | UUID FK -> auth.users | -- |

This replaces the old system's JSONB `links`, `attachments`, and `bid_file` columns with a proper normalized table.

---

## 17. Complete Table Summary

| # | Table | Rows (typical) | Purpose |
|---|-------|---------------|---------|
| 1 | `projects` | 5-20 | Project containers |
| 2 | `estimates` | 2-5 per project | Versioned estimates |
| 3 | `estimate_nodes` | 200-1000 per estimate | Tree structure (all node types) |
| 4 | `node_item_details` | ~60% of nodes | Item-specific data |
| 5 | `node_assembly_details` | ~10% of nodes | Assembly-specific data |
| 6 | `node_option_memberships` | Variable | Junction: nodes to option alternatives |
| 7 | `estimate_nodes_history` | Grows over time | Audit trail |
| 8 | `node_item_details_history` | Grows over time | Audit trail |
| 9 | `node_assembly_details_history` | Grows over time | Audit trail |
| 10 | `phases` | 5-10 per project | Classification tags |
| 11 | `cost_codes` | ~50-100 (mostly seed data) | Structured CSI MasterFormat codes |
| 12 | `units_of_measure` | ~25 (mostly seed data) | Standardized units |
| 13 | `unit_conversions` | ~30 | Conversion factors |
| 14 | `project_parameters` | 10-30 per project | Named values for formulas |
| 15 | `catalog_items` | 100-500 (growing) | Reusable item templates |
| 16 | `catalog_assemblies` | 20-100 | Reusable assembly templates |
| 17 | `catalog_assembly_components` | ~5 per assembly | Assembly composition |
| 18 | `option_groups` | 5-30 per estimate | Choice points (with anchor_node_id) |
| 19 | `option_alternatives` | 2-5 per group | Alternatives per choice |
| 20 | `option_sets` | 2-5 per estimate | Saved scenarios |
| 21 | `option_set_selections` | groups x sets | Inline option scenario selections |
| 22 | `option_set_broad_selections` | broad_options x sets | Broad option scenario selections |
| 23 | `broad_options` | 1-10 per estimate | Parameter override toggles |
| 24 | `broad_option_overrides` | 1-5 per broad option | What each toggle overrides |
| 25 | `proposals` | 1-5 per estimate | Client-facing proposal documents |
| 26 | `vendors` | 20-100 | Vendor records |
| 27 | `vendor_contacts` | 1-3 per vendor | Contact info |
| 28 | `vendor_documents` | 2-5 per vendor | COIs, contracts, etc. |
| 29 | `vendor_catalog_items` | Many-to-many | Vendor pricing per item |
| 30 | `node_attachments` | Variable | Files attached to nodes |

**Total: 30 tables** (vs. 26 in v1, vs. 14 in the old system). The additions are: `node_option_memberships` (junction table replacing column), `option_set_broad_selections` (broad option scenario tracking), `cost_codes` (structured cost code reference), and `proposals` (client-facing documents). Each table is focused, normalized, and clear about what it contains. No 46-column monoliths. No JSONB for things that need referential integrity.
