# ShossyWorks -- Durable Instructions

@import README.md

## Session Protocol

### Start (MANDATORY -- every session)
Run /start-session at the beginning of every session. This command:
0. Git sync: git fetch -- if behind remote, warn user and recommend git pull
1. Reads INTENT.md, CODEBASE_MAP.md, CONTRACT-INDEX.md, .claude/memory/index.md
2. Reads latest session handoff from .claude/memory/sessions/
3. Evaluates task for agents (Three-Criteria Evaluation from .claude/rules/autonomous-agents.md)
4. Reports ready state to user

### During Session (INCREMENTAL WRITES -- non-negotiable)
- Log feature gaps/friction points IMMEDIATELY when encountered
- Update contracts when boundary code changes -- in the same edit sequence
- Update docs when referenced structures change -- before moving to the next task
- Use /compact at natural breakpoints; after compaction, re-read core context files

### Finish (MANDATORY -- before every session end)
Run /finish-session before indicating task completion. This command:
1. Verifies build passes
2. Deploys 3-5 documentation agents (codebase-mapper, intent-curator, contract-auditor, doc-updater, memory-updater)
3. Validates agent output
4. Updates CONTRACT-INDEX.md
5. Creates session handoff document
6. Cleans memory scratch
7. Removes session marker
8. Stages and commits atomically (code + docs + contracts + memory)
9. Reports to user, asks before pushing

## Context Budget

| Layer | Files | When | Target |
|-------|-------|------|--------|
| L0 | CLAUDE.md + imports | Always | <100 lines + imports |
| L1 | INTENT.md + CODEBASE_MAP.md + CONTRACT-INDEX.md + memory/index.md | Every session | <200 lines each |
| L2 | Session doc + topic memory + contracts | Per-task | <1KB per contract |
| L3 | Feature docs, old sessions, architecture docs | On-demand | No limit |

Never load L3 files unless actively implementing from them. Use subagents for research to keep main context clean.

## Code Conventions

- Stack TBD -- conventions will be added once the project stack is established
- See .claude/rules/code-style.md for naming, imports, and styling conventions
- See .claude/rules/architecture.md for framework patterns and data flow

## Skills Setup

Mount the shared skills repo (one-time setup from project root):

    ln -s A:/claude-skills .claude/skills

Skills provide: deep-planning, swarm, plan-execute, batch-write, commit-batch,
validate-kb, worktree-sync, branding, bid-package, index-docs, onboard,
implementation-board, plan-review-board

The .claude/.gitignore excludes skills/ to prevent committing the symlink target.

## Rules

1. Follow session protocol every time. No exceptions.
2. Write session logs incrementally -- never batch to session end.
3. Keep always-loaded files within context budget targets.
4. Update contracts and docs when the code they reference changes -- same commit.
5. Ask before pushing to remote.
6. When in doubt, read existing code first.
7. Log feature gaps and friction points immediately.
8. All agents must use Opus model.
