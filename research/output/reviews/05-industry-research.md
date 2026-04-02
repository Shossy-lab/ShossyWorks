# Review: Industry Research -- Construction Estimating Software Patterns

> **Reviewer:** Industry Research Agent
> **Date:** 2026-04-02
> **Scope:** How existing construction estimating platforms handle the core problems our architecture addresses, and where proven industry patterns should influence our design.

---

## 1. Executive Summary

Our proposed architecture is generally well-aligned with industry patterns. The hybrid base-plus-detail table model, copy-on-instantiate catalog, and isomorphic calculation engine are sound. However, this review identifies several areas where industry conventions suggest adjustments or additions:

1. **Cost codes should be structured, not free-text** -- the `cost_code VARCHAR(50)` field should reference a structured cost code table based on CSI MasterFormat.
2. **The "allowance" concept is missing** -- industry-standard allowance tracking (budget placeholders for unfinalized selections) is distinct from options/alternates and needs first-class support.
3. **Assembly formula patterns from STACK/PlanSwift/ProEst validate our ratio system** but suggest we add explicit "takeoff variable" support for measurement-driven calculations.
4. **Client-facing proposal generation needs a dedicated data path** -- not just visibility flags on nodes, but a separate presentation layer like CoConstruct/Buildertrend provide.
5. **Version management as full-copy snapshots is a differentiator**, not industry standard -- most tools offer only basic revision tracking.
6. **Units of measure need a canonical enforcement table**, which we have, but our seed data should align with RSMeans/industry standards more precisely.

**Overall Verdict:** The architecture is strong. The adjustments below are refinements, not redesigns.

---

## 2. Estimate Hierarchy Models Across Platforms

### 2.1 How Industry Tools Organize Estimates

| Platform | Hierarchy Model | Depth | Key Pattern |
|----------|----------------|-------|-------------|
| **ProEst** | Database of items grouped into phases; assemblies as "recipes" of items with formula variables | Flexible | Assemblies use custom formula variables that convert takeoff measurements into purchase units |
| **Sage Estimating** | Phases contain items; up to 40 WBS codes for cross-cutting classification; assemblies via Work Assemblies table | Flexible via WBS | Dual organization: structural (phases/items) + classificatory (WBS codes) -- exactly the pattern our architecture proposes |
| **STACK** | Items (individual materials) and Assemblies (collections of items); takeoff variables drive formulas | 2-level (assembly -> items) | Assemblies use "takeoff variables" (measured values from plans) that feed into item formulas for unit conversion |
| **PlanSwift** | Templates organized in tabs by trade; assemblies are "smart templates" combining parts | Template-driven | Assemblies prompt for user-entered specs (height, spacing) at instantiation, then auto-calculate all child quantities |
| **RSMeans** | MasterFormat 2022 (50 divisions) for unit costs; UNIFORMAT II for assemblies | Industry-standard depth | Assemblies organized by UNIFORMAT II (functional building elements), unit costs by MasterFormat (material/trade classification) |
| **Clear Estimates** | Pre-built library of 12,000+ assembly-level items; customizable categories/cost codes | Flat + categories | Targets residential builders with pre-assembled items (not individual components) -- speed over granularity |

### 2.2 Comparison with Our Architecture

**What our architecture gets right:**
- The three-type model (group / assembly / item) maps well to the industry pattern of organizational containers, functional assemblies, and atomic cost items.
- The single generic "group" type (replacing separate category/section types) is validated by industry practice -- most tools use a single container concept with flexible nesting, not two distinct container types.
- Assemblies with own quantity/unit whose children calculate relatively is exactly how ProEst, STACK, PlanSwift, and RSMeans structure assemblies.

**What needs attention:**

**FINDING 1: "Takeoff Variables" pattern.** STACK and PlanSwift explicitly distinguish between "takeoff variables" (measurements from plans -- length, area, count) and "custom variables" (assembly-specific parameters like stud spacing, layer count). Our architecture handles this through the ratio system and formula system, but doesn't have a first-class concept of "takeoff variable types" (linear, area, volume, count). Consider adding a `measurement_type` enum to assemblies that constrains what kind of takeoff measurement feeds into the assembly.

