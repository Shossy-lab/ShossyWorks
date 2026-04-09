# ShossyWorks Implementation Plan v2 (Revised)

## Changelog from v1

Every change below references the specific feedback item that triggered it.

### BLOCKING fixes

| # | Change | Feedback Source |
|---|--------|----------------|
| B1 | **Reordered migrations: reference/lookup tables BEFORE core tables.** Moved `units_of_measure`, `cost_codes` to Phase 1A-2 (top of migration), `phases` created after `projects`. Core tables with FK references to these now resolve correctly. | Dependency Issue 2, Dependency Concern 4 |
| B2 | **Deferred `client_has_project_access()` and ALL client-role RLS policies to Phase 1A-5.** The function queries `client_project_access` which does not exist until 1A-5. Phases 1A-2 through 1A-4 now contain only staff/owner/pending/anon policies. Phase 1A-5 creates the table, the helper function, and then adds client RLS policies to all prior tables via `CREATE POLICY`. | Dependency Issue 1, Dependency Issue 9, Correctness Issue 9, Risk Issue 3 |
| B3 | **Split user_roles -> user_profiles into two migrations.** Migration 1A-0a creates `user_profiles`, migrates data, updates hook/triggers. Migration 1A-0b drops `user_roles` ONLY after 1A-0a succeeds. Added explicit atomicity note and rollback documentation. | Feasibility Issue 3, Risk Issue 1 |
| B4 | **Deferred aggressive tsconfig flags to post-1A.** Only `noImplicitReturns` is added now (safe). `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are deferred to a hardening pass after Phase 1A completes. | Feasibility Issue 2, Risk Issue 4 |
| B5 | **Added Phase 1A Prerequisites section** with Docker/Supabase startup, `supabase db reset` validation, `custom_access_token_hook` registration check in `config.toml`. | Feasibility Issue 6 |
| B6 | **Added explicit Recovery Strategy section.** Nuclear rollback is `supabase db reset` (no production data). Stated for every phase. | Risk Issue 2, Feasibility Concern B |
| B7 | **Unified trigger bypass variable to `app.is_snapshot_copy` everywhere.** `restore_estimate_snapshot()` now uses `app.is_snapshot_copy`, not `app.is_snapshot_restore`. Eliminated `app.allow_snapshot_mutation`. | Correctness Issue 1, Correctness Concern 1 |

### MAJOR fixes

| # | Change | Feedback Source |
|---|--------|----------------|
| M1 | **Reduced Phase 1A server actions to CORE ONLY.** Kept: `projects.ts`, `estimates.ts`, `nodes.ts`, `snapshots.ts` (28 actions). Deferred to 1B: `catalog.ts`, `search.ts`, `option-sets.ts`, `notes.ts`, `options.ts` (26 actions). Server actions now ship alongside their consuming UI. | Feasibility Issue 4, Risk Issue 7 |
| M2 | **Reduced Phase 1A tests to CORE ONLY.** Kept: triggers, constraints, RLS, snapshot round-trip, deep-copy (~82 tests). Deferred to 1B: server action tests, validation tests, type guard tests, catalog/options/settings tests (~82 tests). | Feasibility Issue 5, Risk Issue 7, Risk Concern 4 |
| M3 | **Added reference action implementation step.** Before parallel agent deployment in 1A-11, one agent creates `_shared.ts` utility + `projects.ts` as a reference implementation. Remaining agents follow the established pattern. | Feasibility Issue 10 |
| M4 | **Removed `node_attachments` from deep-copy function.** Table does not exist in any migration. Added TODO comment in deep_copy for future addition. | Completeness Issue 1, Correctness Issue 7 |
| M5 | **Added `create_estimate_from_snapshot()` PostgreSQL function** to Phase 1A-9. | Completeness Issue 6 |
| M6 | **Fixed `estimate_status_at_time` to use enum type** instead of VARCHAR(50). | Correctness Issue 2 |
| M7 | **Fixed `node_notes.format` CHECK to `('markdown', 'html')`** matching all research files. | Correctness Issue 3 |
| M8 | **Added `CHECK (is_internal OR is_client_visible)` constraint** to `node_notes` to prevent invisible notes. | Correctness Issue 4 |
| M9 | **Fixed option_groups RLS to use `is_staff()` pattern** consistently with all other tables. | Correctness Issue 5 |
| M10 | **Resolved snapshot immutability trigger conflict.** Using column-by-column check from snapshot research (allows restore-tracking column updates). Eliminated session-variable-based approach. | Correctness Issue 6 |
| M11 | **Clarified snapshot INSERT policy: function-only via SECURITY DEFINER.** INSERT RLS is `TO service_role` only. Staff create snapshots through the `create_estimate_snapshot()` function. | Correctness Issue 8 |
| M12 | **Updated DAG: 1A-5 depends on BOTH 1A-2 AND 1A-4** (estimate_approvals has FK to option_sets). | Dependency Issue 3 |
| M13 | **Consolidated ALL index creation in Phase 1A-8.** Removed inline indexes from Phase 1A-7. | Dependency Issue 5 |
| M14 | **Added table-dependency annotations to trigger functions** in Phase 1A-6. | Dependency Issue 7 |
| M15 | **Added documentation update phase (1A-13).** Updates CODEBASE_MAP.md, INTENT.md, CONTRACT-INDEX.md, creates contracts for new feature boundaries. | Completeness Issue 4 |
| M16 | **Added session handoff document requirement.** Each session writes a cumulative "Phase 1A State" document for cross-session context. | Risk Issue 6 |
| M17 | **Updated session estimates to 6-7 sessions** (realistic with debugging buffer). | Feasibility Concern A, Risk scope assessment |
| M18 | **Moved test infrastructure setup to Phase 1A-10** (alongside type generation) so server actions can validate against it immediately. | Risk Issue 5 |
| M19 | **Added savepoint pattern to `restore_estimate_snapshot()`** for safe rollback if deserialization fails. | Risk Issue 8 |
| M20 | **Enabled RLS on history tables with deny-all policy** + service_role bypass. | Risk Issue 9 |
| M21 | **Added `supabase db reset` as mandatory first step in Phase 1A-10.** | Feasibility Concern C |
| M22 | **Moved `broad_options` and `broad_option_overrides` to Phase 1A-4** (they are feature tables, not reference tables). | Feasibility Issue 8 |
| M23 | **Fixed Phase 1A-2 verification script** to check per-table RLS, not just any occurrence. | Feasibility Issue 9 |
| M24 | **Added `was_auto_promoted` to snapshot serialization.** | Correctness Issue 10 |
| M25 | **Added explicit note that `app_role` enum ALREADY EXISTS** -- do not recreate in 1A-1. | Risk Issue 11 |
| M26 | **Used `vitest.config.ts` with existing `db` project** instead of creating a new `vitest.config.db.ts`. | Feasibility Issue 5 |
| M27 | **Added `create_estimate_from_snapshot()` to Phase 1A-9 function list.** | Completeness Issue 6 |
| M28 | **Reduced Zod validation schemas in 1A-10 to core only** (projects, estimates, nodes, snapshots). Options/catalog/notes schemas deferred to 1B. | Risk Issue 7 |
| M29 | **Added smoke test after Phase 1A-9** (end-to-end: project -> estimate -> nodes -> snapshot -> restore -> verify). | Risk Concern 3 |

### MINOR fixes (addressed but not individually detailed)

- Added `IF NOT EXISTS` comment for ltree extension (Feasibility Issue 1)
- Noted `pending` role already exists in hook (Feasibility Issue 11)
- Noted `proposals` table deferred to 1B+ (Completeness Issue 2)
- Noted `set_app_user_id` not needed (auth.uid() used directly) (Completeness Issue 3)
- Deferred `flag_color` note added (Completeness Issue 5)
- Fixed pending-approval page routing to outside route groups (Feasibility Issue 7)
- Added `was_auto_promoted` to snapshot serialization (Correctness Issue 10)
- Fixed deep_copy `search_path = ''` with schema-qualified refs (Correctness Issue 12)
- Added SQL-based verification alongside grep checks (Risk Issue 10)
- Added table creation order note for 1A-5 agents (Dependency Issue 4)
- Added trigger table-reference annotations (Dependency Issue 6)
- Noted `app_role` already exists with `pending` (Dependency Concern 2)

---

## Context

This plan supersedes the original Phase 1A plan from the 2026-04-06 planning session. It incorporates:

1. **5 interaction decisions** made 2026-04-08 (project lifecycle, node actions, preferences, client experience, search)
2. **Comprehensive analysis** from the 5-agent Implementation Review Board (19 findings, 7 key decisions)
3. **8 deep-research files** covering snapshot architecture, RLS authorization, client visibility, options system, enum strategy, type system, deep-copy function design, and settings/preferences
4. **5-agent Plan Review Board feedback** (feasibility, completeness, correctness, dependency, risk) from iteration 1

**Key changes from original v1:**
- Phase 1A split from 4 monolithic steps into 14 focused phases (1A-0 through 1A-13)
- Session estimate revised to 6-7 sessions (with debugging buffer)
- Server actions scoped to CORE ONLY (projects, estimates, nodes, snapshots) -- catalog/options/notes actions deferred to 1B
- Tests scoped to CORE ONLY (triggers, constraints, RLS, snapshots, deep-copy) -- action/validation/type tests deferred to 1B
- Migration ordering fixed: reference tables BEFORE core tables, client RLS deferred to 1A-5
- Explicit recovery strategy: `supabase db reset` for any failure
- Session handoff documents required between sessions
- tsconfig aggressive flags deferred to post-1A

---

## Recovery Strategy

Phase 1A operates on a local Supabase instance with **no production data**. The nuclear rollback for ANY migration failure is:

```bash
supabase db reset
```

This destroys and recreates the local database, reapplying all migrations from scratch. This is acceptable because Phase 1A creates schema only -- no user data exists.

**Rules:**
- During development, failed migrations are fixed in-place and re-tested via `supabase db reset`
- No DOWN migrations are maintained
- All 10 migration files should be developed and verified via `supabase db reset` before committing
- If a committed migration needs fixing, create a NEW migration file (do not edit committed ones)

---

## Phase 1A Prerequisites

Before starting ANY Phase 1A work, verify:

```bash
#!/bin/bash
echo "=== Phase 1A Prerequisites ==="

# 1. Docker is running
docker info > /dev/null 2>&1 && echo "PASS: Docker running" || echo "FAIL: Docker not running"

# 2. Supabase CLI available
npx supabase --version > /dev/null 2>&1 && echo "PASS: Supabase CLI" || echo "FAIL: Supabase CLI not found"

# 3. Start local Supabase
npx supabase start && echo "PASS: Supabase started" || echo "FAIL: Supabase start failed"

# 4. Existing migrations apply cleanly
npx supabase db reset && echo "PASS: Existing migrations clean" || echo "FAIL: Migration errors"

# 5. Verify custom_access_token_hook is registered
grep -q "custom_access_token" "supabase/config.toml" && echo "PASS: Hook registered" || echo "WARN: Verify hook in config.toml"

