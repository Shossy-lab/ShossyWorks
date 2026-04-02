# Review 02: Calculation Engine & Formula System

> **Reviewer:** Calculation Engine Critic
> **Date:** 2026-04-02
> **Scope:** Sections 9-10 of `01-data-architecture.md`, Phases 2-4 of `02-implementation-sequence.md`, cedar siding example math, expr-eval library fitness, isomorphic architecture viability, calculation chain edge cases.
> **Verdict:** CONDITIONAL PASS — architecture is sound at the structural level, but has three critical issues and several moderate risks that must be addressed before implementation.

---

## 1. Cedar Siding Example: Manual Verification

### 1.1 Quantity Calculations — VERIFIED CORRECT

Given: Assembly = 1,200 SF

| Item | Formula | Raw Qty | After Waste | Package Round | Final | Doc Claims | Match? |
|------|---------|---------|-------------|---------------|-------|------------|--------|
| Siding (2.88 LF/SF, 15% waste, pkg 10) | 1200 x 2.88 | 3,456.0 | 3,456 x 1.15 = 3,974.4 | ceil(3974.4/10) x 10 = 3,980 | 3,980 LF | 3,980 LF | YES |
| Furring strips (1 box/75 SF) | 1200 x 1 / 75 | 16.0 | N/A | N/A | 16 boxes | 16 boxes | YES |
| Fasteners (3/SF, pkg 1,000) | 1200 x 3 | 3,600 | N/A | ceil(3600/1000) x 1000 = 4,000 | 4,000 | 4,000 | YES |
| Labor (1 SF/SF) | 1200 x 1 | 1,200 | N/A | N/A | 1,200 SF | 1,200 SF | YES |

All four calculations match. The purchasing constraint cascade (waste -> package rounding -> minimum) produces correct results.

### 1.2 Ratio Formula Verification

The ratio formula is: `raw_qty = (assembly_qty x ratio_numerator) / ratio_denominator`

For furring strips: "1 box per 75 SF" means ratio_numerator=1, ratio_denominator=75.
Calculation: (1200 x 1) / 75 = 16.0. **Correct.**

For siding: "2.88 LF per 1 SF" means ratio_numerator=2.88, ratio_denominator=1.
Calculation: (1200 x 2.88) / 1 = 3,456.0. **Correct.**

### 1.3 Markup Chain Verification

Testing the compounding markup claim with sample data:

Given: qty=100, unit_cost=$10.00, contingency_rate=5%, overhead_rate=10%

```
subtotal = 100 x $10.00 = $1,000.00
contingency_amount = $1,000.00 x 0.05 = $50.00
overhead_amount = ($1,000.00 + $50.00) x 0.10 = $105.00
total_price = $1,000.00 + $50.00 + $105.00 = $1,155.00
unit_price = $1,155.00 / 100 = $11.55
```

Non-compounding overhead (for comparison): $1,000.00 x 0.10 = $100.00, total = $1,150.00.
Difference: $5.00 ($1,155 vs $1,150). The compounding effect is real and correctly described.

**The formula chain in Section 9.2 is mathematically correct.**

---

## 2. CRITICAL ISSUE: expr-eval Library Is Unacceptable

**Severity: CRITICAL — Must be resolved before Phase 4.**

### 2.1 The Vulnerability

CVE-2025-12735 is a **CVSS 9.8 Critical** remote code execution vulnerability in expr-eval. The flaw is a prototype pollution attack via unrestricted member access (IMEMBER) and user-defined functions (IFUNDEF) in the expression evaluator. An attacker can execute arbitrary system commands through crafted context objects passed to `evaluate()`.

This is not a theoretical vulnerability. Public exploit code exists. The original expr-eval package (v2.0.2) is the latest release, and the maintainer has been unresponsive to pull requests fixing the issue.

### 2.2 The Maintenance Problem

