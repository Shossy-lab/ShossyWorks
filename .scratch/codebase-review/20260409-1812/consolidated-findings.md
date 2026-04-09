# Consolidated Codebase Review Findings

**Date:** 2026-04-09
**Agents:** 13
**Scope:** Full-stack review of ShossyWorks (Next.js 16 + Supabase construction estimating platform)

---

## 1. Summary

| Metric | Count |
|--------|-------|
| Raw findings (all agents) | 119 |
| After deduplication | 73 |
| CRITICAL | 6 |
| HIGH | 27 |
| MEDIUM | 30 |
| LOW | 10 |

---

## 2. Consensus Heatmap

Findings flagged by 2+ agents, sorted by severity then consensus count. These are the highest-confidence issues.

| ID | Finding | Severity | Agents (count) | Agents |
|----|---------|----------|----------------|--------|
| CF-01 | SECURITY DEFINER RPC functions (5) have no internal auth checks -- any authenticated user can call them, bypassing all RLS | CRITICAL | 3 | AUTH-01, SEC-C1, DB-CRIT-02 (partial) |
| CF-02 | `restoreSnapshot` validates `estimateVersion` but silently discards it -- optimistic locking is non-functional | CRITICAL | 5 | AI-02, API-01, ARCH-02, CQ-01, SEC-H4 |
| CF-03 | `duplicateNode` imports `duplicateNodeSchema` but never uses it; schema/action interface mismatch | HIGH | 5 | AI-04, API-02, ARCH-01, CQ-03, CQ-05 |
| CF-04 | Non-atomic two-step insert in `createNode`/`duplicateNode` -- orphaned rows on partial failure | HIGH | 4 | API-05, CQ-02, ERR-05, PERF-05 |
| CF-05 | `updateItemDetails`/`updateAssemblyDetails` silently succeed on zero-row updates (wrong node type) | HIGH | 3 | API-07, ERR-03, PERF-02 (related) |
| CF-06 | `deleteSnapshot` admin client bypasses all RLS and immutability trigger -- insufficient guards | HIGH | 4 | AI-07, API-09, AUTH-02, SEC-C2 |
| CF-07 | Inconsistent validation -- 13-15 actions use manual `if (!id)` instead of existing Zod schemas | HIGH | 4 | API-03, CQ-06, SEC-H1, TYPE-02 (related) |
| CF-08 | Dead imports: `notFound` unused in 3 action files, unused Zod schemas in nodes.ts | MEDIUM | 4 | AI-05, AI-08, ARCH-06, CQ-05 |
| CF-09 | `nodes.ts` at 623 lines exceeds 300-line target by 2x | MEDIUM | 2 | ARCH-07, CQ-04 |
| CF-10 | Server actions perform NO role-based authorization -- all rely entirely on RLS | HIGH | 2 | AUTH-03, SEC-H1 (related) |
| CF-11 | `set_updated_at()` trigger missing SECURITY DEFINER and SET search_path (CVE-2018-1058) | MEDIUM | 2 | DB-HIGH-01, SEC-M3 |
| CF-12 | Snapshot immutability trigger inconsistency between migration 006 and 007 | MEDIUM | 2 | DB-CRIT-02, SEC-M2 |
| CF-13 | `restoreSnapshot` does not pass `p_force` parameter -- active estimate restore always fails | MEDIUM | 2 | AI-02 (partial), API-06 |
| CF-14 | Unused Zod enum imports (`costTypeSchema`, `qtyModeSchema`, `bidTypeSchema`) in nodes.ts | MEDIUM | 3 | AI-05, ARCH-06, TYPE-09 |
| CF-15 | SnapshotData type misaligned with actual SQL JSONB structure (hallucinated fields, missing keys) | HIGH | 2 | AI-01, TYPE-07 (related) |
| CF-16 | Auth pages are full client components instead of server page + client form child | HIGH | 2 | ARCH-03, A11Y-M3 (related) |
| CF-17 | History `changed_by` always NULL -- no server action sets `app.current_user_id` | HIGH | 2 | SEC-H2, PERF-09 (related) |
| CF-18 | `createVersionSchema` and 20+ other validation schemas/types defined but never used | MEDIUM | 2 | AI-06, CQ-07 |
| CF-19 | Duplicate enum definitions across 3 layers with no compile-time drift guard | MEDIUM | 2 | CQ-10, TYPE-04 |
| CF-20 | `handleSupabaseError` does not log known error codes (23505, 23503, PGRST116) | HIGH | 2 | ERR-02, PERF-02 (related) |
| CF-21 | `getAuthenticatedClient()` creates two Supabase clients per action call | HIGH | 2 | PERF-03, ARCH-04 (related) |

