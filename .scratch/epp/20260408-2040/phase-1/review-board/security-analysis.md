# Security Analyst Analysis -- ShossyWorks Plan Update

## Summary (3-5 sentences)

The 5 interaction decisions introduce significant security surface area that the current codebase is not prepared for. The most critical gaps are: (1) no RLS policies exist on any application table beyond `user_roles`, meaning all new tables will be exposed via PostgREST unless policies are written alongside schema creation; (2) the PIN-protected share link system requires careful PIN hashing design because 6-digit PINs have only 1M combinations and bcrypt alone is insufficient without aggressive rate limiting at the database level, not just application level; (3) the `pending` role is already in the enum but the middleware and protected layout perform zero role-based filtering, meaning a pending user who somehow gets authenticated has full access to the protected area; (4) snapshot immutability has no database-level enforcement in any current design document -- it relies on application-level rejection which violates Design Principle #2; (5) the single-company model eliminates multi-tenant RLS complexity but creates a different risk -- every authenticated user can see every row unless role-specific policies are airtight.

## Findings

### Finding 1: No RLS Policies Exist on Application Tables

- **Severity:** CRITICAL
- **Category:** Security
- **Details:** The only RLS-enabled table in the deployed schema is `user_roles` (migration `00000000000001_auth_roles.sql`). The `security_fixes.sql` migration dropped the overpermissive policy, leaving only "Users can read their own role." When Phase 1A creates `projects`, `estimates`, `estimate_nodes`, `node_item_details`, `node_assembly_details`, `estimate_snapshots`, `user_preferences`, `company_settings`, `estimate_shares`, and all supporting tables, RLS must be enabled AND policies must be created IN THE SAME MIGRATION. Supabase's PostgREST auto-generates REST API endpoints for every table. Without RLS, the `anon` key (which is public, embedded in client-side JS) can read every row in every table. The current data architecture doc (section 14) has example policies but they reference `raw_user_meta_data->>'role'` (stale -- the hook now uses `app_metadata.user_role`) and `organization_id` (doesn't exist in this single-company design).
- **Recommendation:** Every Phase 1A migration file MUST follow this pattern: `CREATE TABLE` -> `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` -> `CREATE POLICY` (at minimum: staff full access, client filtered, anon denied). Create a reusable SQL helper function `get_user_role()` that reads from `auth.jwt() -> 'app_metadata' ->> 'user_role'` with a fallback to `'pending'` (not `'client'` as in the env-research doc). This function must be `SECURITY DEFINER SET search_path = ''` and created in the first Phase 1A migration before any table policies reference it. File path for helper: `supabase/migrations/20260408000001_rls_helpers.sql`.
- **Dependencies:** Blocks ALL Phase 1A table creation. Must be the first migration file.
- **Effort:** Medium (boilerplate per table, but must be done correctly for ~15+ tables)

### Finding 2: `pending` Role Has No Access Restrictions

- **Severity:** CRITICAL
- **Category:** Security
- **Details:** The `pending` role was added in `20260406000001_security_fixes.sql` and new users default to it. However, the middleware (`src/lib/supabase/middleware.ts`) only checks whether a user exists -- it does not check the user's role. The protected layout (`src/app/(protected)/layout.tsx`) likewise only checks `user` existence. A user who signs up and gets a `pending` role can access `/dashboard`, `/projects`, `/settings`, and any future protected route. The JWT contains `app_metadata.user_role = 'pending'` but nothing reads it. RLS policies (once created) will be the last line of defense, but the UI should not even render for pending users.
- **Recommendation:** Add role checking to middleware. After `getUser()`, extract `user.app_metadata?.user_role`. If role is `'pending'`, redirect to a `/pending-approval` page (new route, public, shows "your account is awaiting approval" message). The protected layout should also check role as a defense-in-depth measure. Critical: do NOT trust the client-provided session for role -- always use `getUser()` which validates the JWT server-side. File paths: `src/lib/supabase/middleware.ts`, `src/app/(protected)/layout.tsx`, new `src/app/(auth)/pending-approval/page.tsx`.
- **Dependencies:** Should be done before Phase 1A or as the first step of Phase 1A.
- **Effort:** Low

### Finding 3: Share Link PIN Hashing Requires Specific Design