- **Last release of original expr-eval:** Over 6 years ago (v2.0.2)
- **Maintainer responsiveness:** Unresponsive to security PRs
- **expr-eval-fork v3.0.0:** Contains the fix, but is itself a fork with uncertain long-term maintenance
- **safe-expr-eval:** A newer drop-in replacement, but has low download numbers and uncertain maintenance trajectory

### 2.3 Why This Matters for ShossyWorks

The architecture plan has users entering formula strings (`qty_formula`, `cost_formula`) that are then passed to the expression evaluator. While this is a single-user application (reducing the attack surface), the formulas are stored in the database and evaluated on both client and server. If the application ever exposes any API endpoint, or if catalog data is shared, a crafted formula string could achieve remote code execution on the server.

Even in a single-user scenario, if formulas are persisted and evaluated server-side, a compromised database (SQL injection elsewhere, backup theft) could inject malicious formulas that execute when loaded.

### 2.4 Recommendation: Replace expr-eval

**Primary recommendation: math.js** (with constrained configuration)

| Criterion | expr-eval | math.js | filtrex |
|-----------|-----------|---------|---------|
| Maintenance | Abandoned (6+ years) | Active, regular releases | Low activity but secure by design |
| CVEs | CVE-2025-12735 (9.8 Critical) | None known | None known |
| Sandbox security | Broken — prototype pollution | Actively prevents `eval` and `new Function` | Compiles to function, no `eval` |
| Custom functions | Yes | Yes | Yes |
| Ternary/conditionals | Yes | Yes (plus if/else) | Yes |
| Bundle size | ~15KB | ~200KB | ~8KB |
| TypeScript support | @types/expr-eval | Built-in | Limited |

**Why math.js over filtrex:** math.js has built-in unit support (relevant for a construction estimating tool), active maintenance, built-in security measures that prevent `eval`/`new Function`, and native TypeScript support. The 200KB bundle size is acceptable for a construction estimating application (not a lightweight widget).

**If bundle size is a concern:** filtrex is an excellent lightweight alternative. It compiles expressions to JavaScript functions without ever using `eval()`, making it immune to injection attacks by design. However, it lacks math.js's unit conversion features.

**Alternative approach:** Write a custom evaluator using jsep (parser only) + simple-eval. This gives full control over the evaluation sandbox but requires more implementation effort and introduces maintenance burden.

---

## 3. CRITICAL ISSUE: Floating-Point Precision Is Unaddressed

**Severity: CRITICAL — Must be resolved in Phase 2 design.**

### 3.1 The Problem

The architecture uses standard JavaScript `Number` (IEEE 754 double-precision floating point) throughout. The calculation chain multiplies quantities by unit costs, applies percentage markups, and sums results across hundreds of nodes. Every operation accumulates floating-point error.

Classic example: `0.1 + 0.2 = 0.30000000000000004` in JavaScript.

In a construction estimating context:
```
// 3,974.4 LF of siding x $4.50/LF
3974.4 * 4.50 = 17884.800000000003  // NOT exactly $17,884.80
```

For a single calculation, the error is sub-penny. But the calculation chain compounds errors:
1. raw_qty calculation (multiply/divide ratios)
2. waste factor multiplication
3. package rounding (this one is safe — `Math.ceil` on integers)
4. qty x unit_cost
5. subtotal x contingency_rate
6. (subtotal + contingency) x overhead_rate
7. Sum across hundreds of child nodes

Each step can introduce a rounding error of up to ~1e-15 relative to the true value. After 6 chained operations across hundreds of nodes, accumulated error could reach multiple cents on large estimates.

### 3.2 Why This Matters

Construction estimates involve values from $0.03 (a single fastener) to $2,000,000+ (total project). The system stores monetary values as `DECIMAL(15,2)` in the database (correct), but performs all intermediate calculations in JavaScript floating-point (risky). The isomorphic calculation engine means these floating-point calculations run on BOTH client and server — but worse, client and server JavaScript engines may produce different results at the sub-penny level, causing the "values don't match" path in the batch save strategy to trigger unnecessarily.

