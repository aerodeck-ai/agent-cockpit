/**
 * /api/flow/events
 *
 * Returns recent trace events from hermes_findings, mapped to the TraceEvent
 * shape used by ExecutionFlowCanvas. Tenant-aware: mally only sees mally-sourced
 * events; henry sees all others.
 *
 * Cache: 60s via Cache-Control header.
 * Limit: last 200 events (configurable via ?limit=N, max 500).
 * Window: last 24h by default (configurable via ?hours=N, max 72).
 */

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { resolveTenantFromRequest } from '../../../lib/auth/tenants'
import { isAuthenticatedWithCFAccess } from '../../../server/auth-middleware'

export type TraceEvent = {
  id: number
  trace_id: string
  ts: string
  source: string
  kind: string
  status: string
  label: string
  detail?: string | null
  model_req?: string | null
  model_used?: string | null
  provider?: string | null
  input_tokens?: number | null
  output_tokens?: number | null
  cost_usd?: number | null
  pane_id?: number | null
  mcp_server?: string | null
  tool_name?: string | null
}

// hermes.db is the shared findings store; symlink hermes.db.hermes_findings -> hermes.db
const HERMES_DB_PATH =
  process.env.HERMES_DB_PATH ??
  join(
    process.env.HERMES_DATA_DIR ?? '/home/ubuntu/data/sqlite/shared',
    'hermes.db',
  )

// Mally-related sources for tenant filtering
const MALLY_SOURCES = ['mally', 'mally-hermes', 'stillmusic', 'berlai-mally']

function isMallySource(source: string): boolean {
  return MALLY_SOURCES.some((s) => source.toLowerCase().includes(s))
}

export const Route = createFileRoute('/api/flow/events')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticatedWithCFAccess(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        const url = new URL(request.url)
        const limit = Math.min(
          500,
          parseInt(url.searchParams.get('limit') ?? '200', 10) || 200,
        )
        const hours = Math.min(
          72,
          parseInt(url.searchParams.get('hours') ?? '24', 10) || 24,
        )

        const tenantInfo = await resolveTenantFromRequest(request)
        const isMally = tenantInfo?.tenant === 'mally'

        try {
          const Database = (await import('better-sqlite3')).default
          const db = new Database(HERMES_DB_PATH, {
            readonly: true,
            fileMustExist: true,
          })

          // Build WHERE clause for tenant isolation
          const tenantFilter = isMally
            ? `AND (${MALLY_SOURCES.map(() => `LOWER(source) LIKE ?`).join(' OR ')})`
            : `AND NOT (${MALLY_SOURCES.map(() => `LOWER(source) LIKE ?`).join(' OR ')})`

          const tenantParams = MALLY_SOURCES.map((s) => `%${s}%`)

          const rows = db
            .prepare(
              `
              SELECT
                id,
                ts,
                source,
                severity   AS kind,
                status,
                title      AS label,
                body       AS detail,
                NULL       AS model_req,
                NULL       AS model_used,
                NULL       AS provider,
                NULL       AS input_tokens,
                NULL       AS output_tokens,
                NULL       AS cost_usd,
                NULL       AS pane_id,
                NULL       AS mcp_server,
                NULL       AS tool_name,
                -- derive trace_id from session_id bucket (1h buckets)
                'hermes_' || strftime('%Y%m%d_%H', ts) AS trace_id
              FROM hermes_findings
              WHERE ts >= datetime('now', ?)
              ${tenantFilter}
              ORDER BY ts DESC
              LIMIT ?
            `,
            )
            .all(
              `-${hours} hours`,
              ...tenantParams,
              limit,
            ) as TraceEvent[]

          db.close()

          // Reverse so oldest first (canvas reads chronologically)
          const events = rows.reverse()

          return new Response(JSON.stringify({ events, count: events.length }), {
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'public, max-age=60, s-maxage=60',
            },
          })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          // Graceful degradation — return empty events so canvas still renders
          return json(
            { events: [], count: 0, error: msg },
            { status: 200 },
          )
        }
      },
    },
  },
})