echo "=== Prerequisites Complete ==="
```

**Zac action item:** Ensure `supabase/config.toml` has `[auth.hook.custom_access_token]` configured to point to `public.custom_access_token_hook`. Without this, JWT will not contain the `user_role` claim and ALL RLS policies using `get_user_role()` will fail silently.

---

## Phase Overview Table

| Phase | Focus | Est. Sessions | Key Deliverables |
|-------|-------|---------------|------------------|
| **1A-0** | Security & Type Foundation | 0.5 | `get_user_role()`, `is_staff()`, `user_profiles` consolidation, pending role enforcement, type system stubs |
| **1A-1** | Enums & Extensions Migration | 0.25 | `project_status`, `estimate_status` CREATE TYPEs, extensions |
| **1A-2** | Reference + Core Tables Migration | 0.5 | `units_of_measure`, `cost_codes`, `projects`, `estimates`, `estimate_nodes`, details, notes + staff/owner RLS |
| **1A-3** | Supporting Tables Migration | 0.25 | `phases`, `parameters`, `company_settings`, `user_preferences`, `estimate_view_state` + RLS |
| **1A-4** | Catalog, Options & Vendor Tables | 0.5 | `vendors`, catalog tables, option system (9 tables), `broad_options`, `broad_option_overrides` + RLS |
| **1A-5** | Client/Sharing Tables + Client RLS | 0.5 | `client_project_access`, `client_has_project_access()`, snapshots, shares, comments, approvals + client RLS for ALL tables |
| **1A-6** | Triggers | 0.5 | All trigger functions with bypass mechanism |
| **1A-7** | History Tables | 0.25 | `estimate_nodes_history`, `node_item_details_history` + triggers + deny-all RLS |
| **1A-8** | Indexes & Seed Data | 0.25 | ALL indexes (including history table indexes) + seed data |
| **1A-9** | PostgreSQL Functions | 0.75 | `deep_copy_estimate`, `create/restore/create_from_snapshot`, `set_subtree_visibility` + smoke test |
| **1A-10** | Generated Types, Domain Types & Test Infrastructure | 0.75 | `supabase gen types`, domain types, core Zod schemas, test helpers/factories |
| **1A-11** | Core Server Actions | 0.75 | ~28 server actions (projects, estimates, nodes, snapshots) with reference implementation |
| **1A-12** | Core Tests | 1.0 | ~82 test cases (triggers, constraints, RLS, snapshots, deep-copy) |
| **1A-13** | Documentation & Contract Sync | 0.25 | CODEBASE_MAP.md, INTENT.md, CONTRACT-INDEX.md, new contracts |
| **1B** | Features (high-level) | 4-6 | Snapshot UI, catalog, options UI, client portal, search, preferences UI |

**Total Phase 1A: ~6-7 sessions** (includes debugging buffer)

---

## Phase 1A-0: Security & Type Foundation

**Goal:** Establish security helpers and type system before any application tables exist.

**Prerequisite:** Current auth infrastructure (auth_roles migration, custom_access_token_hook, handle_new_user trigger).

### Migration 1A-0a: `supabase/migrations/20260409000001_security_foundation.sql`

**Contents:**
1. `get_user_role()` SECURITY DEFINER helper (returns TEXT, pure SQL, inlinable in RLS)
   - Reference: `rls-authorization-research.md` Section 1
   - Note: Returns TEXT, not `app_role` enum. All comparisons use text for flexibility.
2. `is_staff()` helper function (returns `get_user_role() IN ('owner', 'employee')`)
   - Reference: `rls-authorization-research.md` Section 4.1
3. `user_profiles` table (replaces `user_roles`)
   - `role public.app_role NOT NULL DEFAULT 'pending'`
   - ENABLE ROW LEVEL SECURITY
   - RLS: own profile read, owner manage all
   - Reference: `rls-authorization-research.md` Section 2
4. Data migration from `user_roles` to `user_profiles`
5. Updated `handle_new_user()` trigger (inserts into `user_profiles`)
6. Updated `custom_access_token_hook()` function (queries `user_profiles` instead of `user_roles`)
   - Note: `custom_access_token_hook` was already updated in `20260406000001_security_fixes.sql` to default to 'pending'. This migration replaces it to query `user_profiles` instead of `user_roles`.
7. `prevent_role_self_change()` trigger
8. Grant/revoke permissions

**NOT in this migration:** `client_has_project_access()` -- deferred to Phase 1A-5 (requires `client_project_access` table).

### Migration 1A-0b: `supabase/migrations/20260409000001b_drop_user_roles.sql`

**Contents:**
1. Verify `user_profiles` has data: `SELECT count(*) FROM user_profiles`
2. Verify `custom_access_token_hook` references `user_profiles`: check function source
3. Drop old `user_roles` table
4. Comment: "Safe to drop: 1A-0a migrated all data and updated all references"

**Atomicity note:** Supabase wraps each migration in a transaction. If 1A-0a fails, `user_roles` remains intact and auth continues working. If 1A-0b fails (unlikely -- just a DROP), `user_profiles` is already live and functioning. Recovery for any failure: `supabase db reset`.

### Application Changes

| File | Change |
|------|--------|
| `src/middleware.ts` | Add `pending` role check: extract `user.app_metadata?.user_role`, redirect pending to `/pending-approval` |
| `src/app/(protected)/layout.tsx` | Defense-in-depth: check role in layout, redirect pending |
| `src/app/pending-approval/page.tsx` | New page (OUTSIDE route groups to avoid layout interference): "Your account is pending admin approval" |

### TypeScript Type System Setup

| File | Contents |
|------|----------|
| `src/lib/types/enums.ts` | `PROJECT_STATUS`, `ESTIMATE_STATUS` const objects, type guards, labels, ordinals |
| `src/lib/types/action-result.ts` | `ActionResult<T>`, `ErrorCode`, `ok()`, `err()` factory functions |
| `src/lib/types/domain/nodes.ts` | `NodeWithDetails` discriminated union stub (populated in 1A-10) |
| `src/lib/types/domain/snapshots.ts` | `SnapshotNode` branded type stub (populated in 1A-10) |
| `src/lib/types/settings.ts` | `CompanySettings`, `CompanySettingsJson`, `UserPreferences` |
| `src/lib/types/preferences.ts` | `EstimateViewState`, `UserPreferencesJson` |
| `src/lib/types/options.ts` | `OptionGroup`, `OptionAlternative`, `NodeOptionMembership`, `OptionSet` |
| `src/lib/types/status-transitions.ts` | `evaluateProjectTransition()`, `evaluateEstimateTransition()` guardrail functions |

### tsconfig Hardening (SAFE FLAGS ONLY)

Add to `tsconfig.json` compilerOptions:
```json
{
  "noImplicitReturns": true
}
```

**Deferred to post-1A hardening pass:**
- `noUncheckedIndexedAccess` -- adds `| undefined` to every array/object index access, will cascade type errors through existing code
- `exactOptionalPropertyTypes` -- notoriously strict, will break existing components that pass `undefined` to optional props

### Agent Assignments

| Agent | Scope | Type |
|-------|-------|------|
| Agent 1 | Security migration SQL (1A-0a + 1A-0b: get_user_role, user_profiles, helpers, triggers, grants) | Full-capability |
| Agent 2 | TypeScript type system files (all 8 type files + tsconfig) | Full-capability |
| Agent 3 | Middleware + layout pending role enforcement + pending-approval page | Full-capability |

### Verification Script

```bash
#!/bin/bash
# Phase 1A-0 Verification
PASS=0; FAIL=0

# Migration files exist
[ -f "supabase/migrations/20260409000001_security_foundation.sql" ] && ((PASS++)) || ((FAIL++))
[ -f "supabase/migrations/20260409000001b_drop_user_roles.sql" ] && ((PASS++)) || ((FAIL++))

# Type files exist
for f in "src/lib/types/enums.ts" "src/lib/types/action-result.ts" \
         "src/lib/types/domain/nodes.ts" "src/lib/types/domain/snapshots.ts" \
         "src/lib/types/settings.ts" "src/lib/types/preferences.ts" \
         "src/lib/types/options.ts" "src/lib/types/status-transitions.ts"; do
  [ -f "$f" ] && ((PASS++)) || ((FAIL++))
done

# Pending approval page exists (outside route groups)
[ -f "src/app/pending-approval/page.tsx" ] && ((PASS++)) || ((FAIL++))

# Migration contains key elements
grep -q "get_user_role" "supabase/migrations/20260409000001_security_foundation.sql" && ((PASS++)) || ((FAIL++))
grep -q "user_profiles" "supabase/migrations/20260409000001_security_foundation.sql" && ((PASS++)) || ((FAIL++))
grep -q "ENABLE ROW LEVEL SECURITY" "supabase/migrations/20260409000001_security_foundation.sql" && ((PASS++)) || ((FAIL++))

# tsconfig has ONLY safe flag
grep -q "noImplicitReturns" "tsconfig.json" && ((PASS++)) || ((FAIL++))
# Aggressive flags NOT present
! grep -q "noUncheckedIndexedAccess" "tsconfig.json" && ((PASS++)) || ((FAIL++))
! grep -q "exactOptionalPropertyTypes" "tsconfig.json" && ((PASS++)) || ((FAIL++))

# client_has_project_access is NOT in this migration (deferred to 1A-5)
! grep -q "client_has_project_access" "supabase/migrations/20260409000001_security_foundation.sql" && ((PASS++)) || ((FAIL++))

# SQL verification: migrations apply cleanly
npx supabase db reset 2>/dev/null && ((PASS++)) || ((FAIL++))

echo "Phase 1A-0: PASS=$PASS FAIL=$FAIL"
[ $FAIL -eq 0 ] && echo "GATE: PASSED" || echo "GATE: FAILED"
```

### Commit

```
feat(infra): security foundation -- get_user_role helper, user_profiles consolidation, type system

