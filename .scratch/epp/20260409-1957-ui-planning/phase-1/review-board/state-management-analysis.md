# State & Data Management Analysis

**Analyst:** State & Data Management Specialist
**Date:** 2026-04-09
**Scope:** Tree state management, server/client mutation strategy, optimistic updates, real-time prep, cache coherence, undo/redo

---

## 1. State Management for the Tree View

### The Core Problem

The estimate tree is not a simple list. It is a deeply nested, mutable, multi-type tree (group/assembly/item) with 200-2,000 nodes, where:
- Every node has a discriminated union type (`NodeWithDetails = GroupNode | AssemblyNode | ItemNode`)
- Nodes have detail records from separate tables (base + detail JOIN)
- Sort order, parent-child relationships, expand/collapse, and selection state all co-exist
- Phase 2 adds isomorphic calculations that must fire on every mutation
- Phase 1B adds Supabase Realtime broadcasts that arrive asynchronously

This rules out simple `useState` or even a single `useReducer` without careful design.

### Recommendation: useReducer with Immer -- NOT Zustand or Jotai

**Decision 13 in INTENT.md already mandates `useReducer`.** This is the correct call. Here is why, and how to implement it properly.

#### Why NOT Zustand

Zustand is excellent for simple global state (theme, sidebar collapsed, auth session). It is a poor fit for the tree because:

1. **Two mutation sources.** INTENT Decision #9 says Supabase Realtime broadcasts arrive as external events. useReducer naturally handles dispatching from two sources (local edits and remote broadcasts) through the same reducer -- both produce actions. Zustand's `set()` API makes it harder to distinguish the source of a mutation, which matters for conflict resolution and undo.

2. **Reducer pattern is the right abstraction for complex state machines.** The tree has state transitions that must be validated: a node cannot become an item if it has children, moving a node requires updating sort orders of siblings, indent/outdent may trigger auto-promotion/demotion. A reducer centralizes this logic. Zustand scatters it across `set()` calls.

3. **Undo/redo.** A reducer naturally produces a list of (action, inverse-action) pairs. Zustand requires wrapping every `set()` call with undo bookkeeping, which is fragile.

4. **No external dependency.** The project has zero state management libraries currently. useReducer ships with React. Adding Zustand for a single (albeit complex) feature is unnecessary overhead.

#### Why NOT Jotai

Jotai's atom model is optimized for fine-grained reactivity across many independent pieces of state. The estimate tree is the opposite -- it is one large interconnected structure where changing a leaf node's price must propagate totals up to the root. Jotai would require dozens of derived atoms with complex dependency chains that mirror the tree structure, adding abstraction without benefit.

#### Why useReducer + Immer

The tree state is deeply nested. Immutable updates on a 5-level-deep node require spreading at every level:

```typescript
// Without Immer -- painful for deep trees
return {
  ...state,
  nodes: state.nodes.map(n => n.id === parentId ? {
    ...n,
    children: n.children.map(c => c.id === childId ? {
      ...c,
      details: { ...c.details, quantity: newQty }
    } : c)
  } : n)
};
```

With Immer's `produce()`, the same mutation is:

```typescript
// With Immer -- direct mutation on draft
draft.nodesById[nodeId].details.quantity = newQty;
```

Immer is 4KB gzipped, has zero dependencies, and is the standard approach for complex reducer state. **Add `immer` as a dependency.**

### Recommended State Shape

**CRITICAL: Do NOT store the tree as a nested `TreeNode[]`.** Store it as a flat normalized map with a separate children index. The `TreeNode` type in `nodes.ts` with its recursive `children: TreeNode[]` is for RENDERING, not for state storage.

