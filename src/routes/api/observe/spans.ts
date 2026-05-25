/**
 * GET /api/observe/spans
 *
 * Returns recent Hermes spans from per-profile hermes_events.db files for the
 * /observe/trace and /observe/workflow views.
 *
 * Data source: Oracle /home/ubuntu/.hermes/profiles/<profile>/hermes_events.db
 * Schema: AgentEvent fields — see hermes-agent/agent_event.py:SQLITE_DDL
 *
 * Query params:
 *   since    — duration string "5m" | "1h" | "24h"  (default: "5m")
 *   intent_id — filter to a specific intent (optional)
 *   profile  — repeatable; filter to specific profiles (default: all found)
 *   limit    — max rows, capped at 1000 (default: 200)
 *
 * Response:
 *   { spans: AgentEvent[], count: number, source: "sqlite" | "fixture" | "error" }
 *
 * Fixture fallback: if no hermes_events.db files are found OR all return 0
 * rows, returns 3 sample spans and sets header x-cockpit-fixture: true.
 *
 * Always returns HTTP 200 — never lets an empty/broken data source crash the view.
 */

import { createFileRoute } from '@tanstack/react-router'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { isAuthenticatedWithCFAccess } from '../../../server/auth-middleware'

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentEvent = {
  intent_id: string | null
  span_id: string | null
  parent_span_id: string | null
  ts: string
  source_app: string | null
  kind: string | null
  label: string | null
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
  profile?: string
}

// ─── Config ───────────────────────────────────────────────────────────────────

/**
 * Root of Hermes profiles directory.
 * On Oracle: /home/ubuntu/.hermes/profiles
 * On Mac dev: ~/.hermes/profiles (will likely be empty → fixture fallback)
 * Override with HERMES_PROFILES_DIR env var.
 */
const HERMES_PROFILES_DIR =
  process.env.HERMES_PROFILES_DIR ??
  (process.env.HERMES_HOME
    ? join(process.env.HERMES_HOME, 'profiles')
    : join(
        process.env.HOME ?? '/home/ubuntu',
        '.hermes',
        'profiles',
      ))

// ─── Duration parsing ─────────────────────────────────────────────────────────

function parseSinceToDuration(since: string): string {
  const m = since.match(/^(\d+)(m|h|d)$/)
  if (!m) return '-5 minutes'
  const [, n, unit] = m
  const map: Record<string, string> = { m: 'minutes', h: 'hours', d: 'days' }
  return `-${n} ${map[unit]}`
}

// ─── Profile discovery ────────────────────────────────────────────────────────

