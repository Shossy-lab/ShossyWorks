# Code Quality Analysis — ShossyWorks Plan Update

## Summary (5 sentences)

The codebase is a clean Phase 0 scaffold (~1,414 lines, 26 source files) with strong foundational patterns — strict TypeScript, Zod-based env validation, design token enforcement, and a well-structured Next.js App Router layout. The 5 new interaction decisions introduce substantial type system complexity (10-stage project status, 4-stage estimate status, discriminated unions for 3 node types, snapshot freeze semantics, client visibility filtering) that must be modeled correctly from day one or will incur painful retrofit costs. The current codebase has zero application-domain types — everything is auth/infrastructure — so Phase 1A is a greenfield opportunity to establish type patterns that will carry through 30+ tables. The testing infrastructure is minimal but well-structured (vitest with 5 project categories, 2 test files), and needs to expand dramatically to cover database triggers, RLS policies, snapshot integrity, and server action validation. Critical quality risks include: snapshot deep-copy atomicity, concurrent modification during snapshot restore, circular reference potential in options, and the gap between the data architecture's complexity (~32 tables, 10+ triggers) and the current team's ability to verify correctness without comprehensive tests.

## Findings

### Finding 1: Type System — No Discriminated Union Infrastructure Exists

- **Severity:** HIGH
- **Category:** API / Testing
- **Details:** The codebase currently has zero domain types. The plan calls for `src/lib/types/database.ts` with a "discriminated union for NodeWithDetails" but does not specify the pattern. With 3 node types (group, assembly, item), each having different detail tables, plus 3 client visibility states, 10 project statuses, 4 estimate statuses, and snapshot frozen vs. live semantics — the type system design is far more complex than a single discriminated union. Specific concerns:

  1. **NodeWithDetails must be a proper discriminated union**, not a loose intersection. The pattern should be:
     ```typescript
     type NodeWithDetails =
       | { node_type: 'group'; details: null; /* base fields */ }
       | { node_type: 'assembly'; details: NodeAssemblyDetails; /* base fields */ }
       | { node_type: 'item'; details: NodeItemDetails; /* base fields */ }
     ```
     This enables exhaustive switch/case checking with `never` guards. Without this, every component that handles nodes will use unsafe type assertions.

  2. **Supabase generated types are insufficient alone.** `supabase gen types typescript` produces flat row types per table. It does NOT produce joined/discriminated types. A manual type layer is needed that composes generated types into domain-meaningful shapes.

  3. **Snapshot types need a frozen/readonly wrapper.** A snapshot's nodes should be `Readonly<NodeWithDetails>` or a branded type like `FrozenNode` to prevent accidental mutation at the type level. Without this, nothing stops UI code from calling mutation actions on snapshot data.

  4. **Client-visible node type should be a strict subset.** When filtering by `client_visible`, the returned type should omit internal fields (notes, cost breakdowns, vendor info). A `ClientVisibleNode` type prevents leaking sensitive data through the type system.

- **Recommendation:** Create a layered type system in `src/lib/types/`:
  - `supabase.ts` — auto-generated (already planned in package.json script)
  - `database.ts` — composed domain types built on generated types (NodeWithDetails discriminated union, ProjectWithEstimates, EstimateWithNodes)
  - `enums.ts` — const enums/const objects for project_status, estimate_status, node_type, client_visibility, cost_type, bid_type, qty_mode (duplicating the DB CHECK values as TypeScript literals for exhaustive checking)
  - `actions.ts` — ActionResult<T> pattern (already planned)
  - `client-types.ts` — subset types for client-facing views (omit sensitive fields)
  - `snapshot-types.ts` — branded/frozen types for snapshot data
- **Dependencies:** Blocks all server actions, all components, all tests
- **Effort:** Medium (architecture design is the hard part, not line count)

### Finding 2: Enum Explosion — 10 Project Statuses Need Careful Modeling

