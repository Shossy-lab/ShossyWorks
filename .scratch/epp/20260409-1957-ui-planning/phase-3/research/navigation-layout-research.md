# Navigation and Layout Architecture Research

**Cluster 8 -- Comprehensive Findings**
**Date:** 2026-04-09
**Status:** Research complete

---

## Question 1: Correct Next.js App Router Layout Nesting for a 5-Level Deep Route Structure

### The ShossyWorks Route Hierarchy

ShossyWorks requires a 5-level deep route structure for its core workflow:

```
Level 0: Root layout          layout.tsx          (html, body, fonts)
Level 1: Route group           (protected)/layout.tsx  (auth check, sidebar, header)
Level 2: Feature               projects/page.tsx       (project list)
Level 3: Dynamic segment       [projectId]/layout.tsx  (project context)
Level 4: Sub-feature            estimates/page.tsx      (estimate list)
Level 5: Dynamic sub-segment   [estimateId]/layout.tsx (estimate context)
  +-- page.tsx (THE TREE EDITOR)
  +-- settings/page.tsx
  +-- snapshots/[snapshotId]/page.tsx
```

### How Next.js App Router Handles This

Next.js App Router handles deep nesting natively and correctly. Key behaviors:

1. **Layouts nest automatically.** A `layout.tsx` at any folder level wraps all child routes via the `children` prop. No manual wiring needed.

2. **Partial rendering.** On navigation between sibling routes (e.g., from `/projects/abc/estimates/xyz` to `/projects/abc/estimates/xyz/settings`), only the innermost changed segment re-renders. The root layout, protected layout, project layout, and estimate layout all persist. This is the core value of nested layouts -- they never re-render during child navigation.

3. **Route groups do not add URL segments.** The `(protected)` and `(auth)` groups organize code without adding `/protected/` or `/auth/` to the URL. This is exactly right for ShossyWorks' three layout variants (protected, auth, client portal).

4. **Each layout can independently fetch data.** Layouts run as server components by default. Each layout in the chain can perform its own data fetch concurrently with other layouts. Next.js eagerly initiates layout data fetches in parallel.

### Recommended File Structure

```
src/app/
  layout.tsx                                    # L0: Root -- html, body, font, SkipLink
  page.tsx                                      # Redirect to /dashboard or /sign-in
  globals.css
  error.tsx / global-error.tsx / not-found.tsx

  (auth)/
    layout.tsx                                  # Centered card, no sidebar
    sign-in/page.tsx
    sign-up/page.tsx

  (protected)/
    layout.tsx                                  # Auth check, sidebar, header, breadcrumbs slot
    loading.tsx                                 # Generic skeleton (EXISTS)
    error.tsx                                   # Error boundary (EXISTS)

    dashboard/
      page.tsx                                  # Server component: recent projects, stats
      loading.tsx                               # Dashboard-specific skeleton

    projects/
      page.tsx                                  # Server component: project list
      loading.tsx                               # Project list skeleton
      new/page.tsx                              # Create project (could be modal)

      [projectId]/
        layout.tsx                              # NEW: Fetches project, contributes breadcrumb
        page.tsx                                # Project detail/overview
        loading.tsx                             # Project detail skeleton
        edit/page.tsx                           # Edit project form

        estimates/
          page.tsx                              # Estimate list (or tab in project detail)
          new/page.tsx                          # Create estimate

          [estimateId]/
            layout.tsx                          # NEW: Fetches estimate metadata
            page.tsx                            # THE TREE EDITOR
            loading.tsx                         # Tree editor skeleton
            settings/page.tsx
            snapshots/
              [snapshotId]/page.tsx              # Read-only snapshot viewer

    catalog/
      page.tsx
      [itemId]/page.tsx
      import/page.tsx

    settings/
      layout.tsx                                # Settings sub-nav (tabs)
      page.tsx                                  # Redirects to /settings/company
      company/page.tsx
      preferences/page.tsx
      users/page.tsx

  (client)/
    layout.tsx                                  # Minimal layout, no sidebar, PIN auth
    share/[token]/page.tsx
```

### What Each Layout Does

