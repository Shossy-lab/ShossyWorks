# UI Research Documentation Strategy

**Research Agent Output** | 2026-04-09
**Question:** How should all UI research be documented and managed during development?

---

## 1. Where Should UI Research Documents Live?

### Recommendation: `docs/ui/` (committed to git) -- NOT `.scratch/` or `.claude/memory/`

**Rationale by location:**

| Location | Verdict | Why |
|----------|---------|-----|
| `.scratch/` | NO | Gitignored, ephemeral. Research has long-term value across sessions. `.scratch/` is for working state (briefs, agent coordination) that expires after the current workflow completes. |
| `.claude/memory/topics/` | NO | Memory topics are for persistent *cross-session knowledge* (patterns, debugging notes, architecture summaries). They are small (<1KB target), subjective, and written for the memory system's quick-scan purpose. Research docs are larger, objective, and structured differently. |
| `research/ui/` | POSSIBLE | The `research/` directory already holds architecture research (`research/output/`). Adding `research/ui/` follows the established pattern. However, `research/` was originally designed for a single pre-implementation research session. UI research is ongoing across many implementation sessions. |
| `docs/ui/` | RECOMMENDED | The `docs/` directory is the project's committed, persistent documentation. `docs/features/` already exists for feature docs. `docs/ui/` extends this naturally. It fits the documentation rules: target <5KB per file, descriptive names, split when >10KB. It signals "this is production knowledge" not "this was a one-time research exercise." |

**Key distinction:** The `research/` directory captured foundational architecture decisions *before* implementation began. UI documentation needs to survive *through* implementation and beyond -- it guides every session that touches UI. That makes it documentation, not research output.

**Proposed structure:**

```
docs/ui/
  index.md                    -- Entry point: what exists, what's decided, what's pending
  decisions/
    decision-log.md           -- Chronological log of every approved UI decision
  specs/
    tree-view.md              -- Component spec for estimate tree
    detail-panel.md           -- Component spec for node editing panel
    shared-components.md      -- Design system wrapper layer spec
    navigation.md             -- App shell, breadcrumbs, sidebar
    {component-name}.md       -- One per major component
  patterns/
    state-management.md       -- Reducer patterns, optimistic updates, Realtime prep
    interaction-patterns.md   -- Keyboard nav, context menus, drag-drop
    form-patterns.md          -- Validation, error display, field behavior
  feedback/
    zac-approvals.md          -- Chronological record of Zac's feedback and approvals
```

**Size budget:** Each file targets <3KB (matching the comprehensive analysis recommendation). The `index.md` is the only file loaded routinely; everything else is L2/L3 context pulled per-task.

---

## 2. Research Indexing for Agent Discovery

### Problem

Implementation agents need to find the right research before writing code. If they have to read every file in `docs/ui/` to find relevant findings, the context cost is prohibitive.

### Recommendation: `docs/ui/index.md` as a routing table

The index file serves as a lookup table that agents read at L2 (per-task) to identify which spec files they need.

**Format:**

```markdown
# UI Documentation Index

## Component Specs
| Component | Spec File | Status | Key Constraint |
|-----------|-----------|--------|----------------|
| Estimate Tree | specs/tree-view.md | Approved | Custom-built, @tanstack/react-virtual, flat normalized state |
| Detail Panel | specs/detail-panel.md | Draft | Side panel, not modal; dispatch-only communication |
| Shared Components | specs/shared-components.md | Approved | Radix wrappers, zero direct Radix imports in features |

## Patterns
| Pattern | File | Applies To |
|---------|------|-----------|
| Tree State | patterns/state-management.md | Any component dispatching tree actions |
| Keyboard Nav | patterns/interaction-patterns.md | Tree view, detail panel, dialogs |

## Open Questions (Pending Zac's Input)
| # | Question | Blocking | Target Session |
|---|----------|----------|----------------|
| Q1 | Panel width: fixed vs resizable? | Detail panel spec | Next UI session |
```