- Add get_user_role() and is_staff() SECURITY DEFINER helpers for RLS policies
- Split user_roles -> user_profiles into two safe migrations (create then drop)
- Add pending role enforcement in middleware and layout
- Create TypeScript type system: ActionResult, NodeWithDetails stubs, enums, error codes
- Add noImplicitReturns to tsconfig (aggressive flags deferred to post-1A)
```

---

## Phase 1A-1: Enums & Extensions Migration

**Goal:** Create PostgreSQL enum types and enable extensions before any table references them.

### Migration: `supabase/migrations/20260409000002_extensions_and_enums.sql`

**Contents:**
1. `CREATE EXTENSION IF NOT EXISTS ltree`
   - Note: ltree already created in `00000000000001_auth_roles.sql`; repeated here with `IF NOT EXISTS` for documentation completeness.
2. `CREATE EXTENSION IF NOT EXISTS pg_trgm` (for fuzzy text search)
3. `CREATE TYPE public.project_status AS ENUM (10 values)`
4. `CREATE TYPE public.estimate_status AS ENUM (4 values)`
5. `COMMENT ON TYPE` for both

**IMPORTANT:** `app_role` enum ALREADY EXISTS from migration `00000000000001_auth_roles.sql` + `20260406000001_security_fixes.sql` (which added 'pending'). Do NOT create or modify `app_role` in this migration.

**Values:**
- `project_status`: lead, in_design, bidding, under_contract, value_engineering, active_construction, closing_out, warranty_period, closed, archived
- `estimate_status`: draft, preliminary, active, complete

### Agent Assignments

Single agent -- this is a small, self-contained migration.

### Verification Script

```bash
#!/bin/bash
PASS=0; FAIL=0
F="supabase/migrations/20260409000002_extensions_and_enums.sql"
[ -f "$F" ] && ((PASS++)) || ((FAIL++))
grep -q "CREATE TYPE public.project_status" "$F" && ((PASS++)) || ((FAIL++))
grep -q "CREATE TYPE public.estimate_status" "$F" && ((PASS++)) || ((FAIL++))
grep -q "ltree" "$F" && ((PASS++)) || ((FAIL++))
# Verify app_role is NOT recreated
! grep -q "CREATE TYPE.*app_role" "$F" && ((PASS++)) || ((FAIL++))
echo "Phase 1A-1: PASS=$PASS FAIL=$FAIL"
[ $FAIL -eq 0 ] && echo "GATE: PASSED" || echo "GATE: FAILED"
```

### Commit

```
feat(db): add project_status and estimate_status enums, enable ltree extension
```

---

## Phase 1A-2: Reference + Core Tables Migration

**Goal:** Create reference/lookup tables FIRST, then the fundamental tables that everything else depends on. All FK references resolve within this single migration.

### Migration: `supabase/migrations/20260409000003_core_tables.sql`

**Reference/Lookup Tables (created FIRST, at top of file):**

1. **`units_of_measure`** -- id, name, abbreviation, unit_type.
   - RLS: read-all for authenticated, write for owner.
   - No FK dependencies (standalone lookup table).

2. **`cost_codes`** -- id, code, name, description, category.
   - RLS: read-all for authenticated, write for owner.
   - No FK dependencies (standalone lookup table).

**Core Tables (created AFTER reference tables):**

3. **`projects`**
   - `status public.project_status NOT NULL DEFAULT 'lead'`
   - `user_id UUID NOT NULL REFERENCES auth.users(id)` (project owner)
   - RLS: staff full CRUD, pending/anon denied
   - **NO client RLS in this migration** -- deferred to Phase 1A-5

4. **`estimates`**
   - `status public.estimate_status NOT NULL DEFAULT 'draft'`
   - `version INTEGER NOT NULL DEFAULT 1` (optimistic locking)
   - `version_group_id UUID`, `version_number INTEGER`, `version_label VARCHAR(255)`, `is_current BOOLEAN`
   - `default_contingency_rate DECIMAL(5,4)`, `default_overhead_rate DECIMAL(5,4)`
   - RLS: staff full CRUD
   - **NO client RLS** -- deferred to Phase 1A-5

5. **`phases`** -- id, project_id FK, name, sort_order.
   - RLS: staff CRUD
   - **NO client RLS** -- deferred to Phase 1A-5

6. **`estimate_nodes`**
   - `client_visibility VARCHAR(20) NOT NULL DEFAULT 'visible'` with CHECK ('visible','hidden','summary_only')
   - `flagged BOOLEAN NOT NULL DEFAULT FALSE`
   - Deferred: `flag_color VARCHAR(7)` for multi-color flags -- revisit if single boolean proves insufficient
   - `search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(name,'') || ' ' || coalesce(description,''))) STORED`
   - `path LTREE`
   - NO `notes TEXT` or `client_notes TEXT` (replaced by `node_notes` table)
   - `was_auto_promoted BOOLEAN NOT NULL DEFAULT FALSE`
   - `reference_name VARCHAR(255)` (formula system)
   - `catalog_source_id UUID`, `catalog_source_type VARCHAR(20)`, `catalog_version INTEGER`
   - `phase_id UUID REFERENCES phases(id)` -- phases created above
   - `cost_code_id UUID REFERENCES cost_codes(id)` -- cost_codes created above
   - RLS: staff full CRUD
   - **NO client RLS** -- deferred to Phase 1A-5

7. **`node_item_details`**
   - All item-specific columns (qty, unit_cost, formulas, bid_type, allowance fields, etc.)
   - `unit_id UUID REFERENCES units_of_measure(id)` -- resolves within this migration
   - `package_unit_id UUID REFERENCES units_of_measure(id)` -- resolves within this migration
   - `vendor_id UUID` -- **soft FK** (no REFERENCES constraint). Vendors created in Phase 1A-4. Hard FK added via ALTER TABLE in Phase 1A-4.
   - 1:1 with estimate_nodes (node_id PK or FK UNIQUE)
   - RLS: staff full CRUD
   - **NO client RLS** -- deferred to Phase 1A-5

8. **`node_assembly_details`**
   - Assembly-specific columns (assembly_qty, assembly_unit_id, derived_unit_cost, qty_formula)
   - `assembly_unit_id UUID REFERENCES units_of_measure(id)` -- resolves within this migration
   - 1:1 with estimate_nodes
   - RLS: staff full CRUD
   - **NO client RLS** -- deferred to Phase 1A-5

9. **`node_notes`**
   - `body TEXT NOT NULL`, `format VARCHAR(20)` CHECK (`format IN ('markdown', 'html')`)
   - `is_internal BOOLEAN NOT NULL DEFAULT TRUE`
   - `is_client_visible BOOLEAN NOT NULL DEFAULT FALSE`
   - `deleted_at TIMESTAMPTZ` (soft delete)
   - Constraint: `CHECK (NOT (is_internal = TRUE AND is_client_visible = TRUE))` -- cannot be both
   - Constraint: `CHECK (is_internal OR is_client_visible)` -- must be visible to at least one audience
   - RLS: staff full access
   - **NO client RLS** -- deferred to Phase 1A-5

**NO Client VIEWs in this migration.** Client VIEWs are deferred to Phase 1A-5 alongside client RLS policies, because they depend on `client_project_access` and `client_has_project_access()`.

### Agent Assignments

| Agent | Scope | Type |
|-------|-------|------|
| Agent 1 | Reference tables (units, cost_codes) + projects + estimates + phases + their RLS | Full-capability |
| Agent 2 | estimate_nodes + detail tables + their RLS | Full-capability |
| Agent 3 | node_notes + RLS | Full-capability |

### Verification Script

```bash
#!/bin/bash
PASS=0; FAIL=0
F="supabase/migrations/20260409000003_core_tables.sql"
[ -f "$F" ] && ((PASS++)) || ((FAIL++))

# Per-table RLS verification (check table-specific ALTER TABLE ... ENABLE)
for table in units_of_measure cost_codes projects estimates phases estimate_nodes node_item_details node_assembly_details node_notes; do
  grep -q "ALTER TABLE.*${table}.*ENABLE ROW LEVEL SECURITY\|ENABLE ROW LEVEL SECURITY.*${table}" "$F" && ((PASS++)) || ((FAIL++))
done

# Alternatively, count total RLS enables (should be >= 9)
RLS_COUNT=$(grep -c "ENABLE ROW LEVEL SECURITY" "$F")
[ "$RLS_COUNT" -ge 9 ] && ((PASS++)) || ((FAIL++))

# Key columns exist
grep -q "client_visibility VARCHAR(20)" "$F" && ((PASS++)) || ((FAIL++))
grep -q "flagged BOOLEAN" "$F" && ((PASS++)) || ((FAIL++))
grep -q "search_vector tsvector" "$F" && ((PASS++)) || ((FAIL++))
grep -q "version INTEGER" "$F" && ((PASS++)) || ((FAIL++))
grep -q "was_auto_promoted" "$F" && ((PASS++)) || ((FAIL++))

# Notes format uses html not plain
grep -q "'markdown'" "$F" && ((PASS++)) || ((FAIL++))
grep -q "'html'" "$F" && ((PASS++)) || ((FAIL++))

# Notes has both constraints
grep -q "is_internal OR is_client_visible" "$F" && ((PASS++)) || ((FAIL++))

# Reference tables are at the TOP (before core tables)
UNITS_LINE=$(grep -n "units_of_measure" "$F" | head -1 | cut -d: -f1)
PROJECTS_LINE=$(grep -n "CREATE TABLE.*projects" "$F" | head -1 | cut -d: -f1)
[ "$UNITS_LINE" -lt "$PROJECTS_LINE" ] && ((PASS++)) || ((FAIL++))

# NO client_has_project_access in this migration
! grep -q "client_has_project_access" "$F" && ((PASS++)) || ((FAIL++))

# Removed columns are NOT present
! grep -q "column_config JSONB" "$F" && ((PASS++)) || ((FAIL++))
! grep -q "view_settings JSONB" "$F" && ((PASS++)) || ((FAIL++))

# SQL verification
npx supabase db reset 2>/dev/null && ((PASS++)) || ((FAIL++))

echo "Phase 1A-2: PASS=$PASS FAIL=$FAIL"
[ $FAIL -eq 0 ] && echo "GATE: PASSED" || echo "GATE: FAILED"
```

### Commit

```
feat(db): reference + core tables -- units, cost_codes, projects, estimates, nodes, details, notes with staff RLS
```

---

## Phase 1A-3: Supporting Tables Migration

**Goal:** Create configuration and settings tables. Reference/lookup tables (units, cost_codes) already created in 1A-2. Phases already created in 1A-2.

### Migration: `supabase/migrations/20260409000004_supporting_tables.sql`

**Tables:**

1. **`project_parameters`** -- id, project_id FK, name, value, data_type. RLS: staff CRUD.

2. **`company_settings`** (hybrid normalized + JSONB)
   - Singleton enforcement via `singleton_key TEXT UNIQUE CHECK (singleton_key = 'default')`
   - Normalized: `default_markup_rate`, `default_overhead_rate`, `default_contingency_rate`, `default_tax_rate`, `default_unit_id FK`
   - JSONB: `settings_json` for company info, licensing, terms, branding
   - Trigger: `prevent_duplicate_company_settings()` (created in this migration)
   - RLS: owner full, employee read-only, client/pending/anon denied
   - Reference: `settings-preferences-research.md` Section 2

3. **`user_preferences`**
   - `user_id UUID PRIMARY KEY` (natural key, not synthetic id)
   - `preferences JSONB NOT NULL DEFAULT '{}'`
   - RLS: own preferences only
   - Reference: `settings-preferences-research.md` Section 3

4. **`estimate_view_state`**
   - Composite PK `(user_id, estimate_id)`
   - `view_state JSONB NOT NULL DEFAULT '{}'`
   - No `created_at` (only `updated_at` matters)
   - RLS: own state only
   - Reference: `settings-preferences-research.md` Section 4

### Agent Assignments

| Agent | Scope | Type |
|-------|-------|------|
| Agent 1 | project_parameters + company_settings (with trigger) + RLS | Full-capability |
| Agent 2 | user_preferences + estimate_view_state + RLS | Full-capability |

### Verification Script

```bash
#!/bin/bash
PASS=0; FAIL=0
F="supabase/migrations/20260409000004_supporting_tables.sql"
[ -f "$F" ] && ((PASS++)) || ((FAIL++))
for table in project_parameters company_settings user_preferences estimate_view_state; do
  grep -q "$table" "$F" && ((PASS++)) || ((FAIL++))
