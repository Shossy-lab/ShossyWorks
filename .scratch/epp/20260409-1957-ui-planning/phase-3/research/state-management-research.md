# State Management Research: Complex Tree Patterns

**Cluster:** 2 -- State Management Patterns for Complex Trees
**Date:** 2026-04-09
**Scope:** Immer + useReducer performance, normalized tree state, optimistic server actions, select/expand/focus state, flatVisibleRows memoization

---

## 1. Optimal Immer-Based Reducer Pattern for Flat Normalized Tree (2000 Nodes)

### 1.1 Immer Performance Characteristics at Scale

Immer's performance at the ShossyWorks scale (200-2,000 nodes in `nodesById: Record<string, NodeWithDetails>`) is well within safe territory. Key data points from Immer's official benchmarks and community testing:

- **Official benchmark:** 50,000 todo items with 5,000 updates -- Immer with proxies is roughly 2-3x slower than hand-written reducers. At 2,000 nodes, this overhead is negligible (sub-millisecond difference).
- **Structural sharing:** Immer automatically shares unchanged portions of the state tree. When updating `nodesById["abc-123"]`, only that entry gets a new reference. The other 1,999 entries retain their existing references. This is critical -- it means `React.memo` comparisons on unchanged `TreeRow` components will correctly bail out.
- **Automatic no-op detection:** If a `produce()` callback makes no actual changes, Immer returns the original reference. This prevents unnecessary re-renders when a dispatch results in a no-op (e.g., trying to expand an already-expanded node).

### 1.2 The Record vs Map vs Array Decision

Immer GitHub issue #649 reveals a performance nuance for large collections:

| Data Structure | Immer Performance | Lookup | Serializable? |
|---|---|---|---|
| `Record<string, T>` (object) | Good at 2K, degrades at 200K+ | O(1) by key | Yes |
| `Map<string, T>` | ~10x faster than objects at scale | O(1) by key | No (breaks JSON serialization) |
| `Array<T>` | Fastest with Immer | O(n) for ID lookup | Yes |

**Decision: Use `Record<string, NodeWithDetails>` for `nodesById`.** At 2,000 nodes, the performance difference between Record and Map is irrelevant. Record is JSON-serializable (needed for snapshots, SSR hydration, DevTools inspection), and provides the O(1) lookup that the normalized state pattern requires. The 200K+ degradation threshold is 100x beyond ShossyWorks' maximum scale.

### 1.3 Recommended Reducer Structure with Immer

The correct pattern uses Immer's curried `produce()` to wrap the entire reducer:

```typescript
import { produce } from 'immer';

import type { EstimateTreeState, TreeAction } from './types';

export const treeReducer = produce(
  (draft: EstimateTreeState, action: TreeAction): void => {
    switch (action.type) {
      case 'NODE_UPDATE': {
        const { id, changes } = action.payload;
        const node = draft.nodesById[id];
        if (!node) return;
        // Direct mutation on draft -- Immer handles immutability
        Object.assign(node, changes);
        // Recompute flatVisibleRows only if structural change
        // (name changes don't affect visibility)
        break;
      }

      case 'NODE_UPDATE_DETAILS': {
        const { id, changes } = action.payload;
        const node = draft.nodesById[id];
        if (!node || !node.details) return;
        Object.assign(node.details, changes);
        break;
      }

      case 'TOGGLE_EXPAND': {
        const { id } = action.payload;
        if (draft.expandedIds.has(id)) {
          draft.expandedIds.delete(id);
        } else {
          draft.expandedIds.add(id);
        }
        // MUST recompute flatVisibleRows
        recomputeFlatVisibleRows(draft);
        break;
      }

      case 'HYDRATE': {
        const nodes = action.payload;
        draft.nodesById = {};
        draft.childrenOf = {};
        draft.rootIds = [];

        for (const node of nodes) {
          draft.nodesById[node.id] = node;
          const parentKey = node.parent_id ?? '__root__';
          if (!draft.childrenOf[parentKey]) {
            draft.childrenOf[parentKey] = [];
          }
          draft.childrenOf[parentKey].push(node.id);
          if (node.parent_id === null) {
            draft.rootIds.push(node.id);
          }
        }

        // Sort children by sort_order
        for (const key of Object.keys(draft.childrenOf)) {
          draft.childrenOf[key].sort((a, b) => {
            const nodeA = draft.nodesById[a];
            const nodeB = draft.nodesById[b];
            return (nodeA?.sort_order ?? 0) - (nodeB?.sort_order ?? 0);
          });
        }

        draft.rootIds.sort((a, b) => {
          const nodeA = draft.nodesById[a];
          const nodeB = draft.nodesById[b];
          return (nodeA?.sort_order ?? 0) - (nodeB?.sort_order ?? 0);
        });

        recomputeFlatVisibleRows(draft);
        draft.totalCount = nodes.length;
        break;
      }

      // ... other cases
    }
  }
);
```