**Severity:** Low. Our formula system can handle this implicitly, but explicit measurement types would improve UX by guiding users to enter the right kind of quantity for each assembly.

**FINDING 2: Assembly instantiation prompts.** PlanSwift assemblies prompt users for specs at instantiation time (e.g., "Enter wall height and stud spacing"). Our architecture copies default values from the catalog and lets the user edit after. Consider whether assemblies should define "required parameters" that must be filled in during instantiation rather than relying on users to find and edit the right fields after insertion.

**Severity:** Low. This is a UX enhancement, not an architectural issue. The data model supports it -- `catalog_assembly_components` already has `qty_value`, `qty_formula`, and ratio fields that could be flagged as "prompt on instantiation."

---

## 3. Assemblies and Formula Patterns

### 3.1 How Industry Tools Handle Assembly Calculations

**ProEst:**
- Assemblies use "formula variables" and "algorithmic equations" to calculate quantities.
- Users define variables specific to each assembly.
- Item formulas convert assembly-level variables into purchase units.
- Users describe this as "essentially creating your own takeoff software within ProEst."
- Setting up assemblies requires "programming of formulas" -- complexity is a known friction point.

**STACK:**
- Two variable types: "takeoff variables" (from plan measurements) and "custom variables" (assembly-specific).
- Item formulas convert takeoff variables into purchase units.
- Example: Convert area to 4'x8' sheets: `[MeasuredArea]/32`
- Example with waste: `[MeasuredArea]/5000*(1+([WastePercentage0to100]/100))`
- Formulas execute per figure drawn, then sum across all figures.

**PlanSwift:**
- Assemblies prompt for specs (height, spacing) via dialog boxes at instantiation.
- "Coverage Rate" is the default calculation, with formulas for complex cases.
- Pre-configured assemblies use drag-and-drop onto plan takeoffs.
- Formula patterns include: `[MeasuredLinear]/10` for converting linear to pieces.

**RSMeans:**
- Each line item has: 12-digit address, description, crew, daily output, labor hours, unit of measure.
- Assemblies combine multiple unit cost lines into functional building elements.
- Cost breakdown always shows: material, labor, equipment separately.
- Crew data includes labor composition and productivity rates.

### 3.2 Comparison with Our Architecture

**What our architecture gets right:**
- The ratio system (`ratio_numerator` / `ratio_denominator`) maps perfectly to how STACK and PlanSwift express per-unit relationships. "1 box per 75 SF" is exactly how these tools let users think.
- Three qty modes (numeric, formula, ratio) cover all the industry patterns.
- The purchasing constraint cascade (waste -> package size -> minimum order) matches the industry-standard calculation sequence.

**What needs attention:**

**FINDING 3: Crew/productivity data is absent.** RSMeans and Sage Estimating track crew composition and productivity rates (daily output, labor-hours per unit). For a residential builder, this is less critical than for commercial estimators, but labor productivity tracking would be valuable for items with `cost_type = 'labor'`. Consider whether `node_item_details` should include optional `productivity_rate` and `crew_size` fields, or whether this is a future enhancement.

**Severity:** Low. This is a nice-to-have for residential work, not a structural gap. Labor items can use the existing `unit_cost` as an hourly rate and `qty` as hours. Crew/productivity modeling can be added later without schema changes -- it's primarily a UI/UX enhancement on top of the existing fields.

**FINDING 4: Formula complexity vs. usability tradeoff.** ProEst users cite formula setup as a major friction point. Our choice of `expr-eval` for the formula engine is correct (lightweight, proven), but the UX must make formula creation accessible to a non-developer builder. Consider providing a visual formula builder in the UI rather than requiring raw expression syntax.

**Severity:** Low (UX concern, not architecture). The formula engine architecture is sound. The formula builder is a UI layer built on top.

---

## 4. Client Selections, Allowances, and Options

### 4.1 Industry Terminology

This is a critical area where construction industry terminology has specific meanings that differ from general usage:

