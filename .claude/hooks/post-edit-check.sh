#!/bin/bash
# Post-Edit Check — PostToolUse hook for Edit and Write tools
#
# Lightweight reminder after any file modification. Not a blocker — just
# prompts the agent to consider whether documentation needs updating.
# Fires on both Edit and Write tool completions.
#
# NOTE: No set -euo pipefail here — this hook should NEVER fail or block.

echo "File modified. Consider: Does CODEBASE_MAP.md, CONTRACT-INDEX.md, or any contract in contracts/ need updating?"

exit 0
