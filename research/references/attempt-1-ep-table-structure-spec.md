# ⚠️ REFERENCE DOCUMENT — DO NOT USE AS A BLUEPRINT ⚠️

> **Source:** First attempt at the estimating platform ("Estimating Platform" / EP repo)
> **Purpose:** This document shows what was tried in the first attempt — a 14-table PostgreSQL schema centered on a monolithic 46-column `estimate_nodes` table. It is included so you understand the SCOPE of what construction estimating requires and the PROBLEMS that emerged from this approach.
>
> **How to read this:**
> - The PROBLEMS identified here are real and must be solved
> - The SOLUTIONS chosen here may have been wrong — do not adopt them
> - The SCOPE of features described here (tree hierarchy, calculation chain, catalog, options, purchasing constraints) accurately represents what the final system needs to handle
> - The specific column layouts, table structures, and code patterns are NOT recommendations
>
> **Key problems with this approach that you should understand:**
> 1. A single 46-column table stored all node types — ~36 columns NULL on non-leaf nodes
> 2. Business rules enforced only in application code, not database constraints
> 3. All layers (tree, calculations, catalog, options) were designed simultaneously, causing cascading instability when any foundational assumption changed
> 4. Recalculation required N+1 database round trips
> 5. Some tree operations (move, duplicate) didn't trigger recalculation, leaving totals stale
> 6. JSONB used for data that needed to be queryable
> 7. Spec documents grew to 100KB+, consuming AI context windows

---

# Estimating Platform — Table Structure & Architecture Spec

> **Compiled from:** schema-analysis.md, tree-architecture.md, data-flow.md, options-catalog.md
> **Source codebase:** `A:/estimating-platform` (Supabase project `hmrsdovclzbzzsypbtod`)
> **Schema version:** 1.0 (2026-01-12) + 5 migrations through 2026-01-19
> **Date:** 2026-03-31

---

## 1. Executive Summary

The Estimating Platform is a construction cost estimation system built on Next.js + Supabase. Its data model centers on a **monolithic 46-column `estimate_nodes` table** that uses UUID self-referential foreign keys (`parent_id -> id`) to form an unbounded-depth tree hierarchy. This single table stores categories, sections, assemblies, and items — distinguished by a `node_type` VARCHAR column rather than separate tables per type.

**Key architectural choices:**
- **Single table for all node types.** Categories, sections, assemblies, and items all live in `estimate_nodes`. This simplifies tree operations (move, indent, outdent) at the cost of NULL-dense rows for non-leaf types (~36 of 46 columns are unused on category nodes).
- **Unbounded nesting via assembly recursion.** Unlike a fixed-depth system, assemblies can contain other assemblies to arbitrary depth. The hierarchy constraint system (`VALID_CHILD_TYPES`) is enforced in application code, not database constraints.
- **Copy-on-instantiate catalog.** Catalog items are copied into estimate nodes, not referenced by FK. This ensures estimate stability but requires explicit sync operations.
- **Three-layer options system.** Broad options (parameter overrides), inline options (per-item cost adjustments), and option sets (saved combinations) provide flexible scenario modeling.
- **Server-authoritative calculations.** All cost calculations run server-side. The client never computes monetary values — it only displays what the server returns.

**Why this matters for the ShossyWorks Estimating Platform:** This spec documents every table, relationship, constraint, and behavioral pattern. Deviations from this design should be conscious trade-off decisions, not accidental drift.

---

## 2. Entity Relationship Model

### 2.1 All Tables (14 total)

| Table | Columns | Purpose |
|-------|---------|---------|
| `organizations` | 6 | Multi-tenancy root entity |
| `user_profiles` | 8 | Application users, linked to auth.users and organizations |
| `projects` | 21 | Construction project containers |
| `estimates` | 18 | Versioned estimates within projects |
| `estimate_nodes` | **46** | Monolithic tree — categories, sections, assemblies, items |
| `broad_options` | 10 | Estimate-wide parameter override toggles |
| `inline_options` | 10 | Per-node cost adjustment alternatives |
| `option_sets` | 9 | Saved combinations of broad + inline selections |
| `catalog_items` | 23 | Reusable item templates |
| `catalog_assemblies` | 14 | Reusable assembly templates |
| `catalog_assembly_components` | 11 | Junction table: items/sub-assemblies within assemblies |
| `units_of_measure` | 11 | Standard and custom measurement units |
| `unit_conversions` | 7 | Conversion factors between units |
| `project_parameters` | 13 | Named takeoff values for formula references |
| `contracts` | 14 | Project-scoped contract records with PDF metadata |

### 2.2 ER Diagram

```
                           ┌──────────────────────┐
                           │    auth.users         │
                           │  (Supabase Auth)      │
                           └───────┬──────────────┘
                                   │ 1:1
                                   ▼
┌──────────────────┐      ┌──────────────────────┐
│  organizations   │◄─────│    user_profiles      │
│  (multi-tenant   │ 1:N  │  id FK→auth.users     │
│   root)          │      │  organization_id FK    │
└──────┬───────────┘      │  role (owner/admin/    │
       │                  │    member/viewer)       │
       │                  └────────────────────────┘
       │
       ├───── 1:N ──► projects
       │                 │
       │                 ├───── 1:N ──► estimates ◄───── self-ref (parent_estimate_id)
       │                 │                 │
       │                 │                 ├───── 1:N ──► estimate_nodes ◄── self-ref (parent_id)
       │                 │                 │                 │
       │                 │                 │                 └───── 1:N ──► inline_options
       │                 │                 │
       │                 │                 ├───── 1:N ──► broad_options
       │                 │                 │
       │                 │                 └───── 1:N ──► option_sets
       │                 │
       │                 ├───── 1:N ──► project_parameters
       │                 │
       │                 └───── 1:N ──► contracts
       │
       ├───── 1:N ──► catalog_items
       │
       ├───── 1:N ──► catalog_assemblies
       │                 │
       │                 └───── 1:N ──► catalog_assembly_components
       │                                    │
       │                                    ├── FK→ catalog_items (XOR)
       │                                    └── FK→ catalog_assemblies (XOR, recursive)
       │
       ├───── 1:N ──► units_of_measure ◄── self-ref (base_unit_id)
       │                 │
       │                 └──────────────► unit_conversions (from_unit, to_unit)
       │
       └──(nullable org = system-level units/conversions)

Soft references (no FK constraint):
  estimate_nodes.catalog_source_id ···> catalog_items.id OR catalog_assemblies.id
  estimate_nodes.vendor_assignment ···> (vendor entity, not yet in schema)
```

