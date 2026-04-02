#!/bin/bash
# Pre-Compact Hook — AUTO-WRITE session state to disk before compaction
#
# KEY INNOVATION: This hook captures session context to a file BEFORE
# compaction destroys the in-memory context. The post-compact hook then
# reads this file back, injecting the state into the new context window.
#
# Writes to: .claude/memory/scratch/pre-compact-state.md
set -euo pipefail

MARKER_FILE=".claude/.session-marker"
SCRATCH_DIR=".claude/memory/scratch"
STATE_FILE="$SCRATCH_DIR/pre-compact-state.md"
NOW="$(date -Iseconds)"

# Ensure scratch directory exists
mkdir -p "$SCRATCH_DIR"

# Capture current branch (may fail if not in a git repo)
BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")

# Capture modified files from git
STAGED=$(git diff --cached --name-only 2>/dev/null || echo "(not a git repo)")
UNSTAGED=$(git diff --name-only 2>/dev/null || echo "(not a git repo)")

# Read session marker if it exists
MARKER_CONTENTS=""
if [ -f "$MARKER_FILE" ]; then
  MARKER_CONTENTS=$(cat "$MARKER_FILE")
  # Also record compaction in the marker
  echo "last_compact_at: $NOW" >> "$MARKER_FILE"
fi

# Write state file to disk — this survives compaction
cat > "$STATE_FILE" <<EOF
# Pre-Compaction State Snapshot

**Captured at:** $NOW
**Branch:** $BRANCH

## Session Marker
\`\`\`
${MARKER_CONTENTS:-No session marker found}
\`\`\`

## Staged Files
\`\`\`
${STAGED:-None}
\`\`\`

## Unstaged Modified Files
\`\`\`
${UNSTAGED:-None}
\`\`\`

## Recovery Instructions
After compaction, re-read: INTENT.md, CODEBASE_MAP.md, CONTRACT-INDEX.md,
.claude/memory/index.md, and the latest session doc in .claude/memory/sessions/.
EOF

echo "COMPACTION IMMINENT. Session state saved to $STATE_FILE."
echo "After compaction, your context will include the contents of $STATE_FILE."