| Layout | Fetches | Renders | Persists Through |
|--------|---------|---------|------------------|
| Root `layout.tsx` | Nothing | `<html>`, `<body>`, fonts, `<SkipLink>` | Every navigation |
| `(protected)/layout.tsx` | User session/role | Sidebar, header, `<main>` wrapper | All protected page navigations |
| `[projectId]/layout.tsx` | Project by ID | Project breadcrumb segment | Navigation between project sub-pages |
| `[estimateId]/layout.tsx` | Estimate metadata | Estimate breadcrumb segment | Navigation between estimate sub-pages |
| `(auth)/layout.tsx` | Nothing | Centered card wrapper | Auth page switches |
| `(client)/layout.tsx` | Share token validation | Minimal header, no sidebar | Client portal navigation |

### Key Constraint: Layouts Cannot Pass Data Down via Props

In App Router, layouts receive `{ children }` only. They cannot pass fetched data as props to child pages. Three solutions exist:

1. **Re-fetch in the page** with React `cache()` deduplication (RECOMMENDED -- see Question 4).
2. **React Context** -- but server components cannot use `createContext`. Only works if both provider and consumer are client components.
3. **Parallel routes / slots** -- overkill for simple data sharing.

### Verdict

Five levels of nesting is well within App Router's design. The framework explicitly supports this via partial rendering and concurrent layout data fetching. The recommended structure above is the correct architecture for ShossyWorks.

---

## Question 2: How Should Sidebar, Header, and Breadcrumbs Compose Across Page Types

### Current State Analysis

The current `(protected)/layout.tsx` renders:
- **Sidebar** (left): `<Sidebar>` client component with 3 nav items, collapsible, active state via left border
- **Header** (top-right): Fixed height (`--header-height: 3.5rem`), "ShossyWorks" text + `<UserMenu>`
- **Main content**: `flex-1 overflow-y-auto` with `--color-bg-secondary` background and `--space-6` padding

Problems identified in the existing implementation:
1. Sidebar shows nothing when collapsed (no icons, just empty space)
2. No breadcrumbs anywhere
3. Header space between "ShossyWorks" and `<UserMenu>` is wasted -- breadcrumbs belong here
4. No contextual navigation within projects/estimates

### Composition Pattern by Page Type

#### Protected Pages (Sidebar + Header + Breadcrumbs)

```
+--sidebar--+--header-area-----------------------------------------+
|            | [Breadcrumbs: Projects > Soloway > Budget]  [UserMenu]|
| Dashboard  |-----------------------------------------------------+
| Projects   |                                                      |
| Catalog    |  [Page Content]                                      |
| Settings   |                                                      |
|            |                                                      |
+--sidebar--+------------------------------------------------------+
```

- Sidebar: static items (Dashboard, Projects, Catalog, Settings). Active state based on current top-level route.
- Breadcrumbs: dynamic, data-aware, rendered in the header area.
- Header height: `3.5rem` (`--header-height`), unchanged.

#### Estimate Editor (Sidebar + Header + Workspace)

```
+--sidebar--+--header-area-----------------------------------------+
|            | Projects > Soloway > Budget Estimate  [UserMenu]      |
| Dashboard  |-----------------------------------------------------+
| Projects   | [Toolbar: + Add | Delete | Dup | Search | Snap]     |
| Catalog    |-----------------------------------------------------+
| Settings   | Tree Panel          | Detail Panel                   |
|            |                     |                                 |
|            | > Foundation        | [Item: Concrete Footing]        |
|            |   > Concrete        | Quantity: ___                   |
|            |     Footings *      | Unit: ___                       |
|            |     Grade Beams     | Cost: ___                       |
|            | > Framing           |                                 |
|            |                     | [Notes] [Options]               |
|            +---------------------+---------------------------------+
|            | [Status: 47 nodes | $125,000 | Draft]                 |
+--sidebar--+-------------------------------------------------------+
```

- The estimate editor replaces the standard `<main>` padding with a full-bleed workspace.
- The `<main>` element should conditionally remove padding when on the estimate editor page, OR the estimate editor page should use negative margin to override it. Better approach: the `[estimateId]/layout.tsx` overrides the main area styling.

#### Auth Pages (No Sidebar, No Header)

```
+------------------------------------------------------------+
|                                                            |
|                   [ShossyWorks Logo]                       |
|                   [Sign In Form]                           |
|                                                            |
+------------------------------------------------------------+
```

