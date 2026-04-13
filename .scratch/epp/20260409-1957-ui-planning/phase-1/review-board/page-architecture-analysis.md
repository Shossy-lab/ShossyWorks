# Page & Route Architecture Analysis

**Analyst:** Page Architecture Review Board Member
**Date:** 2026-04-09
**Status:** READ-ONLY research findings

---

## 1. Complete Page Inventory

Every user workflow mapped to a required page/route. Organized by domain.

### 1.1 Authentication & Onboarding (EXISTS)

| Page | Route | Status | Notes |
|------|-------|--------|-------|
| Sign In | `/sign-in` | EXISTS | Full client component. Should be server+client split. |
| Sign Up | `/sign-up` | EXISTS | Full client component. Same issue. |
| Pending Approval | `/pending-approval` | EXISTS | Client component, standalone (outside route groups). |
| Auth Callback | `/auth/callback` | EXISTS | Server route handler. |

### 1.2 Dashboard (EXISTS - placeholder)

| Page | Route | Status | Notes |
|------|-------|--------|-------|
| Dashboard | `/dashboard` | EXISTS (placeholder) | Currently just 2 link cards. Needs: recent projects, recent estimates, quick stats (total active projects, estimates in draft, etc.), recent activity. |

### 1.3 Projects (NEEDS BUILDING)

| Page | Route | Status | Notes |
|------|-------|--------|-------|
| Project List | `/projects` | EXISTS (placeholder) | Needs: filterable list, status badges, search, create button. Server action `getProjects()` exists. |
| Create Project | `/projects/new` | NEEDED | Form page OR modal intercepting route. All fields available in `createProject()` action. |
| Project Detail | `/projects/[projectId]` | NEEDED | Overview page: project info, estimate list, status management. Actions exist: `getProject()`, `updateProject()`. |
| Edit Project | `/projects/[projectId]/edit` | NEEDED | Could be inline on detail page OR dedicated route. `updateProject()` exists. |
| Project Estimates | `/projects/[projectId]/estimates` | NEEDED | List estimates for this project. `getEstimates(projectId)` exists. Could also be a tab/section within project detail. |

### 1.4 Estimates (NEEDS BUILDING)

| Page | Route | Status | Notes |
|------|-------|--------|-------|
| Create Estimate | `/projects/[projectId]/estimates/new` | NEEDED | Form with name, description, default rates. `createEstimate()` exists. |
| Estimate Detail / Tree Editor | `/projects/[projectId]/estimates/[estimateId]` | NEEDED | THE CORE PAGE. Tree view, node editing, the primary workspace. |
| Estimate Settings | `/projects/[projectId]/estimates/[estimateId]/settings` | NEEDED | Default rates, status management, metadata. Could be a panel/tab within the estimate editor. |
| Duplicate Estimate | N/A (action) | AVAILABLE | `duplicateEstimate()` server action exists. Triggered from UI, not a separate page. |

### 1.5 Tree View & Node Editing (NEEDS BUILDING -- THE CRITICAL UI)

These are not separate pages but PANELS/REGIONS within the estimate editor page:

| Component/Region | Location | Notes |
|------------------|----------|-------|
| Tree Panel | Left/main area of estimate editor | Hierarchical node tree with expand/collapse, indent/outdent, reorder. |
| Node Detail Panel | Right side or bottom of estimate editor | Contextual editing panel that changes based on selected node type (group/assembly/item). |
| Node Item Details Form | Within detail panel | All ItemDetails fields: quantity, unit, unit_cost, labor, materials, equipment, markup rates, etc. |
| Node Assembly Details Form | Within detail panel | Assembly quantity, unit, ratio_base, specifications. |
| Node Notes Panel | Tab/section in detail panel | Multiple notes per node via `node_notes` table. Rich text, client visibility toggles. |
| Bulk Actions Bar | Top/contextual toolbar | Delete, duplicate, copy, paste, convert type, toggle visibility, flag. |

### 1.6 Snapshots (Phase 1B-1)