**Agent instruction pattern:** When an implementation agent starts work on a UI component, its prompt includes: "Read `docs/ui/index.md` to identify which spec files are relevant to your task. Load only those files."

This keeps the lookup cost to ~200 lines (the index) and only loads the 1-2 relevant spec files (~3KB each) into the agent's context.

---

## 3. UI Decision Log Structure

### Problem

Decisions happen across sessions, in different contexts (research boards, Zac feedback, implementation discoveries). There is no single place to see "what was decided, when, by whom, and why."

INTENT.md captures *architecture* decisions. UI decisions are a different category -- they are visual, behavioral, and interaction-level choices that do not rise to the level of INTENT entries but must be tracked with equal rigor.

### Recommendation: `docs/ui/decisions/decision-log.md`

**Format:**

```markdown
# UI Decision Log

Chronological record of every approved UI decision. Never remove entries -- supersede with new numbered entries.

## Decisions

### UID-001: Side panel for node editing (not modal, not inline)
- **Date:** 2026-04-09
- **Source:** Implementation Review Board (unanimous, C8)
- **Status:** Approved
- **Decision:** The detail editing panel is persistent alongside the tree, not a modal dialog or inline editing.
- **Rationale:** EP used modals (broke workflow flow). Soloway used inline (coupled tree and form state). Side panel matches ProEst, Figma, VS Code pattern -- separate rendering from editing.
- **Alternatives rejected:** Modal (EP failure mode), inline editing (Soloway failure mode)
- **Affects:** detail-panel spec, tree-component contract, page layout
- **Approved by:** Review Board consensus; pending Zac confirmation at CP-2

### UID-002: useReducer + Immer for tree state (not Zustand/Jotai)
- **Date:** 2026-04-09
- **Source:** INTENT Decision #13, Review Board (unanimous, C2)
- **Status:** Approved (INTENT-locked)
- **Decision:** ...
```

**Rules for the decision log:**

1. Every decision gets a sequential ID (`UID-NNN`).
2. `Source` must trace back to where the decision was made (review board finding, Zac feedback, implementation discovery).
3. `Status` is one of: `Proposed`, `Approved`, `Superseded by UID-NNN`.
4. `Approved by` tracks whether Zac has explicitly approved, or if it is approved by review board consensus pending Zac's review.
5. Decisions that are already in INTENT.md get cross-referenced, not duplicated. The decision log entry says "See INTENT Decision #13" and adds only UI-specific details.
6. Never remove entries. Supersede by adding a new entry that references the old one.

**Relationship to INTENT.md:** INTENT captures *architectural* decisions (data model, calculation engine, state management pattern). The UI decision log captures *visual and interaction* decisions (panel layout, keyboard shortcuts, animation behavior, component composition patterns). Some decisions span both -- those live in INTENT.md with a cross-reference in the UI decision log.

---

## 4. Component Contracts

### Problem

The existing contract system (`contracts/`) governs feature-to-feature boundaries (tree-calculation, catalog-estimate, options-tree, client-visibility, realtime-state). UI components have their own boundaries that need the same protection: what props a component accepts, what actions it dispatches, what it renders vs. what it delegates to children.

### Recommendation: Extend the existing contract system with UI-boundary contracts

The comprehensive analysis (Section 8) already identified three UI contracts needed:

| Contract | Governs | Lives In |
|----------|---------|----------|
| `tree-state.contract.md` | Reducer state shape, action types, provider interface | `contracts/` |
| `tree-component.contract.md` | Tree container / tree row / detail panel boundaries | `contracts/` |
| `shared-components.contract.md` | Design system wrapper layer | `contracts/` |

**These go in `contracts/`, not in `docs/ui/`.** They follow the same template, the same <1KB rule, the same CONTRACT-INDEX.md integration, and the same sync enforcement. They ARE contracts, not documentation.

**Component contract template (extends TEMPLATE.contract.md):**

