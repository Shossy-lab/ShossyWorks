# Codebase Map -- ShossyWorks
<!-- UPDATED: 2026-04-02 | VERSION: 1 | BY: onboard -->
<!-- This file is a hybrid: Sections marked [CURATED] are human-maintained. -->
<!-- Sections marked [GENERATED] are rebuilt by the codebase-mapper agent (Agent 1 in /finish-session). -->
<!-- Update at the end of EVERY implementation session. -->

## Architecture Overview [CURATED]

**What this app does:** ShossyWorks -- newly created project. Purpose and architecture to be defined.

**Core mental model:** Greenfield repository -- no code structure established yet.

**Key architectural decision:** Stack and architecture TBD -- will be documented here as decisions are made.

---

## File Registry [GENERATED]
<!-- Last generated: 2026-04-02 -->
<!-- Agent 1 (codebase-mapper) maintains this section during /finish-session -->

### Source Files

No source files yet. Project is at initial setup stage.

### Configuration Files

    Root:
      CLAUDE.md             -- AI agent navigation hub
      INTENT.md             -- Design intent and decision reasoning
      CODEBASE_MAP.md       -- THIS FILE
      CONTRACT-INDEX.md     -- Contract quick-lookup table
      README.md             -- Project readme
      .gitattributes        -- Git merge strategies for docs

    .claude/
      settings.json         -- Claude Code hooks and permissions
      rules/                -- 7 rule files (architecture, agents, code-style, contracts, docs, git, tools)
      agents/               -- 7 agent definitions
      commands/             -- Session protocol commands (start-session, finish-session)
      hooks/                -- 5 lifecycle hooks
      workflows/            -- Agent team workflow, prompt templates, state schema
      memory/               -- Session handoffs, topic files, scratch

---

## Dependency Graph [GENERATED]
<!-- Key import relationships. Numbers = import count across codebase. -->
<!-- Agent 1 (codebase-mapper) maintains this section during /finish-session -->

### Most-Imported Modules

No source modules yet.

---

## Database Schema [CURATED]

No database configured yet.

---

## API Routes [CURATED]

No API routes yet.

---

## Contracts Index [CURATED]

No contracts yet -- will be created as feature boundaries emerge.

---

## Design System [CURATED]

No design system yet.

---

## Known Refactoring Targets [CURATED]

None -- clean slate.

---

## External Integrations [CURATED]

| Service | Purpose | Config Location |
|---------|---------|----------------|
| GitHub | Source control | Shossy-lab/ShossyWorks |

---

## Recent Changes Log [GENERATED]
<!-- Last 5 sessions. Oldest entries roll off when adding new ones. -->
<!-- Agent 1 (codebase-mapper) maintains this section during /finish-session -->

| Date | Phase | Key Changes | Files Touched |
|------|-------|-------------|---------------|
| 2026-04-02 | Initial setup | Project created, Claude setup onboarded | 43 files |
