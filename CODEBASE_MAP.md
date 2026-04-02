# Codebase Map -- ShossyWorks

> **Status:** Pre-development (research/architecture phase)
> **Last updated:** 2026-04-02
> **Stack decision:** Next.js + Supabase + Vercel + TypeScript + Tailwind CSS

---

## 1. Architecture Overview

Construction estimating platform for Szostak Build, LLC. Third attempt after two failed builds (EP: monolithic 46-column table; Soloway: rigid 5-level hierarchy). This attempt uses strict bottom-up development -- each layer stable before the next begins.

**Planned core systems:** tree-based estimate hierarchy (adjacency list + ltree), isomorphic calculation engine, assembly system with quantity cascade, catalog (copy-on-instantiate), three-layer options system (broad/inline/option sets), formula engine (math.js), version management with audit trail, vendor management, client-facing filtered view, PDF export.

**No application code exists yet.** The repo contains completed architectural research, Claude Code configuration, and project scaffolding docs.

---

## 2. File Registry

```
ShossyWorks/
├── CLAUDE.md                          -- Claude Code entry point, imports README.md
├── README.md                          -- Project title (stub)
├── INTENT.md                          -- Design intent (stub, pending population)
├── CODEBASE_MAP.md                    -- This file
├── CONTRACT-INDEX.md                  -- Contract quick-lookup table (empty)
├── .gitattributes                     -- Union merge strategy for memory files
├── skills-lock.json                   -- Pinned skill versions
│
├── research/                          -- Architectural research (primary content)
│   ├── README.md                      -- Research folder guide
│   ├── RESEARCH-SESSION-BRIEF.md      -- Complete research session briefing (30KB)
│   ├── references/                    -- Prior attempt artifacts (context only)
│   │   ├── attempt-1-ep-table-structure-spec.md   -- EP's 14-table spec
│   │   └── attempt-2-soloway-overview.md          -- Soloway's fixed hierarchy
│   └── output/                        -- Research deliverables (finalized 2026-04-02)
│       ├── README.md                  -- Deliverable index with review verdicts
│       ├── 01-data-architecture.md    -- Complete data architecture (~28 tables, 71KB)
│       ├── 02-implementation-sequence.md -- 12-phase build sequence (38KB)
│       ├── 03-open-questions.md       -- 11 researched open questions (33KB)
│       ├── 04-risk-assessment.md      -- Risk matrix + mitigation (30KB)
│       ├── 05-addendum-new-requirements.md -- Multi-user, auto-promotion, PIN auth
│       ├── research-realtime-collaboration.md  -- Supabase Realtime analysis
│       ├── research-node-promotion.md          -- Item-to-group auto-promotion
│       ├── research-pin-auth.md                -- PIN authentication design
│       ├── reviews/                   -- 5-agent review board output
│       │   ├── 01-data-model-review.md
│       │   ├── 02-calc-engine-review.md
│       │   ├── 03-options-system-review.md
│       │   ├── 04-sequence-risk-review.md
│       │   └── 05-industry-research.md
│       └── archive/v1-originals/      -- Pre-review v1 deliverables (superseded)
│
├── contracts/                         -- Interface agreements between features
│   └── TEMPLATE.contract.md           -- Contract template (<1KB target)
│
├── docs/                              -- Project documentation
│   ├── features/
│   │   ├── README.md                  -- Feature docs guidelines
│   │   └── backlog.md                 -- Feature requests / friction points
│   └── sessions/
│       └── README.md                  -- Session handoff template
│
└── .claude/                           -- Claude Code configuration
    ├── .gitignore                     -- Excludes local settings, scratch, skills/
    ├── settings.json                  -- Permissions, hooks, agent teams config
    ├── settings.local.json.template   -- Local settings template
    ├── agents/                        -- Agent role definitions (stubs)
    │   ├── code-reviewer.md
    │   ├── codebase-mapper.md
    │   ├── contract-auditor.md
    │   ├── db-specialist.md
    │   ├── doc-updater.md
    │   ├── intent-curator.md
    │   └── ui-specialist.md
    ├── commands/                      -- Session protocol commands (stubs)
    │   ├── start-session.md
    │   └── finish-session.md
    ├── hooks/                         -- Lifecycle hooks
    │   ├── session-start.sh           -- Runs on session startup/compact/resume
    │   ├── session-end.sh             -- Runs on session end
    │   ├── pre-compact.sh             -- Saves state before context compaction
    │   ├── post-compact.sh            -- Restores state after compaction
    │   └── post-edit-check.sh         -- Reminds to update contracts/docs
    ├── rules/                         -- Behavioral rules (always loaded)
    │   ├── architecture.md            -- Component model, data flow, file org
    │   ├── autonomous-agents.md       -- Three-criteria agent deployment
    │   ├── code-style.md              -- Naming, types, imports, formatting
    │   ├── contracts-enforcement.md   -- Non-negotiable sync rule
    │   ├── documentation.md           -- Session docs, memory, context budget
    │   ├── domain.md.template         -- Domain rules template (stub)
    │   ├── git-workflow.md            -- Conventional commits, safety rules
    │   └── tool-awareness.md          -- MCP/skill/agent evaluation checklist
    ├── memory/                        -- Cross-session knowledge persistence
    │   ├── index.md                   -- Memory entry point
    │   ├── topics/
    │   │   └── project-overview.md    -- Core concepts, requirements, decisions
    │   ├── sessions/                  -- Session handoff docs (empty)
    │   └── scratch/                   -- Ephemeral hook state (gitignored)
    ├── workflows/                     -- Agent orchestration templates
    │   ├── agent-team-workflow.md     -- Multi-agent coordination (stub)
    │   ├── prompt-templates.md        -- Reusable prompt patterns (stub)
    │   ├── workflow-state-schema.json -- State machine schema (stub)
    │   └── scratch/                   -- Ephemeral workflow state
    └── skills -> A:/claude-skills     -- Symlink to shared skills repo (gitignored)
```