This is especially dangerous for the isomorphic validation step (Section 9.4): "If they match: bulk UPDATE" vs. "If they don't match: use server values." If floating-point quirks cause the client's `$1,155.004999999998` to round to `$1,155.00` while the server's `$1,155.005000000001` rounds to `$1,155.01`, the validation fails even though both calculations are logically correct.

### 3.3 Recommendation

**Option A (Recommended): Cent-based integer arithmetic**

Store and calculate all monetary values as integers representing cents. Convert to dollars only for display.

```typescript
// Instead of: subtotal = qty * unitCost;
// Do: subtotalCents = qty * unitCostCents;
// Where unitCostCents = 450 (meaning $4.50)
```

This eliminates floating-point error for all monetary math. Quantities can remain as floating-point (you can have 3,974.4 linear feet), but as soon as money enters the picture, switch to integer cents.

**Option B: Explicit rounding at every step**

Round to 2 decimal places after every monetary calculation step:

```typescript
const subtotal = roundToCents(qty * unitCost);
const contingencyAmount = roundToCents(subtotal * contingencyRate);
const overheadAmount = roundToCents((subtotal + contingencyAmount) * overheadRate);
const totalPrice = subtotal + contingencyAmount + overheadAmount;
```

This is simpler to implement but requires discipline — every monetary calculation must call `roundToCents()`. Missing one call reintroduces drift.

**Option C: Decimal.js library**

Use a dedicated decimal arithmetic library. Ensures exact decimal math at the cost of performance and complexity. Overkill for this application if Option A or B is adopted.

**The critical requirement regardless of option chosen:** Define and document the rounding strategy. When does rounding happen? What precision is used for intermediate values? Does the system use banker's rounding (round half to even) or standard rounding (round half up)? This must be consistent between client and server.

---

## 4. CRITICAL ISSUE: The Isomorphic Validation Gap

**Severity: CRITICAL — The batch save "match/don't match" logic needs precise definition.**

### 4.1 The Problem

Section 9.4 describes the batch save strategy:

> "3. Compares server-calculated values with client-submitted values
> 4. If they match: bulk UPDATE all changed nodes in a single transaction
> 5. If they don't match: use server values and return them to the client (self-correcting)"

This raises several unanswered questions:

**What does "match" mean?** Exact bit-level equality of floating-point values? Equality after rounding to 2 decimal places? Within an epsilon tolerance? Each interpretation has different failure modes.

**What happens when there is a legitimate mismatch?** The plan says "use server values and return them to the client (self-correcting)." But what if the mismatch is caused by:
- A stale client (user opened two tabs, edited in one, then saved from the stale tab)?
- A race condition (user edits while a save is in flight)?
- A genuine formula evaluation difference between browser JS engines (V8 in Chrome vs SpiderMonkey in Firefox)?

**How often will "self-correction" trigger?** If it triggers frequently due to floating-point noise, users will see their values silently change after every save, which erodes trust.

### 4.2 Recommendation

1. **Define "match" as equality after rounding to DECIMAL(15,2)** — the database storage precision. This absorbs floating-point noise without requiring exact bit-level agreement.

2. **Add a tolerance mode for non-monetary values** (quantities) where floating-point is acceptable. A qty of 3,974.4000000001 should match 3,974.4.

3. **Log every mismatch** (even when self-corrected) so that patterns can be identified. If a specific formula consistently produces client/server divergence, it indicates a real problem.

4. **Consider making the server the SOLE calculator** for the save path. The client calculates for display only (optimistic UI). The server recalculates from scratch on save and ALWAYS uses its own values. The "comparison" becomes a health check / telemetry signal rather than a gating decision.

---

## 5. MODERATE ISSUE: Parent Aggregation and the "Reverse-Calculated Rate" Problem

### 5.1 The Problem

The architecture states that parent nodes aggregate dollar amounts from children and then "reverse-calculate" markup rates for display:

