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

        const tenantFilterSql = isMally
          ? `AND (${MALLY_SOURCES.map(() => `LOWER(source) LIKE ?`).join(' OR ')})`
          : `AND NOT (${MALLY_SOURCES.map(() => `LOWER(source) LIKE ?`).join(' OR ')})`
        const tenantLikeParams = MALLY_SOURCES.map((s) => `%${s}%`)

        // ── SSE live-stream mode (?stream=1) ──────────────────────────────
        // Pushes new hermes_findings rows as they land so the LiveFlow canvas
        // animates in near-real-time instead of 10s client polling. The
        // existing JSON path below is untouched (initial load / fallback).
        if (url.searchParams.get('stream') === '1') {
          const SELECT = (extra: string) => `
              SELECT id, ts, source, severity AS kind, status, title AS label,
                     body AS detail, NULL AS model_req, NULL AS model_used,
                     NULL AS provider, NULL AS input_tokens, NULL AS output_tokens,
                     NULL AS cost_usd, NULL AS pane_id, NULL AS mcp_server,
                     NULL AS tool_name,
                     'hermes_' || strftime('%Y%m%d_%H', ts) AS trace_id
              FROM hermes_findings
              WHERE ts >= datetime('now', ?) ${tenantFilterSql} ${extra}`
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let db: any = null
          try {
            const Database = (await import('better-sqlite3')).default
            db = new Database(HERMES_DB_PATH, {
              readonly: true,
              fileMustExist: true,
            })
          } catch {
            // DB unavailable → tell client to use JSON fallback, don't 500
            return new Response('retry: 10000\nevent: nostream\ndata: {}\n\n', {
              headers: { 'Content-Type': 'text/event-stream' },
            })
          }
          const sdb = db
          const enc = new TextEncoder()
          // Defensive try: prepare() can throw on schema mismatch OR sqlite
          // corruption (observed 2026-05-16 21:44 in agent-cockpit-error.log
          // — `SqliteError: database disk image is malformed`,
          // `SQLITE_CORRUPT`), which surfaced as HTTP 500 because this SSE
          // branch lacked the outer try/catch the JSON branch (~line 196)
          // has. Fall back to a `nostream` event so the client uses its
          // JSON-poll fallback — same UX as a DB-open failure.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let stmtInit: any
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let stmtSince: any
          try {
            stmtInit = sdb.prepare(
              `${SELECT('')} ORDER BY ts DESC LIMIT ?`,
            )
            stmtSince = sdb.prepare(
              `${SELECT('AND id > ?')} ORDER BY id ASC LIMIT 200`,
            )
          } catch {
            try {
              sdb.close()
            } catch {
              /* already closed */
            }
            return new Response(
              'retry: 10000\nevent: nostream\ndata: {}\n\n',
              { headers: { 'Content-Type': 'text/event-stream' } },
            )
          }
          let lastId = 0
          let timer: ReturnType<typeof setInterval> | null = null
          const stream = new ReadableStream({
            start(controller) {
              const send = (s: string) => {
                try {
                  controller.enqueue(enc.encode(s))
                } catch {
                  /* closed */
                }
              }
              try {
                const init = (
                  stmtInit.all(
                    `-${hours} hours`,
                    ...tenantLikeParams,
                    limit,
                  ) as TraceEvent[]
                ).reverse()
                for (const e of init)
                  if (e.id > lastId) lastId = e.id
                send(
                  `event: snapshot\ndata: ${JSON.stringify({ events: init, count: init.length })}\n\n`,
                )
              } catch {
                send(`event: snapshot\ndata: ${JSON.stringify({ events: [] })}\n\n`)
              }
              let ticks = 0
              timer = setInterval(() => {
                try {
                  const rows = stmtSince.all(
                    `-${hours} hours`,
                    ...tenantLikeParams,
                    lastId,
                  ) as TraceEvent[]
                  if (rows.length) {
                    for (const r of rows) if (r.id > lastId) lastId = r.id
                    send(
                      `data: ${JSON.stringify({ events: rows, count: rows.length })}\n\n`,
                    )
                  }
                  if (++ticks % 5 === 0) send(`: hb\n\n`) // ~15s keepalive
                } catch {
                  /* transient query error — keep stream alive */
                }
              }, 3000)
              const onAbort = () => {
                if (timer) clearInterval(timer)
                try {
                  sdb.close()
                } catch {
                  /* already closed */
                }
                try {
                  controller.close()
                } catch {
                  /* already closed */
                }
              }
              request.signal.addEventListener('abort', onAbort)
            },
            cancel() {
              if (timer) clearInterval(timer)
              try {
                sdb.close()
              } catch {
                /* already closed */
              }
            },
          })
          return new Response(stream, {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache, no-transform',
              Connection: 'keep-alive',
            },
          })
        }

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
