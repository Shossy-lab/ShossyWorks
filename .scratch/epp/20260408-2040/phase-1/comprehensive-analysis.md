# Comprehensive Analysis -- ShossyWorks Plan Update

## Executive Summary

Five specialist analysts (Architecture, Security, Performance, Quality, Business Logic) independently reviewed the 5 interaction decisions against the existing codebase, data architecture, and implementation plan. The analysis reveals 4 CRITICAL findings with unanimous or near-unanimous consensus: (1) the snapshot system requires a separate storage model from the version system, with JSONB serialization as the clear winner over deep-copy; (2) no RLS policies exist on any application table, making every new table exposed via PostgREST the moment it is created; (3) the `client_visibility` field has a documented conflict between a 3-value VARCHAR and a simple boolean, with all analysts agreeing the 3-value approach must prevail; (4) the deep-copy/snapshot function is the highest-risk single operation in the system, touching 10-12 tables with FK remapping in a single atomic transaction. Beyond these, 8 HIGH-severity findings cover missing tables, enum strategy conflicts, testing infrastructure gaps, business logic gaps in the options system, and the need for a security foundation (RLS helpers, role enforcement) before any application tables are created. The plan's "2-3 session" estimate for Phase 1A is unanimously considered insufficient -- all analysts converge on 4-5 sessions minimum.

---

## Consensus Findings

Findings confirmed by 2+ analysts, sorted by severity then consensus count.

