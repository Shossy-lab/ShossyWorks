# Cluster 5: Figma Prototype Integration Strategy

**Research Agent:** Figma Integration Specialist
**Date:** 2026-04-09
**Sources:** Comprehensive Analysis, Historical Context Brief, Attempt 1 (EP) Reference, Attempt 2 (Soloway) Reference, DESIGN-SYSTEM.md, INTENT.md, globals.css, Figma MCP Server Capabilities, Global Memory (Figma Import Pending)

---

## Research Question 1: Optimal Workflow for Extracting UI Patterns from Figma into Code

### The Problem

Zac has Figma Make prototypes covering estimates, dashboard, and login pages. The prototypes represent his visual direction -- the "this is what I want it to feel like" reference. However, three failure modes must be avoided:

1. **Cargo-cult extraction** -- copying Figma pixel values into code without mapping them to the existing token system, producing hardcoded styles that violate the foundational design rule.
2. **Over-extraction** -- treating every Figma decision as final when some may be aspirational sketches, not binding specifications.
3. **Under-extraction** -- ignoring Figma entirely and building "clean but generic" UI that Zac rejects as "AI slop."

### Recommended Workflow: Extract-Map-Reconcile-Implement

**Step 1: Structured Figma Review (Zac + Claude, 30-60 min)**

For each Figma screen, classify every design decision into one of three categories:

| Category | Definition | Example | Action |
|----------|-----------|---------|--------|
| **Binding** | "This is exactly what I want" | Overall layout proportions, navigation structure, information hierarchy | Implement faithfully using existing tokens |
| **Directional** | "This is the vibe, but details can change" | Color palette feel, spacing density, visual weight distribution | Extract the intent, map to closest tokens, propose adjustments |
| **Exploratory** | "I was trying something, not sure if it works" | A specific animation, an unusual layout experiment | Note it, defer to implementation checkpoint review |

**Step 2: Design Token Extraction**

For each binding/directional element, use the Figma MCP `get_design_context` tool to extract:
- Color values (map to existing `--color-*` tokens or propose new ones)
- Spacing values (map to existing `--space-*` scale)
- Typography choices (font, weight, size -- map to `--text-*` and `--font-*` tokens)
- Layout proportions (sidebar width, content areas, panel splits)
- Shadow/elevation usage
- Border treatments

Critical rule: **Every extracted value must map to a token.** If a Figma value does not match an existing token, the options are:
1. Map it to the nearest existing token (preferred -- maintains consistency)
2. Add a new token to globals.css AND DESIGN-SYSTEM.md (if the value represents a genuinely new concept)
3. Flag it for discussion with Zac (if the value conflicts with established design principles)

**Step 3: Information Architecture Extraction**

Separately from visual styling, extract the structural decisions:
- What data appears on each screen?
- What is the information hierarchy (what is primary, secondary, tertiary)?
- What navigation patterns are used?
- What interaction models are implied (click targets, hover states, edit modes)?
- How does the layout respond to different amounts of data?

These decisions transfer regardless of token values and are often the most valuable part of a prototype.

**Step 4: Implementation with Token Mapping**

Build components using ONLY design tokens, with Figma as the reference for proportion, hierarchy, and layout -- never for raw values. The implementation should pass this test:

> "If I changed every token value in globals.css, would the layout still make sense?"

If yes, the extraction was done correctly. If specific pixel values from Figma leaked into component code, the extraction failed.

---

## Research Question 2: How the Figma MCP Server Should Be Used During Development

### Available Figma MCP Tools and Their Roles

The Figma MCP server provides several tools. Here is how each should be used in the ShossyWorks workflow:

| Tool | Purpose | When to Use | When NOT to Use |
|------|---------|-------------|-----------------|
| `get_design_context` | **Primary tool.** Returns reference code, screenshot, and metadata for a Figma node. | First pass on any Figma screen -- understand layout, extract structure, get a screenshot for reference. | Do not use the returned code as production code. It is React+Tailwind reference only. |
| `get_screenshot` | Returns a visual screenshot of a specific node. | Quick visual reference during implementation. Comparing "what Figma shows" vs "what the component renders." | Not a substitute for `get_design_context` which provides structured data alongside the screenshot. |
| `get_metadata` | Returns XML structure of a Figma node (layers, positions, sizes). | Understanding the layer hierarchy when `get_design_context` output is too large. Mapping which elements are siblings vs nested. | Not for getting design values -- use `get_design_context` for that. |
| `get_variable_defs` | Returns variable definitions (tokens) used in the Figma file. | **Critical for token reconciliation.** Shows what design variables Figma uses (e.g., `icon/default/secondary: #949494`). Enables direct comparison with globals.css tokens. | N/A -- always use this when Figma variables exist. |
| `search_design_system` | Searches for components, variables, and styles in Figma libraries. | Finding specific design system assets when building a component. | ShossyWorks may not have a Figma library -- more relevant for teams with mature Figma setups. |
| `add_code_connect_map` / `get_code_connect_map` | Maps Figma components to codebase components. | **After** shared components are built (Phase 1B-0.0). Creating bidirectional links between Figma design components and their code implementations. | Before any code exists -- mapping requires working components to map to. |
| `use_figma` | Executes JavaScript against the Figma Plugin API. | Advanced scenarios: batch-extracting token values, programmatically reading properties across many nodes. | Routine design review -- `get_design_context` is simpler and sufficient. |

### Recommended MCP Usage Pattern Per Phase

**Phase 1B-0.0 (Shared Components):**
1. `get_design_context` on each Figma page to capture layout and component patterns
2. `get_variable_defs` to extract any Figma-defined tokens
3. `get_screenshot` for visual reference during implementation
4. Compare extracted tokens against globals.css -- reconcile differences
5. After components are built, `add_code_connect_map` to link Figma nodes to code

**Phase 1B-0.1 through 1B-0.4 (Feature Pages):**
1. `get_screenshot` of relevant Figma screens as visual reference
2. `get_design_context` only for screens where layout/structure is unclear
3. Cross-reference against established token mappings from Phase 1B-0.0

**Ongoing (Any UI Session):**
1. `get_screenshot` for quick "does my implementation match the intent?" comparisons
2. `get_code_connect_map` to verify components stay mapped to their Figma counterparts

### What `get_design_context` Returns and How to Interpret It

The tool returns React+Tailwind enriched code as a **reference**, not final code. The adaptation rules for ShossyWorks:

| Figma MCP Output | ShossyWorks Adaptation |
|-------------------|----------------------|
| Tailwind color classes (e.g., `bg-gray-50`) | Replace with token: `bg-[var(--color-bg-secondary)]` |
| Rounded corners (`rounded-lg`, `rounded-md`) | Replace with `rounded-none` (containers) or `rounded-full` (buttons) |
| Hardcoded spacing (`p-4`, `gap-6`) | Map to spacing tokens: `p-[var(--space-4)]`, `gap-[var(--space-6)]` |
| Absolute positioning | Convert to Flexbox/Grid with token-based spacing |
| Inline styles | Extract to CSS custom properties or Tailwind utilities |
| Component suggestions | Check if Radix UI primitive exists first; never adopt shadcn/ui patterns |

---

## Research Question 3: Process for Zac to Provide Figma Design Direction

### The Goal: Maximum Design Input, Minimum Friction

Zac is not a developer. He should not need to learn Figma conventions, export formats, or CSS token syntax. The process must meet him where he is: he has visual opinions, he can point at things and say "like this" or "not like that," and he can compare options.

### Recommended Process: Three Touchpoints

**Touchpoint 1: The Figma Walkthrough (30-60 min, one-time, BLOCKING)**

This is the CP-0/CP-1 checkpoint conversation. Zac shares Figma file links. The process:

