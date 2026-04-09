# Business Logic Analysis -- ShossyWorks Plan Update

## Summary (5 sentences)

The 5 interaction decisions are directionally strong and reflect genuine understanding of residential construction estimating workflows. However, several critical business logic gaps exist that will cause confusion or rework if not addressed before Phase 1A schema work begins. The snapshot system conflates two distinct construction use cases (named milestones vs. safety saves) into one mechanism, and the "restore from snapshot" workflow during active construction has unaddressed implications for change order tracking. The options system correctly models alternates but has no concept of "additive options" (upgrades that add cost without replacing anything), which is the most common option type in residential construction. Client visibility needs a fourth state beyond visible/hidden/summary_only to handle allowance items where the budget is visible but the cost breakdown is not.

---

## Findings

### Finding 1: Snapshot System Conflates Two Distinct Business Needs

- **Severity:** CRITICAL
- **Category:** Schema / UX
- **Details:** The current snapshot design treats all snapshots identically -- user names them, metadata is auto-tracked. But in residential construction, there are two fundamentally different snapshot use cases:

  **Use Case A: Named Milestones** -- "Pre-VE Snapshot", "Client Approved Version", "Bid Submission", "Contract Price". These are business events. The contractor needs to find them months later and compare against the current state. They need to be prominently visible, possibly tied to project lifecycle transitions (e.g., when project moves from "Bidding" to "Under-Contract", the system should prompt for a snapshot).

  **Use Case B: Safety Saves** -- "Restore from Snapshot" auto-saves the current state first. This creates a snapshot that exists purely as an undo checkpoint, not as a business milestone. If these mix into the same list as milestone snapshots, the list becomes cluttered with "Auto-save before restore (2026-04-08 14:32:17)" entries that have no business meaning.

  **Real scenario:** Zac bids a $450K custom home. He snapshots "Bid Submission". Client comes back with VE requests. He makes changes, snapshots "Post-VE". Client approves. He snapshots "Contract Price". During construction, he restores from "Post-VE" to check something, triggering an auto-save. Now his snapshot list has 4 entries, and the auto-save sits between "Post-VE" and "Contract Price" with no business meaning.

- **Recommendation:** Add a `snapshot_type` column to `estimate_snapshots`: `'milestone'` vs `'checkpoint'`. Milestones are user-named and prominent. Checkpoints are auto-generated and can be hidden by default (expandable section in UI). Consider also adding an optional `lifecycle_event` column (VARCHAR) that links the snapshot to a project status transition -- "Created when project moved to Under-Contract."

- **Dependencies:** Affects estimate_snapshots schema design, snapshot list UI, and the restore-from-snapshot workflow.
- **Effort:** Low (one column addition + UI filtering logic)

---

### Finding 2: Restore-from-Snapshot During Active Construction Has Change Order Implications

- **Severity:** HIGH
- **Category:** Schema / UX
- **Details:** Decision 1 says "Restore from Snapshot" auto-saves current state, then restores. But the decision does not address what happens to the ESTIMATE STATUS when restoring. Consider this scenario:

  A project is in "Active Construction" with an estimate at status "Complete" (the contract price). The contractor wants to restore from the "Pre-VE" snapshot to reference old pricing for a change order calculation. If "Restore from Snapshot" literally replaces the current estimate tree with the old snapshot, the contractor just destroyed the contract price estimate.

  **The real workflow:** During active construction, contractors do NOT want to restore old snapshots as the working estimate. They want to COMPARE -- "show me what the flooring cost in the bid vs. what it costs now." Or they want to use old data as a STARTING POINT for a change order estimate (a new estimate, not replacing the existing one).

  The current design assumes restore is always desirable, but in construction, once a project is under contract, the current estimate is the contract document. Restoring over it would be a data integrity disaster.

- **Recommendation:** Three actions instead of one:
  1. **Compare with Snapshot** -- side-by-side diff view (read-only, no data mutation)
  2. **Restore to Snapshot** -- replaces current tree (only available when estimate status is Draft or Preliminary; blocked or warned when Active/Complete)
  3. **Create Estimate from Snapshot** -- creates a NEW estimate seeded from the snapshot data (for change order pricing, re-bidding, etc.)

  Add a guard: if estimate status is "Active" or "Complete," the restore action should require explicit confirmation with a warning: "This estimate is the active contract price. Restoring will replace it. Are you sure?" Or better: block restore entirely and offer "Create New Estimate from Snapshot" instead.

