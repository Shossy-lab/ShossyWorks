# Security Scanner Findings

**Reviewer:** Security Scanner (A1)
**Date:** 2026-04-09
**Scope:** Hardcoded secrets, open redirects, injection risks, insecure configurations, RLS policy correctness, SECURITY DEFINER function authorization, server action auth/validation gaps

---

## CRITICAL

### SEC-C1: SECURITY DEFINER RPC Functions Lack Internal Authorization Checks

**Severity:** CRITICAL
**Files:**
- `supabase/migrations/20260409000011_functions.sql:100-497` (`deep_copy_estimate`)
- `supabase/migrations/20260409000011_functions.sql:514-815` (`create_estimate_snapshot`)
- `supabase/migrations/20260409000011_functions.sql:825-1239` (`restore_estimate_snapshot`)
- `supabase/migrations/20260409000011_functions.sql:1249-1648` (`create_estimate_from_snapshot`)
- `supabase/migrations/20260409000011_functions.sql:49-87` (`set_subtree_visibility`)

**Evidence:** All five heavy-lifting RPC functions are declared `SECURITY DEFINER`, which means they execute as the function owner (postgres superuser), completely bypassing RLS. None of these functions contain any internal authorization check (e.g., verifying `is_staff()` or `get_user_role()` within the function body). They are all granted `EXECUTE` to `authenticated`:

```sql
GRANT EXECUTE ON FUNCTION public.deep_copy_estimate(UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_estimate_snapshot(...) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_estimate_snapshot(...) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_estimate_from_snapshot(...) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_subtree_visibility(...) TO authenticated;
```

**Impact:** Any authenticated user -- including `client` and `pending` role users -- can call these functions directly via the Supabase client. A client-role user could:
1. Deep-copy any estimate in the system (data exfiltration)
2. Create snapshots of any estimate (read all pricing data)
3. Restore snapshots over any estimate (data destruction)
4. Change visibility on any node subtree (bypass client visibility controls)

The server actions correctly gate behind `getAuthenticatedClient()` + `requireUser()`, but these RPC functions are directly callable from the client-side Supabase JS SDK. The `GRANT ... TO authenticated` without an internal `is_staff()` check inside the `SECURITY DEFINER` function body is the vulnerability.

**Fix:** Add authorization checks at the top of each function body:
```sql
IF NOT public.is_staff() THEN
  RAISE EXCEPTION 'Permission denied: staff role required';
END IF;
```
Or restrict the GRANT to a custom DB role mapped to staff users only.

---

### SEC-C2: Admin Client Snapshot Delete Bypasses Immutability with Insufficient Guards

**Severity:** CRITICAL
**File:** `src/lib/actions/snapshots.ts:197-241`

**Evidence:** The `deleteSnapshot` function uses `createAdminClient()` (service_role key) to bypass the snapshot immutability trigger:

```typescript
// Line 229-233
const admin = createAdminClient();
const { error: deleteError } = await admin
  .from("estimate_snapshots")
  .delete()
  .eq("id", id);
```

The function checks `snapshot_type !== "milestone"` and `snapshot.created_by !== user.id`, but these checks are performed via the regular authenticated supabase client. The critical issue: the admin client bypass bypasses ALL RLS policies and the immutability trigger. If there is any TOCTOU (time-of-check-time-of-use) race between the permission check (regular client) and the delete (admin client), the guards could be circumvented.

Additionally, the immutability trigger in migration 007 (`trg_prevent_snapshot_mutation`, lines 264-282) was updated to remove the bypass mechanism entirely (`RAISE EXCEPTION 'Snapshots are immutable'` with no conditional). This means the admin client delete relies on `service_role` bypassing triggers -- but Supabase service_role does NOT bypass PostgreSQL triggers, only RLS. The delete via admin client will **always fail** with "Snapshots are immutable" because the trigger fires unconditionally.

**Impact:** Either (a) `deleteSnapshot` silently fails for all callers (the trigger blocks it), making the feature broken, or (b) if there is an older trigger version still active (migration ordering issue), the admin bypass could delete any snapshot regardless of type/ownership.

**Fix:** The snapshot immutability trigger needs a controlled bypass mechanism for admin-initiated milestone deletions. Options:
1. Re-add `current_setting('app.allow_snapshot_mutation', true)` check to the trigger, and have the server action set it via `SET LOCAL` before deleting
2. Use a separate database function with `SECURITY DEFINER` that includes authorization checks internally

---

## HIGH

### SEC-H1: Missing UUID Validation on Direct ID Parameters in Multiple Server Actions

