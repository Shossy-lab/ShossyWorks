# Design System Component Wrappers -- Research

**Cluster:** 4 (Design System Component Wrappers)
**Date:** 2026-04-09
**Sources:** DESIGN-SYSTEM.md, component-architecture-analysis.md, design-ux-analysis.md, comprehensive-analysis.md, Radix UI docs, Linear design analysis, AI slop escape guides

---

## 1. Wrapping Radix UI Primitives for the ShossyWorks Design System

### 1.1 The Wrapping Strategy

Radix UI primitives are headless -- they provide accessibility (focus traps, ARIA attributes, keyboard navigation, screen reader announcements) and behavioral logic (open/close state, positioning, dismiss-on-outside-click) with zero styling opinions. The wrapping strategy applies the ShossyWorks design system at a single enforcement layer.

**The pattern has three rules:**

1. **One wrapper file per Radix primitive.** Each file in `src/components/shared/` imports from `@radix-ui/react-*` and re-exports styled components. Feature code never imports from `@radix-ui/*` directly.

2. **All visual properties come from CSS custom properties.** Colors use `var(--color-*)`, spacing uses `var(--space-*)`, shadows use `var(--shadow-*)`. Zero hardcoded values, zero Tailwind color classes.

3. **Shape rules are enforced at the wrapper level.** Dialog/dropdown/popover content gets `rounded-none` (sharp corners). Buttons within wrappers get `rounded-full` (pill shape). This is the single place where shape decisions are made.

### 1.2 Concrete Wrapper Pattern

```typescript
// src/components/shared/dialog.tsx
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { forwardRef } from 'react';

import type { ComponentPropsWithoutRef, ElementRef } from 'react';

// Re-export behavioral parts unchanged
export const DialogRoot = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

// Style the overlay
export const DialogOverlay = forwardRef<
  ElementRef<typeof DialogPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className = '', ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={`fixed inset-0 z-50 bg-[var(--color-bg-inverse)]/40
      data-[state=open]:animate-in data-[state=open]:fade-in-0
      data-[state=closed]:animate-out data-[state=closed]:fade-out-0
      ${className}`}
    {...props}
  />
));
DialogOverlay.displayName = 'DialogOverlay';

// Style the content panel
export const DialogContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ children, className = '', ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={`fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2
        w-full max-w-lg
        border border-[var(--color-border)] bg-[var(--color-surface)]
        p-[var(--space-6)] shadow-[var(--shadow-lg)]
        data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95
        data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95
        ${className}`}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = 'DialogContent';

// Styled title
export const DialogTitle = forwardRef<
  ElementRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className = '', ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={`text-lg font-semibold text-[var(--color-text-primary)] ${className}`}
    {...props}
  />
));
DialogTitle.displayName = 'DialogTitle';

// Styled description
export const DialogDescription = forwardRef<
  ElementRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className = '', ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={`text-sm text-[var(--color-text-secondary)] mt-[var(--space-2)] ${className}`}
    {...props}
  />
));
DialogDescription.displayName = 'DialogDescription';
```

**Key observations about this pattern:**

- `forwardRef` preserves Radix's ref forwarding for focus management
- `className` prop allows per-instance overrides while maintaining defaults
- `displayName` is set for React DevTools clarity
- The overlay is rendered inside `DialogContent` via Portal -- this keeps the usage API simple for consumers
- NO `rounded-*` classes except `rounded-none` implicit (no radius = sharp corners)
- ALL colors reference design tokens

### 1.3 Radix data-[state] Integration with Tailwind

Radix exposes component state via `data-state` attributes. Tailwind v4 supports these natively:

| Radix Attribute | Tailwind Selector | Use |
|----------------|-------------------|-----|
| `data-state="open"` | `data-[state=open]:` | Dialog/dropdown open animations |
| `data-state="closed"` | `data-[state=closed]:` | Close/exit animations |
| `data-state="checked"` | `data-[state=checked]:` | Toggle active state |
| `data-state="unchecked"` | `data-[state=unchecked]:` | Toggle inactive state |
| `data-state="active"` | `data-[state=active]:` | Tab active state |
| `data-disabled` | `data-[disabled]:` | Disabled styling |
| `data-highlighted` | `data-[highlighted]:` | Menu item hover/focus |
| `data-side="top/bottom/left/right"` | `data-[side=bottom]:` | Popover/tooltip positioning |
| `data-align="start/center/end"` | `data-[align=start]:` | Alignment-specific styles |

**Example -- DropdownMenu with data-state styling:**

```typescript
// src/components/shared/dropdown-menu.tsx
export const DropdownMenuContent = forwardRef<...>(({ className = '', ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={4}
      className={`z-50 min-w-[8rem] overflow-hidden
        border border-[var(--color-border)] bg-[var(--color-surface)]
        p-[var(--space-1)] shadow-[var(--shadow-md)]
        data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95
        data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95
        data-[side=bottom]:slide-in-from-top-2
        data-[side=left]:slide-in-from-right-2
        data-[side=right]:slide-in-from-left-2
        data-[side=top]:slide-in-from-bottom-2
        ${className}`}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));

export const DropdownMenuItem = forwardRef<...>(({ className = '', ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={`relative flex cursor-default select-none items-center
      px-[var(--space-3)] py-[var(--space-2)]
      text-sm text-[var(--color-text-primary)]
      outline-none
      data-[highlighted]:bg-[var(--color-surface-active)]
      data-[highlighted]:text-[var(--color-text-primary)]
      data-[disabled]:pointer-events-none data-[disabled]:opacity-50
      ${className}`}
    {...props}
  />
));
```