- **Severity:** MEDIUM
- **Category:** API
- **Details:** Decision 1 specifies 10 project statuses and 4 estimate statuses with "full flexibility — any status can transition to any other." The data architecture document (Section 5.1) specifies only 4 project statuses (`active, on_hold, completed, archived`). This is a direct conflict that must be resolved before migration.

  The 10-status model (`Lead, In Design, Bidding, Under-Contract, Value-Engineering, Active Construction, Closing Out, Warranty Period, Closed, Archived`) is correct per Decision 1, but has implications:

  1. **PostgreSQL enum vs CHECK constraint vs lookup table.** A 10-value enum is borderline for `CREATE TYPE ... AS ENUM`. Adding/removing values later requires `ALTER TYPE ADD VALUE` (can only add, cannot remove from PG enums). A CHECK constraint with string literals is more flexible. A lookup table is most flexible but adds a JOIN. Recommendation: CHECK constraint with string literals, mirrored as a TypeScript const object.

  2. **No transition validation specified.** "Any to any" means the database won't enforce valid transitions, but the application should still warn on unusual transitions (e.g., Closed -> Bidding). This is a UI concern, not a schema concern — but the type system should model it.

  3. **Estimate status (4 values) is fine as an enum.** Draft/Preliminary/Active/Complete is small and stable.

- **Recommendation:**
  - Use CHECK constraints (not PG enums) for both project_status and estimate_status
  - Create `src/lib/types/enums.ts` with `PROJECT_STATUS` and `ESTIMATE_STATUS` as const objects
  - Add Zod schemas that validate against these same values
  - Document the conflict between the data architecture's 4 statuses and Decision 1's 10 statuses in the migration, explicitly superseding the data architecture
- **Dependencies:** Migration Step 1A.1 (core tables)
- **Effort:** Low

### Finding 3: Server Action Organization — Scale Problem Coming

- **Severity:** HIGH
- **Category:** API
- **Details:** The current plan lists server actions in Step 1A.5 as a flat list: `createNode, updateNode, deleteNode, moveNode, getNodes, createProject, getProjects, createEstimate, getEstimates`. With the 5 new decisions, the actual server action count is significantly larger:

  **Phase 1A minimum (schema-driven):**
  - Project CRUD: create, update, delete, list, get (5)
  - Estimate CRUD: create, update, delete, list, get (5)
  - Node CRUD: create, update, delete, move, reorder, duplicate, list (7)
  - Node type conversion: convertToGroup, convertToAssembly, convertToItem (3)
  - Node visibility: toggleClientVisibility (1)
  - Snapshot: createSnapshot, restoreSnapshot, listSnapshots, getSnapshot, deleteSnapshot (5)
  - User preferences: getUserPreferences, updateUserPreferences (2)
  - Company settings: getCompanySettings, updateCompanySettings (2)

  **Phase 1B+ additions:**
  - Catalog: addToCatalog, instantiateFromCatalog, syncFromCatalog, unlinkCatalog (4)
  - Options: createOptionGroup, createAlternative, switchAlternative, deleteOptionGroup (4)
  - Option sets: createOptionSet, applyOptionSet, deleteOptionSet (3)
  - Client sharing: createShareLink, validateSharePIN, revokeShareLink (3)
  - Comments: createComment, listComments, deleteComment (3)
  - Approvals: createApproval, getApprovalStatus (2)
  - Search: searchNodes, searchGlobal (2)
  - Copy/paste: copyNodes, pasteNodes (2)

  That is **30+ server actions in Phase 1A** and **50+ total** by Phase 1B+.

  **The current plan has no organization strategy for this volume.** Putting all actions in one file violates the <300 line per file guideline. The architecture rules say "co-locate mutation handlers with their routes/pages when route-specific. Share in a library directory when used across features."

- **Recommendation:** Organize server actions by entity in `src/lib/actions/`:
  ```
  src/lib/actions/
    projects.ts       — project CRUD
    estimates.ts      — estimate CRUD + snapshots
    nodes.ts          — node CRUD + move + reorder + type conversion
    catalog.ts        — catalog operations (Phase 1B)
    options.ts        — option groups, alternatives, sets (Phase 1B)
    sharing.ts        — share links, PIN validation (Phase 1B)
    comments.ts       — estimate/node comments (Phase 1B)
    preferences.ts    — user preferences + company settings
    search.ts         — full-text search actions (Phase 1B)
  ```
  Each file exports named functions. Each function uses `"use server"` directive. Each returns `ActionResult<T>`. Shared validation (requireAuth, requireRole) imported from `src/lib/auth/`.
- **Dependencies:** Affects all downstream UI components
- **Effort:** Low (organizational decision, not code complexity)

### Finding 4: Snapshot Deep-Copy — Highest Risk Operation in the System

