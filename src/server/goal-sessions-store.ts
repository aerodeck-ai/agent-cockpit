/**
 * goal-sessions-store.ts
 *
 * Server-side store for God Mode goal sessions.
 * DB: /mnt/databases/atc-goal-sessions/goal_sessions.db (Oracle)
 *
 * Uses execFileSync python3 to avoid native better-sqlite3 build issues,
 * matching the pattern in mcp-health-store.ts.
 */

import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { GoalSession, GoalStatus } from '../types/goal-session'

export type { GoalSession, GoalStatus }

const DB_PATH =
  process.env.GOAL_SESSIONS_DB ??
  '/mnt/databases/atc-goal-sessions/goal_sessions.db'

// ── Python scripts ─────────────────────────────────────────────────

function runPy(script: string, args: string[] = []): unknown {
  const out = execFileSync('python3', ['-c', script, ...args], {
    timeout: 8_000,
    encoding: 'utf8',
  }).trim()
  return out ? JSON.parse(out) : null
}

const PY_GET = `
import json, sqlite3, sys
db, id_ = sys.argv[1], sys.argv[2]
try:
    conn = sqlite3.connect("file:" + db + "?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT * FROM goal_sessions WHERE id=?", (id_,)).fetchone()
    print(json.dumps(dict(row) if row else None))
except Exception as e:
    print(json.dumps({"_error": str(e)}))
`.trim()

const PY_LIST = `
import json, sqlite3, sys
db = sys.argv[1]
try:
    conn = sqlite3.connect("file:" + db + "?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT * FROM goal_sessions WHERE status IN ('pending','running','paused') OR created_at >= datetime('now','-24 hours') ORDER BY created_at DESC LIMIT 50"
    ).fetchall()
    print(json.dumps([dict(r) for r in rows]))
except Exception as e:
    print(json.dumps([]))
`.trim()

const PY_INSERT = `
import json, sqlite3, sys
db = sys.argv[1]
row = json.loads(sys.argv[2])
try:
    conn = sqlite3.connect(db)
    conn.execute("""
        INSERT INTO goal_sessions
          (id, goal_text, status, cost_ceiling, time_ceiling_hr, henry_bound,
           no_progress, killed_sentinel, created_at, cost_view_usd, cost_real_usd)
        VALUES
          (:id, :goal_text, :status, :cost_ceiling, :time_ceiling_hr, :henry_bound,
           :no_progress, :killed_sentinel, :created_at, 0, 0)
    """, row)
    conn.commit()
    r2 = conn.execute("SELECT * FROM goal_sessions WHERE id=?", (row['id'],)).fetchone()
    conn.row_factory = sqlite3.Row
    r2 = conn.execute("SELECT * FROM goal_sessions WHERE id=?", (row['id'],)).fetchone()
    print(json.dumps(dict(r2) if r2 else row))
except Exception as e:
    print(json.dumps({"_error": str(e)}))
`.trim()

const PY_UPDATE = `
import json, sqlite3, sys
db, id_, updates_json = sys.argv[1], sys.argv[2], sys.argv[3]
updates = json.loads(updates_json)
try:
    conn = sqlite3.connect(db)
    set_clause = ", ".join(f"{k}=?" for k in updates)
    values = list(updates.values()) + [id_]
    conn.execute(f"UPDATE goal_sessions SET {set_clause} WHERE id=?", values)
    conn.commit()
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT * FROM goal_sessions WHERE id=?", (id_,)).fetchone()
    print(json.dumps(dict(row) if row else None))
except Exception as e:
    print(json.dumps({"_error": str(e)}))
`.trim()

// ── Public API ─────────────────────────────────────────────────────

export function getGoalSession(id: string): GoalSession | null {
  const result = runPy(PY_GET, [DB_PATH, id]) as GoalSession | { _error: string } | null
  if (!result || '_error' in result) return null
  return result as GoalSession
}

export function listGoalSessions(): GoalSession[] {
  const result = runPy(PY_LIST, [DB_PATH])
  if (!Array.isArray(result)) return []
  return result as GoalSession[]
}

export interface CreateGoalInput {
  goal_text: string
  cost_ceiling?: number | null
  time_ceiling_hr?: number | null
  henry_bound?: string[] | null
  no_progress?: string | null
  killed_sentinel?: string | null
}

export function createGoalSession(input: CreateGoalInput): GoalSession {
  const id = randomUUID()
  const row = {
    id,
    goal_text: input.goal_text,
    status: 'pending' as GoalStatus,
    cost_ceiling: input.cost_ceiling ?? null,
    time_ceiling_hr: input.time_ceiling_hr ?? null,
    henry_bound: input.henry_bound ? JSON.stringify(input.henry_bound) : null,
    no_progress: input.no_progress ?? null,
    killed_sentinel: input.killed_sentinel ?? null,
    created_at: new Date().toISOString(),
  }
  const result = runPy(PY_INSERT, [DB_PATH, JSON.stringify(row)]) as
    | GoalSession
    | { _error: string }
    | null
  if (!result || '_error' in result) {
    throw new Error('Failed to create goal session: ' + JSON.stringify(result))
  }
  return result as GoalSession
}

export function pauseGoalSession(id: string): GoalSession | null {
  const updates = { status: 'paused', paused_at: new Date().toISOString() }
  const result = runPy(PY_UPDATE, [DB_PATH, id, JSON.stringify(updates)]) as
    | GoalSession
    | { _error: string }
    | null
  if (!result || '_error' in result) return null
  return result as GoalSession
}

export function killGoalSession(id: string): GoalSession | null {
  const updates = { status: 'killed', killed_at: new Date().toISOString() }
  const result = runPy(PY_UPDATE, [DB_PATH, id, JSON.stringify(updates)]) as
    | GoalSession
    | { _error: string }
    | null
  if (!result || '_error' in result) return null
  return result as GoalSession
}
