# Session Logs

This directory contains session log files created by the `/finish-session` protocol.

## Format Guide

Session logs are stored in `.claude/memory/sessions/` (the primary location). This `docs/sessions/` directory is available for project-specific session documentation that does not fit the memory system format.

## Session Handoff Template

Each session handoff document follows this structure:

    # Session: {Brief Descriptive Title}

    **Date:** YYYY-MM-DD
    **Status:** Complete | In Progress | Blocked (reason)
    **Build:** Passing | Warnings (describe) | Failing (describe)

    ---

    ## Summary
    [2-3 sentences: what was accomplished and why, in human terms]

    ## What Was Done
    [Bullet list of changes -- be specific enough that the next session understands scope]
    - Changed X to fix Y because Z
    - Added A to support B

    ## Decisions
    [Design choices made during this session, with reasoning]
    - Decided X because Y (alternatives considered: A, B)

    ## Files Changed
    | File | Change | Purpose |
    |------|--------|---------|
    | path/to/file | Modified/Created/Deleted | One-line description |

    ## Issues Found
    [Bugs, tech debt, or concerns discovered -- with severity]
    - Issue (High/Medium/Low): description

    ## Next Steps
    [Specific, actionable items for the next session]
    1. First priority: what and why
    2. Second priority: what and why

    ## Handoff Notes
    [Anything the next session should know before touching the code --
     warnings, context that does not fit elsewhere, "read X before doing Y" guidance]
