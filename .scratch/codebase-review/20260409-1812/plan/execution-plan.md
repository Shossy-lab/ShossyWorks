# Codebase Review Execution Plan

**Status:** PLAN ONLY -- awaiting user approval before execution
**Date:** 2026-04-09
**Input:** 73 deduplicated findings (6 CRITICAL, 27 HIGH, 30 MEDIUM, 10 LOW)
**Scope:** CRITICAL and HIGH findings addressed in full. MEDIUM findings listed for deferral.

---

## 1. Fix Priority Order

| # | Finding ID | Severity | Effort | Why This Order |
|---|-----------|----------|--------|----------------|
| 1 | CF-01 | CRITICAL | 1.5h | Auth bypass on ALL 5 SECURITY DEFINER RPCs -- any authenticated user can call the most sensitive business operations. Zero internal authorization checks. Blocks nothing; depends on nothing. |
| 2 | CF-04-CRIT | CRITICAL | 3h | Admin snapshot delete either always fails or bypasses all RLS. Trigger inconsistency between migrations 006/007 creates undefined behavior. |
| 3 | CF-03-CRIT | CRITICAL | 0.5h | EXCEPTION block missing from `restore_estimate_snapshot()` -- trigger bypass flag can leak on error. Must be done WITH the restore function rewrite. |
| 4 | CF-02 | CRITICAL | 2h | Optimistic locking is completely non-functional -- concurrent restore operations can overwrite each other. Combined with CF-03-CRIT since both modify same function. |
| 5 | CF-10 | HIGH | 2.5h | No role-based auth in ANY server action. Defense-in-depth layer after CF-01. Also fixes CF-22 (`"use server"` on `_shared.ts`). |
| 6 | CF-17 | HIGH | 1.5h | History audit trail `changed_by` always NULL. Depends on CF-10 (shares `_shared.ts` refactor). |
| 7 | CF-06 | HIGH | incl. in CF-04-CRIT | Admin delete snapshot bypass -- addressed as part of CF-04-CRIT immutability trigger fix. |
| 8 | CF-21 | HIGH | 1h | Double Supabase client creation per action. Depends on CF-10 (`_shared.ts` refactor). |
| 9 | CF-20 | HIGH | 0.25h | Known error codes not logged. Trivial fix during `_shared.ts` refactor. |
| 10 | CF-23 | HIGH | incl. in CF-04-CRIT | Unhandled throw from `createAdminClient()`. Addressed in the snapshot delete rewrite. |
| 11 | CF-05-CRIT | CRITICAL | 1h | `server-only` import barrier breaks all 58 action tests. Blocks test infrastructure. |
| 12 | CF-04 | HIGH | 4h (Option A) / 0.5h (Option B) | Non-atomic two-step insert in `createNode`/`duplicateNode`. Orphaned rows on partial failure. |
| 13 | CF-05 | HIGH | 0.5h | Silent zero-row updates in `updateItemDetails`/`updateAssemblyDetails`. |
| 14 | CF-15 | HIGH | 2.5h | `SnapshotData` TS type fully misaligned with SQL JSONB structure. |
| 15 | CF-25 | HIGH | 0.5h | `attachDetails` produces invalid discriminated union members (null cast). |
| 16 | CF-03 | HIGH | 0.5h | `duplicateNode` imports schema but never uses it. Interface mismatch. |
| 17 | CF-07 | HIGH | 2.5h | 13-15 actions use manual `if (!id)` instead of Zod UUID validation. |
| 18 | CF-27 | HIGH | 0.25h | `setNodeVisibility` accepts untyped string parameter. |
| 19 | CF-29 | HIGH | 3h | `restore_estimate_snapshot()` row-by-row loops. 10-50x slower than set-based. |
| 20 | CF-30 | HIGH | 2h | Redundant `getNode()` re-fetch after every mutation (8 locations). |
| 21 | CF-28 | HIGH | 0.5h | Missing HSTS and CSP security headers. |
| 22 | CF-34 | HIGH | 0.5h | Nested `<main>` landmarks -- WCAG violation. |
| 23 | CF-35 | HIGH | 0.25h | Sidebar nav links empty when collapsed -- WCAG violation. |
| 24 | CF-16 | HIGH | 1h | Auth pages are entire-page client components. |
| 25 | CF-36 | HIGH | 0.25h | Phantom dependency on `@t3-oss/env-core`. |
| 26 | CF-26 | HIGH | 1h | 5 of 9 SQL enum types missing from `enums.ts`. |
| 27 | CF-31 | HIGH | 2h | 173 database tests always skipped, no CI strategy. |
| 28 | CF-32 | HIGH | 1h | Authorization tests are tautological -- pass regardless. |
| 29 | CF-33 | HIGH | 0.5h | Tests silently swallow errors via try/catch. |

