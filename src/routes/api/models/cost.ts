/**
 * GET /api/models/cost
 *
 * Returns last-7d cost aggregates per model_used from harness.db.
 * Read-only. Cached in memory for 60s.
 */
import fs from 'node:fs'
import path from 'node:path'
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

function queryCostRows(): CostRow[] {
  // Dynamic require of better-sqlite3 so it doesn't break SSR builds that
  // don't have native deps installed.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3') as typeof import('better-sqlite3')

  if (!fs.existsSync(HARNESS_DB_PATH)) {
    return []
  }

  const db = new Database(HARNESS_DB_PATH, { readonly: true, fileMustExist: true })
  try {
    const cutoff = Math.floor(Date.now() / 1000) - 7 * 24 * 3600

    // Aggregate per model
    const rows = db.prepare(`
      SELECT
        model_used,
        COUNT(*)                                          AS calls_7d,
        COALESCE(SUM(input_tok + output_tok), 0)         AS tokens_7d,
        COALESCE(SUM(cost_usd), 0)                       AS total_cost_7d
      FROM llm_calls
      WHERE ts >= ?
      GROUP BY model_used
      ORDER BY total_cost_7d DESC
    `).all(cutoff) as Array<{ model_used: string; calls_7d: number; tokens_7d: number; total_cost_7d: number }>

    // Top caller per model
    const topCallers = db.prepare(`
      SELECT
        model_used,
        caller,
        COUNT(*) AS n
      FROM llm_calls
      WHERE ts >= ?
      GROUP BY model_used, caller
      ORDER BY model_used, n DESC
    `).all(cutoff) as Array<{ model_used: string; caller: string | null; n: number }>

    const topCallerMap = new Map<string, string | null>()
    for (const row of topCallers) {
      if (!topCallerMap.has(row.model_used)) {
        topCallerMap.set(row.model_used, row.caller)
      }
    }

    return rows.map((r) => ({
      model_used: r.model_used,
      calls_7d: r.calls_7d,
      tokens_7d: r.tokens_7d,
      total_cost_7d: r.total_cost_7d,
      top_caller_profile: topCallerMap.get(r.model_used) ?? null,
    }))
  } finally {
    db.close()
  }
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