1. **Zac shares the Figma URL(s).** No export needed -- the Figma MCP can read directly from URLs.
2. **Claude captures screenshots and design context** for each page via `get_design_context` and `get_screenshot`.
3. **For each screen, Zac answers three questions:**
   - "What on this screen is exactly right?" (Binding decisions)
   - "What on this screen captures the vibe but could change?" (Directional decisions)
   - "What on this screen was experimental?" (Exploratory -- ignore for now)
4. **Claude produces a token mapping table** showing: Figma value -> closest existing token -> proposed action (use existing / add new / modify existing).
5. **Zac reviews the mapping table.** No code review needed -- just "yes that mapping looks right" or "no, this color should be darker."

Deliverable: `research/ui/prototype-extraction.md` with per-element decisions.

**Touchpoint 2: Visual Direction Checkpoints (5-15 min each, recurring)**

After each implementation milestone (CP-1 through CP-3), Zac reviews deployed output:

- **Format:** Deployed preview URL (Vercel preview deployment) + 2-3 screenshots comparing Figma intent vs actual implementation.
- **Zac's required action:** Thumb up/down on each screenshot. If down, one sentence on what feels wrong.
- **Claude's action:** Adjust tokens/layout, push update, re-request review.
- **Turnaround:** Same session. No multi-day review cycles for visual direction.

**Touchpoint 3: Annotated Feedback (async, non-blocking)**

For ongoing feedback outside formal checkpoints:
- Zac can use **Figma comments/annotations** directly on design screens. Claude reads these via `get_design_context` which includes design annotations.
- Zac can use **Vercel Toolbar threads** (available via MCP) to leave feedback on deployed previews. Claude reads these via `list_toolbar_threads` and `get_toolbar_thread`.
- For quick feedback: Zac takes a screenshot, circles what bothers him, drops it in the Claude Dropbox or describes it in chat.

### What Zac Should NOT Be Asked To Do

- Export Figma frames as images (Claude can screenshot directly)
- Specify CSS values or token names
- Review code diffs for visual changes
- Make decisions about technical implementation (Radix vs custom, useReducer vs Zustand)
- Approve changes individually when batch approval suffices

---

## Research Question 4: What to Extract from EP vs Soloway vs Figma

### Extraction Matrix

| Source | Extract | Do NOT Extract | Rationale |
|--------|---------|---------------|-----------|
| **EP (Attempt 1)** | -- | Everything | Wrong architecture. 46-column monolithic table produced UI coupled to that schema. Zero lines of EP code should enter ShossyWorks. The only value is scope awareness: EP shows the BREADTH of fields an estimating UI must handle. |
| **Soloway (Attempt 2)** | Tree UX patterns, Option panel UX, Real-time sync patterns, Per-row aggregation display | Code, Components, State management, Schema references, Auth flow | Soloway proved specific UX PATTERNS work: progressive disclosure via expand/collapse, option bubble-up indicators, inline option panels, Supabase Realtime for live selection sync. The patterns are validated. The code is built on immutable data assumptions and cannot be reused. |
| **Figma** | Visual direction, Layout proportions, Information hierarchy, Navigation structure, Component styling intent | Raw pixel values, Hardcoded colors, Specific spacing numbers, Font sizes as absolute values | Figma provides what no codebase can: Zac's visual opinion. Extract the INTENT (proportions, hierarchy, density, feel) and map to tokens. Never extract raw values. |

### Detailed Extraction: Soloway Patterns to Preserve

These are the specific UX patterns from Soloway that the review board unanimously agreed should carry forward:

**1. Progressive Disclosure Tree (HIGH PRIORITY)**
- Depth-based visual formatting: deeper nodes are visually lighter (thinner font weight, smaller text, more indentation)
- Expand/collapse with chevron rotation
- Lazy expansion (children hidden until parent expanded)
- Token mapping: Use `--text-lg`/semibold for groups, `--text-sm`/medium for items, `--color-text-secondary` for deeper nesting

