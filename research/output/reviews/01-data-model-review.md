# Data Model & Schema Architecture Review

> **Reviewer:** Data Model Critic
> **Document under review:** `research/output/01-data-architecture.md`
> **Date:** 2026-04-02
> **Verdict:** Generally strong with specific weaknesses that need addressing before implementation

---

## Executive Assessment

The proposed architecture makes a defensible choice at its highest level: hybrid base table + type-specific detail tables, adjacency list tree, classificatory phases, copy-on-instantiate catalog. These are sound fundamentals. The document demonstrates genuine independent thinking rather than rehashing the old 46-column monolith.

However, several decisions deserve deeper scrutiny. Some are likely correct but insufficiently justified. Others have real alternatives that were dismissed too quickly. And a few have subtle implementation risks that could cause problems months into development.

This review challenges each major architectural decision, rates confidence, and proposes specific alternatives where warranted.

---

## 1. Tree Model: Adjacency List

### The Recommendation
Self-referencing `parent_id` FK with `INTEGER sort_order`, with materialized path as a deferred enhancement.

### Critique

**Confidence: MEDIUM** -- The choice is defensible but the dismissal of alternatives is too fast.

**What the document gets right:**
- For 200-1,000 nodes loaded in full, adjacency list is simple and sufficient.
- The "load everything, build in memory" access pattern eliminates most of the read-performance arguments for fancier tree models.
- O(1) re-parenting is genuinely valuable for an estimate tree where drag-and-drop reordering is a core interaction.

**What the document gets wrong or underestimates:**

1. **The `ltree` extension deserves serious consideration, not just a mention as "materialized path."** PostgreSQL's `ltree` is purpose-built for hierarchical data. It provides GiST-indexable path operations (`<@`, `@>`, `~`, `?`), ancestor/descendant queries without recursive CTEs, and depth/level functions built in. The document's "materialized path" section treats it as a generic string column with LIKE queries -- that undersells the actual PostgreSQL capability significantly. `ltree` gives you `subpath()`, `nlevel()`, `lca()` (least common ancestor), and label-based matching via `lquery` and `ltxtquery`. For a construction estimate where you will eventually need "show me everything under Framing" or "what is the depth of this node" -- these operations are trivial with `ltree` and require recursive traversal with adjacency list.

   **However**, `ltree` has a real weakness: moving a subtree requires updating every descendant's path. For a 200-1000 node tree where subtree moves are common, this is O(k) per move where k is the subtree size. That is still fast at this scale (a 100-node subtree update is ~100 UPDATEs in a single transaction), but it is not O(1) like adjacency list.

   **My recommendation:** Use adjacency list as the primary model, but add an `ltree path` column from day one (not as a deferred enhancement). Populate it via a trigger that fires on INSERT/UPDATE of `parent_id`. This gives you both O(1) re-parenting at the adjacency list level AND instant subtree queries via the `ltree` index. The trigger-maintained path column means application code never needs to manage paths manually. Cost: one trigger, one column, one GiST index. Benefit: server-side subtree queries without recursive CTEs forever.

   **Confidence in this alternative: HIGH.** The dual-column approach (parent_id + ltree path) is a well-known PostgreSQL pattern that gives you the best of both worlds with minimal overhead.

2. **The sort_order strategy has a gap.** The document says "renumber all siblings sequentially (1, 2, 3...) after drag-and-drop" to avoid fractional drift. This is correct, but what happens during concurrent edits? If two users (or even two browser tabs) reorder siblings simultaneously, renumbering creates a race condition. For a single-user app this is unlikely but not impossible (e.g., user has two estimate tabs open).

   **Mitigation:** Use optimistic locking -- add a `version` column on `estimate_nodes`, check it before reordering, and reject stale writes. Or use a gap-tolerant strategy (sort_order values of 100, 200, 300 with plenty of room for inserts between). The document doesn't address this.

   **Confidence: LOW** (this is a minor edge case for a single-user app, but worth documenting).

