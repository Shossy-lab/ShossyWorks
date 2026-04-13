# Component Architecture Analysis

**Analyst:** Component Architecture Specialist
**Date:** 2026-04-09
**Status:** READ-ONLY research -- no code changes

---

## Executive Summary

This analysis addresses the #3 failure mode from previous attempts: **wrong component architecture -- too coupled, couldn't iterate without rewriting.** The tree view is the core interaction of this application, and every architectural decision radiates from it. The recommendations below are designed to survive from Phase 1B through Phase 2D without rewrites.

Three critical findings:

1. **Use Radix UI primitives (not shadcn/ui) with custom styling.** shadcn/ui's copy-paste model creates maintenance burden, and its default styling fights the strict design system. Radix headless primitives give accessible, keyboard-navigable building blocks with zero styling opinions.

2. **Build a custom tree view, do not adopt react-arborist or any tree library.** No existing library handles the combination of: discriminated union node types, inline editing of 20+ fields per node type, real-time collaborative updates via useReducer, virtual scrolling at 2000 nodes, and the strict design system. The integration cost exceeds the build cost.

3. **The component hierarchy must separate tree structure from node rendering from detail editing.** Previous attempts coupled all three, making iteration impossible. The tree handles expand/collapse/drag/keyboard; node renderers handle type-specific display; detail editors handle the actual data entry.

---

## 1. Component Hierarchy -- Major Families

### 1.1 Family Map

```
App Shell (exists)
  +-- Sidebar (exists, needs estimate-context nav items)
  +-- Header (exists, needs breadcrumbs, search trigger)
  +-- Content Area
       +-- Page-level components (server components, data fetching)
       +-- Feature components (client components, interactivity)

Component Families:
  Navigation     -- sidebar, breadcrumbs, page header, tabs
  Data Display   -- stat cards, status badges, money formatters, date formatters
  Tree           -- tree container, tree row, node renderers, tree toolbar
  Forms          -- field primitives, node editors, settings forms
  Overlays       -- dialog, dropdown menu, command palette, toast
  Feedback       -- loading skeletons, empty states, error states
  Layout         -- page wrapper, split pane, panel, section
```

### 1.2 Composition Rules

Each family has a clear dependency direction:

```
Layout -> Navigation -> Data Display -> (leaf)
Layout -> Tree -> Node Renderers -> Data Display -> (leaf)
Layout -> Forms -> Field Primitives -> (leaf)
Overlays -> Forms | Data Display -> (leaf)
Feedback -> (leaf, no dependencies)
```

Key constraint: **Tree components never import from Forms.** The tree renders nodes; when a user wants to edit, a separate editing surface (side panel or inline editor) is activated. This separation is what previous attempts got wrong -- they tried to make tree rows editable inline from the start, coupling tree rendering with form state.

### 1.3 Server/Client Split

Per the architecture rules, push interactivity down to the smallest leaf:

| Component | Server/Client | Why |
|-----------|--------------|-----|
| Project list page | Server | Fetches project list, passes to client list |
| Estimate page | Server | Fetches nodes via getNodes(), passes to client tree |
| Tree container | Client | Manages expand/collapse, selection, keyboard nav |
| Tree row | Client | Handles click/hover, renders based on node type |
| Node detail panel | Client | Form state for editing selected node |
| Settings page | Server | Fetches company_settings, passes to client form |
| Snapshot browser | Client | Interactive list with restore actions |

---

## 2. Base Component Library Recommendation

### 2.1 Options Evaluated

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Radix UI primitives** | Headless, zero styling, full a11y, keyboard nav, composable | Must build all visual styling | RECOMMENDED |
| **shadcn/ui** | Pre-built components, Tailwind styled | Copy-paste model = maintenance burden; default rounded corners fight design system; would need to re-style every component anyway | REJECTED |
| **Ark UI** | Headless like Radix, state machine driven | Smaller ecosystem, fewer examples, React support less mature | BACKUP |
| **Build from scratch** | Full control | Massive a11y burden (dialog focus trap, dropdown positioning, listbox keyboard) | REJECTED for overlays; ACCEPTED for tree |

### 2.2 The Radix + Custom Styling Decision

Rationale:

1. **The design system is strict and opinionated.** Sharp corners, pill buttons, CSS custom property tokens. Any component library with default styling becomes a fight. Radix has no styling opinions at all.

2. **Accessibility is non-negotiable.** The existing codebase already has skip links, focus-visible, and ARIA attributes. Radix provides WCAG-compliant Dialog, DropdownMenu, Select, Tooltip, Popover, AlertDialog, and Tabs out of the box. Building these from scratch is 2-4 weeks of work for proper focus management alone.