| Page | Route | Status | Notes |
|------|-------|--------|-------|
| Snapshot List | Panel within estimate editor | NEEDED | `listSnapshots()` exists. Sidebar panel or modal. |
| Snapshot Viewer | `/projects/[projectId]/estimates/[estimateId]/snapshots/[snapshotId]` | NEEDED | Read-only tree render. `getSnapshot()` exists. Frozen data via `FrozenNode` type. |
| Snapshot Comparison | Modal or dedicated view | NEEDED | Side-by-side diff of two snapshots or snapshot vs current. |
| Create Snapshot | Dialog/modal | NEEDED | `createSnapshot()` exists. |
| Restore Snapshot | Confirmation dialog | NEEDED | `restoreSnapshot()` exists with force flag. |

### 1.7 Catalog (Phase 1B-2)

| Page | Route | Status | Notes |
|------|-------|--------|-------|
| Catalog Browser | `/catalog` OR panel within estimate editor | NEEDED | Browse, search, filter catalog items. Server actions deferred to 1B. |
| Catalog Item Detail | `/catalog/[itemId]` | NEEDED | View/edit catalog template. |
| Add to Catalog | Dialog/modal | NEEDED | Save node as catalog template. |
| Insert from Catalog | Panel within estimate editor | NEEDED | Drag or click to add from catalog. |
| CSV Import | `/catalog/import` | NEEDED | Column mapping, preview, bulk import. |

### 1.8 Options (Phase 1B-3)

| Page | Route | Status | Notes |
|------|-------|--------|-------|
| Option Group Manager | Panel within estimate editor | NEEDED | Create/edit option groups and alternatives. |
| Option Set Manager | Panel or modal | NEEDED | Save/apply/compare named scenarios. |
| Option Comparison View | Modal or full-page | NEEDED | Side-by-side cost comparison of option sets. |

### 1.9 Client Portal (Phase 1B-4)

| Page | Route | Status | Notes |
|------|-------|--------|-------|
| Client Estimate Viewer | `/share/[token]` | NEEDED | PIN-protected entry, filtered tree view. Separate route group `(client)`. |
| Client PIN Entry | `/share/[token]` (initial state) | NEEDED | 6-digit PIN form, rate limited. |
| Client Comment Thread | Within viewer | NEEDED | Comment on specific nodes. |
| Client Approval | Within viewer | NEEDED | Approve/reject estimate or options. |
| Share Link Management | Within estimate settings | NEEDED | Generate, revoke, manage share links. |

### 1.10 Search (Phase 1B-5)

| Page | Route | Status | Notes |
|------|-------|--------|-------|
| Global Search | Command palette / modal | NEEDED | Cross-project, cross-estimate search. |
| Estimate Search | Within estimate editor | NEEDED | Filter nodes within current estimate. |

### 1.11 Settings (Phase 1B-6)

| Page | Route | Status | Notes |
|------|-------|--------|-------|
| Settings Hub | `/settings` | EXISTS (placeholder) | Needs tabs/sections for different settings areas. |
| Company Settings | `/settings/company` | NEEDED | Company info, default rates, tax. |
| User Preferences | `/settings/preferences` | NEEDED | UI preferences, display settings. |
| User Management | `/settings/users` | NEEDED | Approve pending users, manage roles. |

### 1.12 Error/Utility Pages (EXISTS)

| Page | Route | Status |
|------|-------|--------|
| Root Error | `error.tsx` | EXISTS |
| Global Error | `global-error.tsx` | EXISTS |
| Not Found | `not-found.tsx` | EXISTS |
| Protected Error | `(protected)/error.tsx` | EXISTS |
| Auth Error | `(auth)/error.tsx` | EXISTS |
| Loading | `(protected)/loading.tsx` | EXISTS |

---

## 2. Route Structure Recommendation

### 2.1 Route Group Architecture

