/**
 * GET /api/sse/events?tenant=<tenant>&window=<seconds>
 *
 * Server-Sent Events stream of HookEvent objects.
 *
 * Source: tail ~/.claude/logs/events-{YYYY-MM-DD}.jsonl
 *   (written by ~/.claude/hooks/claude-event-emitter.py on every CC hook fire)
 *
 * Laminar OTEL context (track 1 discovery, 2026-05-13):
 *   Laminar self-hosted exposes two servers:
 *   - HTTP on :8000  → POST /v1/traces (protobuf ExportTraceServiceRequest)
 *   - gRPC on :8001  → TraceServiceServer / LogsServiceServer (proto, not HTTP)
 *   There is NO HTTP SSE stream for hook events in Laminar's app-server.
 *   The SSE realtime endpoint (/api/v1/projects/{id}/sse) is for Laminar's own
 *   frontend signals, not for Claude Code hook payloads.
 *   → LAMINAR_SSE_URL must be unset (or point to a custom bridge) for this to work.
 *
 * If LAMINAR_SSE_URL is set, tries that first; falls back to JSONL tail.
 * If both sources are unavailable, the stream stays open and sends keepalives.
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
import { createReadStream, existsSync, watch } from 'node:fs'
import { readdir, stat, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { isAuthenticatedWithCFAccess } from '../../../server/auth-middleware'
import { eventBus } from './event-bus'

// ── Config ───────────────────────────────────────────────────────────────────

// Only attempt Laminar proxy if LAMINAR_SSE_URL is explicitly set.
// Laminar :8001 is gRPC-only — no HTTP SSE. Default: empty = skip Laminar.
const LAMINAR_BASE = process.env.LAMINAR_SSE_URL ?? ''

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
 * Also ensures the log directory exists (emitter may not have run yet).
 */
