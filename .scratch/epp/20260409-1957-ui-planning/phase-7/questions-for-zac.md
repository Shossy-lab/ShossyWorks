# ShossyWorks UI -- Questions & Input Needed from Zac

**Date:** 2026-04-09
**Context:** The UI implementation plan has been analyzed by 10 specialist agents across two review rounds and is unanimously APPROVED. Before we write a single line of UI code, we need your input on the decisions below.

---

## How to Use This Document

This contains everything we need from you before starting UI development. Work through it at your own pace -- most decisions take 1-5 minutes.

**Three tiers:**
- **BLOCKING** (D1-D6) -- Must answer before ANY work starts. Without these, agents cannot begin coding.
- **IMPORTANT** (D7-D10) -- Must answer before specific phases. You have time, but we need them before we get to those features.
- **NICE-TO-HAVE** (D11-D13) -- Can decide during development. We have sensible defaults.

For each decision, we provide context, our recommendation, and a simple way to respond (often just "Approved" or picking A/B/C).

---

## BLOCKING DECISIONS (Must Answer Before We Start)

### D1: Figma Prototype Discussion

**What this is about:** You have Figma Make prototypes for estimates, dashboard, and login. Before we start building, we need to understand what role those designs play.

**Why it matters:** The review board built this plan around a specific architecture (sidebar + tree + side panel). If your Figma designs show something fundamentally different, we need to know now -- not after we have built three sessions of code.

**What we need from you:**

When you are ready, share the Figma links and walk us through them. Before that conversation, think about these questions:

1. **Which screens represent your VISION?** These are the ones where you said "yes, this is what I want." We will match these closely.

2. **Which screens are EXPLORATORY?** These are the ones where you were trying things out, not committed to a direction. We will take inspiration but not follow them literally.

3. **Are there specific screens that are "this is exactly what I want"?** Point them out. These become our north star.

4. **Are there screens that are "directionally right but needs work"?** These tell us what feeling you are going for without locking us into specific layouts.

5. **What should we pull from each source?**
   - From EP: what worked in terms of data display or workflow?
   - From Soloway: the tree rendering with expand/collapse, option selection, real-time sync
   - From Figma: layout? color? typography? information hierarchy? all of the above?

**Our commitment:** Figma values (colors, spacing, fonts) will be mapped to design tokens. We will never hardcode a Figma value directly. If Figma shows rounded corners on containers, we will NOT follow that -- your design system says sharp corners, and we enforce that. But if Figma shows a specific layout flow or information hierarchy, we want to hear about it.

**Estimated time:** 30-60 minute conversation. Can be async (you annotate the Figma files) or live.

**Your response:** Share Figma links when ready. We will schedule the walkthrough as part of CP-0.

---

### D2: Tree View Design Direction

**What this is about:** The estimate tree is the core of the entire product. How it looks and feels determines whether ShossyWorks is pleasant to use or frustrating.

**Why it matters:** This decision shapes the most complex component we will build. Changing direction after it is built would be very expensive.

**The two main approaches:**

**Option A: Tree-Dominant (recommended)**
The tree is the main view. Each row shows the node name with indentation to show hierarchy, plus a total on the right. Clicking a node opens its full details in a side panel.

```
+------------------------------------------------------------------+
| Sidebar |  TREE                              | DETAIL PANEL       |
|         |                                    |                    |
| Dash    |  v Foundation Work        $45,200  | Item: Rebar #4     |
| Projects|    v Excavation           $12,800  | ---------------    |
| Catalog |      Topsoil Removal       $3,200  | Qty: 2,400  lf    |
| Settings|      Rock Excavation       $6,100  | Unit Cost: $1.85   |
|         |      Backfill              $3,500  | Material:  $4,440  |
|         |    v Concrete              $32,400  | Labor:     $2,160  |
|         |      Footings             $14,200  | Markup:    15%     |
|         |      Grade Beams           $8,900  | Total:     $7,590  |
|         |      > Rebar #4            $7,590  | ---------------    |
|         |      Slab on Grade         $1,710  | Notes: 3           |
|         |  v Framing                 $89,300  | Vendor: ABC Steel   |
|         |    ...                              |                    |
+------------------------------------------------------------------+
| Status: 847 nodes | Total: $1,234,567 | Draft                    |
+------------------------------------------------------------------+
```

- Clean, focused tree view
- Full details in the side panel (20+ fields for items)
- Panel is always visible alongside the tree
- Similar to VS Code, Figma, or file explorer interfaces

**Option B: Spreadsheet-Hybrid**
The tree has multiple data columns visible inline, more like a spreadsheet.

