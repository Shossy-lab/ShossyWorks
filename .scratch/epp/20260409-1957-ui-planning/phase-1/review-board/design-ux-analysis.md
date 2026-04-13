# Design & UX Research Analysis

**Analyst Role:** Design & UX Research
**Date:** 2026-04-09
**Scope:** Phase 1 UI Planning — design language, prototype extraction, estimate UI patterns, responsive strategy, micro-interactions, feedback loops

---

## 1. Design Language Beyond Tokens

### Problem Statement
The design system tokens (DESIGN-SYSTEM.md) handle colors, spacing, radii, and typography. But tokens alone do not create a distinctive product. The difference between "clean" and "generic" lives in the spaces between tokens: visual hierarchy, information density, whitespace rhythm, interaction philosophy, and motion language.

### What the Current Token System Gets Right
- **Sharp corners on rectangles, pill shapes for buttons.** This is a genuine differentiator. Most AI-generated and SaaS UI defaults to `rounded-lg` everywhere. The sharp/pill binary creates immediate visual identity.
- **Monochrome interactive palette (#0a0a0a primary).** Black-and-white with semantic color accents (green/yellow/red/blue) is the same strategy Linear uses. It works because it forces the color to carry meaning, not decoration.
- **Inter font.** Functional choice. However, Inter is the single most common font in AI-generated UI. See "Font Differentiation" below.

### What Is Missing (Design Language Gaps)

**A. Visual Hierarchy Rules**
Tokens define `text-xs` through `text-3xl`, but there are no rules governing WHEN to use which size. A construction estimator needs a strict typographic hierarchy:

| Level | Use | Recommended Token | Weight |
|-------|-----|-------------------|--------|
| Page title | "Estimates" | text-2xl | semibold |
| Section header | "Cedar Siding System" (group node) | text-lg | semibold |
| Row label | "Siding - Western Red Cedar" (item) | text-sm | medium |
| Data cell | "$3,974.40" | text-sm (mono) | normal |
| Metadata / secondary | "1,200 SF" | text-xs | normal |
| Helper text | "Last edited 2h ago" | text-xs | normal, tertiary color |

Without these rules codified, every component will make ad-hoc size decisions and the result will be visually incoherent.

**B. Information Density Standard**
Construction estimating is data-dense work. The tool must avoid two failure modes:
1. Too sparse (typical AI output) -- giant padding, low data-per-screen, feels like a marketing page
2. Too dense (typical spreadsheet) -- no breathing room, overwhelming, hard to scan

RECOMMENDATION: Define three density modes as CSS token sets:
- `--density-compact`: 24px row height, 8px padding (spreadsheet mode, power users)
- `--density-default`: 32px row height, 12px padding (balanced)
- `--density-comfortable`: 40px row height, 16px padding (presentation / client view)

User preference stored per-estimate (Decision 3 from interaction decisions already supports this).

**C. Whitespace Rhythm**
Add a spacing rhythm rule to DESIGN-SYSTEM.md:
- **Within a row/cell:** space-1 to space-2
- **Between sibling rows:** space-0 (rows share borders)
- **Between sections/groups:** space-4 (visual grouping)
- **Between page regions:** space-8 to space-12
- **Page margins:** space-6 (already used in layout)

This creates a predictable cadence where whitespace communicates structure.

**D. Font Differentiation**
Inter is the most common AI-generated UI font. The design system already specifies it. TWO options:

1. **Keep Inter, differentiate through weight discipline.** Most AI output uses Inter Regular and Medium. ShossyWorks could create distinctiveness by using a strict weight ladder: 400 (data), 500 (labels), 600 (section headers), 700 (page titles only). The weight contrast does more visual work than the font choice.

2. **Switch to a distinctive sans-serif.** Options that maintain the clean/professional feel:
   - **IBM Plex Sans** -- designed for data-heavy interfaces, has a monospace companion (IBM Plex Mono), slightly more technical personality than Inter
   - **Geist** -- Vercel's own font, designed for developer tools, clean but less common than Inter
   - **DM Sans** -- geometric, modern, better optical sizing than Inter at small text sizes

DECISION NEEDED FROM ZAC: Font choice is a taste decision. Propose showing a short estimate tree rendered in Inter vs IBM Plex Sans vs Geist. 10-minute comparison, big impact.

**E. Animation Philosophy**
The current tokens define `transition-fast` (100ms), `transition-normal` (200ms), `transition-slow` (300ms). But there is no philosophy governing WHAT animates and what does not.

RECOMMENDATION -- "Functional motion only":
- **Animate:** State transitions (expand/collapse, modal open/close, sidebar toggle, toast appear/dismiss)
- **Animate:** Feedback signals (save confirmation, error shake, loading indicators)
- **Do NOT animate:** Page navigation, data loading, layout reflows
- **Do NOT animate:** Decorative motion (hover glows, pulse effects, parallax)
- All motion should be `prefers-reduced-motion` aware

This is the Linear approach: motion exists to confirm actions, not to decorate.

**F. Iconography**
No icon system is defined. The existing sidebar uses Unicode arrows. This needs resolution:

RECOMMENDATION: [Lucide Icons](https://lucide.dev/) -- tree-shakeable, consistent stroke weight, MIT licensed, widely used in Next.js projects. Ship a subset (30-40 icons for Phase 1B) rather than the full set.

Alternative: [Phosphor Icons](https://phosphoricons.com/) -- more variety, six weights, but heavier bundle.

DECISION NEEDED FROM ZAC: Icon style preference (outline vs. filled for active states? consistent weight?). A 5-icon comparison sheet would suffice.

---

## 2. Prototype Extraction Strategy

### Sources Available
1. **EP (Attempt 1)** -- Had working UI with a 46-column monolithic table. UI was tightly coupled to the wrong data model.
2. **Soloway (Attempt 2)** -- Read-only client viewer with tree rendering, expand/collapse, option selection panels, bubble-up indicators.
3. **Figma Make prototypes** -- Zac has designs for estimates, dashboard, login. Not yet shared.

### What to Extract from Each

**From Soloway (HIGH VALUE):**
- **Progressive disclosure via expand/collapse tree with depth-based formatting.** The Soloway attempt proved this UX pattern works for client communication. The code cannot be reused (it was built for immutable data), but the PATTERN is validated: indentation depth drives visual weight, and expand/collapse lets users control complexity.
- **Option selection UI patterns.** Inline panels, bubble-up indicators (showing a parent has options underneath), overview modal. These are production-tested interaction patterns. The Soloway option system's three-layer architecture (broad, inline, option sets) maps directly to the ShossyWorks options system (selection vs toggle types from INTENT Decision 19).
- **Per-row aggregation display.** Showing actual contingency/overhead amounts per row (not just global rates) was proven correct in Soloway.
- **Real-time option selection sync.** Supabase Realtime channels for live option selection during budget meetings -- proven pattern.

**From EP (LOW VALUE -- concepts only):**
- **Scope reference.** EP's 46-column table shows the full breadth of fields an estimating UI needs to display: quantity, unit, unit cost, subtotal, contingency rate/amount, overhead rate/amount, total price, unit price, waste factor, package rounding, minimum order. The NEW system has these split across `estimate_nodes` + `node_item_details` + `node_assembly_details`, but the UI still needs to display the same data.
- **Tree operations UX.** EP had working add/delete/move/indent/outdent. The specific implementation is not reusable (wrong data model), but the user expectations are established.

**From Figma (UNKNOWN VALUE -- needs discussion):**
This is the biggest gap. Zac has Figma prototypes but has explicitly said he wants to discuss WHAT to extract before sharing links. This is correct -- extracting Figma designs without context leads to cargo-cult implementation.

STRUCTURED CONVERSATION NEEDED:
1. What pages do Figma prototypes cover? (estimates, dashboard, login -- anything else?)
2. For each page: Is this a layout/structure reference, a visual style reference, or both?
3. Are there component-level designs (buttons, inputs, cards) or only page-level compositions?
4. Do the Figma designs use the current design token values, or do they predate the token system?
5. Are there any Figma designs for the TREE VIEW specifically? This is the most important component and the most dangerous to get wrong.

### Extraction Rules
- **Extract patterns, not pixels.** Never copy layout values from a Figma comp without verifying they map to existing design tokens.
- **Extract information architecture, not visual design.** What data goes where, what hierarchy of information is shown -- this transfers. Specific colors, spacing, and styling must come from the token system.
- **Prototype code is toxic.** Zero lines of code from EP or Soloway should be copy-pasted. Both were built on fundamentally different data models. Even "simple" components like buttons or inputs were hardcoded to those contexts.

---

## 3. Estimate UI Patterns -- Industry Research

### How Professional Estimating Tools Display Cost Data

After researching ProEst, Buildertrend, PlanSwift, Cubit Estimating, and general construction software UI patterns, the dominant paradigm is:

**The Tree-Table Hybrid**

Every serious estimating tool uses a tree-table: a spreadsheet-like grid where rows can have parent-child relationships (expand/collapse), and columns show cost data. This is NOT a card layout. This is NOT a kanban board. This is a data grid with hierarchy.

| Pattern | Used By | Appropriate For |
|---------|---------|-----------------|
| Tree-table (spreadsheet + hierarchy) | ProEst, Excel, Cubit, most pros | Core estimate editing -- the primary interaction |
| Card grid | Buildertrend, Monday.com | Project overview, dashboard, high-level navigation |
| List with drill-down | Notion, Linear | Project lists, estimate lists, settings |
| Detail panel (split view) | ProEst, Figma, Linear | Node detail editing alongside tree context |

### Recommended UI Architecture for ShossyWorks Estimates

```
+--sidebar--+------- main content area ---------------------------+
|            | Breadcrumb: Projects > Soloway Residence > Estimate |
| Nav        +----------------------------------------------------+
|            | Toolbar: [+ Add] [Actions v] [Search] [Columns v]  |
|            +----------------------------------------------------+
|            |  [Tree-Table: full width, virtualized]              |
|            |  > Group: Foundation                          $24K  |
|            |    > Assembly: Concrete Footings         28 CY $8K  |
|            |      Item: Concrete Ready Mix    28 CY  $180   $5K  |
|            |      Item: Rebar #4             400 LF  $1.20  $480 |
|            |      Item: Labor - Pour          32 HR  $65    $2K  |
|            |    > Assembly: Foundation Walls           etc.       |
|            |  > Group: Framing                          $48K     |
|            +----------------------------------------------------+
|            |  [Status bar: 342 items | $187,240 total | Draft]   |
+------------+----------------------------------------------------+
```

**Detail editing:** When a user clicks a node, a SIDE PANEL or INLINE EXPANSION shows the detail fields (quantity, unit, unit cost, markup rates, notes, etc.). The tree-table continues to show the summary view. This is the ProEst / Figma pattern -- the list stays visible while you edit one item.

### Tree-Table Column Set (Phase 1B)

Minimum columns for Phase 1B:
| Column | Width | Source |
|--------|-------|--------|
| Name (with indent) | flex/fill | `estimate_nodes.name` |
| Type icon | 24px | `estimate_nodes.node_type` |
| Quantity | 80px | `node_item_details.quantity` or assembly qty |
| Unit | 50px | `units_of_measure.abbreviation` |
| Unit Cost | 90px | `node_item_details.unit_cost` |
| Total | 100px | Calculated: aggregated or item-level |
| Status/flags | 30px | `estimate_nodes.is_flagged` |

Columns toggled via user preference (INTENT Decision 3): contingency rate, contingency amount, overhead rate, overhead amount, unit price, cost code, phase.

### Virtualization Requirement
INTENT.md states estimates can have 500-2,000 nodes. A flat list of 2,000 rows with expand/collapse MUST be virtualized. Options:
- **TanStack Table + custom virtualization** -- most control, no vendor lock-in, but significant build effort
- **AG Grid (community)** -- tree data support, virtualization built in, MIT licensed, but heavyweight
- **react-arborist** -- purpose-built tree component with drag-and-drop, but less spreadsheet-like
- **Custom implementation** -- using `react-window` or `@tanstack/virtual` for scroll virtualization on a custom tree renderer

RECOMMENDATION: TanStack Table for the data grid foundation + `@tanstack/virtual` for row virtualization. This gives full control over rendering (critical for design system compliance), keeps the bundle small, and avoids fighting a vendor component's opinions. AG Grid and MUI X Data Grid both impose their own styling that would conflict with the sharp-corners design system.

DECISION NEEDED FROM ZAC: Tradeoff between build speed (AG Grid) and design control (TanStack). This is a day-one architectural decision that affects every subsequent UI session.

---

## 4. Responsive Strategy

### Desktop-First is Correct

Construction estimating is overwhelmingly a desktop activity. The data density required for cost editing (8+ columns, deep hierarchy, inline formulas) does not translate to mobile screens. Industry research confirms:

- ProEst, PlanSwift, STACK: Desktop/laptop primary. Tablet as secondary for field reference.
- Buildertrend, ArcSite: Mobile-first for field operations (photos, daily logs, time tracking), but estimating features are desktop-focused.
- Job site tablet usage is primarily for VIEWING approved estimates, not editing them.

### Recommended Breakpoints

| Breakpoint | Device | Layout |
|------------|--------|--------|
| >= 1280px (default) | Desktop / laptop | Full layout: sidebar + tree-table + detail panel |
| >= 1024px | Small laptop / landscape tablet | Sidebar collapsed by default, detail panel as overlay |
| >= 768px | Portrait tablet | Sidebar hidden (hamburger), tree-table full width, detail as bottom sheet or modal |
| < 768px | Phone | NOT a target for Phase 1B. Redirect to a simplified project/estimate viewer if accessed. |

### Phase 1B Scope
- Build the >= 1280px layout first. This is where 90%+ of estimate editing happens.
- The >= 1024px adaptation (collapsed sidebar) is trivially derivable.
- Tablet (>= 768px) is Phase 2E per the roadmap. Defer it explicitly.
- Mobile: Show a "please use desktop" message. Do not attempt to cram a tree-table into 375px.

### Client View Exception
The client-facing estimate view (PIN-protected share links, INTENT Decision 18) SHOULD be responsive down to tablet. Clients are not editing -- they are reviewing a formatted proposal. This is a simpler layout (no sidebar, no editing controls, read-only tree with expand/collapse). Tablet-friendly client view can be built in Phase 1B if scoped as a separate route with its own layout.

---

## 5. Micro-Interactions That Matter

### The Difference Between Polished and Generic

Generic AI tools have zero micro-interactions. Everything is instant, with no feedback, no affordances, no sense of weight. A polished estimating tool communicates through interaction quality.

### Priority Micro-Interactions for Phase 1B

**MUST HAVE (functional, not decorative):**

1. **Tab-to-next-cell navigation.** In the tree-table, Tab moves focus right to the next editable cell. Shift+Tab moves left. Enter commits and moves down. This is the spreadsheet contract that every estimator expects. Without this, the tool feels broken.

2. **Inline editing activation.** Double-click or Enter on a cell transitions it from display to edit mode. The transition should be INSTANT (no animation on entering edit mode). The cell border changes from transparent to `--color-border-focus`. This is the most common interaction -- it must be zero-friction.

3. **Save feedback.** After editing a value, a brief (200ms) background flash on the row confirms the save completed. If using optimistic updates with server reconciliation, the flash happens on server confirmation. No spinners for individual cell saves -- too disruptive.

4. **Expand/collapse with content-aware animation.** Groups and assemblies expand/collapse with a 200ms height transition. The chevron rotates 90 degrees. Children animate in with a slight stagger (50ms per child, capped at 300ms total). This communicates the tree structure spatially.

5. **Keyboard shortcuts overlay.** Following the Linear pattern: `?` opens a keyboard shortcut reference. Shortcuts are discoverable via tooltip on hover (after 1s delay). Key shortcuts for Phase 1B:
   - `N` -- new node
   - `Tab` -- indent (promote to child)
   - `Shift+Tab` -- outdent
   - `Ctrl+D` -- duplicate
   - `Delete` -- delete with confirmation
   - `Ctrl+/` -- toggle sidebar
   - `Ctrl+K` -- command palette (search/navigate)

6. **Drag-and-drop reorder feedback.** When dragging a node: source row gets a 50% opacity ghost, a blue insertion line shows the drop target, valid/invalid drop zones are visually distinct. Drop animation: 200ms ease-out to final position.

7. **Contextual right-click menu.** Right-click on a node shows: Edit, Duplicate, Delete, Move to..., Add to Catalog, Add to Option, Toggle Client Visibility, Flag/Unflag. This replaces a toolbar for power users.

**NICE TO HAVE (polish, Phase 2+):**

8. **Calculation cascade visualization.** When a value changes, briefly highlight (100ms pulse) every cell that recalculated as a result. Shows the user what their edit affected.

9. **Presence indicators.** When another user is viewing/editing the same estimate (real-time collaboration), show their avatar on the row they are focused on. Colored border on cells they are editing.

10. **Undo/redo feedback.** `Ctrl+Z` undoes with a brief "Undone" toast (auto-dismiss 2s). `Ctrl+Shift+Z` redoes.

### Cubit Estimating Keyboard Shortcuts (Industry Reference)
Research into Cubit Estimating's shortcut system reveals the pattern professional estimators expect: keyboard-driven navigation through cost data, with shortcuts for duplicating items, adjusting quantities, and navigating the tree. ShossyWorks should match this expectation in spirit if not exact bindings.

---

## 6. Feedback Loop Design -- Design Decision Checkpoints

### The Problem
Zac needs to approve design decisions. But blocking development for every visual choice would kill velocity. The previous attempts failed partly because UI decisions were made in isolation without feedback, then the result did not match expectations.

### Proposed Checkpoint Architecture

Categorize every design decision by impact and reversibility:

| Category | Impact | Reversible? | Checkpoint Type | Examples |
|----------|--------|-------------|-----------------|----------|
| **Foundation** | High | No (rebuilding is catastrophic) | BLOCKING -- Zac must approve before implementation | Tree-table library choice, state management pattern, component architecture, layout structure |
| **System** | Medium | Difficult (cascading changes) | REVIEW -- implement, show screenshot/prototype, iterate | Typography hierarchy, density modes, icon set, animation philosophy, color token additions |
| **Surface** | Low | Easy (token change or component swap) | INFORM -- implement, document the choice, Zac can request changes later | Specific spacing values, hover states, focus ring styles, loading skeletons |

### Checkpoint Implementation

**For BLOCKING decisions (before any code):**
1. Write a decision document (< 1 page) with 2-3 options and a recommendation
2. Include visual examples (screenshots from reference apps, simple mockups)
3. Zac reviews and chooses (expected turnaround: same session or next session)
4. Document the decision in INTENT.md
5. Proceed with implementation

**For REVIEW decisions (code first, then validate):**
1. Implement the component or pattern
2. Deploy to Vercel preview (or provide screenshot)
3. Note in session handoff doc: "Pending Zac review: [component], deployed at [URL]"
4. Zac reviews asynchronously (no blocking)
5. If changes needed, iterate next session

**For SURFACE decisions (document only):**
1. Implement following design system tokens
2. Note the choice in the session handoff doc
3. No explicit review needed unless Zac raises concerns

### Phase 1B Decision Queue

These decisions should be resolved BEFORE Phase 1B implementation begins, in this order:

1. **BLOCKING: Figma prototype review.** Zac shares Figma links, discusses what to extract. Without this, the team is guessing at visual direction.
2. **BLOCKING: Tree-table component strategy.** TanStack Table vs AG Grid vs custom. Affects every estimate UI component.
3. **BLOCKING: State management choice.** useReducer vs Zustand vs Jotai. Affects every client component.
4. **BLOCKING: Layout structure.** Sidebar + tree-table + detail panel arrangement. Confirm the wireframe above or propose alternatives.
5. **REVIEW: Font choice.** Inter vs alternative. Show side-by-side comparison.
6. **REVIEW: Icon set.** Lucide vs Phosphor vs other. Show 10 common icons.
7. **REVIEW: Density modes.** Show the same estimate at compact/default/comfortable density.
8. **SURFACE: Animation timing values.** Implement using current tokens, adjust if needed.

### Time Budget
- BLOCKING decisions: ~1 session of focused discussion (could be combined with early Phase 1B)
- REVIEW decisions: embedded in normal development, asynchronous
- SURFACE decisions: no time overhead, part of normal development

---

## 7. Critical Warnings

### Warning 1: The Tree View is the Product
The tree-table component is not "a component." It IS the product. An estimating tool with a bad tree view is like a text editor with bad text input. This component will consume 40-60% of Phase 1B development time and must be architectured for:
- 2,000+ nodes with virtualization
- Keyboard-driven navigation (Tab, Enter, Arrow keys)
- Inline editing with optimistic updates
- Real-time collaboration overlay (Phase 2)
- Drag-and-drop reorder
- Context menus
- Column resizing and toggling
- Three density modes

Do NOT treat this as one component. It is a component SYSTEM:
- `TreeTable` (container, virtualization, scroll management)
- `TreeTableRow` (single row rendering, indent, expand/collapse)
- `TreeTableCell` (display + edit modes, type-specific rendering)
- `TreeTableHeader` (column headers, resize handles, sort indicators)
- `TreeTableToolbar` (actions, search, column toggle)
- `TreeTableStatusBar` (item count, total, estimate status)
- `useTreeState` (hook: expand/collapse, selection, edit mode)
- `useTreeKeyboard` (hook: keyboard navigation)
- `useTreeDragDrop` (hook: reorder logic)

### Warning 2: Headless UI Components for Everything Else
For non-tree components (modals, dropdowns, tooltips, popovers, command palette), use a headless UI library like Radix UI or Ark UI. These handle accessibility (ARIA, focus management, keyboard navigation) without imposing visual styles. Building these from scratch is a waste of time and will have accessibility bugs.

RECOMMENDATION: Radix UI Primitives -- widely used in the Next.js ecosystem, zero styling opinions, excellent accessibility, composable.

### Warning 3: The Client View is a Separate Product
The client-facing estimate view (PIN-protected, read-only, responsive to tablet) has fundamentally different requirements from the estimating interface. It should be a separate route group with its own layout, its own component set, and its own responsive strategy. Do NOT try to make the estimating UI "also work for clients" by hiding buttons. Build it separately.

### Warning 4: Do Not Over-Design Before Building
The previous attempts failed partly from over-design (100KB+ spec documents). The design system and token architecture are already established. Phase 1B should start building REAL components against REAL data (the server actions exist!) and iterate. The skeleton is:
1. Get the tree rendering flat data
2. Get expand/collapse working
3. Get inline editing working
4. Get save/load working
5. THEN iterate on polish, density, animations

---

## 8. Summary of Decisions Needed from Zac

| # | Decision | Type | Impact | Time to Decide |
|---|----------|------|--------|----------------|
| 1 | Share and discuss Figma prototypes | BLOCKING | What visual direction to follow | 30-60 min conversation |
| 2 | Tree-table library (TanStack vs AG Grid vs custom) | BLOCKING | Foundation of entire estimate UI | 15 min briefing + decision |
| 3 | State management (useReducer vs Zustand) | BLOCKING | Every client component pattern | 10 min briefing + decision |
| 4 | Layout wireframe approval | BLOCKING | Page structure for estimates | 10 min review |
| 5 | Font choice (Inter vs alternative) | REVIEW | Visual distinctiveness | 5 min side-by-side |
| 6 | Icon library | REVIEW | Iconography consistency | 5 min review |
| 7 | Density modes | REVIEW | Information density control | 5 min prototype review |

Total estimated decision time: ~2 hours, front-loaded before Phase 1B begins.

---

## Research Sources

- [Buildertrend Construction Estimating Software](https://buildertrend.com/financial-tools/construction-estimating-software/)
- [ProEst Construction Estimating Software](https://construction.autodesk.com/products/proest/)
- [How we redesigned the Linear UI](https://linear.app/now/how-we-redesigned-the-linear-ui)
- [Linear Design: The SaaS design trend](https://blog.logrocket.com/ux-design/linear-design/)
- [A calmer interface for a product in motion (Linear)](https://linear.app/now/behind-the-latest-design-refresh)
- [Escape AI slop frontend design guide](https://techbytes.app/posts/escape-ai-slop-frontend-design-guide/)
- [Why Your AI Keeps Building the Same Purple Gradient Website](https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website)
- [Prompting for frontend aesthetics (Claude)](https://platform.claude.com/cookbook/coding-prompting-for-frontend-aesthetics)
- [How to build a tree grid component in React](https://blog.logrocket.com/build-tree-grid-component-react/)
- [MUI X Tree View](https://mui.com/x/react-tree-view/)
- [MUI X Data Grid Tree Data](https://mui.com/x/react-data-grid/tree-data/)
- [Syncfusion React Tree Grid](https://www.syncfusion.com/react-components/react-tree-grid/performance)
- [Keyboard shortcuts in Cubit Estimating](https://bsoft.zendesk.com/hc/en-us/articles/360000640935-Keyboard-and-Mouse-Shortcuts-in-Cubit-Estimating)
- [Iterative Design -- The Decision Lab](https://thedecisionlab.com/reference-guide/design/iterative-design)
- [How Feedback Loops Improve Collaborative Design](https://developerux.com/2025/05/28/how-feedback-loops-improve-collaborative-design/)
- [Best Residential Construction Estimating Software 2026](https://www.workyard.com/compare/residential-construction-estimating-software)
- [Top Construction Estimating Software 2026](https://www.getclue.com/blog/top-construction-estimating-software)
