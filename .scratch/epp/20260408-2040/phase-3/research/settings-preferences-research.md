# Company Settings & User Preferences Research

## Problem Statement

Three tables (`company_settings`, `user_preferences`, `estimate_view_state`) are needed to store business configuration and per-user UI state. These tables are read on nearly every page load and estimate open, so the schema must balance query performance with migration flexibility. The key design tensions are: (1) hybrid normalized+JSONB vs pure JSONB for company settings, (2) write frequency management for expand/collapse state that changes with every user click, and (3) whether `user_id` alone should serve as PK for the preferences table. All three tables need RLS policies that respect the owner/employee/client/pending role model.

## Recommended Solution

### SQL

#### 1. `get_user_role()` Helper (Prerequisite -- referenced in all policies below)

This function MUST exist before any of these tables are created. It is defined in the RLS helpers migration but included here for completeness of the RLS policies.

```sql
-- NOTE: This is defined in the RLS helpers migration, NOT in this migration.
-- Included here only so the policies below are self-contained for review.
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS public.app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'user_role')::public.app_role,
    'pending'::public.app_role
  );
$$;
```

#### 2. `company_settings` (Hybrid Approach)

**Design rationale -- which fields are columns vs JSONB:**

- **Columns:** Fields that participate in SQL calculations, have database-level type constraints, or are referenced by other tables via FK. These are the financial rates (used as defaults when creating new estimate items) and the default unit FK.
- **JSONB (`settings_json`):** Fields that are display-only, informational, and opaque to the database. These include company contact info, license/insurance details, payment terms, warranty language, and branding. These change infrequently and are never used in SQL queries or calculations.

```sql
-- ============================================================
-- company_settings: Single-row company configuration
-- Hybrid: columns for calculated/constrained fields, JSONB for display fields
-- ============================================================
CREATE TABLE public.company_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Singleton enforcement: only one row can exist
  singleton_key TEXT NOT NULL DEFAULT 'default' UNIQUE
    CONSTRAINT only_one_row CHECK (singleton_key = 'default'),

  -- ── Financial Defaults (columns -- used in calculations) ──────
  default_markup_rate    DECIMAL(5,4) NOT NULL DEFAULT 0.0000
    CONSTRAINT valid_markup CHECK (default_markup_rate >= 0 AND default_markup_rate <= 1),
  default_overhead_rate  DECIMAL(5,4) NOT NULL DEFAULT 0.0000
    CONSTRAINT valid_overhead CHECK (default_overhead_rate >= 0 AND default_overhead_rate <= 1),
  default_contingency_rate DECIMAL(5,4) NOT NULL DEFAULT 0.0000
    CONSTRAINT valid_contingency CHECK (default_contingency_rate >= 0 AND default_contingency_rate <= 1),
  default_tax_rate       DECIMAL(5,4) NOT NULL DEFAULT 0.0000
    CONSTRAINT valid_tax CHECK (default_tax_rate >= 0 AND default_tax_rate <= 1),

  -- ── Default Unit (FK -- used when creating new items) ─────────
  default_unit_id UUID REFERENCES public.units_of_measure(id)
    ON DELETE SET NULL,

  -- ── Display / Informational Fields (JSONB) ────────────────────
  -- Schema for settings_json is enforced at the application level via Zod.
  -- The database treats this as an opaque blob.
  settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- ── Timestamps ────────────────────────────────────────────────
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger: auto-update updated_at
CREATE TRIGGER set_company_settings_updated_at
  BEFORE UPDATE ON public.company_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;

-- Owner: full read/write
CREATE POLICY "owner_full_access" ON public.company_settings
  FOR ALL TO authenticated
  USING (public.get_user_role() = 'owner')
  WITH CHECK (public.get_user_role() = 'owner');

-- Employee: read-only (they need rates for creating estimates, but cannot change them)
CREATE POLICY "employee_read_only" ON public.company_settings
  FOR SELECT TO authenticated
  USING (public.get_user_role() = 'employee');

-- Client, pending, anon: no access
CREATE POLICY "deny_anon" ON public.company_settings
  FOR ALL TO anon
  USING (false);

-- Prevent INSERT if row already exists (defense in depth beyond unique constraint)
-- The singleton_key UNIQUE constraint is the primary guard; this trigger
-- provides a clearer error message.
CREATE OR REPLACE FUNCTION public.prevent_duplicate_company_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT count(*) FROM public.company_settings) >= 1 THEN
    RAISE EXCEPTION 'company_settings already has a row. UPDATE instead of INSERT.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_singleton_company_settings
  BEFORE INSERT ON public.company_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_duplicate_company_settings();
```

