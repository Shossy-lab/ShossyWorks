# ShossyWorks Implementation Plan v2

## Context

This plan supersedes the original Phase 1A plan from the 2026-04-06 planning session. It incorporates:

1. **5 interaction decisions** made 2026-04-08 (project lifecycle, node actions, preferences, client experience, search)
2. **Comprehensive analysis** from the 5-agent Implementation Review Board (19 findings, 7 key decisions)
3. **8 deep-research files** covering snapshot architecture, RLS authorization, client visibility, options system, enum strategy, type system, deep-copy function design, and settings/preferences

**Key changes from v1:**
- Phase 1A split from 4 monolithic steps into 13 focused phases (1A-0 through 1A-12)
- Session estimate revised from 2-3 to 5-6 sessions
- RLS policies are now mandatory on every table (zero existed before)
- `user_roles` merged into `user_profiles`
- `client_visibility` changed from BOOLEAN to 3-value VARCHAR
- `estimate_nodes` gains `flagged`, `search_vector`; loses `notes`, `client_notes`
- `estimates` loses `column_config`, `view_settings`; gains `version INTEGER`
- 8 new tables added (snapshots, notes, preferences, shares, comments, approvals, view state, company settings)
- Server actions expanded from ~9 to ~30
- Test cases expanded from ~22 to 114+
- CREATE TYPE enums (not CHECK constraints) for project/estimate status

**Decisions driving this plan:**
- Enum strategy: CREATE TYPE (matches existing `app_role` pattern)
- Estimate statuses: 4 values (draft/preliminary/active/complete) per user decision
- Snapshot storage: JSONB serialization (not deep-copy into production tables)
- `company_settings`: Hybrid normalized columns + JSONB
- `user_roles` -> merged into `user_profiles`

---

## Phase Overview Table

| Phase | Focus | Est. Sessions | Key Deliverables |
|-------|-------|---------------|------------------|
| **1A-0** | Security & Type Foundation | 0.5 | `get_user_role()`, `user_profiles` consolidation, pending role enforcement, type system stubs |
| **1A-1** | Enums & Extensions Migration | 0.25 | `project_status`, `estimate_status` CREATE TYPEs, extensions |
| **1A-2** | Core Tables Migration | 0.5 | `projects`, `estimates`, `estimate_nodes`, `node_item_details`, `node_assembly_details`, `node_notes` + RLS |
| **1A-3** | Supporting Tables Migration | 0.25 | `units_of_measure`, `cost_codes`, `phases`, `parameters`, `company_settings`, `user_preferences`, `estimate_view_state` + RLS |
| **1A-4** | Catalog, Options & Vendor Tables | 0.5 | `catalog_items`, `catalog_assemblies`, `option_groups`, `option_alternatives`, `node_option_memberships`, `option_sets`, `option_set_selections`, `option_set_broad_selections`, `vendors` + RLS |
| **1A-5** | Client/Sharing Tables | 0.25 | `estimate_snapshots`, `estimate_shares`, `estimate_comments`, `estimate_approvals`, `client_project_access` + RLS + client VIEWs |
| **1A-6** | Triggers | 0.5 | All trigger functions with bypass mechanism, `set_updated_at`, path maintenance, history logging |
| **1A-7** | History Tables | 0.25 | `estimate_nodes_history` + triggers, `node_item_details_history` |
| **1A-8** | Indexes & Seed Data | 0.25 | All indexes (GIN, partial btree), seed data (units, cost_codes, company_settings) |
| **1A-9** | PostgreSQL Functions | 0.5 | `deep_copy_estimate`, `create_estimate_snapshot`, `restore_estimate_snapshot`, `set_subtree_visibility` |
| **1A-10** | Generated Types & Domain Types | 0.5 | `supabase gen types`, discriminated unions, `ActionResult<T>`, error codes, Zod schemas |
| **1A-11** | Server Actions | 0.75 | ~30 server actions organized by entity |
| **1A-12** | Comprehensive Tests | 1.0 | 114+ test cases, test infrastructure, verification gates |
| **1B** | Features (high-level) | 4-6 | Snapshot UI, catalog, options UI, client portal, search, preferences UI |
| **2+** | Advanced (high-level) | TBD | Calculation engine, reporting, PDF, Figma integration |

**Total Phase 1A: ~5-6 sessions**

---

## Phase 1A-0: Security & Type Foundation

**Goal:** Establish security helpers and type system before any application tables exist.

**Prerequisite:** Current auth infrastructure (auth_roles migration, custom_access_token_hook, handle_new_user trigger).

### Migration: `supabase/migrations/20260409000001_security_foundation.sql`

**Contents:**
1. `get_user_role()` SECURITY DEFINER helper (pure SQL, inlinable in RLS)
   - Reference: `rls-authorization-research.md` Section 1
2. `is_staff()` helper function
   - Reference: `rls-authorization-research.md` Section 4.1
3. `client_has_project_access(UUID)` helper function
   - Reference: `rls-authorization-research.md` Section 4.1
4. `user_profiles` table (replaces `user_roles`)
   - Reference: `rls-authorization-research.md` Section 2
5. Data migration from `user_roles` to `user_profiles`
6. Updated `handle_new_user()` trigger
7. Updated `custom_access_token_hook()` function
8. `prevent_role_self_change()` trigger
9. Drop old `user_roles` table
10. Grant/revoke permissions

### Application Changes

| File | Change |
|------|--------|
| `src/middleware.ts` | Add `pending` role check: extract `user.app_metadata?.user_role`, redirect pending to `/pending-approval` |
| `src/app/(protected)/layout.tsx` | Defense-in-depth: check role in layout, redirect pending |
| `src/app/(auth)/pending-approval/page.tsx` | New page: "Your account is pending admin approval" |

### TypeScript Type System Setup

| File | Contents |
|------|----------|
| `src/lib/types/enums.ts` | `PROJECT_STATUS`, `ESTIMATE_STATUS` const objects, type guards, labels, ordinals |
| `src/lib/types/action-result.ts` | `ActionResult<T>`, `ErrorCode`, `ok()`, `err()` factory functions |
| `src/lib/types/domain/nodes.ts` | `NodeWithDetails` discriminated union, `NodeBase`, `ItemDetails`, `AssemblyDetails`, type guards |
| `src/lib/types/domain/snapshots.ts` | `SnapshotNode` branded type, `SnapshotData`, snapshot sub-records |
| `src/lib/types/settings.ts` | `CompanySettings`, `CompanySettingsJson`, `UserPreferences` |
| `src/lib/types/preferences.ts` | `EstimateViewState`, `UserPreferencesJson` |
| `src/lib/types/options.ts` | `OptionGroup`, `OptionAlternative`, `NodeOptionMembership`, `OptionSet` |
| `src/lib/types/status-transitions.ts` | `evaluateProjectTransition()`, `evaluateEstimateTransition()` guardrail functions |

### tsconfig Hardening

Add to `tsconfig.json` compilerOptions:
```json
{
  "noUncheckedIndexedAccess": true,
  "noImplicitReturns": true,
  "exactOptionalPropertyTypes": true
}
```

### Agent Assignments

| Agent | Scope | Type |
|-------|-------|------|
| Agent 1 | Security migration SQL (get_user_role, user_profiles, helpers, triggers, grants) | Full-capability |
| Agent 2 | TypeScript type system files (all 8 type files + tsconfig) | Full-capability |
| Agent 3 | Middleware + layout pending role enforcement + pending-approval page | Full-capability |

### Verification Script

```bash
#!/bin/bash
# Phase 1A-0 Verification
PASS=0; FAIL=0

# Migration file exists
[ -f "supabase/migrations/20260409000001_security_foundation.sql" ] && ((PASS++)) || ((FAIL++))

# Type files exist
for f in "src/lib/types/enums.ts" "src/lib/types/action-result.ts" \
         "src/lib/types/domain/nodes.ts" "src/lib/types/domain/snapshots.ts" \
         "src/lib/types/settings.ts" "src/lib/types/preferences.ts" \
         "src/lib/types/options.ts" "src/lib/types/status-transitions.ts"; do
  [ -f "$f" ] && ((PASS++)) || ((FAIL++))
done

# Pending approval page exists
[ -f "src/app/(auth)/pending-approval/page.tsx" ] && ((PASS++)) || ((FAIL++))

# Migration contains key elements
grep -q "get_user_role" "supabase/migrations/20260409000001_security_foundation.sql" && ((PASS++)) || ((FAIL++))
grep -q "user_profiles" "supabase/migrations/20260409000001_security_foundation.sql" && ((PASS++)) || ((FAIL++))
grep -q "ENABLE ROW LEVEL SECURITY" "supabase/migrations/20260409000001_security_foundation.sql" && ((PASS++)) || ((FAIL++))

# tsconfig has strict flags
grep -q "noUncheckedIndexedAccess" "tsconfig.json" && ((PASS++)) || ((FAIL++))

echo "Phase 1A-0: PASS=$PASS FAIL=$FAIL"
[ $FAIL -eq 0 ] && echo "GATE: PASSED" || echo "GATE: FAILED"
```

