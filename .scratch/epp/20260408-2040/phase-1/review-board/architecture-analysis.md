# Architecture Analysis -- ShossyWorks Plan Update

## Summary (3-5 sentences)

The 5 interaction decisions introduce significant schema additions that the original data architecture (01-data-architecture.md) does not cover: an `estimate_snapshots` table, expanded project/estimate status enums, `user_preferences` and `company_settings` tables, client sharing/commenting/approval tables, and full-text search indexes. The existing version system (deep-copy via `version_group_id`) is architecturally distinct from the new snapshot concept -- versions are linear sequences while snapshots are named bookmarks at arbitrary points -- and conflating them would be a design error. The enum strategy, snapshot storage model, and migration ordering all require concrete decisions before Phase 1A code is written. Several gaps in the original table designs also surface when mapped against the 5 decisions: missing `highlight`/`flagged` columns on nodes, no `node_notes` table in the architecture doc (decided in the weekend session but not yet documented), and a `client_visibility` column that needs renaming from a 3-value string to a boolean per Decision 4.

## Findings

### Finding 1: Snapshots vs Versions -- Two Distinct Concepts Requiring Separate Tables

- **Severity:** CRITICAL
- **Category:** Schema
- **Details:** The original architecture (Section 8.2) describes "Explicit Versions" as deep-copy snapshots using `version_group_id`, `version_number`, `version_label`, and `is_current` on the `estimates` table. Decision 1 introduces "Estimate Snapshots" which are conceptually different: manual, named bookmarks at any point during an estimate's lifecycle, independently of the version sequence. The existing version system is a linear progression (v1 -> v2 -> v3). Snapshots are lateral -- you can take 5 snapshots of v1 alone during bidding rounds. These are not the same thing.

  If we reuse the version system for snapshots, we get problems:
  1. `version_number` implies ordering; snapshots are not ordered sequentially
  2. `is_current` implies exactly one active version; snapshots are all read-only alongside the live estimate
  3. "Restore from Snapshot" creates a new version from a snapshot, mixing the two hierarchies
  4. The deep_copy_estimate() function assumes linear version progression

  The interaction decision explicitly states: "User names the snapshot, metadata auto-tracked (timestamp, user, status at time)." This is metadata that the version system doesn't capture.

- **Recommendation:** Create a separate `estimate_snapshots` table:
  ```
  estimate_snapshots:
    id              UUID PK
    estimate_id     UUID FK -> estimates (the live estimate this snapshot belongs to)
    name            VARCHAR(255) NOT NULL (user-provided name, e.g., "Pre-VE Round 2")
    description     TEXT
    estimate_status VARCHAR(50) (status of the estimate at snapshot time)
    project_status  VARCHAR(50) (status of the project at snapshot time)
    snapshot_data   JSONB (serialized full tree -- see Finding 2)
    node_count      INTEGER (metadata for quick display)
    total_price     DECIMAL(15,4) (cached total for comparison views)
    created_at      TIMESTAMPTZ
    created_by      UUID FK -> auth.users
  ```
  Keep the existing version system (`version_group_id`, `is_current`) for the linear version progression. Snapshots are a parallel concept.

- **Dependencies:** Finding 2 (storage model), Finding 5 (migration ordering)
- **Effort:** Medium

### Finding 2: Snapshot Storage Model -- JSONB Serialization Over Deep-Copy Tables