- **Dependencies:** Affects snapshot restore logic, estimate status guards, and potentially the version system.
- **Effort:** Medium (UI flow changes + status guard logic)

---

### Finding 3: Options System Missing "Additive Options" (Upgrades)

- **Severity:** CRITICAL
- **Category:** Schema
- **Details:** The current options architecture handles two types well:
  - **Replacement options** (inline options): "Tile floors $12K" vs "Hardwood floors $18K" -- swap one subtree for another
  - **Parameter options** (broad options): "Upgraded Insulation Package" changes R-value globally

  But the most common option type in residential custom home construction is missing: **additive options** (upgrades). These are items that ADD to the estimate, not replace anything. Examples:
  - "Add screened porch: +$35,000"
  - "Add whole-house generator: +$12,000"
  - "Upgrade to tankless water heater: +$3,200" (adds $3,200, not replaces the water heater line item)
  - "Add landscape package: +$18,000"

  In the current system, you could model these as inline options where Alternative A is "empty/excluded" and Alternative B is the add-on. But this is awkward -- you need a "null alternative" (an empty subtree representing "do not include this") just to have an option group. Every additive option requires creating an option group, a "None" alternative with zero cost, and an "Add" alternative with the actual items. This is 3x the work for the most common use case.

  **Industry pattern (Buildertrend, CoConstruct):** Additive options are modeled as a toggle -- "include/exclude" -- not as a two-alternative selection. The option is either in the estimate total or not. No "replacement" alternative exists.

- **Recommendation:** Add a `group_type` column to `option_groups`: `'selection'` (pick one of N alternatives -- current behavior) vs `'toggle'` (include/exclude single alternative). For toggle groups, there is exactly one alternative, and `is_selected` acts as include/exclude. The active tree query already handles this correctly -- deselected alternatives are excluded. The only change is UX: toggle options show a checkbox, not a radio button set.

  Alternatively, add a `is_additive BOOLEAN DEFAULT FALSE` to `option_groups`. When true, the group has one "included" alternative and no "excluded" baseline -- deselecting it simply removes those items from the total.

- **Dependencies:** Affects option_groups schema, option creation UI, option set management, and client-facing option display.
- **Effort:** Low (one column + UI toggle pattern)

---

### Finding 4: Client Visibility Needs a Fourth State for Allowances

- **Severity:** HIGH
- **Category:** Schema / UX
- **Details:** Decision 2 defines `client_visibility` as `'visible' | 'hidden' | 'summary_only'`. Decision 4 says clients see estimates filtered by this flag. But neither decision addresses how allowance items should display to clients.

  **The construction business reality:** Allowances are a core concept in custom home contracts. A typical custom home has 20-40 allowance items (plumbing fixtures, lighting, tile, countertops, appliances, etc.). The client contract says "Allowance for lighting fixtures: $8,000." The client needs to see:
  - The allowance budget amount ($8,000)
  - Whether they've made a selection
  - The overage/underage if they've selected

  The client does NOT need to see:
  - The builder's cost for the selection
  - The markup rate
  - The vendor name or wholesale pricing
  - The contingency/overhead breakdown

  This is not "visible" (shows everything), not "hidden" (shows nothing), and not "summary_only" (shows just a rolled-up total). It is "show the budget and status but not the cost breakdown." The current three-state enum does not capture this.

  Additionally, the `summary_only` state is poorly defined. What "summary" does a client see? The total price? The item name + total? The name + quantity + unit price (which reveals the markup)? This needs specification.

- **Recommendation:** Either:
  1. Add a fourth visibility state: `'allowance_view'` -- shows allowance budget, selection status, and overage/underage but hides cost/markup details. Define `summary_only` explicitly as "name + total_price only."
  2. OR: Keep 3 states but add `client_detail_level` as a separate column: `'full' | 'price_only' | 'budget_only'`. This provides finer control. `visible` + `price_only` = shows name and total but not cost breakdown. `visible` + `budget_only` = shows allowance budget only.

  Option 2 is more flexible but adds complexity. Option 1 is simpler and covers the 95% case.

  Also: the `client_visibility` field should be INHERITED by default when nodes are created under a parent. If a parent group is marked hidden, all new children should default to hidden. Currently no inheritance mechanism is specified.