done
grep -q "singleton_key" "$F" && ((PASS++)) || ((FAIL++))
grep -q "ENABLE ROW LEVEL SECURITY" "$F" && ((PASS++)) || ((FAIL++))
npx supabase db reset 2>/dev/null && ((PASS++)) || ((FAIL++))
echo "Phase 1A-3: PASS=$PASS FAIL=$FAIL"
[ $FAIL -eq 0 ] && echo "GATE: PASSED" || echo "GATE: FAILED"
```

### Commit

```
feat(db): supporting tables -- parameters, company_settings, preferences, view_state
```

---

## Phase 1A-4: Catalog, Options & Vendor Tables Migration

**Goal:** Create the full options system, catalog infrastructure, and broad options. Schema only -- features ship in 1B.

### Migration: `supabase/migrations/20260409000005_catalog_options_vendors.sql`

**Tables (in dependency order):**

1. **`vendors`** -- id, name, contact_info JSONB. RLS: staff CRUD.
   - Also: `ALTER TABLE node_item_details ADD CONSTRAINT ... FOREIGN KEY (vendor_id) REFERENCES vendors(id)` -- adds the hard FK that was left as soft ref in 1A-2.

2. **`catalog_items`** -- id, name, description, default fields, created_by. RLS: staff CRUD.

3. **`catalog_assemblies`** -- id, name, description, created_by. RLS: staff CRUD.

4. **`broad_options`** -- id, estimate_id FK, name, description, is_active.
   - RLS: via estimate ownership using `is_staff()`.

5. **`broad_option_overrides`** -- id, broad_option_id FK, parameter_id FK (references project_parameters from 1A-3), override_value.
   - RLS: via broad_option ownership chain using `is_staff()`.

6. **`option_groups`** (with `group_type`)
   - `group_type VARCHAR(20) NOT NULL DEFAULT 'selection'` CHECK ('selection', 'toggle')
   - `anchor_node_id UUID NOT NULL REFERENCES estimate_nodes(id) ON DELETE CASCADE`
   - RLS: `is_staff()` for all operations (NOT owner-only -- corrected from options research)
   - Reference: `options-system-research.md` Section 1

7. **`option_alternatives`**
   - `is_selected BOOLEAN NOT NULL DEFAULT FALSE`
   - Partial unique index: one selected per group
   - RLS: `is_staff()` for all operations

8. **`node_option_memberships`** (junction table)
   - `UNIQUE (node_id, option_alternative_id)`
   - Performance indexes: `idx_nom_node`, `idx_nom_alt`
   - RLS: `is_staff()` for all operations

9. **`option_sets`**
   - Partial unique index: one default per estimate
   - RLS: `is_staff()` for all operations

10. **`option_set_selections`**
    - `UNIQUE (option_set_id, option_group_id)`
    - RLS: `is_staff()` for all operations

11. **`option_set_broad_selections`**
    - `UNIQUE (option_set_id, broad_option_id)`
    - RLS: `is_staff()` for all operations

**Deferred:** `proposals` / `vendor_proposals` table -- revisit in Phase 1B+ if bid management features are needed.

### Agent Assignments

| Agent | Scope | Type |
|-------|-------|------|
| Agent 1 | vendors (+ vendor_id FK on node_item_details), catalog_items, catalog_assemblies, broad_options, broad_option_overrides + RLS | Full-capability |
| Agent 2 | option_groups, option_alternatives, node_option_memberships + RLS + indexes | Full-capability |
| Agent 3 | option_sets, option_set_selections, option_set_broad_selections + RLS | Full-capability |

### Verification Script

```bash
#!/bin/bash
PASS=0; FAIL=0
F="supabase/migrations/20260409000005_catalog_options_vendors.sql"
[ -f "$F" ] && ((PASS++)) || ((FAIL++))
grep -q "group_type VARCHAR(20)" "$F" && ((PASS++)) || ((FAIL++))
grep -q "broad_options" "$F" && ((PASS++)) || ((FAIL++))
grep -q "broad_option_overrides" "$F" && ((PASS++)) || ((FAIL++))
grep -q "is_staff()" "$F" && ((PASS++)) || ((FAIL++))
grep -q "ENABLE ROW LEVEL SECURITY" "$F" && ((PASS++)) || ((FAIL++))
# vendor_id FK added to node_item_details
grep -q "ALTER TABLE.*node_item_details" "$F" && ((PASS++)) || ((FAIL++))
npx supabase db reset 2>/dev/null && ((PASS++)) || ((FAIL++))
echo "Phase 1A-4: PASS=$PASS FAIL=$FAIL"
[ $FAIL -eq 0 ] && echo "GATE: PASSED" || echo "GATE: FAILED"
```

### Commit

```
feat(db): catalog, options, vendors, broad_options with full RLS and constraint indexes
```

---

## Phase 1A-5: Client/Sharing Tables + Client RLS

**Goal:** Create client access infrastructure, snapshot/sharing/commenting tables, AND add client-role RLS policies to ALL prior tables. This is the phase where the client access story becomes complete.

### Migration: `supabase/migrations/20260409000006_client_sharing_tables.sql`

**SECTION 1: Client Access Infrastructure (created FIRST)**

1. **`client_project_access`** (junction: which clients can see which projects)
   - `UNIQUE (client_user_id, project_id)`
   - RLS: staff manage, client read own
   - Reference: `rls-authorization-research.md` Section 3

2. **`client_has_project_access(p_project_id UUID)` helper function**
   - `SECURITY DEFINER`, `STABLE`, `SET search_path = ''`
   - Queries `public.client_project_access` to check if `auth.uid()` has access to the project
   - Reference: `rls-authorization-research.md` Section 4.1

**SECTION 2: Snapshot & Sharing Tables**

3. **`estimate_snapshots`**
   - `snapshot_type VARCHAR(20)` CHECK ('milestone', 'checkpoint')
   - `snapshot_data JSONB NOT NULL`
   - `schema_version INTEGER NOT NULL DEFAULT 1`
   - `node_count INTEGER`, `total_price DECIMAL(15,4)` (summary metadata)
   - `estimate_status_at_time public.estimate_status NOT NULL` (uses enum, NOT VARCHAR)
   - `project_status_at_time public.project_status` (uses enum, NOT VARCHAR)
   - `version_number_at_time INTEGER`
   - `restored_at TIMESTAMPTZ`, `restored_by UUID` (restore tracking)
   - Immutability trigger: `prevent_snapshot_mutation()` -- column-by-column check, allows ONLY `restored_at` and `restored_by` updates, blocks all other field changes and deletes
   - RLS: authenticated SELECT, **service_role INSERT only** (snapshots created through `create_estimate_snapshot()` SECURITY DEFINER function), no direct UPDATE/DELETE
   - Reference: `snapshot-architecture-research.md` "Recommended Solution"

4. **`estimate_shares`**
   - `share_token VARCHAR(64) UNIQUE`
   - `pin_hash TEXT` (bcrypt cost 12)
   - `expires_at TIMESTAMPTZ NOT NULL`
   - `failed_attempts INTEGER DEFAULT 0`, `locked_until TIMESTAMPTZ`
   - `is_revoked BOOLEAN DEFAULT FALSE`
   - `access_count INTEGER DEFAULT 0`, `last_accessed_at TIMESTAMPTZ`
   - RLS: staff CRUD, no client/anon access

5. **`estimate_comments`**
   - `author_type VARCHAR(10)` CHECK ('user', 'share')
   - `node_id UUID` (nullable)
   - `is_resolved BOOLEAN DEFAULT FALSE`
   - RLS: staff full, client read/write on accessible estimates

6. **`estimate_approvals`**
   - `status VARCHAR(20)` CHECK ('approved', 'rejected', 'pending')
   - `option_set_id UUID REFERENCES option_sets(id)` -- FK to 1A-4 table (DAG enforces ordering)
   - `notes TEXT`
   - RLS: staff read, client/share write

**SECTION 3: Client RLS Policies for ALL Prior Tables**

Add client-role RLS policies to tables from Phase 1A-2, 1A-3, 1A-4:

| Table | Client Policy |
|-------|--------------|
| `projects` | `CREATE POLICY "client_read_projects" ON projects FOR SELECT USING (get_user_role() = 'client' AND client_has_project_access(id))` |
| `estimates` | `CREATE POLICY "client_read_estimates" ON estimates FOR SELECT USING (get_user_role() = 'client' AND client_has_project_access(project_id))` |
| `estimate_nodes` | `CREATE POLICY "client_read_nodes" ON estimate_nodes FOR SELECT USING (get_user_role() = 'client' AND client_visibility != 'hidden' AND ...)` |
| `node_item_details` | Client read ONLY for 'visible' nodes (not summary_only) via join |
| `node_assembly_details` | Same as item_details |
| `node_notes` | Client read client-visible notes on non-hidden nodes |
| `phases` | Client read on accessible projects |
| `option_groups` | Client read on accessible estimates (for option set comparison) |
| `option_alternatives` | Client read via option_group chain |
| `option_sets` | Client read via estimate chain |

**SECTION 4: Client VIEWs**

- `client_estimate_nodes` -- column-filtered view for client access
- `client_node_item_details` -- only for 'visible' nodes
- `client_node_assembly_details` -- only for 'visible' nodes

**Per-IP rate limiting note:** Per-IP rate limiting (C13: 20 attempts/hour/IP) is application-layer, implemented via in-memory rate limiter or Redis in the share link validation API route (Phase 1B-4).

### Agent Assignments

| Agent | Scope | Type |
|-------|-------|------|
| Agent 1 | client_project_access + client_has_project_access() function + estimate_snapshots + immutability trigger + RLS | Full-capability |
| Agent 2 | estimate_shares + estimate_comments + estimate_approvals + their RLS | Full-capability |
| Agent 3 | Client RLS policies for ALL Phase 1A-2/3/4 tables + Client VIEWs | Full-capability |

**IMPORTANT:** Within this migration, table creation order MUST be: `client_project_access` -> `client_has_project_access()` -> `estimate_snapshots` -> `estimate_shares` -> `estimate_comments` -> `estimate_approvals` -> client RLS policies -> client VIEWs.

### Verification Script

```bash
#!/bin/bash
PASS=0; FAIL=0
F="supabase/migrations/20260409000006_client_sharing_tables.sql"
[ -f "$F" ] && ((PASS++)) || ((FAIL++))
grep -q "client_project_access" "$F" && ((PASS++)) || ((FAIL++))
grep -q "client_has_project_access" "$F" && ((PASS++)) || ((FAIL++))
grep -q "estimate_snapshots" "$F" && ((PASS++)) || ((FAIL++))
grep -q "prevent_snapshot_mutation" "$F" && ((PASS++)) || ((FAIL++))
grep -q "share_token VARCHAR(64)" "$F" && ((PASS++)) || ((FAIL++))
grep -q "estimate_status_at_time public.estimate_status" "$F" && ((PASS++)) || ((FAIL++))
grep -q "ENABLE ROW LEVEL SECURITY" "$F" && ((PASS++)) || ((FAIL++))
# Client RLS policies added for prior tables
grep -q "client_read_projects\|client_read.*projects" "$F" && ((PASS++)) || ((FAIL++))
grep -q "client_read.*estimates\|client_read_estimates" "$F" && ((PASS++)) || ((FAIL++))
grep -q "client_estimate_nodes" "$F" && ((PASS++)) || ((FAIL++))
# service_role INSERT for snapshots
grep -q "service_role" "$F" && ((PASS++)) || ((FAIL++))
npx supabase db reset 2>/dev/null && ((PASS++)) || ((FAIL++))
echo "Phase 1A-5: PASS=$PASS FAIL=$FAIL"
[ $FAIL -eq 0 ] && echo "GATE: PASSED" || echo "GATE: FAILED"
```

### Commit

```
feat(db): client/sharing tables, client_has_project_access(), client RLS for all tables, client VIEWs
```

---

## Phase 1A-6: Triggers

**Goal:** Create all trigger functions with unified bypass mechanism for snapshot/deep-copy operations.

### Migration: `supabase/migrations/20260409000007_triggers.sql`

**Trigger functions (with table dependencies annotated):**

1. **`set_updated_at()`** -- Generic trigger, sets `updated_at = NOW()` on UPDATE.
   - Tables referenced: none (operates on `NEW` record only)
   - Applied to all tables with `updated_at`.

2. **`maintain_node_path()`** -- Updates ltree `path` column on INSERT/UPDATE of estimate_nodes.
   - Tables referenced: `estimate_nodes` (self-join for parent path lookup)
   - Bypass: skipped when `current_setting('app.is_snapshot_copy', true) = 'true'`

3. **`enforce_item_leaf_constraint()`** -- Prevents items from having children.
   - Tables referenced: `estimate_nodes` (check parent node_type)
   - Bypass: skipped during snapshot copy

4. **`auto_promote_to_assembly()`** -- Promotes item to assembly when first child is added.
   - Tables referenced: `estimate_nodes` (check parent), `node_item_details`, `node_assembly_details` (move data)
   - Sets `was_auto_promoted = TRUE`
   - Bypass: skipped during snapshot copy

5. **`auto_demote_from_assembly()`** -- Demotes auto-promoted assembly back to item when last child removed.
   - Tables referenced: `estimate_nodes` (check children count), `node_item_details`, `node_assembly_details`
   - Only if `was_auto_promoted = TRUE`
   - Bypass: skipped during snapshot copy

6. **`update_parent_subtotals()`** -- Recalculates parent node totals when child prices change.
   - Tables referenced: `estimate_nodes` ONLY (sums child totals, no option-awareness)
   - Bypass: skipped during snapshot copy

7. **`cascade_sort_order()`** -- Maintains sort order when nodes are reordered.
   - Tables referenced: `estimate_nodes` (siblings by parent_id)

**Bypass mechanism pattern (unified, single variable name):**

```sql
-- At the start of every bypassable trigger:
IF current_setting('app.is_snapshot_copy', true) = 'true' THEN
  RETURN NEW; -- Skip trigger logic during deep-copy/snapshot operations