**Construction business fields stored in `settings_json`:**

The JSONB blob accommodates all construction-specific business information beyond financial rates. The expected schema (enforced by Zod at the application layer):

```jsonc
{
  // Company identity
  "company_name": "Szostak Design & Build",
  "company_address": {
    "street": "123 Main St",
    "city": "Anytown",
    "state": "OH",
    "zip": "44101"
  },
  "company_phone": "555-123-4567",
  "company_email": "info@szostakdesign.com",
  "company_website": "https://szostakdesign.com",

  // Licensing & insurance
  "license_number": "HIC-123456",
  "license_state": "OH",
  "license_expiry": "2027-12-31",
  "insurance_provider": "Hartford",
  "insurance_policy_number": "POL-789",
  "insurance_expiry": "2027-06-30",
  "bonding_capacity": 500000,

  // Default terms (used in proposals/contracts)
  "payment_terms": "Net 30",
  "payment_schedule": "30% deposit, 30% at rough-in, 30% at substantial completion, 10% at final walkthrough",
  "warranty_terms": "1-year workmanship warranty from date of substantial completion",
  "standard_inclusions": "All work performed per local building codes...",
  "standard_exclusions": "Permits and fees, architectural/engineering drawings unless specified...",

  // Estimate defaults (non-financial)
  "default_estimate_validity_days": 30,
  "default_bid_type": "estimate",

  // Branding
  "logo_url": null,
  "primary_color": "#1a1a1a",
  "accent_color": "#d4a843"
}
```

#### 3. `user_preferences`

**Design decision: `user_id` as PK.**

Yes, use `user_id` as PK. Rationale:
- One row per user, always. No multi-row preference scenarios.
- Eliminates a synthetic `id UUID` column and the need for a separate unique index on `user_id`.
- Natural key makes lookups O(1) with no index indirection -- the PK IS the lookup key.
- `ON DELETE CASCADE` from `auth.users` ensures cleanup.
- JSONB blob because preference shapes evolve rapidly during development; adding a column for every UI toggle would require constant migrations.

```sql
-- ============================================================
-- user_preferences: Per-user UI preferences and personal settings
-- One row per user, JSONB blob for flexibility
-- ============================================================
CREATE TABLE public.user_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- All preferences in one JSONB blob. Schema enforced by Zod at app layer.
  preferences JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger: auto-update updated_at
CREATE TRIGGER set_user_preferences_updated_at
  BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

-- Users can only read/write their own preferences
CREATE POLICY "own_preferences_only" ON public.user_preferences
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Deny anon
CREATE POLICY "deny_anon" ON public.user_preferences
  FOR ALL TO anon
  USING (false);

-- Deny pending (they cannot access the app, so no preferences to save)
-- Note: the USING clause in "own_preferences_only" already handles this
-- since pending users should be redirected by middleware. But defense in depth:
-- pending users whose user_id matches would pass the above policy.
-- We accept this: saving preferences is harmless for pending users,
-- and middleware prevents them from reaching any UI that would trigger it.
```

#### 4. `estimate_view_state`

**Write frequency handling for expand/collapse state:**

The expand/collapse state changes on every click. Writing to the database on every click is wasteful and creates unnecessary write amplification. The solution is a **client-side debounce** strategy:

1. **Client-side:** Keep the full `view_state` in React state (useReducer). On every expand/collapse, update local state immediately (instant UI response).
2. **Debounced persist:** After the last state change, wait 3 seconds of inactivity before writing to the database. Use a `useEffect` cleanup + `setTimeout` pattern or a debounce utility. If the user navigates away before the debounce fires, persist on `beforeunload` or `visibilitychange` events.
3. **No Supabase Realtime subscription** on this table -- view state is personal and never needs cross-user sync.
4. **UPSERT pattern:** Always use `INSERT ... ON CONFLICT (user_id, estimate_id) DO UPDATE SET view_state = EXCLUDED.view_state, updated_at = now()`. This handles first-open (INSERT) and subsequent updates (UPDATE) in one statement.

```sql
-- ============================================================
-- estimate_view_state: Per-user, per-estimate UI state
-- Composite PK (user_id, estimate_id) -- no synthetic id needed
-- ============================================================
CREATE TABLE public.estimate_view_state (
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  estimate_id UUID NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,

  -- All view state in JSONB. Schema enforced at app layer.
  view_state JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Timestamp -- only updated_at matters (we care about recency, not creation)
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Composite primary key
  PRIMARY KEY (user_id, estimate_id)
);

-- Index: look up all view states for a user (e.g., "recently opened estimates")
CREATE INDEX idx_estimate_view_state_user
  ON public.estimate_view_state(user_id);

-- Index: clean up all view states when an estimate is deleted (CASCADE handles
-- this, but the index speeds up the CASCADE delete on large tables)
CREATE INDEX idx_estimate_view_state_estimate
  ON public.estimate_view_state(estimate_id);

-- No updated_at trigger needed -- the UPSERT statement sets updated_at explicitly.
-- Adding a trigger would fire on every debounced write, adding overhead for
-- a value we already set in the UPSERT. If future code paths update this table
-- without setting updated_at, add the trigger then.

-- RLS
ALTER TABLE public.estimate_view_state ENABLE ROW LEVEL SECURITY;

-- Users can only read/write their own view state
CREATE POLICY "own_view_state_only" ON public.estimate_view_state
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Deny anon
CREATE POLICY "deny_anon" ON public.estimate_view_state
  FOR ALL TO anon
  USING (false);
```

**Expected `view_state` JSONB structure:**

```jsonc
{
  // Expand/collapse state: array of expanded node IDs
  // (collapsed is the default -- only store expanded nodes)
  "expanded_node_ids": ["uuid-1", "uuid-2", "uuid-3"],

  // Column visibility: which columns are shown in the estimate grid
  "visible_columns": ["name", "qty", "unit", "unit_cost", "total_price", "cost_code"],

  // Sort state
  "sort_column": "sort_order",
  "sort_direction": "asc",

  // Scroll position (restored when re-opening estimate)
  "scroll_top": 0,

  // Selected node (restored when re-opening)
  "selected_node_id": null,

  // Zoom / density
  "density": "comfortable" // "compact" | "comfortable" | "spacious"
}
```

### TypeScript Types and Zod Schemas

File: `src/lib/types/settings.ts`

```typescript
// ── Company Settings ─────────────────────────────────────────────

/** Address structure for company settings */
export interface CompanyAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
}

/** Shape of the settings_json JSONB blob on company_settings */
export interface CompanySettingsJson {
  // Company identity
  company_name: string;
  company_address: CompanyAddress | null;
  company_phone: string | null;
  company_email: string | null;
  company_website: string | null;

  // Licensing & insurance
  license_number: string | null;
  license_state: string | null;
  license_expiry: string | null; // ISO date string
  insurance_provider: string | null;
  insurance_policy_number: string | null;
  insurance_expiry: string | null; // ISO date string
  bonding_capacity: number | null;

  // Default terms
  payment_terms: string | null;
  payment_schedule: string | null;
  warranty_terms: string | null;
  standard_inclusions: string | null;
  standard_exclusions: string | null;

  // Estimate defaults (non-financial)
  default_estimate_validity_days: number;
  default_bid_type: 'bid' | 'allowance' | 'estimate';

  // Branding
  logo_url: string | null;
  primary_color: string | null;
  accent_color: string | null;
}

/** Full company_settings row */
export interface CompanySettings {
  id: string;
  singleton_key: 'default';
  default_markup_rate: number;
  default_overhead_rate: number;
  default_contingency_rate: number;
  default_tax_rate: number;
  default_unit_id: string | null;
  settings_json: CompanySettingsJson;
  created_at: string;
  updated_at: string;
}

/** Input for updating company settings (partial -- only changed fields) */
export interface CompanySettingsUpdate {
  default_markup_rate?: number;
  default_overhead_rate?: number;
  default_contingency_rate?: number;
  default_tax_rate?: number;
  default_unit_id?: string | null;
  settings_json?: Partial<CompanySettingsJson>;
}
```