### 1.4 Critical Performance Optimization: Scope the produce() Correctly

Immer's official guidance for performance-critical paths is to avoid drafting the entire large collection when you only need to mutate one item. For ShossyWorks at 2,000 nodes, the full `produce()` approach is fine. But if profiling ever shows Immer as a bottleneck:

**Escape hatch -- draft only the sub-object:**

```typescript
// Instead of wrapping the entire reducer in produce():
case 'NODE_UPDATE_DETAILS': {
  const { id, changes } = action.payload;
  // Only draft the single node, merge back with vanilla JS
  const updatedNode = produce(state.nodesById[id], draft => {
    if (draft.details) Object.assign(draft.details, changes);
  });
  return {
    ...state,
    nodesById: { ...state.nodesById, [id]: updatedNode },
  };
}
```

This pattern avoids proxy creation for all 2,000 entries when only one node changes. **Do NOT use this pattern by default** -- it sacrifices readability for a micro-optimization that is unnecessary at the 2,000-node scale. Keep it as a documented escape hatch.

### 1.5 Enable `enableMapSet()` for Set Support

The `expandedIds`, `selectedIds`, and `conflictIds` fields use `Set<string>`. Immer requires explicit opt-in for Set/Map support:

```typescript
import { enableMapSet } from 'immer';

// Call once at app initialization (e.g., in the provider module)
enableMapSet();
```

Without this, mutating Sets in a draft will throw. This adds ~1KB to the Immer bundle but is required for the state shape.

---

## 2. useReducer Performance with Complex Immer produce on Frequent Dispatches

### 2.1 Dispatch Frequency Profile

The estimate tree has distinct dispatch frequency bands:

| Interaction | Frequency | Immer Cost | Concern Level |
|---|---|---|---|
| Inline name editing (keystrokes) | 10-30/sec (debounced to 1/500ms) | Low -- single field mutation | NONE (debounced before dispatch) |
| Expand/collapse | 1-5/sec burst | Medium -- triggers flatVisibleRows recompute | LOW |
| Drag-and-drop move | 1/gesture | Medium -- updates childrenOf, sort_orders | LOW |
| Detail panel field edits | 1-3/sec (debounced) | Low -- single detail field mutation | NONE |
| Server action confirmation | 1-10/sec | Low -- merges single node | NONE |
| Remote Realtime broadcast | 1-5/sec | Low -- merges single node | NONE |
| HYDRATE (initial load) | Once | High -- processes entire tree | NONE (runs once) |

### 2.2 React's Dispatch Stability Guarantee

`useReducer` returns a `dispatch` function with a stable identity -- it never changes between renders. This means:

- Child components receiving `dispatch` via props or context never re-render due to dispatch identity changes.
- Unlike `useState` setter + callback pattern, there is no closure stale-state risk.
- `dispatch` can be safely passed to `useEffect` dependencies without causing effect re-runs.

### 2.3 The Re-render Cascade Problem and Solutions

The core performance challenge: when `useReducer` produces a new state reference, every component consuming that state via `useContext` re-renders. With 2,000 nodes and naive context consumption, this means all visible TreeRow components (30-50 via virtual scroll) re-render on every single dispatch.

**Solution: The External Store Pattern with `useSyncExternalStore`**

Instead of passing the full state through Context, expose a subscription-based store:

```typescript
// tree-store.ts
import { useCallback, useRef, useSyncExternalStore } from 'react';
import { produce } from 'immer';

import type { EstimateTreeState, TreeAction } from './types';

export function createTreeStore(initialState: EstimateTreeState) {
  let state = initialState;
  const listeners = new Set<() => void>();

  return {
    getState: () => state,
    dispatch: (action: TreeAction) => {
      state = treeReducer(state, action);
      listeners.forEach(listener => listener());
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

type TreeStore = ReturnType<typeof createTreeStore>;
```

**Selector hooks that prevent re-render cascades:**

```typescript
// use-tree-selectors.ts
import { useSyncExternalStore } from 'react';

export function useNode(store: TreeStore, id: string): NodeWithDetails | undefined {
  return useSyncExternalStore(
    store.subscribe,
    () => store.getState().nodesById[id],
  );
}

export function useChildren(store: TreeStore, parentId: string | null): string[] {
  const key = parentId ?? '__root__';
  return useSyncExternalStore(
    store.subscribe,
    () => store.getState().childrenOf[key] ?? EMPTY_ARRAY,
  );
}

export function useIsExpanded(store: TreeStore, id: string): boolean {
  return useSyncExternalStore(
    store.subscribe,
    () => store.getState().expandedIds.has(id),
  );
}

export function useSelectedId(store: TreeStore): string | null {
  return useSyncExternalStore(
    store.subscribe,
    () => store.getState().selectedId,
  );
}

const EMPTY_ARRAY: string[] = [];
```

