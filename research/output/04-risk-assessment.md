# Risk Assessment (Revised)

> **Date:** 2026-04-02
> **Revised:** 2026-04-02 (v2 -- incorporates findings from all five review documents)
> **Purpose:** Identify decisions that are expensive to change later, likely failure modes, and things to prove early.

### Revision Notes

This revision incorporates findings from:
- **Data model review** (01): decimal precision concerns, deep-copy remapping complexity, stored totals recalculation obligation
- **Calculation engine review** (02): expr-eval CVE-2025-12735, floating-point precision strategy, batch save comparison semantics
- **Options system review** (03): stamp corruption via tree operations, junction table recommendation, nested options forward-compatibility, anchor node requirement
- **Sequence/risk review** (04): priority re-ranking, session count estimates, UI state management risk, vendor/formula scope creep risks
- **Industry research** (05): missing allowance tracking, free-text cost code risk, proposal layer gap

Key changes from v1: Formula refs across options promoted to P1. Isomorphic calc drift demoted to P3. Four new risks added (expr-eval CVE, UI state management, vendor scope creep, formula scope creep). Options system risk reframed around junction table decision. Floating-point precision strategy added as a foundational decision. Prototype list expanded.

---

## 1. Decisions That Are Expensive to Change Later

These are the architectural choices where getting it wrong early means significant rework later. Listed in order of blast radius.

### 1.1 The Node Type Split (Base Table + Detail Tables) -- HIGHEST IMPACT

**Decision:** Three-table hybrid (estimate_nodes + node_item_details + node_assembly_details) instead of monolithic.

**Why it's expensive to change:** Every query that touches item or assembly data joins across these tables. Every server action, every client-side type definition, every form component assumes this structure. If the split causes performance problems or developer friction, migrating means rewriting virtually every query and component.

**Mitigation:** Prototype this FIRST (Phase 1). Build the full CRUD for all three node types, verify that JOINs are performant, and -- critically -- evaluate whether the developer experience of working with split tables is acceptable across 5+ complete CRUD operations. The risk is ergonomics (working with JOINs everywhere, handling nullable detail types in TypeScript), not raw query performance. PostgreSQL handles these JOINs trivially at the expected scale of 200-1,000 nodes.

**Confidence level:** High. The schema clarity benefit (no 36-column NULL density) is worth the additional query complexity. The old system's 46-column monolith was a known pain point. The data model review confirmed the hybrid approach is strictly better than both monolithic and table-per-type alternatives.

### 1.2 The Options System Data Model -- HIGH IMPACT

**Decision:** Junction table (`node_option_memberships`) for option alternative membership, replacing the original column-stamping approach (`option_alternative_id` on each node).

**Why it's expensive to change:** The options system touches the tree query (active tree filter), the calculation engine (skip inactive nodes), the UI (option indicators, switching), and the catalog (instantiating alternatives). The membership model is the foundation for all of these.

**Why the junction table was chosen over column stamping:** The options system review identified four critical issues with the stamping approach:
1. Tree operations (move, indent, outdent) silently corrupt stamps -- a node dragged into an option subtree retains its old stamp value, becoming an orphan visible in all alternatives.
2. No mechanism for enforcing stamp consistency without recursive triggers on every parent_id change.
3. Single-column stamp prevents future nested options (an option within an option), which the industry research confirmed is a standard construction workflow, not an edge case.
4. Deleting an option's root node creates cascading cleanup problems that are hard to express with FK constraints alone.

The junction table resolves all four: membership is explicit (not inherited from position in tree), multiple memberships are supported by design, and cleanup is straightforward FK cascades. The cost is one additional JOIN in the active tree query path.

**Mitigation:** Prototype the junction table query performance before Phase 6. Prove that the JOIN doesn't degrade the active tree query at scale (1,000 base nodes + 2,000 inactive alternative nodes, 20+ option groups).

**Confidence level:** High. The junction table is a well-understood relational pattern. The stamping approach was clever but fragile. The migration from stamp-based to junction-based would have been painful if discovered mid-implementation.

### 1.3 The Floating-Point Precision Strategy -- MEDIUM-HIGH IMPACT

**Decision:** Define and enforce a rounding discipline for all monetary calculations.