END IF;
```

The bypass is set via `SET LOCAL app.is_snapshot_copy = 'true'` inside BOTH `deep_copy_estimate()` AND `restore_estimate_snapshot()`. `SET LOCAL` scopes to the current transaction only.

**NO other bypass variable names.** `app.is_snapshot_restore` and `app.allow_snapshot_mutation` are NOT used anywhere. The single variable `app.is_snapshot_copy` controls all trigger bypass.

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
# No other bypass variable names
! grep -q "app.is_snapshot_restore" "$F" && ((PASS++)) || ((FAIL++))
! grep -q "app.allow_snapshot_mutation" "$F" && ((PASS++)) || ((FAIL++))
npx supabase db reset 2>/dev/null && ((PASS++)) || ((FAIL++))
echo "Phase 1A-6: PASS=$PASS FAIL=$FAIL"
[ $FAIL -eq 0 ] && echo "GATE: PASSED" || echo "GATE: FAILED"
```

### Commit

```
feat(db): trigger functions with unified snapshot bypass mechanism (app.is_snapshot_copy)
```

---

## Phase 1A-7: History Tables

**Goal:** Create history tables and triggers for audit trail. Indexes are NOT created here (all indexes consolidated in Phase 1A-8).

### Migration: `supabase/migrations/20260409000008_history_tables.sql`

**Tables:**

1. **`estimate_nodes_history`**
   - `id UUID PK`, `original_node_id UUID`, `estimate_id UUID`
   - All columns from `estimate_nodes` (snapshot of changed row)
   - `operation VARCHAR(10)` CHECK ('UPDATE', 'DELETE') -- NO INSERT logging (per C17)
   - `changed_at TIMESTAMPTZ DEFAULT NOW()`
   - `changed_by UUID`
   - **ENABLE ROW LEVEL SECURITY** (deny-all: no policies for non-service roles)
   - `CREATE POLICY "service_role_all" ON estimate_nodes_history FOR ALL TO service_role USING (true) WITH CHECK (true)`
   - **No indexes** -- all indexes created in Phase 1A-8

2. **`node_item_details_history`** -- same pattern for item detail changes.
   - **ENABLE ROW LEVEL SECURITY** (deny-all + service_role bypass)
   - **No indexes** -- all indexes created in Phase 1A-8

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

  RETURN COALESCE(NEW, OLD);  -- Handles both UPDATE (NEW) and DELETE (OLD is returned)
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';
```

**Note:** Uses `RETURN COALESCE(NEW, OLD)` (NOT bare `RETURN NEW`) to correctly handle DELETE operations where NEW is NULL.

**Note:** A similar `log_item_detail_history()` trigger function is created for `node_item_details_history`.

### Agent Assignments

Single agent -- focused migration.

### Verification Script

```bash
#!/bin/bash
PASS=0; FAIL=0
F="supabase/migrations/20260409000008_history_tables.sql"
[ -f "$F" ] && ((PASS++)) || ((FAIL++))
grep -q "estimate_nodes_history" "$F" && ((PASS++)) || ((FAIL++))
grep -q "node_item_details_history" "$F" && ((PASS++)) || ((FAIL++))
grep -q "log_node_history" "$F" && ((PASS++)) || ((FAIL++))
grep -q "app.is_snapshot_copy" "$F" && ((PASS++)) || ((FAIL++))
grep -q "COALESCE(NEW, OLD)" "$F" && ((PASS++)) || ((FAIL++))
# RLS enabled on history tables
grep -q "ENABLE ROW LEVEL SECURITY" "$F" && ((PASS++)) || ((FAIL++))
grep -q "service_role" "$F" && ((PASS++)) || ((FAIL++))
# No indexes in this file (consolidated in 1A-8)
! grep -q "CREATE INDEX.*history" "$F" && ((PASS++)) || ((FAIL++))
npx supabase db reset 2>/dev/null && ((PASS++)) || ((FAIL++))
echo "Phase 1A-7: PASS=$PASS FAIL=$FAIL"
[ $FAIL -eq 0 ] && echo "GATE: PASSED" || echo "GATE: FAILED"
```

### Commit

```
feat(db): history tables with audit triggers, deny-all RLS, snapshot bypass
```

---

## Phase 1A-8: Indexes & Seed Data

**Goal:** Create ALL performance indexes (including history table indexes) and seed reference data.

### Migration: `supabase/migrations/20260409000009_indexes_and_seeds.sql`

**Indexes (ALL indexes for all tables, single source of truth):**

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
| `idx_nom_node` | `node_option_memberships` | btree on `node_id` | Option membership lookups |
| `idx_nom_alt` | `node_option_memberships` | btree on `option_alternative_id` | Alternative membership lookups |
| `idx_one_selected_per_group` | `option_alternatives` | partial unique WHERE is_selected = TRUE | One selected per group |

**Seed Data:**

1. **Units of measure** (common construction units):
   EA, SF, LF, CY, SQ, SHT, BAG, GAL, HR, DAY, LS, ALLOW, PR, SET, ROLL, BNDL, LB, TON

2. **Cost codes** (CSI MasterFormat top-level divisions):
   01-12, 21-23, 26, 31-33

3. **Company settings singleton** -- default rates, placeholder company name

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
grep -q "idx_nodes_history_node" "$F" && ((PASS++)) || ((FAIL++))
grep -q "idx_nodes_history_estimate" "$F" && ((PASS++)) || ((FAIL++))
grep -q "idx_nom_node" "$F" && ((PASS++)) || ((FAIL++))
grep -q "units_of_measure" "$F" && ((PASS++)) || ((FAIL++))
grep -q "cost_codes" "$F" && ((PASS++)) || ((FAIL++))
grep -q "company_settings" "$F" && ((PASS++)) || ((FAIL++))
npx supabase db reset 2>/dev/null && ((PASS++)) || ((FAIL++))
echo "Phase 1A-8: PASS=$PASS FAIL=$FAIL"
[ $FAIL -eq 0 ] && echo "GATE: PASSED" || echo "GATE: FAILED"
```

### Commit

```
feat(db): all indexes (including history), seed data for units, cost codes, company settings
```

---

## Phase 1A-9: PostgreSQL Functions

**Goal:** Create the complex database functions that orchestrate multi-table operations. All use `SET search_path = ''` with schema-qualified table references.

### Migration: `supabase/migrations/20260409000010_functions.sql`

**Functions:**

1. **`deep_copy_estimate(p_source_estimate_id UUID, p_new_version_label VARCHAR, p_created_by UUID)`**
   - Returns new estimate UUID
   - `SECURITY DEFINER`, `SET search_path = ''` (all table refs schema-qualified as `public.`)
   - Copies tables with full FK remapping via temp tables
   - Sets `SET LOCAL app.is_snapshot_copy = 'true'` to bypass triggers
   - Rebuilds ltree paths via recursive CTE after all nodes copied
   - **Does NOT copy `node_attachments`** (table does not exist). Comment: `-- TODO: Add node_attachments copy when table is created`
   - `was_auto_promoted` is copied for each node
   - Reference: `deep-copy-function-research.md`

2. **`create_estimate_snapshot(p_estimate_id UUID, p_name VARCHAR, p_description TEXT, p_snapshot_type VARCHAR, p_created_by UUID)`**
   - Returns snapshot UUID
   - Serializes tables into JSONB with `schema_version = 1`
   - Captures summary metadata (node_count, total_price)
   - **Includes `was_auto_promoted` in node serialization**
   - Variable types use enums: `v_estimate_status public.estimate_status`
   - Reference: `snapshot-architecture-research.md`

3. **`restore_estimate_snapshot(p_snapshot_id UUID, p_restored_by UUID, p_force BOOLEAN DEFAULT FALSE)`**
   - Auto-saves current state as checkpoint before restore
   - Acquires advisory lock: `pg_advisory_xact_lock(hashtext(estimate_id::text))`
   - **Uses savepoint pattern for safety:**
     1. Auto-save checkpoint
     2. `SAVEPOINT pre_restore`
     3. Delete current tree data
     4. Deserialize snapshot JSONB back into tables
     5. Validate FK integrity
     6. If any error -> `ROLLBACK TO pre_restore` (tree restored to pre-delete state)
     7. If success -> `RELEASE SAVEPOINT pre_restore`
   - Uses `SET LOCAL app.is_snapshot_copy = 'true'` (same bypass variable as deep-copy)
   - **Includes ltree path rebuild step** (recursive CTE, same as deep-copy)
   - **Restores `was_auto_promoted`** for each node
   - Reference: `snapshot-architecture-research.md`

4. **`create_estimate_from_snapshot(p_snapshot_id UUID, p_name VARCHAR, p_version_label VARCHAR, p_created_by UUID)`**
   - Returns new estimate UUID
   - Creates a NEW estimate row (new estimate_id, same version_group)
   - Deserializes snapshot JSONB into the new estimate's tables
   - Rebuilds ltree paths
   - Uses `SET LOCAL app.is_snapshot_copy = 'true'`

5. **`set_subtree_visibility(p_node_id UUID, p_visibility VARCHAR)`**
   - Updates all descendants via ltree `path <@` query
   - Returns count of updated nodes
   - Reference: `client-visibility-research.md` Section 3

6. **`create_toggle_option(p_estimate_id UUID, p_anchor_node_id UUID, p_name VARCHAR, p_description TEXT)`**
   - Creates toggle-type option group with "Excluded" + "Included" alternatives
   - Reference: `options-system-research.md`