### 1.4 CSS Custom Properties Exposed by Radix

Several Radix primitives expose CSS custom properties for animation and positioning:

| Primitive | CSS Variable | Purpose |
|-----------|-------------|---------|
| Collapsible | `--radix-collapsible-content-height` | Animate expand/collapse height |
| Collapsible | `--radix-collapsible-content-width` | Animate expand/collapse width |
| Accordion | `--radix-accordion-content-height` | Same for accordion panels |
| Toast | `--radix-toast-swipe-move-x` | Swipe gesture distance (horizontal) |
| Toast | `--radix-toast-swipe-move-y` | Swipe gesture distance (vertical) |
| Toast | `--radix-toast-swipe-end-x` | Final swipe position |
| Popover | (via `sideOffset`, `alignOffset`) | Positioning offsets |

These are critical for smooth animations. For example, tree group expand/collapse can use `--radix-collapsible-content-height` for height transitions:

```css
.collapsible-content {
  overflow: hidden;
}
.collapsible-content[data-state="open"] {
  animation: slideDown 200ms ease;
}
.collapsible-content[data-state="closed"] {
  animation: slideUp 200ms ease;
}
@keyframes slideDown {
  from { height: 0; }
  to { height: var(--radix-collapsible-content-height); }
}
@keyframes slideUp {
  from { height: var(--radix-collapsible-content-height); }
  to { height: 0; }
}
```

---

## 2. Optimal File Structure for the Component Library

### 2.1 Directory Architecture

```
src/components/
  shared/                    # Layer 0: Design system enforcement boundary
    dialog.tsx               # Radix Dialog wrapper (~80 lines)
    alert-dialog.tsx         # Radix AlertDialog wrapper (~70 lines)
    dropdown-menu.tsx        # Radix DropdownMenu wrapper (~100 lines)
    context-menu.tsx         # Radix ContextMenu wrapper (~90 lines)
    select.tsx               # Radix Select wrapper (~120 lines)
    popover.tsx              # Radix Popover wrapper (~60 lines)
    tooltip.tsx              # Radix Tooltip wrapper (~50 lines)
    toast.tsx                # Radix Toast wrapper (~100 lines)
    tabs.tsx                 # Radix Tabs wrapper (~60 lines)
    collapsible.tsx          # Radix Collapsible wrapper (~40 lines)
    toggle.tsx               # Radix Toggle wrapper (~30 lines)
    button.tsx               # Button variants (primary/secondary/ghost/icon)
    badge.tsx                # Status badge (pill shape)
    text-field.tsx           # Text input primitive
    number-field.tsx         # Number input with formatting
    money-field.tsx          # Currency input ($ prefix, 2dp display)
    rate-field.tsx           # Percentage input (% suffix)
    select-field.tsx         # Labeled select (composes Select wrapper)
    textarea.tsx             # Auto-resize text area
    checkbox.tsx             # Checkbox field
    skeleton.tsx             # Loading skeleton
    empty-state.tsx          # "No data" state
    error-state.tsx          # Error display
    skip-link.tsx            # (exists)

  nav/                       # Layer 1: Navigation
    sidebar.tsx              # (exists, extend with icons + context items)
    user-menu.tsx            # (exists)
    breadcrumbs.tsx          # URL-aware breadcrumbs

  layout/                   # Layer 1: Page structure
    page-header.tsx          # Title + action buttons
    split-pane.tsx           # Resizable tree/detail split
    panel.tsx                # Bordered content panel
    status-bar.tsx           # Bottom status strip

  estimate/                  # Layer 2: Feature (co-located)
    tree/                    # Tree component system
      estimate-tree-container.tsx
      virtual-tree-renderer.tsx
      tree-row.tsx
      group-row.tsx
      assembly-row.tsx
      item-row.tsx
      tree-toolbar.tsx
      tree-status-bar.tsx
      hooks/
        use-estimate-tree-reducer.ts
        use-tree-keyboard.ts
      utils/
        flatten-tree.ts
    editors/                 # Node editing
      node-detail-panel.tsx
      item-editor.tsx
      assembly-editor.tsx
      group-editor.tsx
    snapshot/                # Snapshot feature
    catalog/                 # Catalog feature

  project/                   # Layer 2: Feature
    project-list.tsx
    project-card.tsx
    project-create-dialog.tsx

  settings/                  # Layer 2: Feature
    company-settings-form.tsx
    user-preferences-form.tsx
```

### 2.2 Why This Structure Works

