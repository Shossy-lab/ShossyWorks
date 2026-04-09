# Client Visibility and Filtering Research

## Problem Statement

The `client_visibility` field on `estimate_nodes` controls what clients see when viewing an estimate. The current architecture specifies a 3-value VARCHAR (`visible`, `hidden`, `summary_only`), while the Business Logic analyst proposes a 4th value (`allowance_view`) for allowance items. The exact field-level semantics of each visibility state are undefined, inheritance behavior is unspecified, RLS enforcement on detail tables for `summary_only` nodes is unresolved, and the new `node_notes` table introduces a separate visibility surface that must integrate cleanly.

---

## Research Question 1: 3-Value vs 4-Value `client_visibility`

### Recommendation: 3 values. Defer `allowance_view`.

**Rationale:**

1. **`summary_only` covers the allowance case at 90%+.** A `summary_only` allowance node shows `name` + `total_price` to the client. The client sees "Lighting Fixtures Allowance: $8,000." That is the contract-standard allowance presentation.

2. **Allowance-specific display is a UI concern, not a visibility concern.** The distinction between "show name + total" (`summary_only`) and "show budget + selection status + overage" (`allowance_view`) is about *which fields to render*, not *whether the node is accessible*. Both states block cost breakdown details. The difference is presentation logic that belongs in the client-facing component, not in an RLS column.

3. **Adding enum values is cheap; removing them is expensive.** Starting with 3 values and adding a 4th later if needed requires one ALTER + CHECK update. Starting with 4 and discovering the 4th is unused creates a permanent dead value in the schema.

4. **The `allowance_view` fields (`allowance_budget`, `allowance_status`) live on `node_item_details`, not the base table.** A visibility enum on the base table that controls detail-table field exposure creates a cross-table coupling that complicates both RLS policies and application logic. Better to handle this with a client-side rendering rule: "if `bid_type = 'allowance'` AND `client_visibility = 'summary_only'`, render the allowance-specific view."

5. **Consensus:** The comprehensive analysis (Decision 5) already recommends 3 values. The Business Logic analyst's proposal is explicitly deferred to 1B+.

### CHECK Constraint (Final)

```sql
CONSTRAINT valid_visibility CHECK (client_visibility IN ('visible', 'hidden', 'summary_only'))
```

Column definition:
```sql
client_visibility VARCHAR(20) NOT NULL DEFAULT 'visible'
```

---

## Research Question 2: Exact Fields per Visibility State

### Field Visibility Matrix

The core principle: **`client_visibility` controls access at the node level (base table) and gates access to detail tables entirely.** It does NOT selectively null individual columns -- it is a binary gate on detail table access plus a field-filter on the base table.

#### `visible` -- Client sees full client-safe data

**Base table (`estimate_nodes`) fields exposed:**

| Field | Exposed? | Notes |
|-------|----------|-------|
| `id` | YES | Needed for tree rendering, commenting |
| `estimate_id` | YES | Context |
| `parent_id` | YES | Tree structure |
| `sort_order` | YES | Ordering |
| `node_type` | YES | Rendering type (group/assembly/item) |
| `name` | YES | Display |
| `description` | YES | Client may need context |
| `phase_id` | YES | Classification context |
| `cost_code_id` | NO | Internal builder classification |
| `client_visibility` | NO | Internal control field |
| `subtotal` | NO | Internal cost figure (pre-markup) |
| `contingency_amount` | NO | Internal cost figure |
| `overhead_amount` | NO | Internal cost figure |
| `total_price` | YES | The client-facing price |
| `reference_name` | NO | Formula system internals |
| `catalog_source_id` | NO | Catalog internals |
| `catalog_source_type` | NO | Catalog internals |
| `catalog_version` | NO | Catalog internals |
| `path` | NO | ltree internals |

**Detail table (`node_item_details`) fields exposed:**