---

## 3. Topic Clusters for Research

### Cluster A: Authorization & RLS Bypass (10 findings)
**Findings:** CF-01, CF-06, CF-07, CF-10, AUTH-04, AUTH-05, AUTH-06, AUTH-07, AUTH-08, SEC-M1
**Research Questions:**
1. What is the correct pattern for adding authorization checks inside Supabase SECURITY DEFINER functions?
2. Should the project use a custom database role for staff users instead of granting to `authenticated`?
3. How should the `deleteSnapshot` admin client bypass be restructured to work with the unconditional immutability trigger?
4. What is the impact radius if a client-role or pending user discovers the direct RPC call path?

### Cluster B: Data Integrity & Transaction Safety (8 findings)
**Findings:** CF-02, CF-04, CF-05, CF-13, CF-15, DB-CRIT-01, DB-HIGH-03, DB-HIGH-04
**Research Questions:**
1. Should `createNode` and `duplicateNode` be rewritten as Supabase RPCs for atomicity?
2. What is the correct approach for implementing optimistic locking across the snapshot restore flow?
3. How should `SnapshotData` be restructured to match the actual SQL serialization output?
4. Should snapshot serialization include estimate-level metadata (rates, notes, description)?

### Cluster C: Validation & Type Safety (9 findings)
**Findings:** CF-03, CF-07, CF-14, CF-18, CF-19, TYPE-01, TYPE-05, TYPE-06, TYPE-08
**Research Questions:**
1. Should all server actions be standardized to use Zod validation, or is the manual pattern acceptable for simple ID lookups?
2. How should the Zod enum double-cast (`as unknown as [string, ...string[]]`) be replaced to preserve literal types?
3. What is the right approach for aligning the 9 SQL enums with TypeScript -- derive from generated types or maintain manually?

### Cluster D: Test Infrastructure (6 findings)
**Findings:** T-CRIT-01, T-HIGH-01, T-HIGH-02, T-HIGH-03, T-HIGH-04, T-MED-03
**Research Questions:**
1. How should `server-only` be mocked in Vitest to unblock the 58 action tests?
2. What CI configuration is needed for the 173 database tests (local Supabase, Docker Compose)?
3. How should the `run_sql` RPC function be documented and provisioned for test environments?
4. What is the priority order for adding unit tests vs fixing broken integration tests?

### Cluster E: Performance & Query Efficiency (7 findings)
**Findings:** PERF-01, PERF-02, PERF-03, PERF-04, PERF-06, PERF-07, PERF-08
**Research Questions:**
1. Should `restore_estimate_snapshot()` be rewritten with set-based inserts (like `deep_copy_estimate()`)?
2. What is the latency cost of the redundant `getNode()` re-fetch after every mutation?
3. Should middleware skip `getUser()` for public routes, or does the Supabase session refresh pattern require it?

### Cluster F: Accessibility & Frontend (5 findings)
**Findings:** A11Y-H1, A11Y-H2, A11Y-H3, A11Y-H4, A11Y-H5
**Research Questions:**
1. What is the correct landmark structure for a Next.js app with root layout + protected layout + page?
2. How should focus-visible styles be systematically added to all 15+ interactive elements?
3. Should a global focus style be defined in `globals.css` as a design token?

---

## 4. All Findings (Deduplicated, Sorted by Severity)

### CRITICAL (6)

#### CF-01: SECURITY DEFINER RPC functions have no internal authorization checks
**Severity:** CRITICAL
**Agents:** Auth Auditor, Security Scanner, DB Inspector (partial)
**Files:** `supabase/migrations/20260409000011_functions.sql` (all 5 RPC functions)
**Description:** All five SECURITY DEFINER functions (`deep_copy_estimate`, `create_estimate_snapshot`, `restore_estimate_snapshot`, `create_estimate_from_snapshot`, `set_subtree_visibility`) are granted EXECUTE to `authenticated` role but contain zero internal authorization checks. They bypass all RLS when executing. Any authenticated user -- including `pending` and `client` role users -- can call these directly via the Supabase JS SDK to deep-copy any estimate, create/restore snapshots, and change node visibility. Complete authorization bypass for the most sensitive business operations.
**Fix:** Add `IF NOT public.is_staff() THEN RAISE EXCEPTION 'Permission denied: staff role required'; END IF;` as the first line in every SECURITY DEFINER function, or restrict GRANT to a custom staff-only database role.