---

## 2. Dependency DAG

```
CF-01 (RPC auth guards)
  |
  v
CF-10 + CF-22 (_shared.ts refactor, requireStaff, server-only import)
  |
  +---> CF-17 (set_user_context GUC -- uses refactored _shared.ts)
  |
  +---> CF-21 (single Supabase client -- shares _shared.ts + get-user.ts)
  |
  +---> CF-20 (error logging -- same file)

CF-04-CRIT (immutability trigger) + CF-06 (admin delete) + CF-23 (unhandled throw)
  |  (all addressed in one snapshot delete rewrite)
  v
  (standalone -- no downstream deps)

CF-03-CRIT (EXCEPTION block) + CF-02 (optimistic locking)
  |  (both modify restore_estimate_snapshot -- must be one migration)
  v
CF-29 (set-based inserts in restore function -- same function rewrite)

CF-05-CRIT (server-only mock)
  |
  +---> CF-31 (DB test infrastructure)
  +---> CF-32 (rewrite tautological tests)
  +---> CF-33 (remove try/catch wrappers)

CF-04 (atomic node create) -- independent
CF-05 (zero-row update) -- independent
CF-15 (SnapshotData type) -- independent
CF-25 (attachDetails null cast) -- independent
CF-03 + CF-07 + CF-27 (validation standardization) -- independent cluster
CF-26 (enum completeness) -- independent
CF-28 (security headers) -- independent
CF-34 + CF-35 + CF-16 (frontend/a11y) -- independent cluster
CF-30 (redundant re-fetch) -- should follow CF-05 (zero-row fix adds .select().single())
CF-36 (phantom dep) -- independent
```

---

## 3. Execution Phases

### Phase A: Critical Security & Auth Fixes

**Goal:** Close all authorization bypass vectors and fix the snapshot immutability system.
**Agent count:** 2 agents (parallel, non-overlapping file ownership)
**Estimated effort:** 6 hours total

#### Agent A1: SQL Security Migrations

**Files owned:**
- `supabase/migrations/20260410000001_rpc_auth_guards.sql` (NEW)
- `supabase/migrations/20260410000002_snapshot_delete_rpc.sql` (NEW)
- `supabase/migrations/20260410000003_set_user_context.sql` (NEW)

**Changes:**
1. **CF-01:** CREATE OR REPLACE all 5 SECURITY DEFINER functions with `IF NOT public.is_staff() THEN RAISE EXCEPTION ...` as the first statement after `BEGIN`. Functions: `deep_copy_estimate`, `create_estimate_snapshot`, `restore_estimate_snapshot`, `create_estimate_from_snapshot`, `set_subtree_visibility`.
2. **CF-04-CRIT + CF-06 + CF-23:** Create `delete_milestone_snapshot(UUID, UUID)` SECURITY DEFINER RPC that handles immutability bypass internally. Restore controlled bypass (`app.allow_snapshot_delete`) in `prevent_snapshot_mutation()` trigger, limited to DELETE with the bypass variable set.
3. **CF-17:** Create `set_user_context(UUID)` RPC for setting `app.current_user_id` GUC used by history triggers.

**Verification script:**
```bash
#!/bin/bash
echo "=== Phase A1 Verification ==="
# Check auth guards exist in all 5 functions
count=$(grep -c "is_staff()" supabase/migrations/20260410000001_rpc_auth_guards.sql)
[ "$count" -ge 5 ] && echo "PASS: Auth guards in all RPC functions" || echo "FAIL: Expected 5+ is_staff() calls, got $count"

# Check snapshot delete RPC exists
grep -q "delete_milestone_snapshot" supabase/migrations/20260410000002_snapshot_delete_rpc.sql && echo "PASS: Snapshot delete RPC exists" || echo "FAIL: Missing snapshot delete RPC"

# Check bypass variable in trigger
grep -q "app.allow_snapshot_delete" supabase/migrations/20260410000002_snapshot_delete_rpc.sql && echo "PASS: Trigger bypass variable" || echo "FAIL: Missing trigger bypass"

# Check set_user_context RPC
grep -q "set_user_context" supabase/migrations/20260410000003_set_user_context.sql && echo "PASS: set_user_context RPC exists" || echo "FAIL: Missing set_user_context RPC"
```

#### Agent A2: Server Action Auth Layer

**Files owned:**
- `src/lib/auth/get-user.ts`
- `src/lib/actions/_shared.ts`
- `src/lib/actions/snapshots.ts` (deleteSnapshot function only)

