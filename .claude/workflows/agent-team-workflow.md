# Agent Team Workflow

## Overview

The Agent Team Workflow orchestrates multiple AI agents for complex tasks that exceed the scope of a single agent. It uses a tiered system that matches process complexity to task complexity, preventing both under-engineering (missed issues) and over-engineering (wasted cost/time).

This workflow is designed to be invoked by the primary Claude Code agent (the orchestrator) when a task is identified as requiring multi-agent coordination. The orchestrator reads this document, selects the appropriate tier, and follows the phased execution plan.

---

## Tier System

| Tier | Agents | Typical Cost | Use When |
|------|--------|-------------|----------|
| **Tier 1: Simple** | 2 agents | ~$1 | Bug fixes, small features, single-domain changes |
| **Tier 2: Medium** | 5-8 agents | ~$4 | Multi-file features, cross-domain changes, refactoring |
| **Tier 3: Complex** | 10-15 agents | ~$7+ | New pages/features, architecture changes, multi-system integration |

### Cost Awareness

Before selecting a tier, estimate the cost and confirm with the user if the task warrants it. Log estimated vs actual agent count at completion.

---

## Tier Selection Decision Tree

```
Is it a single file change with clear scope?
  YES → Don't use workflow. Handle directly.
  NO  ↓

Does it touch 2-5 files in one domain?
  YES → Tier 1
  NO  ↓

Does it cross feature boundaries or require 5+ file changes?
  YES → Tier 2
  NO  ↓

Does it require new architecture, new pages, or touch 3+ domains?
  YES → Tier 3
  NO  → Tier 2 (default to medium when uncertain)
```

### Domain Definition

A "domain" is a logical area of the codebase — examples:
- Database layer (schema, migrations, queries)
- API layer (routes, server actions, middleware)
- UI layer (components, pages, layouts)
- Auth/security
- External integrations (third-party APIs, webhooks)
- Infrastructure (config, deployment, CI/CD)

---

## Workflow Phases (5 Waves)

### Wave 1: Research

**Purpose**: Explore the codebase, understand current state, identify dependencies and risks.

**Agents**: 1-2 research agents depending on tier

**Process**:
1. Read the task description and any referenced files
2. Map the relevant parts of the codebase (file structure, imports, types)
3. Identify existing patterns to follow
4. Find contracts/interfaces that constrain the implementation
5. Document dependencies and potential conflict zones

**Output**: `.scratch/{task-slug}/research.md`

**Completion Criteria**: All questions about "what exists" are answered. No implementation decisions yet.

### Wave 2: Planning

**Purpose**: Decompose the task into an implementation plan with file-level specificity.

**Agents**:
- Tier 1: 1 planner
- Tier 2: 1 planner
- Tier 3: 2-3 planners + 1 auditor (deliberative consensus)

**Process**:
1. Read research output
2. Create implementation plan with specific files, functions, and changes
3. Identify test strategy
4. Document risks and uncertainties (dissent log — cannot be empty)
5. Estimate number of implementation agents needed

**Output**: `.scratch/{task-slug}/plan.md`

**Tier 3 Consensus Process**:
1. Spawn 2-3 independent planner agents with identical briefs
2. Each produces a plan independently
3. Auditor agent compares plans and produces verdict:
   - **TRUE CONSENSUS**: Plans agree on approach → proceed with merged plan
   - **NEAR CONSENSUS**: Plans agree on 80%+ → auditor resolves differences, proceed
   - **FALSE CONSENSUS**: Fundamental disagreements → escalate to user with options
4. Output: `.scratch/{task-slug}/consensus.md`

**Human Gate** (Tier 2 & 3): Present plan to user for approval before proceeding.

**Completion Criteria**: Plan specifies every file to create/modify, with descriptions of changes. Dissent log exists.

### Wave 3: Implementation

**Purpose**: Execute the plan. Write code with TDD approach when possible.

**Agents**:
- Tier 1: 1 implementation agent
- Tier 2: 2-4 implementation agents (parallelized by domain)
- Tier 3: 3-6 implementation agents (parallelized by domain)

**Process**:
1. Read the approved plan
2. Write tests first when applicable (TDD)
3. Implement changes file by file per plan
4. Run type-check after each significant change
5. Self-validate against plan checklist

**Parallelization Rules**:
- Agents can work in parallel ONLY if they touch different files
- If two agents need the same file, serialize them (earlier in plan goes first)
- Shared types/interfaces must be created before dependent implementations
- Database schema changes must complete before code that uses them

**Output**: The actual code changes (committed or staged)

**Completion Criteria**: All planned changes implemented. No known type errors in changed files.

### Wave 4: Verification

**Purpose**: Automated quality checks — build, type-check, lint, tests.

**Agents**: 1 verification agent

**Process**:
1. Run full build (`npm run build`)
2. Run type-check (`npx tsc --noEmit`)
3. Run linter (`npm run lint`)
4. Run tests (`npm test` or `npm run test`)
5. Check for uncommitted debug code (console.log, debugger, TODO/FIXME from this task)

