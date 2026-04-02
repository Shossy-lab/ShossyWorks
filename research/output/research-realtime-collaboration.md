# Real-Time Collaborative Editing Research

> **Date:** 2026-04-02
> **Scope:** Architecture for Google-Sheets-level real-time collaboration on construction estimate trees
> **Requirement source:** `05-addendum-new-requirements.md`, Question 6 -- Zac confirmed: "truly real-time collaborative. Google Sheets, Excel Online... that's the feel I would like."
> **Constraint:** Supabase Realtime + Next.js. No heavy external dependencies unless clearly justified.

---

## 0. Executive Summary

**Recommended approach:** Use Supabase Realtime **Broadcast** for field-level change propagation and **Presence** for cursor/editing indicators. Do NOT use Postgres Changes for edit synchronization (too slow, wrong tool). Persist edits to the database via normal server actions; broadcast edits to other clients via a parallel WebSocket channel.

**Conflict model:** Field-level soft locking with presence-based visual indicators. When two users target the same field, the first editor "claims" it via presence; the second user sees a colored highlight and a name badge. If they edit anyway, last-writer-wins at the field level. This matches Google Sheets behavior and is appropriate for structured data where conflicts are rare and low-stakes.

**When to build it:** Weave the real-time foundation into Phase 1B (tree UI) as a horizontal concern. The state management pattern chosen in Phase 1B determines whether real-time is easy or painful to add later. Defer the polish (presence colors, conflict toasts) to Phase 7-8 timeframe, but the channel architecture and state subscription model must exist from Phase 1B.

**Message volume estimate:** 3 users, 1 edit per 5 seconds = ~36 broadcast messages/minute + presence updates. Well within Supabase Free tier (2M messages/month, 100 messages/second). Not even close to a scaling concern.

---

## 1. Supabase Realtime Channel Types: Which to Use

Supabase Realtime offers three channel types. Each serves a different purpose:

### 1.1 Broadcast -- PRIMARY TOOL for edit propagation

**What it does:** Sends ephemeral messages between connected clients via WebSocket. Messages are NOT persisted (unless using database broadcast, which stores them for 3 days). Pure pub/sub -- a client publishes an event, all other subscribers on the same channel receive it.

**Latency:** p50 = 6ms, p95 = 28ms with WebSocket broadcast (Supabase benchmarks, 32K concurrent users). With 1KB payloads: p50 = 13ms, p95 = 36ms. This is fast enough for "instant feel" -- a 6-28ms propagation delay is imperceptible to humans (typical visual perception threshold is ~50-100ms).

**Why it fits:** When User A changes a field value, we need to tell Users B and C immediately. We do NOT need the database involved in this notification path. The database save happens separately (via the existing server action pattern). Broadcast is the fastest path because it skips the database entirely -- message goes from Client A to Supabase Realtime server to Clients B and C.

**API:**
```typescript
// Subscribe to edits on a specific estimate
const channel = supabase.channel(`estimate:${estimateId}`, {
  config: { broadcast: { self: false } } // don't echo my own edits back to me
})

channel
  .on('broadcast', { event: 'field_edit' }, (payload) => {
    // Another user changed a field -- update local state
    applyRemoteEdit(payload.payload)
  })
  .on('broadcast', { event: 'node_add' }, (payload) => {
    applyRemoteNodeAdd(payload.payload)
  })
  .on('broadcast', { event: 'node_delete' }, (payload) => {
    applyRemoteNodeDelete(payload.payload)
  })
  .on('broadcast', { event: 'node_move' }, (payload) => {
    applyRemoteNodeMove(payload.payload)
  })
  .subscribe()

// When I edit a field:
channel.send({
  type: 'broadcast',
  event: 'field_edit',
  payload: {
    node_id: 'uuid-here',
    field: 'unit_cost',
    value: 4.50,
    user_id: currentUser.id,
    timestamp: Date.now(),
    version: node.version + 1
  }
})
```

### 1.2 Presence -- SECONDARY TOOL for user awareness