- **Severity:** CRITICAL
- **Category:** Schema / Performance
- **Details:** Three options for storing snapshot data:

  **Option A: Full table deep-copy (like versions).** Create copies of all nodes, details, options, memberships as real rows in the same tables, linked to a snapshot estimate record. Pros: queryable with standard SQL, reusable existing deep_copy_estimate() function. Cons: massive storage growth (500 nodes x 20 snapshots = 10,000 node rows per estimate), pollutes production tables with read-only data, complicates RLS policies, makes the "active tree" queries more expensive (must filter snapshot data).

  **Option B: JSONB serialization.** Serialize the entire estimate tree (nodes + item_details + assembly_details + option_memberships + notes) into a single JSONB column on `estimate_snapshots`. Pros: zero pollution of production tables, trivially fast to create (one JSON build + one INSERT), read-only by nature (JSONB is opaque), comparison is application-level. Cons: not queryable with SQL joins, schema changes require migration logic for old snapshots, larger individual row size.

  **Option C: Separate snapshot tables (estimate_snapshot_nodes, etc.).** Dedicated tables mirroring production structure but only for snapshot data. Pros: clean separation, SQL-queryable. Cons: doubles the migration surface area, every schema change must be applied to snapshot tables too.

  **Analysis for this project:**
  - Snapshots are read-only and browsable. Users view them, compare totals, and occasionally restore. They do NOT need to be queried with SQL joins (no "find all snapshots where drywall cost > $5000").
  - The existing history tables already provide field-level audit trail. Snapshots provide point-in-time recall.
  - A 500-node estimate with full details serializes to roughly 200-500KB of JSON. 20 snapshots = 4-10MB. Trivial for Postgres.
  - Decision 1 says snapshots are "browsable, interactable" -- this means the application deserializes the JSONB and renders it in a read-only tree view. Same rendering code as live estimates, different data source.

- **Recommendation:** Option B (JSONB serialization) for snapshots. Use a structured JSONB schema:
  ```json
  {
    "schema_version": 1,
    "estimate": { /* estimate row data */ },
    "nodes": [ /* all estimate_nodes rows */ ],
    "item_details": [ /* all node_item_details rows */ ],
    "assembly_details": [ /* all node_assembly_details rows */ ],
    "notes": [ /* all node_notes rows */ ],
    "option_groups": [ /* ... */ ],
    "option_alternatives": [ /* ... */ ],
    "option_memberships": [ /* ... */ ],
    "broad_options": [ /* ... */ ],
    "broad_option_overrides": [ /* ... */ ]
  }
  ```
  The `schema_version` field enables future migration of old snapshot formats. "Restore from Snapshot" deserializes the JSONB and writes the data back to production tables (after auto-saving a snapshot of the current state first, per Decision 1).

  **Keep Option A (deep-copy) for the version system.** Versions are queryable, diffable, and participate in the `version_group_id` lineage. Snapshots and versions serve different purposes with different access patterns.

- **Dependencies:** Snapshot restore function, TypeScript serialization/deserialization types
- **Effort:** Medium

### Finding 3: Enum Strategy -- Database Enums for Statuses, Application Constants for Everything Else

- **Severity:** HIGH
- **Category:** Schema
- **Details:** Decision 1 introduces two new enum sets:
  - Project statuses: 10 values (Lead, In Design, Bidding, Under-Contract, Value-Engineering, Active Construction, Closing Out, Warranty Period, Closed, Archived)
  - Estimate statuses: 4 values (Draft, Preliminary, Active, Complete)

  The original architecture uses VARCHAR with CHECK constraints for most enums (node_type, client_visibility, bid_type, cost_type, qty_mode). Only `app_role` uses a Postgres CREATE TYPE enum. The question is: should the new statuses follow the VARCHAR+CHECK pattern or the CREATE TYPE pattern?

  **Analysis:**
  - Postgres enums (CREATE TYPE): Compact storage (4 bytes vs variable), type-safe at DB level, but ALTER TYPE ADD VALUE is irreversible (cannot remove values without DROP/RECREATE cycle), and ordering is fixed at creation. Adding a value is easy; removing or reordering is painful.
  - VARCHAR + CHECK: Flexible (drop and recreate constraint to change values), but no type safety at the DB level, and CHECK constraints don't provide autocomplete in tooling.
  - Lookup tables (separate table with id+name): Maximum flexibility, FK integrity, supports metadata per status (display_name, color, sort_order), but adds JOINs.

  For this project:
  - The 10-stage project status is **unlikely to change frequently** but may need reordering or display metadata (colors for a Kanban view). A lookup table would support this but adds complexity for 10 static rows.
  - The 4-stage estimate status is **very stable** -- these map directly to estimating workflow stages.
  - The existing `app_role` enum already established the CREATE TYPE pattern. Consistency matters.
  - Decision 1 says "Full flexibility -- any status can transition to any other." This means no state machine enforcement at the DB level. The enum just constrains valid values.

