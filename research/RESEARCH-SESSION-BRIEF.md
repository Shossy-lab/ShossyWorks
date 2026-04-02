# Research Session Brief — ShossyWorks Estimating Platform

> **What this document is:** A comprehensive briefing for a fresh Claude Code CLI session. Your job in this session is to perform deep research into how to build a construction estimating platform from scratch. You are NOT implementing anything yet. You are researching, analyzing, and producing architectural recommendations.
>
> **How to use this document:** Read this entire document before doing anything else. It contains everything you need to understand the problem domain, the relationships between concepts, what was tried before (and why it didn't work), and what your research should produce.

---

## Part 1: Who I Am and What I Need

I'm Zac. I own Szostak Build, LLC — a high-end custom residential construction company in Chapel Hill, North Carolina. I am NOT a software developer. I don't write code. You (Claude Code CLI) are the sole developer on this project.

This application is being built for ME to use in MY business. It is not being built to sell, license, or distribute. It is a personal business tool. This means we don't need to over-engineer for multi-tenancy, SaaS features, or scale beyond one company. But it DOES need to be excellent — this tool will be how I estimate, manage, and present construction projects worth hundreds of thousands to millions of dollars.

I have been trying to build this application across two previous attempts over many months. Both attempts taught me an enormous amount about what I need and how the concepts relate to each other. But both attempts also had serious structural problems that made them increasingly difficult to work with as complexity grew. I am starting completely fresh in this repo.

**The critical thing you need to understand:** I have HOURS of conversation history, specs, prototypes, and documentation from the previous attempts. Some of that knowledge is included in this repo as reference material. But your job is NOT to adopt, replicate, or inherit any of those structures. Your job is to understand the PROBLEM DOMAIN — what construction estimating requires — and then figure out the BEST way to solve it from first principles. The previous attempts are cautionary tales and context, not blueprints.

**My tech stack preference:** Next.js, Supabase, Vercel, TypeScript, Tailwind CSS. But if your research leads you to believe a different approach is better for any part of this, I want to hear that argument.

---

## Part 2: The Problem Domain — Construction Estimating

### What a Construction Estimate Is

A construction estimate is a detailed breakdown of everything required to build a project — every material, every hour of labor, every piece of equipment, every subcontractor — organized into a hierarchical structure that makes sense both for the builder (who needs to buy things and manage costs) and for the client (who needs to understand what they're paying for).

An estimate is NOT a flat list of costs. It's a TREE. At the top level, you might have broad categories like "Site Work," "Framing," "Mechanical/Electrical/Plumbing," or "Finishes." Inside each of those, you have more specific groupings. Inside those, you have the actual individual cost items. The depth and organization of this tree is how the complexity of a construction project becomes manageable.

### Why This Is Hard

Construction estimating is hard because the same data needs to serve multiple audiences and purposes simultaneously:

1. **The builder** needs to see detailed cost breakdowns — unit costs, quantities, waste factors, vendor assignments, purchasing constraints, labor rates, subcontractor bids. This is the operational view.

2. **The client** needs to see a clear, understandable summary — what they're getting, what it costs, and what their options are. They should NOT see the builder's internal cost structure (unit costs, markup percentages, contingency calculations). They see the final price.

3. **The budget** needs to be viewable from multiple angles — grouped by phase of construction, by cost code (industry standard classification), by vendor, by cost type (material vs. labor vs. equipment vs. subcontractor). The same data, sliced differently depending on what question you're answering.

4. **Options and alternatives** are central to the process. A client might choose between hardwood and tile flooring. Or between a standard kitchen and an upgraded kitchen. These aren't just price changes — swapping an option can replace entire sections of the estimate tree, not just adjust a number. The estimate needs to model multiple scenarios and let the client (or builder) toggle between them.

5. **Reusability** is essential. I build similar things across different projects. A "cedar siding system" involves the same materials, labor, and relationships every time. I need to define these once in a catalog and pull them into any estimate, where they become independent copies that I can customize for that specific project.

---

## Part 3: Core Concepts — The Building Blocks

These are the fundamental concepts of the system. I'm explaining them from the construction perspective, not from a database perspective. How they get stored is YOUR research task.

### Items

An Item is the atomic unit of the entire system. It represents a single purchasable or billable thing. Every dollar in an estimate ultimately traces back to an item.

Examples of items:
- 2×4 Lumber, 8 feet long, at $4.50 each
- Carpenter labor at $65.00 per hour
- Concrete at $125.00 per cubic yard
- A subcontractor bid for electrical rough-in at $18,500 lump sum
- Paint at $35.00 per gallon
- Quarrix furring strips at $42.00 per box (covers 75 square feet)

Key characteristics of items:
- They have a **quantity** and a **unit** (10 LF, 3 hours, 250 SF, 1 lump sum)
- They have a **unit cost** (what one unit costs the builder)
- They have a **cost type** classification: Material, Labor, Equipment, Subcontractor, or Other
- They can carry **purchasing constraints**: minimum order quantities (can't buy less than 10 LF of siding because it comes in 10-foot lengths), package sizes (fasteners come in boxes of 1,000), waste factors (15% of siding material will be wasted in cuts)
- They have **documentation**: installation instructions, material specifications, internal notes, client-facing notes
- They have **classification**: cost codes (industry standard like CSI MasterFormat), phases, vendor assignments
- They have **visibility controls**: some items are visible to clients, some are hidden (internal costs), some show only in summary form
- Items are ALWAYS leaf nodes in the tree. They cannot contain other items or any other type of node. They are the bottom of the hierarchy.
- Items carry a full calculation chain: quantity × unit cost = subtotal, then contingency markup is applied, then overhead markup is applied (compounding on the contingency), producing a total price. The total price divided by quantity gives the unit price (what the client sees per unit).

### Assemblies

An Assembly is a reusable grouping of items (and potentially other assemblies) that represents a common construction component. The key thing that makes assemblies special is that they have their own quantity and unit, and the quantities of everything inside them are calculated RELATIVE to the assembly's quantity.

**The Cedar Siding Example (this is the canonical example — understand this and you understand assemblies):**

I build a "Cedar Siding System" assembly. The assembly's unit is Square Feet (SF). Inside it:

1. **1×6 T&G Cedar Siding boards** — The item's unit is Linear Feet (LF). The relationship: 2.88 LF of siding per 1 SF of wall area (calculated from the board's 5.5" actual width). There's a 15% waste factor because cuts produce scrap. The siding comes in 10-foot lengths, so the minimum quantity is 10 LF.

2. **Quarrix Furring Strips** — The item's unit is Boxes. The relationship: 1 Box per 75 SF. I can't buy a partial box, so the minimum is 1 box and the quantity rounds up to whole boxes.

3. **Stainless Steel Fasteners** — 3 fasteners per SF. Bought in boxes of 1,000. So the quantity calculation is: (assembly SF × 3), rounded up to the nearest 1,000.

4. **Installation Labor** — 1 SF per SF. A direct 1:1 ratio with the assembly quantity.

When I set the assembly quantity to 1,200 SF (the wall area for a specific project), ALL of those child quantities automatically calculate:
- Siding: 1,200 × 2.88 × 1.15 (waste) = 3,974.4 LF → rounded up to 3,980 LF (nearest 10)
- Furring strips: 1,200 / 75 = 16 boxes
- Fasteners: 1,200 × 3 = 3,600 → rounded to 4,000 (nearest box of 1,000)
- Labor: 1,200 SF

The assembly's own unit cost is DERIVED — it's the sum of all children's costs divided by the assembly quantity. The builder never inputs the assembly's cost directly; it rolls up from the items.

**Assemblies can nest.** A "Complete Exterior Wall" assembly might contain the Cedar Siding assembly, a Weather Barrier assembly, and an Insulation assembly. The calculation cascades recursively.

**The Ratio System — how item quantities relate to assembly quantities:**

Items inside assemblies can express their quantities in different ways:

- **Ratio mode:** "X item-units per Y assembly-units." This is the most natural expression. "1 Box per 75 SF" is much more intuitive than "0.0133 Boxes per 1 SF." The system should allow the user to express the ratio in whatever pairing makes sense for the real-world purchasing logic — not force normalization to "per 1 unit."

- **Formula mode:** Some quantities require complex calculations. A manufacturer might specify a coverage formula, or the quantity might depend on project-specific measurements (perimeter, area, custom parameters). The system needs to support formula-driven quantities that can reference project-level variables.

- **Direct numeric entry:** Sometimes you just know the quantity. Override any formula or ratio and type a number directly.

**Purchasing constraint cascade:** After the base quantity is calculated (from ratio, formula, or direct entry), purchasing constraints are applied in order: multiply by waste factor → round up to package size → enforce minimum quantity → final quantity.

### Categories and Sections — Organizational Containers

Above items and assemblies in the tree, there are organizational groupings. In construction, estimates are typically organized something like:

- **Division 03 — Concrete** (top-level category)
  - Foundation Walls (section)
    - Concrete material (item)
    - Rebar (item)
    - Forming labor (item)
  - Slab on Grade (section)
    - Concrete material (item)
    - Vapor barrier (item)
    - Finish labor (item)

Categories and sections are purely organizational — they don't have their own quantities or costs. They exist to group things logically and to aggregate totals from their children. A category's total is the sum of everything inside it.

**An important question for your research:** Do we actually need BOTH categories AND sections as distinct concepts? In the previous attempts, "category" was a root-level grouping and "section" was a mid-level grouping. But functionally they behave identically — both are containers that aggregate children. The only difference was that categories could be root nodes and sections couldn't. Is this distinction valuable, or is one generic "group" concept cleaner? I don't have a strong opinion — I want you to figure out what makes the most sense.

**Another important question:** How do "phases" relate to this hierarchy? In construction, a project has phases (Foundation, Framing, Rough-In, Finishes, etc.). Sometimes phases map cleanly to the estimate tree structure (the "Foundation" category IS the foundation phase). Sometimes they don't — a single category might span multiple phases, or a phase might cut across categories. I need the ability to view and group costs by phase, but I'm not sure whether phases should be structural (built into the tree) or classificatory (a tag on items that enables grouping in views). Research this.

### The Catalog — Reusable Templates

I build similar things across different projects. Cedar siding systems, framing assemblies, roofing systems — these are standard components with standard relationships. I need a catalog where I define these templates once, and then pull them into any estimate.

**The fundamental principle: Instantiation, Not Reference.**

When I pull a catalog item or assembly into an estimate, it must be COPIED — a completely independent duplicate with its own identity. The estimate OWNS its data. This is non-negotiable and was one of the few things both previous attempts got right.

Why? Because if catalog items were linked by reference, then editing the catalog would silently change existing estimates. That's catastrophic in construction — an estimate that was approved at a certain price must not change because someone updated a material cost in the catalog. The catalog is where templates live. The estimate is where project-specific reality lives.

After instantiation, the estimate copy can be freely modified without affecting the catalog or other estimates. There should be an optional breadcrumb back to the catalog source (so you can check "has this changed since I pulled it?") and explicit user-initiated sync operations (pull latest from catalog, push changes back to catalog). But automatic cascading updates are forbidden.

### The Options System — Modeling Client Choices

Options are how the estimate handles "or" — when a client might choose between alternatives. This is one of the most complex parts of the system and one where previous attempts struggled with sequencing.

**Three layers of options:**

**Layer 1 — Broad Options (estimate-wide parameter overrides):**
These are toggles that change project-level parameters and affect all formula-driven calculations. Example: "Upgraded Insulation Package" might change the insulation R-value parameter from R-19 to R-38, which cascades through every formula that references that parameter, changing quantities and costs throughout the estimate.

**Layer 2 — Inline Options (item-level alternatives):**
These are attached to specific positions in the estimate tree. The critical thing: options can swap ENTIRE LINE ITEMS, entire assemblies, or even entire sections and categories — not just adjust a cost number. Example: an "Upgraded Kitchen" option doesn't just change a price — it replaces the entire kitchen section with a different set of items, assemblies, materials, and labor. The base version and each alternative are complete, independent subtrees.

**Layer 3 — Option Sets (saved scenario snapshots):**
These are saved combinations of broad and inline option selections. "Budget Scenario," "Mid-Range Scenario," "Premium Scenario" — each remembers which options are toggled on/off, so you can quickly switch between complete configurations and compare total costs.

---

## Part 4: The Calculation Chain

Every dollar in the estimate flows through this chain. Getting this wrong breaks everything downstream.

**For leaf items (the atomic cost entries):**
```
quantity × unit_cost = subtotal
subtotal × contingency_rate = contingency_amount
(subtotal + contingency_amount) × overhead_rate = overhead_amount
subtotal + contingency_amount + overhead_amount = total_price
total_price ÷ quantity = unit_price (what the client sees per unit)
```

**Critical detail:** Overhead COMPOUNDS on contingency. It's `(subtotal + contingency) × overhead_rate`, NOT `subtotal × overhead_rate`. This is how real-world job pricing works — overhead covers the cost of managing contingency reserves too.

**For parent nodes (groups, assemblies, categories, sections):**
Parent costs are NEVER directly entered. They are ALWAYS the sum of their children's costs. A category's subtotal is the sum of all its children's subtotals. Its contingency amount is the sum of all children's contingency amounts. And so on. This means markup rates on parents are "reverse-calculated" — they're display-only percentages derived from the aggregated totals, not inputs.

**For assemblies specifically:**
The assembly node has a quantity (e.g., 1,200 SF). Its children's quantities are calculated relative to that. The assembly's derived unit cost = sum of children's subtotals ÷ assembly quantity. This gives you "cost per square foot of siding system" automatically.

**Per-item markup rates, not global rates:**
Different items can have different contingency and overhead rates. Some materials might carry 5% contingency while labor carries 10%. When parent nodes aggregate, they sum the actual dollar amounts, which naturally produces a blended effective rate. This is more accurate than applying a flat global rate, which only works when all items share the same rate.

---

## Part 5: What Went Wrong in Previous Attempts (Cautionary Context, NOT Blueprints)

I am including this section so you understand the PROBLEMS we encountered, not so you can study the SOLUTIONS that were tried. The solutions may have been wrong. The problems are real and must be addressed in whatever new approach you design.

### Attempt 1 — The Estimating Platform (EP)

This was a full-featured estimating application built with Next.js + Supabase. It was ambitious — item editing, tree management, catalog system, formula engine, assembly support, options system, all designed in parallel.

**What went wrong:**

1. **Everything was built simultaneously.** The tree, calculations, catalog, options, and UI were all designed and partially implemented at the same time. This meant that when a foundational assumption changed (and they changed frequently as I clarified what I actually needed), the ripple effects broke everything above it. The catalog system was designed before the item data model was stable. The options system was designed before the tree operations were proven. Nothing had a solid foundation.

2. **The data model grew to 46 columns on a single table.** Every node in the estimate tree — whether it was a top-level category with 3 relevant fields or a detailed item with 30+ relevant fields — lived in one monolithic table. This was done because tree operations (move, indent, outdent) are simpler when everything is in one table. But it meant ~36 columns were NULL on every non-leaf node, the schema was ambiguous about which columns mattered for which node type, and every query pulled all 46 columns whether you needed them or not.

3. **The application code was expected to enforce rules the database didn't.** Which node types can be children of which? Application code only. Circular reference prevention in nested assemblies? Application code only. This meant bugs could put the data into invalid states that the database was perfectly happy to store.

4. **Recalculation had an N+1 problem.** After recalculating the entire tree, each changed node was updated individually via separate database calls. For a tree with N ancestors of a changed node, that's N+1 round trips. This was slow and wasteful.

5. **Known operations didn't trigger recalculation.** Moving a node between parents left both parents' totals stale. Duplicating a node only added the root copy to the UI — children existed in the database but were invisible until a full page refresh. These gaps accumulated over time.

6. **Documentation specs grew massive and consumed context.** The item parameters spec alone was 2,635 lines (111KB). The catalog spec was 74KB. Loading these into Claude's context window consumed ~35% of available space before any code generation began.

7. **JSONB was used for things that needed to be queryable.** Tags, parameters, attachments, links — all stored as JSONB blobs with no referential integrity, no type checking at the database level, and no ability to query or join against the internal structure efficiently.

### Attempt 2 — The Soloway Proposals System

This was a narrower application — a client-facing proposal viewer for a specific project. Data flowed one direction: Excel workbook → Python export script → Supabase → Next.js frontend. No editing in the app itself (initially), just display.

**What went wrong (differently):**

1. **The hierarchy was fixed at exactly 5 levels (0-4)** with a stored `hierarchy_level` column. This was simple and worked for the proposal viewer, but it's too rigid for a full estimating platform where assemblies nest to variable depths.

2. **Data was read-only by design.** When editing was added later, it was bolted on as an afterthought rather than designed in. The calculation engine, the data flow, and the component architecture all assumed immutable data.

3. **The Excel workbook was the source of truth.** This was fine for one specific project but means the app can never stand on its own. The goal of the new platform is to be self-sufficient — no Excel dependency.

### Failure Patterns Common to Both Attempts

- **Building layers in parallel instead of bottom-up.** Both attempts tried to design the catalog before the item model was stable, and the options system before the tree was proven. This caused cascading instability.
- **Insufficient database-level enforcement.** Business rules lived in application code, which meant bugs could corrupt data silently.
- **No clear distinction between "what the builder sees" and "what the client sees"** in the data model itself. Visibility was an afterthought, not a first-class concern.
- **Context window management was ignored until it became a crisis.** Massive spec documents consumed AI context and made iterative development harder.

---

## Part 6: Critical Warnings for This Research Session

**READ THIS CAREFULLY. This is the most important section of this document.**

### Warning 1: Do NOT inherit structures from previous attempts

The `research/references/` folder contains documents from the previous attempts. These exist so you can understand what was tried and what problems were encountered. They are NOT templates to adopt. I expect you to:

- Read them to understand the problem space
- Identify what PROBLEMS they were trying to solve (those problems are real)
- IGNORE the specific solutions they chose (those may have been wrong)
- Design new solutions from first principles based on your own research into best practices

If I see a schema that looks like a warmed-over version of the old 46-column monolithic table, or a tree system that copies the old `buildTree()` algorithm without questioning whether it's the best approach, I will know you copied instead of researched.

### Warning 2: Do NOT let existing structures influence your recommendations by default

This is subtle and important. When you read the reference docs, you will see patterns — self-referencing parent_id for trees, JSONB for flexible parameters, UUIDs for everything. These MIGHT be the right choices. But they should be right because your research concludes they're the best approach, not because the old system used them and it's easier to keep them. Question everything.

### Warning 3: Do NOT conflate "what was done" with "what should be done"

When the reference docs say things like "the monolithic table was chosen because tree operations are simpler," that's explaining WHY a decision was made, not asserting it was correct. Maybe there's a better way to get simple tree operations WITHOUT a monolithic table. Maybe tree operations aren't actually the bottleneck that should drive the schema design. Research it. Don't accept the old reasoning at face value.

### Warning 4: Sequencing matters more than anything

The single biggest lesson from both previous attempts: the ORDER in which things are built determines whether the foundation is stable enough to support what comes next. Both attempts tried to build too many layers at once and paid for it with cascading instability. Your research must produce a clear, justified implementation sequence where each layer is fully stable before the next one begins.

### Warning 5: This is for one company, one user

Don't over-engineer. I don't need multi-tenancy, role-based access control with 5 roles, a SaaS billing system, or enterprise-grade anything. I need a tool that works exceptionally well for ONE construction company. Simpler is better. If a feature would add complexity and it's not needed for a single-user, single-company tool, skip it.

---

## Part 7: Open Questions (Things I'm Actively Uncertain About)

These are real questions I don't have answers to. Part of your research should address them.

1. **Do I need both "categories" and "sections" as distinct node types, or is one generic "group" type sufficient?** In real life, the only difference was that categories could be root nodes. Is that distinction worth a separate type?

2. **How should phases work?** Are they structural (part of the tree hierarchy) or classificatory (a tag on items for grouping in views)? Can they be both?

3. **Where should assembly-specific parameters live?** Waste factors, minimum quantities, package sizes — these describe an item's behavior WITHIN a specific assembly context. The same catalog item might have different waste factors in different assemblies. How do you model that?

4. **How many fields belong directly on an item node vs. in related tables?** The old system put everything on one row (46 columns). My intuition says that's too many, but splitting into too many related tables adds JOIN complexity. Where's the right balance?

5. **Should calculations happen client-side, server-side, or both?** The old system did server-only (safe but slow — every edit required a round trip). Client-side would be instant but risks calculation drift. A hybrid approach (calculate client-side for display, validate server-side on save) might be best. Research the trade-offs.

6. **How should the options system model "swap entire sections"?** When an inline option replaces an entire section of the estimate tree, what does that look like in the data? Are both alternatives stored as complete subtrees? Does the inactive one exist in the tree but marked hidden? Or is it stored separately and injected when selected?

7. **What's the right way to model the tree?** Self-referencing parent_id? Materialized paths? Nested sets? Closure tables? Each has trade-offs for read performance, write performance, and operation complexity (move, insert, delete, re-parent). Which best fits a construction estimate where the tree is frequently modified and moderate in size (typically 200-1000 nodes)?

8. **How should formulas work?** Items can have formula-driven quantities that reference project parameters, other items' values, and dimensional properties. What's the best approach — a formula engine library, custom expression parser, or something else?

9. **What is the best approach for units of measure and conversion?** The old system had a units table but the item's unit field was free-text with no FK, so "sqft" and "SF" could coexist as different units. How should this be handled properly?

---

## Part 8: Your Research Task — What This Session Should Produce

You are NOT building anything in this session. You are researching and producing written recommendations. Here is specifically what I need:

### Deliverable 1: Data Architecture Recommendation

Research and recommend the best data structure for this application. This should cover:
- How to model the estimate tree (which tree representation approach and why)
- How to model items, assemblies, groups/categories/sections (monolithic table vs. separated tables vs. hybrid — with genuine pros/cons analysis, not just "the old system did X")
- How to model the item-to-assembly relationship and quantity calculations
- How to model the catalog and the instantiation pattern
- How to model options (all three layers)
- How to handle units of measure
- How to handle formulas and calculated fields
- Where to use JSONB vs. normalized tables
- What constraints and validations should be enforced at the database level vs. application level

For each recommendation, explain: what alternatives you considered, why you chose this approach, and what the trade-offs are.

### Deliverable 2: Implementation Sequence

Produce a strict, ordered sequence of implementation phases. For each phase:
- What it builds (scope)
- What it depends on (prerequisites — must be fully stable)
- What it produces (testable output)
- What "done" means (how we know the foundation is stable enough for the next layer)
- Estimated relative complexity (simple / moderate / complex)

The sequence must be bottom-up. Each layer must be independently testable and provably stable before the next layer begins.

### Deliverable 3: Answers to Open Questions

Address each of the open questions in Part 7 with a researched recommendation and reasoning.

### Deliverable 4: Risk Assessment

Identify the hardest parts of this system. Where are the design decisions that are expensive to change later? Where are the likely failure modes? What should we prototype or prove out early because getting it wrong would be costly?

### Where to Write Your Output

Create your research output in `research/output/` in this repo. Organize it however makes sense for the content, but every file should be clearly named and self-explanatory.

---

## Part 9: Reference Documents

The `research/references/` folder contains documents from the two previous attempts. These are included for CONTEXT ONLY.

**How to use these references:**
- Read them to understand the problem space and what challenges were encountered
- Note what PROBLEMS they identify (those are real)
- Do NOT adopt their solutions, schemas, or structures
- Treat them the way you would treat a competitor's product teardown — useful for understanding the problem, NOT a template for your design

**What's in the references folder:**
- `attempt-1-ep-table-structure-spec.md` — Complete schema analysis of the first attempt's 14-table, 46-column design. Shows what happens when you put everything in one table and build all layers simultaneously. Read it to understand the full scope of what the system needs to handle, not to adopt the structure.
- `attempt-2-soloway-overview.md` — Brief summary of the second attempt's different approach (fixed hierarchy, read-only-first, Excel-dependent). Shows what happens with the opposite set of trade-offs.

---

**That's everything. Start by reading this entire document and the two reference files. Then begin your research. Ask me questions if anything is unclear — I'd rather clarify upfront than have you make assumptions that send the research in the wrong direction.**