#### CF-02: `restoreSnapshot` validates `estimateVersion` but silently discards it -- optimistic locking non-functional
**Severity:** CRITICAL
**Agents:** AI Code Auditor, API Verifier, Arch Reviewer, Code Quality, Security Scanner
**Files:** `src/lib/validation/snapshots.ts:23-28`, `src/lib/actions/snapshots.ts:125-163`, `supabase/migrations/20260409000011_functions.sql:825-829`
**Description:** The `restoreSnapshotSchema` requires `estimateVersion` (described as "required for optimistic locking"), validates it via `safeParse`, then never passes it to the RPC call. The DB function `restore_estimate_snapshot` has no version parameter. The action also matches error messages for "version" or "modified" that the SQL function never raises. The optimistic lock is completely non-functional -- concurrent restore operations can overwrite each other.
**Fix:** Either add `p_expected_version` parameter to the RPC and check it, or add a version check in the server action before calling the RPC.

#### CF-03-CRIT: `restore_estimate_snapshot()` missing EXCEPTION block -- trigger bypass flag can leak
**Severity:** CRITICAL
**Agents:** DB Inspector
**Files:** `supabase/migrations/20260409000011_functions.sql:825-1231`
**Description:** `deep_copy_estimate()` and `create_estimate_from_snapshot()` both have `EXCEPTION WHEN OTHERS THEN RESET app.is_snapshot_copy; RAISE;` blocks. `restore_estimate_snapshot()` does not. If any error occurs during restore, the `app.is_snapshot_copy = 'true'` flag remains set. While `SET LOCAL` scopes to the transaction, savepoints used by Supabase client libraries could cause the flag to leak, disabling history triggers and path maintenance for subsequent operations.
**Fix:** Add the same `EXCEPTION WHEN OTHERS THEN RESET app.is_snapshot_copy; RAISE;` block.

#### CF-04-CRIT: Admin client snapshot delete may be permanently broken OR dangerous
**Severity:** CRITICAL
**Agents:** Security Scanner, Auth Auditor, API Verifier, AI Code Auditor
**Files:** `src/lib/actions/snapshots.ts:197-241`, `supabase/migrations/20260409000007_triggers.sql:264-282`
**Description:** The `deleteSnapshot` action uses `createAdminClient()` (service_role key) to bypass the snapshot immutability trigger. However, migration 007 replaced the trigger function to unconditionally `RAISE EXCEPTION 'Snapshots are immutable'` with no bypass. The service_role key bypasses RLS but NOT PostgreSQL triggers. This means either: (a) the delete always fails silently, or (b) if migration ordering left the old trigger active, the admin client can delete any snapshot. Additionally, the action has no role check (any non-pending user can call it) and the ownership check is the only guard before the admin bypass.
**Fix:** Re-add a controlled bypass mechanism (e.g., `SET LOCAL app.allow_snapshot_mutation = 'true'` checked in the trigger), with the server action setting it via admin client before deleting.

#### CF-05-CRIT: ALL 58 server action tests permanently broken -- `server-only` import barrier
**Severity:** CRITICAL
**Agents:** Test Reviewer
**Files:** `tests/actions/*.test.ts`, `src/lib/auth/get-user.ts:1`
**Description:** All 58 server action tests fail with "This module cannot be imported from a Client Component module" because `get-user.ts` imports `server-only` which throws unconditionally outside Next.js server context. Vitest runs in Node.js. The `skipIf` guard only checks env vars, not the import barrier. Zero test coverage for all 28 server actions.
**Fix:** Add `"server-only": path.resolve(__dirname, "tests/helpers/server-only-mock.ts")` as a vitest alias, with an empty mock file.

#### CF-06-CRIT: Snapshot immutability trigger inconsistency between migrations
**Severity:** CRITICAL (intermediate state risk)
**Agents:** DB Inspector
**Files:** `supabase/migrations/20260409000006_client_sharing_tables.sql:130-148`, `supabase/migrations/20260409000007_triggers.sql:264-282`
**Description:** Migration 006 creates `prevent_snapshot_mutation()` WITH a bypass (`app.allow_snapshot_mutation`). Migration 007 replaces it WITHOUT the bypass. If migration 007 fails partway, the system is left with the bypassable version. The final state is correct, but the intermediate state risk exists during migration runs.
**Fix:** Remove the function definition from migration 006 (move it entirely to 007) to eliminate the intermediate-state risk.