- **Recommendation:** Use CREATE TYPE enums for both, matching the existing `app_role` pattern. Specific approach:
  ```sql
  CREATE TYPE public.project_status AS ENUM (
    'lead', 'in_design', 'bidding', 'under_contract',
    'value_engineering', 'active_construction', 'closing_out',
    'warranty_period', 'closed', 'archived'
  );
  
  CREATE TYPE public.estimate_status AS ENUM (
    'draft', 'preliminary', 'active', 'complete'
  );
  ```
  Replace the existing VARCHAR(50) `status` column on `projects` (currently using 'active','on_hold','completed','archived') and the VARCHAR(50) `status` column on `estimates` (currently using 'draft','in_review','approved','sent','accepted','archived').

  **Warning:** The old project statuses ('active', 'on_hold', 'completed', 'archived') do NOT map 1:1 to the new 10-stage enum. 'active' could mean several things. 'on_hold' has no direct equivalent. The migration must include a mapping strategy (e.g., 'active' -> 'active_construction', 'on_hold' -> 'lead', 'completed' -> 'closed', 'archived' -> 'archived'). Since no data exists yet (Phase 0 only), this is a clean replacement, not a data migration.

  **Warning:** The old estimate statuses ('draft','in_review','approved','sent','accepted','archived') are completely different from the new 4-stage set. 'in_review', 'sent', 'accepted' have no equivalents. Again, since no estimate data exists yet, this is a clean replacement.

- **Dependencies:** Projects and estimates tables must be created/altered before any data is inserted
- **Effort:** Low

### Finding 4: Missing Columns on estimate_nodes for Decision 2

- **Severity:** HIGH
- **Category:** Schema
- **Details:** Decision 2 (Node Actions) requires two new columns on `estimate_nodes` that are not in the original architecture:
  1. `client_visible BOOLEAN` -- Decision 4 says nodes get a toggle for client visibility. BUT the original architecture already has `client_visibility VARCHAR(20)` with values 'visible', 'hidden', 'summary_only'. Decision 2 says "Toggle client visibility per node (client_visible boolean)." These conflict.
  2. `highlight BOOLEAN` or `flagged BOOLEAN` -- "Highlight/flag nodes (visual marking)" is a new field not in the original schema.

  The `client_visibility` conflict is important:
  - Original architecture: 3-tier visibility ('visible', 'hidden', 'summary_only')
  - Decision 2: simple boolean toggle
  - Decision 4: "View estimates (filtered by client_visible flag on nodes)" -- references a boolean
  - The client-visibility contract: references the 3-tier VARCHAR approach

  The 3-tier approach is architecturally superior. 'summary_only' (client sees name + total, no child breakdown) is a real construction estimating need. A boolean loses this capability. But the decisions explicitly say "boolean."

- **Recommendation:** Keep the existing 3-tier `client_visibility VARCHAR(20)` approach from the original architecture. The boolean described in the decisions was a simplification during conversation, but the 3-tier model was researched and validated. Add a computed/virtual "client_visible" boolean in TypeScript types that maps `client_visibility != 'hidden'` for simpler API usage. Flag this for Zac's confirmation during plan review.

  Add new column:
  ```sql
  ALTER TABLE estimate_nodes ADD COLUMN flagged BOOLEAN NOT NULL DEFAULT FALSE;
  ```
  Also consider adding `flag_color VARCHAR(7)` for multiple flag colors (common in estimating tools for marking scope, alternates, etc.).

  Update the client-visibility contract to note the TypeScript convenience mapping.

- **Dependencies:** Client-visibility contract update, TypeScript type generation
- **Effort:** Low

### Finding 5: New Tables Not in Original Architecture

- **Severity:** HIGH
- **Category:** Schema
- **Details:** The 5 decisions require several tables not designed in 01-data-architecture.md:

  1. **`estimate_snapshots`** -- Decision 1. Fully new. See Finding 1-2.
  2. **`node_notes`** -- Weekend session decision (2026-04-06). Multiple notes per node, rich text, soft-delete, author/timestamp. Not in the architecture doc. Must be designed.
  3. **`user_preferences`** -- Decision 3. JSONB or columns for UI state, estimate view settings, personal favorites.
  4. **`company_settings`** -- Decision 3. Markup rates, overhead percentages, tax rates, company info.
  5. **`estimate_shares`** -- Decision 4. Share link + PIN for client access without accounts.
  6. **`estimate_comments`** -- Decision 4. Client comments on line items.
  7. **`estimate_approvals`** -- Decision 4. Formal approve/reject records.
  8. **`option_items`** -- Decision 2 mentions "option_items tables" for the options system. But this appears to overlap with the existing `node_option_memberships` junction table. Clarification needed.

  Phase 1A scope question: which of these tables are Phase 1A (schema foundation) vs Phase 1B+ (feature implementation)?

