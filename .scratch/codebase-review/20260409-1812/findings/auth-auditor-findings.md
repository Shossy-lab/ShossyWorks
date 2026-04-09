# Auth Auditor (A2) Findings

**Auditor:** Auth Auditor (A2)
**Date:** 2026-04-09
**Scope:** Auth flows (sign-in/sign-up, middleware, role enforcement, server action auth, RLS policy auth patterns)
**Files Reviewed:** 30+ files across middleware, server actions, auth helpers, RLS migrations, SECURITY DEFINER functions

---

## CRITICAL Findings

### AUTH-01: SECURITY DEFINER RPC functions have NO internal authorization checks — any authenticated user can execute destructive operations
**Severity:** CRITICAL
**Files:**
- `supabase/migrations/20260409000011_functions.sql:100-497` (deep_copy_estimate)
- `supabase/migrations/20260409000011_functions.sql:514-814` (create_estimate_snapshot)
- `supabase/migrations/20260409000011_functions.sql:822-1237` (restore_estimate_snapshot)
- `supabase/migrations/20260409000011_functions.sql:1245-1647` (create_estimate_from_snapshot)
- `supabase/migrations/20260409000011_functions.sql:49-87` (set_subtree_visibility)

**Evidence:** All six SECURITY DEFINER functions are granted to `authenticated` role:
```sql
GRANT EXECUTE ON FUNCTION public.deep_copy_estimate(UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_subtree_visibility(UUID, public.client_visibility) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_estimate_snapshot(...) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_estimate_snapshot(...) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_estimate_from_snapshot(...) TO authenticated;
```

These functions run as the function owner (postgres superuser), bypassing ALL RLS policies. They contain zero internal calls to `is_staff()`, `get_user_role()`, or `auth.uid()`. A `pending` user or a `client` user can directly invoke any of these RPCs via the Supabase client and:

1. **deep_copy_estimate** — duplicate any estimate in the database, regardless of project ownership
2. **restore_estimate_snapshot** — overwrite an active estimate's data with a snapshot, destroying current work
3. **create_estimate_snapshot** — create snapshots of any estimate (data exfiltration of full estimate trees)
4. **create_estimate_from_snapshot** — create new estimates from any snapshot
5. **set_subtree_visibility** — change client visibility of any node tree

The server actions DO call `getAuthenticatedClient()` which validates the user is logged in, but the RPC functions themselves can be called directly by any authenticated user via `supabase.rpc()` from client code or API.

**Impact:** A pending user (not yet approved) or a client user can read, copy, modify, and destroy estimate data for any project. Complete authorization bypass for the most sensitive business operations.

**Fix:** Add `IF NOT public.is_staff() THEN RAISE EXCEPTION 'Unauthorized'; END IF;` as the first line in every SECURITY DEFINER function, or restrict GRANT to a custom staff-only database role instead of `authenticated`.

---

### AUTH-02: deleteSnapshot uses admin client to bypass immutability trigger with insufficient authorization — ownership check is bypassable
**Severity:** HIGH
**File:** `src/lib/actions/snapshots.ts:197-241`

**Evidence:**
```typescript
export async function deleteSnapshot(id: string): Promise<ActionResult<void>> {
  const { user, supabase } = await getAuthenticatedClient();
  // ...
  // Verify the caller is the owner
  if (snapshot.created_by !== user.id) {
    return forbidden();
  }
  // Use admin client to bypass the immutability trigger
  const admin = createAdminClient();
  const { error: deleteError } = await admin
    .from("estimate_snapshots")
    .delete()
    .eq("id", id);
```

Two issues:
1. The ownership check (`snapshot.created_by !== user.id`) only verifies the user created the snapshot, not that they have staff role. A client user who somehow created a snapshot (via AUTH-01 above) would pass this check.
2. There is no role check at all. The `getAuthenticatedClient()` call only verifies the user is logged in (not pending, not anon), but does NOT verify `owner` or `employee` role. A `client`-role user could call this action.
3. The admin client bypasses RLS entirely, meaning the service role key is used for the delete. If the ownership check is wrong or bypassed, data loss occurs.

**Impact:** Any authenticated non-pending user can delete milestone snapshots they created (or that were created via AUTH-01). The admin client bypass makes the immutability trigger meaningless for this code path.

**Fix:** Add explicit role check: `if (user.app_metadata?.user_role !== 'owner' && user.app_metadata?.user_role !== 'employee') return forbidden();` before the ownership check.

---

## HIGH Findings

