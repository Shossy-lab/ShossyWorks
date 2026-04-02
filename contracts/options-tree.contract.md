# Options-Tree Contract

**Last verified**: 2026-04-02
**Governs**: Interface between inline options system and the estimate tree

## Required Fields

| Field | Type | Notes |
|-------|------|-------|
| anchor_node_id | UUID FK | On option_groups. Tree node where option lives. |
| is_selected | BOOLEAN | On option_alternatives. Exactly one TRUE per group. |
| node_option_memberships | junction | Links node_id to option_alternative_id. |

## Calculated Fields (Read-Only)

| Field | Formula |
|-------|---------|
| active tree | Nodes NOT in any deselected alternative |

## Invariants

- Exactly one alternative per group is selected (partial unique index + app logic).
- Selection switch is atomic: deselect old + select new in one transaction.
- Nodes with no membership rows are ALWAYS visible (unoptioned).
- All alternatives in a group share the same parent_id (same tree position).
- Deleting anchor node cascade-deletes option_group, alternatives, and memberships.
- Initial release: one option group per node. Schema supports nested options later.

## Cross-Feature Rules

- Active tree query: exclude nodes where ANY membership points to a deselected alternative.
- Parent aggregation uses only active children (see tree-calculation contract).
- Moving node into optioned subtree triggers membership propagation (trigger).
- Children of a promoted node inherit parent's option memberships.
- Creating option: stamps existing node + descendants with base alternative ID.
- Creating alternative: new nodes at same parent_id, stamped with new alternative ID.
- Option sets store per-group selection snapshots. Applying a set updates is_selected.
- Broad options are independent -- they override parameters, not tree structure.

## Change Protocol

Update contract FIRST, then code, then CONTRACT-INDEX.md. Commit together.