**2. Option Selection UX (MEDIUM PRIORITY -- Phase 1B-3)**
- Inline option panels that expand below the parent node
- Bubble-up indicators (small badge on parent showing "3 options available")
- Overview modal showing all options across the estimate
- Option Sets as scenario previews (overlay without database write)

**3. Real-Time Sync Pattern (MEDIUM PRIORITY -- Phase 1B+)**
- Supabase Realtime channel per open estimate
- Presence indicators showing who is viewing/editing which node
- Live option selection visible to all connected users

**4. Per-Row Aggregation Display (HIGH PRIORITY)**
- Parent rows show SUM of children's actual amounts, not reapplied global rates
- Contingency and overhead shown as both rate AND amount per row
- Total column is always visible

### Detailed Extraction: Figma Elements to Map

Based on the memory files confirming Figma prototypes cover estimates, dashboard, and login:

| Figma Page | Extract As | Maps To |
|-----------|-----------|---------|
| **Login** | Visual style reference | Auth pages already exist -- extract color/typography/layout feel and reconcile with current tokens |
| **Dashboard** | Layout + information hierarchy | Dashboard page exists as placeholder -- extract card layout, data density, navigation patterns |
| **Estimates** | **CRITICAL: Layout + tree structure + information hierarchy** | The estimate tree page is the core product. Extract: sidebar vs content proportions, tree row height/density, column layout, detail panel positioning, toolbar design |

For the estimates page specifically, the extraction must answer:
- Does Figma show a tree-table (rows + columns) or a tree-list (rows only)?
- Does Figma show a side panel for editing, or inline editing?
- What information density does Figma target? (compact/default/comfortable)
- How does Figma handle the group/assembly/item type distinction visually?
- Does Figma show cost totals inline in tree rows?

---

## Research Question 5: Reconciling Figma Tokens with DESIGN-SYSTEM.md

### Current State of the Token System

The ShossyWorks design system is already established in `globals.css` with:
- 21 color tokens (backgrounds, surfaces, borders, text, interactive, semantic)
- 12 spacing tokens (0 through 16 on the 4px grid)
- 9 typography tokens (sizes xs through 3xl, weights 400-700)
- 3 radius tokens (none, full -- no in-between)
- 3 shadow tokens (sm, md, lg)
- 4 layout tokens (sidebar width/collapsed, header height, content max-width)
- 3 transition tokens (fast, normal, slow)

### Reconciliation Process

When Figma tokens are extracted via `get_variable_defs`, three scenarios arise:

**Scenario A: Figma value matches an existing token**
Action: No change needed. Document the mapping in `research/ui/prototype-extraction.md`.
Example: Figma uses `#ffffff` for backgrounds -> maps to `--color-bg-primary: #ffffff`. Done.

**Scenario B: Figma value is close but not identical to an existing token**
Action: Determine whether the difference is intentional or incidental.
- If incidental (e.g., Figma uses `#f4f4f4` vs token `#f5f5f5`): Use the existing token. Figma prototypes are not pixel-perfect specifications.
- If intentional (e.g., Figma uses a warm gray `#f5f0eb` vs the cool gray `#f5f5f5` in tokens): This is a design direction conversation. Present both to Zac.

**Scenario C: Figma uses a value with no existing token equivalent**
Action: Evaluate whether a new token is needed.
- If the value fills a genuine gap (e.g., Figma uses an accent color that the token system lacks): Add the token to `globals.css` AND `DESIGN-SYSTEM.md` simultaneously.
- If the value is redundant (e.g., Figma uses 5 shades of gray where the token system has 3): Use the closest existing token. More tokens != better design system.

### Token Reconciliation Table Template

This table should be produced during the Figma walkthrough and committed to `research/ui/prototype-extraction.md`:

```markdown
| Figma Element | Figma Value | Closest Token | Match | Action |
|---------------|-------------|---------------|-------|--------|
| Page background | #f5f5f5 | --color-bg-secondary | Exact | Use existing |
| Card background | #ffffff | --color-surface | Exact | Use existing |
| Primary text | #1a1a1a | --color-text-primary (#0a0a0a) | Close | Ask Zac: is darker intentional? |
| Accent button | #2563eb | --color-info (#2563eb) | Exact | Use existing (or add --color-accent if distinct from info) |
| Tree row height | 36px | No token | Gap | Add --tree-row-height: 36px? Or use density system |
```

### Tokens the Figma Extraction Will Likely Add

Based on the comprehensive analysis and design-ux analysis, these token gaps are anticipated:

| Token | Purpose | Expected Value |
|-------|---------|---------------|
| `--tree-row-height-compact` | Tree row height in compact mode | 24px |
| `--tree-row-height-default` | Tree row height in default mode | 32px |
| `--tree-row-height-comfortable` | Tree row height in comfortable mode | 40px |
| `--tree-indent-width` | Per-level indentation in tree | 24px |
| `--detail-panel-width` | Side panel width for node editing | 400px (or from Figma) |
| `--color-accent` | Brand accent color (if Figma introduces one beyond the monochrome palette) | TBD from Figma |
| `--color-row-hover` | Tree row hover background | TBD from Figma |
| `--color-row-selected` | Selected row background | TBD from Figma |
| `--color-depth-*` | Depth-based text colors for tree nesting levels | TBD from Figma |

These should only be added after the Figma walkthrough confirms their values. Do not pre-create tokens speculatively.

---

## Research Question 6: Structured Feedback Process for Zac to Approve UI Decisions Without Blocking Development

### The Core Tension

Zac must approve visual direction (this is HIS product, "generic AI slop" is explicitly rejected). But Zac is busy running a construction company. The feedback process must be:
- **Fast** -- 5-15 minutes per checkpoint, not hours
- **Visual** -- screenshots and deployed previews, not code reviews
- **Decisive** -- clear approve/reject/modify, no ambiguous "looks okay I guess"
- **Non-blocking where possible** -- development continues on approved foundations while visual polish feedback is gathered

### Three-Tier Decision Framework

This framework matches the comprehensive analysis (Section 4) and applies it specifically to the Figma integration workflow:

**Tier 1: BLOCKING Decisions (Must resolve before implementation starts)**

| Decision | Format | Zac's Action | Time |
|----------|--------|-------------|------|
| Figma walkthrough -- what to extract | Live conversation, Claude screenshots Figma pages | Classify each element as Binding/Directional/Exploratory | 30-60 min |
| Token reconciliation table approval | Markdown table comparing Figma values to existing tokens | Approve mappings, flag disagreements | 10-15 min |
| Layout architecture approval | Wireframe screenshot showing sidebar + tree + detail panel | "Yes this is the right structure" or "No, I want X instead" | 10 min |

These happen ONCE, at the start. After these are resolved, development can proceed for weeks without blocking on Zac.

**Tier 2: REVIEW Decisions (Build first, then Zac validates)**

| Decision | Deliverable | Zac's Action | Time | Blocking? |
|----------|------------|-------------|------|-----------|
| Shared component look | Deployed preview with buttons, inputs, cards, icons | "This feels right" or "This feels generic" | 10 min | YES -- blocks feature work if rejected |
| Project list page | Deployed preview | "Does this feel like ShossyWorks?" | 5 min | YES -- blocks further pages |
| Tree view interaction | Working tree on his device | 15 min using it, report what feels wrong | 15-30 min | YES -- blocks remaining tree work |
| Font choice | Side-by-side screenshots (Inter vs alternatives) | Pick one | 5 min | NO -- can swap later |
| Icon style | 10 common icons rendered with each library | Pick one | 5 min | NO -- can swap later |

**Tier 3: INFORM Decisions (Document choice, Zac sees it when the feature ships)**