### AUTH-03: Server actions perform NO role-based authorization — all authenticated non-pending users can execute all operations
**Severity:** HIGH
**Files:**
- `src/lib/actions/_shared.ts:19-23` (getAuthenticatedClient)
- `src/lib/actions/projects.ts` (all 5 actions)
- `src/lib/actions/estimates.ts` (all 5 actions)
- `src/lib/actions/nodes.ts` (all 11 actions)
- `src/lib/actions/snapshots.ts` (all 5 actions)

**Evidence:** The `getAuthenticatedClient()` function that guards every server action:
```typescript
export async function getAuthenticatedClient() {
  const user = await requireUser();        // only checks: logged in, not null
  const supabase = await createClient();   // uses anon key, RLS applies
  return { user, supabase };
}
```

And `requireUser()`:
```typescript
export async function requireUser() {
  const { user, error } = await getUser();
  if (error) redirect("/sign-in?error=service_unavailable");
  if (!user) redirect("/sign-in");
  return user;
}
```

Neither function checks `user.app_metadata.user_role`. A `client`-role user can call `createProject()`, `updateProject()`, `deleteProject()`, `createEstimate()`, `deleteEstimate()`, and all 11 node actions. While RLS on the database would block some operations (RLS policies require `is_staff()` for write operations), the server actions using the anon-key Supabase client WILL have RLS enforced. So in practice, the database-level RLS is the real authorization layer.

However, this creates a defense-in-depth gap: the application layer has zero role awareness, relying entirely on RLS. If any RLS policy is misconfigured (as in AUTH-01 where SECURITY DEFINER bypasses RLS), the application has no second layer of defense.

**Impact:** No application-level authorization for any server action. The only defense is database RLS, which is already shown to be bypassable via SECURITY DEFINER functions.

**Fix:** Add a `requireStaff()` helper that checks `user.app_metadata.user_role` is `owner` or `employee`. Use it in all write actions. For read actions, RLS provides adequate protection since those use the anon-key client.

---

### AUTH-04: Middleware role check reads from JWT app_metadata which can be stale after role changes
**Severity:** HIGH
**File:** `src/lib/supabase/middleware.ts:53-54`

**Evidence:**
```typescript
const role = (user.app_metadata?.user_role as string | undefined) ?? "pending";
const isPending = role === "pending";
```

The middleware reads `user_role` from `app_metadata` in the JWT token. The `custom_access_token_hook` injects this claim when tokens are issued/refreshed. However, JWT tokens have a default 1-hour expiry in Supabase. If an owner changes a user's role from `employee` to `pending` (or revokes access), the affected user retains their previous role in the JWT for up to 1 hour.

The same pattern appears in the protected layout (`src/app/(protected)/layout.tsx:23`).

While `supabase.auth.getUser()` is used (which contacts the auth server, not just decoding the JWT), the `app_metadata` in the response still reflects the JWT claims, not a live database lookup. The JWT claims are only refreshed when the token is reissued.

**Impact:** A fired employee or demoted user retains access for up to 1 hour after role change. In a construction estimating context, this window could allow data exfiltration or destructive actions.

**Fix:** For critical role transitions (employee -> pending, or role removal), also call `supabase.auth.admin.signOut(userId)` to invalidate all sessions immediately. Alternatively, add a database lookup for role on sensitive operations rather than relying solely on JWT claims.

---

### AUTH-05: `pending` users can access `/pending-approval` page and execute client-side Supabase queries
**Severity:** MEDIUM
**Files:**
- `src/lib/supabase/middleware.ts:7,58` (PUBLIC_ROUTES includes `/pending-approval`)
- `src/app/pending-approval/page.tsx` (client component with Supabase client)

**Evidence:** The `/pending-approval` route is listed in `PUBLIC_ROUTES`:
```typescript
const PUBLIC_ROUTES = ["/sign-in", "/sign-up", "/auth/callback", "/pending-approval"];
```

The middleware logic at line 58:
```typescript
if (isPending && !onPendingPage && !isPublic) {
  // redirect to /pending-approval
}
```

This means pending users are correctly redirected TO `/pending-approval`, but the page itself is a client component that creates a Supabase browser client. While the page only has a sign-out button, a pending user could use browser devtools to call `supabase.rpc()` directly with the authenticated session (exploiting AUTH-01). The middleware only controls page navigation, not API calls.

**Impact:** Low in isolation (the page itself is harmless), but combined with AUTH-01, a pending user can bypass the approval workflow entirely by calling RPCs directly from the browser console.

---

## MEDIUM Findings

