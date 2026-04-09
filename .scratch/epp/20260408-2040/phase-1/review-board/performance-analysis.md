# Performance Analyst — ShossyWorks Plan Update

## Summary

The 5 interaction decisions introduce several operations with non-obvious performance characteristics. The snapshot deep-copy is the highest-risk: copying 500-2000 nodes plus detail rows, notes, option memberships, and option sets in a single atomic transaction will require a carefully written server-side function to avoid timeout and lock contention. Full-text search with adjustable scope (single estimate vs project vs global) demands a composite GIN index strategy that accounts for the hierarchical filtering — naive `tsvector` indexes without estimate/project scoping will produce slow query plans. The option overlay query ("show estimate with Option A applied") uses a NOT EXISTS anti-join that must be benchmarked against an alternative LEFT JOIN approach. User preferences and client visibility are low-risk if indexed correctly but create silent performance traps if overlooked.

## Findings

### Finding 1: Snapshot Deep-Copy at Scale — Transaction Size and Lock Duration

- **Severity:** CRITICAL
- **Category:** Performance / Schema
- **Details:** The `deep_copy_estimate()` function (Section 8.2 of data architecture) must copy across 7-10 tables in a single transaction. For a residential estimate with 1,000 nodes, the operation involves:

  | Table | Rows per snapshot | Row size (est.) | Total per copy |
  |-------|------------------|-----------------|----------------|
  | estimate_nodes | 1,000 | ~500 bytes | ~500 KB |
  | node_item_details | ~700 (70% items) | ~400 bytes | ~280 KB |
  | node_assembly_details | ~100 | ~100 bytes | ~10 KB |
  | node_notes | ~200 (20% have notes) | ~300 bytes | ~60 KB |
  | node_option_memberships | ~300 | ~80 bytes | ~24 KB |
  | option_groups | ~10-20 | ~200 bytes | ~4 KB |
  | option_alternatives | ~30-60 | ~200 bytes | ~12 KB |
  | option_sets + selections | ~50 | ~150 bytes | ~7.5 KB |
  | broad_options + overrides | ~20 | ~150 bytes | ~3 KB |

  **Total per snapshot: ~900 KB of data, ~2,400 INSERT operations.**

  The critical concern is not raw data volume (trivial for Postgres) but:
  1. **Lock duration.** The entire source estimate is read-locked for consistency during the copy. If another user is editing the estimate via Supabase Realtime, their writes will block or be blocked.
  2. **ID remapping.** The function must maintain a temporary mapping table (`old_id -> new_id`) for estimate_nodes, then use it to remap parent_id, anchor_node_id, node_id in memberships, etc. This is an O(N) lookup for each of ~2,400 rows.
  3. **Trigger cascade.** Every INSERT into estimate_nodes fires the `maintain_node_path()` trigger (ltree update), the `track_node_changes()` history trigger, and the `inherit_option_memberships()` trigger. For 1,000 nodes, that is 3,000 trigger invocations. The path trigger does a recursive CTE for each node — on a fresh insert with no children this is cheap, but the trigger still runs.
  4. **History table bloat.** 1,000 INSERT history records are created per snapshot. With 10 snapshots per estimate, that is 10,000 history rows just from snapshots — not from real edits.

- **Recommendation:**
  1. **Use INSERT...SELECT with a CTE-based ID remapping table**, not row-by-row inserts. Pattern:
     ```sql
     WITH id_map AS (
       INSERT INTO estimate_nodes (id, estimate_id, parent_id, ...)
       SELECT gen_random_uuid(), $new_est_id, NULL, ... -- parent_id remapped in second pass
       FROM estimate_nodes WHERE estimate_id = $source_id
       RETURNING id, ... -- capture old_id somehow
     )
     ```
     Problem: `INSERT...SELECT` cannot easily capture old-to-new ID mapping. The recommended pattern is:
     - First: `SELECT id, gen_random_uuid() as new_id FROM estimate_nodes WHERE estimate_id = $source_id` into a temp table.
     - Then: `INSERT INTO estimate_nodes SELECT new_id, ..., (SELECT new_id FROM map WHERE old_id = en.parent_id) ... FROM estimate_nodes en JOIN map m ON en.id = m.old_id`.
     This is 2 queries for nodes instead of N, and the JOIN-based remapping is O(N log N) with index.
  2. **Disable triggers during snapshot copy**, then re-enable. Specifically:
     - `maintain_node_path()` — compute paths from the ID map directly in the INSERT, skipping the trigger entirely
     - `track_node_changes()` — snapshot inserts are NOT real edits; they should not pollute the history table. Add a session variable `SET LOCAL app.is_snapshot_copy = 'true'` and have the trigger skip when this is set.
     - `inherit_option_memberships()` — memberships are explicitly copied from the source; the trigger's auto-inheritance would be redundant and potentially incorrect.
  3. **Use `SET LOCAL lock_timeout = '5s'`** in the function to fail fast if the source estimate is locked by a concurrent edit, rather than blocking indefinitely.
  4. **Benchmark target: < 500ms for 1,000-node copy.** Postgres can INSERT 10K rows/second easily with bulk operations. 2,400 rows should complete in ~250ms if triggers are bypassed.

