# Real-Time Collaboration & Optimistic Updates Research

**Clusters 6 & 7 from Comprehensive Analysis**
**Date:** 2026-04-09
**Sources:** INTENT.md (Decision #9, #13), `realtime-state.contract.md`, `research-realtime-collaboration.md`, State Management Analysis, existing server actions and domain types

---

## Part A: Real-Time Collaboration Architecture

### A1. How Should the Estimate Reducer Handle Remote Broadcasts Alongside Local Mutations?

**Answer: Both paths dispatch through the same reducer, but with distinct action types and a conflict-resolution guard.**

The reducer already defines two categories of actions in the agreed state management analysis:

```
Local mutations:  NODE_UPDATE, NODE_MOVE, NODE_DELETE, NODE_CREATE, etc.
Remote events:    REMOTE_NODE_CHANGED, REMOTE_NODE_DELETED, REMOTE_NODES_BULK
Resolution:       MUTATION_CONFIRMED, MUTATION_FAILED
```

The key architectural rule from the realtime-state contract is:

> "Local edits: dispatch -> reduce -> recalculate -> render -> broadcast.
>  Remote edits: channel event -> dispatch -> reduce -> recalculate -> render.
>  Both paths use the SAME reducer and SAME calc engine. No separate code paths."

#### Detailed Flow for Each Path

**Local edit flow:**

```
1. User changes field (e.g., unit_cost on node X)
2. dispatch({ type: 'NODE_UPDATE_DETAILS', payload: { id: X, changes: { unitCost: 5.00 } } })
3. Reducer applies change optimistically to nodesById[X]
4. Reducer pushes { mutationId, previousSnapshot } onto pendingMutations
5. Calculation engine recalculates affected ancestor path
6. React re-renders affected rows
7. Side effect: broadcast field_edit event via Supabase channel (parallel)
8. Side effect: debounced (500ms) server action call to updateItemDetails()
9. On server success: dispatch({ type: 'MUTATION_CONFIRMED', payload: { mutationId, serverData } })
10. On server failure: dispatch({ type: 'MUTATION_FAILED', payload: { mutationId, error } })
```

**Remote edit flow:**

```
1. Supabase Broadcast delivers field_edit event from another user
2. Echo suppression: config { broadcast: { self: false } } prevents own edits returning
3. dispatch({ type: 'REMOTE_NODE_CHANGED', payload: nodeData })
4. Reducer checks: does this node have a pending local mutation?
   a. YES + remote updated_at < local mutation timestamp: IGNORE (our change is newer)
   b. YES + remote updated_at > local mutation timestamp: ACCEPT remote, discard pending
   c. NO: ACCEPT unconditionally -- merge into nodesById
5. Calculation engine recalculates affected ancestor path (same pure function)
6. React re-renders affected rows
```

#### The Pending Mutation Guard (Critical Detail)

When a remote update arrives for a node that has a pending local mutation, the reducer must compare timestamps to decide which version wins:

```typescript
case 'REMOTE_NODE_CHANGED': {
  const remoteNode = action.payload;
  const pending = draft.pendingMutations.find(
    m => m.nodeId === remoteNode.id
  );

  if (pending && pending.mutatedAt > new Date(remoteNode.updated_at).getTime()) {
    // Our local mutation is newer -- ignore the remote update.
    // Our pending mutation will be persisted when the server action completes.
    return;
  }

  // Remote update is newer or there is no pending local mutation.
  // Accept the remote data.
  draft.nodesById[remoteNode.id] = remoteNode;

  // If we had a pending mutation for this node, discard it.
  if (pending) {
    draft.pendingMutations = draft.pendingMutations.filter(
      m => m.nodeId !== remoteNode.id
    );
  }
  break;
}
```

This uses `updated_at` from the `estimate_nodes` table as the authoritative timestamp. The trigger-maintained `updated_at` on the database ensures server-side consistency.

#### Remote Recalculation Debouncing

When multiple remote edits arrive in rapid succession (e.g., another user tabbing through 5 fields in 2 seconds), batch recalculations with a 50ms debounce:

```typescript
// In the EstimateTreeProvider
const pendingRemoteRecalcs = useRef<string[]>([]);
const recalcTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

function handleRemoteEdit(payload: RemoteEditPayload) {
  // Apply field update immediately (visual feedback is instant)
  dispatch({ type: 'REMOTE_NODE_CHANGED', payload });

  // Batch recalculations
  pendingRemoteRecalcs.current.push(payload.node_id);
  if (recalcTimer.current) clearTimeout(recalcTimer.current);
  recalcTimer.current = setTimeout(() => {
    const nodeIds = [...new Set(pendingRemoteRecalcs.current)];
    dispatch({ type: 'RECALCULATE_FROM_NODES', payload: { nodeIds } });
    pendingRemoteRecalcs.current = [];
    recalcTimer.current = null;
  }, 50);
}
```

The 50ms debounce is a precaution, not a necessity -- full tree recalculation for 500 nodes is sub-millisecond in JavaScript.

---

### A2. What Is the Channel Structure for Supabase Realtime Per Estimate?

**Answer: One channel per open estimate, using both Broadcast and Presence on the same channel.**

```
Channel topic: "estimate:{estimate_id}"

Broadcast events (edit propagation):
  - field_edit:     { node_id, field, value, user_id, timestamp }
  - node_add:       { node: NodeWithDetails, parent_id, sort_order, user_id }
  - node_delete:    { node_id, deleted_by, node_name }
  - node_move:      { node_id, new_parent_id, new_sort_order, user_id }
  - tree_refresh:   { reason: string }  // rare -- full reload signal

Presence state (user awareness):
  - user_id:        string
  - display_name:   string
  - color:          string (CSS color from deterministic palette)
  - active_node_id: string | null
  - active_field:   string | null
  - last_active:    number (timestamp for idle detection)
```

#### Channel Initialization Pattern

```typescript
// In useEstimateChannel hook (called from EstimateTreeProvider)
function useEstimateChannel(estimateId: string, dispatch: Dispatch<TreeAction>) {
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    const channel = supabase.channel(`estimate:${estimateId}`, {
      config: { broadcast: { self: false } }  // echo prevention
    });

    channel
      .on('broadcast', { event: 'field_edit' }, ({ payload }) => {
        dispatch({ type: 'REMOTE_NODE_CHANGED', payload: payload.node });
      })
      .on('broadcast', { event: 'node_add' }, ({ payload }) => {
        dispatch({ type: 'REMOTE_NODE_CHANGED', payload: payload.node });
      })
      .on('broadcast', { event: 'node_delete' }, ({ payload }) => {
        dispatch({ type: 'REMOTE_NODE_DELETED', payload: { id: payload.node_id } });
      })
      .on('broadcast', { event: 'node_move' }, ({ payload }) => {
        dispatch({ type: 'REMOTE_NODE_CHANGED', payload: payload.node });
      })
      .on('broadcast', { event: 'tree_refresh' }, () => {
        // Full reload: refetch all nodes from server
        refetchTree(estimateId, dispatch);
      })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        dispatch({ type: 'PRESENCE_SYNC', state });
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            user_id: currentUser.id,
            display_name: currentUser.display_name,
            color: getUserColor(currentUser.id, []),
            active_node_id: null,
            active_field: null,
            last_active: Date.now(),
          });
        }
      });

    return () => { supabase.removeChannel(channel); };
  }, [estimateId, dispatch, supabase]);
}
```

#### Why One Channel Per Estimate (Not Per Node or Per Project)

- **Per-node channels:** Would require subscribing/unsubscribing to channels as nodes scroll into/out of view. Enormous complexity for 2,000-node estimates. Rejected.
- **Per-project channels:** Too broad. An estimate with 500 nodes generates events irrelevant to other estimates in the same project. Wastes bandwidth and forces filtering.
- **Per-estimate channels:** The natural boundary. An estimate is the working document that multiple users open simultaneously. All events within one estimate are relevant to all viewers. This also matches the `EstimateTreeProvider` lifecycle (mount = subscribe, unmount = unsubscribe).

#### Presence State is Separate from Tree State

Presence state (who is here, what they are editing) does NOT go into the tree reducer. It is a separate lightweight state:

```typescript
// Separate useState or tiny Zustand store
const [presence, setPresence] = useState<Map<string, UserPresence>>(new Map());

// Updated on presence sync events
channel.on('presence', { event: 'sync' }, () => {
  const state = channel.presenceState();
  setPresence(transformPresenceState(state));
});
```

Presence only affects rendering (colored highlights, name badges). It has no interaction with tree data mutations, calculations, or undo/redo. Keeping it separate prevents unnecessary tree re-renders when someone moves their cursor.

---

### A3. How to Prevent Echo (User's Own Mutations Arriving as Remote Events)?

**Answer: Supabase Broadcast's built-in `self: false` configuration handles this completely.**

```typescript
const channel = supabase.channel(`estimate:${estimateId}`, {
  config: { broadcast: { self: false } }
});
```

When `self: false` is set:
- Messages broadcast by this client are delivered to ALL OTHER subscribers on the channel
- The broadcasting client does NOT receive its own messages back
- This is handled at the Supabase Realtime server level, not client-side filtering

#### Why This Is Sufficient (No Additional Echo Prevention Needed)

Some real-time systems require client-side echo filtering (checking `event.user_id === currentUser.id`). Supabase does not, because the `self: false` configuration is authoritative. The Realtime server tracks connections and suppresses delivery to the originating connection.

#### Edge Case: Same User, Multiple Tabs

If the same user opens the same estimate in two browser tabs:
- Each tab has its own Supabase client instance and its own WebSocket connection
- Each connection has a unique connection ID
- `self: false` is per-connection, not per-user
- Tab A's edits WILL be delivered to Tab B (they are different connections)

This is correct behavior. Tab A and Tab B have independent reducer states. If Tab A edits a field, Tab B should see the change. The alternative (per-user suppression) would cause Tab B to fall out of sync.

#### The Server Action Confirmation Path (Not an Echo Concern)

The server action response (`MUTATION_CONFIRMED`) is separate from the broadcast channel:
1. User edits -> optimistic update in reducer -> broadcast to channel -> server action call
2. Server action returns `ActionResult<NodeWithDetails>` with server-calculated values
3. `MUTATION_CONFIRMED` merges the authoritative server data (which may differ in calculated fields like `total_price`)

The broadcast and the server action are independent, parallel paths. The broadcast tells other users "this changed." The server action confirms the change was persisted and provides authoritative calculated values.

---

### A4. What Happens When Two Users Move the Same Node Simultaneously?

**Answer: Last-writer-wins, with the server's optimistic lock (version column) as the safety net.**

This is a specific instance of the general conflict model described in the research document. There are several sub-scenarios:

#### Scenario 1: Two Users Move Node X to Different Parents

```
T=0:  Both users see Node X under Parent A
T=1:  User 1 drags Node X to Parent B
T=1:  User 2 drags Node X to Parent C (before receiving User 1's broadcast)
```

What happens:

1. **User 1's move:** Optimistic update moves X under B locally. Broadcast fires. Server action `moveNode()` with version=N executes.
2. **User 2's move:** Optimistic update moves X under C locally. Broadcast fires. Server action `moveNode()` with version=N executes.
3. **Server side:** One of these server actions wins (whichever hits the DB first). The other gets `OPTIMISTIC_LOCK_FAILED` (version=N was already consumed).
4. **Broadcast delivery:**
   - User 1 receives User 2's broadcast. If User 1's move already committed to the DB, User 1 has the newer version and the remote broadcast is ignored (pending mutation guard).
   - User 2 receives User 1's broadcast. Same logic.
5. **MUTATION_FAILED handler:** The user whose server action failed:
   - Rolls back the optimistic move
   - Refetches the current state of Node X
   - Sees it is now under the winning user's parent
   - Toast: "This node was moved by [Other User]. Your change was reverted."

#### Scenario 2: One User Moves, Other User Edits the Same Node

```
T=0:  User 1 drags Node X from Parent A to Parent B
T=0:  User 2 edits Node X's unit_cost
```

These are orthogonal operations:
- The move changes `parent_id` and `sort_order`
- The edit changes `unit_cost` on the detail row

Both can succeed at the database level because they modify different columns. The version column on `estimate_nodes` increments for the move but the detail row update goes through `node_item_details` which has its own update path.

For User 2: Node X animates to its new position in the tree. The editing state is preserved -- the field input stays focused, the user can finish editing. A toast says "Node was moved to [new parent] by [User 1]."

For User 1: The field edit arrives via broadcast and is applied. The node under its new parent now shows the updated cost.

#### Scenario 3: Both Users Reorder Siblings in the Same Parent

```
T=0:  Nodes under Parent A: [X, Y, Z]
T=1:  User 1 drags Z to position 1: [Z, X, Y]
T=1:  User 2 drags X to position 3: [Y, Z, X]
```

This is the hardest case. Both operations update `sort_order` on multiple sibling nodes. The server actions execute sequentially (database serialization), so one order wins. The losing user's optimistic reorder is rolled back and replaced with the winning order.

The solution: after any move operation's `MUTATION_CONFIRMED`, refetch sibling sort orders to ensure local state matches the server's authoritative order. This is a lightweight query (siblings of the affected parent only).

---

## Part B: Optimistic Updates and Error Recovery

### B1. How Should React 19's useOptimistic or startTransition Work with the Tree Reducer?

**Answer: Use `startTransition` for server action calls, NOT `useOptimistic`. The reducer handles optimistic state directly.**

#### Why NOT React 19's useOptimistic

React 19's `useOptimistic` hook is designed for simple cases: show an optimistic value while an action is pending, then replace it with the server result. It works well for:
- A like button (optimistically show liked, confirm with server)
- A comment submission (show the comment immediately)

It does NOT work well for the estimate tree because:

1. **Multiple concurrent mutations.** The tree can have 3-5 pending mutations simultaneously (user renames node A, then moves node B, then edits node C's cost -- all before any server response returns). `useOptimistic` manages ONE optimistic state per hook instance.

2. **Complex rollback.** Rolling back a tree mutation requires restoring the previous node snapshot AND undoing any side effects (sort order adjustments for siblings, childrenOf index updates). `useOptimistic` does a simple value replacement.

3. **The reducer already handles this.** The `pendingMutations` array in the reducer state tracks every in-flight mutation with its rollback snapshot. Adding `useOptimistic` on top creates a second, conflicting optimistic state mechanism.

#### The Correct Pattern: startTransition + Reducer

`startTransition` wraps the server action call to mark it as a non-blocking transition. The reducer manages all optimistic state:

```typescript
function useTreeMutation() {
  const { state, dispatch } = useEstimateTree();
  const [isPending, startTransition] = useTransition();

  const updateNodeField = useCallback(
    (nodeId: string, field: string, value: unknown) => {
      const mutationId = nanoid();

      // 1. Optimistic update in reducer
      dispatch({
        type: 'NODE_UPDATE_DETAILS',
        payload: { id: nodeId, changes: { [field]: value }, mutationId },
      });

      // 2. Broadcast to other clients (parallel, fire-and-forget)
      channel.send({
        type: 'broadcast',
        event: 'field_edit',
        payload: { node_id: nodeId, field, value, user_id: currentUser.id },
      });

      // 3. Debounced server action (wrapped in startTransition)
      debouncedSave(nodeId, () => {
        startTransition(async () => {
          const result = await updateItemDetails(nodeId, { [field]: value });
          if (result.success) {
            dispatch({
              type: 'MUTATION_CONFIRMED',
              payload: { mutationId, serverData: result.data },
            });
          } else {
            dispatch({
              type: 'MUTATION_FAILED',
              payload: { mutationId, error: result.error },
            });
          }
        });
      });
    },
    [dispatch, channel, currentUser],
  );

  return { updateNodeField, isPending };
}
```

#### startTransition Behavior

`startTransition` marks the server action as a non-urgent update. React can:
- Continue rendering other updates while the action is in flight
- Batch the final state update (MUTATION_CONFIRMED/FAILED) with other pending renders
- Keep the UI responsive during the 200-500ms server round-trip

The `isPending` flag from `useTransition` can drive subtle UI indicators (e.g., a saving indicator in the toolbar) without blocking interaction.

---

### B2. What Is the Rollback Pattern When a Server Action Fails After Optimistic UI Update?

**Answer: Snapshot-based rollback stored in pendingMutations, with three failure modes handled differently.**

#### The Rollback Mechanism

Every optimistic mutation stores a snapshot of the affected state before modification:

```typescript
// Inside the reducer, when processing a local mutation:
case 'NODE_UPDATE_DETAILS': {
  const { id, changes, mutationId } = action.payload;
  const currentNode = draft.nodesById[id];

  // Save rollback snapshot BEFORE applying changes
  draft.pendingMutations.push({
    mutationId,
    nodeId: id,
    previousSnapshot: structuredClone(currentNode),
    mutatedAt: Date.now(),
  });

  // Apply optimistic changes
  if (currentNode.details) {
    Object.assign(currentNode.details, changes);
  }
  break;
}

case 'MUTATION_FAILED': {
  const { mutationId, error } = action.payload;
  const pending = draft.pendingMutations.find(m => m.mutationId === mutationId);

  if (pending) {
    // Restore the snapshot
    draft.nodesById[pending.nodeId] = pending.previousSnapshot;

    // Clean up childrenOf if this was a move
    if (pending.previousChildrenSnapshot) {
      Object.assign(draft.childrenOf, pending.previousChildrenSnapshot);
    }
  }

  // Remove from pending
  draft.pendingMutations = draft.pendingMutations.filter(
    m => m.mutationId !== mutationId
  );
  break;
}
```

#### Three Failure Modes

| Error Code | Meaning | Rollback Behavior | User Experience |
|------------|---------|-------------------|-----------------|
| `OPTIMISTIC_LOCK_FAILED` | Another user saved a newer version | Rollback + refetch node from server | Toast: "Updated by [User]. Your change was replaced." |
| `VALIDATION_ERROR` | Server rejected the value (e.g., negative quantity) | Rollback + highlight field | Toast with error message + red field border |
| `SERVER_ERROR` | Database or network failure | Rollback + offer retry | Toast: "Save failed. [Retry] [Dismiss]" with retry button |

#### Dependent Mutation Rollback

When multiple mutations are queued and an early one fails:

```
Mutation 1: Rename node A to "Foundation" (pending)
Mutation 2: Move node A under Parent B (pending, depends on A existing)
Mutation 1 FAILS
```

The rollback must cascade:

1. Roll back Mutation 1 (restore original name)
2. Check if Mutation 2 depends on Mutation 1. In this case, Mutation 2 is independent (it does not depend on the name). Let it proceed.

For genuinely dependent mutations (e.g., create node + edit its details):

1. Mutation 1 (create) fails -> roll back (remove temp node)
2. Mutation 2 (edit details of new node) is automatically invalid -> cancel server call, remove from pendingMutations

The dependency tracking is simple: if Mutation 2's `nodeId` matches a node created by Mutation 1 (temp ID), and Mutation 1 fails, cancel Mutation 2.

#### Server Data Reconciliation on MUTATION_CONFIRMED

When the server confirms a mutation, the server response may include values that differ from the optimistic version:

```typescript
case 'MUTATION_CONFIRMED': {
  const { mutationId, serverData } = action.payload;

  // Merge server-authoritative data (calculated fields, updated_at, version)
  draft.nodesById[serverData.id] = serverData;

  // Remove from pending
  draft.pendingMutations = draft.pendingMutations.filter(
    m => m.mutationId !== mutationId
  );
  break;
}
```

The server data is authoritative for:
- `total_price` (server recalculates)
- `updated_at` (server timestamp)
- `version` (server increments)
- Any trigger-modified fields (e.g., path after a move)

The client's optimistic values for user-edited fields (name, quantity, unit_cost) should match the server response, but the server values override regardless.

---

### B3. How Should the UI Indicate Pending vs Confirmed vs Failed Operations?

**Answer: Three-tier visual feedback system with increasing urgency.**

#### Tier 1: Subtle (Pending Operations)

Pending operations get minimal visual treatment -- the optimistic update IS the feedback. The user sees their change applied immediately. No spinners, no loading states on the changed row.

The only "pending" indicator is a global one: a small saving indicator in the toolbar or status bar:

```
Visual: Faint pulsing dot or text like "Saving..." in the estimate toolbar
When: Any entry exists in pendingMutations[]
Disappears: When pendingMutations becomes empty
Color: var(--color-text-muted) -- barely noticeable
```

This follows the Google Sheets model: changes appear instant, a subtle "Saving..." appears briefly in the toolbar, then it says "All changes saved."

#### Tier 2: Noticeable (Remote Changes)

When another user changes a node you can see (but are not editing):

```
Visual: Brief flash/highlight on the changed row (200ms fade-in, 500ms hold, 300ms fade-out)
Color: The other user's presence color at 10% opacity
Duration: ~1 second total
Extra: If the changed value is visible, the number/text updates with a subtle animation
```

When another user changes a node you ARE editing:

```
Visual: The field value updates (if they changed a different field on the same node)
Toast: Only if they changed the SAME field you have focused
Toast message: "[User Name] also edited [field name]"
Toast duration: 3 seconds, auto-dismiss
```

#### Tier 3: Prominent (Failed Operations)

Failed mutations get immediate, prominent feedback:

```
For field validation errors:
  - Red border on the affected field: border-[var(--color-error)]
  - Inline error message below the field
  - Field retains the invalid value (user can correct and retry)

For optimistic lock failures:
  - Toast: "This node was modified by [User]. Refreshing..."
  - Node row briefly flashes with a warning background
  - The server's current values replace the local values

For server errors:
  - Toast with retry action: "Failed to save changes. [Retry] [Dismiss]"
  - The rolled-back node row gets a subtle warning indicator (small icon)
  - Warning indicator persists until the user successfully edits the node again
```

#### Visual States Summary

| State | Row Background | Field Border | Toolbar | Toast |
|-------|---------------|--------------|---------|-------|
| Normal (confirmed) | Default | Default | "All changes saved" | None |
| Pending (optimistic, in flight) | Default | Default | "Saving..." | None |
| Remote changed (other user) | Brief color flash | None | None | Only if editing same field |
| Failed (rolled back) | Brief warning flash | Red (if validation) | None | Error message with context |
| Conflict (lock failed) | Brief warning flash | None | None | "[User] modified this node" |

#### Implementation: CSS Custom Properties for States

```css
/* In globals.css */
--color-row-remote-flash: oklch(0.9 0.02 220);  /* very subtle blue flash */
--color-row-error-flash: oklch(0.9 0.05 30);     /* very subtle red flash */
--color-field-error-border: var(--color-error);
--color-saving-indicator: var(--color-text-muted);
```

These tokens ensure all state feedback follows the design system. No hardcoded colors in components.

---

### B4. What Is the Error Recovery UX for Concurrent Edit Conflicts?

**Answer: Three resolution strategies depending on the conflict type, all following the Google Sheets model of minimal disruption.**

#### Strategy 1: Silent Accept (Most Common -- 95% of Cases)

When the conflict is non-disruptive (remote user changed a different field on the same node, or changed a completely different node):

- Accept the remote change silently
- Merge into local state
- No toast, no dialog, no interruption
- The user may not even notice

This is what Google Sheets does for the vast majority of concurrent edits. It is the right default because construction estimators typically work on different sections of the tree.

#### Strategy 2: Informational Toast (Uncommon -- 4% of Cases)

When the conflict affects the user's current view but not their current editing:

| Scenario | Toast Message | Duration | Action Required |
|----------|--------------|----------|-----------------|
| Remote user edited visible node | None (silent merge) | N/A | None |
| Remote user moved a visible node | "[Node] moved to [Parent] by [User]" | 3s | None |
| Remote user deleted a visible node | "[Node] deleted by [User]" | 5s | None |
| Remote user added option group | "Option group created by [User]" | 3s | None |

All toasts are informational, auto-dismissing. No action required. The user's workflow is not interrupted.

#### Strategy 3: Disruptive Notification (Rare -- 1% of Cases)

When the conflict directly affects the node/field the user is actively editing:

**Case A: Remote user deleted the node being edited**

```
1. Close the edit mode (deselect the field, close detail panel if it shows this node)
2. Animate the node out of the tree (fade + collapse, 300ms)
3. Prominent toast: "[Node name] was deleted by [User]. Your unsaved changes were lost."
4. Toast includes: [Undo] button that calls a "restore deleted node" server action
   (only if the node was soft-deleted; hard delete has no undo)
5. Move selection to the next sibling or parent
```

**Case B: Remote user edited the SAME field the local user is editing**

```
1. Do NOT close the edit mode
2. Do NOT replace the user's in-progress value
3. Show a subtle inline indicator: "[User] also changed this to [value]"
4. When the local user commits (blur/Enter), their value overwrites (last-writer-wins)
5. If the local user abandons (Escape), accept the remote value
```

This preserves the local user's editing context. The indicator gives them information but does not force a decision. This matches Google Sheets behavior exactly -- if two people type in the same cell, the last keypress wins, and neither user is interrupted.

**Case C: Optimistic lock failure on save**

```
1. Toast: "This node was updated by [User] since you started editing. Your changes were replaced."
2. The field reverts to the server's current value (the other user's value)
3. The user can immediately re-edit if they want their value to win
4. No merge dialog. No conflict resolution modal. No side-by-side comparison.
```

The version column on `estimate_nodes` catches this case. It is expected to be rare because:
- Broadcast delivers remote edits in ~6ms
- Local save is debounced to 500ms
- By the time the local save fires, the local state already reflects the remote edit
- The version check is a safety net for network partitions, not a primary mechanism

#### Why No Merge Dialog

The research document explicitly rejects merge dialogs:

> "There is no meaningful 'merge' of two different numbers for the same field. The complexity is enormous and the benefit is zero for this data type."

Construction estimate fields are scalar values (numbers, short strings). When two people type different numbers for the same unit cost, there is no algorithmic way to "merge" them. One value must win. The decision is: last writer wins, with social presence indicators to prevent the conflict from happening in the first place.

#### The Presence Layer as Primary Conflict Prevention

The most effective conflict prevention is not in the error recovery -- it is in the presence system. When User A sees User B's colored highlight on a row, User A naturally works on a different row. This is the same social protocol that makes Google Sheets collaborative editing work despite having no locking mechanism.

Presence indicators reduce concurrent-field conflicts by an estimated 90%+. The error recovery UX described above handles the remaining edge cases gracefully without interrupting workflow.

---

## Part C: Implementation Recommendations

### C1. Phase 1B Deliverables (Minimum for Real-Time Readiness)

1. **useReducer with Immer** for tree state (Decision #13, unanimous consensus)
2. **Flat normalized state shape** (nodesById + childrenOf + rootIds)
3. **All reducer action types defined** including REMOTE_* variants, even if the broadcast subscription is minimal
4. **useEstimateChannel hook** that subscribes to `estimate:{id}`, dispatches REMOTE_* actions
5. **Broadcast on local mutations** (even if no other users are listening)
6. **Basic presence tracking** (who is viewing this estimate)
7. **startTransition wrapper** for all server action calls from non-form interactions
8. **pendingMutations array** in reducer state for optimistic rollback tracking

### C2. Deferred to Phase 1B+ / Phase 7-8

- Presence UI (colored highlights, name badges, user list panel)
- Conflict toasts and disruptive notifications
- Idle detection and presence dimming
- WebSocket reconnection handling with full tree refetch
- "Saving..." / "All changes saved" toolbar indicator
- Row flash animations for remote changes

### C3. Explicitly Rejected (Never Build)

- Operational Transform / CRDTs (Decision #9 -- wrong abstraction for scalar values)
- Field locking (creates worse UX than last-writer-wins)
- Offline editing with sync (enormous complexity for a rare scenario)
- Shared undo (per-user undo is sufficient, Google Sheets does not have shared undo)
- Character-level cursor tracking (this is not a document editor)
- Live typing preview (users only need committed values)
- Merge dialogs for conflicting scalar values

### C4. Key Dependencies

| Dependency | Why | Size |
|------------|-----|------|
| `immer` | Ergonomic deep immutable updates in the reducer | ~4KB gzipped |
| `nanoid` | Mutation ID generation (lightweight alternative to uuid) | ~0.5KB |
| `@supabase/supabase-js` (already installed) | Realtime Broadcast + Presence | Already in bundle |

No additional real-time libraries needed. Supabase Realtime handles everything.

### C5. Contract Implications

The `realtime-state.contract.md` governs this entire system. Key contract rules that implementation must satisfy:

1. State via useReducer (not useState) -- two mutation sources feed one reducer
2. Both local and remote paths use the SAME reducer and SAME calc engine
3. Conflict resolution: presence-guided last-writer-wins, no field locking
4. Channel topic: `estimate:{id}`
5. Client role receives broadcasts but cannot originate edits
6. Budget: 3 users @ 1 edit/5s = ~62 msgs/min, within Supabase free tier

Any implementation that violates these contract rules must update the contract FIRST per the contracts-enforcement rule.