function discoverProfiles(profilesDir: string): string[] {
  if (!existsSync(profilesDir)) return []
  try {
    return readdirSync(profilesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return []
  }
}

function dbPathForProfile(profilesDir: string, profile: string): string {
  return join(profilesDir, profile, 'hermes_events.db')
}

// ─── Fixture data ─────────────────────────────────────────────────────────────

function fixtureSpans(): AgentEvent[] {
  const now = new Date()
  const tsOf = (offsetMs: number) =>
    new Date(now.getTime() - offsetMs).toISOString()

  return [
    {
      intent_id: 'fixture-intent-1',
      span_id: 'fixture-span-1',
      parent_span_id: null,
      ts: tsOf(9000),
      source_app: 'hermes-agent',
      kind: 'model_call',
      label: 'claude-sonnet-4-5 → draft reply',
      mcp_server: null,
      tool_name: null,
      model_req: 'claude-sonnet-4-5',
      model_used: 'claude-sonnet-4-5',
      provider: 'anthropic',
      input_tokens: 1240,
      output_tokens: 387,
      cost_usd: 0.00312,
      status: 'ok',
      error_message: null,
      profile: 'fixture',
    },
    {
      intent_id: 'fixture-intent-1',
      span_id: 'fixture-span-2',
      parent_span_id: 'fixture-span-1',
      ts: tsOf(5000),
      source_app: 'hermes-agent',
      kind: 'mcp_call',
      label: 'berlos-mcp / hermes_summary',
      mcp_server: 'berlos-mcp',
      tool_name: 'hermes_summary',
      model_req: null,
      model_used: null,
      provider: null,
      input_tokens: null,
      output_tokens: null,
      cost_usd: null,
      status: 'ok',
      error_message: null,
      profile: 'fixture',
    },
    {
      intent_id: 'fixture-intent-1',
      span_id: 'fixture-span-3',
      parent_span_id: 'fixture-span-1',
      ts: tsOf(1000),
      source_app: 'hermes-agent',
      kind: 'handoff',
      label: 'reply drafted → telegram outbox',
      mcp_server: null,
      tool_name: null,
      model_req: null,
      model_used: null,
      provider: null,
      input_tokens: null,
      output_tokens: null,
      cost_usd: null,
      status: 'ok',
      error_message: null,
      profile: 'fixture',
    },
  ]
}

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/api/observe/spans')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticatedWithCFAccess(request)) {
          return new Response(
            JSON.stringify({ error: 'Unauthorized', spans: [], count: 0, source: 'error' }),
            { status: 401, headers: { 'Content-Type': 'application/json' } },
          )
        }

        const url = new URL(request.url)
        const since = url.searchParams.get('since') ?? '5m'
        const intentId = url.searchParams.get('intent_id') ?? null
        const profileFilter = url.searchParams.getAll('profile')
        const limit = Math.min(
          1000,
          parseInt(url.searchParams.get('limit') ?? '200', 10) || 200,
        )

        const sqliteDuration = parseSinceToDuration(since)

        try {
          // Determine which profiles to query
          const allProfiles = discoverProfiles(HERMES_PROFILES_DIR)
          const profilesToQuery =
            profileFilter.length > 0
              ? profileFilter.filter((p) => allProfiles.includes(p))
              : allProfiles

          // Collect spans from each profile's hermes_events.db
          const allSpans: AgentEvent[] = []
          let queriedAny = false

          if (profilesToQuery.length > 0) {
            const Database = (await import('better-sqlite3')).default

            for (const profile of profilesToQuery) {
              const dbPath = dbPathForProfile(HERMES_PROFILES_DIR, profile)
              if (!existsSync(dbPath)) continue

              try {
                const db = new Database(dbPath, {
                  readonly: true,
                  fileMustExist: true,
                })

                // Build query with optional intent_id filter
                const intentClause = intentId
                  ? `AND intent_id = @intentId`
                  : ''

                const rows = db
                  .prepare(
                    `
                    SELECT
                      intent_id,
                      span_id,
                      parent_span_id,
                      ts,
                      source_app,
                      kind,
                      label,
                      mcp_server,
                      tool_name,
                      model_req,
                      model_used,
                      provider,
                      input_tokens,
                      output_tokens,
                      cost_usd,
                      status,
                      error_message
                    FROM hermes_events
                    WHERE ts >= datetime('now', @duration)
                    ${intentClause}
                    ORDER BY ts DESC
                    LIMIT @limit
                  `,
                  )
                  .all({
                    duration: sqliteDuration,
                    intentId: intentId ?? '',
                    limit,
                  }) as Omit<AgentEvent, 'profile'>[]

                db.close()

                queriedAny = true
                for (const row of rows) {
                  allSpans.push({ ...row, profile })
                }
              } catch {
                // Individual DB failure — skip this profile, continue
              }
            }
          }

          // Sort merged result by ts DESC and cap at limit
          allSpans.sort((a, b) => (b.ts > a.ts ? 1 : b.ts < a.ts ? -1 : 0))
          const spans = allSpans.slice(0, limit)

          // Fixture fallback: no files found or all returned 0 rows
          if (!queriedAny || spans.length === 0) {
            const fixtures = fixtureSpans()
            // Apply intent_id filter to fixtures too
            const filtered = intentId
              ? fixtures.filter((s) => s.intent_id === intentId)
              : fixtures

            return new Response(
              JSON.stringify({
                spans: filtered,
                count: filtered.length,
                source: 'fixture',
              }),
              {
                headers: {
                  'Content-Type': 'application/json',
                  'Cache-Control': 'no-store',
                  'x-cockpit-fixture': 'true',
                },
              },
            )
          }

          return new Response(
            JSON.stringify({ spans, count: spans.length, source: 'sqlite' }),
            {
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=15, s-maxage=15',
              },
            },
          )
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return new Response(
            JSON.stringify({ spans: [], count: 0, error: msg, source: 'error' }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }
      },
    },
  },
})