**Changes:**
1. **CF-10 + CF-22:** Replace `"use server"` with `import "server-only"` in `_shared.ts`. Add `requireStaff()` to `get-user.ts`. Add `getStaffClient()` to `_shared.ts`. Convert mutation actions (create/update/delete) to use `getStaffClient()`.
2. **CF-21:** Refactor `getUser()` to export the Supabase client via `getAuthSession()` cache. Eliminate double client creation in `getAuthenticatedClient()`.
3. **CF-17 (TS side):** Call `set_user_context` RPC in `getAuthenticatedClient()` / `getStaffClient()`.
4. **CF-20:** Move `console.error` to the top of `handleSupabaseError()` so all error codes are logged.
5. **CF-04-CRIT (TS side):** Rewrite `deleteSnapshot` to use the new `delete_milestone_snapshot` RPC instead of admin client bypass. Add staff role check.

**Verification script:**
```bash
#!/bin/bash
echo "=== Phase A2 Verification ==="
# No "use server" in _shared.ts
grep -q '"use server"' src/lib/actions/_shared.ts && echo "FAIL: _shared.ts still has 'use server'" || echo "PASS: _shared.ts uses server-only"

# server-only import present
grep -q 'import "server-only"' src/lib/actions/_shared.ts && echo "PASS: server-only import" || echo "FAIL: Missing server-only import"

# requireStaff exists
grep -q "requireStaff" src/lib/auth/get-user.ts && echo "PASS: requireStaff exists" || echo "FAIL: Missing requireStaff"

# getStaffClient exists
grep -q "getStaffClient" src/lib/actions/_shared.ts && echo "PASS: getStaffClient exists" || echo "FAIL: Missing getStaffClient"

# handleSupabaseError logs first
head -5 <(grep -A5 "handleSupabaseError" src/lib/actions/_shared.ts) | grep -q "console.error" && echo "PASS: Error logging first" || echo "WARN: Check error logging position"

# deleteSnapshot uses RPC not admin client
grep -q "createAdminClient" src/lib/actions/snapshots.ts && echo "FAIL: Still using admin client" || echo "PASS: Admin client removed from snapshots"
```

**Commit message:** `fix(security): add auth guards to SECURITY DEFINER RPCs, role-based action authorization, audit trail`

---

### Phase B: Data Integrity & Transaction Safety

**Goal:** Fix optimistic locking, atomic operations, and type alignment.
**Agent count:** 2 agents (parallel, non-overlapping file ownership)
**Estimated effort:** 8 hours total
**Depends on:** Phase A (auth guards will be in the restored function)

#### Agent B1: SQL Function Fixes (restore + atomic node create)

**Files owned:**
- `supabase/migrations/20260410000004_restore_snapshot_fixes.sql` (NEW)
- `supabase/migrations/20260410000005_atomic_node_create.sql` (NEW)

**Changes:**
1. **CF-02 + CF-03-CRIT:** Full replacement of `restore_estimate_snapshot()` to add: `p_expected_version` parameter for optimistic locking, EXCEPTION block for `app.is_snapshot_copy` cleanup, `is_staff()` auth guard (from Phase A pattern).
2. **CF-04 (Option A):** Create `create_node_with_details(...)` SECURITY DEFINER RPC for atomic node creation with detail row in single transaction. Include auth guard.

**Verification script:**
```bash
#!/bin/bash
echo "=== Phase B1 Verification ==="
# Optimistic lock parameter exists
grep -q "p_expected_version" supabase/migrations/20260410000004_restore_snapshot_fixes.sql && echo "PASS: Optimistic lock parameter" || echo "FAIL: Missing p_expected_version"

# EXCEPTION block exists
grep -q "EXCEPTION WHEN OTHERS" supabase/migrations/20260410000004_restore_snapshot_fixes.sql && echo "PASS: EXCEPTION block" || echo "FAIL: Missing EXCEPTION block"

# RESET in exception
grep -q "RESET app.is_snapshot_copy" supabase/migrations/20260410000004_restore_snapshot_fixes.sql && echo "PASS: Bypass flag reset in EXCEPTION" || echo "FAIL: Missing RESET in EXCEPTION"

# Atomic node create exists
grep -q "create_node_with_details" supabase/migrations/20260410000005_atomic_node_create.sql && echo "PASS: Atomic node create RPC" || echo "FAIL: Missing create_node_with_details"
```

#### Agent B2: Server Action Data Fixes

**Files owned:**
- `src/lib/actions/snapshots.ts` (restoreSnapshot, createSnapshot)
- `src/lib/actions/nodes.ts` (createNode, duplicateNode, updateItemDetails, updateAssemblyDetails, attachDetails)
- `src/lib/validation/snapshots.ts`
- `src/lib/types/domain/snapshots.ts`