- **Dependencies:** Affects client_visibility enum, client portal rendering logic, RLS policies for client role, and allowance tracking display.
- **Effort:** Low for option 1 (enum change); Medium for option 2 (new column + rendering logic)

---

### Finding 5: Project Status Transitions Need Business Rules, Not "Full Flexibility"

- **Severity:** HIGH
- **Category:** UX / Schema
- **Details:** Decision 1 says "Full flexibility -- any status can transition to any other." This is a red flag. While flexibility is convenient during development, in practice several transitions are business logic errors that should at minimum trigger warnings:

  **Dangerous transitions:**
  - "Active Construction" -> "Lead" -- this undoes a signed contract; should never happen accidentally
  - "Closed" -> "Bidding" -- reopening a closed project for bidding is a new engagement
  - "Under-Contract" -> "In Design" -- if a contract is signed, going back to design means scope changes, which should be tracked as change orders, not a status regression
  - "Warranty Period" -> "Active Construction" -- warranty work is distinct from original scope

  **Transitions that should trigger actions:**
  - ANY status -> "Under-Contract" -- should prompt for a "Contract Price" snapshot
  - "Bidding" -> "Under-Contract" -- should prompt to lock the estimate (status -> "Complete")
  - "Active Construction" -> "Closing Out" -- should prompt for an "As-Built" snapshot
  - "Closing Out" -> "Warranty Period" -- should prompt for a "Final" snapshot

  **Industry practice:** Every construction management platform (Procore, Buildertrend, CoConstruct) restricts at least some transitions and uses them as triggers for required actions (document generation, snapshot creation, notification sending).

- **Recommendation:** Implement as a "soft guardrails" system:
  1. Define a `valid_transitions` map in application logic (not DB constraints -- too rigid for a single-company tool)
  2. "Normal" transitions proceed silently
  3. "Unusual" transitions (e.g., regression from Active Construction to Bidding) show a confirmation dialog
  4. "Milestone" transitions (e.g., -> Under-Contract) trigger prompts: "Create a snapshot of the current estimate?" and "Lock the estimate?"
  5. Store transition history in a `project_status_history` table for audit trail: `(project_id, old_status, new_status, changed_by, changed_at, notes)`

  This preserves flexibility (Zac can do anything) while preventing accidents and capturing business events.

- **Dependencies:** Affects project status management, snapshot prompting logic, and future notification system.
- **Effort:** Medium (transition map + confirmation dialogs + history table)

---

### Finding 6: Catalog "Update from Catalog" Has an Unresolved Merge Conflict Problem

- **Severity:** HIGH
- **Category:** Schema / UX
- **Details:** The data architecture (Section 6.6) defines "Pull from catalog" as: "Update item details from latest catalog version. Preserve qty." But this is an oversimplification of how catalog updates work in practice.

  **Real scenario:** Zac creates a catalog item "Standard Interior Door" at $285/unit. He uses it in 3 active estimates. Then lumber prices rise and he updates the catalog to $315/unit. He also changes the waste factor from 5% to 8% and updates the specifications text.

  When he runs "Update from Catalog" on Estimate A:
  - Unit cost updates from $285 to $315 -- correct, this is why he updated
  - Waste factor updates from 5% to 8% -- correct, reflects new reality
  - Specifications update -- BUT he had customized the specifications on this estimate to include project-specific notes. The catalog update OVERWRITES his customizations.

  The architecture says "preserve qty" but doesn't say WHICH OTHER FIELDS to preserve vs. overwrite. In practice, contractors customize these fields per-estimate:
  - `instructions` -- often project-specific ("install per plan sheet A4.2")
  - `specifications` -- may have project-specific amendments
  - `contingency_rate` -- may be higher for a difficult project
  - `overhead_rate` -- may be adjusted for a project with unusual conditions
  - `vendor_id` -- may be different per project based on vendor availability

  **Industry pattern (STACK, Sage):** Catalog updates show a DIFF view -- "these fields changed in the catalog, which ones do you want to apply?" The user selects which fields to update. This is the only safe pattern.

