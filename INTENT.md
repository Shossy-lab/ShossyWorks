# ShossyWorks -- Design Intent

> Baseline established: 2026-04-02 (research session).
> Major update: 2026-04-08 (5 interaction decisions + deep planning).
> Maintained by finish-session agents going forward.

## Project Vision

A construction estimating platform for Szostak Build, LLC. Single-company, multi-user. The tool that makes estimating, managing, and presenting construction projects seamless -- from rough line items to polished client proposals. This is a personal business tool, not a SaaS product.

Key differentiators over existing tools (ProEst, Sage, STACK):
- Three-layer options system with full subtree swapping AND additive toggle options
- Iterative workflow with auto-promotion/demotion (Tab to indent promotes items to groups)
- Real-time multi-user collaboration (Google Sheets feel) from day one
- Named estimate snapshots with restore capability (compare "what we bid" vs "what we built")
- PIN-protected client sharing with three-level visibility (visible/hidden/summary-only)
- 10-stage project lifecycle mirroring real construction phases
- Adjustable-scope full-text search across estimates, projects, or globally

## Design Principles

1. **Bottom-up stability.** Each layer must be provably correct before anything is built on top of it. Tree before calculations. Calculations before catalog. Catalog before options. Lessons from two failed attempts that built all layers simultaneously.

2. **Database enforces invariants.** If a rule must never be violated, encode it in constraints, triggers, or CHECK clauses -- not application code. Application code has bugs. Database constraints do not.

3. **Single-company, multi-user.** One company, multiple users (owner, employees, clients), no multi-tenancy. Every architectural decision should be evaluated against "does a single-company tool need this?"

4. **Estimates own their data.** Copy-on-instantiate from catalog. No live references that could silently change approved estimates. The catalog is a template library; estimates are independent documents.

5. **Isomorphic calculations.** The same calculation logic runs client-side (for instant feedback) and server-side (for validation on save). One TypeScript module, imported by both. No drift possible.

6. **Schema clarity over storage optimization.** Every column on a table should be relevant to every row in that table. No 36-column NULL density. If a column only applies to items, it goes on the items detail table.

## Key Decisions

Decisions from 2026-04-02 research session and 2026-04-08 interaction decisions. Never remove a decision -- supersede with a new numbered entry if reasoning changes.

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

15. **10-stage project lifecycle (2026-04-08).** Lead / In Design / Bidding / Under-Contract / Value-Engineering / Active Construction / Closing Out / Warranty Period / Closed / Archived. Full flexibility -- any status can transition to any other. Implemented as CREATE TYPE enum (not CHECK constraint) for type safety and storage efficiency. Application-level soft guardrails warn on unusual transitions.

16. **4-stage estimate lifecycle with named snapshots (2026-04-08).** Draft / Preliminary / Active / Complete. Snapshots are JSONB-serialized frozen copies of the full estimate tree, distinct from versions (which are living deep-copies). Snapshot types: 'milestone' (user-created, permanent) vs 'checkpoint' (system-created before destructive operations). Restore auto-saves a checkpoint first. Restore blocked on Complete estimates (must use "Create Estimate from Snapshot" instead). Supersedes Decision 7 for snapshots (versions remain deep-copy for working copies).

17. **Three-level client visibility (2026-04-08).** `client_visibility VARCHAR(20)` with values: 'visible' (client sees everything), 'hidden' (client cannot see node at all), 'summary_only' (client sees name + total price but not detailed breakdown). NOT a boolean. Enforced via RLS on detail tables -- clients cannot access `node_item_details` or `node_assembly_details` for summary_only nodes. Notes have independent `is_client_visible` flag.

18. **PIN-protected share links for client access (2026-04-08).** Two sharing methods: account-based (client role login) and share link + 6-digit PIN (no account needed). PIN stored as bcrypt hash. 5-attempt lockout per link per IP, 30-minute cooldown. Server-side API route with admin client -- share link auth never touches RLS/PostgREST. Token is `crypto.randomBytes(32)`, not UUID.

19. **Options system with selection AND toggle types (2026-04-08).** `group_type` column on `option_groups`: 'selection' (mutually exclusive alternatives) vs 'toggle' (additive on/off). Option sets save complete scenario configurations for client comparison. Approval workflow targets option sets (scenarios), not raw estimates. Total prices computed on-demand, not cached.

20. **Catalog as template library with copy-on-insert (2026-04-08).** "Add to Catalog" saves any node/group/assembly as reusable template. "Insert from Catalog" creates an independent copy (matches Decision 4 principle). "Update from Catalog" is a future feature requiring per-field diff/merge -- NOT blind overwrite. Catalog tables in Phase 1A schema, feature UI in Phase 1B.

21. **User preferences vs company settings separation (2026-04-08).** User-level: UI state, estimate view settings, favorites, recently used items. Company-level: default markup/overhead/contingency/tax rates, company info, license/insurance. Company settings use hybrid normalized+JSONB (rates as columns for database-level validation, informational fields as JSONB). No named view presets -- app remembers last-used settings per estimate.

22. **Adjustable-scope full-text search (2026-04-08).** tsvector GENERATED column on estimate_nodes with GIN index. User selects scope: current estimate (default, uses ILIKE for small scope), current project, or global (uses tsvector for performance). Filters: node type, cost code, phase, cost range, flagged status. Jump-to shortcuts for common queries. GIN index built in Phase 1A, search UI in Phase 1B.

23. **JSONB snapshot storage over deep-copy tables (2026-04-08, deep planning).** Snapshots stored as JSONB blobs in `estimate_snapshots`, NOT deep-copied into production tables. Reasons: JSONB prevents snapshot data from polluting working tables, guarantees immutability via trigger (no UPDATE/DELETE), simplifies schema (one table vs duplicated production tables), includes schema_version for forward compatibility. Deep-copy remains for the version system (living working copies).

