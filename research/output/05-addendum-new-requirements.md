# Addendum: New Requirements & Architectural Updates

> **Date:** 2026-04-02
> **Scope:** Three new requirements surfaced after the v2 deliverables were finalized. This addendum documents their impact on the architecture and implementation sequence.
> **Supporting Research:** `research-node-promotion.md`, `research-pin-auth.md`

---

## 1. Requirement Changes

### 1.1 Multi-User (NOT Single-User)

**Correction:** The v2 architecture's Design Principle 3 says "single-user simplicity." This is wrong. The platform is **single-company, multi-user:**

| Role | Count | Access |
|------|-------|--------|
| Owner | 1 (Zac) | Full access to everything |
| Employee | Several | Full access to estimates, catalog, vendors. Possibly restricted from billing/settings. |
| Client | Per-project | Filtered read-only access to their project's estimates. Can toggle allowed options. |

**Architecture Impact:**

| Component | Change Required |
|-----------|----------------|
| Design Principle 3 | Reword: "Single-company simplicity. One company, multiple users, no multi-tenancy." |
| `user_profiles` table | **Add.** Fields: id, auth_user_id (FK → auth.users), display_name, role ('owner','employee','client'), pin_hash, pin_failed_attempts, pin_locked_until, created_at. |
| `client_project_access` table | **Add.** Junction table: client user_id + project_id. Controls which clients see which projects. |
| RLS policies | Update from "builder-owns-everything" to role-aware. Owner/employee = full read/write. Client = read-only on their projects, filtered by client_visibility. |
| `created_by` / `updated_by` | Already on most tables. Now meaningful for audit trail — "who changed this node?" becomes a real question with multiple users. |
| Concurrent editing | **New concern.** Two employees could edit the same estimate simultaneously. Need optimistic locking (version column on estimate_nodes, reject stale writes) or last-writer-wins with conflict notification. |
| Phase 0 | Auth setup becomes more substantial — need role management, not just basic login. |

### 1.2 Item Auto-Promotion (Iterative Estimating Workflow)

**Requirement:** When a user indents a node under an item (Tab key), the item automatically promotes to a group. This supports the natural workflow of starting with rough line items and progressively adding detail.

**Architecture Impact:**

| Component | Change Required |
|-----------|----------------|
| "Items are always leaves" invariant | **Modified.** Items are leaves until a child is added, then they auto-promote to group. The invariant becomes: "items CURRENTLY have no children" (enforced by auto-promotion, not by rejection). |
| INSERT trigger on `estimate_nodes` | **Replace** the "reject child of item" trigger with an "auto-promote item parent" trigger. On INSERT where parent is an item: change parent's node_type to 'group', archive parent's node_item_details row. |
| `node_item_details` | **Add `archived_at TIMESTAMPTZ` column.** On promotion, set archived_at = NOW(). Calculation engine filters on `archived_at IS NULL`. On manual demotion, clear archived_at to restore. |
| Calculation chain | No change needed. Group nodes already use SUM(children) path. Promotion just switches which path is used. |
| Options | Children of a promoted node inherit the parent's option memberships (via trigger on INSERT and UPDATE of parent_id). |
| Catalog references | Cleared on promotion (catalog_source_id = NULL). Original preserved in history. |
| Demotion | **Manual only.** Empty groups stay as groups. User explicitly converts back to item via context menu. Auto-demotion rejected (surprise data loss risk). |

**Default promotion target:** Always `group`. If the user wants assembly behavior (ratio-based children), they manually convert to assembly afterward. This is the safer default — a group is a pure SUM container with nothing to misconfigure.

**This is a genuine differentiator.** No existing construction estimating tool supports this iterative workflow natively. ProEst, Sage, and STACK all require assembly structure to be defined upfront at the catalog/database level.

### 1.3 PIN Authentication (Fast Login)

**Requirement:** Optional 6-digit PIN as a faster login alternative. Phone-lock-screen model — full email+password for initial auth, PIN for quick daily access.

**Architecture Impact:**

| Component | Change Required |
|-----------|----------------|
| `user_profiles` table | Add: `pin_hash VARCHAR(255)`, `pin_failed_attempts INTEGER DEFAULT 0`, `pin_locked_until TIMESTAMPTZ`, `device_trust_token_hash VARCHAR(255)` |
| Auth flow | Supabase Auth handles real authentication (email+password). PIN is an application-level session unlock, not a Supabase auth factor. |
| Security model | PIN + device trust cookie + rate limiting (5 attempts / 15-min lockout). Brute-force ceiling: ~5.7 years at maximum attack rate. |
| Implementation | Next.js server action validates PIN against bcrypt hash, checks device trust cookie, returns session. No custom JWT signing. |
| Phase 0 | PIN setup is deferred to after basic auth works. Can be added as a Phase 0.5 or folded into Phase 1B. |