---

### HIGH (27)

#### CF-03: `duplicateNode` imports `duplicateNodeSchema` but never uses it
**Agents:** AI Code Auditor, API Verifier, Arch Reviewer, Code Quality (x2)
**Files:** `src/lib/actions/nodes.ts:17, 452-562`, `src/lib/validation/nodes.ts:177-183`
**Description:** The schema defines `sourceNodeId`, `includeChildren`, `includeDetails`, `includeNotes` fields. The action takes `(nodeId: string, includeNotes: boolean)` -- a completely different interface. No UUID validation occurs (only `!nodeId` check). The `includeChildren` and `includeDetails` capabilities from the schema are never implemented.

#### CF-04: Non-atomic two-step insert in `createNode`/`duplicateNode`
**Agents:** API Verifier, Code Quality, Error Reviewer, Performance Analyzer
**Files:** `src/lib/actions/nodes.ts:88-162, 452-562`
**Description:** Both functions insert a base node then insert a detail row as a separate query. If the detail insert fails, manual cleanup deletes the base node -- but the cleanup result is never checked. If cleanup also fails, orphaned nodes persist with no detail row, violating the domain invariant. Four instances of unchecked rollback cleanup at lines 136, 155, 515, 534.

#### CF-05: `updateItemDetails`/`updateAssemblyDetails` silently succeed on zero-row updates
**Agents:** API Verifier, Error Reviewer, (Performance Analyzer related)
**Files:** `src/lib/actions/nodes.ts:349-356, 385-392`
**Description:** These update queries use `.eq("node_id", nodeId)` without `.select().single()`. If no rows match (wrong node type, non-existent ID), the update is a silent no-op. The action returns the unchanged node via `getNode()`, making it appear the update succeeded. Compare with `updateNode` which correctly uses `.select().single()`.

#### CF-06: `deleteSnapshot` admin client bypasses all RLS with insufficient guards
**Agents:** AI Code Auditor, API Verifier, Auth Auditor, Security Scanner
**Files:** `src/lib/actions/snapshots.ts:197-241`
**Description:** Uses `createAdminClient()` which bypasses ALL RLS policies, not just the immutability trigger. No role check -- any authenticated non-pending user can call it. The ownership check (`created_by === user.id`) is the only authorization gate. The admin DELETE has no `.eq("snapshot_type", "milestone")` guard. See also CF-04-CRIT for the trigger conflict.

#### CF-07: Inconsistent validation -- 13-15 actions use manual checks instead of existing Zod schemas
**Agents:** API Verifier, Code Quality, Security Scanner, Type Checker (related)
**Files:** Multiple action files; corresponding unused schemas in `src/lib/validation/*.ts`
**Description:** 15 actions accept any non-empty string as a UUID via `if (!id)` checks, sending malformed IDs to Supabase where they fail with cryptic PostgREST errors. Zod schemas with UUID validation exist for many of these (`deleteProjectSchema`, `getProjectSchema`, `deleteEstimateSchema`, `deleteNodeSchema`, etc.) but are never imported or used.

#### CF-10: Server actions perform NO role-based authorization
**Agents:** Auth Auditor, Security Scanner (related)
**Files:** `src/lib/actions/_shared.ts:19-23`, all action files
**Description:** `getAuthenticatedClient()` calls `requireUser()` which only checks that the user is logged in, not their role. A `client`-role user can call any server action. The only defense is database RLS, which is already shown to be bypassable via SECURITY DEFINER functions (CF-01). No defense-in-depth for authorization.

#### CF-15: SnapshotData TypeScript type fully misaligned with SQL JSONB structure
**Agents:** AI Code Auditor, Type Checker (related)
**Files:** `src/lib/types/domain/snapshots.ts:47-56`, `supabase/migrations/20260409000011_functions.sql:767-782`
**Description:** The TS type declares `estimate_name` and `estimate_status` (never produced by SQL), uses `notes` instead of the correct `node_notes`, and is missing 8 keys (`serialized_at`, `item_details`, `assembly_details`, `option_sets`, `option_set_selections`, `broad_options`, `broad_option_overrides`, `option_set_broad_selections`). The `nodes` field uses inline details per node, but SQL serializes them as separate top-level arrays with `node_id` foreign keys.

