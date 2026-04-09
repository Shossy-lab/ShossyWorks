# ShossyWorks -- Deep Planning Executive Summary

**Date:** April 8, 2026
**Prepared for:** Zac Szostak, Szostak Build LLC
**Project:** ShossyWorks Construction Estimating Platform

---

## What Was Analyzed

ShossyWorks is a web-based construction estimating platform being built for Szostak Build. The app will let you create projects, build detailed cost estimates with a tree-based structure (groups of items, assemblies, line items), manage options/alternatives for clients, share estimates for review and approval, and maintain a catalog of reusable items.

Before this planning session, the app had its foundation in place: user login, basic page layout, deployment pipeline, and security hardening. What it did NOT have was any of the actual business data -- no database tables for projects, estimates, cost items, options, or client sharing.

This deep planning session analyzed the entire codebase (32 files, ~1,400 lines of code), incorporated 5 major design decisions you made earlier today about how the app should work, and produced a battle-tested implementation plan that was reviewed and revised by 10 specialist AI agents across two rounds of scrutiny.

---

## Agent Deployment Summary

| Phase | Agents Deployed | Duration | Key Output |
|-------|----------------|----------|------------|
| **1. Implementation Review Board** | 5 specialist analysts (Architecture, Security, Performance, Quality, Business Logic) | ~15 min | 19 consensus findings, 7 key decisions needing input, 8 research topic clusters |
| **2. Synthesis** | 1 lead agent | ~5 min | Comprehensive analysis document combining all 5 specialist reports |
| **3. Deep Research** | 8 research agents (one per topic cluster) | ~20 min | 8 detailed research files covering snapshots, security, client visibility, options, enums, types, deep-copy, and settings |
| **4. Plan Architecture** | 1 plan architect | ~10 min | Implementation Plan v1 (14 phases, 10 migration files, agent assignments, verification scripts) |
| **5. Plan Review Board (Round 1)** | 5 review agents (Feasibility, Completeness, Correctness, Dependency, Risk) | ~15 min | All 5 agents returned "REVISE" -- found 11 BLOCKING issues and 23 MAJOR issues |
| **6. Plan Revision** | 1 revision agent | ~10 min | Implementation Plan v2 with 29 fixes (7 blocking, 22 major/minor) |
| **7. Plan Review Board (Round 2)** | 5 review agents | ~10 min | All 5 agents returned "APPROVE" -- every issue resolved |
| **Total** | ~26 agent deployments | ~85 min | Approved implementation plan with full research backing |

---

## Top Findings (Plain English)

### 1. Snapshots and Versions Are Different Things

When you save a "snapshot" of an estimate (like taking a photo of it at a point in time), the system needs to store that differently than when you create a new "version" (like making a copy to edit). The plan stores snapshots as a single frozen record (think of it as a ZIP file of the entire estimate), while versions are full working copies. This prevents snapshots from cluttering up the working tables and makes them truly read-only.

### 2. Every Database Table Needs a Security Fence -- From Day One

The database technology we are using (Supabase) exposes tables through a public web interface. Without explicit security rules on each table ("Row Level Security" or RLS), anyone with the right URL could read or modify data. The plan requires that every single table created gets security rules in the same step it is created -- no exceptions, no "we'll add security later."

### 3. Client Visibility Is Not Just On/Off

When sharing estimates with clients, a simple "visible or hidden" toggle is not enough. The plan uses three levels: **visible** (client sees everything), **hidden** (client cannot see it at all), and **summary only** (client sees the name and total price but not the detailed breakdown). This matches how construction estimates actually work -- you might want a client to see that "Kitchen Renovation" costs $45,000 without showing every line item.

### 4. The Most Complex Operation Is Copying an Estimate

When you duplicate an estimate or restore from a snapshot, the system has to copy 10-12 interconnected tables while keeping all the internal references correct (every item pointing to its parent group, every option pointing to its alternatives, etc.). This is the single highest-risk operation in the entire system. The plan allocates dedicated testing and includes a safety mechanism (database "savepoints") so that if a restore fails mid-operation, nothing is lost.