```
src/app/
  layout.tsx                           # Root: html, body, font, skip-link
  page.tsx                             # Landing redirect -> /dashboard or /sign-in
  globals.css
  error.tsx / global-error.tsx / not-found.tsx

  (auth)/                              # Route group: NO sidebar, NO header
    layout.tsx                         # Centered card layout (exists)
    error.tsx                          # (exists)
    sign-in/page.tsx                   # (exists, needs server/client split)
    sign-up/page.tsx                   # (exists, needs server/client split)

  (protected)/                         # Route group: sidebar + header, auth required
    layout.tsx                         # Auth check, sidebar, header (exists)
    loading.tsx                        # (exists)
    error.tsx                          # (exists)

    dashboard/
      page.tsx                         # Server component: fetch recent data
      loading.tsx                      # Skeleton for dashboard

    projects/
      page.tsx                         # Server component: project list
      loading.tsx
      new/page.tsx                     # Create project form
      [projectId]/
        layout.tsx                     # Project-scoped layout: fetch project, breadcrumb
        page.tsx                       # Project detail / overview
        edit/page.tsx                  # Edit project form (or could be modal)
        estimates/
          page.tsx                     # Estimate list for project (may not need if shown in project detail)
          new/page.tsx                 # Create estimate form
          [estimateId]/
            layout.tsx                 # Estimate-scoped layout: fetch estimate metadata
            page.tsx                   # THE TREE EDITOR (core workspace)
            settings/page.tsx          # Estimate settings/metadata
            snapshots/
              [snapshotId]/page.tsx    # Read-only snapshot viewer

    catalog/
      page.tsx                         # Catalog browser
      [itemId]/page.tsx                # Catalog item detail
      import/page.tsx                  # CSV import

    settings/
      page.tsx                         # Settings hub (redirects or shows tabs)
      company/page.tsx                 # Company settings
      preferences/page.tsx             # User preferences
      users/page.tsx                   # User management

    search/page.tsx                    # Full search results page (optional)

  (client)/                            # Route group: client portal, NO sidebar
    layout.tsx                         # Minimal layout, client-safe
    share/
      [token]/
        page.tsx                       # PIN entry + client viewer

  pending-approval/                    # Standalone (outside route groups, exists)
    page.tsx

  auth/
    callback/route.ts                  # (exists)
```

### 2.2 Critical Design Decisions for Route Structure

**DECISION 1: `(protected)/projects/[projectId]/estimates/[estimateId]` as the deep nesting path.**

Pros: URL is fully navigable and shareable (`/projects/abc/estimates/xyz`). Breadcrumbs are trivially derivable from the URL segments. Each level can have its own layout that fetches relevant data.

Cons: Deep nesting (5 levels). However, this mirrors the actual data hierarchy (project -> estimate -> tree), and Next.js App Router handles this well with nested layouts.

Recommendation: USE THIS PATTERN. The URL structure mirrors the mental model. A construction estimator thinks "I'm working on the Soloway project, the Budget estimate." The URL `/projects/soloway-id/estimates/budget-id` maps directly to that mental model.

**DECISION 2: Separate `(client)` route group.**

The client portal has fundamentally different concerns: no sidebar, no header, PIN auth instead of Supabase auth, filtered data, read-only (mostly). A separate route group with its own layout is correct. The client route does NOT share the `(protected)` layout.

**DECISION 3: `(auth)` route group stays separate.**

Auth pages have a centered-card layout with no navigation chrome. This is correct and should remain.

**DECISION 4: Catalog gets its own top-level section under `(protected)`.**

Catalog is cross-project. It should not be nested under a specific project. The catalog browser at `/catalog` is accessible from the sidebar at all times. From within an estimate editor, the catalog is accessed via a PANEL (not a route navigation), but the standalone catalog management is at `/catalog`.

**DECISION 5: Settings uses sub-routes, not tabs.**

Company, preferences, and user management are distinct enough to warrant separate routes under `/settings/`. Each can be a server component that fetches its own data. A `layout.tsx` at the settings level provides the tab navigation UI.

### 2.3 What SHOULD NOT Be Separate Routes

The following should be panels/modals WITHIN existing pages, NOT separate routes:

| Feature | Why Not a Route |
|---------|----------------|
| Node editing | The detail panel is contextual to the selected tree node. Navigating away would lose tree state. |
| Snapshot creation | A dialog overlay. No URL change needed. |
| Option management | A side panel within the estimate editor. Context is the current estimate. |
| Search within estimate | A filter bar/command palette, not a page navigation. |
| Bulk actions | Toolbar actions, not page navigations. |
| Share link creation | A modal dialog within estimate settings. |

### 2.4 What COULD Be Intercepting Routes (Advanced)

Next.js intercepting routes (`(.)`, `(..)`) could improve UX for:

| Feature | Pattern | Why |
|---------|---------|-----|
| Create Project | `(.)new` intercepting `/projects/new` | Opens as a modal from the project list, but direct URL shows full page. |
| Create Estimate | `(.)new` intercepting `/projects/[id]/estimates/new` | Same pattern. |
| Snapshot Viewer | Intercepting from estimate editor | Opens as an overlay panel, but direct URL shows full read-only page. |

**Recommendation:** Do NOT implement intercepting routes in Phase 1B. They add complexity. Use simple modals with `dialog` elements first. Intercepting routes can be retrofitted later for polish (Phase 2D).

---

## 3. Server vs Client Component Boundaries

### 3.1 The Core Principle

Server components for data fetching and static rendering. Client components only where browser interactivity is required. Push the boundary DOWN to the smallest interactive leaf.

### 3.2 Page-by-Page Analysis

| Page | Component Type | Rationale |
|------|---------------|-----------|
| **Dashboard** | SERVER | Fetches recent projects, estimates, stats. Renders cards. Zero interactivity needed on the page itself. |
| **Project List** | SERVER + CLIENT leaf | Server fetches projects. Client component only for: search/filter input, create button that opens modal. |
| **Project Detail** | SERVER | Fetches project + estimates list. Static render. Status badge is server-rendered. |
| **Edit Project** | SERVER wrapper + CLIENT form | Server fetches current project data. Client form for editing with validation. |
| **Estimate List** | SERVER | Fetched inside project detail layout. Status badges, simple links. |
| **Create Estimate** | CLIENT form | Needs form state. But the wrapper page can be server. |
| **Estimate Editor (Tree)** | SERVER initial load + CLIENT tree | THE KEY BOUNDARY. Server component fetches all nodes via `getNodes()`. Passes flat array to client `TreeEditor` component. Client runs `buildTree()`, manages tree state via `useReducer`. |
| **Snapshot Viewer** | SERVER | Read-only. Fetch snapshot data, render frozen tree. No interactivity except expand/collapse (which could be CSS-only or a thin client wrapper). |
| **Catalog Browser** | SERVER + CLIENT search | Server fetches catalog items. Client component for search input and filtering. |
| **Settings pages** | SERVER + CLIENT forms | Server fetches current settings. Client forms for editing. |
| **Client Portal** | SERVER gated + CLIENT viewer | Server validates token/PIN. Client component for interactive tree viewing, commenting, approval. |

### 3.3 The Estimate Editor Boundary (CRITICAL)

This is the most important server/client boundary in the entire application.

```
(protected)/projects/[projectId]/estimates/[estimateId]/page.tsx  <-- SERVER
  |
  |-- Fetches: estimate metadata, all nodes, item details, assembly details
  |-- Fetches: user preferences (view state for this estimate)
  |-- Passes data as props to:
  |
  +-- <EstimateEditor>  <-- CLIENT ("use client")
        |
        |-- Receives: flat node array, estimate metadata
        |-- Runs: buildTree() to construct tree
        |-- Manages: tree state via useReducer
        |-- Manages: selected node, expanded/collapsed state
        |-- Manages: dirty state tracking for saves
        |
        +-- <TreePanel>  <-- Client child
        |     |-- Renders tree with expand/collapse
        |     |-- Handles: drag, indent/outdent, reorder
        |     |-- Handles: node selection
        |
        +-- <NodeDetailPanel>  <-- Client child
        |     |-- Renders based on selected node type
        |     |-- <ItemDetailForm> | <AssemblyDetailForm> | <GroupDetailForm>
        |     |-- Handles: field editing, validation, save
        |
        +-- <EstimateToolbar>  <-- Client child
              |-- Add node, delete, duplicate, undo
              |-- Snapshot button, search button
```

**Why the boundary is here:**
1. The tree is highly interactive (drag, click, keyboard nav, expand/collapse).
2. Two mutation sources (local edits + future Supabase Realtime broadcasts) require `useReducer` -- a client-only pattern (Decision 13 from INTENT.md).
3. The node detail panel changes dynamically based on selection.
4. Dirty state tracking requires client-side awareness.