### 2.3 FK Cascade Behavior

| Parent | Child | ON DELETE |
|--------|-------|-----------|
| organizations | projects, catalog_items, catalog_assemblies, units_of_measure, unit_conversions | CASCADE |
| organizations | user_profiles | SET NULL (organization_id) |
| projects | estimates, project_parameters, contracts | CASCADE |
| estimates | estimate_nodes, broad_options, option_sets | CASCADE |
| estimate_nodes | estimate_nodes (children via parent_id) | CASCADE |
| estimate_nodes | inline_options | CASCADE |
| catalog_assemblies | catalog_assembly_components | CASCADE |
| catalog_items | catalog_assembly_components | CASCADE |
| auth.users | user_profiles | CASCADE |

> **Comparison Note:** CASCADE DELETE on the self-referential `estimate_nodes.parent_id` means deleting any parent node recursively deletes the entire subtree. A safer alternative would be SET NULL (orphan children) or application-level soft-delete, but CASCADE simplifies the delete path at the cost of irreversibility.

---

## 3. The estimate_nodes Table

This is the system's core — a 46-column monolithic table that stores every node in the estimate tree regardless of type.

### 3.1 Columns by Functional Group

#### Identity & Position (6 columns)

| Column | Type | Nullable | Default | Constraints |
|--------|------|----------|---------|-------------|
| `id` | UUID | NO | `gen_random_uuid()` | PRIMARY KEY |
| `estimate_id` | UUID | NO | — | FK -> `estimates(id)` ON DELETE CASCADE |
| `parent_id` | UUID | YES | — | FK -> `estimate_nodes(id)` ON DELETE CASCADE (self-ref) |
| `sort_order` | INTEGER | NO | `0` | — |
| `row_number` | VARCHAR(50) | YES | — | Stored but NOT used by tree renderer |
| `name` | VARCHAR(255) | NO | — | — |

#### Node Type (1 column)

| Column | Type | Nullable | Default | Constraints |
|--------|------|----------|---------|-------------|
| `node_type` | VARCHAR(20) | NO | — | CHECK: `('category','section','assembly','item')` |

> **Comparison Note:** This uses a VARCHAR CHECK constraint, not a PostgreSQL ENUM. Adding a new node type requires both an `ALTER TABLE ... DROP CONSTRAINT / ADD CONSTRAINT` migration and a TypeScript type update. The trade-off is simpler migration mechanics vs. no pg_enum catalog dependency.

#### Quantity Fields (6 columns)

| Column | Type | Nullable | Default | Constraints |
|--------|------|----------|---------|-------------|
| `qty` | DECIMAL(15,4) | YES | — | — |
| `qty_formula` | TEXT | YES | — | Formula string referencing parameters |
| `qty_mode` | VARCHAR(20) | YES | `'numeric'` | CHECK: `('numeric','formula','ratio')` |
| `qty_ratio_value` | DECIMAL(15,4) | YES | — | — |
| `qty_ratio_unit_from` | VARCHAR(50) | YES | — | — |
| `qty_ratio_unit_to` | VARCHAR(50) | YES | — | — |

#### Unit & Direct Cost (3 columns)

| Column | Type | Nullable | Default | Constraints |
|--------|------|----------|---------|-------------|
| `unit` | VARCHAR(50) | YES | — | Free-text (no FK to units_of_measure) |
| `cost` | DECIMAL(15,4) | YES | — | Unit cost |
| `cost_formula` | TEXT | YES | — | Formula string |

> **Comparison Note:** Despite having a full `units_of_measure` table, the `unit` column is free-text VARCHAR. This means there's no referential integrity between nodes and the units table. A simpler system might skip the units table entirely; a stricter system would FK the unit column.

#### Calculated / Derived Cost Fields (7 columns)

| Column | Type | Nullable | Default | Constraints |
|--------|------|----------|---------|-------------|
| `subtotal_cost` | DECIMAL(15,2) | YES | — | qty * cost (leaf) or SUM of children (parent) |
| `contingency_markup` | DECIMAL(5,4) | YES | `0` | Percentage as decimal (0.05 = 5%) |
| `contingency` | DECIMAL(15,2) | YES | `0` | subtotal_cost * contingency_markup |
| `overhead_markup` | DECIMAL(5,4) | YES | `0` | Percentage as decimal |
| `overhead` | DECIMAL(15,2) | YES | `0` | (subtotal + contingency) * overhead_markup |
| `unit_price` | DECIMAL(15,2) | YES | — | total_price / qty (null for parents) |
| `total_price` | DECIMAL(15,2) | YES | — | subtotal + contingency + overhead |

**Calculation formula (leaf items):**
```
subtotal_cost = qty * cost
contingency   = subtotal_cost * contingency_markup
overhead      = (subtotal_cost + contingency) * overhead_markup    // COMPOUNDS on contingency
total_price   = subtotal_cost + contingency + overhead
unit_price    = total_price / qty   (null if qty = 0)
```

**Parent aggregation:** Parents SUM children's `subtotal_cost`, `contingency`, `overhead`, and `total_price`. Markup percentages on parents are reverse-calculated from totals (display-only).

**Decimal precision split:**
- Cost/quantity inputs: DECIMAL(15,4) — 4 decimal places
- Calculated totals: DECIMAL(15,2) — 2 decimal places (money)
- Markup percentages: DECIMAL(5,4) — up to 9.9999 (999.99%)

#### Classification (3 columns)

