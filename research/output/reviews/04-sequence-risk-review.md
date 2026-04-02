# Review: Implementation Sequence & Risk Assessment

> **Reviewer:** Implementation Sequence Critic
> **Date:** 2026-04-02
> **Documents Reviewed:** `02-implementation-sequence.md`, `04-risk-assessment.md`
> **Supporting Context:** `01-data-architecture.md`, `03-open-questions.md`, `RESEARCH-SESSION-BRIEF.md`

---

## Overall Assessment

The 10-phase sequence is **fundamentally sound.** It correctly addresses the #1 lesson from both failed attempts: build bottom-up, prove each layer before stacking the next. The risk assessment correctly identifies the biggest danger (building options on an unstable foundation) and the mitigation IS the sequence itself.

That said, I have practical concerns about phase sizing, missing work, hidden dependencies, and risk prioritization that should be addressed before implementation begins.

**Verdict: APPROVE with revisions.** The sequence should be followed as-is with the adjustments noted below. None of the issues are structural -- they're about scope clarity, missing steps, and phase boundary tightness.

---

## 1. Phase Ordering Analysis

### What's Right

The core dependency chain is correct:

```
Schema/Tree (1) -> Calculations (2) -> Assemblies (3) -> Formulas (4) -> Catalog (5) -> Options (6)
```

Each phase genuinely depends on the previous one being stable. The brief's emphasis on sequential construction is properly reflected. The late placement of Options (Phase 6) is especially correct -- both previous attempts proved that building options on shaky foundations fails.

The parallelism note for Phases 7/8/9 is accurate and helpful. These are genuinely independent once the core (1-6) is stable.

### Hidden Dependency: Phase 4 (Formulas) Depends on Phase 3 (Assemblies) Only Weakly

The sequence claims Phase 4 depends on Phase 3. In practice, formulas could be built immediately after Phase 2 (Calculations). The assembly system uses formulas (via `qty_mode = 'formula'`), but formulas don't depend on assemblies -- they're a parallel quantity resolution mode.

**However:** I would NOT recommend reordering. Keeping formulas after assemblies means the formula engine can be tested with real assembly contexts (e.g., "formula that references assembly quantity"). Building formulas earlier would mean testing them in isolation and then retesting when assemblies arrive. The current order produces a more natural test progression. The dependency is weak but the ordering is still correct for practical reasons.

### Hidden Dependency: Phase 9 (Vendors) Should Depend on Phase 5 (Catalog), Not Phase 6 (Options)

The phase summary table says Vendors depends on Phase 5, but the prose section says "Phases 1-5 complete (catalog system in particular)." This is correct -- vendors don't need options to be working. The summary table reflects this accurately.

However, the note at the bottom says "Phases 7, 8, and 9 are largely independent of each other (all depend on Phase 6 or earlier)." This is misleading for Phase 9. Vendors depend on Phase 5 (catalog), not Phase 6 (options). Vendors could begin immediately after Phase 5, in parallel with Phase 6. This is worth clarifying because it creates a real scheduling opportunity.

**Recommendation:** Make this explicit. Vendors can start as soon as Phase 5 is stable -- they don't need to wait for Options.

### Potential Issue: Vendor FK Dangling in Phase 1

The `node_item_details` table has `vendor_id UUID FK -> vendors(id)` from Phase 1, but the `vendors` table isn't created until Phase 9. This FK reference to a nonexistent table will cause the Phase 1 migration to fail.

**Resolution:** This is a schema definition issue, not a dependency issue. Either:
- (a) Define `vendor_id` as a plain UUID column with no FK constraint in Phase 1, add the FK constraint in Phase 9 when vendors are created, OR
- (b) Create the `vendors` table (empty, no UI) in Phase 1 as part of the schema, and build the vendor management UI in Phase 9.

Option (a) is cleaner -- it follows the principle of "only build what you need now." The column exists for future use, the constraint arrives when the referenced table does.

### Client View Timing: Should Visibility Testing Happen Earlier?

`client_visibility` is on every node from Phase 1. Phase 8 (Client View) isn't until after Phase 6. Should the visibility model be validated earlier?

**My take: No, the current ordering is fine.** The `client_visibility` column is just a VARCHAR field with a CHECK constraint -- it works from day one by construction. The Phase 8 work is about building the filtered query, the client auth role, PDF export, and the zero-data-leakage guarantee. None of that requires earlier validation. The column being present early is a smart forward-planning decision, not a hidden dependency.