| Term | Industry Definition | How It Maps to Our Architecture |
|------|--------------------|---------------------------------|
| **Allowance** | A budget placeholder for items not yet fully specified. The contract includes a dollar amount; the final cost adjusts up or down when the client makes their selection. Overages/underages generate change orders. | **NOT MODELED.** Our architecture has no concept of allowance tracking. The `bid_type` field on `node_item_details` includes `'allowance'` as a value, but there's no mechanism for tracking the original allowance amount vs. actual selection cost, or automatically generating the overage/underage. |
| **Alternate** | A pre-priced option to upgrade, downgrade, or swap specific materials/features. The cost impact is shown upfront. "Add $3,500 for upgraded windows" or "Deduct $2,000 for standard fixtures." | Maps well to our **Layer 2 (Inline Options)**. Each alternative is a complete subtree with its own pricing. The "add/deduct" pricing is the difference between alternatives. |
| **Selection** | The actual choice a client makes from available options/allowances. Selections flow into change orders and budgets. | Partially modeled by `option_alternatives.is_selected`. But the selection workflow (client portal, deadlines, approval) is a UX layer. |
| **Option** | Generic term, used inconsistently in the industry. Sometimes means "alternate," sometimes means "optional scope item." | Our three-layer options system is more structured than any single industry tool's approach. This is a differentiator. |

### 4.2 How CoConstruct and Buildertrend Handle Selections

**CoConstruct:**
- Single-entry financial system: specs, allowances, and options entered once, flow everywhere.
- Client portal shows: available allowance amount, price of each option, difference (overage/underage).
- Fixed-price projects: clients see upgrade/downgrade opportunities, not raw costs.
- Open-book projects: clients see full budget breakdown including markups.
- Selections have due dates with color-coded urgency indicators.
- Selection changes automatically generate change orders with cost impact.
- Markup visibility is controllable per project type.

**Buildertrend:**
- Selections presented with: title, description, photos, vendor info, product links.
- Three pricing modes per choice: Flat Fee, Line Items (itemized), or Request From Sub/Vendor.
- "Include in Budget" toggle controls whether a choice affects job costing before selection.
- Client portal for viewing, choosing, and approving selections.
- Selections flow into change orders and budgets automatically.

**Both platforms agree on these patterns:**
- Allowances are first-class concepts with original budget, actual cost, and difference tracking.
- Client selections have deadlines and approval workflows.
- Selection changes generate change orders automatically.
- The builder controls what financial details the client sees.

### 4.3 Comparison with Our Architecture

**What our architecture gets right:**
- The three-layer options system (broad parameter overrides, inline subtree swapping, saved scenarios) is more sophisticated than any single competitor. CoConstruct and Buildertrend handle inline options and selections but don't have broad parameter overrides or saved option sets for scenario comparison.
- The `client_visibility` field (visible/hidden/summary_only) on nodes is the right approach for controlling what clients see.
- Option sets for scenario comparison ("Budget vs. Mid-Range vs. Premium") is a genuine differentiator that no mainstream residential builder tool offers.

**What needs attention:**

**FINDING 5 (IMPORTANT): Allowance tracking is missing.** This is the most significant gap identified in this review. In residential construction, allowances are ubiquitous. A typical custom home estimate might have 20-40 allowance items (flooring, lighting, fixtures, countertops, hardware, appliances, etc.). The builder includes a budget amount for each; the client selects products; overages/underages adjust the contract price.

Our architecture has `bid_type = 'allowance'` as a classification on items, but no mechanism for:
- Recording the original allowance budget amount separately from the current cost
- Tracking the difference (overage/underage) when a selection is made
- Linking a selection to its allowance
- Rolling up all allowance variances into a net contract adjustment

**Recommended addition:** An `allowance_budget` DECIMAL field on `node_item_details` (the original budgeted amount), and an `allowance_status` enum (`'pending_selection'`, `'selected'`, `'finalized'`). The overage/underage is simply `total_price - allowance_budget`. A view or computed field can aggregate all allowance variances across the estimate.