- **Recommendation:** Phase 1A should create the schema for ALL tables, even those whose features ship later. Creating tables early is cheap; adding them later requires new migrations and contract updates. Specifically:

  Phase 1A tables:
  - `estimate_snapshots` (schema only, snapshot functions in 1A, UI in 1B+)
  - `node_notes` (schema, used immediately in tree UI)
  - `user_preferences` (schema, populated when features use it)
  - `company_settings` (schema with seed data for default rates)
  - `estimate_shares` (schema only, sharing feature in 1B+)
  - `estimate_comments` (schema only, client features in 1B+)
  - `estimate_approvals` (schema only, client features in 1B+)

  Do NOT create `option_items` -- this appears to be a naming confusion. The existing architecture's `node_option_memberships` + `option_groups` + `option_alternatives` already covers the options system. The Decision 2 mention of "option_items" likely refers to the membership junction table.

- **Dependencies:** All new tables depend on core tables (projects, estimates, estimate_nodes) being created first
- **Effort:** Medium

### Finding 6: user_preferences and company_settings Design

- **Severity:** HIGH
- **Category:** Schema
- **Details:** Decision 3 describes two new tables with distinct storage patterns:

  **user_preferences:** UI state (sidebar, theme), estimate view settings (columns, sort, expand/collapse), personal items (favorites, recent, pinned). This data is:
  - Highly variable in structure (new preferences added without migrations)
  - Never JOINed against or queried by value
  - Per-user (FK to auth.users)
  - Some preferences are global (theme), some are per-estimate (column visibility, expanded nodes)

  **company_settings:** Default rates, company info. This data is:
  - Stable in structure (columns are well-defined)
  - Used in calculations (default markup rates seed new items)
  - Exactly one row per company (single-company model)

  The per-estimate view state is particularly tricky. Decision 3 says "App remembers last-used settings per estimate." This means the key is `(user_id, estimate_id)`, not just `user_id`.

- **Recommendation:**
  ```sql
  -- Global user preferences (JSONB -- opaque UI state, variable structure)
  CREATE TABLE user_preferences (
    id          UUID PK DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    preferences JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id)
  );
  
  -- Per-estimate view state (JSONB per user per estimate)
  CREATE TABLE estimate_view_state (
    id          UUID PK DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    estimate_id UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
    view_state  JSONB NOT NULL DEFAULT '{}',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, estimate_id)
  );
  
  -- Company settings (normalized columns -- stable structure, used in calculations)
  CREATE TABLE company_settings (
    id                      UUID PK DEFAULT gen_random_uuid(),
    company_name            VARCHAR(255),
    company_address         TEXT,
    license_number          VARCHAR(100),
    default_markup_rate     DECIMAL(5,4) NOT NULL DEFAULT 0,
    default_overhead_rate   DECIMAL(5,4) NOT NULL DEFAULT 0,
    default_contingency_rate DECIMAL(5,4) NOT NULL DEFAULT 0,
    default_tax_rate        DECIMAL(5,4) NOT NULL DEFAULT 0,
    default_unit_id         UUID REFERENCES units_of_measure(id),
    settings_json           JSONB DEFAULT '{}',  -- overflow for future settings
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  -- Exactly one row, enforced by application + seed migration
  ```

  Note: `estimates.default_contingency_rate` and `estimates.default_overhead_rate` should seed from `company_settings` when creating a new estimate. This creates a dependency: company_settings must exist before estimate creation logic.

  Also note: the existing `estimates` table has `column_config JSONB` and `view_settings JSONB`. With the new `estimate_view_state` table (per-user-per-estimate), these JSONB columns on `estimates` become redundant. They should be migrated to `estimate_view_state` or repurposed as estimate-level defaults (not per-user).