```
+------------------------------------------------------------------+
| Sidebar |  NAME                QTY   UNIT  $/UNIT   TOTAL         |
|         |  ------------------------------------------------      |
| Dash    |  v Foundation Work                        $45,200      |
| Projects|    v Excavation                           $12,800      |
| Catalog |      Topsoil Removal  400   cy    $8.00    $3,200      |
| Settings|      Rock Excavation  220   cy    $27.73   $6,100      |
|         |      Backfill         180   cy    $19.44   $3,500      |
|         |    v Concrete                             $32,400      |
|         |      Footings         85    cy    $167.06  $14,200     |
|         |      Grade Beams      42    cy    $211.90   $8,900     |
|         |      > Rebar #4     2400    lf     $3.16    $7,590     |
|         |      Slab on Grade   150    sf    $11.40    $1,710     |
|         |  v Framing                                $89,300      |
+------------------------------------------------------------------+
```

- More data visible without clicking
- Feels like Excel / Google Sheets
- Side panel may still exist but is less prominent
- More visually dense

**Our recommendation:** Option A (Tree-Dominant) for Phase 1B. The side panel keeps the tree clean and avoids the complexity of cramming 20+ item fields into inline columns. Option B elements (inline qty/unit columns) can be added in Phase 2 as a user preference.

**Your response:** "A", "B", or "I want to discuss this more."

---

### D3: Layout Wireframe

**What this is about:** The overall page layout -- where things go on screen.

**Why it matters:** This is the shell that everything else lives inside. Changing it later means reworking every page.

**Option A: Fixed Sidebar (recommended)**

```
+------+--------------------------------------------------+
|      |  Logo    Breadcrumbs: Projects > 123 Main > Est  |
| SIDE |--------------------------------------------------|
| BAR  |                                                  |
|      |  [Main Content Area]                             |
| Dash |                                                  |
| Proj |  (Tree + Detail Panel when on estimate page)     |
| Cat  |  (Project list when on projects page)            |
| Set  |  (Settings form when on settings page)           |
|      |                                                  |
+------+--------------------------------------------------+
|  Status bar                                             |
+---------------------------------------------------------+
```

- Sidebar is always visible (collapses to icons on narrow screens)
- Breadcrumbs show where you are: Dashboard > Projects > "123 Main St" > Estimates > "Base Bid"
- Main content area changes based on the page
- Status bar at the bottom shows context info

**Option B: Full-Width with Slide-Out**

```
+---------------------------------------------------------+
|  [=]  Logo    Breadcrumbs                               |
|---------------------------------------------------------|
|                                                         |
|  [Main Content Area - Full Width]                       |
|                                                         |
|  Sidebar slides in/out from left when hamburger         |
|  menu [=] is clicked                                    |
|                                                         |
+---------------------------------------------------------+
```

- More horizontal space for the tree/content
- Sidebar hidden by default, opens on demand
- Feels more like a mobile app

**Our recommendation:** Option A. Construction estimating is overwhelmingly desktop work. You want the navigation always visible -- you are constantly switching between projects, estimates, catalog, and settings. A hidden sidebar adds clicks to every navigation action.

**Your response:** "A", "B", or your own preference.

---

### D4: Component Library Approach

**What this is about:** Under the hood, we need to build buttons, dropdown menus, dialog boxes, tooltips, and other interactive elements. We have a choice about how to build them.

**Why it matters:** Building all interactive UI elements from scratch takes 3-4 extra weeks and risks accessibility bugs (screen readers, keyboard navigation). Using a proven foundation saves time and ensures the app works for everyone.

**Our recommendation: Radix UI**

Radix UI provides the behavior and accessibility of interactive elements (focus management, keyboard navigation, screen reader support) with ZERO visual styling. We wrap each Radix component with your design system tokens, so it looks exactly like ShossyWorks -- not like a generic template.

What Radix gives us:
- Dialog boxes that trap focus correctly
- Dropdown menus that work with keyboard
- Select dropdowns with proper accessibility
- Tooltips, toasts (notification popups), tabs
- All WAI-ARIA compliant out of the box

What Radix does NOT give us (we build these ourselves):
- The estimate tree (fully custom)
- Field components (text, number, currency, percentage inputs)
- Layout components (sidebar, split panels, page headers)
- All visual styling

**Important:** We specifically rejected shadcn/ui (a popular alternative). Its copy-paste model and default rounded corners fight your design system. Radix primitives give us the behavior without any styling opinions.

**Your response:** "Approved" or "I want to discuss this more."

---

### D5: Information Density