### Commit

```
feat(infra): security foundation — get_user_role helper, user_profiles consolidation, type system

- Add get_user_role() SECURITY DEFINER helper for RLS policies
- Merge user_roles into user_profiles table
- Add pending role enforcement in middleware and layout
- Create TypeScript type system: ActionResult, NodeWithDetails, enums, error codes
- Harden tsconfig with strict flags
```

---

## Phase 1A-1: Enums & Extensions Migration

**Goal:** Create PostgreSQL enum types and enable extensions before any table references them.

### Migration: `supabase/migrations/20260409000002_extensions_and_enums.sql`

**Contents:**
1. `CREATE EXTENSION IF NOT EXISTS ltree` (for tree paths)
2. `CREATE EXTENSION IF NOT EXISTS pg_trgm` (for fuzzy text search, optional)
3. `CREATE TYPE public.project_status AS ENUM (10 values)`
   - Reference: `enum-strategy-research.md` exact SQL
4. `CREATE TYPE public.estimate_status AS ENUM (4 values)`
   - Reference: `enum-strategy-research.md` exact SQL
5. `COMMENT ON TYPE` for both

**Values:**
- `project_status`: lead, in_design, bidding, under_contract, value_engineering, active_construction, closing_out, warranty_period, closed, archived
- `estimate_status`: draft, preliminary, active, complete

### Agent Assignments

Single agent -- this is a small, self-contained migration.

### Verification Script

```bash
#!/bin/bash
PASS=0; FAIL=0
[ -f "supabase/migrations/20260409000002_extensions_and_enums.sql" ] && ((PASS++)) || ((FAIL++))
grep -q "CREATE TYPE public.project_status" "supabase/migrations/20260409000002_extensions_and_enums.sql" && ((PASS++)) || ((FAIL++))
grep -q "CREATE TYPE public.estimate_status" "supabase/migrations/20260409000002_extensions_and_enums.sql" && ((PASS++)) || ((FAIL++))
grep -q "ltree" "supabase/migrations/20260409000002_extensions_and_enums.sql" && ((PASS++)) || ((FAIL++))
echo "Phase 1A-1: PASS=$PASS FAIL=$FAIL"
[ $FAIL -eq 0 ] && echo "GATE: PASSED" || echo "GATE: FAILED"
```

### Commit

```
feat(db): add project_status and estimate_status enums, enable ltree extension
```

---

## Phase 1A-2: Core Tables Migration

**Goal:** Create the fundamental tables that everything else depends on.

### Migration: `supabase/migrations/20260409000003_core_tables.sql`

**Tables (in dependency order):**

1. **`projects`**
   - `status public.project_status NOT NULL DEFAULT 'lead'`
   - `user_id UUID NOT NULL REFERENCES auth.users(id)` (project owner)
   - RLS: staff full CRUD, client read on assigned projects, pending/anon denied
   - Reference: `rls-authorization-research.md` Section 4.2

2. **`estimates`**
   - `status public.estimate_status NOT NULL DEFAULT 'draft'`
   - `version INTEGER NOT NULL DEFAULT 1` (optimistic locking)
   - NO `column_config JSONB` or `view_settings JSONB` (moved to `estimate_view_state`)
   - `version_group_id UUID`, `version_number INTEGER`, `version_label VARCHAR(255)`, `is_current BOOLEAN`
   - `default_contingency_rate DECIMAL(5,4)`, `default_overhead_rate DECIMAL(5,4)`
   - RLS: staff full CRUD, client read on project-accessible estimates
   - Reference: `rls-authorization-research.md` Section 4.3

3. **`estimate_nodes`**
   - `client_visibility VARCHAR(20) NOT NULL DEFAULT 'visible'` with CHECK ('visible','hidden','summary_only')
   - `flagged BOOLEAN NOT NULL DEFAULT FALSE`
   - `search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(name,'') || ' ' || coalesce(description,''))) STORED`
   - `path LTREE`
   - NO `notes TEXT` or `client_notes TEXT` (replaced by `node_notes` table)
   - `was_auto_promoted BOOLEAN NOT NULL DEFAULT FALSE`
   - `reference_name VARCHAR(255)` (formula system)
   - `catalog_source_id UUID`, `catalog_source_type VARCHAR(20)`, `catalog_version INTEGER`
   - RLS: staff full CRUD, client read filtered by client_visibility
   - Reference: `client-visibility-research.md` Sections 2, 4; `rls-authorization-research.md` Section 4.4

4. **`node_item_details`**
   - All item-specific columns (qty, unit_cost, formulas, bid_type, allowance fields, etc.)
   - 1:1 with estimate_nodes (node_id PK or FK UNIQUE)
   - RLS: staff full CRUD, client read ONLY for 'visible' nodes (not summary_only)
   - Reference: `rls-authorization-research.md` Section 4.5

5. **`node_assembly_details`**
   - Assembly-specific columns (assembly_qty, assembly_unit_id, derived_unit_cost, qty_formula)
   - 1:1 with estimate_nodes
   - RLS: same pattern as item_details
   - Reference: `rls-authorization-research.md` Section 4.6

6. **`node_notes`**
   - `body TEXT NOT NULL`, `format VARCHAR(20)` CHECK ('markdown','plain')
   - `is_internal BOOLEAN NOT NULL DEFAULT TRUE`
   - `is_client_visible BOOLEAN NOT NULL DEFAULT FALSE`
   - `deleted_at TIMESTAMPTZ` (soft delete)
   - Constraint: `NOT (is_internal = TRUE AND is_client_visible = TRUE)`
   - RLS: staff full access, client read client-visible notes on non-hidden nodes
   - Reference: `client-visibility-research.md` Section 5

### Client VIEWs (in same migration)

- `client_estimate_nodes` -- column-filtered view for client access
- `client_node_item_details` -- only for 'visible' nodes
- `client_node_assembly_details` -- only for 'visible' nodes

Reference: `client-visibility-research.md` Section 2, "Implementation: PostgreSQL VIEW"

### Agent Assignments

| Agent | Scope | Type |
|-------|-------|------|
| Agent 1 | projects + estimates tables + their RLS | Full-capability |
| Agent 2 | estimate_nodes + detail tables + their RLS | Full-capability |
| Agent 3 | node_notes + client VIEWs + notes RLS | Full-capability |

### Verification Script

```bash
#!/bin/bash
PASS=0; FAIL=0
F="supabase/migrations/20260409000003_core_tables.sql"
[ -f "$F" ] && ((PASS++)) || ((FAIL++))

# Every CREATE TABLE has ENABLE ROW LEVEL SECURITY
for table in projects estimates estimate_nodes node_item_details node_assembly_details node_notes; do
  grep -q "ENABLE ROW LEVEL SECURITY" "$F" && ((PASS++)) || ((FAIL++))
done

# Key columns exist
grep -q "client_visibility VARCHAR(20)" "$F" && ((PASS++)) || ((FAIL++))
grep -q "flagged BOOLEAN" "$F" && ((PASS++)) || ((FAIL++))
grep -q "search_vector tsvector" "$F" && ((PASS++)) || ((FAIL++))
grep -q "version INTEGER" "$F" && ((PASS++)) || ((FAIL++))

# Removed columns are NOT present
! grep -q "column_config JSONB" "$F" && ((PASS++)) || ((FAIL++))
! grep -q "view_settings JSONB" "$F" && ((PASS++)) || ((FAIL++))

# Client VIEWs exist
grep -q "client_estimate_nodes" "$F" && ((PASS++)) || ((FAIL++))

echo "Phase 1A-2: PASS=$PASS FAIL=$FAIL"
[ $FAIL -eq 0 ] && echo "GATE: PASSED" || echo "GATE: FAILED"
```

### Commit

```
feat(db): core tables — projects, estimates, estimate_nodes, details, notes with RLS
```

---

## Phase 1A-3: Supporting Tables Migration

**Goal:** Create reference and configuration tables.

### Migration: `supabase/migrations/20260409000004_supporting_tables.sql`

**Tables:**

1. **`units_of_measure`** -- id, name, abbreviation, unit_type. RLS: read-all for authenticated, write for owner.

2. **`cost_codes`** -- id, code, name, description, category. RLS: read-all for authenticated, write for owner.

3. **`phases`** -- id, project_id FK, name, sort_order. RLS: staff CRUD, client read on accessible projects.

4. **`project_parameters`** -- id, project_id FK, name, value, data_type. RLS: staff CRUD.

5. **`broad_options`** -- id, estimate_id FK, name, description, is_active. RLS: via estimate ownership.

6. **`broad_option_overrides`** -- id, broad_option_id FK, parameter_id FK, override_value. RLS: via broad_option ownership chain.