3. **Recursive CTE performance is dismissed too casually.** "PostgreSQL handles recursive CTEs efficiently at this scale" is true for simple cases, but the options system query (Section 7.2 in the doc) requires joining `option_alternatives` to determine visibility on every query. When combined with recursive descent for subtree operations, the query plan can become non-trivial. The document should specify which operations use recursive CTEs and ensure they're tested with realistic data volumes during Phase 1.

   **Confidence: MEDIUM.**

---

## 2. Node Type Architecture: Hybrid Base + Detail Tables

### The Recommendation
Shared `estimate_nodes` base table (~23 columns) + `node_item_details` (~21 columns) + `node_assembly_details` (~5 columns). Three node types: `group`, `assembly`, `item`.

### Critique

**Confidence: HIGH** -- This is the right pattern, with caveats.

**What the document gets right:**
- Eliminates the 36-column NULL density problem of the monolith.
- Tree operations only touch the base table -- detail tables are irrelevant for move/reorder.
- The hybrid is strictly better than full table-per-type (which would require UNION queries for tree traversal).

**What the document gets wrong or underestimates:**

1. **The base table still has ~23 columns, and several only apply to specific types.** The columns `phase_id`, `cost_code`, `client_visibility`, `reference_name` are on the base table but are operationally only meaningful for items (and sometimes assemblies). Groups don't have cost codes. Groups don't have `reference_name` values that formulas reference. The document's own design principle says "every column should be relevant to every row" -- but this principle is violated in the base table itself.

   **Counter-argument (acknowledged):** Moving these to detail tables would require JOINs for every tree-rendering query that needs to display cost codes or visibility icons. The pragmatic choice is to keep them on the base table even if groups don't use them, because the alternative (JOINing detail tables just to render tree nodes) is worse. This is a justified violation of the stated principle, but the document should explicitly acknowledge it rather than claiming zero irrelevant NULLs.

   **Confidence: HIGH** -- keep them on the base table, but be honest about the tradeoff.

2. **PostgreSQL table inheritance (INHERITS) was not evaluated.** PostgreSQL has a native feature for exactly this pattern: `CREATE TABLE node_item_details () INHERITS (estimate_nodes)`. With inheritance, querying `SELECT * FROM estimate_nodes` automatically includes rows from child tables. This eliminates the need for LEFT JOINs entirely.

   **However**, PostgreSQL table inheritance has critical limitations that make it a poor fit here:
   - UNIQUE constraints and FOREIGN KEYS do not propagate to child tables. This means `parent_id` FK integrity and `(estimate_id, reference_name)` uniqueness would not work across the inheritance hierarchy.
   - PostgREST (which Supabase uses) has documented issues with inheritance hierarchies for relationship detection.
   - INSERT does not automatically route to child tables -- you must INSERT directly into the specific child table.

   **Verdict:** The document's hybrid approach (base table + JOINed detail tables) is actually better than PostgreSQL INHERITS for this use case. But the document should have evaluated and rejected INHERITS explicitly, with reasons. Omitting it entirely suggests the author didn't consider it.

   **Confidence: HIGH** that INHERITS is wrong here, but the omission is a gap in the analysis.

3. **The "group" type replacing both "category" and "section" is correct but needs guardrails.** The document correctly unifies categories and sections into one `group` type. This is simpler and more flexible. But it loses the one useful constraint the old system had: categories were always root-level containers. Now, nothing prevents a deeply nested group structure like group > group > group > group > item, which may make the estimate tree confusing for the user.

   **Recommendation:** Add an advisory depth limit for groups (e.g., UI warns at depth > 3, hard limit at depth > 5). This isn't a database constraint -- it's application-level guidance. The document doesn't address how to prevent users from creating pathologically deep organizational structures.

   **Confidence: MEDIUM** -- this is a UX concern more than a data model concern.