Entirely separate layout. Centered card on neutral background.

#### Client Portal (No Sidebar, Minimal Header)

```
+--header-area----------------------------------------------+
| ShossyWorks | [Project: Soloway Residence]                 |
+-----------------------------------------------------------+
|                                                            |
| [Filtered Tree View -- Read-Only]                          |
|                                                            |
+-----------------------------------------------------------+
```

Minimal branded header. No sidebar. No breadcrumbs needed (single-page experience).

### Breadcrumb Implementation

**Recommended approach: Client-side `<Breadcrumbs>` component using `usePathname()` + `useParams()`.**

This is the approach endorsed by the page architecture analysis and is the pragmatic choice for App Router.

```typescript
// src/components/nav/breadcrumbs.tsx
"use client";

import { usePathname, useParams } from "next/navigation";
import Link from "next/link";
import useSWR from "swr"; // or a minimal fetcher

// Static segment labels
const STATIC_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  projects: "Projects",
  estimates: "Estimates",
  settings: "Settings",
  catalog: "Catalog",
  company: "Company",
  preferences: "Preferences",
  users: "Users",
  snapshots: "Snapshots",
  edit: "Edit",
  new: "New",
};

export function Breadcrumbs() {
  const pathname = usePathname();
  const params = useParams();
  // Split pathname, filter empties, build segments
  // For dynamic params (projectId, estimateId), fetch names via lightweight API
  // Cache entity names in SWR to avoid re-fetching on every navigation
  // ...
}
```

**Why not server-side breadcrumbs via parallel routes?**

Parallel routes (`@breadcrumbs`) in the protected layout would require a `breadcrumbs/` directory at every route level, with each one rendering its breadcrumb segment. This is architecturally clean but creates 10+ extra files and is harder to maintain. The client-side approach is simpler, works everywhere, and fetches entity names on demand with caching.

**Why not derive breadcrumbs entirely from the URL without data?**

Dynamic segments like `[projectId]` contain UUIDs, not human-readable names. Breadcrumbs showing `Projects > 8f3a2b1c-... > Estimates > a7d4e9f0-...` are useless. Entity names must be fetched. The client component can do this with a lightweight SWR or React Query hook that caches names by ID.

### Sidebar Enhancement (Required Fix)

The current sidebar renders nothing when collapsed because it only shows `{!collapsed && item.label}`. This is a critical usability bug.

Required changes:
1. Add icons to each nav item (Lucide React recommended, pending Zac review)
2. When collapsed, show icon only. When expanded, show icon + label.
3. Consider adding a "Recent Estimates" section at the bottom for quick access (Phase 2+).

---

## Question 3: How Professional Tools Handle Deep Navigation Hierarchies

### Linear

**URL Pattern:** `https://linear.app/{workspace}/{team}/issue/{issue-id}`

**Navigation model:**
- Left sidebar: teams, views, projects (collapsible tree structure)
- Breadcrumbs: Workspace > Team > View/Project > Issue
- Sub-issues render as nested hierarchy within issue lists
- Initiatives can nest up to 5 levels deep (as of 2025)
- Deep linking: every issue has a unique URL with readable identifier (e.g., `ENG-123`)

**Key pattern for ShossyWorks:** Linear uses workspace-scoped identifiers in URLs (e.g., `ENG-123` not UUIDs). ShossyWorks could consider adding project numbers to URLs for readability, but UUIDs are simpler for Phase 1B.

### Figma

**URL Pattern:** `https://figma.com/design/{fileKey}/{fileName}?node-id={nodeId}`

**Navigation model:**
- Left panel: page/layer tree (deep hierarchy, hundreds of levels possible)
- Node selection is encoded as a query parameter (`?node-id=5-3`), NOT as a URL path segment
- The file/page stays in the URL path; the selected element is in the query string
- This means back/forward browser navigation does NOT navigate between node selections by default
- Breadcrumbs: File > Page > Component (when inside a component)

**Key pattern for ShossyWorks:** Figma's approach of encoding selection state in query params is directly applicable to the estimate tree. The selected node should be `?node={nodeId}`, not `/nodes/{nodeId}`. This preserves the tree editor URL while encoding selection state in a shareable way.

### Notion

**URL Pattern:** `https://notion.so/{workspace}/{pageId}` (with optional readable slug)

