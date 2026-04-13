# Keyboard Navigation and Accessibility Research

**Cluster:** 3 (from Comprehensive Analysis)
**Date:** 2026-04-09
**Status:** Research complete -- ready for implementation planning

---

## 1. WAI-ARIA Tree View Keyboard Interaction Requirements

Source: [WAI-ARIA Tree View Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/)

### 1.1 Required Keyboard Interactions

| Key | Action |
|-----|--------|
| **Down Arrow** | Move focus to the next visible node (does not expand/collapse) |
| **Up Arrow** | Move focus to the previous visible node (does not expand/collapse) |
| **Right Arrow** | On collapsed parent: expand. On expanded parent: move to first child. On end node: nothing |
| **Left Arrow** | On expanded parent: collapse. On child/end node: move to parent. On collapsed root: nothing |
| **Home** | Move focus to first node in tree |
| **End** | Move focus to last visible node in tree |
| **Enter** | Activate the focused node (select, open editor, follow link) |

### 1.2 Optional but Recommended Interactions

| Key | Action |
|-----|--------|
| **Space** | Toggle selection of focused node (multi-select trees) |
| **\* (asterisk)** | Expand all siblings at the focused node's level |
| **Type-ahead** | Focus moves to next node whose name starts with typed character(s) |

### 1.3 Multi-Select Keyboard (Recommended Model -- no modifier keys)

| Key | Action |
|-----|--------|
| **Space** | Toggle selection of focused node |
| **Shift+Down/Up** | Move focus and toggle selection state |
| **Shift+Space** | Select contiguous nodes from last selected to focused |
| **Ctrl+Shift+Home** | Select from focus to first node |
| **Ctrl+Shift+End** | Select from focus to last node |
| **Ctrl+A** | Select all nodes (optional) |

### 1.4 Focus Initialization

- **Single-select tree:** When tree receives focus, focus goes to the selected node (if any) or the first node.
- **Multi-select tree:** When tree receives focus, focus goes to the first selected node (if any) or the first node.
- Focus and selection are distinct concepts. A node can be focused without being selected and vice versa.

---

## 2. Professional Tree Editor Keyboard Patterns

### 2.1 VS Code (File Explorer / Outline)

VS Code uses a virtualized list internally and treats its trees as single-tab-stop widgets where arrow keys handle all in-tree navigation. Key patterns:

- **Arrow Up/Down:** Navigate between visible items
- **Right Arrow:** Expand collapsed; move to first child if expanded
- **Left Arrow:** Collapse expanded; move to parent if leaf
- **Enter:** Open/activate the selected item (open file, jump to symbol)
- **Space:** Toggle selection in multi-select mode
- **Home/End:** Jump to first/last item
- **Type-ahead:** Start typing a name to filter/focus matching items

VS Code does NOT use Tab for indent/outdent in tree views. Tab exits the tree entirely to the next UI region. Indent/outdent of code uses Tab only inside text editors, not tree panels.