#### CF-16: Auth pages are entire-page client components
**Agents:** Arch Reviewer, Frontend/A11Y (related)
**Files:** `src/app/(auth)/sign-in/page.tsx:1`, `src/app/(auth)/sign-up/page.tsx:1`, `src/app/pending-approval/page.tsx:1`
**Description:** All three auth pages are marked `"use client"` at line 1, making the entire page tree a client component. The correct pattern is a server component page that imports a client form component. This loses server-rendering benefits for content that could be statically rendered.

#### CF-17: History audit trail `changed_by` always NULL
**Agents:** Security Scanner, Performance Analyzer (related)
**Files:** `supabase/migrations/20260409000008_history_tables.sql`, all action files
**Description:** History triggers use `current_setting('app.current_user_id', true)` to capture who made changes. No server action or middleware ever sets this GUC. Every history record will have `changed_by = NULL`, making the audit trail useless for accountability.

#### CF-20: `handleSupabaseError` does not log known error codes
**Agents:** Error Reviewer, (Performance Analyzer related)
**Files:** `src/lib/actions/_shared.ts:33-41`
**Description:** `console.error` only fires for unknown error codes. When 23505 (unique constraint), 23503 (FK violation), or PGRST116 (not found) occurs, the function returns a user-friendly message but logs nothing. Constraint violations are invisible in server logs.

#### CF-21: `getAuthenticatedClient()` creates two Supabase clients per action
**Agents:** Performance Analyzer, Arch Reviewer (related)
**Files:** `src/lib/actions/_shared.ts:19-22`, `src/lib/auth/get-user.ts:8-15`
**Description:** `requireUser()` creates Supabase client #1 internally (via `getUser()`), then `getAuthenticatedClient()` creates client #2. Each `createClient()` call reads the cookie store via `await cookies()`. The first client is discarded after auth check.

#### CF-22: `_shared.ts` uses `"use server"` directive, exposing utilities as callable server actions
**Agents:** Arch Reviewer
**Files:** `src/lib/actions/_shared.ts:6`
**Description:** The `"use server"` directive marks ALL exported functions as server actions callable from client code. `getAuthenticatedClient()` and `handleSupabaseError()` are internal utilities not meant to be exposed. They should use `import "server-only"` instead.

#### CF-23: `deleteSnapshot` can throw unhandled from `createAdminClient`
**Agents:** Error Reviewer
**Files:** `src/lib/actions/snapshots.ts:229`, `src/lib/supabase/admin.ts:11`
**Description:** `createAdminClient()` throws if the service role key is missing. Called inside a server action with no try-catch. Violates the ActionResult contract that server actions never throw.

#### CF-24: `SnapshotOptionGroupRecord` has hallucinated `anchor_node_id` field
**Agents:** AI Code Auditor
**Files:** `src/lib/types/domain/snapshots.ts:113-118`
**Description:** The TS type declares `anchor_node_id: string` which does not exist in the `option_groups` SQL table or snapshot serialization. Missing `group_type` and `sort_order` which ARE serialized.

#### CF-25: `attachDetails` silently produces invalid discriminated union members
**Agents:** Type Checker
**Files:** `src/lib/actions/nodes.ts:47-67`
**Description:** When a detail record is missing, `details` is set to `null` via `?? null`, then cast with `as NodeWithDetails`. The `ItemNode` interface declares `details: ItemDetails` (non-nullable). The cast silences TypeScript but any code accessing `node.details.quantity` will crash with TypeError.

#### CF-26: 5 of 9 SQL enum types have no `enums.ts` representation
**Agents:** Type Checker
**Files:** `src/lib/types/enums.ts`, `supabase/migrations/20260409000002_enums_and_extensions.sql`
**Description:** `snapshot_type`, `option_group_type`, `approval_status`, `author_type`, and `app_role` are missing from `enums.ts` despite its header claiming to be the single source of truth for enum values.

#### CF-27: `setNodeVisibility` accepts untyped `string` parameter
**Agents:** Type Checker
**Files:** `src/lib/actions/nodes.ts:588-623`
**Description:** Unlike other actions that use Zod validation, `setNodeVisibility` accepts a raw `string` for `visibility` and does manual `includes` check with unsafe `as ClientVisibility` cast.

#### CF-28: Missing HSTS and CSP security headers
**Agents:** Security Scanner
**Files:** `next.config.ts:8-24`
**Description:** X-Frame-Options, X-Content-Type-Options, Referrer-Policy, and Permissions-Policy are set. `Strict-Transport-Security` (HSTS) and `Content-Security-Policy` (CSP) are missing. Without HSTS, SSL stripping attacks are possible. Without CSP, XSS impact is maximized.

