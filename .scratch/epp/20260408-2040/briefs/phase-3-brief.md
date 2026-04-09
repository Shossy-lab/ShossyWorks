# Research Swarm — Shared Brief

## Mission
Each research agent investigates ONE topic cluster from the comprehensive analysis. Produce concrete, implementable solutions with SQL, TypeScript, and file paths.

## Context Files
- Comprehensive analysis: `A:\ShossyWorks\.scratch\epp\20260408-2040\phase-1\comprehensive-analysis.md`
- Data architecture: `A:\ShossyWorks\research\output\01-data-architecture.md`
- 5 decisions: `C:\Users\zacha\.claude\projects\A--ShossyWorks\memory\project_interaction-decisions.md`
- Node promotion triggers: `A:\ShossyWorks\research\output\research-node-promotion.md`
- Addendum requirements: `A:\ShossyWorks\research\output\05-addendum-new-requirements.md`
- Existing migrations: `A:\ShossyWorks\supabase\migrations\`

## Output Format
Write to: `A:\ShossyWorks\.scratch\epp\20260408-2040\phase-3\research\{topic-slug}-research.md`

Structure:
```
# {Topic} Research

## Problem Statement (2-3 sentences)
## Recommended Solution
### SQL (exact CREATE TABLE / CREATE FUNCTION / CREATE POLICY statements)
### TypeScript (exact type definitions, function signatures)
### File Paths (where each piece goes)
## Trade-offs Considered
## Effort Estimate
## Dependencies (what must exist before this can be implemented)
## Test Cases (specific tests needed, with descriptions)
```

Be CONCRETE. No hand-waving. Actual SQL. Actual TypeScript. Actual file paths.