**Output**: `.scratch/{task-slug}/verification.md`

**On Failure**: Transition to FIXING state. Create fix plan and loop back to Implementation (max 3 iterations).

**Completion Criteria**: All checks pass.

### Wave 5: QA (Quality Assurance)

**Purpose**: Human-quality code review for things automation cannot catch.

**Agents**:
- Tier 1: 1 code reviewer (the code-reviewer agent)
- Tier 2: 1 code reviewer + 1 integration reviewer
- Tier 3: 1 code reviewer + 1 integration reviewer

**Process**:
1. **Code Quality Review**: Line-by-line review using the code-reviewer agent protocol
2. **Integration Review** (Tier 2+): Cross-file compatibility, data flow correctness, side effects

**Output**: `.scratch/{task-slug}/qa-report.md`

**Human Gate** (Tier 3): Present QA report to user before finalizing.

**On BLOCK Findings**: Transition to FIXING state. Loop back with fix plan (max 3 iterations).

**Completion Criteria**: Verdict is PASS or PASS_WITH_NOTES.

---

## State Machine

```
IDLE
  ↓ (task received)
RESEARCH
  ↓ (research complete)
PLANNING
  ↓ (plan ready)              ↓ (Tier 3 only)
  ↓                        CONSENSUS
  ↓                            ↓
  ↓ ← ← ← ← ← ← ← ← ← ← ← ↓
  ↓
HUMAN_GATE_PLAN (Tier 2, 3)
  ↓ (approved)
IMPLEMENTING
  ↓ (code written)
VERIFYING
  ↓ (checks pass)          ↓ (checks fail)
  ↓                      FIXING ←──┐
  ↓                        ↓       │
  ↓                        ↓ ──────┘ (max 3 iterations)
  ↓                        ↓ (still failing after 3)
  ↓                      ESCALATED → (user intervention)
  ↓
QA
  ↓ (pass)              ↓ (BLOCK findings)
  ↓                   FIXING ←──┐
  ↓                     ↓       │
  ↓                     ↓ ──────┘ (max 3 iterations)
  ↓                     ↓ (still failing after 3)
  ↓                   ESCALATED → (user intervention)
  ↓
HUMAN_GATE_QA (Tier 3)
  ↓ (approved)
COMPLETE
```

### State Transitions

Each transition must:
1. Update `workflow-state.json`
2. Log the transition to the history array
3. Compact agent context if transitioning between major phases

### Terminal States
- **COMPLETE**: All phases passed, work is done
- **FAILED**: Unrecoverable error (e.g., impossible task, missing prerequisites)
- **ESCALATED**: Hit iteration cap or encountered ambiguity requiring human decision

---

## Orchestrator Rules

The primary agent acts as the orchestrator. It manages the workflow but does NOT accumulate implementation work in its own context.

### Core Principles

1. **Delegate, don't accumulate**: The orchestrator spawns agents for work. It reads their outputs but does not do the work itself.
2. **Checkpoint religiously**: Write `workflow-state.json` before every phase transition. This enables crash recovery.
3. **Compact aggressively**: Between major phases, compact context to avoid running out of context window.
4. **Validate outputs**: Before advancing to the next phase, verify the current phase's output exists and meets completion criteria.
5. **Escalate early**: If stuck after 2 iterations of the same fix cycle, escalate to the user rather than burning tokens.

### Agent Spawning Pattern

When spawning a subagent:
1. Create a brief file at `.scratch/{task-slug}/brief-{agent-role}.md`
2. Include: task context, specific instructions, input files to read, output format expected
3. Spawn the agent using the Agent tool with clear instructions to read the brief
4. Wait for completion
5. Read and validate the output

### Error Handling

- **Agent fails to produce output**: Retry once with a clearer brief. If still fails, escalate.
- **Agent produces incorrect output**: Log the issue, create a correction brief, spawn a new agent.
- **Build/test failures**: Transition to FIXING state with failure details.
- **Conflicting agent outputs**: Use the consensus process (even in Tier 2 if conflicts arise).

---

## Human Gates

Human gates are synchronization points where the workflow pauses for user approval.

### Tier 1: No Gates
- Fully autonomous from start to finish
- User is notified only at completion

### Tier 2: Plan Gate
- Pause after Planning phase
- Present the implementation plan to the user
- Wait for: APPROVE, MODIFY, or REJECT
- MODIFY: Update plan per feedback, present again
- REJECT: Abort workflow, transition to FAILED

### Tier 3: Plan Gate + QA Gate
- Plan Gate (same as Tier 2)
- QA Gate: After QA phase, present the review report
- User can request additional fixes or approve

### Gate Presentation Format