| # | Finding | Severity | Confirmed By | Resolution |
|---|---------|----------|--------------|------------|
| C1 | Snapshots vs Versions are distinct concepts requiring separate storage | CRITICAL | Architecture, Security, Performance, Quality, Business Logic (5/5) | Create `estimate_snapshots` table with JSONB serialization (not deep-copy into production tables). Keep version system (deep-copy via `version_group_id`) separate. Include `schema_version` in JSONB for future migration. |
| C2 | No RLS policies on any application table -- all new tables exposed via PostgREST `anon` key | CRITICAL | Security, Quality (2/5, but blocking severity) | Every migration MUST include `ENABLE ROW LEVEL SECURITY` + at least one policy per table. Create `get_user_role()` SECURITY DEFINER helper as the first Phase 1A migration. Add verification script to enforce this gate. |
| C3 | `client_visibility` field conflict: boolean (Decision 2) vs 3-value VARCHAR (data architecture) | CRITICAL | Architecture, Security, Performance, Quality, Business Logic (5/5) | Use the 3-value `client_visibility VARCHAR(20)` CHECK ('visible','hidden','summary_only'). The boolean was a conversational simplification. Add TypeScript convenience mapping `clientVisible = client_visibility !== 'hidden'`. Business Logic analyst additionally proposes a 4th value 'allowance_view' -- defer to research phase. |
| C4 | `deep_copy_estimate()` / snapshot functions are the highest-risk operations in the system | CRITICAL | Architecture, Performance, Quality, Business Logic (4/5) | Must handle 10-12 tables with FK remapping in a single transaction. Use temp-table-based ID mapping (not row-by-row). Disable/bypass triggers during copy (history, path maintenance, option inheritance). Benchmark target: <500ms for 1,000 nodes. Requires 15+ dedicated test cases. |
| C5 | `pending` role has no access restrictions -- middleware and layout check user existence only | CRITICAL | Security (1/5, but trivially verifiable and blocking) | Add role check to middleware: extract `user.app_metadata?.user_role`, redirect `pending` to `/pending-approval` page. Add same check in protected layout as defense-in-depth. |
| C6 | New tables not in original data architecture doc need Phase 1A schema definitions | HIGH | Architecture, Security, Quality, Business Logic (4/5) | Tables needed: `estimate_snapshots`, `node_notes`, `user_preferences`, `estimate_view_state` (or `user_estimate_preferences`), `company_settings`, `estimate_shares`, `estimate_comments`, `estimate_approvals`. Create schema for ALL in Phase 1A even if features ship later. |
| C7 | Enum strategy for project/estimate statuses needs resolution before migration | HIGH | Architecture, Quality (2/5) | **Disagreement exists** -- Architecture recommends CREATE TYPE enums (matching `app_role` pattern); Quality recommends CHECK constraints (more flexible). Business Logic proposes expanding estimate statuses from 4 to 6. See Key Decisions Needed #1. |
| C8 | `column_config` and `view_settings` on `estimates` table are redundant with per-user view state | HIGH | Architecture, Performance, Quality (3/5) | Remove `column_config JSONB` and `view_settings JSONB` from `estimates`. Replace with per-user-per-estimate `estimate_view_state` table (composite PK on `user_id, estimate_id`, JSONB `view_state`). |
| C9 | Testing infrastructure is missing entirely for database tests | HIGH | Quality (1/5, but blocking for verification) | Need: database connection helpers, transaction isolation, seed data factories, role-switching helpers, cleanup utilities. Plan's "12+ trigger tests, 10+ constraint tests" estimate is ~5x too low -- Quality analyst identifies 114 test cases minimum. |
| C10 | `node_notes` table has no schema definition in any document despite being referenced in plan | HIGH | Architecture, Quality, Business Logic (3/5) | Design: `id UUID PK`, `node_id UUID FK`, `body TEXT`, `format VARCHAR(20)`, `is_internal BOOLEAN DEFAULT TRUE` (replaces `client_notes` on base table), `deleted_at TIMESTAMPTZ` (soft-delete), `created_by UUID FK`, `created_at`, `updated_at`. Must be included in snapshot serialization. |
| C11 | `flagged` / `highlight` column missing from `estimate_nodes` | HIGH | Architecture, Performance (2/5) | Add `flagged BOOLEAN NOT NULL DEFAULT FALSE` to `estimate_nodes`. Add partial index `WHERE flagged = TRUE` for filtered queries. Consider `flag_color VARCHAR(7)` for multiple flag types. |
| C12 | Snapshot immutability has no database-level enforcement | HIGH | Security, Architecture (2/5) | For JSONB approach: RLS `FOR SELECT ONLY` on `estimate_snapshots` for all roles; INSERT only via service_role/server action. Add trigger `BEFORE UPDATE OR DELETE ON estimate_snapshots` that raises exception. |
| C13 | Share link PIN system requires aggressive rate limiting beyond standard auth patterns | HIGH | Security (1/5, but specialized domain) | bcrypt cost 12, 5 failed attempts per share link per IP -> 30-min lockout, global 20 attempts/hour/IP across all share links. Token must be `crypto.randomBytes(32)`, not UUID. Use server-side API route with admin client -- never expose share link auth to RLS/PostgREST. |
| C14 | Full-text search needs stored tsvector column, not expression index | MEDIUM | Performance, Quality (2/5) | Add `search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', name || ' ' || COALESCE(description, ''))) STORED` to `estimate_nodes`. Create GIN index on stored column. Defer GIN index creation to Phase 1B if desired (pure write overhead with no read benefit in 1A). |
| C15 | Migration ordering needs restructuring from 4 to 8-10 focused migrations | MEDIUM | Architecture, Security (2/5) | Split: (1) Extensions + Enums, (2) Core tables, (3) Supporting tables, (4) Catalog + Options + Vendors, (5) Client/Sharing tables, (6) Triggers, (7) History tables, (8) Indexes + RLS, (9) Seed data, (10) Functions. Every migration independently testable and rollback-safe. |
| C16 | Server action organization will not scale -- plan lists ~9 but actual count is 30+ | MEDIUM | Quality (1/5, but structural) | Organize by entity in `src/lib/actions/`: `projects.ts`, `estimates.ts`, `nodes.ts`, `catalog.ts`, `options.ts`, `sharing.ts`, `comments.ts`, `preferences.ts`, `search.ts`. Each returns `ActionResult<T>` with error codes. |
| C17 | History table growth from triggers is a long-term concern | MEDIUM | Performance (1/5) | Do NOT log INSERT operations. Add indexes on `(original_node_id, changed_at DESC)` and `(estimate_id, changed_at DESC)`. Add trigger bypass for snapshot copies (`SET LOCAL app.is_snapshot_copy = 'true'`). Implement 1-year retention policy. |
| C18 | Option anti-join query (`NOT EXISTS` for active tree) should be benchmarked/optimized | MEDIUM | Performance (1/5) | Add indexes: `(node_id)` and `(option_alternative_id)` on `node_option_memberships`. Consider LEFT JOIN IS NULL rewrite. For option set preview: pass deselected alternative IDs as parameter array, avoiding the JOIN entirely. |
| C19 | Phase 1A duration estimate of "2-3 sessions" is insufficient | HIGH | Architecture, Quality, Business Logic (3/5) | Consensus: 4-5 sessions minimum. Architecture estimates 3-4; Quality estimates 5; Business Logic implicitly aligns with 4+. The 114 test cases, 30+ server actions, snapshot functions, and comprehensive validation schemas demand more time. |

---

## Topic Clusters for Research

