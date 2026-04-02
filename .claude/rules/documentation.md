---
description: Documentation standards, memory system, and context optimization
globs: ["docs/**/*.md", ".claude/memory/**/*.md", "contracts/**/*.md"]
---

# Documentation Rules

## Session Handoff Docs

- Location: `.claude/memory/sessions/{YYYY-MM-DD}.md`
- Created by the finish-session protocol at the end of every session
- Written incrementally during the session, finalized at session end

### Required Format

```markdown
# Session: {YYYY-MM-DD}

## Summary
One-paragraph overview of what this session accomplished.

## What Was Done
- Bullet list of completed work items
- Include file paths for major changes

## Discoveries
- Patterns, edge cases, or architectural insights found during work
- Anything that surprised you or changed your understanding

## Known Issues
- Bugs, tech debt, or concerns discovered but not yet fixed
- Include severity (blocking, important, minor)

## Next Steps
- Prioritized list of what should happen next
- Include enough context for a fresh session to pick up immediately

## Handoff Notes
- Anything the next session needs to know RIGHT AWAY
- Active branch state, pending PRs, broken builds, mid-refactor state
```

## Memory System

The memory system lives in `.claude/memory/` and persists knowledge across sessions.

### Structure
```
.claude/memory/
  index.md              -- Entry point: topic index + recent sessions
  topics/               -- Persistent knowledge files (committed to git)
    architecture.md     -- Architecture decisions, patterns
    debugging.md        -- Known issues, workarounds
    {topic}.md          -- Any domain-specific knowledge
  sessions/             -- Session handoff documents (committed to git)
    {YYYY-MM-DD}.md     -- One per session
  scratch/              -- Ephemeral notes (gitignored)
    pre-compact-state.md  -- Auto-written by pre-compact hook
```

### Rules
- `index.md` is the entry point -- read it every session start (L1 context)
- Topic files store persistent knowledge that spans sessions
- Session files are handoff documents, not activity logs
- Scratch is for hook-managed ephemeral state -- do not rely on it persisting
- Memory files are committed to git with `merge=union` strategy (see .gitattributes)

## Contract Files

- Location: `contracts/`
- Must be <1KB each -- contracts are interface agreements, not documentation
- Use the template in `contracts/TEMPLATE.contract.md`
- One contract per feature boundary
- Include `Last verified: {date}` and update when confirmed against code
- See `.claude/rules/contracts-enforcement.md` for the non-negotiable sync rule

## Feature Docs

- Location: `docs/features/` or `docs/` in focused, topic-specific files
- Target <5KB per file -- if a doc exceeds 10KB, split it into sub-topics
- Name files descriptively: `auth-flow.md`, `data-pipeline.md`, not `notes.md` or `misc.md`
- One README.md per feature directory as table of contents (if needed)

## Core Project Files

### CODEBASE_MAP.md (repo root)
- Primary orientation document for the codebase
- Contains: file registry, dependency graph, recent changes, refactoring targets
- Read at session start (L1 context)
- Updated by finish-session codebase-mapper agent
- Update trigger: any file added, removed, renamed, or significantly restructured

### INTENT.md (repo root)
- Design decisions, reasoning, trade-offs, constraints
- Numbered decisions with rationale
- Never remove a decision without explicit user approval -- supersede instead
- Updated by finish-session intent-curator agent
- Update trigger: any design or architecture decision made during a session

### CONTRACT-INDEX.md (repo root)
- Quick-lookup table of all contracts
- Format: Feature | Contract File | Governs | Key Rule | Last Verified
- Read at session start (L1 context)
- Updated whenever contracts change
- Must always reflect the current state of `contracts/` directory

## Context Optimization

### Context Budget Layers
| Layer | Content | When Loaded | Target Size |
|-------|---------|-------------|-------------|
| L0 | CLAUDE.md + imports | Always (automatic) | <100 lines + imports |
| L1 | INTENT.md + CODEBASE_MAP.md + CONTRACT-INDEX.md + memory/index.md | Every session start | <200 lines each |
| L2 | Active session doc + relevant topic memory + relevant contracts | Per-task | <1KB per contract |
| L3 | Feature docs, old sessions, architecture deep-dives | On-demand via subagents | No limit |

### Rules
- Never load >10KB into main conversation context at once
- Use subagents for research that requires reading many files
- Reference docs by path rather than pasting contents when possible
- Use `/compact` proactively at ~70% context usage
- Start fresh sessions for unrelated tasks

## Documentation Agent Swarm (Session End)

The finish-session protocol deploys an autonomous documentation swarm:

1. **codebase-mapper agent** -- Updates CODEBASE_MAP.md (file registry, dependency graph, recent changes)
2. **intent-curator agent** -- Curates INTENT.md (new decisions, updated reasoning)
3. **contract-auditor agent** -- Verifies contract compliance against code
4. **doc-updater agent** -- Scans changed files, updates affected docs
5. **memory updater** -- Updates memory index + topic files

These agents run in parallel with `run_in_background=true`. The main thread validates their output before committing. See `.claude/commands/finish-session.md` for the full protocol.
