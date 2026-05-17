/**
 * GET /api/hermes/jobs/$run_id
 *
 * Reverse-sync status read. Returns the current state of a bridge-dispatched
 * task by its `hermes_run_id` (which equals `card_id` per the bridge's
 * idempotency scheme).
 *
 * Joins:
 *   tasks (canonical task row)
 *   task_runs (latest run for the task — for worker / token / cost data)
 *   hermes_findings (recent span events — for live-flow context)
 *
 * Target DB: /home/ubuntu/.hermes/kanban.db (tasks + task_runs)
 *            /home/ubuntu/data/sqlite/shared/hermes.db (hermes_findings)
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { execFileSync } from 'node:child_process'
import { isAuthenticated } from '../../../../server/auth-middleware'

const HERMES_KANBAN_DB =
  process.env.HERMES_KANBAN_DB ?? '/home/ubuntu/.hermes/kanban.db'
const HERMES_FINDINGS_DB =
  process.env.HERMES_FINDINGS_DB ?? '/home/ubuntu/data/sqlite/shared/hermes.db'

const PYTHON_LOOKUP = `
import json, sqlite3, sys

kanban_db = sys.argv[1]
findings_db = sys.argv[2]
run_id = sys.argv[3]

conn = sqlite3.connect("file:" + kanban_db + "?mode=ro", uri=True)
conn.row_factory = sqlite3.Row

task_row = conn.execute(
    "SELECT id, title, status, tenant, created_at, started_at, completed_at, "
    "worker_pid, last_heartbeat_at, current_run_id, result, idempotency_key "
    "FROM tasks WHERE id=? OR idempotency_key=? LIMIT 1",
    (run_id, run_id),
).fetchone()

if not task_row:
    print(json.dumps({"ok": False, "error": "not_found"}))
    sys.exit(0)

task = dict(task_row)

latest_run = conn.execute(
    "SELECT id, status, started_at, ended_at, outcome, summary, error, "
    "input_tokens, output_tokens, cost_usd, model_used, tool_name, mcp_server "
    "FROM task_runs WHERE task_id=? ORDER BY started_at DESC LIMIT 1",
    (task["id"],),
).fetchone()

conn.close()

findings = []
try:
    fconn = sqlite3.connect("file:" + findings_db + "?mode=ro", uri=True)
    fconn.row_factory = sqlite3.Row
    rows = fconn.execute(
        "SELECT id, ts, kind, label, status, tool_name, mcp_server, "
        "duration_ms, error_message FROM hermes_findings "
        "WHERE intent_id=? ORDER BY ts ASC LIMIT 200",
        (task["id"],),
    ).fetchall()
    findings = [dict(r) for r in rows]
    fconn.close()
except Exception:
    findings = []

print(json.dumps({
    "ok": True,
    "task": task,
    "latest_run": dict(latest_run) if latest_run else None,
    "findings": findings,
    "findings_count": len(findings),
}))
`.trim()

export const Route = createFileRoute('/api/hermes/jobs/$run_id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const runId = String(params.run_id ?? '').trim()
        if (!runId) {
          return json({ ok: false, error: 'run_id required' }, { status: 400 })
        }
        try {
          const stdout = execFileSync(
            'python3',
            ['-c', PYTHON_LOOKUP, HERMES_KANBAN_DB, HERMES_FINDINGS_DB, runId],
            { timeout: 5_000, encoding: 'utf8' },
          ).trim()
          const parsed = JSON.parse(stdout)
          if (!parsed.ok && parsed.error === 'not_found') {
            return json(parsed, { status: 404 })
          }
          return json(parsed, { status: 200 })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'unknown error'
          return json({ ok: false, error: `Job lookup failed: ${msg}` }, { status: 500 })
        }
      },
    },
  },
})