| Column | Type | Nullable | Default | Constraints |
|--------|------|----------|---------|-------------|
| `bid_allowance_estimate` | VARCHAR(20) | YES | `'Estimate'` | CHECK: `('Bid','Allowance','Estimate')` |
| `cost_code` | VARCHAR(50) | YES | — | — |
| `cost_type` | VARCHAR(20) | YES | — | CHECK: `('Material','Labor','Equipment','Subcontractor','Other')` |

#### Visibility & Assignment (2 columns)

| Column | Type | Nullable | Default | Constraints |
|--------|------|----------|---------|-------------|
| `client_visibility` | VARCHAR(20) | YES | `'Visible'` | CHECK: `('Visible','Hidden','Summary Only')` |
| `vendor_assignment` | UUID | YES | — | Soft reference (no FK — vendor entity not in schema) |

#### Documentation (7 columns)

| Column | Type | Nullable | Default | Constraints |
|--------|------|----------|---------|-------------|
| `instructions` | TEXT | YES | — | — |
| `specifications` | TEXT | YES | — | — |
| `notes` | TEXT | YES | — | — |
| `client_notes` | TEXT | YES | — | — |
| `links` | JSONB | YES | `'[]'` | Array of link objects |
| `attachments` | JSONB | YES | `'[]'` | Array of attachment metadata |
| `bid_file` | JSONB | YES | — | Single bid file metadata |

#### Reference System (2 columns)

| Column | Type | Nullable | Default | Constraints |
|--------|------|----------|---------|-------------|
| `is_active_reference` | BOOLEAN | YES | `FALSE` | — |
| `reference_name` | VARCHAR(100) | YES | — | Must be non-null when is_active_reference = TRUE |

When `is_active_reference = true`, the node's value can be referenced by name in formulas on other nodes.

#### Parameters (2 columns)

| Column | Type | Nullable | Default | Constraints |
|--------|------|----------|---------|-------------|
| `unit_parameters` | JSONB | YES | `'{}'` | Copied from catalog_items.unit_parameters_template |
| `assembly_parameters` | JSONB | YES | `'{}'` | Copied from catalog_assemblies.parameters_template |

#### Catalog Integration (4 columns)

| Column | Type | Nullable | Default | Constraints |
|--------|------|----------|---------|-------------|
| `catalog_source_id` | UUID | YES | — | Soft reference (no FK) to catalog_items or catalog_assemblies |
| `catalog_source_type` | VARCHAR(20) | YES | — | CHECK: `('item','assembly')` |
| `catalog_version` | INTEGER | YES | — | Version at time of instantiation |
| `catalog_sync_enabled` | BOOLEAN | YES | `FALSE` | Whether to track changes from source |

> **Comparison Note:** These are SOFT references — no FK constraint. Deleting a catalog item does NOT cascade to estimate nodes. A stricter system would use FKs with SET NULL on delete. The trade-off is estimate stability (deleting a catalog item never breaks estimates) vs. potential stale references.

#### Purchasing (4 columns)

| Column | Type | Nullable | Default | Constraints |
|--------|------|----------|---------|-------------|
| `min_order_qty` | DECIMAL(15,4) | YES | — | — |
| `package_size` | DECIMAL(15,4) | YES | — | — |
| `package_unit` | VARCHAR(50) | YES | — | — |
| `waste_factor` | DECIMAL(5,4) | YES | `0` | — |

#### Metadata (3 columns)

| Column | Type | Nullable | Default | Constraints |
|--------|------|----------|---------|-------------|
| `created_at` | TIMESTAMPTZ | YES | `NOW()` | — |
| `updated_at` | TIMESTAMPTZ | YES | `NOW()` | Auto-updated via trigger |
| `created_by` | UUID | YES | — | FK -> `auth.users(id)` |

### 3.2 Named Constraints

| Constraint | Definition | Meaning |
|------------|-----------|---------|
| `valid_hierarchy` | `(node_type = 'item' AND parent_id IS NOT NULL) OR (node_type != 'item')` | Items MUST have a parent. Other types MAY be root nodes. |
| `valid_reference_name` | `(is_active_reference = FALSE) OR (is_active_reference = TRUE AND reference_name IS NOT NULL)` | Active references must have a name. |

### 3.3 Indexes

| Name | Column(s) | Notes |
|------|-----------|-------|
| `idx_nodes_estimate` | `estimate_id` | — |
| `idx_nodes_parent` | `parent_id` | — |
| `idx_nodes_type` | `node_type` | — |
| `idx_nodes_cost_code` | `cost_code` | — |
| `idx_nodes_catalog` | `catalog_source_id` | — |
| `idx_nodes_sort` | `(estimate_id, parent_id, sort_order)` | **Key index** for tree-ordered queries |
| `idx_nodes_reference` | `(estimate_id, is_active_reference)` | Partial: `WHERE is_active_reference = TRUE` |

### 3.4 NULL Density — The Monolithic Trade-off

For a category node (depth 0), approximately 36 of 46 columns are NULL. The node only uses: `id`, `estimate_id`, `parent_id` (null for root), `sort_order`, `name`, `node_type`, `created_at`, `updated_at`, `created_by`, and potentially `bid_allowance_estimate`.