```markdown
# {Component} Contract

**Last verified**: {YYYY-MM-DD}
**Governs**: {What boundary this protects}

## Props Interface

| Prop | Type | Required | Notes |
|------|------|----------|-------|
| {prop} | {type} | {yes/no} | {constraints} |

## Actions Dispatched

| Action | Payload | When |
|--------|---------|------|
| {ACTION_TYPE} | {shape} | {trigger condition} |

## Rendering Boundaries

- {What this component renders vs. what it delegates}
- {What it must NOT render (separation of concerns)}

## Design Constraints

- {Token references this component must use}
- {Shape/radius rules}
- {Responsive behavior or lack thereof}

## Invariants

- {Rules that must never be violated}

## Cross-Feature Rules

- {How this component interacts with other components/systems}

## Change Protocol

Same as all contracts: update contract FIRST, then code, then indexes. Commit together.
```

**Key difference from feature contracts:** Component contracts include `Props Interface`, `Actions Dispatched`, `Rendering Boundaries`, and `Design Constraints` sections. These are specific to UI boundaries. The `Required Fields` and `Calculated Fields` sections from the standard template may not apply and can be omitted.

**When to create a component contract:**
- When a component crosses a rendering boundary (tree container vs. tree row vs. detail panel)
- When a component is a shared wrapper used by multiple features (Radix wrappers)
- When a component has a complex state interface (reducer providers)
- NOT for every leaf component. A simple `<Badge>` does not need a contract.

---

## 5. Preventing Research Staleness

### Problem

Research documents are written during planning and referenced during implementation. If implementation diverges from research (which it always does), the research becomes misleading. This is the same problem contracts solve for code interfaces.

### Recommendation: Three-layer staleness prevention

**Layer 1: Last-verified dates on every document**

Every file in `docs/ui/` includes a `Last verified: YYYY-MM-DD` header. The finish-session doc-updater agent checks whether any UI files referenced during the session need their dates updated.

**Layer 2: Status field on specs**

Each spec file has a status:

| Status | Meaning |
|--------|---------|
| `Draft` | Initial research output, not yet implemented |
| `Approved` | Zac has reviewed (or review board consensus for non-visual decisions) |
| `Implementing` | Active implementation session is working against this spec |
| `Implemented` | Code exists and matches spec. Contract is the source of truth now. |
| `Superseded` | Replaced by a newer spec. Link to replacement. |

**Critical rule:** Once a component is `Implemented`, the **contract** is the source of truth, not the spec. The spec becomes historical context (why decisions were made). If the contract and spec disagree, the contract wins.

**Layer 3: Finish-session integration**

Add to the finish-session doc-updater agent's checklist:
- "Were any `docs/ui/` files referenced during this session? If so, verify they still match the implemented code."
- "Did any UI decisions change during this session? If so, update `docs/ui/decisions/decision-log.md`."
- "Did any component boundaries change? If so, update the relevant component contract."

This is not a new system -- it extends the existing finish-session protocol with UI-specific checks.

**Staleness signals (extending the contract staleness table):**

| Signal | Meaning | Action |
|--------|---------|--------|
| Spec status is `Draft` for >2 sessions after work begins | Spec was never approved | Flag for Zac review |
| Spec status is `Approved` but contract disagrees | Spec is stale | Update spec or mark `Superseded` |
| Decision log references a component that no longer exists | Decision is orphaned | Archive the decision |
| `Last verified` >30 days and component has been modified | Spec may be stale | Verify on next touch |

---

## 6. Documentation Format for Agent Consumption

### Problem

Claude Code agents consume documentation by reading files into their context window. Large files waste context. Poorly structured files require agents to read the entire document to find the one section they need. Prose-heavy documents are harder to parse than structured formats.

### Recommendation: Structured, scannable, reference-oriented format

**Format principles:**

1. **Tables over prose.** Props, actions, constraints, decisions -- all in tables. Agents parse tables faster and more accurately than paragraphs.