**Changes:**
1. **CF-02 (TS side):** Pass `estimateVersion` to RPC call in `restoreSnapshot`. Update error matching.
2. **CF-13:** Add `force` field to `restoreSnapshotSchema` and pass `p_force` to RPC.
3. **CF-04 (TS side):** Rewrite `createNode`/`duplicateNode` to call `create_node_with_details` RPC instead of two-step insert. Remove manual cleanup code.
4. **CF-05:** Add `.select().single()` to `updateItemDetails` and `updateAssemblyDetails`. Return proper error on zero-row update.
5. **CF-15 + CF-24:** Rewrite `SnapshotData` and all sub-record types to match actual SQL JSONB structure. Fix `SnapshotOptionGroupRecord` (remove `anchor_node_id`, add `group_type`, `sort_order`).
6. **CF-25:** Fix `attachDetails` to handle missing detail records without unsafe `as` cast. Return proper error or use a type guard.

**Verification script:**
```bash
#!/bin/bash
echo "=== Phase B2 Verification ==="
# estimateVersion passed to RPC
grep -q "p_expected_version" src/lib/actions/snapshots.ts && echo "PASS: Version passed to RPC" || echo "FAIL: Version not passed"

# force parameter in schema
grep -q "force" src/lib/validation/snapshots.ts && echo "PASS: force in schema" || echo "FAIL: Missing force parameter"

# No manual cleanup in createNode
grep -c "delete.*eq.*node.id" src/lib/actions/nodes.ts | (read count; [ "$count" -eq 0 ] && echo "PASS: No manual cleanup" || echo "WARN: Manual cleanup may still exist ($count occurrences)")

# .select().single() in updateItemDetails
grep -A3 "updateItemDetails" src/lib/actions/nodes.ts | grep -q "\.single()" && echo "PASS: single() in updateItemDetails" || echo "FAIL: Missing single()"

# SnapshotData has correct fields
grep -q "item_details.*ReadonlyArray" src/lib/types/domain/snapshots.ts && echo "PASS: SnapshotData restructured" || echo "FAIL: SnapshotData not fixed"

# No anchor_node_id
grep -q "anchor_node_id" src/lib/types/domain/snapshots.ts && echo "FAIL: anchor_node_id still present" || echo "PASS: anchor_node_id removed"
```

**Commit message:** `fix(data): implement optimistic locking, atomic node creation, fix SnapshotData type alignment`

---

### Phase C: Validation & Type Safety Cleanup

**Goal:** Standardize all actions to use Zod validation, fix enum alignment, clean up type safety issues.
**Agent count:** 2 agents (parallel)
**Estimated effort:** 5 hours total
**Depends on:** Phase B (node action signatures change)

#### Agent C1: Validation Standardization

**Files owned:**
- `src/lib/actions/projects.ts`
- `src/lib/actions/estimates.ts`
- `src/lib/actions/nodes.ts` (validation changes only -- coordinate with B2)
- `src/lib/actions/snapshots.ts` (validation changes only)
- `src/lib/validation/nodes.ts` (duplicateNodeSchema fix)
- `src/lib/validation/shared.ts` (zodEnumFromValues helper)

**Changes:**
1. **CF-03:** Fix `duplicateNode` to actually use `duplicateNodeSchema` (Option B: simplify schema to match action interface). Remove dead import.
2. **CF-07:** Convert 13-15 actions from `if (!id)` to Zod UUID validation. Use inline `uuidSchema.safeParse(id)` for simple ID-only functions, or use existing schemas where they exist.
3. **CF-27:** Add proper Zod validation to `setNodeVisibility` using `clientVisibilitySchema`.
4. **CF-54:** Create `zodEnumFromValues<T>()` helper in `shared.ts`. Replace all `as unknown as [string, ...string[]]` double-casts. Remove downstream `as` casts that were needed because of erased literal types.

**Verification script:**
```bash
#!/bin/bash
echo "=== Phase C1 Verification ==="
# No manual if (!id) checks remain
count=$(grep -rn 'if (!id)' src/lib/actions/ | wc -l)
[ "$count" -eq 0 ] && echo "PASS: No manual !id checks" || echo "FAIL: $count manual !id checks remain"

# No unused schema imports
grep -q "duplicateNodeSchema" src/lib/actions/nodes.ts && grep -A5 "duplicateNodeSchema" src/lib/actions/nodes.ts | grep -q "safeParse" && echo "PASS: duplicateNodeSchema used" || echo "FAIL: duplicateNodeSchema still unused"

# zodEnumFromValues helper exists
grep -q "zodEnumFromValues" src/lib/validation/shared.ts && echo "PASS: zodEnumFromValues helper" || echo "FAIL: Missing helper"

# No double-cast pattern
grep -c "as unknown as \[string" src/lib/validation/shared.ts | (read count; [ "$count" -eq 0 ] && echo "PASS: No double-cast" || echo "FAIL: $count double-casts remain")
```

#### Agent C2: Enum Completeness & Type Cleanup

**Files owned:**
- `src/lib/types/enums.ts`
- `src/lib/types/domain/snapshots.ts` (only if not already modified by B2 -- coordinate)

