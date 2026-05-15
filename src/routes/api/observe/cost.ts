/**
 * GET /api/observe/cost
 *
 * Returns daily token spend broken down by tenant + model (or any subset).
 *
 * Query params:
 *   days      – how many days back (default 1, max 30)
 *   group_by  – comma-separated list of {tenant, model, provider} (default "tenant,model")
 *   tenant    – filter to a single tenant slug (e.g. "henry_cos" or "mally")
 *
 * Response shape:
 *   {
 *     totals: { cost_usd, input_tokens, output_tokens },
 *     rows:   [{ tenant?, model?, provider?, cost_usd, input_tokens, output_tokens }, ...],
 *     since:  "ISO timestamp",
 *     source: "tokens_db" | "fixture" | "fixture_no_tenant_data" | "error"
 *   }
 *
 * Always returns 200.
 * If tokens.db is missing / unreadable → source:"fixture" + x-cockpit-fixture: true header.
 * Fixture shows 3 sample rows across henry/mally and claude-opus-4-7/claude-sonnet-4-6.
 */

import { createFileRoute } from '@tanstack/react-router'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { isAuthenticatedWithCFAccess } from '../../../server/auth-middleware'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CostRow = {
  tenant?: string | null
  model?: string | null
  provider?: string | null
  cost_usd: number
  input_tokens: number
  output_tokens: number
}

export type CostTotals = {
  cost_usd: number
  input_tokens: number
  output_tokens: number
}

export type CostResponse = {
  totals: CostTotals
  rows: CostRow[]
  since: string
  source: 'tokens_db' | 'fixture' | 'fixture_no_tenant_data' | 'error'
  error?: string
  tenant_filter?: string | null
}

// ---------------------------------------------------------------------------
// Path — Mac-local canonical cost ledger
// ---------------------------------------------------------------------------

const TOKENS_DB_PATH =
  process.env.TOKENS_DB_PATH ??
  join(homedir(), 'mcp-infra/data/cliproxy-tokens/tokens.db')

// ---------------------------------------------------------------------------
// Fixture data (used when tokens.db is unavailable — e.g. Oracle deployment)
// ---------------------------------------------------------------------------

/**
 * Canonical tenant slug stored in token_events.tenant vs the fixture tenant labels.
 * henry_cos rows are stored as "henry" in the fixture; mally rows as "mally".
 */
const FIXTURE_TENANT_MAP: Record<string, string> = {
  henry_cos: 'henry',
  mally:     'mally',
}

function buildFixture(since: string, tenantFilter?: string | null): CostResponse {
  const allRows: CostRow[] = [
    {
      tenant: 'henry',
      model: 'claude-opus-4-7',
      cost_usd: 9.12,
      input_tokens: 2_800_000,
      output_tokens: 48_000,
    },
    {
      tenant: 'henry',
      model: 'claude-sonnet-4-6',
      cost_usd: 3.44,
      input_tokens: 1_100_000,
      output_tokens: 24_000,
    },
    {
      tenant: 'mally',
      model: 'claude-sonnet-4-6',
      cost_usd: 2.31,
      input_tokens: 740_000,
      output_tokens: 16_500,
    },
  ]

  const dbTenant = tenantFilter ? (FIXTURE_TENANT_MAP[tenantFilter] ?? tenantFilter) : null
  const rows = dbTenant ? allRows.filter((r) => r.tenant === dbTenant) : allRows
  const source: CostResponse['source'] =
    dbTenant && rows.length === 0 ? 'fixture_no_tenant_data' : 'fixture'

  const totals: CostTotals = rows.reduce(
    (acc, r) => ({
      cost_usd: acc.cost_usd + r.cost_usd,
      input_tokens: acc.input_tokens + r.input_tokens,
      output_tokens: acc.output_tokens + r.output_tokens,
    }),
    { cost_usd: 0, input_tokens: 0, output_tokens: 0 },
  )
  totals.cost_usd = Math.round(totals.cost_usd * 100) / 100
  return { totals, rows, since, source, tenant_filter: tenantFilter ?? null }
}

// ---------------------------------------------------------------------------
// Allowed GROUP BY columns (allowlist prevents SQL injection)
// ---------------------------------------------------------------------------

const ALLOWED_GROUP_COLS = new Set(['tenant', 'model', 'provider'])