File: `src/lib/types/preferences.ts`

```typescript
// ── User Preferences ─────────────────────────────────────────────

/** Shape of the preferences JSONB blob on user_preferences */
export interface UserPreferencesJson {
  // UI state
  sidebar_collapsed: boolean;
  theme: 'light' | 'dark' | 'system';
  last_visited_path: string | null;

  // Personal shortcuts
  favorite_cost_code_ids: string[];
  recently_used_item_ids: string[];
  pinned_project_ids: string[];
  preferred_unit_id: string | null;

  // Estimate defaults (personal, NOT company-wide)
  default_density: 'compact' | 'comfortable' | 'spacious';
  default_visible_columns: string[];
}

/** Full user_preferences row */
export interface UserPreferences {
  user_id: string;
  preferences: UserPreferencesJson;
  created_at: string;
  updated_at: string;
}

// ── Estimate View State ──────────────────────────────────────────

export type SortDirection = 'asc' | 'desc';
export type ViewDensity = 'compact' | 'comfortable' | 'spacious';

/** Shape of the view_state JSONB blob on estimate_view_state */
export interface EstimateViewStateJson {
  expanded_node_ids: string[];
  visible_columns: string[];
  sort_column: string;
  sort_direction: SortDirection;
  scroll_top: number;
  selected_node_id: string | null;
  density: ViewDensity;
}

/** Full estimate_view_state row */
export interface EstimateViewState {
  user_id: string;
  estimate_id: string;
  view_state: EstimateViewStateJson;
  updated_at: string;
}
```

File: `src/lib/validation/settings.ts`

```typescript
import { z } from 'zod';

// ── Company Address ──────────────────────────────────────────────

export const companyAddressSchema = z.object({
  street: z.string().max(255),
  city: z.string().max(100),
  state: z.string().max(2),
  zip: z.string().max(10),
});

// ── Company Settings JSON ────────────────────────────────────────

export const companySettingsJsonSchema = z.object({
  company_name: z.string().min(1).max(255),
  company_address: companyAddressSchema.nullable().default(null),
  company_phone: z.string().max(50).nullable().default(null),
  company_email: z.string().email().max(255).nullable().default(null),
  company_website: z.string().url().max(255).nullable().default(null),

  license_number: z.string().max(100).nullable().default(null),
  license_state: z.string().max(2).nullable().default(null),
  license_expiry: z.string().nullable().default(null),
  insurance_provider: z.string().max(255).nullable().default(null),
  insurance_policy_number: z.string().max(100).nullable().default(null),
  insurance_expiry: z.string().nullable().default(null),
  bonding_capacity: z.number().nonnegative().nullable().default(null),

  payment_terms: z.string().max(500).nullable().default(null),
  payment_schedule: z.string().max(1000).nullable().default(null),
  warranty_terms: z.string().max(2000).nullable().default(null),
  standard_inclusions: z.string().max(5000).nullable().default(null),
  standard_exclusions: z.string().max(5000).nullable().default(null),

  default_estimate_validity_days: z.number().int().min(1).max(365).default(30),
  default_bid_type: z.enum(['bid', 'allowance', 'estimate']).default('estimate'),

  logo_url: z.string().url().nullable().default(null),
  primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().default(null),
  accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().default(null),
});

// ── Rate validation (shared) ─────────────────────────────────────

const rateSchema = z.number().min(0).max(1);

// ── Company Settings Update ──────────────────────────────────────

export const companySettingsUpdateSchema = z.object({
  default_markup_rate: rateSchema.optional(),
  default_overhead_rate: rateSchema.optional(),
  default_contingency_rate: rateSchema.optional(),
  default_tax_rate: rateSchema.optional(),
  default_unit_id: z.string().uuid().nullable().optional(),
  settings_json: companySettingsJsonSchema.partial().optional(),
});
```