However, the Phase 2 (Calculations) "active children" filtering should be designed to accept BOTH option filtering AND visibility filtering from the start. The calculation engine needs to know "which nodes count?" and the answer is "active option AND visible to current role." If the calc engine only accounts for option filtering and ignores visibility, Phase 8 will require calc engine changes. This is a minor point but worth noting in the Phase 2 design.

### No Circular Dependencies Found

I checked all cross-phase references in the data architecture:
- Catalog references items/assemblies (Phases 1-3 -> Phase 5): forward dependency, correct
- Options reference tree, calculations, formulas, catalog (Phases 1-5 -> Phase 6): forward dependency, correct
- Formulas reference project parameters (independent table, created Phase 1): correct
- Vendors reference catalog items (Phase 5 -> Phase 9): forward dependency, correct
- The Phase 4 (Formulas) / Phase 3 (Assemblies) relationship is NOT circular: formulas are a qty_mode on items, and assemblies use items. Formulas don't depend on assemblies -- they're a parallel quantity resolution mechanism. The `project_parameters` table is created in Phase 1 (schema), and the formula engine reads from it in Phase 4. No cycle.

No cycles. The dependency graph is a clean DAG.

---

## 2. Phase Sizing Analysis

### Phase 1 Is Too Large -- Should Be Split

Phase 1 bundles four distinct concerns:

1. **Core schema creation** (projects, estimates, nodes, detail tables, units, phases)
2. **Database constraints and triggers** (type validation, history tracking, cascading)
3. **Server actions** (CRUD operations for all node types)
4. **Tree UI** (render, expand/collapse, add/delete, reorder, indent/outdent)

This is a LOT of surface area for a "foundation" phase. The risk is that a bug in the tree UI delays proving the schema, or that trigger complexity delays getting the basic CRUD working. Previous attempts failed partly because too much was tackled simultaneously -- and while this phase is all "foundation," it's still a broad foundation.

**Recommendation:** Split Phase 1 into two sub-phases:

- **Phase 1A: Schema + Constraints + Server Actions** -- Stand up the database, prove CRUD operations work via server actions or direct SQL. No UI. Verify constraints fire correctly, history tables populate, type validation triggers work. This is testable with automated tests or manual SQL.

- **Phase 1B: Tree UI** -- Build the visual tree on top of the proven schema. Render, expand/collapse, reorder, indent/outdent. This can move fast because the data layer is already proven.

The risk of NOT splitting: if the tree UI has rendering bugs, the developer might be tempted to "fix" them by changing the schema or server actions, muddying the foundation. Separating them makes the contract clear: the schema is frozen once 1A passes.

### Phase 6 (Options) Sizing Is Appropriate Despite Being "Very High" Complexity

The options system is correctly sized as a single phase even though it's the most complex. The three layers (inline, broad, option sets) are tightly coupled -- they share the same estimate context, affect the same calculation engine, and interact with each other. Splitting them into separate phases would create artificial boundaries where the integration between layers is actually the hard part.

The plan correctly builds Layer 2 (inline) first, then Layer 1 (broad), then Layer 3 (sets). This internal sequencing within Phase 6 is right.

### Phase 10 (Polish) Is a Grab Bag -- That's Fine

Phase 10 is intentionally loose. For a single-user tool, this is the right approach. The user will discover which "polish" items actually matter during Phases 7-9. No point over-specifying Phase 10 now.

---

## 3. Missing Phases / Missing Work

### MISSING: Auth Setup Is Buried in Phase 1 Prerequisites

Phase 1 lists "Auth configured (single user is fine -- Supabase Auth with email login)" as a prerequisite. This is not a trivial step. It includes:

- Setting up Supabase Auth
- Configuring the Next.js middleware for auth
- Creating the client-side auth flow (login page, session management)
- Setting up RLS policies (or deciding to skip RLS for single-user)
- Setting `app.current_user_id` for history trigger attribution

This is easily a half-day to full-day of work. It should be called out explicitly, either as **Phase 0** or as the first item in Phase 1A.

**Recommendation:** Add a **Phase 0: Project Scaffolding** that covers:
- Next.js project setup with TypeScript, Tailwind
- Supabase project creation and connection
- Auth configuration (single-user email login)
- Basic app shell (layout, navigation skeleton)
- RLS policy decision (enable with permissive policies, or skip for single-user)
- CI/CD setup if any (even just `next build` passing)