- **Recommendation:** 
  1. Add `catalog_synced_fields JSONB` to `estimate_nodes` -- tracks which fields were last synced from catalog and their catalog values at sync time. E.g., `{"unit_cost": 285, "waste_factor": 0.05, "specifications": "Grade A..."}`.
  2. "Check for Changes" compares current node values against `catalog_synced_fields` AND the current catalog version. Reports three categories:
     - "Catalog changed, you didn't" -- safe to auto-update
     - "You changed, catalog didn't" -- keep your changes
     - "Both changed" -- show diff, let user choose per field
  3. If this complexity is too much for Phase 1A, at minimum show a confirmation: "These fields will be overwritten: [list]. Your customizations to [instructions, specifications] will be lost. Continue?"

- **Dependencies:** Affects catalog sync logic, catalog_source tracking, and the catalog update UI.
- **Effort:** High (diff/merge logic + per-field tracking)

---

### Finding 7: node_notes Table Needs Snapshot and Client Visibility Integration

- **Severity:** HIGH
- **Category:** Schema
- **Details:** The 2026-04-06 session decided on a `node_notes` table with multiple entries per node, rich text, author tracking, and soft-delete. But the interaction decisions don't address two critical integration points:

  **Snapshot integration:** When a snapshot is taken, do notes get deep-copied? The data architecture's deep-copy function (Section 8.2) copies nodes, details, options, and memberships. It does NOT mention notes. If notes are not copied, a restored snapshot will have nodes with no notes. If notes ARE copied, the snapshot faithfully preserves the state -- but notes created AFTER the snapshot exist only on the current version.

  **Client visibility:** Notes are described as "to self" or "for the record" -- internal builder notes. But what about client-facing notes? The base table has `client_notes TEXT` (a single field). The `node_notes` table creates a richer system for internal notes. Should client-facing notes also use the `node_notes` table with a `is_client_visible BOOLEAN` flag? Or should the single `client_notes` text field suffice?

  **Search integration:** Decision 5 says search should filter nodes by name/description. But notes contain valuable searchable content -- "check with Mike about the beam size" or "client wants to match the Smith project tile." If notes are in a separate table, full-text search must JOIN across `estimate_nodes` AND `node_notes` to be comprehensive.

- **Recommendation:**
  1. **Snapshots:** YES, deep-copy `node_notes` rows during snapshot. Add to the deep_copy_estimate function. Notes are part of the estimate's state at a point in time.
  2. **Client visibility:** Add `is_client_visible BOOLEAN DEFAULT FALSE` to `node_notes`. This replaces the `client_notes` TEXT field on the base table. One system for all notes, with a visibility flag. Simpler than maintaining two parallel note systems.
  3. **Search:** Include `node_notes.content` in the full-text search index. Either via a materialized view that JOINs nodes + notes, or via a tsvector column on node_notes with a separate GIN index.

- **Dependencies:** Affects node_notes schema, deep_copy_estimate function, client portal rendering, and search indexing.
- **Effort:** Medium (schema additions + deep-copy function update + search index)

---

### Finding 8: Estimate Status Enum Is Insufficient for Real Construction Workflows

- **Severity:** MEDIUM
- **Category:** Schema
- **Details:** Decision 1 defines 4 estimate statuses: Draft / Preliminary / Active / Complete. The original data architecture (Section 5.2) had 6: draft / in_review / approved / sent / accepted / archived. Neither set captures the actual lifecycle of a construction estimate:

  **Real lifecycle:**
  1. **Draft** -- actively being built, not ready to show anyone
  2. **Internal Review** -- team members reviewing before sending to client
  3. **Sent to Client** -- shared with client, awaiting response
  4. **Client Approved** -- client has formally approved (creates a contract moment)
  5. **Under Contract** -- the approved estimate is now the contract price
  6. **Superseded** -- a newer version exists; this version is historical
  7. **Voided** -- estimate was sent but is no longer valid (project cancelled, scope changed)

  The 4-status set from Decision 1 (Draft/Preliminary/Active/Complete) conflates "Sent" with "Active" and has no concept of client approval as a distinct state. "Complete" is ambiguous -- does it mean "I finished writing it" or "the project is done"?

  The 6-status set from the original architecture is better but also conflates "approved" (by the team internally) with "accepted" (by the client) and is missing "under contract" and "voided."