- **Dependencies:** Depends on trigger architecture decisions (can triggers check session variables?). Depends on history table design (should snapshots generate history?).
- **Effort:** Medium — the function itself is ~100 lines of SQL, but getting the trigger bypass and ID remapping correct is fiddly.

---

### Finding 2: Snapshot Storage Growth and Retention

- **Severity:** HIGH
- **Category:** Performance / Schema
- **Details:** The interaction decision says "manual snapshots at any point during lifecycle." There is no stated limit on snapshot count. For a realistic residential construction company:

  | Metric | Conservative | Aggressive |
  |--------|-------------|------------|
  | Active projects | 5-15 | 20-30 |
  | Estimates per project | 1-3 | 3-5 |
  | Snapshots per estimate | 3-5 | 10-20 |
  | Nodes per estimate | 200-500 | 500-2,000 |

  **Conservative total:** 15 projects x 2 estimates x 4 snapshots x 350 nodes = **42,000 snapshot node rows**
  **Aggressive total:** 25 projects x 4 estimates x 15 snapshots x 1,000 nodes = **1,500,000 snapshot node rows**

  Plus detail rows (70% of node count) and notes. The aggressive scenario puts **2-3 million rows** in the estimate_nodes table. While Postgres handles this fine in raw storage, the RLS policies use subqueries that scan `estimates` and potentially `client_project_access` — these will slow down as the row count grows if indexes are not precise.

  The current data architecture uses an `estimate_snapshots` table (from the interaction decisions) that would contain metadata, with the actual snapshot data living in the same `estimate_nodes` table (deep-copied with a different `estimate_id`). This means every query against `estimate_nodes` traverses snapshot data unless filtered.

- **Recommendation:**
  1. **Add a `is_snapshot BOOLEAN DEFAULT FALSE` column to the `estimates` table** (or use the snapshot status). Ensure all node queries filter on `estimates.is_snapshot = FALSE` by default.
  2. **Index: `CREATE INDEX idx_nodes_estimate_active ON estimate_nodes(estimate_id) WHERE estimate_id IN (SELECT id FROM estimates WHERE is_snapshot = FALSE)`** — but this is not a valid partial index syntax. Instead, ensure the `idx_nodes_estimate` index on `estimate_id` is sufficient and that the query planner uses it.
  3. **Consider archiving old snapshots to a separate schema or partitioning by project_id** if row counts exceed 1M. Postgres table partitioning by `estimate_id` range is overkill at this scale but worth noting as a future option.
  4. **Set a soft limit of 20 snapshots per estimate** in the application layer. Display a warning at 15. This is a UX decision, not a database limit.

- **Dependencies:** Needs estimate_snapshots table design finalized.
- **Effort:** Low — one column, one application-level check.

---

### Finding 3: Full-Text Search with Adjustable Scope — GIN Index Design