- **Dependencies:** estimates table, units_of_measure table, auth.users
- **Effort:** Medium

### Finding 7: estimate_shares, estimate_comments, estimate_approvals Design

- **Severity:** MEDIUM
- **Category:** Schema
- **Details:** Decision 4 specifies three client-facing tables. These are Phase 1B+ features but their schema should be established in Phase 1A. Proposed designs:

  ```sql
  CREATE TABLE estimate_shares (
    id          UUID PK DEFAULT gen_random_uuid(),
    estimate_id UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
    share_token VARCHAR(64) NOT NULL UNIQUE,  -- URL-safe random token
    pin_hash    VARCHAR(255) NOT NULL,         -- bcrypt hash of 6-digit PIN
    created_by  UUID NOT NULL REFERENCES auth.users(id),
    expires_at  TIMESTAMPTZ,                   -- NULL = no expiry
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    accessed_at TIMESTAMPTZ,                   -- last access timestamp
    access_count INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  
  CREATE TABLE estimate_comments (
    id          UUID PK DEFAULT gen_random_uuid(),
    estimate_id UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
    node_id     UUID REFERENCES estimate_nodes(id) ON DELETE SET NULL,
    author_type VARCHAR(20) NOT NULL,  -- 'user' or 'share'
    author_id   UUID,                  -- user_id if author_type='user'
    share_id    UUID REFERENCES estimate_shares(id) ON DELETE SET NULL,
    body        TEXT NOT NULL,
    is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_by UUID REFERENCES auth.users(id),
    resolved_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  
  CREATE TABLE estimate_approvals (
    id          UUID PK DEFAULT gen_random_uuid(),
    estimate_id UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
    author_type VARCHAR(20) NOT NULL,  -- 'user' or 'share'
    author_id   UUID,
    share_id    UUID REFERENCES estimate_shares(id),
    status      VARCHAR(20) NOT NULL,  -- 'approved', 'rejected', 'pending'
    notes       TEXT,
    option_set_id UUID REFERENCES option_sets(id), -- which scenario was approved
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ```

  Key design decision: comments and approvals can come from either authenticated users (clients with accounts) OR anonymous share-link visitors (identified by share_id). The `author_type` discriminator handles both cases.

- **Recommendation:** Include these table definitions in Phase 1A migrations. RLS policies can be deferred until the client features are built (Phase 1B+), but the schema structure should be final. The `estimate_comments.node_id` uses ON DELETE SET NULL (not CASCADE) because deleting a node shouldn't delete client feedback -- the comment becomes estimate-level.

- **Dependencies:** estimates, estimate_nodes, estimate_shares, option_sets tables
- **Effort:** Low

### Finding 8: Full-Text Search Indexes for Decision 5

- **Severity:** MEDIUM
- **Category:** Schema / Performance
- **Details:** Decision 5 requires full-text search on node name and description, with scope filtering (current estimate, current project, global). The original architecture already specifies a tsvector GIN index on catalog_items but NOT on estimate_nodes.

  For estimate_nodes, the search needs:
  1. GIN index on `to_tsvector('english', name || ' ' || COALESCE(description, ''))` 
  2. Standard B-tree indexes already exist for cost_code_id, phase_id (covered)
  3. The `node_type` column is already indexed via the composite idx_nodes_tree_order

  Cross-project search ("find drywall costs across all projects") requires querying estimate_nodes across estimates, which is already supported by removing the estimate_id filter. No schema change needed -- just query strategy.

- **Recommendation:** Add to Phase 1A migration:
  ```sql
  -- Full-text search on estimate nodes
  CREATE INDEX idx_nodes_search ON estimate_nodes
    USING gin(to_tsvector('english', name || ' ' || COALESCE(description, '')));
  
  -- For "find unpriced items" and "items over $X" queries
  CREATE INDEX idx_nodes_total ON estimate_nodes(total_price)
    WHERE node_type = 'item';
  
  -- For flagged/highlighted filter
  CREATE INDEX idx_nodes_flagged ON estimate_nodes(estimate_id)
    WHERE flagged = TRUE;
  ```
  These are Phase 1A because indexes should exist before data is inserted (avoids expensive index builds on populated tables).

- **Dependencies:** estimate_nodes table with flagged column (Finding 4)
- **Effort:** Trivial