async function findLatestJsonl(): Promise<string | null> {
  // Ensure log dir exists so fs.watch can target it even before first event
  try {
    await mkdir(JSONL_LOG_DIR, { recursive: true })
  } catch {
    // ignore
  }

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
 * Emit JSONL lines from startOffset to current EOF, returning new EOF.
 */
async function readNewLines(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  filePath: string,
  startOffset: number,
  tenant: string,
): Promise<number> {
  try {
    const s = await stat(filePath)
    if (s.size <= startOffset) return startOffset

    const stream = createReadStream(filePath, {
      encoding: 'utf8',
      start: startOffset,
      end: s.size - 1,
    })
    const rl = createInterface({ input: stream, crlfDelay: Infinity })
    for await (const line of rl) {
      if (!line.trim()) continue
      try {
        const evt = JSON.parse(line) as HookEvent
        if (!matchesTenant(evt, tenant)) continue
        controller.enqueue(
          encoder.encode(`event: hook_event\ndata: ${JSON.stringify(evt)}\n\n`),
        )
      } catch {
        // skip malformed lines
      }
    }
    return s.size
  } catch {
    return startOffset
  }
}

/**
 * Tail a JSONL file from the end and emit new lines as SSE events.
 *
 * Strategy:
 *   1. Backfill the last 50 lines immediately so the tab isn't blank.
 *   2. Use fs.watch for instant change notification (sub-100ms latency).
 *   3. Fall back to a 2s poll if fs.watch is unavailable (networked FS).
 */
async function tailJsonl(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  filePath: string,
  tenant: string,
  signal: AbortSignal,
): Promise<void> {
  // ── 1. Backfill last 50 lines ─────────────────────────────────────────────
  try {
    const rl = createInterface({
      input: createReadStream(filePath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    })
    const lines: string[] = []
    for await (const line of rl) {
      if (line.trim()) lines.push(line)
    }
    for (const line of lines.slice(-50)) {
      try {
        const evt = JSON.parse(line) as HookEvent
        if (!matchesTenant(evt, tenant)) continue
        controller.enqueue(
          encoder.encode(`event: hook_event\ndata: ${JSON.stringify(evt)}\n\n`),
        )
      } catch {
        // skip malformed
      }
    }
  } catch {
    // File not yet readable — that's fine, watcher will catch first write
  }

  // ── 2. Track current file size so we only read new bytes ─────────────────
  let lastSize = 0
  try {
    const s = await stat(filePath)
    lastSize = s.size
  } catch {
    lastSize = 0
  }

  // ── 3. Watch for changes ──────────────────────────────────────────────────
  let watcher: ReturnType<typeof watch> | null = null
  let pollFallback: ReturnType<typeof setInterval> | null = null

  async function onFileChange() {
    if (signal.aborted) return
    lastSize = await readNewLines(controller, encoder, filePath, lastSize, tenant)
  }

  try {
    watcher = watch(filePath, async (event) => {
      if (event === 'change') await onFileChange()
    })
    // Also watch the dir so we notice when today's file is created for the first time
    const dirWatcher = watch(JSONL_LOG_DIR, async (_event, filename) => {
      if (filename && filename.startsWith('events-') && filename.endsWith('.jsonl')) {
        // A new day file appeared — switch to it
        const newPath = join(JSONL_LOG_DIR, filename)
        if (newPath !== filePath && existsSync(newPath)) {
          lastSize = 0
          lastSize = await readNewLines(controller, encoder, newPath, 0, tenant)
        }
      }
    })
    signal.addEventListener(
      'abort',
      () => {
        watcher?.close()
        dirWatcher.close()
      },
      { once: true },
    )
  } catch {
    // fs.watch unavailable (e.g. networked FS) — fall back to 2s poll
    pollFallback = setInterval(async () => {
      if (signal.aborted) {
        if (pollFallback) clearInterval(pollFallback)
        return
      }
      lastSize = await readNewLines(controller, encoder, filePath, lastSize, tenant)
    }, 2_000)

    signal.addEventListener(
      'abort',
      () => {
        if (pollFallback) clearInterval(pollFallback)
      },
      { once: true },
    )
  }
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

            // 2. Try Laminar only if LAMINAR_SSE_URL is explicitly set.
            //    Default is empty — Laminar :8001 is gRPC-only, no HTTP SSE.
            const laminarCleanup = LAMINAR_BASE
              ? await tryLaminarProxy(
                  controller,
                  encoder,
                  tenant,
                  abortController.signal,
                )
              : null

            if (!laminarCleanup) {
              // 3a. In-process event bus — receives events from POST /api/sse/ingest
              //     (used when emitter hook runs on a different host than the cockpit)
              //     Backfill recent events, then subscribe for new ones.
              const recentBusEvents = eventBus.since(Date.now() - 5 * 60_000) // last 5 min
              for (const evt of recentBusEvents) {
                if (!matchesTenant(evt as unknown as HookEvent, tenant)) continue
                try {
                  controller.enqueue(
                    encoder.encode(
                      `event: hook_event\ndata: ${JSON.stringify(evt)}\n\n`,
                    ),
                  )
                } catch {
                  // stream closed
                }
              }
              const unsubscribe = eventBus.subscribe((evt) => {
                if (abortController.signal.aborted) return
                if (!matchesTenant(evt as unknown as HookEvent, tenant)) return
                try {
                  controller.enqueue(
                    encoder.encode(
                      `event: hook_event\ndata: ${JSON.stringify(evt)}\n\n`,
                    ),
                  )
                } catch {
                  // stream closed
                }
              })
              abortController.signal.addEventListener('abort', unsubscribe, { once: true })

              // 3b. JSONL tail — local fallback when emitter writes to same host.
              //     findLatestJsonl also ensures the log dir exists.
              const jsonlPath = await findLatestJsonl()
              if (jsonlPath) {
                // Don't await — runs in background via fs.watch
                tailJsonl(
                  controller,
                  encoder,
                  jsonlPath,
                  tenant,
                  abortController.signal,
                ).catch(() => {})
              } else {
                // Log dir exists but no file yet — watch the dir for first create
                ;(async () => {
                  try {
                    const dirWatcher = watch(JSONL_LOG_DIR, async (_evt, filename) => {
                      if (
                        filename &&
                        filename.startsWith('events-') &&
                        filename.endsWith('.jsonl')
                      ) {
                        dirWatcher.close()
                        const p = join(JSONL_LOG_DIR, filename)
                        await tailJsonl(
                          controller,
                          encoder,
                          p,
                          tenant,
                          abortController.signal,
                        )
                      }
                    })
                    abortController.signal.addEventListener(
                      'abort',
                      () => dirWatcher.close(),
                      { once: true },
                    )
                  } catch {
                    // fs.watch not available — nothing to do, keepalives keep stream alive
                  }
                })().catch(() => {})
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