All quantity fields, cost fields, formula fields, documentation fields, catalog fields, and purchasing fields are NULL on non-leaf nodes. This is the primary cost of the monolithic design: storage waste and schema ambiguity (the table definition doesn't tell you which columns are relevant per node type).

> **Comparison Note:** An alternative design would use table-per-type (separate `categories`, `sections`, `assemblies`, `items` tables) or table inheritance. The monolithic approach was chosen because tree operations (move, re-parent, indent) only update `parent_id` and `sort_order` on one row regardless of type. With separate tables, changing a section to an assembly would require cross-table migration.

---

## 4. Tree Hierarchy System

### 4.1 Valid Child Types (Application-Enforced)

```typescript
// src/types/estimate-node.ts:82-87
export const VALID_CHILD_TYPES: Record<NodeType, NodeType[]> = {
  category: ['section', 'assembly'],
  section: ['assembly', 'item'],
  assembly: ['assembly', 'item'],   // ← recursive nesting
  item: [],                          // ← always leaf
};
```

This produces the containment graph:

```
category
  ├── section
  │     ├── assembly
  │     │     ├── assembly  (recursive)
  │     │     └── item      (leaf)
  │     └── item            (leaf)
  └── assembly
        ├── assembly        (recursive)
        └── item            (leaf)
```

**Key properties:**
1. `item` is always a leaf — cannot have children
2. `category` is always a root-level container — never nested inside another node
3. `assembly` is the only self-referential type — enables unbounded nesting depth
4. `section` cannot contain other sections — no section-in-section nesting
5. The database does NOT enforce these rules — the `valid_hierarchy` constraint only ensures items have parents

> **Comparison Note:** The soloway-proposals system uses a fixed 5-level hierarchy (Division, Subdivision, Assembly, Item, Sub-item) with a stored `hierarchy_level` column (0-4). The estimating platform's approach is fundamentally different: depth is derived at runtime, not stored, and there is no maximum depth.

### 4.2 buildTree() Algorithm

**File:** `src/lib/utils/tree.ts:10-65`

Converts flat `EstimateNode[]` from Supabase into nested `TreeNode[]`. Three passes:

**Pass 1 — Node Conversion (O(n)):**
```typescript
const nodeMap = new Map<string, TreeNode>();
for (const node of nodes) {
  nodeMap.set(node.id, { ...node, children: [], depth: 0 });
}
```

**Pass 2 — Parent-Child Linking (O(n)):**
```typescript
for (const node of nodes) {
  const treeNode = nodeMap.get(node.id);
  if (node.parent_id) {
    const parent = nodeMap.get(node.parent_id);
    if (parent) {
      parent.children.push(treeNode);
      treeNode.depth = parent.depth + 1;
    }
    // Orphaned nodes (parent_id not in array) silently disappear
  } else {
    rootNodes.push(treeNode);
  }
}
```

**Pass 3 — Sort + Depth Fix (O(n log n)):**
```typescript
const sortChildren = (nodes: TreeNode[]) => {
  nodes.sort((a, b) => a.sort_order - b.sort_order);
  for (const node of nodes) sortChildren(node.children);
};
sortChildren(rootNodes);

const updateDepths = (nodes: TreeNode[], depth: number) => {
  for (const node of nodes) {
    node.depth = depth;
    updateDepths(node.children, depth + 1);
  }
};
updateDepths(rootNodes, 0);
```

**Overall complexity:** O(n log n) time, O(n) space.

**Orphan handling:** If a node's `parent_id` points to a non-existent node (e.g., parent was deleted but child wasn't), the child silently disappears. No error, no recovery.

### 4.3 TreeNode Type

```typescript
// src/types/estimate-node.ts:15-18
export interface TreeNode extends EstimateNode {
  children: TreeNode[];   // populated by buildTree
  depth: number;          // computed at build time, NOT stored in DB
}
```

### 4.4 Supporting Tree Utilities

| Function | File:Line | Purpose |
|----------|-----------|---------|
| `flattenTree(tree)` | tree.ts:70-86 | Depth-first → flat `EstimateNode[]` for serialization |
| `findNode(tree, id)` | tree.ts:91-102 | Recursive DFS by ID, O(n) worst case |
| `generateRowNumbers(tree)` | tree.ts:107-124 | Dot-notation numbering (1, 1.1, 1.1.1) — 1-indexed |
| `getAncestorIds(nodes, id)` | tree.ts:129-144 | Walk parent chain upward |
| `getDescendantIds(nodes, id)` | tree.ts:149-172 | Recursive child collection |
| `getNextSortOrder(nodes, parentId)` | tree.ts:177-181 | Max sort_order + 1 among siblings |

**Row numbering:** `generateRowNumbers` computes hierarchical dot-notation from the tree structure. The database's `row_number` column is stored but unused by the tree renderer.

### 4.5 Expand/Collapse

- State: `expandedIds: Set<string>` — initialized empty (all collapsed)
- Toggle: simple add/remove from set
- No persistence — expand state resets on navigation/refresh
- No "expand all" or "collapse all" functionality
- No deep expand (expanding a parent does not auto-expand children)

### 4.6 Movement Operations

**Move Up/Down:** Swap `sort_order` with adjacent sibling. Delegates to `moveNode()` server action.

**Indent:** Move node to be a child of its previous sibling. Appends at end of new parent's children (max sort_order + 1). Auto-expands the new parent.

**Outdent:** Move node to be a sibling of its current parent. Uses midpoint sort_order calculation to place the node after its former parent:
```typescript
newSortOrder = (parent.sort_order + nextSibling.sort_order) / 2;
```

> **Comparison Note:** The midpoint calculation produces fractional sort_order values. Over many operations, sort_order values drift from integers. No compaction/renumbering is implemented. A simpler system might re-index all siblings after each move; this system optimizes for fewer writes at the cost of value drift.

### 4.7 Keyboard Navigation

Two-phase design:

| Phase | Context | Keys | Handler |
|-------|---------|------|---------|
| Phase 1 (Inline Edit) | While editing a field | Tab, Shift+Tab, Enter, Backspace (empty) | InlineEdit component |
| Phase 2 (Row level) | When row is focused, not editing | ArrowUp/Down, Enter, Backspace (empty) | useKeyboardNavigation hook |

Navigation uses `flatNodes` — a depth-first, expansion-aware list. Collapsed children are invisible to keyboard traversal.

---

## 5. Data Flow

### 5.1 Server -> Client Initial Load

```
Browser → Next.js route /projects/[projectId]/estimates/[estimateId]
  → Server Component (EstimateEditorPage)
    → Promise.all([getProject, getEstimate, getNodes])
      → Authorization: getRequestContext() → requireEstimateAccess()
      → Three parallel Supabase queries (org-scoped via RLS)
    → Validates: project exists, estimate exists, estimate belongs to project
    → Passes props to Client Component:
      <EstimateEditorClient project={...} estimate={...} initialNodes={[...]} />
```

### 5.2 Client State Management

**Primary state (EstimateEditorClient):**