**Changes:**
1. **CF-26:** Add 5 missing enum types to `enums.ts`: `snapshot_type`, `option_group_type`, `approval_status`, `author_type`, `app_role`. Follow existing pattern (const object + type + values array).
2. **CF-19 (partial):** Update `shared.ts` enum schemas to derive from centralized `enums.ts` values instead of inline definitions.

**Verification script:**
```bash
#!/bin/bash
echo "=== Phase C2 Verification ==="
# All 9 enum types present
for enum in PROJECT_STATUS ESTIMATE_STATUS NODE_TYPE CLIENT_VISIBILITY SNAPSHOT_TYPE OPTION_GROUP_TYPE APPROVAL_STATUS AUTHOR_TYPE APP_ROLE; do
  grep -q "$enum" src/lib/types/enums.ts && echo "PASS: $enum exists" || echo "FAIL: $enum missing"
done
```

**Commit message:** `fix(validation): standardize Zod validation across all actions, complete enum alignment`

---

### Phase D: Performance & Error Handling

**Goal:** Eliminate redundant queries, rewrite row-by-row loops, fix error handling gaps.
**Agent count:** 2 agents (parallel)
**Estimated effort:** 6 hours total
**Depends on:** Phase B (node action structure), Phase C (validation changes)

#### Agent D1: SQL Performance (restore function rewrite)

**Files owned:**
- `supabase/migrations/20260410000004_restore_snapshot_fixes.sql` (EXTEND -- add set-based inserts)

**Changes:**
1. **CF-29:** Replace all 12 FOR LOOPs in `restore_estimate_snapshot()` with set-based `INSERT ... SELECT FROM jsonb_array_elements()`. This is combined with the Phase B migration since both modify the same function. NOTE: If Phase B already replaced the function, this is folded into that migration.

**Verification script:**
```bash
#!/bin/bash
echo "=== Phase D1 Verification ==="
# No FOR LOOP remaining in restore function
count=$(grep -c "FOR v_rec IN" supabase/migrations/20260410000004_restore_snapshot_fixes.sql)
[ "$count" -eq 0 ] && echo "PASS: No row-by-row loops" || echo "FAIL: $count FOR loops remain"

# jsonb_array_elements used
grep -q "jsonb_array_elements" supabase/migrations/20260410000004_restore_snapshot_fixes.sql && echo "PASS: Set-based inserts" || echo "FAIL: Missing jsonb_array_elements"
```

#### Agent D2: Action Performance & Error Handling

**Files owned:**
- `src/lib/actions/nodes.ts` (refetch elimination)
- `src/lib/actions/snapshots.ts` (createSnapshot return type)
- `src/app/global-error.tsx`
- `src/app/error.tsx`
- `src/app/(protected)/error.tsx`
- `src/app/(auth)/error.tsx`
- `next.config.ts`

**Changes:**
1. **CF-30:** Eliminate redundant `getNode()` re-fetch at 8 locations in `nodes.ts`. Add `.select().single()` to mutations that lack it. Create `attachSingleNodeDetails()` helper for efficient single-node detail fetching.
2. **CF-28:** Add HSTS and CSP security headers to `next.config.ts`.
3. **CF-50 (MEDIUM, included for marginal cost):** Add `useEffect` error logging to all 3 error boundaries.

**Verification script:**
```bash
#!/bin/bash
echo "=== Phase D2 Verification ==="
# Reduced getNode calls (should be <= 2 -- only in getNode itself and getNodes)
count=$(grep -c "getNode(" src/lib/actions/nodes.ts)
[ "$count" -le 3 ] && echo "PASS: getNode calls reduced to $count" || echo "FAIL: Still $count getNode calls"

# HSTS header exists
grep -q "Strict-Transport-Security" next.config.ts && echo "PASS: HSTS header" || echo "FAIL: Missing HSTS"

# CSP header exists
grep -q "Content-Security-Policy" next.config.ts && echo "PASS: CSP header" || echo "FAIL: Missing CSP"

# Error boundaries log
for f in src/app/error.tsx src/app/\(protected\)/error.tsx; do
  grep -q "console.error" "$f" && echo "PASS: Error logging in $f" || echo "FAIL: No logging in $f"
done
```

**Commit message:** `perf(queries): eliminate redundant re-fetches, set-based snapshot restore, add security headers`

---

### Phase E: Testing Infrastructure & Frontend Fixes

**Goal:** Unblock test execution, fix tautological tests, resolve WCAG violations.
**Agent count:** 2 agents (parallel)
**Estimated effort:** 5 hours total
**Depends on:** Phase A (auth changes affect test expectations)

#### Agent E1: Test Infrastructure