**What this is about:** Construction estimates have a LOT of data. How tightly packed should the UI be?

**Why it matters:** Too sparse wastes screen space and forces excessive scrolling. Too dense makes the interface overwhelming and error-prone.

**Option A: Spacious**
```
v Foundation Work                                    $45,200

    v Excavation                                     $12,800

        Topsoil Removal                               $3,200

        Rock Excavation                               $6,100
```
- 50px row height, 15px font, generous padding
- Easy to read, fewer items visible at once
- Good for reviewing, presenting to clients

**Option B: Default (recommended)**
```
v Foundation Work                                    $45,200
    v Excavation                                     $12,800
        Topsoil Removal                               $3,200
        Rock Excavation                               $6,100
        Backfill                                      $3,500
```
- 40px row height, 14px font, moderate padding
- Balance of readability and information density
- Good for general use

**Option C: Compact**
```
v Foundation Work                                    $45,200
    v Excavation                                     $12,800
        Topsoil Removal                               $3,200
        Rock Excavation                               $6,100
        Backfill                                      $3,500
    v Concrete                                       $32,400
        Footings                                     $14,200
        Grade Beams                                   $8,900
```
- 30px row height, 13px font, tight padding
- Maximum items visible, spreadsheet-like density
- Good for power users who know the data well

**Our recommendation:** Build with Option B as the default. Add a toggle in Settings (and optionally in the tree toolbar) to switch between all three. The toggle is a small effort and lets you choose based on what you are doing -- compact for data entry, spacious for client reviews.

**Your response:** "B as default with toggle" or your preferred default density.

---

### D6: Phase 1B-0 Confirmation

**What this is about:** The review board identified a critical gap in the original plan -- it listed features but never allocated time to build the estimate tree itself. We added "Phase 1B-0" (5-6 sessions of foundation work) before any feature phases.

**Why it matters:** Without the tree editor, none of the features (snapshots, catalog, options, client portal) have anything to attach to. This is like trying to install cabinets before the walls are framed.

**What Phase 1B-0 builds:**
1. Reusable UI components (buttons, form fields, dialogs) -- 1 session
2. Navigation, sidebar, breadcrumbs -- 0.75 session
3. Project list, estimate list, create/edit dialogs -- 0.75 session
4. The estimate tree viewer (rendering, expand/collapse, scrolling) -- 1.5 sessions
5. The detail editing panel (item fields, assembly fields, group fields) -- 1 session
6. Tree polish (move nodes, keyboard shortcuts, right-click menus) -- 0.75 session

**Impact on timeline:** Adds 5-6 sessions to the plan. Total goes from the original 12-16 sessions to 21-27 sessions. But those original 12-16 sessions assumed the tree already existed -- they would have failed without this foundation.

**Your response:** "Confirmed" or "I want to discuss the timeline."

---

## IMPORTANT DECISIONS (Needed Before Specific Phases)

These are not blocking day-one work. We need them before we reach the relevant phase, which gives you some time.

---

### D7: Icon Library
**Needed before:** Phase 1B-0.0a (first session)

**What this is about:** Which icon set to use throughout the app. Icons appear in the sidebar, tree nodes, buttons, and status indicators.

**Options:**
- **Lucide** (recommended) -- Clean, consistent line icons. 1,500+ icons. Tree-shakeable (only icons you use get included). Matches the minimal/monochrome design language.
- **Phosphor** -- Similar style, slightly heavier weight. Good variety.
- **Heroicons** -- Made by the Tailwind CSS team. Clean but smaller set.

**Our recommendation:** Lucide. Best match for the sharp, minimal aesthetic. If you do not like how they look after seeing them in context at CP-1, we can swap to Phosphor easily because we wrap all icon imports.

**Your response:** "Lucide" or your preference. Can also defer to CP-1 (we will show you icons in context).

---

### D8: Font Selection
**Needed before:** Phase 1B-0.0b (second session)

**What this is about:** The typeface used throughout the app. Currently set to Inter (a very common, neutral sans-serif).

**Options:**
- **Inter** (current) -- Clean, highly readable, used everywhere. Very "safe" choice. Risk: can feel generic.
- **IBM Plex Sans** -- Slightly more technical/industrial feel. Good at small sizes. Would give ShossyWorks a more distinctive look.
- **Geist** -- Made by Vercel (our deployment platform). Modern, crisp. Designed specifically for interfaces.

**Our recommendation:** Keep Inter for now. After the first components are built, we will show you the same screen in all three fonts and you can pick. This is a low-risk decision -- changing fonts is a one-line CSS change.

**Your response:** "Keep Inter for now" or a specific preference.