2. **Front-matter metadata.** Every file starts with a YAML-like header:
   ```
   Status: Approved
   Last verified: 2026-04-09
   Applies to: src/components/estimate-tree/
   Depends on: contracts/tree-state.contract.md
   ```
   Agents can read the first 5 lines to decide whether the file is relevant without reading the body.

3. **"NOT in scope" section.** Every spec explicitly states what it does NOT cover. This prevents agents from looking for information that is not there, and prevents scope creep during implementation.

4. **Token references, never descriptions.** Write `var(--color-bg-secondary)` not "a light gray background." Write `var(--space-4)` not "16px of padding." Agents implementing the spec should be able to copy-paste token references directly into code.

5. **Code examples are minimal and concrete.** Show the interface (TypeScript type, prop signature), not the implementation. A 5-line type definition communicates more than 50 lines of prose about "what the component should accept."

6. **File size: 1-3KB.** Hard ceiling of 5KB. If a spec exceeds 3KB, it is likely covering too many concerns. Split by boundary.

**Example spec structure:**

```markdown
# Tree View Spec

Status: Approved
Last verified: 2026-04-09
Applies to: src/components/estimate-tree/
Contract: contracts/tree-component.contract.md

## Purpose
One sentence.

## Interface
{TypeScript type definition, <10 lines}

## Behavior
{Table of behaviors: trigger -> action -> result}

## Design Tokens Used
{Table of token -> usage}

## NOT in Scope
{Bullet list of what this component does NOT handle}

## Open Questions
{Numbered list, each with blocking/non-blocking status}
```

---

## 7. Recording Zac's Feedback and Approvals

### Problem

Zac provides feedback at checkpoints (CP-1, CP-2, etc. from the comprehensive analysis) and ad-hoc during sessions. This feedback needs to be:
- Recorded in a way that future agents can find it
- Traceable to specific decisions or components
- Distinguished from review board recommendations (which are suggestions until Zac approves)

### Recommendation: `docs/ui/feedback/zac-approvals.md` + decision log cross-references

**Feedback file format:**

```markdown
# Zac's UI Feedback and Approvals

Chronological record. Each entry links to the decision(s) it affects.

## 2026-04-10 -- CP-1 Review (Shared Component Layer)

### Approved
- Radix wrapper approach (UID-005)
- Button component styling (UID-007)
- Color token palette (UID-008)

### Requested Changes
- "Make the sidebar narrower" -> Updated UID-003, new width: 280px -> 240px
- "The hover state is too subtle" -> New UID-012: increase hover contrast

### Deferred
- Dark mode tokens -- "not now, but keep the token structure ready"

### Verbatim Notes
> "I want it to feel sharp and intentional, not rounded and soft like every other SaaS."
> "The tree should feel like VS Code's file explorer, not like a generic list."
```

**Rules:**

1. Record feedback the same session it is given. Do not defer to finish-session.
2. Link every approved/changed item to a decision log entry (UID-NNN).
3. Record verbatim quotes when Zac expresses design intent -- these are the most valuable long-term references for agents making judgment calls.
4. Distinguish `Approved` (go ahead), `Requested Changes` (modify before proceeding), and `Deferred` (acknowledged but not now).
5. Session handoff docs reference feedback given during that session: "Zac reviewed at CP-1, see `docs/ui/feedback/zac-approvals.md` for details."

**Feedback that becomes decisions:** When Zac approves something or requests a change, the decision log gets a new entry (or updates an existing one). The feedback file is the raw record; the decision log is the processed, actionable version.

---

## 8. Integration with Existing Systems

### Integration with Contracts System (`contracts/`, `CONTRACT-INDEX.md`)

- UI-boundary contracts (tree-state, tree-component, shared-components) live in `contracts/` alongside existing feature contracts.
- CONTRACT-INDEX.md gets new rows for each UI contract. Same format, same enforcement.
- The contract template is extended (not replaced) with UI-specific sections (Props, Actions, Rendering Boundaries, Design Constraints).
- Contract enforcement rules (the non-negotiable sync rule) apply identically.
- Component specs in `docs/ui/specs/` are NOT contracts. They are design documentation. Once implemented, the contract supersedes the spec for "what is true now."