#### CF-29: restore_estimate_snapshot() uses row-by-row loops instead of set-based inserts
**Agents:** Performance Analyzer
**Files:** `supabase/migrations/20260409000011_functions.sql:970-1102`
**Description:** 12 separate FOR LOOPs for row-by-row INSERT. `deep_copy_estimate()` and `create_estimate_from_snapshot()` correctly use set-based `INSERT ... SELECT`. Only `restore_estimate_snapshot()` uses the slow approach. For 500-node estimates, this means 500+ individual INSERT statements plus 500+ UPDATEs for parent_id.

#### CF-30: Every node mutation triggers redundant full re-fetch via getNode()
**Agents:** Performance Analyzer
**Files:** `src/lib/actions/nodes.ts` (8 locations)
**Description:** `updateNode` already has data from `.select().single()` but discards it and calls `getNode()` again. `flagNode` does 1-3 queries for a boolean toggle. Every write operation doubles round-trips.

#### CF-31: 173 database tests always skipped with no CI strategy
**Agents:** Test Reviewer
**Files:** `tests/database/*.test.ts`
**Description:** All database tests use `skipIf(SKIP)` where SKIP is true when env vars are absent. No CI configuration, Docker Compose, or documentation exists for running them. The `run_sql` RPC function required by trigger/RLS tests has no migration or setup script. 140 RLS tests (the most critical security validation) have no path to CI execution.

#### CF-32: Authorization tests are tautological -- pass regardless of outcome
**Agents:** Test Reviewer
**Files:** `tests/actions/projects.test.ts:294-334`
**Description:** Tests ACT-PROJ-15 and ACT-PROJ-16 accept SUCCESS as a valid outcome. They test nothing. The comment "If it succeeds, the test environment has an active session -- still valid" means the test cannot fail.

#### CF-33: Multiple tests silently swallow all errors via try/catch
**Agents:** Test Reviewer
**Files:** `tests/actions/nodes.test.ts`, `tests/actions/snapshots.test.ts` (6+ instances)
**Description:** At least 6 tests wrap their entire body in `try { ... } catch { // not implemented yet }`. These always pass even if the function throws unexpected errors or returns wrong data.

#### CF-34: Nested `<main>` landmarks -- WCAG violation
**Agents:** Frontend/A11Y
**Files:** `src/app/layout.tsx:23`, `src/app/(protected)/layout.tsx:40`
**Description:** Root layout wraps children in `<main id="main-content">`. Protected layout wraps page content in a second `<main>`. Nested `<main>` landmarks violate WCAG 1.3.1 and 4.1.1. Skip link targets the outer `<main>` which contains navigation.

#### CF-35: Sidebar nav links empty when collapsed -- WCAG violation
**Agents:** Frontend/A11Y
**Files:** `src/components/nav/sidebar.tsx:45-55`
**Description:** When sidebar is collapsed, links have no visible text AND no `aria-label`. The `title` attribute is not sufficient per WCAG 4.1.2. Screen readers announce "link" with no destination.

#### CF-36: Phantom dependency on `@t3-oss/env-core`
**Agents:** Dependency Auditor
**Files:** `src/env.ts:2`, `package.json`
**Description:** `@t3-oss/env-core/presets-zod` is imported directly but not listed in `package.json`. Resolves only via npm hoisting from `@t3-oss/env-nextjs`. Would break if switching to pnpm/yarn PnP or if the transitive dependency changes.

---

### MEDIUM (30)