---

### D9: Feature Priority Order
**Needed before:** CP-5 (after the foundation is complete)

**What this is about:** After the tree editor is built, we build features. The recommended order is:

| Priority | Feature | Sessions | Why This Order |
|----------|---------|----------|---------------|
| 1st | Settings & Preferences | 0.75 | Small, quick. Sets up company defaults that other features use. |
| 2nd | Search & Filtering | 1.0 | Makes the tree usable for real estimates with hundreds of items. |
| 3rd | Catalog | 2-3 | Lets you save and reuse items/assemblies across estimates. |
| 4th | Snapshots | 2-3 | Save and compare estimate versions ("what we bid" vs "what we built"). |
| 5th | Options | 2-3 | Alternates and upgrades -- your key differentiator for clients. |
| 6th | Client Portal | 3-4 | Share estimates with clients, get approvals. Needs tree + options working first. |

**Your response:** "Approved" or reorder as you see fit. You can change this at CP-5 after using the tree editor for real work.

---

### D10: Dashboard Content
**Needed before:** Phase 2 (deferred from Phase 1B)

**What this is about:** The dashboard (home screen after login) is currently a placeholder with two links. The review board recommends keeping it as a simple link hub through Phase 1B -- the tree editor is the priority. A full dashboard with stats and recent activity would come in Phase 2.

**If we were to build a dashboard, what would you want to see?**
- Active project count and total value?
- Recent estimates you have worked on?
- Quick-action buttons (new project, new estimate)?
- Summary of estimates by status (Draft, Preliminary, Active, Complete)?
- Something else?

**Your response:** "Defer to Phase 2" (recommended) or tell us what the dashboard should show. If you want a basic dashboard sooner, we can add 0.5 sessions to Phase 1B-0.2.

---

## NICE-TO-HAVE (Can Decide During Development)

These have sensible defaults. Only weigh in if you have a strong opinion.

---

### D11: Animation Philosophy
**Default:** Subtle, fast transitions. 200ms for expand/collapse with a chevron rotation. No bouncy animations, no slow fades. Quick and functional.

**Your response:** "Default is fine" or "I want to see options."

---

### D12: Keyboard Shortcut Scheme
**Default:** Standard patterns used by professional tools:
- Arrow keys: navigate tree
- Enter: select/open node
- Escape: close panel or deselect
- Ctrl+] / Ctrl+[: indent/outdent (move node deeper or shallower)
- Delete: delete node (with confirmation dialog)
- Ctrl+Z / Ctrl+Y: undo/redo

**Your response:** "Default is fine" or specific shortcuts you want.

---

### D13: Color Accents
**Default:** The current design is monochrome -- black, white, and grays. This creates the clean, minimal look you asked for.

**The question:** Do you want any color accents for specific purposes? For example:
- Status colors (green for "Active", amber for "Bidding", red for "Urgent")?
- A subtle blue for selected/focused items?
- Color-coded node types (groups vs assemblies vs items)?

The design system already has token slots for status colors (`--color-success`, `--color-warning`, `--color-error`). They just are not visually prominent right now.

**Your response:** "Keep it monochrome" or tell us where you want color.

---

## Summary: Your To-Do List

| Priority | Decision | Time Needed | How to Respond |
|----------|----------|-------------|---------------|
| BLOCKING | D1: Figma walkthrough | 30-60 min | Share links, schedule conversation |
| BLOCKING | D2: Tree view direction | 2 min | "A" or "B" |
| BLOCKING | D3: Layout wireframe | 2 min | "A" or "B" |
| BLOCKING | D4: Component library (Radix) | 1 min | "Approved" |
| BLOCKING | D5: Information density | 2 min | "B as default with toggle" or other |
| BLOCKING | D6: Phase 1B-0 confirmation | 1 min | "Confirmed" |
| IMPORTANT | D7: Icon library | 1 min | "Lucide" or other |
| IMPORTANT | D8: Font selection | 1 min | "Keep Inter" or other |
| IMPORTANT | D9: Feature priority order | 5 min | "Approved" or reorder |
| IMPORTANT | D10: Dashboard content | 2 min | "Defer to Phase 2" or specify |
| NICE-TO-HAVE | D11: Animations | 1 min | "Default is fine" |
| NICE-TO-HAVE | D12: Keyboard shortcuts | 1 min | "Default is fine" |
| NICE-TO-HAVE | D13: Color accents | 2 min | "Monochrome" or specify |

**Total time needed: ~15 minutes for quick decisions + 30-60 minutes for the Figma walkthrough.**

Once D1-D6 are answered, we start building.