```
## Workflow Gate: {Plan Approval | QA Approval}

### Task: {feature name}
### Tier: {1|2|3}
### Current Phase: {phase}

{Plan summary or QA report}

### Options
1. **APPROVE** — Proceed to next phase
2. **MODIFY** — Adjust the plan/fix specific items (provide details)
3. **REJECT** — Abort this workflow

What would you like to do?
```

---

## Model Selection

All agents use Opus for maximum quality and reasoning capability.

| Role | Model | Rationale |
|------|-------|-----------|
| Orchestrator | Opus | Manages complex state transitions |
| Research agents | Opus | Needs deep codebase understanding |
| Planning agents | Opus | Requires architectural reasoning |
| Consensus auditor | Opus | Must evaluate competing plans |
| Implementation agents | Opus | Code quality matters most here |
| Verification agents | Opus | Needs to interpret error output |
| Review agents | Opus | Nuanced quality assessment |

---

## Non-Negotiable Rules

These rules cannot be overridden by any agent or any part of the workflow.

### 1. Fact-Check Everything
Planners and implementers MUST verify claims about the codebase using tools (Read, Grep, Glob). Never assume a file exists, a function has a certain signature, or a pattern is used without checking. "I believe" is not acceptable — "I verified by reading {file}" is.

### 2. Dissent Log Required
Every plan MUST include a dissent log documenting uncertainties, alternatives considered, and risks. An empty dissent log means the planner did not think critically enough. Minimum 2 entries.

### 3. Iteration Cap
Maximum 3 fix cycles (FIXING → IMPLEMENTING/QA → FIXING) before escalating to the user. This prevents infinite loops and runaway costs.

### 4. Cost Tracking
Log the following at workflow completion:
- Tier selected
- Agents spawned (by role)
- Fix cycles used
- Estimated vs actual complexity

### 5. Crash Recovery
`workflow-state.json` must always reflect the current state. If the workflow is interrupted and restarted, the orchestrator must:
1. Read `workflow-state.json`
2. Determine the last completed phase
3. Resume from the next phase (do not re-execute completed phases)

### 6. No Orphaned Artifacts
`.scratch/{task-slug}/` must be cleaned up after COMPLETE. The workflow state file and any useful outputs (like the QA report) should be preserved elsewhere if needed.

### 7. Scope Discipline
Agents must not make changes outside the scope of the plan. If an agent discovers something that needs fixing but is out of scope, it logs it as a NOTE in its output — it does not fix it.

---

## Scratch Workspace

All inter-agent communication happens through files in the scratch workspace.

### Structure

```
.scratch/
  {task-slug}/
    brief-research.md          # Research agent brief
    research.md                # Research output
    brief-planner.md           # Planner brief
    plan.md                    # Implementation plan
    consensus.md               # (Tier 3) Consensus report
    brief-impl-{n}.md          # Implementation agent briefs
    verification.md            # Verification results
    qa-report.md               # QA review report
    fix-plan-{n}.md            # Fix plans for iterations
    workflow-state.json        # Current workflow state
```

### Rules
- The `.scratch/` directory is gitignored
- Each task gets its own subdirectory using a slug derived from the task name
- Briefs are written BEFORE spawning agents
- Outputs are validated AFTER agents complete
- Cleaned up after workflow reaches COMPLETE state

---

## Workflow Invocation

### Starting a Workflow

When the user requests a task that warrants multi-agent coordination:

1. Assess the task scope using the decision tree
2. Announce the selected tier and estimated cost
3. Create `.scratch/{task-slug}/`
4. Initialize `workflow-state.json`
5. Begin Wave 1 (Research)

### Example Invocation

```
User: "Add a new settings page with user profile editing, password change, and notification preferences"

Orchestrator assessment:
- New page: yes
- Multiple domains: UI, API, database
- Estimated files: 10-15
→ Tier 3

"This task requires a Tier 3 workflow (new page, 3 domains, ~12 files).
Estimated cost: ~$7. Shall I proceed?"
```

### Resuming a Workflow

If a workflow was interrupted:

1. Check for `.scratch/*/workflow-state.json`
2. Read the state file
3. Report current state to user
4. Offer to resume or restart

---

## Integration with finish-session

When the user invokes `finish-session` or asks to wrap up:

1. If a workflow is in progress, check its state
2. If in COMPLETE state, confirm all cleanup is done
3. If in any other state, report current progress and ask if user wants to:
   - Save state and resume later
   - Abort the workflow
   - Push through to completion now

The code-reviewer agent is always invoked as part of finish-session, regardless of whether a workflow is active. It reviews all staged changes independently.

---

## Customization Points

When applying this template to a specific project, customize:

1. **Domain definitions**: What constitutes a domain in this project
2. **Build commands**: The exact build, lint, test commands
3. **Contract locations**: Where interface contracts live
4. **Naming conventions**: Project-specific naming rules
5. **Test patterns**: Testing framework and conventions
6. **Deployment checks**: Any deployment-specific verification steps

These customizations go in the project's CLAUDE.md or in project-specific rule files, NOT in this workflow document.