4. **The base table has calculated cost fields (subtotal, contingency_amount, overhead_amount, total_price) on ALL node types.** This is stated as a design decision but deserves more justification. Storing derived values creates a consistency obligation: every mutation that changes a quantity, cost, rate, or tree structure must trigger a recalculation that updates these stored values. If ANY code path misses this obligation, the stored totals become stale.

   **The alternative:** Don't store calculated values on group nodes at all. Only store them on items (where they're calculated from qty * cost) and assemblies (where derived_unit_cost is useful). For group totals, always compute them by summing active children at query time or in the client.

   **Counter-argument:** Storing group totals enables direct querying for reports ("show me all groups with total > $50,000") without recursive aggregation. For the "comparison view" of option sets, pre-stored totals make side-by-side comparison cheap.

   **My position:** Store them, but acknowledge the consistency obligation explicitly. Every recalculation must be a bottom-up traversal that touches every ancestor of every changed node. The document's "batch save" strategy (Section 9.4) addresses this, but the link between "stored totals" and "recalculation obligation" should be stated as a formal invariant.

   **Confidence: MEDIUM** -- either approach works; the stored approach is better for reporting but requires discipline.

---

## 3. Detail Table Design

### node_item_details (~21 columns)

**Confidence: HIGH** -- well designed with one concern.

**Strength:** Separating `raw_qty` from `qty` to show the purchasing constraint pipeline is excellent. This is a genuine insight that the old system lacked.

**Concern: The ratio model uses `ratio_numerator` / `ratio_denominator` but doesn't specify which unit is which.** The document says "1 box per 75 SF" is expressed as numerator=1, denominator=75. But what tells you the numerator unit is "boxes" and the denominator unit is "SF of assembly"? The item's own `unit_id` presumably gives the numerator unit, and the parent assembly's `assembly_unit_id` gives the denominator unit. But this relationship is implicit, not documented or enforced.

**What happens if the user puts an item with unit "LF" inside an assembly with unit "SF" and sets ratio 2.88:1?** Is that "2.88 LF per 1 SF" or "2.88 per 1 LF of assembly (but wait, the assembly is in SF)"? The document needs to specify: the ratio is ALWAYS `ratio_numerator [item units] per ratio_denominator [assembly units]`. This should be documented as a contract and validated at save time.

**Confidence: HIGH** -- this is a clarity gap, not a design flaw.

### node_assembly_details (~5 columns)

**Confidence: HIGH** -- lean and correct.

The assembly detail table is appropriately minimal. Assemblies don't need their own markup rates (those live on child items). The `derived_unit_cost` is correctly marked as display-only.

**One gap:** There's no `description` or `notes` field specific to assemblies. The base table has `description` and `notes`, so this is covered. But should assemblies have assembly-specific fields like `output_description` (e.g., "Total cost per SF of installed cedar siding system")? This is a UX question, not a schema question -- the base table's `description` field is sufficient.

---

## 4. Catalog System

### The Recommendation
Separate `catalog_items` and `catalog_assemblies` tables, `catalog_assembly_components` junction table, copy-on-instantiate.

### Critique

**Confidence: HIGH** -- fundamentals are sound.

**What the document gets right:**
- Copy-on-instantiate is non-negotiable and correctly identified.
- Soft reference (`catalog_source_id` without FK) is correct -- deleting catalog entries must never break estimates.
- Version tracking enables "check for changes" without breaking stability.
- The XOR constraint on `catalog_assembly_components` properly models the "either an item or a nested assembly" choice.

**What deserves scrutiny:**

1. **Catalog items and catalog assemblies are separate tables, but estimate items and assemblies share a base table.** This asymmetry creates a conceptual mismatch: in the catalog, items and assemblies are fundamentally different tables. In the estimate, they're rows in the same tree. The instantiation flow (Section 6.5) must bridge this gap. This is workable but not elegant.

   **Alternative considered:** A unified `catalog_entries` table with the same hybrid pattern as estimate nodes (base + details). This would make the catalog structurally parallel to the estimate, making instantiation more symmetrical. The cost: the catalog also needs a tree structure (assemblies contain components), which means the catalog would need its own adjacency list. This is what the `catalog_assembly_components` junction table already provides, just less elegantly.

   **Verdict:** The current design is acceptable. The asymmetry between catalog and estimate structures is a pragmatic choice -- the catalog doesn't need a full tree model because assembly components are only one level deep (an assembly contains items or nested assemblies, but you're not building a multi-level tree IN the catalog).

   **Wait -- actually, nested assemblies DO create multi-level trees in the catalog.** A "Complete Exterior Wall" assembly contains a "Cedar Siding System" assembly, which contains items. The `catalog_assembly_components` table handles this via the `nested_assembly_id` FK. But this means the catalog IS a tree -- just modeled as a junction table instead of a self-referential parent_id. That's fine for the catalog's simpler use case (you never need to "move" a catalog assembly component in a drag-and-drop sense).

   **Confidence: HIGH** -- acceptable asymmetry.