### 5. The Original Timeline Was Too Aggressive

The first draft of the plan estimated 2-3 work sessions. After analysis by 10 specialist agents who examined every table, every function, and every dependency, the realistic estimate is **6-7 sessions** for the database foundation alone. This is not scope creep -- it is honest accounting for the complexity of building 35+ database tables with security rules, automated behaviors ("triggers"), and comprehensive testing.

---

## The Approved Plan at a Glance

### Phase 1A: Database Foundation (6-7 sessions)

| Sub-Phase | What It Does | Est. Sessions |
|-----------|-------------|---------------|
| **1A-0: Security Foundation** | Sets up the security helper functions, consolidates user data into one table, blocks unapproved users | 0.5 |
| **1A-1: Status Categories** | Creates the official lists of project statuses (10 stages) and estimate statuses (4 stages) | 0.25 |
| **1A-2: Core Tables** | Builds the main tables: projects, estimates, cost items, item details, assembly details, notes | 0.5 |
| **1A-3: Settings Tables** | Creates tables for company settings, user preferences, and per-estimate view customization | 0.25 |
| **1A-4: Options & Catalog** | Builds the options/alternatives system (9 tables), vendor tracking, and catalog infrastructure | 0.5 |
| **1A-5: Client Sharing** | Creates client access controls, snapshot storage, share links, comments, approvals, and adds client security rules to ALL prior tables | 0.5 |
| **1A-6: Automated Behaviors** | Sets up triggers -- automatic actions the database takes (recalculate totals when items change, maintain the tree structure, auto-promote items to groups, etc.) | 0.5 |
| **1A-7: History Tracking** | Creates tables to log every change to estimate items (audit trail) | 0.25 |
| **1A-8: Performance & Seed Data** | Adds database indexes for fast searching/filtering and inserts starter data (measurement units, cost code categories) | 0.25 |
| **1A-9: Complex Functions** | Builds the heavy-lifting database functions: duplicate estimate, create snapshot, restore from snapshot, create estimate from snapshot | 0.75 |
| **1A-10: TypeScript Types & Test Setup** | Generates TypeScript type definitions from the database schema, creates domain-specific types, validation rules, and testing infrastructure | 0.75 |
| **1A-11: Server Actions** | Builds ~28 core server-side functions for creating/reading/updating/deleting projects, estimates, nodes, and snapshots | 0.75 |
| **1A-12: Tests** | Writes ~82 automated tests verifying triggers work, security rules hold, snapshots round-trip correctly, and the duplicate function preserves data | 1.0 |
| **1A-13: Documentation** | Updates all project documentation, creates contracts for new system boundaries | 0.25 |

### Phase 1B: User-Facing Features (11-16 sessions)

| Sub-Phase | What It Does | Est. Sessions |
|-----------|-------------|---------------|
| **1B-1: Snapshot UI** | The visual interface for creating, browsing, comparing, and restoring snapshots | 2-3 |
| **1B-2: Catalog System** | "Add to Catalog" and "Insert from Catalog" -- save and reuse estimate items across projects | 2-3 |
| **1B-3: Options UI** | The interface for managing option groups, alternatives, and "what if" scenario comparison | 2-3 |
| **1B-4: Client Portal** | Share link generation, PIN-protected client access, commenting, and approval workflow | 3-4 |
| **1B-5: Search & Filtering** | Live search within estimates, filter by type/code/phase/cost/flags | 1-2 |
| **1B-6: Preferences & Settings** | Company settings form, user preference panel, expand/collapse state persistence | 1 |

### Phase 2+: Future Roadmap

| Phase | What It Does | Est. Sessions |
|-------|-------------|---------------|
| **2A: Calculation Engine** | Formula parser, automatic subtotals, contingency/overhead rollup | 3-4 |
| **2B: Reporting & Exports** | Estimate reports, CSV/Excel export, print layouts | 2-3 |
| **2C: PDF Generation** | Professional PDF proposals with your branding | 1-2 |
| **2D: Design Integration** | Polish the visual design, component library | 2-3 |
| **2E: Mobile/Tablet** | Touch-friendly interface, responsive layouts | 1-2 |