7. **`company_settings`** (hybrid normalized + JSONB)
   - Singleton enforcement via `singleton_key TEXT UNIQUE CHECK (= 'default')`
   - Normalized: `default_markup_rate`, `default_overhead_rate`, `default_contingency_rate`, `default_tax_rate`, `default_unit_id FK`
   - JSONB: `settings_json` for company info, licensing, terms, branding
   - RLS: owner full, employee read-only, client/pending/anon denied
   - Reference: `settings-preferences-research.md` Section 2

8. **`user_preferences`**
   - `user_id UUID PRIMARY KEY` (natural key, not synthetic id)
   - `preferences JSONB NOT NULL DEFAULT '{}'`
   - RLS: own preferences only
   - Reference: `settings-preferences-research.md` Section 3

9. **`estimate_view_state`**
   - Composite PK `(user_id, estimate_id)`
   - `view_state JSONB NOT NULL DEFAULT '{}'`
   - No `created_at` (only `updated_at` matters)
   - RLS: own state only
   - Reference: `settings-preferences-research.md` Section 4

### Agent Assignments

| Agent | Scope | Type |
|-------|-------|------|
| Agent 1 | units, cost_codes, phases, parameters, broad_options + RLS | Full-capability |
| Agent 2 | company_settings, user_preferences, estimate_view_state + RLS | Full-capability |

### Verification Script

```bash
#!/bin/bash
PASS=0; FAIL=0
F="supabase/migrations/20260409000004_supporting_tables.sql"
[ -f "$F" ] && ((PASS++)) || ((FAIL++))
for table in units_of_measure cost_codes phases company_settings user_preferences estimate_view_state; do
  grep -q "$table" "$F" && ((PASS++)) || ((FAIL++))
done
grep -q "singleton_key" "$F" && ((PASS++)) || ((FAIL++))
grep -q "ENABLE ROW LEVEL SECURITY" "$F" && ((PASS++)) || ((FAIL++))
echo "Phase 1A-3: PASS=$PASS FAIL=$FAIL"
[ $FAIL -eq 0 ] && echo "GATE: PASSED" || echo "GATE: FAILED"
```

### Commit

```
feat(db): supporting tables — units, cost_codes, phases, company_settings, preferences
```

---

## Phase 1A-4: Catalog, Options & Vendor Tables Migration

**Goal:** Create the full options system and catalog infrastructure. Schema only -- features ship in 1B.

### Migration: `supabase/migrations/20260409000005_catalog_options_vendors.sql`

**Tables (in dependency order):**

1. **`vendors`** -- id, name, contact_info JSONB. RLS: staff CRUD.

2. **`catalog_items`** -- id, name, description, default fields, created_by. RLS: staff CRUD.

3. **`catalog_assemblies`** -- id, name, description, created_by. RLS: staff CRUD.

4. **`option_groups`** (with `group_type`)
   - `group_type VARCHAR(20) NOT NULL DEFAULT 'selection'` CHECK ('selection', 'toggle')
   - `anchor_node_id UUID NOT NULL REFERENCES estimate_nodes(id) ON DELETE CASCADE`
   - RLS: via estimate ownership chain
   - Reference: `options-system-research.md` Section 1

5. **`option_alternatives`**
   - `is_selected BOOLEAN NOT NULL DEFAULT FALSE`
   - Partial unique index: one selected per group
   - RLS: via option_group ownership chain
   - Reference: `options-system-research.md` "Recommended Solution"

6. **`node_option_memberships`** (junction table)
   - `UNIQUE (node_id, option_alternative_id)`
   - Performance indexes: `idx_nom_node`, `idx_nom_alt`
   - RLS: via node ownership chain
   - Reference: `options-system-research.md` "Recommended Solution"

7. **`option_sets`**
   - Partial unique index: one default per estimate
   - RLS: via estimate ownership
   - Reference: `options-system-research.md` "Recommended Solution"

8. **`option_set_selections`**
   - `UNIQUE (option_set_id, option_group_id)`
   - RLS: via option_set ownership chain

9. **`option_set_broad_selections`**
   - `UNIQUE (option_set_id, broad_option_id)`
   - RLS: via option_set ownership chain

### Agent Assignments

| Agent | Scope | Type |
|-------|-------|------|
| Agent 1 | vendors, catalog_items, catalog_assemblies + RLS | Full-capability |
| Agent 2 | option_groups, option_alternatives, node_option_memberships + RLS + indexes | Full-capability |
| Agent 3 | option_sets, option_set_selections, option_set_broad_selections + RLS | Full-capability |

### Verification Script

```bash
#!/bin/bash
PASS=0; FAIL=0
F="supabase/migrations/20260409000005_catalog_options_vendors.sql"
[ -f "$F" ] && ((PASS++)) || ((FAIL++))
grep -q "group_type VARCHAR(20)" "$F" && ((PASS++)) || ((FAIL++))
grep -q "idx_one_selected_per_group" "$F" && ((PASS++)) || ((FAIL++))
grep -q "idx_nom_node" "$F" && ((PASS++)) || ((FAIL++))
grep -q "idx_nom_alt" "$F" && ((PASS++)) || ((FAIL++))
grep -q "ENABLE ROW LEVEL SECURITY" "$F" && ((PASS++)) || ((FAIL++))
echo "Phase 1A-4: PASS=$PASS FAIL=$FAIL"
[ $FAIL -eq 0 ] && echo "GATE: PASSED" || echo "GATE: FAILED"
```

### Commit

```
feat(db): catalog, options, and vendor tables with full RLS and constraint indexes
```

---

## Phase 1A-5: Client/Sharing Tables Migration

**Goal:** Create snapshot, sharing, commenting, and approval tables. Schema only -- features ship in 1B+.

### Migration: `supabase/migrations/20260409000006_client_sharing_tables.sql`

**Tables:**

1. **`client_project_access`** (junction: which clients can see which projects)
   - `UNIQUE (client_user_id, project_id)`
   - RLS: staff manage, client read own
   - Reference: `rls-authorization-research.md` Section 3

2. **`estimate_snapshots`**
   - `snapshot_type VARCHAR(20)` CHECK ('milestone', 'checkpoint')
   - `snapshot_data JSONB NOT NULL`
   - `schema_version INTEGER NOT NULL DEFAULT 1`
   - `node_count INTEGER`, `total_price DECIMAL(15,4)` (summary metadata)
   - `estimate_status_at_time`, `project_status_at_time`, `version_number_at_time`
   - `restored_at`, `restored_by` (restore tracking)
   - Immutability trigger: `prevent_snapshot_mutation()`
   - RLS: authenticated SELECT, service_role INSERT, no UPDATE/DELETE for data fields
   - Reference: `snapshot-architecture-research.md` "Recommended Solution"

3. **`estimate_shares`**
   - `share_token VARCHAR(64) UNIQUE` (crypto.randomBytes(32).toString('hex'))
   - `pin_hash TEXT` (bcrypt cost 12)
   - `expires_at TIMESTAMPTZ NOT NULL`
   - `failed_attempts INTEGER DEFAULT 0`, `locked_until TIMESTAMPTZ`
   - `is_revoked BOOLEAN DEFAULT FALSE`
   - `access_count INTEGER DEFAULT 0`, `last_accessed_at TIMESTAMPTZ`
   - RLS: staff CRUD, no client/anon access (share validation goes through server-side API)

4. **`estimate_comments`**
   - `author_type VARCHAR(10)` CHECK ('user', 'share')
   - `node_id UUID` (nullable -- comment on entire estimate or specific node)
   - `is_resolved BOOLEAN DEFAULT FALSE`
   - RLS: staff full, client read/write on accessible estimates via share or project access

5. **`estimate_approvals`**
   - `status VARCHAR(20)` CHECK ('approved', 'rejected', 'pending')
   - `option_set_id UUID FK` (nullable -- approval can target specific scenario)
   - `notes TEXT`
   - RLS: staff read, client/share write (create approval record)

### Agent Assignments

| Agent | Scope | Type |
|-------|-------|------|
| Agent 1 | client_project_access + estimate_snapshots + immutability trigger + RLS | Full-capability |
| Agent 2 | estimate_shares + estimate_comments + estimate_approvals + RLS | Full-capability |

### Verification Script

```bash
#!/bin/bash
PASS=0; FAIL=0
F="supabase/migrations/20260409000006_client_sharing_tables.sql"
[ -f "$F" ] && ((PASS++)) || ((FAIL++))
grep -q "estimate_snapshots" "$F" && ((PASS++)) || ((FAIL++))
grep -q "prevent_snapshot_mutation" "$F" && ((PASS++)) || ((FAIL++))
grep -q "share_token VARCHAR(64)" "$F" && ((PASS++)) || ((FAIL++))
grep -q "ENABLE ROW LEVEL SECURITY" "$F" && ((PASS++)) || ((FAIL++))
echo "Phase 1A-5: PASS=$PASS FAIL=$FAIL"
[ $FAIL -eq 0 ] && echo "GATE: PASSED" || echo "GATE: FAILED"
```

### Commit

```
feat(db): client/sharing tables — snapshots, shares, comments, approvals with RLS
```

