# ShossyWorks -- Durable Instructions

@import README.md
@import DESIGN-SYSTEM.md

## Skills Setup

Mount the shared skills repo (one-time setup from project root):

    ln -s A:/claude-skills .claude/skills

Skills provide: deep-planning, swarm, plan-execute, batch-write, commit-batch, validate-kb, worktree-sync, branding, bid-package, index-docs, onboard, implementation-board, plan-review-board

The .claude/.gitignore excludes skills/ to prevent committing the symlink target.

 