---

## Phase 1A Breakdown (The Next Thing to Build)

Phase 1A is the database foundation -- think of it as pouring the concrete slab before framing the house. No one sees it, but everything depends on it being right.

### 1A-0: Security Foundation (Session 1, first half)

This is about making sure the doors are locked before we put anything valuable inside. The system currently tracks user roles (owner, employee, client, pending) in one table. This phase consolidates user data into a cleaner single table, creates reusable security helper functions that every other table will use, and adds a "pending approval" screen so new signups cannot access anything until you approve them.

**Key safety measure:** The old user table is not deleted until after the new one is confirmed working. If anything goes wrong, the system falls back to the original.

### 1A-1: Status Categories (Session 1)

This creates the official status lists. Your projects now follow a 10-stage lifecycle that matches real construction: Lead, In Design, Bidding, Under Contract, Value Engineering, Active Construction, Closing Out, Warranty Period, Closed, Archived. Estimates have 4 stages: Draft, Preliminary, Active, Complete. These are locked into the database as formal types, so nothing can accidentally set a project to an invalid status like "sorta done."

### 1A-2: Core Tables (Session 1, second half)

This is the heart of the system -- the tables that store projects, estimates, and cost items. Every table gets security rules. The estimate items table includes the three-level client visibility, a "flagged" marker for items needing attention, and a full-text search column so you can find items by name instantly. Notes are stored in their own table (not crammed into a column) so items can have multiple notes with different visibility levels.

### 1A-3: Settings Tables (Session 2)

Company-wide settings (default markup rate, overhead rate, contingency rate, tax rate, company name, license info) go in one row with a mechanism that prevents accidentally creating a second row. User preferences and per-estimate view customization (which columns are visible, which groups are expanded) each get their own table.

### 1A-4: Options & Catalog (Session 2)

This builds the infrastructure for the "what if" scenario system. Option groups let you define alternatives ("Granite countertops vs. Quartz vs. Laminate"), and option sets let you save complete scenario configurations ("Budget package," "Premium package"). The catalog tables let you save items as reusable templates. Nine tables total, all with security rules.

### 1A-5: Client Sharing (Session 2-3)

This creates the tables for sharing estimates with clients: access control, PIN-protected share links (with lockout after 5 failed attempts), client comments, and approval tracking. It also goes back and adds client-specific security rules to ALL the tables created in previous phases. This was deliberately saved for last because client security rules depend on the client access table existing first.

### 1A-6 through 1A-9: Triggers, History, Indexes, Functions (Sessions 3-4)

These phases add the "intelligence" to the database: automatic behaviors when data changes (recalculate totals, maintain the tree structure, log changes to history), performance optimizations (indexes for fast queries), starter data (measurement units like "each," "linear feet," "square feet"), and the complex functions for duplicating estimates and managing snapshots.

### 1A-10 through 1A-13: Types, Actions, Tests, Docs (Sessions 5-7)

These phases connect the database to the application code. TypeScript types are generated from the database schema (so the app code and database always agree on data shapes). Server actions provide the functions the user interface will call. Tests verify everything works correctly. Documentation is updated to reflect all the new infrastructure.

---

## Phase 1B Preview

Phase 1B is where the app starts doing things users can see and interact with. Each feature ships with its own server actions and tests (the parts deferred from 1A to keep it focused).

**Snapshot UI (1B-1):** The ability to save named milestones of an estimate and browse/compare/restore them. This is the first feature to build because it exercises the most complex database functions and will validate the entire snapshot architecture.

**Catalog System (1B-2):** Save any item or assembly as a reusable template. Insert from catalog into any estimate. "Update from Catalog" to pull in changes. This is how estimators avoid retyping the same items across projects.

**Options UI (1B-3):** The visual interface for managing alternatives and "what if" scenarios. Create option groups, assign alternatives, build option sets, and compare total prices across scenarios. This is the primary client-facing differentiator -- most estimating software does not handle options well.