**Layered dependency direction (never upward):**
```
Feature components (estimate/, project/, settings/)
  -> Layout components (layout/)
  -> Navigation components (nav/)
  -> Shared/design-system components (shared/)
  -> Radix UI primitives (@radix-ui/react-*)
```

Feature components compose from shared components. Shared components never import from feature directories. This is the enforcement boundary: if a feature needs a styled dialog, it imports `DialogContent` from `shared/dialog.tsx`, never from `@radix-ui/react-dialog`.

**No barrel files (index.ts).** Every import specifies the exact file. This keeps tree-shaking reliable, makes imports explicit, and avoids circular dependency issues that barrel files can create.

**Co-location by feature.** The estimate tree system lives together: tree rendering, editors, hooks, and utilities are physically adjacent. A developer working on the tree never navigates outside `src/components/estimate/`.

**The 300-line rule.** Every file targets under 300 lines. When exceeded, extract into the same directory: sub-components as siblings, hooks into `hooks/`, utilities into `utils/`.

---

## 3. Preventing shadcn/ui-Style Copy-Paste Drift

### 3.1 The Problem with shadcn/ui for This Project

shadcn/ui uses a copy-paste model: components are scaffolded into your project, becoming your code. This creates three risks:

1. **Styling drift.** Each component file has hardcoded Tailwind classes. Without discipline, developers (or AI agents) modify individual components inconsistently. One dialog gets `rounded-lg`, another gets `rounded-md`, a third stays `rounded-none`. Over time, visual coherence degrades.

2. **Default styling fights the design system.** shadcn/ui defaults to `rounded-md` on containers, `bg-background` / `text-foreground` color tokens that do not match the ShossyWorks token vocabulary, and spacing values that do not align with the `--space-*` scale. Every component would need rework.

3. **Upgrade path is manual.** When shadcn/ui ships a fix or enhancement, you must manually apply it to your copy. With Radix wrappers, you upgrade the `@radix-ui/*` package and the wrapper stays unchanged (accessibility and behavioral improvements come for free).

### 3.2 The Anti-Drift Architecture

The wrapper layer prevents drift through three mechanisms:

**Mechanism 1: Single source of truth for visual styling.**

Each Radix wrapper file is THE place where visual properties are defined for that component type. Feature components compose these wrappers -- they add content, not styling.

```typescript
// CORRECT: Feature uses the wrapper
import { DialogRoot, DialogContent, DialogTitle } from '@/components/shared/dialog';

function CreateProjectDialog() {
  return (
    <DialogRoot>
      <DialogContent>
        <DialogTitle>Create Project</DialogTitle>
        {/* feature-specific form content */}
      </DialogContent>
    </DialogRoot>
  );
}

// WRONG: Feature imports Radix directly and styles it
import * as Dialog from '@radix-ui/react-dialog';

function CreateProjectDialog() {
  return (
    <Dialog.Root>
      <Dialog.Content className="rounded-lg bg-white p-6 shadow-xl">
        {/* BAD: hardcoded styles, bypassing design system */}
      </Dialog.Content>
    </Dialog.Root>
  );
}
```

**Mechanism 2: Lint enforcement via grep.**

A design system check script (already proposed in the comprehensive analysis) scans all `.tsx` files in feature directories for forbidden patterns:

```bash
#!/bin/bash
# scripts/design-system-check.sh
VIOLATIONS=0

# Direct Radix imports outside shared/
grep -r "from '@radix-ui/" src/components/ --include="*.tsx" \
  | grep -v "src/components/shared/" && VIOLATIONS=$((VIOLATIONS+1))

# Forbidden border-radius classes
grep -rn "rounded-sm\|rounded-md\|rounded-lg\|rounded-xl" src/ \
  --include="*.tsx" && VIOLATIONS=$((VIOLATIONS+1))

# Direct Tailwind color classes
grep -rn "bg-white\|bg-gray-\|text-gray-\|bg-blue-\|text-blue-\|bg-red-\|text-red-" src/ \
  --include="*.tsx" && VIOLATIONS=$((VIOLATIONS+1))

# Hardcoded hex colors in className
grep -rn 'className=.*#[0-9a-fA-F]\{3,6\}' src/ \
  --include="*.tsx" && VIOLATIONS=$((VIOLATIONS+1))

[ $VIOLATIONS -eq 0 ] && echo "PASS: Design system compliant" || echo "FAIL: $VIOLATIONS violation categories found"
```

**Mechanism 3: Contract enforcement.**

A `shared-components.contract.md` contract governs the wrapper layer:

- All Radix imports go through wrappers in `shared/`
- Zero direct `@radix-ui/*` imports in feature components
- Every wrapper uses only CSS custom properties for visual values
- Shape rules: `rounded-none` for containers, `rounded-full` for buttons/badges
- The wrapper layer is reviewed as a batch at CP-1 before feature work begins

### 3.3 Versioning the Wrapper Layer

Unlike shadcn/ui where component versions are implicit (whatever you copied), the Radix wrapper approach has explicit versioning:

- Radix packages are npm dependencies with version ranges in `package.json`
- Upgrading Radix (`npm update @radix-ui/react-dialog`) immediately applies accessibility and behavioral fixes to all dialogs in the app
- The wrapper layer only needs updating if Radix changes its API (rare -- Radix maintains backward compatibility)
- A failing test after a Radix upgrade pinpoints the exact wrapper that needs attention

---

## 4. Radix Primitives Needed for Phase 1B

### 4.1 Tier 1: Required for Phase 1B-0 (Foundation)

| Primitive | Package | Phase 1B Use Cases | Bundle Size |
|-----------|---------|-------------------|-------------|
| **Dialog** | `@radix-ui/react-dialog` | Create project, create estimate, edit settings modals | ~12KB |
| **AlertDialog** | `@radix-ui/react-alert-dialog` | Delete confirmation for nodes, projects, estimates | ~10KB |
| **DropdownMenu** | `@radix-ui/react-dropdown-menu` | Node context menu (right-click), action menus in toolbar | ~15KB |
| **Select** | `@radix-ui/react-select` | Unit selector, cost code picker, status selector, phase selector | ~18KB |
| **Tooltip** | `@radix-ui/react-tooltip` | Field help text, toolbar button descriptions, keyboard shortcut hints | ~8KB |
| **Toast** | `@radix-ui/react-toast` | Save confirmation, error notifications, undo feedback | ~10KB |
| **Tabs** | `@radix-ui/react-tabs` | Node detail panel sections (Details/Notes/Options/History), settings sections | ~6KB |
| **Collapsible** | `@radix-ui/react-collapsible` | Tree expand/collapse behavior (accessible), sidebar sections | ~5KB |
| **Toggle** | `@radix-ui/react-toggle` | Flag node toggle, visibility toggle, boolean field toggles | ~4KB |

**Total: ~88KB minified (tree-shakeable -- only imported primitives are bundled).**

### 4.2 Tier 2: Likely Needed Mid-Phase 1B

| Primitive | Package | Use Case | When |
|-----------|---------|----------|------|
| **Popover** | `@radix-ui/react-popover` | Node quick-info hover, filter controls, search results panel | 1B-5 (Search) |
| **ContextMenu** | `@radix-ui/react-context-menu` | Alternative to DropdownMenu for right-click (native context menu behavior) | 1B-0.4 |

### 4.3 Tier 3: Phase 2+ (Explicitly Deferred)

| Primitive | Use Case | Why Defer |
|-----------|----------|-----------|
| **NavigationMenu** | Complex nav with submenus | Sidebar is custom, no need |
| **Accordion** | Collapsible sections | Collapsible handles tree; Tabs handle detail panel |
| **Slider** | Percentage/rate adjustment via drag | Number inputs suffice for Phase 1B |
| **Switch** | On/off toggle alternative | Toggle primitive covers this |
| **Menubar** | Menu bar (File/Edit/View) | Not the right UI pattern for this app |
| **Command (cmdk)** | Command palette (Ctrl+K) | Phase 2+ feature |

### 4.4 Toast Provider Architecture

The Toast primitive requires a `ToastProvider` wrapping the application. It also needs a `ToastViewport` positioned in the layout. Given the sidebar + tree + detail panel layout:

```
+--sidebar--+--tree-panel--+--detail-panel--+
|            |              |                |
|            |              |                |
|            |              |    [TOAST]     | <-- bottom-right of viewport
+------------+--------------+----------------+
```

**Recommended toast position:** Bottom-right of the full viewport (not relative to a panel). This avoids the toast overlapping tree rows during editing. The viewport uses `fixed` positioning with `bottom-[var(--space-4)] right-[var(--space-4)]`.

```typescript
// src/components/shared/toast.tsx
export function ToastViewport() {
  return (
    <ToastPrimitive.Viewport
      className="fixed bottom-[var(--space-4)] right-[var(--space-4)] z-[100]
        flex max-h-screen w-[380px] flex-col gap-[var(--space-2)]"
    />
  );
}
```

The `ToastProvider` wraps the app in the root layout:

```typescript
// src/app/(protected)/layout.tsx
import { ToastProvider, ToastViewport } from '@/components/shared/toast';

export default function ProtectedLayout({ children }) {
  return (
    <ToastProvider swipeDirection="right" duration={4000}>
      <div className="flex h-screen">
        <Sidebar />
        <main className="flex-1">{children}</main>
      </div>
      <ToastViewport />
    </ToastProvider>
  );
}
```

---

## 5. Design Token Integration with Radix Primitive Styling

### 5.1 The Token-to-Radix Pipeline

```
DESIGN-SYSTEM.md (source of truth)
  -> globals.css :root {} (CSS custom properties)
    -> globals.css @theme {} (Tailwind utility registration)
      -> Radix wrappers (Tailwind classes using CSS vars)
        -> Feature components (compose wrappers, never style directly)
```

Every visual property flows through this pipeline. At no point does a component file contain a hardcoded color, spacing value, or shadow.

### 5.2 Token Mapping for Common Radix States