**Why it's expensive to change:** The calculation chain multiplies quantities by unit costs, applies percentage markups, and sums results across hundreds of nodes. Every operation accumulates floating-point error. JavaScript's `0.1 + 0.2 = 0.30000000000000004` is the canonical example, but in a construction estimate the chain is longer: raw_qty -> waste -> package rounding -> qty * unit_cost -> contingency -> overhead -> sum across children. After 6 chained operations across hundreds of nodes, accumulated error can reach multiple cents on large estimates.

The database stores monetary values as `DECIMAL(15,2)` (exact), but all intermediate calculations run in JavaScript floating-point (approximate). If the rounding strategy isn't defined from Phase 2, retrofitting consistent rounding into every calculation path is tedious and error-prone -- every monetary calculation must be audited.

**Mitigation:** Choose a strategy before Phase 2 implementation begins:
- **Option A (recommended): Explicit rounding at every monetary step** using a `roundToCents()` helper. Every monetary multiplication or division must call it. This requires discipline but is straightforward.
- **Option B: Cent-based integer arithmetic.** Store and calculate all money as integers representing cents. Eliminates floating-point entirely for monetary math but requires conversion at every display boundary.
- **Option C: Decimal.js library.** Exact decimal math at the cost of performance and bundle size. Overkill if Option A or B is adopted.

Regardless of option chosen, the strategy must specify: when rounding happens, what precision is used for intermediate values, and whether the system uses standard rounding or banker's rounding. This must be consistent between client and server.

**Confidence level:** Medium-high. Option A is sufficient for this scale. The critical requirement is that the strategy exists and is documented before the first line of calculation code is written.

### 1.4 The Calculation Architecture (Isomorphic Client/Server) -- MEDIUM IMPACT

**Decision:** One TypeScript module shared between client and server.

**Why it's somewhat expensive to change:** If client-side and server-side calculation later need to diverge, maintaining a single shared module becomes a constraint.

**Mitigation:** Design the calculation module with clean interfaces from day one. The module takes inputs (tree structure, parameters) and produces outputs (calculated values). It doesn't reach into the database or the DOM. This makes it portable even if the sharing model changes. The calculation engine review recommended considering "server is always authoritative" for the save path -- the client calculates for display only (optimistic UI), the server recalculates from scratch on save and always uses its own values. This eliminates the need for client/server comparison logic entirely.

**Confidence level:** High. The isomorphic pattern is well-proven. Since both sides import the same TypeScript file, drift risk is near-zero (see P3 in the risk matrix). The real design question is the batch save comparison semantics, which should be resolved in Phase 2.

### 1.5 Version Management as Deep Copies -- MEDIUM IMPACT

**Decision:** Each estimate version is a complete deep copy of the tree (separate rows in estimate_nodes).

**Why it's somewhat expensive to change:** Storage grows linearly with versions, and the deep copy operation itself is a complex multi-step transaction requiring ID remapping across all tables (nodes, detail tables, option groups, alternatives, memberships, sets, selections, broad options, overrides).

**Mitigation:** At the expected scale (500 nodes x 5 versions = 2,500 rows), this is trivial for PostgreSQL. The data model review strongly recommends implementing the deep copy as a single PostgreSQL function (`deep_copy_estimate(source_estimate_id)`) rather than application code -- the function handles all remapping in one atomic transaction, guaranteeing referential integrity. The options review specifically flagged that failing to remap option membership references during deep copy would entangle versions (editing options on one version would affect the other).

**Confidence level:** High for the expected scale.

---

## 2. Likely Failure Modes

These are the things most likely to go wrong during implementation, based on previous failure patterns and inherent system complexity.

### 2.1 Formula References Across Options -- CRITICAL

**What can go wrong:**
- A formula references a named node (`reference_name`) that exists in one option alternative but not another. When the user switches alternatives, the referenced node disappears from the active tree and the formula breaks.
- A broad option overrides a parameter that feeds formulas within an inline option's subtree. The interaction between parameter overrides and subtree visibility creates a combinatorial calculation space.
- The core question is unanswered: **what does a formula do when its reference is in an inactive option alternative?** Does it use the inactive value? Return 0? Error? This semantic decision affects the calculation engine (Phase 2), formula engine (Phase 4), and options system (Phase 6).

**Why this is critical:** This is not a "might happen" edge case. The brief explicitly says users will use formulas and options together (broad options override parameters that feed formulas). Any user who creates a formula referencing a node and then puts that node inside an option group will hit this immediately.