| Field | Exposed? | Notes |
|-------|----------|-------|
| `qty` | YES | "You need 1,200 SF of flooring" |
| `unit_id` | YES | Unit label for qty display |
| `unit_price` | YES | Client-facing per-unit price |
| `bid_type` | YES | Client needs to know if it is an allowance |
| `allowance_budget` | YES | Contract allowance amount |
| `allowance_status` | YES | Selection tracking |
| `specifications` | YES | Material specs are client-relevant |
| `instructions` | NO | Builder installation notes |
| `unit_cost` | NO | Builder's wholesale cost |
| `cost_formula` | NO | Internal |
| `qty_formula` | NO | Internal |
| `qty_mode` | NO | Internal |
| `raw_qty` | NO | Internal |
| `ratio_numerator` | NO | Internal |
| `ratio_denominator` | NO | Internal |
| `contingency_rate` | NO | Internal markup |
| `overhead_rate` | NO | Internal markup |
| `waste_factor` | NO | Internal |
| `min_order_qty` | NO | Internal |
| `package_size` | NO | Internal |
| `package_unit_id` | NO | Internal |
| `cost_type` | NO | Internal classification |
| `vendor_id` | NO | Internal supplier info |

**Detail table (`node_assembly_details`) fields exposed:**

| Field | Exposed? | Notes |
|-------|----------|-------|
| `assembly_qty` | YES | "1,200 SF of wall" |
| `assembly_unit_id` | YES | Unit label |
| `derived_unit_cost` | NO | Internal cost figure |
| `qty_formula` | NO | Internal |

#### `summary_only` -- Client sees name + total only

**Base table fields exposed:** `id`, `estimate_id`, `parent_id`, `sort_order`, `node_type`, `name`, `total_price`

**Detail tables:** BLOCKED entirely. Client cannot access `node_item_details` or `node_assembly_details` for this node. No quantity, no unit price, no specifications, no allowance details. The client sees a single line: "Rough Carpentry: $45,000."

**Special case -- allowance items with `summary_only`:** The client sees "Lighting Allowance: $8,000" but NOT the budget/status/overage breakdown. If the builder wants clients to see allowance specifics, they set the node to `visible`, and the application renders the allowance-specific view based on `bid_type = 'allowance'`.

#### `hidden` -- Client sees nothing

The node is completely invisible to the client. RLS blocks the row entirely. The node's `total_price` is still included in parent aggregations (the parent shows the total, but the hidden child is not listed). This is critical for builder-internal items like "Builder's Profit" or "Contingency Reserve."

### Implementation: PostgreSQL VIEW for Client Access

Rather than trying to null individual columns via RLS (which PostgreSQL does not support -- RLS is row-level, not column-level), use a PostgreSQL VIEW that exposes only client-safe columns. The RLS policy on the base table handles row filtering; the VIEW handles column filtering.

```sql
-- Client-safe view of estimate_nodes (column filtering)
CREATE OR REPLACE VIEW client_estimate_nodes AS
SELECT
  id,
  estimate_id,
  parent_id,
  sort_order,
  node_type,
  name,
  CASE
    WHEN client_visibility = 'visible' THEN description
    ELSE NULL
  END AS description,
  CASE
    WHEN client_visibility = 'visible' THEN phase_id
    ELSE NULL
  END AS phase_id,
  total_price,
  client_visibility
FROM estimate_nodes
WHERE client_visibility != 'hidden';

-- Client-safe view of node_item_details (only for 'visible' nodes)
CREATE OR REPLACE VIEW client_node_item_details AS
SELECT
  nid.node_id,
  nid.qty,
  nid.unit_id,
  nid.unit_price,
  nid.bid_type,
  nid.allowance_budget,
  nid.allowance_status,
  nid.specifications
FROM node_item_details nid
JOIN estimate_nodes en ON en.id = nid.node_id
WHERE en.client_visibility = 'visible';

-- Client-safe view of node_assembly_details (only for 'visible' nodes)
CREATE OR REPLACE VIEW client_node_assembly_details AS
SELECT
  nad.node_id,
  nad.assembly_qty,
  nad.assembly_unit_id
FROM node_assembly_details nad
JOIN estimate_nodes en ON en.id = nad.node_id
WHERE en.client_visibility = 'visible';
```