### Cluster 1: Snapshot Architecture and Lifecycle
- **Related findings:** C1, C4, C12, BL-1, BL-2
- **Research questions:**
  1. What is the exact JSONB schema for snapshot serialization? Which tables/fields are included?
  2. How does `schema_version` in JSONB handle forward/backward compatibility when columns are added?
  3. Should snapshots be typed as 'milestone' vs 'checkpoint' (auto-save)? What UI implications does this have?
  4. What are the exact guards for "Restore from Snapshot" based on estimate status? (Block when Active/Complete, or just warn?)
  5. Should "Create Estimate from Snapshot" be a distinct action from "Restore"?
  6. How does the JSONB approach interact with the existing version system (deep-copy via `version_group_id`)? Are both needed?
- **Why this cluster matters:** Snapshots are the single most complex new feature. Getting the storage model, serialization schema, and restore workflow wrong creates data integrity risks that compound across every other feature.

### Cluster 2: RLS and Authorization Architecture
- **Related findings:** C2, C5, C13, S-4, S-6, S-7, S-8, S-9
- **Research questions:**
  1. What is the exact signature and implementation of `get_user_role()` SECURITY DEFINER helper?
  2. Should `user_roles` be consolidated into `user_profiles` (cleaner model) or kept separate (less migration risk)?
  3. What is the complete RLS policy set for each Phase 1A table? (Full matrix: owner/employee/client/pending/anon x CRUD)
  4. How does the share link system bypass RLS safely? (Server-side API route with admin client -- confirm architecture)
  5. Should `summary_only` enforcement happen via RLS (blocking detail table access) or a PostgreSQL VIEW?
  6. How should the trigger bypass mechanism (`app.is_snapshot_copy`) be secured so only `deep_copy_estimate()` can set it?
- **Why this cluster matters:** Without correct RLS from day one, every table is an open data breach via the public `anon` key. The share link system introduces unauthenticated access patterns that must be isolated from the standard auth model.

