# ShossyWorks -- Design Intent

> Baseline established: 2026-04-02 (research session).
> Maintained by finish-session agents going forward.

## Project Vision

A construction estimating platform for Szostak Build, LLC. Single-company, multi-user. The tool that makes estimating, managing, and presenting construction projects seamless -- from rough line items to polished client proposals. This is a personal business tool, not a SaaS product.

Key differentiators over existing tools (ProEst, Sage, STACK):
- Three-layer options system with full subtree swapping (not just cost adjustments)
- Iterative workflow with auto-promotion/demotion (Tab to indent promotes items to groups)
- Real-time multi-user collaboration (Google Sheets feel) from day one
- Full version recall with deep-copy snapshots and trigger-based history

## Design Principles

1. **Bottom-up stability.** Each layer must be provably correct before anything is built on top of it. Tree before calculations. Calculations before catalog. Catalog before options. Lessons from two failed attempts that built all layers simultaneously.

2. **Database enforces invariants.** If a rule must never be violated, encode it in constraints, triggers, or CHECK clauses -- not application code. Application code has bugs. Database constraints do not.

3. **Single-company, multi-user.** One company, multiple users (owner, employees, clients), no multi-tenancy. Every architectural decision should be evaluated against "does a single-company tool need this?"

4. **Estimates own their data.** Copy-on-instantiate from catalog. No live references that could silently change approved estimates. The catalog is a template library; estimates are independent documents.

5. **Isomorphic calculations.** The same calculation logic runs client-side (for instant feedback) and server-side (for validation on save). One TypeScript module, imported by both. No drift possible.

6. **Schema clarity over storage optimization.** Every column on a table should be relevant to every row in that table. No 36-column NULL density. If a column only applies to items, it goes on the items detail table.

## Key Decisions

Decisions made during the 2026-04-02 research session. Never remove a decision -- supersede with a new numbered entry if reasoning changes.

1. **Hybrid base+detail tables (not monolithic).** Shared tree fields on `estimate_nodes` base table; type-specific fields on `node_item_details` and `node_assembly_details`. Eliminates NULL density of the old 46-column monolithic table. Trade-off: JOINs required for full node data.

2. **Adjacency list + ltree (not closure table).** Self-referencing `parent_id` for O(1) re-parenting; trigger-maintained `ltree` path column for GiST-indexed subtree queries. Closure table rejected as overkill for 200-1,000 node trees.

3. **Three node types: group, assembly, item.** Merged the old category/section distinction into a single "group" type. Groups are pure SUM containers. Assemblies have quantity/unit and ratio-based children. Items are leaf nodes with cost data.

4. **Junction table for options (not column stamping).** `node_option_memberships` junction table instead of `option_alternative_id` column on nodes. One extra JOIN but future-proof for nested options without schema migration.

5. **math.js for formulas (not expr-eval).** expr-eval has CVE-2025-12735 and abandoned maintenance. math.js is actively maintained, supports the expression complexity needed, and runs isomorphically.

6. **Phases as classification (not structural).** Phases are tags on items enabling grouped views, not structural tree levels. A single category can span multiple phases; a phase can cut across categories. Avoids rigid hierarchy.

7. **Deep-copy version snapshots + trigger-based history.** Versions are full deep copies of the estimate tree (immutable once created). Field-level change history tracked via triggers for audit trail. Supports rollback and diff comparison.

8. **Auto-promotion/demotion for iterative workflow.** Indenting a node under an item auto-promotes the item to a group (trigger-based). Removing the last child auto-demotes back to item. Item details are archived (soft-delete), not destroyed. This is a genuine differentiator -- no existing estimating tool supports this natively.

9. **Supabase Realtime for collaboration (broadcast + presence).** One channel per open estimate. Broadcast for edit propagation (6ms p50 latency). Presence for user awareness. Conflict resolution: presence-guided last-writer-wins (matches Google Sheets). Yjs/Liveblocks/CRDTs rejected as wrong abstraction for structured data.

10. **Structured cost codes (CSI MasterFormat).** FK to a `cost_codes` table, not free-text. Prevents "sqft" vs "SF" drift. Enables consistent reporting and industry-standard classification.

11. **First-class allowance tracking.** `allowance_budget` and `allowance_status` on item details. Allowances are a core construction concept (budget placeholder until client selects specific materials), not an afterthought.

12. **PIN auth as session unlock (deferred).** 6-digit PIN for fast daily login on trusted devices. Not a replacement for Supabase Auth -- just a session unlock mechanism. Deferred until core estimating works.

13. **useReducer state pattern from Phase 1B.** Required for handling two mutation sources (local edits + remote broadcasts) cleanly. Designing this in from the start avoids a painful retrofit.

14. **DECIMAL(15,4) for calculated totals.** Round to 2dp only at display time. Prevents rounding drift in intermediate calculations across deep assembly nesting.

## Trade-offs

| Decision | Cost | Benefit |
|----------|------|---------|
| 32 tables (hybrid model) | More JOINs for full node data | Zero NULL density, clear schema ownership |
| Junction table for options | One extra JOIN per option query | Future-proof for nested options, no schema migration |
| Auto-promotion triggers | More trigger complexity, archived detail rows | Seamless iterative workflow, unique differentiator |
| Real-time from Phase 1B | Slight upfront design cost (useReducer, channel hooks) | Avoids painful retrofit, collaboration from day one |
| Deep-copy version snapshots | Storage growth per snapshot | True immutability, reliable rollback, simple diff |

## Constraints

- **Stack:** Next.js + Supabase + Vercel + TypeScript + Tailwind CSS
- **Company:** Szostak Build, LLC (single company, not multi-tenant)
- **Users:** Owner (Zac) + employees + per-project clients
- **Real-time:** Must support concurrent multi-user editing from Phase 1B
- **Security:** No hardcoded secrets; all credentials via Azure Key Vault
- **Context:** Claude Code is the sole developer; specs must stay concise

## Future Considerations

Items identified but explicitly deferred. Not committed to, not designed for, but acknowledged:
- Named preset formulas (reusable formula templates for common calculations)
- Nested options (options within options -- junction table already supports this)
- Advanced vendor management (POs, RFPs, COI tracking, vendor ratings/CRM)
- Offline support / reconnection handling for real-time collaboration
- PDF export for proposals, purchase orders, RFPs
- Comment threads on estimate nodes
- Advanced role permissions (differentiated employee access levels)