**Navigation model:**
- Left sidebar: page tree with arbitrary nesting depth
- Breadcrumbs: path-style showing page hierarchy (Parent > Child > Grandchild)
- Uses `/` separator (which they found less intuitive than `>` arrows -- their UX case study showed arrow separators are clearer)
- Pages can be deeply nested but URL stays flat (only current page ID in URL)
- Sidebar shows expand/collapse with chevrons, indentation, and hover tooltips

**Key pattern for ShossyWorks:** Notion proves that deep hierarchy in the sidebar works well with expand/collapse, but ShossyWorks should NOT put the estimate tree in the sidebar. The sidebar is for top-level navigation only; the tree belongs in the main content area.

### Jira

**URL Pattern:** `https://{instance}.atlassian.net/browse/{PROJECT-KEY}-{number}`

**Navigation model:**
- Top navigation bar with global search
- Left sidebar: project-scoped navigation (Board, Backlog, Timeline, etc.)
- Sidebar changes context when switching projects ("Container pattern")
- Breadcrumbs: Project > Board/Backlog/etc > Issue
- Issue detail opens as a right panel or full page

**Key pattern for ShossyWorks:** Jira's project-scoped sidebar is interesting but adds complexity. For Phase 1B, ShossyWorks' static sidebar (Dashboard, Projects, Catalog, Settings) is simpler and sufficient. The project context comes from the URL/breadcrumbs, not the sidebar.

### VS Code / IDE Pattern

**Navigation model:**
- Left sidebar: file tree (collapsible, icons for file types)
- Top: tabs for open files
- Right: editor/detail panel
- Bottom: terminal/output panel
- Breadcrumbs: path to current file

**Key pattern for ShossyWorks:** The tree + detail panel pattern is exactly the estimate editor layout. VS Code's split-pane approach (resizable panels, tree on left, editor on right) is the proven model for this type of interface.

### Summary: Patterns to Adopt

| Pattern | Source | Application to ShossyWorks |
|---------|--------|---------------------------|
| Static sidebar for top-level nav | Jira, Linear, VS Code | Dashboard, Projects, Catalog, Settings |
| Breadcrumbs with data-aware entity names | Linear, Jira, Notion | Projects > [Name] > Estimates > [Name] |
| Selection state in query params | Figma | `?node={nodeId}` on the tree editor |
| Split-pane tree + detail panel | VS Code, Figma | Estimate editor workspace |
| Arrow separators in breadcrumbs (not `/`) | Notion UX research | Use `>` or chevron icons between segments |
| Collapsible sidebar with icons | Linear, VS Code | Icon-only when collapsed, icon+label when expanded |

---

## Question 4: Correct Data Loading Pattern for Nested Layouts (Parallel vs Waterfall)

### The Problem

With a 5-level deep layout hierarchy, naive data loading creates a waterfall:

```
Root layout (0ms)
  -> Protected layout: fetch user session (~50ms)
    -> [projectId] layout: fetch project (~50ms, waits for auth)
      -> [estimateId] layout: fetch estimate (~50ms, waits for project)
        -> page.tsx: fetch all nodes (~100ms, waits for estimate)
Total: ~250ms sequential waterfall
```

### How Next.js Actually Works

Next.js App Router does NOT create waterfalls between layouts and pages by default. The framework renders layouts and pages concurrently:

- **Layouts at each level start rendering simultaneously.** The `[projectId]/layout.tsx` does not wait for `(protected)/layout.tsx` to finish before starting its own data fetch.
- **Pages render in parallel with their layouts.** The `page.tsx` and its ancestor `layout.tsx` files all begin data fetching at the same time.
- **Suspense boundaries** (via `loading.tsx`) allow each segment to stream independently.

However, there is a dependency chain: the `[projectId]/layout.tsx` needs the `projectId` from URL params (available immediately), but it also needs to validate that the user is authenticated (which `(protected)/layout.tsx` handles). Since URL params are available synchronously, each layout CAN begin its Supabase query immediately without waiting for parent layouts.

### The Supabase Complication

Each layout that calls `createClient()` creates a new Supabase server client that reads cookies for auth. This means each layout independently authenticates. There is no dependency between layouts for auth -- each one re-reads the auth cookie independently.