Source: [VS Code Accessibility Guidelines](https://github.com/microsoft/vscode/wiki/Accessibility-Guidelines)

### 2.2 Figma (Layers Panel)

Figma uses a navigation-centric model for its layers tree:

- **Enter:** Navigate down into child layers (select children of focused frame)
- **Shift+Enter:** Navigate up to parent layer
- **Tab:** Select next sibling layer within the same parent frame
- **Shift+Tab:** Select previous sibling layer
- **Alt+L (Opt+L on Mac):** Toggle layers panel visibility
- **Alt+click expand arrow:** Expand/collapse ALL nested layers under a node

Figma does NOT use Tab for indent/outdent. Layers cannot be reordered or re-parented via keyboard in the layers panel -- drag-and-drop is the primary reparenting mechanism. Tab moves between sibling layers, which is a non-standard use of Tab that conflicts with WAI-ARIA guidance.

Source: [Figma Keyboard Shortcuts](https://help.figma.com/hc/en-us/articles/360040328653-Use-Figma-products-with-a-keyboard)

### 2.3 Notion (Block Editor)

Notion uses Tab/Shift+Tab for indentation within its block editor:

- **Tab:** Indent (nest block under the block above it)
- **Shift+Tab:** Outdent (unnest block from its parent)
- **Arrow Up/Down:** Move between blocks
- **Enter:** Create new block / confirm edit
- **Shift+Enter:** Soft line break within a block
- **Escape:** Deselect / exit edit mode

Notion captures Tab within the editor context. This is a known accessibility concern: once inside the editor, Tab no longer moves focus to the next UI element. Notion mitigates this by treating the editor as a modal-like focus region.

Source: [Notion Keyboard Shortcuts](https://www.notion.com/help/keyboard-shortcuts)

### 2.4 Construction Estimating Software (Cubit)

Cubit Estimating uses keyboard shortcuts for estimate sheet operations. Specific tree navigation shortcuts are not publicly documented in detail, but the software supports:

- **I / E keys:** Toggle pricing mode (inclusive/exclusive) on focused row
- Standard spreadsheet-like navigation (arrow keys between cells)
- Copy/paste for estimate items
- Mouse-driven tree manipulation for hierarchy changes

Source: [Cubit Keyboard Shortcuts](https://bsoft.zendesk.com/hc/en-us/articles/360000640935-Keyboard-and-Mouse-Shortcuts-in-Cubit-Estimating)

### 2.5 Pattern Summary Across Products

| Feature | VS Code | Figma | Notion | WAI-ARIA Spec |
|---------|---------|-------|--------|---------------|
| Arrow Up/Down for row nav | Yes | No (uses Tab) | Yes | Yes (required) |
| Right/Left for expand/collapse | Yes | No | No | Yes (required) |
| Tab exits widget | Yes | No (sibling nav) | No (indent) | Yes (required) |
| Enter to activate | Yes | Yes (enter children) | Yes (new block) | Yes (required) |
| Home/End | Yes | No | No | Yes (required) |
| Type-ahead | Yes | No | No | Yes (optional) |
| Tab for indent/outdent | No | No | Yes | No (conflicts) |

**Key insight:** Only Notion uses Tab for indent/outdent, and it explicitly captures Tab, creating an accessibility trade-off. VS Code and the WAI-ARIA specification both require Tab to exit the composite widget.

---

## 3. ARIA Roles and Properties for a Tree-Table Hybrid

### 3.1 Pure Tree (`role="tree"`) vs Treegrid (`role="treegrid"`)

ShossyWorks must choose between two ARIA patterns based on the interaction model:

**Option A: `role="tree"` (recommended for Phase 1B)**

```
Container: role="tree" aria-label="Estimate items"
  Each row: role="treeitem" tabindex="-1" aria-expanded="true|false"
    Children: role="group"
      Child rows: role="treeitem" tabindex="-1"
```

Use when:
- Rows are the primary interactive unit (select a row, open its detail panel)
- There are no individually focusable/editable cells within rows
- The tree is navigation-oriented, not data-entry-oriented

**Option B: `role="treegrid"` (Phase 2+ when inline editing is added)**

```
Container: role="treegrid" aria-label="Estimate items"
  Each row: role="row" aria-expanded="true|false" aria-level="N"
    Cells: role="gridcell" or role="rowheader"
```

Use when:
- Individual cells within rows are interactive (editable inline)
- Users need to navigate between cells with arrow keys
- The widget behaves like a spreadsheet with hierarchy

Source: [WAI-ARIA Treegrid Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treegrid/)

### 3.2 Recommended Phased Approach

**Phase 1B: Use `role="tree"` with `role="treeitem"`**

Rationale:
- Phase 1B uses side-panel editing, not inline cell editing
- Tree rows are display-only with click-to-select behavior
- The simpler tree pattern is easier to implement correctly
- All editing happens in the detail panel (separate focus context)

**Phase 2+: Migrate to `role="treegrid"` when inline editing is added**

When inline cell editing is introduced (qty, cost fields directly in tree rows), the widget becomes a treegrid. This requires:
- Adding `role="row"` and `role="gridcell"` semantics
- Implementing cell-level keyboard navigation (Left/Right between cells)
- Managing the distinction between "row navigation mode" and "cell edit mode"

### 3.3 Required ARIA Attributes (Phase 1B)

| Element | Attribute | Value | Notes |
|---------|-----------|-------|-------|
| Tree container | `role` | `"tree"` | Root element |
| Tree container | `aria-label` | `"Estimate items"` | Or `aria-labelledby` |
| Tree container | `aria-multiselectable` | `"true"` | If multi-select supported |
| Parent treeitem | `role` | `"treeitem"` | Each visible row |
| Parent treeitem | `aria-expanded` | `"true"` or `"false"` | Only on nodes with children |
| Parent treeitem | `tabindex` | `"0"` or `"-1"` | Roving tabindex (see section 5) |
| Parent treeitem | `aria-selected` | `"true"` or `"false"` | Selection state |
| Leaf treeitem | `role` | `"treeitem"` | No `aria-expanded` |
| Leaf treeitem | `aria-selected` | `"true"` or `"false"` | Selection state |
| Child group | `role` | `"group"` | Wraps children of expanded node |

### 3.4 Attributes Required for Virtualized Trees

When the complete set of nodes is not in the DOM (which is always the case with virtual scrolling), the following attributes become **required** per the spec:

| Attribute | Purpose | Applied to |
|-----------|---------|------------|
| `aria-level` | Nesting depth (1-based) | Every `treeitem` |
| `aria-setsize` | Total siblings at this level | Every `treeitem` |
| `aria-posinset` | Position within siblings (1-based) | Every `treeitem` |

These attributes are normally computed by the browser from the DOM structure (nested `role="group"` elements). In a virtualized tree, the DOM structure is flat (all rows are siblings of the virtual scroller container), so the browser cannot compute these values. They must be set explicitly.

### 3.5 React Aria Reference Implementation

Adobe's React Aria library (GA as of March 2025) implements a Tree component using the pure `role="tree"` pattern with:
- Roving tabindex for focus management
- `aria-expanded` on parent items
- Selection via `aria-selected`
- Keyboard navigation (arrows, Home, End, type-ahead)
- Drag-and-drop via `useDragAndDrop` hook
- `TreeLoadMoreItem` for dynamic loading / infinite scroll

This validates the pure-tree approach for Phase 1B. React Aria's internal virtualizer handles the flat-DOM issue by setting `aria-level`, `aria-setsize`, and `aria-posinset` explicitly.

Source: [React Aria Tree](https://react-aria.adobe.com/Tree)

---

## 4. Tab/Shift+Tab for Indent/Outdent vs Standard Focus Management

### 4.1 The Core Conflict

The WAI-ARIA specification is unambiguous: **Tab must move focus out of a composite widget** (tree, listbox, grid, toolbar) to the next focusable element on the page. Using Tab for indent/outdent within a tree violates this requirement and traps keyboard-only users inside the widget.

However, Tab for indent/outdent is the overwhelmingly intuitive shortcut for users of:
- Notion, Google Docs, Microsoft Word (outliner mode)
- Spreadsheet software (indent within cells)
- Code editors (VS Code, but only in text editing, not tree navigation)

### 4.2 Solution: Mode-Based Tab Behavior

The established pattern from rich text editors (codified in WordPress Gutenberg, Lexical, Joplin) is a **mode toggle**:

**Navigation Mode (default when tree first receives focus):**
- Tab/Shift+Tab: Exit the tree to the next/previous focusable element (standard behavior)
- Arrow keys: Navigate between rows
- All WAI-ARIA tree keyboard interactions apply

**Action Mode (activated by explicit user intent):**
- Tab: Indent focused node (move under previous sibling)
- Shift+Tab: Outdent focused node (move to parent's parent)
- Escape or Ctrl+M: Return to Navigation Mode
- A visual indicator (e.g., subtle border change, status bar text) shows which mode is active

**Activation triggers for Action Mode:**
- User presses Ctrl+M (W3C recommended toggle)
- User performs first editing action (rename, add node)
- Mode persists until user explicitly exits or the tree loses focus

### 4.3 Recommended Implementation for ShossyWorks

Given that the primary users are construction estimators (power users, not casual web users), and the most common hierarchy operation is indent/outdent:

1. **Default to Navigation Mode** when the tree receives focus via Tab
2. **Expose indent/outdent as Ctrl+] / Ctrl+[** (always available, no mode required)
3. **Provide optional Tab capture via Ctrl+M toggle** for users who prefer Tab-based indenting
4. **Show mode indicator** in the tree toolbar: "Nav" or "Edit" badge
5. **Escape always exits** Action Mode and returns to Navigation Mode

This approach satisfies both the WAI-ARIA requirement (Tab exits the widget by default) and the power-user expectation (Tab can indent if explicitly enabled).

### 4.4 Alternative Shortcuts for Indent/Outdent

| Shortcut | Precedent | Conflict Risk |
|----------|-----------|---------------|
| **Ctrl+] / Ctrl+[** | VS Code (indent/outdent in text) | Low -- not used by browsers |
| **Alt+Shift+Right / Alt+Shift+Left** | Microsoft Word (promote/demote in outline) | Low |
| **Tab / Shift+Tab** (in Action Mode only) | Notion, Gutenberg | None if mode is explicit |
| **Ctrl+Right / Ctrl+Left** | Some outliners | Medium -- conflicts with word-jump in text inputs |

**Recommendation:** Use **Ctrl+] / Ctrl+[** as the always-available shortcut pair, with Tab/Shift+Tab as an optional toggle-activated alternative. This avoids all conflicts and requires no mode switching for the common case.

### 4.5 Focus Management When Nodes Move

When indent/outdent moves a node in the tree:
- Focus MUST stay on the moved node
- The tree MUST re-render with the node at its new position
- Screen readers MUST be informed of the new position (update `aria-level`, `aria-setsize`, `aria-posinset`)
- If the move fails (e.g., can't indent because there is no previous sibling), nothing changes and no focus disruption occurs
- Announce the result to screen readers: `aria-live="polite"` region with text like "Node moved to level 3" or "Cannot indent: no sibling above"

---

## 5. Roving Tabindex Pattern for a Virtualized Tree

### 5.1 Why Roving Tabindex (Not `aria-activedescendant`)

There are two approaches for managing focus within composite widgets:

**Roving Tabindex:** One child has `tabindex="0"`, all others have `tabindex="-1"`. When the user arrows to a new item, swap the tabindex values and call `.focus()`.

**`aria-activedescendant`:** The container keeps DOM focus (`tabindex="0"` on the container). The container's `aria-activedescendant` attribute points to the ID of the "virtually focused" child. No `.focus()` calls on children.

**Decision: Use roving tabindex.** Reasons:

1. **Screen reader compatibility:** `aria-activedescendant` does not work reliably with VoiceOver on macOS/iOS, and NVDA on Windows has inconsistent behavior. Only JAWS handles it well. Roving tabindex works across all screen readers.
   Source: [Sarah Higley - aria-activedescendant is not focus](https://sarahmhigley.com/writing/activedescendant/)

2. **Automatic scroll-into-view:** When you call `.focus()` on an element with roving tabindex, the browser automatically scrolls it into view. With `aria-activedescendant`, you must manually manage scrolling.

3. **Simplicity:** Roving tabindex is more straightforward to implement and reason about. The focused element IS the focused element -- no abstraction layer.

4. **React Aria precedent:** Adobe's React Aria Tree component (GA, battle-tested across enterprise products) uses roving tabindex, not `aria-activedescendant`.
   Source: [React Aria Tree](https://react-aria.adobe.com/Tree)

5. **Performance:** Ariakit's benchmarks show roving tabindex composite items render 20-30% faster than `aria-activedescendant` equivalents, improving Interaction to Next Paint (INP).

### 5.2 The Virtualization Challenge

With `@tanstack/react-virtual`, only 30-50 rows are in the DOM at any time (out of potentially 2000). This creates a specific problem: **the focused row may be scrolled out of the viewport and removed from the DOM.**

When the user arrows past the visible range, the virtual scroller must render the new row and immediately focus it. The key challenge is coordinating three things:
1. Update the `focusedId` in state (which row should be focused)
2. Let `@tanstack/react-virtual` render that row into the DOM
3. Call `.focus()` on the newly rendered DOM element

### 5.3 Implementation Pattern

```typescript
// In the tree container component:

// 1. Track focused ID in reducer state
const [state, dispatch] = useReducer(treeReducer, initialState);

// 2. Ref for the virtual scroller
const scrollerRef = useRef<HTMLDivElement>(null);
const virtualizer = useVirtualizer({
  count: state.flatVisibleRows.length,
  getScrollElement: () => scrollerRef.current,
  estimateSize: () => ROW_HEIGHT,
  overscan: 15, // render extra rows for smooth keyboard navigation
});

// 3. When focusedId changes, scroll to it and focus the DOM element
useEffect(() => {
  if (!state.focusedId) return;
  
  const index = state.flatVisibleRows.findIndex(
    row => row.nodeId === state.focusedId
  );
  if (index === -1) return;
  
  // Tell the virtualizer to scroll this index into view
  virtualizer.scrollToIndex(index, { align: 'auto' });
  
  // After next paint, focus the actual DOM element
  requestAnimationFrame(() => {
    const el = document.querySelector(
      `[data-node-id="${state.focusedId}"]`
    );
    if (el instanceof HTMLElement) {
      el.focus({ preventScroll: true }); // already scrolled
    }
  });
}, [state.focusedId]);

// 4. Keyboard handler on the tree container
function handleKeyDown(e: React.KeyboardEvent) {
  const currentIndex = state.flatVisibleRows.findIndex(
    row => row.nodeId === state.focusedId
  );
  
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      if (currentIndex < state.flatVisibleRows.length - 1) {
        dispatch({ 
          type: 'SET_FOCUS', 
          nodeId: state.flatVisibleRows[currentIndex + 1].nodeId 
        });
      }
      break;
    case 'ArrowUp':
      e.preventDefault();
      if (currentIndex > 0) {
        dispatch({ 
          type: 'SET_FOCUS', 
          nodeId: state.flatVisibleRows[currentIndex - 1].nodeId 
        });
      }
      break;
    case 'ArrowRight':
      e.preventDefault();
      handleRightArrow(state.focusedId);
      break;
    case 'ArrowLeft':
      e.preventDefault();
      handleLeftArrow(state.focusedId);
      break;
    case 'Home':
      e.preventDefault();
      dispatch({ 
        type: 'SET_FOCUS', 
        nodeId: state.flatVisibleRows[0].nodeId 
      });
      break;
    case 'End':
      e.preventDefault();
      dispatch({ 
        type: 'SET_FOCUS', 
        nodeId: state.flatVisibleRows[state.flatVisibleRows.length - 1].nodeId 
      });
      break;
    case 'Enter':
      e.preventDefault();
      dispatch({ type: 'SELECT', nodeId: state.focusedId! });
      break;
    // ... more handlers
  }
}
```

### 5.4 Tabindex Management in Virtualized Rows

Each `TreeNodeRow` component manages its own tabindex based on whether it is the focused row:

```typescript
function TreeNodeRow({ row, isFocused }: TreeNodeRowProps) {
  return (
    <div
      role="treeitem"
      tabIndex={isFocused ? 0 : -1}
      aria-expanded={row.hasChildren ? row.isExpanded : undefined}
      aria-selected={row.isSelected}
      aria-level={row.depth + 1}       // 1-based
      aria-setsize={row.siblingCount}   // total siblings
      aria-posinset={row.siblingIndex + 1} // 1-based position
      data-node-id={row.nodeId}
      // ...
    >
      {/* row content */}
    </div>
  );
}
```

### 5.5 Edge Cases in Virtualized Focus

| Scenario | Behavior |
|----------|----------|
| Focused row scrolled out of DOM | `focusedId` persists in state. When user presses Arrow, new focus target is computed from `flatVisibleRows` (which includes all rows, not just rendered ones). The virtualizer scrolls to and renders the target. |
| Node deleted while focused | Focus moves to the next sibling, or the previous sibling, or the parent. Never leave `focusedId` pointing to a deleted node. |
| Node added (new child of focused parent) | Focus stays on parent. New child appears in tree. User can arrow down to reach it. |
| Tree collapsed above focused node | If collapsing a parent hides the focused node, focus must move to the collapsed parent. |
| Expand reveals children | Children appear in `flatVisibleRows`. Focus stays on the parent (per WAI-ARIA spec). |
| Page refresh / initial load | `focusedId` starts as `null`. First Tab into the tree sets focus on the first row (or last-selected row if selection is persisted). |

### 5.6 Overscan Strategy for Keyboard Navigation

The `overscan` parameter in `@tanstack/react-virtual` determines how many extra rows are rendered above/below the viewport. For keyboard navigation smoothness:

- **Minimum overscan: 10 rows.** This ensures that pressing Arrow Down/Up once always hits a pre-rendered row (no flash of content).
- **Recommended overscan: 15-20 rows.** At 40px row height, this is 600-800px of off-screen rendering -- negligible performance impact but ensures rapid keyboard sequences (holding Arrow Down) never outrun the renderer.
- **Maximum practical overscan: 30 rows.** Beyond this, the DOM size approaches a non-virtualized tree for small datasets, defeating the purpose.

### 5.7 Live Region for Screen Reader Announcements

Add an `aria-live="polite"` region for announcing state changes that are not conveyed by focus movement alone:

```html
<div aria-live="polite" aria-atomic="true" class="sr-only">
  <!-- Updated programmatically -->
</div>
```

Announce:
- Node expanded/collapsed: "Foundations expanded, 5 items"
- Node moved (indent/outdent): "Concrete moved to level 3"
- Node deleted: "Footings deleted"
- Node added: "New item added under Concrete"
- Selection count change: "3 items selected"
- Mode change: "Edit mode" / "Navigation mode"

---

## 6. Complete Keyboard Map for ShossyWorks Tree

### 6.1 Navigation Mode (Default)

| Key | Action | WAI-ARIA Compliant |
|-----|--------|--------------------|
| **Tab** | Exit tree to next focusable element | Yes (required) |
| **Shift+Tab** | Exit tree to previous focusable element | Yes (required) |
| **Arrow Down** | Focus next visible row | Yes (required) |
| **Arrow Up** | Focus previous visible row | Yes (required) |
| **Arrow Right** | Expand collapsed parent / focus first child / no-op on leaf | Yes (required) |
| **Arrow Left** | Collapse expanded parent / focus parent / no-op on collapsed root | Yes (required) |
| **Home** | Focus first row | Yes (required) |
| **End** | Focus last visible row | Yes (required) |
| **Enter** | Select focused row (open in detail panel) | Yes |
| **Space** | Toggle selection of focused row (multi-select) | Yes |
| **Escape** | Clear selection / exit edit mode | Yes |
| **Delete** | Delete focused node (with confirmation dialog) | Custom |
| **F2** | Start inline name editing on focused row | Custom (matches Excel/Windows convention) |
| **Ctrl+]** | Indent: move node under previous sibling | Custom (does not conflict) |
| **Ctrl+[** | Outdent: move node to parent's parent | Custom (does not conflict) |
| **Ctrl+D** | Duplicate focused node | Custom |
| **Ctrl+C** | Copy node(s) to clipboard | Custom |
| **Ctrl+V** | Paste node(s) from clipboard | Custom |
| **Ctrl+Z** | Undo last action | Custom |
| **Ctrl+Shift+Z** | Redo | Custom |
| **\*** | Expand all siblings at current level | Yes (optional) |
| **Type a character** | Focus next matching node (type-ahead) | Yes (optional) |

### 6.2 Action Mode (Toggled via Ctrl+M)

| Key | Action | Notes |
|-----|--------|-------|
| **Tab** | Indent focused node | Replaces standard Tab behavior |
| **Shift+Tab** | Outdent focused node | Replaces standard Shift+Tab behavior |
| **Escape** | Return to Navigation Mode | Always available |
| **Ctrl+M** | Return to Navigation Mode | Toggle |
| All arrow keys | Same as Navigation Mode | Unchanged |

### 6.3 Inline Name Editing Mode (Activated by F2 or double-click)

| Key | Action |
|-----|--------|
| **Enter** | Commit edit, return focus to row |
| **Escape** | Cancel edit, restore original value, return focus to row |
| **Tab** | Commit edit, move focus to next row (and start editing it) |
| All other keys | Standard text input behavior |

---

## 7. Implementation Recommendations

### 7.1 Phase 1B Priorities

1. **Implement `role="tree"` pattern** (not treegrid) since editing is side-panel only
2. **Use roving tabindex** (not `aria-activedescendant`) for maximum screen reader compatibility
3. **Set `aria-level`, `aria-setsize`, `aria-posinset` explicitly** on every row (required for virtualized trees)
4. **Default to Navigation Mode** with Tab exiting the tree
5. **Use Ctrl+] / Ctrl+[ for indent/outdent** as the primary always-available shortcuts
6. **Implement F2 for inline name editing** (single field only, not full inline editing)
7. **Add `aria-live` announcements** for expand/collapse, add/delete, move operations
8. **Set overscan to 15** in `@tanstack/react-virtual` for smooth keyboard navigation
9. **Handle focused-node-removed edge case** by moving focus to next sibling or parent

### 7.2 Phase 2+ Additions

1. **Migrate to `role="treegrid"`** when inline cell editing is added
2. **Add cell-level navigation** (Left/Right between cells within a row)
3. **Implement Action Mode toggle** (Ctrl+M) for Tab-based indent/outdent
4. **Add drag-and-drop** via `@dnd-kit/core` with keyboard drag support
5. **Add Ctrl+A** for select-all in multi-select mode

### 7.3 Testing Requirements

| Screen Reader | Browser | Priority |
|---------------|---------|----------|
| NVDA | Chrome (Windows) | P0 -- most common free screen reader |
| JAWS | Chrome (Windows) | P1 -- most common paid screen reader |
| VoiceOver | Safari (macOS) | P1 -- default macOS screen reader |
| Narrator | Edge (Windows) | P2 -- improving rapidly |

Test matrix for each release:
- [ ] Arrow key navigation through all visible rows
- [ ] Expand/collapse with Right/Left arrows
- [ ] Focus persists through expand/collapse state changes
- [ ] Tab exits the tree; Shift+Tab exits backward
- [ ] Home/End jump to first/last rows
- [ ] Screen reader announces node name, level, position, expanded state
- [ ] Indent/outdent with Ctrl+] / Ctrl+[ announces result
- [ ] Delete with confirmation maintains focus correctly
- [ ] Virtual scrolling does not break ARIA attribute integrity

---

## 8. Sources

- [WAI-ARIA Tree View Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/)
- [WAI-ARIA Treegrid Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treegrid/)
- [WAI-ARIA Keyboard Interface Practices](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)
- [Navigation Treeview Example (W3C)](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/examples/treeview-navigation/)
- [Sarah Higley - aria-activedescendant is not focus](https://sarahmhigley.com/writing/activedescendant/)
- [VS Code Accessibility Guidelines](https://github.com/microsoft/vscode/wiki/Accessibility-Guidelines)
- [React Aria Tree Component](https://react-aria.adobe.com/Tree)
- [Figma Keyboard Shortcuts](https://help.figma.com/hc/en-us/articles/360040328653-Use-Figma-products-with-a-keyboard)
- [Notion Keyboard Shortcuts](https://www.notion.com/help/keyboard-shortcuts)
- [Gutenberg Tab Key Discussion (WordPress)](https://github.com/WordPress/gutenberg/issues/7051)
- [Lexical Tab-to-Indent Feature Request](https://github.com/facebook/lexical/issues/2854)
- [Joplin Tab Navigation vs Indentation PR](https://github.com/laurent22/joplin/pull/11717)
- [Cubit Estimating Shortcuts](https://bsoft.zendesk.com/hc/en-us/articles/360000640935-Keyboard-and-Mouse-Shortcuts-in-Cubit-Estimating)
- [Accessible Culture - ARIA Tree Views](https://accessibleculture.org/articles/2013/02/not-so-simple-aria-tree-views-and-screen-readers/)