**Why VIEWs over column-level RLS:** PostgreSQL RLS operates on rows, not columns. You cannot write an RLS policy that says "return this row but null column X." Supabase PostgREST can expose VIEWs as API endpoints just like tables. The VIEWs inherit the underlying table's RLS policies, so the client still needs row-level access to `estimate_nodes` (which the RLS policy below provides).

---

## Research Question 3: Visibility Inheritance

### Recommendation: Application-level inheritance on INSERT, no automatic trigger.

**The rule:** When a new node is created as a child of an existing node, it inherits the parent's `client_visibility` value as its default. The user can override this after creation.

**Why application-level, not a trigger:**

1. **Triggers fire on every INSERT, including deep-copy and snapshot restore.** The deep-copy function copies nodes with their existing `client_visibility` values. A trigger that overwrites `client_visibility` based on the parent would destroy the copied values. The deep-copy function already handles trigger bypass via `app.is_snapshot_copy`, but adding another trigger to bypass increases complexity.

2. **The inheritance is a UX convenience, not a data integrity rule.** Unlike "items must be leaves" (which is a structural invariant that must never be violated), visibility inheritance is a defaulting behavior. If a child has a different visibility than its parent, that is valid -- the builder may want a visible group with some hidden children.

3. **Re-parenting should NOT change visibility.** When a node is moved to a different parent, its visibility should stay the same. A trigger would need to detect "is this a new node or a re-parent?" which adds complexity for no integrity benefit.

4. **Bulk visibility changes use explicit UPDATE.** "Hide this entire section" should be an explicit `UPDATE estimate_nodes SET client_visibility = 'hidden' WHERE path <@ (ltree of parent node)`. This is clearer than a cascading trigger and gives the builder control.

### Application-Level Implementation

```typescript
// In the node creation mutation/server action
async function createNode(input: CreateNodeInput): Promise<MutationResult<EstimateNode>> {
  // If client_visibility not explicitly set, inherit from parent
  let visibility = input.clientVisibility;

  if (!visibility && input.parentId) {
    const parent = await getNode(input.parentId);
    if (parent) {
      visibility = parent.clientVisibility;
    }
  }

  // Default to 'visible' if no parent or no explicit value
  visibility = visibility ?? 'visible';

  // ... insert node with visibility value
}
```

### Bulk Visibility Update (ltree-powered)

```sql
-- Set all descendants of a node to a specific visibility
CREATE OR REPLACE FUNCTION set_subtree_visibility(
  p_node_id UUID,
  p_visibility VARCHAR(20)
)
RETURNS INTEGER AS $$
DECLARE
  v_path LTREE;
  v_count INTEGER;
BEGIN
  -- Validate visibility value
  IF p_visibility NOT IN ('visible', 'hidden', 'summary_only') THEN
    RAISE EXCEPTION 'Invalid visibility value: %', p_visibility;
  END IF;

  -- Get the node's path
  SELECT path INTO v_path FROM estimate_nodes WHERE id = p_node_id;
  IF v_path IS NULL THEN
    RAISE EXCEPTION 'Node not found: %', p_node_id;
  END IF;

  -- Update all descendants (including the node itself)
  UPDATE estimate_nodes
  SET client_visibility = p_visibility, updated_at = NOW()
  WHERE path <@ v_path;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;
```

---

## Research Question 4: RLS Policies for Client Role

### Policy on `estimate_nodes`

```sql
-- Clients see non-hidden nodes on estimates they have access to
CREATE POLICY client_read_nodes ON estimate_nodes
  FOR SELECT TO authenticated
  USING (
    CASE
      WHEN get_user_role() IN ('owner', 'employee') THEN TRUE
      ELSE (
        client_visibility != 'hidden'
        AND estimate_id IN (
          SELECT e.id FROM estimates e
          JOIN client_project_access cpa ON cpa.project_id = e.project_id
          WHERE cpa.user_id = auth.uid()
        )
      )
    END
  );
```