Alternatively, a dedicated `allowances` table linking items to their budget amounts and selection status, but the simpler approach (fields on `node_item_details`) is probably sufficient for a single-user tool.

**FINDING 6: Client proposal presentation layer.** CoConstruct and Buildertrend both provide structured client-facing views with:
- Controlled financial detail levels (lump sum, line items, or full detail)
- Photo attachments for selection choices
- Product links
- Due dates for pending selections
- Approval workflows

Our architecture handles the data side (`client_visibility`, `client_notes`) but doesn't define a proposal/presentation structure. This is more of a UI/feature concern than a data architecture issue, but consider adding:
- A `proposals` table linking to estimates with presentation settings (detail level, included sections, cover letter, terms)
- A `selection_choices` table that enriches option alternatives with photos, product links, and vendor info for the client-facing view

**Severity of Finding 5:** Medium-high. Allowances are fundamental to residential custom home building. Not having them would be a noticeable gap compared to every competitor.

**Severity of Finding 6:** Medium. The data architecture supports building this, but it should be considered in the implementation sequence so the schema accommodates it.

---

## 5. Cost Code Structure -- CSI MasterFormat

### 5.1 Industry Standard

CSI MasterFormat is the industry standard in North America for organizing construction work. The current edition (MasterFormat 2020/2022) uses a 50-division structure:

**Structure:**
- **Level 1 -- Division** (2 digits): e.g., `03` = Concrete, `06` = Wood/Plastics/Composites
- **Level 2 -- Section** (4 digits): e.g., `03 30` = Cast-in-Place Concrete
- **Level 3 -- Subsection** (6 digits): e.g., `03 30 00` = Cast-in-Place Concrete (general)

**Divisions relevant to residential construction:**
- 01: General Requirements
- 03: Concrete
- 04: Masonry
- 05: Metals
- 06: Wood, Plastics, and Composites (framing, trim, cabinetry)
- 07: Thermal and Moisture Protection (roofing, siding, insulation)
- 08: Openings (doors, windows)
- 09: Finishes (drywall, paint, flooring, tile)
- 10: Specialties
- 22: Plumbing
- 23: HVAC
- 26: Electrical
- 31: Earthwork
- 32: Exterior Improvements (driveways, landscaping)

**UNIFORMAT II** is an alternative classification based on building systems/elements (foundations, superstructure, exterior enclosure) rather than trade/material. RSMeans uses UNIFORMAT II for assembly-level cost data.

### 5.2 How Industry Tools Handle Cost Codes

- **Sage Estimating:** Database templates organized by MasterFormat (1995 or 2010 editions), with up to 40 WBS codes for additional classification dimensions.
- **RSMeans:** Unit costs by MasterFormat 2022, assemblies by UNIFORMAT II.
- **ProEst:** Pre-built costbook with regionalized pricing organized by standard codes.
- **Clear Estimates:** Customizable categories/cost codes with CSI MasterFormat as an option.
- **STACK:** Hides internal codes from clients; uses cost codes for builder-side organization.

### 5.3 Comparison with Our Architecture

**FINDING 7 (IMPORTANT): Cost codes should be structured, not free-text.** Our architecture defines `cost_code VARCHAR(50)` on `estimate_nodes` as a free-text field. This repeats a mistake from the old system where "sqft" and "SF" could coexist as different units.

**Recommended change:** Replace the free-text `cost_code` with a structured reference:

```
cost_codes table:
  id UUID PK
  code VARCHAR(20) -- e.g., "06 10 00"
  division VARCHAR(2) -- e.g., "06"
  title VARCHAR(255) -- "Rough Carpentry"
  parent_code_id UUID FK (self-ref) -- for hierarchy
  is_system BOOLEAN -- TRUE for MasterFormat seeds
```

Then `estimate_nodes.cost_code_id UUID FK -> cost_codes(id)` instead of free text.

**Benefits:**
- Prevents inconsistency ("06 10 00" vs "061000" vs "Rough Carpentry")
- Enables grouping/reporting by division with reliable aggregation
- Enables filtering/searching by standard divisions
- Allows custom codes alongside MasterFormat standards (`is_system = false`)
- Seed data from MasterFormat residential divisions provides instant value