**What it is NOT:** The PIN does not replace Supabase Auth. It does not create new sessions. It unlocks a suspended session on a previously authenticated device. Full re-auth is required for: new devices, expired sessions (30-day max), forgotten PIN, or 15+ failed attempts in 24 hours.

---

## 2. Implementation Sequence Updates

### Phase 0 (Scaffolding + Auth) — Expanded

Add to Phase 0:
- `user_profiles` table with role column
- Supabase Auth Custom Access Token Hook to inject role into JWT
- Basic role-based middleware (owner/employee = full access, client = filtered)
- `client_project_access` junction table

Defer to later:
- PIN authentication setup (Phase 1B or after)
- Advanced role permissions (Phase 8 with client view)

### Phase 1A (Schema) — Add Promotion Infrastructure

Add to Phase 1A:
- `archived_at TIMESTAMPTZ` column on `node_item_details`
- Replace "reject child of item" trigger with "auto-promote item parent" trigger
- Option membership inheritance trigger (on INSERT and UPDATE of parent_id)
- Optimistic locking `version INTEGER DEFAULT 1` on `estimate_nodes` (for concurrent editing safety)

### Phase 1B (Tree UI) — Keyboard Operations

Add to Phase 1B:
- Tab = indent (change parent_id to previous sibling, trigger auto-promotion if needed)
- Shift+Tab = outdent (change parent_id to grandparent)
- Toast notification on auto-promotion: "Converted 'Flooring' to group"
- Context menu: "Convert to Item" (manual demotion, only on childless groups)
- Context menu: "Convert to Assembly" (for switching group → assembly)

### Phase 8 (Client View) — Role-Based Access

Phase 8 becomes more substantial with multi-user:
- Client role authentication and authorization
- Client-project access control (which clients see which projects)
- Client-specific option interaction permissions
- PIN authentication setup (if not done earlier)

---

## 3. Updated Table List

New tables from this addendum:

| # | Table | Purpose |
|---|-------|---------|
| 31 | `user_profiles` | User metadata, role, PIN hash, display name |
| 32 | `client_project_access` | Junction: which clients can access which projects |

Modified tables:

| Table | Change |
|-------|--------|
| `node_item_details` | Add `archived_at TIMESTAMPTZ` column |
| `estimate_nodes` | Add `version INTEGER DEFAULT 1` for optimistic locking |

**Updated total: ~32 tables.**

---

## 4. Open Questions — Zac's Answers (2026-04-02)

| # | Question | Answer | Impact |
|---|----------|--------|--------|
| 1 | Default to group on promotion? | **Yes** | No change — already the recommendation |
| 2 | No auto-demotion? | **No — wants auto-demotion** | Add demotion trigger: when last child removed from a promoted group, auto-revert to item (un-archive detail row) |
| 3 | Toast notification sufficient? | **Yes** | No change |
| 4 | Employee permissions same as owner? | **Yes, for now** | Role column in place, same permissions initially, architecture supports differentiation later |
| 5 | PIN auth priority? | **Defer until core works** | PIN removed from Phase 0. Add to Phase 10 or later. |
| 6 | Concurrent editing likelihood? | **Very likely — needs real-time collaboration (Google Sheets feel)** | MAJOR addition. See Section 6 below. |

### Q2 Impact: Auto-Demotion Trigger

When a group that was auto-promoted from an item loses its last child (all children deleted or outdented), the system should auto-demote it back to an item:

1. Trigger fires on DELETE from `estimate_nodes` or UPDATE of `parent_id` (child moved away)
2. Check: does the old parent now have zero children AND have an archived `node_item_details` row?
3. If yes: change `node_type` back to `'item'`, set `archived_at = NULL` on the detail row
4. Toast: "Reverted 'Flooring' to item"
5. Recalculation switches from SUM(children) back to qty × unit_cost

This makes Tab/Shift-Tab fully bidirectional — indent promotes, outdent (when it removes the last child) demotes. Seamless in both directions.

**Edge case:** If the user manually edited the group (changed name, added notes) after promotion, those changes are preserved on the base table. Only the item details are restored from the archived row.

---

## 5. MAJOR ADDITION: Real-Time Collaborative Editing

### The Requirement

Multiple employees will edit the same estimate simultaneously. The desired experience is "Google Sheets / Excel Online" — see who's editing, changes appear instantly, no stepping on each other's work.

### Research Findings (from `research-realtime-collaboration.md`)

**This is more achievable than initially expected.** Key findings:

1. **The calculation engine doesn't need to change.** It's already a pure function. Remote edits are just another mutation source that triggers the same recalculation path.

2. **Use Supabase Realtime directly.** No external libraries needed (Yjs, Liveblocks, PartyKit all rejected — wrong abstraction for structured data, unnecessary cost/complexity).
   - **Broadcast channel** for edit propagation (6ms p50 latency)
   - **Presence channel** for user awareness (who's here, what are they editing)
   - One channel per open estimate: `estimate:{id}`

3. **Conflict resolution: Presence-guided last-writer-wins.** Matches Google Sheets behavior. No field locking (blocks users, adds complexity). No OT/CRDTs (designed for text documents, overkill for scalar field values). Users see each other's cursors and naturally avoid editing the same field.

4. **Total added effort: ~1 extra session** spread across the build. The foundation (useReducer pattern + channel hook) adds 2-4 hours to Phase 1B. Polish (presence UI, conflict toasts) adds 1-2 sessions in Phase 7/8.

5. **Performance is a non-issue.** 3 users at 1 edit/5 seconds = ~62 messages/minute = ~1.96M/month. Within Supabase free tier (2M/month). Full-tree recalculation takes <1ms for 500 nodes.

### Architecture Change

The only structural change is the state management pattern:

```
BEFORE (single-user batch save):
  Local state ← user edits → batch save to server

AFTER (real-time collaborative):
  Local state ← user edits → broadcast to channel → save per-field
              ← remote edits from channel (other users' changes)
  Both paths trigger the same calculation engine.
```

The state manager must use `useReducer` (not `useState`) from Phase 1B to handle two mutation sources cleanly. This is a Phase 1B design decision, not a retrofit.

### Sequencing Impact

| Phase | Real-Time Addition | Effort |
|-------|-------------------|--------|
| 1B | `useReducer` state pattern + Supabase Realtime channel hook + basic broadcast | +2-4 hours |
| 2 | Calculation engine handles remote edits (already works — pure function) | +0 |
| 7/8 | Presence UI (colored cursors, user avatars), conflict toasts, polish | +1-2 sessions |

### MVP for "Feels Collaborative" (5 features)

1. See who is viewing this estimate (presence indicators)
2. See which node/field each person is editing (colored highlight)
3. See their changes appear instantly (broadcast → local state merge → recalculate)
4. Social conflict avoidance (you see someone editing a field, you naturally avoid it)
5. Graceful delete handling (if someone deletes a node you're editing, close your edit + toast)

### Deferred (not MVP)

- Offline sync / reconnection handling
- Conflict history ("Alice changed this field 2 seconds ago")
- Cursor position tracking within text fields
- Live typing preview (see characters as they type)
- Shared undo/redo
- Comment threads on nodes

---

## 6. Relationship Map: How Everything Interacts

```
User Authentication
  ├── Supabase Auth (email + password) ── real auth boundary
  ├── PIN (session unlock) ── deferred, convenience layer
  └── Roles (owner/employee/client) ── JWT claims via Custom Access Token Hook
        │
        ├── Owner/Employee ── full estimate access, real-time collaborative
        │     └── Supabase Realtime ── broadcast edits, presence tracking
        │
        └── Client ── filtered by client_visibility + client_project_access
              └── Option toggling ── where builder allows it

Estimate Tree Operations (real-time collaborative)
  ├── Tab (indent) ── parent_id = previous sibling → broadcast
  │     └── If parent is item ── auto-promote to group (trigger)
  │           ├── Archive node_item_details (soft-delete)
  │           ├── Parent subtotal switches to SUM(children)
  │           └── Toast notification (local + remote)
  │
  ├── Shift+Tab (outdent) ── parent_id = grandparent → broadcast
  │     └── If parent now childless + has archived details ── auto-demote to item
  │           ├── Un-archive node_item_details
  │           ├── Subtotal switches back to qty × unit_cost
  │           └── Toast notification
  │
  ├── Move (drag-drop) ── parent_id = drop target → broadcast
  │     └── Option membership inherited from new parent (trigger)
  │
  ├── Edit field ── local state update → broadcast → remote clients merge
  │     └── Presence shows who's editing what (colored highlight)
  │
  └── Manual type conversion (context menu)
        ├── Group → Assembly ── create node_assembly_details, set qty/unit
        ├── Group → Item ── only if no children, un-archive node_item_details
        └── Assembly → Group ── archive node_assembly_details

State Management (useReducer pattern from Phase 1B)
  ├── Local edits ── dispatch action → reduce → recalculate → render
  ├── Remote edits ── channel event → dispatch action → reduce → recalculate → render
  └── Both paths use the same reducer and calculation engine
```