| State | Type | Source | Purpose |
|-------|------|--------|---------|
| `nodes` | `EstimateNode[]` | `initialNodes` prop | Primary flat node array |
| `estimate` | `Estimate` | `initialEstimate` prop | Estimate metadata |
| `broadOptions` | `BroadOption[]` | Lazy-loaded | Options panel data |
| `parameters` | `Parameter[]` | Lazy-loaded | Project parameters |
| `optionSets` | `OptionSet[]` | Lazy-loaded | Saved option combinations |

**Derived state (useEstimateTree hook, memoized):**

| Derived | Source | Computation |
|---------|--------|-------------|
| `tree: TreeNode[]` | `nodes` | `buildTree(nodes)` |
| `rowNumbers: Map<string, string>` | `tree` | `generateRowNumbers(tree)` |
| `flatNodes: TreeNode[]` | `tree` + `expandedIds` | Depth-first visible-only list |
| `siblingsMap: Map<string, TreeNode[]>` | `tree` | Each node ID -> sibling array |
| `parentMap: Map<string, TreeNode\|null>` | `tree` | Each node ID -> parent |

### 5.3 Mutation Lifecycle

The platform uses **server-confirmed updates**, not optimistic updates. The pattern:

1. User action triggers server action call (client `await`s)
2. Server: auth check -> validate -> mutate -> recalculate if needed -> return
3. Client: on success, update local state with server-returned data

| Operation | Server Action | Client Update | Triggers Recalc? |
|-----------|--------------|---------------|-------------------|
| Create node | `createNode(estimateId, input)` | Append `result.data` to array | YES (if has parent) |
| Update node | `updateNode(nodeId, input)` | Replace node in array | YES (if qty/cost/markup changed) |
| Delete node | `deleteNode(nodeId)` | Remove node + descendants | YES (if had parent) |
| Move node | `moveNode(nodeId, newParentId, sortOrder)` | Patch parent_id + sort_order | **NO** (gap!) |
| Duplicate node | `duplicateNode(nodeId)` | Append root copy only | **NO** |
| Catalog add | `instantiateCatalogItem/Assembly()` | Full `refreshNodes()` | YES |
| Toggle option | Toggle server action | Full `refreshNodes()` | Via refresh |

### 5.4 Server Action Signatures

```typescript
// All return ActionResult<T> = { success: true; data: T } | { success: false; error: string }

getNodes(estimateId: string): Promise<ActionResult<EstimateNode[]>>
createNode(estimateId: string, input: CreateNodeInput): Promise<ActionResult<EstimateNode>>
updateNode(nodeId: string, input: UpdateNodeInput): Promise<ActionResult<EstimateNode>>
deleteNode(nodeId: string): Promise<ActionResult<void>>
moveNode(nodeId: string, newParentId: string | null, newSortOrder: number): Promise<ActionResult<void>>
duplicateNode(nodeId: string): Promise<ActionResult<EstimateNode>>
```

### 5.5 Recalculation Engine

**Files:** `src/lib/calculations/engine.ts`, `src/lib/calculations/cascade.ts`, `src/lib/calculations/aggregation.ts`

`recalculateEntireTree(nodes)` processes bottom-up:
1. Build `childrenMap` (parent_id -> children)
2. Compute depth for each node
3. Process deepest leaves first, then parents:
   - **Leaf:** `calculateNodeFields(node)` — applies `qty * cost` formula
   - **Parent:** `aggregateFromNodes(children)` — SUM of children's cost fields
4. Returns `Map<nodeId, CalculatedFields>`

**Aggregation rules:**
- Currency fields: SUM of children
- `unit_price`: null for parents
- Markup percentages on parents: reverse-calculated from totals (display-only)

After recalculation, each changed node is updated individually via separate Supabase calls. For a tree with N ancestors, this means N+1 database round trips.

### 5.6 Known Gaps

1. **Move does not trigger recalculation.** Moving a $10K item between categories leaves both categories' totals stale until the next recalc-triggering edit.
2. **Duplicate adds only root to client.** Descendant copies exist in the database but aren't reflected in the UI until a full refresh.
3. **No user-visible error handling.** All error paths use `logger.error()` (console). No toast or inline error shown.
4. **Estimate-level totals not synced.** Node recalculation updates `estimate_nodes` but does not roll up to the `estimates` table's `total_price`.
5. **No optimistic updates.** Users experience a delay between editing and seeing updated values, especially for large trees.

---

## 6. Options Architecture

### 6.1 Three-Layer Design

```
Layer 1: Broad Options (estimate-wide)
  │  Toggle is_active on/off
  │  Overrides project parameter values
  │  Affects ALL formula-driven calculations
  │
  ▼
Layer 2: Inline Options (per-node)
  │  Attached to individual leaf items
  │  Absolute ($) or percentage (%) cost adjustment
  │  Applied AFTER formula calculation
  │
  ▼
Layer 3: Option Sets (saved snapshots)
     Captures which broad + inline options are active
     Apply to quickly switch between scenarios
     Comparison view shows side-by-side totals
```

### 6.2 Broad Options

**Table: `broad_options`** — 10 columns

| Column | Type | Nullable | Default | Key Info |
|--------|------|----------|---------|----------|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `estimate_id` | UUID | NO | — | FK -> estimates |
| `name` | VARCHAR(255) | NO | — | UNIQUE per estimate |
| `description` | TEXT | YES | — | — |
| `is_active` | BOOLEAN | YES | `FALSE` | Toggle for activation |
| `parameter_overrides` | JSONB | YES | `'[]'::jsonb` | Array of override objects |
| `sort_order` | INTEGER | YES | `0` | — |
| `created_at` | TIMESTAMPTZ | YES | `NOW()` | — |
| `updated_at` | TIMESTAMPTZ | YES | `NOW()` | — |
| `created_by` | UUID | YES | — | FK -> auth.users |

**`parameter_overrides` JSONB structure:**
```typescript
interface ParameterOverride {
  parameterId: string;      // UUID of project_parameters row
  parameterName: string;    // Denormalized display name
  originalValue: number;    // Snapshot at override creation
  overrideValue: number;    // Replacement value when active
  unit?: string | null;
}
```

Multiple broad options can be active simultaneously. If they override the same parameter, later options take precedence (last-writer-wins).