### Finding 9: Migration Ordering -- Dependency Chain

- **Severity:** HIGH
- **Category:** Schema
- **Details:** The current plan has 4 migrations (core tables, supporting tables, triggers, history tables). With the 5 decisions adding ~7 new tables and modified enums, the dependency chain becomes:

  ```
  Migration 1: Extensions + Enums
    - CREATE EXTENSION ltree (already done in auth migration)
    - CREATE TYPE project_status
    - CREATE TYPE estimate_status
    - (app_role enum already exists)
  
  Migration 2: Core Tables
    - projects (uses project_status enum)
    - estimates (uses estimate_status enum, FK -> projects)
    - estimate_nodes (FK -> estimates)
    - node_item_details (FK -> estimate_nodes)
    - node_assembly_details (FK -> estimate_nodes)
    - node_notes (FK -> estimate_nodes, FK -> auth.users)
  
  Migration 3: Supporting Tables
    - units_of_measure (no FKs, seed data)
    - unit_conversions (FK -> units)
    - cost_codes (self-referencing FK, seed data)
    - phases (FK -> projects)
    - project_parameters (FK -> projects, FK -> units)
    - company_settings (FK -> units)
    - user_preferences (FK -> auth.users)
    - estimate_view_state (FK -> estimates, FK -> auth.users)
  
  Migration 4: Catalog + Options + Vendor Tables
    - catalog_items (FK -> units)
    - catalog_assemblies (FK -> units)
    - catalog_assembly_components (FK -> both catalog tables)
    - option_groups (FK -> estimates, FK -> estimate_nodes)
    - option_alternatives (FK -> option_groups)
    - node_option_memberships (FK -> estimate_nodes, FK -> option_alternatives)
    - broad_options (FK -> estimates)
    - broad_option_overrides (FK -> broad_options, FK -> project_parameters)
    - option_sets (FK -> estimates)
    - option_set_selections (FK -> option_sets, FK -> option_groups, FK -> option_alternatives)
    - option_set_broad_selections (FK -> option_sets, FK -> broad_options)
    - vendors + vendor_contacts + vendor_documents + vendor_catalog_items
    - node_attachments (FK -> estimate_nodes)
    - proposals (FK -> estimates, FK -> option_sets)
  
  Migration 5: Client/Sharing Tables
    - estimate_snapshots (FK -> estimates, FK -> auth.users)
    - estimate_shares (FK -> estimates, FK -> auth.users)
    - estimate_comments (FK -> estimates, FK -> estimate_nodes, FK -> estimate_shares)
    - estimate_approvals (FK -> estimates, FK -> estimate_shares, FK -> option_sets)
  
  Migration 6: Triggers
    - update_updated_at (all tables)
    - maintain_node_path
    - auto_promote_item_parent
    - auto_demote_empty_group
    - prevent_item_with_children
    - inherit_option_memberships
    - track_node_changes (history triggers)
  
  Migration 7: History Tables
    - estimate_nodes_history
    - node_item_details_history
    - node_assembly_details_history
    - (node_notes_history? -- depends on whether note edits need audit trail)
  
  Migration 8: Indexes + RLS Policies
    - Full-text search indexes
    - Performance indexes
    - RLS policies for all tables
  
  Migration 9: Seed Data
    - units_of_measure (25 units)
    - cost_codes (CSI MasterFormat divisions)
    - company_settings (single row with defaults)
  
  Migration 10: Functions
    - deep_copy_estimate() for version system
    - create_snapshot() for snapshot system
    - restore_snapshot() for snapshot restoration
    - set_app_user_id() RPC
  ```

  The current plan lumps too much into too few migrations. With 30+ tables plus 7 new ones, a single "core tables" migration becomes unwieldy.

- **Recommendation:** Split into 8-10 focused migrations as shown above. Each migration should be independently testable and rollback-safe. The enum migration MUST come before any table that references those enums. Triggers MUST come after all tables they reference. History tables MUST mirror the final schema of their source tables (so they come after any ALTER TABLE operations). Seed data comes after tables but before functions that reference the data.

  **Critical ordering constraint:** The `estimate_comments` table FK-references `estimate_shares`, so shares must be created first. The `estimate_approvals` table FK-references `option_sets`, so the options system tables must exist first.

