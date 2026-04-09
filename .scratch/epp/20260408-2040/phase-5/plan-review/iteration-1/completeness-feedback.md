# Completeness Review -- Iteration 1

## Verdict: REVISE

## Strengths (what the plan gets right)

1. **Excellent phasing granularity.** The split from 4 monolithic steps into 13 focused phases (1A-0 through 1A-12) is a major structural improvement. Each phase has a clear scope, verification script, agent assignments, and commit message.

2. **All 5 user decisions are reflected.** Project lifecycle (Decision 1), node actions (Decision 2), user preferences (Decision 3), client experience (Decision 4), and search/filtering (Decision 5) all have concrete plan items. The 10-value project_status, 4-value estimate_status, JSONB snapshots, hybrid company_settings, and full-text search infrastructure are all present.

3. **CRITICAL findings C1-C5 are all addressed.** Snapshot JSONB storage (C1), mandatory RLS on every table (C2), client_visibility 3-value VARCHAR (C3), deep_copy with FK remapping (C4), and pending role enforcement (C5) all have dedicated plan items and verification gates.

4. **Research file references are embedded throughout.** The plan cites specific sections of all 8 research files, creating traceability from research to implementation.

5. **Test count exceeds the analysis target.** The plan identifies 164+ test cases, exceeding the comprehensive analysis's 114+ minimum. Test suites are categorized by priority.

6. **Duration estimate is realistic.** 5-6 sessions for Phase 1A matches the consensus from the comprehensive analysis (which called for 4-5 sessions minimum).

7. **Verification scripts at every gate.** Every phase has a bash verification script checking file existence, key patterns, and content integrity.

---

## Issues Found

### Issue 1: `node_attachments` Table Missing from All Migration Phases

- **Severity:** MAJOR
- **Location in plan:** Phase 1A-2 (Core Tables), Phase 1A-9 (Functions)
- **Problem:** The deep-copy function research (`deep-copy-function-research.md`) explicitly lists `node_attachments` as Group 3 item #6 in the copy dependency order, alongside `node_item_details`, `node_assembly_details`, and `node_notes`. The complete deep-copy SQL provided in research includes `INSERT INTO node_attachments` as Step 6. The snapshot serialization function includes `node_attachments` in its JSONB output. The restore function includes `DELETE FROM node_attachments` and `INSERT INTO node_attachments` steps. However, `node_attachments` appears NOWHERE in the implementation plan -- no CREATE TABLE, no RLS policy, no migration phase, no TypeScript type. Yet the Phase 1A-9 functions that are taken from research will reference this table and fail.
- **Fix:** Either (a) add `node_attachments` as a table in Phase 1A-2 with schema (id, node_id FK, file_name, file_path, file_size, file_type, attachment_type, uploaded_at, uploaded_by) + RLS, and add it to the deep-copy/snapshot function definitions, OR (b) explicitly exclude it from the deep-copy and snapshot SQL and note it as deferred. The plan must be internally consistent -- functions cannot reference tables that don't exist.

### Issue 2: `proposals` / `vendor_proposals` Table Referenced in Analysis but Missing from Plan

- **Severity:** MINOR
- **Location in plan:** Phase 1A-4 (Catalog, Options & Vendor Tables)
- **Problem:** The comprehensive analysis Plan Update Requirements (line 257) lists `proposals` as part of Migration 4 alongside vendors. The plan's Phase 1A-4 lists `vendors` but no `proposals` table. This may be intentional (deferred), but there is no explicit deferral note.
- **Fix:** Add a brief note in Phase 1A-4 or the deferred items table explaining whether `vendor_proposals` / `proposals` is deferred to 1B+ or simply not needed.

### Issue 3: `set_app_user_id` Function Referenced in Analysis but Missing from Plan

- **Severity:** MINOR
- **Location in plan:** Phase 1A-9 (PostgreSQL Functions)
- **Problem:** The comprehensive analysis Plan Update Requirements (line 263) lists Migration 10 as including `set_app_user_id` alongside deep_copy, create_snapshot, and restore_snapshot. The implementation plan's Phase 1A-9 lists 6 functions but `set_app_user_id` is not among them. This function is typically used to set `app.user_id` for the session so that `changed_by` columns in history triggers can identify the acting user.
- **Fix:** Either add `set_app_user_id()` to Phase 1A-9 with its definition, or explain why it is not needed (e.g., if `auth.uid()` is used directly in triggers instead).

### Issue 4: No Documentation Update Phase -- CODEBASE_MAP.md, INTENT.md, CONTRACT-INDEX.md, DESIGN-SYSTEM.md Are Not Mentioned