---

## 3. Dependency Graph (Architectural -- from Implementation Sequence)

No code dependencies exist. The planned 12-phase build sequence defines a strict dependency chain:

```
Phase 0: Scaffolding (Next.js + Supabase + Vercel + Auth)
    └─> Phase 1A: Schema, Constraints, Triggers, Server Actions
         └─> Phase 1B: Tree UI & Project Navigation
              └─> Phase 2: Calculation Engine (isomorphic TypeScript)
                   └─> Phase 3: Assembly System (quantity cascade)
                        └─> Phase 4: Formula Engine (math.js)
                             └─> Phase 5: Catalog System (copy-on-instantiate)
                                  ├─> Phase 6: Options System (3-layer, junction table)
                                  │    ├─> Phase 7: Version Management UI
                                  │    └─> Phase 8: Client-Facing View + PDF
                                  └─> Phase 9: Vendor MVP (parallel with Phase 6)

Phase 10: Polish & Advanced Features (depends on all above)
```

**Scheduling note:** Phase 9 (Vendors) can run in parallel with Phase 6 (Options) since it only depends on Phase 5. Phases 7, 8, and 9 are independent of each other. Estimated total: 18-28 sessions for Phases 0-9.

---

## 4. Database Schema

No schema deployed. The planned schema (~28 tables) is documented in `research/output/01-data-architecture.md`. Key table groups:

| Group | Tables | Purpose |
|-------|--------|---------|
| Core | projects, estimates, estimate_nodes, node_item_details, node_assembly_details | Tree hierarchy + estimate structure |
| Reference | units_of_measure, phases, cost_codes, project_parameters | Lookup data + configuration |
| Options | option_groups, option_alternatives, node_option_memberships, option_sets, option_set_broad_selections | Three-layer options system |
| Catalog | catalog_items, catalog_assemblies, catalog_assembly_nodes | Reusable templates |
| Versions | estimate_versions, estimate_nodes_history | Snapshots + audit trail |
| Vendors | vendors, vendor_contacts, vendor_pricing | Vendor management |
| Proposals | proposals | Client-facing documents |
| Auth/Users | profiles (extends Supabase auth.users) | Roles: owner, employee, client |

---

## 5. API Routes

None yet. Will be established in Phase 0 (scaffolding).

---

## 6. Design System

Not yet established. Tailwind CSS selected. Design tokens, component library, and UI patterns will be defined during Phase 0/1B.

---

## 7. Contracts Index

See `CONTRACT-INDEX.md` at repo root. No contracts defined yet -- will be created as feature boundaries are established during implementation.

---

## 8. Refactoring Targets

None. No application code exists to refactor.

---

## 9. External Integrations

| Service | Purpose | Status |
|---------|---------|--------|
| Supabase | Auth, PostgreSQL database, Realtime, Storage | Planned (Phase 0) |
| Vercel | Hosting, CI/CD, preview deployments | Planned (Phase 0) |
| GitHub | Source control, PR workflow | Active (repo exists) |
| PDF generation | Proposal/PO export | Planned (Phase 8, service TBD) |

---

## 10. Recent Changes

| Date | Change | Scope |
|------|--------|-------|
| 2026-04-02 | Complete architectural research session | 5 deliverables + 3 supplemental + 5 reviews |
| 2026-04-02 | Claude Code configuration deployed | Rules, hooks, agents, memory, workflows |
| 2026-04-02 | Addendum: multi-user, auto-promotion, PIN auth | New requirements integrated into architecture |