- **Severity:** HIGH
- **Category:** Performance / Schema
- **Details:** Decision 5 specifies search across three scopes: single estimate, all estimates in a project, and global (all projects). The data architecture (Section 6.2) shows a GIN index on catalog_items but NOT on estimate_nodes. The interaction decisions call for GIN indexes on `estimate_nodes.name` and `estimate_nodes.description`.

  The naive approach:
  ```sql
  CREATE INDEX idx_nodes_fts ON estimate_nodes
    USING gin(to_tsvector('english', name || ' ' || COALESCE(description, '')));
  ```

  This index supports `WHERE to_tsvector(...) @@ to_tsquery(...)` but does NOT efficiently support scope filtering. The query planner must:
  - For single-estimate scope: intersect the GIN result with `estimate_id = $1` — this works IF the planner uses the btree index on `estimate_id` first and then filters.
  - For project scope: intersect with `estimate_id IN (SELECT id FROM estimates WHERE project_id = $1)` — this is a semi-join that the planner may or may not optimize.
  - For global scope: use the GIN index alone — fast.

  **The problem:** GIN indexes are most efficient when they narrow the result set significantly. Searching for "drywall" across all projects will match many nodes. Searching for "drywall" within a single 500-node estimate will match maybe 5-10. The GIN index helps the global case but is overkill for the single-estimate case where a sequential scan of 500 rows with ILIKE would be faster.

  **Additional concern:** The `node_notes` table (from the 2026-04-06 session decision) should also be searchable. Adding a separate GIN index on `node_notes.body` and joining to `estimate_nodes` for scope filtering adds a second dimension.

- **Recommendation:**
  1. **For single-estimate scope (the default and most common):** Do NOT use the GIN index. Use:
     ```sql
     SELECT * FROM estimate_nodes
     WHERE estimate_id = $1
       AND (name ILIKE '%' || $2 || '%' OR description ILIKE '%' || $2 || '%')
     ORDER BY sort_order;
     ```
     The `idx_nodes_estimate` btree index narrows to ~500 rows, then the ILIKE filter is a sequential scan on those 500 strings. This is <1ms on modern hardware. No GIN index needed.
  2. **For project scope:** Use the same ILIKE pattern but with `estimate_id IN (SELECT id FROM estimates WHERE project_id = $1 AND is_snapshot = FALSE)`. Still fast — maybe 5 estimates x 500 nodes = 2,500 rows to scan.
  3. **For global scope:** Use the GIN index with `tsvector`:
     ```sql
     SELECT en.*, e.name as estimate_name, p.name as project_name
     FROM estimate_nodes en
     JOIN estimates e ON en.estimate_id = e.id
     JOIN projects p ON e.project_id = p.id
     WHERE to_tsvector('english', en.name || ' ' || COALESCE(en.description, ''))
       @@ plainto_tsquery('english', $1)
       AND e.is_snapshot = FALSE
     ORDER BY ts_rank(...) DESC
     LIMIT 50;
     ```
  4. **Add a `search_vector tsvector` GENERATED column** instead of computing it in the query:
     ```sql
     ALTER TABLE estimate_nodes ADD COLUMN search_vector tsvector
       GENERATED ALWAYS AS (to_tsvector('english', name || ' ' || COALESCE(description, ''))) STORED;
     CREATE INDEX idx_nodes_search ON estimate_nodes USING gin(search_vector);
     ```
     This avoids recomputing the tsvector on every query and keeps the GIN index updated automatically.
  5. **For node_notes search:** Use a separate query with `JOIN estimate_nodes USING (node_id)` for scope filtering. Do NOT try to combine node search and note search in a single index — they are different tables with different access patterns.

- **Dependencies:** Needs the `search_vector` column added to Phase 1A schema. Needs the `is_snapshot` flag on estimates.
- **Effort:** Low — one generated column, one index, scope-aware query patterns.

---

### Finding 4: Active Tree Query with Option Filtering — Anti-Join Performance

- **Severity:** HIGH
- **Category:** Performance
- **Details:** The "active tree query" from Section 7.2 of the data architecture uses a NOT EXISTS anti-join:
  ```sql
  SELECT n.* FROM estimate_nodes n
  WHERE n.estimate_id = $1
  AND NOT EXISTS (
    SELECT 1 FROM node_option_memberships nom
    JOIN option_alternatives oa ON nom.option_alternative_id = oa.id
    WHERE nom.node_id = n.id AND oa.is_selected = FALSE
  )
  ORDER BY n.parent_id, n.sort_order;
  ```

  This query runs on EVERY tree load. For a 1,000-node estimate with 300 option membership rows and 60 alternatives, the NOT EXISTS subquery executes once per node (correlated subquery). The planner typically converts this to an anti-join, but the double-table subquery (nom JOIN oa) makes it harder to optimize.

  **Benchmark estimate for 1,000 nodes:**
  - Without options: simple btree scan on `estimate_id`, ~0.5ms
  - With NOT EXISTS + JOIN: 1,000 x (index lookup on nom.node_id + JOIN to oa) = ~2-5ms
  - This is acceptable but not negligible, especially with Supabase Realtime broadcasting changes frequently.

  **The "show with Option A applied" query pattern** (from the option sets interaction decision) is worse: it must temporarily override `is_selected` for specific alternatives without mutating the database, then re-run the tree query. This means the query cannot use the partial unique index on `is_selected = TRUE`.

