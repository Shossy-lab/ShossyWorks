# ⚠️ REFERENCE DOCUMENT — DO NOT USE AS A BLUEPRINT ⚠️

> **Source:** Second attempt ("Soloway Proposals" / soloway-estimating-platform repo)
> **Purpose:** Shows a completely different approach from Attempt 1. Where Attempt 1 was over-engineered for flexibility, this one was under-engineered — too rigid, too narrow, and dependent on an external Excel workbook.

---

## What This System Was

A client-facing construction proposal viewer for one specific project (the Soloway Residence). Built with Next.js + Supabase. Data flowed one direction only:

```
Excel Workbook (.xlsm) → Python export script → Supabase → Next.js frontend
```

The application was read-only by design. The Excel workbook was the source of truth. The web app was just a display layer with interactive features (expand/collapse tree, option selection, column toggling).

## Key Architectural Differences from Attempt 1

| Aspect | Attempt 1 (EP) | Attempt 2 (Soloway) |
|--------|----------------|---------------------|
| Hierarchy depth | Unbounded (runtime-derived) | Fixed 5 levels (stored `hierarchy_level` 0-4) |
| Data entry | In-app editing | Excel workbook only |
| Source of truth | Supabase database | Excel workbook |
| Data flow | Bidirectional | One-way (Excel → Supabase) |
| Scope | Full estimating platform | Client proposal viewer |
| Node types | 4 types (category, section, assembly, item) | Implicit from hierarchy level |
| Export mechanism | N/A (data lives in app) | Python script, full replace on each export |


## What Worked

1. **Bottom-up implementation (initially).** Started with data display before adding interactivity. The tree rendering, expand/collapse, and calculation display all worked well because the foundation was simple and stable.

2. **Client-facing UX.** Progressive disclosure via expand/collapse tree with depth-based formatting. Clients could understand complex estimates through a clean hierarchy. The option selection UI (inline panels, bubble-up indicators, overview modal) was effective.

3. **Per-row aggregation.** Parent nodes summed children's actual contingency and overhead amounts rather than reapplying global percentages. This correctly handled mixed markup rates across different items.

4. **Real-time option selection sync.** Using Supabase Realtime so the builder could see which options the client was selecting during a live budget meeting.

5. **Option Sets as overlay.** Named scenario presets that overlaid selections in memory without writing to the database until explicitly saved. Clean separation of "previewing" vs. "committing" a scenario.

## What Went Wrong

1. **Fixed 5-level hierarchy is too rigid.** Real estimates need variable depth. An assembly containing a sub-assembly containing items is 3 levels within what might be level 2 of the organizational hierarchy. A fixed depth model can't accommodate this.

2. **Excel dependency makes the app a dead end.** The app can never stand on its own. Every data change requires editing Excel, running the export script, and waiting for the full replace to complete. This was acceptable for one project but is not viable for a general estimating tool.

3. **Editing was bolted on after the fact.** The entire architecture (components, state management, data flow) assumed immutable data. When inline editing was added for admin users, it required a draft/publish workflow, new server actions, recalculation logic, and auth tiers — all retrofitted into a system that wasn't designed for mutation.

4. **No catalog, no assemblies, no formula engine.** Because data came from Excel, none of the catalog/assembly/formula infrastructure needed for a real estimating tool was built. These are the hardest parts of the system and this attempt didn't address them at all.

5. **The options system was partially populated.** Only 116 of 493 items had option data. The UI was built but the data coverage was incomplete, making it hard to test edge cases.

## What's Relevant for the New System

- **The option system's three-layer architecture** (broad options for parameter overrides, inline options for item/section swaps, option sets for saved scenarios) was well-designed and production-tested. The CONCEPTS are sound even though the implementation was tied to a read-only viewer.

- **The calculation chain** (subtotal → contingency compounding → overhead compounding → total) was proven correct against the Excel workbook's calculations.

- **The UX patterns** (progressive disclosure, depth-based formatting, inline option panels, bubble-up indicators) were effective for client communication.

- **The per-row aggregation principle** (sum children's actual amounts, don't reapply global rates) is the correct approach for mixed-rate estimates.

## What's NOT Relevant for the New System

- The Excel export pipeline (we're eliminating the Excel dependency entirely)
- The fixed 5-level hierarchy model
- The read-only-first architecture
- The Python export script
- The PIN-based auth system (fine for a proposal viewer, not for an estimating tool)
- The specific Supabase schema (designed for display, not editing)
- The specific component architecture (designed for immutable data rendering)
