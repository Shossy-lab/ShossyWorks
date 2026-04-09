# Performance Analyzer Findings

**Reviewer:** A9 — Performance Analyzer
**Date:** 2026-04-09
**Scope:** Server actions, SQL functions, middleware, query patterns, bundle concerns

---

## PERF-01: restore_estimate_snapshot() uses row-by-row loops instead of set-based inserts [HIGH]

**File:** `supabase/migrations/20260409000011_functions.sql:970-1102`
**Impact:** O(n) individual INSERT statements for each node, detail row, note, option group, alternative, membership, broad option, override, option set, and selection during restore. For an estimate with 500 nodes, this means 500+ individual INSERT statements just for nodes, plus hundreds more for detail rows.

**Evidence:**
```sql
-- Line 972-997: Nodes inserted one at a time in a FOR LOOP
FOR v_rec IN SELECT * FROM jsonb_array_elements(v_snapshot_data->'nodes')
LOOP
    INSERT INTO public.estimate_nodes (...) VALUES (...);
END LOOP;

-- Line 1000-1007: SECOND loop to set parent_id (another 500 UPDATEs)
FOR v_rec IN SELECT * FROM jsonb_array_elements(v_snapshot_data->'nodes')
LOOP
    IF v_rec->>'parent_id' IS NOT NULL THEN
      UPDATE public.estimate_nodes SET parent_id = ...
      WHERE id = ...;
    END IF;
END LOOP;

-- Lines 1027-1062, 1065-1082, 1085-1102, 1105-1225: Same row-by-row pattern
-- for item_details, assembly_details, node_notes, option_groups,
-- option_alternatives, option_memberships, broad_options,
-- broad_option_overrides, option_sets, option_set_selections,
-- option_set_broad_selections (12 separate FOR LOOPs total)
```

**Contrast with deep_copy_estimate():** The `deep_copy_estimate()` function (lines 100-497) correctly uses set-based `INSERT ... SELECT` for all operations, which is dramatically faster. The `create_estimate_from_snapshot()` function (lines 1249-end) also uses set-based operations with temp table mappings. Only `restore_estimate_snapshot()` uses the slow row-by-row approach.

**Fix:** Rewrite `restore_estimate_snapshot()` to use set-based operations like `create_estimate_from_snapshot()` does. The node insert can use `INSERT INTO ... SELECT ... FROM jsonb_array_elements()` in a single statement, with a second UPDATE for parent_id (also set-based). This would reduce ~12 FOR LOOPs to ~12 set-based statements.

---

## PERF-02: Every node mutation triggers a redundant full re-fetch via getNode() [HIGH]

**File:** `src/lib/actions/nodes.ts:161,307,356,392,425,561,583,622`
**Impact:** Every write operation on a node (create, update, updateItemDetails, updateAssemblyDetails, moveNode, duplicateNode, flagNode, setNodeVisibility) ends with `return getNode(id)` which performs 1-3 additional database queries (fetch node + conditionally fetch item_details or assembly_details). This doubles the round-trips for every mutation.

**Evidence:**
```typescript
// Line 161: createNode ends with full re-fetch
return getNode(node.id);

// Line 307: updateNode already has the updated data from .select(), re-fetches anyway
const { data, error } = await supabase
    .from("estimate_nodes").update(updates).eq("id", id).select().single();
if (error) return handleSupabaseError(error);
return getNode(data.id);  // <-- wasteful: data already returned above

// Lines 356, 392: updateItemDetails and updateAssemblyDetails
// don't use .select() on the detail update, then call getNode which
// fetches the base node AND the detail row separately

// Lines 561, 583, 622: duplicateNode, flagNode, setNodeVisibility
// all end with getNode re-fetch
```

**Impact per operation:**
- `updateNode`: 1 unnecessary query (already had data from `.select()`)
- `updateItemDetails`/`updateAssemblyDetails`: 2 queries that could be 1 if .select() were used
- `createNode`: acceptable (needs to compose data from multiple tables)
- `flagNode`: 1-3 queries for a boolean toggle

**Fix:** For `updateNode` and `moveNode`, use the data already returned from `.select().single()` and compose the result locally. For `flagNode`, add `.select().single()` to the update and compose locally. For detail updates, either return the updated row from the update query or batch the node+detail fetch into a single RPC.

---

## PERF-03: getAuthenticatedClient() creates two Supabase clients per action call [HIGH]

**File:** `src/lib/actions/_shared.ts:19-22` and `src/lib/auth/get-user.ts:8-15`
**Impact:** Every server action call creates TWO Supabase server clients. `requireUser()` (line 20) internally calls `createClient()` (get-user.ts:9) to check auth, then `getAuthenticatedClient()` creates a second client (line 21). Each `createClient()` call reads the cookie store via `await cookies()`.

