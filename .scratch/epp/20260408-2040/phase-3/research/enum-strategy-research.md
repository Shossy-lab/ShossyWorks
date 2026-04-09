# Enum and Status Strategy Research

## Problem Statement

The codebase needs PostgreSQL type definitions for `project_status` (10 values) and `estimate_status` (4 values) before any application tables can reference them. The existing codebase already uses `CREATE TYPE public.app_role AS ENUM (...)` for user roles, establishing a precedent. The comprehensive analysis identified a disagreement between analysts: CREATE TYPE enums (type safety, smaller storage, consistency with `app_role`) vs CHECK constraints (easier to modify values). Additionally, the Business Logic analyst proposed expanding estimate statuses from 4 to 6. This research resolves both questions with concrete SQL, TypeScript, and transition guardrail designs.

---

## Recommended Solution

### Decision: CREATE TYPE enums (not CHECK constraints)

**Recommendation: Use `CREATE TYPE ... AS ENUM` for both `project_status` and `estimate_status`.**

#### Trade-off Analysis

| Criterion | CREATE TYPE ENUM | CHECK Constraint |
|-----------|-----------------|-----------------|
| **Type safety** | Full -- column IS the type; impossible to store invalid value even via `service_role` | Partial -- constraint can be bypassed with `ALTER TABLE ... DROP CONSTRAINT` |
| **Storage** | 4 bytes per value (internal OID) | VARCHAR storage (10-25 bytes per value) |
| **Index performance** | Integer comparison internally | String comparison |
| **Codebase consistency** | Matches existing `app_role` pattern exactly | Introduces a second pattern for the same concept |
| **Adding values** | `ALTER TYPE ... ADD VALUE` -- append-only, cannot remove (but can add `IF NOT EXISTS`) | Drop and recreate constraint -- can add or remove freely |
| **Removing values** | Requires: create new type, migrate column, drop old type. Painful with data. | Drop and recreate constraint. Trivial. |
| **Renaming values** | `ALTER TYPE ... RENAME VALUE` (PG 10+). Easy. | Update CHECK + all existing data. Moderate. |
| **Ordering** | Implicit order by definition order. Enables `<` / `>` comparisons. | No ordering. Must use CASE or lookup table. |
| **Supabase codegen** | Generates TypeScript enum type in `database.types.ts` automatically | Generates `string` type -- no narrowing |
| **JOIN overhead** | None -- value stored inline | None -- value stored inline |

#### Why CREATE TYPE wins for this project

1. **No production data exists.** The "can't remove values" downside of CREATE TYPE is irrelevant during development. We can `DROP TYPE` and recreate freely until production launch. After launch, the 10 project statuses and 4 estimate statuses are stable business concepts that map to real-world construction phases.

2. **Supabase codegen matters.** The generated `database.types.ts` will produce a proper union type (`'lead' | 'in_design' | ...`) for CREATE TYPE enums. CHECK constraints produce `string`, losing all type narrowing at the TypeScript boundary.

3. **Consistency.** `app_role` already uses CREATE TYPE. Having `project_status` and `estimate_status` use a different mechanism creates cognitive overhead for every developer (or AI agent) touching the schema.

4. **Ordering is useful.** Project statuses have a natural progression (lead -> closed). CREATE TYPE preserves this ordering, enabling queries like `WHERE status > 'bidding'` to find all projects past the bidding phase. CHECK constraints cannot do this.

5. **Performance.** 4 bytes vs 10-25 bytes per row. With millions of history rows over time, this adds up. Not a primary concern, but a free benefit.

#### When CHECK constraints WOULD be correct

- If the value set were volatile (changing monthly). These status sets are not.
- If there were 50+ values (enum overhead becomes awkward). 10 and 4 are well within range.
- If multiple tables needed different subsets of the same values. Each status set is used by exactly one table.

---

### Decision: Keep 4 estimate statuses (not 6)

**Recommendation: Keep the user's decided 4 statuses: `draft`, `preliminary`, `active`, `complete`.**

#### Reasoning