File: `src/lib/validation/preferences.ts`

```typescript
import { z } from 'zod';

// ── User Preferences ─────────────────────────────────────────────

export const userPreferencesJsonSchema = z.object({
  sidebar_collapsed: z.boolean().default(false),
  theme: z.enum(['light', 'dark', 'system']).default('system'),
  last_visited_path: z.string().nullable().default(null),

  favorite_cost_code_ids: z.array(z.string().uuid()).default([]),
  recently_used_item_ids: z.array(z.string().uuid()).max(50).default([]),
  pinned_project_ids: z.array(z.string().uuid()).default([]),
  preferred_unit_id: z.string().uuid().nullable().default(null),

  default_density: z.enum(['compact', 'comfortable', 'spacious']).default('comfortable'),
  default_visible_columns: z.array(z.string()).default([
    'name', 'qty', 'unit', 'unit_cost', 'total_price',
  ]),
});

export const userPreferencesUpdateSchema = userPreferencesJsonSchema.partial();

// ── Estimate View State ──────────────────────────────────────────

export const estimateViewStateJsonSchema = z.object({
  expanded_node_ids: z.array(z.string().uuid()).default([]),
  visible_columns: z.array(z.string()).default([
    'name', 'qty', 'unit', 'unit_cost', 'total_price',
  ]),
  sort_column: z.string().default('sort_order'),
  sort_direction: z.enum(['asc', 'desc']).default('asc'),
  scroll_top: z.number().int().min(0).default(0),
  selected_node_id: z.string().uuid().nullable().default(null),
  density: z.enum(['compact', 'comfortable', 'spacious']).default('comfortable'),
});

export const estimateViewStateUpdateSchema = estimateViewStateJsonSchema.partial();
```

### Seed Data

```sql
-- ============================================================
-- Seed: company_settings singleton row
-- ============================================================
INSERT INTO public.company_settings (
  default_markup_rate,
  default_overhead_rate,
  default_contingency_rate,
  default_tax_rate,
  default_unit_id,
  settings_json
) VALUES (
  0.0000,   -- markup: 0% (owner sets their own)
  0.1000,   -- overhead: 10% (common residential default)
  0.0500,   -- contingency: 5% (industry standard for residential)
  0.0000,   -- tax: 0% (varies by jurisdiction, owner must set)
  NULL,     -- default unit: none until units_of_measure is seeded
  jsonb_build_object(
    'company_name', 'My Company',
    'company_address', NULL,
    'company_phone', NULL,
    'company_email', NULL,
    'company_website', NULL,
    'license_number', NULL,
    'license_state', NULL,
    'license_expiry', NULL,
    'insurance_provider', NULL,
    'insurance_policy_number', NULL,
    'insurance_expiry', NULL,
    'bonding_capacity', NULL,
    'payment_terms', 'Net 30',
    'payment_schedule', NULL,
    'warranty_terms', '1-year workmanship warranty from date of substantial completion',
    'standard_inclusions', NULL,
    'standard_exclusions', NULL,
    'default_estimate_validity_days', 30,
    'default_bid_type', 'estimate',
    'logo_url', NULL,
    'primary_color', NULL,
    'accent_color', NULL
  )
);
```

### File Paths

