# UI Planning — Implementation Review Board Brief

## CRITICAL CONTEXT
This is the phase where TWO PREVIOUS ATTEMPTS at this product FAILED. The user explicitly says this is "incredibly delicate and important" and rebuilding would be "catastrophic." Maximum effort. No shortcuts.

## Mission
Analyze the ShossyWorks codebase, design system, previous prototypes, and industry best practices to produce findings that will inform a comprehensive UI implementation plan. The plan must cover:
1. What pages and components need to be built
2. What to extract from previous prototypes (EP, Soloway, Figma)
3. Component architecture that supports iteration without rewriting
4. State management for complex interactions (tree view, real-time)
5. When and how the user (Zac) needs to provide feedback and direction
6. How research is documented and referenced during development
7. Integration with the existing Phase 1B plan

## Key Files to Read
1. `A:\ShossyWorks\.scratch\epp\20260409-1957-ui-planning\codebase-profile.md` — current state + failure modes
2. `A:\ShossyWorks\DESIGN-SYSTEM.md` — design token system and visual rules
3. `A:\ShossyWorks\INTENT.md` — 27 design decisions
4. `C:\Users\zacha\.claude\projects\A--ShossyWorks\memory\project_interaction-decisions.md` — 5 interaction decisions
5. `C:\Users\zacha\.claude\projects\A--ShossyWorks\memory\project_ui-critical-context.md` — failure modes + Figma discussion needed
6. `A:\ShossyWorks\src\app\` — current page structure
7. `A:\ShossyWorks\src\components\` — current components
8. `A:\ShossyWorks\src\lib\actions\` — available server actions
9. `A:\ShossyWorks\src\lib\types\` — available types
10. `A:\ShossyWorks\research\output\01-data-architecture.md` — table structures that UI must represent
11. `A:\ShossyWorks\research\output\02-implementation-sequence.md` — original phasing
12. `A:\ShossyWorks\research\references\attempt-1-ep-table-structure-spec.md` — EP prototype context
13. `A:\ShossyWorks\research\references\attempt-2-soloway-overview.md` — Soloway prototype context
14. `C:\Users\zacha\.claude\plans\indexed-tumbling-wilkes.md` — current approved plan (Phase 1B section)

## Output Format
Save findings to: A:\ShossyWorks\.scratch\epp\20260409-1957-ui-planning\phase-1\review-board\{role}-analysis.md

## Anti-Sycophancy Rules
- "It looks fine" is never acceptable. Find REAL problems and opportunities.
- Challenge assumptions. The existing plan's Phase 1B may be wrong.
- Think from the perspective of a construction business owner using this daily.
- If a component architecture won't survive Phase 2 (calculation engine), say so NOW.