The Business Logic analyst proposed 6 values: `draft, review, sent, approved, contract, archived`. While architecturally cleaner from a pure workflow perspective, this conflicts with the user's explicit decision and misunderstands the domain:

1. **The user decided 4 statuses.** Decision 1 explicitly states: "Estimate statuses (4 stages): Draft / Preliminary / Active / Complete. Can revert to any earlier status freely." This was a deliberate choice, not a placeholder.

2. **`preliminary` and `active` map to real construction concepts.** In residential construction estimating:
   - `draft` = work in progress, incomplete, not shared
   - `preliminary` = rough estimate shared with client for ballpark budgeting (common in design phase)
   - `active` = the estimate is being used for bidding/contract (the "live" version)
   - `complete` = final, all actuals reconciled, project closeout

3. **The 6-value proposal conflates estimate status with estimate actions.** "Sent" and "approved" are events that happen TO an estimate, not states the estimate IS IN. These are better modeled as:
   - `sent` -> a record in `estimate_shares` or a timestamp on the estimate
   - `approved` -> a record in `estimate_approvals`
   - `contract` -> the estimate status is `active` + the project status is `under_contract`
   - `archived` -> covered by project-level `archived` or soft-delete

4. **"Can revert to any earlier status freely"** is the user's explicit requirement. The 6-value set implies a one-way funnel (`draft -> review -> sent -> approved -> contract -> archived`) that contradicts this.

5. **Fewer statuses = simpler UI.** A 4-value dropdown vs a 6-value dropdown. The user explicitly chose simplicity.

#### If expansion is needed later

Adding values to a CREATE TYPE enum is a one-line migration:
```sql
ALTER TYPE public.estimate_status ADD VALUE 'review' BEFORE 'preliminary';
```
This is safe, non-destructive, and requires no data migration. The cost of starting with 4 and expanding later is near-zero.

---

### SQL: Exact CREATE TYPE Statements

```sql
-- ============================================================
-- Migration: Extensions + Enums
-- Must run BEFORE any table that references these types
-- ============================================================

-- ── Project Status Enum ─────────────────────────────────────
-- 10 stages covering the full residential construction lifecycle.
-- Ordered by typical project progression (ordering is meaningful
-- for queries like "projects past bidding phase").
-- Full flexibility: any status can transition to any other.
CREATE TYPE public.project_status AS ENUM (
  'lead',
  'in_design',
  'bidding',
  'under_contract',
  'value_engineering',
  'active_construction',
  'closing_out',
  'warranty_period',
  'closed',
  'archived'
);

-- ── Estimate Status Enum ────────────────────────────────────
-- 4 stages covering estimate maturity lifecycle.
-- Can revert to any earlier status freely.
CREATE TYPE public.estimate_status AS ENUM (
  'draft',
  'preliminary',
  'active',
  'complete'
);

-- ── Convenience: Comment documenting the enums ──────────────
COMMENT ON TYPE public.project_status IS
  'Project lifecycle stages. Any-to-any transitions allowed. Ordered by typical progression.';
COMMENT ON TYPE public.estimate_status IS
  'Estimate maturity stages: draft -> preliminary -> active -> complete. Free reversion allowed.';
```

#### Usage in table definitions

```sql
-- In the projects table CREATE TABLE:
status public.project_status NOT NULL DEFAULT 'lead',

-- In the estimates table CREATE TABLE:
status public.estimate_status NOT NULL DEFAULT 'draft',
```

#### Replacing old VARCHAR status columns

The data architecture doc defines `status VARCHAR(50)` on both `projects` and `estimates`. The migration replaces these:

```sql
-- Old (data architecture doc):
--   projects.status VARCHAR(50) with values 'active','on_hold','completed','archived'
-- New:
--   projects.status project_status NOT NULL DEFAULT 'lead'

-- Old (data architecture doc):
--   estimates.status VARCHAR(50) with values 'draft','in_review','approved','sent','accepted','archived'
-- New:
--   estimates.status estimate_status NOT NULL DEFAULT 'draft'
```

Since no production data exists, this is a clean replacement -- no ALTER TABLE or data migration needed. The CREATE TABLE statements simply use the new types.