**Severity:** Medium. Free-text cost codes will cause data quality issues over time. A structured table is not complex to implement and provides significant reporting value.

**Note:** For a residential builder, only ~15-20 of the 50 MasterFormat divisions are relevant. The seed data should focus on residential divisions, not the full commercial specification.

---

## 6. Version Management and Audit Trail

### 6.1 Industry Practices

| Platform | Version Management | Audit Trail |
|----------|-------------------|-------------|
| **Planyard** | Multiple estimate versions; create new versions or revert to previous; compare changes across versions | Full audit trail for all bid changes and approvals |
| **PlanSwift** | Complete transparency and traceability of changes | Change tracking |
| **Buildertrend** | Collaborative workflows with version control | Document control tied to each estimate |
| **CoConstruct** | Financial structure per project; revised budgets reflect client decisions and change orders | Budget tracking with Original vs. Revised vs. Committed vs. Actuals columns |
| **Most others** | Basic save/edit with limited history | User/timestamp on last edit only |

### 6.2 Comparison with Our Architecture

**What our architecture gets right -- and then some:**

Our two-level version system (explicit snapshots + trigger-based change history) is significantly more sophisticated than what most industry tools offer. This is a genuine differentiator:

- **Explicit versions as full copies** enable true side-by-side comparison and rollback -- most tools only track the current state with limited undo.
- **Automatic change history via triggers** captures every edit without application code involvement -- most tools rely on application-level logging that can miss changes.
- **History from day one** is correctly identified as essential -- retrofitting audit trails is painful.

**This is NOT over-engineering.** For a builder managing million-dollar estimates, the ability to say "what did this estimate look like before the client requested changes?" and get a complete answer is extremely valuable. CoConstruct partially achieves this with their "Original Budget vs. Revised Budget" columns, but our approach is more comprehensive.

**One industry pattern worth noting:** CoConstruct's four-column budget view (Original Budget / Revised Budget / Committed / Actuals) tracks estimate-to-actual variance. Our architecture captures estimate versions but doesn't model actual costs, committed costs, or purchase orders. This is likely a Phase 2+ concern (job costing), but the version system provides the foundation for it.

---

## 7. Units of Measure

### 7.1 Industry Standards

Common construction UOMs (from RSMeans, industry guides, and supplier conventions):

| Abbreviation | Full Name | Category | Common Usage |
|---|---|---|---|
| LF | Linear Feet | Length | Framing lumber, trim, siding |
| SF | Square Feet | Area | Flooring, drywall, roofing, siding |
| SY | Square Yards | Area | Carpet, grading |
| CF | Cubic Feet | Volume | Insulation |
| CY | Cubic Yards | Volume | Concrete, gravel, fill |
| EA | Each | Count | Fixtures, doors, windows |
| HR | Hour | Time | Labor |
| DAY | Day | Time | Equipment rental |
| PR | Pair | Count | Specific hardware |
| SET | Set | Count | Hardware sets |
| BOX | Box | Package | Fasteners, tile |
| BDL | Bundle | Package | Shingles, lumber |
| GAL | Gallon | Volume | Paint, stain, sealants |
| LB | Pound | Weight | Rebar, nails sold by weight |
| TON | Ton | Weight | Aggregate, steel |
| LS | Lump Sum | Fixed | Subcontractor bids, fixed-price items |
| MBF | Thousand Board Feet | Volume | Lumber pricing |
| MSF | Thousand Square Feet | Area | Sheathing, bulk material |
| SQ | Square (100 SF) | Area | Roofing (industry-standard roofing unit) |
| BAG | Bag | Package | Concrete mix, morite |
| ROLL | Roll | Package | Building paper, membrane |
| PAIL | Pail | Package | Adhesive, compound |
| TUBE | Tube | Package | Caulk, sealant |
| SHEET | Sheet | Count | Plywood, drywall (4x8, etc.) |

### 7.2 Comparison with Our Architecture