However, if the same data is needed in both a layout and its child page (e.g., both `[projectId]/layout.tsx` and `page.tsx` need the project), a double-fetch occurs.

### Solution: React `cache()` for Request-Scoped Deduplication

React's `cache()` function memoizes function calls within a single server render pass. This is the correct solution for Supabase calls shared between layouts and pages.

```typescript
// src/lib/data/projects.ts
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export const getProjectCached = cache(async (projectId: string) => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();

  if (error) throw error;
  return data;
});
```

```typescript
// src/app/(protected)/projects/[projectId]/layout.tsx
import { getProjectCached } from "@/lib/data/projects";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await getProjectCached(projectId);
  // Render breadcrumb segment, pass children
  return (
    <>
      {/* Breadcrumb contribution happens in client-side Breadcrumbs component */}
      {children}
    </>
  );
}
```

```typescript
// src/app/(protected)/projects/[projectId]/page.tsx
import { getProjectCached } from "@/lib/data/projects";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await getProjectCached(projectId); // DEDUPLICATED -- same render pass
  // Render project detail...
}
```

**Key property:** `cache()` memoization lasts only for the current server request. It is NOT a cross-request cache. No stale data risk. No revalidation needed.

### Recommended Data Fetching Architecture

```
Layer          | What It Fetches              | How                   | Who Consumes
--------------|------------------------------|----------------------|------------------
(protected)   | User session + role          | createClient() + getUser() | Sidebar, header, auth gate
  layout      |                              |                      |
[projectId]   | Project by ID                | getProjectCached()   | Layout (breadcrumb name), page (detail)
  layout      |                              |                      |
[estimateId]  | Estimate metadata            | getEstimateCached()  | Layout (breadcrumb name), page (editor context)
  layout      |                              |                      |
page.tsx      | All nodes + item details     | getNodesCached()     | Tree editor client component
(tree editor) | + assembly details           | (parallel via        |
              |                              | Promise.all)         |
```

### Parallel Fetching at the Page Level

The tree editor page needs multiple data sets. These should be fetched in parallel:

```typescript
// src/app/(protected)/projects/[projectId]/estimates/[estimateId]/page.tsx
export default async function EstimateEditorPage({
  params,
}: {
  params: Promise<{ projectId: string; estimateId: string }>;
}) {
  const { projectId, estimateId } = await params;

  // Parallel fetches -- no waterfall
  const [estimate, nodes, viewState] = await Promise.all([
    getEstimateCached(estimateId),
    getNodesCached(estimateId),       // All nodes with details
    getViewStateCached(estimateId),   // User's expand/collapse state
  ]);

  return (
    <EstimateEditor
      estimate={estimate}
      initialNodes={nodes}
      initialViewState={viewState}
    />
  );
}
```

### Loading States Per Segment

Each route level should have its own `loading.tsx` with an appropriate skeleton:

| Route Level | Skeleton Content |
|-------------|-----------------|
| `(protected)/loading.tsx` | Full-page spinner (EXISTS, fallback only) |
| `dashboard/loading.tsx` | Stat cards + recent items skeleton |
| `projects/loading.tsx` | Table/list skeleton rows |
| `[projectId]/loading.tsx` | Project header + tabs skeleton |
| `[estimateId]/loading.tsx` | Tree panel + detail panel skeleton with placeholder rows |

The loading skeleton for the estimate editor is especially important because the page fetches the most data (potentially 2000 nodes). Users should see the workspace layout immediately (toolbar, tree panel shape, detail panel shape) with skeleton rows filling in as data arrives.

---

## Question 5: How Should the URL Structure Encode Estimate Tree Selection State

### The Question

When a user selects a node in the estimate tree, should the URL change? And if so, how?

### Analysis of Options

#### Option A: Node Selection as a URL Path Segment

```
/projects/{projectId}/estimates/{estimateId}/nodes/{nodeId}
```

**Problems:**
- Creates a 7-level deep route structure
- Would require a `[nodeId]/page.tsx` which implies a separate page -- but node selection is NOT a page navigation, it is a panel update within the same page
- Browser back/forward would navigate between node selections, which is unexpected behavior for what is effectively a click-to-select in a tree
- Breaks the mental model: the estimate editor IS one page; selecting nodes within it is not navigation

