#!/bin/bash
# Post-Compact Hook — AUTO-READ memory scratch back into context
#
# KEY INNOVATION: Reads the state file written by pre-compact.sh and
# outputs its contents to stdout. Claude Code injects stdout from
# PostCompact hooks into the new context window, so the session state
# survives compaction automatically.
set -euo pipefail

STATE_FILE=".claude/memory/scratch/pre-compact-state.md"

# Output saved state if it exists — this gets injected into context
if [ -f "$STATE_FILE" ]; then
  echo "--- RECOVERED PRE-COMPACTION STATE ---"
  cat "$STATE_FILE"
  echo ""
  echo "--- END RECOVERED STATE ---"
else
  echo "No pre-compaction state file found at $STATE_FILE."
  echo "Manual recovery required."
fi

echo ""
echo "COMPACTION COMPLETE. Re-read these files to restore full context:"
echo "  - INTENT.md"
echo "  - CODEBASE_MAP.md"
echo "  - CONTRACT-INDEX.md"
echo "  - .claude/memory/index.md"
echo "  - Latest session doc in .claude/memory/sessions/"