2. **The `tags` field on `catalog_items` and `catalog_assemblies` is JSONB.** The document's own rule (Section 11) says JSONB is appropriate for "simple array, rarely queried individually." But catalog tags are the primary search/filter mechanism for finding catalog items! If a user wants "show me all catalog items tagged 'exterior'" -- that's a query inside JSONB.

   PostgreSQL's GIN index on JSONB handles `@>` containment queries efficiently, so this works technically. But it's an exception to the document's stated rule. If tags become a complex taxonomy (hierarchical tags, tag categories), JSONB will be limiting.

   **Recommendation:** For the initial implementation, JSONB tags with a GIN index is fine. But document it as a known tradeoff -- if tags grow complex, migrate to a `catalog_item_tags` junction table.

   **Confidence: MEDIUM** -- acceptable for now, but worth flagging.

3. **Circular reference detection in catalog assemblies.** The document correctly identifies that the CHECK `nested_assembly_id != assembly_id` only prevents direct self-nesting, not indirect cycles (A -> B -> A). It says "indirect cycle detection requires application-level validation." This is correct, but the implementation strategy should be specified: at INSERT/UPDATE time on `catalog_assembly_components`, walk the chain of `nested_assembly_id` references (bounded by a max depth, say 10) and reject if a cycle is detected. This is a finite traversal because catalog assemblies are expected to nest at most 3-5 levels deep.

   **Confidence: HIGH** -- the document identifies the problem but doesn't specify the solution.

---

## 5. Options System

### Inline Options (Layer 2) -- The Most Complex Part

**Confidence: MEDIUM** -- the design is clever but has subtle issues.

**What the document gets right:**
- Subtree swapping via `option_alternative_id` stamping is a clean mechanism.
- The query for "active tree" is elegant: WHERE `option_alternative_id IS NULL OR option_alternative_id IN (selected alternatives)`.
- Disallowing nested options initially is wise.

**What concerns me:**

1. **All alternative subtrees share the same `parent_id`.** When Alternative B replaces Alternative A, the new nodes have the same `parent_id` as A's nodes. This means sibling ordering between alternatives could conflict -- A's nodes have sort_order 1, 2, 3 and B's nodes also have sort_order 1, 2, 3. The active tree query filters to only show one set, so this works for display. But it means the `(parent_id, sort_order)` pair is NOT unique -- which could confuse application logic that assumes uniqueness.

   **Recommendation:** Add a composite sort: `ORDER BY option_alternative_id NULLS FIRST, sort_order`. Or assign non-overlapping sort_order ranges per alternative. This needs specification.

   **Confidence: HIGH** -- this is a real ordering ambiguity.

2. **Switching alternatives requires no data migration, just flipping `is_selected`.** This is elegant BUT it means ALL alternatives exist as rows in `estimate_nodes` at all times. For an estimate with 10 option groups and 3 alternatives each, the "full" tree might have 2-3x as many nodes as the "active" tree. This doesn't affect correctness, but it affects:
   - Tree loading performance (you load all alternatives even if most are inactive)
   - History table growth (changes to inactive alternatives are still tracked)
   - Estimate version deep-copy size (copying all alternatives, not just the active set)

   For the expected scale (200-1,000 active nodes, maybe 1,500-3,000 total with alternatives), this is fine. But the document should acknowledge the storage multiplier and verify the assumptions hold.

   **Confidence: LOW** -- this is a scale concern that's unlikely to matter for this app.