**Severity:** HIGH
**Files:**
- `src/lib/actions/projects.ts:85-101` (`getProject` -- `id: string` with only `!id` check)
- `src/lib/actions/projects.ts:155-173` (`deleteProject` -- same)
- `src/lib/actions/nodes.ts:210-266` (`getNode` -- same)
- `src/lib/actions/nodes.ts:430-448` (`deleteNode` -- same)
- `src/lib/actions/nodes.ts:452-561` (`duplicateNode` -- `nodeId` with only `!nodeId` check)
- `src/lib/actions/nodes.ts:566-583` (`flagNode` -- same)
- `src/lib/actions/nodes.ts:588-623` (`setNodeVisibility` -- same)
- `src/lib/actions/nodes.ts:166-206` (`getNodes` -- `estimateId` with only `!estimateId` check)
- `src/lib/actions/snapshots.ts:81-100` (`listSnapshots` -- `estimateId` with only `!estimateId` check)
- `src/lib/actions/snapshots.ts:104-121` (`getSnapshot` -- same)
- `src/lib/actions/snapshots.ts:197-241` (`deleteSnapshot` -- same)
- `src/lib/actions/estimates.ts:170-191` (`duplicateEstimate` -- `id` with only `!id` check)
- `src/lib/actions/estimates.ts:195-213` (`deleteEstimate` -- same)

**Evidence:** These server actions accept `id: string` parameters and only validate with `if (!id)`. They do NOT use Zod UUID validation before passing the value into Supabase `.eq()` queries. Compare with `getEstimate` (line 93-115) and `updateEstimate` (line 119-166) which correctly use `getEstimateSchema.safeParse()` and `updateEstimateSchema.safeParse()` with UUID validation.

**Impact:** While Supabase/PostgREST will reject malformed UUIDs at the database layer (returning an error rather than executing arbitrary SQL), the inconsistency means:
1. Error messages leak database details (PostgREST error format instead of clean validation errors)
2. The pattern is inconsistent -- some actions validate IDs, others don't -- creating maintenance risk
3. Any future refactor that changes the query pattern could introduce injection if the ID is used in a string-interpolated context

**Fix:** Add UUID validation via `z.string().uuid()` at the top of every action that accepts an ID parameter directly. The project already has `uuidSchema` in `src/lib/validation/shared.ts:18`.

---

### SEC-H2: History Audit Trail `changed_by` Always NULL -- No User Context Set

**Severity:** HIGH
**Files:**
- `supabase/migrations/20260409000008_history_tables.sql:14,176,222,297,357`
- All server action files in `src/lib/actions/` (none set `app.current_user_id`)

**Evidence:** The history trigger functions use `NULLIF(current_setting('app.current_user_id', true), '')::uuid` to capture who made a change (lines 176, 222, 297, 357 of the history migration). The design comment on line 14 states:

```
-- changed_by uses current_setting('app.current_user_id') set by server actions
```

However, a search across ALL TypeScript files reveals **zero** references to `app.current_user_id`. No server action calls `SET LOCAL app.current_user_id = ...` or uses Supabase's `set_config` to provide this value before executing mutations.

**Impact:** Every history record in `estimate_nodes_history` and `node_item_details_history` will have `changed_by = NULL`, making the audit trail useless for accountability. You cannot determine who made any change, only that a change occurred.

**Fix:** In `_shared.ts` or each mutation action, set the user context before executing mutations:
```typescript
await supabase.rpc('set_config', { setting: 'app.current_user_id', value: user.id });
```
Or create a wrapper that sets this GUC via a raw SQL call before each mutation.

---

### SEC-H3: Missing HSTS and CSP Security Headers

**Severity:** HIGH
**File:** `next.config.ts:8-24`

**Evidence:** The security headers configuration includes:
- X-Frame-Options: DENY (good)
- X-Content-Type-Options: nosniff (good)
- Referrer-Policy: strict-origin-when-cross-origin (good)
- Permissions-Policy (good)
- poweredByHeader: false (good)

**Missing:**
- `Strict-Transport-Security` (HSTS) -- Without this, the app is vulnerable to SSL stripping attacks. Users could be downgraded to HTTP by a MITM attacker on their first visit.
- `Content-Security-Policy` (CSP) -- Without CSP, the app has no defense-in-depth against XSS. If any XSS vulnerability is discovered (e.g., through a future rich-text rendering feature), there is no CSP to limit the damage.

**Impact:** SSL stripping attacks are feasible without HSTS. XSS impact is maximized without CSP. Both are required for production deployment of a financial application (construction estimates contain sensitive pricing data).

**Fix:** Add to the headers array:
```typescript
{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
{ key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://*.supabase.co wss://*.supabase.co;" },
```

---

### SEC-H4: `restoreSnapshot` Ignores Validated `estimateVersion` -- No Optimistic Lock Enforced

**Severity:** HIGH
**Files:**
- `src/lib/actions/snapshots.ts:125-163`
- `src/lib/validation/snapshots.ts:23-26`

