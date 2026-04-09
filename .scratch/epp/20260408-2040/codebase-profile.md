# Codebase Profile — ShossyWorks

**Date:** 2026-04-08
**Project:** Construction Estimating Platform
**Owner:** Szostak Build, LLC

## Tech Stack
- **Framework:** Next.js 16.2.2 (App Router, Turbopack)
- **Language:** TypeScript (strict mode)
- **Database:** Supabase (PostgreSQL)
- **Auth:** Supabase Auth + Custom Access Token Hook (role injection)
- **Styling:** Tailwind CSS v4 + CSS custom property design tokens
- **Testing:** Vitest 3.2.4 + @vitest/coverage-v8
- **Hosting:** Vercel
- **CI/CD:** GitHub → Vercel auto-deploy

## File Counts
| Category | Files | Lines |
|----------|-------|-------|
| Source (TS/TSX) | 25 | ~1,100 |
| Styles (CSS) | 1 | ~130 |
| SQL migrations | 2 | ~140 |
| Tests | 2 | ~80 |
| Config | 6 | ~150 |
| **Total** | **32** | **~1,414** |

## Current State (Post-Hardening H1-H4)
- Phase 0: COMPLETE (scaffold, auth, deploy, app shell)
- Hardening H1-H4: COMPLETE (37 review findings fixed)
- Phase 1A: NOT STARTED (schema, triggers, types, actions, tests)
- Phase 1B+: NOT PLANNED (catalog, options, client sharing, search UI)

## Architecture Patterns
- Server Components (default) + Client Components (opt-in)
- Supabase client patterns: browser, server, admin, middleware
- Design token system via CSS custom properties + @theme block
- Error boundaries at root, (protected), and (auth) route groups
- Cached getUser/requireUser with React cache()
- T3 env validation with Zod schemas

## Key Design Decisions (from 5 interaction decisions, 2026-04-08)
1. 10-stage project lifecycle (Lead → Archived)
2. 4-stage estimate lifecycle + named snapshots with restore
3. Rich node actions: duplicate, copy, convert, catalog, options, client visibility
4. Full workspace preferences (user-level) + company settings (shared)
5. Client view+comment+approve with PIN-protected share links
6. Adjustable-scope search with filters and jump-to

## Key Reference Files
| File | Purpose |
|------|---------|
| research/output/01-data-architecture.md | Original table designs, full schema |
| research/output/research-node-promotion.md | Auto-promotion/demotion trigger SQL |
| research/output/05-addendum-new-requirements.md | archived_at, auto-demotion, optimistic locking |
| .claude/memory/sessions/2026-04-06.md | Weekend session: node_notes, interaction areas |
| .claude/projects/.../project_interaction-decisions.md | 5 interaction decisions (2026-04-08) |
| .scratch/codebase-review/20260406-0917/consolidated-findings.md | 52 review findings |
| C:\Users\zacha\.claude\plans\indexed-tumbling-wilkes.md | Current plan (needs updating) |