**Files owned:**
- `vitest.config.ts`
- `tests/helpers/server-only-mock.ts` (NEW)
- `tests/setup.ts`
- `tests/actions/projects.test.ts`
- `tests/actions/nodes.test.ts`
- `tests/actions/snapshots.test.ts`
- `tests/smoke/supabase.test.ts`
- `supabase/migrations/20260409000099_test_helpers.sql` (NEW -- `run_sql` RPC)

**Changes:**
1. **CF-05-CRIT:** Create empty `tests/helpers/server-only-mock.ts`. Add Vitest alias for `server-only` module. Add mocks for `next/headers` and `next/navigation` in `tests/setup.ts`. Remove duplicate `resolve.alias` block.
2. **CF-31:** Create `run_sql` migration for test environments. Add `test:ci:full` and `test:ci:db` scripts to `package.json`.
3. **CF-32:** Rewrite tautological authorization tests to actually verify role-based access denial (Option B: mark as `it.todo()` until proper mocking exists).
4. **CF-33:** Remove all try/catch wrappers that silently swallow errors. Replace with proper test assertions.
5. **CF-80 (MEDIUM, included):** Fix smoke test to use `skipIf` instead of throwing.

**Verification script:**
```bash
#!/bin/bash
echo "=== Phase E1 Verification ==="
# server-only mock exists
[ -f tests/helpers/server-only-mock.ts ] && echo "PASS: server-only mock" || echo "FAIL: Missing mock file"

# Vitest alias configured
grep -q "server-only" vitest.config.ts && echo "PASS: Vitest alias" || echo "FAIL: Missing Vitest alias"

# next/headers mock in setup
grep -q "next/headers" tests/setup.ts && echo "PASS: next/headers mock" || echo "FAIL: Missing next/headers mock"

# No tautological test patterns
grep -c "still valid" tests/actions/projects.test.ts | (read count; [ "$count" -eq 0 ] && echo "PASS: No tautological tests" || echo "FAIL: $count tautological patterns remain")

# No silent catch blocks
count=$(grep -c "catch.*not implemented" tests/actions/snapshots.test.ts tests/actions/nodes.test.ts 2>/dev/null)
[ "$count" -eq 0 ] && echo "PASS: No silent catch blocks" || echo "FAIL: $count silent catch blocks remain"

# run_sql migration exists
[ -f supabase/migrations/20260409000099_test_helpers.sql ] && echo "PASS: run_sql migration" || echo "FAIL: Missing run_sql migration"

# Smoke test uses skipIf
grep -q "skipIf" tests/smoke/supabase.test.ts && echo "PASS: Smoke test skipIf" || echo "FAIL: Smoke test still throws"
```

#### Agent E2: Frontend & Accessibility

**Files owned:**
- `src/app/layout.tsx`
- `src/app/(protected)/layout.tsx`
- `src/app/(auth)/sign-in/page.tsx`
- `src/app/(auth)/sign-in/sign-in-form.tsx` (NEW)
- `src/app/(auth)/sign-up/page.tsx`
- `src/app/(auth)/sign-up/sign-up-form.tsx` (NEW)
- `src/components/nav/sidebar.tsx`
- `src/app/(protected)/loading.tsx`
- `src/app/globals.css` (focus-visible token only)
- `package.json` (phantom dep fix)

**Changes:**
1. **CF-34:** Replace `<main>` in root layout with `<div id="main-content">`. Move `id="main-content"` to protected layout's `<main>`.
2. **CF-35:** Add `aria-label` to collapsed sidebar links. Add `aria-current="page"` for active links. Add `aria-label` to `<aside>` and `<nav>` elements.
3. **CF-16:** Split `sign-in/page.tsx` and `sign-up/page.tsx` into server page + client form component. Remove `"use client"` from page files.
4. **CF-36:** Add `@t3-oss/env-core` as explicit dependency in `package.json`.
5. **CF-63 (MEDIUM, included):** Add global `:focus-visible` rule to `globals.css` using `--color-border-focus` token.
6. **CF-65 (MEDIUM, included):** Add `role="status"` and `aria-live="polite"` to loading component.
7. **CF-67 (MEDIUM, included):** Change layout brand text from `<h2>` to `<span>`.
8. **CF-68 (MEDIUM, included):** Add `aria-label` to sidebar `<aside>` and `<nav>`.