**Evidence:**
```typescript
// _shared.ts:19-22
export async function getAuthenticatedClient() {
  const user = await requireUser();   // creates client #1 internally
  const supabase = await createClient(); // creates client #2
  return { user, supabase };
}

// get-user.ts:8-15  (called by requireUser)
export const getUser = cache(async () => {
  const supabase = await createClient();  // <-- client #1 created here
  const { data: { user }, error } = await supabase.auth.getUser();
  return { user, error };
});
```

**Mitigating factor:** `getUser` is wrapped in React `cache()`, so within a single request, the `supabase.auth.getUser()` call itself is deduplicated. However, `createClient()` is NOT cached -- the cookie-based client construction runs twice. Additionally, `createClient()` calls `await cookies()` which is async on Next.js 16.

**Fix:** Refactor `getAuthenticatedClient()` to create a single client and reuse it for both auth checking and the returned client:
```typescript
export async function getAuthenticatedClient() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/sign-in");
  return { user, supabase };
}
```

---

## PERF-04: createSnapshot fetches full snapshot_data JSONB blob after creation [MEDIUM]

**File:** `src/lib/actions/snapshots.ts:68-76`
**Impact:** After creating a snapshot via RPC (which serializes the entire estimate tree into JSONB), the action immediately re-fetches the full snapshot row including the potentially multi-megabyte `snapshot_data` column. This data is returned to the client over the wire but is almost certainly not needed immediately after creation.

**Evidence:**
```typescript
// Line 68-76: Fetches full snapshot including snapshot_data
const { data, error } = await supabase
    .from("estimate_snapshots")
    .select("*")     // <-- includes snapshot_data JSONB blob
    .eq("id", snapshotId)
    .single();
```

The `listSnapshots` action (line 79-99) correctly excludes `snapshot_data` by selecting specific columns. But `createSnapshot` returns the full row type `EstimateSnapshotRow` which includes it.

**Fix:** After creation, fetch only metadata columns (same as `listSnapshots`). Change the return type to `SnapshotMeta` (already defined on line 21). The caller can use `getSnapshot()` if they later need the full data.

---

## PERF-05: duplicateNode performs sequential serial queries for a multi-step copy [MEDIUM]

**File:** `src/lib/actions/nodes.ts:452-562`
**Impact:** `duplicateNode` performs up to 7 sequential database round-trips: (1) getNode to fetch source, (2) insert base node, (3) insert detail row, (4) fetch notes, (5) insert notes, (6) getNode to fetch result (which is 1-3 more queries). For a single node copy, this is 5-8 round-trips.

**Evidence:**
```typescript
// Line 463: Round-trip 1 - fetch source
const sourceResult = await getNode(nodeId);

// Line 468: Round-trip 2 - insert node
const { data: newNode, error: nodeError } = await supabase
    .from("estimate_nodes").insert({...}).select().single();

// Line 488-517: Round-trip 3 - insert detail (item or assembly)

// Line 541-543: Round-trip 4 - fetch notes
const { data: notes, error: notesError } = await supabase
    .from("node_notes").select("*").eq("node_id", nodeId);

// Line 547-558: Round-trip 5 - insert notes (if any)

// Line 561: Round-trip 6-8 - getNode re-fetch
return getNode(newNode.id);
```

**Fix:** This should be an RPC function (like `deep_copy_estimate` but for a single node subtree) to do everything in one round-trip. Alternatively, use `Promise.all` for independent fetches (e.g., fetch source node and notes in parallel), and avoid the final getNode re-fetch by composing the result from already-available data.

---

## PERF-06: Missing index on node_item_details.vendor_id [MEDIUM]

**File:** `supabase/migrations/20260409000005_catalog_options_vendors.sql:51-58`
**Impact:** The `vendor_id` column on `node_item_details` has a FK to `vendors` but no index. When a vendor is deleted (ON DELETE SET NULL), PostgreSQL must scan all `node_item_details` rows to find matching vendor_id values. For large estimates this becomes a sequential scan on the detail table.

**Evidence:**
```sql
-- Migration 5, line 51-58: vendor_id FK added without index
ALTER TABLE public.node_item_details
  ADD COLUMN IF NOT EXISTS vendor_id UUID;

ALTER TABLE public.node_item_details
  ADD CONSTRAINT fk_item_details_vendor
  FOREIGN KEY (vendor_id)
  REFERENCES public.vendors(id)
  ON DELETE SET NULL;
```

The migration 9 index audit (lines 1-35 of `20260409000009_indexes_and_seed_data.sql`) explicitly lists existing indexes but does not include a vendor_id index. The `unit_id` column on the same table HAS an index (`idx_item_details_unit`), making this an oversight.

**Fix:** Add `CREATE INDEX idx_item_details_vendor ON public.node_item_details(vendor_id) WHERE vendor_id IS NOT NULL;`

---

## PERF-07: Middleware creates Supabase client + calls getUser() on every matched request [MEDIUM]