3. **The document mentions "broad option selections in sets" as an afterthought.** Section 7.3 says "Add `broad_option_ids` to `option_set_selections` or a separate junction table." This is hand-waved. Option sets need to capture BOTH inline selections and broad option toggles. The schema should have a `option_set_broad_selections` table (or extend `option_set_selections` with a `broad_option_id` column and appropriate constraints). Leaving this to "or a separate junction table" is underspecified.

   **Confidence: HIGH** -- this needs a concrete table definition.

---

## 6. Money and Decimal Precision

### The Recommendation
- DECIMAL(15,4) for inputs (costs, quantities)
- DECIMAL(15,2) for calculated totals (money)
- DECIMAL(5,4) for markup percentages

### Critique

**Confidence: HIGH** -- mostly correct with one important caveat.

**What the document gets right:**
- Using DECIMAL (which PostgreSQL aliases as NUMERIC) for exact arithmetic is correct. FLOAT would cause rounding drift.
- Separating input precision (4 dp) from output precision (2 dp) is good practice.
- DECIMAL(5,4) for percentages caps at 9.9999 (999.99%) which is sufficient.

**What concerns me:**

1. **DECIMAL(15,2) for calculated totals introduces rounding.** When the calculation chain runs:
   ```
   subtotal = qty * unit_cost  (DECIMAL(15,4) * DECIMAL(15,4) = up to 8 decimal places)
   contingency = subtotal * rate  (more decimal places)
   overhead = (subtotal + contingency) * rate  (even more)
   ```
   Truncating to 2 decimal places at each step introduces cumulative rounding error. For a single item, this is negligible. For 500 items being summed, rounding errors can compound.

   **Best practice (per GAAP):** Carry at least 4 decimal places through ALL intermediate calculations. Only round to 2 decimal places for DISPLAY. Store calculated totals as DECIMAL(15,4) internally, and format to 2dp in the UI.

   **Alternative:** Store as integer cents (multiply everything by 100 or 10000). This is what financial systems like Stripe use. It eliminates floating-point ambiguity entirely. However, it makes the schema less readable and requires conversion at every boundary.

   **Recommendation:** Change calculated total columns (subtotal, contingency_amount, overhead_amount, total_price, unit_price) from DECIMAL(15,2) to DECIMAL(15,4). Round to 2dp only at display time. The cost is 2 extra bytes per column per row. The benefit is eliminating cumulative rounding errors across hundreds of items.

   **Confidence: HIGH** -- this is a real precision concern.

---

## 7. Version Management

### The Recommendation
Deep-copy for explicit versions + trigger-based history tables for change tracking.

### Critique

**Confidence: HIGH** -- this is well designed.

**Strengths:**
- Deep-copy versioning is the right model for construction estimates. Each version must be an independent snapshot.
- Starting history triggers from day one is wise.
- The storage math (2,500 rows for 500 nodes x 5 versions) is trivially small.

**Concerns:**

1. **The deep-copy mechanism requires an ID remapping step.** When copying 500 nodes into a new estimate version, every `parent_id` must be remapped from old node IDs to new node IDs. Every `option_alternative_id` must be remapped. Every detail table row must point to the new node IDs. This is a complex transaction that's easy to get wrong.

   **Recommendation:** Implement the deep-copy as a single PostgreSQL function (`deep_copy_estimate(source_estimate_id)`) that handles all remapping in one atomic transaction. Don't implement this in application code with multiple round-trips. The function should return the new estimate ID and guarantee referential integrity.

   **Confidence: HIGH** -- the mechanism is right, but the implementation must be a single DB function.

2. **History tables duplicate the full schema of their source tables.** This means every schema migration on `estimate_nodes` also requires a matching migration on `estimate_nodes_history`. This is maintenance overhead that's easy to forget. Consider whether PostgreSQL's `pg_audit` extension or a generic JSONB-based audit log (`{table, row_id, old_values JSONB, new_values JSONB, changed_at, changed_by}`) would be simpler.

   **Counter-argument:** Typed history tables enable direct SQL queries ("show me the quantity history of this node" without JSONB path extraction). For a single-user app, the maintenance overhead of parallel migrations is manageable.

   **Verdict:** Typed history tables are fine. Just document the "every migration must touch history tables too" rule as a contract.

   **Confidence: MEDIUM** -- both approaches work; typed tables are marginally better for querying.