**Client Portal (1B-4):** The largest 1B feature. Clients get a PIN-protected link to view their estimate, filtered by what you have marked as visible. They can leave comments on specific items and approve or reject the estimate. Rate limiting prevents brute-force PIN guessing.

**Search & Filtering (1B-5):** Live search within estimates using the full-text search infrastructure built in 1A. Filter by item type, cost code, phase, cost range, or flagged status.

**Preferences & Settings (1B-6):** The UI for company settings (default rates, company info) and user preferences (UI customization, expand/collapse state that persists between sessions).

---

## What Changed from v1 to v2

The first version of the plan was reviewed by 5 specialist agents who found significant issues. Here are the key changes:

| What Changed | Why |
|-------------|-----|
| **Migration order fixed** | Some tables referenced other tables that had not been created yet. Reference data (units of measure, cost codes) now gets created BEFORE the tables that use them. |
| **Client security rules deferred** | Client access rules depended on a table that was created several steps later. Now, ALL client security is added in one step after all the necessary tables exist. |
| **User table migration split in two** | Originally, the old user table was deleted in the same step as creating the new one. Now it is a two-step process -- create new table first, delete old table only after confirming the new one works. |
| **Strict TypeScript rules postponed** | Some very strict coding rules would have broken existing working code. Only safe rules are added now; aggressive rules wait until after Phase 1A. |
| **Server actions reduced from 54 to 28** | The original plan tried to build all server functions upfront. Now, only the core ones (projects, estimates, items, snapshots) are built in 1A. The rest ship alongside their UI in 1B. |
| **Tests reduced from 164 to 82** | Same philosophy -- core tests in 1A, feature tests in 1B alongside the features they test. |
| **Session estimate increased from 5.5 to 6-7** | Honest accounting for debugging time, complexity, and cross-session context management. |
| **Recovery strategy documented** | Every phase now has an explicit "if something goes wrong, here is what to do" path. Since there is no real data yet, the recovery is simple: reset the database and reapply everything from scratch. |
| **Snapshot restore safety added** | The restore function now uses database "savepoints" -- if the restore fails mid-operation, the original data is automatically preserved instead of being lost. |
| **Trigger variable names unified** | Three different naming conventions were being used across research files. Now there is one consistent name everywhere. |
| **Smoke test added** | After all functions are built, a full end-to-end test runs: create project, create estimate, add items, take snapshot, restore snapshot, verify everything survived. |

---

## Decisions Confirmed

These are the 5 design decisions you made earlier today and how they shaped the plan:

### Decision 1: 10-Stage Project Lifecycle

You chose a lifecycle that mirrors real construction: Lead through Archived, with stages for Design, Bidding, Under Contract, Value Engineering, Active Construction, Closing Out, and Warranty. The plan creates this as a formal database type (not just text) so the system enforces valid statuses. Transition guardrails (warnings when making unusual status jumps) are planned for Phase 1B.

### Decision 2: Estimate Snapshots with Named Restore

You chose to let estimators save named "milestones" of estimates and restore from them. The plan implements three distinct actions: **Restore** (replace current estimate with snapshot), **Compare** (side-by-side view), and **Create New** (seed a fresh estimate from snapshot data). Restore includes safety guards when the estimate has been sent to a client or is under contract.

### Decision 3: Rich Node Actions

You chose a full set of actions for estimate items: duplicate, copy across estimates, convert between types, save to catalog, manage options, and control client visibility. The plan builds the database infrastructure for all of these in 1A, with the UI coming in 1B.

### Decision 4: Client View, Comment, and Approve

You chose PIN-protected share links with commenting and approval. The plan implements three-level visibility (visible/hidden/summary-only), rate limiting against PIN guessing (lockout after 5 failed attempts, 20 attempts per hour per IP address), and a full approval workflow. All security is handled server-side -- clients never get direct database access.

### Decision 5: Adjustable-Scope Search

You chose a search system that can operate within a single estimate, across a project, or across all projects. The plan creates full-text search infrastructure at the database level (for speed) with filters for item type, cost code, phase, cost range, and flagged status. The database indexing is built in 1A; the search UI ships in 1B-5.