**File:** `src/lib/supabase/middleware.ts:13-91`
**Impact:** Every non-static request (matched by the regex in `src/middleware.ts:9-11`) creates a Supabase server client and calls `supabase.auth.getUser()` which makes a network call to Supabase Auth. This includes requests for public routes like `/sign-in` and `/sign-up`.

**Evidence:**
```typescript
// middleware.ts line 17-18: isPublic is determined early...
const isPublic = isPublicRoute(pathname);

// ...but the Supabase client is still created and getUser() is still called
// for ALL routes (line 22-44), including public ones
const supabase = createServerClient<Database>(...);
const { data: { user } } = await supabase.auth.getUser();
```

The `isPublic` flag is checked AFTER the `getUser()` call (line 46). Public routes still pay the full auth overhead even though unauthenticated access is expected.

**Mitigating factor:** This is by Supabase design -- the middleware must refresh session cookies to prevent stale tokens. However, for truly unauthenticated routes (sign-in, sign-up), the getUser() call is wasted work.

**Fix:** For public routes where no user-conditional logic is needed (like `/sign-in`, `/sign-up`), skip the `getUser()` call entirely. Only call it when: (1) the route is protected, or (2) the route is public but has user-conditional redirects (like redirecting authenticated users away from sign-in). This would save ~50-100ms per request on public routes.

---

## PERF-08: `select("*")` used in list queries where column subsets would suffice [LOW]

**File:** `src/lib/actions/projects.ts:75`, `src/lib/actions/estimates.ts:83,109`, `src/lib/actions/nodes.ts:178,194,198`
**Impact:** List queries fetch all columns when the consuming components likely only need a subset. The `projects` table has 18 columns and `estimate_nodes` has 15 columns (including the stored `search_vector` TSVECTOR). Fetching `search_vector` on list queries is wasteful -- it's a derived column only useful for server-side search.

**Evidence:**
```typescript
// projects.ts:73-77 - getProjects fetches all 18 columns
const { data, error } = await supabase
    .from("projects")
    .select("*")
    .neq("status", PROJECT_STATUS.ARCHIVED)
    .order("updated_at", { ascending: false });

// nodes.ts:176-180 - getNodes fetches all nodes with search_vector
const { data: nodes, error: nodesError } = await supabase
    .from("estimate_nodes")
    .select("*")
    .eq("estimate_id", estimateId)
    .order("sort_order", { ascending: true });
```

**Note:** The `listSnapshots` action (snapshots.ts:90-96) correctly demonstrates the pattern by selecting only the needed columns and excluding `snapshot_data`.

**Fix:** Replace `select("*")` with explicit column lists in list queries. Particularly exclude `search_vector` from node list queries and `description`/address fields from project list queries if they're not displayed in list views.

---

## PERF-09: No history table partition strategy or cleanup mechanism [LOW]

**File:** `supabase/migrations/20260409000008_history_tables.sql`
**Impact:** History tables (`estimate_nodes_history`, `node_item_details_history`) grow unboundedly. Every UPDATE or DELETE on an estimate node or item detail creates a history row. For active estimates being edited frequently, this can produce thousands of history rows per estimate. There is no retention policy, archival mechanism, or partition strategy.

**Evidence:** The history tables have indexes on `changed_at DESC` (migration 9, lines 44-57) but no mechanism to prune old records. The `changed_by` column uses `current_setting('app.current_user_id', true)` but this setting is never SET by the server actions, meaning `changed_by` will always be NULL.

**Fix:** (1) Add a `changed_by` SET LOCAL in `getAuthenticatedClient` or create a wrapper that sets `app.current_user_id` before queries. (2) Plan a retention policy (e.g., keep 90 days of history, archive older). (3) Consider partitioning by `changed_at` month if history volume grows large.

---

## Summary

| ID | Severity | Finding |
|----|----------|---------|
| PERF-01 | HIGH | restore_estimate_snapshot() uses row-by-row loops (12 FOR LOOPs) instead of set-based inserts |
| PERF-02 | HIGH | Every node mutation triggers redundant full re-fetch via getNode() (doubles round-trips) |
| PERF-03 | HIGH | getAuthenticatedClient() creates two Supabase clients per server action call |
| PERF-04 | MEDIUM | createSnapshot fetches full snapshot_data JSONB blob unnecessarily after creation |
| PERF-05 | MEDIUM | duplicateNode performs 5-8 sequential round-trips for a single node copy |
| PERF-06 | MEDIUM | Missing index on node_item_details.vendor_id (FK without index) |
| PERF-07 | MEDIUM | Middleware calls getUser() on every request including public routes |
| PERF-08 | LOW | select("*") in list queries fetches unused columns (search_vector, etc.) |
| PERF-09 | LOW | History tables grow unboundedly with no retention/cleanup and changed_by always NULL |