```typescript
// State shape
interface EstimateTreeState {
  // --- Data (server-authoritative) ---
  nodesById: Record<string, NodeWithDetails>;    // flat lookup
  childrenOf: Record<string, string[]>;          // parent_id -> ordered child IDs
  rootIds: string[];                             // top-level nodes (parent_id === null)

  // --- UI state (client-only) ---
  expandedIds: Set<string>;                      // which nodes are expanded
  selectedId: string | null;                     // currently selected node
  editingId: string | null;                      // node being inline-edited
  dragState: DragState | null;                   // active drag operation

  // --- Mutation state ---
  pendingMutations: PendingMutation[];           // optimistic updates awaiting server confirmation
  undoStack: UndoEntry[];                        // for undo
  redoStack: UndoEntry[];                        // for redo

  // --- Sync state ---
  lastSyncedAt: string | null;                   // ISO timestamp of last server sync
  conflictIds: Set<string>;                      // nodes with unresolved conflicts
}
```

**Why flat + index instead of nested:**

1. **O(1) node lookup.** Finding node `abc-123` in a nested tree requires recursive search. In a flat map, it is `nodesById["abc-123"]`.
2. **O(1) updates.** Changing a node's name in a nested tree requires rebuilding the path from root to node. In a flat map, it is one object replacement.
3. **O(1) re-parenting.** Moving a node means: remove ID from old parent's `childrenOf` array, add to new parent's array, update the node's `parent_id`. In a nested tree, this requires splicing at two different levels.
4. **Rendering builds the tree on demand.** A `buildTreeFromState(state, parentId)` function reconstructs `TreeNode[]` for rendering. React.memo on tree rows prevents re-rendering unchanged subtrees.
5. **Supabase returns flat arrays.** The `getNodes()` action returns `NodeWithDetails[]` (flat). Storing flat avoids an unnecessary tree-building step on load, and the tree-building only happens at the render boundary.

### Reducer Action Catalog

```typescript
type TreeAction =
  // Data mutations (produce server calls)
  | { type: 'NODE_CREATE'; payload: CreateNodeInput }
  | { type: 'NODE_UPDATE'; payload: { id: string; changes: Partial<NodeBase> } }
  | { type: 'NODE_UPDATE_DETAILS'; payload: { id: string; changes: Partial<ItemDetails | AssemblyDetails> } }
  | { type: 'NODE_DELETE'; payload: { id: string } }
  | { type: 'NODE_MOVE'; payload: { id: string; newParentId: string | null; newIndex: number } }
  | { type: 'NODE_DUPLICATE'; payload: { id: string; includeNotes: boolean } }
  | { type: 'NODE_FLAG'; payload: { id: string; flagged: boolean } }
  | { type: 'NODE_SET_VISIBILITY'; payload: { id: string; visibility: ClientVisibility; applyToChildren: boolean } }

  // Optimistic resolution
  | { type: 'MUTATION_CONFIRMED'; payload: { mutationId: string; serverData: NodeWithDetails } }
  | { type: 'MUTATION_FAILED'; payload: { mutationId: string; error: string } }

  // Remote updates (from Supabase Realtime)
  | { type: 'REMOTE_NODE_CHANGED'; payload: NodeWithDetails }
  | { type: 'REMOTE_NODE_DELETED'; payload: { id: string } }
  | { type: 'REMOTE_NODES_BULK'; payload: NodeWithDetails[] }

  // UI state
  | { type: 'TOGGLE_EXPAND'; payload: { id: string } }
  | { type: 'SET_SELECTED'; payload: { id: string | null } }
  | { type: 'SET_EDITING'; payload: { id: string | null } }
  | { type: 'SET_DRAG_STATE'; payload: DragState | null }

  // Bulk operations
  | { type: 'HYDRATE'; payload: NodeWithDetails[] }      // initial load from server
  | { type: 'UNDO' }
  | { type: 'REDO' }
```

### Context Architecture

