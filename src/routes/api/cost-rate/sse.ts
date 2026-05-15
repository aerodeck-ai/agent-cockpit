/**
 * GET /api/cost-rate/sse
 *
 * Server-Sent Events stream — emits a cost-rate snapshot every 30 seconds.
 *
 * Data shape per tick:
 *   { ts, today_view_usd, today_real_usd, rate_view_usd_per_hr,
 *     rate_real_usd_per_hr, warn_threshold, kill_threshold, model_breakdown }
 *
 * Source: tokens.db on Mac via SSH (Tailscale mally 100.89.244.20).
 * The app runs on Oracle so we shell out via `ssh mally sqlite3 ...`.
 *
 * Auth: CF Access gate via isAuthenticated.
 */
import { createFileRoute } from '@tanstack/react-router'
import { execSync } from 'node:child_process'
import { isAuthenticated } from '../../../server/auth-middleware'

// ── Constants ──────────────────────────────────────────────────────

const TOKENS_DB_REMOTE = '/Users/hberliand/mcp-infra/data/cliproxy-tokens/tokens.db'
const SSH_HOST = 'mally'
const WARN_THRESHOLD_USD = parseFloat(process.env.GOAL_DAILY_WARN_USD ?? '300')
const KILL_THRESHOLD_USD = parseFloat(process.env.GOAL_DAILY_KILL_USD ?? '800')
const TICK_MS = 30_000

// ── Helpers ────────────────────────────────────────────────────────

interface ModelRow {
  model: string
  est_cost_usd: number
}

interface CostSnapshot {
  today_view_usd: number
  model_breakdown: ModelRow[]
}

function fetchCostSnapshot(): CostSnapshot {
  // Query via SSH — Tailscale is always up between Oracle and mally.
  const query = `SELECT model, ROUND(SUM(est_cost_usd),6) AS est_cost_usd FROM daily_cost_by_tenant WHERE day = date('now') GROUP BY model ORDER BY est_cost_usd DESC;`
  const cmd = `ssh -o BatchMode=yes -o ConnectTimeout=5 ${SSH_HOST} "sqlite3 -json ${TOKENS_DB_REMOTE} '${query}'"`.replace(/'/g, `'\\''`)

  let raw: string
  try {
    raw = execSync(
      `ssh -o BatchMode=yes -o ConnectTimeout=5 ${SSH_HOST} sqlite3 -json ${TOKENS_DB_REMOTE} "SELECT model, ROUND(SUM(est_cost_usd),6) AS est_cost_usd FROM daily_cost_by_tenant WHERE day = date('now') GROUP BY model ORDER BY est_cost_usd DESC"`,
      { timeout: 8_000, encoding: 'utf8' },
    ).trim()
  } catch {
    return { today_view_usd: 0, model_breakdown: [] }
  }

  let rows: ModelRow[] = []
  try {
    rows = raw ? (JSON.parse(raw) as ModelRow[]) : []
  } catch {
    rows = []
  }

  const today_view_usd = rows.reduce((s, r) => s + (r.est_cost_usd ?? 0), 0)
  return { today_view_usd, model_breakdown: rows }
}

function buildTick(snapshot: CostSnapshot, startedAt: number): string {
  const elapsedHr = (Date.now() - startedAt) / 3_600_000
  const rate_view_usd_per_hr = elapsedHr > 0.01 ? snapshot.today_view_usd / elapsedHr : 0

  const payload = {
    ts: Date.now(),
    today_view_usd: snapshot.today_view_usd,
    today_real_usd: snapshot.today_view_usd, // same source until real-cost feed exists
    rate_view_usd_per_hr: Math.round(rate_view_usd_per_hr * 1000) / 1000,
    rate_real_usd_per_hr: Math.round(rate_view_usd_per_hr * 1000) / 1000,
    warn_threshold: WARN_THRESHOLD_USD,
    kill_threshold: KILL_THRESHOLD_USD,
    model_breakdown: snapshot.model_breakdown,
  }
  return `event: cost-rate\ndata: ${JSON.stringify(payload)}\n\n`
}

// ── Route ──────────────────────────────────────────────────────────

export const Route = createFileRoute('/api/cost-rate/sse')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return new Response('Unauthorized', { status: 401 })
        }

        const encoder = new TextEncoder()
        const startedAt = Date.now()
        let tickInterval: ReturnType<typeof setInterval> | null = null

        const stream = new ReadableStream({
          start(controller) {
            // Send connected event immediately
            controller.enqueue(
              encoder.encode(
                `event: connected\ndata: ${JSON.stringify({ ts: startedAt })}\n\n`,
              ),
            )

            // Emit first tick right away (non-blocking)
            try {
              const snap = fetchCostSnapshot()
              controller.enqueue(encoder.encode(buildTick(snap, startedAt)))
            } catch {
              // best-effort
            }

            // Tick every 30s
            tickInterval = setInterval(() => {
              try {
                const snap = fetchCostSnapshot()
                controller.enqueue(encoder.encode(buildTick(snap, startedAt)))
              } catch {
                try {
                  controller.enqueue(encoder.encode(`: keepalive\n\n`))
                } catch {
                  // stream closed
                }
              }
            }, TICK_MS)

            // Keepalive every 15s in between
            const keepalive = setInterval(() => {
              try {
                controller.enqueue(encoder.encode(`: keepalive\n\n`))
              } catch {
                clearInterval(keepalive)
              }
            }, 15_000)
          },
          cancel() {
            if (tickInterval) clearInterval(tickInterval)
          },
        })

        return new Response(stream, {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-store',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          },
        })
      },
    },
  },
})