- **Severity:** MAJOR
- **Location in plan:** Missing entirely
- **Problem:** Per the project's non-negotiable contracts-enforcement rule, every code change must update relevant contracts, CODEBASE_MAP.md, INTENT.md, and CONTRACT-INDEX.md in the same commit. This plan introduces 10 migration files, 30+ TypeScript files in new directories (`src/lib/types/domain/`, `src/lib/validation/`, `src/lib/actions/`, `src/lib/options/`, `tests/setup/`, `tests/db/`), 8 new tables, and several architectural decisions. None of the 13 phases mention updating any of these project meta-documents. The plan also makes no mention of DESIGN-SYSTEM.md updates, though the Phase 1B UI work will certainly require them. At minimum:
  - CODEBASE_MAP.md needs updated file registry for all new directories and files
  - INTENT.md needs new decisions recorded (enum strategy, snapshot JSONB approach, user_profiles consolidation, 3-value client_visibility)
  - CONTRACT-INDEX.md needs any new contracts that govern the new feature boundaries
  - Contracts may need to be created for: snapshot system, options system, client visibility, RLS policy patterns
- **Fix:** Add a documentation update step to either (a) each phase's commit section (preferred, per the atomic commit rule), or (b) a dedicated Phase 1A-13 "Documentation & Contract Sync" phase that updates all meta-documents. Include contract creation for the new feature boundaries.

### Issue 5: `flag_color VARCHAR(7)` from C11 Finding Is Silently Dropped

- **Severity:** MINOR
- **Location in plan:** Phase 1A-2 (Core Tables)
- **Problem:** The comprehensive analysis finding C11 says "Consider `flag_color VARCHAR(7)` for multiple flag types." The plan includes `flagged BOOLEAN` but does not mention `flag_color` at all -- no implementation, no explicit deferral note. This is a minor gap because the boolean is sufficient for now, but the plan should acknowledge the consideration.
- **Fix:** Add a note in Phase 1A-2's estimate_nodes section: "Deferred: `flag_color VARCHAR(7)` for multi-color flags -- revisit if single boolean proves insufficient."

### Issue 6: `createEstimateFromSnapshot` Has a Server Action but No PostgreSQL Function

- **Severity:** MAJOR
- **Location in plan:** Phase 1A-9 (Functions) vs Phase 1A-11 (Server Actions)
- **Problem:** Phase 1A-11 lists `createEstimateFromSnapshot` as a server action in `snapshots.ts`, and the snapshot research describes it as a distinct operation from restore. Phase 1B-1 lists "Create Estimate from Snapshot" as a UI deliverable. However, Phase 1A-9 only defines `restore_estimate_snapshot()` -- there is no `create_estimate_from_snapshot()` PostgreSQL function. The research file explicitly distinguishes these as separate operations: restore overwrites the current estimate, while "create from snapshot" creates a NEW estimate from snapshot data (new estimate_id, same version_group). Without a database function, the server action has no backend to call.
- **Fix:** Add `create_estimate_from_snapshot(p_snapshot_id UUID, p_name VARCHAR, p_version_label VARCHAR, p_created_by UUID)` to Phase 1A-9's function list. This function should: (1) create new estimate row, (2) deserialize snapshot JSONB into the new estimate's tables, (3) return the new estimate UUID.

### Issue 7: Validation Schema Coverage Is Incomplete for All Entity Types

- **Severity:** MINOR
- **Location in plan:** Phase 1A-10 (Validation Schemas)
- **Problem:** The plan lists 9 validation schema files but is missing schemas for `notes` (createNoteSchema, updateNoteSchema) and `catalog` (addToCatalogSchema). Phase 1A-11 has `notes.ts` server actions (createNote, updateNote, deleteNote) and `catalog.ts` stubs, but Phase 1A-10 has no corresponding validation schemas. Server actions that accept user input without validation schemas violate the plan's own pattern.
- **Fix:** Add `src/lib/validation/notes.ts` (createNoteSchema, updateNoteSchema) and `src/lib/validation/catalog.ts` (addToCatalogSchema) to Phase 1A-10's validation schema list.

### Issue 8: Share Link Rate Limiting Parameters from C13 Not in Schema Design

- **Severity:** MINOR
- **Location in plan:** Phase 1A-5 (Client/Sharing Tables)
- **Problem:** Finding C13 specifies aggressive rate limiting: "5 failed attempts per share link per IP -> 30-min lockout, global 20 attempts/hour/IP across all share links." The plan's `estimate_shares` table has `failed_attempts INTEGER` and `locked_until TIMESTAMPTZ`, which covers per-link lockout. But there is no schema for the per-IP rate limiting (global 20 attempts/hour/IP). This is likely handled at the application layer (not schema), but the plan should note this explicitly since C13 is a HIGH finding.
- **Fix:** Add a note in Phase 1A-5 or Phase 1B-4 (Client Portal): "Per-IP rate limiting (C13: 20 attempts/hour/IP) is application-layer, implemented via in-memory rate limiter or Redis in the share link validation API route (Phase 1B-4)."

