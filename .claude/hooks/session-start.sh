#!/bin/bash
# Session Start Hook — handles startup, compact, and resume modes
# Receives matcher type as first argument: startup | compact | resume
#
# Responsibilities:
#   - Creates/updates .claude/.session-marker with session metadata
#   - Detects orphaned sessions (marker exists from previous unfinished session)
#   - Outputs context-loading checklists appropriate to each mode
#   - References the memory system for post-compaction recovery
set -euo pipefail

MODE="${1:-startup}"
MARKER_FILE=".claude/.session-marker"
SESSION_ID="$(date +%Y%m%d-%H%M%S)-$$"
NOW="$(date -Iseconds)"

# --- Helper: Check for orphaned session marker ---
check_orphan() {
  if [ -f "$MARKER_FILE" ]; then
    PREV_START=$(grep "started_at:" "$MARKER_FILE" 2>/dev/null | cut -d' ' -f2- || echo "unknown")
    PREV_ID=$(grep "session_id:" "$MARKER_FILE" 2>/dev/null | cut -d' ' -f2- || echo "unknown")
    echo ""
    echo "WARNING: Previous session did not complete /finish-session protocol."
    echo "Orphaned session: $PREV_ID (started: $PREV_START)"
    echo ""
    echo "RECOVERY REQUIRED — before starting new work:"
    echo "  1. Read the latest session doc in .claude/memory/sessions/"
    echo "  2. Run /finish-session to close out the previous session"
    echo "  3. If no session doc exists, check git log for recent commits"
    echo "  4. After recovery, this session will continue normally"
    echo ""
  fi
}

# --- Helper: Create a fresh session marker ---
create_marker() {
  local marker_mode="$1"
  mkdir -p "$(dirname "$MARKER_FILE")"
  cat > "$MARKER_FILE" <<EOF
session_id: $SESSION_ID
started_at: $NOW
mode: $marker_mode
EOF
}

case "$MODE" in
  startup)
    check_orphan
    create_marker "startup"
    echo "SESSION START — Execute the /start-session protocol."
    echo ""
    echo "Startup checklist:"
    echo "  1. Git sync: git fetch — warn if behind remote"
    echo "  2. Read INTENT.md"
    echo "  3. Read CODEBASE_MAP.md"
    echo "  4. Read CONTRACT-INDEX.md"
    echo "  5. Read .claude/memory/index.md"
    echo "  6. Read latest session doc in .claude/memory/sessions/"
    echo "  7. Three-criteria agent evaluation"
    echo "  8. Report ready state to user"
    ;;

  compact)
    # Update existing marker with compaction timestamp
    if [ -f "$MARKER_FILE" ]; then
      echo "last_compact_at: $NOW" >> "$MARKER_FILE"
    fi
    echo "POST-COMPACTION RECOVERY:"
    echo ""
    echo "  1. Re-read INTENT.md"
    echo "  2. Re-read CODEBASE_MAP.md"
    echo "  3. Re-read CONTRACT-INDEX.md"
    echo "  4. Re-read .claude/memory/index.md"
    echo "  5. Read .claude/memory/scratch/pre-compact-state.md (auto-saved before compaction)"
    echo "  6. Read latest session doc in .claude/memory/sessions/"
    echo "  7. Continue where you left off"
    ;;

  resume)
    check_orphan
    if [ ! -f "$MARKER_FILE" ]; then
      # No marker means clean state — create one for the resumed session
      create_marker "resumed"
    fi
    echo "SESSION RESUMED — Verify your context is current."
    echo ""
    echo "Resume checklist:"
    echo "  1. Read INTENT.md"
    echo "  2. Read CODEBASE_MAP.md"
    echo "  3. Read CONTRACT-INDEX.md"
    echo "  4. Read .claude/memory/index.md"
    echo "  5. Read latest session doc in .claude/memory/sessions/"
    echo "  6. Check git status for uncommitted changes"
    echo "  7. Verify active contracts for current work"
    ;;
esac