- **Recommendation:**
  1. **Rewrite as LEFT JOIN with IS NULL** (equivalent semantics, sometimes better plan):
     ```sql
     SELECT n.* FROM estimate_nodes n
     LEFT JOIN node_option_memberships nom ON nom.node_id = n.id
     LEFT JOIN option_alternatives oa ON nom.option_alternative_id = oa.id
       AND oa.is_selected = FALSE
     WHERE n.estimate_id = $1
       AND oa.id IS NULL
     ORDER BY n.parent_id, n.sort_order;
     ```
  2. **For "show with option set applied" (preview without persisting):** Pass the option set's selections as a parameter and filter in the query:
     ```sql
     -- $2 = array of deselected alternative IDs for this scenario
     SELECT n.* FROM estimate_nodes n
     WHERE n.estimate_id = $1
     AND NOT EXISTS (
       SELECT 1 FROM node_option_memberships nom
       WHERE nom.node_id = n.id
       AND nom.option_alternative_id = ANY($2)
     )
     ```
     This avoids the JOIN to `option_alternatives` entirely — the application pre-computes which alternatives are deselected in the scenario and passes their IDs directly. Much faster.
  3. **Index: `CREATE INDEX idx_nom_node ON node_option_memberships(node_id)`** — critical for the anti-join. Without this, every NOT EXISTS does a sequential scan of the memberships table.
  4. **Index: `CREATE INDEX idx_nom_alt ON node_option_memberships(option_alternative_id)`** — needed for the reverse lookup ("which nodes belong to alternative X").
  5. **Consider materialized view for the active tree** if real-time collaborative editing requires sub-1ms tree loads. Refresh on option switch. Likely premature at this scale.

- **Dependencies:** Needs `node_option_memberships` indexes in Phase 1A. Needs the option set preview query pattern decided before implementing the option set comparison view.
- **Effort:** Low — indexes and query rewrite.

---

### Finding 5: ltree Path Updates on Subtree Move — O(k) Recursive UPDATE

- **Severity:** MEDIUM
- **Category:** Performance
- **Details:** The `maintain_node_path()` trigger (Section 2 of data architecture) fires on every INSERT and UPDATE of `parent_id`. On a move operation (re-parenting a subtree), it runs a recursive CTE to find all descendants and updates their paths.

  For the common case (move a single item): O(1) — just update the moved node's path. Fast.

  For the uncommon but real case (move a group with 50+ children): O(k) where k = subtree size. The recursive CTE walks the tree, then updates k rows. Each UPDATE fires the history trigger, adding k more history inserts.

  **Worst case:** Move a 200-node subtree. That is 200 path updates + 200 history inserts = 400 write operations in a single trigger invocation. At Supabase's default `statement_timeout = 30s`, this will complete, but it blocks the connection for ~50-100ms.

  **With Supabase Realtime:** The 200 row updates generate 200 Realtime events (if estimate_nodes has Realtime enabled). This is a burst that could overwhelm the client's merge logic.

- **Recommendation:**
  1. **Accept the O(k) cost** — it is fundamentally unavoidable with materialized paths. The alternative (recompute paths lazily) introduces inconsistency windows.
  2. **Batch the Realtime events.** Do not enable Postgres-level Realtime (WAL-based) on `estimate_nodes`. Instead, use Supabase Broadcast channels with application-level batching: the server action sends one "subtree moved" message with the root node ID, and clients re-fetch the affected subtree.
  3. **Add a guard in the trigger:** If the subtree exceeds 500 nodes, log a warning. No residential estimate should have a 500-node subtree under a single parent, but if it happens, the trigger will be slow.
  4. **For the snapshot deep-copy (Finding 1):** The path trigger fires on every INSERT. For 1,000 nodes, that is 1,000 trigger invocations each computing a path. If nodes are inserted in topological order (parents before children), each invocation is O(1) — the parent's path already exists. If inserted in arbitrary order, some invocations require a recursive lookup. **Insert nodes in topological (level-first) order** in the deep-copy function.