**Why NOT make the page itself a client component:**
1. Initial data fetch should be server-side for performance (one DB round-trip, no waterfall).
2. Layout shell (sidebar, header) is server-rendered.
3. Estimate metadata (name, status) can be server-rendered.
4. The server component can prefetch and pass all data the client needs in ONE render pass.

### 3.4 Auth Page Server/Client Split (FIX NEEDED)

Current sign-in/sign-up pages are entirely `"use client"`. This means the entire page JS is shipped to the browser. Better pattern:

```
sign-in/page.tsx (SERVER) -- renders page shell, metadata
  +-- <SignInForm> (CLIENT) -- form state, Supabase auth calls
```

This is a minor optimization but aligns with the architecture principle.

---

## 4. Data Fetching Patterns

### 4.1 Layout-Level Data Fetching

**Root Layout** (`layout.tsx`): No data fetching. Pure HTML/body wrapper.

**Protected Layout** (`(protected)/layout.tsx`): Fetches user session (EXISTS). Validates auth. Renders sidebar + header.

**Project Layout** (`[projectId]/layout.tsx`): NEW. Fetches project via `getProject(projectId)`. Makes project data available to all child pages. Renders project-level breadcrumb.

**Estimate Layout** (`[estimateId]/layout.tsx`): NEW. Fetches estimate metadata via `getEstimate(estimateId)`. Renders estimate-level breadcrumb. Does NOT fetch nodes -- that is the page's responsibility (because snapshot viewer needs different data).

### 4.2 Page-Level Data Fetching

| Page | Fetch Pattern | Data Source |
|------|--------------|-------------|
| Dashboard | `getProjects()` (recent 5), count stats | Server action, single await |
| Project List | `getProjects()` | Server action, single await |
| Project Detail | Project from layout + `getEstimates(projectId)` | Layout provides project, page fetches estimates |
| Estimate Editor | `getNodes(estimateId)` + item details + assembly details | Server action, parallel fetches via `Promise.all()` |
| Snapshot Viewer | `getSnapshot(snapshotId)` | Server action, single await (full JSONB blob) |
| Catalog Browser | `getCatalogItems()` (deferred to 1B) | Server action with pagination |
| Settings | Respective settings actions | Per-section server actions |

### 4.3 Client-Side Data Fetching (Minimal)

Client-side fetching should be used ONLY for:

| Case | Why Client-Side | Pattern |
|------|----------------|---------|
| Real-time updates | Supabase Realtime channels (Phase 2) | `useEffect` + channel subscription |
| Optimistic updates | User edits tree node, sees immediate feedback | `useReducer` dispatch + background server action call |
| Search autocomplete | Keystroke-driven, debounced | Client fetch with debounce, NOT server action (latency) |
| Estimate view state | Remember expanded/collapsed per user per estimate | Save to `estimate_view_state` on debounced writes |

### 4.4 Data Flow: Layout to Page to Component

```
(protected)/layout.tsx
  -- Fetches: user session, user role
  -- Provides: sidebar (server rendered), header with UserMenu
  -- Passes: nothing explicitly (children pattern)

  [projectId]/layout.tsx
    -- Fetches: project data (from params.projectId)
    -- Provides: project context for breadcrumbs
    -- WARNING: Do NOT use React Context here (server components
       cannot provide context). Instead, use a shared data pattern:
       fetch in layout, pass via slot props OR fetch again in page
       (Next.js request deduplication makes this free).

    [estimateId]/layout.tsx
      -- Fetches: estimate metadata
      -- Provides: estimate context for breadcrumbs

      page.tsx (THE ESTIMATE EDITOR)
        -- Fetches: all nodes for estimate (full tree data)
        -- Passes flat array to <EstimateEditor> client component
```

### 4.5 CRITICAL: Request Deduplication

Next.js automatically deduplicates `fetch()` calls with the same URL within a single render pass. However, Supabase client calls via `createClient()` are NOT automatically deduplicated because they use the Supabase SDK, not raw `fetch()`.

**Solution:** If both the layout and the page need the same data (e.g., project details), either:
1. Fetch in the layout and pass via a React Server Component pattern (layout renders page with props -- NOT standard in App Router, but possible with slot patterns).
2. Accept the double-fetch (Supabase queries are fast, and this is a single-company tool with low traffic).
3. Use React `cache()` to memoize the Supabase call within the render pass.