This makes Phase 1 purely about the domain schema and tree operations, not about infrastructure.

### MISSING: Project Dashboard / Home Page

There's no phase that builds the "project list" or "estimate list" UI. The user needs to navigate between projects and estimates. Where does this get built?

Phase 1 creates the `projects` and `estimates` tables, and Phase 1 includes "Can create a project with an estimate" as testable output. But there's no mention of a project list page, project creation form, or estimate management UI (list, create, delete, rename).

**Recommendation:** Include basic project/estimate management UI in Phase 1B (Tree UI). The tree UI needs SOMETHING to navigate from, so the project dashboard is a natural prerequisite. It doesn't need to be polished -- just functional navigation: list projects, select project, list estimates, select estimate, open tree editor.

### MISSING: Deployment / Hosting

No phase addresses deployment to Vercel or any hosting platform. For a single-user business tool, this matters early -- the user (Zac) will want to use the tool on actual projects, not just in `localhost:3000`.

**Recommendation:** First deployment to Vercel should happen at the end of Phase 1 (or Phase 1B). Get the basics live early. Each subsequent phase deploys as part of its completion. This also surfaces environment-specific issues (env vars, Supabase connection from Vercel, etc.) before the codebase is complex.

### MISSING: Data Migration / Initial Data Entry

The brief mentions "Import utilities (if CSV/Excel import is needed for initial data migration)" in Phase 10. But Zac has existing Excel workbooks with estimate data from the Soloway project and likely others. The catalog system (Phase 5) will be much more useful if it starts with actual catalog items, not empty.

**Recommendation:** Consider a lightweight CSV/Excel import for catalog items as part of Phase 5, not Phase 10. The catalog is only useful if populated. Making the user manually enter 100+ catalog items through the UI is a poor experience. Even a basic "paste a CSV, map columns, import" would be valuable.

### NOT MISSING: Multi-User / Roles

The brief explicitly says single-user, single-company. The plan correctly avoids multi-user complexity. Phase 8 (Client View) adds a client role, which is the only secondary role needed. This is correct.

---

## 4. Risk Assessment Critique

### Risk Priorities Are Mostly Right

The P1 risks are genuinely the highest-impact items:
- Hybrid table split performance (P1) -- correct, prove it in Phase 1
- Assembly cascade edge cases (P1) -- correct, the cedar siding example is a good litmus test
- Option subtree stamping (P1) -- correct, though the pre-Phase-6 prototype recommendation is key

### UNDER-PRIORITIZED: Formula Circular References Across Options (Currently P2, Should Be P1)

The risk assessment rates "Formula circular references across options" as P2 (Medium impact, Medium likelihood). I'd argue this should be P1. Here's why:

The scenario is: Formula A references named node B. Node B is inside an option group. When the user switches alternatives, node B disappears from the active tree and formula A breaks. This isn't a "might happen" edge case -- it's a **guaranteed user experience problem** if anyone uses formulas and options together, which the brief explicitly says they will (broad options override parameters that feed formulas).

The mitigation ("warn if reference doesn't exist in all alternatives") is necessary but insufficient. The real question is: what happens to calculation results when a formula references a node that's in an inactive alternative? Does it use the value from the inactive alternative? Does it return 0? Does it error? This design decision affects the calculation engine (Phase 2), formula engine (Phase 4), and options system (Phase 6) -- three phases spanning the entire core sequence.

**Recommendation:** Decide the semantic answer to "what does a formula do when its reference is in an inactive option alternative?" BEFORE Phase 2, and encode it in the calculation engine from day one. Don't defer this to Phase 6 discovery.

### UNDER-PRIORITIZED: Deep Copy Performance for Options (Not Listed)

The risk assessment covers deep copy for versioning (rated P3) but doesn't address deep copy for options. Creating an option alternative for a large group (say, a 50-node kitchen section with assemblies, sub-items, detail rows) requires a deep copy. This is the same operation as versioning but happens MORE FREQUENTLY -- every time the user creates a new alternative.

At expected scale this is fine. But the risk assessment should at least acknowledge it alongside the versioning deep copy discussion.

### OVER-PRIORITIZED: Isomorphic Calc Drift (Currently P2, Should Be P3)

The risk of client/server calculation drift is rated P2 (Medium impact, Very Low likelihood). Given that the module is literally the same TypeScript file imported by both sides, and JavaScript floating-point behavior is deterministic within a single runtime, this risk is almost zero. The plan correctly uses `DECIMAL` in the database (not floats), so the only drift risk is rounding during JS-to-SQL-to-JS round-trips -- and batch save with server-side recalculation handles that.