---

### TypeScript: Const Objects Mirroring Enums

These go in `src/lib/types/enums.ts` and serve as the single source of truth for the application layer. They mirror the PostgreSQL enums exactly.

```typescript
// src/lib/types/enums.ts
// ────────────────────────────────────────────────────────────
// Application-level enum definitions mirroring PostgreSQL types.
// These are the ONLY place status values should be referenced
// in application code. Never use raw string literals.
// ────────────────────────────────────────────────────────────

// ── Project Status ──────────────────────────────────────────

export const PROJECT_STATUS = {
  LEAD: 'lead',
  IN_DESIGN: 'in_design',
  BIDDING: 'bidding',
  UNDER_CONTRACT: 'under_contract',
  VALUE_ENGINEERING: 'value_engineering',
  ACTIVE_CONSTRUCTION: 'active_construction',
  CLOSING_OUT: 'closing_out',
  WARRANTY_PERIOD: 'warranty_period',
  CLOSED: 'closed',
  ARCHIVED: 'archived',
} as const;

export type ProjectStatus = typeof PROJECT_STATUS[keyof typeof PROJECT_STATUS];

/** All project status values in lifecycle order */
export const PROJECT_STATUS_VALUES: readonly ProjectStatus[] = [
  PROJECT_STATUS.LEAD,
  PROJECT_STATUS.IN_DESIGN,
  PROJECT_STATUS.BIDDING,
  PROJECT_STATUS.UNDER_CONTRACT,
  PROJECT_STATUS.VALUE_ENGINEERING,
  PROJECT_STATUS.ACTIVE_CONSTRUCTION,
  PROJECT_STATUS.CLOSING_OUT,
  PROJECT_STATUS.WARRANTY_PERIOD,
  PROJECT_STATUS.CLOSED,
  PROJECT_STATUS.ARCHIVED,
] as const;

/** Human-readable labels for UI display */
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  lead: 'Lead',
  in_design: 'In Design',
  bidding: 'Bidding',
  under_contract: 'Under Contract',
  value_engineering: 'Value Engineering',
  active_construction: 'Active Construction',
  closing_out: 'Closing Out',
  warranty_period: 'Warranty Period',
  closed: 'Closed',
  archived: 'Archived',
} as const;

/** Short descriptions for tooltips / help text */
export const PROJECT_STATUS_DESCRIPTIONS: Record<ProjectStatus, string> = {
  lead: 'Initial inquiry or prospect, not yet committed',
  in_design: 'Design phase, plans being developed with architect',
  bidding: 'Estimates being prepared and submitted for pricing',
  under_contract: 'Contract signed, pre-construction activities',
  value_engineering: 'Scope and cost adjustments before construction',
  active_construction: 'Construction is underway on site',
  closing_out: 'Punch list, final inspections, documentation',
  warranty_period: 'Post-completion warranty coverage period',
  closed: 'All obligations fulfilled, project complete',
  archived: 'Removed from active views, retained for reference',
} as const;

// ── Estimate Status ─────────────────────────────────────────

export const ESTIMATE_STATUS = {
  DRAFT: 'draft',
  PRELIMINARY: 'preliminary',
  ACTIVE: 'active',
  COMPLETE: 'complete',
} as const;

export type EstimateStatus = typeof ESTIMATE_STATUS[keyof typeof ESTIMATE_STATUS];

/** All estimate status values in maturity order */
export const ESTIMATE_STATUS_VALUES: readonly EstimateStatus[] = [
  ESTIMATE_STATUS.DRAFT,
  ESTIMATE_STATUS.PRELIMINARY,
  ESTIMATE_STATUS.ACTIVE,
  ESTIMATE_STATUS.COMPLETE,
] as const;

/** Human-readable labels for UI display */
export const ESTIMATE_STATUS_LABELS: Record<EstimateStatus, string> = {
  draft: 'Draft',
  preliminary: 'Preliminary',
  active: 'Active',
  complete: 'Complete',
} as const;

/** Short descriptions for tooltips / help text */
export const ESTIMATE_STATUS_DESCRIPTIONS: Record<EstimateStatus, string> = {
  draft: 'Work in progress, not yet shared with anyone',
  preliminary: 'Rough estimate for budgeting purposes',
  active: 'Live estimate used for bidding or contract',
  complete: 'Finalized, all actuals reconciled',
} as const;

// ── Utility Functions ───────────────────────────────────────

/** Check if a string is a valid ProjectStatus */
export function isProjectStatus(value: string): value is ProjectStatus {
  return PROJECT_STATUS_VALUES.includes(value as ProjectStatus);
}

/** Check if a string is a valid EstimateStatus */
export function isEstimateStatus(value: string): value is EstimateStatus {
  return ESTIMATE_STATUS_VALUES.includes(value as EstimateStatus);
}

/**
 * Get the ordinal position of a project status (0-indexed).
 * Useful for comparing progression: isAfter = ordinal(a) > ordinal(b)
 */
export function projectStatusOrdinal(status: ProjectStatus): number {
  return PROJECT_STATUS_VALUES.indexOf(status);
}

/**
 * Get the ordinal position of an estimate status (0-indexed).
 */
export function estimateStatusOrdinal(status: EstimateStatus): number {
  return ESTIMATE_STATUS_VALUES.indexOf(status);
}
```

