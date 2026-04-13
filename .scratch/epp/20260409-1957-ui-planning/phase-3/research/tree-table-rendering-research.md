# Cluster 1: Tree-Table Rendering Architecture -- Research Findings

**Researcher:** Tree-Table Rendering Specialist
**Date:** 2026-04-09
**Status:** Research complete -- concrete recommendations with code patterns

---

## 1. How Professional Estimating Tools Render Hierarchical Cost Data

### Industry Survey

Research into ProEst, Cubit, PlanSwift, Sage 300 CRE, and ConstructionOnline reveals a consistent pattern across professional construction estimating software:

**The dominant UI paradigm is "tree-in-first-column + cost columns to the right."**

| Tool | Layout Pattern | Key Observations |
|------|---------------|-----------------|
| **ProEst** (Autodesk) | Tree hierarchy in left column, cost data in right columns. Side panel for detailed editing. | Unit cost, total cost computed in real time as quantities flow from takeoff. Matches the sidebar + tree + detail panel layout already recommended. |
| **Cubit** (Buildsoft) | Hierarchical grouped view with expandable trades. Columns: Markup Value, Cost Total, Rate. | Grouping by Trade, Division, or Zone. Dynamic grouped views for analysis. Two distinct column sets: estimate sheet and rate sheet. |
| **PlanSwift** | Blueprint-centric with tabular cost breakdown. Sort and group by Trade, Division, or Zone. | Drag-and-drop assemblies onto blueprints. Pre-built "Views" for different cost breakdowns. Less tree-oriented, more spreadsheet-oriented. |
| **Sage 300 CRE** | WBS hierarchy with unlimited subdivisions. Columns per cost category: Material, Labor, Equipment, Subcontract, Other. | Each WBS code has unlimited WBS Values (subdivisions). Quantities tracked per category. Most spreadsheet-like of the group. |
| **ConstructionOnline** | Three-level hierarchy: Category > Subcategory > Item. Inline item entry with filtered costbook lookup. | Emphasis on quick inline entry. Summary views at multiple hierarchy levels. |

### Common Column Patterns Across Tools

All professional estimating tools display these columns alongside the tree hierarchy:

1. **Name/Description** (always the tree column with indentation)
2. **Quantity** (numeric, from takeoff or manual entry)
3. **Unit** (text or dropdown -- SF, LF, CY, EA, etc.)
4. **Unit Cost** (currency, typically 2-4 decimal places)
5. **Total Cost** (computed: quantity x unit cost, rolled up for groups)
6. **Cost Category Breakdown** (varies: Material, Labor, Equipment, Subcontract)

**Key insight:** Professional tools show cost totals BOTH inline in tree rows AND in summary/detail views. The inline totals are essential for scanning -- estimators compare costs across line items without opening each one. The detail view provides the full breakdown.

### Layout Paradigm for ShossyWorks

The industry consensus validates the architecture already proposed:

```
+--sidebar--+---------tree panel (scrollable)--------+---detail panel---+
|           | [Name]          [Qty] [Unit] [Total]    |  Full editing    |
| Dashboard | + Foundations          -     -   $45,200|  surface for     |
| Projects  |   + Concrete           -     -   $32,100|  selected node   |
| Settings  |     > Footings   120   CY   $28,800    |                  |
|           |     > Stem Walls  85   LF    $3,300     |  [20+ fields]    |
|           |   + Framing            -     -   $13,100|                  |
+-----------+-----------------------------------------+------------------+
```

Groups and assemblies show rolled-up totals. Items show their specific quantity, unit, and total. The detail panel shows the full field set for the selected node.

---

## 2. Optimal Column Set for Phase 1B

### Recommendation: Three-Tier Column Approach

Based on industry patterns and the ShossyWorks data model, implement columns in phases:

#### Phase 1B-0 (MVP): Minimal Informative Columns