**Verification script:**
```bash
#!/bin/bash
echo "=== Phase E2 Verification ==="
# No nested main
grep -c "<main" src/app/layout.tsx | (read count; [ "$count" -eq 0 ] && echo "PASS: No <main> in root layout" || echo "FAIL: Root layout still has <main>")

# Protected layout has main with id
grep -q 'id="main-content"' src/app/\(protected\)/layout.tsx && echo "PASS: main-content id in protected layout" || echo "FAIL: Missing main-content id"

# Sidebar aria-label
grep -q "aria-label" src/components/nav/sidebar.tsx && echo "PASS: Sidebar aria-label" || echo "FAIL: Missing sidebar aria-label"

# Sign-in form split
[ -f src/app/\(auth\)/sign-in/sign-in-form.tsx ] && echo "PASS: sign-in-form.tsx exists" || echo "FAIL: Missing sign-in-form.tsx"

# No "use client" in sign-in page
grep -q '"use client"' src/app/\(auth\)/sign-in/page.tsx && echo "FAIL: page.tsx still client component" || echo "PASS: page.tsx is server component"

# focus-visible in globals
grep -q "focus-visible" src/app/globals.css && echo "PASS: focus-visible styles" || echo "FAIL: Missing focus-visible"

# @t3-oss/env-core in package.json
grep -q "@t3-oss/env-core" package.json && echo "PASS: env-core dependency" || echo "FAIL: Missing env-core dependency"
```

**Commit message:** `fix(a11y,frontend): resolve WCAG violations, split auth pages, add focus-visible styles`

---

## 4. Conflict Matrix

Files modified in multiple phases require careful coordination:

| File | Phase A | Phase B | Phase C | Phase D | Phase E | Resolution |
|------|---------|---------|---------|---------|---------|------------|
| `src/lib/actions/nodes.ts` | - | B2 (create/duplicate/update rewrite) | C1 (validation) | D2 (refetch elimination) | - | B2 goes first (structural changes). C1 adds validation to the new structure. D2 eliminates refetches in the final structure. **Sequential within file.** |
| `src/lib/actions/snapshots.ts` | A2 (deleteSnapshot) | B2 (restoreSnapshot) | C1 (validation IDs) | - | - | A2 touches deleteSnapshot. B2 touches restoreSnapshot. C1 adds UUID validation. **Non-overlapping functions -- safe.** |
| `src/lib/actions/_shared.ts` | A2 (full refactor) | - | - | - | - | **Phase A owns entirely.** Later phases use the new API. |
| `src/lib/auth/get-user.ts` | A2 (requireStaff + getAuthSession) | - | - | - | - | **Phase A owns entirely.** |
| `restore_estimate_snapshot()` (SQL) | A1 (auth guard) | B1 (optimistic lock + EXCEPTION) | - | D1 (set-based inserts) | - | **All changes go in one migration** (20260410000004). Agent B1 writes the full replacement with auth guard, optimistic lock, EXCEPTION block, AND set-based inserts. Combine B1+D1 scope. |
| `src/lib/validation/shared.ts` | - | - | C1 (zodEnumFromValues) | - | - | **Single owner.** |
| `src/lib/types/domain/snapshots.ts` | - | B2 (SnapshotData rewrite) | C2 (if needed) | - | - | **B2 owns the rewrite.** C2 skips this file if B2 already handles it. |
| `vitest.config.ts` | - | - | - | - | E1 | **Single owner.** |
| `next.config.ts` | - | - | - | D2 (headers) | - | **Single owner.** |
| `package.json` | - | - | - | - | E2 (dep fix) | **Single owner.** |
| `src/app/globals.css` | - | - | - | - | E2 (focus-visible) | **Single owner.** |

**Key coordination rule:** `nodes.ts` is the most contested file. Changes must be applied in order: B2 (structural) -> C1 (validation) -> D2 (performance). These phases are sequential for this file.

---

## 5. Findings NOT Addressed (Deferred)

### MEDIUM Findings -- Deferred to Future Sessions