**Recommendation:** Downgrade to P3. It's a "validate during Phase 2 and move on" item, not an ongoing concern.

### MISSING RISK: UI State Management Complexity

The risk assessment focuses heavily on data and calculation risks but doesn't address UI state management. The tree editor will need to manage:

- In-memory tree state (nodes, expanded/collapsed, selected)
- Dirty state tracking (which nodes have unsaved changes)
- Optimistic updates (show changes immediately, reconcile on save)
- Active option filtering (which nodes are visible based on selections)
- Formula evaluation display (show intermediate values)
- Error states per node (validation warnings, formula errors)

This is a significant source of bugs in tree-editing UIs. The old system's "children existed in the database but were invisible until a full page refresh" failure was a UI state management bug, not a data bug.

**Recommendation:** Add UI state management as a P2 risk. The mitigation is straightforward: choose a state management pattern early (React context + useReducer, or a lightweight store like Zustand) and commit to it. Don't let different phases introduce different state management patterns.

### CHALLENGE: Is the Hybrid Table JOIN Risk Really P1?

The risk assessment rates "Hybrid table split doesn't work well in practice" as P1 with Very High impact but Low likelihood. At 200-1000 nodes, LEFT JOINs across three tables are trivially fast for PostgreSQL -- this is well within "not even worth benchmarking" territory. The real question isn't performance; it's developer ergonomics (writing JOINs everywhere, handling nullable detail types in TypeScript).

**My verdict: Keep it at P1, but reframe it.** The risk isn't "JOINs are slow" (they won't be). The risk is "the developer experience of the three-table pattern becomes friction that slows every subsequent phase." Every server action, every type definition, every form component touches this split. If it's awkward, that awkwardness compounds across 9 more phases. P1 is correct, but the mitigation should be "build 5+ complete CRUD operations and evaluate developer ergonomics" not "benchmark query times."

### MISSING RISK: Scope Creep -- Especially Vendor System

The vendor system (Phase 9) as specified includes: vendor CRUD, contact management, document management with Supabase Storage, expiration tracking with alerts, vendor-item pricing associations, vendor comparison, vendor selection in estimates, vendor-grouped views, and "foundation for purchase orders and RFPs."

This is a CRM bolted onto an estimating tool. For a single-user app, this scope is aggressive. The brief says "don't over-engineer" and "simpler is better." The vendor system as specified could easily consume 3-5 implementation sessions.

**Recommendation:** Define a "Vendor MVP" scope for Phase 9:
- Vendors table + basic CRUD (name, trade, status, notes)
- Vendor-item association with pricing
- Vendor selection on estimate items
- Vendor-grouped view in estimates

Defer to Phase 10 or beyond: document management, expiration tracking, COI alerts, contact management, purchase order foundation, RFP generation. These are nice-to-haves that don't affect the core estimating workflow.

This also applies more broadly: each phase should have a clear "MVP scope" vs. "nice-to-have scope" boundary. The plan currently defines scope as a flat list with no prioritization within each phase.

### MISSING RISK: Formula Engine Becoming a Mini Programming Language

The brief asks for formulas that support arithmetic, project parameters, named references, and conditionals. The plan recommends `expr-eval` and mentions "named preset formulas" as a future enhancement.

The risk: every user interaction with formulas will generate requests for more formula features. "Can I reference another item's quantity?" becomes "Can I reference another item's total?" becomes "Can I do a SUM across all children?" becomes "Can I write IF/ELSE?" becomes "Can I have loops?" This is a classic scope treadmill.

**Recommendation:** Define a hard boundary for the formula engine in Phase 4: arithmetic operators, ternary conditionals, project parameter references, and named node references (value only). Explicitly document what's OUT of scope: aggregation functions (SUM, AVG), cross-node queries, loops, string operations, date math. If the user needs something more complex, the answer is "add a project parameter and compute it externally." This boundary should be a contract, not a suggestion.

### MISSING RISK: Session/Context Window During Phase 6

The risk assessment mentions "Context window management during development" as P2, which is correct. But it doesn't specifically call out Phase 6 as the highest-risk phase for this concern.

