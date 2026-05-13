#!/usr/bin/env bash
# Install the claude-event-emitter.py hook and register it in ~/.claude/settings.json
#
# Run once: bash scripts/install-event-emitter.sh
# Requires: jq (brew install jq)

set -euo pipefail

HOOK_DST="$HOME/.claude/hooks/claude-event-emitter.py"
SETTINGS="$HOME/.claude/settings.json"

# ── 1. Copy hook script ───────────────────────────────────────────────────────
cp "$(dirname "$0")/hooks/claude-event-emitter.py" "$HOOK_DST"
chmod 755 "$HOOK_DST"
echo "✓ Installed $HOOK_DST"

# ── 2. Register in settings.json ─────────────────────────────────────────────
# Add to PreToolUse (matcher ".*") and PostToolUse (matcher ".*") and Stop hooks
# Uses jq to merge safely — never clobbers existing hooks.

if ! command -v jq &>/dev/null; then
  echo "⚠️  jq not found — install with: brew install jq"
  echo "   Then re-run this script, OR manually add the hook to $SETTINGS"
  echo ""
  echo '   Hook entry to add under PreToolUse[matcher=".*"] and PostToolUse[matcher=".*"]:'
  echo '   {"type":"command","command":"python3 '"$HOOK_DST"'"}'
  exit 1
fi

EMITTER_CMD="python3 $HOOK_DST"

# Check if already registered
if jq -e --arg cmd "$EMITTER_CMD" \
  '.hooks.PreToolUse[]?.hooks[]? | select(.command == $cmd)' \
  "$SETTINGS" > /dev/null 2>&1; then
  echo "✓ Hook already registered in $SETTINGS — nothing to do"
  exit 0
fi

# Backup
cp "$SETTINGS" "$SETTINGS.bak-$(date +%Y%m%d-%H%M%S)"

# Add the emitter to PreToolUse (matcher ".*") and PostToolUse (matcher ".*")
UPDATED=$(jq \
  --arg cmd "$EMITTER_CMD" \
  '
  # Helper: add hook entry to a specific matcher block or create new one
  def add_hook(event; matcher):
    .hooks[event] //= [] |
    .hooks[event] |= (
      if any(.[]; .matcher == matcher)
      then map(if .matcher == matcher then .hooks += [{"type":"command","command":$cmd}] else . end)
      else . + [{"matcher": matcher, "hooks": [{"type":"command","command":$cmd}]}]
      end
    )
  ;
  add_hook("PreToolUse"; ".*") |
  add_hook("PostToolUse"; ".*") |
  add_hook("Stop"; "")
  ' \
  "$SETTINGS")

echo "$UPDATED" > "$SETTINGS"
echo "✓ Registered hook in $SETTINGS (backed up with .bak suffix)"
echo ""
echo "Restart Claude Code to activate the event emitter."