| ID | Finding | Justification |
|----|---------|---------------|
| CF-08 | Dead imports (`notFound` in 3 files, unused Zod schemas) | Low risk. Will be partially fixed by CF-07 (using the schemas). Remaining dead imports are cosmetic. |
| CF-09 | `nodes.ts` at 623 lines exceeds 300-line limit | Refactoring while making structural changes (B2, C1, D2) risks merge conflicts. Do after all phases complete. |
| CF-11 | `set_updated_at()` missing SECURITY DEFINER and SET search_path | CVE-2018-1058 requires a malicious schema in the search path. Low risk in this environment. Address in a security hardening pass. |
| CF-12 | Snapshot immutability trigger inconsistency (006 vs 007) | Addressed indirectly by CF-04-CRIT (trigger is rewritten). The migration ordering risk is deployment-time only and migrations are atomic. |
| CF-13 | `restoreSnapshot` missing `p_force` | Addressed in Phase B (B2). |
| CF-14 | Unused Zod enum imports in nodes.ts | Cosmetic. Will be partially resolved by CF-03/CF-07 fixes. |
| CF-18 | 20+ unused schemas/types | Dead code cleanup. Low risk. Schedule as a separate cleanup task. |
| CF-19 | Duplicate enum definitions across 3 layers | Partially addressed by CF-26 (enum completeness) and CF-54 (zodEnumFromValues). Full drift guard requires generated types. |
| CF-37 | `env.ts` has vars not in `pull-env.sh` | Operational, not a code bug. Document and address separately. |
| CF-38 | Missing `phase_id` column on `estimate_nodes` | Feature addition, not a bug. Requires schema discussion. |
| CF-39 | Snapshot serialization missing estimate-level metadata | Feature gap, not a bug. Requires product decision. |
| CF-40 | `deep_copy_estimate()` does not copy comments | Feature gap. Requires product decision on comment duplication semantics. |
| CF-41 | History tables deny ALL to authenticated | Intentional security restriction. Needs separate staff read path design. |
| CF-42-CF-44 | Seed data idempotency, snapshot total_price, missing index | Low priority. Address in a DB optimization pass. |
| CF-45-CF-49 | INSERT policy, JWT staleness, sign-up redirect, error map, note duplication | Various medium-priority issues. None are security-critical after Phase A fixes. |
| CF-51 | `createSnapshot` fetches full JSONB blob | Performance. Address in Phase D if time permits. |
| CF-52-CF-53 | Missing index, middleware optimization | Performance tuning. Non-critical. |
| CF-55-CF-58 | Type safety: enum string types, no runtime validation, tsconfig flags, coverage thresholds | Type hardening. Schedule as incremental improvements. |
| CF-59-CF-61 | Unit tests for pure logic, RLS test accuracy, test data cleanup | Test quality improvements. Non-blocking. |
| CF-62-CF-66 | Various accessibility MEDIUM items | Addressed where marginal cost is low (CF-63, CF-65, CF-67, CF-68 bundled into Phase E). Remaining items deferred. |
| CF-69-CF-94 | LOW findings: dev CVEs, version pinning, naming, trigger naming, history retention, etc. | All low risk. Address opportunistically. |

### Findings Resolved by Other Fixes

| ID | Resolution |
|----|-----------|
| CF-06 | Resolved by CF-04-CRIT (snapshot delete rewrite) |
| CF-22 | Resolved by CF-10 (`_shared.ts` refactor) |
| CF-23 | Resolved by CF-04-CRIT (deleteSnapshot rewrite) |
| CF-24 | Resolved by CF-15 (SnapshotData type rewrite) |
| CF-13 | Resolved by CF-02 (restore snapshot fix) |

---

## 6. Execution Summary

| Phase | Scope | Agents | Est. Hours | Findings Resolved | Key Deliverable |
|-------|-------|--------|-----------|-------------------|----------------|
| **A** | Critical Security & Auth | 2 | 6h | CF-01, CF-04-CRIT, CF-06, CF-10, CF-17, CF-20, CF-21, CF-22, CF-23 (9) | All auth bypass vectors closed. Audit trail functional. |
| **B** | Data Integrity & Transactions | 2 | 8h | CF-02, CF-03-CRIT, CF-04, CF-05, CF-13, CF-15, CF-24, CF-25 (8) | Optimistic locking works. Atomic node creation. Types match SQL. |
| **C** | Validation & Type Safety | 2 | 5h | CF-03, CF-07, CF-26, CF-27, CF-54 (5) | All actions use Zod validation. Enum alignment. |
| **D** | Performance & Error Handling | 2 | 6h | CF-28, CF-29, CF-30, CF-50 (4) | Set-based restore. No redundant queries. Security headers. |
| **E** | Testing & Frontend | 2 | 5h | CF-05-CRIT, CF-16, CF-31, CF-32, CF-33, CF-34, CF-35, CF-36, CF-63, CF-65, CF-67, CF-68, CF-80 (13) | Tests unblocked. WCAG violations fixed. |
| **TOTAL** | | 10 agents | ~30h | **39 findings** (all 6 CRITICAL, 24 HIGH, 9 MEDIUM bundled) | |

**Deferred:** 34 findings (21 MEDIUM, 3 LOW remaining, 10 LOW deferred entirely)

### Execution Order

```
Phase A  ───>  Phase B  ───>  Phase C  ───>  Phase D
                                                |
Phase E (can run parallel to B/C/D, but A must complete first for auth changes)
```

Phase E can start as soon as Phase A completes. Phases B, C, D are sequential due to `nodes.ts` conflicts. Phase D's SQL work (restore function) is folded into Phase B's migration to avoid rewriting the same function twice.

**Revised practical phasing:**
- Phase A: standalone, first priority
- Phase B+D1: combined (restore function rewrite includes both fixes)
- Phase C: after B completes for `nodes.ts`
- Phase D2: after C completes for `nodes.ts`
- Phase E: parallel to B/C/D (no file conflicts after Phase A)

---

**AWAITING USER APPROVAL. No code changes will be made until this plan is reviewed and approved.**