---

## Phase 1A-6: Triggers

**Goal:** Create all trigger functions with bypass mechanism for snapshot/deep-copy operations.

### Migration: `supabase/migrations/20260409000007_triggers.sql`

**Trigger functions:**

1. **`set_updated_at()`** -- Generic trigger, sets `updated_at = NOW()` on UPDATE. Applied to all tables with `updated_at`.

2. **`maintain_node_path()`** -- Updates ltree `path` column on INSERT/UPDATE of estimate_nodes.
   - Bypass: skipped when `current_setting('app.is_snapshot_copy', true) = 'true'`
   - Path rebuilt in bulk after deep-copy

3. **`enforce_item_leaf_constraint()`** -- Prevents items from having children.
   - Bypass: skipped during snapshot copy

4. **`auto_promote_to_assembly()`** -- Promotes item to assembly when first child is added.
   - Sets `was_auto_promoted = TRUE`
   - Bypass: skipped during snapshot copy

5. **`auto_demote_from_assembly()`** -- Demotes auto-promoted assembly back to item when last child removed.
   - Only if `was_auto_promoted = TRUE`
   - Bypass: skipped during snapshot copy

6. **`update_parent_subtotals()`** -- Recalculates parent node totals when child prices change.
   - Bypass: skipped during snapshot copy (totals are already correct in copied data)

7. **`cascade_sort_order()`** -- Maintains sort order when nodes are reordered.

8. **`prevent_snapshot_mutation()`** -- Already created in 1A-5 (on estimate_snapshots). Listed here for completeness.

9. **`prevent_duplicate_company_settings()`** -- Already created in 1A-3. Listed here for completeness.

**Bypass mechanism pattern:**

```sql
-- At the start of every bypassable trigger:
IF current_setting('app.is_snapshot_copy', true) = 'true' THEN
  RETURN NEW; -- Skip trigger logic during deep-copy/snapshot operations
END IF;
```

The bypass is set via `SET LOCAL app.is_snapshot_copy = 'true'` inside `deep_copy_estimate()` and `restore_estimate_snapshot()`. `SET LOCAL` scopes to the current transaction only, so the bypass cannot leak.

### Agent Assignments

| Agent | Scope | Type |
|-------|-------|------|
| Agent 1 | set_updated_at + maintain_node_path + enforce_item_leaf_constraint | Full-capability |
| Agent 2 | auto_promote/demote + update_parent_subtotals + cascade_sort_order | Full-capability |

### Verification Script

```bash
#!/bin/bash
PASS=0; FAIL=0
F="supabase/migrations/20260409000007_triggers.sql"
[ -f "$F" ] && ((PASS++)) || ((FAIL++))
grep -q "set_updated_at" "$F" && ((PASS++)) || ((FAIL++))
grep -q "maintain_node_path" "$F" && ((PASS++)) || ((FAIL++))
grep -q "app.is_snapshot_copy" "$F" && ((PASS++)) || ((FAIL++))
grep -q "auto_promote" "$F" && ((PASS++)) || ((FAIL++))
grep -q "enforce_item_leaf" "$F" && ((PASS++)) || ((FAIL++))
echo "Phase 1A-6: PASS=$PASS FAIL=$FAIL"
[ $FAIL -eq 0 ] && echo "GATE: PASSED" || echo "GATE: FAILED"
```

### Commit

```
feat(db): trigger functions with snapshot bypass mechanism
```

---

## Phase 1A-7: History Tables

**Goal:** Create history tables and triggers for audit trail.

### Migration: `supabase/migrations/20260409000008_history_tables.sql`

**Tables:**

1. **`estimate_nodes_history`**
   - `id UUID PK`, `original_node_id UUID`, `estimate_id UUID`
   - All columns from `estimate_nodes` (snapshot of changed row)
   - `operation VARCHAR(10)` CHECK ('UPDATE', 'DELETE') -- NO INSERT logging (per C17)
   - `changed_at TIMESTAMPTZ DEFAULT NOW()`
   - `changed_by UUID`
   - Indexes: `(original_node_id, changed_at DESC)`, `(estimate_id, changed_at DESC)`
   - NO RLS (history is server-side only, not exposed via PostgREST)

2. **`node_item_details_history`** -- same pattern for item detail changes.

**History trigger function:**