**What our architecture gets right:**
- Dedicated `units_of_measure` table with canonical symbols is the correct approach.
- FK-based unit references on items and assemblies prevent the "sqft vs SF" problem.
- `unit_conversions` table for factor-based conversion is clean.
- Unit categorization (length, area, volume, weight, count, time) is correct.

**FINDING 8: Seed data should be expanded.** Our proposed seed data (LF, SF, SY, CF, CY, EA, HR, DAY, PR, SET, BOX, BDL, GAL, LB, TON, LS) covers the basics but misses several units that are standard in residential construction:

**Additions recommended:**
- `SQ` -- Square (100 SF), standard roofing unit
- `MBF` -- Thousand Board Feet, used in lumber pricing from suppliers
- `MSF` -- Thousand Square Feet, used in bulk material pricing
- `BAG` -- Bag (concrete mix, mortar)
- `ROLL` -- Roll (building paper, membrane, flashing)
- `SHEET` -- Sheet (plywood, drywall -- common purchase unit)
- `TUBE` -- Tube (caulk, sealant)
- `PAIL` -- Pail (adhesive, joint compound)

**Also add a `time` category for `DAY` and add the `package` category for BOX, BDL, BAG, ROLL, SHEET, TUBE, PAIL.**

**Severity:** Low. This is seed data, not schema. But getting the initial unit list right prevents early friction when the builder starts entering items and doesn't find their unit.

**FINDING 9: Consider "display unit" vs "purchase unit" distinction.** STACK's formula system explicitly distinguishes between the unit used for takeoff measurement (display) and the unit used for purchasing. Example: you measure area in SF, but you buy plywood in sheets (SHEET). The formula converts: `[MeasuredArea] / 32` (where 32 = 4x8 sheet area).

Our architecture handles this implicitly through the ratio system (`ratio_numerator` / `ratio_denominator` with assembly unit being the "display" unit and item unit being the "purchase" unit). This is architecturally correct, but the UI should make this distinction explicit to users.

**Severity:** Low. Architectural support exists; this is a UX concern.

---

## 8. Phases and Classification

### 8.1 Industry Patterns

**Sage Estimating** provides the clearest model:
- **Phases** are structural containers in the database (items belong to phases).
- **WBS codes** (up to 40) are classificatory tags that can be attached to any item for cross-cutting organization.
- You can view/sort by phase OR by any WBS code, independently.

**RSMeans** uses dual classification:
- **MasterFormat** (material/trade classification) for unit costs.
- **UNIFORMAT II** (building system/element classification) for assemblies.
- These are orthogonal -- the same concrete item might be UNIFORMAT "Substructure > Foundations" and MasterFormat "Division 03 > Cast-in-Place."

**CoConstruct** uses a more pragmatic approach:
- Estimates are organized by "categories" (builder-defined).
- Budgets track by category with Original/Revised/Committed/Actual columns.
- No formal phase system, but categories often map to construction phases.

### 8.2 Comparison with Our Architecture

**What our architecture gets right:**
- Phases as classificatory (not structural) is the correct choice. This matches Sage's WBS code pattern and avoids the rigidity of forcing items into a phase-based hierarchy.
- The `phase_id` FK on `estimate_nodes` enables grouping by phase without affecting tree structure.
- Phases per project (not global) is correct -- different projects have different phase structures.

**No changes needed.** The classificatory phase model is well-validated by industry practice.

---

## 9. Proposal and Client-Facing Presentation

### 9.1 Industry Patterns

All residential builder platforms provide structured client-facing views:

| Platform | Client View Features |
|----------|---------------------|
| **CoConstruct** | Configurable detail levels (bottom line only -> detailed cost breakdown); markup visibility toggles; allowance budgets with remaining amounts; selection portals with deadlines |
| **Buildertrend** | Branded proposals; selection choices with photos, descriptions, product links; client approval workflow; mobile-friendly portal |
| **Buildern** | Show/hide estimates, allowances, payment schedules, terms with single-click toggles |
| **STACK** | Hide overhead, markup, waste percentage, taxes from customer-facing quotes |
| **Houzz Pro** | Proposals with markup hiding, memos, payment schedules, deposit requests |
| **ConstructionOnline** | Proposal Wizard generating from estimates; flexible markup (fixed or percentage, per item or per classification) |