| Artifact | Path |
|----------|------|
| Migration: company_settings | `supabase/migrations/XXXXXXXX_supporting_tables.sql` (part of the supporting tables migration) |
| Migration: user_preferences + estimate_view_state | Same migration file (they are supporting tables) |
| Migration: seed data | `supabase/migrations/XXXXXXXX_seed_data.sql` |
| TypeScript types: settings | `src/lib/types/settings.ts` |
| TypeScript types: preferences | `src/lib/types/preferences.ts` |
| Zod schemas: settings | `src/lib/validation/settings.ts` |
| Zod schemas: preferences | `src/lib/validation/preferences.ts` |
| Server actions: settings | `src/lib/actions/settings.ts` |
| Server actions: preferences | `src/lib/actions/preferences.ts` |

## Trade-offs Considered

### 1. Hybrid vs Pure JSONB for `company_settings`

| Approach | Pros | Cons |
|----------|------|------|
| **Hybrid (chosen)** | DB validates rate ranges, type-safe FKs for default_unit, rates are queryable/indexable | Requires migration to add new rate columns |
| Pure JSONB | Zero migrations for new fields | No DB validation on rates, no FK integrity for unit, rates are opaque strings in JSONB |
| Pure columns | Maximum type safety | Migration for every new field (company_phone, logo_url, etc.), table becomes wide |

**Decision:** Hybrid wins because the financial rates are the most critical fields (they affect every estimate calculation) and benefit from CHECK constraints. The informational fields change shape during development and never participate in SQL operations.

### 2. `user_id` as PK vs Synthetic `id` for `user_preferences`

| Approach | Pros | Cons |
|----------|------|------|
| **`user_id` as PK (chosen)** | Natural key, no wasted UUID column, one row guaranteed, O(1) lookup | Cannot have multiple preference rows per user (not needed) |
| Synthetic `id` PK | Follows the "every table has `id UUID PK`" convention | Requires a separate UNIQUE index on `user_id`, wastes storage, adds a JOIN key nobody uses |

**Decision:** `user_id` as PK. The "every table has `id`" convention exists to support many-to-one relationships. `user_preferences` is strictly one-to-one with `auth.users`, so the natural key is the correct choice.

### 3. Debounce interval for view state writes

| Interval | Writes/session (estimated) | UX risk |
|----------|---------------------------|---------|
| 1 second | ~60 writes in a heavy session | Too chatty, unnecessary DB load |
| **3 seconds (chosen)** | ~20 writes in a heavy session | Good balance -- state is saved within 3s of last interaction |
| 5 seconds | ~12 writes in a heavy session | Risk of losing state if browser crashes between clicks |
| 10 seconds | ~6 writes in a heavy session | Unacceptable data loss window |

**Decision:** 3-second debounce. Also persist on `visibilitychange` (tab switch/minimize) and `beforeunload` (page close) as safety nets.

### 4. `estimate_view_state` with or without `created_at`

Omitted `created_at` in favor of only `updated_at`. Rationale: the creation timestamp of a view state row has no business value. The only meaningful question is "when was this state last saved?" which `updated_at` answers. Keeping the table lean reduces the per-row storage for what could become a high-row-count table (users x estimates).

### 5. Singleton enforcement for `company_settings`

Three options considered:
- **`CHECK (singleton_key = 'default') + UNIQUE` (chosen):** Simple, clear, self-documenting. The `UNIQUE` constraint on `singleton_key` prevents a second row. The `CHECK` constraint ensures the value is always `'default'` so the query is always `WHERE singleton_key = 'default'` (or just `LIMIT 1`).
- **BEFORE INSERT trigger only:** Works but the error message is less clear than a constraint violation.
- **View over single row:** Over-engineered for this use case.

## Effort Estimate

| Task | Effort |
|------|--------|
| SQL: CREATE TABLE + RLS for all 3 tables | 1 hour |
| SQL: Seed data | 15 minutes |
| TypeScript: Types | 30 minutes |
| TypeScript: Zod schemas | 30 minutes |
| Server actions: getCompanySettings, updateCompanySettings | 45 minutes |
| Server actions: getUserPreferences, updateUserPreferences | 30 minutes |
| Server actions: getEstimateViewState, upsertEstimateViewState | 30 minutes |
| Client hook: useViewState with debounced persist | 1 hour |
| **Total** | **~4.5 hours** |