#### Zod Validation Schemas (companion file)

```typescript
// src/lib/validation/status.ts
import { z } from 'zod';

import { ESTIMATE_STATUS_VALUES, PROJECT_STATUS_VALUES } from '@/lib/types/enums';

export const projectStatusSchema = z.enum(
  PROJECT_STATUS_VALUES as unknown as [string, ...string[]]
);

export const estimateStatusSchema = z.enum(
  ESTIMATE_STATUS_VALUES as unknown as [string, ...string[]]
);
```

---

### Status Transition Guardrails (Application-Level)

**Recommendation: Soft guardrails only. No database-level enforcement of transitions.**

The user explicitly stated: "Full flexibility -- any status can transition to any other." Database-enforced transition constraints would violate this requirement. Instead, implement application-level warnings for unusual or potentially destructive transitions.

#### Design

```typescript
// src/lib/types/status-transitions.ts

import {
  ESTIMATE_STATUS,
  PROJECT_STATUS,
} from '@/lib/types/enums';

import type { EstimateStatus, ProjectStatus } from '@/lib/types/enums';

// ── Project Status Transitions ──────────────────────────────

/**
 * Transition warning levels:
 * - 'none': transition is normal, no confirmation needed
 * - 'confirm': unusual transition, show confirmation dialog
 * - 'warn': potentially destructive, show warning with explanation
 */
export type TransitionWarning = 'none' | 'confirm' | 'warn';

export interface TransitionResult {
  warning: TransitionWarning;
  message: string | null;
  /** Optional: suggest creating a snapshot before this transition */
  suggestSnapshot: boolean;
}

/**
 * Evaluate a project status transition and return any warnings.
 * This does NOT block the transition -- the user always has final say.
 */
export function evaluateProjectTransition(
  from: ProjectStatus,
  to: ProjectStatus
): TransitionResult {
  // Same status -- no-op
  if (from === to) {
    return { warning: 'none', message: null, suggestSnapshot: false };
  }

  // Moving to archived -- always confirm
  if (to === PROJECT_STATUS.ARCHIVED) {
    return {
      warning: 'confirm',
      message: 'Archiving will remove this project from active views. You can unarchive later.',
      suggestSnapshot: false,
    };
  }

  // Moving backward more than 2 stages (skipping stages)
  const fromIdx = PROJECT_STATUS_VALUES.indexOf(from);
  const toIdx = PROJECT_STATUS_VALUES.indexOf(to);
  if (toIdx < fromIdx - 2) {
    return {
      warning: 'confirm',
      message: `Moving from "${PROJECT_STATUS_LABELS[from]}" back to "${PROJECT_STATUS_LABELS[to]}" skips several stages. Are you sure?`,
      suggestSnapshot: false,
    };
  }

  // Moving from closed/warranty back to active phases
  if (
    (from === PROJECT_STATUS.CLOSED || from === PROJECT_STATUS.WARRANTY_PERIOD) &&
    toIdx <= PROJECT_STATUS_VALUES.indexOf(PROJECT_STATUS.CLOSING_OUT)
  ) {
    return {
      warning: 'warn',
      message: `Reopening a ${PROJECT_STATUS_LABELS[from].toLowerCase()} project to "${PROJECT_STATUS_LABELS[to]}" is unusual. This typically means additional work was discovered.`,
      suggestSnapshot: false,
    };
  }

  // Skipping forward more than 2 stages
  if (toIdx > fromIdx + 2 && to !== PROJECT_STATUS.ARCHIVED) {
    return {
      warning: 'confirm',
      message: `Jumping from "${PROJECT_STATUS_LABELS[from]}" to "${PROJECT_STATUS_LABELS[to]}" skips intermediate stages. Proceed?`,
      suggestSnapshot: false,
    };
  }

  // Normal transition
  return { warning: 'none', message: null, suggestSnapshot: false };
}

// Import the labels/values arrays (already imported above via enums)
const PROJECT_STATUS_VALUES = Object.values(PROJECT_STATUS);
const PROJECT_STATUS_LABELS_MAP = PROJECT_STATUS_LABELS;

/**
 * Evaluate an estimate status transition and return any warnings.
 */
export function evaluateEstimateTransition(
  from: EstimateStatus,
  to: EstimateStatus
): TransitionResult {
  // Same status -- no-op
  if (from === to) {
    return { warning: 'none', message: null, suggestSnapshot: false };
  }

  // Moving FROM complete to anything -- warn, suggest snapshot
  if (from === ESTIMATE_STATUS.COMPLETE) {
    return {
      warning: 'warn',
      message: 'Reverting a completed estimate will allow edits. A snapshot of the current state is recommended.',
      suggestSnapshot: true,
    };
  }

  // Moving FROM active to draft (skipping preliminary) -- confirm
  if (from === ESTIMATE_STATUS.ACTIVE && to === ESTIMATE_STATUS.DRAFT) {
    return {
      warning: 'confirm',
      message: 'Moving an active estimate back to draft. If this estimate has been shared with clients, they will no longer see updates.',
      suggestSnapshot: true,
    };
  }

  // Moving TO complete -- suggest snapshot
  if (to === ESTIMATE_STATUS.COMPLETE) {
    return {
      warning: 'confirm',
      message: 'Marking as complete indicates all pricing is final. A snapshot will be created automatically.',
      suggestSnapshot: true,
    };
  }

  // Normal transition (including any revert)
  return { warning: 'none', message: null, suggestSnapshot: false };
}
```