### AUTH-06: `estimate_comments` and `estimate_approvals` client INSERT policies lack `author_id` enforcement
**Severity:** MEDIUM
**File:** `supabase/migrations/20260409000006_client_sharing_tables.sql:234-241,289-299`

**Evidence:** The client INSERT policies for comments and approvals:
```sql
CREATE POLICY "Clients can create comments"
  ON public.estimate_comments FOR INSERT
  WITH CHECK (
    public.get_user_role() = 'client'
    AND EXISTS (
      SELECT 1 FROM public.estimates e
      WHERE e.id = estimate_id
        AND public.client_has_project_access(e.project_id)
    )
  );
```

The policy does NOT enforce that `author_id = auth.uid()`. A client could insert a comment with `author_id` set to another user's UUID, impersonating that user. The same applies to `estimate_approvals`.

**Impact:** A client could create comments or approval records attributed to other users, potentially causing confusion or fraudulent approval records.

**Fix:** Add `AND author_id = (SELECT auth.uid())` to both INSERT policies.

---

### AUTH-07: `client_has_project_access()` is SECURITY DEFINER with no role guard — any authenticated user can probe project access
**Severity:** MEDIUM
**File:** `supabase/migrations/20260409000006_client_sharing_tables.sql:65-81`

**Evidence:**
```sql
CREATE OR REPLACE FUNCTION public.client_has_project_access(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE PARALLEL SAFE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.client_project_access
    WHERE client_user_id = (SELECT auth.uid())
      AND project_id = p_project_id
  );
$$;
GRANT EXECUTE ON FUNCTION public.client_has_project_access(UUID) TO authenticated;
```

The function is granted to all `authenticated` users and runs as SECURITY DEFINER (bypassing RLS on `client_project_access`). While it only checks the caller's own `auth.uid()`, the function itself reveals whether a project_id exists or not (boolean oracle). A staff user calling this would always get `false` (since staff wouldn't have client_project_access rows), which is benign. However, the SECURITY DEFINER is unnecessary here since the function only reads the caller's own rows, which the RLS policy already allows.

**Impact:** Minor information disclosure risk. The SECURITY DEFINER is overprivileged for the function's purpose.

---

### AUTH-08: Sign-up flow redirects to `/dashboard` when email verification is disabled, bypassing pending-approval check
**Severity:** MEDIUM
**File:** `src/app/(auth)/sign-up/page.tsx:36-39`

**Evidence:**
```typescript
if (data.session) {
  router.push("/dashboard");
  router.refresh();
  return;
}
```

If Supabase email verification is disabled (development mode or misconfiguration), `signUp` returns a session immediately. The sign-up page redirects directly to `/dashboard`. The middleware WILL catch this and redirect to `/pending-approval` (line 58-62 of middleware.ts), but there is a brief window where the client-side router push happens before the middleware intercept on the next navigation.

**Impact:** Momentary UI flash of dashboard before redirect. Not a security bypass because middleware enforces the redirect server-side, but it indicates the client-side flow doesn't align with the pending-approval workflow.

---

## Positive Observations

1. **Middleware uses `getUser()` not `getSession()`** — correctly validates JWT server-side rather than trusting client-provided tokens (middleware.ts:44)
2. **Open redirect prevention** in auth callback is properly implemented (callback/route.ts:4-11)
3. **Auth error messages are sanitized** — raw Supabase errors never reach the client (error-messages.ts)
4. **Defense-in-depth pending check** in protected layout catches middleware misses (layout.tsx:23-25)
5. **`prevent_role_self_change` trigger** prevents role escalation at database level (security_foundation.sql:182-202)
6. **Admin client is server-only** — uses `import "server-only"` guard (admin.ts:1)
7. **Service role key not in client bundle** — env.ts correctly separates server/client env vars
8. **RLS enabled on ALL tables** — no table was missed
9. **`custom_access_token_hook` is SECURITY DEFINER with `SET search_path = ''`** — hardened against CVE-2018-1058

---

## Summary

| Severity | Count | Key Theme |
|----------|-------|-----------|
| CRITICAL | 1 | SECURITY DEFINER RPCs callable by any authenticated user, bypass all RLS |
| HIGH     | 3 | No app-level role checks, admin client misuse, JWT staleness |
| MEDIUM   | 4 | Missing author_id enforcement, sign-up flow gap, function overprivilege |

The most urgent fix is AUTH-01: adding role checks inside all SECURITY DEFINER functions or restricting their GRANT to a custom database role. Without this, the entire RLS system is bypassable by any authenticated user (including pending and client users) through direct RPC calls.