3. **shadcn/ui is the wrong abstraction here.** shadcn/ui is excellent for rapid prototyping with generic styling. This project has the opposite requirement: a specific, enforced design language. Every shadcn/ui component would need its rounded corners removed, its colors replaced with CSS variables, and its spacing adjusted. At that point you are maintaining a fork of shadcn/ui. Just use Radix directly.

4. **Radix is compatible with Tailwind v4 and Next.js 16.** Radix primitives use `data-*` attributes for state, which work with Tailwind's `data-[state=open]:` selector pattern. No conflicts with the `@theme` block or CSS custom properties.

### 2.3 Which Radix Primitives to Use

| Primitive | Use Case | Why Not Build |
|-----------|----------|---------------|
| `@radix-ui/react-dialog` | Create/edit modals, confirmation dialogs | Focus trap, escape handling, portal rendering |
| `@radix-ui/react-dropdown-menu` | Node context menus, action menus | Keyboard navigation, sub-menus, typeahead |
| `@radix-ui/react-select` | Status selectors, unit selectors, cost code picker | Keyboard nav, typeahead, positioning |
| `@radix-ui/react-popover` | Node quick-info, filter controls | Positioning, dismiss on outside click |
| `@radix-ui/react-tooltip` | Status descriptions, field help text | Delay timing, screen reader announcements |
| `@radix-ui/react-tabs` | Node detail sections, settings sections | ARIA tabpanel, keyboard arrow nav |
| `@radix-ui/react-alert-dialog` | Delete confirmation, destructive actions | Forces explicit user action, accessible |
| `@radix-ui/react-collapsible` | Tree expand/collapse behavior | Accessible expand/collapse with animation |
| `@radix-ui/react-toggle` | Flag node, visibility toggles | ARIA pressed state |
| `@radix-ui/react-toast` | Action confirmations, error notifications | Auto-dismiss, screen reader announcements |

Primitives NOT needed: Accordion (Collapsible is enough), NavigationMenu (sidebar is custom), Slider, Switch (toggles suffice).

### 2.4 Wrapper Component Layer

Each Radix primitive gets wrapped in a design-system-compliant component:

```typescript
// src/components/shared/dialog.tsx
// Wraps @radix-ui/react-dialog with design system styling
// Sharp corners, proper tokens, consistent sizing
export { DialogRoot, DialogTrigger, DialogContent, DialogTitle, DialogClose }

// src/components/shared/dropdown-menu.tsx
// Wraps @radix-ui/react-dropdown-menu
// Sharp corners, design system colors, keyboard-first
export { MenuRoot, MenuTrigger, MenuContent, MenuItem, MenuSeparator }
```

This wrapper layer is the ONLY place Radix is imported. Feature components never import from `@radix-ui/*` directly. If a Radix primitive needs replacement (e.g., moving to Ark UI), only the wrapper file changes.

---

## 3. Tree View Component Architecture

### 3.1 Why No Existing Library Works

I evaluated three categories of tree view solutions:

**Category 1: Full tree libraries (react-arborist, react-complex-tree)**

- react-arborist: Well-designed API, supports drag-and-drop. But: it assumes homogeneous node data (not discriminated unions), owns its own state (conflicts with useReducer requirement for real-time), and has its own styling system that would fight the design system. The `TreeApi` object would be a second source of truth alongside the useReducer state.

- react-complex-tree: More flexible, supports controlled mode. But: its `TreeItem<T>` generic assumes a single data shape per tree. Our tree has three node types (GroupNode, AssemblyNode, ItemNode) with completely different detail structures. The type gymnastics required to make this work would be fragile.

**Category 2: Virtual scrolling (tanstack/react-virtual, react-window)**

- @tanstack/react-virtual: Excellent for flat lists. For trees, you must flatten the tree yourself (computing visible rows from expanded/collapsed state). This is fine and exactly what we should do -- but it is a building block, not a tree component.

**Category 3: Spreadsheet-like (tanstack/react-table with tree expansion)**

- @tanstack/react-table: Has `getExpandedRowModel()` for hierarchical data. But: it is designed for tabular data, not tree structures. The column model does not fit our use case well -- tree nodes are not rows with uniform columns. Items have 20+ editable fields; groups have 3. Forcing this into a table model creates the wrong UX.

**Conclusion:** Build a custom tree using @tanstack/react-virtual for the virtual scrolling layer. Own the tree state, expand/collapse logic, keyboard navigation, and drag-and-drop.

### 3.2 Architecture: Three-Layer Tree

