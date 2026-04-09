# Error Handling Review Findings

**Reviewer:** Error Handling Reviewer (A10)
**Date:** 2026-04-09
**Scope:** Server actions, error boundaries, middleware, auth flows, catch blocks

---

## Finding 1: `deleteSnapshot` can throw unhandled from `createAdminClient` — violates "never throw from server action" rule

**Severity:** HIGH

**Location:** `src/lib/actions/snapshots.ts:229`, `src/lib/supabase/admin.ts:11`

**Evidence:**
```typescript
// admin.ts:11
throw new Error("Missing SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY");

// snapshots.ts:229 — called inside a server action with no try-catch
const admin = createAdminClient();
```

**Problem:** `deleteSnapshot` is a `"use server"` action that calls `createAdminClient()`, which throws if the service role key is missing. There is no try-catch around this call. The ActionResult contract states "Server actions ALWAYS return ActionResult -- never throw" (action-result.ts:4). If the env var is missing or misconfigured at runtime, this server action throws an unhandled exception instead of returning `err(ERROR_CODE.SERVER_ERROR, ...)`.

**Impact:** In production, a missing service key would cause a 500 error with a raw error message potentially reaching the client (depending on Next.js error serialization behavior). At minimum it violates the project's own ActionResult contract.

**Fix:** Wrap `createAdminClient()` in a try-catch within `deleteSnapshot`, or change `createAdminClient` to return a result type instead of throwing.

---

## Finding 2: `handleSupabaseError` silently swallows known error codes without logging

**Severity:** HIGH

**Location:** `src/lib/actions/_shared.ts:33-41`

**Evidence:**
```typescript
export function handleSupabaseError(error: {
  message: string;
  code?: string;
}): ActionResult<never> {
  if (error.code === "23505") {
    return err(ERROR_CODE.CONFLICT, "A record with this value already exists.");
  }
  if (error.code === "23503") {
    return err(ERROR_CODE.NOT_FOUND, "Referenced record not found.");
  }
  if (error.code === "PGRST116") {
    return err(ERROR_CODE.NOT_FOUND, "Record not found.");
  }

  console.error("Supabase error:", error);  // <-- only logs for UNKNOWN codes
  return err(ERROR_CODE.SERVER_ERROR, "An unexpected error occurred.");
}
```

**Problem:** The `console.error` on line 43 only executes for errors that don't match any of the three known codes (23505, 23503, PGRST116). When a 23505 unique constraint violation or 23503 FK violation occurs, the function returns a user-friendly error but logs nothing server-side. This means:

1. Duplicate/conflict errors are invisible in server logs — no way to trace which constraint was violated, which table, or which value caused it.
2. FK violations (23503) are silently mapped to "Referenced record not found" without logging which FK relationship failed.
3. Debugging production issues involving these codes requires reproducing them locally since there is zero server-side evidence.

**Impact:** Significant operational blind spot. In a construction estimating platform where data integrity is critical, constraint violations should always leave a server-side audit trail.

**Fix:** Add `console.error("Supabase error:", error)` before each early return for 23505, 23503, and PGRST116. Alternatively, move the log before the switch logic so all errors are logged regardless of code.

---

## Finding 3: `updateItemDetails` and `updateAssemblyDetails` succeed silently on zero-row updates

**Severity:** HIGH

**Location:** `src/lib/actions/nodes.ts:349-356`, `src/lib/actions/nodes.ts:385-392`

**Evidence:**
```typescript
// nodes.ts:349-356
const { error } = await supabase
  .from("node_item_details")
  .update(updates)
  .eq("node_id", nodeId);

if (error) return handleSupabaseError(error);
return getNode(nodeId);  // <-- proceeds even if 0 rows updated
```