**Mitigation:** Decide the semantic answer BEFORE Phase 2 and encode it in the calculation engine from day one:
- Formula validation must check references against ALL option alternatives, not just the active tree.
- When a formula references a named node, warn if that reference doesn't exist in all alternatives.
- Define explicit behavior for "reference to inactive node": most likely return 0 with a UI warning, but this must be a documented design decision, not a runtime surprise.

### 2.2 Assembly Quantity Cascade Edge Cases

**What can go wrong:**
- Nested assemblies where inner assembly quantity depends on outer assembly quantity, which depends on a formula referencing an overridden parameter.
- Zero-quantity assemblies: qty 0 cascades to 0 costs for all children, but minimum order constraints could force non-zero purchases (the calc engine review identified: `applyPurchasingConstraints(rawQty: 0, ...)` returns `minOrderQty` instead of 0).
- Package size rounding with very small ratios producing surprising cost multipliers.
- Waste factor compounding in nested assemblies (waste should apply to the item's raw quantity, not the assembly's quantity -- but this must be explicit).

**Mitigation:** Build a comprehensive test suite including adversarial cases:
- Zero quantities at every level (with explicit guard: rawQty <= 0 skips all constraints, returns 0)
- Very large and very small ratios
- Deep nesting (3+ levels)
- Package rounding with fractional results at boundary values
- Waste factor application at different levels
- Mixed units across nested assemblies

### 2.3 UI State Management Complexity

**What can go wrong:** The tree editor must manage in-memory tree state, dirty state tracking, optimistic updates, active option filtering, formula evaluation display, and per-node error states simultaneously. This is a significant source of bugs in tree-editing UIs.

**The lesson from the old system:** The "invisible children after duplicate" bug -- where children existed in the database but were invisible in the UI until a full page refresh -- was a UI state management bug, not a data bug. The data was correct; the client-side tree state was stale.

**Why this matters:** Different phases will add different state concerns to the tree editor (Phase 1: tree structure; Phase 2: calculated values; Phase 4: formula evaluation; Phase 6: option visibility). If each phase introduces a different state management pattern, the accumulation creates an unmaintainable tangle.

**Mitigation:** Choose a state management pattern in Phase 1B (React context + useReducer, or a lightweight store like Zustand) and commit to it for the entire project. Every subsequent phase adds state to the same pattern, not a new pattern. The tree's "which nodes are visible" filter must be designed to accept both option filtering AND client visibility filtering from day one.

### 2.4 Option Membership Consistency

**What can go wrong:** With the junction table approach, option membership is explicit rather than inherited from tree position. This is safer than the stamp-based approach, but new failure modes exist:
- User creates a new node inside an option alternative's subtree but forgets (or the system fails) to add the membership row. The new node appears in all alternatives instead of just the one it was added to.
- Moving a node between alternatives requires updating membership rows, not just changing parent_id.
- Deleting an option group requires cleaning up all membership rows for all alternatives.

**Why the junction table is still better:** These are application-logic bugs (missing INSERT/UPDATE/DELETE of membership rows), not silent data corruption bugs. They are detectable (a node with no membership inside an option subtree is a queryable anomaly) and fixable (add the missing row). The stamp-based approach had the same class of bugs but they were invisible because stamp values appeared correct even when they weren't.

**Mitigation:** Application-level invariant checks:
- When adding a node under a parent that has option memberships, automatically create the membership row.
- When moving a node, update memberships in the same transaction.
- A periodic integrity check: "find nodes whose parent has option memberships but the node itself does not."
- Add `anchor_node_id` FK to `option_groups` to establish which node "owns" the option, enabling cascade deletes and UI indicator placement.

### 2.5 Calculation Performance at Scale

**What can go wrong:**
- An estimate with 1,000 nodes, 30 option groups (each with 3 alternatives = ~2,000 inactive nodes), and 20 project parameters. Full tree recalculation on every keystroke might lag.
- The comparison view needs to calculate 5+ scenarios (option sets). Each scenario requires: load nodes, filter to active tree, recalculate with resolved parameters. At 1,000 nodes with formula evaluation, each scenario could take 50-100ms. Five scenarios = 250-500ms, which is noticeable.