| ID | Finding | Agents |
|----|---------|--------|
| CF-08 | Dead imports: `notFound` in 3 action files, unused Zod schemas in nodes.ts | AI-05, AI-08, ARCH-06, CQ-05 |
| CF-09 | `nodes.ts` at 623 lines exceeds 300-line target by 2x | ARCH-07, CQ-04 |
| CF-11 | `set_updated_at()` missing SECURITY DEFINER and SET search_path | DB-HIGH-01, SEC-M3 |
| CF-12 | Snapshot immutability trigger inconsistency between migrations 006/007 | DB-CRIT-02, SEC-M2 |
| CF-13 | `restoreSnapshot` does not pass `p_force` -- active estimate restore always fails | AI-02, API-06 |
| CF-14 | Unused Zod enum imports in nodes.ts validation | AI-05, ARCH-06, TYPE-09 |
| CF-18 | `createVersionSchema` and 20+ schemas/types defined but never used | AI-06, CQ-07 |
| CF-19 | Duplicate enum definitions across 3 layers with no compile-time drift guard | CQ-10, TYPE-04 |
| CF-37 | `env.ts` has `DIRECT_DATABASE_URL` and `CRON_SECRET` not in `pull-env.sh` | API-04 |
| CF-38 | `estimate_nodes` missing `phase_id` column despite phases table existing | DB-HIGH-02 |
| CF-39 | Snapshot serialization does not capture estimate-level metadata (rates, notes) | DB-HIGH-03 |
| CF-40 | `deep_copy_estimate()` does not copy comments; docstring implies full copy | DB-HIGH-04 |
| CF-41 | History tables deny ALL to authenticated -- no read path for staff | DB-HIGH-05 |
| CF-42 | Cost codes seed data uses ON CONFLICT with NULL subdivision -- not idempotent | DB-MED-03 |
| CF-43 | Snapshot `total_price` only sums root nodes -- may always be 0 | DB-MED-04 |
| CF-44 | Missing index on `client_project_access.project_id` | DB-MED-05 |
| CF-45 | `estimate_comments`/`estimate_approvals` INSERT policies lack `author_id` enforcement | AUTH-06 |
| CF-46 | JWT app_metadata role can be stale for up to 1 hour after role changes | AUTH-04 |
| CF-47 | Sign-up flow redirects to /dashboard before middleware catches pending state | AUTH-08 |
| CF-48 | `auth_callback_error` not in sign-in page error message map | ERR-04 |
| CF-49 | `duplicateNode` silently drops note duplication failures | ERR-06 |
| CF-50 | Error boundaries do not log errors or report to monitoring | ERR-07 |
| CF-51 | `createSnapshot` fetches full snapshot_data JSONB blob after creation | PERF-04 |
| CF-52 | Missing index on `node_item_details.vendor_id` | PERF-06 |
| CF-53 | Middleware calls `getUser()` on every request including public routes | PERF-07 |
| CF-54 | Zod enum double-cast erases literal types, forcing unsafe `as` casts | TYPE-05 |
| CF-55 | `SnapshotData.estimate_status` typed as `string` instead of enum type | TYPE-06 |
| CF-56 | `snapshot_data` JSONB returned from DB without runtime validation | TYPE-07 |
| CF-57 | `noUncheckedIndexedAccess` not enabled in tsconfig | TYPE-08 |
| CF-58 | Coverage thresholds set to zero in vitest config | T-MED-03 |
| CF-59 | No unit tests exist for testable pure logic (Zod schemas, enums, formatters) | T-MED-04 |
| CF-60 | RLS tests may be false positives -- `run_sql` RPC context unclear | T-MED-05 |
| CF-61 | Test data cleanup incomplete -- orphaned data accumulates | T-MED-02 |
| CF-62 | `global-error.tsx` uses hardcoded inline styles instead of design tokens | A11Y-M1 |
| CF-63 | 15 interactive elements missing focus-visible styles -- WCAG 2.4.7 | A11Y-H4 |
| CF-64 | `aria-current="page"` missing on active nav links | A11Y-M4 |
| CF-65 | Loading state lacks accessibility indication (no `role="status"`) | A11Y-M7 |
| CF-66 | Error alert pattern inconsistent across error boundaries | A11Y-M5 |
| CF-67 | Heading hierarchy skips h2 -- WCAG 1.3.1 | A11Y-H2 |
| CF-68 | Sidebar landmarks lack accessible labels | A11Y-H5 |
| CF-69 | Vite 7.3.1 has 3 HIGH-severity CVEs (dev-only) | DEP-02 |
| CF-70 | `@types/node` pinned to ^20 but runtime is Node 24 | DEP-03 |
| CF-71 | Inconsistent version pinning strategy | DEP-04 |
| CF-72 | `client_has_project_access()` SECURITY DEFINER unnecessary | AUTH-07 |
| CF-73 | `user_profiles` missing INSERT/UPDATE grant for authenticated users | SEC-M1 |
| CF-74 | Inconsistent skip patterns across database tests | T-MED-01 |
| CF-75 | SQL injection patterns in test helpers (string interpolation) | T-MED-06 |
| CF-76 | Duplicated detail-insert logic between `createNode` and `duplicateNode` | CQ-08 |
| CF-77 | Duplicated node-type dispatch logic in `attachDetails` and `getNode` | CQ-09 |
| CF-78 | Excessive `as` type assertions instead of proper narrowing | CQ-11 |
| CF-79 | Domain types `FrozenNode`, `TreeNode`, type guards unused | CQ-12 |
| CF-80 | Smoke test throws instead of skipping on missing env vars | T-HIGH-01 |
| CF-81 | Duplicate `set_updated_at()` definition across migrations | DB-MED-01 |
| CF-82 | `estimate_nodes.catalog_source_id` is a soft reference with no FK | DB-MED-02 |
| CF-83 | Server actions centralized in lib/actions/ vs co-locate-with-routes rule | ARCH-05 |
| CF-84 | No page demonstrates server-fetch-pass-as-props pattern | ARCH-08 |