```
<EstimateTreeProvider estimateId={id}>         // holds useReducer, subscribes to Realtime
  <TreeToolbar />                               // dispatches bulk actions
  <TreeView />                                  // renders from state
    <TreeRow node={node} />                     // dispatches per-node actions
      <TreeRow ... />                           // recursive children
  <NodeDetailPanel />                           // edits selected node's details
</EstimateTreeProvider>
```

The provider creates the reducer, handles server action calls on dispatch, subscribes to Supabase Realtime, and provides `[state, dispatch]` via context. **Do NOT put the entire application state in this context** -- only estimate tree state. Sidebar collapse, auth session, and theme use separate, simpler state mechanisms (Zustand is fine for those global UI concerns).

### Performance Considerations for 2,000 Nodes

- **Virtualization is NOT needed at launch.** A 2,000-row flat list renders fine with React 19's concurrent features. Only ~50-100 rows are visible at once due to expand/collapse. Monitor and add `react-window` or `@tanstack/virtual` if profiling shows jank.
- **React.memo on TreeRow** is essential. Each row should only re-render when its specific node data changes, not when any node in the tree changes.
- **Selector pattern.** Instead of passing the entire state through context, provide selector hooks: `useNode(id)`, `useChildren(parentId)`, `useIsExpanded(id)`. Each subscribes to only the slice of state it needs. This can be done with `useSyncExternalStore` or a context with `useRef` + subscribers pattern, avoiding the "all consumers re-render on any state change" problem of naive context.

---

## 2. Server Actions vs API Calls

### When to Use Server Actions

Server actions (the existing `"use server"` functions in `src/lib/actions/`) are the right choice for:

1. **All data mutations** -- createNode, updateNode, deleteNode, moveNode, duplicateNode, flagNode, setNodeVisibility. These are already implemented and return `ActionResult<T>`.
2. **Initial data loading** -- getNodes, getNode. Called from server components on page load.
3. **Form submissions** -- creating projects, estimates. These are user-initiated, discrete operations.

### When to Use Supabase Client Directly

The browser Supabase client (`createClient()` from `src/lib/supabase/client.ts`) should be used for:

1. **Supabase Realtime subscriptions** -- these MUST use the browser client. Server actions cannot maintain persistent WebSocket connections. The Realtime channel subscription lives in the `EstimateTreeProvider` component.
2. **Presence tracking** -- who is viewing/editing which node. This is a Realtime feature.

### When NOT to Use Supabase Client Directly

**Never use the browser Supabase client for data writes.** Always go through server actions. Reasons:

1. **Validation.** Server actions validate with Zod schemas. Client-side writes bypass this.
2. **Authorization.** RLS provides a safety net, but server actions add application-level authorization logic (checking estimate status, ownership, etc.).
3. **Consistency.** All mutations flow through one code path, making debugging and auditing straightforward.
4. **ActionResult pattern.** Server actions return structured `{ success, data }` or `{ success: false, error, code }`. Direct Supabase calls return raw Supabase errors that must be mapped to user-friendly messages in each component.

### The Hybrid Pattern

```
User edits node name
  -> dispatch({ type: 'NODE_UPDATE', payload: ... })
  -> Reducer applies optimistic update immediately
  -> Side effect calls updateNode() server action
  -> On success: dispatch({ type: 'MUTATION_CONFIRMED' })
  -> On failure: dispatch({ type: 'MUTATION_FAILED' }) -- rolls back

Meanwhile:
  Supabase Realtime broadcasts the change
  -> Other connected clients receive it
  -> Their providers dispatch({ type: 'REMOTE_NODE_CHANGED' })
  -> Their reducers merge the remote update
```

### PROBLEM: Server Actions and Side Effects

React's server action model is designed for form submissions. The tree UI needs server calls triggered by non-form interactions (drag-drop, keyboard shortcuts, inline editing blur). These should use `startTransition` to call server actions without blocking the UI:

```typescript
import { useTransition } from 'react';

const [isPending, startTransition] = useTransition();

function handleNodeMove(id: string, newParentId: string, newIndex: number) {
  dispatch({ type: 'NODE_MOVE', payload: { id, newParentId, newIndex } });
  startTransition(async () => {
    const result = await moveNode({ id, newParentId, newSortOrder: newIndex });
    if (result.success) {
      dispatch({ type: 'MUTATION_CONFIRMED', payload: { mutationId, serverData: result.data } });
    } else {
      dispatch({ type: 'MUTATION_FAILED', payload: { mutationId, error: result.error } });
    }
  });
}
```

---

## 3. Optimistic Updates

### Strategy

Every user-initiated mutation follows this sequence:

1. **Generate a mutation ID** (nanoid or uuid).
2. **Apply the change optimistically** in the reducer. Push `{ mutationId, previousState }` onto `pendingMutations`.
3. **Call the server action** asynchronously.
4. **On success:** Remove from `pendingMutations`. Optionally merge server-returned data (server may have computed fields like `total_price`, `updated_at` that differ from the optimistic version).
5. **On failure:** Roll back by restoring `previousState` for affected nodes. Show error toast.

### What Gets Optimistically Updated

| Operation | Optimistic? | Why |
|-----------|-------------|-----|
| Rename node | YES | Instant feedback essential for inline editing |
| Update quantity/cost | YES | User is typing in a field; lag would feel broken |
| Expand/collapse | N/A | Pure UI state, no server call |
| Move node (drag-drop) | YES | Visual feedback must be immediate |
| Reorder siblings | YES | Same as move |
| Delete node | YES (with confirmation dialog first) | Remove from tree immediately |
| Create node | PARTIAL | Show a placeholder node; replace with real node on server response (need server-generated ID) |
| Duplicate node | NO | Wait for server (needs server-generated IDs for entire subtree) |
| Flag node | YES | Toggle is trivial to reverse |
| Set visibility | YES | Toggle is trivial to reverse |

### Failure Handling

When a server action returns `{ success: false }`:

1. **Roll back the optimistic change.** The reducer replaces the optimistic node(s) with the snapshot saved in `pendingMutations`.
2. **Show an error toast** with the user-friendly message from `ActionResult.error`.
3. **For specific error codes, take additional action:**
   - `OPTIMISTIC_LOCK_FAILED` -- another user changed this node. Refetch and show a conflict indicator.
   - `ITEM_HAS_CHILDREN` -- the auto-promotion trigger rejected the change. Roll back and explain.
   - `TREE_CYCLE_DETECTED` -- the move would create a cycle. Roll back the drag.

### CRITICAL: Node Creation and Server-Generated IDs

When creating a new node, the server generates the UUID. The client cannot predict it. Two approaches:

**Option A: Optimistic with temporary ID.** Generate a temp ID client-side (`temp_${nanoid()}`). Show the node immediately. On server response, replace the temp ID everywhere (nodesById key, childrenOf references, selectedId if selected). This is complex but gives instant feedback.

**Option B: Non-optimistic creation with loading state.** Show a skeleton/spinner in the tree at the insertion point. On server response, insert the real node. Simpler to implement, and node creation is infrequent enough (compared to editing) that a 200ms delay is acceptable.

**Recommendation: Option B for Phase 1B.** Node creation happens via a dialog or button click, not during rapid-fire editing. The 200ms wait is imperceptible after clicking "Add Node." Option A can be added later if users find it sluggish.

---

## 4. Real-Time Collaboration Preparation

### INTENT Decision #9 Requirements

- One Supabase Realtime channel per open estimate
- Broadcast for edit propagation (6ms p50 latency)
- Presence for user awareness (who is viewing/editing what)
- Conflict resolution: presence-guided last-writer-wins

### What Must Be Designed In from Day One

Even though Realtime is Phase 1B, the state architecture must accommodate it NOW. Retrofitting real-time into a state system not designed for it is the exact failure mode Decision #13 warns against.