```
parent.subtotal = SUM(children.subtotal)
parent.contingency_amount = SUM(children.contingency_amount)
parent.overhead_amount = SUM(children.overhead_amount)
// Display-only: parent.effective_contingency_rate = parent.contingency_amount / parent.subtotal
```

This is conceptually correct but has edge cases:

**Edge Case 1: Division by zero.** If `parent.subtotal = 0` (all children have zero cost), the effective rate calculation divides by zero. This can happen legitimately — a group might temporarily have all items zeroed out during editing.

**Edge Case 2: Negative subtotals.** If credits or adjustments produce negative subtotals on some children, the aggregated parent subtotal could be zero or negative while contingency amounts are positive, producing nonsensical display rates (e.g., -500% contingency).

**Edge Case 3: Mixed rates produce confusing blended rates.** If one child has 5% contingency and another has 15%, the parent might show 8.3% — a number that doesn't appear on any child. Users may find this confusing. The architecture acknowledges this ("naturally produces a blended effective rate") but doesn't address how to present it to the user.

### 5.2 Recommendation

- Handle division by zero explicitly: display "N/A" or "--" for rates when subtotal is zero.
- Consider not displaying reverse-calculated rates at all. Show the dollar amounts (which are always correct) and let users who want the rate do the mental math. Showing a blended rate that matches no individual item's rate may cause more confusion than clarity.
- If rates ARE displayed, include a tooltip or indicator showing "Blended from X children with rates ranging from Y% to Z%."

---

## 6. MODERATE ISSUE: Purchasing Constraint Cascade — Edge Cases

### 6.1 Identified Edge Cases

The purchasing constraint function in Section 9.3 has several edge cases not addressed:

**Edge Case 1: Zero or negative raw quantity.**
```typescript
function applyPurchasingConstraints(rawQty: 0, wasteFactor: 0.15, packageSize: 10, minOrderQty: 50) {
  qty = 0;           // 0 * 1.15 = 0
  qty = 0;           // ceil(0/10) * 10 = 0
  qty = 50;          // 0 < 50, so qty = 50
  return 50;         // User entered 0 quantity but system says buy 50!
}
```

If a user sets an item quantity to 0 (intending "not needed"), the minimum order constraint forces it to 50. This is mathematically correct per the function logic but almost certainly wrong in intent. A zero quantity should mean "do not purchase" and should bypass all constraints.

**Edge Case 2: Waste factor on items that don't waste.**
Labor items, subcontractor bids, and lump-sum items should never have waste applied. The schema allows `waste_factor = 0` as default, which is correct — but there's no enforcement preventing someone from setting a 15% waste factor on a labor line item.

**Edge Case 3: Package rounding on non-discrete items.**
If `package_size = 10` but the item unit is "hours" (labor), rounding up to the nearest 10 hours may not make business sense. Package rounding is meaningful for physical goods (lumber, boxes of fasteners) but not for labor or subcontractor work.

**Edge Case 4: Interaction between waste and package rounding on near-boundary values.**
```
rawQty = 99
wasteFactor = 0.01  (1% waste)
packageSize = 100

qty = 99 * 1.01 = 99.99
qty = ceil(99.99 / 100) * 100 = 100
```
vs.
```
rawQty = 99
wasteFactor = 0.009  (0.9% waste)
packageSize = 100

qty = 99 * 1.009 = 99.891
qty = ceil(99.891 / 100) * 100 = 100
```
vs.
```
rawQty = 99
wasteFactor = 0
packageSize = 100

qty = 99
qty = ceil(99 / 100) * 100 = 100
```

In all three cases, the final quantity is 100 — the waste factor is irrelevant because the package rounding dominates. This isn't a bug, but users may be confused when changing waste factor has no visible effect on the final quantity. The `raw_qty` vs `qty` split helps here, but the UX should make this clear.

### 6.2 Recommendation

