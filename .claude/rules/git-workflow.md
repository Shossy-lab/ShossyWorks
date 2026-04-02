---
description: Git workflow conventions, commit standards, and safety rules
---

# Git Workflow

## Commit Message Format

Use conventional commits: `type(scope): description`

**Types:** `feat`, `fix`, `refactor`, `docs`, `style`, `test`, `chore`, `perf`

**Scope:** Feature area or module name (e.g., `auth`, `api`, `dashboard`). Omit scope for cross-cutting changes.

**Examples:**
- `feat(auth): add password reset flow`
- `fix(dashboard): correct chart rendering on mobile`
- `refactor(api): extract shared validation middleware`
- `docs(memory): update architecture topic`
- `docs(memory): session 2026-03-23`
- `chore: update dependencies`

## Memory Commit Convention

Documentation and memory updates use specific formats:
- Topic updates: `docs(memory): update {topic}`
- Session handoffs: `docs(memory): session {YYYY-MM-DD}`
- Contract updates: `docs(contracts): update {feature} contract`
- Mixed session end: `docs: session {YYYY-MM-DD} summary`

## Pre-Commit Checklist

Before every commit, verify:
- [ ] Build passes (project's build command)
- [ ] Type checking passes (project's type-check command)
- [ ] Contracts are synced with code changes (see contracts-enforcement rule)
- [ ] No credentials, API keys, or secrets in staged files
- [ ] No debug statements left in production code (`console.log`, `print()`, `debugger`)
- [ ] Docs updated if code changes affect documented behavior
- [ ] CODEBASE_MAP.md updated if file structure changed
- [ ] CONTRACT-INDEX.md updated if contracts changed

## Commit Grouping

Code + docs + contracts go in the **same commit**. Atomic commits that keep everything in sync.

The commit sequence:
1. Change the code
2. Update contracts (if boundary code changed)
3. Update docs (if referenced code changed)
4. Update CONTRACT-INDEX.md and CODEBASE_MAP.md as needed
5. Commit all together -- one atomic commit

Never split code and its documentation updates across separate commits. If you realize mid-commit that a contract needs updating, update it before committing.

## Safety Rules

- **Never auto-push.** Always ask the user before pushing to any remote.
- **Never use `--no-verify`** to bypass pre-commit hooks. Fix the issue instead.
- **If a pre-commit hook fails**, fix the problem and create a NEW commit. Never amend the previous commit -- the failed commit didn't happen, so amending would modify an unrelated earlier commit.
- **Never force-push to main/master.** Warn the user if they request it.
- **Stage specific files** by name. Avoid `git add -A` or `git add .` which can accidentally stage secrets, env files, or large binaries.
- **Never stage credential files** (`.env`, token files, key files). Verify these are in `.gitignore`.