- **Severity:** CRITICAL
- **Category:** Schema / Testing
- **Details:** Decision 1 requires estimate snapshots with "deep-copy of all nodes, details, notes." The data architecture (Section 8.2) specifies a 10-step `deep_copy_estimate()` PostgreSQL function that remaps all foreign keys in a single atomic transaction. This is the highest-risk operation in the entire system because:

  1. **Partial copy = data corruption.** If the function copies nodes but fails to remap `parent_id` values, the copied tree points to the original tree's nodes. If it copies option memberships without remapping `option_alternative_id`, switching options on one copy affects the other. Every FK must be remapped.

  2. **ID remapping requires a temp table or CTE.** The function needs to maintain a mapping from `{old_id -> new_id}` for every copied row. This is typically done with `INSERT ... RETURNING` into a temp table, then joining against it for subsequent copies. The implementation must handle: estimate_nodes, node_item_details, node_assembly_details, node_notes, option_groups, option_alternatives, node_option_memberships, option_sets, option_set_selections, option_set_broad_selections, broad_options, broad_option_overrides. That is 12 tables requiring remapping.

  3. **Restore-from-snapshot has a race condition.** Decision 1 says "auto-saves a snapshot of current state first, then restores." If another user is editing the estimate between the auto-save and the restore, their changes are silently lost. With real-time collaborative editing (from the addendum), this is a real concern. The restore operation needs either: (a) a lock on the estimate during the operation, or (b) optimistic version checking that rejects the restore if the estimate was modified after the auto-save.

  4. **Snapshot naming collision.** No uniqueness constraint on snapshot names per estimate is mentioned. Two snapshots named "Pre-VE" would be confusing. Add a UNIQUE constraint on `(estimate_id, name)`.

  5. **Snapshot count limits.** Unlimited snapshots per estimate means unbounded storage growth. Not a Phase 1A concern, but the schema should include `created_by` and `created_at` on `estimate_snapshots` for future cleanup policies.

- **Recommendation:**
  - The `deep_copy_estimate()` function MUST be the single most-tested piece of code in the system. Minimum 15 test cases covering: basic copy, node tree integrity after copy, detail row integrity, option group integrity, option membership remapping, option set remapping, broad option remapping, independent modification after copy, concurrent modification detection, restore-from-snapshot atomicity, and edge cases (empty estimate, estimate with no options, estimate with nested option groups).
  - Add `version INTEGER DEFAULT 1` on `estimates` table (already mentioned in addendum) and check it during restore.
  - Add UNIQUE constraint on `(estimate_id, name)` for snapshot names.
  - Implement snapshot restore as: (1) acquire advisory lock on estimate_id, (2) auto-snapshot current state, (3) deep-copy from snapshot, (4) release lock. This prevents race conditions.
- **Dependencies:** Blocks snapshot UI, blocks comparison views
- **Effort:** High (complex SQL function + extensive testing)

### Finding 5: Validation Layer — Zod Schemas Need Comprehensive Coverage

- **Severity:** HIGH
- **Category:** API / Testing
- **Details:** The codebase currently uses Zod only for environment variable validation (`src/env.ts`). Phase 1A introduces many user-input boundaries that need validation:

  **Form validation schemas needed:**
  - Project creation: name (required, 1-255 chars), project_number (optional, max 50), client_name (optional, max 255), status (must be one of 10 valid values)
  - Estimate creation: name (required, 1-255 chars), status (must be one of 4 valid values), default rates (0-1 range, max 4dp)
  - Node creation: name (required, 1-255 chars), node_type (must be group/assembly/item), parent_id (valid UUID or null), sort_order (non-negative integer)
  - Node update: partial of creation fields, plus all numeric fields with range validation (quantities non-negative, rates 0-1, costs non-negative)
  - Snapshot creation: name (required, 1-100 chars, no special characters that could break UI)
  - PIN code: exactly 6 digits (Phase 1B+)
  - Search query: 1-500 chars, sanitized for SQL injection (though parameterized queries handle this)
  - Share link: expires_at must be future date, PIN must be 6 digits

  **Server-side validation pattern:**
  ```typescript
  // Every server action should follow this pattern:
  const schema = z.object({ ... });
  export async function createProject(input: unknown): Promise<ActionResult<Project>> {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: formatZodError(parsed.error) };
    }
    // ... proceed with validated data
  }
  ```

  **The codebase currently lacks a Zod error formatter.** The raw Zod errors are developer-facing, not user-facing. Need a `formatZodError()` utility that maps field errors to user-friendly messages, similar to `getAuthErrorMessage()`.