```
Layer 1: EstimateTreeContainer (state owner)
  - Owns the tree state via useReducer
  - Receives NodeWithDetails[] from server component (flat list)
  - Builds tree structure client-side (O(n) with parent_id map)
  - Manages expanded/collapsed set, selection, focus
  - Dispatches to server actions for mutations
  - Receives real-time broadcast updates (Phase 1B+)

Layer 2: VirtualTreeRenderer (virtual scrolling)
  - Receives flattened visible rows from container
  - Uses @tanstack/react-virtual for viewport rendering
  - Only renders rows visible in the viewport
  - Handles overscan for smooth scrolling
  - Provides row measurements for variable-height rows

Layer 3: TreeNodeRow (individual row rendering)
  - Pure component: renders one node based on its type
  - Receives: node, depth, isExpanded, isSelected, isFocused
  - Dispatches: onExpand, onSelect, onContextMenu
  - Does NOT handle editing -- that happens elsewhere
  - Three sub-renderers: GroupRow, AssemblyRow, ItemRow
```

### 3.3 Tree State Shape

```typescript
interface EstimateTreeState {
  // Data
  nodes: Map<string, NodeWithDetails>;  // id -> node (flat lookup)
  rootIds: string[];                     // top-level node IDs in sort order
  childrenMap: Map<string, string[]>;    // parent_id -> sorted child IDs

  // UI state
  expandedIds: Set<string>;
  selectedIds: Set<string>;             // multi-select support from day 1
  focusedId: string | null;             // keyboard focus (separate from selection)
  editingId: string | null;             // which node is being edited

  // Derived (computed on dispatch, not on render)
  flatVisibleRows: FlatRow[];           // pre-computed for virtual scroller
  totalCount: number;                   // total nodes in tree
}

interface FlatRow {
  nodeId: string;
  depth: number;
  isExpanded: boolean;
  hasChildren: boolean;
  nodeType: NodeType;
}
```

### 3.4 Reducer Actions

```typescript
type TreeAction =
  // Data mutations (from server actions or real-time)
  | { type: 'SET_NODES'; nodes: NodeWithDetails[] }
  | { type: 'UPSERT_NODE'; node: NodeWithDetails }
  | { type: 'REMOVE_NODE'; nodeId: string }
  | { type: 'MOVE_NODE'; nodeId: string; newParentId: string | null; newSortOrder: number }
  | { type: 'REORDER_SIBLINGS'; parentId: string | null; orderedIds: string[] }

  // UI state
  | { type: 'TOGGLE_EXPAND'; nodeId: string }
  | { type: 'EXPAND_ALL' }
  | { type: 'COLLAPSE_ALL' }
  | { type: 'EXPAND_TO_DEPTH'; depth: number }
  | { type: 'SELECT'; nodeId: string; multi?: boolean }
  | { type: 'SELECT_RANGE'; fromId: string; toId: string }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'SET_FOCUS'; nodeId: string }
  | { type: 'SET_EDITING'; nodeId: string | null }

  // Real-time (Phase 1B+)
  | { type: 'REMOTE_UPSERT'; node: NodeWithDetails; userId: string }
  | { type: 'REMOTE_REMOVE'; nodeId: string; userId: string }
```

This reducer design is critical: it handles both local edits AND remote broadcasts through the same state update path, which is the architecture required by INTENT.md Decision 13 (useReducer state pattern from Phase 1B).

### 3.5 Virtual Scrolling

For 2000+ nodes, virtual scrolling is mandatory. The approach:

1. **Flatten the tree on state change:** When expandedIds or nodes change, compute `flatVisibleRows[]` in the reducer (not in a useMemo -- the reducer must own this computation to avoid render-time recalculation).

2. **Feed flat rows to @tanstack/react-virtual:** The virtualizer only knows about a flat list. Each row knows its depth (for indentation) and node ID (for data lookup).

3. **Variable row heights:** Groups are 40px (name only). Items might be 48px (name + price). Assemblies might be 44px (name + quantity). Use `estimateSize` with the virtualizer and measure actual heights via ResizeObserver for accuracy.

4. **Overscan:** Render 10-20 extra rows above/below viewport for smooth scrolling. At 40-48px per row, that is 400-960px of off-screen rendering -- negligible.

5. **Performance target:** 60fps scrolling with 2000 nodes. With virtual scrolling, only ~30-50 rows are ever in the DOM. This is trivially achievable.

### 3.6 Drag-and-Drop

Drag-and-drop is the second most complex tree interaction after keyboard navigation. Approach:

**Phase 1 (MVP):** No drag-and-drop. Move nodes via keyboard shortcuts (Tab to indent, Shift+Tab to outdent) and context menu (Move Up, Move Down, Move To...). This matches the "iterative workflow" described in INTENT.md Decision 8.