7. **`compare_option_sets(p_estimate_id UUID)`**
   - Returns table of (option_set_id, option_set_name, total_price) for all sets
   - Reference: `options-system-research.md`

**Note:** `set_app_user_id` is NOT needed -- triggers use `auth.uid()` directly for `changed_by`.

### Smoke Test (run after Phase 1A-9)

After all migrations are applied, run an end-to-end smoke test:

```sql
-- Smoke test: project -> estimate -> nodes -> snapshot -> restore -> verify
DO $$
DECLARE
  v_project_id UUID;
  v_estimate_id UUID;
  v_node_id UUID;
  v_snapshot_id UUID;
  v_restored BOOLEAN;
BEGIN
  -- Create project
  INSERT INTO public.projects (name, user_id) VALUES ('Smoke Test', auth.uid()) RETURNING id INTO v_project_id;
  -- Create estimate
  INSERT INTO public.estimates (name, project_id) VALUES ('Smoke Est', v_project_id) RETURNING id INTO v_estimate_id;
  -- Create nodes
  INSERT INTO public.estimate_nodes (estimate_id, name, node_type) VALUES (v_estimate_id, 'Root', 'group') RETURNING id INTO v_node_id;
  INSERT INTO public.estimate_nodes (estimate_id, name, node_type, parent_id) VALUES (v_estimate_id, 'Child', 'item', v_node_id);
  -- Create snapshot
  v_snapshot_id := public.create_estimate_snapshot(v_estimate_id, 'Smoke Snap', NULL, 'milestone', auth.uid());
  -- Restore snapshot
  PERFORM public.restore_estimate_snapshot(v_snapshot_id, auth.uid());
  -- Verify nodes still exist
  ASSERT (SELECT count(*) FROM public.estimate_nodes WHERE estimate_id = v_estimate_id) = 2, 'Node count mismatch after restore';
  -- Cleanup
  DELETE FROM public.projects WHERE id = v_project_id;
  RAISE NOTICE 'SMOKE TEST PASSED';
END $$;
```

### Agent Assignments

| Agent | Scope | Type |
|-------|-------|------|
| Agent 1 | `deep_copy_estimate()` -- highest complexity | Full-capability |
| Agent 2 | `create_estimate_snapshot()` + `restore_estimate_snapshot()` + `create_estimate_from_snapshot()` | Full-capability |
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
grep -q "create_estimate_from_snapshot" "$F" && ((PASS++)) || ((FAIL++))
grep -q "set_subtree_visibility" "$F" && ((PASS++)) || ((FAIL++))
grep -q "create_toggle_option" "$F" && ((PASS++)) || ((FAIL++))
grep -q "pg_advisory_xact_lock" "$F" && ((PASS++)) || ((FAIL++))
grep -q "SAVEPOINT" "$F" && ((PASS++)) || ((FAIL++))
grep -q "was_auto_promoted" "$F" && ((PASS++)) || ((FAIL++))
# Unified bypass variable
grep -q "app.is_snapshot_copy" "$F" && ((PASS++)) || ((FAIL++))
! grep -q "app.is_snapshot_restore" "$F" && ((PASS++)) || ((FAIL++))
# search_path = '' for all SECURITY DEFINER functions
! grep -q "search_path = public" "$F" && ((PASS++)) || ((FAIL++))
# No node_attachments reference
! grep -q "node_attachments" "$F" && ((PASS++)) || ((FAIL++))

# SQL verification: all migrations apply cleanly
npx supabase db reset 2>/dev/null && ((PASS++)) || ((FAIL++))

echo "Phase 1A-9: PASS=$PASS FAIL=$FAIL"
[ $FAIL -eq 0 ] && echo "GATE: PASSED" || echo "GATE: FAILED"
```

### Commit

```
feat(db): PostgreSQL functions -- deep_copy, snapshots (create/restore/from), visibility, options
```

---

## Phase 1A-10: Generated Types, Domain Types & Test Infrastructure

**Goal:** Generate Supabase types, create domain types with discriminated unions, build CORE validation schemas, and set up test infrastructure.

### Step 0: Reset Database for Clean Type Generation

```bash
npx supabase db reset  # Ensure all 10 migrations are cleanly applied
```

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
import type { Database } from '@/lib/types/supabase';
createBrowserClient<Database>(...) // client.ts
createServerClient<Database>(...) // server.ts
createClient<Database>(...)       // admin.ts
```

### Step 4: CORE Validation Schemas (Zod)

Only schemas needed for Phase 1A server actions. Options/catalog/notes/settings schemas ship with 1B.

| File | Schemas |
|------|---------|
| `src/lib/validation/projects.ts` | `createProjectSchema`, `updateProjectSchema` |
| `src/lib/validation/estimates.ts` | `createEstimateSchema`, `updateEstimateSchema` |
| `src/lib/validation/nodes.ts` | `createNodeSchema`, `updateNodeSchema`, `moveNodeSchema`, `duplicateNodeSchema` |
| `src/lib/validation/snapshots.ts` | `createSnapshotSchema`, `restoreSnapshotSchema` |
| `src/lib/validation/status.ts` | `projectStatusSchema`, `estimateStatusSchema` |
| `src/lib/validation/format-error.ts` | `formatZodError()` utility for user-facing error messages |

**Deferred to 1B:** `settings.ts`, `preferences.ts`, `options.ts`, `notes.ts`, `catalog.ts` validation schemas (ship alongside their server actions and UI).

### Step 5: Options Tree Filter Utility

| File | Exports |
|------|---------|
| `src/lib/options/filter-active-tree.ts` | `buildMembershipMap()`, `getDeselectedFromLive()`, `getDeselectedForOptionSet()`, `filterActiveTree()`, `getTreesForAllOptionSets()` |

### Step 6: Test Infrastructure Setup

| File | Purpose |
|------|---------|
| `tests/setup/db-helpers.ts` | Database connection helpers, admin client setup |
| `tests/setup/role-helpers.ts` | Role-switching utilities (owner, employee, client, pending, anon) using service_role to set JWT claims |
| `tests/setup/seed-factories.ts` | Factory functions: `createTestProject()`, `createTestEstimate()`, `createTestNode()`, `createTestUser()` |
| `tests/setup/cleanup.ts` | Transaction isolation, test data cleanup |

**Note:** Tests use the existing `vitest.config.ts` with its `db` project. Do NOT create a new `vitest.config.db.ts`.

### Agent Assignments

| Agent | Scope | Type |
|-------|-------|------|
| Agent 1 | Run `supabase db reset` + `supabase gen types` + update all client files with Database generic | Full-capability |
| Agent 2 | Domain type files (nodes, snapshots, enums, options, settings, preferences) | Full-capability |
| Agent 3 | Core Zod validation schemas (6 files) + format-error utility | Full-capability |
| Agent 4 | Options tree filter utility + status-transitions + test infrastructure (helpers, factories, cleanup) | Full-capability |

### Verification Script

```bash
#!/bin/bash
PASS=0; FAIL=0

# Generated types exist
[ -f "src/lib/types/supabase.ts" ] && ((PASS++)) || ((FAIL++))
grep -q "Database" "src/lib/types/supabase.ts" && ((PASS++)) || ((FAIL++))

# Domain types exist and are populated
for f in "src/lib/types/domain/nodes.ts" "src/lib/types/domain/snapshots.ts" \
         "src/lib/types/action-result.ts" "src/lib/types/enums.ts" \
         "src/lib/types/options.ts" "src/lib/types/settings.ts" \
         "src/lib/types/preferences.ts" "src/lib/types/status-transitions.ts"; do
  [ -f "$f" ] && ((PASS++)) || ((FAIL++))
done

# CORE validation schemas exist
for f in "src/lib/validation/status.ts" "src/lib/validation/projects.ts" \
         "src/lib/validation/estimates.ts" "src/lib/validation/nodes.ts" \
         "src/lib/validation/snapshots.ts" "src/lib/validation/format-error.ts"; do
  [ -f "$f" ] && ((PASS++)) || ((FAIL++))
done

# Options filter exists
[ -f "src/lib/options/filter-active-tree.ts" ] && ((PASS++)) || ((FAIL++))

# Test infrastructure exists
for f in "tests/setup/db-helpers.ts" "tests/setup/role-helpers.ts" \
         "tests/setup/seed-factories.ts" "tests/setup/cleanup.ts"; do
  [ -f "$f" ] && ((PASS++)) || ((FAIL++))
done

# Supabase clients are typed
grep -q "Database" "src/lib/supabase/client.ts" && ((PASS++)) || ((FAIL++))
grep -q "Database" "src/lib/supabase/server.ts" && ((PASS++)) || ((FAIL++))

# Key type patterns
grep -q "NodeWithDetails" "src/lib/types/domain/nodes.ts" && ((PASS++)) || ((FAIL++))
grep -q "ActionResult" "src/lib/types/action-result.ts" && ((PASS++)) || ((FAIL++))

# TypeScript compiles
npx tsc --noEmit 2>/dev/null && ((PASS++)) || ((FAIL++))

echo "Phase 1A-10: PASS=$PASS FAIL=$FAIL"
[ $FAIL -eq 0 ] && echo "GATE: PASSED" || echo "GATE: FAILED"
```

### Commit

```
feat(types): generated types, domain models, core validation schemas, test infrastructure, options filter
```

---

## Phase 1A-11: Core Server Actions

**Goal:** Create ~28 CORE server actions (projects, estimates, nodes, snapshots) organized by entity, all returning `ActionResult<T>`. Non-core actions (catalog, options, option-sets, notes, search, settings, preferences) ship in Phase 1B alongside their consuming UI.

### Step 0: Reference Implementation (BEFORE parallel agents)

One agent creates the shared utility and one reference file:

1. **`src/lib/actions/_shared.ts`** -- shared imports, helper functions:
   - `getAuthenticatedClient()` -- creates typed Supabase server client, verifies auth
   - `mapSupabaseError()` -- maps Supabase error codes to `ErrorCode`
   - `requireRole()` -- checks user has required role, returns err() if not

2. **`src/lib/actions/projects.ts`** -- reference implementation with `createProject` and `listProjects` fully implemented, demonstrating the exact pattern all other actions must follow.

### Step 1: Parallel Agent Implementation

After the reference implementation is reviewed and approved, remaining agents implement using it as the pattern template.

### File Organization: `src/lib/actions/`

| File | Actions | Count |
|------|---------|-------|
| `_shared.ts` | `getAuthenticatedClient`, `mapSupabaseError`, `requireRole` | 3 helpers |
| `projects.ts` | `createProject`, `updateProject`, `deleteProject`, `getProject`, `listProjects`, `updateProjectStatus` | 6 |
| `estimates.ts` | `createEstimate`, `updateEstimate`, `deleteEstimate`, `getEstimate`, `listEstimates`, `updateEstimateStatus`, `createVersion` | 7 |
| `nodes.ts` | `createNode`, `updateNode`, `deleteNode`, `moveNode`, `duplicateNode`, `convertNodeType`, `toggleFlag`, `setVisibility`, `setSubtreeVisibility` | 9 |
| `snapshots.ts` | `createSnapshot`, `restoreSnapshot`, `createEstimateFromSnapshot`, `listSnapshots`, `getSnapshot`, `deleteCheckpoints` | 6 |

**Total: ~28 action functions + 3 shared helpers**