### Policy on `node_item_details`

```sql
-- Clients see item details ONLY for 'visible' nodes (not 'summary_only', not 'hidden')
CREATE POLICY client_read_item_details ON node_item_details
  FOR SELECT TO authenticated
  USING (
    CASE
      WHEN get_user_role() IN ('owner', 'employee') THEN TRUE
      ELSE EXISTS (
        SELECT 1 FROM estimate_nodes en
        WHERE en.id = node_item_details.node_id
          AND en.client_visibility = 'visible'
          AND en.estimate_id IN (
            SELECT e.id FROM estimates e
            JOIN client_project_access cpa ON cpa.project_id = e.project_id
            WHERE cpa.user_id = auth.uid()
          )
      )
    END
  );
```

### Policy on `node_assembly_details`

```sql
-- Same pattern as item details
CREATE POLICY client_read_assembly_details ON node_assembly_details
  FOR SELECT TO authenticated
  USING (
    CASE
      WHEN get_user_role() IN ('owner', 'employee') THEN TRUE
      ELSE EXISTS (
        SELECT 1 FROM estimate_nodes en
        WHERE en.id = node_assembly_details.node_id
          AND en.client_visibility = 'visible'
          AND en.estimate_id IN (
            SELECT e.id FROM estimates e
            JOIN client_project_access cpa ON cpa.project_id = e.project_id
            WHERE cpa.user_id = auth.uid()
          )
      )
    END
  );
```

### Key Design Decision: `summary_only` Blocks Detail Tables

The Security analyst's Finding 4 recommendation is correct: clients should see `name` + `total_price` for `summary_only` nodes but ZERO detail table data. The RLS policy on `node_item_details` and `node_assembly_details` checks `en.client_visibility = 'visible'` (equals, not `!=`), which means both `hidden` AND `summary_only` nodes have their detail rows blocked.

**Why this is correct:**
- `summary_only` means "show a rolled-up total." If the client could see `qty`, `unit_price`, `specifications`, they could reverse-engineer cost breakdowns. The whole point of `summary_only` is to hide the breakdown.
- The `client_estimate_nodes` VIEW (from Question 2) already nulls `description` and `phase_id` for `summary_only` nodes. Combined with blocked detail access, the client sees only `name`, `node_type`, and `total_price`.

### Performance Optimization: Security-Definer Function

Per the Performance analyst (Finding 6), the nested subqueries in RLS policies can be expensive for client users. For production client queries, use a SECURITY DEFINER function that validates access once and then returns the filtered tree:

```sql
-- Optimized client tree query (access check runs once, not per-row)
CREATE OR REPLACE FUNCTION get_client_estimate_tree(
  p_estimate_id UUID
)
RETURNS TABLE (
  id UUID,
  estimate_id UUID,
  parent_id UUID,
  sort_order INTEGER,
  node_type VARCHAR(20),
  name VARCHAR(255),
  description TEXT,
  phase_id UUID,
  total_price DECIMAL(15,4),
  client_visibility VARCHAR(20)
) AS $$
BEGIN
  -- Verify the calling user has access to this estimate's project
  IF NOT EXISTS (
    SELECT 1 FROM estimates e
    JOIN client_project_access cpa ON cpa.project_id = e.project_id
    WHERE e.id = p_estimate_id AND cpa.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Return filtered tree (access already verified)
  RETURN QUERY
  SELECT
    en.id,
    en.estimate_id,
    en.parent_id,
    en.sort_order,
    en.node_type,
    en.name,
    CASE WHEN en.client_visibility = 'visible' THEN en.description ELSE NULL END,
    CASE WHEN en.client_visibility = 'visible' THEN en.phase_id ELSE NULL END,
    en.total_price,
    en.client_visibility
  FROM estimate_nodes en
  WHERE en.estimate_id = p_estimate_id
    AND en.client_visibility != 'hidden'
  ORDER BY en.sort_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
```