| Column | Width | Applies To | Source Field | Notes |
|--------|-------|-----------|-------------|-------|
| **Name** (tree column) | flex: 1 (min 200px) | All nodes | `node.name` | Contains indentation + expand/collapse + type icon |
| **Type** | 60px fixed | All nodes | `node.node_type` | Subtle badge: G / A / I or icon |
| **Total** | 120px fixed | All nodes | `node.total_price` | Right-aligned, formatted currency. Groups show rolled-up total. |

**Rationale:** Three columns is the minimum that makes the tree useful for scanning. The name column carries the hierarchy. The type badge differentiates groups from items at a glance. The total column is the most-scanned number in any estimate.

#### Phase 1B-1 (After tree editing works): Core Cost Columns

| Column | Width | Applies To | Source Field | Notes |
|--------|-------|-----------|-------------|-------|
| **Qty** | 80px fixed | Items, Assemblies | `details.quantity` | Right-aligned number. Blank for groups. |
| **Unit** | 60px fixed | Items, Assemblies | `details.unit_id` (resolved to label) | Center-aligned text. Blank for groups. |
| **Unit Cost** | 100px fixed | Items only | `details.unit_cost` | Right-aligned currency. Blank for groups/assemblies. |

#### Phase 2 (Full cost breakdown): Extended Columns

| Column | Width | Applies To | Notes |
|--------|-------|-----------|-------|
| **Material** | 100px | Items | `details.material_cost` |
| **Labor** | 100px | Items | `details.labor_cost` |
| **Equipment** | 100px | Items | `details.equipment_cost` |
| **Subcontract** | 100px | Items | `details.subcontractor_cost` |
| **Markup** | 80px | Items | `details.markup_rate` as percentage |

### Column Visibility Configuration

Allow users to show/hide columns via a column picker (dropdown checkbox list in the tree toolbar). Store preferences in `localStorage` initially, migrate to `user_preferences` table later.

```typescript
interface TreeColumnConfig {
  id: string;
  label: string;
  width: number;          // px
  minWidth: number;       // px, for resize constraint
  align: 'left' | 'center' | 'right';
  visible: boolean;
  resizable: boolean;
  appliesTo: NodeType[];  // which node types show data in this column
  renderCell: (node: NodeWithDetails) => ReactNode;
}

const DEFAULT_COLUMNS: TreeColumnConfig[] = [
  {
    id: 'name',
    label: 'Name',
    width: 0,             // flex
    minWidth: 200,
    align: 'left',
    visible: true,
    resizable: false,      // name column always fills remaining space
    appliesTo: ['group', 'assembly', 'item'],
    renderCell: (node) => node.name,
  },
  {
    id: 'total',
    label: 'Total',
    width: 120,
    minWidth: 80,
    align: 'right',
    visible: true,
    resizable: true,
    appliesTo: ['group', 'assembly', 'item'],
    renderCell: (node) => formatCurrency(node.total_price),
  },
  // ... additional columns
];
```

---

## 3. Inline Cost Totals vs Detail Panel Only

### Recommendation: Show Inline Totals -- This Is Non-Negotiable for Estimators

**Every professional estimating tool shows cost totals inline in tree rows.** This is the single most important piece of information an estimator scans for when reviewing an estimate. Hiding totals behind a detail panel click would make the tree useless for its primary purpose: understanding cost distribution at a glance.

#### What to Show Inline vs What to Keep in Detail Panel

| Data | Inline (tree row) | Detail Panel | Rationale |
|------|-------------------|-------------|-----------|
| **Name** | Yes | Yes (editable) | Primary identifier |
| **Total price** | Yes (read-only) | Yes (computed, non-editable) | Most-scanned column |
| **Quantity** | Yes (Phase 1B-1+) | Yes (editable) | Needed for quick scanning |
| **Unit** | Yes (Phase 1B-1+) | Yes (editable dropdown) | Context for quantity |
| **Unit cost** | Yes (Phase 1B-1+) | Yes (editable) | Quick comparison |
| **Material/Labor/Equip/Sub** | No (Phase 2 column) | Yes (editable) | Too many columns for MVP |
| **Markup/Overhead/Tax rates** | No | Yes (editable) | Detail-level data |
| **Specifications/Notes** | No | Yes (editable) | Free-text, variable length |
| **Allowance fields** | No | Yes (editable) | Conditional fields |
| **Vendor/Purchasing** | No | Yes (editable) | Detail-level data |

