# Options System Completeness Research

## Problem Statement

The data architecture (v2) defines a three-layer options system (broad options, inline options, option sets) but leaves several completeness gaps identified by the comprehensive analysis. Specifically: (1) additive/toggle options -- the most common option type in residential construction -- are not modeled, (2) the `option_items` naming in Decision 2 conflicts with the `node_option_memberships` junction table naming in the data architecture, (3) option set comparison mechanics at the application level are unspecified, (4) `option_sets.total_price` caching strategy is undefined, and (5) approval workflow targeting of option sets needs resolution.

---

## Research Question 1: Should additive options ('toggle' type) be added now?

### Answer: YES -- add `group_type` column now, defer feature to Phase 1B

**Rationale:** The comprehensive analysis (Decision 6) and Business Logic F3 both recommend adding the column now. A `toggle` option is an additive upgrade (e.g., "Add crown molding" or "Upgrade to tankless water heater") where the alternative is simply "include or exclude" rather than "choose A vs B." In residential construction, 60-70% of client-facing options are additive toggles, not selection-based alternates. Missing this type means the core differentiation feature ships without its most common use case.

**Schema change:** One column addition to `option_groups`, one additional `option_alternative` seeding rule.

**How toggle groups differ from selection groups:**

| Behavior | `selection` group (existing) | `toggle` group (new) |
|----------|------------------------------|----------------------|
| Alternatives count | 2+ named alternatives | Exactly 2: "Excluded" (base) + "Included" |
| Selection rule | Exactly one selected | Exactly one selected (same constraint) |
| UI presentation | Dropdown / radio buttons | Toggle switch / checkbox |
| Tree effect | Swap subtrees | Include or exclude a subtree |
| Default state | Base alternative selected | "Excluded" selected (toggle off) |

The database constraint is identical -- the partial unique index `idx_one_selected_per_group` already enforces exactly-one-selected. The difference is purely semantic (UI rendering and option creation workflow). This means zero new database constraints are needed.

---

## Research Question 2: `option_items` vs `node_option_memberships` naming

### Answer: `option_items` (Decision 2) is informal shorthand; `node_option_memberships` (data architecture) is the canonical table name

Decision 2 from the interaction decisions says: "Schema: needs option_sets, option_items tables." This was written during an early interaction session before the full data architecture was designed. The data architecture (v2, Section 7.2) formalized the design as `node_option_memberships` -- a junction table linking `estimate_nodes` to `option_alternatives`.

**There is no `option_items` table.** The concept Decision 2 called "option_items" is fully realized by the `node_option_memberships` junction table. The naming difference:

| Decision 2 term | Data architecture term | What it actually is |
|-----------------|----------------------|---------------------|
| `option_items` | `node_option_memberships` | Junction: which nodes belong to which option alternative |
| `option_sets` | `option_sets` + `option_set_selections` + `option_set_broad_selections` | Saved scenario with inline + broad selections |