## Dependencies

| Dependency | Required By | Status |
|------------|-------------|--------|
| `get_user_role()` helper function | All RLS policies | Must be created in RLS helpers migration (before this migration) |
| `public.set_updated_at()` trigger function | `company_settings`, `user_preferences` triggers | Standard Supabase utility -- must exist before these tables |
| `public.units_of_measure` table | `company_settings.default_unit_id` FK | Must be created in same or earlier migration |
| `public.estimates` table | `estimate_view_state.estimate_id` FK | Must be created in same or earlier migration |
| `auth.users` table | `user_preferences.user_id`, `estimate_view_state.user_id` FKs | Exists (Supabase built-in) |

**Migration ordering:** These tables go in Migration 3 (Supporting tables), which runs after Migration 2 (Core tables including `estimates`) and Migration 1 (Extensions + Enums). The seed data goes in Migration 9.

## Test Cases

### company_settings

| # | Test | Description |
|---|------|-------------|
| CS-1 | Singleton enforcement | INSERT a second row -> expect constraint violation |
| CS-2 | Rate CHECK constraints | INSERT with `default_markup_rate = 1.5` -> expect CHECK violation |
| CS-3 | Rate CHECK constraints | INSERT with `default_markup_rate = -0.01` -> expect CHECK violation |
| CS-4 | Owner can read | As owner role -> SELECT from company_settings -> returns row |
| CS-5 | Owner can update | As owner role -> UPDATE rates -> succeeds |
| CS-6 | Employee can read | As employee role -> SELECT -> returns row |
| CS-7 | Employee cannot write | As employee role -> UPDATE -> denied by RLS |
| CS-8 | Client cannot access | As client role -> SELECT -> returns 0 rows |
| CS-9 | Pending cannot access | As pending role -> SELECT -> returns 0 rows |
| CS-10 | Anon cannot access | As anon -> SELECT -> returns 0 rows |
| CS-11 | JSONB partial update | UPDATE settings_json with partial object -> preserves unmodified keys |
| CS-12 | FK to units_of_measure | SET default_unit_id to valid unit -> succeeds; invalid UUID -> FK violation |

### user_preferences

| # | Test | Description |
|---|------|-------------|
| UP-1 | Create preferences | INSERT for current user -> succeeds |
| UP-2 | One row per user | INSERT second row for same user -> PK violation |
| UP-3 | Own preferences only | User A reads User B's preferences -> returns 0 rows |
| UP-4 | Own preferences write | User A updates User B's preferences -> denied by RLS |
| UP-5 | Cascade delete | Delete auth.users row -> user_preferences row deleted |
| UP-6 | Default JSONB | INSERT without preferences -> defaults to `{}` |
| UP-7 | Anon denied | Anon SELECT -> 0 rows |

### estimate_view_state

| # | Test | Description |
|---|------|-------------|
| EVS-1 | UPSERT first open | INSERT for (user_id, estimate_id) -> succeeds |
| EVS-2 | UPSERT subsequent | INSERT ON CONFLICT DO UPDATE -> updates view_state |
| EVS-3 | Own state only | User A reads User B's view state -> 0 rows |
| EVS-4 | Cascade on user delete | Delete auth.users -> all estimate_view_state rows for user deleted |
| EVS-5 | Cascade on estimate delete | Delete estimate -> all estimate_view_state rows for estimate deleted |
| EVS-6 | Composite PK unique | INSERT duplicate (user_id, estimate_id) -> PK violation |
| EVS-7 | Anon denied | Anon SELECT -> 0 rows |
| EVS-8 | Large JSONB (500 expanded nodes) | INSERT view_state with 500 UUIDs in expanded_node_ids -> succeeds, no size issues |
