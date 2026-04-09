# Research: Clusters D, E, F -- Tests, Performance, Frontend/Accessibility

**Date:** 2026-04-09
**Scope:** Concrete fix recommendations with code patterns for 18 findings across 3 clusters

---

## Cluster D: Test Infrastructure (6 findings)

### D1. CF-05-CRIT: `server-only` import barrier breaks all 58 action tests

**Root Cause:** `src/lib/auth/get-user.ts` line 1 imports `server-only`, which throws unconditionally outside Next.js server context. Vitest runs in Node.js. Every action test dynamically imports actions that transitively import `get-user.ts`, hitting this barrier before any test logic runs.

**Fix: Add a Vitest alias for `server-only`**

Create an empty mock file and register it as a Vitest resolve alias.

1. Create `tests/helpers/server-only-mock.ts`:
```ts
// Empty mock -- allows server-only modules to be imported in Vitest.
// The real `server-only` package throws when imported outside Next.js server context.
export {};
```

2. Update `vitest.config.ts` -- add the alias to `sharedConfig`:
```ts
const sharedConfig = {
  globals: true,
  environment: "node" as const,
  setupFiles: ["./tests/setup.ts"],
  alias: {
    "@": path.resolve(__dirname, "src"),
    "server-only": path.resolve(__dirname, "tests/helpers/server-only-mock.ts"),
  },
};
```

Also remove the duplicate top-level `resolve.alias` block (lines 14-18) since project-level aliases now cover it.

**Additional mock needed:** `get-user.ts` uses `import { cache } from "react"` and `import { redirect } from "next/navigation"`. These will throw or be undefined in Vitest. The action tests use dynamic imports that call through `getAuthenticatedClient()` -> `requireUser()` -> `getUser()`. For tests to actually execute (not just import), the actions need either:
- A mock for `requireUser` that returns a fake user, OR
- The `createClient` from `@/lib/supabase/server` needs a mock or the tests need real cookies.

Since these tests already use `skipIf(SKIP)` on env vars, they are integration tests expecting a live Supabase. The `server-only` fix unblocks the import barrier. For the `cookies()` dependency in `createClient`, either:
- Mock `next/headers` to provide a fake cookie store in `tests/setup.ts`, OR
- Change the test approach to call Supabase directly (as the DB tests do) rather than going through server actions.

**Recommended approach:** Fix the `server-only` alias first. Then mock `next/headers` in setup.ts:
```ts
// tests/setup.ts
import { config } from "dotenv";
import { vi } from "vitest";

config({ path: ".env.local" });

// Mock next/headers for server action tests
vi.mock("next/headers", () => ({
  cookies: vi.fn(() => ({
    getAll: () => [],
    get: () => null,
    set: vi.fn(),
  })),
  headers: vi.fn(() => new Map()),
}));

// Mock next/navigation redirect to throw a known error instead of hanging
vi.mock("next/navigation", async (importOriginal) => {
  const orig = await importOriginal<typeof import("next/navigation")>();
  return {
    ...orig,
    redirect: vi.fn((url: string) => {
      throw new Error(`NEXT_REDIRECT: ${url}`);
    }),
    notFound: vi.fn(() => {
      throw new Error("NEXT_NOT_FOUND");
    }),
  };
});
```

**Priority:** CRITICAL -- blocking all action test coverage.

---

### D2. CF-31: 173 database tests always skipped with no CI strategy

**Root Cause:** All DB tests use `skipIf(SKIP)` where SKIP is true when env vars are absent. No CI pipeline, Docker Compose, or documentation exists for local Supabase. The `run_sql` RPC function required by trigger/RLS tests has no migration or provisioning script.

**Fix: Three-part solution**

**Part A: Create `run_sql` migration for test environments**

Create `supabase/migrations/20260409000099_test_helpers.sql`:
```sql
-- Test helper: run_sql RPC
-- Only grant to service_role -- never expose to authenticated users.
-- This function exists for test infrastructure only.

CREATE OR REPLACE FUNCTION public.run_sql(query text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result jsonb;
BEGIN
  EXECUTE query;
  RETURN '[]'::jsonb;
EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$;

-- CRITICAL: Only service_role can call this
REVOKE ALL ON FUNCTION public.run_sql(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_sql(text) FROM anon;
REVOKE ALL ON FUNCTION public.run_sql(text) FROM authenticated;
-- service_role has superuser-like access and can call any function
```

