/**
 * GET /api/meeting-tasks
 *
 * ATC cross-link of VectOS meeting actions. Reads `meeting_tasks` rows
 * from Oracle's canonical berlai.db so meeting-derived actions surface in
 * the Agent Cockpit alongside Hermes execution tasks.
 *
 * Source DB:   /home/ubuntu/data/sqlite/berlai-business/berlai.db
 *              (override via BERLAI_DB env)
 * Source view: meeting_tasks JOIN meeting_ingest_log for title/dt
 *
 * Filters (querystring):
 *   - status:        open | in_progress | done | dropped
 *   - track:         dev | business | unknown
 *   - tenant_hint:   henry | berlai (currently inferred from `who`)
 *   - limit:         max rows (default 100, max 500)
 *
 * Response shape:
 *   { tasks: MeetingTaskRow[], source: { db_path, ledger_path } }
 *
 * Auth: requires the ATC `isAuthenticated` middleware (same as
 * `/api/claude-tasks`).
 *
 * M4 RED #3 fix — branch feat/m4-red-fixes-2026-05-19.
 */
import { createFileRoute } from '@tanstack/react-router'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { isAuthenticated } from '../../server/auth-middleware'

const BERLAI_DB =
  process.env.BERLAI_DB ?? '/home/ubuntu/data/sqlite/berlai-business/berlai.db'
const LEDGER_DB =
  process.env.MEETING_INGEST_LEDGER_PATH ??
  '/home/ubuntu/data/sqlite/shared/meeting-ingest/ledger.db'
const SQLITE_TIMEOUT_MS = 8_000

type MeetingTaskRow = {
  id: number
  meeting_id: string
  meeting_title: string | null
  meeting_dt: string | null
  client_id: string | null
  track: 'dev' | 'business' | 'unknown'
  who: string | null
  action: string
  due_hint: string | null
  status: 'open' | 'in_progress' | 'done' | 'dropped'
  classifier_v1: string | null
  confidence_v1: number | null
  classifier_v2: string | null
  confidence_v2: number | null
  dashboard_surface: string
  review_status: string | null
  created_at: string
  completed_at: string | null
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function sqliteQuoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function isStatus(v: string | null): boolean {
  return v === 'open' || v === 'in_progress' || v === 'done' || v === 'dropped'
}
function isTrack(v: string | null): boolean {
  return v === 'dev' || v === 'business' || v === 'unknown'
}

function readMeetingTasks(filters: {
  status?: string | null
  track?: string | null
  limit: number
}): MeetingTaskRow[] {
  if (!fs.existsSync(BERLAI_DB)) {
    throw new Error(`berlai DB missing: ${BERLAI_DB}`)
  }
  const where: string[] = []
  if (filters.status && isStatus(filters.status)) {
    where.push(`mt.status = ${sqliteQuoteLiteral(filters.status)}`)
  }
  if (filters.track && isTrack(filters.track)) {
    where.push(`mt.track = ${sqliteQuoteLiteral(filters.track)}`)
  }
  // Default: hide done/dropped to keep the cross-link surface useful as a
  // live work-queue. Pass ?status=done explicitly to see closed rows.
  if (!filters.status) {
    where.push("mt.status NOT IN ('done','dropped')")
  }
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  const limit = Math.max(1, Math.min(500, filters.limit | 0 || 100))

  // ATTACH the ledger DB so we can join title/dt without two round-trips.
  const sql = `
    ATTACH DATABASE ${sqliteQuoteLiteral(LEDGER_DB)} AS ledger;
    SELECT
      mt.id,
      mt.meeting_id,
      mil.title         AS meeting_title,
      mil.meeting_dt    AS meeting_dt,
      mt.client_id,
      mt.track,
      mt.who,
      mt.action,
      mt.due_hint,
      mt.status,
      mt.classifier_v1,
      mt.confidence_v1,
      mt.classifier_v2,
      mt.confidence_v2,
      mt.dashboard_surface,
      mt.review_status,
      mt.created_at,
      mt.completed_at
    FROM meeting_tasks mt
    LEFT JOIN ledger.meeting_ingest_log mil ON mil.meeting_id = mt.meeting_id
    ${whereClause}
    ORDER BY datetime(mil.meeting_dt) DESC NULLS LAST, mt.id DESC
    LIMIT ${limit};
  `.trim()

  const raw = execFileSync('sqlite3', [BERLAI_DB, '-json', sql], {
    encoding: 'utf8',
    timeout: SQLITE_TIMEOUT_MS,
  }).trim()
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as MeetingTaskRow[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export const Route = createFileRoute('/api/meeting-tasks')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return jsonResponse({ error: 'Unauthorized' }, 401)
        }
        const url = new URL(request.url)
        const status = url.searchParams.get('status')
        const track = url.searchParams.get('track')
        const limit = Number.parseInt(url.searchParams.get('limit') ?? '100', 10)

        try {
          const tasks = readMeetingTasks({ status, track, limit })
          return jsonResponse({
            tasks,
            source: { db_path: BERLAI_DB, ledger_path: LEDGER_DB },
          })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'unknown error'
          return jsonResponse(
            { error: 'Failed to read meeting_tasks', detail: msg },
            500,
          )
        }
      },
    },
  },
})
