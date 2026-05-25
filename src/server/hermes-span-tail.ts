/**
 * Hermes span tail — Phase 2.5
 *
 * Polls per-profile hermes_events.db files every 2s and pushes new rows into
 * the in-process eventBus so Home FlowStrip + Observe pages see Hermes activity
 * alongside CC hook events.
 *
 * Profile discovery: HERMES_PROFILES_DIR env var, or HERMES_HOME/profiles, or
 * ~/.hermes/profiles (same resolution as /api/observe/spans).
 *
 * DB handles are opened lazily and closed after 5 min of no new rows.
 *
 * Call startHermesSpanTail() once at startup. Idempotent — second call is no-op.
 * Graceful shutdown: all intervals cleared on SIGTERM.
 */

import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { eventBus } from '../routes/api/sse/event-bus'

// ── Config ─────────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 2_000
const IDLE_CLOSE_MS = 5 * 60_000 // close DB handle after 5 min of no new rows

const HERMES_PROFILES_DIR =
  process.env.HERMES_PROFILES_DIR ??
  (process.env.HERMES_HOME
    ? join(process.env.HERMES_HOME, 'profiles')
    : join(process.env.HOME ?? homedir(), '.hermes', 'profiles'))

// ── State ──────────────────────────────────────────────────────────────────────

let started = false
const intervals: ReturnType<typeof setInterval>[] = []

/** High-water mark: max ts string seen per profile */
const hwm = new Map<string, string>()

/** Open DB handle + last-activity timestamp per profile */
const openHandles = new Map<string, { db: import('better-sqlite3').Database; lastActivity: number }>()

// ── Helpers ────────────────────────────────────────────────────────────────────

function discoverProfiles(): string[] {
  if (!existsSync(HERMES_PROFILES_DIR)) return []
  try {
    return readdirSync(HERMES_PROFILES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return []
  }
}

function dbPathForProfile(profile: string): string {
  return join(HERMES_PROFILES_DIR, profile, 'hermes_events.db')
}

async function getDb(profile: string): Promise<import('better-sqlite3').Database | null> {
  const existing = openHandles.get(profile)
  if (existing) {
    existing.lastActivity = Date.now()
    return existing.db
  }

  const dbPath = dbPathForProfile(profile)
  if (!existsSync(dbPath)) return null

  try {
    const Database = (await import('better-sqlite3')).default
    const db = new Database(dbPath, { readonly: true, fileMustExist: true })
    openHandles.set(profile, { db, lastActivity: Date.now() })
    return db
  } catch {
    return null
  }
}

function closeIdleHandles(): void {
  const now = Date.now()
  for (const [profile, handle] of openHandles) {
    if (now - handle.lastActivity > IDLE_CLOSE_MS) {
      try {
        handle.db.close()
      } catch {
        // ignore
      }
      openHandles.delete(profile)
    }
  }
}

// ── Core poll ──────────────────────────────────────────────────────────────────

async function pollProfile(profile: string): Promise<void> {
  try {
    const db = await getDb(profile)
    if (!db) return

    const after = hwm.get(profile) ?? '1970-01-01T00:00:00.000Z'

    type SpanRow = {
      ts: string
      source_app: string | null
      kind: string | null
      label: string | null
      span_id: string | null
      intent_id: string | null
      mcp_server: string | null
      tool_name: string | null
      model_req: string | null
      model_used: string | null
      provider: string | null
      input_tokens: number | null
      output_tokens: number | null
      cost_usd: number | null
      status: string | null
      error_message: string | null
    }

    const rows = db
      .prepare(
        `SELECT
          ts, source_app, kind, label, span_id, intent_id,
          mcp_server, tool_name, model_req, model_used, provider,
          input_tokens, output_tokens, cost_usd, status, error_message
        FROM hermes_events
        WHERE ts > ?
        ORDER BY ts ASC
        LIMIT 200`,
      )
      .all(after) as SpanRow[]

    if (rows.length === 0) return

    // Update high-water mark
    const maxTs = rows[rows.length - 1].ts
    hwm.set(profile, maxTs)

    // Update last-activity
    const handle = openHandles.get(profile)
    if (handle) handle.lastActivity = Date.now()

    // Push into eventBus
    for (const row of rows) {
      const tsMs = new Date(row.ts).getTime()
      eventBus.emit({
        // Fields matching HookEvent shape used by SSE consumers
        timestamp: isNaN(tsMs) ? Date.now() : tsMs,
        source_app: row.source_app ?? profile,
        hook_event_type: 'hermes_span',
        source: 'hermes-span',
        // Span-specific fields
        ts: row.ts,
        profile,
        kind: row.kind,
        label: row.label,
        span_id: row.span_id,
        intent_id: row.intent_id,
        mcp_server: row.mcp_server,
        tool_name: row.tool_name,
        model_req: row.model_req,
        model_used: row.model_used,
        provider: row.provider,
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
        cost_usd: row.cost_usd,
        status: row.status,
        error_message: row.error_message,
      })
    }
  } catch {
    // Individual profile failure — skip silently
  }
}

async function poll(): Promise<void> {
  const profiles = discoverProfiles()
  await Promise.allSettled(profiles.map(pollProfile))
  closeIdleHandles()
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function startHermesSpanTail(): void {
  if (started) return
  started = true

  // Initial poll fires shortly after startup
  poll().catch(() => {})

  const pollInterval = setInterval(() => {
    poll().catch(() => {})
  }, POLL_INTERVAL_MS)

  intervals.push(pollInterval)

  process.on('SIGTERM', () => {
    for (const id of intervals) clearInterval(id)
    for (const { db } of openHandles.values()) {
      try { db.close() } catch { /* ignore */ }
    }
  })
}