---

## 8. Formula Engine

### The Recommendation
Library-based expression evaluator (`expr-eval`), isomorphic execution (client + server).

### Critique

**Confidence: MEDIUM** -- the approach is sound but the library choice needs validation.

1. **`expr-eval` is recommended but its maintenance status should be verified.** The npm package `expr-eval` had its last major update in 2020 (version 2.0.2). For a long-lived application, depending on an unmaintained library is risky. Alternatives like `mathjs` are actively maintained (though larger). The document should specify a fallback if `expr-eval` proves unmaintained.

   **Confidence: HIGH** -- verify maintenance status before committing.

2. **Circular reference detection "at save time" is necessary but insufficient.** The document says "build a dependency graph from formula references. If a cycle is found, reject the formula." This is correct for save-time validation, but what about the client-side calculation engine? If a formula creates a cycle, the client-side evaluator could infinite-loop before the server rejects it on save. The client needs its own cycle detection (or a max-iteration guard) to prevent the browser from freezing.

   **Confidence: HIGH** -- client-side must also guard against cycles.

---

## 9. Database vs. Application Enforcement

### Critique

**Confidence: HIGH** -- the principle is sound and the division is mostly correct.

**One gap:** The document says "valid parent-child type combinations" are application-level because the logic is "complex multi-column." But the most critical rule -- items cannot have children -- IS enforced at the DB level via a trigger. This is good. However, the trigger as described ("reject INSERT where parent is an item") only prevents NEW children from being added to items. It doesn't prevent an existing parent node from being CHANGED to type 'item' while it still has children. The trigger must also fire on UPDATE of `node_type` and verify the node has no children before allowing a type change to 'item'.

**Confidence: HIGH** -- missing UPDATE trigger case.

---

## 10. Missing or Underspecified Areas

### Things the document doesn't address that it should:

1. **Row-Level Security (RLS).** Supabase applications typically use RLS policies. The document doesn't mention RLS at all. For a single-user app, simple policies (`auth.uid() = created_by` or a single-owner check) are sufficient. But they need to exist -- Supabase projects with RLS disabled expose data to any authenticated user via the auto-generated API.

   **Confidence: HIGH** -- this is a security gap.

2. **Supabase Realtime subscriptions.** If two browser tabs are open on the same estimate, Supabase Realtime can keep them in sync. The schema should consider which tables need Realtime enabled. At minimum: `estimate_nodes` and detail tables. The `updated_at` trigger is necessary for Realtime change detection to work properly.

   **Confidence: LOW** -- nice-to-have for a single-user app, but worth noting.

3. **Soft deletes vs. hard deletes.** The document uses CASCADE DELETE throughout -- deleting a parent node recursively deletes all descendants permanently. This is simple but irreversible. Should there be a "trash" concept where deleted nodes are marked as deleted but recoverable for 30 days? The history tables partially address this (the OLD row values are captured), but restoring from history is not a simple undo.

   **Recommendation:** For the initial implementation, hard deletes with history tracking are sufficient. If users frequently delete and regret, add a `deleted_at` soft-delete column later. Don't over-engineer this upfront.

   **Confidence: MEDIUM** -- acceptable for now.

4. **Estimate-to-estimate item sharing.** Can the user copy nodes between estimates (not just from catalog)? The document's data model supports this (just INSERT new rows), but the workflow isn't mentioned. This is a UX concern, but the schema should be aware of it.

   **Confidence: LOW** -- minor gap.

5. **Bulk import/export.** The old system had an Excel import path. The new system should have a defined import strategy (CSV? Excel? JSON?) for initial data seeding and for users who want to pull in data from spreadsheets. The schema itself doesn't need changes, but the document should note that bulk import is a Phase 1 requirement (or explicitly defer it).

   **Confidence: MEDIUM** -- important for user adoption.