**Problem:** These update queries use `.eq("node_id", nodeId)` without `.select().single()`. When no rows match the `node_id` (e.g., wrong node type — calling `updateItemDetails` on an assembly node, or a non-existent nodeId that passes UUID validation), Supabase returns no error but updates zero rows. The action then proceeds to `getNode(nodeId)` which either returns stale data (if the node exists but is the wrong type) or a NOT_FOUND error (if the node doesn't exist).

Compare to `updateNode` at line 297 which correctly uses `.select().single()` — getting a PGRST116 error if no rows match.

**Impact:** The caller receives a success response with unchanged data, making it appear the update worked when it was silently a no-op. In an estimating tool, this means cost changes could appear to save but actually not persist.

**Fix:** Add `.select().single()` to these update queries so PGRST116 fires on zero-row updates, or add an explicit row-count check.

---

## Finding 4: `auth_callback_error` not handled by sign-in page URL error map

**Severity:** MEDIUM

**Location:** `src/app/auth/callback/route.ts:31`, `src/app/(auth)/sign-in/page.tsx:9-12`

**Evidence:**
```typescript
// route.ts:31 — redirects with this error code
return NextResponse.redirect(`${origin}/sign-in?error=auth_callback_error`);

// sign-in page.tsx:9-12 — does NOT list it
const URL_ERROR_MESSAGES: Record<string, string> = {
  service_unavailable: "The authentication service is temporarily unavailable.",
  session_expired: "Your session has expired. Please sign in again.",
};
// Falls through to generic: "An error occurred. Please try again."
```

**Problem:** The auth callback route redirects to `/sign-in?error=auth_callback_error` on exchange failure, but the sign-in page's `URL_ERROR_MESSAGES` map does not include `auth_callback_error`. The user sees the generic "An error occurred. Please try again." instead of a specific message explaining the email verification link may have expired.

**Impact:** Poor user experience. Users clicking an expired verification link get an uninformative message with no actionable guidance.

**Fix:** Add `auth_callback_error: "Your sign-in link has expired or was already used. Please try signing in again."` to `URL_ERROR_MESSAGES`.

---

## Finding 5: `createNode` rollback cleanup does not check for failure

**Severity:** MEDIUM

**Location:** `src/lib/actions/nodes.ts:136-137`, `src/lib/actions/nodes.ts:155-156`

**Evidence:**
```typescript
// nodes.ts:136-137
if (detailError) {
  // Clean up the base node if detail insert fails
  await supabase.from("estimate_nodes").delete().eq("id", node.id);
  return handleSupabaseError(detailError);
}
```

**Problem:** When a detail insert fails during `createNode`, the code attempts to delete the orphaned base node. However, the delete result is discarded with `await` but no error check. If the rollback delete also fails (e.g., network issue, RLS denying the delete), the orphaned base node persists in the database with no detail record — a data integrity violation. The same pattern appears in `duplicateNode` at lines 515 and 534.

There are 4 instances total:
- `nodes.ts:136` (createNode, item detail fail)
- `nodes.ts:155` (createNode, assembly detail fail)
- `nodes.ts:515` (duplicateNode, item detail fail)
- `nodes.ts:534` (duplicateNode, assembly detail fail)

**Impact:** Orphaned estimate_nodes with no corresponding detail row. The node_type says "item" or "assembly" but `node_item_details`/`node_assembly_details` has no matching row. Any subsequent `getNode` call would fail with NOT_FOUND on the detail query.

**Fix:** At minimum, log the rollback failure. Ideally, use a database transaction (Supabase RPC wrapping the multi-table insert) so the entire operation is atomic.

---

## Finding 6: `duplicateNode` silently drops note duplication failures

**Severity:** MEDIUM

**Location:** `src/lib/actions/nodes.ts:556-558`

**Evidence:**
```typescript
// nodes.ts:546-558
if (!notesError && notes && notes.length > 0) {
  const noteInserts = notes.map((note) => ({...}));
  await supabase.from("node_notes").insert(noteInserts);
  // Note duplication failure is non-fatal; we still return the new node
}
```

**Problem:** Two issues here:
1. The note insert result is completely discarded — no error variable captured, no logging.
2. If the initial notes fetch fails (`notesError` is truthy), that error is also silently swallowed — not logged, not returned.

The comment "Note duplication failure is non-fatal" is a design choice, but the complete absence of logging means there is no way to know that notes were lost during duplication.

**Impact:** User duplicates a node expecting notes to copy. Notes silently fail to copy. User discovers the loss later with no explanation. No server-side record of what went wrong.

**Fix:** Capture and log the insert error: `const { error: insertError } = await supabase.from("node_notes").insert(noteInserts); if (insertError) console.error("Note duplication failed:", insertError);`. Also log `notesError` when the fetch fails.

---

## Finding 7: Error boundaries do not log errors or report to monitoring

**Severity:** MEDIUM

**Location:** `src/app/error.tsx`, `src/app/(protected)/error.tsx`, `src/app/(auth)/error.tsx`

**Evidence:** All three error boundary components receive the `error` object but only conditionally display `error.digest` in development mode. None of them:
1. Log the error to `console.error`
2. Report to any error monitoring service (Sentry, etc.)
3. Include `useEffect` to capture the error on mount (React's recommended pattern)

```typescript
// All three files — same pattern
export default function RootError({ error, reset }: {...}) {
  // No useEffect(() => { console.error(error); reportToService(error) }, [error])
  return (...);
}
```

**Problem:** Error boundaries are the last defense for unhandled React errors. Without logging, errors that reach these boundaries vanish silently in production. The digest is only shown in development.

**Impact:** Production errors caught by boundaries leave no trace. Since server actions are well-handled, this matters most for rendering errors in server components or client-side React crashes.

**Fix:** Add `useEffect(() => { console.error("Uncaught error:", error); }, [error])` to each error boundary. When a monitoring service is added later, this is where the integration goes.

---

## Finding 8: `pending-approval` page has no dedicated error boundary

**Severity:** LOW

**Location:** `src/app/pending-approval/page.tsx` — no sibling `error.tsx`

**Evidence:** The `pending-approval` route is not nested under `(protected)` or `(auth)` — it sits at the root level. The only error boundary that covers it is the root `src/app/error.tsx`. If this page throws (e.g., client-side `createClient()` fails during sign-out), the user sees a generic "Something went wrong" with no link back to sign-in. The `(auth)/error.tsx` has a "Go to Sign In" link, but it does not cover this route.

**Impact:** Minor UX gap — pending users who hit an error lose navigation context.

---

## Summary

| # | Finding | Severity | Location |
|---|---------|----------|----------|
| 1 | `deleteSnapshot` throws from `createAdminClient` — violates ActionResult contract | HIGH | snapshots.ts:229, admin.ts:11 |
| 2 | `handleSupabaseError` does not log known error codes (23505, 23503, PGRST116) | HIGH | _shared.ts:33-41 |
| 3 | `updateItemDetails`/`updateAssemblyDetails` silently succeed on zero-row updates | HIGH | nodes.ts:349-356, 385-392 |
| 4 | `auth_callback_error` not in sign-in page error message map | MEDIUM | route.ts:31, sign-in/page.tsx:9-12 |
| 5 | `createNode`/`duplicateNode` rollback cleanup ignores delete failures | MEDIUM | nodes.ts:136,155,515,534 |
| 6 | `duplicateNode` silently drops note duplication failures without logging | MEDIUM | nodes.ts:546-558 |
| 7 | Error boundaries do not log or report errors | MEDIUM | error.tsx (all 3) |
| 8 | `pending-approval` page lacks dedicated error boundary | LOW | pending-approval/ |

**Positive observations:**
- All 28 server actions consistently use `handleSupabaseError` for Supabase errors — no exceptions found.
- ActionResult discriminated union is well-designed with factory functions enforcing consistent construction.
- No empty catch blocks anywhere in the codebase.
- No raw error messages leaked to clients — all user-facing messages are hardcoded strings.
- Middleware error handling is solid: catches Supabase outages, allows public routes through, redirects protected routes to sign-in with error code.
- Auth error message mapping (`getAuthErrorMessage`) uses partial matching with a safe generic fallback.
- Sign-in/sign-up forms properly handle both Supabase errors and unexpected exceptions with separate code paths.