### 9.2 Comparison with Our Architecture

**What our architecture gets right:**
- `client_visibility` (visible/hidden/summary_only) on nodes controls item-level visibility.
- `client_notes` on nodes provides client-facing text separate from builder notes.
- Option alternatives with `is_selected` determine which configuration the client sees.

**FINDING 10: Proposal structure is under-specified.** The architecture handles what data is visible to clients but doesn't define how that data is presented. Industry tools provide:

1. **Proposal documents** with cover letters, terms and conditions, payment schedules.
2. **Detail level configuration** per proposal (not per item) -- "show this client a lump sum breakdown by category" vs. "show this client full line-item detail."
3. **Branded output** with company logo, formatting, and professional presentation.
4. **Digital signature / approval** workflow.

This is primarily a UI/presentation layer, but a minimal `proposals` table would be useful:

```
proposals:
  id UUID PK
  estimate_id UUID FK
  name VARCHAR(255) -- "Initial Proposal", "Revised Proposal"
  detail_level VARCHAR(20) -- 'lump_sum', 'category_summary', 'line_item'
  option_set_id UUID FK -- which scenario to present
  cover_letter TEXT
  terms TEXT
  status VARCHAR(20) -- 'draft', 'sent', 'viewed', 'approved', 'declined'
  sent_at TIMESTAMPTZ
  approved_at TIMESTAMPTZ
  created_at / updated_at TIMESTAMPTZ
```

**Severity:** Medium. Not needed for Phase 1, but the existence of this table in the schema design signals that client-facing proposals are a planned feature, and other tables (like `option_sets`) are designed to support it.

---

## 10. Summary of Findings and Recommendations

### Findings Ranked by Impact

| # | Finding | Severity | Architecture Impact | Action |
|---|---------|----------|-------------------|--------|
| 5 | **Allowance tracking is missing** | Medium-High | Add `allowance_budget` + `allowance_status` fields to `node_item_details` | Implement in Phase 1 item model |
| 7 | **Cost codes should be structured** | Medium | Add `cost_codes` table, change `cost_code` to FK reference | Implement in Phase 1 supporting tables |
| 10 | Proposal structure under-specified | Medium | Add `proposals` table | Design in Phase 1, implement in Phase 3+ |
| 6 | Client presentation layer needed | Medium | UX concern; data architecture supports it | Plan for Phase 3+ |
| 8 | Unit seed data needs expansion | Low | Add ~8 more units to seed data | Trivial, do in Phase 1 |
| 1 | Takeoff variable types on assemblies | Low | Optional `measurement_type` on assemblies | Consider for Phase 2 |
| 2 | Assembly instantiation prompts | Low | UX pattern, not schema change | Consider for Phase 2 |
| 3 | Crew/productivity data absent | Low | Optional fields on items | Defer to Phase 3+ |
| 4 | Formula UX complexity | Low | UX concern, not architecture | Defer to formula UI phase |
| 9 | Display vs. purchase unit distinction | Low | Already handled by ratio system | UX enhancement |

### What We Do Better Than Industry Tools

1. **Three-layer options system** -- No competitor offers broad parameter overrides + inline subtree swapping + saved option sets in a unified model.
2. **Full version snapshots with trigger-based audit trail** -- Most tools offer basic revision history. Our approach enables true point-in-time reconstruction and side-by-side comparison.
3. **Isomorphic calculation engine** -- Client-side instant feedback with server-side validation is not standard in the industry. Most tools are either server-only (slow) or client-only (risky).
4. **Assembly ratio expression** -- Preserving natural expressions ("1 box per 75 SF") rather than forcing per-unit normalization is more intuitive than what most tools require.
5. **Database-enforced invariants** -- Most tools rely on application code for data integrity. Our trigger-and-constraint approach is more robust.

### What Industry Tools Do That We Should Adopt

