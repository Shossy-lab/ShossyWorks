# {FEATURE_NAME} Contract

**Last verified**: {YYYY-MM-DD}
**Governs**: {What this contract covers -- e.g., "Interface between estimate tree and calculation engine"}

## Required Fields

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| {field_name} | {type} | {default or required} | {constraints, validation rules} |

## Calculated Fields (Read-Only)

| Field | Formula | Triggers |
|-------|---------|----------|
| {field_name} | {how it is computed} | {what causes recalculation} |

## Invariants

Rules that must NEVER be violated:

- {invariant 1: e.g., "Parent nodes never have their own cost values -- always aggregations"}
- {invariant 2: e.g., "Items are always leaf nodes -- cannot have children"}
- {invariant 3: e.g., "Calculated fields cannot be manually overridden"}

## Cross-Feature Rules

How this feature interacts with others:

- {rule 1: e.g., "Catalog items are deep-copied on import -- changes never cascade back"}
- {rule 2: e.g., "Option packages affect visibility, not data -- toggling an option shows/hides nodes"}

## Change Protocol

When modifying code governed by this contract:

1. Update this contract FIRST
2. Update all implementing code
3. Update CONTRACT-INDEX.md
4. Update CODEBASE_MAP.md if structure changed
5. Verify with build / type-check
6. Commit contract + code + docs together -- NEVER separately