### Supporting Indexes

```sql
-- Already defined in data architecture:
CREATE INDEX idx_nodes_estimate ON estimate_nodes(estimate_id);

-- New indexes needed for client access patterns:
CREATE INDEX idx_estimates_project ON estimates(project_id, id);
CREATE INDEX idx_cpa_user ON client_project_access(user_id, project_id);
```

Do NOT add an index on `client_visibility` -- only 3 values, 80%+ are `visible`, too low cardinality to be useful.

---

## Research Question 5: `node_notes` and Client Visibility Integration

### Recommendation: `is_client_visible BOOLEAN DEFAULT FALSE` on `node_notes`

The `node_notes` table replaces both `notes TEXT` (internal) and `client_notes TEXT` (client-facing) from the base table. Each note has its own visibility flag.

### Schema

```sql
CREATE TABLE node_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id UUID NOT NULL REFERENCES estimate_nodes(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  format VARCHAR(20) NOT NULL DEFAULT 'markdown'
    CHECK (format IN ('markdown', 'plain')),
  is_internal BOOLEAN NOT NULL DEFAULT TRUE,
  is_client_visible BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,  -- soft delete
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- Constraint: a note cannot be both internal and client-visible
ALTER TABLE node_notes ADD CONSTRAINT note_visibility_coherent
  CHECK (NOT (is_internal = TRUE AND is_client_visible = TRUE));

-- Indexes
CREATE INDEX idx_node_notes_node ON node_notes(node_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_node_notes_client ON node_notes(node_id, is_client_visible)
  WHERE is_client_visible = TRUE AND deleted_at IS NULL;
```

### Visibility Rules for Notes

1. **`is_client_visible = FALSE` (default):** Builder-only note. Client never sees it regardless of parent node visibility.
2. **`is_client_visible = TRUE`:** Client can see this note IF AND ONLY IF the parent node's `client_visibility` is `'visible'` or `'summary_only'`. If the parent node is `hidden`, the client sees nothing -- not even client-visible notes.

**Why notes on `summary_only` nodes are visible:** A builder may mark a group as `summary_only` (hide the cost breakdown) but still attach a client-facing note like "Allowance -- client to make final selection by June 15." The note adds context to the summary line without revealing pricing details.

### RLS Policy on `node_notes`

```sql
ALTER TABLE node_notes ENABLE ROW LEVEL SECURITY;

-- Builder/employee: full access to all notes on accessible nodes
CREATE POLICY staff_all_notes ON node_notes
  FOR ALL TO authenticated
  USING (
    get_user_role() IN ('owner', 'employee')
  );

-- Client: read-only access to client-visible notes on non-hidden nodes
CREATE POLICY client_read_notes ON node_notes
  FOR SELECT TO authenticated
  USING (
    CASE
      WHEN get_user_role() IN ('owner', 'employee') THEN TRUE
      ELSE (
        is_client_visible = TRUE
        AND deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM estimate_nodes en
          WHERE en.id = node_notes.node_id
            AND en.client_visibility != 'hidden'
            AND en.estimate_id IN (
              SELECT e.id FROM estimates e
              JOIN client_project_access cpa ON cpa.project_id = e.project_id
              WHERE cpa.user_id = auth.uid()
            )
        )
      )
    END
  );
```

---

## TypeScript Type Definitions

### File: `src/types/estimate-nodes.ts`