**Part B: Add `test:ci:db` script and docs**

In `package.json`:
```json
"test:ci:full": "vitest run",
"test:ci:db": "vitest run --project db"
```

Add a `TESTING.md` or section in `README.md` documenting:
1. Install Supabase CLI: `npx supabase init` (already done)
2. Start local: `npx supabase start`
3. Copy `.env.local` from local Supabase output
4. Run: `npm run test:ci:full`

**Part C: GitHub Actions workflow (future)**

A `.github/workflows/test.yml` should:
1. Start Supabase via `npx supabase start`
2. Apply migrations
3. Run `npm run test:ci:full`

This is a Phase 2 item but should be planned now.

**Priority:** HIGH -- 140 RLS tests (the most critical security validation) cannot run.

---

### D3. CF-32: Authorization tests are tautological

**Root Cause:** Tests `ACT-PROJ-15` and `ACT-PROJ-16` (lines 294-334 in `tests/actions/projects.test.ts`) accept SUCCESS as a valid outcome. A test that cannot fail tests nothing.

**Fix: Rewrite with proper role impersonation**

The tests need a mechanism to call server actions as specific roles. Options:

**Option A (recommended): Direct DB approach with `test-utils.ts` helpers**

Instead of trying to call server actions (which need Next.js context), test authorization at the database layer:
```ts
it("ACT-PROJ-15: unauthenticated user cannot access projects", async () => {
  const anonClient = getAnonClient();
  const { data, error } = await anonClient.from("projects").select("*");
  // Anon should get zero rows (RLS blocks)
  expect(data).toEqual([]);
});

it("ACT-PROJ-16: pending role cannot insert projects", async () => {
  const admin = getAdminClient();
  // Create a pending user
  const { data: pendingUser } = await admin.auth.admin.createUser({
    email: `pending-${Date.now()}@test.com`,
    password: "test12345",
    email_confirm: true,
    app_metadata: { user_role: "pending" },
  });
  // Sign in as that user
  const pendingClient = createClient(url, anonKey);
  await pendingClient.auth.signInWithPassword({
    email: pendingUser.user.email!,
    password: "test12345",
  });
  // Attempt to create -- should fail via RLS
  const { error } = await pendingClient.from("projects").insert({ name: "Blocked" });
  expect(error).not.toBeNull();
});
```

**Option B: Mark as `it.todo()` until server action mocking exists**

If the goal is to keep them as server action tests, replace the current tautological body with `it.todo("requires server action role mocking infrastructure")` so they are visible as untested.

**Priority:** HIGH -- false confidence in authorization coverage.

---

### D4. CF-33: Tests silently swallow errors via try/catch

**Root Cause:** At least 6 tests in `nodes.test.ts` and `snapshots.test.ts` wrap their entire body in `try { ... } catch { // not implemented yet }`. These always pass, even if the function throws unexpected errors.

**Specific instances found:**
- `snapshots.test.ts` line 399: `catch { // createEstimateFromSnapshot may not be implemented yet }`
- `snapshots.test.ts` line 429/435: nested try/catch for deleteSnapshot
- `snapshots.test.ts` line 475: `catch { // deleteCheckpoints may not exist yet }`
- `nodes.test.ts` line 497: `catch { // Function may not be implemented yet }`
- `nodes.test.ts` line 535/578/628: catch blocks for flag/visibility functions

**Fix: Replace with proper conditional testing**

Since the functions DO exist now, remove all try/catch wrappers. If a function genuinely might not exist, use a different pattern:
```ts
it("ACT-SNAP-14: createEstimateFromSnapshot returns new estimate ID", async () => {
  const { createEstimateFromSnapshot } = await import("@/lib/actions/snapshots");
  // Function exists -- test it properly
  const result = await createEstimateFromSnapshot(snapshotId, "New Name");
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data).not.toBe(estimateId);
  }
});
```

For functions that truly might not exist yet, use `it.todo()` or `it.skip()` instead of a silent catch.

**Priority:** HIGH -- false test confidence.

---

### D5. CF-80: Smoke test throws instead of skipping on missing env vars

**Root Cause:** `tests/smoke/supabase.test.ts` lines 8-11 throw `new Error("Missing required env vars...")` when env vars are absent, instead of using `skipIf` like other test files.