- **Dependencies:** All migrations are sequential by nature
- **Effort:** Medium (restructuring existing plan, not new code)

### Finding 10: node_notes Table Design (Weekend Decision Gap)

- **Severity:** MEDIUM
- **Category:** Schema
- **Details:** The weekend session (2026-04-06) decided on a `node_notes` table: multiple entries per node, rich text, soft-delete, author/timestamp. But no table design exists in any architecture document. The plan references it (Step 1A.1) but doesn't define the columns.

- **Recommendation:** 
  ```sql
  CREATE TABLE node_notes (
    id          UUID PK DEFAULT gen_random_uuid(),
    node_id     UUID NOT NULL REFERENCES estimate_nodes(id) ON DELETE CASCADE,
    body        TEXT NOT NULL,          -- Rich text (HTML or Markdown)
    format      VARCHAR(20) NOT NULL DEFAULT 'markdown',  -- 'markdown' or 'html'
    is_internal BOOLEAN NOT NULL DEFAULT TRUE,  -- internal (builder-only) vs client-visible
    deleted_at  TIMESTAMPTZ,           -- Soft-delete
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by  UUID REFERENCES auth.users(id)
  );
  
  CREATE INDEX idx_node_notes_node ON node_notes(node_id) WHERE deleted_at IS NULL;
  ```

  This also means the `notes TEXT` and `client_notes TEXT` columns currently on `estimate_nodes` become redundant. They should be removed from the base table and replaced by `node_notes` entries with the `is_internal` flag.

  **Impact on snapshot serialization:** node_notes rows must be included in snapshot JSONB.

- **Dependencies:** estimate_nodes table
- **Effort:** Low

### Finding 11: Existing estimates.column_config and view_settings Redundancy

- **Severity:** MEDIUM
- **Category:** Schema
- **Details:** The original `estimates` table includes `column_config JSONB` and `view_settings JSONB` for "UI column visibility preferences" and "UI display preferences." Decision 3 creates `user_preferences` and `estimate_view_state` tables that serve the same purpose but per-user. With multiple users, view settings on the estimate itself don't make sense -- two users can have different column preferences for the same estimate.

- **Recommendation:** Remove `column_config` and `view_settings` from the `estimates` table. Replace with the per-user `estimate_view_state` table (Finding 6). If estimate-level defaults are needed (e.g., "this estimate always shows the cost code column"), add an `estimate_defaults JSONB` column on `estimates` that seeds new users' view state. But the per-user table is the authoritative source.

- **Dependencies:** estimate_view_state table, user_preferences table
- **Effort:** Low

### Finding 12: Snapshot Restore Flow Requires Safety Mechanism

- **Severity:** MEDIUM
- **Category:** Schema / API
- **Details:** Decision 1 says "Restore from Snapshot auto-saves a snapshot of current state first, then restores." This means the restore function must:
  1. Create a snapshot of the current live estimate (named automatically, e.g., "Auto-save before restore from 'Pre-VE Round 2'")
  2. Deserialize the target snapshot's JSONB
  3. DELETE all current nodes, details, notes, option memberships from the live estimate
  4. INSERT all snapshot data back into the live tables, remapping IDs
  5. Trigger full recalculation

  Steps 3-4 are essentially the reverse of create_snapshot(). This is a complex atomic operation that must be a single Postgres function.

  **Risk:** If the snapshot was created under an older schema version (e.g., before `flagged` column was added), the restore must handle missing columns gracefully. The `schema_version` field in the JSONB (Finding 2) enables this.

- **Recommendation:** Create two companion Postgres functions:
  - `create_estimate_snapshot(estimate_id, name, created_by)` -- serializes to JSONB
  - `restore_estimate_snapshot(snapshot_id, restored_by)` -- auto-saves current, then deserializes
  
  Both should be Phase 1A schema (function definitions) even if the UI is Phase 1B+.

- **Dependencies:** estimate_snapshots table, all node/detail tables
- **Effort:** High

### Finding 13: Versioning System Has Conflicting Status Enums