| Radix State | Visual Treatment | Token Reference |
|------------|------------------|-----------------|
| Default surface | White background | `bg-[var(--color-surface)]` |
| Hover | Subtle background shift | `bg-[var(--color-surface-hover)]` |
| Active / Pressed | Slightly darker | `bg-[var(--color-surface-active)]` |
| Highlighted (menu item) | Active surface | `data-[highlighted]:bg-[var(--color-surface-active)]` |
| Disabled | Reduced opacity | `data-[disabled]:opacity-50` |
| Focus visible | Strong border | `focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]` |
| Open overlay | Dim background | `bg-[var(--color-bg-inverse)]/40` |
| Selected tab | Primary text + accent border | `data-[state=active]:text-[var(--color-text-primary)] data-[state=active]:border-b-2 data-[state=active]:border-[var(--color-text-primary)]` |
| Checked toggle | Inverse colors | `data-[state=on]:bg-[var(--color-interactive)] data-[state=on]:text-[var(--color-interactive-text)]` |
| Error state | Semantic red | `border-[var(--color-error)] text-[var(--color-error)]` |
| Success feedback | Semantic green | `bg-[var(--color-success-bg)] text-[var(--color-success)]` |

### 5.3 Animation Tokens

Radix transitions should use the existing duration tokens:

| Animation | Duration Token | Easing | When |
|-----------|---------------|--------|------|
| Dialog open/close | `--duration-normal` (200ms) | ease-out / ease-in | Modal appearance |
| Dropdown open | `--duration-fast` (100ms) | ease-out | Menu appearance (should feel instant) |
| Tooltip show | `--duration-normal` (200ms) | ease | After hover delay (~700ms) |
| Toast enter | `--duration-normal` (200ms) | ease-out | Slide in from right |
| Toast exit | `--duration-fast` (100ms) | ease-in | Swipe or auto-dismiss |
| Collapsible expand | `--duration-normal` (200ms) | ease | Tree group expand |
| Collapsible collapse | `--duration-fast` (100ms) | ease | Tree group collapse (faster than expand) |
| Tab switch | None (instant) | -- | Tab content swap (no animation) |

**Asymmetric timing:** Expand animations should be slightly slower than collapse. Expansion reveals content (user needs to register new elements); collapse removes content (user already decided to hide it). This is the Linear pattern.

### 5.4 Focus Management Tokens

Radix handles focus trapping and restoration automatically for Dialog, AlertDialog, and DropdownMenu. The visual focus indicator uses design tokens:

```css
/* Applied via Tailwind on all interactive elements */
focus-visible:outline-none
focus-visible:ring-2
focus-visible:ring-[var(--color-border-focus)]
focus-visible:ring-offset-0
```

**No `ring-offset` needed** because the design uses sharp corners -- there is no rounded corner to create a gap between the focus ring and the element edge. The ring sits flush against the element border.

### 5.5 Tokens That Need Adding

The current token system covers colors, spacing, typography, borders, shadows, and transitions. For Radix integration, these additional tokens should be added to `globals.css` and `DESIGN-SYSTEM.md`:

| Token | Value | Purpose |
|-------|-------|---------|
| `--overlay-opacity` | `0.4` | Dialog/alert overlay darkness |
| `--toast-width` | `380px` | Toast notification width |
| `--dropdown-min-width` | `8rem` | Dropdown menu minimum width |
| `--tooltip-max-width` | `16rem` | Tooltip maximum width |
| `--focus-ring-width` | `2px` | Focus indicator width |
| `--focus-ring-color` | `var(--color-border-focus)` | Focus indicator color |
| `--z-dropdown` | `50` | Z-index for dropdown/popover |
| `--z-dialog` | `50` | Z-index for dialog overlay/content |
| `--z-toast` | `100` | Z-index for toast (above everything) |
| `--z-tooltip` | `50` | Z-index for tooltip |

---

## 6. Making the Design System Feel DISTINCTIVE (Not Generic)

### 6.1 What Makes UI Look Like "AI Slop"

AI-generated interfaces converge on a recognizable aesthetic. These are the telltale signs:

1. **Universal `rounded-lg`/`rounded-xl`.** Every card, every input, every button, every dropdown -- all the same intermediate radius. The visual equivalent of a participation trophy.

2. **Tailwind default colors used directly.** `bg-gray-50`, `bg-blue-600`, `text-gray-900` without any semantic mapping. Results in a "template" feel.

3. **Inter font at default weight.** Inter is a fine font, but at Regular (400) weight throughout, it is the single most common AI-generated font choice.

4. **Even spacing everywhere.** `p-4` on everything. No rhythm, no hierarchy. Everything feels equidistant and equally unimportant.

5. **Decorative gradients and glows.** Purple-to-blue hero gradients, glowing borders, pulse animations on buttons. Visual noise disguised as design.

6. **No density awareness.** Giant padding, low data per screen. Works for marketing pages, death for productivity tools.

7. **Identical hover states.** Every interactive element gets `hover:bg-gray-100`. No personality in interaction.

### 6.2 What Distinguishes High-Quality Apps

The apps that feel hand-crafted (Linear, Figma, Vercel, Raycast, Notion) share specific patterns:

**A. Deliberate shape language with commitment.**

Linear uses sharp corners on almost everything. Not "sometimes rounded, sometimes not" -- always sharp. The commitment to a single shape vocabulary is what creates visual identity. ShossyWorks already has this: sharp corners on containers, pill shape on buttons. The design system simply needs to enforce it without exception.

**B. Typographic hierarchy through weight, not just size.**

Instead of five font sizes all at Regular weight, high-quality apps use weight as the primary differentiator:

| Content Type | Size | Weight | Creates |
|-------------|------|--------|---------|
| Page title | text-2xl | 600 (semibold) | Anchoring |
| Section header | text-lg | 600 (semibold) | Grouping |
| Row label | text-sm | 500 (medium) | Readability |
| Data value | text-sm (mono for numbers) | 400 (normal) | Scanning |
| Metadata | text-xs | 400 (normal) + secondary color | De-emphasis |
| Helper text | text-xs | 400 (normal) + tertiary color | Minimal presence |

The weight ladder (400 -> 500 -> 600) does more visual work than size changes. This is how Inter becomes distinctive: not through the font choice, but through disciplined weight usage.

**C. Whitespace as information architecture.**

Not "more whitespace = better." Whitespace communicates grouping:

- **0 gap between sibling rows** = they belong together (table rows)
- **space-4 between groups** = new section of related items
- **space-8 to space-12 between page regions** = distinct functional areas

This rhythm is more important than any individual spacing value. It tells the user "these things are related" without labels or borders.

**D. Color restraint with semantic meaning.**

The ShossyWorks palette is almost entirely monochrome (black/white/gray). Color appears ONLY for semantic meaning:

| Color | Meaning | Never Used For |
|-------|---------|---------------|
| Green (`--color-success`) | Positive outcome, saved, complete | Decoration, branding |
| Red (`--color-error`) | Error, destructive action, warning | Attention-grabbing buttons |
| Yellow (`--color-warning`) | Caution, pending, needs attention | Backgrounds or fills |
| Blue (`--color-info`) | Informational, links (used sparingly) | Primary actions |

When color is scarce, each color instance carries weight. A red border on an item is immediately alarming because nothing else is red. Compare this to apps where red, blue, green, and purple are all used decoratively -- the user learns to ignore color.

**E. Functional motion, not decorative motion.**

| Animate | Do Not Animate |
|---------|---------------|
| State transitions (open/close, expand/collapse) | Page navigation |
| Feedback signals (save confirmed, error shake) | Data loading (no skeleton shimmer -- use static skeletons) |
| Spatial orientation (where did this come from?) | Hover glows, pulse effects, parallax |

The animation philosophy is: "motion confirms actions." A dialog sliding in confirms "you opened something." A toast sliding in from the right confirms "something happened." A tree group expanding confirms "you revealed children." Nothing else moves.

**F. Data density appropriate to the domain.**

Construction estimating is a data-dense domain. The UI should respect this by offering density modes and defaulting to a compact-enough density that power users can see 20-30 rows without scrolling.

The three density modes proposed in the design-ux-analysis:
- `--density-compact`: 24px row height, 8px padding
- `--density-default`: 32px row height, 12px padding
- `--density-comfortable`: 40px row height, 16px padding

These should be implemented as CSS custom properties set on the tree container, allowing the user to switch without reloading.

### 6.3 ShossyWorks-Specific Visual Identity Markers

Beyond the general "avoid AI slop" advice, these specific choices create the ShossyWorks identity:

1. **The sharp/pill binary.** No intermediate radii. This is the single strongest visual differentiator. Every card, every input, every panel -- razor sharp. Every button, every badge, every tag -- fully rounded pill. No exceptions.

2. **Left accent borders on active items.** The sidebar already uses `border-l-2 border-[var(--color-text-primary)]` for active nav items. Extend this to the tree: the selected row gets a left accent border. This creates a consistent "where am I" indicator across the entire app.

3. **Monospace numbers in data contexts.** Cost values, quantities, rates -- all rendered in `--font-mono` (JetBrains Mono). This creates visual alignment in columns and signals "this is data, not prose." The contrast between Inter for labels and JetBrains Mono for numbers is a subtle but powerful identity marker.

4. **Weight-driven hierarchy.** Font weight does more work than font size. The weight ladder (400/500/600/700) is strictly assigned to content types. No component should use Bold (700) except page titles. No component should use Regular (400) for labels (always Medium 500).

5. **Static loading skeletons.** No shimmer animation on loading states. Static rectangles with `bg-[var(--color-bg-secondary)]` matching content shapes. This is calmer and more intentional than the ubiquitous shimmer effect. Loading should feel like "content is coming" not "look at this animation."

6. **One-pixel borders everywhere, zero shadows by default.** Borders (`1px solid var(--color-border)`) define structure. Shadows are reserved for elevated elements ONLY: dialogs, dropdowns, tooltips, toasts. If an element is inline (cards, panels, sections), it gets a border, never a shadow. This creates a clear visual hierarchy: bordered = inline, shadowed = floating.