**Verdict: REJECT.**

#### Option B: Node Selection as a Query Parameter

```
/projects/{projectId}/estimates/{estimateId}?node={nodeId}
```

**Advantages:**
- URL is shareable: copying the URL and sending it to someone opens the estimate with that node selected
- Does not create additional route segments
- Does not trigger layout re-renders (query params do not affect layout rendering in App Router)
- Browser back/forward can optionally respect node selection changes (configurable)
- Matches Figma's proven pattern (`?node-id=5-3`)

**Implementation:**

```typescript
// In the EstimateEditor client component:
"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";

function EstimateEditor({ estimate, initialNodes, initialViewState }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Read initial selection from URL
  const initialNodeId = searchParams.get("node") ?? null;

  // Update URL when selection changes (without full navigation)
  function selectNode(nodeId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("node", nodeId);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    // Also update reducer state
    dispatch({ type: "SET_SELECTED", payload: { nodeId } });
  }

  function clearSelection() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("node");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    dispatch({ type: "SET_SELECTED", payload: { nodeId: null } });
  }
}
```

**Verdict: ADOPT.** This is the correct pattern.

#### Option C: No URL Encoding of Selection State

Selection state lives only in React state (the `useReducer` state). URL stays as `/projects/{projectId}/estimates/{estimateId}` regardless of what is selected.

**Advantages:** Simplest implementation. No URL management overhead.
**Disadvantages:** URLs are not shareable at the node level. Refreshing the page loses selection.

**Verdict:** Acceptable for Phase 1B MVP. Upgrade to Option B before client portal (since share links need to deep-link to specific nodes).

### Recommended URL Patterns

| State | URL Pattern | Implementation |
|-------|-------------|----------------|
| Project list | `/projects` | Static route |
| Project detail | `/projects/{projectId}` | Dynamic route |
| Estimate editor | `/projects/{projectId}/estimates/{estimateId}` | Dynamic route |
| Node selected | `/projects/{projectId}/estimates/{estimateId}?node={nodeId}` | Query param |
| Settings | `/projects/{projectId}/estimates/{estimateId}/settings` | Sub-route |
| Snapshot viewer | `/projects/{projectId}/estimates/{estimateId}/snapshots/{snapshotId}` | Sub-route |

### Additional Query Parameters (Future)

As the app grows, additional query params can encode workspace state without adding routes:

| Param | Purpose | Example |
|-------|---------|---------|
| `node` | Selected node | `?node=abc123` |
| `panel` | Active side panel | `?node=abc123&panel=notes` |
| `search` | Active search query | `?search=concrete` |
| `option` | Active option set | `?option=budget-a` |
| `compare` | Snapshot comparison | `?compare=snap1,snap2` |

These should be added incrementally, not all at once. Use a library like `nuqs` for type-safe URL state management if the parameter count grows beyond 3-4.

### nuqs Library Consideration

