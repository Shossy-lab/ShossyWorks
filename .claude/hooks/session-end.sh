#!/bin/bash
# Session End Hook — Detects orphaned sessions and logs them
#
# If .claude/.session-marker still exists when the session ends, it means
# /finish-session was never run. This hook logs the orphan for detection
# at the next session startup.
#
# NOTE: This hook CANNOT block session termination. Recovery happens next startup.
MARKER_FILE=".claude/.session-marker"
ORPHAN_LOG=".claude/.orphan-log"
NOW="$(date -Iseconds 2>/dev/null || date)"

if [ -f "$MARKER_FILE" ]; then
  SESSION_ID=$(grep "session_id:" "$MARKER_FILE" 2>/dev/null | cut -d' ' -f2- || echo "unknown")
  echo "orphaned_at: $NOW" >> "$MARKER_FILE"
  echo "[$NOW] Session orphaned (id: $SESSION_ID) — /finish-session was not completed" >> "$ORPHAN_LOG"
  echo "WARNING: Session ended without running /finish-session. Logged to $ORPHAN_LOG."
fi