### 6.3 Inline Options

**Table: `inline_options`** — 10 columns

| Column | Type | Nullable | Default | Key Info |
|--------|------|----------|---------|----------|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `node_id` | UUID | NO | — | FK -> estimate_nodes |
| `name` | VARCHAR(255) | NO | — | UNIQUE per node |
| `description` | TEXT | YES | — | — |
| `cost_adjustment` | DECIMAL(15,2) | NO | `0` | Adjustment value |
| `adjustment_type` | VARCHAR(20) | NO | `'absolute'` | CHECK: `('absolute','percentage')` |
| `is_selected` | BOOLEAN | YES | `FALSE` | Currently active? |
| `selection_locked` | BOOLEAN | YES | `FALSE` | Prevents toggling |
| `sort_order` | INTEGER | YES | `0` | — |
| `created_at` / `updated_at` | TIMESTAMPTZ | YES | `NOW()` | — |

**Cost calculation:**
```typescript
function calculateAdjustedCost(baseCost: number, options: InlineOption[]): number {
  let adjustedCost = baseCost;
  for (const option of options.filter(o => o.is_selected)) {
    if (option.adjustment_type === 'absolute') {
      adjustedCost += option.cost_adjustment;
    } else {
      adjustedCost += baseCost * (option.cost_adjustment / 100);  // Always from baseCost
    }
  }
  return adjustedCost;
}
```

Multiple selected options are **additive**. Percentage adjustments always reference `baseCost`, not a running total.

**Example:** base $1000, option A = +$200 (absolute), option B = +10% (percentage) => $1000 + $200 + $100 = $1300.

> **Comparison Note:** An alternative would be multiplicative chaining (each option compounds on the previous). The additive approach is simpler and more predictable but limits complex pricing scenarios.

### 6.4 Option Sets

**Table: `option_sets`** — 9 columns

| Column | Type | Nullable | Default | Key Info |
|--------|------|----------|---------|----------|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `estimate_id` | UUID | NO | — | FK -> estimates |
| `name` | VARCHAR(255) | NO | — | UNIQUE per estimate |
| `description` | TEXT | YES | — | — |
| `broad_option_ids` | UUID[] | YES | `'{}'` | **Native PG array** (only array column in schema) |
| `inline_selections` | JSONB | YES | `'{}'::jsonb` | `{ optionId: boolean }` map |
| `is_default` | BOOLEAN | YES | `FALSE` | Default scenario flag |
| `sort_order` | INTEGER | YES | `0` | — |
| `created_at` / `updated_at` | TIMESTAMPTZ | YES | `NOW()` | — |

> **Comparison Note:** `broad_option_ids` uses a native PostgreSQL UUID array (`UUID[]`), not JSONB. This is the only array column in the schema. The alternative would be JSONB or a junction table. UUID[] enables `ANY()` / `@>` array operators but is less portable than JSONB.

### 6.5 Options Comparison

The comparison view builds scenarios from: base estimate (no options), current selection, each saved option set, and individual broad options (if <= 5). For each scenario, it shows total, difference from base, and color-coded cost impact.

---

## 7. Catalog System

### 7.1 Design Principle: Copy-on-Instantiate

Catalog items and assemblies are **templates**. When added to an estimate, all values are **copied** into the `estimate_nodes` row. The catalog source is tracked via soft reference (`catalog_source_id`, `catalog_source_type`, `catalog_version`) but there is no FK constraint.

This means:
- Deleting a catalog item does NOT affect any estimates
- Changes to catalog items do NOT auto-propagate
- Sync is explicit and user-initiated (pull, push, revert, unlink)

### 7.2 catalog_items (23 columns)

Key fields beyond standard metadata:

| Column | Type | Purpose |
|--------|------|---------|
| `sku` | VARCHAR(100) | Product identifier |
| `category` / `subcategory` | VARCHAR(100) | Classification |
| `tags` | JSONB | Array of string tags |
| `default_unit` | VARCHAR(50) | Unit when instantiated |
| `default_cost` | DECIMAL(15,4) | Cost when instantiated |
| `default_cost_type` | VARCHAR(20) | Material/Labor/Equipment/Subcontractor/Other |
| `cost_formula` / `qty_formula` | TEXT | Formula templates |
| `unit_parameters_template` | JSONB | Parameter template copied to node |
| `default_waste_factor` | DECIMAL(5,4) | Waste multiplier |
| `specifications` | TEXT | Material specs |
| `manufacturer` / `manufacturer_url` | VARCHAR/TEXT | Vendor info |
| `version` | INTEGER | Incrementing version number |
| `is_active` | BOOLEAN | Soft-delete flag |

**Full-text search index:**
```sql
CREATE INDEX idx_catalog_items_search ON catalog_items
  USING gin(to_tsvector('english', name || ' ' || COALESCE(description, '')));
```

This is the only FTS index in the schema.

### 7.3 catalog_assemblies (14 columns)

Similar to items but with assembly-specific fields:

| Column | Type | Purpose |
|--------|------|---------|
| `output_unit` | VARCHAR(50) | What one assembly produces |
| `output_qty_per_assembly` | DECIMAL(15,4) | Output quantity per unit |
| `parameters_template` | JSONB | Assembly parameter template |
| `max_depth` | INTEGER | Advisory nesting limit (default 5) |

### 7.4 catalog_assembly_components (11 columns)

Junction table with XOR constraint:

```sql
CONSTRAINT component_type_check CHECK (
  (catalog_item_id IS NOT NULL AND nested_assembly_id IS NULL) OR
  (catalog_item_id IS NULL AND nested_assembly_id IS NOT NULL)
)
```

Each component is either a catalog item OR a nested assembly, never both. The `no_self_reference` constraint prevents direct self-nesting but NOT indirect cycles (A -> B -> A).

Override fields allow customization when the component is instantiated:
- `name_override`, `cost_override`, `unit_override` — replace catalog defaults
- `qty_per_assembly` — how many per parent assembly
- `qty_formula` — formula-based quantity alternative

### 7.5 Instantiation

