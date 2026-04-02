# Tree-Calculation Contract

**Last verified**: 2026-04-02
**Governs**: Interface between estimate tree data model and the isomorphic calculation engine

## Required Fields

| Field | Type | Notes |
|-------|------|-------|
| node_type | VARCHAR(20) | 'group'/'assembly'/'item' -- determines calc path |
| qty_mode | VARCHAR(20) | 'numeric'/'formula'/'ratio' -- determines raw_qty source |
| subtotal | DECIMAL(15,4) | Items: qty*unit_cost. Parents: SUM(active_children) |

## Calculated Fields (Read-Only)

| Field | Formula |
|-------|---------|
| raw_qty | numeric: direct / ratio: (parent_asm_qty * num) / denom / formula: evaluate() |
| qty | applyPurchasingConstraints(raw_qty, waste, package_size, min_order) |
| subtotal (item) | qty * unit_cost |
| contingency_amount | subtotal * contingency_rate |
| overhead_amount | (subtotal + contingency_amount) * overhead_rate |
| total_price | subtotal + contingency_amount + overhead_amount |
| subtotal (parent) | SUM(active_children.subtotal) -- same for contingency, overhead, total |

## Invariants

- All intermediates DECIMAL(15,4). Round to 2dp at display only.
- Overhead COMPOUNDS on contingency: (subtotal + contingency) * rate.
- Purchasing constraint order: waste -> package rounding -> minimum.
- Zero raw_qty skips all constraints, returns 0.
- Parent aggregation uses only active children (not in deselected alternatives).
- Calc engine is a pure function. Server recalculates on save; server values are authoritative.

## Cross-Feature Rules

- Option selections filter active children for aggregation (see options-tree contract).
- Broad options override parameters before formula evaluation.
- Calc order: resolve broad options -> resolve active tree -> calculate.
- Auto-promotion switches calc path from qty*unit_cost to SUM(children).

## Change Protocol

Update contract FIRST, then code, then CONTRACT-INDEX.md. Commit together.