**Fix:**
```ts
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const SKIP = !url || !anonKey;

describe.skipIf(SKIP)("connection-smoke/supabase", () => {
  // ... tests, with individual skipIf for serviceKey-dependent tests
  it("CONN-L2-04: Service role key works", async () => {
    if (!serviceKey) {
      // Use Vitest skip API instead of throwing
      return; // or it.skip()
    }
    // ... test body
  });
});
```

**Priority:** MEDIUM -- breaks test runner when env vars are absent.

---

### D6. CF-58: Coverage thresholds set to zero

**Root Cause:** `vitest.config.ts` lines 63-67 set all coverage thresholds to 0 with a TODO comment.

**Fix:** Leave at 0 for now but track coverage baseline. After fixing the `server-only` barrier (D1) and adding unit tests for pure logic:
- Phase 1: Set thresholds to actual measured values (prevents regression)
- Phase 2: Incrementally raise as coverage improves

**Immediate action:** After D1 fix, run `npm run test:coverage` to get baseline numbers, then set thresholds to those values minus 2% margin.

**Priority:** LOW (depends on D1 fix first).

---

## Cluster E: Performance & Error Handling (7 findings)

### E1. CF-29: `restore_estimate_snapshot()` uses row-by-row loops

**Root Cause:** Lines 970-1102 in `20260409000011_functions.sql` use 12 separate `FOR v_rec IN ... LOOP ... INSERT ... END LOOP` blocks. Meanwhile, `deep_copy_estimate()` (lines 200-280) correctly uses set-based `INSERT ... SELECT` with temp table ID remapping.

**Performance impact:** For a 500-node estimate with item details, this means ~1500 individual INSERT statements (500 nodes + 500 details + 500 parent_id UPDATEs) vs ~6 set-based statements.

**Fix: Rewrite restore to use set-based operations**

The challenge with restore is that data comes from JSONB, not existing tables. Use `jsonb_to_recordset()` instead of looping:

```sql
-- REPLACE the node insert loops (steps 8, pass 1 + pass 2) with:

-- Pass 1: Insert all nodes with parent_id initially NULL
INSERT INTO public.estimate_nodes (
  id, estimate_id, parent_id, sort_order,
  node_type, name, description,
  client_visibility, flagged, was_auto_promoted,
  catalog_source_id, total_price,
  created_by, created_at, updated_at
)
SELECT
  (j->>'id')::uuid,
  v_estimate_id,
  NULL,  -- set in pass 2
  COALESCE((j->>'sort_order')::integer, 0),
  (j->>'node_type')::public.node_type,
  j->>'name',
  j->>'description',
  COALESCE((j->>'client_visibility')::public.client_visibility, 'visible'),
  COALESCE((j->>'flagged')::boolean, false),
  COALESCE((j->>'was_auto_promoted')::boolean, false),
  (j->>'catalog_source_id')::uuid,
  COALESCE((j->>'total_price')::decimal, 0),
  (j->>'created_by')::uuid,
  COALESCE((j->>'created_at')::timestamptz, now()),
  now()
FROM jsonb_array_elements(v_snapshot_data->'nodes') AS j;

-- Pass 2: Set parent_id in bulk
UPDATE public.estimate_nodes en
   SET parent_id = (j->>'parent_id')::uuid
  FROM jsonb_array_elements(v_snapshot_data->'nodes') AS j
 WHERE en.id = (j->>'id')::uuid
   AND j->>'parent_id' IS NOT NULL;

-- REPLACE the item_details loop (step 10) with:
INSERT INTO public.node_item_details (
  id, node_id, quantity, unit_id, unit_cost, /* ... all columns ... */
)
SELECT
  COALESCE((j->>'id')::uuid, gen_random_uuid()),
  (j->>'node_id')::uuid,
  COALESCE((j->>'quantity')::decimal, 0),
  /* ... all columns from j ... */
FROM jsonb_array_elements(v_snapshot_data->'item_details') AS j;
```

Apply the same pattern to all 12 loops (assembly_details, node_notes, option_groups, option_alternatives, node_option_memberships, option_sets, option_set_selections, broad_options, broad_option_overrides, option_set_broad_selections).

**Estimated improvement:** 10-50x for large estimates (500+ nodes). Set-based inserts use bulk WAL writes instead of per-row overhead.

