---
description: End-of-session finishing protocol. Run this before ending any implementation session. This protocol handles its own agent deployment -- do NOT apply the standard Three-Criteria Evaluation from autonomous-agents.md.
---

# Finish Session Protocol

Execute the following steps in order. Do NOT skip steps. Do NOT indicate task completion without completing this protocol first.

---

## Step 1: Verify Build

Run the project build, type-check, and lint commands.

<!-- CUSTOMIZE: Replace with your project commands -->
<!-- Examples: npm run build, cargo build, go build, dotnet build -->

**If build fails:**
- Identify whether the failure is in code this session modified
- If YES: fix the code, then retry the build
- If NO (pre-existing or dependency issue): document as a known issue in the session handoff, then proceed
- If the fix is complex: create the session handoff doc recording what was attempted, commit docs only, and report to the user

---

## Step 2: Deploy Documentation Agent Swarm

Launch 3-5 background agents in parallel. ALL agents MUST use Opus. Wait for all to complete before proceeding.

Write a shared brief to .claude/memory/scratch/finish-brief.md before spawning if deploying 3+ agents. Include: date, 2-3 sentence session summary, list of files changed (from git diff --name-only).

### Agent 1: Codebase Mapper

**Scope:** Only modifies CODEBASE_MAP.md. Read-only access to everything else.

Instructions for the agent:

> You are updating CODEBASE_MAP.md after an implementation session.
>
> 1. Read the current CODEBASE_MAP.md in full
> 2. Run git diff HEAD~1 (or appropriate range) to see what changed
> 3. Update these sections as needed:
>    - File Registry [GENERATED]: Add new files, remove deleted files, update line counts
>    - Dependency Graph [GENERATED]: Update import relationships if they changed
>    - Contracts Index [CURATED]: Update if contracts were added/removed/changed
>    - Recent Changes Log: Add new entry at top, keep only last 5
>    - Timestamp: Update the header comment with current date
> 4. Do NOT modify [CURATED] sections unless factual corrections are needed
> 5. Do NOT modify any other files

### Agent 2: Intent Curator

**Scope:** Only modifies INTENT.md. Read-only access to everything else.

Instructions for the agent:

> You are reviewing the current session for design decisions to preserve in INTENT.md.
>
> 1. Read the current INTENT.md in full
> 2. Review the session for:
>    - New design decisions and their reasoning
>    - User preferences or corrections
>    - Trade-offs discussed and resolved
>    - Architectural choices and why
> 3. ADDITIONS are the primary operation:
>    - Append new decisions to the Key Decisions table
>    - Add new trade-offs to the Trade-offs section
>    - Add new constraints or future considerations as discovered
> 4. REMOVALS only under extreme circumstances:
>    - Only remove when intent has 100% clearly and explicitly changed
>    - Never remove reasoning even if conclusions changed
>    - When in doubt, ADD a note about the change rather than removing
> 5. If no meaningful intent to capture: report no new intent and make no changes
> 6. Do NOT modify any other files
> 7. Keep INTENT.md under 200 lines (context budget target)

### Agent 3: Contract Auditor

**Scope:** Read-only. Produces a report, does not modify files.

Instructions for the agent:

> You are verifying contract compliance after an implementation session.
>
> 1. Read CONTRACT-INDEX.md for the list of active contracts
> 2. Read each contract referenced by changed code (check git diff for affected features)
> 3. For each contract, verify:
>    - Code still matches the contract interface definitions
>    - No invariants are violated by the session changes
>    - Cross-feature rules are respected
> 4. Report:
>    - PASS: Contracts that are still in compliance
>    - WARN: Contracts that may need updating (ambiguous or close to boundary)
>    - FAIL: Contracts that are violated by current code
> 5. Do NOT modify any files -- report findings only

### Agent 4: Doc Updater

**Scope:** Modifies documentation files only (docs/, README.md). Read-only for code.

Instructions for the agent:

> You are scanning for documentation that needs updating after code changes.
>
> 1. Run git diff --name-only to see changed files
> 2. Check if any documentation references the changed files or features
> 3. Update affected docs:
>    - README.md if project setup/commands changed
>    - Feature docs if feature behavior changed
>    - API docs if endpoints changed
> 4. Do NOT modify code files, contracts, INTENT.md, or CODEBASE_MAP.md
> 5. If no docs need updating, report no doc updates needed

### Agent 5: Memory Updater

**Scope:** Only modifies files in .claude/memory/. Read-only for everything else.

Instructions for the agent:

> You are updating the project memory system after a session.
>
> 1. Read .claude/memory/index.md
> 2. Check if any topic files need updating based on session activity
> 3. Update topic files:
>    - Add new facts, patterns, or decisions discovered
>    - Update existing entries if understanding changed
>    - Create new topic files if a new recurring theme emerged
> 4. Update index.md:
>    - Add new topic files to the Topic Memory table
>    - Update Last Updated dates for modified topics
> 5. Do NOT modify code, docs, contracts, or root files

**If an agent fails (timeout, crash, rate limit):**
- Retry once. If it fails again:
  - Agent 1 (mapper): Manually update CODEBASE_MAP.md using git diff -- the map must stay current
  - Agent 2 (intent): Note INTENT.md not updated in session handoff for next session
  - Agent 3 (auditor): Skip -- note contract audit skipped in session handoff
  - Agent 4 (docs): Skip -- note in session handoff
  - Agent 5 (memory): Manually update memory/index.md with session entry

---

## Step 3: Validate Agent Output

Before proceeding, verify agent results:

1. **Check scope:** Run git diff --name-only -- verify each agent only modified its designated files. Revert out-of-scope changes.
2. **Check CODEBASE_MAP.md:** Confirm Recent Changes Log has a new entry and no more than 5 total. Confirm [CURATED] sections are unchanged unless factual corrections were needed.
3. **Check INTENT.md:** Confirm it is under 200 lines. Confirm new entries do not contradict existing reasoning.
4. **Check contract audit report:** Address any FAIL findings before committing. WARN findings go into session handoff.
5. **If any output is invalid:** Fix the issue manually before continuing.

---

## Step 4: Update CONTRACT-INDEX.md

Review whether any contracts were added, removed, or changed during this session.
- Update the quick-lookup table in CONTRACT-INDEX.md with any changes
- Update Last Verified dates for contracts that were audited by Agent 3

**Prompt yourself:** Did any interaction between two features surface this session that the next developer would not know about?

If yes, create or update the relevant contract in contracts/ and add it to CONTRACT-INDEX.md.

---

## Step 5: Create Session Handoff Document

Create a new file in .claude/memory/sessions/{YYYY-MM-DD}-{summary-slug}.md using the session handoff template from docs/sessions/README.md.

Required sections: Summary, What Was Done, Discoveries and Gotchas, Known Issues, Next Steps, Handoff Notes.

Update .claude/memory/index.md Recent Sessions table with this new entry (keep last 5).

---

## Step 6: Clean Memory Scratch

Remove ephemeral files that should not persist:
- Delete .claude/memory/scratch/pre-compact-state.md (if it exists)
- Delete .claude/memory/scratch/finish-brief.md (if it exists)

---

## Step 7: Remove Session Marker

Delete .claude/.session-marker to signal clean session end. If this file is found at next session start, the session-start hook will detect an orphaned session.

---

## Step 8: Stage and Commit

Stage ALL changed files atomically: code, docs, contracts, memory, maps, and intent together.

Implementation, documentation, map updates, intent updates, contract updates, and memory changes MUST be in the same commit. Never split code and docs across separate commits.

**If pre-commit hook fails:**
1. Read the error -- fix the underlying issue
2. If lint or type errors: fix them, re-stage, and commit again
3. Do NOT use --no-verify unless the hook failure is confirmed as a false positive

---

## Step 9: Report to User

Tell the user:
- What was accomplished this session
- What each agent updated (or no changes / agent failed)
- Contract audit results (any WARN or FAIL findings)
- Any edge cases or gotchas discovered
- Recommended next steps
- **Ask before pushing** -- never auto-push to remote