---

## 7. Complete Wrapper Specifications for Phase 1B

### 7.1 Each Wrapper at a Glance

| Wrapper | File | Key Props | Shape | Animation |
|---------|------|-----------|-------|-----------|
| Dialog | `shared/dialog.tsx` | `open`, `onOpenChange` | Sharp corners | 200ms fade + zoom |
| AlertDialog | `shared/alert-dialog.tsx` | `open`, `onOpenChange` | Sharp corners | 200ms fade + zoom |
| DropdownMenu | `shared/dropdown-menu.tsx` | `open`, `onOpenChange` | Sharp corners | 100ms fade + zoom |
| ContextMenu | `shared/context-menu.tsx` | (triggered by right-click) | Sharp corners | 100ms fade |
| Select | `shared/select.tsx` | `value`, `onValueChange` | Sharp corners (trigger + content) | 100ms slide |
| Popover | `shared/popover.tsx` | `open`, `onOpenChange` | Sharp corners | 100ms fade |
| Tooltip | `shared/tooltip.tsx` | (hover-triggered, 700ms delay) | Sharp corners | 200ms fade |
| Toast | `shared/toast.tsx` | `open`, `onOpenChange`, `variant` | Sharp corners | 200ms slide-in, 100ms slide-out |
| Tabs | `shared/tabs.tsx` | `value`, `onValueChange` | Sharp corners, bottom border accent | None (instant switch) |
| Collapsible | `shared/collapsible.tsx` | `open`, `onOpenChange` | N/A (content wrapper) | 200ms height |
| Toggle | `shared/toggle.tsx` | `pressed`, `onPressedChange` | Pill shape (it is a button variant) | None (instant) |

### 7.2 Toast Variant System

Toasts need semantic variants matching the color system:

```typescript
type ToastVariant = 'default' | 'success' | 'error' | 'warning' | 'info';

const variantStyles: Record<ToastVariant, string> = {
  default: 'border-[var(--color-border)] bg-[var(--color-surface)]',
  success: 'border-[var(--color-success)] bg-[var(--color-success-bg)]',
  error:   'border-[var(--color-error)] bg-[var(--color-error-bg)]',
  warning: 'border-[var(--color-warning)] bg-[var(--color-warning-bg)]',
  info:    'border-[var(--color-info)] bg-[var(--color-info-bg)]',
};
```

### 7.3 Tooltip Provider Configuration

Radix Tooltip requires a `TooltipProvider` wrapping the application (similar to Toast). Configuration:

```typescript
// In the root layout
<TooltipProvider delayDuration={700} skipDelayDuration={300}>
  {children}
</TooltipProvider>
```

- `delayDuration={700}` -- tooltips appear after 700ms hover (not immediately -- avoids visual noise during normal mouse movement)
- `skipDelayDuration={300}` -- after dismissing one tooltip, the next appears faster (user is actively exploring)

### 7.4 Select Implementation Notes

Radix Select is the most complex wrapper because it has many sub-parts (Trigger, Value, Content, Viewport, Item, ItemText, ItemIndicator, ScrollUpButton, ScrollDownButton, Separator, Group, Label). The wrapper should simplify this:

```typescript
// Simplified API for feature consumers:
<SelectField
  label="Unit of Measure"
  value={unit}
  onValueChange={setUnit}
  placeholder="Select unit..."
  error={errors.unit}
>
  <SelectItem value="sf">SF</SelectItem>
  <SelectItem value="lf">LF</SelectItem>
  <SelectItem value="cy">CY</SelectItem>
  <SelectSeparator />
  <SelectItem value="ea">EA</SelectItem>
  <SelectItem value="ls">LS</SelectItem>
</SelectField>
```

The wrapper handles: trigger styling (sharp corners, border, correct typography), content positioning, scroll buttons, keyboard navigation, and checked indicator styling. The consumer provides only the semantic content.

---

## 8. Implementation Checklist

### Phase 1B-0.0 Delivery (Shared Component Layer)

Build in this order (each builds on the previous):

1. **Button** -- foundation for all interactive elements (primary/secondary/ghost/icon variants)
2. **Badge** -- simple pill component for status indicators
3. **TextField, NumberField, MoneyField, RateField, TextArea** -- field primitives used by all editors
4. **Tooltip + TooltipProvider** -- add to root layout, used by toolbar buttons and field help
5. **Dialog + AlertDialog** -- modals for create/edit/delete confirmations
6. **DropdownMenu + ContextMenu** -- action menus and right-click menus
7. **Select + SelectField** -- dropdowns for unit, status, cost code, phase selection
8. **Toast + ToastProvider + ToastViewport** -- notification system, add to root layout
9. **Tabs** -- detail panel sections
10. **Collapsible** -- tree expand/collapse (may be used directly or as reference for custom tree animation)
11. **Toggle** -- flag/visibility toggles in node editors
12. **Skeleton, EmptyState, ErrorState** -- feedback components

### Verification Script