---

## 11. Table Count Assessment

The document proposes 26 tables. This is reasonable for the feature scope. Key observation: 3 of those tables are history tables that are structurally duplicates of their source tables. 4 are vendor-related tables that are explicitly deferred. The "core" schema (what you'd build in Phases 1-3) is approximately 19 tables.

For comparison: the old system had 14 tables but one of them was a 46-column monolith doing the work of 3-4 tables. The new 26-table count reflects proper normalization, not over-engineering.

**Confidence: HIGH** -- 26 tables is appropriate.

---

## Summary of Recommendations

| # | Issue | Severity | Recommendation | Confidence |
|---|-------|----------|----------------|------------|
| 1 | Tree model -- add ltree column from day one | Enhancement | Dual parent_id + ltree path column, trigger-maintained | HIGH |
| 2 | Sort order -- race condition on concurrent reorder | Minor | Optimistic locking or gap-tolerant sort values | LOW |
| 3 | Base table has columns only relevant to some types | Acknowledged tradeoff | Keep as-is, but document the violation of "zero irrelevant NULLs" | HIGH |
| 4 | PostgreSQL INHERITS not evaluated | Documentation gap | Add explicit rejection with reasons | HIGH |
| 5 | Group depth has no limit | UX concern | Advisory depth limit in application (warn at 3, hard limit at 5) | MEDIUM |
| 6 | Stored calculated totals create recalculation obligation | Design risk | Document as formal invariant; every mutation path must recalculate | MEDIUM |
| 7 | Ratio unit semantics implicit | Clarity gap | Document the contract: numerator is item units, denominator is assembly units | HIGH |
| 8 | Catalog tags as JSONB | Acceptable tradeoff | Fine for now; document migration path to junction table if needed | MEDIUM |
| 9 | Cycle detection in catalog assemblies | Missing implementation detail | Specify bounded chain-walk algorithm at INSERT/UPDATE time | HIGH |
| 10 | Option alternative sort_order overlap | Real bug risk | Specify ordering strategy when alternatives share parent_id | HIGH |
| 11 | Broad option set selections underspecified | Schema gap | Define concrete junction table for option_set_broad_selections | HIGH |
| 12 | DECIMAL(15,2) for calculated totals causes rounding | Precision concern | Change to DECIMAL(15,4), round to 2dp at display only | HIGH |
| 13 | Deep-copy version remapping complexity | Implementation risk | Implement as single PostgreSQL function, not application code | HIGH |
| 14 | History table schema sync obligation | Maintenance risk | Document "every migration touches history tables" rule | MEDIUM |
| 15 | expr-eval library maintenance status | Dependency risk | Verify active maintenance or identify fallback | HIGH |
| 16 | Client-side cycle detection missing | Bug risk | Add max-iteration guard to client formula evaluator | HIGH |
| 17 | UPDATE trigger for node_type change | Missing constraint | Trigger must prevent changing to 'item' if node has children | HIGH |
| 18 | RLS policies not mentioned | Security gap | Define RLS policies for all tables | HIGH |
| 19 | Soft deletes not addressed | Feature gap | Document as acceptable deferral; history tables are partial mitigation | MEDIUM |

---

## Overall Verdict

The architecture is **well-reasoned and implementable**. The hybrid base+detail pattern, adjacency list tree, classificatory phases, and copy-on-instantiate catalog are all correct foundational choices. The document shows genuine independent thinking rather than inherited patterns.

The weaknesses are mostly in specificity (underspecified areas like option set broad selections, ratio semantics, sort order conflicts) rather than fundamental design errors. The most impactful changes would be:

1. Add `ltree` path column from day one (significant server-side query capability for minimal cost)
2. Fix decimal precision for calculated totals (DECIMAL(15,4) not (15,2))
3. Specify the missing trigger case for node_type UPDATE
4. Concretely define the broad option set selection table
5. Add RLS policies

None of these require rethinking the architecture. They're refinements to a solid foundation.

**Recommendation: Proceed to implementation with the specific fixes noted above.**
