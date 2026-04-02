# Research: Automatic Node Type Promotion in Tree Hierarchy

> **Date:** 2026-04-02
> **Scope:** What happens when an item node gains children in the estimate tree? How should the system handle automatic type promotion, demotion, and all downstream effects?
> **Audience:** Implementation sessions. Zac for review.
> **Status:** Research complete. Recommendations ready for implementation.

---

## Table of Contents

1. [The User's Workflow](#1-the-users-workflow)
2. [What Happens to Item Data During Promotion](#2-what-happens-to-item-data-during-promotion)
3. [Should Promotion Default to Group or Assembly](#3-should-promotion-default-to-group-or-assembly)
4. [Demotion: Reverse Promotion](#4-demotion-reverse-promotion)
5. [Promotion and the Calculation Chain](#5-promotion-and-the-calculation-chain)
6. [Promotion and Options](#6-promotion-and-options)
7. [Promotion and Assemblies (Ratio-Based Children)](#7-promotion-and-assemblies-ratio-based-children)
8. [Promotion and Catalog References](#8-promotion-and-catalog-references)
9. [Database vs Application Logic](#9-database-vs-application-logic)
10. [How Other Tools Handle This](#10-how-other-tools-handle-this)
11. [Recommended Implementation](#11-recommended-implementation)
12. [Migration/Trigger SQL](#12-migrationtrigger-sql)
13. [Open Questions for Zac](#13-open-questions-for-zac)

---

## 1. The User's Workflow

Zac describes the core pattern:

> "I am typically estimating in an iterative workflow. There may be a line item for 'flooring', and then as we get more detailed, the flooring line item would be expanded with child-rows. So what was once the 'flooring' line item would become the 'flooring' assembly/parent, as I added items indented below it like 'flooring material', 'flooring labor', etc."

The keyboard model: **Tab** = indent (make child of previous sibling), **Shift+Tab** = outdent (make sibling of current parent). These operations change `parent_id`, which drives the tree structure.

The problem: the current architecture enforces that items are ALWAYS leaf nodes. A database trigger on INSERT rejects any child whose proposed parent has `node_type = 'item'`. This blocks the iterative workflow entirely.

The solution must allow items to accept children by automatically changing their type when a child is added (promotion), while preserving data integrity across all downstream systems.

---

## 2. What Happens to Item Data During Promotion

### The Data at Stake

When an item is promoted, its `node_item_details` row contains:

| Field | Example Value | Relevance After Promotion |
|-------|---------------|--------------------------|
| `qty`, `raw_qty` | 1200.0000 | **Meaningless** -- group totals are SUM(children) |
| `qty_mode` | `'numeric'` | **Meaningless** -- groups don't have qty modes |
| `qty_formula` | `= wall_area * 1.15` | **Meaningless** -- groups don't evaluate formulas |
| `ratio_numerator/denominator` | 2.88 / 1.0 | **Meaningless** -- groups don't use ratios |
| `unit_id` | FK to "SF" | **Meaningless** for group, **useful seed** for assembly |
| `unit_cost` | 8.5000 | **Meaningless** -- group totals come from children |
| `cost_formula` | NULL | **Meaningless** |
| `cost_type` | `'material'` | **Ambiguous** -- group might contain mixed cost types |
| `contingency_rate` | 0.0500 | **Useful as default** for new children |
| `overhead_rate` | 0.1000 | **Useful as default** for new children |
| `waste_factor` | 0.1500 | **Meaningless** for group, **useful seed** for children |
| `min_order_qty` | 10.0000 | **Meaningless** |
| `package_size` | NULL | **Meaningless** |
| `vendor_id` | FK to vendor | **Ambiguous** -- see Section 5 |
| `bid_type` | `'estimate'` | **Meaningless** for groups |
| `allowance_budget` | NULL | **Meaningless** for groups |
| `instructions` | "Install per spec" | **Meaningless** for groups (children get their own) |
| `specifications` | "Grade A hardwood" | **Meaningless** for groups |
| `unit_price` | 9.3500 | **Meaningless** -- recalculated from children |

### Recommendation: Soft-Delete (Archive) the Detail Row

**Option (a) -- Hard delete:** Simple, clean. The history table already captured the old values via the DELETE trigger. But recovery requires querying a history table, which is a different query path than normal CRUD.

**Option (b) -- Soft-delete/archive:** Add an `archived_at TIMESTAMPTZ` column to `node_item_details`. On promotion, set `archived_at = NOW()`. The row stays in the table but is excluded from all calculations by filtering on `archived_at IS NULL`. On demotion (if supported), un-archive by setting `archived_at = NULL`.

**Option (c) -- Keep but ignore:** Don't touch the row. Calculation logic skips detail rows for non-item nodes. Risk: confusing data state where a group node has item details that are visibly "there" but functionally dead. This creates maintenance debt and confusion for debugging.

**Recommended: Option (b) -- soft-delete.** Rationale:

1. **Recovery is trivial.** Demotion (Section 4) simply clears `archived_at`. No history table querying needed.
2. **The data stays with the node.** No need to match history records by `node_id` and timestamp -- the archived row IS the original data.
3. **Calculation safety.** The `archived_at IS NULL` filter is a single WHERE clause added to the calculation engine's detail-fetching query. Groups and assemblies never have non-archived detail rows, so no false matches.
4. **History table serves a different purpose.** The history table captures every intermediate state (10 edits to qty before promotion). The archived row captures the FINAL state at the moment of promotion -- which is what you want for recovery.
5. **Minimal schema change.** One nullable TIMESTAMPTZ column on `node_item_details`.

**What about `node_assembly_details`?** If promoting to assembly (see Section 3), a new `node_assembly_details` row is created. This is an INSERT, not a conversion from the item detail row. The unit from `node_item_details.unit_id` can seed `node_assembly_details.assembly_unit_id`.

---

## 3. Should Promotion Default to Group or Assembly

### The Two Cases

**Case A -- "Flooring" example (group behavior):**
The user has a $12,000 flooring line item. They break it down into "Flooring Material" ($8,000) and "Flooring Labor" ($4,000). The promoted "Flooring" node is a pure container. Its total is SUM(children). It has no quantity of its own -- it's not "1200 SF of flooring with children that calculate relative to it." The children have their own independent quantities.

**Case B -- "Siding" example (assembly behavior):**
The user has a siding line item at $8.50/SF for 1200 SF. They want to break it into "Siding Material" (ratio: 2.88 LF per 1 SF), "Siding Labor" (ratio: 0.5 HR per 1 SF), and "Siding Fasteners" (ratio: 1 box per 75 SF). The promoted "Siding" node becomes an assembly with `assembly_qty = 1200` and `assembly_unit_id = SF`. Children use ratio-based quantities relative to the assembly.

### Recommendation: Always Default to Group, with Easy Conversion to Assembly

**Why group as default:**

1. **Most common case.** The iterative workflow Zac describes -- "I have a placeholder, now I'm breaking it down" -- is usually a container/summary operation. The new children have their own quantities and costs entered from scratch.

2. **Safer.** A group has no calculation mechanics of its own. Its totals are pure SUM(children). There is nothing to misconfigure. Promoting to assembly requires setting `assembly_qty` and `assembly_unit_id`, which may not have obvious values.

3. **Assembly is a conscious choice.** When the user WANTS ratio-based children, they know they're creating an assembly relationship. This is a meaningful architectural decision, not something that should happen automatically.

**The conversion path:**

After promotion to group, the user can change `node_type` from `'group'` to `'assembly'` via the UI. When they do:
- Create a `node_assembly_details` row
- Seed `assembly_unit_id` from the archived `node_item_details.unit_id` (if available)
- Seed `assembly_qty` from the archived `node_item_details.qty` (if available)
- The user confirms/adjusts these values

This two-step flow (auto-promote to group, manually upgrade to assembly) keeps the automatic behavior simple and the complex behavior intentional.

**Alternative considered and rejected: "Smart detection."** We could try to detect whether the promotion should be group or assembly based on the item's data (if it has a unit and qty, maybe it should be an assembly?). Rejected because: (a) most items have qty and unit -- that doesn't mean they should become assemblies, (b) the user's intent is ambiguous without asking, (c) implicit smart behavior that guesses wrong is worse than explicit simple behavior that always works.

---

## 4. Demotion: Reverse Promotion

### When Demotion Could Occur

A group or assembly has all its children removed -- either deleted or outdented to become siblings. The node is now a childless parent. Should it automatically revert to an item?

### Recommendation: No Auto-Demotion. Manual Only.

**Why auto-demotion is dangerous:**

1. **Surprise data loss.** The user outdents a child to reorganize. They didn't intend to demote the parent -- they were just rearranging. Auto-demotion would silently change the node's type, potentially discarding the assembly details row and restoring archived item details the user has forgotten about.

2. **Undo complexity.** If the user immediately re-indents the child, the node would auto-promote again. This creates a promote-demote-promote cycle that could lose data at each step.

3. **Intent ambiguity.** An empty group is a valid state. A user might create a group first and add children later. Auto-demoting it to an item because it's momentarily childless would be wrong.

4. **Assembly destruction.** If a node was manually converted to an assembly (with qty, unit, and ratio-based children), and the user temporarily moves all children elsewhere, auto-demotion would destroy the assembly configuration. When they move children back, they'd have to reconfigure everything.

**The manual demotion path:**

Offer a context menu action: "Convert to Item" (on a group/assembly with no children). When triggered:
- Verify the node has no children (reject otherwise)
- Check for an archived `node_item_details` row
  - If found: un-archive it (`archived_at = NULL`), restoring the original item data
  - If not found: create a new empty `node_item_details` row
- If the node has `node_assembly_details`: delete it (hard delete -- it was created during promotion or manual conversion, no need to archive)
- Change `node_type` to `'item'`

**Recovery from history:** If no archived detail row exists (e.g., the row was hard-deleted in an older version of the system), the history table can be queried: `SELECT * FROM node_item_details_history WHERE node_id = $1 AND change_type = 'delete' ORDER BY changed_at DESC LIMIT 1`. This is a fallback, not the primary path.

**Summary:** Auto-promote YES, auto-demote NO. Promotion is triggered by an unambiguous event (user added a child to an item). Demotion has no unambiguous trigger -- an empty parent is a valid state.

---

## 5. Promotion and the Calculation Chain

### Before Promotion

```
Flooring (item):
  subtotal = qty * unit_cost = 1200 * 8.50 = 10,200.00
  contingency_amount = subtotal * contingency_rate = 10,200 * 0.05 = 510.00
  overhead_amount = (subtotal + contingency) * overhead_rate = 10,710 * 0.10 = 1,071.00
  total_price = 10,200 + 510 + 1,071 = 11,781.00
```

### After Promotion (to group)

```
Flooring (group):
  subtotal = SUM(children.subtotal) = (calculated from children)
  contingency_amount = SUM(children.contingency_amount)
  overhead_amount = SUM(children.overhead_amount)
  total_price = SUM(children.total_price)
```

The node's own qty, unit_cost, contingency_rate, and overhead_rate are no longer used. All values come from children.

### What Happens to Rates

**Contingency and overhead rates on the promoted node:**

These rates lived on `node_item_details`, which is now archived. The base table's calculated cost fields (`subtotal`, `contingency_amount`, `overhead_amount`, `total_price`) get overwritten by the SUM(children) calculation on the next recalc.

The node no longer has its own rates. The "effective rate" displayed on the parent is reverse-calculated: `effective_contingency_rate = contingency_amount / subtotal`. This is a display concern, already handled by the architecture (see Section 9.2 of data-architecture.md).

**Seeding children with the old rates:** When the user adds child items to the newly promoted group, the system should default their `contingency_rate` and `overhead_rate` to the estimate's default rates (`estimates.default_contingency_rate`, `estimates.default_overhead_rate`). Optionally, the original item's rates (from the archived detail row) could be offered as the default for children created during the same promotion event, but this adds complexity for marginal value.

### What Happens to Vendor Assignment

The promoted node had `node_item_details.vendor_id` pointing to a vendor. After promotion:
- The vendor assignment is archived with the detail row
- The group node has no vendor (groups don't have vendors -- multiple children might have different vendors)
- Individual child items get their own vendor assignments

**No special handling needed.** The vendor FK is on the detail row, which is archived. Groups naturally don't have vendor assignments.

### Recalculation Trigger

After promotion, the calculation engine must:
1. Recognize the node is now a group (check `node_type`)
2. Use SUM(children) instead of qty*unit_cost
3. If the promoted node has no children yet (promotion happened but children haven't been added), all cost fields = 0
4. Recalculate all ancestors (bottom-up propagation)

This is NOT a new code path. The calculation engine already handles groups via SUM(children). The promoted node simply switches from the item code path to the group code path by virtue of its `node_type` changing.

---

## 6. Promotion and Options

### The Problem

An item belongs to an option alternative (via `node_option_memberships`). The user promotes it by adding children. Those new children need to inherit the option membership -- otherwise they'd appear in ALL alternatives.

### Example

```
Kitchen (group, anchor for "Kitchen Package" option group)
  +-- Standard Kitchen (option_alternative: "Standard", selected)
  |   +-- Countertops (item, member of "Standard")  <-- user promotes this
  |       +-- Countertop Material (new child)        <-- must inherit "Standard" membership
  |       +-- Countertop Labor (new child)           <-- must inherit "Standard" membership
  +-- Premium Kitchen (option_alternative: "Premium", not selected)
      +-- Countertops (item, member of "Premium")
```

If "Countertop Material" and "Countertop Labor" don't get "Standard" membership, they'd be visible in BOTH alternatives.

### Recommendation: Inherit Option Memberships on INSERT

When a new node is inserted with a `parent_id`, check if the parent has any `node_option_memberships` rows. If so, create matching membership rows for the new child.

This is already the expected behavior for the junction table approach described in the architecture (Section 7.2 of data-architecture.md): "A trigger on `parent_id` UPDATE can add the moved node to the parent's option memberships." The same trigger handles both moves and new inserts.

**Implementation:** The INSERT/UPDATE trigger on `estimate_nodes` that checks `parent_id` should:
1. Look up the new parent's option memberships
2. Copy those memberships to the inserted/moved node
3. Recursively apply to all descendants (if moving a subtree)

This trigger is needed regardless of promotion. It's a general tree-operation safety trigger for the options system. Promotion just happens to exercise it.

**The promoted node itself:** Its own option memberships don't change. It was already a member of the alternative. Promotion changes its `node_type`, not its tree position or option membership.

---

## 7. Promotion and Assemblies (Ratio-Based Children)

### The Problem

An item inside an assembly has `qty_mode = 'ratio'` with `ratio_numerator = 2.88` and `ratio_denominator = 1.0` (meaning "2.88 LF per 1 SF of parent assembly"). If this item is promoted to a group, the ratio becomes meaningless -- a group doesn't have a ratio relationship with its parent assembly.

### Example

```
Wall Assembly (assembly_qty = 1200 SF)
  +-- Siding (item, ratio: 2.88 LF per 1 SF)  <-- user promotes this
      +-- Siding Material (new child)
      +-- Siding Labor (new child)
```

After promotion, "Siding" is a group. Its relationship with the parent assembly is structural (it's a child) but not quantitative (it doesn't use a ratio).

### Recommendation: Promotion to Group Drops the Ratio; Promotion to Assembly Could Preserve It

**Promotion to group (the default):**
- The ratio is archived with the `node_item_details` row
- The promoted group's totals come from SUM(children)
- The children are NOT automatically given ratio-based quantities -- they use `qty_mode = 'numeric'` by default
- The user enters explicit quantities on the children

**If the user later converts to assembly:**
- The assembly gets `assembly_qty` and `assembly_unit_id` (potentially seeded from the archived item details or from the parent assembly's values)
- The user sets up ratio-based quantities on the children manually

**Should promotion be BLOCKED for ratio-based assembly children?**

No. Blocking would frustrate the iterative workflow. The user should be able to expand any line item. The ratio data is preserved in the archived detail row and can be referenced when setting up the new children's quantities. The information is not lost -- it's just no longer automatically applied.

**Transfer the ratio to new children?**

Not automatically. The original ratio was "2.88 LF of siding per 1 SF of wall." If the siding line item is expanded into material + labor, each child has a DIFFERENT relationship with the parent assembly. The material might be "2.88 LF per 1 SF" but the labor might be "0.5 HR per 1 SF." The system can't know how to split the original ratio.

However, when the user creates children immediately after promotion (as part of the same workflow), the UI could offer to pre-populate the first child's ratio with the original item's ratio. This is a UX convenience, not a database concern.

---

## 8. Promotion and Catalog References

### The Problem

An item instantiated from the catalog has `catalog_source_id` (a soft reference -- no FK) and `catalog_source_type = 'item'`. Promotion changes it from an item to a group. The catalog reference is now semantically wrong -- the node is no longer an instance of that catalog item.

### Recommendation: Clear the Catalog Reference on Promotion

Set `catalog_source_id = NULL`, `catalog_source_type = NULL`, `catalog_version = NULL` on the base table when the node is promoted.

**Rationale:**
1. The catalog link implies "this node was instantiated from catalog item X and can be compared against it for updates." A promoted group is no longer comparable to the catalog item.
2. If the catalog has an update notification system ("catalog item X was updated, do you want to sync?"), the promoted node should NOT receive those notifications.
3. The original catalog reference is preserved in the history table (the UPDATE trigger captures the old values).

**Should we preserve it for reference?** We could keep it for "this group was originally derived from catalog item X" informational purposes. But this creates confusion: is the catalog link active or informational? A clean break is simpler. If provenance tracking is needed later, a dedicated `original_catalog_source_id` column or a note in the node's `description` field could serve that purpose without muddying the active catalog link.

---

## 9. Database vs Application Logic

### The Core Question

Should promotion be:
- **(a) A database trigger** that fires when INSERT detects the parent is an item, automatically changing the parent's `node_type` and archiving the detail row?
- **(b) Application logic** that the UI/server calls explicitly before or during the child INSERT?

### Recommendation: Hybrid -- Database Trigger for Safety, Application Logic for UX

**The trigger handles the invariant:**
A trigger on INSERT into `estimate_nodes` checks if the parent node has `node_type = 'item'`. If so, the trigger:
1. Updates the parent's `node_type` to `'group'`
2. Sets `archived_at = NOW()` on the parent's `node_item_details` row
3. Clears the parent's `catalog_source_id`, `catalog_source_type`, `catalog_version`
4. Allows the INSERT to proceed

This ensures the invariant "items never have children" is ALWAYS enforced, even if application code has a bug, a migration runs directly, or a future developer forgets the promotion logic.

**The application handles the UX:**
Before the trigger fires, the application layer can:
1. Detect that the user is about to add a child to an item
2. Show a brief, non-blocking notification: "Converting 'Flooring' from item to group"
3. Optionally offer the choice: "Convert to Group" or "Convert to Assembly" (if we support assembly promotion -- see Section 3)
4. If the user chooses assembly, set `node_type = 'assembly'` and create the assembly detail row BEFORE inserting the child

**Why not trigger-only?**
- No confirmation dialog possible. The trigger fires silently.
- No choice between group and assembly. The trigger would always pick one.
- The user might not realize their item was promoted until they notice the icon changed.

**Why not application-only?**
- A missed code path means a child gets inserted under an item, violating the invariant.
- Direct SQL operations (migrations, data fixes, bulk imports) bypass application logic.
- The database should enforce its own invariants regardless of the application layer.

**The hybrid model:**
```
User presses Tab to indent "Flooring Material" under "Flooring" (an item)
  -> Application detects: target parent is an item
  -> Application shows: "Converting 'Flooring' to group" notification
  -> Application sends: UPDATE parent SET node_type = 'group' + archive detail row
  -> Application sends: INSERT child with parent_id = flooring.id
  -> Database trigger: verifies parent is no longer an item (it's a group now -- no action needed)
  -> If application FORGOT the pre-conversion: trigger catches it and does the conversion
```

The trigger is a safety net. The application does the conversion proactively for better UX. Both paths produce the same result. The trigger never fires in normal operation -- it only catches bugs.

**The trigger should NOT block the INSERT.** Instead of rejecting "cannot add child to item," it should auto-promote the parent. The current architecture has a trigger that REJECTS the INSERT. This must be REPLACED with one that PROMOTES the parent.

---

## 10. How Other Tools Handle This

### Excel / Google Sheets

Any row can have children via the outline/group feature. There is no concept of "type" -- rows don't distinguish between container rows and leaf rows. A row with children automatically gets a collapse/expand control. When all children are removed (ungrouped), the row reverts to a normal row. No data changes -- the row's content is completely unaffected by its parent/child status.

**Lesson:** The simplest model is "any row can be a parent." Type distinctions are a construction-estimating-specific concern, not a tree concern.

### Notion

Blocks auto-become parents when content is indented under them (Tab key). There is no type distinction -- a text block, a toggle block, a database block can all have children. No promotion/demotion concept exists because there are no types to promote between.

**Lesson:** Users expect Tab/Shift+Tab to work immediately, without dialogs or confirmations. The promotion should feel as invisible as Notion's block nesting.

### Smartsheet

Any row can become a parent when another row is indented under it. No type restrictions -- the hierarchy is purely positional. Parent rows can use hierarchy functions (`CHILDREN()`, `PARENT()`, `ANCESTORS()`) in formulas to aggregate child values. When all children are outdented, the row remains unchanged -- no auto-demotion.

**Lesson:** Smartsheet's "any row can be a parent" model, combined with formula-based aggregation, is the closest analog to our architecture. Note: Smartsheet does NOT auto-demote when children are removed. The parent stays a parent (structurally) until manually changed.

### ProEst / Sage Estimating

These tools do NOT support the iterative workflow directly. Items and assemblies are distinct entities in the database:
- In ProEst, assemblies are created in the database/costbook as "recipes" of items. You don't convert a line item into an assembly by adding children to it -- you create the assembly separately and then use it in the estimate.
- In Sage Estimating, assemblies are predefined "Work Assemblies" in the database. The estimate references them. There is no in-estimate item-to-assembly conversion.

**Lesson:** Competitor tools solve this workflow at the catalog/database level, not the estimate level. Our approach of supporting in-estimate promotion is a differentiator -- it matches how builders actually think (start rough, add detail) rather than how traditional tools are structured (define precisely, then use).

### PlanSwift / STACK

These are takeoff-focused tools where assemblies are templates. You create an assembly template, then apply it to a measurement on the plans. There is no "convert a line item into an assembly in-place." The workflow is: take off a measurement -> apply an assembly template -> the template's items populate.

**Lesson:** These tools front-load the assembly structure. Our approach allows back-loading it (start with a single line, expand later). This is more flexible for the iterative estimating pattern.

---

## 11. Recommended Implementation

### Summary of Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| What happens to item data? | Soft-delete (archive) the `node_item_details` row | Trivial recovery for demotion; data stays with the node |
| Default type on promotion? | Always `group` | Safer; assembly requires conscious configuration |
| Auto-demotion? | No -- manual only | Empty groups are valid; auto-demotion causes surprise data loss |
| Calculation chain? | Uses existing SUM(children) path | No new code path; just node_type changes from 'item' to 'group' |
| Option memberships? | Children inherit parent's memberships on INSERT | General tree-operation trigger; not promotion-specific |
| Ratio-based assembly children? | Ratio is archived; not transferred to children | Can't split a ratio meaningfully; user sets up children manually |
| Catalog references? | Cleared on promotion | Clean break; original reference in history |
| DB trigger or app logic? | Hybrid: app for UX, trigger as safety net | Invariant enforced at DB level; UX handled at app level |

### Implementation Sequence

**Step 1: Schema change**
- Add `archived_at TIMESTAMPTZ` to `node_item_details` (nullable, default NULL)
- Add partial index: `CREATE INDEX idx_item_details_active ON node_item_details(node_id) WHERE archived_at IS NULL`

**Step 2: Replace the INSERT rejection trigger**
- Remove the existing trigger that rejects INSERT when parent is an item
- Replace with a trigger that auto-promotes the parent:
  1. Check if parent `node_type = 'item'`
  2. Update parent `node_type` to `'group'`
  3. Set `archived_at = NOW()` on the parent's `node_item_details` row
  4. Clear `catalog_source_id`, `catalog_source_type`, `catalog_version` on the parent
  5. Allow the INSERT to proceed

**Step 3: Update the calculation engine**
- Ensure the detail-row fetch query filters on `archived_at IS NULL`
- No new calculation logic needed -- groups already use SUM(children)

**Step 4: Update the option membership trigger**
- On INSERT/UPDATE of `parent_id`, copy the new parent's `node_option_memberships` to the child
- This is needed regardless of promotion (for move operations into option subtrees)

**Step 5: Add manual demotion support**
- UI action "Convert to Item" (available on groups/assemblies with no children)
- Unarchive the `node_item_details` row (`archived_at = NULL`)
- If no archived row exists, create a new blank `node_item_details` row
- Delete `node_assembly_details` if it exists
- Change `node_type` to `'item'`
- Restore `catalog_source_id` from archived row if available (optional -- discuss with Zac)

**Step 6: Application-layer UX**
- Detect indent-into-item in the tree UI
- Show brief toast notification: "Converted 'Flooring' to group"
- The notification is informational, not blocking -- the operation proceeds immediately

---

## 12. Migration/Trigger SQL

### Schema Addition

```sql
-- Add archive column to node_item_details
ALTER TABLE node_item_details
ADD COLUMN archived_at TIMESTAMPTZ DEFAULT NULL;

-- Partial index: only active (non-archived) details participate in calculations
CREATE INDEX idx_item_details_active
ON node_item_details(node_id) WHERE archived_at IS NULL;

COMMENT ON COLUMN node_item_details.archived_at IS
  'Set on promotion (item -> group/assembly). NULL = active. '
  'Archived rows are excluded from calculations but preserved for demotion recovery.';
```

### Promotion Trigger (replaces the current INSERT-rejection trigger)

```sql
CREATE OR REPLACE FUNCTION auto_promote_item_parent()
RETURNS TRIGGER AS $$
DECLARE
  parent_type VARCHAR(20);
BEGIN
  -- Only check if the new node has a parent
  IF NEW.parent_id IS NOT NULL THEN
    SELECT node_type INTO parent_type
    FROM estimate_nodes
    WHERE id = NEW.parent_id;

    -- If parent is an item, promote it to group
    IF parent_type = 'item' THEN
      -- 1. Change parent node_type to 'group'
      UPDATE estimate_nodes
      SET node_type = 'group',
          catalog_source_id = NULL,
          catalog_source_type = NULL,
          catalog_version = NULL,
          updated_at = NOW()
      WHERE id = NEW.parent_id;

      -- 2. Archive the parent's item details (soft-delete)
      UPDATE node_item_details
      SET archived_at = NOW()
      WHERE node_id = NEW.parent_id
        AND archived_at IS NULL;

      -- Note: The history trigger on estimate_nodes and node_item_details
      -- will automatically capture the old values before these UPDATEs.
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Fire BEFORE INSERT so the parent is promoted before the child row is committed
CREATE TRIGGER trg_auto_promote_item_parent
  BEFORE INSERT ON estimate_nodes
  FOR EACH ROW
  EXECUTE FUNCTION auto_promote_item_parent();
```

### Keep the Existing UPDATE Trigger (Prevent Demotion to Item with Children)

The existing `prevent_item_with_children()` trigger on UPDATE remains unchanged. It prevents changing `node_type` to `'item'` if the node has children. This is still correct -- manual demotion should only work on childless nodes.

### Option Membership Inheritance Trigger

```sql
CREATE OR REPLACE FUNCTION inherit_option_memberships()
RETURNS TRIGGER AS $$
BEGIN
  -- When a node is inserted or moved (parent_id changes),
  -- inherit the new parent's option memberships
  IF NEW.parent_id IS NOT NULL THEN
    INSERT INTO node_option_memberships (id, node_id, option_alternative_id)
    SELECT gen_random_uuid(), NEW.id, nom.option_alternative_id
    FROM node_option_memberships nom
    WHERE nom.node_id = NEW.parent_id
    ON CONFLICT (node_id, option_alternative_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inherit_option_memberships
  AFTER INSERT ON estimate_nodes
  FOR EACH ROW
  EXECUTE FUNCTION inherit_option_memberships();

-- Also fire on UPDATE when parent_id changes (move operations)
CREATE TRIGGER trg_inherit_option_memberships_on_move
  AFTER UPDATE OF parent_id ON estimate_nodes
  FOR EACH ROW
  WHEN (OLD.parent_id IS DISTINCT FROM NEW.parent_id)
  EXECUTE FUNCTION inherit_option_memberships();
```

---

## 13. Open Questions for Zac

These questions have clear recommendations above but would benefit from Zac's explicit confirmation:

1. **Default to group -- confirmed?** When you indent under an item, it becomes a group (not an assembly). You'd manually convert to assembly if needed. Does this match your mental model?

2. **No auto-demotion -- confirmed?** When all children are removed from a group, it stays a group. You'd manually convert back to item via a context menu. Is this acceptable, or do you strongly prefer auto-demotion?

3. **Toast notification -- sufficient?** When promotion happens, you'd see a brief "Converted 'Flooring' to group" toast. No confirmation dialog (that would break the Tab-to-indent flow). Is a toast enough, or do you want something more visible?

4. **Catalog link clearing -- confirmed?** When a catalog-sourced item is promoted, the catalog link is broken. The original reference is preserved in history. Is this the right behavior, or would you prefer to keep the catalog reference for informational purposes?

5. **Children don't inherit the old item's rates -- confirmed?** When you add children to the newly promoted group, they get the estimate's default contingency/overhead rates, not the promoted item's rates. Would you prefer the option to seed children with the old item's rates?

---

## Sources

Architecture references:
- `research/output/01-data-architecture.md` -- Sections 3-4 (node types, base table, detail tables), Section 7.2 (options junction table), Section 8.3 (history tables), Section 9 (calculation architecture)
- `research/output/03-open-questions.md` -- Q1 (group type), Q3 (assembly parameters)
- `research/output/reviews/03-options-system-review.md` -- Junction table approach, tree move corruption risks
- `research/output/reviews/05-industry-research.md` -- Industry tool comparison

External references:
- [Smartsheet: Hierarchy indent/outdent](https://help.smartsheet.com/articles/504734-hierarchy-indenting-outdenting-rows) -- Any row can become a parent, no type restrictions
- [Smartsheet: Rows and hierarchy](https://help.smartsheet.com/learning-track/level-1-foundations/rows-and-hierarchy) -- Automatic parent assignment on indent
- [Notion: Parent and child blocks](https://thomasjfrank.com/learn-notion/parent-and-child-blocks/) -- Blocks auto-become parents when content is indented
- [Excel: Outline/group data](https://support.microsoft.com/en-us/office/outline-group-data-in-a-worksheet-08ce98c4-0063-4d42-8ac7-8278c49e9aff) -- Any row can have children via grouping
- [RSMeans: Estimating methods](https://www.rsmeans.com/resources/estimating-methods-in-construction) -- Assembly vs detailed estimating approaches
- [Sage Estimating: Assemblies](https://help-sageestimating.na.sage.com/en-us/20_1/Content/assembly/hid_database_assemblies.htm) -- Assemblies as database-level recipes