**Recommendation:** Use React `cache()` wrapper around Supabase calls used by both layouts and pages. Example:

```typescript
// src/lib/data/projects.ts
import { cache } from 'react';

export const getProjectCached = cache(async (id: string) => {
  // Supabase call here
});
```

This ensures the layout and page calling `getProjectCached(id)` only hit the database once per render.

---

## 5. Navigation Architecture

### 5.1 Primary Navigation (Sidebar)

The sidebar (EXISTS) currently has 3 items: Dashboard, Projects, Settings.

**Recommended sidebar structure:**

```
Sidebar
  -- Dashboard
  -- Projects                  # Active indicator for /projects/*
  -- Catalog                   # NEW: top-level catalog access
  -- Settings                  # Active indicator for /settings/*
  --
  -- [Collapsed/Expanded toggle] (EXISTS)
```

The sidebar should NOT include estimates. Estimates are project-scoped and accessed via project navigation. Adding "Recent Estimates" to the dashboard is a better pattern for quick access.

**Sidebar behavior:**
- Active state shows left accent border (EXISTS, correct per design system).
- Collapsed state shows icons only (EXISTS, but currently shows nothing -- needs icons).
- Sidebar should be collapsible and remember state via user preferences.

### 5.2 Breadcrumbs (NEW -- CRITICAL)

Breadcrumbs are essential for the deep nesting pattern. The user needs to know where they are at all times.

```
Dashboard
Projects > [Project Name]
Projects > [Project Name] > Estimates > [Estimate Name]
Projects > [Project Name] > Estimates > [Estimate Name] > Settings
Projects > [Project Name] > Estimates > [Estimate Name] > Snapshot: [Name]
Catalog > [Item Name]
Settings > Company
Settings > Preferences
```

**Implementation approach:**

Breadcrumbs should be rendered in the header area (between the "ShossyWorks" title and the UserMenu). Each layout level contributes its segment:

- `(protected)/layout.tsx`: No breadcrumb (it's the shell).
- `projects/page.tsx`: "Projects" (static).
- `[projectId]/layout.tsx`: "Projects > [Project Name]" (fetched from data).
- `[estimateId]/layout.tsx`: "... > Estimates > [Estimate Name]" (fetched from data).
- Child pages add their own segment (Settings, Snapshot, etc.).

**The challenge:** In App Router, layouts cannot directly pass data to the header in the parent layout. Options:
1. Each page/layout renders its own breadcrumb in a consistent position.
2. Use a breadcrumb component that reads from `usePathname()` + route params and fetches names. This is a CLIENT component approach.
3. Use parallel routes (`@breadcrumbs` slot) in the protected layout.

**Recommendation:** Option 2 -- a client-side `<Breadcrumbs>` component in the header that uses `usePathname()` and `useParams()` to derive the breadcrumb trail. For entity names (project name, estimate name), use a lightweight client-side cache or SWR hook. This avoids the complexity of parallel routes while providing accurate breadcrumbs.

### 5.3 Within-Page Navigation (Tabs/Panels)

**Project Detail Page:**
```
[Project Name]                    [Status Badge] [Edit Button]
------------------------------------------------------------------
Overview | Estimates | Settings (future)
```

Tabs within the project detail page. NOT separate routes -- use client-side tab state. The "Estimates" tab shows the estimate list. This avoids an extra route level.

**Estimate Editor Page:**
The estimate editor is a workspace, not a traditional page. It has its own internal navigation:

```
+-----------+------------------------------------------+
| Sidebar   | [Breadcrumbs]                   [UserMenu]|
|           |------------------------------------------+
| Dashboard | [Toolbar: Add | Delete | Dup | ...]     |
| Projects  |------------------------------------------+
| Catalog   | Tree Panel          | Detail Panel       |
| Settings  |                     |                    |
|           | > Group 1           | [Item Name]        |
|           |   > Assembly 1.1    | Quantity: ___      |
|           |     Item 1.1.1 *    | Unit: ___          |
|           |     Item 1.1.2      | Unit Cost: ___     |
|           |   > Assembly 1.2    | ...                 |
|           | > Group 2           |                    |
|           |                     | [Notes] [Options]  |
|           +---------------------+--------------------+
|           | [Status Bar: 47 nodes | $125,000 | Draft] |
+-----------+------------------------------------------+
```

The tree panel and detail panel are side-by-side (or top-bottom on smaller screens). The detail panel is contextual -- it shows the form for whatever node is selected.

### 5.4 Deep Tree Navigation

For estimates with 500-2000 nodes, tree navigation needs:

1. **Expand/Collapse all** -- Button to expand or collapse the entire tree.
2. **Expand to level N** -- "Show 2 levels" / "Show 3 levels" controls.
3. **Jump to node** -- Search/filter within the tree (Ctrl+F style).
4. **Keyboard navigation** -- Arrow keys to move between nodes, Enter to select, Tab to indent.
5. **Scroll sync** -- When selecting a node via search, the tree scrolls to it and highlights it.
6. **Visual depth indicators** -- Indentation + subtle background shading per depth level (using design tokens).
7. **Node type icons** -- Visual differentiation between group (folder), assembly (package), item (leaf).
8. **Flagged/highlighted nodes** -- Visual markers for nodes with `flagged: true`.
9. **Client visibility indicators** -- Subtle badge/icon showing hidden or summary_only nodes.

### 5.5 Quick Navigation Patterns

| Pattern | Implementation |
|---------|---------------|
| Recent projects | Dashboard cards, fetched server-side |
| Recent estimates | Dashboard section or sidebar widget |
| Jump to estimate | Command palette (Ctrl+K) with search |
| Back to project | Breadcrumb link |
| Back to project list | Breadcrumb link or sidebar "Projects" |
| Switch between estimates | Within project detail page |

---

## 6. Problems & Risks Identified

### PROBLEM 1: Missing Layout Hierarchy for Data Context (SEVERITY: HIGH)

The current `(protected)/layout.tsx` provides auth context but there is no mechanism for project-level or estimate-level layouts. Without these intermediate layouts:
- Every nested page must independently fetch project/estimate data.
- Breadcrumbs cannot be data-aware without a client-side fetch.
- Page transitions within a project (e.g., from estimate list to estimate editor) will re-render the entire shell because there is no shared project layout.

**Fix:** Create `[projectId]/layout.tsx` and `[estimateId]/layout.tsx` as part of Phase 1B.

### PROBLEM 2: Sidebar Has No Icons (SEVERITY: MEDIUM)

The current sidebar shows text labels when expanded but shows NOTHING when collapsed (`!collapsed && item.label` renders null when collapsed). This means collapsed sidebar is entirely empty -- unusable.

**Fix:** Add icons to sidebar nav items. When collapsed, show icons only. When expanded, show icon + label.

### PROBLEM 3: Auth Pages Are Entirely Client Components (SEVERITY: LOW)

The sign-in and sign-up pages are entirely `"use client"`. This ships unnecessary JS. The page shell (layout, metadata) should be server-rendered, with only the form as a client component.

**Fix:** Extract `<SignInForm>` and `<SignUpForm>` as client components. Make `page.tsx` a server component that renders the form.

### PROBLEM 4: No Loading States for Deep Routes (SEVERITY: MEDIUM)

Only `(protected)/loading.tsx` exists. Deep routes like `/projects/[projectId]/estimates/[estimateId]` need their own `loading.tsx` files for meaningful loading skeletons. A generic top-level spinner for the entire estimate editor page is bad UX.

**Fix:** Add `loading.tsx` at `projects/`, `[projectId]/`, and `[estimateId]/` levels with appropriate skeletons.

### PROBLEM 5: Client Portal Auth Completely Separate from Supabase Auth (SEVERITY: MEDIUM)

The PIN-protected share links use a different auth mechanism (server-side API route with bcrypt validation, no Supabase session). The `(client)` route group needs its own middleware logic that:
- Does NOT require Supabase auth.
- Validates the share token + PIN via server-side session/cookie.
- Applies rate limiting.

This is architecturally sound (per Decision 18 in INTENT.md) but means the `(client)` route group cannot reuse `(protected)` middleware. It needs its own API route handler for validation and a lightweight session mechanism.

### PROBLEM 6: Plan Says Phase 1B Builds Tree UI But Has No Route Architecture (SEVERITY: HIGH)

The approved plan's Phase 1B section (lines 1584-1656 of the plan file) lists 6 sub-phases but provides ZERO guidance on route structure, component architecture, or state management patterns. It lists deliverables ("Snapshot browser panel", "Catalog browser panel") without specifying WHERE in the application these panels live, how they relate to routes, or how data flows.

This analysis fills that gap, but the plan needs to be updated with route architecture before implementation begins.

### PROBLEM 7: Estimate Editor Page Will Be the Most Complex Component in the App (SEVERITY: HIGH)

The estimate editor page needs to handle:
- Tree rendering (500-2000 nodes)
- Node selection and detail editing
- Multiple panel layout (tree + detail + optional side panels)
- State management via useReducer for two mutation sources
- Keyboard navigation
- Drag-and-drop (Phase 10)
- Real-time collaboration (Phase 2)
- Option indicators and management (Phase 1B-3)
- Snapshot creation/restore (Phase 1B-1)
- Catalog insertion (Phase 1B-2)
- Search/filter (Phase 1B-5)

This page MUST be designed with extensibility in mind from the start. If the initial tree editor is built as a monolithic component, adding options/snapshots/catalog later will require rewriting it (Failure Mode 3 from previous attempts).

**Recommendation:** Use a compound component pattern with a shared context/reducer. Each feature (snapshots, catalog, options, search) plugs into the editor as a panel that dispatches to the shared reducer. The tree itself is a pure rendering component that reads from the reducer state.

---

## 7. Recommendations Summary

### MUST DO (Phase 1B prerequisites)

1. Create `[projectId]/layout.tsx` with project data fetching and breadcrumb contribution.
2. Create `[estimateId]/layout.tsx` with estimate metadata fetching.
3. Add icons to sidebar nav items (fix collapsed state).
4. Add `loading.tsx` at each route level with appropriate skeletons.
5. Design the `EstimateEditor` component architecture BEFORE building the tree UI -- compound component pattern with reducer-based state.
6. Create React `cache()` wrappers for shared data fetching between layouts and pages.

### SHOULD DO (Phase 1B implementation)

7. Extract sign-in/sign-up into server page + client form pattern.
8. Implement client-side `<Breadcrumbs>` component using `usePathname()` + `useParams()`.
9. Add `(client)` route group skeleton for future client portal.
10. Add project detail tabs (Overview | Estimates) as client-side tab state.

### CONSIDER (Phase 2+)

11. Intercepting routes for create modals.
12. Parallel routes for side-by-side comparisons.
13. Command palette (Ctrl+K) for global navigation.
14. URL state encoding for tree expansion state (debatable -- may not be worth it).

---

## 8. Route Implementation Order (Aligned with Phase 1B Sub-Phases)

Given the plan's Phase 1B sub-phases, routes should be built in this order:

### Step 0: Route Infrastructure (Before 1B-1)
- Create `[projectId]/layout.tsx`, `[estimateId]/layout.tsx`
- Add `loading.tsx` at each level
- Add breadcrumb component
- Fix sidebar icons
- Build the `EstimateEditor` shell (tree panel + detail panel, without feature panels)

### Step 1: Tree UI (1B-0, not in plan but implicit)
- `/projects` -- project list with CRUD
- `/projects/[projectId]` -- project detail with estimate list
- `/projects/[projectId]/estimates/new` -- create estimate
- `/projects/[projectId]/estimates/[estimateId]` -- THE TREE EDITOR

### Step 2: Snapshots (1B-1)
- Add snapshot panel to estimate editor (not a new route, just a panel)
- `/projects/[projectId]/estimates/[estimateId]/snapshots/[snapshotId]` -- snapshot viewer (new route)

### Step 3: Catalog (1B-2)
- `/catalog` -- catalog browser (new top-level route)
- Add catalog insertion panel to estimate editor

### Step 4: Options (1B-3)
- Add option management panel to estimate editor (no new routes needed)

### Step 5: Client Portal (1B-4)
- `(client)/share/[token]` -- new route group + pages

### Step 6: Search (1B-5)
- Add search component to estimate editor toolbar (no new route)
- Optional: `/search` results page for global search

### Step 7: Settings (1B-6)
- `/settings/company`, `/settings/preferences`, `/settings/users`