Phase 6 (Options) must simultaneously understand the tree structure (Phase 1), calculation engine (Phase 2), assembly cascade (Phase 3), formula resolution (Phase 4), and catalog instantiation (Phase 5). This is the exact scenario that overwhelmed context in previous attempts.

**Recommendation:** The Phase 6 mitigation should be explicit: before starting Phase 6, write a focused "Options Implementation Contract" that summarizes the interfaces of Phases 1-5 in <1KB. The implementing agent should load this contract, not the full code of previous phases. This is exactly what the contracts-enforcement system is for.

---

## 5. Specific Sequence Recommendations

### 5.1 Add Phase 0 (Project Scaffolding)

Before Phase 1, explicitly handle:
- Next.js + TypeScript + Tailwind setup
- Supabase project + connection
- Auth (single-user email login)
- Basic app shell (layout, navigation)
- First Vercel deployment (prove the pipeline works)

**Why:** Getting infra issues out of the way before touching domain logic. Discovering that Supabase RLS doesn't work the way you expected AFTER building 6 tables of schema is expensive.

### 5.2 Split Phase 1 into 1A (Schema) and 1B (UI)

- **1A:** Tables, constraints, triggers, history, server actions. Testable via automated tests and SQL.
- **1B:** Tree renderer, project/estimate navigation, basic CRUD UI.

**Why:** Separates "does the data layer work?" from "does the UI render correctly?" The schema should be frozen before UI work begins.

### 5.3 Move Vendor Phase Earlier (After Phase 5, Parallel with Phase 6)

Vendors don't depend on options. Start vendor work as soon as the catalog is stable.

**Why:** Vendor data (pricing, contact info) is useful immediately for the catalog -- it makes catalog items more complete. Waiting until after Options delays a feature that could provide value sooner.

### 5.4 Include Catalog Seeding in Phase 5

Add a basic import mechanism (CSV or Excel) for populating the catalog with initial data during Phase 5.

**Why:** An empty catalog is useless. The user has existing data in Excel. Making them manually create 100+ items through the UI before the catalog is useful is a poor experience and will delay the point where the system becomes genuinely usable for real estimates.

### 5.5 Deploy Early, Deploy Often

First deployment at the end of Phase 1. Continuous deployment for every phase thereafter.

**Why:** The user (Zac) needs to use this for real projects. A tool that only works on localhost isn't a tool. Early deployment also surfaces environment issues before the codebase is large.

---

## 6. Risk Assessment Revised Priority Matrix

| Risk | Impact | Likelihood | When to Address | Priority | Change |
|------|--------|-----------|-----------------|----------|--------|
| Hybrid table split developer ergonomics | Very High | Low | Phase 1A prototype | **P1** | Reframed: ergonomics, not perf |
| Assembly cascade edge cases | High | Medium | Phase 3 test suite | **P1** | -- |
| Option subtree stamping limits | High | Medium | Pre-Phase 6 prototype | **P1** | -- |
| Formula refs across options | High | High | Before Phase 2 (design decision) | **P1** | UP from P2 |
| UI state management complexity | Medium | Medium | Phase 1B pattern decision | **P2** | NEW |
| Context window during Phase 6 | Medium | Medium | Pre-Phase 6 contract | **P2** | More specific mitigation |
| Deep copy perf for options | Medium | Low | Phase 6 profiling | **P2** | NEW |
| Isomorphic calc drift | Low | Very Low | Phase 2 validation | **P3** | DOWN from P2 |
| Calculation perf at scale | Medium | Low | Phase 2 profiling | **P3** | -- |
| Version deep copy perf | Low | Very Low | Only if needed | **P3** | -- |
| Vendor system scope creep | Medium | High | Phase 9 scope definition | **P2** | NEW |
| Formula engine scope creep | Medium | High | Phase 4 scope boundary | **P2** | NEW |

---

## 7. The Strongest Parts of the Plan

To be clear about what should NOT change:

1. **The strict sequencing.** This is the plan's core insight and its greatest strength. No parallel layer development. Each phase proves stability before the next begins. This directly addresses the #1 failure mode from both previous attempts.

2. **Options last among core features.** Phase 6 placement is exactly right. It touches everything, so everything must be stable first.

3. **The cedar siding litmus test.** Using a concrete, real-world example as the acceptance test for Phases 2-3 is excellent. It's specific, manually verifiable, and tests the exact calculations the system needs to get right.

4. **History tracking from Phase 1.** Starting triggers early and building the UI later is the right call. Retroactive history tracking is painful.