**How `useSyncExternalStore` prevents cascades:** React compares the return value of the snapshot function using `Object.is()`. If the selected slice has not changed (same object reference for the node, same boolean for expanded), the component skips re-rendering entirely. A dispatch that updates node "abc-123" will only re-render the TreeRow for "abc-123" and any component selecting that specific node.

### 2.4 Context Shape

The Context should carry the stable store reference (never changes) and dispatch (never changes), NOT the state itself:

```typescript
interface TreeContextValue {
  store: TreeStore;
  dispatch: (action: TreeAction) => void;
  estimateId: string;
}

const TreeContext = createContext<TreeContextValue | null>(null);
```

Components use the selector hooks (which internally call `useSyncExternalStore`) to read specific state slices. The context value object has a stable reference because `store` and `dispatch` never change. This eliminates the "all consumers re-render on any context change" problem entirely.

### 2.5 React 19+ Compiler Considerations

React 19's compiler (if enabled) performs automatic memoization at build time. However, `useSyncExternalStore` is still the correct pattern for external store subscription because:

1. The compiler optimizes component-level memoization, not store subscription granularity.
2. The compiler cannot infer which slice of a context value a component actually depends on.
3. `useSyncExternalStore` is the React team's endorsed pattern for this exact use case.

---

## 3. Correct Action Type Union for Optimistic Server Action Dispatch

### 3.1 Action Categories

The action union must cleanly separate four concerns:

1. **User-initiated mutations** (produce optimistic updates + server calls)
2. **Server confirmations/failures** (resolve optimistic updates)
3. **Remote broadcasts** (external mutations from other users)
4. **Pure UI state** (expand, select, focus -- no server interaction)

### 3.2 Complete Action Type Union

```typescript
// ── Mutation ID generation ────────────────────────
// Each optimistic mutation gets a unique tracking ID
type MutationId = string; // nanoid()

// ── User-initiated data mutations ─────────────────
// These produce optimistic updates AND trigger server action calls
type DataMutationAction =
  | { type: 'NODE_CREATE'; payload: { mutationId: MutationId; input: CreateNodeInput } }
  | { type: 'NODE_UPDATE'; payload: { mutationId: MutationId; id: string; changes: Partial<NodeBase> } }
  | { type: 'NODE_UPDATE_DETAILS'; payload: { mutationId: MutationId; id: string; changes: Partial<ItemDetails | AssemblyDetails> } }
  | { type: 'NODE_DELETE'; payload: { mutationId: MutationId; id: string } }
  | { type: 'NODE_MOVE'; payload: { mutationId: MutationId; id: string; newParentId: string | null; newIndex: number } }
  | { type: 'NODE_DUPLICATE'; payload: { mutationId: MutationId; id: string; includeNotes: boolean } }
  | { type: 'NODE_FLAG'; payload: { mutationId: MutationId; id: string; flagged: boolean } }
  | { type: 'NODE_SET_VISIBILITY'; payload: { mutationId: MutationId; id: string; visibility: ClientVisibility; applyToChildren: boolean } };

// ── Optimistic resolution ─────────────────────────
// Dispatched by the side-effect layer after server action completes
type OptimisticResolutionAction =
  | { type: 'MUTATION_CONFIRMED'; payload: { mutationId: MutationId; serverData: NodeWithDetails } }
  | { type: 'MUTATION_CONFIRMED_VOID'; payload: { mutationId: MutationId } } // for delete
  | { type: 'MUTATION_FAILED'; payload: { mutationId: MutationId; error: string; code: ErrorCode } };

// ── Remote updates (Supabase Realtime) ────────────
// Dispatched by the Realtime subscription handler
type RemoteAction =
  | { type: 'REMOTE_NODE_UPSERT'; payload: { node: NodeWithDetails; timestamp: string } }
  | { type: 'REMOTE_NODE_DELETE'; payload: { id: string; timestamp: string } }
  | { type: 'REMOTE_NODES_BULK'; payload: { nodes: NodeWithDetails[]; timestamp: string } };

// ── UI state (no server interaction) ──────────────
type UIAction =
  | { type: 'TOGGLE_EXPAND'; payload: { id: string } }
  | { type: 'EXPAND_ALL' }
  | { type: 'COLLAPSE_ALL' }
  | { type: 'SET_SELECTED'; payload: { id: string | null } }
  | { type: 'SET_FOCUSED'; payload: { id: string | null } }
  | { type: 'SET_EDITING'; payload: { id: string | null } }
  | { type: 'SET_DRAG_STATE'; payload: DragState | null };

// ── Lifecycle ─────────────────────────────────────
type LifecycleAction =
  | { type: 'HYDRATE'; payload: NodeWithDetails[] }
  | { type: 'UNDO' }
  | { type: 'REDO' };

// ── The union ─────────────────────────────────────
export type TreeAction =
  | DataMutationAction
  | OptimisticResolutionAction
  | RemoteAction
  | UIAction
  | LifecycleAction;
```