---

## Risks and Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| 1 | **Cross-session context loss** -- With 6-7 sessions needed, each new session might not fully understand decisions made in earlier sessions | High | High | A cumulative "Phase 1A State" document is maintained across sessions, recording every decision, gotcha, and non-obvious choice. Loaded at the start of every session. |
| 2 | **Deep-copy function corruption** -- The estimate duplication function touches 10-12 tables with complex internal references. A single mapping error could silently corrupt data. | Medium | Critical | The function has 15+ dedicated test cases, a full end-to-end smoke test, and uses a proven temp-table-based mapping pattern. The plan benchmarks it for performance (<500ms for 1,000 items). |
| 3 | **Snapshot restore destroys data** -- If the restore operation fails after deleting the current estimate tree, data could be lost. | Medium | Critical | The restore function auto-saves the current state as a checkpoint before starting, uses database savepoints for atomic rollback, and has a dedicated test case for "restore with bad data leaves tree intact." |
| 4 | **Migration ordering breaks on reset** -- Since all 10 migrations run in sequence, a bug in migration 3 could block migrations 4-10 from applying. | Medium | Medium | During development, all migrations are fixed in-place and re-tested via full database reset. After committing, any fix becomes a new numbered migration. The recovery strategy is always: reset and reapply. |
| 5 | **Scope still too large for 1A** -- Even after reducing from 54 to 28 server actions and 164 to 82 tests, Phase 1A is ambitious. | Medium | Medium | The plan includes a debugging buffer in the session estimate (6-7 sessions, not 5.5). Server actions and tests follow a reference implementation pattern (one example is built first, then the rest follow the template). Any action or test that does not fit can be deferred to early 1B. |

---

## Next Steps

To start Phase 1A execution, the following needs to happen:

1. **Verify Docker is installed and running.** The local database runs in Docker containers. Without Docker, nothing works.

2. **Start the local Supabase instance.** Run `supabase start` in the project directory. This spins up a local PostgreSQL database, authentication server, and API gateway.

3. **Verify existing migrations apply cleanly.** Run `supabase db reset` to confirm the current database setup works. If this fails, there is a pre-existing issue to fix first.

4. **Confirm the authentication hook is registered.** The file `supabase/config.toml` must have a section `[auth.hook.custom_access_token]` pointing to the custom access token function. Without this, user roles will not be included in authentication tokens, and ALL security rules will silently fail.

5. **Start with Phase 1A-0.** The security foundation phase is first -- it creates the security helpers that every subsequent phase depends on.

6. **Work through phases in order.** Phases 1A-0 through 1A-2 are strictly sequential. After 1A-2, phases 1A-3 and 1A-4 can be worked on in parallel. From 1A-5 onward, everything is sequential again.

7. **Run verification scripts at every phase gate.** Every phase has a bash script that checks whether the work was done correctly. Do not proceed to the next phase until the current one passes.

---

## Appendix: File Index

All documents generated during this deep planning session:

### Codebase Profile
| File | Description |
|------|-------------|
| `.scratch/epp/20260408-2040/codebase-profile.md` | Tech stack, file counts, current state, key references |

### Phase 1: Implementation Review Board (5 Specialist Analyses)
| File | Description |
|------|-------------|
| `.scratch/epp/20260408-2040/phase-1/review-board/architecture-analysis.md` | Database design, table relationships, migration strategy |
| `.scratch/epp/20260408-2040/phase-1/review-board/security-analysis.md` | RLS policies, auth flow, share link security, role enforcement |
| `.scratch/epp/20260408-2040/phase-1/review-board/performance-analysis.md` | Query optimization, indexes, snapshot storage efficiency |
| `.scratch/epp/20260408-2040/phase-1/review-board/quality-analysis.md` | Type safety, test coverage, validation patterns, code organization |
| `.scratch/epp/20260408-2040/phase-1/review-board/business-logic-analysis.md` | Estimate workflows, option system completeness, client visibility rules |
| `.scratch/epp/20260408-2040/phase-1/comprehensive-analysis.md` | Synthesized findings from all 5 specialists (19 findings, 7 decisions) |

