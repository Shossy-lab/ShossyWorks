# ShossyWorks UI Planning -- Executive Summary

**Date:** 2026-04-09
**Prepared for:** Zac Szostak (Project Owner)
**Status:** Plan APPROVED by review boards. Awaiting your input before we start building.

---

## 1. What Was Analyzed

We ran a full planning operation on the ShossyWorks user interface -- the screens, buttons, forms, and workflows that you will actually see and use every day. This is the part that failed twice before (EP and Soloway), so we treated it with extra rigor.

The analysis covered:
- **Your existing codebase:** 35+ database tables, 28 server actions, the design system, and the auth flow that already work
- **What went wrong before:** EP's data instability, Soloway's inability to handle editing, and the "generic AI look" you called out
- **What your Figma prototypes might contribute** (we need to discuss this -- see Questions document)
- **How professional estimating software** (ProEst, Cubit) handles tree-based cost data
- **Your 5 interaction decisions** from April 8 (project lifecycle, node actions, preferences, client experience, search)
- **The best technical approaches** for building the estimate tree editor -- the core of the entire product

---

## 2. Agent Deployment Summary

This planning session used multiple AI review boards working in parallel to analyze the problem from every angle, then scrutinize the resulting plan.

| Phase | What Happened | Agents Used |
|-------|--------------|-------------|
| Codebase Profile | Documented current state, gaps, and constraints | 1 |
| Historical Context | Analyzed what went wrong in EP and Soloway | 1 |
| Implementation Review Board | 5 specialist analysts examined page architecture, component design, state management, visual design, and build sequencing | 5 + research subagents |
| Comprehensive Synthesis | Combined all 5 analyses into unified findings with resolved disagreements | 1 |
| Research Phase | 8 deep-dive research files on specific technical topics (tree rendering, keyboard accessibility, Radix UI, etc.) | 8 |
| Plan Architecture | Built the implementation plan from all findings and research | 1 |
| Plan Review Board (Iteration 1) | 5 reviewers checked feasibility, completeness, correctness, dependencies, and risk | 5 |
| Plan Revision | Addressed all 35 issues found by reviewers | 1 |
| Plan Review Board (Iteration 2) | Same 5 reviewers verified all fixes | 5 |
| **Total** | | **~28 agent deployments** |

**Iteration 1 verdicts:** 1 APPROVE (Correctness), 4 REVISE (Feasibility, Completeness, Dependency, Risk)
**Iteration 2 verdicts:** 5 APPROVE (unanimous)

---

## 3. Top Findings (Plain English)

Here is what the review board discovered, in order of importance:

**The original plan was missing its foundation.** The plan listed building features (snapshots, catalog, options, client portal) but never allocated time to build the estimate tree itself -- the thing those features depend on. This is like scheduling drywall before framing. We added a "Phase 1B-0" foundation of 5-6 sessions to build the tree editor first.

**The estimate tree is 40-60% of the entire UI effort.** This is the core of the product -- where you view, edit, organize, and price construction estimates. It requires a custom-built component (no off-the-shelf library fits your needs), virtual scrolling to handle large estimates (2000+ line items), and keyboard navigation so power users can work efficiently.

**Previous failures had three specific causes, and this plan addresses all three:**
1. EP built the UI while the database was still changing -- things broke constantly. *This time, the database is complete and stable before we touch the UI.*
2. Both attempts produced a generic, cookie-cutter look. *This time, every visual property flows through your design system tokens -- sharp corners on rectangles, pill-shaped buttons, monochrome palette. No exceptions.*
3. Soloway's components were too tangled together -- changing one thing broke something else. *This time, the tree display is completely separated from the editing panel. You can replace either one without touching the other.*

**The plan needs your input on 6 blocking decisions before any code is written.** These are covered in the companion Questions document. The most important one is the Figma prototype discussion -- we need to understand which parts of your Figma designs represent your vision vs. exploration.

**We identified and fixed 35 issues across two review rounds.** These ranged from missing test plans to underestimated timelines to technical contradictions. Every CRITICAL and HIGH issue was resolved before approval.