### Integration with Memory System (`.claude/memory/`)

- `memory/index.md` gets a new entry under a "UI Documentation" section pointing to `docs/ui/index.md`.
- `memory/topics/` gets a topic file `ui-architecture.md` summarizing key UI decisions and patterns for quick-scan during session starts. This is a <1KB summary, not a duplicate of the full docs.
- Session handoff docs reference which UI specs were used, updated, or created during the session.

### Integration with Session Handoffs

Session handoff docs (`.claude/memory/sessions/YYYY-MM-DD.md`) should include:

```markdown
## UI Documentation Updated
- Updated: docs/ui/specs/tree-view.md (status: Draft -> Implementing)
- Created: docs/ui/decisions/decision-log.md entries UID-015 through UID-018
- Feedback: Zac approved shared component layer at CP-1 (see docs/ui/feedback/zac-approvals.md)
```

This gives the next session immediate awareness of what changed in the UI documentation.

### Integration with Context Budget Layers

| Layer | UI Content | When Loaded |
|-------|-----------|-------------|
| L0 | DESIGN-SYSTEM.md (via CLAUDE.md import) | Always |
| L1 | docs/ui/index.md (routing table) | Every UI session |
| L2 | Specific spec file + relevant contract | Per-task |
| L3 | Decision log, feedback history, pattern docs | On-demand via subagents |

The routing table at L1 keeps the base cost low (~200 lines). Per-task loading of specs (~3KB each) stays within the 10KB rule.

---

## 9. Summary of Recommendations

| Question | Answer |
|----------|--------|
| Where do UI research docs live? | `docs/ui/` (committed to git, persistent) |
| How is research indexed? | `docs/ui/index.md` as routing table, read at L1 for UI sessions |
| UI Decision Log structure? | `docs/ui/decisions/decision-log.md`, sequential IDs (UID-NNN), never-remove policy |
| Component contracts? | Extend existing `contracts/` with UI-specific template sections |
| Staleness prevention? | Last-verified dates + status field + finish-session integration |
| Agent-consumable format? | Tables over prose, front-matter metadata, <3KB per file, token refs not descriptions |
| Zac's feedback? | `docs/ui/feedback/zac-approvals.md` with cross-refs to decision log |

### Full Directory Structure

```
docs/ui/
  index.md                        -- Routing table (L1 for UI sessions)
  decisions/
    decision-log.md               -- All UI decisions, UID-NNN format
  specs/
    tree-view.md                  -- Estimate tree component spec
    detail-panel.md               -- Node editing panel spec
    shared-components.md          -- Design system wrapper layer
    navigation.md                 -- App shell, breadcrumbs, sidebar
    {component}.md                -- One per major component
  patterns/
    state-management.md           -- Reducer, optimistic updates, Realtime
    interaction-patterns.md       -- Keyboard, context menus, drag-drop
    form-patterns.md              -- Validation, error display, fields
  feedback/
    zac-approvals.md              -- Chronological Zac feedback record

contracts/                        -- Extended with UI contracts
  tree-state.contract.md          -- Reducer state shape, actions, provider
  tree-component.contract.md      -- Tree/row/panel boundaries
  shared-components.contract.md   -- Radix wrapper layer rules
```

### What NOT to Do

- Do not put UI research in `.scratch/` -- it will be lost.
- Do not put specs in `.claude/memory/topics/` -- wrong purpose, wrong format, wrong size.
- Do not create per-session UI docs -- use the persistent `docs/ui/` structure and update in place.
- Do not duplicate INTENT.md decisions in the UI decision log -- cross-reference instead.
- Do not treat specs as contracts -- specs are "what we planned," contracts are "what the code must satisfy."
- Do not load all of `docs/ui/` into agent context -- use the index to load only relevant files.
