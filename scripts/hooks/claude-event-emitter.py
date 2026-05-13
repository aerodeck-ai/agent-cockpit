#!/usr/bin/env python3
"""
A4 JSONL event emitter for Claude Code hooks.

Writes hook events to ~/.claude/logs/events-YYYY-MM-DD.jsonl
The cockpit SSE endpoint at /api/sse/events tails these files.

Install: run scripts/install-event-emitter.sh
"""
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path


def main() -> int:
    try:
        raw = sys.stdin.read()
        hook_data = json.loads(raw) if raw.strip() else {}
    except Exception:
        hook_data = {}

    hook_type = os.environ.get("CLAUDE_HOOK_NAME", "Unknown")
    session_id = os.environ.get("CLAUDE_SESSION_ID", "unknown")
    parent_session_id = os.environ.get("CLAUDE_PARENT_SESSION_ID") or None

    tool_name = hook_data.get("tool_name") or hook_data.get("tool", "")
    tool_input = hook_data.get("tool_input") or hook_data.get("input") or {}
    tool_response = hook_data.get("tool_response") or hook_data.get("output")
    duration_ms = hook_data.get("duration_ms")

    # Identify the CC instance via session prefix
    source_app = os.environ.get("CLAUDE_SOURCE_APP") or (
        f"cc-{session_id[:8]}" if session_id != "unknown" else "cc"
    )

    payload: dict = {}
    if tool_name:
        payload["tool_name"] = tool_name
    if tool_input:
        payload["tool_input"] = tool_input
    if tool_response is not None:
        if isinstance(tool_response, str) and len(tool_response) > 500:
            payload["tool_response"] = tool_response[:500] + "...[truncated]"
        else:
            payload["tool_response"] = tool_response
    if duration_ms is not None:
        payload["duration_ms"] = duration_ms
    skip_keys = {"tool_name", "tool", "tool_input", "input",
                 "tool_response", "output", "duration_ms"}
    for k, v in hook_data.items():
        if k not in skip_keys:
            payload[k] = v

    event = {
        "source_app": source_app,
        "session_id": session_id,
        "parent_session_id": parent_session_id,
        "hook_event_type": hook_type,
        "payload": payload,
        "timestamp": int(time.time() * 1000),
    }

    serialised = json.dumps(event, separators=(",", ":"))

    # ── Write to local JSONL (always) ────────────────────────────────────────
    log_dir = Path(
        os.environ.get("CLAUDE_LOGS_DIR", str(Path.home() / ".claude" / "logs"))
    )
    log_dir.mkdir(parents=True, exist_ok=True)

    date_str = datetime.now().strftime("%Y-%m-%d")
    log_file = log_dir / f"events-{date_str}.jsonl"

    try:
        with open(log_file, "a", encoding="utf-8") as f:
            f.write(serialised + "\n")
    except OSError:
        pass  # Never block CC execution on logging failures

    # ── POST to remote cockpit ingest endpoint (optional) ────────────────────
    # Set COCKPIT_INGEST_URL + COCKPIT_INGEST_TOKEN in .env to enable.
    # Used when the cockpit runs on a different host (e.g. Oracle) than CC (Mac).
    ingest_url = os.environ.get("COCKPIT_INGEST_URL", "")
    ingest_token = os.environ.get("COCKPIT_INGEST_TOKEN", "")
    if ingest_url and ingest_token:
        try:
            import urllib.request
            req = urllib.request.Request(
                ingest_url,
                data=serialised.encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "X-Cockpit-Ingest-Token": ingest_token,
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=2):
                pass
        except Exception:
            pass  # Never block CC execution on delivery failures

    return 0


if __name__ == "__main__":
    sys.exit(main())