### Phase 3: Deep Research (8 Topic-Specific Research Files)
| File | Description |
|------|-------------|
| `.scratch/epp/20260408-2040/phase-3/research/snapshot-architecture-research.md` | How snapshots are stored, serialized, and restored |
| `.scratch/epp/20260408-2040/phase-3/research/rls-authorization-research.md` | Security policy design for every table and role |
| `.scratch/epp/20260408-2040/phase-3/research/client-visibility-research.md` | Three-level visibility system design |
| `.scratch/epp/20260408-2040/phase-3/research/options-system-research.md` | Option groups, alternatives, sets, and scenario comparison |
| `.scratch/epp/20260408-2040/phase-3/research/enum-strategy-research.md` | Status value storage strategy (CREATE TYPE vs CHECK constraints) |
| `.scratch/epp/20260408-2040/phase-3/research/type-system-research.md` | TypeScript type architecture and validation patterns |
| `.scratch/epp/20260408-2040/phase-3/research/deep-copy-function-research.md` | Estimate duplication function design with FK remapping |
| `.scratch/epp/20260408-2040/phase-3/research/settings-preferences-research.md` | Company settings and user preferences table design |

### Phase 4: Implementation Plans
| File | Description |
|------|-------------|
| `.scratch/epp/20260408-2040/phase-4/implementation-plan.md` | Original plan (v1) -- superseded by v2 |
| `.scratch/epp/20260408-2040/phase-4/implementation-plan-v2.md` | **APPROVED plan (v2)** -- the authoritative plan for execution |

### Phase 5: Plan Review Board (2 Iterations, 5 Reviewers Each)
| File | Description |
|------|-------------|
| `.scratch/epp/20260408-2040/phase-5/plan-review/iteration-1/feasibility-feedback.md` | Verdict: REVISE -- 2 blocking, 4 major issues |
| `.scratch/epp/20260408-2040/phase-5/plan-review/iteration-1/completeness-feedback.md` | Verdict: REVISE -- 4 major gaps found |
| `.scratch/epp/20260408-2040/phase-5/plan-review/iteration-1/correctness-feedback.md` | Verdict: REVISE -- 1 blocking, 7 major errors |
| `.scratch/epp/20260408-2040/phase-5/plan-review/iteration-1/dependency-feedback.md` | Verdict: REVISE -- 3 blocking dependency issues |
| `.scratch/epp/20260408-2040/phase-5/plan-review/iteration-1/risk-feedback.md` | Verdict: REVISE -- 2 blocking, 6 major risks |
| `.scratch/epp/20260408-2040/phase-5/plan-review/iteration-2/feasibility-feedback.md` | Verdict: **APPROVE** -- all issues resolved |
| `.scratch/epp/20260408-2040/phase-5/plan-review/iteration-2/completeness-feedback.md` | Verdict: **APPROVE** -- all issues resolved |
| `.scratch/epp/20260408-2040/phase-5/plan-review/iteration-2/correctness-feedback.md` | Verdict: **APPROVE** -- all issues resolved |
| `.scratch/epp/20260408-2040/phase-5/plan-review/iteration-2/dependency-feedback.md` | Verdict: **APPROVE** -- all issues resolved |
| `.scratch/epp/20260408-2040/phase-5/plan-review/iteration-2/risk-feedback.md` | Verdict: **APPROVE** -- all issues resolved |

### Phase 7: Executive Summary
| File | Description |
|------|-------------|
| `.scratch/epp/20260408-2040/phase-7/executive-summary.md` | This document |

### Agent Briefs
| File | Description |
|------|-------------|
| `.scratch/epp/20260408-2040/briefs/phase-1-brief.md` | Shared instructions for Phase 1 review board agents |
| `.scratch/epp/20260408-2040/briefs/phase-3-brief.md` | Shared instructions for Phase 3 research agents |
| `.scratch/epp/20260408-2040/briefs/phase-5-brief.md` | Shared instructions for Phase 5 plan review agents |