### 3.3 Why `mutationId` on Every Data Mutation

Every user-initiated data mutation carries a `mutationId` (generated via `nanoid()`). This serves three purposes:

1. **Optimistic tracking.** The reducer stores `{ mutationId, snapshot }` in `pendingMutations`. When `MUTATION_CONFIRMED` arrives with the matching `mutationId`, the pending entry is removed.
2. **Failure rollback.** When `MUTATION_FAILED` arrives, the reducer finds the pending mutation by ID and restores the snapshot.
3. **Deduplication.** If Realtime broadcasts the same change that was locally initiated, the reducer can check if a pending mutation already accounts for this change and skip the remote update.

### 3.4 The Dispatch + Side-Effect Pattern

The component layer dispatches the action (for optimistic update), then calls the server action in `startTransition`:

```typescript
function useTreeMutation(store: TreeStore) {
  const [isPending, startTransition] = useTransition();

  const updateNode = useCallback((id: string, changes: Partial<NodeBase>) => {
    const mutationId = nanoid();

    // 1. Optimistic update (synchronous -- UI updates immediately)
    store.dispatch({
      type: 'NODE_UPDATE',
      payload: { mutationId, id, changes },
    });

    // 2. Server call (async -- does not block UI)
    startTransition(async () => {
      const result = await serverUpdateNode(id, changes);
      if (result.success) {
        store.dispatch({
          type: 'MUTATION_CONFIRMED',
          payload: { mutationId, serverData: result.data },
        });
      } else {
        store.dispatch({
          type: 'MUTATION_FAILED',
          payload: { mutationId, error: result.error, code: result.code },
        });
      }
    });
  }, [store, startTransition]);

  return { updateNode, isPending };
}
```

### 3.5 Why NOT React 19's `useOptimistic`

React 19 introduced `useOptimistic` for simple optimistic UI patterns. It is NOT suitable for the tree reducer because:

1. **`useOptimistic` manages a single optimistic overlay on top of authoritative state.** The tree has concurrent pending mutations (user edits node A, then immediately edits node B before A confirms). `useOptimistic` is designed for one-at-a-time transitions.
2. **Automatic rollback is too coarse.** `useOptimistic` rolls back all optimistic state when the transition ends. The tree needs per-mutation rollback -- a failure on mutation A should not roll back mutation B.
3. **The reducer pattern already handles this.** The `pendingMutations` array in the reducer state is a more precise and flexible mechanism than `useOptimistic`'s transition-scoped overlay.
4. **`useOptimistic` requires the authoritative state to flow from a parent.** In the tree architecture, the authoritative state IS the reducer state (updated by server confirmations and Realtime broadcasts). There is no separate "server state" prop to pass to `useOptimistic`.

**The correct pattern is the one described in 3.4:** dispatch for optimistic update, `startTransition` for the server call, dispatch confirmation/failure to resolve.

### 3.6 Pending Mutation Tracking

```typescript
interface PendingMutation {
  mutationId: string;
  actionType: DataMutationAction['type'];
  affectedNodeIds: string[];
  snapshot: Record<string, NodeWithDetails>; // pre-mutation state for affected nodes
  timestamp: number;
}
```

The reducer pushes to `pendingMutations` on every `DataMutationAction` and pops on `MUTATION_CONFIRMED` / `MUTATION_FAILED`. This enables:

- **Rollback:** On failure, restore affected nodes from `snapshot`.
- **Conflict detection:** When a `REMOTE_NODE_UPSERT` arrives for a node with a pending mutation, compare timestamps. If the remote update is newer, accept it and discard the pending mutation.
- **UI indicators:** Components can check if a node has pending mutations to show a "saving..." indicator.

---

## 4. Select/Expand/Focus State Layer Structure

### 4.1 Three Distinct States (W3C ARIA Tree Pattern)

The W3C ARIA Authoring Practices Guide defines three independent states for tree items:

| State | ARIA Attribute | Purpose | Keyboard Interaction |
|---|---|---|---|
| **Focused** | `tabindex="0"` on focused item, `-1` on others | Which node receives keyboard events | Arrow keys move focus |
| **Selected** | `aria-selected="true"` | Which node(s) the user has chosen for action | Space/Enter toggles, click sets |
| **Expanded** | `aria-expanded="true/false"` | Whether children are visible | Right arrow expands, Left arrow collapses |

These are independent -- a node can be focused without being selected, selected without being focused, and expanded independent of both.

### 4.2 Recommended State Shape

```typescript
// In EstimateTreeState:
{
  // Expanded state -- persistent across interactions
  expandedIds: Set<string>;

  // Selection state -- single-select for Phase 1B
  selectedId: string | null;

  // Focus state -- which node has keyboard focus (roving tabindex)
  focusedId: string | null;

  // Editing state -- which node's name is being inline-edited
  editingId: string | null;
}
```

### 4.3 Why These Are Separate Fields (Not a Single "activeNode")

Combining focus, selection, and editing into one field ("selection follows focus") is tempting for simplicity but breaks key interactions:

1. **Arrow-key browsing without selecting.** User presses ArrowDown to scan the tree. Focus moves, but selection should not change until the user explicitly presses Enter or Space. Premature selection would trigger the detail panel to switch on every arrow key press, which is jarring when rapidly scanning.

2. **Keyboard editing flow.** When `editingId` is set, the inline text input captures keystrokes. ArrowUp/Down should not move focus out of the edit field. `focusedId` stays on the editing node while keyboard navigation is suspended.

3. **Multi-select (Phase 2).** When multi-select is added, `selectedIds: Set<string>` replaces `selectedId`. Focus is always a single node; selection can be many. This separation is forward-compatible.

4. **Detail panel stability.** The detail panel shows the selected node's editor. Focus can roam freely without disturbing the panel. Selection changes only on explicit user action (click, Enter, Space).

### 4.4 State Transitions

```
Initial state:
  focusedId = rootIds[0] (first node)
  selectedId = null
  editingId = null

User clicks node "abc":
  focusedId = "abc"
  selectedId = "abc"     (click selects AND focuses)

User presses ArrowDown:
  focusedId = next visible node
  selectedId = "abc"     (unchanged -- browsing mode)

User presses Enter:
  selectedId = focusedId (confirm selection)
  Detail panel updates to show focused node

User presses F2 or double-clicks:
  editingId = selectedId (enter inline edit mode)
  focusedId = selectedId (focus stays on editing node)

User presses Escape during edit:
  editingId = null       (exit edit mode)
  focusedId = selectedId (focus returns to selected node)

User presses Escape without editing:
  selectedId = null      (deselect)
  focusedId unchanged    (focus stays for continued keyboard nav)
```

### 4.5 Roving Tabindex Implementation

The tree uses the roving tabindex pattern (recommended by W3C APG):

```typescript
// In TreeNodeRow component:
<div
  role="treeitem"
  tabIndex={isFocused ? 0 : -1}
  aria-selected={isSelected}
  aria-expanded={hasChildren ? isExpanded : undefined}
  aria-level={depth + 1}
  aria-setsize={siblingCount}
  aria-posinset={positionInSet}
  onKeyDown={handleKeyDown}
  onClick={handleClick}
>
```

Only the focused node has `tabIndex={0}`. All others have `tabIndex={-1}`. This means:
- Tab into the tree focuses the one node with `tabIndex={0}`.
- Arrow keys programmatically move focus by updating `focusedId` and calling `element.focus()`.
- Tab out of the tree moves to the next focusable element (detail panel, toolbar, etc.).

### 4.6 Expand State and Collapsed-Child Selection Inheritance

Per the W3C pattern: "If the branch node of a selected child node is collapsed, the parent node should inherit the selected state so the user does not lose the context of what is selected."

Implementation in the reducer:

```typescript
case 'TOGGLE_EXPAND': {
  const { id } = action.payload;
  if (draft.expandedIds.has(id)) {
    // Collapsing -- check if selected node is a descendant
    draft.expandedIds.delete(id);
    if (draft.selectedId && isDescendantOf(draft, draft.selectedId, id)) {
      // Move selection to the collapsing parent
      draft.selectedId = id;
    }
    if (draft.focusedId && isDescendantOf(draft, draft.focusedId, id)) {
      draft.focusedId = id;
    }
  } else {
    draft.expandedIds.add(id);
  }
  recomputeFlatVisibleRows(draft);
  break;
}
```

---

## 5. flatVisibleRows Memoization Pattern