**Deferred to Phase 1B (ship alongside consuming UI):**
- `options.ts` -- option group/alternative management
- `option-sets.ts` -- option set CRUD
- `settings.ts` -- company settings
- `preferences.ts` -- user preferences
- `notes.ts` -- note CRUD
- `catalog.ts` -- catalog management
- `search.ts` -- full-text search

### Pattern for Every Action

```typescript
'use server';

import { getAuthenticatedClient, mapSupabaseError, requireRole } from './_shared';
import { ok, err } from '@/lib/types/action-result';
import { createNodeSchema } from '@/lib/validation/nodes';
import type { ActionResult } from '@/lib/types/action-result';
import type { NodeWithDetails } from '@/lib/types/domain/nodes';

export async function createNode(input: unknown): Promise<ActionResult<NodeWithDetails>> {
  const roleCheck = await requireRole(['owner', 'employee']);
  if (!roleCheck.success) return roleCheck;

  const parsed = createNodeSchema.safeParse(input);
  if (!parsed.success) {
    return err('Invalid input', 'VALIDATION_ERROR', formatZodError(parsed.error));
  }

  const { supabase } = await getAuthenticatedClient();
  const { data, error } = await supabase.from('estimate_nodes').insert({...}).select().single();

  if (error) return mapSupabaseError(error);
  return ok(data);
}
```

### Agent Assignments

| Agent | Scope | Type |
|-------|-------|------|
| Agent 0 (Reference) | `_shared.ts` + `projects.ts` (reference implementation) -- runs FIRST | Full-capability |
| Agent 1 | `estimates.ts` (7 actions) | Full-capability |
| Agent 2 | `nodes.ts` (9 actions -- most complex) | Full-capability |
| Agent 3 | `snapshots.ts` (6 actions) | Full-capability |

### Verification Script

```bash
#!/bin/bash
PASS=0; FAIL=0

# Core action files exist
for f in "src/lib/actions/_shared.ts" "src/lib/actions/projects.ts" \
         "src/lib/actions/estimates.ts" "src/lib/actions/nodes.ts" \
         "src/lib/actions/snapshots.ts"; do
  [ -f "$f" ] && ((PASS++)) || ((FAIL++))
done

# All use ActionResult
for f in src/lib/actions/projects.ts src/lib/actions/estimates.ts \
         src/lib/actions/nodes.ts src/lib/actions/snapshots.ts; do
  grep -q "ActionResult" "$f" && ((PASS++)) || ((FAIL++))
done

# All use 'use server'
for f in src/lib/actions/projects.ts src/lib/actions/estimates.ts \
         src/lib/actions/nodes.ts src/lib/actions/snapshots.ts; do
  grep -q "'use server'" "$f" && ((PASS++)) || ((FAIL++))
done

# All use shared helpers
for f in src/lib/actions/projects.ts src/lib/actions/estimates.ts \
         src/lib/actions/nodes.ts src/lib/actions/snapshots.ts; do
  grep -q "_shared" "$f" && ((PASS++)) || ((FAIL++))
done

# TypeScript compiles
npx tsc --noEmit 2>/dev/null && ((PASS++)) || ((FAIL++))

echo "Phase 1A-11: PASS=$PASS FAIL=$FAIL"
[ $FAIL -eq 0 ] && echo "GATE: PASSED" || echo "GATE: FAILED"
```

### Commit

```
feat(actions): core server actions for projects, estimates, nodes, snapshots with shared utilities
```

---

## Phase 1A-12: Core Tests

**Goal:** ~82 CORE test cases covering triggers, constraints, RLS, snapshot round-trip, and deep-copy. Server action, validation, and type guard tests ship in Phase 1B.

### Test Suites

| Suite | File | Test Count | Priority |
|-------|------|-----------|----------|
| **Snapshot round-trip** | `tests/db/snapshots.test.ts` | 15 | CRITICAL |
| **Deep copy** | `tests/db/deep-copy.test.ts` | 12 | CRITICAL |
| **RLS policies** | `tests/db/rls.test.ts` | 20 | CRITICAL |
| **Trigger correctness** | `tests/db/triggers.test.ts` | 15 | HIGH |
| **Constraint enforcement** | `tests/db/constraints.test.ts` | 10 | HIGH |
| **Client visibility** | `tests/db/client-visibility.test.ts` | 10 | HIGH |

**Total: ~82 CORE test cases**

**Deferred to Phase 1B (ship alongside their features):**
- Options system tests (~10)
- Company settings tests (~12)
- Enum validation tests (~10)
- Server action tests (~20)
- Validation schema tests (~15)
- TypeScript type guard tests (~8)
- Catalog/notes tests (~7)

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
16. **Restore with corrupted JSONB leaves tree intact** (tests savepoint rollback)

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
12. Performance: copy 100-node estimate in <500ms

**RLS tests (20):**
- Reference: `client-visibility-research.md` test cases 4-16
- Reference: `rls-authorization-research.md` Section 4

**Note:** Tests run against the local Supabase instance. `supabase start` and `supabase db reset` must have been run (part of Prerequisites). Tests use the existing `vitest.config.ts` with its `db` project.

### Agent Assignments

| Agent | Scope | Type |
|-------|-------|------|
| Agent 1 | Snapshot + deep-copy tests (27 tests) | Full-capability |
| Agent 2 | RLS + client visibility tests (30 tests) | Full-capability |
| Agent 3 | Trigger + constraint tests (25 tests) | Full-capability |

### Verification Script

```bash
#!/bin/bash
PASS=0; FAIL=0

# Core test files exist
for f in "tests/db/snapshots.test.ts" "tests/db/deep-copy.test.ts" \
         "tests/db/rls.test.ts" "tests/db/triggers.test.ts" \
         "tests/db/constraints.test.ts" "tests/db/client-visibility.test.ts"; do
  [ -f "$f" ] && ((PASS++)) || ((FAIL++))
done

# Count total test cases
TOTAL=$(grep -r "it(\|test(" tests/db/ 2>/dev/null | wc -l)
[ "$TOTAL" -ge 70 ] && ((PASS++)) || ((FAIL++))

# Tests pass (using existing vitest config with db project)
npx vitest run --project db 2>/dev/null && ((PASS++)) || ((FAIL++))

# SQL verification: all tables have RLS
TABLES_NO_RLS=$(npx supabase db reset 2>/dev/null && psql "$DATABASE_URL" -t -c "
  SELECT c.relname FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
  AND c.relrowsecurity = false
  AND c.relname NOT IN ('schema_migrations')
" 2>/dev/null | tr -d ' ' | grep -v '^$')
[ -z "$TABLES_NO_RLS" ] && ((PASS++)) || echo "WARN: Tables without RLS: $TABLES_NO_RLS"

echo "Phase 1A-12: PASS=$PASS FAIL=$FAIL (Total test cases: $TOTAL)"
[ $FAIL -eq 0 ] && echo "GATE: PASSED" || echo "GATE: FAILED"
```

### Commit

```
test(db): core test suite -- 82+ tests for triggers, RLS, snapshots, deep-copy, constraints, client visibility
```

---

## Phase 1A-13: Documentation & Contract Sync

**Goal:** Update all project meta-documents to reflect the Phase 1A work. Create contracts for new feature boundaries.

### Updates Required

| Document | Updates |
|----------|---------|
| `CODEBASE_MAP.md` | Add all new directories and files: `src/lib/types/domain/`, `src/lib/validation/`, `src/lib/actions/`, `src/lib/options/`, `tests/setup/`, `tests/db/`, 10 migration files |
| `INTENT.md` | Record decisions: enum strategy (CREATE TYPE), snapshot storage (JSONB), user_profiles consolidation, 3-value client_visibility, is_staff() RLS pattern, trigger bypass mechanism |
| `CONTRACT-INDEX.md` | Add entries for all new contracts |

### New Contracts

| Contract | Governs | Key Rules |
|----------|---------|-----------|
| `contracts/snapshot-system.contract.md` | Snapshot create/restore/from boundary | JSONB schema version, immutability enforcement, savepoint restore, service_role INSERT only |
| `contracts/rls-authorization.contract.md` | RLS policy patterns across all tables | is_staff() for staff, client_has_project_access() for clients, deny-all for history tables |
| `contracts/client-visibility.contract.md` | Client data access patterns | 3-value VARCHAR, field visibility matrix, client VIEWs, node_notes dual-boolean |
| `contracts/options-system.contract.md` | Options/alternatives/sets boundary | group_type, selection uniqueness, membership junction, active tree filtering |

### Session Handoff Document

Write cumulative "Phase 1A State" document to `.claude/memory/sessions/phase-1a-state.md`:

```markdown
# Phase 1A Cumulative State

## Tables Created (with key non-obvious columns)
- client_visibility is VARCHAR(20) with 3 values ('visible', 'hidden', 'summary_only') -- NOT a boolean
- node_notes.format is ('markdown', 'html') -- NOT ('markdown', 'plain')
- estimate_status_at_time uses public.estimate_status ENUM -- NOT VARCHAR
- user_profiles.role uses public.app_role ENUM
- get_user_role() returns TEXT (not app_role enum)

## Decisions Locked In
- Single bypass variable: app.is_snapshot_copy (no other names)
- Snapshot INSERT: service_role only via SECURITY DEFINER function
- History tables: RLS enabled, deny-all + service_role bypass
- All SECURITY DEFINER functions use SET search_path = ''
- node_attachments does NOT exist -- excluded from deep-copy and snapshots

## Gotchas for Next Session
- [Updated each session]
```

### Agent Assignments

| Agent | Scope | Type |
|-------|-------|------|
| Agent 1 | CODEBASE_MAP.md + INTENT.md updates | Full-capability |
| Agent 2 | Contract files + CONTRACT-INDEX.md | Full-capability |
| Agent 3 | Session handoff document + memory index update | Full-capability |

### Commit

```
docs: Phase 1A documentation sync -- contracts, CODEBASE_MAP, INTENT, session state
```

---

## Phase 1B: Features (High-Level)

Phase 1B builds user-facing features on top of the Phase 1A schema foundation. Each sub-phase ships its server actions, validation schemas, and tests alongside the UI.

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
- "Add to Catalog" -- save node as reusable template
- Catalog browser panel with search
- "Insert from Catalog" + "Update from Catalog"
- Server actions: `catalog.ts`, `search.ts`
- Validation schemas: `catalog.ts`
- Tests: catalog + search tests

**Dependencies:** Phase 1A complete, node CRUD UI exists

### 1B-3: Options UI (2-3 sessions)

**Deliverables:**
- Option group/alternative management UI
- Visual indicators for option-owned nodes in tree
- Option set management (create, name, edit selections)
- Option set comparison table
- Active tree filtering
- Server actions: `options.ts`, `option-sets.ts`
- Validation schemas: `options.ts`
- Tests: options system tests

**Dependencies:** Phase 1A complete. Note: 1B-3 can ship without Phase 2A calculation engine -- use raw subtotals for comparison. Accurate formula-based totals come when Phase 2A completes.

### 1B-4: Client Portal (3-4 sessions)

**Deliverables:**
- Share link generation UI
- Share link validation endpoint (server-side API route with rate limiting per C13)
- Client estimate viewer (filtered by client_visibility)
- Client commenting + approval workflow
- Per-IP rate limiting: 20 attempts/hour/IP via in-memory rate limiter

**Dependencies:** Phase 1A complete