- **Dependencies:** Interacts with Finding 1 (snapshot copy) and real-time collaboration architecture.
- **Effort:** Trivial — topological ordering in the copy function, application-level Realtime batching.

---

### Finding 6: Client Visibility Filtering — Index Design for RLS

- **Severity:** MEDIUM
- **Category:** Performance / Security
- **Details:** Decision 2 adds `client_visible` (boolean) to `estimate_nodes`. The data architecture already has `client_visibility VARCHAR(20)` with three values: `visible`, `hidden`, `summary_only`. The RLS policy for clients is:
  ```sql
  WHERE client_visibility != 'hidden'
    AND estimate_id IN (SELECT id FROM estimates WHERE project_id IN (...))
  ```

  This filter runs on EVERY client-facing query. The `estimate_id` btree index narrows the scan, but the `client_visibility != 'hidden'` predicate must be evaluated for every row in the result set.

  **For typical estimates:** 80-90% of nodes are `visible`. The filter rejects 10-20%. This means the filter is not very selective — it does not significantly narrow the result set. A partial index on `client_visibility = 'hidden'` would be counter-productive (index on the minority case is useful for finding hidden nodes, not for excluding them).

  **The real concern** is the RLS subquery chain: `estimate_id IN (SELECT ... WHERE project_id IN (SELECT ... WHERE client_user_id = auth.uid()))`. This is two nested subqueries evaluated for every row. Without proper indexes on `estimates(project_id)` and `client_project_access(client_user_id)`, this becomes a performance cliff.

- **Recommendation:**
  1. **Add a composite index:** `CREATE INDEX idx_estimates_project ON estimates(project_id, id)` — this turns the `estimate_id IN (SELECT id FROM estimates WHERE project_id = $1)` subquery into an index-only scan.
  2. **Add index on client_project_access:** `CREATE INDEX idx_cpa_client ON client_project_access(client_user_id, project_id)` — this turns the innermost subquery into an index-only scan.
  3. **Do NOT add an index on `client_visibility`** — the column has only 3 values and 80%+ are `visible`. A btree index on a low-cardinality column is wasteful. The sequential filter on the already-narrowed result set is fast enough.
  4. **Consider a security-definer function** for the client tree query instead of relying on RLS with nested subqueries. A function with `SECURITY DEFINER` can use a pre-validated project_id parameter and skip the auth.uid() subquery chain:
     ```sql
     CREATE FUNCTION get_client_tree(p_estimate_id UUID, p_client_user_id UUID)
     RETURNS SETOF estimate_nodes AS $$
       SELECT * FROM estimate_nodes
       WHERE estimate_id = p_estimate_id
         AND client_visibility != 'hidden'
         AND EXISTS (SELECT 1 FROM client_project_access cpa
           JOIN estimates e ON cpa.project_id = e.project_id
           WHERE e.id = p_estimate_id AND cpa.client_user_id = p_client_user_id)
     $$ LANGUAGE sql SECURITY DEFINER STABLE;
     ```
     The EXISTS check runs once (not per-row), then the filtered scan is trivial.
  5. **The `summary_only` visibility mode** has performance implications for the calculation display: the client must see totals for summary_only nodes but not their children. This requires the tree query to include summary_only nodes and their aggregated values but exclude their children. This is a tree-level filter, not a row-level filter — the client-side `buildTree()` function must handle it, not the database query.

- **Dependencies:** Needs `client_project_access` table design. Needs RLS policy design.
- **Effort:** Low — indexes and optional function.

---

### Finding 7: User Preferences — JSON vs. Columns and Read/Write Frequency