#### How Groups Display Totals

Groups show **rolled-up totals** from their descendants. The `total_price` field on `estimate_nodes` is already computed by database triggers (the data layer handles aggregation). The tree row simply displays `node.total_price` for all node types.

```
+ Foundations                          $45,200   <-- rolled up by DB trigger
    + Concrete                         $32,100   <-- rolled up
        > Footings     120  CY  $240   $28,800   <-- item: qty * unit_cost
        > Stem Walls    85  LF   $39    $3,300   <-- item: qty * unit_cost
    + Framing                          $13,100   <-- rolled up
```

#### Visual Treatment for Inline Totals

- Groups: total in `--font-semibold`, `--color-text-primary`
- Assemblies: total in `--font-medium`, `--color-text-primary`
- Items: total in `--font-normal`, `--color-text-secondary`
- Columns that don't apply to a node type: empty cell (not "N/A" or "-")
- All currency values right-aligned, monospace font (`--font-mono`) for decimal alignment

---

## 4. Performance Characteristics of @tanstack/react-virtual with Variable-Height Rows

### Architecture Overview

TanStack Virtual uses a three-tier architecture:

1. **Framework-agnostic core** (`@tanstack/virtual-core`) containing all virtualization algorithms
2. **Framework adapters** (`@tanstack/react-virtual`) providing hooks like `useVirtualizer`
3. **Measurement system** with three caching layers: itemSizeCache, measurementsCache, laneAssignments

### Variable-Height Row Performance

#### Measurement Approach

TanStack Virtual supports three sizing modes for our use case:

1. **Fixed size** (all rows same height) -- simplest, best performance
2. **Variable but known** (heights differ but are known before render) -- good performance
3. **Dynamic** (measured after render via `measureElement` + ResizeObserver) -- adequate performance with caveats

**Recommendation for ShossyWorks:** Use **variable but known** sizing. Row heights are deterministic based on node type:

```typescript
const ROW_HEIGHTS: Record<NodeType, number> = {
  group: 40,     // Name + total only
  assembly: 40,  // Name + qty + unit + total
  item: 40,      // Name + qty + unit + unit_cost + total
};

// All rows are the same height in Phase 1B.
// Variable heights reserved for Phase 2 (expanded inline editing).
const ESTIMATE_SIZE = 40;
```

**Why fixed/known is better than dynamic measurement for Phase 1B:**