**Mitigation:**
- Profile the calculation engine early with realistic data (500+ nodes). If single-tree calculation exceeds 16ms (one frame), optimize.
- For comparison views, calculate scenarios in parallel (Web Workers) or cache per-alternative delta values.
- Optimize for the common case (changing one item, recalculating its ancestors only) while supporting full-tree recalculation when needed.

### 2.6 Context Window Management During Development

**What can go wrong:** The previous attempts suffered from spec documents consuming 35%+ of Claude's context window. The growing codebase itself will consume context. Phase 6 (Options) requires understanding the tree (Phase 1), calculations (Phase 2), assemblies (Phase 3), formulas (Phase 4), and catalog (Phase 5) simultaneously.

**Quantified risk:** The sequence review estimates 18-28 sessions total for Phases 0-9. Phase 6 (Options) alone is estimated at 3-5 sessions -- as large as Phases 0 + 1A + 4 combined. If Phase 6 hits problems, it dominates the timeline. The context window risk peaks during this phase because the implementing agent must hold interfaces from five previous phases in context.

**Mitigation:**
- Keep contracts small (<1KB each) and focused on interfaces, not implementations.
- Before starting Phase 6, write a focused "Options Implementation Contract" that summarizes the interfaces of Phases 1-5 in <1KB. The implementing agent loads this contract, not the full code of previous phases.
- Use subagents for research and exploration (keep main context clean).
- Use `/compact` proactively at natural breakpoints.
- Each phase should end with a clear, stable contract with previous phases.

---

## 3. What to Prototype Early

These are high-risk areas where a focused prototype (before full implementation) significantly reduces risk.

### 3.1 The Hybrid Table JOIN Pattern (Phase 1)

**What to prove:** That working with split tables (base + detail) doesn't create developer friction that compounds over time.

**Prototype scope:**
- Create all three tables with constraints and triggers.
- Write CRUD operations for each node type.
- Build the tree query with LEFT JOINs.
- Load a tree with 200 nodes (100 items, 50 groups, 50 assemblies).
- Write 5+ complete server actions and evaluate developer ergonomics (not just query speed).

**Success criteria:** Query time < 50ms for full tree load with JOINs. Developer experience is clean -- no awkward NULL handling, no ambiguous types, no friction that would compound across 9 more phases.

### 3.2 Assembly Quantity Cascade (Phase 3)

**What to prove:** That the ratio/formula/direct quantity system produces correct results for nested assemblies with purchasing constraints.

**Prototype scope:**
- Implement the full cedar siding example (4 items, 1 assembly).
- Implement a nested example (assembly containing a sub-assembly).
- Test all quantity modes (numeric, ratio, formula).
- Test all purchasing constraints (waste -> package -> minimum).
- Verify edge cases (zero qty bypass, fractional results, very large ratios, boundary-value interactions between waste and package rounding).

**Success criteria:** Hand-calculated results match engine output for all test cases. The cedar siding example produces EXACTLY: 3,980 LF siding, 16 boxes furring, 4,000 fasteners.

### 3.3 Option Membership Junction Table Query Performance (Before Phase 6)

**What to prove:** That the junction table approach (`node_option_memberships`) doesn't degrade the active tree query at realistic scale.

**Prototype scope:**
- Create the junction table with appropriate indexes.
- Populate with realistic data: 1,000 base nodes, 20 option groups with 3 alternatives each (~2,000 inactive alternative nodes), membership rows for all alternative nodes.
- Run the active tree query: nodes where no membership exists for a non-selected alternative.
- Test option switching (update which alternative is selected, re-query active tree).
- Compare query time against a baseline (same data without options).

**Success criteria:** Active tree query < 50ms with 3,000 total nodes and 20 option groups. Option switching (update + re-query) < 100ms. The JOIN overhead is negligible compared to network latency.

### 3.4 Math.js Sandbox Verification (Before Phase 4)

**What to prove:** That user-entered formulas evaluated through math.js cannot escape the sandbox.

**Background:** The original architecture recommended `expr-eval` for formula evaluation. The calculation engine review discovered CVE-2025-12735 -- a CVSS 9.8 critical remote code execution vulnerability via prototype pollution. The library has been effectively abandoned (last release: v2.0.2, over 6 years ago, maintainer unresponsive to security PRs). The replacement is `math.js`, which actively prevents `eval` and `new Function`, has built-in TypeScript support, and is under active maintenance.