### 5.1 The Core Question: Reducer vs useMemo

The comprehensive analysis identified a disagreement between analysts on where to compute `flatVisibleRows`. The resolution was to compute it in the reducer. Here is the detailed rationale and implementation.

### 5.2 Why Compute in the Reducer (Not useMemo)

**Arguments for reducer-side computation:**

1. **Single recomputation point.** The flat row list changes only when: (a) tree structure changes (add/remove/move node), or (b) expand/collapse state changes. The reducer knows exactly when these happen because it processes the actions that cause them. A `useMemo` would need to track `nodesById`, `childrenOf`, `rootIds`, and `expandedIds` as dependencies, recomputing on any reference change to these objects.

2. **Avoids render-phase computation.** The virtual scroller reads `flatVisibleRows` directly from state. If computed in `useMemo`, the first render after a dispatch would do the computation synchronously during render. In the reducer, the computation happens during the dispatch (off the render path), and the render only reads the pre-computed result.

3. **Consistent state snapshots.** When `useSyncExternalStore` takes a snapshot, `flatVisibleRows` is already consistent with the current `expandedIds` and `nodesById`. No intermediate state where rows and expand state disagree.

4. **No dependency tracking bugs.** `useMemo` dependencies on complex objects (Records, Sets) are fragile. If Immer creates a new `nodesById` reference for a mutation that does not affect visibility, `useMemo` would unnecessarily recompute. The reducer can be precise: only call `recomputeFlatVisibleRows()` in action handlers that actually affect visibility.

**Arguments against (mitigated):**

- "Reducer should be lean" -- True in general, but the tree-walk is O(visible nodes), not O(total nodes). With typical expand/collapse, this is 50-200 nodes, completing in < 1ms.
- "Derived state in reducers violates separation of concerns" -- The flatVisibleRows IS the state shape that consumers need. It is not derived data; it is a precomputed index for efficient rendering.

### 5.3 The FlatRow Type

```typescript
interface FlatRow {
  id: string;
  depth: number;           // indentation level (0 = root)
  nodeType: NodeType;      // 'group' | 'assembly' | 'item'
  hasChildren: boolean;    // determines expand chevron visibility
  isExpanded: boolean;     // current expand state
  parentId: string | null; // for breadcrumb/path display
}
```

Note: `FlatRow` does NOT include the full `NodeWithDetails`. It contains only the metadata needed for the virtual scroller to render the correct row structure. The actual node data is read by each `TreeNodeRow` via the `useNode(id)` selector hook. This separation means `flatVisibleRows` changes only on structural changes, not on every data edit.

### 5.4 Recomputation Algorithm

```typescript
function recomputeFlatVisibleRows(draft: EstimateTreeState): void {
  const rows: FlatRow[] = [];

  function walk(nodeIds: string[], depth: number): void {
    for (const id of nodeIds) {
      const node = draft.nodesById[id];
      if (!node) continue;

      const childIds = draft.childrenOf[id] ?? [];
      const hasChildren = childIds.length > 0;
      const isExpanded = draft.expandedIds.has(id);

      rows.push({
        id,
        depth,
        nodeType: node.node_type,
        hasChildren,
        isExpanded,
        parentId: node.parent_id,
      });

      if (hasChildren && isExpanded) {
        walk(childIds, depth + 1);
      }
    }
  }

  walk(draft.rootIds, 0);
  draft.flatVisibleRows = rows;
  draft.totalCount = Object.keys(draft.nodesById).length;
}
```

**Performance characteristics:**
- Walks only visible nodes (expanded branches). Collapsed subtrees are skipped entirely.
- Typical case: 50-200 nodes visited (with most subtrees collapsed).
- Worst case: 2,000 nodes (everything expanded). Still < 2ms on modern hardware.
- Called only on: `HYDRATE`, `TOGGLE_EXPAND`, `EXPAND_ALL`, `COLLAPSE_ALL`, `NODE_CREATE` (when parent is expanded), `NODE_DELETE`, `NODE_MOVE`.
- NOT called on: `NODE_UPDATE`, `NODE_UPDATE_DETAILS`, `NODE_FLAG`, `SET_SELECTED`, `SET_FOCUSED` (these do not change tree structure or visibility).

### 5.5 Which Actions Trigger Recomputation

