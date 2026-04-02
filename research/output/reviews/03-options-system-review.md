# Review: Options System Design

> **Reviewer:** Options System Critic
> **Date:** 2026-04-02
> **Document Under Review:** `research/output/01-data-architecture.md` Section 7
> **Severity Scale:** FATAL (design cannot ship) | CRITICAL (must fix before implementation) | SERIOUS (significant risk) | MODERATE (should address) | MINOR (nit)
> **Verdict:** CONDITIONAL PASS -- the three-layer architecture is sound, but the inline options implementation has several critical data integrity gaps that must be closed before building.

---

## Executive Summary

The proposed options system makes a massive leap forward from Attempt 1. The old system's inline options were embarrassingly weak -- simple cost adjustments (absolute/percentage adders) attached to leaf items only. The new design correctly recognizes that options must swap entire subtrees, not just tweak numbers. This is the right instinct and the right direction.

However, the implementation as specified has significant integrity gaps. The `option_alternative_id` stamping mechanism is clever but brittle. The "no nested options" restriction is premature and will be regretted sooner than expected. And the interaction between options and several other system features (versioning, catalog instantiation, tree operations) is dangerously under-specified.

The three-layer model itself (broad options / inline options / option sets) is architecturally correct and mirrors how CPQ systems like Salesforce CPQ structure configuration: parameter-level overrides, component-level alternatives, and saved scenario snapshots. The concern is not the model -- it's the implementation details within Layer 2.

---

## Part 1: What the Design Gets Right

### 1.1 The Three-Layer Separation

The separation into broad options (parameter overrides), inline options (subtree swaps), and option sets (saved scenarios) is clean and well-justified. This maps directly to real-world construction estimating needs:

- Broad options handle "change the spec grade across the whole project" (R-19 to R-38 insulation)
- Inline options handle "swap this kitchen for that kitchen"
- Option sets handle "show me the budget scenario vs. premium scenario"

This layering also mirrors proven CPQ patterns. Salesforce CPQ separates Configuration Attributes (parameter-level controls) from Product Options/Features (component-level alternatives) from Quote/Opportunity scenarios. The architecture is validated by industry practice.

### 1.2 Subtree Swapping Over Cost Adjustments

The old system's inline options were `cost_adjustment` + `adjustment_type` (absolute/percentage) attached to individual nodes. This was fundamentally wrong for construction estimating. When a client upgrades from a standard kitchen to a premium kitchen, they don't add $15,000 to a single line item. They swap the entire kitchen section -- different cabinets, different countertops, different hardware, different labor hours, different subcontractors. The new design correctly models this as a complete subtree replacement.

### 1.3 Broad Option Normalization

The old system stored `parameter_overrides` as JSONB with no referential integrity. The new system normalizes to a `broad_option_overrides` table with FK to `project_parameters`. This is strictly better -- you get cascade deletes, type safety, and queryability. The `sort_order` precedence rule (highest wins) is also better than the old "last-writer-wins" ambiguity.

### 1.4 Option Sets as a Separate Concern

Option sets are correctly decoupled from the option mechanism itself. They are pure snapshot/recall -- they don't add new state, they just remember which selections were active. The `option_set_selections` junction table with UNIQUE on `(option_set_id, option_group_id)` is clean.

---

## Part 2: Critical Issues

### 2.1 CRITICAL: The `option_alternative_id` Stamping Has No Consistency Guarantee

**Severity: CRITICAL**

The design stamps `option_alternative_id` on all nodes in an alternative's subtree. This is the linchpin of the entire system -- the "active tree" query filters on it. But the spec provides no mechanism to ensure stamp consistency.

**Failure scenario -- tree operations break stamps:**

