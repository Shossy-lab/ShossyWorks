---
description: Evaluate available tools before executing tasks to maximize accuracy and efficiency
---

# Tool Awareness (MANDATORY)

Before executing any multi-step task, STOP and evaluate whether the available tools would improve accuracy or efficiency. Do not default to manual approaches when purpose-built tools exist.

## Evaluation Checklist

Ask yourself before starting work:

1. **MCP servers** — Is there an MCP tool that handles this directly? Check available MCP servers before writing manual code for external service interactions (databases, APIs, cloud services, file operations).

2. **Skills** — Is there a skill (in `.claude/skills/`) that orchestrates this type of work? Skills like `deep-planning`, `swarm`, `batch-write`, `index-docs`, `validate-kb` exist for complex multi-agent workflows. Don't reinvent them.

3. **Agents/subagents** — Would a research subagent, reviewer, or parallel team improve the outcome? Apply the Three-Criteria Evaluation from `autonomous-agents.md` before writing any code.

4. **Agent teams** — Would native agent teams (2-3 parallel teammates) complete this faster than sequential work? Agent teams are enabled and available.

5. **Slash commands** — Does a slash command exist for this workflow? Check `/start-session`, `/finish-session`, and any project-specific commands before manually executing multi-step protocols.

6. **Dedicated tools over Bash** — Use Read instead of `cat`, Grep instead of `grep`, Glob instead of `find`, Edit instead of `sed`. Dedicated tools are faster, safer, and produce better output for the user.

## Common Misses

| Instead of... | Use... |
|---------------|--------|
| `curl` / `wget` for web content | Firecrawl (`firecrawl scrape`, `firecrawl search`) |
| Manual `grep` loops across files | Grep tool or Agent with Explore subagent |
| Writing a script to process many files | `/batch-write` or `/swarm` skill |
| Manually reading 10+ files for research | Agent tool with `subagent_type: "Explore"` |
| Sequential file edits that could parallelize | Native agent teams (2-3 teammates) |
| Manual doc updates at session end | `/finish-session` (deploys 5-agent doc swarm) |
| Manual plan creation for complex tasks | `/plan` or `/deep-planning` skill |
| Running builds and checking output manually | Agent with verification role |

## The Rule

**When in doubt, check the toolbox first.** The 30 seconds spent evaluating available tools saves minutes of manual work and produces more reliable results. Purpose-built tools exist for a reason — they encode best practices, handle edge cases, and integrate with the project's systems.