5. **"The mitigation IS the implementation sequence."** This framing in the risk assessment is exactly correct. The plan doesn't need a separate risk mitigation strategy -- the careful sequencing IS the mitigation.

---

## 8. Timeline Realism

The plan intentionally avoids time estimates. But since a single AI developer (Claude Code) is building this, a rough session-count estimate helps set expectations and catch unrealistic phase scoping.

**Assumptions:** One "session" = one focused Claude Code session (typically 1-3 hours of wall-clock time with user interaction). Sessions include implementation, testing, and documentation. The user (Zac) is available for clarifications but not writing code.

| Phase | Est. Sessions | Notes |
|-------|--------------|-------|
| 0 (Scaffolding) | 1 | Boilerplate. Auth is the only non-trivial part. |
| 1A (Schema) | 1-2 | Tables, constraints, triggers. Well-defined scope. |
| 1B (Tree UI) | 2-3 | Tree rendering, CRUD forms, project navigation. UI always takes longer than expected. |
| 2 (Calculations) | 2 | Pure math module + batch save. Well-constrained. |
| 3 (Assemblies) | 2-3 | Recursive cascade + purchasing constraints. Edge cases are the time sink. |
| 4 (Formulas) | 1-2 | Library integration + variable resolution. Bounded by the scope boundary recommended above. |
| 5 (Catalog) | 2-3 | Deep copy, sync operations, search, catalog browser UI. |
| 6 (Options) | 3-5 | Highest complexity. Subtree stamping, calculation filtering, three layers, UI for all of it. |
| 7 (Versions UI) | 1-2 | Infrastructure exists from Phase 1. Diff algorithm is the hard part. |
| 8 (Client View) | 2-3 | Filtered queries + PDF generation. PDF is always harder than expected. |
| 9 (Vendors MVP) | 1-2 | With MVP scope (no document management). Full scope would be 3-4. |
| 10 (Polish) | Ongoing | Driven by real usage feedback. |

**Total estimate: 18-28 sessions for Phases 0-9.** This is a multi-week to multi-month project depending on session frequency.

**Key observation:** The sessions are NOT uniform. Phase 6 (Options) at 3-5 sessions is as large as Phases 0 + 1A + 4 combined. If Phase 6 hits problems, it dominates the timeline. The risk assessment's focus on Phase 6 is justified by this asymmetry.

**The biggest timeline risk is NOT implementation speed -- it's discovery.** Each phase will surface things the brief didn't anticipate. Zac will use the tool and say "actually, I need X" or "this doesn't work the way I expected." Budget 20-30% of sessions for this kind of mid-course correction. The strict sequencing helps here: corrections to Phase 1 during Phase 1 are cheap. Corrections to Phase 1 during Phase 6 are expensive.

---

## 9. Summary of Recommended Changes

| # | Change | Impact | Effort |
|---|--------|--------|--------|
| 1 | Add Phase 0 (scaffolding + auth + deploy) | Removes ambiguity from Phase 1 prereqs | Low |
| 2 | Split Phase 1 into 1A (schema) and 1B (UI) | Cleaner foundation validation | Low |
| 3 | Decide formula-across-options semantics before Phase 2 | Prevents design debt in calc engine | Medium |
| 4 | Start Vendors (Phase 9) parallel with Options (Phase 6) | Earlier value delivery | None (schedule change only) |
| 5 | Add catalog seeding to Phase 5 | Makes catalog immediately useful | Low-Medium |
| 6 | Deploy to Vercel at end of Phase 1 | Surfaces env issues early | Low |
| 7 | Add UI state management as P2 risk | Prevents state management chaos | None (awareness only) |
| 8 | Promote formula-across-options to P1 risk | Correct prioritization | None (awareness only) |
| 9 | Include project/estimate navigation in Phase 1B | Users need to navigate | Low |
| 10 | Define Vendor MVP scope (defer doc mgmt, COI alerts) | Prevents scope creep in Phase 9 | None (scope decision) |
| 11 | Define hard formula engine boundary in Phase 4 | Prevents formula scope treadmill | None (scope decision) |
| 12 | Handle vendor_id FK as plain UUID in Phase 1, add FK in Phase 9 | Prevents migration failure | Low |
| 13 | Design calc engine to accept visibility filter from day one | Prevents Phase 8 calc rework | Low |

None of these changes alter the fundamental sequence. They refine scope, surface hidden technical issues, and add risk mitigations where the original assessment had gaps.
