---
description: Start-of-session protocol. Run this at the beginning of every session to establish context and continuity.
---

# Start Session Protocol

Execute the following steps in order:

## Step 1: Git Sync

Run `git fetch` and check if local branch is behind remote.
- If behind: **warn the user** and recommend `git pull` before continuing.
- If ahead or even: proceed normally.
- Do NOT read memory or context files until sync state is confirmed.

## Step 2: Read Core Context

Load the four L1 context files:
1. `INTENT.md` -- understand design reasoning and key decisions
2. `CODEBASE_MAP.md` -- understand full codebase structure, file registry, dependency graph
3. `CONTRACT-INDEX.md` -- quick-lookup table for all active contracts
4. `.claude/memory/index.md` -- memory system entry point, recent sessions, topic index

These files are maintained to stay under 200 lines each. Load all four every session.

## Step 3: Read Latest Session Handoff

Find the most recent file in `.claude/memory/sessions/` (sort by filename, take last).
- If found: read it to understand what happened last, known issues, and recommended next steps.
- If no session files exist: this is the first session -- proceed without prior context.
- If the most recent session is >7 days old: warn that context may be stale.

## Step 4: Evaluate Task for Agents

Apply the Three-Criteria Evaluation from `.claude/rules/autonomous-agents.md`:
1. **Research** -- Does this task need pre-understanding? (3+ files, unfamiliar area, cross-feature)
2. **Parallel** -- Are there independent workstreams? (separate features, unrelated changes)
3. **Verification** -- Will this need separate review? (multi-file, cross-feature, schema changes)

If any criterion triggers, plan the appropriate agent deployment before writing code.

## Step 5: Report Ready State

Tell the user:
- What context was loaded (list the files read)
- Current project state summary (from session handoff or CODEBASE_MAP recent changes)
- Any warnings (behind remote, stale session, orphan detection)
- Ask for task instructions if not already provided