### Issue 9: Inconsistent Server Action Count Claims

- **Severity:** MINOR
- **Location in plan:** Multiple locations
- **Problem:** The plan claims "~30 server actions" in the context section (line 20) and Phase 1A-11 heading, but the actual enumeration in Phase 1A-11 lists 54 action functions across 11 files. The commit message says "~30 server actions." This inconsistency could cause confusion during estimation and review.
- **Fix:** Update the context section and commit message to say "~54 server actions" to match the detailed enumeration. Alternatively, clarify that ~30 are "primary" actions and ~24 are simple wrappers/stubs.

### Issue 10: Phase 1B Roadmap Lacks Sufficient Detail for Scope Estimation

- **Severity:** MAJOR
- **Location in plan:** Phase 1B section (lines 1176-1249)
- **Problem:** Phase 1B is described in 6 sub-phases with bullet-point deliverables and rough session estimates (totaling 4-6 sessions), but lacks:
  - File-level deliverables (which components, which routes, which hooks)
  - Agent assignment patterns
  - Verification scripts
  - Dependency relationships between 1B sub-phases (e.g., 1B-3 Options UI depends on Phase 2A Calculation Engine for accurate totals -- but does that mean it ships after Phase 2A?)
  - Design system token requirements (which tokens from DESIGN-SYSTEM.md apply to each UI feature)
  - State management approach (React Context, Zustand, server state via React Query, etc.)
  The plan says 1B-3 "Dependencies: Phase 1A complete, Phase 2 calculation engine" -- if that dependency is real, 1B-3 cannot ship after Phase 1A alone, which contradicts the "all require 1A complete" grouping in the dependency DAG.
- **Fix:** Add at minimum: (a) a file/component list for each 1B sub-phase, (b) a refined dependency graph that accurately shows 1B-3's dependency on Phase 2A, (c) state management pattern decision. Full Phase 1B detail can be a separate planning document, but the current level of detail is insufficient to estimate scope or sequence work.

---

## Cross-Cutting Concerns

### 1. Contract Creation Entirely Absent

The plan creates 8+ new feature boundaries (snapshots, options, client visibility, RLS, settings/preferences, notes, deep-copy, catalog) but does not create a single contract file in `contracts/`. Per the project's non-negotiable contracts-enforcement rule, each feature boundary needs a contract. The plan should include contract creation alongside the code.

### 2. No Rollback Strategy for Individual Migrations

Each migration is described as independently testable and rollback-safe (per C15), but no rollback SQL or strategy is defined. If Migration 5 fails, what happens to Migrations 1-4? The plan should note whether `supabase db reset` is the rollback approach during development (acceptable) or whether down-migrations are needed.

### 3. The Dependency DAG Shows 1A-5 Depends on 1A-2 but Not 1A-3/1A-4 -- Yet `estimate_snapshots` References `option_groups`

Phase 1A-5 creates `estimate_snapshots` whose JSONB schema serializes `option_groups`, `option_alternatives`, and other tables from Phase 1A-4. While the JSONB itself doesn't have FK constraints, the snapshot creation function in Phase 1A-9 queries these tables. The DAG should show 1A-9 depends on both 1A-4 and 1A-5 (it already does via the linear chain), but the parallel opportunity note suggesting "1A-5 depends on 1A-2 but NOT on 1A-3/1A-4" could mislead an implementer into running 1A-5 before 1A-4 completes. The table definitions in 1A-5 themselves are safe (no FK to option tables), but this should be clarified.

### 4. History Table for `node_item_details` Mentioned but No Trigger Defined

Phase 1A-7 lists `node_item_details_history` as a table to create, but the `log_node_history()` trigger function is only described for `estimate_nodes_history`. A separate trigger or a modification to log item detail changes is needed but not specified.

---

## Final Assessment

The plan is comprehensive and well-structured. It successfully translates the 5 user decisions, 19 consensus findings, and 8 research files into actionable implementation phases. The most significant gaps are:

1. **Missing `node_attachments` table** -- causes function-level failures in deep-copy and snapshot SQL
2. **Missing `createEstimateFromSnapshot` PostgreSQL function** -- leaves a server action with no backend
3. **No documentation/contract update plan** -- violates the project's own non-negotiable rules
4. **Phase 1B lacks detail for scope estimation** -- session estimates are guesses without file-level planning

None of these are fundamental architectural problems. They are coverage gaps that can be fixed with targeted additions. The plan should be revised to address the 4 MAJOR issues before implementation begins.