```sql
CREATE OR REPLACE FUNCTION log_node_history()
RETURNS TRIGGER AS $$
BEGIN
  -- Skip during snapshot/deep-copy operations
  IF current_setting('app.is_snapshot_copy', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Log UPDATE and DELETE only (not INSERT)
  INSERT INTO estimate_nodes_history (...)
  SELECT OLD.*;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Agent Assignments

Single agent -- focused migration.

### Verification Script

```bash
#!/bin/bash
PASS=0; FAIL=0
F="supabase/migrations/20260409000008_history_tables.sql"
[ -f "$F" ] && ((PASS++)) || ((FAIL++))
grep -q "estimate_nodes_history" "$F" && ((PASS++)) || ((FAIL++))
grep -q "log_node_history" "$F" && ((PASS++)) || ((FAIL++))
grep -q "app.is_snapshot_copy" "$F" && ((PASS++)) || ((FAIL++))
echo "Phase 1A-7: PASS=$PASS FAIL=$FAIL"
[ $FAIL -eq 0 ] && echo "GATE: PASSED" || echo "GATE: FAILED"
```

### Commit

```
feat(db): history tables and audit triggers with snapshot bypass
```

---

## Phase 1A-8: Indexes & Seed Data

**Goal:** Create all performance indexes and seed reference data.

### Migration: `supabase/migrations/20260409000009_indexes_and_seeds.sql`

**Indexes:**

| Index | Table | Type | Purpose |
|-------|-------|------|---------|
| `idx_nodes_search` | `estimate_nodes` | GIN on `search_vector` | Full-text search |
| `idx_nodes_flagged` | `estimate_nodes` | Partial btree WHERE flagged = TRUE | Flagged items filter |
| `idx_nodes_total` | `estimate_nodes` | btree on `total_price` WHERE node_type = 'item' | Unpriced/high-cost queries |
| `idx_nodes_estimate` | `estimate_nodes` | btree on `estimate_id` | Tree load |
| `idx_nodes_parent` | `estimate_nodes` | btree on `(estimate_id, parent_id)` | Children queries |
| `idx_nodes_path` | `estimate_nodes` | GiST on `path` | ltree ancestor/descendant queries |
| `idx_estimates_project` | `estimates` | btree on `(project_id, id)` | Client RLS optimization |
| `idx_cpa_client` | `client_project_access` | btree on `(client_user_id, project_id)` | Client RLS optimization |
| `idx_node_notes_node` | `node_notes` | btree on `node_id` WHERE deleted_at IS NULL | Active notes |
| `idx_node_notes_client` | `node_notes` | partial btree WHERE is_client_visible = TRUE AND deleted_at IS NULL | Client note access |
| `idx_snapshots_estimate` | `estimate_snapshots` | btree on `(estimate_id, created_at DESC)` | Snapshot list |
| `idx_snapshots_milestone` | `estimate_snapshots` | partial btree WHERE snapshot_type = 'milestone' | Milestone list |
| `idx_nodes_history_node` | `estimate_nodes_history` | btree on `(original_node_id, changed_at DESC)` | Node history |
| `idx_nodes_history_estimate` | `estimate_nodes_history` | btree on `(estimate_id, changed_at DESC)` | Estimate history |

**Seed Data:**

1. **Units of measure** (common construction units):
   - Each (EA), Square Foot (SF), Linear Foot (LF), Cubic Yard (CY), Square (SQ), Sheet (SHT), Bag (BAG), Gallon (GAL), Hour (HR), Day (DAY), Lump Sum (LS), Allow (ALLOW), Pair (PR), Set (SET), Roll (ROLL), Bundle (BNDL), Pound (LB), Ton (TON)

2. **Cost codes** (CSI MasterFormat top-level divisions):
   - 01 General Requirements, 02 Existing Conditions, 03 Concrete, 04 Masonry, 05 Metals, 06 Wood/Plastics/Composites, 07 Thermal/Moisture Protection, 08 Openings, 09 Finishes, 10 Specialties, 11 Equipment, 12 Furnishings, 21 Fire Suppression, 22 Plumbing, 23 HVAC, 26 Electrical, 31 Earthwork, 32 Exterior Improvements, 33 Utilities

3. **Company settings singleton** -- default rates, placeholder company name
   - Reference: `settings-preferences-research.md` "Seed Data" section

### Agent Assignments

Single agent -- indexes + seed data.

### Verification Script

```bash
#!/bin/bash
PASS=0; FAIL=0
F="supabase/migrations/20260409000009_indexes_and_seeds.sql"
[ -f "$F" ] && ((PASS++)) || ((FAIL++))
grep -q "idx_nodes_search" "$F" && ((PASS++)) || ((FAIL++))
grep -q "idx_nodes_flagged" "$F" && ((PASS++)) || ((FAIL++))
grep -q "units_of_measure" "$F" && ((PASS++)) || ((FAIL++))
grep -q "cost_codes" "$F" && ((PASS++)) || ((FAIL++))
grep -q "company_settings" "$F" && ((PASS++)) || ((FAIL++))
echo "Phase 1A-8: PASS=$PASS FAIL=$FAIL"
[ $FAIL -eq 0 ] && echo "GATE: PASSED" || echo "GATE: FAILED"
```

### Commit

```
feat(db): performance indexes, seed data for units, cost codes, and company settings
```

---

## Phase 1A-9: PostgreSQL Functions

**Goal:** Create the complex database functions that orchestrate multi-table operations.

### Migration: `supabase/migrations/20260409000010_functions.sql`

**Functions:**

1. **`deep_copy_estimate(p_source_estimate_id UUID, p_new_version_label VARCHAR, p_created_by UUID)`**
   - Returns new estimate UUID
   - Copies 14 tables with full FK remapping via temp tables
   - Sets `SET LOCAL app.is_snapshot_copy = 'true'` to bypass triggers
   - Rebuilds ltree paths via recursive CTE after all nodes copied
   - Reference: `deep-copy-function-research.md` -- complete SQL provided

2. **`create_estimate_snapshot(p_estimate_id UUID, p_name VARCHAR, p_description TEXT, p_snapshot_type VARCHAR, p_created_by UUID)`**
   - Returns snapshot UUID
   - Serializes 12+ tables into JSONB with `schema_version = 1`
   - Captures summary metadata (node_count, total_price) for queryable listing
   - Reference: `snapshot-architecture-research.md` -- complete SQL provided

3. **`restore_estimate_snapshot(p_snapshot_id UUID, p_restored_by UUID, p_force BOOLEAN DEFAULT FALSE)`**
   - Auto-saves current state as checkpoint before restore
   - Acquires advisory lock: `pg_advisory_xact_lock(hashtext(estimate_id::text))`
   - Checks estimate status guards (block complete, warn active unless force=true)
   - Deletes current tree data, deserializes snapshot JSONB back into tables
   - Reference: `snapshot-architecture-research.md` -- design documented

4. **`set_subtree_visibility(p_node_id UUID, p_visibility VARCHAR)`**
   - Updates all descendants via ltree `path <@` query
   - Returns count of updated nodes
   - Reference: `client-visibility-research.md` Section 3

5. **`create_toggle_option(p_estimate_id UUID, p_anchor_node_id UUID, p_name VARCHAR, p_description TEXT)`**
   - Creates toggle-type option group with "Excluded" + "Included" alternatives
   - Stamps anchor node descendants with "Included" alternative membership
   - Reference: `options-system-research.md` "Toggle Option Creation Helper"

6. **`compare_option_sets(p_estimate_id UUID)`**
   - Returns table of (option_set_id, option_set_name, total_price) for all sets
   - Simplified SQL version; full calculation with formulas happens in TypeScript
   - Reference: `options-system-research.md` "Option Set Comparison Function"

### Agent Assignments

| Agent | Scope | Type |
|-------|-------|------|
| Agent 1 | `deep_copy_estimate()` -- highest complexity | Full-capability |
| Agent 2 | `create_estimate_snapshot()` + `restore_estimate_snapshot()` | Full-capability |
| Agent 3 | `set_subtree_visibility()` + `create_toggle_option()` + `compare_option_sets()` | Full-capability |

### Verification Script

```bash
#!/bin/bash
PASS=0; FAIL=0
F="supabase/migrations/20260409000010_functions.sql"
[ -f "$F" ] && ((PASS++)) || ((FAIL++))
grep -q "deep_copy_estimate" "$F" && ((PASS++)) || ((FAIL++))
grep -q "create_estimate_snapshot" "$F" && ((PASS++)) || ((FAIL++))
grep -q "restore_estimate_snapshot" "$F" && ((PASS++)) || ((FAIL++))
grep -q "set_subtree_visibility" "$F" && ((PASS++)) || ((FAIL++))
grep -q "create_toggle_option" "$F" && ((PASS++)) || ((FAIL++))
grep -q "_map_nodes" "$F" && ((PASS++)) || ((FAIL++))
grep -q "pg_advisory_xact_lock" "$F" && ((PASS++)) || ((FAIL++))
echo "Phase 1A-9: PASS=$PASS FAIL=$FAIL"
[ $FAIL -eq 0 ] && echo "GATE: PASSED" || echo "GATE: FAILED"
```

### Commit

```
feat(db): PostgreSQL functions — deep_copy, snapshots, visibility, options helpers
```

---

## Phase 1A-10: Generated Types & Domain Types

**Goal:** Generate Supabase types, create domain types with discriminated unions, and build validation schemas.

### Step 1: Generate Supabase Types

```bash
npx supabase gen types typescript --local > src/lib/types/supabase.ts
```

### Step 2: Domain Type Files

All type files were created in Phase 1A-0 as stubs. Now populate them fully using the generated `Database` type as the source of truth.

| File | Key Types | Reference |
|------|-----------|-----------|
| `src/lib/types/domain/nodes.ts` | `NodeWithDetails`, `GroupNode`, `AssemblyNode`, `ItemNode`, `TreeNode`, `NodeBase`, `ItemDetails`, `AssemblyDetails` | `type-system-research.md` Section 1 |
| `src/lib/types/domain/snapshots.ts` | `SnapshotNode` (branded), `SnapshotData`, `SnapshotNodeRecord`, `SnapshotItemDetails` | `type-system-research.md` Section 2 |
| `src/lib/types/action-result.ts` | `ActionResult<T>`, `ActionSuccess<T>`, `ActionError`, `ErrorCode`, `ok()`, `err()` | `type-system-research.md` Section 3 |
| `src/lib/types/enums.ts` | `PROJECT_STATUS`, `ESTIMATE_STATUS`, labels, descriptions, type guards, ordinals | `enum-strategy-research.md` |
| `src/lib/types/options.ts` | `OptionGroup`, `OptionAlternative`, `OptionSet`, `NodeOptionMembership`, input types | `options-system-research.md` |
| `src/lib/types/settings.ts` | `CompanySettings`, `CompanySettingsJson`, `CompanyAddress` | `settings-preferences-research.md` |
| `src/lib/types/preferences.ts` | `UserPreferences`, `EstimateViewState`, `UserPreferencesJson` | `settings-preferences-research.md` |
| `src/lib/types/status-transitions.ts` | `evaluateProjectTransition()`, `evaluateEstimateTransition()`, `TransitionResult` | `enum-strategy-research.md` |

### Step 3: Supabase Client Typing

Update all Supabase client files to use `Database` generic:

```typescript
// src/lib/supabase/client.ts
import type { Database } from '@/lib/types/supabase';
createBrowserClient<Database>(...)

// src/lib/supabase/server.ts
import type { Database } from '@/lib/types/supabase';
createServerClient<Database>(...)

// src/lib/supabase/admin.ts
import type { Database } from '@/lib/types/supabase';
createClient<Database>(...)
```

### Step 4: Validation Schemas (Zod)

| File | Schemas |
|------|---------|
| `src/lib/validation/status.ts` | `projectStatusSchema`, `estimateStatusSchema` |
| `src/lib/validation/projects.ts` | `createProjectSchema`, `updateProjectSchema` |
| `src/lib/validation/estimates.ts` | `createEstimateSchema`, `updateEstimateSchema` |
| `src/lib/validation/nodes.ts` | `createNodeSchema`, `updateNodeSchema`, `moveNodeSchema`, `duplicateNodeSchema` |
| `src/lib/validation/settings.ts` | `companySettingsUpdateSchema`, `companySettingsJsonSchema` |
| `src/lib/validation/preferences.ts` | `userPreferencesJsonSchema`, `estimateViewStateJsonSchema` |
| `src/lib/validation/options.ts` | `createOptionGroupSchema`, `createOptionAlternativeSchema`, `switchAlternativeSchema` |
| `src/lib/validation/snapshots.ts` | `createSnapshotSchema`, `restoreSnapshotSchema` |
| `src/lib/validation/format-error.ts` | `formatZodError()` utility for user-facing error messages |

### Step 5: Options Tree Filter Utility

| File | Exports |
|------|---------|
| `src/lib/options/filter-active-tree.ts` | `buildMembershipMap()`, `getDeselectedFromLive()`, `getDeselectedForOptionSet()`, `filterActiveTree()`, `getTreesForAllOptionSets()` |

Reference: `options-system-research.md` "TypeScript: Active Tree Filter Function"

### Agent Assignments

| Agent | Scope | Type |
|-------|-------|------|
| Agent 1 | Run supabase gen types + update all client files with Database generic | Full-capability |
| Agent 2 | Domain type files (nodes, snapshots, enums, options, settings, preferences) | Full-capability |
| Agent 3 | Zod validation schemas (all 9 files) + format-error utility | Full-capability |
| Agent 4 | Options tree filter utility + status-transitions | Full-capability |

### Verification Script

```bash
#!/bin/bash
PASS=0; FAIL=0

