/**
 * GET /api/models/cost
 *
 * Returns last-7d cost aggregates per model_used from harness.db.
 * Read-only. Cached in memory for 60s.
 * Uses python3 sqlite3 (same pattern as /api/crew-status) — avoids
 * the better-sqlite3 native binding which is not compiled in this env.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'

const HARNESS_DB_PATH =
  process.env.HARNESS_DB_PATH ??
  '/home/ubuntu/data/sqlite/shared/harness/harness.db'

export type CostRow = {
  model_used: string
  calls_7d: number
  tokens_7d: number
  total_cost_7d: number
  top_caller_profile: string | null
}

type CacheEntry = {
  rows: CostRow[]
  fetchedAt: number
}

let _cache: CacheEntry | null = null
const CACHE_TTL_MS = 60_000

const PYTHON_SCRIPT = `
import json, sqlite3, sys, time
path = sys.argv[1]

if not __import__('os').path.exists(path):
    print(json.dumps([]))
    sys.exit(0)

cutoff = int(time.time()) - 7 * 24 * 3600
conn = sqlite3.connect(path)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

rows = cur.execute("""
    SELECT
        model_used,
        COUNT(*)                                          AS calls_7d,
        COALESCE(SUM(input_tok + output_tok), 0)         AS tokens_7d,
        COALESCE(SUM(cost_usd), 0)                       AS total_cost_7d
    FROM llm_calls
    WHERE ts >= ?
    GROUP BY model_used
    ORDER BY total_cost_7d DESC
""", (cutoff,)).fetchall()

top_callers = cur.execute("""
    SELECT model_used, caller, COUNT(*) AS n
    FROM llm_calls
    WHERE ts >= ?
    GROUP BY model_used, caller
    ORDER BY model_used, n DESC
""", (cutoff,)).fetchall()

caller_map = {}
for row in top_callers:
    m = row["model_used"]
    if m not in caller_map:
        caller_map[m] = row["caller"]

conn.close()

result = []
for row in rows:
    result.append({
        "model_used": row["model_used"],
        "calls_7d": row["calls_7d"],
        "tokens_7d": row["tokens_7d"],
        "total_cost_7d": row["total_cost_7d"],
        "top_caller_profile": caller_map.get(row["model_used"])
    })
print(json.dumps(result))
`

function queryCostRows(): CostRow[] {
  if (!existsSync(HARNESS_DB_PATH)) {
    return []
  }
  const raw = execFileSync('python3', ['-c', PYTHON_SCRIPT, HARNESS_DB_PATH], {
    encoding: 'utf-8',
    timeout: 5_000,
  })
  return JSON.parse(raw) as CostRow[]
}

export const Route = createFileRoute('/api/models/cost')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const now = Date.now()
          if (!_cache || now - _cache.fetchedAt > CACHE_TTL_MS) {
            _cache = { rows: queryCostRows(), fetchedAt: now }
          }
          return json({ ok: true, rows: _cache.rows, cachedAt: _cache.fetchedAt })
        } catch (err) {
          return json(
            { error: err instanceof Error ? err.message : String(err) },
            { status: 500 },
          )
        }
      },
    },
  },
})