```bash
#!/bin/bash
# Verify shared component layer is complete and compliant

EXPECTED_FILES=(
  "src/components/shared/button.tsx"
  "src/components/shared/badge.tsx"
  "src/components/shared/text-field.tsx"
  "src/components/shared/number-field.tsx"
  "src/components/shared/money-field.tsx"
  "src/components/shared/rate-field.tsx"
  "src/components/shared/textarea.tsx"
  "src/components/shared/dialog.tsx"
  "src/components/shared/alert-dialog.tsx"
  "src/components/shared/dropdown-menu.tsx"
  "src/components/shared/select.tsx"
  "src/components/shared/select-field.tsx"
  "src/components/shared/popover.tsx"
  "src/components/shared/tooltip.tsx"
  "src/components/shared/toast.tsx"
  "src/components/shared/tabs.tsx"
  "src/components/shared/collapsible.tsx"
  "src/components/shared/toggle.tsx"
  "src/components/shared/skeleton.tsx"
  "src/components/shared/empty-state.tsx"
  "src/components/shared/error-state.tsx"
)

PASS=0; FAIL=0
for f in "${EXPECTED_FILES[@]}"; do
  if [ -f "$f" ]; then
    PASS=$((PASS+1))
  else
    echo "MISSING: $f"
    FAIL=$((FAIL+1))
  fi
done

echo "Files: $PASS present, $FAIL missing"

# Check no direct Radix imports outside shared/
RADIX_VIOLATIONS=$(grep -r "from '@radix-ui/" src/components/ --include="*.tsx" \
  | grep -v "src/components/shared/" | wc -l)
echo "Direct Radix imports outside shared/: $RADIX_VIOLATIONS (should be 0)"

# Check no forbidden border-radius
RADIUS_VIOLATIONS=$(grep -rn "rounded-sm\|rounded-md\|rounded-lg\|rounded-xl" src/ \
  --include="*.tsx" | wc -l)
echo "Forbidden border-radius classes: $RADIUS_VIOLATIONS (should be 0)"

# Check no direct Tailwind color classes
COLOR_VIOLATIONS=$(grep -rn "bg-white\|bg-gray-\|text-gray-\|bg-blue-\|text-blue-" src/ \
  --include="*.tsx" | wc -l)
echo "Direct Tailwind color classes: $COLOR_VIOLATIONS (should be 0)"

[ $FAIL -eq 0 ] && [ $RADIX_VIOLATIONS -eq 0 ] && [ $RADIUS_VIOLATIONS -eq 0 ] && [ $COLOR_VIOLATIONS -eq 0 ] \
  && echo "OVERALL: PASS" || echo "OVERALL: FAIL"
```

---

## Research Sources

- [Radix Primitives Styling Guide](https://www.radix-ui.com/primitives/docs/guides/styling)
- [Radix Dialog Documentation](https://www.radix-ui.com/primitives/docs/components/dialog)
- [Radix DropdownMenu Documentation](https://www.radix-ui.com/primitives/docs/components/dropdown-menu)
- [Radix Toast Documentation](https://www.radix-ui.com/primitives/docs/components/toast)
- [Radix Alert Dialog Documentation](https://www.radix-ui.com/primitives/docs/components/alert-dialog)
- [Styling Radix UI with Tailwind CSS](https://blog.makerx.com.au/styling-radix-ui-components-using-tailwind-css/)
- [Radix + Tailwind Discussion](https://github.com/radix-ui/primitives/discussions/1000)
- [Radix Primitives GitHub](https://github.com/radix-ui/primitives)
- [Radix Component Architecture (DeepWiki)](https://deepwiki.com/radix-ui/primitives/2-component-architecture)
- [shadcn/ui vs Base UI vs Radix 2026](https://www.pkgpulse.com/blog/shadcn-ui-vs-base-ui-vs-radix-components-2026)
- [React UI Libraries 2025 Comparison](https://makersden.io/blog/react-ui-libs-2025-comparing-shadcn-radix-mantine-mui-chakra)
- [Difference Between Radix and shadcn-ui (WorkOS)](https://workos.com/blog/what-is-the-difference-between-radix-and-shadcn-ui)
- [shadcn/ui vs Radix Key Differences](https://www.swhabitation.com/blogs/what-is-the-difference-between-radix-ui-and-shadcn)
- [Escape AI Slop Frontend Design Guide](https://techbytes.app/posts/escape-ai-slop-frontend-design-guide/)
- [Why Your AI Keeps Building the Same Purple Gradient Website](https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website)
- [Linear Design: The SaaS Design Trend](https://blog.logrocket.com/ux-design/linear-design/)
- [A Calmer Interface for a Product in Motion (Linear)](https://linear.app/now/behind-the-latest-design-refresh)
- [AI Slop Web Design Guide 2026](https://www.925studios.co/blog/ai-slop-web-design-guide)
- [Neubrutalism Web Design Trend](https://bejamas.com/blog/neubrutalism-web-design-trend)
- [Claude Frontend Design Skills Guide](https://techbytes.app/posts/claude-frontend-design-skills-guide/)
- [Best React Component Libraries 2026](https://designrevision.com/blog/best-react-component-libraries)