# Generated types exist
[ -f "src/lib/types/supabase.ts" ] && ((PASS++)) || ((FAIL++))
grep -q "Database" "src/lib/types/supabase.ts" && ((PASS++)) || ((FAIL++))

# Domain types exist
for f in "src/lib/types/domain/nodes.ts" "src/lib/types/domain/snapshots.ts" \
         "src/lib/types/action-result.ts" "src/lib/types/enums.ts" \
         "src/lib/types/options.ts" "src/lib/types/settings.ts" \
         "src/lib/types/preferences.ts" "src/lib/types/status-transitions.ts"; do
  [ -f "$f" ] && ((PASS++)) || ((FAIL++))
done

# Validation schemas exist
for f in "src/lib/validation/status.ts" "src/lib/validation/projects.ts" \
         "src/lib/validation/estimates.ts" "src/lib/validation/nodes.ts" \
         "src/lib/validation/settings.ts" "src/lib/validation/preferences.ts" \
         "src/lib/validation/options.ts" "src/lib/validation/snapshots.ts" \
         "src/lib/validation/format-error.ts"; do
  [ -f "$f" ] && ((PASS++)) || ((FAIL++))
done

# Options filter exists
[ -f "src/lib/options/filter-active-tree.ts" ] && ((PASS++)) || ((FAIL++))

# Supabase clients are typed
grep -q "Database" "src/lib/supabase/client.ts" && ((PASS++)) || ((FAIL++))
grep -q "Database" "src/lib/supabase/server.ts" && ((PASS++)) || ((FAIL++))

# Key type patterns exist
grep -q "NodeWithDetails" "src/lib/types/domain/nodes.ts" && ((PASS++)) || ((FAIL++))
grep -q "ActionResult" "src/lib/types/action-result.ts" && ((PASS++)) || ((FAIL++))
grep -q "ErrorCode" "src/lib/types/action-result.ts" && ((PASS++)) || ((FAIL++))

# TypeScript compiles
npx tsc --noEmit 2>/dev/null && ((PASS++)) || ((FAIL++))

echo "Phase 1A-10: PASS=$PASS FAIL=$FAIL"
[ $FAIL -eq 0 ] && echo "GATE: PASSED" || echo "GATE: FAILED"
```

### Commit

```
feat(types): generated types, domain models, validation schemas, options filter utility
```

---

## Phase 1A-11: Server Actions

**Goal:** Create ~30 server actions organized by entity, all returning `ActionResult<T>`.

### File Organization: `src/lib/actions/`

| File | Actions | Count |
|------|---------|-------|
| `projects.ts` | `createProject`, `updateProject`, `deleteProject`, `getProject`, `listProjects`, `updateProjectStatus` | 6 |
| `estimates.ts` | `createEstimate`, `updateEstimate`, `deleteEstimate`, `getEstimate`, `listEstimates`, `updateEstimateStatus`, `createVersion` | 7 |
| `nodes.ts` | `createNode`, `updateNode`, `deleteNode`, `moveNode`, `duplicateNode`, `convertNodeType`, `toggleFlag`, `setVisibility`, `setSubtreeVisibility` | 9 |
| `snapshots.ts` | `createSnapshot`, `restoreSnapshot`, `createEstimateFromSnapshot`, `listSnapshots`, `getSnapshot`, `deleteCheckpoints` | 6 |
| `options.ts` | `createOptionGroup`, `createOptionAlternative`, `switchAlternative`, `addNodeToAlternative`, `removeNodeFromAlternative`, `createToggleOption` | 6 |
| `option-sets.ts` | `createOptionSet`, `updateOptionSet`, `deleteOptionSet`, `applyOptionSet`, `saveCurrentAsOptionSet`, `compareOptionSets` | 6 |
| `settings.ts` | `getCompanySettings`, `updateCompanySettings` | 2 |
| `preferences.ts` | `getUserPreferences`, `updateUserPreferences`, `getEstimateViewState`, `upsertEstimateViewState` | 4 |
| `notes.ts` | `createNote`, `updateNote`, `deleteNote` (soft), `listNotesForNode` | 4 |
| `catalog.ts` | `addToCatalog`, `updateFromCatalog`, `listCatalogItems` (stubs for 1B) | 3 |
| `search.ts` | `searchNodes` (full-text search stub for 1B) | 1 |

**Total: ~54 action functions** (some are simple wrappers)

### Pattern for Every Action

```typescript
'use server';

import { createServerClient } from '@/lib/supabase/server';
import { ok, err, ERROR_CODE } from '@/lib/types/action-result';
import { createNodeSchema } from '@/lib/validation/nodes';
import type { ActionResult } from '@/lib/types/action-result';
import type { NodeWithDetails } from '@/lib/types/domain/nodes';

export async function createNode(input: unknown): Promise<ActionResult<NodeWithDetails>> {
  const parsed = createNodeSchema.safeParse(input);
  if (!parsed.success) {
    return err('Invalid input', ERROR_CODE.VALIDATION_ERROR, formatZodError(parsed.error));
  }

  const supabase = await createServerClient();
  const { data, error } = await supabase.from('estimate_nodes').insert({...}).select().single();

  if (error) {
    return err('Failed to create node', ERROR_CODE.DATABASE_ERROR);
  }

  return ok(mapToNodeWithDetails(data));
}
```

### Agent Assignments

| Agent | Scope | Type |
|-------|-------|------|
| Agent 1 | `projects.ts` + `estimates.ts` (13 actions) | Full-capability |
| Agent 2 | `nodes.ts` (9 actions -- most complex) | Full-capability |
| Agent 3 | `snapshots.ts` + `notes.ts` (10 actions) | Full-capability |
| Agent 4 | `options.ts` + `option-sets.ts` (12 actions) | Full-capability |
| Agent 5 | `settings.ts` + `preferences.ts` + `catalog.ts` + `search.ts` (10 actions) | Full-capability |

### Verification Script

```bash
#!/bin/bash
PASS=0; FAIL=0
for f in "src/lib/actions/projects.ts" "src/lib/actions/estimates.ts" \
         "src/lib/actions/nodes.ts" "src/lib/actions/snapshots.ts" \
         "src/lib/actions/options.ts" "src/lib/actions/option-sets.ts" \
         "src/lib/actions/settings.ts" "src/lib/actions/preferences.ts" \
         "src/lib/actions/notes.ts" "src/lib/actions/catalog.ts" \
         "src/lib/actions/search.ts"; do
  [ -f "$f" ] && ((PASS++)) || ((FAIL++))
done