- Dynamic measurement via `measureElement` adds a render-measure-rerender cycle
- ResizeObserver callbacks execute after layout/before paint (optimal timing) but still trigger layout recalculation
- Dynamic measurement can cause scroll stuttering when scrolling upward (known TanStack Virtual issue #659)
- Fixed row heights mean `getTotalSize()` is exact from the first render -- no layout shifts
- If Phase 2 adds variable-height rows (inline editing, expanded descriptions), switch to `measureElement` at that point

#### Performance Characteristics

| Metric | Expected Performance | Notes |
|--------|---------------------|-------|
| **Scroll FPS** | 60fps consistently | With ~40 DOM nodes in viewport, trivially achieved |
| **Initial render** | <16ms for 2000 nodes | Virtualizer computes positions in O(n) initially, then O(log n) for visible range |
| **Expand/collapse** | <5ms | Recalculate `flatVisibleRows` in reducer, virtualizer picks up new count |
| **Node add/remove** | <5ms | Single item insert/remove in flat arrays |
| **Memory** | ~500KB for 2000 nodes | FlatRow objects are small (5 fields each) |
| **Overscan impact** | Negligible | 10 extra rows = ~400px of off-screen DOM. Recommended: `overscan: 10` |

#### Concrete useVirtualizer Configuration

```typescript
import { useVirtualizer } from '@tanstack/react-virtual';

function VirtualTreeRenderer({
  flatRows,
  scrollContainerRef,
}: {
  flatRows: FlatRow[];
  scrollContainerRef: React.RefObject<HTMLDivElement>;
}) {
  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT,  // Fixed 40px for Phase 1B
    overscan: 10,
    // Do NOT enable useAnimationFrameWithResizeObserver
    // -- adds 16ms delay with no benefit for fixed-height rows
  });

  return (
    <div
      style={{
        height: `${virtualizer.getTotalSize()}px`,
        width: '100%',
        position: 'relative',
      }}
    >
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const flatRow = flatRows[virtualRow.index];
        return (
          <div
            key={flatRow.nodeId}
            data-index={virtualRow.index}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: `${virtualRow.size}px`,
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            <TreeNodeRow
              flatRow={flatRow}
              // node data passed separately or looked up from state
            />
          </div>
        );
      })}
    </div>
  );
}
```

#### When to Switch to Dynamic Measurement (Phase 2+)

Switch from fixed `estimateSize` to `measureElement` when:
- Inline editing is added (edited rows expand to show form fields)
- Multi-line descriptions are shown in tree rows
- Different density modes require different row heights

The migration path is straightforward:

```typescript
// Phase 2: Dynamic measurement
const virtualizer = useVirtualizer({
  count: flatRows.length,
  getScrollElement: () => scrollContainerRef.current,
  estimateSize: () => 40,  // Estimate largest likely size
  overscan: 10,
});

// In the rendered row:
<div
  key={flatRow.nodeId}
  data-index={virtualRow.index}
  ref={virtualizer.measureElement}  // <-- Add this ref
  style={{
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    // Remove fixed height; let content determine it
    transform: `translateY(${virtualRow.start}px)`,
  }}
>
```

---

## 5. Tree-Table Hybrids: Column Resizing with Hierarchical Indentation

### The Core Challenge

Tree-table hybrids must solve a fundamental layout tension: the first column (the "tree column") contains both hierarchical indentation AND content, while subsequent columns are purely tabular. When the tree column is resized or when deeply-nested nodes appear, the indentation consumes horizontal space that the node name needs.

### Industry Patterns

#### SAP Fiori Tree Table (Enterprise Standard)

SAP Fiori's tree table defines the enterprise standard for this pattern:

- **Tree cell structure:** Each tree cell contains three elements: spacer (depth-based), expand/collapse toggle (fixed width), and content
- **Column resizing:** Dragging the separator between column headers resizes the specific column. Other columns are unaffected (when widths are in px/em/rem)
- **Keyboard resize:** `Shift+Right` to increase width, `Shift+Left` to decrease
- **Minimum width:** Per-column minimum prevents undersized columns
- **Touch:** Column header tap reveals resize handle for drag interaction

#### GitHub Tree View (CSS Grid Pattern)

GitHub's implementation uses CSS Grid with a three-column internal layout:

```css
.TreeView-item {
  --toggle-width: 1rem;
  --spacer-col: max(8px, var(--level) * 8px);
  display: grid;
  grid-template-columns: var(--spacer-col) var(--toggle-width) 1fr;
  grid-template-areas: "spacer toggle content";
}
```

Key advantages:
- Indentation handled per-item via CSS custom property `--level`
- No complex parent-child DOM relationships needed
- `max()` function ensures minimum spacing even at depth 0
- Toggle column reserved even when absent (leaf nodes), preventing layout shift

#### Hagan Rivers Research (Tree-Table Limitations)

Research by Hagan Rivers identifies a critical limitation: **tree tables work best with 2 levels (parent + children). Multiple nested levels become unusable rapidly** because:
- Indentation consumes too much horizontal space at depth 5+
- Columns that apply to some node types but not others create sparse rows
- Icon clutter interferes with hierarchy scanning

This validates the ShossyWorks approach of limiting inline columns and using a side panel for detailed editing.

### Recommended Implementation for ShossyWorks

#### Row Layout: CSS Grid with Fixed + Flex Columns

```typescript
// Column definitions generate the grid template
function getGridTemplate(columns: TreeColumnConfig[]): string {
  return columns
    .filter(c => c.visible)
    .map(c => c.width === 0 ? '1fr' : `${c.width}px`)
    .join(' ');
}

// Example: "1fr 120px" for [Name (flex), Total (120px)]
// Example: "1fr 80px 60px 100px 120px" for [Name, Qty, Unit, UnitCost, Total]
```

#### Tree Column Internal Layout (Indentation)

The tree column (first column) uses a nested flex layout with depth-based padding:

```typescript
const INDENT_PX = 20;  // pixels per depth level
const TOGGLE_WIDTH = 24; // expand/collapse button width

interface TreeCellProps {
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  nodeType: NodeType;
  name: string;
  onToggle: () => void;
}

function TreeCell({
  depth,
  hasChildren,
  isExpanded,
  nodeType,
  name,
  onToggle,
}: TreeCellProps) {
  return (
    <div
      className="flex items-center gap-[var(--space-1)] min-w-0"
      style={{
        paddingLeft: `${depth * INDENT_PX}px`,
      }}
    >
      {/* Toggle button: fixed width, reserved space even for leaves */}
      <button
        className="flex-shrink-0 w-6 h-6 flex items-center justify-center"
        onClick={hasChildren ? onToggle : undefined}
        aria-expanded={hasChildren ? isExpanded : undefined}
        tabIndex={-1}
      >
        {hasChildren && (
          <ChevronIcon
            className="transition-transform"
            style={{
              transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
              transitionDuration: 'var(--transition-fast)',
            }}
          />
        )}
      </button>

      {/* Type icon */}
      <NodeTypeIcon type={nodeType} className="flex-shrink-0 w-4 h-4" />

      {/* Name: truncate with ellipsis */}
      <span className="truncate text-[var(--text-sm)] text-[var(--color-text-primary)]">
        {name}
      </span>
    </div>
  );
}
```

#### Column Resizing Implementation

For Phase 1B, implement simple column resizing via drag handles:

```typescript
function useColumnResize(
  columns: TreeColumnConfig[],
  onResize: (columnId: string, newWidth: number) => void,
) {
  const handleMouseDown = useCallback(
    (columnId: string, startX: number) => {
      const column = columns.find(c => c.id === columnId);
      if (!column || !column.resizable) return;

      const startWidth = column.width;

      const handleMouseMove = (e: MouseEvent) => {
        const delta = e.clientX - startX;
        const newWidth = Math.max(column.minWidth, startWidth + delta);
        onResize(columnId, newWidth);
      };

      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [columns, onResize],
  );

  return { handleMouseDown };
}
```

#### Depth Limit and Horizontal Overflow Strategy

At `INDENT_PX = 20` and a minimum tree column width of 200px:
- Depth 5: 100px indent, leaving 100px for toggle + icon + name (tight but workable)
- Depth 8: 160px indent, leaving 40px for content (unusable)
- Depth 10: 200px indent, leaving 0px (broken)

**Mitigation strategies:**

1. **Cap visual indentation at depth 6** (max 120px). Deeper nodes get the same indent as depth 6 but show a depth indicator badge.
2. **Breadcrumbs** (already planned) show the full path when a deep node is selected.
3. **Use the tree's expand/collapse** -- deeply nested nodes are only visible when their ancestors are expanded, at which point the user has context.

```typescript
const MAX_VISUAL_DEPTH = 6;
const effectiveDepth = Math.min(depth, MAX_VISUAL_DEPTH);
const paddingLeft = effectiveDepth * INDENT_PX;
```

---

## 6. Complete Row Rendering Pattern

Putting it all together -- the full tree row with columns:

```typescript
const ROW_HEIGHT = 40;

interface TreeRowProps {
  flatRow: FlatRow;
  node: NodeWithDetails;
  columns: TreeColumnConfig[];
  isSelected: boolean;
  isFocused: boolean;
  gridTemplate: string;
  onSelect: (nodeId: string) => void;
  onToggle: (nodeId: string) => void;
  onContextMenu: (nodeId: string, e: React.MouseEvent) => void;
}

const TreeNodeRow = React.memo(function TreeNodeRow({
  flatRow,
  node,
  columns,
  isSelected,
  isFocused,
  gridTemplate,
  onSelect,
  onToggle,
  onContextMenu,
}: TreeRowProps) {
  return (
    <div
      role="treeitem"
      aria-level={flatRow.depth + 1}
      aria-expanded={flatRow.hasChildren ? flatRow.isExpanded : undefined}
      aria-selected={isSelected}
      data-node-id={flatRow.nodeId}
      data-node-type={flatRow.nodeType}
      className={cn(
        'flex items-center h-10 border-b border-[var(--color-border)]',
        'cursor-pointer select-none',
        'hover:bg-[var(--color-surface-hover)]',
        isSelected && 'bg-[var(--color-surface-active)]',
        isFocused && 'outline outline-2 outline-offset-[-2px] outline-[var(--color-border-focus)]',
      )}
      style={{
        display: 'grid',
        gridTemplateColumns: gridTemplate,
      }}
      onClick={() => onSelect(flatRow.nodeId)}
      onContextMenu={(e) => onContextMenu(flatRow.nodeId, e)}
    >
      {columns.filter(c => c.visible).map((column) => (
        <div
          key={column.id}
          className={cn(
            'px-[var(--space-2)] flex items-center overflow-hidden',
            column.align === 'right' && 'justify-end',
            column.align === 'center' && 'justify-center',
          )}
        >
          {column.id === 'name' ? (
            <TreeCell
              depth={flatRow.depth}
              hasChildren={flatRow.hasChildren}
              isExpanded={flatRow.isExpanded}
              nodeType={flatRow.nodeType}
              name={node.name}
              onToggle={() => onToggle(flatRow.nodeId)}
            />
          ) : (
            column.appliesTo.includes(flatRow.nodeType)
              ? column.renderCell(node)
              : null
          )}
        </div>
      ))}
    </div>
  );
});
```

---

## 7. Concrete Recommendations Summary

### Architecture Decisions (Confirmed)

| Decision | Recommendation | Confidence |
|----------|---------------|------------|
| Tree-table vs pure tree | **Hybrid: tree-in-first-column + tabular cost columns.** Matches every professional estimating tool surveyed. | High |
| Inline totals | **Yes, always show total_price inline for all node types.** This is how estimators scan. Hiding it behind a click is a UX failure. | High |
| Fixed vs variable row heights (Phase 1B) | **Fixed 40px for all row types.** Switch to dynamic measurement only when inline editing is added (Phase 2). | High |
| Column resizing | **Implement in Phase 1B-1 (after core tree works).** Simple drag-on-separator approach. Name column always flex. | Medium |
| Virtual scrolling library | **@tanstack/react-virtual with `useVirtualizer`.** Fixed `estimateSize`, `overscan: 10`, no `measureElement` in Phase 1B. | High |
| Indentation strategy | **Depth-based padding with CSS, capped at depth 6.** 20px per level, `paddingLeft` on tree cell. | High |

### Column Phasing

| Phase | Columns | When |
|-------|---------|------|
| **1B-0 (MVP)** | Name (tree), Total | Day one |
| **1B-0 stretch** | Name (tree), Type badge, Total | If time allows |
| **1B-1** | Name, Qty, Unit, Unit Cost, Total | After tree editing works |
| **Phase 2** | + Material, Labor, Equipment, Subcontract, Markup | Full cost breakdown |
| **Phase 2+** | Column visibility picker, saved column configurations | User customization |

### Design System Compliance

All tree-table rendering must use design tokens exclusively:

- Row background: `var(--color-bg-primary)` (default), `var(--color-surface-hover)` (hover), `var(--color-surface-active)` (selected)
- Row border: `border-b border-[var(--color-border)]`
- Text: `var(--color-text-primary)` for names/totals, `var(--color-text-secondary)` for secondary data
- Currency values: `var(--font-mono)` for decimal alignment
- Row height: 40px (`var(--space-10)`)
- Cell padding: `var(--space-2)` horizontal
- Sharp corners everywhere (no rounded corners on rows, cells, or containers)
- Focus ring: `outline-[var(--color-border-focus)]`, 2px width
- Transitions: `var(--transition-fast)` for chevron rotation on expand/collapse

### Performance Guardrails

| Guardrail | Value | Rationale |
|-----------|-------|-----------|
| Max DOM nodes in viewport | 50 rows | Virtual scroller renders only visible rows + overscan |
| Overscan | 10 rows | Smooth scrolling without excessive DOM |
| FlatVisibleRows computation | In reducer, not useMemo | Avoid render-time recalculation |
| React.memo on TreeNodeRow | Always | Prevents re-render on parent state changes |
| ResizeObserver | Not used in Phase 1B | Fixed row heights eliminate the need |
| Scroll FPS target | 60fps | Trivially achieved with 40-50 DOM nodes |

### NOT in Scope for Phase 1B

- Inline cell editing (double-click to edit quantity in tree row)
- Drag-and-drop column reordering
- Column sorting (click header to sort)
- Column filtering
- Frozen/pinned columns
- Row grouping beyond the tree hierarchy
- Export to Excel from tree view
- Print layout / print styles

These are all valid Phase 2+ enhancements that the column configuration system is designed to support.

---

## Sources

- [ProEst Complete Guide 2025](https://profoundestimates.com/explanations/proest-estimating-software-a-complete-guide-for-construction-professionals-in-2025)
- [ProEst Construction Estimating (Autodesk)](https://construction.autodesk.com/products/proest/)
- [ProEst Step-by-Step Guide](https://profoundestimates.com/guides/how-to-use-proest-for-construction-estimating-step-by-step-guide)
- [Cubit Estimating Features](https://asestimation.com/blogs/top-features-of-cubit/)
- [Cubit Estimating Pro (Buildsoft)](https://bsssoftware.co.uk/cubit-estimating-pro-building-estimating-software/)
- [PlanSwift Features](https://www.planswift.com/planswift-features/)
- [PlanSwift Overview (Capterra)](https://www.capterra.com/p/70808/PlanSwift/)
- [Sage 300 CRE Estimating Fundamentals](https://cdn.ymaws.com/www.tugweb.com/resource/resmgr/2017_Regional_Workshop/2017_Regional_Session_Materials/5-1_thru_5-3_Estimating_Fund.pdf)
- [ConstructionOnline Estimating](https://us.constructiononline.com/construction-estimating-software-minitour)
- [TanStack Virtual API (Virtualizer)](https://tanstack.com/virtual/latest/docs/api/virtualizer)
- [TanStack Virtual Variable Example](https://tanstack.com/virtual/latest/docs/framework/react/examples/variable)
- [TanStack Virtual Architecture (DeepWiki)](https://deepwiki.com/TanStack/virtual/1.2-getting-started)
- [TanStack Virtual Scroll Stuttering Issue #659](https://github.com/TanStack/virtual/issues/659)
- [SAP Fiori Tree Table Design Guidelines](https://www.sap.com/design-system/fiori-design-web/ui-elements/tree-table/)
- [Interaction Design for Trees (Hagan Rivers)](https://medium.com/@hagan.rivers/interaction-design-for-trees-5e915b408ed2)
- [Tree Data in React Tables (Simple Table)](https://www.simple-table.com/blog/react-tree-data-hierarchical-tables)
- [CSS Tree View Indentation (Ahmad Shadeed)](https://ishadeed.com/article/tree-view-css-indent/)
- [WBS Cost Management (Archdesk)](https://archdesk.com/blog/construction-wbs-cost-management-2025)
- [WBS for Construction (B2W Software)](https://www.b2wsoftware.com/work-breakdown-structure-estimating-for-heavy-construction/)