- **Guard zero quantities:** If `rawQty <= 0`, skip all constraints and return 0. Zero means "exclude this item from purchasing."
- **Validate constraints against cost type:** Warn (don't block) when waste_factor > 0 on labor/subcontractor items. Warn when package_size is set on non-material items.
- **Show the constraint waterfall in the UI:** Display raw_qty -> after waste -> after package rounding -> after minimum check, so users can see exactly which constraint changed the number.

---

## 7. MODERATE ISSUE: Assembly-Level Derived Unit Cost

### 7.1 The Problem

The formula: `derived_unit_cost = total_price / assembly_qty`

This gives "cost per SF of siding system" — useful. But what does it mean when the assembly has options?

If the Cedar Siding assembly has an inline option (standard cedar vs. premium clear cedar), and the user is viewing the "premium" option:
- Does `derived_unit_cost` reflect the premium selection?
- Does it change when the user toggles options?
- Is the "active children" filter (Section 9.2) applied before computing the derived unit cost?

The architecture says parent aggregation uses "active children" (children whose `option_alternative_id` is NULL or points to a selected alternative). If this filtering applies to `derived_unit_cost`, then the cost-per-SF changes when options are toggled. This is correct behavior but needs to be explicit.

### 7.2 Also: What About Zero Assembly Quantities?

`derived_unit_cost = total_price / assembly_qty` divides by zero when `assembly_qty = 0`. New assemblies start with `assembly_qty = 0` (the default). The formula must guard against this.

---

## 8. Isomorphic Architecture: Drift Risk Assessment

### 8.1 Where Drift Can Occur

The architecture claims "no drift possible" because one TypeScript module is imported by both sides. This is aspirational but not guaranteed. Real-world drift sources include:

**1. Module bundling differences.** The client-side bundle goes through a build pipeline (webpack/turbopack/vite), which may apply transformations, tree-shaking, or minification that subtly changes behavior. The server imports the module directly or through a different bundler. Build tools can alter numeric precision through minification optimizations (though modern tools generally avoid this).

**2. JavaScript engine differences.** V8 (Chrome/Node.js) and SpiderMonkey (Firefox) and JavaScriptCore (Safari) may produce different floating-point results for the same operation at the sub-ULP level. For `Math.ceil`, `Math.round`, and basic arithmetic, engines agree. But for `Math.pow`, trigonometric functions, or complex expressions, engines can differ. This is unlikely to matter for the current formula set but could become relevant if formulas grow more complex.

**3. Runtime environment state.** The server calculates from a freshly loaded tree snapshot (database read). The client calculates from a potentially stale in-memory tree that has been incrementally modified. If the client's tree state diverges from what the server would see (e.g., a concurrent edit in another tab, a failed save that partially updated local state), the calculations will differ even with identical code.

**4. Dependency version skew.** If the expression evaluator library (math.js or whatever replaces expr-eval) is loaded at different versions on client and server (e.g., client has a cached older bundle while server was updated), formula evaluation could differ.

### 8.2 Recommendation

- **Pin all calculation dependencies in a lockfile** and ensure client and server always use the same version.
- **The calculation module should be a pure function with no side effects or environment-dependent behavior.** No `Date.now()`, no `Math.random()`, no conditional code paths based on `typeof window`.
- **Write a comprehensive test suite** that runs the same test cases in both Node.js (server) and browser (client via Playwright or similar). If any test produces different results, it reveals a drift source before it reaches production.
- **Consider the "server is always authoritative" approach** from Section 4.2 above. The client calculates for instant feedback; the server always recalculates from scratch on save. There is no "match" check — the server's values are what gets stored. The client then updates its display to match the server's response. This eliminates the drift question entirely.

---

## 9. Phase Sequencing Assessment

### 9.1 Phases 2-4 Dependency Chain

The implementation sequence separates the calculation engine (Phase 2), assembly system (Phase 3), and formula engine (Phase 4). This is sound in principle — build the flat calculation first, then add the assembly quantity cascade, then add formula evaluation.

However, there is a design tension: **the calculation chain in Phase 2 already includes `raw_qty = evaluate(qty_formula, parameters)` for formula mode** (Section 9.2). If formulas are Phase 4, what does Phase 2 do when `qty_mode = 'formula'`? The implementation sequence says "formula-placeholder-for-now" (Phase 3 done criteria). This is acceptable but must be made explicit: Phase 2 should implement `qty_mode = 'formula'` as a stub that returns 0 or throws, and Phase 3 should treat it as unimplemented. The calculation engine MUST NOT silently ignore an unimplemented formula mode — it should clearly flag "formula mode not yet available."

### 9.2 Risk: Phase 3 Is the Highest-Risk Phase

The implementation sequence correctly labels Phase 3 (Assembly System) as "High" complexity and identifies it as "the most mathematically complex phase." I agree. The recursive quantity cascade with purchasing constraints has a combinatorial explosion of edge cases:

- Assembly A contains Assembly B which contains Assembly C, each with different units
- Assembly quantity changes cascade through 3 levels of ratios with different waste factors
- Package rounding at each level can produce counter-intuitive results (rounding at inner level feeds into calculation at outer level)

**Recommendation:** Phase 3 should include an explicit "edge case test matrix" as part of its done criteria — not just the cedar siding example, but adversarial cases: zero quantities, fractional packages, deeply nested assemblies (3+ levels), mixed units, waste factors that interact with package rounding.

---

## 10. Minor Issues

### 10.1 The `unit_price` Column Placement

`unit_price` is on `node_item_details` (DECIMAL(15,2)) and defined as `total_price / qty`. But `total_price` lives on `estimate_nodes` (the base table). This means calculating `unit_price` requires data from both tables. The isomorphic calculation module will need to handle this cross-table dependency, which is fine architecturally but should be explicitly noted in the module interface.

### 10.2 Ratio Denominator = 0

If a user enters `ratio_denominator = 0`, the formula `(assembly_qty x ratio_numerator) / ratio_denominator` divides by zero. The schema uses `DECIMAL(15,4)` with no CHECK constraint preventing zero. Add: `CHECK (ratio_denominator IS NULL OR ratio_denominator != 0)`.

### 10.3 Cost Formula Interaction

The `cost_formula` field on `node_item_details` suggests that unit_cost can also be formula-driven. But Section 9.2's calculation chain only shows quantity as formula-driven. If cost formulas are planned, the calculation chain must specify where they evaluate: before or after the quantity calculation? Can a cost formula reference the item's own quantity? This creates a circular dependency risk that the document doesn't address.

### 10.4 Contingency and Overhead Rates Are Per-Item, Not Per-Node

Both `contingency_rate` and `overhead_rate` are on `node_item_details`, meaning only items (leaf nodes) have explicit rates. Parent nodes' rates are reverse-calculated. This is correct and clearly stated. But the document should explicitly state that assemblies cannot have their own contingency/overhead rates independent of their children. If a builder wants to add a 5% "assembly overhead" on top of the child items' individual overheads, the current design doesn't support this.

---

## 11. Summary of Findings

| # | Issue | Severity | Section | Action Required |
|---|-------|----------|---------|-----------------|
| 1 | expr-eval has CVE-2025-12735 (CVSS 9.8), abandoned maintenance | **CRITICAL** | 10.1 | Replace with math.js or filtrex before Phase 4 |
| 2 | No floating-point precision strategy for monetary calculations | **CRITICAL** | 9.2 | Define and implement rounding strategy in Phase 2 |
| 3 | Batch save "match" comparison is undefined | **CRITICAL** | 9.4 | Define comparison semantics; consider server-authoritative model |
| 4 | Parent reverse-calculated rates: division by zero, confusing blends | Moderate | 9.2 | Guard division, consider not displaying blended rates |
| 5 | Purchasing constraints: zero-qty, cost-type mismatches | Moderate | 9.3 | Add zero-qty guard, cost-type validation warnings |
| 6 | Assembly derived_unit_cost: zero qty, option interaction unclear | Moderate | 4.3 | Guard division, clarify option filtering in spec |
| 7 | Isomorphic drift: bundler, engine, state divergence risks | Moderate | 9.1 | Cross-environment test suite, consider server-authoritative |
| 8 | Phase 3 edge case test matrix not specified | Moderate | Phase 3 | Add adversarial test cases to done criteria |
| 9 | unit_price cross-table dependency | Minor | 4.2 | Document in module interface |
| 10 | ratio_denominator can be zero (no CHECK) | Minor | 4.2 | Add CHECK constraint |
| 11 | cost_formula interaction with calc chain undefined | Minor | 4.2 | Specify evaluation order and circular dependency rules |
| 12 | No assembly-level markup rates (design gap or feature?) | Minor | 4.2/9.2 | Clarify whether this is intentional |

---

## 12. Cedar Siding Full Worked Example (Reference)

For the record, here is the complete hand-verified calculation for the cedar siding assembly at 1,200 SF, assuming:
- Siding unit_cost = $4.50/LF, contingency 5%, overhead 10%
- Furring unit_cost = $42.00/box, contingency 5%, overhead 10%
- Fasteners unit_cost = $35.00/box of 1000, contingency 5%, overhead 10%
- Labor unit_cost = $3.50/SF (installed), contingency 10%, overhead 10%

| Item | Final Qty | Unit Cost | Subtotal | Contingency (5%) | Overhead (10% compound) | Total |
|------|-----------|-----------|----------|-------------------|------------------------|-------|
| Siding | 3,980 LF | $4.50 | $17,910.00 | $895.50 | $1,880.55 | $20,686.05 |
| Furring | 16 boxes | $42.00 | $672.00 | $33.60 | $70.56 | $776.16 |
| Fasteners | 4 boxes* | $35.00 | $140.00 | $7.00 | $14.70 | $161.70 |
| Labor | 1,200 SF | $3.50 | $4,200.00 | $420.00 | $462.00 | $5,082.00 |
| **Assembly** | **1,200 SF** | — | **$22,922.00** | **$1,356.10** | **$2,427.81** | **$26,705.91** |

*Fasteners: 4,000 fasteners / 1,000 per box = 4 boxes. Unit cost is per box.

Assembly derived_unit_cost = $26,705.91 / 1,200 = **$22.25/SF**

**Note on the labor line:** Contingency is 10% (not 5%), so:
- contingency_amount = $4,200.00 x 0.10 = $420.00
- overhead_amount = ($4,200.00 + $420.00) x 0.10 = $462.00
- total = $4,200.00 + $420.00 + $462.00 = $5,082.00

This demonstrates the per-item rate feature: different items can have different contingency rates, and parent aggregation correctly sums dollar amounts rather than re-applying a flat rate.

Verification: $20,686.05 + $776.16 + $161.70 + $5,082.00 = $26,705.91. **Confirmed.**

---

## 13. Conclusion

The calculation architecture is well-thought-out at the structural level. The separation of raw_qty from qty, the compounding markup chain, the parent aggregation model, and the isomorphic design are all sound choices. The implementation sequence correctly identifies the dependency chain and phases the work bottom-up.

However, three issues must be resolved before implementation proceeds:

1. **expr-eval must be replaced.** The library has a critical RCE vulnerability and is effectively abandoned. math.js is the recommended replacement.

2. **Floating-point precision must be addressed explicitly.** Define a rounding strategy (cent-based integers or explicit rounding at every step) and document it as part of the Phase 2 specification.

3. **The isomorphic validation semantics must be precisely defined.** What "match" means, how mismatches are handled, and whether the server should be unconditionally authoritative are design decisions that must be made before the batch save endpoint is implemented.

With these three issues addressed, the calculation engine architecture is ready for implementation.