# All action files use ActionResult
for f in src/lib/actions/*.ts; do
  grep -q "ActionResult" "$f" && ((PASS++)) || ((FAIL++))
done

# All action files use 'use server'
for f in src/lib/actions/*.ts; do
  grep -q "'use server'" "$f" && ((PASS++)) || ((FAIL++))
done

# TypeScript compiles
npx tsc --noEmit 2>/dev/null && ((PASS++)) || ((FAIL++))

echo "Phase 1A-11: PASS=$PASS FAIL=$FAIL"
[ $FAIL -eq 0 ] && echo "GATE: PASSED" || echo "GATE: FAILED"
```

### Commit

```
feat(actions): ~30 server actions for projects, estimates, nodes, snapshots, options, settings
```

---

## Phase 1A-12: Comprehensive Tests

**Goal:** 114+ test cases covering triggers, constraints, snapshots, RLS, actions, and validation.

### Test Infrastructure Setup

| File | Purpose |
|------|---------|
| `tests/setup/db-helpers.ts` | Database connection helpers, admin client setup |
| `tests/setup/role-helpers.ts` | Role-switching utilities (owner, employee, client, pending, anon) |
| `tests/setup/seed-factories.ts` | Factory functions: `createTestProject()`, `createTestEstimate()`, `createTestNode()`, `createTestUser()` |
| `tests/setup/cleanup.ts` | Transaction isolation, test data cleanup |
| `vitest.config.db.ts` | Vitest config for database integration tests |

### Test Suites

| Suite | File | Test Count | Priority |
|-------|------|-----------|----------|
| **Snapshot round-trip** | `tests/db/snapshots.test.ts` | 15 | CRITICAL |
| **Deep copy** | `tests/db/deep-copy.test.ts` | 12 | CRITICAL |
| **RLS policies** | `tests/db/rls.test.ts` | 20 | CRITICAL |
| **Trigger correctness** | `tests/db/triggers.test.ts` | 15 | HIGH |
| **Constraint enforcement** | `tests/db/constraints.test.ts` | 15 | HIGH |
| **Client visibility** | `tests/db/client-visibility.test.ts` | 12 | HIGH |
| **Options system** | `tests/db/options.test.ts` | 10 | HIGH |
| **Company settings** | `tests/db/company-settings.test.ts` | 12 | MEDIUM |
| **Enum validation** | `tests/db/enums.test.ts` | 10 | MEDIUM |
| **Server actions** | `tests/actions/*.test.ts` | ~20 | MEDIUM |
| **Validation schemas** | `tests/validation/*.test.ts` | ~15 | LOW |
| **TypeScript type guards** | `tests/types/*.test.ts` | ~8 | LOW |

**Total: 164+ test cases**

### Critical Test Details

**Snapshot round-trip tests (15):**
1. Create snapshot of empty estimate
2. Create snapshot of estimate with 10 nodes (items, groups, assemblies)
3. Create snapshot with option groups and alternatives
4. Create snapshot with notes (internal + client-visible)
5. Verify snapshot JSONB contains all serialized tables
6. Verify snapshot metadata (node_count, total_price) matches tree
7. Restore snapshot to same estimate -- verify tree matches original
8. Restore verifies auto-checkpoint is created before restore
9. Restore blocked when estimate status is 'complete'
10. Restore with force=true works when status is 'active'
11. Snapshot immutability -- UPDATE snapshot_data fails
12. Snapshot immutability -- DELETE fails
13. Restore with advisory lock prevents concurrent restore
14. Create estimate from snapshot -- new estimate_id, same tree
15. Schema version stored correctly (schema_version = 1)

**Deep copy tests (12):**
1. Copy empty estimate
2. Copy estimate with nodes -- verify new IDs
3. Copy preserves tree structure (parent-child relationships)
4. Copy remaps all FKs correctly (option groups, alternatives, memberships)
5. Copy increments version_number
6. Copy sets new estimate as is_current = TRUE
7. Copy rebuilds ltree paths correctly
8. Copy preserves node_item_details with remapped node_id
9. Copy preserves node_notes with remapped node_id
10. Copy preserves option_set_selections with remapped group/alternative IDs
11. Copy does NOT trigger history logging (bypass works)
12. Performance: copy 1000-node estimate in <500ms

**RLS tests (20):**
- Reference: `client-visibility-research.md` test cases 4-16
- Reference: `settings-preferences-research.md` test cases CS-1 through EVS-8
- Reference: `rls-authorization-research.md` Section 4

### Agent Assignments

| Agent | Scope | Type |
|-------|-------|------|
| Agent 1 | Test infrastructure (helpers, factories, cleanup, vitest config) | Full-capability |
| Agent 2 | Snapshot + deep-copy tests (27 tests) | Full-capability |
| Agent 3 | RLS + client visibility tests (32 tests) | Full-capability |
| Agent 4 | Trigger + constraint + enum tests (40 tests) | Full-capability |
| Agent 5 | Options + settings tests (22 tests) | Full-capability |
| Agent 6 | Server action + validation + type guard tests (43 tests) | Full-capability |

### Verification Script

```bash
#!/bin/bash
PASS=0; FAIL=0

# Test files exist
for f in "tests/db/snapshots.test.ts" "tests/db/deep-copy.test.ts" \
         "tests/db/rls.test.ts" "tests/db/triggers.test.ts" \
         "tests/db/constraints.test.ts" "tests/db/client-visibility.test.ts" \
         "tests/db/options.test.ts" "tests/db/company-settings.test.ts" \
         "tests/db/enums.test.ts"; do
  [ -f "$f" ] && ((PASS++)) || ((FAIL++))
done

# Infrastructure exists
for f in "tests/setup/db-helpers.ts" "tests/setup/role-helpers.ts" \
         "tests/setup/seed-factories.ts" "tests/setup/cleanup.ts"; do
  [ -f "$f" ] && ((PASS++)) || ((FAIL++))
done

# Count total test cases (approximate via 'it(' or 'test(' counts)
TOTAL=$(grep -r "it\(\|test\(" tests/ 2>/dev/null | wc -l)
[ "$TOTAL" -ge 100 ] && ((PASS++)) || ((FAIL++))

# Tests pass
npx vitest run --config vitest.config.db.ts 2>/dev/null && ((PASS++)) || ((FAIL++))

echo "Phase 1A-12: PASS=$PASS FAIL=$FAIL (Total test cases found: $TOTAL)"
[ $FAIL -eq 0 ] && echo "GATE: PASSED" || echo "GATE: FAILED"
```

### Commit

```
test(db): comprehensive test suite — 114+ tests for triggers, RLS, snapshots, deep-copy, actions
```

---

## Phase 1B: Features (High-Level)

Phase 1B builds user-facing features on top of the Phase 1A schema foundation. Each sub-phase is independently shippable.

### 1B-1: Snapshot UI (2-3 sessions)

**Deliverables:**
- "Create Snapshot" dialog (name, description, auto-detect status)
- Snapshot browser panel (list milestones, collapsible checkpoints)
- Snapshot viewer (read-only tree render with snapshot data)
- "Restore from Snapshot" with status-based guards and confirmation
- "Create Estimate from Snapshot" action
- Snapshot comparison (side-by-side tree diff, price delta)

**Dependencies:** Phase 1A complete, estimate tree UI exists

### 1B-2: Catalog System (2-3 sessions)

**Deliverables:**
- "Add to Catalog" -- save node (item/group/assembly) as reusable template
- Catalog browser panel with search and filtering
- "Insert from Catalog" -- add catalog entry to current estimate
- "Update from Catalog" -- refresh node from catalog source (diff view)
- Catalog version tracking (`catalog_source_id`, `catalog_version` on nodes)

**Dependencies:** Phase 1A complete, node CRUD UI exists

### 1B-3: Options UI (2-3 sessions)

**Deliverables:**
- "Create Option Group" workflow (selection vs toggle types)
- Alternative management (add, rename, switch selected)
- Visual indicators for option-owned nodes in tree
- Option set management (create, name, edit selections)
- Option set comparison table (side-by-side totals)
- Active tree filtering (show/hide nodes based on selections)

**Dependencies:** Phase 1A complete, Phase 2 calculation engine (for accurate totals)

### 1B-4: Client Portal (3-4 sessions)

**Deliverables:**
- Share link generation UI (create link, set PIN, set expiry)
- Share link validation endpoint (server-side API route with rate limiting)
- Client estimate viewer (filtered by client_visibility, uses client VIEWs)
- Client commenting (add/edit comments on nodes, threaded?)
- Client approval workflow (approve/reject estimate or option set)
- Builder notification of client actions

**Dependencies:** Phase 1A complete, share link schema, RLS policies for client role

### 1B-5: Search & Filtering (1-2 sessions)

**Deliverables:**
- Search box component with live filtering
- Full-text search using tsvector (Postgres function call)
- Filter bar: node type, cost code, phase, cost range, flagged
- Jump-to shortcuts: cost code, unpriced items, items over $X
- Scope selector: current estimate, all project estimates, global
- Search result highlighting in tree

**Dependencies:** Phase 1A complete (GIN indexes exist), estimate tree UI

### 1B-6: User Preferences & Company Settings UI (1 session)

**Deliverables:**
- Company settings form (financial rates, company info, terms)
- User preferences panel (theme, sidebar, defaults)
- Estimate view state persistence (debounced expand/collapse save)
- `useViewState` custom hook with 3-second debounce
- `beforeunload` / `visibilitychange` save safety net

**Dependencies:** Phase 1A complete

---

## Phase 2+: Roadmap

### Phase 2A: Calculation Engine (3-4 sessions)

- Formula parser (math.js integration)
- Isomorphic calculation pipeline (runs same logic server + client)
- Subtotal/contingency/overhead/total rollup through tree
- Cross-reference calculations (reference_name system)
- Broad option parameter application
- Quantity formulas (numeric, formula, ratio modes)
- Waste factor, min order qty, package size adjustments

### Phase 2B: Reporting & Exports (2-3 sessions)

- Estimate summary report (cost breakdown by division/phase)
- Detailed estimate report (line-item level)
- Option set comparison report
- CSV/Excel export
- Print-optimized layouts

### Phase 2C: PDF Generation (1-2 sessions)

- PDF proposal generation (branded output)
- PDF estimate attachment for share links
- Integration with branding system (logo, colors, terms from company_settings)

### Phase 2D: Figma Design Integration (2-3 sessions)

- Design system refinement via Figma Design System
- Component library alignment
- Visual design for client portal
- Responsive/mobile layouts

### Phase 2E: Mobile/Tablet Optimization (1-2 sessions)

- Touch-friendly tree navigation
- Responsive estimate grid
- Mobile-optimized client view
- PWA capabilities

---

## Dependency DAG

```
Phase 1A-0 (Security Foundation)
  |
  v
Phase 1A-1 (Enums & Extensions)
  |
  v
Phase 1A-2 (Core Tables) ─────────────────────────────────────┐
  |                                                            |
  v                                                            v
Phase 1A-3 (Supporting Tables)    Phase 1A-4 (Catalog/Options) |
  |                                  |                         |
  v                                  v                         |
Phase 1A-5 (Client/Sharing Tables) <───────────────────────────┘
  |
  v
Phase 1A-6 (Triggers) ── requires all tables exist
  |
  v
Phase 1A-7 (History Tables) ── requires triggers
  |
  v
Phase 1A-8 (Indexes & Seeds) ── requires all tables + triggers
  |
  v
Phase 1A-9 (Functions) ── requires tables + triggers + indexes
  |
  v
Phase 1A-10 (Types) ── requires final schema (supabase gen types)
  |
  v
Phase 1A-11 (Server Actions) ── requires types + validation
  |
  v
Phase 1A-12 (Tests) ── requires everything above

──────────────────────────────────────────────────────────────

Phase 1B-1 (Snapshots UI) ─────────────┐
Phase 1B-2 (Catalog) ──────────────────┤
Phase 1B-3 (Options UI) ───────────────┤── all require 1A complete
Phase 1B-4 (Client Portal) ────────────┤
Phase 1B-5 (Search) ───────────────────┤
Phase 1B-6 (Preferences UI) ──────────┘

Phase 2A (Calc Engine) ← Phase 1B-3 (Options) needs this for accurate totals
Phase 2B (Reports) ← Phase 2A
Phase 2C (PDF) ← Phase 2B
```

**Parallel opportunities within Phase 1A:**
- 1A-3 and 1A-4 can run in parallel (both depend only on 1A-2)
- 1A-5 depends on 1A-2 but NOT on 1A-3/1A-4
- Within each phase, agents run in parallel on independent tables

---

## Conflict Matrix

Files potentially touched by multiple phases:

| File | Phases | Resolution |
|------|--------|------------|
| `src/lib/types/supabase.ts` | 1A-10 (generated) | Only generated in 1A-10; all prior phases create SQL only |
| `src/lib/supabase/client.ts` | 1A-0 (exists), 1A-10 (add Database generic) | 1A-0 stubs the import; 1A-10 fills it |
| `src/lib/supabase/server.ts` | Same as client.ts | Same resolution |
| `src/middleware.ts` | 1A-0 (pending role check) | Only modified in 1A-0 |
| `src/lib/types/domain/nodes.ts` | 1A-0 (stub), 1A-10 (populate) | 1A-0 creates file; 1A-10 fills with real generated types |
| `tsconfig.json` | 1A-0 (add strict flags) | Only modified in 1A-0 |

**No two phases write to the same migration file.** Each phase has its own numbered migration.

---

## Verification Gates

### Pre-Commit Gate (every phase)

```bash
#!/bin/bash
# Run before every commit
echo "=== Pre-Commit Verification ==="

# 1. TypeScript compiles
npx tsc --noEmit && echo "PASS: TypeScript" || echo "FAIL: TypeScript"

# 2. Lint passes
npx next lint && echo "PASS: Lint" || echo "FAIL: Lint"

# 3. Build succeeds
npm run build && echo "PASS: Build" || echo "FAIL: Build"

# 4. Supabase migration is valid (if migrations changed)
if git diff --cached --name-only | grep -q "supabase/migrations"; then
  npx supabase db reset && echo "PASS: Migration reset" || echo "FAIL: Migration reset"
fi
```

### RLS Gate (after every migration that creates tables)

```bash
#!/bin/bash
# Verify every table has RLS enabled
echo "=== RLS Gate ==="
TABLES_WITHOUT_RLS=$(psql "$DATABASE_URL" -t -c "
  SELECT tablename FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename NOT IN ('schema_migrations')
    AND tablename NOT IN (
      SELECT tablename FROM pg_tables t
      JOIN pg_policies p ON p.tablename = t.tablename
      WHERE t.schemaname = 'public'
    );
")

if [ -z "$TABLES_WITHOUT_RLS" ]; then
  echo "PASS: All tables have RLS policies"
else
  echo "FAIL: Tables without RLS: $TABLES_WITHOUT_RLS"
fi
```

---

## Session Estimates

| Phase | Est. Sessions | Agent Count | Key Risk |
|-------|--------------|-------------|----------|
| 1A-0 | 0.5 | 3 | tsconfig strict flags may cause existing code errors |
| 1A-1 | 0.25 | 1 | Low risk |
| 1A-2 | 0.5 | 3 | Core table definitions must be exactly right |
| 1A-3 | 0.25 | 2 | Low risk |
| 1A-4 | 0.5 | 3 | Options system complexity |
| 1A-5 | 0.25 | 2 | Snapshot immutability trigger |
| 1A-6 | 0.5 | 2 | Trigger bypass mechanism must be bulletproof |
| 1A-7 | 0.25 | 1 | Low risk |
| 1A-8 | 0.25 | 1 | Low risk |
| 1A-9 | 0.5 | 3 | deep_copy is highest-risk function |
| 1A-10 | 0.5 | 4 | Generated types must match schema exactly |
| 1A-11 | 0.75 | 5 | Volume of actions; consistency of patterns |
| 1A-12 | 1.0 | 6 | Test infrastructure setup; snapshot round-trip correctness |
| **Total 1A** | **~5.5** | **max 6** | |
| 1B (all) | 4-6 | varies | UI complexity, design system adherence |
| 2+ | TBD | varies | Calculation engine algorithm correctness |

---

## Migration File Summary

| Order | File | Phase | Contents |
|-------|------|-------|----------|
| 1 | `20260409000001_security_foundation.sql` | 1A-0 | get_user_role, user_profiles, helpers, triggers, grants |
| 2 | `20260409000002_extensions_and_enums.sql` | 1A-1 | ltree, pg_trgm, project_status, estimate_status |
| 3 | `20260409000003_core_tables.sql` | 1A-2 | projects, estimates, estimate_nodes, detail tables, node_notes, client VIEWs |
| 4 | `20260409000004_supporting_tables.sql` | 1A-3 | units, cost_codes, phases, parameters, company_settings, preferences, view_state |
| 5 | `20260409000005_catalog_options_vendors.sql` | 1A-4 | vendors, catalog tables, option system (9 tables) |
| 6 | `20260409000006_client_sharing_tables.sql` | 1A-5 | client_project_access, snapshots, shares, comments, approvals |
| 7 | `20260409000007_triggers.sql` | 1A-6 | All trigger functions with bypass |
| 8 | `20260409000008_history_tables.sql` | 1A-7 | History tables + history triggers |
| 9 | `20260409000009_indexes_and_seeds.sql` | 1A-8 | All indexes + seed data |
| 10 | `20260409000010_functions.sql` | 1A-9 | deep_copy, snapshot functions, visibility, options helpers |

---

## TypeScript File Summary

| Directory | Files | Phase |
|-----------|-------|-------|
| `src/lib/types/` | `enums.ts`, `action-result.ts`, `settings.ts`, `preferences.ts`, `options.ts`, `status-transitions.ts`, `supabase.ts` | 1A-0, 1A-10 |
| `src/lib/types/domain/` | `nodes.ts`, `snapshots.ts` | 1A-0, 1A-10 |
| `src/lib/validation/` | `status.ts`, `projects.ts`, `estimates.ts`, `nodes.ts`, `settings.ts`, `preferences.ts`, `options.ts`, `snapshots.ts`, `format-error.ts` | 1A-10 |
| `src/lib/actions/` | `projects.ts`, `estimates.ts`, `nodes.ts`, `snapshots.ts`, `options.ts`, `option-sets.ts`, `settings.ts`, `preferences.ts`, `notes.ts`, `catalog.ts`, `search.ts` | 1A-11 |
| `src/lib/options/` | `filter-active-tree.ts` | 1A-10 |
| `tests/setup/` | `db-helpers.ts`, `role-helpers.ts`, `seed-factories.ts`, `cleanup.ts` | 1A-12 |
| `tests/db/` | 9 test files | 1A-12 |
| `tests/actions/` | action test files | 1A-12 |
| `tests/validation/` | validation test files | 1A-12 |

---

## Research File Index

All research is in `.scratch/epp/20260408-2040/phase-3/research/`:

| File | Governs | Primary Phases |
|------|---------|---------------|
| `snapshot-architecture-research.md` | Snapshot JSONB schema, create/restore functions, immutability | 1A-5, 1A-9 |
| `rls-authorization-research.md` | get_user_role, user_profiles, RLS matrix, client access | 1A-0, all tables |
| `client-visibility-research.md` | 3-value VARCHAR, field visibility matrix, client VIEWs, notes | 1A-2, 1A-5 |
| `options-system-research.md` | group_type, toggle options, active tree filter, option sets | 1A-4, 1A-10 |
| `enum-strategy-research.md` | CREATE TYPE decision, 4 vs 6 statuses, transition guardrails | 1A-1, 1A-10 |
| `type-system-research.md` | NodeWithDetails union, ActionResult, error codes, Zod inventory | 1A-0, 1A-10 |
| `deep-copy-function-research.md` | Table copy order, FK remapping, trigger bypass, advisory locks | 1A-9 |
| `settings-preferences-research.md` | Hybrid company_settings, user_preferences PK, view_state debounce | 1A-3, 1A-10 |
