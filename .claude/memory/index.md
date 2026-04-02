# Project Memory

> This file is the entry point for the project memory system. It is loaded every session (L1 context).

## How Memory Works

- **Topics** (`topics/`): Persistent knowledge files for recurring themes -- architecture decisions, debugging patterns, environment quirks. Created as needed, updated incrementally.
- **Sessions** (`sessions/`): Session handoff documents providing continuity between sessions. Created by `/finish-session`. The most recent file is loaded at session start.
- **Scratch** (`scratch/`): Ephemeral workspace for compaction recovery. The `pre-compact.sh` hook writes state here before context compaction; `post-compact.sh` reads it back. Not committed to git.

## Topic Memory

| Topic | File | Last Updated |
|-------|------|--------------|
| *No topics yet* | -- | -- |

## Recent Sessions

| Date | File | Summary |
|------|------|---------|
| *No sessions yet* | -- | -- |