- **Severity:** LOW
- **Category:** Performance / Schema
- **Details:** Decision 3 specifies two preference stores:
  1. **user_preferences** — UI state per user (sidebar, theme, last page, etc.)
  2. **Per-estimate view state** — column visibility, expanded nodes, sort order, zoom — stored per user per estimate.

  The data architecture already has `column_config JSONB` and `view_settings JSONB` on the `estimates` table. But these are per-estimate, not per-user-per-estimate. With multi-user (from addendum 1.1), two users viewing the same estimate need independent view states.

  **Read/write frequency analysis:**
  - User preferences (theme, sidebar): read once per session start, written rarely (user changes theme). **JSONB is fine.** No query performance concern.
  - Per-estimate view state (expanded nodes): read on every estimate open, written on every expand/collapse interaction. For a 1,000-node tree where the user frequently expands/collapses groups, this could mean 5-10 writes per minute.

  **The expanded nodes problem:** Storing `expandedIds: UUID[]` as JSONB means every expand/collapse operation rewrites the entire JSON array. For 200 expanded nodes, this is a ~6 KB JSONB write per toggle. With Supabase Realtime, each write generates a WAL event. At 10 writes/minute, that is ~60 KB/minute of WAL for one user's UI state.

- **Recommendation:**
  1. **Create a `user_estimate_preferences` table:**
     ```sql
     CREATE TABLE user_estimate_preferences (
       user_id UUID REFERENCES auth.users(id),
       estimate_id UUID REFERENCES estimates(id),
       view_state JSONB DEFAULT '{}',
       updated_at TIMESTAMPTZ DEFAULT NOW(),
       PRIMARY KEY (user_id, estimate_id)
     );
     ```
  2. **Use JSONB for view_state** — the data is opaque to the database, never queried by structure. This aligns with the JSONB vs. normalized decision framework in Section 12.
  3. **Debounce writes.** The application should debounce expand/collapse state changes and write at most once every 5 seconds. Do NOT write on every toggle.
  4. **Do NOT use Supabase Realtime on this table.** View state is per-user — there is no need to broadcast one user's expand/collapse to other users.
  5. **Move `column_config` and `view_settings` off the `estimates` table** to the new `user_estimate_preferences` table. The estimates table should not store per-user state — it is shared.

- **Dependencies:** Needs the multi-user architecture from addendum 1.1. Needs the `user_estimate_preferences` table in Phase 1A.
- **Effort:** Low — one table, debounce logic in the client.

---

### Finding 8: Option Set Comparison — Combinatorial Calculation Cost

- **Severity:** MEDIUM
- **Category:** Performance
- **Details:** Decision 2 and the option sets architecture (Section 7.3) describe a comparison view where multiple option sets are displayed side-by-side with their totals. Each option set represents a different combination of inline and broad option selections.

  The comparison requires:
  1. For each option set, determine the active tree (which alternatives are selected)
  2. For each option set, resolve parameter values (which broad options are active)
  3. For each option set, calculate the full tree total

  **Cost per scenario:** The TypeScript calculation engine processes all ~1,000 nodes in <1ms (per the real-time collaboration research). So 6 scenarios = ~6ms of calculation. This is fast.

  **The database cost:** If each scenario requires a separate tree query (to get the active nodes per scenario), that is 6 queries x ~2-5ms = ~12-30ms. This is acceptable but could be optimized.

  **The real performance risk:** Broad options override project parameters, which change formula results, which change quantities, which cascade through purchasing constraints. The calculation engine must re-evaluate EVERY formula in the tree for each scenario. If the estimate has 50 formula-based quantities, each requiring a math.js evaluation, that is 50 evaluations x 6 scenarios = 300 math.js calls. math.js `evaluate()` is ~0.01ms per call, so 300 calls = ~3ms. Still fast.

  **Conclusion:** Option set comparison is NOT a performance concern at the expected scale. The concern would arise at >20 option sets with >5,000 nodes, which is unrealistic for residential construction.

- **Recommendation:**
  1. **Fetch the full node tree ONCE**, then apply option filtering in TypeScript (client-side) for each scenario. Do NOT run a separate database query per scenario.
  2. **Cache the active tree per scenario** in the comparison view component. Only recalculate a scenario when its option selections change.
  3. **Lazy-calculate:** Only compute scenario totals when the comparison view is opened, not on every option change.

- **Dependencies:** Needs the isomorphic calculation engine from Phase 2.
- **Effort:** Trivial — architecture already supports this pattern.

---

### Finding 9: History Table Growth from Triggers