---

### LOW (10)

| ID | Finding | Agents |
|----|---------|--------|
| CF-85 | `allowance_status` VARCHAR vs Zod enum value mismatch (`pending` vs `pending_selection`) | AI-09 |
| CF-86 | Empty `components/ui/` directory alongside `components/shared/` | ARCH-09 |
| CF-87 | Inconsistent variable naming (`v` for validated data across 28 actions) | CQ-13 |
| CF-88 | Split imports from same module across all 5 action files | CQ-14 |
| CF-89 | Trigger naming inconsistency (`set_` vs `trg_` vs `track_`) | DB-LOW-01 |
| CF-90 | History tables grow unboundedly -- no retention policy | PERF-09 |
| CF-91 | `pending-approval` page lacks dedicated error boundary | ERR-08 |
| CF-92 | Skip link targets outer `<main>` in protected routes | A11Y-L2 |
| CF-93 | Test ID numbering gaps | T-LOW-01 |
| CF-94 | Available minor/patch dependency updates | DEP-05 |

---

## 5. Agent Coverage Summary

| Agent | ID | Findings | CRITICAL | HIGH | MEDIUM | LOW | Key Focus Area |
|-------|----|----------|----------|------|--------|-----|----------------|
| Security Scanner | A1 | 9 | 2 | 4 | 3 | 0 | RLS bypass, SECURITY DEFINER, headers, UUID validation |
| Auth Auditor | A2 | 8 | 1 | 3 | 4 | 0 | Auth flows, role enforcement, RPC authorization |
| Type Checker | A3 | 9 | 0 | 3 | 5 | 1 | Discriminated unions, enum alignment, Zod type narrowing |
| Code Quality | A4 | 14 | 1 | 4 | 7 | 2 | Dead code, validation consistency, DRY violations |
| Test Reviewer | A5 | 12 | 1 | 4 | 5 | 2 | Broken tests, tautological asserts, coverage gaps |
| Arch Reviewer | A6 | 9 | 0 | 4 | 4 | 1 | Server/client boundary, file org, data flow |
| API Verifier | A7 | 9 | 0 | 4 | 4 | 0 | Action/RPC consistency, validation patterns, env drift |
| DB Inspector | A8 | 15 | 2 | 5 | 6 | 2 | Triggers, FK ordering, snapshot coverage, index gaps |
| Perf Analyzer | A9 | 9 | 0 | 3 | 4 | 2 | Row-by-row loops, redundant queries, client creation |
| Error Reviewer | A10 | 8 | 0 | 3 | 4 | 1 | Unhandled throws, silent failures, logging gaps |
| Dep Auditor | A11 | 6 | 0 | 2 | 2 | 2 | Phantom deps, CVEs, version pinning |
| Frontend/A11Y | A12 | 16 | 0 | 5 | 8 | 3 | WCAG violations, focus styles, landmark structure |
| AI Code Auditor | A13 | 9 | 0 | 3 | 4 | 2 | Hallucinated types, schema drift, dead code |
| **TOTALS** | | **119 raw / 73 deduped** | **6** | **27** | **30** | **10** | |

---

## Priority Remediation Order

1. **CF-01** -- Add `is_staff()` checks to all SECURITY DEFINER functions (blocks all auth bypass)
2. **CF-04-CRIT** -- Fix snapshot immutability trigger + admin delete interaction
3. **CF-05-CRIT** -- Unblock action tests by mocking `server-only` in vitest
4. **CF-02** -- Fix or remove the dead optimistic locking in `restoreSnapshot`
5. **CF-03-CRIT** -- Add EXCEPTION block to `restore_estimate_snapshot()`
6. **CF-10** -- Add `requireStaff()` helper for server action authorization
7. **CF-28** -- Add HSTS and CSP headers
8. **CF-17** -- Set `app.current_user_id` GUC in server actions for audit trail
9. **CF-04** -- Make `createNode`/`duplicateNode` atomic (RPC or transaction)
10. **CF-07** -- Standardize all actions to use Zod validation