**Evidence:** The `restoreSnapshotSchema` validates an `estimateVersion` field:
```typescript
export const restoreSnapshotSchema = z.object({
  snapshotId: uuidSchema,
  estimateVersion: z.number().int().min(1, "Estimate version is required for optimistic locking."),
});
```

But the `restoreSnapshot` action (line 142-148) never passes `estimateVersion` to the RPC:
```typescript
const { data: checkpointId, error } = await supabase.rpc(
  "restore_estimate_snapshot",
  {
    p_snapshot_id: v.snapshotId,
    p_restored_by: user.id,
  },
);
```

The validated `v.estimateVersion` is collected from the user but completely discarded. The RPC function `restore_estimate_snapshot` also has no `p_expected_version` parameter.

**Impact:** The optimistic locking claim is false. Two users could simultaneously restore different snapshots over the same estimate, with the last write winning silently. This could cause data loss in a multi-user editing scenario.

**Fix:** Either:
1. Add `p_expected_version` parameter to the RPC and check it before proceeding
2. Or add a version check in the server action before calling the RPC (fetch current version, compare, reject if mismatched)

---

## MEDIUM

### SEC-M1: `user_profiles` Missing INSERT Grant for Authenticated Users -- Profile Creation May Fail

**Severity:** MEDIUM
**File:** `supabase/migrations/20260409000001_security_foundation.sql:210-216`

**Evidence:** The grants on `user_profiles` are:
```sql
REVOKE ALL ON TABLE public.user_profiles FROM authenticated, anon, public;
GRANT SELECT ON TABLE public.user_profiles TO authenticated;
```

Only `SELECT` is granted to `authenticated`. The `handle_new_user()` trigger runs as `SECURITY DEFINER` (postgres) so it can INSERT. But if any server action needs to INSERT or UPDATE `user_profiles` (e.g., user self-service profile updates in Phase 1B), it will fail because there is no INSERT/UPDATE grant to `authenticated`.

The RLS policy "Owner can manage all profiles" uses `FOR ALL` which covers INSERT/UPDATE/DELETE, but without the table-level `GRANT INSERT, UPDATE` to `authenticated`, even the owner cannot modify profiles through the Supabase client.

**Impact:** Profile management features will fail silently or with cryptic permission errors when implemented. The owner role cannot update user roles through the API despite having an RLS policy granting it.

**Fix:** Add:
```sql
GRANT INSERT, UPDATE ON TABLE public.user_profiles TO authenticated;
```
RLS policies will still control which rows each role can access.

---

### SEC-M2: Snapshot Immutability Trigger Inconsistency Between Migrations

**Severity:** MEDIUM
**Files:**
- `supabase/migrations/20260409000006_client_sharing_tables.sql:130-148` (first definition with bypass)
- `supabase/migrations/20260409000007_triggers.sql:264-282` (second definition without bypass)

**Evidence:** The `prevent_snapshot_mutation()` function is defined twice:

**Migration 006** (first definition):
```sql
IF current_setting('app.allow_snapshot_mutation', true) = 'true' THEN
  RETURN COALESCE(NEW, OLD);
END IF;
RAISE EXCEPTION 'Snapshots are immutable. Cannot % estimate_snapshots.', TG_OP;
```

**Migration 007** (replacement):
```sql
RAISE EXCEPTION 'Snapshots are immutable';
```

Migration 007 uses `CREATE OR REPLACE` and drops/recreates the trigger, so the final state is the bypass-free version. But RLS tests at `tests/database/rls.test.ts:1329,1382,1893,1900` still reference `set_config('app.allow_snapshot_mutation', 'true', true)`, suggesting some code paths expect the bypass to work. Combined with SEC-C2, this creates confusion about whether snapshot deletion is intended to work at all.

---

### SEC-M3: `set_updated_at()` Trigger Function Missing `SECURITY DEFINER` and `SET search_path`

**Severity:** MEDIUM
**File:** `supabase/migrations/20260409000003_reference_and_core_tables.sql:20-28`

**Evidence:**
```sql
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
```

This function lacks `SECURITY DEFINER SET search_path = ''` which all other trigger functions in the codebase include. While the risk for this specific function is low (it only sets `now()`), it is inconsistent with the project's security hardening pattern, and is vulnerable to the search_path injection attack (CVE-2018-1058) that the security foundation migration explicitly documents as a concern.

**Fix:** Add `SECURITY DEFINER SET search_path = ''` for consistency and defense-in-depth.

---

## Summary

| Severity | Count | Key Themes |
|----------|-------|------------|
| CRITICAL | 2 | RPC functions callable by any authenticated user (bypass RLS via SECURITY DEFINER), admin client delete conflicts with immutability trigger |
| HIGH | 4 | Missing UUID validation on 13+ action entry points, audit trail always NULL, missing HSTS/CSP, dead optimistic lock code |
| MEDIUM | 3 | Missing grants for profile updates, trigger function inconsistency, search_path hardening gap |