---

## 4. The Approved Plan at a Glance

| Phase | What Gets Built | Sessions | You Need To Review? |
|-------|----------------|----------|-------------------|
| CP-0 | You review this plan, answer blocking questions, walk through Figma | -- | YES |
| 1B-0.0a | Reusable UI building blocks (buttons, dialogs, menus) | 0.5 | No |
| 1B-0.0b | Form fields (text, numbers, currency, percentages) + layout pieces | 0.5 | YES -- "Does the look feel right?" |
| 1B-0.1 | Sidebar with icons, breadcrumb navigation, page skeletons | 0.75 | YES -- "Does this feel like ShossyWorks?" |
| 1B-0.2 | Project list, project detail, estimate list, create/edit dialogs | 0.75 | No |
| 1B-0.3 | The estimate tree -- rendering, expand/collapse, virtual scrolling | 1.5 | No |
| 1B-0.4 | Detail panel for editing nodes (items, assemblies, groups) | 1.0 | YES -- "Try the tree on your device" |
| 1B-0.5 | Tree polish: move nodes, keyboard shortcuts, right-click menus | 0.75 | No |
| 1B-T1 | Automated tests for the tree logic | 0.5 | No |
| 1B-6 | Settings: company info, default rates, user preferences | 0.75 | No |
| 1B-5 | Search and filtering within estimates | 1.0 | No |
| 1B-2 | Catalog system (reusable items/assemblies) | 2-3 | No |
| 1B-1 | Snapshots (save and compare estimate versions) | 2-3 | No |
| 1B-3 | Options system (alternates and upgrades for clients) | 2-3 | No |
| 1B-4 | Client portal (share estimates, get approvals) | 3-4 | No |
| **Total** | | **21-27 sessions** | **4 checkpoints** |

**What you can start using at the MVP milestone (after ~6 sessions):**
Working project and estimate navigation, a functional tree editor where you can create/edit/organize estimate items with full keyboard navigation, company settings configured, and basic search within estimates. Enough to start entering real estimates.

---

## 5. Key Architecture Decisions Made (Non-Technical)

These decisions were debated by 5 analysts and are now settled. You do not need to re-decide these -- they are based on what worked in similar software and what failed in EP/Soloway.

**The tree and the editing panel are separate.** When you click a node in the tree, its details appear in a panel to the right. This is how VS Code, Figma, and ProEst work. EP used pop-up modals (broke your flow). Soloway let you edit right in the tree rows (made everything fragile). The side panel avoids both problems.

**The tree handles large estimates.** Virtual scrolling means only the 30-50 visible rows exist at any time, even if the estimate has 2000 items. This keeps things fast without you noticing.

**Keyboard first, drag-and-drop later.** You can navigate the tree with arrow keys, indent/outdent with keyboard shortcuts, and add/delete with keyboard commands. Drag-and-drop for rearranging nodes comes in Phase 2 -- it adds complexity and is not needed for core functionality.

**The visual design system is enforced automatically.** A script runs on every code change checking for violations (wrong colors, wrong corner styles, etc.). This prevents the gradual drift toward generic-looking UI that happened before.

**Future-proofing for real-time collaboration.** The tree's internal architecture already has slots for real-time updates (multiple people editing the same estimate). The wiring comes later, but the foundation is there from day one. This avoids the Soloway problem of retrofitting collaboration onto code that was not designed for it.

---

## 6. What Changed from v1 to v2

The Plan Review Board found 35 issues in v1. Here are the most significant changes:

| What Changed | Why |
|-------------|-----|
| Added a testing strategy | v1 had zero testing. For a project that has failed twice, the core tree logic needs automated tests. |
| Added checkpoint failure protocols | v1 said "checkpoints are blocking" but never said what happens if you reject something. v2 budgets rework time and caps revision cycles. |
| Split the first building session in two | v1 tried to build 27 components in one session. v2 builds the foundations first, then the forms and layouts. |
| Increased tree view time from 1 to 1.5 sessions | The tree is the most complex part of the product. 1 session was optimistic. |
| Added Phase 1A verification | v1 assumed the database was ready. v2 runs checks to confirm before building anything on top. |
| Added overrun protocols | If the tree takes longer than expected, v2 has specific decision points at 1.5x, 2x, and 2.5x the estimate. |
| Specified what the Settings page actually shows | v1 just said "settings form." v2 lists every field. |
| Added error handling strategy | v1 did not address what users see when things go wrong. v2 maps every error type to a user-friendly message. |
| Adjusted total budget from 19-24.5 to 21-27 sessions | Reflects realistic estimates for the tree view, testing, and checkpoint rework. |

---

## 7. Risks and How We Are Handling Them

| Risk | What Could Go Wrong | Our Mitigation |
|------|-------------------|----------------|
| Tree view overrun | The tree editor is complex and could take longer than planned | Budget includes 3 sessions of buffer. Decision triggers at 1.5x, 2x, and 2.5x with specific simplification options. |
| Checkpoint rejection loops | You review something, reject it, we rework, you reject again | Maximum 2 revision cycles per checkpoint. After that, we do a structured design conversation together. |
| Figma vs. architecture conflict | Your Figma designs might show a different layout than what we planned | Conflict resolution protocol: layout conflicts get discussed, inline editing is deferred to Phase 2 regardless, visual styling gets mapped to tokens. |
| Performance at scale | The tree might be slow with 2000 nodes | Performance testing protocol with specific benchmarks. If the primary approach is slow, we have two fallback strategies. |
| "AI slop" creeping back in | Over time, components drift from the design system | Automated enforcement script catches 80% of violations. Reviewer agents catch the remaining 20%. Your checkpoints catch anything else. |
| Data layer not actually ready | A database table or trigger might be missing | Verification checklist runs before any UI code. If something fails, we fix the data layer first. |

---

## 8. Next Steps (What Needs to Happen to Start Building)

1. **You review the Questions document** (companion to this summary). It contains 6 blocking decisions, 4 important decisions, and 3 nice-to-have decisions. The blocking ones must be answered before any code is written.

2. **We schedule the CP-0 conversation** -- a 30-60 minute session where you:
   - Confirm or adjust the plan
   - Walk through your Figma prototypes and tell us what to extract
   - Answer the 6 blocking decisions
   - Approve or modify the feature build order

3. **After CP-0, coding begins** with Phase 1B-0.0a (building the foundational UI components). The first checkpoint where you review the visual direction (CP-1) comes after about 1 session of work.

4. **You will have 4 review checkpoints** during the build. Each takes 5-30 minutes of your time. The most important one is CP-3, where you actually use the tree editor on your own device.

---

## 9. Appendix: File Index

All planning artifacts produced during this session:

| File | Purpose |
|------|---------|
| `.scratch/epp/20260409-1957-ui-planning/codebase-profile.md` | Snapshot of current codebase state |
| `.scratch/epp/20260409-1957-ui-planning/briefs/historical-context.md` | What went wrong in EP and Soloway |
| `.scratch/epp/20260409-1957-ui-planning/phase-1/comprehensive-analysis.md` | Synthesized findings from 5-analyst review board |
| `.scratch/epp/20260409-1957-ui-planning/phase-4/ui-implementation-plan-v2.md` | The approved implementation plan (v2) |
| `.scratch/epp/20260409-1957-ui-planning/phase-5/plan-review/iteration-1/*.md` | 5 reviewer verdicts on v1 (1 APPROVE, 4 REVISE) |
| `.scratch/epp/20260409-1957-ui-planning/phase-5/plan-review/iteration-2/*.md` | 5 reviewer verdicts on v2 (5 APPROVE) |
| `.scratch/epp/20260409-1957-ui-planning/phase-7/executive-summary.md` | This document |
| `.scratch/epp/20260409-1957-ui-planning/phase-7/questions-for-zac.md` | Blocking decisions and input needed |
