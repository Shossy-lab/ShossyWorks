# Autonomous Agent Deployment

Claude Code MUST independently evaluate every task for subagent/team deployment.
This is NOT optional. Do NOT wait for the user to suggest agents. Evaluate BEFORE writing any code.

## Model Requirement (MANDATORY)

**ALL agents MUST use Opus** (`model: "opus"`). No exceptions. Every subagent, every team member, every reviewer -- always Opus. The deep reasoning capability is essential for accurate codebase understanding, correct cross-feature analysis, and reliable code review. Never use lighter models for any agent in this project.

## Three-Criteria Evaluation (MANDATORY on Every Task)

Run these three questions before starting any implementation. If ANY answer is yes, deploy agents.

### 1. Research -- "Do I need to understand before I change?"

**Trigger:** Task touches 3+ files, spans multiple features, or you are unsure about current state.

**Action:** Spawn a read-only research subagent (`model: "opus"`) to map affected files, current imports, function signatures, and relevant contracts BEFORE the main agent writes a single line of code.

**Why:** The accuracy improvement from pre-research almost always pays for the ~1.5x token overhead. Mistakes from incomplete understanding cost far more to fix than the subagent costs to run.

### 2. Parallel -- "Are there independent pieces?"

**Trigger:** Task has workstreams that don't depend on each other (e.g., frontend component + database migration + type definitions for separate features).

**Action:** Spawn agent team (2-3 teammates, all `model: "opus"`) with clear scope per teammate. Each teammate works independently; main agent synthesizes results.

**Why:** Wall-clock time drops proportionally. Use only for genuinely independent work -- not for things that must be sequential.

### 3. Verification -- "Do I need to check my work separately?"

**Trigger:** Multi-file changes, cross-feature work, design system modifications, or any refactoring.

**Action:** Plan for a reviewer subagent (`model: "opus"`) at the end -- type checking, lint, contract compliance, design system adherence. Spawn BEFORE committing.

**Why:** Self-review in the same context that wrote the code has blind spots. A fresh context catches what you miss.

## Subagent Deployment Patterns

### Research Subagent (most common)
Launch for:
- **Pre-implementation mapping:** Before modifying code that touches 3+ files, map affected files, imports, and function signatures.
- **Codebase exploration:** Understanding how a feature works across multiple files -- delegate to subagent so main context stays clean.
- **Impact analysis:** Before refactoring, find all usages of the function/component/type being changed.
- **Contract verification:** When implementing cross-feature work, read relevant contracts and report interface rules.

### Documentation Subagent
Launch for:
- **Current state generation:** Scanning files and compiling what changed into session handoff docs.
- **CODEBASE_MAP updates:** Reading new/changed files to update the file registry and dependency graph.
- **Build/lint output analysis:** Running builds or linters that produce verbose output, summarizing results.

### Reviewer Subagent
Launch for:
- **Pre-commit review:** Type safety, contract compliance, design system adherence, naming conventions.
- **Cross-feature validation:** Verify changes don't violate contracts of features you didn't intend to modify.

## Agent Team Deployment

Launch teams (2-3 teammates) for:
- **Multi-layer changes:** Frontend + backend + types for separate features -- teammates explore each layer in parallel, then implement sequentially.
- **Architecture decisions:** Multiple valid approaches exist -- teammates each explore a different approach and report trade-offs.
- **Debugging competing hypotheses:** Bug with multiple possible causes -- teammates investigate different theories in parallel.

## Agent Teams Awareness

Claude Code supports multiple agent coordination modes. Choose the right one:

| Mode | When to Use | How |
|------|------------|-----|
| **Native agent teams** | 2-3 agents doing independent parallel work in the same repo | Use `teammateMode: "in-process"` (already enabled in settings) |
| **Subagents** | Single-purpose delegation (research, review, doc update) | Spawn with `Agent` tool, read-only or scoped write access |
| **Custom workflow** | 5+ agents, phased execution, state machine orchestration | Use `.claude/workflows/agent-team-workflow.md` |

**Native agent teams** are preferred for simple parallelism (2-3 independent workstreams). Use **custom workflows** only when you need phased execution, state tracking, or 5+ coordinated agents.

When deploying 3+ agents as a swarm, use `run_in_background=true` and wait for task notifications. Never use sleep-poll loops.

## When NOT to Use Agents

- Single-file changes with clear, contained scope
- Simple bug fixes where the cause is already identified
- Tasks requiring fewer than 3 tool calls total
- When context is already at 60%+ (agents add overhead -- prefer `/compact` first)
- The user explicitly says "just do it" or similar

## Execution Pattern

```
1. Receive task
2. MANDATORY: Run Three-Criteria Evaluation (5 seconds, saves hours)
3. If research needed    -> spawn research subagent (model: "opus") BEFORE writing any code
4. If parallel work      -> spawn agent team (all model: "opus") with clear scope per teammate
5. Synthesize subagent/team results into implementation plan
6. Implement with full awareness of codebase state
7. If multi-file change  -> spawn reviewer subagent (model: "opus") BEFORE commit
8. Run finish-session protocol (code + docs in same commit)
```

## Intent Alignment

Before making design or architecture decisions, verify alignment with `INTENT.md` at repo root. If a task would conflict with documented intent, **flag it to the user** rather than silently diverging. Subagents working on design decisions must also be instructed to read `INTENT.md`.

## Agent Communication

- Agents share context through files, not through prompt chaining.
- Research agents write findings to a structured summary, not raw dumps.
- Parallel agents must not write to the same file -- partition ownership clearly.
- The main thread is responsible for final integration and committing.
- For swarms of 10+ agents, write a shared instruction file to disk first, then reference it from each agent's prompt. Do not repeat large instruction blocks inline across multiple agents.

## Cost Awareness

| Deployment | Token Cost | Use When |
|---|---|---|
| Research subagent | ~1.5x single read | Almost always worth it for 3+ file changes |
| Documentation subagent | ~1.5x | End-of-session updates, verbose output processing |
| Reviewer subagent | ~1.5x | Multi-file or cross-feature changes |
| Agent team (2-3) | ~3-4x | Only genuinely parallel, independent workstreams |
| Full pipeline (research + team + review) | ~6-8x | Large features, multi-file refactors |

Default to subagents over teams. The accuracy improvement from pre-research subagents almost always pays for itself. The cheapest agent is the one you don't spawn -- if you can hold the full picture in your current context, just do the work.

## Finish-Session Exception

The `/finish-session` protocol handles its own agent deployment -- a dedicated multi-agent team for CODEBASE_MAP.md, INTENT.md, contracts, and documentation updates. When running finish-session, do NOT apply the Three-Criteria Evaluation above. The finish-session protocol's agent instructions take precedence.