**Note on the import structure above:** The actual file will import `PROJECT_STATUS_LABELS` and `PROJECT_STATUS_VALUES` from `@/lib/types/enums`. The duplicate `const` declarations shown above are artifacts of the research format -- the real implementation will have clean imports only.

---

### Status History: No dedicated table needed

**Recommendation: Do NOT create a `project_status_history` or `estimate_status_history` table in Phase 1A.**

#### Reasoning

1. **The `estimate_nodes_history` table already captures estimate-level changes** via triggers. Adding status-specific history tables creates redundant audit infrastructure.

2. **Status changes are low-frequency events.** A project might change status 10-15 times over its entire lifecycle. An estimate might change status 4-6 times. This does not warrant dedicated history tables.

3. **If audit is needed later, it can be added trivially:**

```sql
-- IF needed in Phase 1B+:
CREATE TABLE public.project_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  old_status public.project_status NOT NULL,
  new_status public.project_status NOT NULL,
  changed_by UUID NOT NULL REFERENCES auth.users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note TEXT  -- optional reason for the change
);

CREATE INDEX idx_project_status_history_project
  ON project_status_history(project_id, changed_at DESC);

-- Trigger to populate it:
CREATE OR REPLACE FUNCTION log_project_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.project_status_history
      (project_id, old_status, new_status, changed_by)
    VALUES
      (NEW.id, OLD.status, NEW.status, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_log_project_status_change
  AFTER UPDATE OF status ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION log_project_status_change();
```

