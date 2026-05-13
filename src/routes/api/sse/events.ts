/**
 * GET /api/sse/events?tenant=<tenant>&window=<seconds>
 *
 * Server-Sent Events stream of HookEvent objects.
 *
 * Primary source: Laminar OTEL ingestion at Oracle :8001
 *   → GET http://localhost:8001/api/hook-events/stream (or equivalent)
 *
 * Fallback: tail ~/.claude/logs/events-{YYYY-MM-DD}.jsonl
 *   (written by the agent A4 JSONL emitter hook)
 *
 * If both sources are unavailable, the stream stays open and sends only
 * keepalives — clients reconnect via EventSource auto-retry.
 *
 * Event types emitted:
 *   event: connected  data: { ts: number }
 *   event: hook_event data: HookEvent (JSON)
 *   :keepalive        (comment, every 15s)
 *
 * Tenant filtering: if ?tenant is provided, only events whose source_app
 * contains the tenant string (case-insensitive) are forwarded.
 */

import { createFileRoute } from '@tanstack/react-router'
import { createReadStream, existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { isAuthenticatedWithCFAccess } from '../../../server/auth-middleware'

// ── Config ───────────────────────────────────────────────────────────────────

const LAMINAR_BASE =
  process.env.LAMINAR_SSE_URL ?? 'http://localhost:8001'

const JSONL_LOG_DIR =
  process.env.CLAUDE_LOGS_DIR ??
  join(homedir(), '.claude', 'logs')

const KEEPALIVE_INTERVAL_MS = 15_000

// ── Types (mirrors disler's HookEvent) ───────────────────────────────────────

interface HookEvent {
  source_app: string
  session_id: string
  parent_session_id?: string
  hook_event_type: string
  payload: Record<string, unknown>
  timestamp: number
  id?: string | number
  summary?: string
  model_name?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function matchesTenant(event: HookEvent, tenant: string): boolean {
  if (!tenant) return true
  return event.source_app.toLowerCase().includes(tenant.toLowerCase())
}

function todayJsonlPath(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return join(JSONL_LOG_DIR, `events-${yyyy}-${mm}-${dd}.jsonl`)
}

/**
 * Try to find the most recent JSONL log file.
 */
async function findLatestJsonl(): Promise<string | null> {
  // Check today's file first
  const today = todayJsonlPath()
  if (existsSync(today)) return today

  // Scan the log dir for the newest events-*.jsonl
  try {
    const files = await readdir(JSONL_LOG_DIR)
    const jsonlFiles = files
      .filter((f) => f.startsWith('events-') && f.endsWith('.jsonl'))
      .sort()
      .reverse()
    if (jsonlFiles.length > 0) {
      return join(JSONL_LOG_DIR, jsonlFiles[0])
    }
  } catch {
    // No log dir — that's fine
  }
  return null
}

/**
 * Attempt to proxy from Laminar SSE endpoint.
 * Returns a cleanup function, or null if Laminar is unreachable.
 */
async function tryLaminarProxy(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  tenant: string,
  signal: AbortSignal,
): Promise<(() => void) | null> {
  const url = `${LAMINAR_BASE}/api/hook-events/stream${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ''}`

  try {
    const resp = await fetch(url, {
      signal,
      headers: { Accept: 'text/event-stream' },
    })

    if (!resp.ok || !resp.body) return null

    const reader = resp.body.getReader()
    const td = new TextDecoder()

    ;(async () => {
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done || signal.aborted) break

          const chunk = td.decode(value, { stream: true })
          // Forward SSE lines verbatim; re-emit as hook_event if data line
          for (const line of chunk.split('\n')) {
            if (line.startsWith('data:')) {
              try {
                const evt = JSON.parse(line.slice(5).trim()) as HookEvent
                if (!matchesTenant(evt, tenant)) continue
                controller.enqueue(
                  encoder.encode(
                    `event: hook_event\ndata: ${JSON.stringify(evt)}\n\n`,
                  ),
                )
              } catch {
                // not JSON — skip
              }
            }
          }
        }
      } catch {
        // Laminar disconnected
      }
    })()

    return () => reader.cancel()
  } catch {
    return null
  }
}