- **Severity:** HIGH
- **Category:** Security
- **Details:** Decision 4 specifies PIN-protected share links for unauthenticated access. This is a fundamentally different threat model than the user PIN (Decision 12/research-pin-auth.md). The user PIN has a valid Supabase session + device trust cookie as prerequisites -- the share PIN is the ONLY authentication layer. A 6-digit PIN with 1M combinations is brute-forceable in minutes without rate limiting. Key differences from user PIN: (a) no device trust cookie to gate access, (b) no existing session to validate, (c) the attacker only needs a share URL (which may leak via email/referrer), (d) the endpoint must be accessible to `anon` users (no auth required). bcrypt with cost factor 10 is correct for the hashing algorithm, but the brute-force mitigation strategy must be more aggressive than the user PIN's 5-attempt/15-min lockout.
- **Recommendation:**
  1. **Hash:** bcrypt cost 12 (slightly higher than user PIN cost 10, since this is the sole auth layer). Argon2id would be ideal but adds a native dependency (`argon2` npm package requires node-gyp); bcrypt is acceptable given the other mitigations.
  2. **Rate limiting on the share link endpoint:** 5 failed attempts per share link ID per IP -> 30-minute lockout. Track in `estimate_shares` table: `failed_attempts INTEGER DEFAULT 0`, `locked_until TIMESTAMPTZ`. ALSO apply a global rate limit per IP (20 attempts per hour across ALL share links) to prevent attackers from trying different share URLs.
  3. **Expiration:** Share links MUST have `expires_at TIMESTAMPTZ NOT NULL`. No perpetual share links. Default: 30 days. Maximum: 90 days.
  4. **Share token:** The URL token should be a cryptographically random string (32+ bytes, base64url-encoded), NOT the share record's UUID. A UUID is guessable (v4 has 122 bits of entropy but attackers can enumerate). Use `crypto.randomBytes(32).toString('base64url')`.
  5. **PIN validation endpoint:** Must be a server action or API route, never client-side. The response must be constant-time regardless of whether the share link exists (prevent share link enumeration).
  6. **Session after PIN validation:** Issue a short-lived httpOnly cookie scoping the client to that specific estimate. Do NOT create a Supabase session for share-link users.
  7. **Database schema for `estimate_shares`:** `id UUID PK`, `estimate_id UUID FK`, `token VARCHAR(64) UNIQUE` (the URL token), `pin_hash TEXT NOT NULL`, `created_by UUID FK`, `created_at TIMESTAMPTZ`, `expires_at TIMESTAMPTZ NOT NULL`, `failed_attempts INTEGER DEFAULT 0`, `locked_until TIMESTAMPTZ`, `last_accessed_at TIMESTAMPTZ`, `is_revoked BOOLEAN DEFAULT FALSE`.
- **Dependencies:** Blocks Decision 4 implementation. Schema must be in Phase 1A; endpoint in Phase 1B+.
- **Effort:** Medium

### Finding 4: Client Role Access Needs Database-Level Filtering