**Priority:** HIGH -- directly affects user-facing restore latency.

---

### E2. CF-30: Redundant `getNode()` re-fetch after every mutation

**Root Cause:** 8 locations in `nodes.ts` call `getNode(id)` after a mutation even when the mutation already returned the updated data via `.select().single()`.

**Specific instances:**
- `updateNode` (line 307): `data` from `.update().select().single()` is discarded, then `getNode(data.id)` re-fetches
- `moveNode` (line 425): Same pattern
- `flagNode` (line 583): Does an update without `.select()`, then `getNode(id)` -- 2 round trips for a boolean toggle
- `updateItemDetails` (line 356): Update without `.select()`, then `getNode(nodeId)` -- 2 round trips
- `updateAssemblyDetails` (line 392): Same pattern
- `setNodeVisibility` (line 622): Same pattern
- `createNode` (line 161): After detail insert, calls `getNode(node.id)` despite having `node` data
- `duplicateNode` (line 561): Same pattern

**Fix: Return data from mutation queries directly**

For mutations that already use `.select().single()`:
```ts
// BEFORE (updateNode, line 297-308):
const { data, error } = await supabase
  .from("estimate_nodes")
  .update(updates)
  .eq("id", id)
  .select()
  .single();
if (error) return handleSupabaseError(error);
return getNode(data.id);  // REDUNDANT -- data already has the row

// AFTER:
const { data, error } = await supabase
  .from("estimate_nodes")
  .update(updates)
  .eq("id", id)
  .select()
  .single();
if (error) return handleSupabaseError(error);
// Fetch only the detail row, not the full getNode()
return attachSingleNodeDetails(supabase, data);
```

For mutations without `.select()` (flagNode, updateItemDetails, updateAssemblyDetails, setNodeVisibility), add `.select().single()` to avoid the second query:
```ts
// BEFORE (flagNode):
const { error } = await supabase
  .from("estimate_nodes")
  .update({ flagged })
  .eq("id", id);
if (error) return handleSupabaseError(error);
return getNode(id);

// AFTER:
const { data, error } = await supabase
  .from("estimate_nodes")
  .update({ flagged })
  .eq("id", id)
  .select()
  .single();
if (error) return handleSupabaseError(error);
return attachSingleNodeDetails(supabase, data);
```