### Cluster 3: Client Visibility and Filtering
- **Related findings:** C3, S-4, P-6, BL-4
- **Research questions:**
  1. Resolve the 3-value vs 4-value question: is 'allowance_view' needed as a fourth client visibility state?
  2. What exact fields does a client see for each visibility state? (visible: all; summary_only: name+total only; hidden: nothing; allowance_view: budget+status only?)
  3. Should `client_visibility` inheritance be automatic (child inherits parent's visibility on creation)?
  4. What is the RLS policy for `node_item_details` and `node_assembly_details` when the parent node is `summary_only`?
  5. How should `node_notes` integrate with client visibility? (Separate `is_client_visible` flag on notes vs inheriting from parent node)
- **Why this cluster matters:** Client visibility crosses security (RLS), business logic (what estimators actually need), and UX (what clients see). Getting the field definition wrong means either data leakage or insufficient client interaction capability.

### Cluster 4: Options System Completeness
- **Related findings:** BL-3, BL-12, P-4, P-8
- **Research questions:**
  1. Should additive options ('toggle' type) be added to `option_groups` now, or deferred? What is the schema change?
  2. Does the existing `option_items` mention in Decision 2 overlap with `node_option_memberships`? Clarify naming.
  3. How does option set comparison work at the application level? Fetch tree once, filter in TypeScript per scenario?
  4. Should `option_sets.total_price` be a cached/computed column for fast comparison?
  5. Should the approval workflow target option sets (scenarios) rather than raw estimates?
- **Why this cluster matters:** The options system is the primary client-facing differentiation feature. Missing "additive options" (the most common option type in residential construction) is a business logic gap that affects the core value proposition.

### Cluster 5: Enum and Status Strategy
- **Related findings:** C7, A-3, A-13, Q-2, BL-5, BL-8
- **Research questions:**
  1. CREATE TYPE enum vs CHECK constraint vs lookup table for project_status (10 values) and estimate_status (4-6 values)?
  2. Should estimate statuses be expanded from 4 (Decision 1) to 6 (Business Logic proposal: draft/review/sent/approved/contract/archived)?
  3. Should project status transitions have "soft guardrails" (warnings on unusual transitions, prompts on milestone transitions)?
  4. Should a `project_status_history` table be created for audit trail?
  5. How do the old project statuses ('active','on_hold','completed','archived') map to the new 10-stage enum? (No data exists yet, so this is a clean replacement.)
- **Why this cluster matters:** Enum decisions are difficult to reverse after data exists. Wrong choices now mean painful ALTER TYPE migrations or data conversion later.

### Cluster 6: Type System and Validation Architecture
- **Related findings:** Q-1, Q-2, Q-5, Q-8, Q-10
- **Research questions:**
  1. What is the exact discriminated union pattern for `NodeWithDetails`? (3 variants: group/assembly/item)
  2. How should snapshot data be typed? (Branded `Readonly<NodeWithDetails>` or separate `FrozenNode` type?)
  3. What is the complete Zod schema inventory for Phase 1A server action inputs?
  4. Should `ActionResult<T>` include error codes alongside error messages? What is the enum?
  5. What tsconfig strict flags should be added before Phase 1A? (`noUncheckedIndexedAccess`, `noImplicitReturns`, `exactOptionalPropertyDifference`)
- **Why this cluster matters:** Phase 1A is greenfield for domain types. Patterns established now propagate through 30+ tables and 50+ server actions. Wrong patterns create compounding type-safety debt.

### Cluster 7: Deep-Copy Function Design
- **Related findings:** C4, P-1, P-5, Q-4, BL-11
- **Research questions:**
  1. What is the exact table copy order for `deep_copy_estimate()`? (Must respect FK dependencies: nodes -> option_groups -> alternatives -> memberships)
  2. How does ID remapping work? (Temp table pattern with `INSERT...SELECT` and JOIN-based FK remapping)
  3. Which triggers should be bypassed during copy? (History, path maintenance, option inheritance -- but NOT updated_at)
  4. Should the function be monolithic or composed of sub-functions? (Trade-off: performance vs maintainability)
  5. How does `node_notes` inclusion affect the copy? (Additional table in the copy chain)
  6. What about the auto-demotion trigger's `was_auto_promoted` flag? Should it be copied as-is or reset?
  7. What is the advisory lock strategy for snapshot restore to prevent race conditions?
- **Why this cluster matters:** This is the single most complex SQL function in the system. Every FK remapping error creates a cross-estimate data corruption that silently breaks the tree.

### Cluster 8: Company Settings and User Preferences Design
- **Related findings:** A-6, S-7, S-8, P-7, BL-10
- **Research questions:**
  1. Should `company_settings` use normalized columns (Architecture proposal) or JSONB (Business Logic proposal)?
  2. What construction business fields beyond the basics need to be captured? (License, insurance, payment terms, warranty terms)
  3. How should per-estimate view state be stored? (Separate `estimate_view_state` table with composite PK `(user_id, estimate_id)`)
  4. How to handle the write frequency of expand/collapse state? (Debounce to max 1 write/5 seconds)
  5. Should `user_preferences` use `user_id` as PK (one row per user, JSONB blob) or a separate `id` column?
- **Why this cluster matters:** These tables are read on every page load (preferences) and every estimate open (view state). Wrong design creates either performance problems or migration headaches.

---

## Key Decisions Needed

These are questions where analysts disagreed or identified trade-offs requiring user/architect input.

### Decision 1: Enum Strategy -- CREATE TYPE vs CHECK Constraint

**Architecture analyst** recommends CREATE TYPE enums for both `project_status` and `estimate_status`, arguing consistency with the existing `app_role` CREATE TYPE pattern. **Quality analyst** recommends CHECK constraints, arguing flexibility (can drop/recreate constraint to change values, whereas ALTER TYPE ADD VALUE is irreversible). Both approaches have merit. The decision depends on whether the status values are expected to change.

**Recommendation for Zac:** If the 10 project statuses and estimate statuses are considered stable, use CREATE TYPE (better type safety, smaller storage). If they may evolve, use CHECK constraints (easier to modify). Given that no production data exists yet, CREATE TYPE is the safer bet -- if changes are needed later, the entire type can be dropped and recreated during development.

### Decision 2: Estimate Status Set -- 4 Values vs 6 Values

**Decision 1** specifies 4 statuses: `draft, preliminary, active, complete`. **Business Logic analyst** argues this is insufficient and proposes 6: `draft, review, sent, approved, contract, archived`. The distinction matters because:
- `preliminary` and `active` don't map to business events (what triggers the transition?)
- `sent` and `approved` are concrete events with timestamps and audit trail implications
- `contract` creates a natural immutability point (the estimate becomes the contract price)

**Recommendation for Zac:** The 6-value set is architecturally stronger because each status maps to a real business event. However, this needs validation against your actual workflow.

### Decision 3: `company_settings` -- Normalized Columns vs JSONB

**Architecture analyst** proposes a normalized table with specific columns for each setting (e.g., `default_markup_rate DECIMAL(5,4)`, `company_name VARCHAR(255)`) plus a JSONB overflow column. **Business Logic analyst** proposes a single JSONB column for everything, arguing the data is opaque to the database. The trade-off: normalized columns enable database-level validation and type safety; JSONB enables adding new settings without migrations.

**Recommendation for Zac:** Hybrid approach from the Architecture analyst. Use explicit columns for settings that participate in calculations (rates, tax) and JSONB for display/informational fields (license number, insurance info, terms). This gives type safety where it matters.

### Decision 4: `user_roles` vs `user_profiles` Consolidation

**Security analyst** identifies that role lives in `user_roles` (current), but Decision 3/research proposes a `user_profiles` table with role + display_name + PIN. Having role in two places is a consistency risk. Options: (a) keep `user_roles` separate and have `user_profiles` reference it; (b) merge `user_roles` into `user_profiles`.

**Recommendation for Zac:** Merge into `user_profiles`. It is cleaner and eliminates a JOIN. The migration is manageable since no application data exists yet.

### Decision 5: Allowance Visibility -- 3 Values or 4?

**Business Logic analyst** proposes adding `'allowance_view'` as a fourth `client_visibility` state for allowance items. Other analysts do not address this. The question: is `summary_only` (name + total) sufficient for allowances, or do allowances need a distinct display (budget + selection status + overage)?

**Recommendation for Zac:** Start with 3 values. `summary_only` covers 90% of the allowance case. Add `allowance_view` later if the distinction proves necessary. Adding an enum value is easier than removing one.

### Decision 6: Additive Options -- Schema Change Now or Later?

**Business Logic analyst** identifies that the most common option type in residential construction (additive/upgrade options) is not modeled by the current system. Proposes adding `group_type VARCHAR(20) DEFAULT 'selection'` to `option_groups` with values `'selection'` (existing) vs `'toggle'` (new). This is a low-effort schema change now that avoids a migration later.

**Recommendation for Zac:** Add the column now. It is one VARCHAR column with a default value. The feature can be deferred to Phase 1B, but the schema should accommodate it from day one.

### Decision 7: Snapshot Restore Guards

**Business Logic analyst** raises a critical workflow concern: restoring a snapshot over a "Complete" or "Contract" estimate destroys the contract price. Three options proposed:
- (a) "Restore to Snapshot" -- replaces current tree (dangerous when Active/Complete)
- (b) "Compare with Snapshot" -- read-only side-by-side (no data mutation)
- (c) "Create Estimate from Snapshot" -- seeds a NEW estimate from snapshot data

**Recommendation for Zac:** Implement all three as distinct actions. Block or warn "Restore" when estimate status is Active/Complete. This matches construction industry practice.

---

## Schema Impact Summary

### New Tables (Phase 1A)

| Table | Source | Key Columns | Notes |
|-------|--------|-------------|-------|
| `estimate_snapshots` | Decision 1, Architecture F1-F2 | `id`, `estimate_id FK`, `name`, `description`, `snapshot_type` ('milestone'/'checkpoint'), `estimate_status_at_time`, `project_status_at_time`, `snapshot_data JSONB`, `node_count`, `total_price`, `schema_version INTEGER`, `created_at`, `created_by FK` | JSONB serialization of full estimate tree. Immutable via RLS + trigger. |
| `node_notes` | Weekend session, Architecture F10 | `id`, `node_id FK`, `body TEXT`, `format` ('markdown'/'html'), `is_internal BOOLEAN DEFAULT TRUE`, `is_client_visible BOOLEAN DEFAULT FALSE`, `deleted_at`, `created_at`, `updated_at`, `created_by FK` | Replaces `notes TEXT` and `client_notes TEXT` on `estimate_nodes`. Soft-delete. |
| `user_preferences` | Decision 3, Architecture F6 | `user_id UUID PK FK`, `preferences JSONB`, `created_at`, `updated_at` | One row per user. JSONB for opaque UI state. |
| `estimate_view_state` | Decision 3, Architecture F6 | `user_id FK`, `estimate_id FK`, `view_state JSONB`, `updated_at` | Composite PK `(user_id, estimate_id)`. Replaces `column_config`/`view_settings` on estimates. |
| `company_settings` | Decision 3, Architecture F6 | `id`, `company_name`, `license_number`, `default_markup_rate`, `default_overhead_rate`, `default_contingency_rate`, `default_tax_rate`, `default_unit_id FK`, `settings_json JSONB`, `created_at`, `updated_at` | Single row enforced by unique dummy column. Hybrid normalized + JSONB. |
| `estimate_shares` | Decision 4, Architecture F7 | `id`, `estimate_id FK`, `share_token VARCHAR(64) UNIQUE`, `pin_hash TEXT`, `created_by FK`, `expires_at TIMESTAMPTZ NOT NULL`, `failed_attempts INTEGER`, `locked_until`, `is_revoked BOOLEAN`, `last_accessed_at`, `access_count`, `created_at` | Schema only in 1A; validation endpoint in 1B+. |
| `estimate_comments` | Decision 4, Architecture F7 | `id`, `estimate_id FK`, `node_id FK (SET NULL)`, `author_type` ('user'/'share'), `author_id`, `share_id FK`, `body TEXT`, `is_resolved BOOLEAN`, `resolved_by FK`, `resolved_at`, `created_at`, `updated_at` | Schema only in 1A; feature in 1B+. |
| `estimate_approvals` | Decision 4, Architecture F7 | `id`, `estimate_id FK`, `author_type`, `author_id`, `share_id FK`, `status` ('approved'/'rejected'/'pending'), `notes TEXT`, `option_set_id FK`, `created_at` | Schema only in 1A; feature in 1B+. |

### New Enums (Phase 1A)

| Enum | Values | Replaces |
|------|--------|----------|
| `project_status` | `lead, in_design, bidding, under_contract, value_engineering, active_construction, closing_out, warranty_period, closed, archived` | Old `status VARCHAR(50)` on projects ('active','on_hold','completed','archived') |
| `estimate_status` | `draft, preliminary, active, complete` (or 6-value: `draft, review, sent, approved, contract, archived`) | Old `status VARCHAR(50)` on estimates ('draft','in_review','approved','sent','accepted','archived') |

### Modified Tables (Phase 1A)

| Table | Change | Source |
|-------|--------|--------|
| `estimate_nodes` | Add `flagged BOOLEAN NOT NULL DEFAULT FALSE` | Architecture F4 |
| `estimate_nodes` | Add `search_vector tsvector GENERATED ALWAYS AS (...)` | Performance F3, Quality F9 |
| `estimate_nodes` | Remove `notes TEXT`, `client_notes TEXT` (replaced by `node_notes` table) | Architecture F10 |
| `estimate_nodes` | Consider adding `was_auto_promoted BOOLEAN DEFAULT FALSE` | Business Logic F11 |
| `estimates` | Replace `status VARCHAR(50)` with `estimate_status` enum | Architecture F3 |
| `estimates` | Remove `column_config JSONB`, `view_settings JSONB` | Architecture F11, Performance F7 |
| `estimates` | Add `version INTEGER DEFAULT 1` (optimistic locking) | Addendum, Quality F4 |
| `projects` | Replace `status VARCHAR(50)` with `project_status` enum | Architecture F3 |
| `option_groups` | Consider adding `group_type VARCHAR(20) DEFAULT 'selection'` | Business Logic F3 |

### New Indexes (Phase 1A)

| Index | Table | Type | Purpose |
|-------|-------|------|---------|
| `idx_nodes_search` | `estimate_nodes` | GIN on `search_vector` | Full-text search (may defer to 1B) |
| `idx_nodes_flagged` | `estimate_nodes` | Partial btree WHERE flagged = TRUE | Flagged item filter |
| `idx_nodes_total` | `estimate_nodes` | btree on `total_price` WHERE node_type = 'item' | "Unpriced items" and "items over $X" queries |
| `idx_nom_node` | `node_option_memberships` | btree on `node_id` | Anti-join performance for active tree query |
| `idx_nom_alt` | `node_option_memberships` | btree on `option_alternative_id` | Reverse lookup "which nodes belong to alternative X" |
| `idx_estimates_project` | `estimates` | btree on `(project_id, id)` | Client RLS subquery optimization |
| `idx_cpa_client` | `client_project_access` | btree on `(client_user_id, project_id)` | Client RLS subquery optimization |
| `idx_node_notes_node` | `node_notes` | btree on `node_id` WHERE deleted_at IS NULL | Active notes lookup |
| `idx_nodes_history_*` | `estimate_nodes_history` | Multiple btree indexes | History queries by node, date, estimate |

### New Functions (Phase 1A)

| Function | Purpose | Notes |
|----------|---------|-------|
| `get_user_role()` | Extract role from JWT `app_metadata` | `SECURITY DEFINER SET search_path = ''`. Fallback to 'pending'. |
| `create_estimate_snapshot(estimate_id, name, created_by)` | Serialize estimate tree to JSONB | Sets `app.is_snapshot_copy` to bypass history triggers. |
| `restore_estimate_snapshot(snapshot_id, restored_by)` | Auto-save current state, then deserialize snapshot | Acquires advisory lock, checks estimate version for optimistic locking. |

---

## Plan Update Requirements

### Structural Changes

1. **Add Phase 1A-0: Security and Type Foundation** (new, before any application tables)
   - Create `get_user_role()` SECURITY DEFINER helper function
   - Resolve `user_roles` vs `user_profiles` consolidation
   - Update `handle_new_user()` trigger for the consolidated approach
   - Update `custom_access_token_hook()` if table changes
   - Add `pending` role redirect to middleware
   - Create RLS policy template that all subsequent migrations follow
   - Create TypeScript type system architecture (`enums.ts`, `database.ts` stubs, `ActionResult<T>`)
   - Add tsconfig strict flags (`noUncheckedIndexedAccess`, `noImplicitReturns`, `exactOptionalPropertyDifference`)

2. **Split Step 1A.1 into multiple focused migrations** (currently too monolithic)
   - Migration 1: Extensions + Enums (project_status, estimate_status)
   - Migration 2: Core tables (projects, estimates, estimate_nodes, node_item_details, node_assembly_details, node_notes)
   - Migration 3: Supporting tables (units, cost_codes, phases, parameters, company_settings, user_preferences, estimate_view_state)
   - Migration 4: Catalog + Options + Vendors (catalog_items, catalog_assemblies, option_groups, option_alternatives, memberships, option_sets, vendors, proposals)
   - Migration 5: Client/Sharing tables (estimate_snapshots, estimate_shares, estimate_comments, estimate_approvals)
   - Migration 6: Triggers (all triggers, with bypass mechanism for snapshot copies)
   - Migration 7: History tables
   - Migration 8: Indexes + RLS policies (every table)
   - Migration 9: Seed data (units, cost_codes, company_settings singleton)
   - Migration 10: Functions (deep_copy_estimate, create_snapshot, restore_snapshot, set_app_user_id)

3. **Add Step 1A.2b: Snapshot Functions** (after tables and triggers)
   - `create_estimate_snapshot()` PostgreSQL function
   - `restore_estimate_snapshot()` PostgreSQL function
   - Both as schema-level definitions even if UI is Phase 1B+

4. **Update estimate_nodes schema** in the plan
   - Add `flagged BOOLEAN NOT NULL DEFAULT FALSE`
   - Remove `notes TEXT` and `client_notes TEXT` (replaced by `node_notes` table)
   - Add `search_vector tsvector GENERATED ALWAYS AS (...) STORED`
   - Consider `was_auto_promoted BOOLEAN DEFAULT FALSE`
   - Replace `client_visible BOOLEAN` with `client_visibility VARCHAR(20) CHECK ('visible','hidden','summary_only')`

5. **Update estimates schema** in the plan
   - Remove `column_config JSONB` and `view_settings JSONB`
   - Add `version INTEGER DEFAULT 1`
   - Replace status with new enum (4 or 6 values per Decision 2)

6. **Update projects schema** in the plan
   - Replace 4-value status with 10-value project_status enum

7. **Expand Step 1A.5: Server Actions** from ~9 to ~30
   - Organize by entity in `src/lib/actions/`
   - Add snapshot actions (create, restore, list, get, delete)
   - Add preferences/settings actions (get, update for both user prefs and company settings)
   - Each file exports named functions returning `ActionResult<T>` with error codes

8. **Add Step 1A.5.5: Validation Schemas**
   - Create `src/lib/validation/` directory with Zod schemas per entity
   - Include `format-error.ts` utility for user-facing error messages
   - Schemas used both client-side (forms) and server-side (server action input validation)

9. **Expand Step 1A.6: Tests** from "12+ trigger, 10+ constraint" to 114+ test cases
   - Add test infrastructure setup as first sub-step (helpers, seed data, db connection)
   - Prioritize: snapshot tests > trigger tests > constraint tests > RLS tests > action tests
   - Add RLS policy test suite (10 tests minimum)
   - Add snapshot round-trip test suite (15 tests minimum)

10. **Update Phase 1A duration estimate** from "2-3 sessions" to "4-5 sessions"
    - Session 1: Security foundation + type foundation + 5 migration files
    - Session 2: Remaining migrations + snapshot functions
    - Session 3: Test infrastructure + database tests (triggers, constraints, snapshots)
    - Session 4: Generated types + domain types + validation schemas + server actions
    - Session 5: Server action tests + RLS tests + verification + cleanup

### Verification Gates (add to plan)

Every Phase 1A migration must pass:
- [ ] Contains `ENABLE ROW LEVEL SECURITY` for every `CREATE TABLE`
- [ ] Contains at least one RLS policy per table
- [ ] All enum/status values match the decided set
- [ ] No hardcoded role strings -- all use `get_user_role()` helper
- [ ] `client_visibility` is VARCHAR(20) with 3-value CHECK, not boolean
- [ ] No `column_config` or `view_settings` on `estimates` table
- [ ] `estimate_nodes` has `flagged`, `search_vector`, no `notes`/`client_notes`

---

## Deferred Items

Items that all analysts agree can wait for Phase 1B+.

| Item | Source | Why Deferred | Phase |
|------|--------|--------------|-------|
| Share link validation endpoint and PIN authentication flow | Security F3, F6 | Complex unauthenticated access pattern; schema is sufficient for 1A | 1B |
| Client portal UI and share viewing pages | Decision 4, Security F11 | Feature implementation, not schema foundation | 1B+ |
| Catalog field-level sync tracking ("Update from Catalog" diff view) | Business Logic F6 | Complex merge logic; not needed until catalog features are built | 1B+ |
| Cross-project search with faceted filtering and cost trending | Business Logic F9 | Search UI and analytics; indexes exist in 1A | 1B+ |
| Option set comparison side-by-side view | Performance F8, Business Logic F12 | Calculation engine dependency (Phase 2); schema supports it | 1B+ |
| Full-text search UI and query functions | Performance F3, Quality F9 | GIN index can exist in 1A; search functions and UI in 1B | 1B |
| Option set approval workflow (approve scenario, not just estimate) | Business Logic F12 | Approval feature implementation; schema accommodates it | 1B+ |
| History table partitioning and retention cron job | Performance F9 | Not needed until data volume warrants it | 1B+ |
| Project status transition soft guardrails (warnings, prompts) | Business Logic F5 | Application-level logic; schema supports all transitions | 1B |
| `allowance_view` fourth client visibility state | Business Logic F4 | Start with 3 values; add if needed after client portal is built | 1B+ |
| Materialized view for active tree (sub-1ms loads) | Performance F4 | Premature optimization at current scale | 2+ |
| Supabase Realtime batching for subtree moves | Performance F5 | Application-level optimization; not a schema concern | 1B+ |

---

## Contradictions Between Analysts

### Contradiction 1: Snapshot Storage Model
**Performance analyst** (Finding 2) initially describes the snapshot data as living in "the same `estimate_nodes` table (deep-copied with a different `estimate_id`)" and proposes `is_snapshot BOOLEAN` on estimates. **Architecture analyst** (Findings 1-2) explicitly argues AGAINST deep-copy into production tables and recommends JSONB serialization. **Security analyst** (Finding 5) sides with JSONB as "simpler and more robust" for immutability. **Resolution:** JSONB serialization is the consensus (4 of 5 analysts). The Performance analyst's deep-copy framing appears to be an alternative considered but not the recommended approach -- their Phase 1A recommendations also reference the `estimate_snapshots` table.

### Contradiction 2: company_settings -- Columns vs JSONB
**Architecture analyst** proposes a normalized table with specific columns for rates plus a JSONB overflow. **Business Logic analyst** proposes pure JSONB. Neither is wrong. **Resolution:** Hybrid approach (Architecture's recommendation) is stronger because rate fields participate in calculations and benefit from database-level type checking.

### Contradiction 3: Enum Implementation
**Architecture analyst** recommends CREATE TYPE. **Quality analyst** recommends CHECK constraints. **Resolution:** Unresolved -- requires Zac's input. Both are valid approaches with different trade-off profiles.

### Contradiction 4: Per-User View State Table Naming
**Architecture analyst** calls it `estimate_view_state`. **Performance analyst** calls it `user_estimate_preferences`. Both describe the same concept (composite PK on user_id + estimate_id, JSONB view_state). **Resolution:** Use `estimate_view_state` (Architecture's name) -- it describes the content, not the ownership.

### Contradiction 5: Estimate Status Values
**Decision 1** says 4 values. **Business Logic analyst** proposes 6. **Architecture analyst** analyzes both the old 6 and new 4 and notes they serve different purposes (workflow vs maturity). **Resolution:** Requires Zac's input. The 6-value set from Business Logic is the most business-accurate.