#### 1. The Reducer Must Accept Remote Actions

The `TreeAction` union already includes `REMOTE_NODE_CHANGED`, `REMOTE_NODE_DELETED`, and `REMOTE_NODES_BULK`. These are dispatched by the Realtime subscription handler. The reducer treats them identically to confirmed local mutations -- it merges the data into `nodesById`.

#### 2. The Reducer Must Distinguish Local vs Remote

When a remote update arrives for a node that has a pending local mutation:
- If the remote timestamp is OLDER than the local mutation, ignore it (our change is newer).
- If the remote timestamp is NEWER, accept it and discard our pending mutation (another user's change wins).

This requires `updated_at` comparison. The `estimate_nodes` table has `updated_at` with a trigger-maintained value. Use it.

#### 3. Presence State is Separate

Presence (who is viewing, who is editing which node) is NOT part of the tree reducer. It is a separate, lightweight piece of state:

```typescript
interface PresenceState {
  users: Map<string, { displayName: string; editingNodeId: string | null; color: string }>;
}
```

This can be a simple `useState` or a tiny Zustand store, updated by Realtime presence events. It does not affect the tree data at all -- it only affects rendering (colored cursors, "being edited by..." indicators).

#### 4. Channel Subscription Lifecycle

```
EstimateTreeProvider mounts
  -> Subscribe to channel `estimate:${estimateId}`
  -> Listen for broadcast events: node_changed, node_deleted, nodes_bulk
  -> Track presence: join with user info
  -> On unmount: unsubscribe, leave presence

EstimateTreeProvider receives broadcast:
  -> dispatch({ type: 'REMOTE_NODE_CHANGED', payload: broadcastData })
  -> Reducer merges into state
```

#### 5. Debouncing Broadcasts

When the local user edits a field (typing in a text input), do NOT broadcast on every keystroke. Debounce at 300-500ms. The server action is already debounced by the time the user stops editing (blur or explicit save), but Realtime broadcasts of intermediate state should also be throttled.

### What Can Wait

- Conflict resolution UI (highlight conflicting nodes, show "edited by X") -- Phase 1B
- Cursor position sharing -- Phase 1B
- Operational transform / CRDT -- EXPLICITLY REJECTED by Decision #9. Last-writer-wins is sufficient for structured data.

---

## 5. Cache Management and State Coherence

### The Coherence Problem

The same node data appears in multiple views:
1. **Tree view** -- the main tree rendering
2. **Detail panel** -- the selected node's full details (including item/assembly details)
3. **Search results** -- nodes matching a filter query
4. **Snapshot viewer** -- a read-only tree from a snapshot

### Solution: Single Source of Truth

The `nodesById` map in the reducer IS the single source of truth. All views read from it.

- **Tree view:** Reads `nodesById` + `childrenOf` + `rootIds` to build the visual tree.
- **Detail panel:** Reads `nodesById[selectedId]` directly. When the selected node is updated in the reducer (by any source -- local, server confirmation, or remote broadcast), the detail panel re-renders automatically.
- **Search results:** A derived computation. Apply filters to `Object.values(nodesById)`. Use `useMemo` with the search query and `nodesById` as dependencies. When a node changes, the search results update if the changed node matches the filter.

### Snapshot Viewer is Separate

Snapshot data is JSONB blobs. Snapshots are immutable and do NOT share state with the live tree. The snapshot viewer gets its own read-only state, initialized from the snapshot JSONB, and never merged with the live tree reducer. This is by design (INTENT Decision #23).

### React Server Components and the State Boundary

The page component (`/app/estimates/[id]/page.tsx`) should be a server component that:
1. Calls `getNodes(estimateId)` server-side
2. Passes the flat `NodeWithDetails[]` array as initial data to the client component

```typescript
// Server component (page.tsx)
export default async function EstimatePage({ params }: { params: { id: string } }) {
  const result = await getNodes(params.id);
  if (!result.success) return <ErrorState error={result.error} />;
  return <EstimateTreeProvider initialNodes={result.data} estimateId={params.id} />;
}

// Client component (EstimateTreeProvider.tsx)
'use client';
export function EstimateTreeProvider({ initialNodes, estimateId, children }) {
  const [state, dispatch] = useReducer(treeReducer, initialNodes, buildInitialState);
  // ... Realtime subscription, context provider, etc.
}
```

This pattern gives us:
- Server-side data loading (no loading spinner on initial render)
- Client-side state management (for interactivity)
- Clean boundary between server and client concerns

### Revalidation Strategy

When the user navigates away from the estimate page and comes back, the server component re-fetches from the database. The client reducer re-initializes with the fresh data. This is the correct behavior -- we do NOT need to cache tree data across navigations. Each estimate page visit gets fresh data.

For within-page staleness (user has been editing for 30 minutes), the Realtime subscription keeps data fresh. If the WebSocket disconnects and reconnects, the provider should re-fetch the full tree to catch up.

---

## 6. Undo/Redo

### The Hard Problem

Undo in a locally-managed list is trivial: snapshot the state before each action, push to a stack, pop on undo. But this application has server-persisted data. When the user undoes a node rename:

1. The client must revert the visual state (easy)
2. The client must send the REVERSE mutation to the server (a server action call with the old value)
3. If the server call fails, the undo itself must be rolled back (undo-of-undo)

### Recommended Approach: Command Pattern with Inverse Operations

Each mutation produces an `UndoEntry`:

```typescript
interface UndoEntry {
  mutationId: string;
  description: string;                         // "Renamed 'Framing' to 'Structural Framing'"
  forward: TreeAction;                         // the action that was performed
  inverse: TreeAction;                         // the action that reverses it
  serverForward: () => Promise<ActionResult>;   // server call for redo
  serverInverse: () => Promise<ActionResult>;   // server call for undo
}
```

When the user presses Ctrl+Z:

1. Pop from `undoStack`, push to `redoStack`
2. Dispatch `entry.inverse` to the reducer (optimistic undo)
3. Call `entry.serverInverse()` asynchronously
4. On failure: dispatch `entry.forward` to re-apply (undo failed, restore state)

### What Operations Are Undoable

| Operation | Undoable? | Inverse |
|-----------|-----------|---------|
| Rename node | YES | Rename back to old value |
| Update quantity/cost | YES | Update back to old value |
| Move node | YES | Move back to old parent + sort order |
| Reorder siblings | YES | Reorder back to old positions |
| Delete node | COMPLEX | Requires re-creating the node (and entire subtree if it had children). The inverse must store the full deleted subtree data. |
| Create node | YES | Delete the created node |
| Flag/unflag | YES | Toggle flag |
| Change visibility | YES | Set back to old visibility |
| Duplicate node | YES | Delete the duplicate |

### Undo Stack Depth

Cap at 50 entries. Construction estimators make hundreds of edits per session; unlimited undo would accumulate significant memory.

### CRITICAL ISSUE: Delete Undo

Undoing a delete requires recreating the node and all its children with their details. The `deleteNode` server action does a hard CASCADE delete. To support undo:

**Option A:** Change delete to soft-delete (set `deleted_at`, filter in queries). Undo clears `deleted_at`. This is the cleanest approach but requires modifying every query to filter out soft-deleted nodes.

**Option B:** Before deleting, snapshot the full subtree into the undo entry. On undo, call `createNode` for each node in the subtree, re-linking parent IDs. This is complex and may produce different UUIDs (the recreated nodes get new server-generated IDs).

**Option C:** For Phase 1B, make delete NOT undoable. Show a confirmation dialog that says "This cannot be undone." Add undo-delete in a future phase.

**Recommendation: Option C for Phase 1B, migrate to Option A later.** Delete undo is the hardest undo operation and touches the database schema. Do not let it block Phase 1B. The confirmation dialog is standard UX. Option A (soft delete) should be planned for Phase 2+ as it requires schema migration and query modifications across all server actions.

### Undo and Real-Time Collaboration

When two users are editing the same estimate, User A's undo could revert a value that User B has since changed. The correct behavior:

1. User A presses undo
2. The inverse action dispatches, which calls the server action with the old value
3. The server applies it (last-writer-wins)
4. Realtime broadcasts the change to User B
5. User B sees the value change (it was "overwritten" by User A's undo)

This is acceptable for a single-company tool. Google Sheets behaves similarly -- undo reverts YOUR last action, even if someone else has since edited the same cell. The "presence-guided" part of Decision #9's conflict resolution means the UI can show "User A is editing this cell" to minimize simultaneous edits on the same field.

---

## 7. Findings Summary

### MUST-DO (Blocking)

| # | Finding | Severity |
|---|---------|----------|
| S1 | **Use flat normalized map for tree state, NOT nested `TreeNode[]`.** Store `nodesById` + `childrenOf` + `rootIds`. Build the nested tree at the render boundary only. | BLOCKING -- nested tree state will cause O(n) updates for every mutation and make Realtime integration painful |
| S2 | **Add `immer` as a dependency.** useReducer with deeply nested immutable updates on a 2,000-node tree without Immer will produce bugs. ~4KB cost. | BLOCKING -- reducer code quality |
| S3 | **Design the reducer action union to include remote actions from day one.** Even though Realtime is Phase 1B, the reducer shape must accommodate `REMOTE_NODE_CHANGED` etc. Adding remote action types later means rewriting the reducer. | BLOCKING -- retrofitting is Decision #13's explicit concern |
| S4 | **Server component fetches, client component manages state.** Page.tsx is async server component calling `getNodes()`. `EstimateTreeProvider` is a client component receiving initial data as props. | BLOCKING -- wrong boundary here means either no SSR or no interactivity |

### SHOULD-DO (High Priority)

| # | Finding | Severity |
|---|---------|----------|
| S5 | **Implement selector hooks (`useNode(id)`, `useChildren(parentId)`) to prevent re-render cascades.** With 2,000 nodes, naive context consumption will cause the entire tree to re-render on every state change. | HIGH -- performance at scale |
| S6 | **Cap undo stack at 50, make delete non-undoable in Phase 1B.** Full delete undo requires either soft-delete schema changes or complex subtree snapshot/replay. Ship the simple version first. | HIGH -- scope control |
| S7 | **Use `startTransition` for all non-form server action calls.** Tree interactions (drag, keyboard, inline edit blur) are not form submissions. `startTransition` prevents blocking the UI during server calls. | HIGH -- perceived performance |
| S8 | **Debounce inline edit server calls at 500ms.** Do not call `updateNode()` on every keystroke. Debounce to when the user pauses or blurs the field. | HIGH -- server load and Realtime noise |

### CONSIDER (Medium Priority)

| # | Finding | Severity |
|---|---------|----------|
| S9 | **Add Zustand for global UI state (sidebar, theme) separately from the tree reducer.** Do not mix tree data state with UI shell state. Different concerns, different update frequencies, different persistence needs. | MEDIUM -- separation of concerns |
| S10 | **Do not add virtualization yet.** With expand/collapse, the visible node count is typically 50-200. React.memo on TreeRow + selector hooks should suffice. Add react-window only if profiling shows problems. | MEDIUM -- premature optimization risk |
| S11 | **Design the reconnection strategy for Realtime.** When the WebSocket disconnects and reconnects, the provider should re-fetch the full node list to catch up on missed broadcasts. Without this, the tree can silently drift. | MEDIUM -- reliability |

### WARNINGS

| # | Finding | Severity |
|---|---------|----------|
| W1 | **The existing `TreeNode` type (recursive `children: TreeNode[]`) is for rendering, NOT for state.** If the tree state is stored as nested `TreeNode[]`, every mutation requires O(depth) spreading. The codebase already has this type defined in `src/lib/types/domain/nodes.ts` -- it must be used only at the render boundary, never as the reducer state shape. | WARNING -- type misuse risk |
| W2 | **The existing server actions return the mutated node, NOT the full tree.** After `updateNode()`, you get back one `NodeWithDetails`. The reducer must merge this into `nodesById`, not replace the whole tree. This is correct and efficient, but the reducer must handle the case where server-returned data differs from the optimistic state (e.g., `updated_at` timestamp). | WARNING -- subtle merge logic |
| W3 | **`moveNode` returns only the moved node, but siblings need sort_order updates too.** When a node is moved, the siblings in both the old and new parent need their sort_orders renumbered. The current `moveNode` action only updates the moved node's `parent_id` and `sort_order`. The client must optimistically renumber siblings, and may need to re-fetch siblings after confirmation if the server renumbers differently. | WARNING -- potential state drift after move |
| W4 | **`duplicateNode` does NOT duplicate children.** The current server action duplicates only the specified node (not its subtree). This is different from what users expect when they "duplicate a group." Either document this clearly or add subtree duplication. | WARNING -- feature gap |

---

## 8. Recommended Dependencies

| Package | Version | Purpose | Size |
|---------|---------|---------|------|
| `immer` | ^10 | Immutable state updates in reducer | ~4KB gzipped |
| `nanoid` | ^5 | Mutation IDs for optimistic updates | ~1KB gzipped |

No other state management libraries needed. No Zustand for tree state (useReducer suffices). No Jotai. No Redux. No TanStack Query for tree data (the reducer IS the cache). TanStack Query MAY be useful later for non-tree data (project lists, cost code lookups) but is not needed in Phase 1B.

---

## 9. Architecture Diagram

```
Page.tsx (Server Component)
  |-- getNodes(estimateId) -- server-side fetch
  |-- passes NodeWithDetails[] as props
  v
EstimateTreeProvider (Client Component)
  |-- useReducer(treeReducer, initialNodes, buildInitialState)
  |-- Supabase Realtime subscription (Phase 1B+)
  |-- Provides: [state, dispatch] via context
  |-- Provides: selector hooks (useNode, useChildren, useIsExpanded)
  |
  +-- TreeToolbar
  |     |-- dispatches: NODE_CREATE, bulk actions
  |     |-- calls server actions via startTransition
  |
  +-- TreeView (virtualized if needed)
  |     |-- reads: rootIds, childrenOf
  |     |-- renders TreeRow recursively
  |     |
  |     +-- TreeRow (React.memo)
  |           |-- reads: useNode(id), useIsExpanded(id), useChildren(id)
  |           |-- dispatches: TOGGLE_EXPAND, SET_SELECTED, NODE_MOVE (drag)
  |           |-- inline edit -> dispatches NODE_UPDATE (debounced)
  |
  +-- NodeDetailPanel
        |-- reads: useNode(selectedId)
        |-- form fields -> dispatch NODE_UPDATE_DETAILS (debounced)
        |-- calls server actions via startTransition
```

---

## 10. Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Context re-render cascade with 2,000 nodes | UI jank, dropped frames | Selector hooks + React.memo on TreeRow |
| Optimistic update diverges from server state | Stale data displayed | Always merge server-returned data on confirmation; re-fetch on reconnect |
| Undo stack memory with large trees | OOM on long sessions | Cap at 50 entries; store minimal diffs, not full state snapshots |
| Drag-and-drop sort order conflicts with concurrent editors | Inconsistent ordering | Re-fetch siblings after move confirmation; Realtime broadcasts catch up |
| Server action latency during rapid inline editing | Lost edits if user navigates away | Debounce + track pending mutations; warn on navigate if mutations pending |
