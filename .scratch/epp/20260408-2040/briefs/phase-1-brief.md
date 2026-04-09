# Implementation Review Board — Shared Brief

## Mission
Analyze the ShossyWorks codebase and requirements to produce findings that will inform an updated implementation plan. The plan must incorporate 5 new interaction decisions into Phases 1A through 1B+.

## Context
- Codebase is small (~1,414 lines, 32 files), Phase 0 scaffold + hardening complete
- 5 interaction decisions were made on 2026-04-08 (see project_interaction-decisions.md)
- The existing plan needs updating to include: estimate snapshots, expanded enums, client visibility, user preferences, company settings, full-text search, catalog/options/sharing schema support
- Phase 1A = database schema + triggers + types + server actions + tests
- Phase 1B+ = catalog system, options, client sharing, comments, approvals, search UI

## Key Files to Read
1. `C:\Users\zacha\.claude\projects\A--ShossyWorks\memory\project_interaction-decisions.md` — THE 5 DECISIONS
2. `A:\ShossyWorks\research\output\01-data-architecture.md` — Original table designs
3. `A:\ShossyWorks\research\output\research-node-promotion.md` — Trigger SQL
4. `A:\ShossyWorks\research\output\05-addendum-new-requirements.md` — Recent requirements
5. `A:\ShossyWorks\.claude\memory\sessions\2026-04-06.md` — Weekend session (node_notes)
6. `A:\ShossyWorks\supabase\migrations\` — Existing migrations
7. `A:\ShossyWorks\src\` — Current source code
8. `C:\Users\zacha\.claude\plans\indexed-tumbling-wilkes.md` — Current plan

## Output Format
Each agent writes to: `A:\ShossyWorks\.scratch\epp\20260408-2040\phase-1\review-board\{role}-analysis.md`

Structure:
```
# {Role} Analysis — ShossyWorks Plan Update

## Summary (3-5 sentences)

## Findings
### Finding {N}: {Title}
- **Severity:** CRITICAL / HIGH / MEDIUM / LOW
- **Category:** Schema / Trigger / API / Security / Performance / UX / Testing
- **Details:** What the issue or opportunity is
- **Recommendation:** Concrete, actionable fix with file paths
- **Dependencies:** What else this depends on or blocks
- **Effort:** Trivial / Low / Medium / High

## Recommendations for Plan Update
Specific additions, changes, or reordering for the implementation plan.

## Questions for Other Board Members
Cross-cutting concerns that other agents should weigh in on.
```

## Anti-Sycophancy Rules
- Finding nothing is NOT an option — dig deeper
- "Looks good" is never a valid finding — be specific
- If you agree with existing decisions, explain WHY they're correct and what risks remain
- Challenge assumptions in the existing plan — it was written before the 5 decisions