**`instantiateCatalogItem()`** — Creates a single `estimate_nodes` row:
1. Copies all catalog defaults (name, unit, cost, type, waste_factor, specs, parameters)
2. Sets `catalog_source_id`, `catalog_source_type = 'item'`, `catalog_sync_enabled = true`
3. Default qty = 1, node_type = 'item'
4. Triggers full tree recalculation

**`instantiateCatalogAssembly()`** — Creates a node tree:
1. Creates assembly node (node_type = 'assembly')
2. For each component: creates child item or recursively instantiates nested assemblies
3. Depth limit: `MAX_ASSEMBLY_DEPTH = 5`
4. Triggers full tree recalculation after all nodes created

### 7.6 Sync Operations

| Action | Direction | Effect |
|--------|-----------|--------|
| `updateFromCatalog` | Catalog -> Node | Pulls latest catalog values. **Preserves qty.** |
| `pushToCatalog` | Node -> Catalog | Pushes node values to catalog. **Affects all future instantiations.** |
| `revertToCatalog` | Catalog -> Node | Full reset including qty (to 1 or output_qty) |
| `unlinkFromCatalog` | — | Clears catalog_source_id, disables sync |
| `hasChangesFromCatalog` | — | Comparison check returning `{ hasChanges, changes[] }` |

---

## 8. Supporting Tables

### 8.1 organizations (6 columns)

Multi-tenancy root. ALL data is scoped to an organization via FK chains.

| Column | Type | Key Info |
|--------|------|----------|
| `id` | UUID | PK |
| `name` | VARCHAR(255) | — |
| `slug` | VARCHAR(100) | UNIQUE |
| `settings` | JSONB | Freeform, default `'{}'` |

No INSERT or DELETE RLS policies — organizations are created by service-role only.

Seed data: `slug='szostak-build'`, `name='Szostak Build, LLC'`.

### 8.2 projects (21 columns)

| Column | Type | Key Info |
|--------|------|----------|
| `id` | UUID | PK |
| `organization_id` | UUID | FK -> organizations, NOT NULL |
| `name` | VARCHAR(255) | NOT NULL |
| `project_number` | VARCHAR(50) | — |
| `client_name` / `client_email` / `client_phone` | VARCHAR | Client info |
| `address_line1` through `country` | VARCHAR | Project address (default country 'USA') |
| `status` | VARCHAR(50) | CHECK: `('active','archived','completed','on_hold')` |
| `start_date` / `target_completion_date` | DATE | — |
| `settings` | JSONB | Freeform |
| `created_by` | UUID | FK -> auth.users |

> **Comparison Note:** The soloway-proposals system uses `status` values (`sent`, `viewed`, `approved`) for public visibility gating via RLS. This system uses internal status values (`active`, `archived`, etc.) and requires authentication for all access — there is no public-facing RLS.

### 8.3 estimates (18 columns)

| Column | Type | Key Info |
|--------|------|----------|
| `id` | UUID | PK |
| `project_id` | UUID | FK -> projects |
| `name` | VARCHAR(255) | — |
| `version_number` | INTEGER | Default 1 |
| `status` | VARCHAR(50) | 7 values: draft, pending_review, approved, sent, accepted, rejected, archived |
| `subtotal_cost` / `total_contingency` / `total_overhead` / `total_price` | DECIMAL(15,2) | Estimate-level totals |
| `global_contingency_markup` / `global_overhead_markup` / `global_profit_markup` | DECIMAL(5,4) | Estimate-wide rates |
| `column_config` | JSONB | UI column visibility config |
| `view_settings` | JSONB | UI display preferences |
| `is_current_version` | BOOLEAN | Default TRUE, partial index |
| `parent_estimate_id` | UUID | Self-ref FK for version chain |

**Versioning:** Linked-list model via `parent_estimate_id`. New version points to old; old version flips `is_current_version` to FALSE.

### 8.4 units_of_measure (11 columns)

System units (`organization_id = NULL`) plus org-specific custom units.

| Category | Units |
|----------|-------|
| Length | IN, FT, LF, YD |
| Area | SQIN, SF, SY |
| Volume | CUIN, CF, CY, GAL |
| Weight | LB, OZ, TON |
| Count | EA, PR, SET, DZ, BOX, BDL |
| Time | HR, DAY, WK |

Self-referential `base_unit_id` for conversion chains. UNIQUE on `(organization_id, symbol)`.

### 8.5 unit_conversions (7 columns)

Conversion factors between units. System-level (org = NULL) + org-specific. UNIQUE on `(organization_id, from_unit_id, to_unit_id)` with `no_self_conversion` CHECK.

### 8.6 project_parameters (13 columns)

Named takeoff values referenced in formulas. Project-scoped.

| Key Constraint | Definition |
|---------------|-----------|
| `unique_param_name` | UNIQUE on `(project_id, name)` |
| `valid_param_name` | CHECK: `name ~ '^[A-Za-z_][A-Za-z0-9_]*$'` (identifier-safe for formulas) |

### 8.7 contracts (14 columns)

Project-scoped contract records with PDF file metadata (`file_path`, `file_name`, `file_size`, `file_type`). Storage bucket `contract-files` is documented in migration 003 but must be manually created in Supabase dashboard.

---

## 9. Database Infrastructure

### 9.1 RLS Policy Architecture (The Org-Chain Pattern)

All RLS policies ultimately check organization membership via the `get_user_organization_id()` function:

```sql
-- SECURITY DEFINER function (bypasses RLS to avoid recursion)
CREATE OR REPLACE FUNCTION get_user_organization_id()
RETURNS UUID
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id FROM user_profiles WHERE id = auth.uid()
$$;
```

**The chain:**

```
get_user_organization_id()    ← SECURITY DEFINER, reads user_profiles bypassing RLS
    ↓
organizations:    id = get_user_organization_id()
projects:         organization_id = get_user_organization_id()
estimates:        project_id IN (SELECT id FROM projects WHERE org = get_user_org())
estimate_nodes:   estimate_id IN (estimates JOIN projects WHERE org = get_user_org())
inline_options:   EXISTS (nodes JOIN estimates JOIN projects JOIN user_profiles)  ← 4-hop!
```