4. **The `updated_at` and `updated_by` columns on `projects` and `estimates`** provide basic "who changed it last" tracking. For Phase 1A, this is sufficient.

5. **Snapshot metadata captures estimate status at snapshot time** via `estimate_status_at_time` on `estimate_snapshots`. This provides the most important audit point (what status was the estimate in when this snapshot was taken).

---

### Old-to-New Status Mapping

Since no production data exists (confirmed in the comprehensive analysis), this is a documentation-only mapping for reference:

#### Project Statuses

| Old Value (data arch doc) | New Value | Notes |
|--------------------------|-----------|-------|
| `'active'` | `'active_construction'` | Or `'in_design'` / `'bidding'` depending on context -- "active" was ambiguous |
| `'on_hold'` | No direct equivalent | Projects are never "on hold" in the new model. A paused project stays at its current stage. If needed, add an `is_paused BOOLEAN` column later. |
| `'completed'` | `'closed'` | "Completed" maps to "Closed" (all obligations fulfilled) |
| `'archived'` | `'archived'` | Direct mapping, same semantics |

#### Estimate Statuses

| Old Value (data arch doc) | New Value | Notes |
|--------------------------|-----------|-------|
| `'draft'` | `'draft'` | Direct mapping |
| `'in_review'` | `'preliminary'` | "In review" maps to the preliminary/budgeting phase |
| `'approved'` | `'active'` | An approved estimate is the active/live one |
| `'sent'` | `'preliminary'` or `'active'` | "Sent" is an action, not a state. Sending a preliminary = still preliminary. Sending a bid = active. |
| `'accepted'` | `'complete'` | Client acceptance = estimate is finalized |
| `'archived'` | No direct equivalent | Estimates are archived at the project level (project status = archived). If per-estimate archival is needed, add a `deleted_at` soft-delete column. |

**Action required: None.** No data migration needed. The CREATE TABLE statements use the new types from the start. This mapping exists solely for understanding how the domain model evolved.

---

### File Paths

| Artifact | Path |
|----------|------|
| PostgreSQL enum types | `supabase/migrations/YYYYMMDDHHMMSS_extensions_and_enums.sql` (first migration in Phase 1A) |
| TypeScript enum constants | `src/lib/types/enums.ts` |
| Zod validation schemas | `src/lib/validation/status.ts` |
| Transition guardrails | `src/lib/types/status-transitions.ts` |
| Status history (deferred) | `supabase/migrations/YYYYMMDDHHMMSS_status_history.sql` (Phase 1B if needed) |

---

## Trade-offs Considered

| Decision | Chosen | Rejected | Why |
|----------|--------|----------|-----|
| Enum mechanism | CREATE TYPE | CHECK constraint | Consistency with `app_role`, Supabase codegen, ordering, storage efficiency. No production data = no migration risk. |
| Estimate status count | 4 values | 6 values | User explicitly decided 4. The 6-value set conflates states with events. Adding values later is trivial. |
| Transition enforcement | Application-level warnings | Database triggers blocking invalid transitions | User requires "full flexibility, any to any." Hard blocks would violate this. |
| Status history table | Deferred to Phase 1B+ | Phase 1A | Low-frequency events, `updated_at`/`updated_by` sufficient for now, snapshot metadata captures key audit points. |
| `on_hold` equivalent | Omitted (no direct mapping) | Adding `is_paused` boolean | No user request for pause functionality. Can be added as a boolean if needed. |

---

## Effort Estimate

| Task | Effort |
|------|--------|
| SQL migration (CREATE TYPE x2, COMMENT x2) | 15 minutes |
| TypeScript enums.ts (constants, types, labels, utilities) | 30 minutes |
| TypeScript status-transitions.ts (guardrail logic) | 30 minutes |
| Zod validation schemas | 10 minutes |
| **Total** | **~1.5 hours** |

This is part of the first Phase 1A migration (extensions + enums) and the initial TypeScript type system setup.

---

## Dependencies