| Action | Recompute flatVisibleRows? | Why |
|---|---|---|
| `HYDRATE` | YES | Entire tree rebuilt |
| `TOGGLE_EXPAND` | YES | Visibility changes |
| `EXPAND_ALL` / `COLLAPSE_ALL` | YES | Mass visibility change |
| `NODE_CREATE` | YES (if parent expanded) | New node appears in visible list |
| `NODE_DELETE` | YES | Node removed from visible list |
| `NODE_MOVE` | YES | Node moves to different position/parent |
| `NODE_UPDATE` | NO | Data change, not structural |
| `NODE_UPDATE_DETAILS` | NO | Detail data, not structural |
| `NODE_FLAG` | NO | Metadata, not structural |
| `SET_SELECTED` / `SET_FOCUSED` | NO | UI state, not structural |
| `MUTATION_CONFIRMED` | CONDITIONAL | Only if server data changes parent_id |
| `REMOTE_NODE_UPSERT` | CONDITIONAL | Only if parent_id or sort_order changed |
| `REMOTE_NODE_DELETE` | YES | Node removed |

### 5.6 Integration with @tanstack/react-virtual

The virtual scroller consumes `flatVisibleRows` directly:

```typescript
function VirtualTreeRenderer() {
  const flatRows = useSyncExternalStore(
    store.subscribe,
    () => store.getState().flatVisibleRows,
  );

  const rowVirtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: () => ROW_HEIGHT, // fixed row height for Phase 1B
    overscan: 10,
  });

  return (
    <div ref={scrollElementRef} style={{ height: '100%', overflow: 'auto' }}>
      <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
        {rowVirtualizer.getVirtualItems().map(virtualRow => {
          const flatRow = flatRows[virtualRow.index];
          return (
            <TreeNodeRow
              key={flatRow.id}
              flatRow={flatRow}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                transform: `translateY(${virtualRow.start}px)`,
                width: '100%',
                height: `${virtualRow.size}px`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
```

### 5.7 Fixed vs Variable Row Height

Phase 1B should use fixed row height (e.g., 36px or 40px). Variable row heights with `@tanstack/react-virtual` require `ResizeObserver` measurement on each row, which adds complexity and introduces layout shift. Fixed height means:

- `estimateSize` is exact, not an estimate.
- No `ResizeObserver` overhead.
- Smooth, predictable scrolling.
- Simpler implementation.

Variable row heights (for multi-line descriptions, expanded detail previews) can be added in Phase 2 if needed.

---

## 6. Additional Implementation Guidance

### 6.1 The `buildInitialState` Function

The `EstimateTreeProvider` receives `NodeWithDetails[]` from the server component and must build the initial `EstimateTreeState`:

```typescript
function buildInitialState(nodes: NodeWithDetails[]): EstimateTreeState {
  const state: EstimateTreeState = {
    nodesById: {},
    childrenOf: {},
    rootIds: [],
    expandedIds: new Set<string>(),
    selectedId: null,
    focusedId: null,
    editingId: null,
    dragState: null,
    pendingMutations: [],
    undoStack: [],
    redoStack: [],
    lastSyncedAt: new Date().toISOString(),
    conflictIds: new Set<string>(),
    flatVisibleRows: [],
    totalCount: 0,
  };

  // Process nodes into normalized shape
  for (const node of nodes) {
    state.nodesById[node.id] = node;
    const parentKey = node.parent_id ?? '__root__';
    if (!state.childrenOf[parentKey]) {
      state.childrenOf[parentKey] = [];
    }
    state.childrenOf[parentKey].push(node.id);
    if (node.parent_id === null) {
      state.rootIds.push(node.id);
    }
  }

  // Sort by sort_order
  for (const key of Object.keys(state.childrenOf)) {
    state.childrenOf[key].sort((a, b) =>
      (state.nodesById[a]?.sort_order ?? 0) - (state.nodesById[b]?.sort_order ?? 0)
    );
  }
  state.rootIds.sort((a, b) =>
    (state.nodesById[a]?.sort_order ?? 0) - (state.nodesById[b]?.sort_order ?? 0)
  );

  // Default: expand only root-level nodes
  for (const id of state.rootIds) {
    state.expandedIds.add(id);
  }

  // Set focus to first visible node
  if (state.rootIds.length > 0) {
    state.focusedId = state.rootIds[0];
  }

  // Compute initial flatVisibleRows
  state.flatVisibleRows = computeFlatVisibleRows(state);
  state.totalCount = nodes.length;

  return state;
}
```

### 6.2 Undo Stack Structure

```typescript
interface UndoEntry {
  mutationId: string;
  description: string;        // e.g., "Renamed 'Framing' to 'Structural Framing'"
  forward: DataMutationAction; // the action that was performed
  inverse: DataMutationAction; // the action that reverses it
  snapshot: Record<string, NodeWithDetails>; // affected nodes pre-mutation
}
```

Undo stack is capped at 50 entries. Delete is not undoable in Phase 1B (confirmation dialog instead). See state-management-analysis.md Section 6 for full undo/redo design.