**RLS recursion backstory:** The original schema had `user_profiles` RLS policies that queried `user_profiles`, causing infinite recursion. Two migrations (20260119182818 and 20260119183153) fixed this by creating the SECURITY DEFINER function and rewriting all policies.

**Inconsistency:** The three options tables (migration 001) still use the older EXISTS/JOIN pattern instead of `get_user_organization_id()`. They work because the JOIN filters by `auth.uid()` first, but they're inconsistent with the rest of the schema.

### 9.2 Role-Based Write Gating

Only the options tables enforce role checks:

| Table | Write Policy |
|-------|-------------|
| `broad_options` | `role IN ('owner','admin','member')` — viewers excluded |
| `inline_options` | Same |
| `option_sets` | Same |
| All other tables | Any authenticated org member can write |

### 9.3 Functions & Triggers

| Function | Type | Purpose |
|----------|------|---------|
| `update_updated_at_column()` | TRIGGER | Sets `updated_at = NOW()` on every UPDATE |
| `handle_new_user()` | TRIGGER | Auto-creates user_profile on auth.users INSERT, assigns default org |
| `get_user_organization_id()` | SQL/STABLE | SECURITY DEFINER function for RLS (anti-recursion) |

Every table has a `BEFORE UPDATE` trigger calling `update_updated_at_column()`.

### 9.4 Index Summary

| Index | Table | Type | Purpose |
|-------|-------|------|---------|
| `idx_nodes_sort` | estimate_nodes | Composite (estimate_id, parent_id, sort_order) | Tree-ordered queries |
| `idx_nodes_reference` | estimate_nodes | Partial (WHERE is_active_reference = TRUE) | Active reference lookup |
| `idx_estimates_current` | estimates | Partial (WHERE is_current_version = TRUE) | Current version lookup |
| `idx_catalog_items_search` | catalog_items | GIN (full-text) | Catalog text search |
| `idx_catalog_items_active` | catalog_items | Partial (WHERE is_active = TRUE) | Active items only |

### 9.5 Realtime

No Realtime publications are configured in the schema. All data flow is request-response via server actions.

---

## 10. Design Decisions & Trade-offs

### 10.1 Why a Monolithic estimate_nodes Table?

**Decision:** One table for all node types (category, section, assembly, item) with 46 columns.

**Trade-off:**
- (+) Tree operations (move, indent, outdent, re-parent) only update `parent_id` and `sort_order` on one row, regardless of type
- (+) No cross-table joins for tree traversal — single SELECT with ORDER BY fetches the entire tree
- (+) Changing a node's type (if needed) is a column update, not a cross-table migration
- (-) ~36 columns are NULL for non-leaf nodes (storage waste, schema ambiguity)
- (-) The table definition doesn't tell you which columns are relevant per node type
- (-) All node queries fetch all 46 columns via `SELECT *`

**Alternative:** Table-per-type (separate `categories`, `sections`, `assemblies`, `items` tables joined by a shared `nodes` table with `parent_id`). This would enforce column relevance per type but make tree traversal require multi-table joins.

### 10.2 Why UUID Self-Referential FKs?

**Decision:** `estimate_nodes.parent_id` references `estimate_nodes.id` with ON DELETE CASCADE.

**Trade-off:**
- (+) CASCADE delete removes entire subtrees automatically — simple delete semantics
- (+) Tree integrity is enforced by the database (no orphans possible via FK)
- (-) CASCADE is irreversible — no soft-delete recovery
- (-) Accidental parent delete destroys all descendants

### 10.3 Why Separate Options Tables?

**Decision:** Three tables (`broad_options`, `inline_options`, `option_sets`) rather than columns on `estimate_nodes` or a single polymorphic `options` table.

**Trade-off:**
- (+) Clean separation of concerns — each table has exactly the columns its option type needs
- (+) 1:N relationships are natural (multiple inline options per node, multiple broad options per estimate)
- (-) More tables to maintain and query
- (-) Option sets store denormalized references (UUID arrays, JSONB maps) rather than normalized junction tables

### 10.4 JSONB Usage — Pros and Cons

JSONB is used for: `settings` (3 tables), `column_config`, `view_settings`, `links`, `attachments`, `bid_file`, `unit_parameters`, `assembly_parameters`, `tags`, `parameter_overrides`, `inline_selections`.

**Pros:**
- Schema flexibility — JSONB columns can evolve without migrations
- Natural fit for arrays (links, tags, attachments) and key-value maps (parameters)
- PostgreSQL JSONB operators enable querying inside the values

**Cons:**
- No referential integrity inside JSONB (parameter IDs in overrides, option IDs in selections)
- No type checking at the database level — invalid JSON structures are only caught in application code
- Schema documentation is the only contract for JSONB structure

### 10.5 The NULL Density Trade-off

A typical estimate might have 10 categories, 30 sections, 50 assemblies, and 200 items = 290 nodes. Of these, ~90 are non-leaf (category/section/assembly) and each has ~36 NULL columns. That's ~3,240 NULL column values stored.

This is acceptable for PostgreSQL (NULLs are stored as bitmap flags, not full column width) but creates cognitive overhead when reading the schema — you must know which columns apply to which node type.

### 10.6 Server-Side-Only Calculation

**Decision:** The client never computes monetary values. All calculations run in server actions.

**Trade-off:**
- (+) Single source of truth — no client/server calculation drift
- (+) Calculation logic can be complex without bundle size impact
- (-) Every edit requires a server round trip before showing updated values
- (-) Full tree recalculation + node-by-node DB updates can be slow for large trees
- (-) No optimistic display of calculated values during network latency

### 10.7 No Database-Level Aggregation

**Decision:** No triggers for automatic parent aggregation. All aggregation happens in application code via `recalculateEntireTree()`.

**Trade-off:**
- (+) Simpler database schema — no trigger chain complexity
- (+) Calculation logic is visible and testable in TypeScript
- (-) Every calculation-affecting mutation must remember to call recalculation
- (-) `moveNode()` currently does NOT recalculate, leaving parent totals stale
- (-) Each node update after recalculation is a separate DB call (N+1 problem)
