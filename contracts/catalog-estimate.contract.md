# Catalog-Estimate Contract

**Last verified**: 2026-04-02
**Governs**: Interface between catalog system and estimate node instantiation

## Required Fields

| Field | Type | Notes |
|-------|------|-------|
| catalog_source_id | UUID | Soft reference (no FK) to catalog_items or catalog_assemblies |
| catalog_source_type | VARCHAR(20) | 'item' or 'assembly' -- identifies source table |
| catalog_version | INTEGER | Version at instantiation, for drift detection |

## Calculated Fields (Read-Only)

| Field | Formula |
|-------|---------|
| sync_status | Compare node details vs catalog source at stored version |

## Invariants

- Instantiation is ALWAYS a deep copy. Estimates own their data. No live references.
- Deleting a catalog entry never breaks estimates (soft reference, no FK).
- Assembly instantiation is recursive; each component becomes a child node with detail row.
- Assembly deep-copy remaps all internal parent_id references to new node IDs.
- Max recursive nesting depth: 5 levels (advisory).
- catalog_source_id cleared on auto-promotion (item->group). Original in history.

## Cross-Feature Rules

- Pull from catalog: updates node details from latest version. PRESERVES qty.
- Push to catalog: updates catalog from node values. Increments catalog version.
- Unlink: clears catalog_source_id/version. Node becomes independent.
- Component overrides (name, cost, waste_factor) from catalog_assembly_components apply to instantiated children.
- Ratio/formula qty_modes from catalog components carry into instantiated nodes.

## Change Protocol

Update contract FIRST, then code, then CONTRACT-INDEX.md. Commit together.