### 6.3 Remote Conflict Resolution in the Reducer

```typescript
case 'REMOTE_NODE_UPSERT': {
  const { node, timestamp } = action.payload;
  const existing = draft.nodesById[node.id];

  // Check for pending local mutation on this node
  const pendingIdx = draft.pendingMutations.findIndex(
    pm => pm.affectedNodeIds.includes(node.id)
  );

  if (pendingIdx >= 0) {
    const pending = draft.pendingMutations[pendingIdx];
    // Remote is newer than our pending mutation -- accept remote, discard pending
    if (new Date(timestamp).getTime() > pending.timestamp) {
      draft.nodesById[node.id] = node;
      draft.pendingMutations.splice(pendingIdx, 1);
    }
    // Otherwise: our pending mutation is newer -- ignore remote update
    return;
  }

  // No pending mutation -- straightforward merge
  const structuralChange = !existing ||
    existing.parent_id !== node.parent_id ||
    existing.sort_order !== node.sort_order;

  draft.nodesById[node.id] = node;

  if (structuralChange) {
    // Rebuild childrenOf index for affected parents
    rebuildChildrenOf(draft, existing?.parent_id, node.parent_id, node.id);
    recomputeFlatVisibleRows(draft);
  }
  break;
}
```

---

## 7. Recommended Dependencies

| Package | Version | Purpose | Bundle Size |
|---|---|---|---|
| `immer` | ^10 | Immutable state updates in reducer | ~4KB gzipped |
| `nanoid` | ^5 | Mutation IDs for optimistic tracking | ~1KB gzipped |

**Not needed:** Zustand (tree state is useReducer), Jotai (wrong model for interconnected tree), Redux (overkill), TanStack Query (reducer IS the cache for tree data), `use-immer` (raw `produce()` wrapping the reducer is cleaner and more explicit).

---

## 8. Key Decisions Summary

| # | Decision | Rationale |
|---|---|---|
| D1 | `Record<string, NodeWithDetails>` for nodesById | JSON-serializable, O(1) lookup, 2K nodes well within Immer's performance envelope |
| D2 | Curried `produce()` wrapping entire reducer | Cleaner than per-case produce; escape hatch documented for future optimization |
| D3 | `enableMapSet()` for Set support | Required for expandedIds, selectedIds, conflictIds |
| D4 | `useSyncExternalStore` + selector hooks for re-render prevention | Solves the context cascade problem; endorsed by React team |
| D5 | Context carries store + dispatch, NOT state | Stable context reference = zero spurious re-renders from context |
| D6 | `mutationId` on every data mutation action | Enables per-mutation rollback, deduplication, and pending tracking |
| D7 | Custom dispatch+startTransition, NOT useOptimistic | useOptimistic too coarse for concurrent mutations; reducer pattern is more precise |
| D8 | Three independent states: focused, selected, expanded | W3C APG compliance; forward-compatible with multi-select; prevents jarring panel switches |
| D9 | flatVisibleRows computed in reducer, not useMemo | Single recomputation point; avoids render-phase work; precise trigger control |
| D10 | Fixed row height for Phase 1B | Eliminates ResizeObserver complexity; smooth scrolling guaranteed |

---

## 9. Sources

- [Immer Official Performance Documentation](https://immerjs.github.io/immer/performance/)
- [Immer GitHub Issue #649: Array vs Object Performance](https://github.com/immerjs/immer/issues/649)
- [React useReducer Documentation](https://react.dev/reference/react/useReducer)
- [React useSyncExternalStore Documentation](https://react.dev/reference/react/useSyncExternalStore)
- [React useOptimistic Documentation](https://react.dev/reference/react/useOptimistic)
- [React startTransition Documentation](https://react.dev/reference/react/startTransition)
- [W3C ARIA Tree View Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/)
- [Carbon Design System Tree View Usage](https://carbondesignsystem.com/components/tree-view/usage/)
- [Retool: Designing UI for Tree Data](https://retool.com/blog/designing-a-ui-for-tree-data)
- [UX Patterns: Tree View Pattern](https://uxpatterns.dev/patterns/data-display/tree-view)
- [Simplify Immutable Data Structures with Immer](https://prateeksurana.me/blog/simplify-immutable-data-structures-in-usereducer-with-immer/)
- [useSyncExternalStore -- The Underrated React API](https://thisweekinreact.com/articles/useSyncExternalStore-the-underrated-react-api)
- [Replacing Redux with Optimized React Context](https://evolved.io/articles/replacing-redux-with-optimized-react-context)
- [TypeScript Discriminated Union Actions](https://www.benmvp.com/blog/type-checking-react-usereducer-typescript/)