**Lesson documented:** Always vet library security (CVE databases, maintenance status, last release date) before recommending a dependency for user-input evaluation. The expr-eval CVE was a known, published vulnerability with public exploit code. This was caught during review, not during implementation -- catching it during implementation would have required replacing an already-integrated library.

**Prototype scope:**
- Configure math.js in constrained mode (no access to `import`, `createUnit`, or other extension points).
- Attempt sandbox escape: prototype pollution, constructor access, `__proto__` manipulation, `Function` constructor via expression.
- Verify that the configured math.js instance only exposes arithmetic, comparisons, ternary conditionals, and the project parameter/reference resolution functions.
- Test with the formula patterns the system will actually use: `assembly_qty * 2.88`, `r_value > 30 ? 0.15 : 0.10`, `project_parameter('wall_height') * stud_spacing`.

**Success criteria:** No sandbox escape possible through any tested vector. Formula evaluation produces correct results for all expected patterns. Performance acceptable (< 1ms per formula evaluation).

### 3.5 Isomorphic Calculation Module (Phase 2)

**What to prove:** That the same TypeScript module produces identical results on client and server.

**Prototype scope:**
- Write the calculation chain as a pure function (no Date.now, no Math.random, no typeof window checks).
- Import in a Next.js page (client) and a server action (server).
- Run identical inputs through both, including edge cases (very large numbers, very small decimals, zero quantities).
- Apply the chosen rounding strategy and verify that rounding eliminates any sub-penny divergence.

**Success criteria:** Client and server produce identical results (after rounding to storage precision) for all test inputs. No rounding differences that would trigger unnecessary "mismatch" paths in the batch save strategy.

---

## 4. Risk Priority Matrix

| Risk | Impact | Likelihood | When to Address | Priority |
|------|--------|-----------|-----------------|----------|
| Hybrid table split developer ergonomics | Very High | Low | Phase 1 prototype | **P1** |
| Assembly cascade edge cases | High | Medium | Phase 3 test suite | **P1** |
| Formula refs across options (inactive node semantics) | High | High | Before Phase 2 (design decision) | **P1** |
| expr-eval CVE / library security | Critical | Certain (if used) | Before Phase 4 (already mitigated: use math.js) | **P1 -- RESOLVED** |
| UI state management complexity | Medium | Medium | Phase 1B pattern decision | **P2** |
| Context window during Phase 6 | Medium | Medium | Pre-Phase 6 contract | **P2** |
| Vendor system scope creep (Phase 9 = CRM) | Medium | High | Phase 9 scope definition | **P2** |
| Formula engine scope creep | Medium | High | Phase 4 scope boundary | **P2** |
| Floating-point precision discipline | Medium | Medium | Phase 2 strategy decision | **P2** |
| Deep copy perf for options | Medium | Low | Phase 6 profiling | **P2** |
| Option membership junction table perf | Medium | Low | Pre-Phase 6 prototype | **P2** |
| Isomorphic calc drift | Low | Very Low | Phase 2 validation | **P3** |
| Calculation perf at scale | Medium | Low | Phase 2 profiling | **P3** |
| Version deep copy perf | Low | Very Low | Only if version count grows large | **P3** |

### Changes from v1

| Risk | v1 Priority | v2 Priority | Reason |
|------|------------|------------|--------|
| Formula refs across options | P2 | **P1** | Guaranteed user problem, not edge case. Affects calc engine design from Phase 2. |
| Isomorphic calc drift | P2 | **P3** | Same TS file on both sides. JS floating-point is deterministic within a runtime. Near-zero risk. |
| Option subtree stamping limits | P1 | Replaced | Replaced by junction table approach -- stamp corruption risk is now mitigated. |
| Option membership junction table perf | -- | **P2** | New: the junction table adds a JOIN to every active-tree query. Must prove it's fast at scale. |
| expr-eval CVE | -- | **P1 (resolved)** | New: CVSS 9.8 RCE in the originally recommended library. Resolved by switching to math.js. |
| UI state management complexity | -- | **P2** | New: old system's "invisible children" bug was a state management issue, not data. |
| Vendor scope creep | -- | **P2** | New: Phase 9 as written is a CRM. Need MVP scope boundary. |
| Formula scope creep | -- | **P2** | New: users always want more formula features. Need hard boundaries defined in Phase 4. |
| Floating-point precision | -- | **P2** | New: no precision strategy was defined. Retrofitting rounding discipline is tedious. |