| This depends on | Why |
|-----------------|-----|
| Nothing | Enums are the first migration -- they depend on nothing. |

| Depends on this | Why |
|-----------------|-----|
| `projects` table | References `project_status` type |
| `estimates` table | References `estimate_status` type |
| `estimate_snapshots` table | Stores `estimate_status_at_time` and `project_status_at_time` |
| All server actions that mutate project/estimate status | Import from `enums.ts` |
| All UI components rendering status | Import labels/descriptions from `enums.ts` |

---

## Test Cases

### SQL Tests

| # | Test | Type | Description |
|---|------|------|-------------|
| 1 | Enum values exist | Constraint | Verify `SELECT enum_range(NULL::project_status)` returns all 10 values in order |
| 2 | Enum values exist | Constraint | Verify `SELECT enum_range(NULL::estimate_status)` returns all 4 values in order |
| 3 | Invalid insert rejected | Constraint | `INSERT INTO projects (..., status) VALUES (..., 'invalid')` should fail with type error |
| 4 | NULL rejected | Constraint | `INSERT INTO projects (..., status) VALUES (..., NULL)` should fail (NOT NULL) |
| 5 | Default applied | Constraint | `INSERT INTO projects (...) VALUES (...)` without status should default to `'lead'` |
| 6 | Default applied | Constraint | `INSERT INTO estimates (...) VALUES (...)` without status should default to `'draft'` |
| 7 | Ordering works | Query | `SELECT 'bidding'::project_status > 'lead'::project_status` should be TRUE |
| 8 | Any-to-any update | Mutation | `UPDATE projects SET status = 'closed' WHERE status = 'lead'` should succeed (no transition restrictions) |
| 9 | Enum in snapshot | Integration | `estimate_snapshots.estimate_status_at_time` accepts all 4 estimate_status values |
| 10 | Enum in snapshot | Integration | `estimate_snapshots.project_status_at_time` accepts all 10 project_status values |

### TypeScript Tests

| # | Test | Description |
|---|------|-------------|
| 11 | Type guard - valid | `isProjectStatus('lead')` returns `true` |
| 12 | Type guard - invalid | `isProjectStatus('invalid')` returns `false` |
| 13 | Type guard - valid | `isEstimateStatus('draft')` returns `true` |
| 14 | Type guard - invalid | `isEstimateStatus('in_review')` returns `false` (old value) |
| 15 | Ordinal correctness | `projectStatusOrdinal('lead')` returns `0`, `projectStatusOrdinal('archived')` returns `9` |
| 16 | Labels complete | Every value in `PROJECT_STATUS_VALUES` has a corresponding entry in `PROJECT_STATUS_LABELS` |
| 17 | Labels complete | Every value in `ESTIMATE_STATUS_VALUES` has a corresponding entry in `ESTIMATE_STATUS_LABELS` |
| 18 | Values array length | `PROJECT_STATUS_VALUES.length === 10` |
| 19 | Values array length | `ESTIMATE_STATUS_VALUES.length === 4` |

### Transition Guardrail Tests

| # | Test | Description |
|---|------|-------------|
| 20 | Normal forward | `evaluateProjectTransition('lead', 'in_design')` returns `warning: 'none'` |
| 21 | Archive confirm | `evaluateProjectTransition('active_construction', 'archived')` returns `warning: 'confirm'` |
| 22 | Big skip back | `evaluateProjectTransition('closing_out', 'lead')` returns `warning: 'confirm'` |
| 23 | Reopen closed | `evaluateProjectTransition('closed', 'active_construction')` returns `warning: 'warn'` |
| 24 | Same status | `evaluateProjectTransition('bidding', 'bidding')` returns `warning: 'none'` |
| 25 | Complete revert | `evaluateEstimateTransition('complete', 'draft')` returns `warning: 'warn'` and `suggestSnapshot: true` |
| 26 | Mark complete | `evaluateEstimateTransition('active', 'complete')` returns `suggestSnapshot: true` |
| 27 | Normal forward | `evaluateEstimateTransition('draft', 'preliminary')` returns `warning: 'none'` |