```typescript
// ============================================================
// Visibility enum
// ============================================================
export const CLIENT_VISIBILITY = {
  VISIBLE: 'visible',
  HIDDEN: 'hidden',
  SUMMARY_ONLY: 'summary_only',
} as const;

export type ClientVisibility = (typeof CLIENT_VISIBILITY)[keyof typeof CLIENT_VISIBILITY];

// ============================================================
// Full node data (builder/employee view)
// ============================================================
export interface EstimateNode {
  id: string;
  estimateId: string;
  parentId: string | null;
  path: string | null; // ltree -- used server-side only
  sortOrder: number;
  nodeType: 'group' | 'assembly' | 'item';
  name: string;
  description: string | null;
  phaseId: string | null;
  costCodeId: string | null;
  clientVisibility: ClientVisibility;
  subtotal: number;
  contingencyAmount: number;
  overheadAmount: number;
  totalPrice: number;
  referenceName: string | null;
  catalogSourceId: string | null;
  catalogSourceType: 'item' | 'assembly' | null;
  catalogVersion: number | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}

export interface NodeItemDetails {
  nodeId: string;
  qty: number;
  rawQty: number;
  qtyMode: 'numeric' | 'formula' | 'ratio';
  qtyFormula: string | null;
  ratioNumerator: number | null;
  ratioDenominator: number | null;
  unitId: string | null;
  unitCost: number;
  costFormula: string | null;
  costType: 'material' | 'labor' | 'equipment' | 'subcontractor' | 'other' | null;
  contingencyRate: number;
  overheadRate: number;
  unitPrice: number | null;
  wasteFactor: number;
  minOrderQty: number | null;
  packageSize: number | null;
  packageUnitId: string | null;
  bidType: 'bid' | 'allowance' | 'estimate' | null;
  allowanceBudget: number | null;
  allowanceStatus: 'pending_selection' | 'selected' | 'finalized' | null;
  vendorId: string | null;
  instructions: string | null;
  specifications: string | null;
}

export interface NodeAssemblyDetails {
  nodeId: string;
  assemblyUnitId: string | null;
  assemblyQty: number;
  derivedUnitCost: number | null;
  qtyFormula: string | null;
}

// ============================================================
// Client-visible node data (filtered view)
// ============================================================

/** What a client sees for a 'visible' node */
export interface ClientVisibleNode {
  id: string;
  estimateId: string;
  parentId: string | null;
  sortOrder: number;
  nodeType: 'group' | 'assembly' | 'item';
  name: string;
  description: string | null;
  phaseId: string | null;
  totalPrice: number;
  clientVisibility: 'visible';
}

/** What a client sees for a 'summary_only' node */
export interface ClientSummaryNode {
  id: string;
  estimateId: string;
  parentId: string | null;
  sortOrder: number;
  nodeType: 'group' | 'assembly' | 'item';
  name: string;
  description: null; // always null for summary_only
  phaseId: null;     // always null for summary_only
  totalPrice: number;
  clientVisibility: 'summary_only';
}

/** Union type for all client-visible nodes */
export type ClientNode = ClientVisibleNode | ClientSummaryNode;

/** Client-visible item details (only available for 'visible' nodes) */
export interface ClientItemDetails {
  nodeId: string;
  qty: number;
  unitId: string | null;
  unitPrice: number | null;
  bidType: 'bid' | 'allowance' | 'estimate' | null;
  allowanceBudget: number | null;
  allowanceStatus: 'pending_selection' | 'selected' | 'finalized' | null;
  specifications: string | null;
}

/** Client-visible assembly details (only available for 'visible' nodes) */
export interface ClientAssemblyDetails {
  nodeId: string;
  assemblyQty: number;
  assemblyUnitId: string | null;
}

/** A note visible to the client */
export interface ClientNote {
  id: string;
  nodeId: string;
  body: string;
  format: 'markdown' | 'plain';
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// Type guards and helpers
// ============================================================

export function isClientVisible(node: { clientVisibility: ClientVisibility }): boolean {
  return node.clientVisibility !== 'hidden';
}

export function isFullDetailVisible(node: { clientVisibility: ClientVisibility }): boolean {
  return node.clientVisibility === 'visible';
}

export function isSummaryOnly(node: { clientVisibility: ClientVisibility }): boolean {
  return node.clientVisibility === 'summary_only';
}

/**
 * Filter a full node tree down to client-visible nodes.
 * Used client-side when rendering the client view preview (builder previewing what client sees).
 */
export function filterForClientView(nodes: EstimateNode[]): ClientNode[] {
  return nodes
    .filter((n) => n.clientVisibility !== 'hidden')
    .map((n): ClientNode => {
      if (n.clientVisibility === 'summary_only') {
        return {
          id: n.id,
          estimateId: n.estimateId,
          parentId: n.parentId,
          sortOrder: n.sortOrder,
          nodeType: n.nodeType,
          name: n.name,
          description: null,
          phaseId: null,
          totalPrice: n.totalPrice,
          clientVisibility: 'summary_only',
        };
      }
      return {
        id: n.id,
        estimateId: n.estimateId,
        parentId: n.parentId,
        sortOrder: n.sortOrder,
        nodeType: n.nodeType,
        name: n.name,
        description: n.description,
        phaseId: n.phaseId,
        totalPrice: n.totalPrice,
        clientVisibility: 'visible',
      };
    });
}
```