---

## 5. Mitigated Risks (Previously Critical)

### 5.1 Option Stamp Corruption -- MITIGATED by Junction Table

The original risk assessment identified option subtree stamping as P1 due to the complexity of maintaining stamp consistency. The options system review then identified four critical failure modes with the stamping approach:
1. Tree operations silently corrupt stamps.
2. No database-level consistency guarantee for stamps.
3. Single column prevents future nested options.
4. Deleting option root nodes orphans stamped subtrees.

The decision to use a junction table (`node_option_memberships`) instead of column stamping mitigates all four:
- Membership is explicit (rows in a table), not inherited from tree position.
- Membership rows have standard FK constraints and can be cascade-deleted.
- Multiple memberships per node are supported by design (future nested options).
- `anchor_node_id` on `option_groups` establishes ownership for cascade deletes.

**Residual risk:** Application logic must correctly maintain membership rows during tree operations (add, move, delete nodes within option subtrees). This is an application-logic concern, not a data-integrity concern -- missing rows are detectable and fixable.

### 5.2 expr-eval RCE Vulnerability -- MITIGATED by Library Replacement

CVE-2025-12735 is a CVSS 9.8 critical remote code execution vulnerability in `expr-eval` via prototype pollution through unrestricted member access and user-defined functions. Public exploit code exists. The library is effectively abandoned (last release over 6 years ago).

**Mitigation:** Replace with `math.js` (actively maintained, built-in security measures preventing `eval`/`new Function`, native TypeScript support, built-in unit support relevant to construction). The math.js sandbox must still be verified via prototype (Section 3.4) but the known CVE is eliminated.

---

## 6. Scope Creep Boundaries

Two risks identified by the sequence review require explicit scope boundaries rather than technical mitigation.

### 6.1 Vendor System (Phase 9) -- Define MVP

Phase 9 as specified includes: vendor CRUD, contact management, document management with Supabase Storage, expiration tracking with alerts, vendor-item pricing, vendor comparison, vendor selection in estimates, vendor-grouped views, and "foundation for purchase orders and RFPs." This is a CRM bolted onto an estimating tool.

**MVP scope (Phase 9):**
- Vendors table + basic CRUD (name, trade, status, notes)
- Vendor-item association with pricing
- Vendor selection on estimate items
- Vendor-grouped view in estimates

**Deferred (Phase 10+):** Document management, expiration tracking, COI alerts, contact management, purchase order foundation, RFP generation.

### 6.2 Formula Engine (Phase 4) -- Define Hard Boundary

The brief asks for arithmetic, project parameters, named references, and conditionals. Users will inevitably request more: aggregation functions (SUM across children), cross-node queries, loops, string operations, date math.

**In scope (Phase 4):**
- Arithmetic operators (+, -, *, /, %, ^)
- Ternary conditionals (condition ? value_if_true : value_if_false)
- Project parameter references (`project_parameter('name')`)
- Named node references (value of a specific node by `reference_name`)

**Explicitly out of scope:**
- Aggregation functions (SUM, AVG, MIN, MAX across nodes)
- Cross-node queries ("the quantity of item X")
- Loops or iteration
- String operations
- Date math

This boundary should be encoded as a contract, not a suggestion. If a user needs complex logic beyond these operations, the answer is "add a project parameter and compute it externally."

---

## 7. The Single Biggest Risk

**Building options (Phase 6) on an unstable foundation.**

This has not changed from v1. Both previous attempts failed because layers were built in parallel before lower layers were proven. The options system touches EVERYTHING -- tree structure, calculations, formulas, catalog, UI. If any of those systems have bugs or design flaws when options are implemented, the options system will either inherit those flaws or paper over them with workarounds that become technical debt.

**The mitigation IS the implementation sequence.** Phases 1-5 must be individually stable, tested, and proven before Phase 6 begins. No shortcuts. No "we'll fix it when we add options." Each phase should end with a clear "this works, here's the proof" milestone.

**Quantified:** Phase 6 is estimated at 3-5 sessions, dominating the implementation timeline. The total project is estimated at 18-28 sessions. Phase 6 is as large as Phases 0 + 1A + 4 combined. If Phase 6 hits problems due to unstable foundations, it could double that session count. The strict sequencing is not cautious overengineering -- it is the lesson paid for with two failed attempts.

**The sequence IS the risk mitigation.**