**What it does:** Tracks which users are connected and their current state. Automatically handles join/leave/sync events. Each client "tracks" a state object (user_id, name, color, what they're editing), and all other clients receive the merged presence state.

**Why it fits:** Shows who is online, who is viewing the estimate, and which node/field each user is currently editing. This is the "colored cell highlight" feature from Google Sheets.

**Update frequency:** Presence messages are rate-limited to 20/second on Free, 50/second on Pro. This is sufficient -- presence state changes when a user moves focus to a different field (maybe once per 2-5 seconds during active editing).

**API:**
```typescript
// Same channel, add presence tracking
channel
  .on('presence', { event: 'sync' }, () => {
    const state = channel.presenceState()
    updateActiveUsers(state) // re-render presence indicators
  })
  .subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      await channel.track({
        user_id: currentUser.id,
        display_name: currentUser.display_name,
        color: currentUser.assigned_color, // e.g., '#3B82F6'
        active_node_id: null,
        active_field: null
      })
    }
  })

// When user focuses a field:
await channel.track({
  user_id: currentUser.id,
  display_name: currentUser.display_name,
  color: currentUser.assigned_color,
  active_node_id: 'uuid-of-node',
  active_field: 'unit_cost'
})
```

### 1.3 Postgres Changes -- NOT recommended for edit sync

**What it does:** Listens to INSERT/UPDATE/DELETE on database tables via PostgreSQL logical replication. Delivers the changed row to subscribers.

**Why it does NOT fit for edit synchronization:**
- **Latency:** p95 = 238ms (Supabase benchmarks). This is 8x slower than Broadcast. Users would see a noticeable delay.
- **Throughput:** Limited to 64 changes/second on a single thread. Our edit volume is nowhere near this, but the architectural limitation means it cannot scale if needed.
- **Round-trip dependency:** The edit must be written to the database FIRST, then the change is detected and broadcast. This means the edit flow becomes: Client A edits -> server action writes to DB -> Postgres WAL -> Realtime server detects change -> broadcasts to Clients B and C. That is 3 network hops instead of 1.
- **Payload size:** Changes that exceed 1024KB are truncated; fields over 64 bytes are omitted.

**When Postgres Changes IS appropriate:** For non-interactive background updates -- e.g., if an admin changes project settings, or a catalog item is updated. These are infrequent, non-latency-sensitive updates where the database is the correct source of truth. They are not appropriate for keystroke-level edit propagation.

### 1.4 Summary: Channel Architecture

```
One Supabase channel per open estimate:
  Channel topic: "estimate:{estimate_id}"

  Uses Broadcast for:
    - field_edit events (field-level value changes)
    - node_add events (new node inserted)
    - node_delete events (node removed)
    - node_move events (node re-parented or reordered)
    - tree_refresh events (full tree reload needed -- rare)

  Uses Presence for:
    - Who is online viewing this estimate
    - Which node/field each user is focused on
    - User display names and assigned colors
```

---

## 2. Data Flow Architecture Change

### 2.1 Current Design (Single-User)

```
Load:    SELECT full tree -> build in memory -> render UI
Edit:    User changes field -> update local state -> recalculate tree -> render
Save:    Batch all changes -> POST to server action -> server recalculates
         -> server stores authoritative values -> return to client
```

This is the "isomorphic hybrid" from Section 9 of the data architecture. The client calculates for instant feedback; the server is authoritative on save.

### 2.2 Real-Time Design (Multi-User)

```
Load:    SELECT full tree -> build in memory -> subscribe to channel -> render
Edit:    User changes field -> update local state -> recalculate tree -> render
         -> broadcast change to channel (parallel, non-blocking)
         -> debounced save to server (same as before)
Receive: Channel delivers remote edit -> update local state -> recalculate -> render
Save:    Same batch save pattern, but with version checking
```

**What changes:**

| Concern | Single-User | Multi-User |
|---------|------------|------------|
| State updates | Local only | Local + incoming remote edits |
| Recalculation trigger | User edit only | User edit OR remote edit received |
| Save timing | User-initiated (save button / auto-save) | Same, but with optimistic version check |
| State shape | Tree data only | Tree data + presence state + pending remote edits |

**What does NOT change:**

- The calculation engine itself. It is a pure function: tree in, tree out. It does not care whether the edit came from the local user or a remote broadcast.
- The server-authoritative save. The server still recalculates from scratch on every save.
- The tree data model. No schema changes needed for real-time (the `version` column already planned in the addendum handles optimistic concurrency).

### 2.3 Per-Field vs. Per-Node Saves

**Recommendation: Per-field broadcast, debounced per-node save.**

When a user edits a field (e.g., changes `unit_cost` from 4.50 to 5.00 and presses Tab/Enter):

1. **Immediately:** Broadcast `field_edit` event with `{ node_id, field: 'unit_cost', value: 5.00 }`
2. **Immediately:** Update local state, recalculate affected tree path, re-render
3. **Debounced (500ms after last edit to this node):** Save the node via server action

The broadcast is per-field because that is the atomic unit of user intent -- "I changed this one value." Other clients need to know exactly which field changed so they can apply the update surgically.

The save is debounced per-node because a user often edits multiple fields on the same row in rapid succession (quantity, then unit cost, then contingency rate). We do not want 3 separate database round-trips for what is conceptually "editing one line item." The 500ms debounce groups rapid sequential edits into one save.

**Why not per-field saves?** A user editing 5 fields on one node in 3 seconds would cause 5 database writes. The version column would increment 5 times. Other users' debounced saves for THEIR changes could conflict with intermediate versions. Per-node debounced saves are cleaner and match the existing batch-save pattern.

### 2.4 How Remote Edits Trigger Recalculation

The calculation engine is already designed to take a full tree and produce calculated values. When a remote edit arrives:

```typescript
function applyRemoteEdit(payload: RemoteEditPayload) {
  const { node_id, field, value, user_id, timestamp } = payload

  // 1. Update the node in local state
  updateNodeField(node_id, field, value)

  // 2. Recalculate the affected path (not full tree)
  //    Start from the changed node, walk up to root
  recalculateFromNode(node_id)

  // 3. Re-render affected nodes
  //    React will handle this if state is properly structured
}
```

**Should recalculation be debounced for remote edits?** Yes, lightly. If 3 remote edits arrive within 50ms (e.g., another user is rapidly tabbing through fields), batch them into one recalculation pass. A 50ms debounce is imperceptible but avoids redundant calculation cycles.

```typescript
// Debounce remote recalculations by 50ms
const pendingRemoteEdits: RemoteEditPayload[] = []
let recalcTimer: ReturnType<typeof setTimeout> | null = null

function onRemoteEdit(payload: RemoteEditPayload) {
  // Apply the field update immediately (visual feedback)
  updateNodeField(payload.node_id, payload.field, payload.value)

  // Batch the recalculation
  pendingRemoteEdits.push(payload)
  if (recalcTimer) clearTimeout(recalcTimer)
  recalcTimer = setTimeout(() => {
    // Recalculate once for all pending edits
    const affectedNodeIds = [...new Set(pendingRemoteEdits.map(e => e.node_id))]
    recalculateFromNodes(affectedNodeIds)
    pendingRemoteEdits.length = 0
    recalcTimer = null
  }, 50)
}
```

**Performance concern -- 500-node tree recalculation on every remote edit:** The isomorphic calc engine already recalculates the full tree client-side on every local edit. For a 500-node tree, this is ~500 multiplication/addition operations plus some tree traversal -- sub-millisecond work in JavaScript. Remote edits do not change this performance profile. The 50ms debounce is a precaution, not a necessity.

---

## 3. Conflict Resolution Strategy

### 3.1 What Google Sheets Actually Does

Google Sheets uses **cell-level last-writer-wins with presence indicators.** When you select a cell, other users see your colored highlight on that cell. If two users type into the same cell simultaneously, the last keystroke to reach the server wins. There is no locking, no merge dialog, no conflict notification. The losing user's value is simply overwritten.

Google Sheets gets away with this because:
1. Presence indicators show you WHERE others are editing, so you naturally avoid the same cell
2. Cells are simple scalar values -- there is no "merge" possible for two different numbers in the same cell
3. The undo history is per-user, so you can recover your value if it was overwritten

### 3.2 Recommendation: Presence-Guided Last-Writer-Wins

**This is the right model for construction estimates.** Here is why:

**Why NOT field-level locking (option a):**
- Locking adds complexity: lock acquisition, lock timeout, lock release on disconnect, lock stealing for stale locks
- If User A locks a field and walks away, User B is blocked until the lock times out
- For a construction estimate, it is overkill -- two estimators rarely need the exact same field at the exact same time. They are typically working on different sections of the tree.
- Google Sheets does not lock cells and it works fine

**Why NOT operational transform / CRDTs (option c):**
- OT and CRDTs are designed for merging concurrent text edits (character insertions/deletions in a document)
- Estimate fields are scalar values (numbers, short strings), not documents
- There is no meaningful "merge" of two different numbers for the same field
- The complexity is enormous and the benefit is zero for this data type

**Why last-writer-wins with presence (option b):**
- Simple to implement and reason about
- Presence indicators provide social conflict avoidance (you see where others are, you work elsewhere)
- When conflicts do occur (rare), the last value written is as valid as the first -- the "correct" value requires human judgment either way
- Matches the mental model of "we're both editing a shared spreadsheet"

### 3.3 Implementation

```
User A focuses on Node 123, field "unit_cost":
  -> Presence update: { active_node_id: 123, active_field: 'unit_cost' }
  -> All other clients see: Node 123's unit_cost cell highlighted in User A's color

User B sees the highlight and works on a different node (social avoidance)

IF User B focuses on the SAME field despite the highlight:
  -> Both users see each other's colors on the same cell
  -> Both can edit
  -> Each edit broadcasts immediately
  -> Last edit to arrive at each client is displayed
  -> Last edit to be saved to the server is persisted

No merge dialog. No error. No lock. The presence highlight IS the conflict resolution.
```

### 3.4 Version Column for Save Conflicts

The `version INTEGER DEFAULT 1` column on `estimate_nodes` (from the addendum) provides an additional safety net for the save path:

```sql
-- Server action: update a node
UPDATE estimate_nodes
SET unit_cost = $1, version = version + 1, updated_at = NOW()
WHERE id = $2 AND version = $3
RETURNING version;
```

If the UPDATE affects 0 rows (version mismatch), the save failed because someone else saved a change to this node since we last loaded it. The client should:

1. Fetch the current server state for this node
2. Apply it to local state (the remote user's value wins)
3. Show a brief toast: "This node was updated by [User Name]. Your changes were replaced."
4. Let the user re-edit if needed

This is NOT expected to happen frequently. The broadcast channel delivers remote edits in ~6ms. By the time the local user's debounced save fires (500ms later), they have already seen the remote edit and their local state already reflects it. The version check is a safety net for edge cases (network partitions, race conditions), not a primary conflict resolution mechanism.

---

## 4. Presence System Design

### 4.1 Presence Data Shape

```typescript
interface UserPresence {
  user_id: string
  display_name: string
  color: string          // CSS color, assigned deterministically from a palette
  active_node_id: string | null  // which tree node they're focused on
  active_field: string | null    // which field within that node
  last_active: number            // timestamp for idle detection
}
```

### 4.2 Color Assignment

Assign colors deterministically from a fixed palette based on user order:

```typescript
const PRESENCE_COLORS = [
  '#3B82F6', // blue
  '#EF4444', // red
  '#10B981', // green
  '#F59E0B', // amber
  '#8B5CF6', // purple
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#F97316', // orange
] as const

function getUserColor(userId: string, allUserIds: string[]): string {
  const sortedIds = [...allUserIds].sort()
  const index = sortedIds.indexOf(userId)
  return PRESENCE_COLORS[index % PRESENCE_COLORS.length]
}
```

### 4.3 UI Indicators

1. **User list panel:** Show avatars/initials + names of all users viewing this estimate, each with their assigned color
2. **Row highlight:** If another user has `active_node_id` set, highlight that entire row with a subtle tint of their color
3. **Field highlight:** If another user has `active_field` set, put a colored border on that specific cell
4. **Name badge:** On the highlighted cell, show a small floating badge with the user's name
5. **Idle state:** If `last_active` is more than 60 seconds old, dim the user's indicators (they may have switched tabs)

### 4.4 Presence Update Triggers

Update presence when:
- User focuses a cell (sets active_node_id + active_field)
- User blurs a cell (clears active_field, keeps active_node_id)
- User navigates to a different node (updates active_node_id)
- User switches away from the tab (clears active_node_id + active_field via `document.visibilitychange`)
- User disconnects (automatic via Supabase Presence leave event)

Throttle presence updates to at most 1 per 200ms to stay well within Supabase's presence rate limits (20/sec free, 50/sec pro).

---

## 5. Tree Operation Conflicts

These are the hard edge cases. Each requires specific handling.

### 5.1 User A moves a node while User B is editing it

**Scenario:** User B is editing Node X's `unit_cost` field. User A drags Node X from under Parent P1 to Parent P2.

**What happens:**
1. User A performs the move. Local state updates. Broadcast: `{ event: 'node_move', node_id: X, new_parent_id: P2, new_sort_order: 3 }`
2. User B receives the broadcast. Node X moves in their tree view. Their cursor is still in the `unit_cost` field -- the field is still valid, just in a different position in the tree.
3. User B finishes editing and tabs away. The edit saves normally.
4. Recalculation runs on both clients: Node X's values now roll up to P2 instead of P1.

**Resolution:** No conflict. The move changes where the node lives in the tree; the edit changes a field value on the node. These are orthogonal operations. The UI should smoothly animate the node to its new position while preserving the user's editing state.

**Toast notification for User B:** "Node '[name]' was moved to '[new parent name]' by [User A]."

### 5.2 User A deletes a node that User B is editing

**Scenario:** User B is editing Node X. User A deletes Node X.

**What happens:**
1. User A deletes. Broadcast: `{ event: 'node_delete', node_id: X, deleted_by: A }`
2. User B receives the broadcast. The node they are actively editing was deleted by someone else.

**Resolution:** This is a conflict that requires explicit handling:
1. Close User B's edit mode for Node X
2. Show a prominent toast: "Node '[name]' was deleted by [User A]. Your unsaved changes to this node were lost."
3. Remove Node X from User B's tree view
4. If User B had unsaved edits, they are lost. This is acceptable because:
   - It is rare (two users operating on the exact same node)
   - The deleted node's data still exists in the history table (if history tracking is implemented)
   - User B can undo User A's delete if needed (undo at the tree operation level, not field level)

**Alternative considered -- "protect nodes being edited":** We could prevent deletion if another user has presence on that node. Rejected because it creates a frustrating experience: "I can't delete this node because someone else has their cursor on it" forces User A to coordinate out-of-band. The social signal (presence highlight) already tells User A that someone is there. If they delete anyway, they made a conscious choice.

### 5.3 User A adds an option alternative while User B is working in the base

**Scenario:** User B is editing items in the Base alternative of a section. User A creates a new option group and adds an alternative to that section.

**What happens:**
1. User A creates the option group and alternative. Multiple broadcasts fire: node_add for new nodes, possibly node_move for nodes being assigned to the alternative.
2. User B receives the broadcasts. New nodes appear in the tree. Option membership changes are applied.
3. If nodes that User B is editing are now assigned to an option alternative (via the junction table propagation trigger), their editing context may have changed.

**Resolution:**
1. If User B's active node is NOT affected by the option membership change: no disruption. They keep editing.
2. If User B's active node IS affected: toast notification: "Option group '[name]' was created by [User A]. This section now has alternatives." Continue allowing editing -- the node still exists, it is now part of the base alternative.
3. UI updates to show option group indicators on affected nodes.

**This is the least disruptive of the three scenarios** because option creation does not delete or move existing nodes -- it adds new ones and classifies existing ones.

### 5.4 User A reorders siblings while User B is editing one of them

**Scenario:** User B is editing Node X at position 3 in a list. User A drags Node Y to position 2, pushing Node X to position 4.

**Resolution:** Visual reorder only. User B's node moves in the list but their editing state is preserved. No toast needed -- reordering siblings is a visual change, not a data change to the node being edited.

### 5.5 Summary of Tree Operation Conflict Handling

| Scenario | Disrupts editing? | Resolution | User notification |
|----------|------------------|------------|-------------------|
| Move node being edited | No | Animate move, preserve edit state | Toast: node was moved |
| Delete node being edited | Yes | Close edit, remove node | Prominent toast: node deleted, changes lost |
| Add option to section being edited | Rarely | Add nodes, update option indicators | Toast: option group created |
| Reorder siblings of node being edited | No | Animate reorder, preserve edit state | None needed |
| Edit same field as another user | No | Last-writer-wins | Presence highlight (preventive) |

---

## 6. Implementation Approach

### 6.1 Recommendation: Supabase Realtime Directly (No External Libraries)

**Use Supabase Realtime Broadcast + Presence directly.** Do not introduce Yjs, Liveblocks, or PartyKit.

**Why not Yjs?**
- Yjs is a CRDT library designed for merging concurrent text edits (character-level insertions and deletions)
- Construction estimate fields are scalar values (numbers, short strings), not collaborative documents
- Yjs adds significant complexity (CRDT data structures, state synchronization protocol, garbage collection) for zero benefit in this domain
- Yjs requires a WebSocket server (y-websocket) or a provider like Liveblocks -- adding infrastructure
- The Y.Map data type could theoretically model node fields, but this is using a cannon to kill a fly

**Why not Liveblocks?**
- Liveblocks costs ~$939/month for 10K MAU. Even their starter tier is $99/month. Supabase Realtime is included in the $25/month Pro plan.
- Liveblocks is a separate service with its own state management (LiveObject, LiveList, LiveMap). It would create a parallel state system alongside Supabase's database state. Two sources of truth.
- For this use case (structured data with occasional concurrent edits), Liveblocks is wildly over-provisioned.

**Why not PartyKit?**
- PartyKit runs on Cloudflare Workers. Adding it means running compute on two platforms (Vercel for Next.js, Cloudflare for PartyKit). Unnecessary operational complexity.
- PartyKit is most valuable when you need custom server-side logic for real-time features (game state, complex merges). Our real-time needs are simple pub/sub.

**Why Supabase Realtime directly?**
- Already in the stack. No new dependencies, no new billing, no new operational concerns.
- Broadcast + Presence cover exactly the two things we need: message propagation and user awareness.
- The `supabase-js` client already handles WebSocket connection management, reconnection, and channel subscription.
- Latency (6ms p50) is more than sufficient.
- Message capacity (100/sec free, 500/sec pro) is orders of magnitude above our needs.

### 6.2 Integration with the Calculation Engine

The isomorphic calculation engine (Section 9 of the data architecture) does NOT need to change for real-time. Here is why:

**The calculation engine is a pure function:** `calculateTree(nodes) -> calculatedNodes`. It takes a flat array of nodes, builds the tree, calculates every value, and returns the result. It does not care where the input came from.

**Local edits:** User changes a field -> update local state -> `calculateTree(localState)` -> render
**Remote edits:** Broadcast delivers a field change -> update local state -> `calculateTree(localState)` -> render

The only change is that the local state now has two mutation sources (local user edits AND remote broadcast events) instead of one. The calculation engine runs the same way regardless.

**Where the calc engine integration matters:**
1. The `recalculateFromNode()` optimization (recalculate only the affected ancestor path, not the full tree) should be used for both local and remote edits. For a 500-node tree, full recalculation is <1ms, so this optimization is a nice-to-have, not a requirement.
2. The server-authoritative save still recalculates from scratch. Multiple users saving concurrently do not conflict because each save recalculates the full tree from the current database state.

### 6.3 State Management Pattern Change

**Current design (single-user):**
```
React state:
  - treeNodes: Map<NodeId, TreeNode>
  - expandedNodes: Set<NodeId>
  - editingNodeId: NodeId | null
  - editingField: string | null
  - pendingChanges: Map<NodeId, Partial<TreeNode>>  // unsaved changes
```

**Real-time design (multi-user):**
```
React state:
  - treeNodes: Map<NodeId, TreeNode>
  - expandedNodes: Set<NodeId>
  - editingNodeId: NodeId | null
  - editingField: string | null
  - pendingChanges: Map<NodeId, Partial<TreeNode>>  // MY unsaved changes
  - presence: Map<UserId, UserPresence>              // NEW: who's here, what they're doing
  - realtimeChannel: RealtimeChannel | null           // NEW: channel reference
```

**The critical addition** is a state update handler that processes incoming broadcast events:

```typescript
// In the estimate page component or custom hook:
useEffect(() => {
  if (!estimateId) return

  const channel = supabase.channel(`estimate:${estimateId}`, {
    config: { broadcast: { self: false } }
  })

  channel
    .on('broadcast', { event: 'field_edit' }, ({ payload }) => {
      dispatch({ type: 'REMOTE_FIELD_EDIT', payload })
    })
    .on('broadcast', { event: 'node_add' }, ({ payload }) => {
      dispatch({ type: 'REMOTE_NODE_ADD', payload })
    })
    .on('broadcast', { event: 'node_delete' }, ({ payload }) => {
      dispatch({ type: 'REMOTE_NODE_DELETE', payload })
    })
    .on('broadcast', { event: 'node_move' }, ({ payload }) => {
      dispatch({ type: 'REMOTE_NODE_MOVE', payload })
    })
    .on('presence', { event: 'sync' }, () => {
      dispatch({ type: 'PRESENCE_SYNC', state: channel.presenceState() })
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({
          user_id: currentUser.id,
          display_name: currentUser.display_name,
          color: getUserColor(currentUser.id, []),
          active_node_id: null,
          active_field: null
        })
      }
    })

  return () => { supabase.removeChannel(channel) }
}, [estimateId])
```

**Using a reducer vs. useState:** For multi-user state with multiple mutation sources, `useReducer` is strongly recommended over multiple `useState` calls. A reducer centralizes all state transitions (local edits, remote edits, presence updates, saves) in one place, making it easier to reason about consistency.

---

## 7. Implementation Sequencing

### 7.1 The Core Question: Weave In or Bolt On?

**Option A -- Bolt on after Phase 6:** Build the entire system single-user first (Phases 0-6), then add real-time as a separate Phase 7.5.

**Option B -- Weave in from Phase 1B:** Build the real-time channel and state management pattern into Phase 1B, so every subsequent phase builds on a multi-user-aware foundation.

**Recommendation: Option B -- weave in from Phase 1B, but in layers.**

### 7.2 Why Not Bolt On Later

The state management pattern chosen in Phase 1B determines how easy real-time is to add:

- **If Phase 1B uses simple `useState` with direct mutation:** Adding real-time later requires rewriting every state update to go through a central dispatcher. Every component that calls `setNodes()` directly must be refactored to call `dispatch()` instead. This is a full rewrite of the state layer.

- **If Phase 1B uses `useReducer` with action dispatching from day one:** Adding real-time means adding new action types (`REMOTE_FIELD_EDIT`, `REMOTE_NODE_ADD`, etc.) to the existing reducer. The components do not change at all -- they dispatch local actions the same way they always did.

The difference is not about real-time specifically -- it is about choosing a state management pattern that supports multiple mutation sources. `useReducer` supports this naturally; `useState` with direct mutation does not.

**Cost of getting this wrong:** If you build 6 phases of UI on `useState` with direct mutation, then discover in Phase 7 that you need to refactor to `useReducer` for real-time support, you are touching every component that edits state. That is a cross-cutting refactor that touches nearly every file. It is cheaper to start with `useReducer` than to migrate to it later.

### 7.3 Layered Implementation Plan

**Phase 1B additions (minimal -- 1-2 hours of work):**
1. Use `useReducer` for tree state management (not `useState`)
2. Create the Supabase channel subscription hook (`useEstimateChannel`)
3. Broadcast local edits via the channel (even if no one else is listening yet)
4. Log incoming broadcast events to console (no handling yet)
5. Add basic presence tracking (who is viewing this estimate)

This gives you the architecture without the UX. The system is "real-time capable" even if the real-time UX features are not polished.

**Phase 2 additions (calculation engine):**
1. Ensure `calculateTree()` works correctly when called from a remote edit handler (it should -- it is a pure function, but test it)
2. Add the 50ms debounce for batching remote recalculations

**Phase 3-6 (no additional real-time work):**
Each phase adds new node types, new fields, new operations. Because the state management pattern already supports remote edits via the reducer, new features automatically work with real-time. When Phase 3 adds assembly quantity cascade, the `REMOTE_FIELD_EDIT` action for an assembly quantity triggers the same recalculation path as a local edit.

**Phase 7 or 8 -- Real-Time Polish:**
1. Presence UI: colored highlights on nodes/fields, user avatars, name badges
2. Conflict handling for tree operations (toasts for delete/move)
3. "Someone else changed this" toast when version check fails on save
4. Idle detection and presence dimming
5. Reconnection handling (what happens when WebSocket drops and reconnects)

### 7.4 What This Means for the Phase Summary

| Phase | Real-Time Work | Effort Added |
|-------|---------------|--------------|
| 1B | useReducer pattern + channel hook + broadcast on edit + basic presence | +2-4 hours |
| 2 | Test calc engine with remote edits, add debounce | +1 hour |
| 3-6 | Nothing explicit -- new features inherit the pattern | +0 |
| 7 or 8 | Presence UI, conflict toasts, reconnection, polish | +1-2 sessions |

**Total added effort for real-time:** ~1 extra session spread across the build, plus 1-2 dedicated sessions for polish. This is far cheaper than a retrofit.

---

## 8. Performance at Scale

### 8.1 Message Volume Calculation

**Scenario:** 3 concurrent users editing a 500-node estimate. Each makes ~1 field edit per 5 seconds.

**Broadcast messages:**
- 3 users x 1 edit / 5 seconds = 0.6 edits/second = 36 edits/minute
- Each edit generates 1 broadcast message
- 36 broadcast messages/minute

**Presence messages:**
- Each user updates presence when they change focus (~every 5-10 seconds)
- 3 users x 1 presence update / 7 seconds = ~26 presence messages/minute

**Total:** ~62 messages/minute = ~1 message/second

**Supabase limits:**
- Free tier: 100 messages/second, 2M messages/month
- 62 messages/minute = 3,720/hour = 89,280/day (8-hour workday)
- Monthly (22 working days): ~1.96M messages/month

**Verdict:** Fits within the Free tier. Comfortably within the Pro tier (5M messages/month). This is not even close to a scaling concern. You could have 10 users making edits every 2 seconds and still be well within Pro tier limits.

### 8.2 Full-Tree Recalculation Performance

**Concern:** Does recalculating the full tree on every remote edit cause jank?

**Analysis:** The calculation chain for one node is: `qty * unit_cost = subtotal`, then contingency, then overhead, then total. That is ~5 arithmetic operations per node. For 500 nodes: ~2,500 arithmetic operations. JavaScript performs hundreds of millions of arithmetic operations per second. The full tree recalculation takes **<1ms** on any modern device.

**The expensive part is not calculation but rendering.** If a remote edit to one leaf node causes recalculated totals to propagate to the root (changing 5-10 ancestor nodes), React needs to re-render those 5-10 rows. With proper `React.memo` and keying, this is a handful of DOM updates -- trivial.

**The 50ms debounce for remote edits is a precaution,** not a performance requirement. Even without it, the system would perform fine. The debounce exists to batch rapid-fire remote edits (e.g., another user tabbing through 5 fields in 2 seconds) into one recalculation pass instead of 5.

### 8.3 WebSocket Connection Overhead

Each browser tab subscribed to an estimate holds one WebSocket connection to Supabase. The overhead is:
- ~1KB of memory per connection
- One heartbeat message every 30 seconds (Supabase default)
- Connection is shared across all channels for the same Supabase client

For 3 concurrent users, this is 3 connections. The Free tier allows 200 concurrent connections. Not a concern.

---

## 9. What NOT to Build (MVP Scoping)

### 9.1 Defer These

| Feature | Why defer | When to add |
|---------|----------|-------------|
| Offline editing with sync | Requires conflict-free data structure (CRDT/OT), queue-and-replay logic, merge UI. Enormous complexity for a scenario that rarely occurs (construction estimators work in offices with internet). | Never, unless Zac specifically needs it |
| Conflict history / audit trail | "User A overwrote User B's value of X with Y at time T." Requires logging every overwrite. Not needed for MVP -- the `updated_by` column already tracks who last changed a node. | Phase 10+ if desired |
| Undo others' changes | User B undoes User A's edit. Requires a global undo stack shared across users. Extremely complex. Google Sheets does not support this either -- undo is per-user. | Never (per-user undo is sufficient) |
| Cursor tracking on text fields | Character-by-character cursor position within a text input. This is Google Docs collaboration, not Google Sheets. Estimate fields are short values (numbers, names), not long documents. | Never |
| Live typing preview | Show what another user is typing in real-time, character by character. Overkill for numeric fields. Users only need to see the COMMITTED value, not the in-progress keystrokes. | Never |
| WebSocket multiplexing optimization | Share one WebSocket for multiple estimates open in different tabs. The Supabase client already handles connection pooling. No optimization needed at this scale. | Never (handled by supabase-js) |

### 9.2 The MVP for "Feels Collaborative"

The minimum set of features that creates the "Google Sheets feel":

1. **See who is here.** A small panel showing avatars/names of other users viewing this estimate. (Presence)
2. **See where they are.** Colored highlight on the row another user is focused on. (Presence + UI)
3. **See their changes instantly.** When another user changes a field value, the new value appears in your view within ~50ms. (Broadcast + local state update + recalculation)
4. **No stepping on each other.** If you focus a cell that another user is already editing, you see their color on it. Social signal to work elsewhere. (Presence + UI)
5. **Graceful handling of deletions.** If someone deletes a node you are editing, you get a clear notification rather than a crash. (Broadcast event handler)

That is it. Five features. No offline sync, no conflict merge UI, no cursor tracking, no shared undo. These five features produce the "we're working on this together" experience that Zac described.

---

## 10. Broadcast Message Schemas

Standardized payload shapes for each event type:

```typescript
// Field edit -- single field value change
interface FieldEditPayload {
  node_id: string
  field: string              // 'name' | 'unit_cost' | 'quantity' | 'contingency_rate' | ...
  value: string | number | boolean | null
  user_id: string
  user_name: string          // for toast notifications
  timestamp: number
  version: number            // expected version after this edit
}

// Node add -- new node inserted
interface NodeAddPayload {
  node: {                    // full node data for the new node
    id: string
    parent_id: string | null
    sort_order: number
    node_type: 'group' | 'assembly' | 'item'
    name: string
    // ... all base table fields
  }
  detail?: NodeItemDetail | NodeAssemblyDetail  // type-specific detail if applicable
  user_id: string
  user_name: string
  timestamp: number
}

// Node delete -- node removed
interface NodeDeletePayload {
  node_id: string
  node_name: string          // for notification display
  subtree_ids: string[]      // all descendant node IDs also removed
  user_id: string
  user_name: string
  timestamp: number
}

// Node move -- re-parented or reordered
interface NodeMovePayload {
  node_id: string
  old_parent_id: string | null
  new_parent_id: string | null
  new_sort_order: number
  affected_sort_orders: Array<{ node_id: string; sort_order: number }>  // siblings that shifted
  user_id: string
  user_name: string
  timestamp: number
}

// Tree refresh -- full reload needed (rare: bulk operation, option toggle, etc.)
interface TreeRefreshPayload {
  reason: string             // human-readable explanation
  user_id: string
  user_name: string
  timestamp: number
}
```

---

## 11. Architecture Decision Summary

| Decision | Choice | Alternatives Rejected | Reason |
|----------|--------|----------------------|--------|
| Message transport | Supabase Broadcast | Postgres Changes, WebSocket server | Lowest latency (6ms p50), no DB dependency |
| User awareness | Supabase Presence | Custom heartbeat system | Built-in, handles disconnects automatically |
| Conflict resolution | Last-writer-wins + presence | Field locking, OT, CRDTs | Matches Google Sheets model; appropriate for scalar data |
| External libraries | None (Supabase only) | Yjs, Liveblocks, PartyKit | Already in stack; others add cost and complexity for zero benefit |
| Broadcast granularity | Per-field | Per-node, per-tree | Enables surgical updates; other clients update one cell, not a full row |
| Save granularity | Debounced per-node (500ms) | Per-field, batch on explicit save | Groups rapid sequential edits; avoids version column churn |
| State management | useReducer | useState, Zustand, Redux | Multiple mutation sources (local + remote) need centralized dispatch |
| Recalculation | 50ms debounced for remote edits | Immediate, throttled | Batches rapid remote edits; imperceptible delay |
| Implementation timing | Phase 1B foundation + Phase 7/8 polish | Bolt-on after Phase 6 | useReducer vs. useState choice cascades; cheaper to start right |
| Tree operation conflicts | Toast + graceful degradation | Blocking protection, merge UI | Matches user expectations; rare in practice |

---

## 12. Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|------------|
| WebSocket drops during editing | Remote edits missed; state diverges | Medium | On reconnect, fetch full tree from server and reconcile with local state. Supabase client auto-reconnects. |
| Two users save the same node simultaneously | Version conflict; one save rejected | Low (broadcast delivers remote edits in 6ms; local state is already updated before debounced save fires) | Version column check + toast + refetch |
| Broadcast message lost (network) | One client misses an edit | Very low (WebSocket is reliable; Supabase handles reconnection) | Periodic full-tree refetch (every 5 minutes or on refocus) as a consistency check |
| Supabase Realtime outage | No real-time sync; single-user mode | Very low | Degrade gracefully: disable presence indicators, show "real-time sync unavailable" banner, continue single-user editing |
| Presence update overwhelms rate limit | Presence data stale | Very low (20/sec free is more than enough for 3 users) | Throttle presence updates to 1 per 200ms (5/sec per user max) |

---

## 13. Open Questions for Zac

1. **Is 3 concurrent users the expected maximum, or could it grow to 5-10?** The architecture handles 10+ without changes, but the presence UI (color palette, space for name badges) should be designed for the expected range.

2. **Should clients (the homeowner role) see real-time edits?** When a builder is editing an estimate and a client is viewing it, should the client see changes appear live? Or should the client view be a static snapshot that updates only when the builder explicitly "publishes"?

3. **Auto-save interval preference:** The current design debounces saves at 500ms per node. An alternative is a periodic auto-save (every 30 seconds, save all pending changes). Which feels right? The 500ms debounce is more responsive but generates more saves; the periodic approach batches more but has a larger "unsaved changes" window.