### File: `src/types/estimate-nodes.ts` (location)

All types above belong in the shared types file for estimate nodes. The client-specific types (`ClientNode`, `ClientItemDetails`, etc.) are co-located because they derive from the same domain and the builder's "preview client view" feature needs both types in the same context.

---

## Trade-offs Considered

| Decision | Chosen | Alternative | Why |
|----------|--------|-------------|-----|
| 3 vs 4 visibility values | 3 values | Add `allowance_view` | Simpler, covers 90%+ cases. Allowance display is a rendering concern. Defer to 1B+. |
| Column filtering approach | PostgreSQL VIEWs | Application-level column stripping | VIEWs are enforced at DB level (defense in depth). PostgREST exposes VIEWs natively. Client app cannot bypass. |
| `summary_only` detail access | Block detail tables entirely | Selectively expose some detail fields | Blocking is simpler and more secure. Any exposed detail field risks cost reverse-engineering. |
| Visibility inheritance | Application-level default | Database trigger | Triggers interfere with deep-copy. Inheritance is a UX convenience, not an invariant. |
| Notes visibility | Per-note `is_client_visible` flag | Inherit from parent node only | Per-note flags give finer control. Builder may want internal + client notes on the same node. |
| Notes on `summary_only` nodes | Client-visible notes shown | Block notes for summary_only too | Summary nodes often need contextual notes ("selection deadline: June 15") without revealing pricing. |

---

## Effort Estimate

| Component | Effort | Phase |
|-----------|--------|-------|
| CHECK constraint on `client_visibility` | Trivial | 1A migration |
| RLS policies (3 tables: nodes, item_details, assembly_details) | Low | 1A migration |
| `client_estimate_nodes` VIEW | Low | 1A migration |
| `client_node_item_details` VIEW | Low | 1A migration |
| `client_node_assembly_details` VIEW | Low | 1A migration |
| `node_notes` table + RLS + indexes | Low | 1A migration |
| `set_subtree_visibility()` function | Low | 1A migration |
| `get_client_estimate_tree()` function | Low | 1A or 1B (optimization) |
| TypeScript types + helpers | Low | 1A |
| Application-level inheritance logic | Low | 1A |
| Client view preview (builder previewing client view) | Medium | 1B |
| Supporting indexes (estimates, client_project_access) | Trivial | 1A migration |

**Total estimated effort:** ~2-3 hours for all Phase 1A schema work.

---

## Dependencies

1. **`get_user_role()` SECURITY DEFINER helper** -- must exist before any RLS policy that references it. This is the first Phase 1A migration (per Cluster 2 research).
2. **`client_project_access` table** -- must exist before client RLS policies. Defines which clients can see which projects.
3. **`estimate_nodes` base table** -- must exist before detail tables, views, and functions.
4. **`node_item_details` and `node_assembly_details`** -- must exist before their client views and RLS policies.