1. **Allowance management** -- Tracking original budget vs. actual selection cost with automatic overage/underage calculation.
2. **Structured cost codes** -- Referenced from a table, not free-text fields.
3. **Client selection workflow** -- Due dates, approval flow, and change order generation from selection changes.
4. **Expanded unit seed data** -- Including industry-standard package units (SQ, MBF, BAG, ROLL, SHEET).
5. **Proposal generation** -- Structured proposals with configurable detail levels and presentation settings.

---

## 11. Sources

- [ProEst Construction Estimating Software](https://construction.autodesk.com/products/proest/)
- [STACK Takeoff & Estimating](https://www.stackct.com/takeoff-and-estimating/)
- [STACK: Working with Assembly Formulas](https://help-preconstruction.stackct.com/docs/working-with-assembly-formulas)
- [STACK: Mastering Custom Formulas](https://help-preconstruction.stackct.com/docs/mastering-custom-formulas)
- [PlanSwift: Use Parts and Assemblies](https://www.planswift.com/blog/use-parts-assemblies/)
- [PlanSwift: Use Takeoff Assemblies](https://www.planswift.com/blog/use-takeoff-assemblies/)
- [PlanSwift: Useful Formulas](https://help.constructconnect.com/15-writing-and-using-formulas-189/planswift-15-01-useful-formulas-for-takeoff-and-estimating-1656)
- [Sage Estimating Getting Started Guide](https://docs.sage.com/docs/en/customer/estimating/14_11SQL/open/SageEstimatingGettingStartedGuide.pdf)
- [Sage Estimating: Defining WBS](http://help-sageestimating.na.sage.com/en-us/20_1/Content/geninfo/defining_work_breakdown_structures.htm)
- [RSMeans: Unit Cost Databases Guide](https://www.rsmeans.com/resources/unit-cost-databases-construction-guide)
- [RSMeans: Creating Unit & Assembly Estimates](https://www.rsmeans.com/resources/creating-unit-assembly-estimates-rsmeans-online)
- [RSMeans: Understanding CSI MasterFormat](https://www.rsmeans.com/resources/csi-masterformat)
- [RSMeans: Understanding UNIFORMAT II](https://www.rsmeans.com/resources/uniformat-ii)
- [CoConstruct: Specs and Selections](https://www.coconstruct.com/learn-construction-software-features/specs-and-selections)
- [CoConstruct: Estimates and Proposals](https://www.coconstruct.com/learn-construction-software-features/estimates-and-proposals)
- [CoConstruct: Client View of Specs & Selections](https://www.coconstruct.com/learn-construction-software/client-view-of-specs-selections)
- [CoConstruct: Understanding Terminology](https://www.coconstruct.com/learn-construction-software/understanding-terminology-budgets-client-prices-and-allowances)
- [CoConstruct: Selections Management & Change Orders](https://www.coconstruct.com/learn-construction-software/selections-management-change-orders-decisions-in-time)
- [Buildertrend: Construction Selections Software](https://buildertrend.com/project-management/construction-selections-software/)
- [Buildertrend: Selections Overview](https://buildertrend.com/help-article/selections-overview/)
- [Clear Estimates: Feature Guide](https://help.clearestimates.com/en_US/start/can-it-do)
- [Procore: CSI MasterFormat Guide](https://www.procore.com/library/csi-masterformat)
- [Tyler Graham Construction: Allowances, Alternates, and Addenda](https://tgcbuild.com/blog/understanding-allowances-alternates-and-addenda-in-custom-home-building-and-why-they-protect-your-budget/)
- [Building Advisor: Allowances in Construction Contracts](https://buildingadvisor.com/project-management/contracts/red-flag-clauses/allowances-in-construction-contracts/)
- [Markup and Profit: Allowances in Pricing](https://www.markupandprofit.com/articles/allowances-in-your-pricing/)
- [Construction Consulting: Allowances in Residential Construction](https://constructionconsulting.co/blog/how-to-use-allowances-in-residential-construction)
- [Noble Desktop: Units of Measure in Construction Estimating](https://www.nobledesktop.com/learn/construction-estimating/understanding-units-of-measure-in-construction-estimating)