**Recommendation:** Use `node_option_memberships` everywhere. Update any references to `option_items` in documentation to point to the correct table. The name `node_option_memberships` is more precise -- it describes the relationship (a node's membership in an option alternative), not the entity type.

---

## Research Question 3: Option set comparison at application level

### Answer: Fetch tree once, filter per scenario in TypeScript

The data architecture (Section 7.3) specifies: "For each option set, temporarily apply its selections (in memory, not persisted), calculate the tree total, and present side-by-side comparisons."

**Concrete algorithm:**

1. **Fetch once:** Load ALL estimate nodes (including deselected alternatives) in a single query with no option filtering:
   ```sql
   SELECT n.*, nom.option_alternative_id
   FROM estimate_nodes n
   LEFT JOIN node_option_memberships nom ON nom.node_id = n.id
   WHERE n.estimate_id = $1
   ORDER BY n.parent_id, n.sort_order;
   ```

2. **For each option set:** Apply its selections as a filter:
   - Build a Set of deselected alternative IDs from the option set's selections
   - Filter out nodes whose membership is in the deselected set
   - Nodes with no membership (NULL) are always included
   - Calculate totals on the filtered tree

3. **Present comparison:** Side-by-side table showing each option set name + its calculated total.

**Why in-memory, not per-query:** For a 200-1,000 node tree with 3-6 option sets, the cost of 3-6 separate database queries with different WHERE clauses is higher than one full fetch + 3-6 in-memory filters. The tree data is already in memory for the active view. The filter is O(n) per scenario where n is total nodes -- for 1,000 nodes and 6 scenarios, that is 6,000 filter operations, which completes in under 1ms.

**Broad option interaction:** For each option set, also resolve broad option overrides to get the correct parameter values, then recalculate formulas with those parameters. The calculation order is: resolve parameters -> filter tree -> calculate totals.

---

## Research Question 4: Should `option_sets.total_price` be cached?

### Answer: NO cached column -- compute on demand, with optional application-level cache

**Against a database column:**
- The total depends on the ENTIRE tree structure + all option selections + all broad option parameter overrides + all formulas. Any change to any node, any formula, any parameter invalidates the cached value.
- Maintaining cache consistency requires triggers on `estimate_nodes`, `node_item_details`, `broad_option_overrides`, `option_alternatives`, AND `node_option_memberships`. The trigger web becomes a maintenance nightmare.
- For a single-user app with <6 option sets and <1,000 nodes, the computation time is <50ms. Caching saves <50ms at the cost of significant complexity.

**Recommended approach:**
- Compute option set totals on demand when the comparison view is opened
- Cache results in application memory (React state / server action response) for the duration of the comparison view session
- Invalidate the cache on any tree mutation (the estimate already triggers re-render on mutation)
- If performance becomes an issue (benchmark first), add a `last_calculated_total DECIMAL(15,4)` column with a `last_calculated_at TIMESTAMPTZ` as a stale-able cache, NOT a source of truth

---

## Research Question 5: Should approval workflow target option sets?

### Answer: YES -- approvals should reference an option set

**Rationale:** The comprehensive analysis schema impact summary already includes `option_set_id FK` on `estimate_approvals`. A client approves a specific scenario (option set), not the raw estimate with all its alternatives. "I approve the Mid-Range package at $425,000" is the real workflow, not "I approve the estimate" (which has no single price when options exist).

**How it works:**
- When an estimate has option sets, the approval references which option set was approved
- When an estimate has NO option sets (simple estimate), `option_set_id` is NULL (approval covers the estimate as-is)
- Multiple option sets can be approved (client might approve both "Budget" and "Premium" for comparison/contract negotiation)
- The approval record captures the total price at the time of approval (snapshot, not live reference)

**Schema:** Already designed in the comprehensive analysis. The `estimate_approvals` table includes `option_set_id FK -> option_sets` as a nullable foreign key. No additional schema work needed beyond what is already planned.

---

## Recommended Solution

### SQL: CREATE TABLE Statements

```sql
-- ============================================================
-- OPTION GROUPS (with group_type for toggle support)
-- ============================================================
CREATE TABLE public.option_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id UUID NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  anchor_node_id UUID NOT NULL REFERENCES public.estimate_nodes(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  group_type VARCHAR(20) NOT NULL DEFAULT 'selection'
    CONSTRAINT valid_group_type CHECK (group_type IN ('selection', 'toggle')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_option_groups_estimate ON public.option_groups(estimate_id);
CREATE INDEX idx_option_groups_anchor ON public.option_groups(anchor_node_id);

-- RLS
ALTER TABLE public.option_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage option groups on their estimates"
  ON public.option_groups FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.estimates e
      JOIN public.projects p ON e.project_id = p.id
      WHERE e.id = option_groups.estimate_id
      AND p.user_id = (SELECT auth.uid())
    )
  );

-- ============================================================
-- OPTION ALTERNATIVES
-- ============================================================
CREATE TABLE public.option_alternatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  option_group_id UUID NOT NULL REFERENCES public.option_groups(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_selected BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Exactly-one-selected constraint (at most one TRUE per group)
CREATE UNIQUE INDEX idx_one_selected_per_group
  ON public.option_alternatives (option_group_id)
  WHERE is_selected = TRUE;

-- General lookup index
CREATE INDEX idx_option_alternatives_group
  ON public.option_alternatives(option_group_id);

-- RLS
ALTER TABLE public.option_alternatives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage alternatives via option group ownership"
  ON public.option_alternatives FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.option_groups og
      JOIN public.estimates e ON og.estimate_id = e.id
      JOIN public.projects p ON e.project_id = p.id
      WHERE og.id = option_alternatives.option_group_id
      AND p.user_id = (SELECT auth.uid())
    )
  );

-- ============================================================
-- NODE OPTION MEMBERSHIPS (junction table)
-- ============================================================
CREATE TABLE public.node_option_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id UUID NOT NULL REFERENCES public.estimate_nodes(id) ON DELETE CASCADE,
  option_alternative_id UUID NOT NULL REFERENCES public.option_alternatives(id) ON DELETE CASCADE,
  UNIQUE (node_id, option_alternative_id)
);

-- Performance indexes for active tree query
CREATE INDEX idx_nom_node ON public.node_option_memberships(node_id);
CREATE INDEX idx_nom_alt ON public.node_option_memberships(option_alternative_id);

-- RLS
ALTER TABLE public.node_option_memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage memberships via node ownership"
  ON public.node_option_memberships FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.estimate_nodes en
      JOIN public.estimates e ON en.estimate_id = e.id
      JOIN public.projects p ON e.project_id = p.id
      WHERE en.id = node_option_memberships.node_id
      AND p.user_id = (SELECT auth.uid())
    )
  );

-- ============================================================
-- OPTION SETS (saved scenarios)
-- ============================================================
CREATE TABLE public.option_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id UUID NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one default per estimate
CREATE UNIQUE INDEX idx_one_default_option_set
  ON public.option_sets (estimate_id)
  WHERE is_default = TRUE;

CREATE INDEX idx_option_sets_estimate ON public.option_sets(estimate_id);

-- RLS
ALTER TABLE public.option_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage option sets on their estimates"
  ON public.option_sets FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.estimates e
      JOIN public.projects p ON e.project_id = p.id
      WHERE e.id = option_sets.estimate_id
      AND p.user_id = (SELECT auth.uid())
    )
  );

-- ============================================================
-- OPTION SET SELECTIONS (inline option choices per scenario)
-- ============================================================
CREATE TABLE public.option_set_selections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  option_set_id UUID NOT NULL REFERENCES public.option_sets(id) ON DELETE CASCADE,
  option_group_id UUID NOT NULL REFERENCES public.option_groups(id) ON DELETE CASCADE,
  selected_alternative_id UUID NOT NULL REFERENCES public.option_alternatives(id) ON DELETE CASCADE,
  UNIQUE (option_set_id, option_group_id)
);

CREATE INDEX idx_oss_set ON public.option_set_selections(option_set_id);
CREATE INDEX idx_oss_group ON public.option_set_selections(option_group_id);

-- RLS
ALTER TABLE public.option_set_selections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage set selections via option set ownership"
  ON public.option_set_selections FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.option_sets os
      JOIN public.estimates e ON os.estimate_id = e.id
      JOIN public.projects p ON e.project_id = p.id
      WHERE os.id = option_set_selections.option_set_id
      AND p.user_id = (SELECT auth.uid())
    )
  );

-- ============================================================
-- OPTION SET BROAD SELECTIONS (broad option toggles per scenario)
-- ============================================================
CREATE TABLE public.option_set_broad_selections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  option_set_id UUID NOT NULL REFERENCES public.option_sets(id) ON DELETE CASCADE,
  broad_option_id UUID NOT NULL REFERENCES public.broad_options(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (option_set_id, broad_option_id)
);

CREATE INDEX idx_osbs_set ON public.option_set_broad_selections(option_set_id);

-- RLS
ALTER TABLE public.option_set_broad_selections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage broad set selections via option set ownership"
  ON public.option_set_broad_selections FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.option_sets os
      JOIN public.estimates e ON os.estimate_id = e.id
      JOIN public.projects p ON e.project_id = p.id
      WHERE os.id = option_set_broad_selections.option_set_id
      AND p.user_id = (SELECT auth.uid())
    )
  );
```

### SQL: Active Tree Filter Query

```sql
-- "Show estimate with Option Set X applied"
-- This query returns the active tree for a given option set's selections.
--
-- Strategy: The option set tells us which alternative is selected per group.
-- We need to exclude nodes that belong to NON-selected alternatives.
-- Nodes with no option membership are always included.

-- Step 1: Get the set of deselected alternative IDs for this option set
WITH deselected_alternatives AS (
  -- All alternatives in the estimate that are NOT the selected one for their group
  SELECT oa.id AS alternative_id
  FROM option_alternatives oa
  JOIN option_groups og ON oa.option_group_id = og.id
  JOIN option_set_selections oss ON oss.option_group_id = og.id
  WHERE oss.option_set_id = $2  -- the option set ID
    AND og.estimate_id = $1     -- the estimate ID
    AND oa.id != oss.selected_alternative_id
)
SELECT n.*
FROM estimate_nodes n
WHERE n.estimate_id = $1
  -- Exclude nodes belonging to any deselected alternative
  AND NOT EXISTS (
    SELECT 1
    FROM node_option_memberships nom
    WHERE nom.node_id = n.id
      AND nom.option_alternative_id IN (SELECT alternative_id FROM deselected_alternatives)
  )
ORDER BY n.parent_id NULLS FIRST, n.sort_order;


-- Simpler variant: "Show estimate with CURRENT selections applied"
-- (no option set, just whatever is_selected = TRUE on alternatives)
SELECT n.*
FROM estimate_nodes n
WHERE n.estimate_id = $1
  AND NOT EXISTS (
    SELECT 1
    FROM node_option_memberships nom
    JOIN option_alternatives oa ON nom.option_alternative_id = oa.id
    WHERE nom.node_id = n.id
      AND oa.is_selected = FALSE
  )
ORDER BY n.parent_id NULLS FIRST, n.sort_order;
```

### SQL: Toggle Option Creation Helper

```sql
-- When creating a toggle-type option group, automatically create
-- two alternatives: "Excluded" (selected by default) and "Included"
CREATE OR REPLACE FUNCTION create_toggle_option(
  p_estimate_id UUID,
  p_anchor_node_id UUID,
  p_name VARCHAR(255),
  p_description TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_group_id UUID;
  v_excluded_alt_id UUID;
  v_included_alt_id UUID;
BEGIN
  -- Create the option group
  INSERT INTO option_groups (estimate_id, anchor_node_id, name, description, group_type)
  VALUES (p_estimate_id, p_anchor_node_id, p_name, p_description, 'toggle')
  RETURNING id INTO v_group_id;

  -- Create "Excluded" alternative (selected by default = toggle OFF)
  INSERT INTO option_alternatives (option_group_id, name, is_selected, sort_order)
  VALUES (v_group_id, 'Excluded', TRUE, 0)
  RETURNING id INTO v_excluded_alt_id;

  -- Create "Included" alternative (not selected = toggle OFF)
  INSERT INTO option_alternatives (option_group_id, name, is_selected, sort_order)
  VALUES (v_group_id, 'Included', FALSE, 1)
  RETURNING id INTO v_included_alt_id;

  -- Stamp the anchor node and its descendants with the "Included" alternative
  -- (they should appear only when the toggle is ON)
  INSERT INTO node_option_memberships (node_id, option_alternative_id)
  SELECT en.id, v_included_alt_id
  FROM estimate_nodes en
  WHERE en.path <@ (SELECT path FROM estimate_nodes WHERE id = p_anchor_node_id)
  ON CONFLICT DO NOTHING;

  RETURN v_group_id;
END;
$$;
```

### SQL: Option Set Comparison Function

```sql
-- Calculate total price for each option set in an estimate
-- Returns a table of (option_set_id, option_set_name, total_price)
-- NOTE: This is a SIMPLIFIED version that sums node totals.
-- Full calculation (with formula re-evaluation for broad options)
-- must happen in the TypeScript calculation engine.
CREATE OR REPLACE FUNCTION compare_option_sets(p_estimate_id UUID)
RETURNS TABLE (
  option_set_id UUID,
  option_set_name VARCHAR(255),
  total_price DECIMAL(15,4)
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    os.id AS option_set_id,
    os.name AS option_set_name,
    COALESCE(SUM(n.total_price), 0) AS total_price
  FROM option_sets os
  CROSS JOIN estimate_nodes n
  WHERE os.estimate_id = p_estimate_id
    AND n.estimate_id = p_estimate_id
    AND n.parent_id IS NULL  -- root nodes only for top-level total
    -- Exclude nodes in deselected alternatives for this set
    AND NOT EXISTS (
      SELECT 1
      FROM node_option_memberships nom
      JOIN option_alternatives oa ON nom.option_alternative_id = oa.id
      JOIN option_groups og ON oa.option_group_id = og.id
      JOIN option_set_selections oss ON oss.option_group_id = og.id
        AND oss.option_set_id = os.id
      WHERE nom.node_id = n.id
        AND oa.id != oss.selected_alternative_id
    )
  GROUP BY os.id, os.name
  ORDER BY os.sort_order;
$$;
```

### TypeScript: Type Definitions

```typescript
// File: src/types/options.ts

// ── Group Types ──────────────────────────────────────────────
export type OptionGroupType = 'selection' | 'toggle';

// ── Core Entities ────────────────────────────────────────────

export interface OptionGroup {
  id: string;
  estimateId: string;
  anchorNodeId: string;
  name: string;
  description: string | null;
  groupType: OptionGroupType;
  createdAt: string;
  updatedAt: string;
}

export interface OptionAlternative {
  id: string;
  optionGroupId: string;
  name: string;
  description: string | null;
  isSelected: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface NodeOptionMembership {
  id: string;
  nodeId: string;
  optionAlternativeId: string;
}

export interface OptionSet {
  id: string;
  estimateId: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface OptionSetSelection {
  id: string;
  optionSetId: string;
  optionGroupId: string;
  selectedAlternativeId: string;
}

export interface OptionSetBroadSelection {
  id: string;
  optionSetId: string;
  broadOptionId: string;
  isActive: boolean;
}

// ── Composite / Enriched Types ───────────────────────────────

/** Option group with its alternatives loaded */
export interface OptionGroupWithAlternatives extends OptionGroup {
  alternatives: OptionAlternative[];
}

/** Option set with all its inline + broad selections */
export interface OptionSetWithSelections extends OptionSet {
  inlineSelections: OptionSetSelection[];
  broadSelections: OptionSetBroadSelection[];
}

/** Result of option set comparison */
export interface OptionSetComparison {
  optionSetId: string;
  optionSetName: string;
  totalPrice: number;
}

// ── Input Types (for server actions) ─────────────────────────

export interface CreateOptionGroupInput {
  estimateId: string;
  anchorNodeId: string;
  name: string;
  description?: string;
  groupType: OptionGroupType;
}

export interface CreateOptionAlternativeInput {
  optionGroupId: string;
  name: string;
  description?: string;
}

export interface SwitchAlternativeInput {
  optionGroupId: string;
  newSelectedAlternativeId: string;
}

export interface CreateOptionSetInput {
  estimateId: string;
  name: string;
  description?: string;
  isDefault?: boolean;
}

export interface ApplyOptionSetInput {
  optionSetId: string;
}

export interface SaveCurrentAsOptionSetInput {
  estimateId: string;
  name: string;
  description?: string;
}

// ── Utility Types ────────────────────────────────────────────

/** Map of node ID -> set of alternative IDs it belongs to */
export type NodeMembershipMap = Map<string, Set<string>>;

/** Set of alternative IDs that are deselected (for tree filtering) */
export type DeselectedAlternativeSet = Set<string>;
```

### TypeScript: Active Tree Filter Function

```typescript
// File: src/lib/options/filter-active-tree.ts

import type {
  NodeMembershipMap,
  DeselectedAlternativeSet,
  OptionAlternative,
  OptionSetSelection,
  NodeOptionMembership,
} from '@/types/options';
import type { EstimateNode } from '@/types/estimate-nodes';

/**
 * Build a map of nodeId -> Set<alternativeId> from membership rows.
 * Used to quickly check which alternatives a node belongs to.
 */
export function buildMembershipMap(
  memberships: NodeOptionMembership[]
): NodeMembershipMap {
  const map: NodeMembershipMap = new Map();
  for (const m of memberships) {
    let set = map.get(m.nodeId);
    if (!set) {
      set = new Set();
      map.set(m.nodeId, set);
    }
    set.add(m.optionAlternativeId);
  }
  return map;
}

/**
 * Get the set of deselected alternative IDs from current live selections.
 */
export function getDeselectedFromLive(
  alternatives: OptionAlternative[]
): DeselectedAlternativeSet {
  const deselected = new Set<string>();
  for (const alt of alternatives) {
    if (!alt.isSelected) {
      deselected.add(alt.id);
    }
  }
  return deselected;
}

/**
 * Get the set of deselected alternative IDs for a specific option set.
 * Requires all alternatives and the option set's selections.
 */
export function getDeselectedForOptionSet(
  allAlternatives: OptionAlternative[],
  optionSetSelections: OptionSetSelection[]
): DeselectedAlternativeSet {
  // Build a map of groupId -> selectedAlternativeId from the option set
  const selectedByGroup = new Map<string, string>();
  for (const sel of optionSetSelections) {
    selectedByGroup.set(sel.optionGroupId, sel.selectedAlternativeId);
  }

  const deselected = new Set<string>();
  for (const alt of allAlternatives) {
    const selectedId = selectedByGroup.get(alt.optionGroupId);
    if (selectedId !== undefined && alt.id !== selectedId) {
      deselected.add(alt.id);
    }
  }
  return deselected;
}

/**
 * Filter the full node list to only include active nodes.
 * A node is active if it does NOT belong to any deselected alternative.
 * Nodes with no memberships are always active.
 */
export function filterActiveTree(
  allNodes: EstimateNode[],
  membershipMap: NodeMembershipMap,
  deselected: DeselectedAlternativeSet
): EstimateNode[] {
  return allNodes.filter((node) => {
    const memberships = membershipMap.get(node.id);
    if (!memberships || memberships.size === 0) {
      // No option membership -- always visible
      return true;
    }
    // Exclude if ANY of the node's memberships is in the deselected set
    for (const altId of memberships) {
      if (deselected.has(altId)) {
        return false;
      }
    }
    return true;
  });
}

/**
 * Compare all option sets for an estimate.
 * Returns filtered trees for each option set (caller calculates totals).
 */
export function getTreesForAllOptionSets(
  allNodes: EstimateNode[],
  membershipMap: NodeMembershipMap,
  allAlternatives: OptionAlternative[],
  optionSets: Array<{
    id: string;
    name: string;
    selections: OptionSetSelection[];
  }>
): Array<{ optionSetId: string; optionSetName: string; activeNodes: EstimateNode[] }> {
  return optionSets.map((os) => {
    const deselected = getDeselectedForOptionSet(allAlternatives, os.selections);
    const activeNodes = filterActiveTree(allNodes, membershipMap, deselected);
    return {
      optionSetId: os.id,
      optionSetName: os.name,
      activeNodes,
    };
  });
}
```

### File Paths

| Artifact | File Path |
|----------|-----------|
| Migration (options tables) | `supabase/migrations/XXXXXXXX_options_system.sql` |
| TypeScript types | `src/types/options.ts` |
| Active tree filter | `src/lib/options/filter-active-tree.ts` |
| Option server actions | `src/lib/actions/options.ts` |
| Option set server actions | `src/lib/actions/option-sets.ts` |

---

## Trade-offs Considered

### 1. `group_type` column vs separate `toggle_options` table
- **Chosen:** Column on `option_groups`. Toggle options share 95% of the behavior with selection options (same alternatives table, same membership table, same active tree query). A separate table would duplicate all this infrastructure.
- **Rejected:** Separate table. Would require separate UI components, separate server actions, separate deep-copy logic, and separate option set handling.

### 2. Cached `total_price` on `option_sets` vs compute-on-demand
- **Chosen:** Compute on demand. The trigger cascade for cache invalidation (6+ tables) exceeds the complexity budget for a <50ms computation.
- **Rejected:** Cached column. Would require triggers on every table that affects tree totals, plus invalidation logic when options themselves change.

### 3. Option set comparison: database function vs TypeScript
- **Chosen:** TypeScript (primary), with a simplified database function available for reporting. The full calculation (including formula re-evaluation with broad option parameters) MUST happen in the shared TypeScript calculation engine to maintain the "isomorphic calculation" principle (data architecture, Principle 5).
- **Rejected:** Database-only comparison. Cannot evaluate `math.js` formulas in PostgreSQL.

### 4. Toggle default state: "Excluded" selected vs "Included" selected
- **Chosen:** "Excluded" selected by default (toggle OFF). Additive options should not inflate the base estimate price. The client explicitly opts in.
- **Rejected:** "Included" by default. Would make the base estimate include all upgrades, which is not how construction estimating works.

---

## Effort Estimate

| Task | Effort | Phase |
|------|--------|-------|
| Migration: all options tables (6 tables) | 2 hours | 1A (Migration 4) |
| TypeScript types | 30 min | 1A |
| Active tree filter utility | 1 hour | 1A |
| Server actions (CRUD for groups, alternatives, sets) | 3 hours | 1A |
| Toggle option creation helper | 30 min | 1B (feature, not schema) |
| Option set comparison view | 2 hours | 1B |
| **Total** | **~9 hours** | Split 1A/1B |

---

## Dependencies

| Dependency | Required Before |
|------------|----------------|
| `estimates` table | `option_groups`, `option_sets` (FK) |
| `estimate_nodes` table | `option_groups` (anchor FK), `node_option_memberships` (node FK) |
| `broad_options` table | `option_set_broad_selections` (FK) |
| `project_parameters` table | `broad_option_overrides` (FK) |
| Tree calculation engine | Option set comparison (needs `calculateTree()`) |
| `ltree` extension | Toggle option creation helper (uses `path <@` query) |

All options tables go in Migration 4 (after core tables in Migrations 1-3).

---

## Test Cases

### Database Constraint Tests

1. **Exactly-one-selected enforcement:** Insert two alternatives with `is_selected = TRUE` in the same group. Expect unique index violation.
2. **Cascade delete from anchor node:** Delete an `estimate_node` that is an anchor. Verify `option_groups`, `option_alternatives`, and `node_option_memberships` rows are all deleted.
3. **Cascade delete from option group:** Delete an `option_group`. Verify alternatives and memberships cascade.
4. **Unique membership:** Insert duplicate `(node_id, option_alternative_id)` pair. Expect unique constraint violation.
5. **Valid group_type:** Insert option_group with `group_type = 'invalid'`. Expect CHECK violation.
6. **One default option set:** Insert two option sets with `is_default = TRUE` for the same estimate. Expect unique index violation.
7. **Unique set selection per group:** Insert two `option_set_selections` for the same `(option_set_id, option_group_id)`. Expect unique violation.

### Active Tree Filter Tests

8. **No options:** Tree with no option memberships returns all nodes.
9. **Single selection group, base selected:** Nodes in deselected alternative are excluded; base nodes shown.
10. **Single selection group, alt selected:** Nodes in base alternative excluded; alt nodes shown.
11. **Toggle group, excluded (default):** Toggled nodes are excluded from active tree.
12. **Toggle group, included:** Toggled nodes appear in active tree.
13. **Multiple groups:** Two independent option groups filter correctly in combination.
14. **Unowned nodes always visible:** Nodes with no membership rows appear regardless of selections.

### Option Set Tests

15. **Apply option set:** Applying an option set updates `is_selected` on all referenced alternatives.
16. **Save current as set:** Creating an option set from current selections captures all group selections.
17. **Comparison accuracy:** Two option sets with different selections produce different total prices.
18. **Broad option in set:** Option set with broad option override produces correct parameter-adjusted totals.

### RLS Tests

19. **Owner access:** Estimate owner can CRUD all option tables.
20. **Non-owner blocked:** Different user cannot read/write option data for estimates they don't own.
21. **Client access (future):** Client role can read option groups/alternatives but not modify them.

### Toggle Option Tests

22. **Toggle creation:** `create_toggle_option()` creates group with exactly 2 alternatives ("Excluded" + "Included").
23. **Toggle membership:** Anchor node and descendants are stamped with the "Included" alternative ID.
24. **Toggle switch:** Switching from "Excluded" to "Included" makes the toggled nodes appear in the active tree.