/**
 * Tail a JSONL file from the end and emit new lines as events.
 * Reads the last N lines immediately, then polls for new lines.
 */
async function tailJsonl(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  filePath: string,
  tenant: string,
  signal: AbortSignal,
): Promise<void> {
  // Emit recent events from the file first
  try {
    const rl = createInterface({
      input: createReadStream(filePath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    })
    const lines: string[] = []
    for await (const line of rl) {
      if (line.trim()) lines.push(line)
    }
    // Emit last 50 lines as backfill
    const backfill = lines.slice(-50)
    for (const line of backfill) {
      try {
        const evt = JSON.parse(line) as HookEvent
        if (!matchesTenant(evt, tenant)) continue
        controller.enqueue(
          encoder.encode(
            `event: hook_event\ndata: ${JSON.stringify(evt)}\n\n`,
          ),
        )
      } catch {
        // skip malformed
      }
    }
  } catch {
    // File unreadable
  }

  // Poll for new content every 2s by tracking file size
  let lastSize = 0
  try {
    const { stat } = await import('node:fs/promises')
    const s = await stat(filePath)
    lastSize = s.size
  } catch {
    return
  }

  const pollInterval = setInterval(async () => {
    if (signal.aborted) {
      clearInterval(pollInterval)
      return
    }
    try {
      const { stat } = await import('node:fs/promises')
      const s = await stat(filePath)
      if (s.size <= lastSize) return

      const { createReadStream: crs } = await import('node:fs')
      const stream = crs(filePath, {
        encoding: 'utf8',
        start: lastSize,
        end: s.size,
      })
      lastSize = s.size

      const rl = createInterface({ input: stream, crlfDelay: Infinity })
      for await (const line of rl) {
        if (!line.trim()) continue
        try {
          const evt = JSON.parse(line) as HookEvent
          if (!matchesTenant(evt, tenant)) continue
          controller.enqueue(
            encoder.encode(
              `event: hook_event\ndata: ${JSON.stringify(evt)}\n\n`,
            ),
          )
        } catch {
          // skip
        }
      }
    } catch {
      // file rotated or gone — stop polling
      clearInterval(pollInterval)
    }
  }, 2_000)

  // Clean up on abort
  signal.addEventListener('abort', () => clearInterval(pollInterval), {
    once: true,
  })
}

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/api/sse/events')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticatedWithCFAccess(request)) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        const url = new URL(request.url)
        const tenant = url.searchParams.get('tenant') ?? ''
        // windowSeconds not used server-side for SSE (live stream)
        // kept for API compat; JSONL backfill uses last 50 lines regardless

        const encoder = new TextEncoder()
        const abortController = new AbortController()

        const stream = new ReadableStream({
          async start(controller) {
            // 1. Send connected event
            controller.enqueue(
              encoder.encode(
                `event: connected\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`,
              ),
            )

            // 2. Try Laminar first
            const laminarCleanup = await tryLaminarProxy(
              controller,
              encoder,
              tenant,
              abortController.signal,
            )

            if (!laminarCleanup) {
              // 3. Laminar unreachable — fall back to JSONL tail
              const jsonlPath = await findLatestJsonl()
              if (jsonlPath) {
                // Don't await — runs in background via polling
                tailJsonl(
                  controller,
                  encoder,
                  jsonlPath,
                  tenant,
                  abortController.signal,
                ).catch(() => {})
              }
            }

            // 4. Keepalive loop
            const keepalive = setInterval(() => {
              try {
                controller.enqueue(encoder.encode(`: keepalive\n\n`))
              } catch {
                clearInterval(keepalive)
              }
            }, KEEPALIVE_INTERVAL_MS)

            abortController.signal.addEventListener(
              'abort',
              () => {
                clearInterval(keepalive)
                laminarCleanup?.()
              },
              { once: true },
            )
          },
          cancel() {
            abortController.abort()
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