- **Severity:** MEDIUM
- **Category:** Performance / Schema
- **Details:** The architecture specifies history triggers on `estimate_nodes`, `node_item_details`, and `node_assembly_details`. Every UPDATE and DELETE creates a history row. Combined with:
  - Snapshot deep-copies (Finding 1): 1,000 INSERTs per snapshot — if the INSERT trigger also logs history, that is 1,000 history rows per snapshot.
  - Real-time collaboration: multiple users editing at ~1 edit/5 seconds = 12 edits/minute x 2 users x (1 node update + 1 detail update) = ~48 history rows/minute.
  - Auto-promotion/demotion triggers: each promotion generates 2 UPDATEs (node_type change + detail archive) = 2 history rows per promotion.
  - ltree path updates on move: k rows updated = k history rows.

  **Projected growth for active use:**
  - Per estimate per session (~2 hours): ~5,000 history rows
  - Per estimate lifetime: ~50,000 history rows
  - 20 active estimates: ~1,000,000 history rows

  The history tables will be the largest tables in the database. Without partitioning or archiving, queries like "what changed today?" will scan an increasingly large table.

- **Recommendation:**
  1. **Do NOT log INSERT operations in history triggers.** The current trigger (Section 8.3) only fires on UPDATE and DELETE — confirm this is preserved. Snapshot INSERTs should not generate history.
  2. **Add indexes on history tables:**
     ```sql
     CREATE INDEX idx_nodes_history_node ON estimate_nodes_history(id, changed_at DESC);
     CREATE INDEX idx_nodes_history_date ON estimate_nodes_history(changed_at);
     CREATE INDEX idx_nodes_history_estimate ON estimate_nodes_history(estimate_id, changed_at DESC);
     ```
     Note: the column referenced above as `id` should be the original node's `id`, not `history_id`. Ensure the history table schema uses a clear name like `original_node_id` to avoid confusion.
  3. **Implement a retention policy:** Archive history rows older than 1 year into a `_history_archive` table or delete them. Run as a monthly cron job.
  4. **Consider partitioning by month** if history exceeds 10M rows. Range partitioning on `changed_at` enables efficient pruning and query scoping.

- **Dependencies:** Needs history table schema finalized.
- **Effort:** Low — indexes and a retention cron job.

---

### Finding 10: `estimate_nodes` Table — Composite Index Strategy

- **Severity:** MEDIUM
- **Category:** Performance
- **Details:** The data architecture defines 7 indexes on `estimate_nodes`. With the 5 interaction decisions adding new query patterns, the index set needs review:

  **Current indexes:**
  1. `idx_nodes_estimate(estimate_id)` — tree loading
  2. `idx_nodes_parent(parent_id)` — child lookup
  3. `idx_nodes_tree_order(estimate_id, parent_id, sort_order)` — ordered tree traversal
  4. `idx_nodes_phase(phase_id) WHERE phase_id IS NOT NULL` — phase filtering
  5. `idx_nodes_reference(estimate_id, reference_name) WHERE reference_name IS NOT NULL` — formula resolution
  6. `idx_nodes_path USING gist(path)` — ltree subtree queries
  7. `idx_nodes_cost_code(cost_code_id) WHERE cost_code_id IS NOT NULL` — cost code filtering

  **New indexes needed from the 5 decisions:**
  8. Full-text search GIN index (Finding 3)
  9. `client_visibility` — NOT needed as a standalone index (Finding 6)
  10. Composite `(estimate_id, client_visibility)` — potentially useful for client queries, but low selectivity of `client_visibility` makes this marginal

  **Concern:** 8+ indexes on a table with frequent writes (every node edit, every tree move, every recalculation) means every write operation must update 8+ index structures. For a 1,000-node bulk recalculation (updating all cost fields), that is 1,000 x 8 = 8,000 index updates.

  The btree indexes are fast to update (O(log n)). The GiST index on ltree is moderately expensive. The GIN index on tsvector is the most expensive — GIN indexes use a "pending list" that gets merged periodically, which can cause write latency spikes.