| Decision | Examples |
|----------|---------|
| Animation timing | 200ms expand/collapse, 100ms hover transitions |
| Loading skeleton style | Pulse animation on secondary background |
| Error state presentation | Inline error messages with red text |
| Focus ring style | 2px solid on border-focus color |
| Toast positioning | Bottom-right, auto-dismiss after 5s |

Inform decisions do NOT need approval. They follow from the design system and industry conventions. If Zac dislikes one after seeing it, it can be changed without architectural impact.

### Async Feedback Channels (Non-Blocking)

For ongoing, non-checkpoint feedback:

1. **Vercel Preview Comments** -- Every push creates a preview deployment. Zac can use the Vercel Toolbar to leave contextual comments on specific UI elements. Claude reads these via the Vercel MCP (`list_toolbar_threads`). This is the lowest-friction feedback mechanism.

2. **Figma Annotations** -- If Zac wants to annotate the original Figma designs with "make it more like this" or "less like this," those annotations are readable via `get_design_context`.

3. **Chat Descriptions** -- Zac describes what bothers him in plain language. Claude interprets, proposes a fix, deploys it to preview, and asks for re-review.

4. **Screenshot Feedback** -- Zac takes a screenshot, marks it up (circle, arrow, text), drops it in the Claude Dropbox. Claude reads it and acts on it.

### Feedback SLA

| Feedback Type | Expected Turnaround | Impact if Delayed |
|---------------|-------------------|-------------------|
| Blocking decision | Same session | Development stops |
| Review checkpoint | Within 24 hours | Development continues on approved foundation, defers polish |
| Async feedback | Next session | Incorporated into ongoing work |
| Inform notification | No response needed | None |

### Anti-Patterns to Avoid

1. **"What do you think?" without constraints.** Never ask Zac an open-ended design question. Always present 2-3 specific options with screenshots.
2. **Requesting code review for visual changes.** Zac should see deployed output, not diffs.
3. **Batching too many decisions.** Never put more than 3 decisions in a single checkpoint. Cognitive overload leads to "looks fine" responses that are not real approvals.
4. **Treating "no response" as approval.** Explicitly confirm that silence means a specific thing. Recommended: "If I don't hear back within 24 hours, I'll proceed with Option A."
5. **Re-asking settled decisions.** Once a Tier 1 decision is made, it is made. Do not re-open it unless Zac explicitly requests it.

---

## Summary of Key Findings

### Critical Path

1. **Figma walkthrough is the first UI action** -- before any Phase 1B code, Zac must share Figma URLs and classify what to extract (30-60 min).
2. **Token reconciliation follows immediately** -- extract values via `get_variable_defs` and `get_design_context`, produce mapping table, get Zac's approval (10-15 min).
3. **Then development proceeds** with Figma as visual reference and tokens as the implementation mechanism.

### What to Extract (Source Summary)

| Source | Value | Priority |
|--------|-------|----------|
| EP | Nothing except scope awareness | N/A |
| Soloway | Tree UX patterns, option panel UX, real-time sync, per-row aggregation | HIGH |
| Figma | Visual direction, layout, information hierarchy, navigation | CRITICAL |

### How to Use Figma MCP

| Phase | Primary Tool | Purpose |
|-------|-------------|---------|
| Pre-implementation | `get_design_context` + `get_variable_defs` | Extract and reconcile |
| During implementation | `get_screenshot` | Visual reference |
| Post-implementation | `add_code_connect_map` | Link components to designs |
| Ongoing | `get_screenshot` + Vercel Toolbar | Compare and gather feedback |

### Token Reconciliation Rule

**Figma values are INPUT to the token system, not overrides of it.** The token system is the source of truth. Figma informs token values. Components consume tokens. At no point does a raw Figma value appear in a component file.

### Feedback Process

Three tiers: Blocking (once, at start), Review (at checkpoints, with deployed previews), Inform (no action needed). Async feedback via Vercel Toolbar, Figma annotations, or chat descriptions. Maximum 3 decisions per checkpoint. Always present options, never open-ended questions.