Migration ordering:
1. `get_user_role()` helper
2. Core tables (`projects`, `estimates`, `estimate_nodes`, detail tables)
3. `client_project_access` table
4. RLS policies on all tables
5. Client VIEWs
6. `node_notes` table + RLS
7. Helper functions (`set_subtree_visibility`, `get_client_estimate_tree`)

---

## Test Cases

### Unit Tests

1. **CHECK constraint enforcement:** INSERT a node with `client_visibility = 'invalid_value'` -- expect constraint violation error.
2. **CHECK constraint accepts valid values:** INSERT nodes with each of `'visible'`, `'hidden'`, `'summary_only'` -- all succeed.
3. **Default value:** INSERT a node without specifying `client_visibility` -- expect `'visible'`.

### RLS Integration Tests

4. **Client cannot see hidden nodes:** As client user, SELECT from `estimate_nodes` where node has `client_visibility = 'hidden'` -- expect 0 rows.
5. **Client can see visible nodes:** As client user, SELECT from `estimate_nodes` where node has `client_visibility = 'visible'` -- expect the node.
6. **Client can see summary_only nodes:** As client user, SELECT from `estimate_nodes` where node has `client_visibility = 'summary_only'` -- expect the node with name + total_price.
7. **Client cannot see detail tables for summary_only nodes:** As client user, SELECT from `node_item_details` for a `summary_only` node -- expect 0 rows.
8. **Client cannot see detail tables for hidden nodes:** As client user, SELECT from `node_item_details` for a `hidden` node -- expect 0 rows.
9. **Client CAN see detail tables for visible nodes:** As client user, SELECT from `node_item_details` for a `visible` node -- expect the row.
10. **Client without project access sees nothing:** As client user not in `client_project_access`, SELECT from `estimate_nodes` -- expect 0 rows.
11. **Builder sees all nodes regardless of visibility:** As owner/employee, SELECT from `estimate_nodes` -- expect all rows including hidden.

### Notes Integration Tests

12. **Client sees client-visible notes on visible nodes:** As client user, note with `is_client_visible = TRUE` on a `visible` node -- expect the note.
13. **Client sees client-visible notes on summary_only nodes:** As client user, note with `is_client_visible = TRUE` on a `summary_only` node -- expect the note.
14. **Client cannot see internal notes:** As client user, note with `is_client_visible = FALSE` -- expect 0 rows.
15. **Client cannot see client-visible notes on hidden nodes:** As client user, note with `is_client_visible = TRUE` on a `hidden` node -- expect 0 rows.
16. **Note visibility coherence constraint:** INSERT note with `is_internal = TRUE AND is_client_visible = TRUE` -- expect constraint violation.

### Application-Level Tests

17. **Visibility inheritance on create:** Create a child node under a `hidden` parent without specifying visibility -- expect child gets `client_visibility = 'hidden'`.
18. **Visibility override on create:** Create a child node under a `hidden` parent with explicit `client_visibility = 'visible'` -- expect child gets `'visible'` (override is allowed).
19. **Bulk visibility update:** Call `set_subtree_visibility(parent_id, 'hidden')` -- expect all descendants updated.
20. **`filterForClientView` strips hidden nodes:** Pass array with mixed visibility -- expect only visible + summary_only returned.
21. **`filterForClientView` nulls fields for summary_only:** Pass a summary_only node -- expect `description` and `phaseId` to be `null` in output.

### Edge Cases

22. **Orphaned tree branch:** Parent is hidden, child is visible. Client sees the child but cannot see its parent. The client-side `buildTree()` must handle this -- nodes whose parent is hidden become apparent root nodes in the client tree. (Note: this is a valid configuration. The builder may hide "General Conditions" as a group but show individual items within it.)
23. **All children hidden:** A visible group where all children are hidden. Client sees the group with its total_price but no children listed. The total still reflects the hidden items.
24. **Re-parenting does not change visibility:** Move a `visible` node under a `hidden` parent -- expect node stays `visible`. (Inheritance only applies at creation time.)