- **Recommendation:** Use 6 statuses that map to real business events:
  `'draft' | 'review' | 'sent' | 'approved' | 'contract' | 'archived'`
  - `draft`: being built
  - `review`: ready for internal review
  - `sent`: shared with client (timestamp recorded)
  - `approved`: client has formally approved (creates approval record)
  - `contract`: locked as the contract price (immutable without change order)
  - `archived`: no longer active (voided, superseded, or project complete)

  The transition from `sent` -> `approved` should require an approval record (from Decision 4's `estimate_approvals` table). The transition from `approved` -> `contract` should auto-create a "Contract Price" snapshot.

- **Dependencies:** Affects estimate_status enum, approval workflow, snapshot automation, and immutability enforcement.
- **Effort:** Low (enum change + transition logic)

---

### Finding 9: Cross-Project Search Returns Need Business Context

- **Severity:** MEDIUM
- **Category:** UX / Schema
- **Details:** Decision 5 says search can span all projects. The use case "Find all drywall items across last 5 jobs" is correct but the decision doesn't specify what the search returns or how the results are actionable.

  **What the contractor actually needs from cross-project search:**
  
  When Zac searches "drywall" across 5 projects, he needs:
  - Project name + estimate name (context)
  - Item name + description
  - Quantity + unit (how much was used)
  - Unit cost at time of estimate (what it cost then)
  - Total price
  - Cost code (for grouping)
  - Date of the estimate (for price trending)
  - Whether the estimate was a bid vs. actual (to know if it was a real cost or a guess)

  **Why this matters for future bidding:** Cross-project search is not just "find things" -- it is the primary mechanism for building institutional knowledge. "Our last 3 drywall bids averaged $2.15/SF for material. The current quote is $2.45/SF -- 14% increase. Is that market rate or should we negotiate?" This requires structured search results, not just text matching.

  **Schema implication:** The search index needs to include the estimate's status (was this a contract price or just a draft?) and the project's completion status (was this project actually built, or just bid?). Searching across draft estimates and completed projects in the same result set without distinction is misleading.

- **Recommendation:**
  1. Search results should include `estimate.status` and `project.status` as filterable facets
  2. Add a "cost history" view that aggregates search results by cost code + time period for price trending
  3. Add `bid_type` from `node_item_details` as a search result field -- distinguishes bid/estimate/allowance items
  4. Consider a "search result context" object that includes parent node path (e.g., "General Conditions > Temporary Facilities > Dumpster") for tree context
  5. Full-text search tsvector should weight `name` higher than `description`, and `description` higher than `notes`

- **Dependencies:** Affects search query design, search results API shape, and future cost trending features.
- **Effort:** Medium (search result schema + faceted filtering)

---

### Finding 10: Company Settings Table Missing Critical Construction Business Fields

- **Severity:** MEDIUM
- **Category:** Schema
- **Details:** Decision 3 lists company-level settings as: default markup rates, overhead percentages, tax rates, default UOM, company info. But several critical construction business settings are missing:

  **Missing fields:**
  - **License number** -- required on all proposals/contracts in most states
  - **Insurance certificate info** -- COI number, expiration (clients frequently request)
  - **Default payment terms** -- "Net 30", "50% deposit, balance on completion", etc.
  - **Default warranty terms** -- "1-year workmanship warranty" (standard in residential)
  - **Tax rate by jurisdiction** -- residential construction is often tax-exempt on labor but taxed on materials, and rates vary by jurisdiction
  - **Bonding capacity** -- relevant for larger residential projects
  - **Default proposal/estimate template preferences** -- which detail level, standard cover letter text

  Some of these (license, insurance) are critical for the proposals feature. Others (payment terms, warranty terms) are needed for contract generation. Including them now in the company_settings schema avoids a migration later.

- **Recommendation:** Design `company_settings` as a JSONB column for flexible fields rather than individual columns. The settings change rarely (once at setup, occasional updates). A JSONB object like:
  ```json
  {
    "company_name": "Szostak Build, LLC",
    "license_number": "RBC-12345",
    "default_tax_rate": 0.07,
    "labor_tax_exempt": true,
    "default_payment_terms": "50% deposit, balance on completion",
    "default_warranty_terms": "1-year workmanship, 10-year structural",
    "default_markup_rate": 0.20,
    "default_overhead_rate": 0.10,
    "default_contingency_rate": 0.05
  }
  ```
  This is one of the rare cases where JSONB is appropriate -- the data is read as a whole blob by the application, rarely queried individually, and changes infrequently.

- **Dependencies:** Affects company_settings table design and future proposal generation.
- **Effort:** Low (JSONB column design)

---

### Finding 11: Auto-Demotion Decision Was Reversed But Schema Impact Not Fully Traced

- **Severity:** MEDIUM
- **Category:** Schema / Trigger
- **Details:** The original research (research-node-promotion.md) recommended NO auto-demotion. Then the Addendum (Section 4, Q2) records that Zac overrode this and WANTS auto-demotion. INTENT.md Decision 8 says "auto-promotion/demotion." But the trigger SQL in research-node-promotion.md (Section 12) does NOT include a demotion trigger -- it only has the promotion trigger.

  The Addendum describes the demotion trigger logic but does not provide SQL. This means the Phase 1A migration will need to write the demotion trigger from scratch, and it has several edge cases:

  1. **What fires the trigger?** DELETE of a child node AND UPDATE of parent_id (child moved away). Both paths must be covered.
  2. **How to check "all children removed"?** The trigger fires AFTER the DELETE/UPDATE, so it must count remaining children of the old parent.
  3. **Assembly demotion?** If a group was manually converted to assembly (with assembly_details row), then had all children removed, does auto-demotion destroy the assembly_details row? The Addendum only discusses group->item demotion, not assembly->item.
  4. **Race condition:** In real-time collaborative editing, two users simultaneously remove the last two children. Both triggers fire. Both see zero remaining children. Both try to demote. Need idempotency guard.

- **Recommendation:** 
  1. Write explicit demotion trigger SQL during Phase 1A planning (not implementation -- planning)
  2. Clarify: does auto-demotion apply to assemblies, or only to groups that were auto-promoted? Recommendation: only auto-demote nodes that were auto-promoted (track this with a `was_auto_promoted BOOLEAN DEFAULT FALSE` on estimate_nodes). Manually-created groups and assemblies should never auto-demote.
  3. Add idempotency: the demotion trigger should check `node_type != 'item'` before attempting demotion, making it safe for concurrent execution.

- **Dependencies:** Affects estimate_nodes schema (potential new column), trigger SQL, and collaborative editing conflict handling.
- **Effort:** Medium (trigger design + edge case handling)

---

### Finding 12: Option Sets Are Scenario Comparison, Not Just "Saved Selections"

- **Severity:** MEDIUM
- **Category:** UX / Schema
- **Details:** The data architecture describes option sets as "saved combinations of option selections" for instant switching. But in residential construction, option sets serve a specific business purpose: they are the **client presentation tool**. 

  **Real workflow:** The contractor builds an estimate with inline options (tile vs. hardwood, standard vs. premium kitchen, etc.) and additive options (screened porch, generator, landscape). Then they create option sets that represent client pricing scenarios:

  - "Base Price" -- all standard selections, no add-ons = $420,000
  - "Mid-Range" -- some upgrades, some add-ons = $475,000
  - "Premium" -- all upgrades, all add-ons = $550,000

  These scenarios are what get presented to the client in a proposal. The client needs to see them side-by-side with a clear breakdown of what's included in each and what the price difference is.

  **Missing in current design:**
  1. No way to attach option sets to proposals (the proposals table references `option_set_id`, but the option set doesn't know it's being presented to a client)
  2. No "price delta" tracking between scenarios -- the client cares about "how much more for Premium vs. Base?" not just absolute prices
  3. No mechanism for the client to select a scenario and approve it (Decision 4's approval system applies to estimates, but what the client really approves is a scenario/option set)

- **Recommendation:**
  1. Add `client_visible BOOLEAN DEFAULT FALSE` to `option_sets` -- controls whether this scenario is included in client proposals
  2. The approval workflow (Decision 4) should be able to target an option set, not just an estimate. When a client "approves," they're approving a specific scenario.
  3. Price comparison view should show delta from base scenario, not just absolute prices
  4. Consider adding `option_sets.total_price DECIMAL(15,4)` as a cached/computed column for fast comparison without recalculating the full tree per scenario

- **Dependencies:** Affects option_sets schema, proposal rendering, approval workflow, and client experience.
- **Effort:** Medium (schema additions + approval flow modification)

---

## Recommendations for Plan Update

### Phase 1A Schema Additions (in priority order)

1. **Add `snapshot_type VARCHAR(20)` to estimate_snapshots** -- 'milestone' vs 'checkpoint'. Trivial change now, painful migration later.

2. **Add `group_type VARCHAR(20) DEFAULT 'selection'` to option_groups** -- 'selection' vs 'toggle'. Enables additive options without schema migration.

3. **Add `is_client_visible BOOLEAN DEFAULT FALSE` to node_notes** -- replaces the need for dual note systems (internal + client_notes text field). Remove `client_notes` from estimate_nodes base table.

4. **Add `was_auto_promoted BOOLEAN DEFAULT FALSE` to estimate_nodes** -- tracks which nodes were auto-promoted so auto-demotion only applies to them. Prevents destroying manually-created groups.

5. **Include node_notes in deep_copy_estimate function** -- notes are part of estimate state; snapshots without notes are incomplete.

6. **Design company_settings as single-row JSONB** -- flexible enough for all business settings without per-field columns.

### Phase 1A Trigger Additions

7. **Write the auto-demotion trigger** with the following specifications:
   - Fires on DELETE from estimate_nodes AND UPDATE of parent_id
   - Only demotes nodes where `was_auto_promoted = TRUE`
   - Checks remaining child count of the affected parent
   - Includes idempotency guard (`node_type != 'item'` check)
   - Handles the assembly edge case (do NOT auto-demote assemblies)

### Phase 1A Business Logic Guards

8. **Add status transition guards** for estimate status changes:
   - Block restore-from-snapshot when estimate status is 'contract' without explicit confirmation
   - Prompt for snapshot on project status transitions to 'under_contract' and 'closing_out'

### Phase 1B+ Additions

9. **Catalog field-level sync tracking** -- at minimum show which fields will be overwritten on "Update from Catalog". Full diff/merge can be deferred, but the confirmation dialog is essential.

10. **Cross-project search result context** -- include estimate status, project status, parent path, and bid_type in search results for actionable intelligence.

11. **Option set approval workflow** -- approvals target option sets (scenarios), not just estimates.

---

## Questions for Other Board Members

### For Schema & Trigger Analyst
- Does the `was_auto_promoted` flag on estimate_nodes create any issues with the existing promotion trigger? The trigger would need to SET this flag during promotion.
- How should the demotion trigger interact with the `node_option_memberships` cleanup? When a group is demoted back to an item, should its option memberships be preserved or cleared?

### For Security & Access Control Analyst
- The `is_client_visible` flag on `node_notes` introduces a new RLS surface. How should the client role policy handle notes? Should clients see ALL notes flagged as visible, or only notes on nodes that are themselves visible?
- Allowance items with `client_visibility = 'allowance_view'` (if added) need special RLS rules that expose `allowance_budget` and `allowance_status` but hide `unit_cost`, `contingency_rate`, and `overhead_rate`. Can this be done with column-level security in Supabase, or does it require a VIEW?

### For Performance & Scalability Analyst
- Cross-project search with full-text indexing across `estimate_nodes` + `node_notes` + `node_item_details` -- what's the indexing strategy? Separate GIN indexes per table, or a materialized view that combines them?
- Option set comparison requires recalculating the full tree per scenario. For 5 scenarios x 500 nodes, is this fast enough client-side, or should scenario totals be cached server-side?

### For Code Quality Analyst
- The deep_copy_estimate function grows with every new table (now: nodes, details, options, memberships, notes). Is there a pattern for making this extensible so new tables don't require function rewrites? Perhaps a registry of "tables to deep-copy" that the function iterates?