function parseGroupBy(raw: string | null): string[] {
  const parts = (raw ?? 'tenant,model')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => ALLOWED_GROUP_COLS.has(s))
  return parts.length > 0 ? parts : ['tenant', 'model']
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute('/api/observe/cost')({
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

        const days = Math.min(
          30,
          Math.max(1, parseInt(url.searchParams.get('days') ?? '1', 10) || 1),
        )
        const groupByCols = parseGroupBy(url.searchParams.get('group_by'))

        // Optional tenant filter — must be an allowlisted slug
        const tenantParam = url.searchParams.get('tenant') ?? null
        const ALLOWED_TENANTS = new Set(['henry_cos', 'mally'])
        const tenantFilter: string | null =
          tenantParam && ALLOWED_TENANTS.has(tenantParam) ? tenantParam : null

        // since = start of the window as an ISO string
        const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
        sinceDate.setUTCHours(0, 0, 0, 0)
        const since = sinceDate.toISOString()

        // ------------------------------------------------------------------
        // Fixture fallback when tokens.db is not present (e.g. Oracle host)
        // ------------------------------------------------------------------
        if (!existsSync(TOKENS_DB_PATH)) {
          const payload = buildFixture(since, tenantFilter)
          return new Response(JSON.stringify(payload), {
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store',
              'x-cockpit-fixture': 'true',
            },
          })
        }

        // ------------------------------------------------------------------
        // SQLite read
        // ------------------------------------------------------------------
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const Database = require('better-sqlite3')
          const db = new Database(TOKENS_DB_PATH, {
            readonly: true,
            fileMustExist: true,
          })

          // Build SELECT list — only include columns that are in group_by
          const selectCols = groupByCols
            .map((col) => `${col}`)
            .join(', ')

          const groupByClause = groupByCols.join(', ')

          // Map tenant slug → the value actually stored in token_events.tenant
          // (henry_cos is stored as "henry"; mally stays "mally")
          const dbTenant = tenantFilter
            ? (FIXTURE_TENANT_MAP[tenantFilter] ?? tenantFilter)
            : null

          // Build WHERE clause — always filter by ts; optionally by tenant
          const whereClause = dbTenant
            ? 'WHERE ts >= ? AND tenant = ?'
            : 'WHERE ts >= ?'
          const queryArgs: string[] = dbTenant ? [since, dbTenant] : [since]

          const rows = db
            .prepare(
              `
              SELECT
                ${selectCols},
                ROUND(SUM(COALESCE(cost_usd, 0)), 6)    AS cost_usd,
                SUM(COALESCE(input_tokens, 0))            AS input_tokens,
                SUM(COALESCE(output_tokens, 0))           AS output_tokens
              FROM token_events
              ${whereClause}
              GROUP BY ${groupByClause}
              ORDER BY cost_usd DESC
              `,
            )
            .all(...queryArgs) as Array<
              Record<string, unknown> & {
                cost_usd: number
                input_tokens: number
                output_tokens: number
              }
            >

          db.close()

          // Build typed rows — only include requested group cols
          const typedRows: CostRow[] = rows.map((r) => {
            const row: CostRow = {
              cost_usd: r.cost_usd,
              input_tokens: r.input_tokens,
              output_tokens: r.output_tokens,
            }
            if (groupByCols.includes('tenant'))   row.tenant   = r.tenant   as string | null
            if (groupByCols.includes('model'))    row.model    = r.model    as string | null
            if (groupByCols.includes('provider')) row.provider = r.provider as string | null
            return row
          })

          const totals = typedRows.reduce(
            (acc, r) => ({
              cost_usd: acc.cost_usd + r.cost_usd,
              input_tokens: acc.input_tokens + r.input_tokens,
              output_tokens: acc.output_tokens + r.output_tokens,
            }),
            { cost_usd: 0, input_tokens: 0, output_tokens: 0 },
          )
          totals.cost_usd = Math.round(totals.cost_usd * 1e6) / 1e6

          const payload: CostResponse = {
            totals,
            rows: typedRows,
            since,
            source: typedRows.length === 0 && tenantFilter ? 'fixture_no_tenant_data' : 'tokens_db',
            tenant_filter: tenantFilter,
          }

          return new Response(JSON.stringify(payload), {
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store, max-age=0',
            },
          })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          // DB open/query failed — return fixture rather than a 5xx
          const payload: CostResponse = {
            ...buildFixture(since, tenantFilter),
            source: 'error',
            error: msg,
          }
          return new Response(JSON.stringify(payload), {
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store',
              'x-cockpit-fixture': 'true',
            },
          })
        }
      },
    },
  },
})