Extract a helper `attachSingleNodeDetails` that fetches only the detail row for one node (1 query instead of getNode's 3):
```ts
async function attachSingleNodeDetails(
  supabase: SupabaseClient<Database>,
  node: EstimateNode,
): Promise<ActionResult<NodeWithDetails>> {
  if (node.node_type === "item") {
    const { data: details, error } = await supabase
      .from("node_item_details").select("*").eq("node_id", node.id).single();
    if (error) return handleSupabaseError(error);
    return ok({ ...node, node_type: "item" as const, details } as NodeWithDetails);
  }
  if (node.node_type === "assembly") {
    const { data: details, error } = await supabase
      .from("node_assembly_details").select("*").eq("node_id", node.id).single();
    if (error) return handleSupabaseError(error);
    return ok({ ...node, node_type: "assembly" as const, details } as NodeWithDetails);
  }
  return ok({ ...node, node_type: "group" as const, details: null } as NodeWithDetails);
}
```

**Impact:** Reduces each mutation from 3-4 queries to 1-2. For `flagNode`, a simple boolean toggle goes from 3 queries (update + getNode which does select + detail select) to 2 (update-with-select + detail select).

**Priority:** HIGH -- every user interaction triggers unnecessary round trips.

---

### E3. CF-21: `getAuthenticatedClient()` creates two Supabase clients

**Root Cause:** `_shared.ts` lines 19-22:
```ts
export async function getAuthenticatedClient() {
  const user = await requireUser();      // creates client #1 via getUser() -> createClient()
  const supabase = await createClient(); // creates client #2
  return { user, supabase };
}
```

Each `createClient()` call reads the cookie store via `await cookies()`. The first client is created inside `getUser()` solely for the auth check, then discarded.

**Fix: Reuse the client from `getUser()`**

Option A: Export the client from `getUser`:
```ts
// src/lib/auth/get-user.ts
export const getUser = cache(async () => {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  return { user, error, supabase };  // <-- also return the client
});

export async function requireUser() {
  const { user, error, supabase } = await getUser();
  if (error) { redirect("/sign-in?error=service_unavailable"); }
  if (!user) { redirect("/sign-in"); }
  return { user, supabase };  // <-- return both
}
```

Then update `_shared.ts`:
```ts
export async function getAuthenticatedClient() {
  return await requireUser();  // single client creation
}
```

**Caveat:** `getUser()` uses React's `cache()` which memoizes per-request in Next.js server components. The returned `supabase` client will be reused across the request. This is actually desirable -- it matches the recommended Supabase pattern of one client per request.

**Option B (simpler, lower risk):** Use `cache()` on `createClient` instead:
```ts
// src/lib/supabase/server.ts
import { cache } from "react";
export const createClient = cache(async () => {
  // ... existing implementation
});
```

This ensures duplicate `createClient()` calls in the same request return the same instance.

**Priority:** HIGH -- doubles Supabase client overhead on every server action call.

---

### E4. CF-20: `handleSupabaseError` does not log known error codes

**Root Cause:** `_shared.ts` lines 33-41: `console.error` only fires in the `else` branch (unknown errors). When 23505, 23503, or PGRST116 occurs, the function returns a user-friendly message but logs nothing server-side.

**Fix:**
```ts
export function handleSupabaseError(error: {
  message: string;
  code?: string;
}): ActionResult<never> {
  // Always log server-side, regardless of whether we recognize the code
  console.error("Supabase error:", {
    code: error.code,
    message: error.message,
  });

  if (error.code === "23505") {
    return err(ERROR_CODE.CONFLICT, "A record with this value already exists.");
  }
  if (error.code === "23503") {
    return err(ERROR_CODE.NOT_FOUND, "Referenced record not found.");
  }
  if (error.code === "PGRST116") {
    return err(ERROR_CODE.NOT_FOUND, "Record not found.");
  }

  return err(ERROR_CODE.SERVER_ERROR, "An unexpected error occurred.");
}
```

The log level could be reduced for expected codes (e.g., `console.warn` for 23505 and PGRST116) but they should never be invisible.

**Priority:** HIGH -- constraint violations are invisible in production logs.

---

### E5. CF-51: `createSnapshot` fetches full `snapshot_data` JSONB after creation

**Root Cause:** `snapshots.ts` lines 69-76 fetch the full snapshot row (including the potentially multi-MB `snapshot_data` JSONB column) just to return it to the client. The client likely only needs the metadata (id, name, type, dates).

**Fix:** Return metadata-only after creation:
```ts
// BEFORE:
const { data, error } = await supabase
  .from("estimate_snapshots")
  .select("*")
  .eq("id", snapshotId)
  .single();

// AFTER:
const { data, error } = await supabase
  .from("estimate_snapshots")
  .select("id, estimate_id, name, description, snapshot_type, estimate_status_at_time, project_status_at_time, node_count, total_price, schema_version, created_at, created_by")
  .eq("id", snapshotId)
  .single();
```

Also change the return type from `ActionResult<EstimateSnapshotRow>` to `ActionResult<SnapshotMeta>` -- the `SnapshotMeta` type already exists at line 21.

**Priority:** MEDIUM -- unnecessary bandwidth on every snapshot create.

---

### E6. CF-53: Middleware calls `getUser()` on every request including public routes

**Root Cause:** `src/lib/supabase/middleware.ts` line 44 calls `supabase.auth.getUser()` on every request. For public routes (`/sign-in`, `/sign-up`, `/auth/callback`, `/pending-approval`), this is technically needed for session refresh but could be skipped for fully unauthenticated users.

**Analysis:** Looking at the middleware code more carefully, the public route check happens BEFORE the Supabase call (line 17), but `getUser()` is still called on line 44 regardless. The issue is that Supabase recommends calling `getUser()` on every request to refresh the session cookie, even on public routes.

**Fix: Skip `getUser()` when no auth cookies exist**

```ts
export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isPublic = isPublicRoute(pathname);

  // Skip auth entirely if no auth cookies exist on a public route
  const hasAuthCookie = request.cookies.getAll().some(
    c => c.name.startsWith("sb-") && c.name.endsWith("-auth-token")
  );
  if (isPublic && !hasAuthCookie) {
    return NextResponse.next({ request });
  }

  // ... rest of existing middleware
}
```

This avoids a Supabase round-trip for anonymous visitors on public routes (sign-in, sign-up pages). Users with existing sessions still get their session refreshed even on public routes.

**Priority:** MEDIUM -- reduces latency for unauthenticated users on public pages.

---

### E7. CF-50: Error boundaries do not log errors

**Root Cause:** All three error boundaries (`error.tsx`, `(protected)/error.tsx`, `(auth)/error.tsx`) render UI but do not log the error or report to any monitoring service.

**Fix:** Add `useEffect` to log the error:
```tsx
"use client";

import { useEffect } from "react";

export default function ProtectedError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log to console for development; replace with monitoring service in production
    console.error("Error boundary caught:", error);
    // Future: reportToMonitoring(error);
  }, [error]);

  return (
    // ... existing JSX
  );
}
```

Apply to all 3 error boundaries. The `global-error.tsx` should also log but cannot use `useEffect` the same way since it replaces the entire HTML -- use inline `<script>` or move logging to a separate utility.

**Priority:** MEDIUM -- errors vanish silently in production.

---

## Cluster F: Frontend & Accessibility (5+ findings)

### F1. CF-34: Nested `<main>` landmarks -- WCAG 1.3.1, 4.1.1

**Root Cause:** Root layout (`src/app/layout.tsx` line 23) wraps children in `<main id="main-content">`. Protected layout (`src/app/(protected)/layout.tsx` line 40) wraps page content in a second `<main>`. Nested `<main>` elements violate WCAG and confuse screen readers.

**Fix: Replace root layout `<main>` with `<div>`, use `<main>` only in leaf layouts**

```tsx
// src/app/layout.tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="min-h-full font-sans antialiased">
        <SkipLink />
        <div id="main-content">{children}</div>
      </body>
    </html>
  );
}
```

The skip link targets `#main-content` which still works on a `<div>`. Each leaf layout then owns its own `<main>`:
- Protected layout already has `<main>` (line 40) -- no change needed
- Auth pages should wrap content in `<main>` (they are currently inside the root `<main>`)

Update the skip link's target: In the protected layout, the skip link should target the inner `<main>`, not the outer div. Add `id="main-content"` to the protected layout's `<main>`:
```tsx
// src/app/(protected)/layout.tsx, line 40:
<main id="main-content" className="flex-1 overflow-y-auto ...">
```

For auth pages, wrap content in `<main id="main-content">`:
```tsx
// src/app/(auth)/sign-in/page.tsx
function SignInForm() {
  return (
    <main id="main-content" className="flex min-h-screen items-center ...">
      {/* existing content */}
    </main>
  );
}
```

**Priority:** HIGH -- WCAG violation affecting all screen reader users.

---

### F2. CF-35: Sidebar nav links empty when collapsed -- WCAG 4.1.2

**Root Cause:** `src/components/nav/sidebar.tsx` lines 45-55. When `collapsed` is true, the `<Link>` renders no text content (`{!collapsed && item.label}` = nothing). Only a `title` attribute is set, which is insufficient for accessibility per WCAG 4.1.2.

**Fix: Add `aria-label` when collapsed**

```tsx
<Link
  href={item.href}
  className={/* existing classes */}
  aria-label={collapsed ? item.label : undefined}
  title={collapsed ? item.label : undefined}
>
  {!collapsed && item.label}
</Link>
```

Additionally, add `aria-current="page"` for active links (CF-64):
```tsx
<Link
  href={item.href}
  aria-current={isActive ? "page" : undefined}
  aria-label={collapsed ? item.label : undefined}
  title={collapsed ? item.label : undefined}
  className={/* existing */}
>
  {!collapsed && item.label}
</Link>
```

**Priority:** HIGH -- screen readers announce empty links.

---

### F3. CF-63: 15 interactive elements missing `focus-visible` styles -- WCAG 2.4.7

**Root Cause:** Many interactive elements (links, buttons) across the app lack `focus-visible` outlines. Some elements (sign-in/sign-up buttons, sign-in inputs) already have them, but most nav links, error boundary buttons, the sidebar toggle, and user-menu items do not.

**Fix: Add a global focus-visible token and apply systematically**

Step 1: Add a focus-visible utility to `globals.css`:
```css
/* ── Focus Styles ─────────────────────────────────────────────── */
/* Global focus-visible style for all interactive elements.        */
/* WCAG 2.4.7: Focus must be visible.                              */

:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 2px;
}
```

This applies universally to all focusable elements. For elements where the outline conflicts with the design (e.g., inputs that already have a border change), override with specific styles.

Step 2: For Tailwind components that need explicit focus-visible, add to the pattern:
```
focus-visible:outline-2 focus-visible:outline-[var(--color-border-focus)] focus-visible:outline-offset-2
```

**Elements needing immediate fixes:**
1. Sidebar collapse button (`sidebar.tsx` line 31-36): Add focus-visible
2. Sidebar nav links (`sidebar.tsx` line 45-55): Add focus-visible
3. Error boundary "Try again" buttons (3 files): Add focus-visible
4. User menu "Sign Out" button (`user-menu.tsx` line 27): Add focus-visible
5. Sign-in/sign-up page links (already have focus-visible -- good)

The global `:focus-visible` rule in CSS is the cleanest approach. It ensures nothing is missed, and elements that need custom focus styles can override it.

**Priority:** MEDIUM -- WCAG 2.4.7 violation on many elements.

---

### F4. CF-62: `global-error.tsx` uses hardcoded inline styles

**Root Cause:** `src/app/global-error.tsx` uses inline `style={{}}` with hardcoded hex values (`#f5f5f5`, `#0a0a0a`, `#525252`). This is because `global-error.tsx` replaces the entire `<html>` element, so CSS files from the layout may not be available.

**Fix: Use CSS custom properties inline, with fallbacks**

Since `global-error.tsx` cannot reliably depend on `globals.css` being loaded (it replaces the entire document), the inline styles are actually the correct approach for this specific file. However, the values should reference the same hex codes as the design tokens for consistency:

```tsx
<body
  style={{
    background: "#f5f5f5",  // matches --color-bg-secondary
    color: "#0a0a0a",        // matches --color-text-primary
    fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
    margin: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100vh",
  }}
>
```

Add comments documenting which tokens these correspond to. Alternatively, embed a minimal `<style>` tag:
```tsx
<html lang="en">
  <head>
    <style>{`
      :root {
        --color-bg-secondary: #f5f5f5;
        --color-text-primary: #0a0a0a;
        --color-text-secondary: #525252;
        --color-interactive: #0a0a0a;
        --color-interactive-text: #fafafa;
      }
    `}</style>
  </head>
  <body style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)' /* ... */ }}>
```

**Priority:** LOW -- design system violation is justified here, just needs documentation.

---

### F5. CF-16: Auth pages are entire-page client components

**Root Cause:** `sign-in/page.tsx` and `sign-up/page.tsx` are marked `"use client"` at line 1. The entire page tree becomes a client component, losing server-rendering benefits.

**Fix: Split into server page + client form component**

```tsx
// src/app/(auth)/sign-in/page.tsx (server component)
import { SignInForm } from "./sign-in-form";

export default function SignInPage() {
  return (
    <main id="main-content" className="flex min-h-screen items-center justify-center bg-[var(--color-bg-secondary)]">
      <div className="w-full max-w-md border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-8)]">
        <h1 className="mb-[var(--space-6)] text-center text-2xl font-bold text-[var(--color-text-primary)]">
          Sign In
        </h1>
        <SignInForm />
      </div>
    </main>
  );
}
```

```tsx
// src/app/(auth)/sign-in/sign-in-form.tsx (client component)
"use client";

import { Suspense, useState } from "react";
// ... move form logic here
```

The sign-in page already does this partially (wraps `SignInForm` in `Suspense`), but the `SignInForm` is defined in the same file with `"use client"` at line 1, making the whole file a client boundary.

The fix is to move `SignInForm` to a separate file (`sign-in-form.tsx`) and remove `"use client"` from `page.tsx`. Same for `sign-up/page.tsx`.

**Priority:** HIGH -- loses server-rendering benefits and is an architecture anti-pattern.

---

### F6. CF-67: Heading hierarchy skip -- WCAG 1.3.1

**Root Cause:** The protected layout uses `<h2>` for "ShossyWorks" in the header (line 35), but pages may use `<h1>` for their page title. If there is no `<h1>` before the `<h2>`, the heading hierarchy is broken.

**Fix:** Change the layout header to use a consistent heading level or make it a non-heading element:

Option A (preferred): Make the layout brand text a non-heading:
```tsx
<span className="text-lg font-semibold text-[var(--color-text-primary)]" aria-hidden="true">
  ShossyWorks
</span>
```

Option B: Each page provides its own `<h1>`, and the layout brand is a `<p>` or `<span>`. This ensures pages control the heading hierarchy.

**Priority:** MEDIUM -- WCAG 1.3.1 violation.

---

### F7. CF-65: Loading state lacks accessibility indication

**Root Cause:** `src/app/(protected)/loading.tsx` renders "Loading..." as plain text with no `role="status"` or `aria-live`.

**Fix:**
```tsx
export default function ProtectedLoading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-live="polite">
      <p className="text-sm text-[var(--color-text-secondary)]">Loading...</p>
    </div>
  );
}
```

**Priority:** MEDIUM.

---

### F8. CF-68: Sidebar landmarks lack accessible labels

**Root Cause:** The `<aside>` in `sidebar.tsx` and the `<nav>` inside it have no `aria-label` attributes.

**Fix:**
```tsx
<aside
  aria-label="Main navigation"
  className={/* existing */}
>
  {/* ... */}
  <nav aria-label="Primary" className="flex-1 p-[var(--space-2)]">
    {/* ... */}
  </nav>
</aside>
```

**Priority:** MEDIUM.

---

### F9. CF-28: Missing HSTS and CSP security headers

**Root Cause:** `next.config.ts` sets X-Frame-Options, X-Content-Type-Options, etc., but omits `Strict-Transport-Security` and `Content-Security-Policy`.

**Fix:**
```ts
async headers() {
  return [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        {
          key: "Permissions-Policy",
          value: "camera=(), microphone=(), geolocation=()",
        },
        { key: "X-DNS-Prefetch-Control", value: "on" },
        // ADD:
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains; preload",
        },
        {
          key: "Content-Security-Policy",
          value: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'",  // Next.js needs these
            "style-src 'self' 'unsafe-inline'",
            `connect-src 'self' ${process.env.NEXT_PUBLIC_SUPABASE_URL}`,
            "img-src 'self' data: blob:",
            "font-src 'self'",
            "frame-ancestors 'none'",
          ].join("; "),
        },
      ],
    },
  ];
},
```

Note: CSP with Next.js requires `unsafe-inline` and `unsafe-eval` for development. For production, Next.js supports nonce-based CSP. Start with the permissive CSP above, then tighten.

**Priority:** MEDIUM -- security hardening.

---

## Priority Summary

| Priority | ID | Fix | Effort |
|----------|-----|------|--------|
| CRITICAL | D1 | `server-only` Vitest alias + Next.js mocks | 1 hour |
| HIGH | D2 | `run_sql` migration + test docs | 2 hours |
| HIGH | D3 | Rewrite tautological auth tests | 1 hour |
| HIGH | D4 | Remove try/catch test wrappers | 30 min |
| HIGH | E1 | Set-based inserts in restore function | 3 hours |
| HIGH | E2 | Eliminate redundant `getNode()` re-fetches | 2 hours |
| HIGH | E3 | Single Supabase client per action | 1 hour |
| HIGH | E4 | Log all Supabase error codes | 15 min |
| HIGH | F1 | Fix nested `<main>` landmarks | 30 min |
| HIGH | F2 | Add `aria-label` to collapsed sidebar links | 15 min |
| HIGH | F5 | Split auth pages into server + client | 1 hour |
| MEDIUM | D5 | Smoke test skip-guard | 15 min |
| MEDIUM | E5 | Slim `createSnapshot` return type | 15 min |
| MEDIUM | E6 | Skip middleware `getUser()` for cookieless public | 30 min |
| MEDIUM | E7 | Error boundary logging | 30 min |
| MEDIUM | F3 | Global focus-visible styles | 30 min |
| MEDIUM | F6 | Fix heading hierarchy | 15 min |
| MEDIUM | F7 | Loading state aria attributes | 5 min |
| MEDIUM | F8 | Sidebar landmark labels | 10 min |
| MEDIUM | F9 | HSTS + CSP headers | 30 min |
| LOW | D6 | Coverage thresholds (after D1) | 15 min |
| LOW | F4 | Document global-error inline styles | 10 min |

**Total estimated effort:** ~15 hours for all fixes across 3 clusters.
