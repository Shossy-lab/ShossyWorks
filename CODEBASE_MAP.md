# Codebase Map -- ShossyWorks

> **Status:** Phase 0 + Hardening complete. Phase 1A next.
> **Last updated:** 2026-04-09
> **Stack:** Next.js 16.2.2 + Supabase + Vercel + TypeScript (strict) + Tailwind CSS v4

---

## 1. Architecture Overview

Construction estimating platform for Szostak Build, LLC. Third attempt after two failed builds (EP: monolithic 46-column table; Soloway: rigid 5-level hierarchy). This attempt uses strict bottom-up development -- each layer stable before the next begins.

**Planned core systems:** tree-based estimate hierarchy (adjacency list + ltree), isomorphic calculation engine, assembly system with quantity cascade, catalog (copy-on-instantiate), three-layer options system (broad/inline/option sets), formula engine (math.js), version management with audit trail, vendor management, client-facing filtered view, PDF export.

**Phase 0 scaffold is deployed and running on Vercel.** Auth flow (sign-in, sign-up, sign-out), protected routes, error boundaries, design token system, and security hardening are complete. ~32 source files, ~1,414 lines of code. Phase 1A (database schema) is next.

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

Two migrations deployed. Phase 1A will add 10 more migrations creating 35+ tables.

**Deployed migrations:**
| Migration | Content |
|-----------|---------|
| `00000000000001_auth_roles.sql` | ltree extension, app_role enum, user_roles table, custom_access_token_hook |
| `20260406000001_security_fixes.sql` | Drop overpermissive RLS, add pending role, handle_new_user trigger, search_path fix |

**Planned tables (Phase 1A, 35+ tables):**

| Group | Tables | Purpose |
|-------|--------|---------|
| Auth | user_profiles (replaces user_roles) | Roles: owner, employee, client, pending |
| Core | projects, estimates, estimate_nodes, node_item_details, node_assembly_details, node_notes | Tree hierarchy + estimate structure |
| Reference | units_of_measure, phases, cost_codes, project_parameters | Lookup data + configuration |
| Settings | company_settings, user_preferences, estimate_view_state | Business defaults + UI state |
| Options | option_groups, option_alternatives, node_option_memberships, option_sets, broad_options | Three-layer options + toggle type |
| Catalog | catalog_items, catalog_assemblies | Reusable templates |
| Snapshots | estimate_snapshots | JSONB-serialized frozen estimate copies |
| Client | estimate_shares, estimate_comments, estimate_approvals, client_project_access | Client sharing + interaction |
| History | estimate_nodes_history + others | Trigger-based audit trail |
| Vendors | vendors, vendor_contacts | Vendor management |

---

## 5. API Routes

| Route | Purpose |
|-------|---------|
| `src/app/auth/callback/route.ts` | OAuth callback with redirect validation |
| `src/middleware.ts` | Auth token refresh, protected route enforcement, public route bypass |

---

## 6. Design System

Established in Phase 0, documented in `DESIGN-SYSTEM.md`. CSS custom property tokens in `src/app/globals.css` with `@theme` block for Tailwind v4 integration. Design rules:
- Zero hardcoded styles — all visual properties use `var(--color-*)`, `var(--space-*)` tokens
- Sharp corners on rectangles (`rounded-none`)
- Pill shape for buttons (`rounded-full`)
- Standard Tailwind utilities for font-weight, text-size, duration (not `var()` arbitrary values)

---

## 7. Contracts Index

See `CONTRACT-INDEX.md` at repo root. No contracts defined yet -- will be created as feature boundaries are established during implementation.

---

## 8. Refactoring Targets

None currently. Auth form deduplication (HIGH-12/13/23 from codebase review) deferred to Phase 1B.

---

## 9. External Integrations

| Service | Purpose | Status |
|---------|---------|--------|
| Supabase | Auth, PostgreSQL, Realtime, Storage | Active (project edpumrranilhipwnvfrq) |
| Vercel | Hosting, CI/CD, preview deployments | Active (shossy-works.vercel.app) |
| GitHub | Source control | Active (Shossy-lab/ShossyWorks) |
| Azure Key Vault | Secret management | Active (shossyworks-vault) |
| PDF generation | Proposal/PO export | Planned (Phase 2C, service TBD) |

---

## 10. Recent Changes

| Date | Change | Scope |
|------|--------|-------|
| 2026-04-02 | Complete architectural research session | 5 deliverables + 3 supplemental + 5 reviews |
| 2026-04-02 | Claude Code configuration deployed | Rules, hooks, agents, memory, workflows |
| 2026-04-03 | Phase 0: scaffold, auth, app shell, tests, deploy | 25 source files, Vercel deployment |
| 2026-04-03 | Design system with CSS custom property tokens | DESIGN-SYSTEM.md + globals.css + all components |
| 2026-04-06 | Weekend session: node_notes decision, interaction planning | Session handoff doc |
| 2026-04-07 | Hardening H1: security + DB fixes | Open redirect, RLS, search_path, middleware, pending role |
| 2026-04-07 | Hardening H2: CSS tokens + dependencies | @theme block, font/duration/text fixes, dep upgrades |
| 2026-04-07 | Hardening H3: error handling + auth UX | 6 error boundaries, auth error mapping, sign-up flow |
| 2026-04-07 | Hardening H4: testing + performance + a11y | Vitest projects, security headers, focus indicators, skip link |
| 2026-04-08 | 5 interaction decisions | Lifecycle, node actions, preferences, client experience, search |
| 2026-04-08 | Deep planning: 26-agent analysis + approved plan v2 | 31 documents, 1,890-line implementation plan |
| 2026-04-09 | Test generation team: 5 agents writing 82+ test cases | tests/database/ + tests/actions/ |