24. **RLS on every table from day one (2026-04-08, deep planning).** Every CREATE TABLE includes `ENABLE ROW LEVEL SECURITY` and at least one policy in the same migration. No exceptions, no "we'll add security later." `get_user_role()` SECURITY DEFINER helper extracts role from JWT. `is_staff()` convenience function for owner/employee checks. Client-role policies deferred to the migration that creates `client_project_access` table (avoids forward FK references).

25. **user_roles merged into user_profiles (2026-04-08, deep planning).** Single table for user identity: role, display_name, email. Eliminates a JOIN and consistency risk. Migration split into two steps: create user_profiles + migrate, then drop user_roles only after confirming success. `custom_access_token_hook` and `handle_new_user` updated to reference user_profiles.

26. **Node notes as separate table with soft-delete (2026-04-06, weekend session).** `node_notes` table replaces `notes TEXT` and `client_notes TEXT` columns on estimate_nodes. Multiple notes per node, rich text (markdown), independent `is_client_visible` flag, `is_internal` flag, soft-delete via `deleted_at`. Included in snapshot serialization. Author/timestamp tracked.

27. **Trigger bypass via SET LOCAL for bulk operations (2026-04-08, deep planning).** `SET LOCAL app.is_snapshot_copy = 'true'` within a transaction skips history logging, path maintenance, auto-promotion/demotion, and option inheritance triggers during deep-copy and snapshot restore. `updated_at` and `prevent_item_with_children` triggers remain active. Scoped to transaction -- auto-clears on commit/rollback.

## Trade-offs

| Decision | Cost | Benefit |
|----------|------|---------|
| 35+ tables (hybrid model) | More JOINs for full node data | Zero NULL density, clear schema ownership |
| Junction table for options | One extra JOIN per option query | Future-proof for nested options, no schema migration |
| Auto-promotion triggers | More trigger complexity, archived detail rows | Seamless iterative workflow, unique differentiator |
| Real-time from Phase 1B | Slight upfront design cost (useReducer, channel hooks) | Avoids painful retrofit, collaboration from day one |
| Deep-copy for versions, JSONB for snapshots | Two storage mechanisms for similar concepts | Versions stay editable; snapshots stay immutable. Clear separation. |
| 10-stage project lifecycle | More enum values to manage | Mirrors real construction phases, no awkward mappings |
| Three-level client visibility | RLS complexity (views, detail table policies) | Granular control matches how estimates are actually shared |
| PIN-protected share links | Separate auth flow, rate limiting logic | Clients can access without accounts, fast sharing |
| Schema-first approach (Phase 1A) | 6-7 sessions before any UI | Rock-solid data foundation prevents cascading bugs |
| RLS on every table from day one | Migration complexity, more SQL per table | Zero security gaps, no retroactive policy patching |
| Trigger bypass for bulk ops | Additional complexity in copy/restore functions | 100x faster deep-copy, no spurious history records |

## Constraints

- **Stack:** Next.js 16 + Supabase + Vercel + TypeScript (strict) + Tailwind CSS v4
- **Company:** Szostak Build, LLC (single company, not multi-tenant)
- **Users:** Owner (Zac) + employees + per-project clients + pending (unapproved signups)
- **Real-time:** Must support concurrent multi-user editing from Phase 1B
- **Security:** No hardcoded secrets; all credentials via Azure Key Vault. RLS on every table. `pending` role blocked from all app data.
- **Context:** Claude Code is the sole developer; specs must stay concise
- **Design system:** CSS custom property tokens, zero hardcoded styles, sharp corners on rectangles, pill shapes on buttons. See DESIGN-SYSTEM.md.
- **Estimates at scale:** Must handle 500-2,000 nodes per estimate efficiently. Deep-copy < 500ms for 1,000 nodes.

## Phase Roadmap

| Phase | Focus | Status | Sessions |
|-------|-------|--------|----------|
| 0 | Scaffold, auth, app shell, deploy | COMPLETE | 2 |
| H1-H4 | Security hardening (37 review findings) | COMPLETE | 1 |
| 1A | Database schema, triggers, types, actions, tests | NEXT | 6-7 |
| 1B | Snapshot UI, Catalog, Options UI, Client Portal, Search, Settings | Planned | 11-16 |
| 2A | Calculation engine (formula parser, subtotals, rollup) | Planned | 3-4 |
| 2B | Reporting & exports (CSV, Excel) | Planned | 2-3 |
| 2C | PDF generation (branded proposals) | Planned | 1-2 |
| 2D | Design integration (Figma, component library) | Planned | 2-3 |
| 2E | Mobile/tablet optimization | Planned | 1-2 |

## Future Considerations

Items identified but explicitly deferred. Not committed to, not designed for, but acknowledged:
- Named preset formulas (reusable formula templates for common calculations)
- Nested options (options within options -- junction table already supports this)
- Advanced vendor management (POs, RFPs, COI tracking, vendor ratings/CRM)
- Offline support / reconnection handling for real-time collaboration
- PDF export for proposals, purchase orders, RFPs
- `allowance_view` as 4th client_visibility state (if summary_only proves insufficient)
- Project status transition soft guardrails (warnings on unusual transitions)
- Status history table for audit trail
- History table partitioning and retention cron job
- Advanced role permissions (differentiated employee access levels)
- Materialized view for active tree (sub-1ms loads at scale)
- Dark mode support
- Rate limiting on auth endpoints (needs Upstash Redis or equivalent)