1. User creates option group for "Kitchen" (group node with 15 descendants)
2. System stamps all 16 nodes with `option_alternative_id = alt_A`
3. User creates alternative "Premium Kitchen" -- 20 new nodes stamped with `option_alternative_id = alt_B`
4. User drags a node from elsewhere in the tree INTO the Premium Kitchen subtree
5. That moved node still has `option_alternative_id = NULL` (or its old stamp)
6. When the user switches to Standard Kitchen (alt_A selected), the moved node remains visible because it has no stamp -- it's an orphan in the wrong subtree
7. The active tree now shows a node that belongs to the Premium Kitchen's structure but appears regardless of which alternative is selected

**Why this is critical:** Every tree mutation operation (move, indent, outdent, paste, drag-and-drop) is a potential stamp-corruption event. The spec says nothing about re-stamping after tree operations. Without a trigger or constraint that propagates stamps to moved nodes, the system will silently accumulate inconsistencies over normal use.

**Required fix:** Either:
- (a) A database trigger on `estimate_nodes` UPDATE of `parent_id` that checks if the new parent has an `option_alternative_id` and propagates it to the moved node and all its descendants (recursive CTE), OR
- (b) A constraint that prevents moving nodes INTO or OUT OF an option-stamped subtree without explicit re-stamping, OR
- (c) Re-derive stamps on every read by walking from each node to its nearest option-owning ancestor (expensive, defeats the purpose of stamping)

Option (a) is the correct answer. It maintains the stamp invariant at the database level, which aligns with the document's own principle: "the database enforces invariants."

### 2.2 CRITICAL: No Constraint Enforcing "Exactly One Selected" Per Option Group

**Severity: CRITICAL**

The `option_alternatives` table has `is_selected BOOLEAN`. The spec says "Exactly one per group must be TRUE." But there is no database constraint enforcing this. A CHECK constraint on a single row cannot enforce cross-row uniqueness of TRUE values.

**Failure scenario:**