### 1B-5: Search & Filtering (1-2 sessions)

**Deliverables:**
- Search box component with live filtering
- Full-text search using tsvector
- Filter bar: node type, cost code, phase, cost range, flagged
- Server actions: `search.ts`

**Dependencies:** Phase 1A complete (GIN indexes exist)

### 1B-6: Preferences & Settings UI (1 session)

**Deliverables:**
- Company settings form + user preferences panel
- Estimate view state persistence with debounce
- Server actions: `settings.ts`, `preferences.ts`, `notes.ts`
- Validation schemas: `settings.ts`, `preferences.ts`, `notes.ts`
- Tests: settings + preferences + notes tests

**Dependencies:** Phase 1A complete

---

## Phase 2+: Roadmap

### Phase 2A: Calculation Engine (3-4 sessions)
- Formula parser, isomorphic calculation pipeline, subtotal/contingency/overhead rollup

### Phase 2B: Reporting & Exports (2-3 sessions)
- Estimate reports, CSV/Excel export, print layouts

### Phase 2C: PDF Generation (1-2 sessions)
- PDF proposals, branded output

### Phase 2D: Figma Design Integration (2-3 sessions)
- Design system refinement, component library alignment

### Phase 2E: Mobile/Tablet Optimization (1-2 sessions)
- Touch-friendly navigation, responsive layouts, PWA

---

## Dependency DAG

```
Phase 1A-0 (Security Foundation -- 2 migrations)
  |
  v
Phase 1A-1 (Enums & Extensions)
  |
  v
Phase 1A-2 (Reference + Core Tables) ── units, cost_codes created FIRST
  |                                     NO client RLS (deferred)
  +------------------+
  |                  |
  v                  v
Phase 1A-3          Phase 1A-4
(Supporting)        (Catalog/Options/Vendors/Broad Options)
  |                  |
  +------------------+
  |
  v
Phase 1A-5 (Client/Sharing + client_has_project_access() + Client RLS for ALL tables)
  |         ── depends on BOTH 1A-3 AND 1A-4 (estimate_approvals FK to option_sets)
  v
Phase 1A-6 (Triggers) ── requires all tables exist
  |
  v
Phase 1A-7 (History Tables) ── requires all application tables (for trigger attachment)
  |                             NO indexes (consolidated in 1A-8)
  v
Phase 1A-8 (ALL Indexes + Seeds) ── single source for all indexes
  |
  v
Phase 1A-9 (Functions + Smoke Test) ── requires tables + triggers + indexes
  |
  v
Phase 1A-10 (Types + Test Infrastructure) ── requires final schema
  |
  v
Phase 1A-11 (Core Server Actions) ── requires types + validation
  |         ── reference implementation BEFORE parallel agents
  v
Phase 1A-12 (Core Tests) ── requires everything above
  |
  v
Phase 1A-13 (Documentation Sync) ── requires everything above
```

**Parallel opportunities within Phase 1A:**
- 1A-3 and 1A-4 can run in parallel (both depend only on 1A-2)
- 1A-5 depends on BOTH 1A-3 AND 1A-4 (corrected from v1 which said "NOT on 1A-3/1A-4")
- Within each phase, agents run in parallel on independent tables/files

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
| `tsconfig.json` | 1A-0 (add noImplicitReturns only) | Only modified in 1A-0 |
| Tables from 1A-2/3/4 | 1A-5 (adds client RLS policies via CREATE POLICY) | 1A-5 adds NEW policies, does not modify existing table definitions |

**No two phases write to the same migration file.** Each phase has its own numbered migration(s).

---

## Cross-Session Context Management

### Session Handoff Requirements

After EACH session that works on Phase 1A:

1. **Update `.claude/memory/sessions/phase-1a-state.md`** with:
   - Tables created so far (with key non-obvious columns)
   - TypeScript files created
   - Decisions locked in
   - "Gotchas" section for things that diverge from naive assumptions
   - What was attempted and what failed (if anything)

2. **At session start**, read `phase-1a-state.md` as L1 context (alongside INTENT.md, CODEBASE_MAP.md, CONTRACT-INDEX.md).

3. **Regression check**: Each session's verification script should validate ALL prior phases, not just the current one. Use `supabase db reset` to verify the full migration chain.

---

## Verification Gates

### Pre-Commit Gate (every phase)

```bash
#!/bin/bash
echo "=== Pre-Commit Verification ==="

# 1. TypeScript compiles
npx tsc --noEmit && echo "PASS: TypeScript" || echo "FAIL: TypeScript"

# 2. Lint passes
npx next lint && echo "PASS: Lint" || echo "FAIL: Lint"

# 3. Build succeeds
npm run build && echo "PASS: Build" || echo "FAIL: Build"

# 4. Supabase migrations valid (if migrations changed)
if git diff --cached --name-only | grep -q "supabase/migrations"; then
  npx supabase db reset && echo "PASS: Migration reset" || echo "FAIL: Migration reset"
fi
```

### RLS Gate (SQL-based, run after migration phases)

```bash
#!/bin/bash
echo "=== RLS Gate ==="
# SQL-based verification: check actual database state, not just file contents
TABLES_NO_RLS=$(psql "$DATABASE_URL" -t -c "
  SELECT c.relname FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
  AND c.relrowsecurity = false
  AND c.relname NOT IN ('schema_migrations')
" 2>/dev/null | tr -d ' ' | grep -v '^$')

if [ -z "$TABLES_NO_RLS" ]; then
  echo "PASS: All tables have RLS enabled"
else
  echo "FAIL: Tables without RLS: $TABLES_NO_RLS"
fi
```

---

## Session Estimates

| Phase | Est. Sessions | Agent Count | Key Risk |
|-------|--------------|-------------|----------|
| 1A-0 | 0.5 | 3 | user_profiles migration must be atomic |
| 1A-1 | 0.25 | 1 | Low risk |
| 1A-2 | 0.5 | 3 | Reference tables must come before core tables in file |
| 1A-3 | 0.25 | 2 | Low risk |
| 1A-4 | 0.5 | 3 | Options system complexity, broad_options moved here |
| 1A-5 | 0.5 | 3 | Client RLS for ALL prior tables; snapshot immutability |
| 1A-6 | 0.5 | 2 | Trigger bypass must use unified variable name |
| 1A-7 | 0.25 | 1 | Low risk; no indexes (in 1A-8) |
| 1A-8 | 0.25 | 1 | Low risk |
| 1A-9 | 0.75 | 3 | deep_copy + restore savepoints are highest-risk functions |
| 1A-10 | 0.75 | 4 | Generated types + test infrastructure setup |
| 1A-11 | 0.75 | 4 | Reference implementation first, then parallel |
| 1A-12 | 1.0 | 3 | Core tests only; snapshot round-trip correctness |
| 1A-13 | 0.25 | 3 | Documentation sync |
| **Total 1A** | **~6.5** | **max 4** | **+0.5 debugging buffer = ~7 sessions** |
| 1B (all) | 4-6 | varies | UI complexity, design system adherence, deferred actions/tests |
| 2+ | TBD | varies | Calculation engine algorithm correctness |

---

## Migration File Summary

| Order | File | Phase | Contents |
|-------|------|-------|----------|
| 1a | `20260409000001_security_foundation.sql` | 1A-0 | get_user_role, is_staff, user_profiles, helpers, triggers, grants |
| 1b | `20260409000001b_drop_user_roles.sql` | 1A-0 | Drop user_roles (only after 1A-0a succeeds) |
| 2 | `20260409000002_extensions_and_enums.sql` | 1A-1 | ltree, pg_trgm, project_status, estimate_status |
| 3 | `20260409000003_core_tables.sql` | 1A-2 | units, cost_codes, projects, estimates, phases, estimate_nodes, detail tables, node_notes + staff RLS |
| 4 | `20260409000004_supporting_tables.sql` | 1A-3 | parameters, company_settings, preferences, view_state |
| 5 | `20260409000005_catalog_options_vendors.sql` | 1A-4 | vendors, catalog tables, option system (11 tables), broad_options |
| 6 | `20260409000006_client_sharing_tables.sql` | 1A-5 | client_project_access, client_has_project_access(), snapshots, shares, comments, approvals + client RLS for ALL tables + client VIEWs |
| 7 | `20260409000007_triggers.sql` | 1A-6 | All trigger functions with unified bypass |
| 8 | `20260409000008_history_tables.sql` | 1A-7 | History tables + history triggers + deny-all RLS |
| 9 | `20260409000009_indexes_and_seeds.sql` | 1A-8 | ALL indexes (including history) + seed data |
| 10 | `20260409000010_functions.sql` | 1A-9 | deep_copy, snapshot functions (create/restore/from), visibility, options helpers |

---

## TypeScript File Summary

| Directory | Files | Phase |
|-----------|-------|-------|
| `src/lib/types/` | `enums.ts`, `action-result.ts`, `settings.ts`, `preferences.ts`, `options.ts`, `status-transitions.ts`, `supabase.ts` | 1A-0 (stubs), 1A-10 (populated) |
| `src/lib/types/domain/` | `nodes.ts`, `snapshots.ts` | 1A-0 (stubs), 1A-10 (populated) |
| `src/lib/validation/` | `status.ts`, `projects.ts`, `estimates.ts`, `nodes.ts`, `snapshots.ts`, `format-error.ts` | 1A-10 |
| `src/lib/actions/` | `_shared.ts`, `projects.ts`, `estimates.ts`, `nodes.ts`, `snapshots.ts` | 1A-11 |
| `src/lib/options/` | `filter-active-tree.ts` | 1A-10 |
| `tests/setup/` | `db-helpers.ts`, `role-helpers.ts`, `seed-factories.ts`, `cleanup.ts` | 1A-10 |
| `tests/db/` | 6 test files | 1A-12 |

**Deferred to 1B:**
| `src/lib/validation/` | `settings.ts`, `preferences.ts`, `options.ts`, `notes.ts`, `catalog.ts` | 1B |
| `src/lib/actions/` | `options.ts`, `option-sets.ts`, `settings.ts`, `preferences.ts`, `notes.ts`, `catalog.ts`, `search.ts` | 1B |
| `tests/actions/`, `tests/validation/`, `tests/types/` | All | 1B |

---

## Research File Index

All research is in `.scratch/epp/20260408-2040/phase-3/research/`:

| File | Governs | Primary Phases |
|------|---------|---------------|
| `snapshot-architecture-research.md` | Snapshot JSONB schema, create/restore functions, immutability | 1A-5, 1A-9 |
| `rls-authorization-research.md` | get_user_role, user_profiles, RLS matrix, client access | 1A-0, 1A-5 (client RLS) |
| `client-visibility-research.md` | 3-value VARCHAR, field visibility matrix, client VIEWs, notes | 1A-2, 1A-5 |
| `options-system-research.md` | group_type, toggle options, active tree filter, option sets | 1A-4, 1A-10 |
| `enum-strategy-research.md` | CREATE TYPE decision, 4 vs 6 statuses, transition guardrails | 1A-1, 1A-10 |
| `type-system-research.md` | NodeWithDetails union, ActionResult, error codes, Zod inventory | 1A-0, 1A-10 |
| `deep-copy-function-research.md` | Table copy order, FK remapping, trigger bypass, advisory locks | 1A-9 |
| `settings-preferences-research.md` | Hybrid company_settings, user_preferences PK, view_state debounce | 1A-3, 1A-10 |
