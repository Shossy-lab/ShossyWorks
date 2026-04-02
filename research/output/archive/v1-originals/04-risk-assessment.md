# Risk Assessment

> **Date:** 2026-04-02
> **Purpose:** Identify decisions that are expensive to change later, likely failure modes, and things to prove early.

---

## 1. Decisions That Are Expensive to Change Later

These are the architectural choices where getting it wrong early means significant rework later. They're listed in order of blast radius — how much code would need to change if the decision turned out to be wrong.

### 1.1 The Node Type Split (Base Table + Detail Tables) — HIGHEST IMPACT

**Decision:** Three-table hybrid (estimate_nodes + node_item_details + node_assembly_details) instead of monolithic.

**Why it's expensive to change:** Every query that touches item or assembly data joins across these tables. Every server action, every client-side type definition, every form component assumes this structure. If we discover that the JOIN pattern causes performance problems or developer friction, migrating to a monolithic table (or a different split) means rewriting virtually every query and component in the system.

**Mitigation:** Prototype this FIRST (Phase 1). Build the full CRUD for all three node types, verify that JOINs are performant, and verify that the developer experience of working with split tables is acceptable. If the split feels painful during Phase 1, that's the cheapest possible time to change it — before calculations, catalog, or options are built on top.

**Confidence level:** High. The JOIN cost is negligible for PostgreSQL at this scale. The schema clarity benefit (no 36-column NULL density) is worth the additional query complexity. The old system's 46-column monolith was a known pain point.

### 1.2 The Options System Data Model — HIGH IMPACT

**Decision:** Subtree swapping via `option_alternative_id` stamped on all nodes in each alternative's subtree.

**Why it's expensive to change:** The options system touches the tree query (active tree filter), the calculation engine (skip inactive nodes), the UI (option indicators, switching), and the catalog (instantiating alternatives). Changing how alternatives are stored requires changes across all these systems.

**Mitigation:** Build a minimal proof-of-concept of subtree swapping BEFORE Phase 6 (perhaps as a prototype during Phase 3 or 4). Prove that:
- Stamping works correctly when creating alternatives
- The active tree query is performant
- Calculations correctly exclude inactive alternatives
- New nodes added to an alternative correctly inherit the stamp

If the stamping approach doesn't work, the alternative (a separate `node_option_memberships` junction table) can be evaluated before the full options phase.

**Confidence level:** Medium-high. The stamping approach is simple and query-friendly, but the "no nested options" restriction may become a limitation. The upgrade path (junction table for nested options) is forward-compatible.

### 1.3 The Calculation Architecture (Isomorphic Client/Server) — MEDIUM IMPACT

**Decision:** One TypeScript module shared between client and server.

**Why it's somewhat expensive to change:** If we later discover that client-side and server-side calculation need to diverge (different rounding rules, different precision, features that only make sense on one side), maintaining a single shared module becomes a constraint rather than a benefit.

**Mitigation:** Design the calculation module with clean interfaces from day one. The module takes inputs (tree structure, parameters) and produces outputs (calculated values). It doesn't reach into the database or the DOM. This makes it inherently portable even if the sharing model needs to change.

**Confidence level:** High. This is a well-proven pattern in modern web applications. The calculation logic is pure math — there's no reason it would need to diverge.

### 1.4 Version Management as Deep Copies — MEDIUM IMPACT

**Decision:** Each estimate version is a complete deep copy of the tree (separate rows in estimate_nodes).

**Why it's somewhat expensive to change:** If an estimate has 500 nodes and 10 versions, that's 5,000 rows in estimate_nodes (plus detail table rows). While PostgreSQL handles this fine, the deep copy operation itself could be slow for large estimates, and the storage grows linearly with versions.

**Mitigation:** At the expected scale (500 nodes × 5 versions = 2,500 rows), this is trivial for PostgreSQL. If version count grows unexpectedly, consider differential versioning (store only changed nodes per version) as an optimization. But start with deep copies — they're simpler, faster to query, and easier to reason about.

**Confidence level:** High for the expected scale. Would need revisiting only if version counts reach the dozens per estimate, which is unlikely.

---

## 2. Likely Failure Modes