1. Application bug sets `is_selected = TRUE` on two alternatives in the same group
2. The active tree query now includes nodes from BOTH alternatives
3. Duplicate subtrees appear in the tree -- two kitchens where there should be one
4. Calculated totals are inflated (both alternatives' costs are summed)
5. The user sees a nonsensical estimate and has no idea why

**Why this is critical:** The active tree query is `WHERE option_alternative_id IN (SELECT id FROM option_alternatives WHERE is_selected = TRUE)`. If two alternatives in the same group are both selected, both subtrees appear. The costs double. The estimate is wrong. And without a constraint, this can happen from any code path that touches `is_selected`.

**Required fix:** A partial unique index:

```sql
CREATE UNIQUE INDEX idx_one_selected_per_group
ON option_alternatives (option_group_id)
WHERE is_selected = TRUE;
```

This ensures at most one alternative per group can be `is_selected = TRUE`. Combined with an application-level check that exactly one (not zero) is selected, this makes the invariant database-enforced. The old system didn't have this either, so this is a known class of bug.

Additionally, consider: what happens if ZERO alternatives are selected? The spec doesn't address this. If all alternatives in a group have `is_selected = FALSE`, the entire option group's content vanishes from the active tree. Is that intended behavior or an error state? It should probably be an error state prevented by application logic (the toggle operation should be atomic: deselect old + select new in a single transaction).

### 2.3 CRITICAL: Deleting the Root Node of an Alternative Orphans the Subtree

**Severity: CRITICAL**

Consider: An option group is created for a "Kitchen" group node. The Kitchen node and its 15 descendants are stamped with `option_alternative_id = alt_A`. Now the user deletes the Kitchen group node.

What happens?

- If `ON DELETE CASCADE` is configured on `parent_id`, all 15 descendants are deleted. The option group and its alternatives still exist, pointing to nodes that no longer exist. The option group is now empty.
- If `ON DELETE SET NULL` is used, the 15 children become root nodes with `parent_id = NULL`, still stamped with `option_alternative_id = alt_A`. They are orphaned subtree fragments floating at the root level.
- If neither cascade behavior handles this: the `option_group` record survives, the `option_alternatives` records survive, but the content they reference is partially or fully gone.

**The spec doesn't address this.** What should happen when you delete a node that is the "root" of an option alternative? Should the entire option group be deleted? Should deletion be prevented? Should all alternatives be cascade-deleted?

**Required fix:** The spec must define which node "owns" the option group (the node at which the option was created). That node's deletion must cascade-delete the option group, all alternatives, and all nodes stamped with any of those alternative IDs. This requires a stored procedure or trigger -- it cannot be expressed as a simple FK cascade because the relationship is through `option_alternative_id`, not through `parent_id`.

### 2.4 CRITICAL: Interaction Between Options and Version Deep-Copy Is Under-Specified

**Severity: CRITICAL**

Section 8.2 describes explicit versions as deep-copies: "Deep-copy all option groups, alternatives, and sets." But this is a single sentence for what is actually a complex multi-step operation with ordering dependencies.

When deep-copying an estimate that has options:

1. Copy all `estimate_nodes` rows (generating new IDs with an ID remapping table)
2. Copy all `option_groups` (generating new IDs)
3. Copy all `option_alternatives` (generating new IDs, remapping `option_group_id`)
4. **Remap `option_alternative_id` on all copied estimate_nodes** using the alternative ID remapping
5. Copy all `option_sets` (generating new IDs)
6. Copy all `option_set_selections` (remapping `option_set_id`, `option_group_id`, `selected_alternative_id`)
7. Copy all `broad_options` and `broad_option_overrides` (remapping `parameter_id` if project parameters were also copied)

Step 4 is the critical one. If the deep-copy operation copies estimate_nodes but doesn't remap their `option_alternative_id` values, the copied nodes point to the OLD version's alternatives. Switching options on the old version would affect the new version's visibility. The two versions would be entangled, not independent.

This is an implementation detail, not an architectural flaw, but the spec must call it out explicitly because getting it wrong would be catastrophic and silent -- estimates would appear to work until someone edits options on one version and sees the other version change.

---

## Part 3: Serious Issues

### 3.1 SERIOUS: The "No Nested Options" Restriction Will Be Regretted

**Severity: SERIOUS**

The spec says: "An item can only belong to one option group. If an option alternative's subtree itself contained an inner option group, a single node would need to belong to multiple alternatives simultaneously -- the `option_alternative_id` column can't hold two values."

This is technically correct about the column limitation. But the restriction itself conflicts with real construction estimating workflows.

**Real-world scenario that requires nesting:**

- Option Group A: "Kitchen Package" -- Standard vs. Premium
- Premium Kitchen has 20 nodes. One of those nodes is "Countertops."
- The client wants the Premium Kitchen but wants to choose between granite and quartz countertops.
- This requires an option WITHIN an option -- a nested option group for countertops inside the Premium Kitchen alternative.

The spec's answer is: "upgrade to a junction table (`node_option_memberships`)." But this is presented as a "future enhancement" rather than a design consideration. The problem is that the junction table approach requires reworking the core active tree query, the stamping logic, the tree operation triggers, and the deep-copy versioning -- essentially every piece of the options system.

**Industry precedent:** Both Salesforce CPQ and SAP Variant Configuration support nested configuration. Salesforce CPQ allows bundles within bundles, each with their own Product Features and Option constraints. SAP's configurable BOMs (the "150% BOM" approach) model variants at any level of the hierarchy. The construction domain is simpler than manufacturing, but "option within an option" is a basic use case, not an edge case.

**Recommendation:** Don't implement nested options now, but design the schema to accommodate them. Specifically:

- Replace the single `option_alternative_id` column with a junction table NOW (`node_option_memberships` with `node_id, option_alternative_id` and UNIQUE on the pair). This adds one JOIN to the active tree query but makes the upgrade path trivial.
- The active tree query becomes: `WHERE NOT EXISTS (SELECT 1 FROM node_option_memberships nom JOIN option_alternatives oa ON nom.option_alternative_id = oa.id WHERE nom.node_id = n.id AND oa.is_selected = FALSE)` -- "exclude nodes that belong to any non-selected alternative."
- When nested options are added later, a node simply gets multiple rows in the junction table. No schema migration required.

The cost of this approach is one additional JOIN in the hot query path. For 200-1,000 node trees, this is negligible. The cost of NOT doing it is a painful migration later that requires rewriting the core query, updating all tree operation logic, and migrating existing data.

### 3.2 SERIOUS: No Specification for Option Group Scope/Attachment

**Severity: SERIOUS**

The `option_groups` table has `estimate_id` but no reference to which node in the tree the option is "attached to." The relationship is implicit: you find the option group's content by looking for nodes stamped with its alternatives' IDs.

But this creates ambiguity: which node in the tree IS the option point? When the user looks at the tree and sees "there's an option here," what are they looking at?

**Scenario:** The user creates an option for the "Kitchen" group node. The system creates an option_group and stamps the Kitchen node with alt_A. But the option_group itself has no FK to the Kitchen node. If someone queries "which node does this option group belong to?" they have to scan the tree for the root-most node stamped with the base alternative.

**Why this matters:**
- UI rendering needs to know where to show the option indicator (the "switch" icon on the tree node)
- When creating a new alternative, the system needs to know what `parent_id` to assign to the new alternative's root nodes
- When the "option root" node is moved, the option group should move with it -- but there's no FK to maintain this relationship

**Required fix:** Add `anchor_node_id UUID FK -> estimate_nodes` to `option_groups`. This is the node in the tree where the option "lives." It enables:
- Direct lookup: "which node has options?" -> `SELECT * FROM option_groups WHERE anchor_node_id = $1`
- UI rendering: show option indicator on anchor nodes
- Move operations: when the anchor node moves, the option group follows naturally via FK
- Cascade: when the anchor node is deleted, cascade-delete the option group (addressing issue 2.3)

### 3.3 SERIOUS: Broad Options Lack Scope Control

**Severity: SERIOUS**

Broad options override project parameters estimate-wide. But what if the user wants a broad option that only affects a specific section of the estimate?

**Example:** "Upgraded Insulation" should change the R-value parameter -- but only for the exterior walls, not the interior partition walls. Both use formulas referencing `r_value`, but they should be able to have different overrides.

The current design has no mechanism for this. A broad option overrides the parameter globally. Every formula in every node that references `r_value` gets the override.

**Industry comparison:** SAP Variant Configuration uses "object dependencies" that scope configuration rules to specific BOM levels. Salesforce CPQ uses "scope" on Product Rules -- the rule can apply to the entire quote or to a specific product/bundle.

**Recommendation:** Add an optional `scope_node_id UUID FK -> estimate_nodes` to `broad_option_overrides`. When NULL, the override applies globally (current behavior). When set, the override only applies to formulas within that node's subtree. This is a backward-compatible addition -- existing overrides with NULL scope behave identically to today.

### 3.4 SERIOUS: No Mechanism for Option Pricing Deltas (Client-Facing)

**Severity: SERIOUS**

The system stores the full cost of each alternative. When showing options to a client, the natural presentation is: "Standard Kitchen: $45,000. Premium Kitchen: +$22,000." But there is no mechanism to calculate or store the delta.

This seems trivial -- just subtract. But consider:
- Broad options can interact with inline options (changing parameters changes formula-driven quantities within an alternative)
- Option sets combine multiple option selections -- the delta of the full set is not the sum of individual deltas if broad options interact
- The comparison view needs to calculate "what does the estimate total become if I switch THIS option?" which requires recalculating the entire tree for each scenario

**The spec mentions comparison view casually:** "For each option set, temporarily apply its selections (in memory, not persisted), calculate the tree total, and present side-by-side comparisons. This is computationally cheap for 200-1,000 node trees."

Is it? If each comparison requires:
1. Load all nodes
2. Filter to the active tree for this scenario
3. Recalculate the entire tree (formulas, constraints, parent aggregation)
4. Return the totals

...and there are 5 option sets plus the base scenario, that's 6 full tree calculations. For a 1,000-node tree with formula evaluation, this could take 1-3 seconds per scenario. The spec claims "computationally cheap" without benchmarking or analysis.

**Recommendation:** Add `delta_from_base DECIMAL(15,2)` to `option_alternatives` as a cached value, recalculated when any node in the alternative changes. This provides instant delta display for common use cases. Full comparison view with broad option interactions still requires per-scenario recalculation, but individual option deltas are pre-computed.

---

## Part 4: Moderate Issues

### 4.1 MODERATE: Option Set Missing Broad Option Selections

The spec says: "Broad option selections in sets: Add `broad_option_ids` to `option_set_selections` or a separate junction table." This hand-waves a critical detail. The `option_set_selections` table is designed for inline options (it has `option_group_id` + `selected_alternative_id`). Broad options don't have groups or alternatives -- they're binary toggles.

**Required:** A separate junction table `option_set_broad_selections` with `(option_set_id, broad_option_id, is_active)`. UNIQUE on `(option_set_id, broad_option_id)`. This cleanly separates the two selection types and avoids overloading `option_set_selections`.

### 4.2 MODERATE: No Validation That Alternatives Have Compatible Tree Structures

When the user creates a new alternative for an option group, they can put anything in it -- a single item, a complex assembly, a deeply nested group structure. There is no validation that the alternative "fits" the position in the tree.

**Example:** The option group is for a node whose parent is an assembly (with assembly_qty = 1200 SF). The base alternative is an item with a ratio-based quantity (2.88 LF per 1 SF). The user creates a new alternative that is a group node with 5 child items. Do those child items inherit the assembly context? Do their ratio calculations work against the parent assembly's quantity?

The spec says alternatives "share the same `parent_id` as the base." So the new alternative's root nodes become children of the assembly. But the detail tables (node_item_details, node_assembly_details) don't automatically inherit the parent context. The user has to manually configure each child's quantity mode. This is error-prone.

**Recommendation:** When creating a new alternative under an assembly parent, the system should warn if child items don't have ratio-based quantities configured. Not a hard constraint, but a validation check.

### 4.3 MODERATE: Active Tree Query Performance With Many Options

The active tree query is:
```sql
WHERE option_alternative_id IS NULL
   OR option_alternative_id IN (SELECT id FROM option_alternatives WHERE is_selected = TRUE)
```

For an estimate with 20 option groups, each with 3 alternatives, there are 60 option_alternative records, 20 of which have `is_selected = TRUE`. The subquery returns 20 IDs. The main query checks every node's `option_alternative_id` against this list.

This is fine for 20 IDs. But the spec says "unlimited alternatives per option point." If someone creates 50 option groups (plausible for a large custom home with many client choices), each with 4-5 alternatives, that's 200-250 alternative records. The IN clause grows. More importantly, the deselected alternatives' nodes are still in the table -- they're just filtered out.

For a 1,000-node base tree with 50 option groups averaging 4 alternatives each, the `estimate_nodes` table could contain 3,000-4,000 rows for that estimate (base + deselected alternatives). The active tree query returns 1,000, but the table scan touches 4,000.

**Recommendation:** The partial index `idx_nodes_option ON estimate_nodes(option_alternative_id) WHERE option_alternative_id IS NOT NULL` helps. But consider materializing the active tree as a view or using a pre-computed `is_active` boolean column updated by triggers when selections change. This trades write complexity for read performance, which is the right trade for an estimating tool where reads vastly outnumber option switches.

### 4.4 MODERATE: No Locking/Concurrency Model for Option Switching

Option switching is a multi-step operation:
1. Deselect old alternative
2. Select new alternative
3. Recalculate tree

If two browser tabs (or future multi-user scenarios) switch options simultaneously, they can interleave and leave the system in an inconsistent state (two alternatives selected, or none selected).

**Required:** The switching operation must be wrapped in a serializable transaction, or use a stored procedure with advisory locks. Since this is a single-user system, the immediate risk is low, but the operation should still be atomic to prevent corruption from duplicate requests (double-click, network retry, etc.).

---

## Part 5: The "No Nested Options" Deep Dive

This deserves special attention because the spec dismisses it as a future concern, but it is the highest-risk architectural decision in the options system.

### 5.1 Why Nested Options Matter in Construction

The brief's own example illustrates this: "An 'Upgraded Kitchen' option doesn't just change a price -- it replaces the entire kitchen section with a different set of items, assemblies, materials, and labor."

Now consider: within the "Upgraded Kitchen" alternative, the client wants to choose between:
- Granite countertops ($8,500) vs. Quartz countertops ($12,000)
- Soft-close cabinet hardware ($1,200) vs. Standard hardware ($600)
- Under-cabinet lighting (add-on, $2,500)

These are options WITHIN an option. They only exist if the Premium Kitchen is selected. They are meaningless in the Standard Kitchen context. This is not an edge case -- it is the normal workflow for custom residential construction.

### 5.2 The 150% BOM Approach as an Alternative Model

Manufacturing uses the "150% BOM" concept: a single master structure contains ALL possible components. Each component is tagged with configuration rules that include or exclude it based on variant selections. The resolved BOM for a specific variant is a filtered subset of the master.

Applied to construction estimating, this would mean:
- The estimate tree contains ALL alternatives for ALL options simultaneously
- Each node carries configuration tags (which option selections include/exclude it)
- The "active tree" is resolved by applying the current selection state as a filter

This is essentially what the proposed design does -- but with a single `option_alternative_id` column instead of a flexible tagging system. The 150% BOM approach uses a more flexible many-to-many relationship between nodes and configurations.

### 5.3 Recommendation: Design for Nesting, Build Without It

As stated in issue 3.1, replace `option_alternative_id` with a junction table now. The implementation cost is one additional JOIN. The architectural cost of not doing it is a migration that touches every query, trigger, and operation in the options system.

The first release can still enforce "one option group per node" in application logic. But the schema should support multiple memberships from day one.

---

## Part 6: Comparison with Industry Systems

### 6.1 Salesforce CPQ

| Concept | Salesforce CPQ | ShossyWorks Proposed |
|---------|---------------|---------------------|
| Option grouping | Product Features (containers for options) | option_groups |
| Individual options | Product Options (with type: Component/Accessory/Related) | option_alternatives |
| Option constraints | Min/Max per Feature, selection rules | No constraints specified |
| Nested configuration | Bundles within bundles, each configurable | Explicitly prohibited |
| Scenario comparison | Quote comparison across Opportunities | option_sets with comparison view |
| Parameter overrides | Configuration Attributes | broad_options + broad_option_overrides |

**Key takeaway:** Salesforce CPQ's Product Features have `Minimum Options` and `Maximum Options` fields. This is missing from the ShossyWorks design. Should at least one alternative always be required? Can the user select "none"? These constraints need specification.

### 6.2 SAP Variant Configuration

SAP uses "characteristics" (parameters) and "object dependencies" (rules that scope which components apply based on characteristic values). This is more powerful than the proposed broad options system because dependencies can be scoped to specific BOM levels, not just global.

The proposed design's broad options are global overrides. SAP's approach allows "if wall_type = 'exterior', use R-38 insulation; if wall_type = 'interior', use R-13." This scoped behavior is closer to what a construction estimator actually needs (see issue 3.3).

### 6.3 The 150% BOM / Configurable BOM Pattern

The key lesson from manufacturing: the "master" structure contains everything, and variants are resolved by filtering. This is exactly what the proposed design does with the active tree query. The proposed approach is sound in concept but needs the junction table upgrade to match the flexibility of industrial configurable BOMs.

---

## Part 7: Summary of Required Changes

### Must Fix Before Implementation

| # | Issue | Severity | Fix |
|---|-------|----------|-----|
| 2.1 | Tree operations can corrupt option stamps | CRITICAL | Database trigger on `parent_id` UPDATE to propagate stamps |
| 2.2 | No "exactly one selected" constraint | CRITICAL | Partial unique index + atomic toggle operation |
| 2.3 | Deleting option root orphans everything | CRITICAL | Add `anchor_node_id` to option_groups + cascade delete trigger |
| 2.4 | Version deep-copy under-specified for options | CRITICAL | Explicit ID remapping specification for all option tables |

### Should Fix Before Implementation

| # | Issue | Severity | Fix |
|---|-------|----------|-----|
| 3.1 | Schema prevents future nesting | SERIOUS | Junction table instead of single column |
| 3.2 | Option group has no anchor node | SERIOUS | Add `anchor_node_id` FK |
| 3.3 | Broad options lack scope control | SERIOUS | Add optional `scope_node_id` to overrides |
| 3.4 | No cached delta pricing | SERIOUS | Add `delta_from_base` cached field |

### Address During Implementation

| # | Issue | Severity | Fix |
|---|-------|----------|-----|
| 4.1 | Option sets missing broad option junction | MODERATE | Separate `option_set_broad_selections` table |
| 4.2 | No alternative structure validation | MODERATE | Warning system for incompatible alternatives |
| 4.3 | Active tree query may degrade with many options | MODERATE | Monitor; consider materialized `is_active` column |
| 4.4 | No concurrency model for switching | MODERATE | Serializable transaction or advisory lock |

---

## Part 8: The Hardest Question -- Data Model for Option Interactions

The spec doesn't address the most dangerous complexity: what happens when broad options and inline options interact?

**Scenario:**
1. Broad option "Upgraded Insulation" changes `r_value` from 19 to 38
2. The "Exterior Wall System" assembly has an insulation item with a formula-driven quantity referencing `r_value`
3. The insulation item is part of option group "Wall Finish" (Standard vs. Premium)
4. The Premium alternative has a different assembly structure that ALSO references `r_value`

When both the broad option and the inline option are active, the system must:
- Apply the parameter override from the broad option
- Use the alternative subtree from the inline option
- Recalculate quantities using the overridden parameters within the selected alternative

This is a cross-cutting concern. The calculation engine must be aware of both the active broad options (which change parameter values) and the active inline options (which change which nodes exist). The spec treats these as independent systems, but they interact during calculation.

**The interaction is not additive -- it's multiplicative.** If there are 3 broad options and 5 inline options, there are potentially 2^3 x 5 = 40 unique calculation scenarios. The comparison view needs to handle this combinatorial space.

**This is not a flaw in the design -- it's an inherent complexity of the domain.** But the spec must acknowledge it and specify the calculation order:

1. Determine which broad options are active -> resolve all parameter values
2. Determine which inline alternatives are selected -> resolve the active tree
3. Calculate the active tree using the resolved parameters

This order is implied but never stated. It must be explicit and tested.

---

## Verdict

The three-layer options architecture is sound and well-aligned with industry patterns. The critical issues are all fixable with targeted additions (triggers, constraints, an anchor FK, a junction table). None require a redesign.

The most important change is replacing `option_alternative_id` (single column) with `node_option_memberships` (junction table) before any code is written. This is a one-time schema cost that prevents a painful migration later. Every other fix is additive.

The "no nested options" restriction is acceptable for v1 if and only if the schema supports future nesting. If the single-column approach ships, nested options become a breaking change instead of a feature addition.

**Bottom line:** Fix the four CRITICAL issues and the junction table question, and this design is ready to build.