- **Severity:** HIGH
- **Category:** Security
- **Details:** Decision 4 specifies clients can view estimates filtered by `client_visible`. The data architecture has `client_visibility` (not a boolean -- it's a VARCHAR with values `'visible'`, `'hidden'`, `'summary_only'`). Decision 2 says `client_visible` boolean on nodes. These conflict. The `summary_only` option is architecturally important -- it lets builders show a line item's name and total but hide the detailed breakdown (qty, unit cost, markup). This MUST be enforced at the RLS level, not just UI filtering. A client with browser dev tools could otherwise call the PostgREST API directly and read hidden nodes. The `client_project_access` junction table (from addendum) needs to gate which clients see which projects, AND the RLS policy on `estimate_nodes` must filter by `client_visibility != 'hidden'` for client-role users.
- **Recommendation:**
  1. **Resolve the field conflict:** Use `client_visibility VARCHAR(20) CHECK (client_visibility IN ('visible', 'hidden', 'summary_only'))` from the data architecture doc (not a simple boolean). The 3-value enum is architecturally correct.
  2. **RLS policy on `estimate_nodes` for clients:**
     ```sql
     CREATE POLICY "client_read_visible_nodes" ON estimate_nodes
     FOR SELECT TO authenticated
     USING (
       CASE WHEN get_user_role() IN ('owner', 'employee') THEN TRUE
       ELSE (
         client_visibility != 'hidden'
         AND estimate_id IN (
           SELECT e.id FROM estimates e
           JOIN client_project_access cpa ON cpa.project_id = e.project_id
           WHERE cpa.user_id = auth.uid()
         )
       )
       END
     );
     ```
  3. **`summary_only` enforcement:** For `summary_only` nodes, clients should see `name`, `total_price`, and `client_notes` but NOT `unit_cost`, `qty`, `contingency_rate`, `overhead_rate`, or detail table data. This requires either: (a) a separate RLS policy on `node_item_details` that blocks client access entirely for `summary_only` parent nodes, or (b) a PostgreSQL VIEW that conditionally nulls sensitive columns. Option (a) is simpler and more secure.
  4. **RLS on `node_item_details` and `node_assembly_details`:**
     ```sql
     CREATE POLICY "client_no_detail_on_hidden_summary" ON node_item_details
     FOR SELECT TO authenticated
     USING (
       CASE WHEN get_user_role() IN ('owner', 'employee') THEN TRUE
       ELSE EXISTS (
         SELECT 1 FROM estimate_nodes en
         WHERE en.id = node_item_details.node_id
         AND en.client_visibility = 'visible'
         AND en.estimate_id IN (
           SELECT e.id FROM estimates e
           JOIN client_project_access cpa ON cpa.project_id = e.project_id
           WHERE cpa.user_id = auth.uid()
         )
       )
       END
     );
     ```
     This blocks detail access for both `hidden` AND `summary_only` nodes.
- **Dependencies:** Requires `client_project_access` table. Requires `get_user_role()` helper.
- **Effort:** Medium

### Finding 5: Snapshot Immutability Has No Database Enforcement

- **Severity:** HIGH
- **Category:** Security
- **Details:** Decision 1 specifies snapshots are "read-only -- browsable, interactable, but never editable." The data architecture doc (section 8.2) says "Old versions are effectively immutable" with enforcement via "application logic -- edits to non-current versions are rejected." This violates Design Principle #2 ("The database enforces invariants"). An API consumer (or a bug in application code) could modify snapshot data via PostgREST. The `estimate_snapshots` table design from Decision 1 stores full node tree serialization, which is safer than the version-as-separate-estimate model. But whichever approach is used, immutability must be database-enforced.
- **Recommendation:** Two approaches depending on snapshot architecture:
  
  **If using `estimate_snapshots` table (Decision 1's approach -- serialized JSON):**
  - RLS: `FOR SELECT ONLY` policy for all roles. No INSERT/UPDATE/DELETE policies for `authenticated` users. Only `service_role` (admin client) can INSERT snapshots (via server action).
  - Add trigger: `BEFORE UPDATE OR DELETE ON estimate_snapshots` that raises an exception: `RAISE EXCEPTION 'Snapshots are immutable and cannot be modified or deleted'`. This blocks even service_role from accidental modification.
  - The "Restore from Snapshot" operation creates a NEW estimate state from the snapshot data -- it does not modify the snapshot itself.

  **If using version-as-separate-estimate model (data architecture section 8.2):**
  - Add `is_current BOOLEAN DEFAULT TRUE` to `estimates`.
  - Add trigger: `BEFORE UPDATE ON estimate_nodes` that checks `SELECT is_current FROM estimates WHERE id = NEW.estimate_id` and raises exception if false.
  - Same trigger on `node_item_details` and `node_assembly_details`.
  - RLS policy: non-current estimates are `SELECT` only for all roles.
  
  The first approach (serialized JSON snapshots) is simpler and more robust. You cannot accidentally modify individual nodes because the data is stored as a single JSONB blob, not as rows that RLS policies must protect individually.
- **Dependencies:** Must be decided before Phase 1A schema design: serialized snapshots vs. deep-copy versions.
- **Effort:** Low (serialized approach) / High (deep-copy approach, requires triggers on every mutable table)

### Finding 6: Share Link Session Scoping and the `anon` Role

- **Severity:** HIGH
- **Category:** Security
- **Details:** PIN-protected share links (Decision 4) require unauthenticated access. In Supabase, this means the `anon` key is used. Currently, ALL tables should have RLS policies that deny `anon` access (since the app requires authentication). Share links break this model -- the validation endpoint and the subsequent estimate viewing must work without a Supabase session. Two approaches: (a) use a server-side API route that validates the PIN, then uses the admin/service_role client to fetch data and returns a filtered response (the client never talks to Supabase directly), or (b) create special `anon` RLS policies gated by a share token. Option (a) is far safer -- it keeps the `anon` role locked down and centralizes share-link access control in application code that uses the admin client.
- **Recommendation:** Use approach (a): server-side API route with admin client.
  1. Share link validation: `POST /api/share/validate` receives `{ token, pin }`, validates against `estimate_shares` table using admin client, returns a signed short-lived cookie (`share_session`) containing `{ share_id, estimate_id, exp }`.
  2. Share link data fetching: `GET /api/share/estimate` checks the `share_session` cookie, uses admin client to fetch estimate data filtered by `client_visibility != 'hidden'`, with `summary_only` columns nulled.
  3. NEVER expose the admin client to the browser. All share-link API routes use `createAdminClient()` server-side.
  4. The `share_session` cookie: httpOnly, secure, sameSite=strict, 1-hour expiry, contains a signed JWT (use `jose` library or a simple HMAC with a server secret).
  5. RLS policies for `anon` on ALL tables: `CREATE POLICY "deny_anon" ON {table} FOR ALL TO anon USING (false)`. Zero exceptions. The share link flow bypasses RLS via the service role client.
- **Dependencies:** Requires `estimate_shares` table schema. Requires `/api/share/*` routes.
- **Effort:** Medium

### Finding 7: `company_settings` Table Requires Owner-Only Write Access

- **Severity:** MEDIUM
- **Category:** Security
- **Details:** Decision 3 specifies company-level settings (markup rates, overhead, tax rates, company info). These are business-critical values that directly affect every estimate's calculations. If an employee can modify default markup rates, they can silently change the profitability of every new estimate. The role permissions matrix (from research-pin-auth.md section 5) states only owner can access "Company settings" and "Billing & payments."
- **Recommendation:**
  ```sql
  CREATE POLICY "owner_read_write" ON company_settings
  FOR ALL TO authenticated
  USING (get_user_role() = 'owner')
  WITH CHECK (get_user_role() = 'owner');
  
  CREATE POLICY "employee_read" ON company_settings
  FOR SELECT TO authenticated
  USING (get_user_role() = 'employee');
  
  -- Clients and pending: no access
  ```
  Also enforce that there is exactly ONE `company_settings` row (single-company model). Use a CHECK constraint or a unique dummy column: `company_id TEXT NOT NULL DEFAULT 'singleton' UNIQUE`. This prevents accidental creation of multiple settings rows.
- **Dependencies:** None beyond the `get_user_role()` helper.
- **Effort:** Low

### Finding 8: `user_preferences` Table Must Be Scoped to Own User

- **Severity:** MEDIUM
- **Category:** Security
- **Details:** Decision 3 specifies per-user preferences (UI state, column visibility, expanded nodes). These are personal and should never be readable or writable by other users. The current codebase has no `user_preferences` table, but when created, its RLS policy must ensure `user_id = auth.uid()` on all operations.
- **Recommendation:**
  ```sql
  CREATE TABLE user_preferences (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
  
  CREATE POLICY "own_preferences_only" ON user_preferences
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
  ```
  Use JSONB for flexibility (UI state changes frequently). The PK being `user_id` ensures one row per user. No `pending` role access -- pending users should not be able to save preferences since they cannot access the app.
- **Dependencies:** None.
- **Effort:** Trivial

### Finding 9: Cross-Estimate Node Operations Need Authorization Checks

- **Severity:** MEDIUM
- **Category:** Security
- **Details:** Decision 2 specifies "Copy/paste between estimates (same or different project)." This creates a cross-resource authorization boundary. A server action that copies nodes from Estimate A to Estimate B must verify the user has access to BOTH estimates. For staff, this is trivially true (full access). For clients (if they ever get copy/paste), this requires checking `client_project_access` for both projects. More critically, the deep-copy function must not leak `client_visibility='hidden'` nodes if a client triggers a copy (which shouldn't be possible, but defense-in-depth).
- **Recommendation:** All cross-estimate operations must be server actions (never client-side Supabase calls). The server action should: (1) verify auth via `requireUser()`, (2) verify role is `owner` or `employee` (clients should not have copy/paste), (3) use the authenticated Supabase client (not admin) so RLS policies naturally filter access, (4) if using admin client for performance, manually verify estimate ownership before proceeding. Add this as a contract: `contracts/cross-estimate-operations.contract.md`.
- **Dependencies:** Blocks Decision 2 implementation.
- **Effort:** Low

### Finding 10: Full-Text Search Indexes Must Not Leak Hidden Data to Clients

- **Severity:** MEDIUM
- **Category:** Security
- **Details:** Decision 5 specifies full-text search across nodes with Postgres `tsvector`. If a client searches "all estimates in current project," the search results must respect `client_visibility`. If the search is implemented as a PostgreSQL function that returns matching node IDs, and the client then fetches those nodes via PostgREST, RLS will filter correctly. But if the search function returns node names/descriptions directly (bypassing RLS), hidden node data leaks through search results. Cross-project search ("global across all projects") is staff-only -- clients should never see nodes from projects they don't have access to.
- **Recommendation:**
  1. Search should be implemented as a PostgreSQL function (`search_nodes(query TEXT, scope TEXT, estimate_id UUID)`) that internally applies the same visibility/access filters as the RLS policies.
  2. The function should be `SECURITY INVOKER` (default), NOT `SECURITY DEFINER`, so it runs with the calling user's permissions and RLS applies naturally.
  3. Alternatively, if search is implemented via PostgREST's built-in text search operators, RLS policies will apply automatically. This is the simpler approach.
  4. For Phase 1A: create the GIN indexes but defer the search function to Phase 1B+. The indexes are read-only and pose no security risk.
- **Dependencies:** Depends on RLS policies being correct (Finding 1).
- **Effort:** Low (indexes in 1A, function in 1B+)

### Finding 11: Middleware Does Not Restrict Share Link Routes

- **Severity:** MEDIUM
- **Category:** Security
- **Details:** The current middleware matcher excludes API routes (`api/`), but the share link validation endpoint (`/api/share/validate`) will need to be accessible without authentication. The middleware currently redirects unauthenticated users to `/sign-in`. Share link pages (e.g., `/share/[token]`) must also be accessible without auth. These routes need to be added to `PUBLIC_ROUTES` in the middleware, but carefully -- only the share-specific routes, not a wildcard that could open other paths.
- **Recommendation:** Add `/share` to `PUBLIC_ROUTES` array in `src/lib/supabase/middleware.ts`. Since API routes are already excluded by the matcher, `/api/share/*` is already accessible. For the share viewing page (`/share/[token]`), add `"/share"` to `PUBLIC_ROUTES`. Do NOT add a wildcard like `"/s"` or `"/view"` -- keep the path specific and predictable.
- **Dependencies:** None until share links are implemented.
- **Effort:** Trivial

### Finding 12: The `handle_new_user()` Trigger Has a Race Condition with Role Defaults

- **Severity:** LOW
- **Category:** Security
- **Details:** The current `handle_new_user()` trigger (in `20260406000001_security_fixes.sql`) creates a `user_roles` row with `role = 'pending'`. The research-pin-auth.md document proposes a `user_profiles` table with a `role` column. Decision 3 adds `user_preferences`. These are three separate tables that all need to be created on signup. If Phase 1A introduces `user_profiles`, the `handle_new_user()` trigger needs to be updated to also create a `user_profiles` row. The current hook reads from `user_roles` -- if Phase 1A switches to `user_profiles.role`, the hook must also be updated. Having role in two places (`user_roles.role` AND `user_profiles.role`) is a consistency risk.
- **Recommendation:** Consolidate. Either: (a) keep `user_roles` as the authoritative role source (current implementation) and have `user_profiles` reference it via FK, or (b) merge `user_roles` into `user_profiles` and update the hook. Option (b) is cleaner -- `user_profiles` is a superset of `user_roles` (it has role + display_name + PIN fields). The hook already reads from `user_roles` -- update it to read from `user_profiles` instead. Migration: create `user_profiles`, migrate data from `user_roles`, update the hook, drop `user_roles`. This should be in the first Phase 1A migration.
- **Dependencies:** Affects all RLS policies that reference role. Must be settled first.
- **Effort:** Medium (migration + hook update + policy updates)

## Recommendations for Plan Update

### Phase 1A Must Start with Security Infrastructure (New Sub-Phase)

**Phase 1A-0: Security Foundation** (before any application tables):
1. Create `get_user_role()` SECURITY DEFINER helper function
2. Decide: `user_roles` vs `user_profiles` consolidation -- do it now
3. Update `handle_new_user()` trigger for the consolidated approach
4. Update `custom_access_token_hook()` if table changes
5. Add `pending` role redirect to middleware
6. Create RLS policy template/pattern that all subsequent migrations follow

**Phase 1A ordering by security priority:**
1. `company_settings` (owner-only write, employee read, single row constraint)
2. `user_preferences` (self-only access, trivial RLS)
3. `projects` + `client_project_access` (staff full access, client filtered -- this gates everything downstream)
4. `estimates` (staff full access, client via project access)
5. `estimate_nodes` + detail tables (staff full, client filtered by visibility)
6. `estimate_snapshots` (immutability triggers, SELECT-only for non-service roles)
7. `estimate_shares` (anon denied, service-role-only INSERT, public validation endpoint)

### PIN Share Links Must NOT Be Phase 1A

The share link system (Decision 4) involves unauthenticated access patterns, custom session cookies, and API routes that bypass normal auth flow. This is a Phase 1B+ feature. Phase 1A should only create the `estimate_shares` table with correct schema and restrictive RLS. The validation endpoint and share viewing pages come later.

### Snapshot Architecture Decision Must Be Made Before Phase 1A

The plan needs a clear decision: serialized JSON snapshots (simpler, naturally immutable) vs. deep-copy-as-separate-estimate (more complex, requires immutability triggers on every table). The security implications are dramatically different. I recommend serialized JSON for Phase 1A with the option to add deep-copy diffing later.

### Every Migration Must Include RLS

Add a plan verification gate: no migration passes review unless it contains `ENABLE ROW LEVEL SECURITY` for every `CREATE TABLE` and at least one policy per table. Create a verification script that checks this.

## Questions for Other Board Members

1. **For Schema Analyst:** The `client_visibility` field has a conflict between Decision 2 (boolean `client_visible`) and the data architecture doc (VARCHAR enum `visible/hidden/summary_only`). Which should the plan adopt? The 3-value enum is strictly more powerful -- `summary_only` is architecturally important for hiding cost breakdowns while showing totals. Recommend resolving this as `client_visibility VARCHAR(20)` with the 3-value CHECK constraint.

2. **For Data Integrity Analyst:** The `estimate_snapshots` table design is not specified in any existing document. Decision 1 says "full node tree serialization" but doesn't define the JSONB structure. What fields need to be captured in the snapshot? Is it just `estimate_nodes` + detail tables, or also options, phases, parameters? The deep-copy function in data architecture section 8.2 copies 10 categories of data -- the snapshot JSONB must include all of them.

3. **For Performance Analyst:** The RLS policies I recommend use subqueries (e.g., `estimate_id IN (SELECT ... FROM client_project_access ...)`). For staff users (owner/employee), the `CASE WHEN get_user_role() IN ('owner','employee') THEN TRUE` short-circuits the subquery. But for client users, every row check runs the subquery. Is this a performance concern for estimates with 500-2000 nodes? Should we use a materialized view or a function-based approach instead?

4. **For UX/API Analyst:** The share link PIN validation must return constant-time responses to prevent enumeration attacks. This means the endpoint should always hash the provided PIN against a dummy hash even when the share link token doesn't exist. Does the server action pattern in Next.js guarantee constant-time response, or do we need explicit timing padding?

5. **For All Board Members:** The `user_roles` vs `user_profiles` consolidation (Finding 12) affects the entire RLS policy design. If we keep `user_roles` separate, the hook reads from one table but PIN/preferences data lives in another. If we merge, the migration is more involved but the model is cleaner. The current plan should specify which approach Phase 1A takes.
