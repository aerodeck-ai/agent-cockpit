/**
 * GET /api/evals
 *
 * Returns the latest eval runs from eval_runs.db.
 * Supports ?limit=N (default 30) and ?dataset=<name> filter.
 *
 * eval_runs.db schema:
 *   runs(id TEXT PK, started_at TEXT, finished_at TEXT,
 *        dataset TEXT, pass INTEGER, fail INTEGER,
 *        regression_count INTEGER, cost_usd REAL, log_url TEXT)
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import Database from 'better-sqlite3'
import path from 'node:path'
import { isAuthenticated } from '../../server/auth-middleware'

const EVAL_RUNS_DB =
  process.env.EVAL_RUNS_DB_PATH ||
  '/home/ubuntu/data/sqlite/shared/eval_runs.db'

export type EvalRun = {
  id: string
  started_at: string
  finished_at: string | null
  dataset: string
  pass: number
  fail: number
  regression_count: number
  cost_usd: number
  log_url: string | null
}

export type EvalsApiResponse = {
  ok: boolean
  runs: Array<EvalRun>
  total: number
}

function getDb() {
  return new Database(EVAL_RUNS_DB, { readonly: true, fileMustExist: true })
}

export const Route = createFileRoute('/api/evals')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        try {
          const url = new URL(request.url)
          const limit = Math.min(
            100,
            parseInt(url.searchParams.get('limit') || '30', 10),
          )
          const dataset = url.searchParams.get('dataset') || null

          const db = getDb()

          let runs: Array<EvalRun>
          let total: number

          if (dataset) {
            runs = db
              .prepare(
                `SELECT * FROM runs WHERE dataset = ?
                 ORDER BY started_at DESC LIMIT ?`,
              )
              .all(dataset, limit) as Array<EvalRun>
            total = (
              db
                .prepare(`SELECT COUNT(*) as c FROM runs WHERE dataset = ?`)
                .get(dataset) as { c: number }
            ).c
          } else {
            runs = db
              .prepare(
                `SELECT * FROM runs ORDER BY started_at DESC LIMIT ?`,
              )
              .all(limit) as Array<EvalRun>
            total = (
              db.prepare(`SELECT COUNT(*) as c FROM runs`).get() as { c: number }
            ).c
          }

          db.close()

          return json({ ok: true, runs, total })
        } catch (err) {
          const message =
            err instanceof Error ? err.message : 'Unknown error'
          // DB not yet created is fine — return empty
          if (message.includes('ENOENT') || message.includes('no such file')) {
            return json({ ok: true, runs: [], total: 0 })
          }
          return json({ ok: false, error: message }, { status: 500 })
        }
      },
    },
  },
})