- **Severity:** MEDIUM
- **Category:** Schema
- **Details:** The original `estimates.status` is defined as `'draft','in_review','approved','sent','accepted','archived'`. Decision 1 redefines it as `'draft','preliminary','active','complete'`. These are fundamentally different sets:
  - The original set tracks document workflow (sent to client, accepted by client)
  - The new set tracks estimate maturity (how refined the numbers are)

  Both are valid but serve different purposes. "Active" in the new set means "this is the working estimate" while "approved" in the old set means "client approved this." These are orthogonal concepts -- an estimate can be both "active" (maturity) and "approved" (client status).

- **Recommendation:** Consider whether both dimensions are needed:
  - `estimate_status` (maturity): draft -> preliminary -> active -> complete
  - A separate client-facing status could live on the `proposals` table or `estimate_approvals` table

  For Phase 1A, use the Decision 1 statuses (draft, preliminary, active, complete) since these directly serve the estimating workflow. Client-facing status tracking comes with the proposals/approvals features in Phase 1B+.

- **Dependencies:** None blocking
- **Effort:** Trivial (just use the new enum values)

## Recommendations for Plan Update

### Structural Changes to the Plan

1. **Add a new Step 1A.0 -- Enum Migration.** Before core tables, create all enum types (project_status, estimate_status). This must precede any table creation.

2. **Split Step 1A.1 into two migrations.** Core tables (projects, estimates, estimate_nodes, details) and new tables (node_notes, user_preferences, company_settings, estimate_view_state, estimate_snapshots, estimate_shares, estimate_comments, estimate_approvals) should be separate for clarity.

3. **Add Step 1A.2b -- Snapshot Functions.** After tables and triggers, create the `create_estimate_snapshot()` and `restore_estimate_snapshot()` Postgres functions. These are schema-level, not application-level.

4. **Add `flagged BOOLEAN` to estimate_nodes.** This is missing from the current plan entirely.

5. **Remove `notes TEXT` and `client_notes TEXT` from estimate_nodes.** Replace with the `node_notes` table. Update the tree-calculation contract (notes are no longer on the base table).

6. **Remove `column_config` and `view_settings` from estimates.** Replace with `estimate_view_state` table.

7. **Update the project status values.** The plan's current project statuses ('active','on_hold','completed','archived') must be replaced with the 10-stage enum from Decision 1.

8. **Update the estimate status values.** Replace ('draft','in_review','approved','sent','accepted','archived') with ('draft','preliminary','active','complete').

9. **Add full-text search indexes to estimate_nodes.** Currently only planned for catalog_items.

10. **Add `version INTEGER DEFAULT 1` to estimate_nodes.** For optimistic locking (from addendum). Currently in the plan but easy to miss.

### New Tests Required

- Snapshot create/restore round-trip test
- Enum constraint tests (invalid status values rejected)
- node_notes CRUD with soft-delete
- Full-text search queries on estimate_nodes
- company_settings seed data validation
- estimate_view_state per-user-per-estimate isolation

## Questions for Other Board Members

1. **For the Security Analyst:** The `estimate_shares` table uses PIN-based access. How should RLS policies handle requests from share-link visitors who are not authenticated Supabase users? They won't have a JWT. This likely needs a separate API route using the service role, not standard RLS.

2. **For the Code Quality Analyst:** The snapshot JSONB schema creates a parallel type system (JSON shapes alongside TypeScript types alongside DB types). How do we ensure type safety for snapshot serialization/deserialization without maintaining three separate type definitions?

3. **For the Test Analyst:** The snapshot restore function has complex ID remapping logic (old node IDs -> new node IDs for all FK references). What's the minimum test coverage to verify this doesn't silently break parent_id chains or option membership references?

4. **For the Risk Analyst:** If a snapshot was created before a schema migration adds a new column (e.g., `flagged`), what happens when that snapshot is restored? The JSONB won't have the field. Should `restore_estimate_snapshot()` apply default values for missing fields, or should it reject old-format snapshots?

5. **For All:** The plan currently shows "2-3 sessions" for Phase 1A. With ~37 tables (30 original + 7 new), 10+ triggers, 3 Postgres functions (deep_copy, create_snapshot, restore_snapshot), history tables, seed data, TypeScript types, and server actions -- is 2-3 sessions realistic? My estimate is 3-4 sessions minimum, possibly 5 if we include comprehensive testing.