- **Recommendation:**
  - Create `src/lib/validation/` directory with schemas co-located by entity:
    ```
    src/lib/validation/
      projects.ts    — createProjectSchema, updateProjectSchema
      estimates.ts   — createEstimateSchema, updateEstimateSchema
      nodes.ts       — createNodeSchema, updateNodeSchema, moveNodeSchema
      snapshots.ts   — createSnapshotSchema
      preferences.ts — userPreferencesSchema, companySettingsSchema
      shared.ts      — common patterns (uuidSchema, paginationSchema, dateRangeSchema)
      format-error.ts — formatZodError() utility
    ```
  - Schemas should be used both client-side (form validation) and server-side (server action input validation).
  - Export the inferred types from schemas (`z.infer<typeof createProjectSchema>`) and use those as the server action input types — single source of truth.
- **Dependencies:** Blocks all server actions, blocks all forms
- **Effort:** Medium

### Finding 6: Testing Strategy — Major Gap Between Requirements and Infrastructure

- **Severity:** CRITICAL
- **Category:** Testing
- **Details:** The codebase has 2 test files with 8 test cases (4 smoke, 4 security). The plan mentions "12+ tests" for triggers and "10+ tests" for constraints, but this dramatically underestimates the testing needs given the 5 new decisions. Here is a comprehensive test case inventory:

  **Database trigger tests (tests/database/triggers.test.ts):**
  1. ltree path computed correctly on INSERT (root node)
  2. ltree path computed correctly on INSERT (child node)
  3. ltree path updated on parent_id change (move)
  4. ltree descendant paths updated on move (subtree)
  5. Auto-promote item to group when child added
  6. Auto-promote archives node_item_details row
  7. Auto-demote group to item when last child removed (delete)
  8. Auto-demote group to item when last child removed (move)
  9. Auto-demote restores archived node_item_details
  10. Auto-demote does NOT fire for manually-created groups (no archived details)
  11. Prevent node_type change to 'item' if has children
  12. updated_at trigger fires on UPDATE
  13. History trigger captures UPDATE with correct change_type
  14. History trigger captures DELETE with correct change_type
  15. History trigger records changed_by from app.current_user_id
  16. Option membership propagates when node moved into option subtree
  17. Option membership propagates to descendants of moved node
  Total: **17 tests**

  **Database constraint tests (tests/database/constraints.test.ts):**
  1. node_type CHECK rejects invalid value
  2. client_visibility CHECK rejects invalid value
  3. items must have parent (CHECK constraint)
  4. reference_name unique per estimate
  5. ratio_denominator cannot be zero
  6. qty_mode CHECK rejects invalid value
  7. cost_type CHECK rejects invalid value
  8. bid_type CHECK rejects invalid value
  9. CASCADE delete: estimate deletion cascades to nodes
  10. CASCADE delete: node deletion cascades to details
  11. CASCADE delete: node deletion cascades to notes
  12. CASCADE delete: option group cascades to alternatives
  13. FK integrity: node parent_id must reference existing node
  14. FK integrity: node estimate_id must reference existing estimate
  Total: **14 tests**

  **Snapshot tests (tests/database/snapshots.test.ts):**
  1. Basic snapshot creates new estimate with correct metadata
  2. Snapshot preserves complete node tree structure
  3. Snapshot preserves node_item_details
  4. Snapshot preserves node_assembly_details
  5. Snapshot preserves node_notes
  6. Snapshot remaps parent_id correctly (tree structure independent)
  7. Snapshot is independent: modifying original does not affect snapshot
  8. Snapshot is independent: modifying snapshot does not affect original
  9. Restore creates auto-snapshot of current state before restoring
  10. Restore produces correct tree structure from snapshot
  11. Restore with concurrent modification detected (optimistic locking)
  12. Snapshot of estimate with options preserves option_groups
  13. Snapshot remaps option_alternative_id in memberships
  14. Snapshot of empty estimate succeeds
  15. Snapshot name uniqueness per estimate enforced
  Total: **15 tests**

  **RLS policy tests (tests/database/rls.test.ts):**
  1. Owner can read all projects
  2. Owner can write all projects
  3. Employee can read all projects
  4. Employee can write estimates
  5. Client can only read assigned projects
  6. Client cannot read unassigned projects
  7. Client sees only client_visible nodes
  8. Client cannot see hidden nodes
  9. Pending user cannot access any data
  10. Anon user cannot access any data
  Total: **10 tests**

  **Server action tests (tests/actions/*.test.ts):**
  - projects.test.ts: CRUD (5 tests)
  - estimates.test.ts: CRUD + status transitions (6 tests)
  - nodes.test.ts: CRUD + move + reorder + type conversion + duplicate + toggle visibility (12 tests)
  - snapshots.test.ts: create + restore + list + delete (6 tests)
  - preferences.test.ts: get + update for user prefs and company settings (4 tests)
  Total: **33 tests**

  **Validation tests (tests/unit/validation.test.ts):**
  - Schema acceptance/rejection for each entity (project, estimate, node, snapshot, preferences): 3-5 cases each
  Total: **~20 tests**

  **Full-text search tests (tests/database/search.test.ts):**
  1. tsvector index returns results for name match
  2. tsvector index returns results for description match
  3. Search filters by estimate scope
  4. Search filters by project scope
  5. Cross-project global search works
  Total: **5 tests**

  **GRAND TOTAL: ~114 test cases** for Phase 1A + early 1B.

  The existing vitest infrastructure supports this — the 5 project categories (unit, smoke, security, db, actions) map well. But the plan's "12+ tests" and "10+ tests" estimates are off by 5x.

- **Recommendation:**
  - Update the plan to reflect ~114 test cases, not ~32
  - Prioritize by blast radius: snapshot tests > trigger tests > constraint tests > action tests > validation tests > search tests
  - Database tests require a test database with seed data and proper cleanup between tests (transaction-based isolation or per-test schema creation)
  - Add a `tests/helpers/` directory with: test database setup, seed data helpers, user authentication helpers, cleanup utilities
  - Set coverage thresholds after Phase 1A: target 80% on `src/lib/` (actions, validation, types), 0% on `src/app/` (UI not testable in unit tests)
- **Dependencies:** Blocks Phase 1A verification gate
- **Effort:** High (114 tests is ~2,000-3,000 lines of test code)

### Finding 7: Code Organization — Feature Directory Migration Should Wait

- **Severity:** MEDIUM
- **Category:** API
- **Details:** The current structure uses Next.js App Router conventions with `src/app/` for routes and `src/lib/` + `src/components/` for shared code. The codebase rules suggest evaluating "should src/ be reorganized into feature directories?" given the growing feature set.

  **Current structure (26 files):**
  ```
  src/
    app/           — 13 files (routes, layouts, error boundaries)
    components/    — 3 files (nav, shared)
    lib/           — 5 files (supabase clients, auth utilities, env)
    middleware.ts
    env.ts
  ```

  **After Phase 1A (~60+ files):**
  ```
  src/
    app/           — 13-18 files (routes, layouts, + new pages)
    components/    — 3-10 files
    lib/
      actions/     — 5-9 files (server actions by entity)
      types/       — 5-6 files (domain types, generated types, enums)
      validation/  — 6-7 files (Zod schemas by entity)
      auth/        — 3-4 files (existing + requireRole)
      supabase/    — 3 files (existing clients)
      utils/       — 2-3 files (formatZodError, etc.)
  ```

  This is still manageable with the current structure. Feature directories (`src/features/projects/`, `src/features/estimates/`) would add indirection for minimal benefit at this scale. The threshold for feature directories is typically 100+ files or when multiple features have their own components, actions, AND types.

  **Recommendation:** Keep the current `lib/` structure through Phase 1A. Revisit at Phase 1B when UI components proliferate. The server actions and validation schemas are shared across routes (a project action is used on the projects page AND the dashboard), so co-locating them by feature would cause cross-imports.

- **Recommendation:** Maintain current structure with these additions for Phase 1A:
  ```
  src/lib/actions/     — NEW: server actions by entity
  src/lib/types/       — NEW: domain types (currently empty)
  src/lib/validation/  — NEW: Zod schemas by entity
  ```
- **Dependencies:** None (organizational, not functional)
- **Effort:** Trivial

### Finding 8: Error Handling — Snapshot and Options Have Unique Failure Modes

- **Severity:** HIGH
- **Category:** API / UX
- **Details:** The architecture rules say "mutation handlers return structured errors, never throw." The current `ActionResult<T>` pattern from the plan is correct, but the 5 new decisions introduce failure modes that need specific error types:

  **Snapshot failures:**
  - Partial copy: deep_copy_estimate() fails mid-transaction -> PostgreSQL transaction rollback handles this atomically, but the server action must detect and report the failure cleanly
  - Concurrent modification: another user modified the estimate between auto-snapshot and restore -> need version check, return specific error "Estimate was modified by {user} at {time}. Refresh and try again."
  - Snapshot not found: deleted between list and restore -> standard 404 handling
  - Snapshot name already exists: UNIQUE violation -> "A snapshot with this name already exists"

  **Options failures:**
  - Circular reference in nested options (future): application-level cycle detection needed
  - Switching selection with no alternative selected: partial unique index only enforces "at most one" — application must enforce "exactly one"
  - Deleting the selected alternative: must auto-select another, or error if it's the only one
  - Option group anchor node deleted: CASCADE handles cleanup, but UI needs to handle the disappearance gracefully

  **Client sharing failures:**
  - Expired share link: specific error with option to request new link
  - Invalid PIN: rate limiting (5 attempts, 15-min lockout) — need a specific error that tells the client how many attempts remain
  - PIN brute force: lockout error with time remaining
  - Share link with deleted estimate: 404 with specific messaging

  **Search failures:**
  - Invalid query syntax (if supporting operators): parse error with suggestion
  - No results: not an error, but needs distinct handling from "search failed"
  - Cross-project search with no permission: filter results rather than error

- **Recommendation:**
  - Extend `ActionResult<T>` with error codes, not just messages:
    ```typescript
    type ActionResult<T> =
      | { success: true; data: T }
      | { success: false; error: string; code: ErrorCode }
    
    type ErrorCode =
      | 'VALIDATION_ERROR'
      | 'NOT_FOUND'
      | 'CONFLICT'           // concurrent modification
      | 'DUPLICATE'          // unique constraint violation
      | 'FORBIDDEN'          // permission denied
      | 'RATE_LIMITED'       // too many attempts
      | 'EXPIRED'            // share link expired
      | 'INTERNAL_ERROR'     // unexpected failure
    ```
  - Map error codes to user-facing messages in a centralized error handler (pattern established by `getAuthErrorMessage()`)
  - For snapshot operations specifically: always return the auto-snapshot ID on restore, so the user can recover if the restore produces unexpected results
- **Dependencies:** ActionResult<T> design affects all server actions
- **Effort:** Low (type design), Medium (implementation across all actions)

### Finding 9: Full-Text Search — Implementation Needs tsvector Column, Not Expression Index

- **Severity:** MEDIUM
- **Category:** Schema / Performance
- **Details:** Decision 5 requires full-text search on node name/description with scope filtering (current estimate, project, global). The data architecture specifies a GIN index on `to_tsvector('english', name || ' ' || COALESCE(description, ''))`.

  This is an **expression index** — it computes the tsvector on every query. For a table that will have thousands of rows across all estimates, a **stored tsvector column** with a trigger is better:

  ```sql
  ALTER TABLE estimate_nodes ADD COLUMN search_vector tsvector;
  
  CREATE FUNCTION update_node_search_vector() RETURNS TRIGGER AS $$
  BEGIN
    NEW.search_vector := to_tsvector('english', 
      NEW.name || ' ' || COALESCE(NEW.description, ''));
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;
  
  CREATE INDEX idx_nodes_search ON estimate_nodes USING gin(search_vector);
  ```

  This is faster for queries because the tsvector is precomputed. The trigger maintains it on INSERT and UPDATE. The catalog_items search index in the data architecture uses the expression index pattern — the stored column pattern is better for both.

  **Scope filtering** is application logic, not schema: `WHERE estimate_id = $1` for current estimate, `WHERE estimate_id IN (SELECT id FROM estimates WHERE project_id = $2)` for project scope, no WHERE clause for global scope.

- **Recommendation:**
  - Use stored tsvector column instead of expression index
  - Add the same pattern to catalog_items
  - Create a reusable search query builder in `src/lib/actions/search.ts` that handles scope filtering
  - Add `ts_rank()` for relevance ordering
- **Dependencies:** Migration Step 1A.1
- **Effort:** Low

### Finding 10: Missing tsconfig Strict Flags

- **Severity:** MEDIUM
- **Category:** Testing
- **Details:** The plan mentions adding `noUncheckedIndexedAccess` and `noImplicitReturns` at the start of Phase 1A, but the current `tsconfig.json` does not have them. These flags are critical for the new code:

  - `noUncheckedIndexedAccess`: Forces null checks on array/object index access. Essential when iterating over tree nodes (a node's children array lookup must handle undefined).
  - `noImplicitReturns`: Prevents functions from silently returning undefined. Critical for server actions that must always return `ActionResult<T>`.
  - `exactOptionalPropertyDifference`: Distinguishes between `undefined` and missing properties. Important for partial update schemas.

  These should be added BEFORE writing any Phase 1A code, not during it. Adding them later means retrofitting null checks into existing code.

- **Recommendation:** Add to tsconfig.json in the first Phase 1A commit:
  ```json
  {
    "compilerOptions": {
      "noUncheckedIndexedAccess": true,
      "noImplicitReturns": true,
      "exactOptionalPropertyDifference": true
    }
  }
  ```
- **Dependencies:** Must happen before any Phase 1A code
- **Effort:** Trivial (config change), Low-Medium (fixing any existing code that breaks)

### Finding 11: Database Test Infrastructure — Missing Entirely

- **Severity:** HIGH
- **Category:** Testing
- **Details:** The ~60+ database tests identified in Finding 6 all require connecting to a real PostgreSQL database (triggers, constraints, and RLS policies cannot be tested with mocks). The current test setup (`tests/setup.ts`) only loads `.env.local` for environment variables. There is no:

  - Database connection helper for tests
  - Transaction isolation (wrap each test in a transaction, rollback after)
  - Seed data helpers (create a project + estimate + nodes for testing)
  - User context helpers (set `app.current_user_id`, authenticate as different roles)
  - Cleanup utilities (truncate tables between test suites)
  - Test database provisioning (separate from development database)

  Without this infrastructure, database tests will be flaky, slow, and dangerous (running against the dev database).

- **Recommendation:**
  - Create `tests/helpers/db.ts` with:
    ```typescript
    export async function withTestTransaction(fn: (client: SupabaseClient) => Promise<void>)
    export async function seedProject(): Promise<{ project: Project; estimate: Estimate }>
    export async function seedNodeTree(estimateId: string): Promise<NodeWithDetails[]>
    export async function asRole(role: 'owner' | 'employee' | 'client'): Promise<SupabaseClient>
    ```
  - Use Supabase's local development stack (`supabase start`) for test database
  - Each test file should use transaction isolation or per-test cleanup
  - Add a `test:db:setup` script that resets the test database and applies all migrations
- **Dependencies:** Blocks all database tests
- **Effort:** Medium

### Finding 12: client_visible Field — Decision Conflict on Implementation

- **Severity:** MEDIUM
- **Category:** Schema
- **Details:** There is a conflict between Decision 2 and the existing data architecture on client visibility:

  - **Decision 2** says: `client_visible` boolean on estimate_nodes
  - **Data architecture (Section 4.1)** says: `client_visibility VARCHAR(20)` with CHECK `('visible','hidden','summary_only')`

  The 3-value approach (visible/hidden/summary_only) is richer than a boolean. `summary_only` means the client sees the node name and total, but not the line-item breakdown — a real need in construction estimating (showing "Kitchen Cabinetry: $45,000" without revealing the 30 individual line items).

  Decision 2's boolean was likely a simplification for the interaction discussion. The data architecture's 3-value approach should take precedence as it was the result of deeper analysis.

- **Recommendation:** Use the 3-value `client_visibility` from the data architecture. Update Decision 2's documentation to reflect this. The TypeScript type should be:
  ```typescript
  type ClientVisibility = 'visible' | 'hidden' | 'summary_only';
  ```
- **Dependencies:** Affects client view filtering logic
- **Effort:** Trivial

## Recommendations for Plan Update

### Plan Additions

1. **Add Step 1A.0: TypeScript Foundation** — Before any migration, create the type system architecture: `enums.ts`, `database.ts` stubs, `actions.ts` (ActionResult), `format-error.ts`. This takes 30 minutes and ensures all subsequent code has consistent types.

2. **Add Step 1A.0.5: tsconfig Strict Flags** — Add `noUncheckedIndexedAccess`, `noImplicitReturns`, `exactOptionalPropertyDifference` before writing any domain code.

3. **Update Step 1A.1 Migration** — Replace `project.status VARCHAR(50)` with the 10-value CHECK constraint from Decision 1. Replace `estimate.status` with the 4-value CHECK. Add `estimate_snapshots` table. Change `client_visible` to `client_visibility` per data architecture.

4. **Add Step 1A.1.5: Snapshot Function** — `deep_copy_estimate()` PostgreSQL function as its own migration step. This is complex enough to warrant isolation for testing and debugging.

5. **Expand Step 1A.5: Server Actions** — Reorganize into `src/lib/actions/` by entity. Add snapshot actions. Add preferences/settings actions. Count: ~30 actions, not ~9.

6. **Add Step 1A.5.5: Validation Schemas** — Create `src/lib/validation/` directory with Zod schemas for all server action inputs. This step should happen between action creation and testing, as tests will validate against schemas.

7. **Expand Step 1A.6: Tests** — Update from "12+ trigger tests, 10+ constraint tests" to the full 114-test inventory. Add test infrastructure setup as the first sub-step. Estimate 2-3 sessions for tests alone, not lumped into the general 1A estimate.

8. **Add search_vector column** — to both estimate_nodes and catalog_items tables, with trigger-maintained tsvector, instead of expression-based GIN indexes.

### Plan Reordering

The current plan has migrations (1A.1-1A.4) -> types + actions (1A.5) -> tests (1A.6). This should be:

1. **1A.0: Type foundation + tsconfig** (30 min)
2. **1A.1: Core tables migration** (as planned, with enum fixes)
3. **1A.2: Supporting tables migration** (as planned)
4. **1A.3: Triggers migration** (as planned)
5. **1A.4: History tables migration** (as planned)
6. **1A.5: Snapshot function migration** (NEW)
7. **1A.6: Test infrastructure** (NEW: helpers, seed data, db connection)
8. **1A.7: Database tests** (triggers, constraints, snapshots, RLS)
9. **1A.8: Generated types + domain types** (run supabase gen types, build composed types)
10. **1A.9: Validation schemas** (Zod schemas for all entities)
11. **1A.10: Server actions** (using generated types + validation)
12. **1A.11: Server action tests** (using test infrastructure)

This ordering ensures: database is proven correct (via tests) BEFORE building the TypeScript layer on top of it. The old order (types + actions before tests) risks building on an unverified foundation.

### Duration Estimate Adjustment

The plan says "2-3 sessions" for all of Phase 1A. With 114 tests, a snapshot deep-copy function, 30+ server actions, and comprehensive validation schemas, this is more realistically **4-5 sessions**. The breakdown:
- Session 1: Type foundation + 5 migration files
- Session 2: Snapshot function + test infrastructure + database tests (part 1)
- Session 3: Database tests (part 2) + generated types + domain types
- Session 4: Validation schemas + server actions
- Session 5: Server action tests + verification + cleanup

## Questions for Other Board Members

1. **For Schema Analyst:** The `deep_copy_estimate()` function needs to handle 12 tables with FK remapping. Has the schema been designed to make this feasible in a single function, or do circular FK references create problems? Specifically: `option_groups.anchor_node_id -> estimate_nodes.id` and `node_option_memberships.node_id -> estimate_nodes.id` AND `node_option_memberships.option_alternative_id -> option_alternatives.id` — the copy order matters. Nodes must be copied before option groups (which reference nodes), and option groups before alternatives, and alternatives before memberships.

2. **For Security Analyst:** The share link + PIN authentication is application-level auth, not Supabase Auth. How should the PIN validation server action interact with RLS policies? The share link request won't have a Supabase JWT. Does this require the service role key for database access? If so, how do we enforce row-level filtering without RLS?

3. **For Performance Analyst:** The snapshot deep-copy for a large estimate (1,000 nodes + details + options) — what is the expected execution time? Should we add a progress indicator for the UI, or will the PostgreSQL function complete within a single request timeout (~30 seconds)?

4. **For UX Analyst:** Decision 3 says user preferences include "expanded/collapsed nodes, zoom" per estimate. The data architecture puts `view_settings JSONB` on the estimates table itself, not a per-user-per-estimate junction table. This means all users share the same expand/collapse state. For multi-user (from addendum), this should be a `user_estimate_preferences` junction table. Has this been accounted for?

5. **For all:** The `node_notes` table (from the weekend session) is mentioned in the plan but has no schema definition in any of the 5 decisions or the existing data architecture. What are the columns? The session doc says "multiple entries per node, rich text, soft-delete, author/timestamp" but no table definition exists. This is a gap that must be filled before the Phase 1A migration.