- **Recommendation:**
  1. **Keep all 7 existing indexes** — they are necessary for the core query patterns.
  2. **Add the GIN index on `search_vector`** (Finding 3) — necessary for global search.
  3. **Do NOT add indexes for `client_visibility` or `highlight`** — too low-cardinality.
  4. **Monitor GIN index pending list** with `SELECT * FROM pg_stat_user_indexes WHERE indexrelname = 'idx_nodes_search'`. If `idx_tup_insert` grows faster than `idx_tup_fetch`, the GIN pending list is backing up.
  5. **Set `gin_pending_list_limit` for the index** to control merge frequency:
     ```sql
     ALTER INDEX idx_nodes_search SET (gin_pending_list_limit = 256); -- 256 KB
     ```
     This triggers more frequent merges, reducing peak write latency at the cost of slightly higher average write overhead.
  6. **Consider deferring the GIN index to Phase 1B** when search UI is actually built. In Phase 1A, the index exists but is never queried — pure write overhead with no read benefit.

- **Dependencies:** Depends on when search UI is built.
- **Effort:** Trivial — index creation is one line, but monitoring and tuning require ongoing attention.

---

## Recommendations for Plan Update

### Phase 1A Additions (Schema)

1. **`estimate_snapshots` table** with metadata (name, timestamp, user, status_at_time, source_estimate_id, snapshot_estimate_id). The snapshot data lives in existing tables with a new `estimate_id` — no separate snapshot storage tables.
2. **`is_snapshot BOOLEAN DEFAULT FALSE`** on the `estimates` table, or use a relationship via `estimate_snapshots.snapshot_estimate_id`.
3. **`search_vector tsvector GENERATED ALWAYS AS (...) STORED`** on `estimate_nodes`. Defer the GIN index to Phase 1B if desired.
4. **`user_estimate_preferences` table** with composite PK `(user_id, estimate_id)` and JSONB `view_state`.
5. **Move `column_config` and `view_settings` off `estimates`** to `user_estimate_preferences`.
6. **`deep_copy_estimate()` function** as a single server-side SQL function with trigger bypass for snapshot copies. Include `app.is_snapshot_copy` session variable support.
7. **History trigger should check** `current_setting('app.is_snapshot_copy', true) != 'true'` before inserting history rows.
8. **Indexes on `node_option_memberships`:** `(node_id)` and `(option_alternative_id)`.
9. **Indexes on `client_project_access`:** `(client_user_id, project_id)`.
10. **Indexes on `estimates`:** `(project_id, id)`.

### Phase 1A Ordering

1. **Build `deep_copy_estimate()` LAST in Phase 1A** — it depends on every other table existing.
2. **Build history triggers EARLY** — they should capture data from the moment tables exist (per architecture Section 8.4).
3. **Build the trigger bypass mechanism (`app.is_snapshot_copy`)** alongside the history triggers, not as an afterthought.

### Phase 1B Additions

1. **GIN index on `search_vector`** — build when search UI is built.
2. **Search query functions** — scope-aware (estimate/project/global) with the patterns from Finding 3.
3. **Option set comparison view** — fetch tree once, filter in TypeScript per scenario.

## Questions for Other Board Members

1. **For the Schema Architect:** The `deep_copy_estimate()` function needs to handle 7-10 tables with FK remapping. Should this be a single monolithic function or a series of composable sub-functions (copy_nodes, copy_details, copy_options)? Monolithic is faster (one transaction, no inter-function overhead) but harder to maintain.

2. **For the Security Analyst:** The trigger bypass mechanism (`SET LOCAL app.is_snapshot_copy = 'true'`) means any caller who sets this variable skips history tracking. How do we ensure only the `deep_copy_estimate()` function can set this? Should the function be `SECURITY DEFINER` with the variable set internally?

3. **For the Data Integrity Analyst:** The snapshot deep-copy function has a critical FK remapping step (Finding 1, step 6 in the architecture). If the remapping is wrong, option memberships in the snapshot point to the original estimate's alternatives, creating a cross-estimate dependency. What validation can we add to the function to assert that all FKs in the snapshot point only to snapshot-internal IDs?

4. **For the API/Contract Analyst:** The `user_estimate_preferences` table introduces a new data access pattern — per-user-per-estimate state. Does this need a contract? It crosses the boundary between user preferences and estimate data, and multiple features (expand state, column config, sort order) depend on it.

5. **For all members:** The interaction decisions mention "highlight/flag nodes" (Decision 2) with a `highlight` field. This is likely a boolean or enum on `estimate_nodes`. What are the query patterns for highlighted nodes? If it is "show me all flagged items," a partial index `WHERE highlight = TRUE` is cheap and useful. If it is "sort by highlight status," it needs to be included in the sort order index.