**Phase 2 (Enhancement):** Add drag-and-drop using `@dnd-kit/core` (not react-beautiful-dnd, which is unmaintained). dnd-kit supports:
- Tree-aware drop indicators (between siblings, onto a node to make it a child)
- Keyboard drag-and-drop (accessibility)
- Custom drag overlays (show the node being dragged)
- Works with virtual lists

The architecture must support drag-and-drop from day 1 (the reducer already has `MOVE_NODE` and `REORDER_SIBLINGS` actions) even though the UI ships without it initially.

### 3.7 Keyboard Navigation

Full keyboard navigation from Phase 1B day one:

| Key | Action |
|-----|--------|
| Arrow Up/Down | Move focus between visible rows |
| Arrow Right | Expand focused node (if collapsed) or move to first child |
| Arrow Left | Collapse focused node (if expanded) or move to parent |
| Enter | Select focused node (open detail editor) |
| Space | Toggle selection (multi-select) |
| Tab | Indent node (move under previous sibling -- triggers auto-promotion) |
| Shift+Tab | Outdent node (move to parent's parent) |
| Delete | Delete with confirmation |
| Ctrl+D | Duplicate |
| Ctrl+C / Ctrl+V | Copy / paste |
| Home / End | Jump to first / last visible row |
| Escape | Clear editing state |

This keyboard model is an accessible equivalent to drag-and-drop and must be fully functional before any drag-and-drop is added.

---

## 4. Form Components

### 4.1 Editing Surface: Side Panel (not inline, not modal)

Previous attempts used two approaches for editing:
- **Inline editing** (Soloway): Every tree row was an editable form. This created a massive coupling between tree rendering and form state, made keyboard navigation conflict with text input, and bloated the virtual scroll with form elements.
- **Modal editing** (EP): Each edit opened a modal. This interrupted flow -- estimators edit hundreds of items in sequence. A modal per item is unacceptable UX.

**Recommendation: Persistent side panel.** The estimate page layout becomes:

```
+--sidebar--+--------tree area--------+----detail panel----+
|           |  [tree toolbar]          |  [node name]       |
| Dashboard |  + Foundations           |  [type: item]      |
| Projects  |    + Concrete            |                    |
| Settings  |      > Footings [sel]    |  Quantity: [___]   |
|           |      > Stem Walls        |  Unit: [___]       |
|           |      > Slab              |  Unit Cost: [___]  |
|           |    + Framing             |  Labor Rate: [___] |
|           |  + Site Work             |  ...more fields... |
+-----------+--------------------------+--------------------+
```

When a node is selected in the tree, its detail fields appear in the side panel. The side panel:
- Is always visible (no open/close animation overhead)
- Shows different fields based on node_type (discriminated union)
- Saves on blur (debounced) or on explicit save button
- Can show multiple tabs for complex nodes: Details, Notes, Options, History

This pattern is well-established in construction software (ProEst, Sage 300, Procore) and in general productivity tools (Figma layers panel, VS Code properties panel).

### 4.2 Field Primitives

Build a small set of field components that enforce the design system:

```typescript
// All field components follow this interface:
interface FieldProps<T> {
  label: string;
  value: T;
  onChange: (value: T) => void;
  error?: string;          // from Zod validation
  disabled?: boolean;
  required?: boolean;
  helpText?: string;
}
```

Field components needed:

| Component | For | Notes |
|-----------|-----|-------|
| `TextField` | Name, description, notes | Sharp corners, design tokens |
| `NumberField` | Quantity, costs, rates | Decimal formatting, min/max |
| `MoneyField` | Unit cost, labor cost | `$` prefix, 2dp display, 4dp internal |
| `RateField` | Markup, overhead, tax | `%` suffix, percentage formatting |
| `SelectField` | Unit, cost code, status | Wraps Radix Select, sharp corners |
| `TextArea` | Description, notes, specs | Auto-resize, character count |
| `Toggle` | Flagged, is_allowance | Wraps Radix Toggle |
| `CheckboxField` | is_client_visible flags | For boolean options in dialogs |

### 4.3 Node Editor Components

Three editor components, one per node type, composed from field primitives:

```typescript
// src/components/estimate/editors/item-editor.tsx
// Renders all ItemDetails fields using field primitives
// Receives: node (ItemNode), onChange callback, errors (from Zod)

// src/components/estimate/editors/assembly-editor.tsx
// Renders all AssemblyDetails fields

// src/components/estimate/editors/group-editor.tsx
// Renders only base node fields (name, description, visibility)
```

The detail panel switches between these based on `node.node_type`:

```typescript
function NodeDetailPanel({ node }: { node: NodeWithDetails }) {
  switch (node.node_type) {
    case 'item':    return <ItemEditor node={node} />;
    case 'assembly': return <AssemblyEditor node={node} />;
    case 'group':   return <GroupEditor node={node} />;
  }
}
```

### 4.4 Zod Integration

Validation flow:

1. User edits a field -> local state updates immediately (optimistic)
2. On blur or debounced (300ms), validate the entire form with the appropriate Zod schema
3. If valid, call the server action (updateItemDetails, updateAssemblyDetails, updateNode)
4. Server action validates again (defense in depth)
5. If server returns error, surface it on the appropriate field
6. If server returns success, update tree state via reducer dispatch

The existing Zod schemas (`updateItemDetailsSchema`, `updateAssemblyDetailsSchema`, `updateNodeSchema`) already support partial updates via `.optional()` on all fields. This is exactly what's needed for field-by-field editing.

### 4.5 Settings Forms

Company settings and user preferences use the same field primitives but in a full-page layout:

```
Settings Page (server component: fetches current settings)
  +-- CompanySettingsForm (client component)
  |     +-- Rate fields (markup, overhead, contingency, tax)
  |     +-- Company info fields (name, address, license)
  +-- UserPreferencesForm (client component)
        +-- UI preferences (sidebar state, theme)
        +-- Estimate view defaults (column visibility)
```

---

## 5. Component File Organization

### 5.1 Directory Structure

```
src/components/
  shared/              -- Design-system primitives (Radix wrappers, field components)
    dialog.tsx          -- Radix Dialog wrapper
    dropdown-menu.tsx   -- Radix DropdownMenu wrapper
    select.tsx          -- Radix Select wrapper
    popover.tsx         -- Radix Popover wrapper
    tooltip.tsx         -- Radix Tooltip wrapper
    tabs.tsx            -- Radix Tabs wrapper
    toast.tsx           -- Radix Toast wrapper
    alert-dialog.tsx    -- Radix AlertDialog wrapper
    text-field.tsx      -- Input field primitive
    number-field.tsx    -- Number input primitive
    money-field.tsx     -- Currency input primitive
    rate-field.tsx      -- Percentage input primitive
    select-field.tsx    -- Labeled select
    textarea.tsx        -- Auto-resize text area
    toggle.tsx          -- Boolean toggle
    button.tsx          -- Primary/secondary/ghost/icon buttons
    badge.tsx           -- Status badge (pill shape)
    skeleton.tsx        -- Loading skeleton
    empty-state.tsx     -- "No data" state
    error-state.tsx     -- Error display

  nav/                 -- Navigation components (exists)
    sidebar.tsx         -- (exists, to be extended)
    user-menu.tsx       -- (exists)
    breadcrumbs.tsx     -- Page breadcrumbs

  layout/              -- Page-level layout primitives
    page-header.tsx     -- Page title + action buttons
    split-pane.tsx      -- Resizable tree/detail split
    panel.tsx           -- Bordered content panel

  estimate/            -- Estimate feature components
    tree/
      estimate-tree-container.tsx   -- State owner (useReducer)
      virtual-tree-renderer.tsx     -- Virtual scroll wrapper
      tree-row.tsx                  -- Single row dispatcher
      group-row.tsx                 -- Group node renderer
      assembly-row.tsx              -- Assembly node renderer
      item-row.tsx                  -- Item node renderer
      tree-toolbar.tsx              -- Add/expand/collapse/search
    editors/
      node-detail-panel.tsx         -- Type-switching editor host
      item-editor.tsx               -- Item detail form
      assembly-editor.tsx           -- Assembly detail form
      group-editor.tsx              -- Group base field form
      node-base-fields.tsx          -- Shared base fields (name, desc, visibility)
    snapshot/
      snapshot-browser.tsx          -- Snapshot list panel
      snapshot-viewer.tsx           -- Read-only tree render
      snapshot-dialog.tsx           -- Create snapshot dialog

  project/             -- Project feature components
    project-list.tsx
    project-card.tsx
    project-create-dialog.tsx
    project-status-badge.tsx

  settings/            -- Settings feature components
    company-settings-form.tsx
    user-preferences-form.tsx
```

### 5.2 Why This Structure

1. **`shared/` is the design system.** Every component here is generic, stateless, and styled with tokens. They never import from feature directories. They are the lowest layer.

2. **Feature directories (`estimate/`, `project/`, `settings/`) co-locate by domain.** An estimator's tree components are physically near each other. A developer working on the tree never needs to leave `src/components/estimate/tree/`.

3. **The "everything in components/" anti-pattern is avoided** by nesting feature-specific components inside their feature directory. `estimate/tree/tree-row.tsx` is NOT reusable outside the estimate tree -- and that is correct. Only `shared/` components are reusable.

4. **No barrel files (index.ts re-exports).** Import directly from the file. This keeps tree-shaking reliable and makes imports explicit.

### 5.3 The 300-Line Rule

Every component file targets under 300 lines. When exceeded:
- Extract sub-components into the same directory (e.g., `item-row.tsx` extracted from `tree-row.tsx`)
- Extract hooks into a `hooks/` sub-directory (e.g., `estimate/tree/hooks/use-tree-keyboard.ts`)
- Extract utility functions into a `utils/` sub-directory (e.g., `estimate/tree/utils/flatten-tree.ts`)

---

## 6. Component Contracts (Props Interfaces)

### 6.1 Preventing Prop Drilling

The tree is deep. A tree row at depth 10 should not receive props that were threaded through 10 layers. Solutions:

**React Context for tree-wide concerns:**

```typescript
interface EstimateTreeContext {
  // State accessors
  getNode: (id: string) => NodeWithDetails | undefined;
  isExpanded: (id: string) => boolean;
  isSelected: (id: string) => boolean;
  isFocused: (id: string) => boolean;
  isEditing: (id: string) => boolean;

  // Dispatch
  dispatch: React.Dispatch<TreeAction>;
}
```

This context is created ONCE by `EstimateTreeContainer` and consumed by all tree rows. Individual rows never receive `expandedIds`, `selectedIds`, etc. as props -- they call `isExpanded(myId)` from context.

**Important:** Context does NOT contain the full nodes Map. Each row receives its `nodeId` as a prop and calls `getNode(nodeId)` from context. This means re-renders propagate correctly -- when a node is updated, the context reference doesn't change (only the internal Map), and the row re-renders because its specific `getNode(myId)` return value changed.

**Actually, a correction:** This pattern has a subtlety. `getNode` is a function whose identity is stable, but its return value changes. To make this work with `React.memo`, rows would need to subscribe to specific node changes. A simpler approach for Phase 1:

```typescript
// Phase 1: Direct props (simple, correct)
<TreeNodeRow
  node={node}           // the actual NodeWithDetails
  depth={depth}
  isExpanded={expandedIds.has(node.id)}
  isSelected={selectedIds.has(node.id)}
  dispatch={dispatch}   // stable reference (useReducer dispatch is stable)
/>
```

This is 5 props -- not prop drilling. The virtual scroller handles the mapping from flat rows to components. Each row gets only what it needs.

**Phase 2 (if performance demands):** Move to context + `useSyncExternalStore` for fine-grained subscriptions. But do not over-optimize before measuring.

### 6.2 Key Component Props

```typescript
// Tree container -- receives data from server component
interface EstimateTreeContainerProps {
  initialNodes: NodeWithDetails[];
  estimateId: string;
  estimateStatus: EstimateStatus;  // controls editability
}

// Tree row -- rendered by virtual scroller
interface TreeNodeRowProps {
  node: NodeWithDetails;
  depth: number;
  isExpanded: boolean;
  isSelected: boolean;
  isFocused: boolean;
  dispatch: React.Dispatch<TreeAction>;
}

// Detail panel -- shows editor for selected node
interface NodeDetailPanelProps {
  node: NodeWithDetails | null;     // null = nothing selected
  onSave: (action: TreeAction) => void;
  estimateId: string;
}

// Item editor -- edits ItemDetails
interface ItemEditorProps {
  node: ItemNode;                   // discriminated: must be item
  onFieldChange: (field: string, value: unknown) => void;
  errors: Record<string, string[]>; // from Zod validation
  disabled?: boolean;               // true for Complete estimates
}

// Field primitive
interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  maxLength?: number;
}
```

### 6.3 Contract: Tree Container / Detail Panel Boundary

The tree container and detail panel communicate through a narrow interface:

- **Tree -> Panel:** Selected node ID (Panel calls `getNode()` to get data)
- **Panel -> Tree:** `UPSERT_NODE` actions after successful server mutations
- **No shared mutable state.** The panel does NOT write to the nodes Map directly. It calls a server action, gets back a `NodeWithDetails`, and dispatches `UPSERT_NODE` to the tree.

This boundary ensures the panel can be replaced entirely (e.g., switching from side panel to modal) without touching tree code.

---

## 7. Critical Risks and Mitigations

### 7.1 Risk: Tree + Real-Time Conflict

When two users edit the same tree simultaneously, the useReducer must handle `REMOTE_UPSERT` actions that conflict with local edits. The reducer must:
- Accept remote updates for nodes NOT currently being edited locally
- Queue remote updates for the node currently being edited (show "modified by X" indicator)
- Never overwrite unsaved local changes

**Mitigation:** Design the reducer to handle this from day 1. Even if real-time is not enabled until Phase 2, the `REMOTE_UPSERT` action type exists in the reducer, and the state shape supports tracking "locally dirty" nodes.

### 7.2 Risk: Virtual Scroll + Variable Heights

Items with long descriptions or multiple cost lines may have variable heights. If `estimateSize` is wrong, scrolling will jump.

**Mitigation:** Use `@tanstack/react-virtual`'s `measureElement` callback to measure actual rendered heights. This auto-corrects the virtual scroller as rows are rendered. Performance impact is negligible since only visible rows are measured.

### 7.3 Risk: Design System Compliance

Every Radix wrapper must be styled with design tokens. A single `rounded-md` or `bg-gray-50` would violate the design system.

**Mitigation:** A PostToolUse hook already checks for this. Additionally, all Radix wrappers should be reviewed as a batch before any feature components are built. The wrapper layer is the enforcement boundary.

### 7.4 Risk: 300-Line Files Becoming 600-Line Files

As features accumulate, component files grow. Especially `estimate-tree-container.tsx` which owns the reducer.

**Mitigation:** The reducer itself should be in a separate file (`use-estimate-tree-reducer.ts`). Tree keyboard handling should be in a separate hook (`use-tree-keyboard.ts`). Flatten/unflatten utilities in a separate file. The container component itself should only wire these together -- under 100 lines.

### 7.5 Risk: Phase 2 Calculation Engine Integration

When the isomorphic calculation engine arrives (Phase 2A), it must be callable from the reducer (for client-side instant feedback) and from server actions (for validation). The tree component must display calculated values.

**Mitigation:** The `NodeWithDetails` type already has `total_price` on the base table. The calculation engine will update this field. The tree row renderers already display it. The integration point is the reducer: after `UPSERT_NODE`, re-run calculations on the affected subtree and dispatch updated totals. This does NOT require any tree component restructuring.

---

## 8. Implementation Sequence Recommendation

This sequence ensures each layer is stable before the next builds on it:

```
Step 1: Shared component layer (Radix wrappers + field primitives)
  - 15-20 small files, each under 100 lines
  - Pure visual components, no business logic
  - Fully styled with design tokens
  - Can be reviewed by Zac before any feature work

Step 2: Layout components (page-header, split-pane, panel)
  - 3-5 files
  - Establish the page structure

Step 3: Project list + detail pages
  - First feature using shared components
  - Validates the shared component layer works
  - Lower complexity than estimate tree -- good proving ground

Step 4: Estimate tree (container + virtual renderer + row renderers)
  - The core interaction
  - Read-only first: display the tree, expand/collapse, select
  - Keyboard navigation
  - No editing yet

Step 5: Detail panel + node editors
  - Editing surface
  - Zod validation integration
  - Server action integration

Step 6: Tree mutations (add, delete, move, duplicate)
  - Tree toolbar
  - Context menu
  - Tab/Shift+Tab indent/outdent

Step 7: Snapshot UI, catalog UI, search
  - Built on the stable tree + editor foundation
```

This sequence maps cleanly to the Phase 1B sub-phases in the approved plan, with Steps 1-2 as prerequisites, Steps 3-6 as the core 1B work, and Step 7 as the 1B feature expansion.

---

## 9. Anti-Patterns to Explicitly Avoid

1. **Do NOT make tree rows editable inline from day 1.** The Soloway attempt did this and it coupled tree rendering with form state. Start with selection + side panel. Inline editing (clicking a cell to edit it directly in the tree) is a Phase 2+ optimization.

2. **Do NOT use Zustand or Jotai for tree state.** The useReducer pattern is required by INTENT.md Decision 13. External state libraries create a second source of truth that conflicts with real-time broadcast updates. Zustand's subscription model is incompatible with the "two mutation sources" pattern (local edits + broadcasts).

3. **Do NOT create a `<TreeProvider>` that wraps the entire estimate page.** Context providers should be as narrow as possible. The tree context wraps only `<EstimateTreeContainer>`, not the page or the detail panel.

4. **Do NOT use `useEffect` for tree state initialization.** Pass `initialNodes` as a prop to the tree container, and initialize the reducer state synchronously in `useReducer(reducer, initialNodes, initFunction)`.

5. **Do NOT build a generic "Tree" component.** This is an estimate tree, not a filesystem browser or org chart. The component should know about `NodeWithDetails`, `NodeType`, and the estimate domain. Premature abstraction killed previous attempts.

---

## 10. Dependency Summary

New packages to add:

| Package | Version | Purpose | Size |
|---------|---------|---------|------|
| `@tanstack/react-virtual` | ^3 | Virtual scrolling for tree | ~15KB |
| `@radix-ui/react-dialog` | ^1 | Accessible dialogs | ~12KB |
| `@radix-ui/react-dropdown-menu` | ^2 | Context menus | ~15KB |
| `@radix-ui/react-select` | ^2 | Select dropdowns | ~18KB |
| `@radix-ui/react-popover` | ^1 | Popovers | ~10KB |
| `@radix-ui/react-tooltip` | ^1 | Tooltips | ~8KB |
| `@radix-ui/react-tabs` | ^1 | Tab panels | ~6KB |
| `@radix-ui/react-alert-dialog` | ^1 | Confirmation dialogs | ~10KB |
| `@radix-ui/react-toast` | ^1 | Notifications | ~10KB |
| `@radix-ui/react-toggle` | ^1 | Toggle buttons | ~4KB |
| `@radix-ui/react-collapsible` | ^1 | Expand/collapse | ~5KB |

Total: ~133KB minified. Tree-shakeable -- only used primitives are bundled.

NOT adding (deferred):
- `@dnd-kit/core` -- drag-and-drop is Phase 2+
- `cmdk` -- command palette is Phase 2+
- `date-fns` -- not needed until reporting

---

## 11. Questions Requiring User Decision

1. **Side panel width:** Should the detail panel be resizable, or fixed width? Resizable adds complexity (split-pane component) but matches tools like Figma and VS Code. Fixed width (e.g., 400px) is simpler.

2. **Tree column visibility:** Should the tree show cost totals inline (e.g., "Footings -- $12,500") or only in the detail panel? Inline totals require wider tree rows but give at-a-glance pricing. This is a UX decision that affects `TreeNodeRow` complexity.

3. **Multi-select behavior:** When multiple nodes are selected, what does the detail panel show? Options: (a) first selected node, (b) nothing, (c) batch edit fields that apply to all. Batch edit is complex but powerful for changing visibility/flagged status on many nodes at once.

4. **Figma prototype extraction:** What specific layout, color, or interaction patterns from the Figma prototypes should inform the tree view design? This analysis is architecture-only -- the visual design must come from the prototypes.

---

## Appendix A: Comparison with Previous Attempts

| Aspect | EP (Attempt 1) | Soloway (Attempt 2) | ShossyWorks (This) |
|--------|----------------|--------------------|--------------------|
| Node types | 4 (category, section, assembly, item) | Implicit from depth level | 3 (group, assembly, item) with discriminated union |
| Tree state | Component state, no reducer | Component state, no reducer | useReducer with typed actions |
| Editing model | Modal per node | Inline in tree row | Side panel (persistent) |
| Component coupling | Tree + forms + calculations in same component | Tree + forms coupled, calculations separate | Tree / Editors / Calculations fully separated |
| Design system | None (raw Tailwind) | None (raw Tailwind) | CSS custom properties, enforced via rules |
| Virtual scrolling | None (full DOM) | None (full DOM) | @tanstack/react-virtual |
| Real-time | None | Supabase Realtime (read-only) | Supabase Realtime via reducer (Phase 1B+) |
| Keyboard nav | Minimal | None | Full keyboard model from day 1 |
| Node data shape | Monolithic 46-col row | Monolithic row | Discriminated union (base + detail tables) |

---

## Appendix B: Radix + Design System Integration Pattern

Example of a properly wrapped Radix component:

```typescript
// src/components/shared/dialog.tsx
import * as DialogPrimitive from '@radix-ui/react-dialog';

export const DialogRoot = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;

export function DialogContent({
  children,
  className = '',
  ...props
}: DialogPrimitive.DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className="fixed inset-0 bg-[var(--color-bg-inverse)]/50 data-[state=open]:animate-in data-[state=closed]:animate-out"
      />
      <DialogPrimitive.Content
        className={`fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
          border border-[var(--color-border)] bg-[var(--color-surface)]
          p-[var(--space-6)] shadow-[var(--shadow-lg)]
          w-full max-w-lg
          ${className}`}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

// Note: NO rounded corners. Sharp edges per design system.
// Note: ALL colors from CSS custom properties.
// Note: Spacing from space tokens.
```

This pattern ensures every visual property comes from the design system while Radix handles focus trap, escape-to-close, overlay click-to-close, and screen reader announcements.