[nuqs](https://nuqs.dev/) provides type-safe, reactive URL query state management for Next.js App Router. It handles:
- Parsing and serializing query params with type safety
- Shallow routing (no server re-render on param change)
- Default values and validation
- History management (push vs replace)

This would be a good addition in Phase 1B-0 when implementing node selection URL encoding, but is not required for the initial MVP if selection state starts as React-only state.

---

## Question 6: How to Avoid Layout Shift When Navigating Between Pages with Different Layouts

### The Problem

ShossyWorks has three distinct layout types:
1. **Protected layout** (sidebar + header + padded content area) -- used by dashboard, project list, settings
2. **Estimate editor layout** (sidebar + header + full-bleed workspace with tree/detail panels) -- used by the tree editor
3. **Auth layout** (centered card, no sidebar) -- used by sign-in, sign-up
4. **Client portal layout** (minimal header, no sidebar) -- used by share links

Navigating between pages that use different layout variants within `(protected)` (e.g., from project list to estimate editor) could cause layout shift if not handled correctly.

### Why This Is Less of a Problem Than It Seems

In Next.js App Router, the `(protected)/layout.tsx` persists across ALL protected page navigations. The sidebar and header never re-render or shift. Only the `<main>` content area changes.

The potential layout shift comes from the difference between:
- **Standard pages** (dashboard, project list): `<main>` has padding (`p-[var(--space-6)]`) and `overflow-y-auto`
- **Estimate editor**: `<main>` should be full-bleed with no padding, and the content uses a split-pane layout

### Solution: Conditional Main Area Styling

**Option A: Override at the page/layout level (RECOMMENDED)**

The `[estimateId]/layout.tsx` can render its own wrapper that overrides the parent `<main>` padding:

```tsx
// src/app/(protected)/projects/[projectId]/estimates/[estimateId]/layout.tsx
export default async function EstimateLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ estimateId: string }>;
}) {
  const { estimateId } = await params;
  const estimate = await getEstimateCached(estimateId);

  return (
    <div className="-m-[var(--space-6)] h-[calc(100%+var(--space-6)*2)] overflow-hidden">
      {/* Negative margin cancels parent padding; height compensates */}
      {children}
    </div>
  );
}
```

This approach keeps the protected layout unchanged and lets the estimate layout "opt out" of the padding.

**Option B: CSS class on `<main>` based on route**

Add a data attribute or class to `<main>` that child layouts can target:

```tsx
// (protected)/layout.tsx
<main data-layout="standard" className="flex-1 overflow-y-auto bg-[var(--color-bg-secondary)] p-[var(--space-6)]">
  {children}
</main>
```

Then the estimate editor page overrides the padding:

```css
[data-layout="standard"]:has(.estimate-editor) {
  padding: 0;
  overflow: hidden;
}
```

This uses CSS `:has()` (well-supported in 2026) to conditionally remove padding when the estimate editor is present.

**Option C: Two `<main>` variants in the protected layout using a prop or slot**

This requires knowing at the layout level whether the child page needs padding or not, which layouts cannot know in App Router (they only receive `children`).

**Verdict:** Option A is the cleanest. The negative margin approach is a well-known pattern for "breaking out" of parent padding in constrained layout contexts.

### Preventing Visible Shift During Navigation

The key techniques:

1. **Instant `loading.tsx` skeletons.** When navigating from project list to estimate editor, the estimate editor's `loading.tsx` should render immediately with the correct layout shape (full-bleed, split-pane skeleton). The user sees the workspace skeleton instantly, then data streams in.

2. **Stable sidebar and header.** These NEVER re-render during protected page navigation. No shift possible.

3. **`router.replace` for query params.** Node selection changes use `router.replace` with `{ scroll: false }`, which updates the URL without scrolling or layout changes.

4. **Fixed dimensions on layout containers.** The split-pane in the estimate editor should have explicit height (`h-full`, `h-screen`, or `calc()`) rather than content-driven height. This prevents the layout from jumping as tree nodes load in.

5. **CSS `content-visibility: auto`** on off-screen tree rows (handled by `@tanstack/react-virtual`). This prevents the browser from calculating layout for thousands of off-screen nodes.

6. **Font preloading.** The root layout already uses `next/font/google` for Inter with `variable` mode, which prevents FOUT (flash of unstyled text).

### Cross-Layout Navigation (Protected <-> Auth)

Navigating from `/sign-in` to `/dashboard` (or vice versa) is a full layout swap. The entire page transitions from the auth card layout to the sidebar+header layout. This is expected behavior and NOT a layout shift -- it is a navigation to a fundamentally different page type.

To make this transition smooth:
- Ensure the auth callback redirects server-side (which it already does via `auth/callback/route.ts`)
- The protected layout's `loading.tsx` provides an immediate skeleton while the dashboard loads
- No client-side animation needed -- the transition is a full page navigation

### Layout Shift Checklist

| Transition | Shift Risk | Mitigation |
|-----------|------------|------------|
| Dashboard -> Project List | None | Same layout, only content changes |
| Project List -> Project Detail | Low | `[projectId]/loading.tsx` provides skeleton |
| Project Detail -> Estimate Editor | Medium | Negative margin override + full-bleed skeleton |
| Estimate Editor -> Settings | Low | Only `<main>` content changes |
| Estimate Editor -> Different Estimate | None | Same layout, only data changes |
| Any Protected -> Sign In | None | Full layout swap (expected) |
| Sign In -> Dashboard | None | Server redirect + loading.tsx |

---

## Synthesis: Architecture Decisions

### Confirmed Decisions

| # | Decision | Confidence |
|---|----------|------------|
| 1 | 5-level route nesting is correct and well-supported | HIGH |
| 2 | `[projectId]/layout.tsx` and `[estimateId]/layout.tsx` must be created | HIGH |
| 3 | Client-side `<Breadcrumbs>` component using `usePathname()` + `useParams()` + SWR for names | HIGH |
| 4 | React `cache()` wrappers for Supabase queries shared between layouts and pages | HIGH |
| 5 | Node selection encoded as `?node={nodeId}` query parameter (Figma pattern) | HIGH |
| 6 | Negative margin override for estimate editor full-bleed layout | HIGH |
| 7 | `loading.tsx` at every route level with layout-specific skeletons | HIGH |
| 8 | Sidebar needs icons for collapsed state (critical usability fix) | HIGH |
| 9 | Sidebar remains static (Dashboard, Projects, Catalog, Settings) -- no contextual items | MEDIUM |
| 10 | Arrow/chevron separators in breadcrumbs, not slash | MEDIUM |

### Open Questions for Zac

| # | Question | Options | Impact |
|---|----------|---------|--------|
| 1 | Should the breadcrumb show "Estimates" as an explicit crumb or skip it? | `Projects > Soloway > Budget` (skip) vs `Projects > Soloway > Estimates > Budget` (include) | Visual density. "Skip" is cleaner but loses navigability to the estimates list. |
| 2 | Should node selection URL encoding be in Phase 1B-0 or deferred? | Now (adds ~2 hours) vs Later (before client portal) | Shareability. Deferring is safe; adding later is easy. |
| 3 | Should the sidebar show a mini project tree when in project context? | Static sidebar vs Context-aware sidebar | Complexity. Static is simpler. Context-aware adds value but is Phase 2+ scope. |

---

## Sources

- [Next.js Layouts and Pages](https://nextjs.org/docs/app/getting-started/layouts-and-pages)
- [Next.js Data Fetching Patterns](https://nextjs.org/docs/14/app/building-your-application/data-fetching/patterns)
- [Next.js loading.js Convention](https://nextjs.org/docs/app/api-reference/file-conventions/loading)
- [Next.js Route Groups](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups)
- [Next.js Caching](https://nextjs.org/docs/app/getting-started/caching)
- [Next.js Fetching Data](https://nextjs.org/docs/app/getting-started/fetching-data)
- [React cache() for Deduplication](https://nextjs.org/docs/app/building-your-application/caching)
- [UX Breadcrumbs in 2026](https://www.eleken.co/blog-posts/breadcrumbs-ux)
- [Breadcrumb UX Design (Smashing Magazine)](https://www.smashingmagazine.com/2022/04/breadcrumbs-ux-design/)
- [Notion Navigation Redesign Case Study](https://davisdesigninteractive.medium.com/notion-navigation-redesign-a-ux-case-study-e547179faf86)
- [Linear Conceptual Model](https://linear.app/docs/conceptual-model)
- [Figma URL and Node IDs](https://forum.figma.com/ask-the-community-7/how-to-generate-url-to-specific-node-31893)
- [Jira Navigation Architecture](https://developer.atlassian.com/cloud/jira/platform/navigation/)
- [Jira Project Sidebar](https://developer.atlassian.com/cloud/jira/platform/jira-project-sidebar/)
- [nuqs - URL State Management for React](https://nuqs.dev/)
- [Next.js App Router Complete Guide 2026 (DEV.to)](https://dev.to/ottoaria/nextjs-app-router-in-2026-the-complete-guide-for-full-stack-developers-5bjl)
- [Next.js Routing Best Practices](https://eastondev.com/blog/en/posts/dev/20251218-nextjs-routing-best-practices/)
- [Mastering URL State in Next.js](https://medium.com/@roman_j/mastering-state-in-next-js-app-router-with-url-query-parameters-a-practical-guide-03939921d09c)
- [Layout Shift Issue (Next.js GitHub)](https://github.com/vercel/next.js/issues/43418)
- [Eliminating Layout Shifts in Next.js](https://medium.com/@ferhattaher00/5-essential-techniques-to-eliminate-layout-shifts-in-next-js-5f314cb23e4b)
- [Next.js Loading States Guide](https://eastondev.com/blog/en/posts/dev/20260105-nextjs-loading-states/)