These are the things most likely to go wrong during implementation, based on the previous attempts' failure patterns and the inherent complexity of the system.

### 2.1 Assembly Quantity Cascade Edge Cases

**What can go wrong:**
- Nested assemblies where the inner assembly's quantity depends on the outer assembly's quantity, which itself depends on a formula that references a parameter that gets overridden by a broad option
- Zero-quantity assemblies: if an assembly's qty is 0, its children's ratios produce 0 quantities, which means 0 costs, which means the parent's aggregation is 0 — but is this correct, or should it be an error?
- Package size rounding with very small ratios: 1 box per 75 SF with an assembly of 10 SF = 0.13 boxes → rounds to 1 box. This is correct (can't buy a partial box), but the 10x cost multiplier might surprise the user.
- Waste factor compounding in nested assemblies: if a sub-assembly has 15% waste and the parent assembly also has 10% waste, do they compound? (They shouldn't — waste applies to the item's raw quantity, not the assembly's quantity.)

**Mitigation:** Build a comprehensive test suite for the calculation engine with edge cases:
- Zero quantities at every level
- Very large and very small ratios
- Deep nesting (3+ levels)
- Package rounding with fractional results
- Waste factor application at different levels

### 2.2 Option Subtree Consistency

**What can go wrong:**
- User creates an option with three alternatives, then adds a new item to the group OUTSIDE any alternative. The item is always visible (option_alternative_id = NULL), but does it make sense alongside the active alternative?
- User moves a node from outside an option into an option's subtree. The moved node needs to be stamped with the alternative_id — but what if the user doesn't realize this happened?
- Deleting an option group: need to clean up all alternatives' nodes AND unstamp the selected alternative's nodes (so they become always-visible again). Order of operations matters.
- Option group with only one alternative remaining: is it still an option, or should it be automatically dissolved?

**Mitigation:** Define and document the exact lifecycle of option groups (create → add alternatives → switch → delete) with clear rules for each edge case. Implement defensive checks: warn when adding items outside options in an optioned area, confirm before deleting options, auto-dissolve single-alternative groups.

### 2.3 Formula Circular References Across Options

**What can go wrong:**
- Node A's formula references node B's value. Node B's formula references node C's value. Node C is part of an option group. When the option is switched, node C's value changes, which changes B, which changes A. This is correct behavior — but detecting circular references needs to account for ALL alternatives, not just the active one.
- A formula references a named reference that exists in one alternative but not another. When the user switches alternatives, the formula breaks.

**Mitigation:** Formula validation must check references against ALL option alternatives, not just the active tree. When a formula references a named reference, warn if that reference doesn't exist in all alternatives.

### 2.4 Calculation Performance at Scale

**What can go wrong:**
- An estimate with 1,000 nodes, 30 option groups (each with 3 alternatives = ~2,000 inactive nodes), and 20 project parameters. Full tree recalculation on every keystroke might lag.
- The comparison view needs to calculate 5+ scenarios (option sets). If each calculation takes 50ms, the comparison takes 250ms+ — noticeable.

**Mitigation:** 
- Profile the calculation engine early with realistic data (500+ nodes). If single-tree calculation exceeds 16ms (one frame), optimize.
- For comparison views, calculate scenarios in parallel (Web Workers) or debounce the calculation.
- The calculation engine should be optimized for the common case (changing one item, recalculating its ancestors only) while supporting full-tree recalculation when needed (option switch, broad option toggle).

### 2.5 Context Window Management During Development

**What can go wrong:** The previous attempts suffered from spec documents consuming 35%+ of Claude's context window. Even though this new project avoids massive spec documents, the growing codebase itself will consume context. Implementing Phase 6 (options) requires understanding the tree (Phase 1), calculations (Phase 2), assemblies (Phase 3), formulas (Phase 4), and catalog (Phase 5) simultaneously.

**Mitigation:**
- Keep contracts small (<1KB each) and focused on interfaces, not implementations
- Use subagents for research and exploration (keep main context clean)
- Use `/compact` proactively at natural breakpoints
- Each phase should have a clear, stable contract with previous phases — so Phase 6 doesn't need to "understand" Phase 1's internals, just its interface

---

## 3. What to Prototype Early

These are high-risk areas where a focused prototype (before full implementation) would significantly reduce risk.

### 3.1 The Hybrid Table JOIN Pattern (Phase 1)

**What to prove:** That working with split tables (base + detail) doesn't create developer friction that compounds over time.

**Prototype scope:**
- Create all three tables
- Write CRUD operations for each node type
- Build the tree query with LEFT JOINs
- Load a tree with 200 nodes (100 items, 50 groups, 50 assemblies)
- Measure query time with and without JOINs
- Write 5+ server actions to evaluate developer experience

**Success criteria:** Query time < 50ms for full tree load with JOINs. Developer experience is clean — no awkward NULL handling, no ambiguous types.

### 3.2 Assembly Quantity Cascade (Phase 3)

**What to prove:** That the ratio/formula/direct quantity system produces correct results for nested assemblies with purchasing constraints.

**Prototype scope:**
- Implement the full cedar siding example (4 items, 1 assembly)
- Implement a nested example (assembly containing a sub-assembly)
- Test all quantity modes (numeric, ratio, formula)
- Test all purchasing constraints (waste → package → minimum)
- Verify edge cases (zero qty, fractional results, very large ratios)

**Success criteria:** Hand-calculated results match engine output for all test cases. The cedar siding example produces EXACTLY the numbers in the brief (3,980 LF siding, 16 boxes furring, 4,000 fasteners).

### 3.3 Option Subtree Swapping (Before Phase 6)

**What to prove:** That the `option_alternative_id` stamping approach works for all option scenarios.

**Prototype scope:**
- Create a simple option (single item with 2 alternatives)
- Create a complex option (entire group with subtree, 3 alternatives)
- Switch selections, verify tree filtering
- Verify calculation correctly uses only active tree
- Test option creation, deletion, and alternative management
- Test adding/moving nodes within an optioned area

**Success criteria:** Active tree query is correct in all scenarios. Calculations match expectations. No orphaned or incorrectly stamped nodes.

### 3.4 Isomorphic Calculation Module (Phase 2)

**What to prove:** That the same TypeScript module produces identical results on client and server.

**Prototype scope:**
- Write the calculation chain as a pure function
- Import in a Next.js page (client) and a server action (server)
- Run identical inputs through both
- Compare outputs to 2-decimal-place precision
- Test with edge cases (very large numbers, very small decimals, zero quantities)

**Success criteria:** Client and server produce BIT-IDENTICAL results for all test inputs. No rounding differences, no precision drift.

---

## 4. Risk Priority Matrix

| Risk | Impact | Likelihood | When to Address | Priority |
|------|--------|-----------|-----------------|----------|
| Hybrid table split doesn't work well in practice | Very High | Low | Phase 1 prototype | **P1** |
| Assembly cascade edge cases | High | Medium | Phase 3 test suite | **P1** |
| Option subtree stamping limitations | High | Medium | Pre-Phase 6 prototype | **P1** |
| Isomorphic calc drift | Medium | Very Low | Phase 2 validation | **P2** |
| Formula circular references across options | Medium | Medium | Phase 6 validation | **P2** |
| Context window during later phases | Medium | Medium | Ongoing — contracts + subagents | **P2** |
| Calculation performance at scale | Medium | Low | Phase 2 profiling | **P3** |
| Version deep copy performance | Low | Very Low | Only if version count grows large | **P3** |

---

## 5. The Single Biggest Risk

**Building options (Phase 6) on an unstable foundation.**

Both previous attempts failed because layers were built in parallel before lower layers were proven. The options system touches EVERYTHING — tree structure, calculations, formulas, catalog, UI. If any of those systems have bugs or design flaws when options are implemented, the options system will either inherit those flaws or paper over them with workarounds that become technical debt.

**The mitigation IS the implementation sequence.** Phases 1-5 must be individually stable, tested, and proven before Phase 6 begins. No shortcuts. No "we'll fix it when we add options." Each phase should end with a clear "this works, here's the proof" milestone.

This is not cautious overengineering — it's the lesson paid for with two failed attempts. The sequence IS the risk mitigation.
