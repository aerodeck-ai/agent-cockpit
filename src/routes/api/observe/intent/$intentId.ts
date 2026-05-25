/**
 * /api/observe/intent/:intentId
 *
 * Returns all spans for a single intent assembled into a call tree.
 * Spans are loaded from per-profile SQLite hermes_events.db files
 * at /home/ubuntu/.hermes/profiles/<profile>/hermes_events.db (union).
 *
 * Response shape:
 *   { intent_id, root_span, span_count, total_duration_ms, total_cost_usd, source }
 *
 * Special behaviour:
 *   - intent_id starting with "fixture-" → returns hardcoded 3-node tree
 *   - No spans found → 200 with root_span: null, source: "empty"
 *   - DB error        → 200 with error field, root_span: null
 *   - Fixture responses include x-cockpit-fixture: true header
 */

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { join } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'
import { isAuthenticatedWithCFAccess } from '../../../../server/auth-middleware'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentEvent = {
  span_id: string
  parent_span_id: string | null
  intent_id: string
  ts: string
  kind: string
  label: string
  status: string
  model?: string | null
  tool_name?: string | null
  mcp_server?: string | null
  input_tokens?: number | null
  output_tokens?: number | null
  cost_usd?: number | null
  duration_ms?: number | null
  detail?: string | null
  profile?: string
  children?: AgentSpanNode[]
}

export type AgentSpanNode = AgentEvent & {
  children: AgentSpanNode[]
}

export type IntentTreeResponse = {
  intent_id: string
  root_span: AgentSpanNode | null
  span_count: number
  total_duration_ms: number
  total_cost_usd: number
  source: 'sqlite' | 'fixture' | 'empty'
  error?: string
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const HERMES_PROFILES_DIR =
  process.env.HERMES_PROFILES_DIR ?? '/home/ubuntu/.hermes/profiles'

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const FIXTURE_INTENT_ID = 'fixture-intent-1'

function buildFixtureTree(): AgentSpanNode {
  const root: AgentSpanNode = {
    span_id: 'fixture-span-root',
    parent_span_id: null,
    intent_id: FIXTURE_INTENT_ID,
    ts: '2026-05-13T10:00:00.000Z',
    kind: 'model_call',
    label: 'claude-sonnet-4-5 · user turn',
    status: 'ok',
    model: 'claude-sonnet-4-5',
    input_tokens: 1240,
    output_tokens: 312,
    cost_usd: 0.0031,
    duration_ms: 2100,
    profile: 'fixture',
    children: [
      {
        span_id: 'fixture-span-mcp',
        parent_span_id: 'fixture-span-root',
        intent_id: FIXTURE_INTENT_ID,
        ts: '2026-05-13T10:00:01.200Z',
        kind: 'mcp_call',
        label: 'hermes_findings · search',
        status: 'ok',
        tool_name: 'search',
        mcp_server: 'hermes_findings',
        duration_ms: 340,
        cost_usd: 0,
        profile: 'fixture',
        children: [],
      },
      {
        span_id: 'fixture-span-handoff',
        parent_span_id: 'fixture-span-root',
        intent_id: FIXTURE_INTENT_ID,
        ts: '2026-05-13T10:00:02.100Z',
        kind: 'handoff',
        label: 'reply dispatched',
        status: 'ok',
        duration_ms: 12,
        cost_usd: 0,
        profile: 'fixture',
        children: [],
      },
    ],
  }
  return root
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

/** Enumerate all per-profile hermes_events.db paths that exist on disk. */
function discoverProfileDbs(): Array<{ profile: string; path: string }> {
  if (!existsSync(HERMES_PROFILES_DIR)) return []
  try {
    return readdirSync(HERMES_PROFILES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => ({
        profile: d.name,
        path: join(HERMES_PROFILES_DIR, d.name, 'hermes_events.db'),
      }))
      .filter((e) => existsSync(e.path))
  } catch {
    return []
  }
}

/** Pull all rows for a given intent_id from a single profile DB. */
function queryProfileDb(
  dbPath: string,
  profile: string,
  intentId: string,
): AgentEvent[] {
  // Dynamic import so the module doesn't fail if better-sqlite3 is absent
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3')
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    // Probe columns — hermes_events schema may vary across profile versions
    const cols: Array<{ name: string }> = db
      .prepare(`PRAGMA table_info(hermes_events)`)
      .all() as Array<{ name: string }>
    const colNames = new Set(cols.map((c) => c.name))

    const select = (col: string, fallback = 'NULL') =>
      colNames.has(col) ? col : `${fallback} AS ${col}`

    const rows = db
      .prepare(
        `SELECT
           ${select('span_id')},
           ${select('parent_span_id')},
           ${select('intent_id')},
           ${select('ts')},
           ${select('kind')},
           ${select('label')},
           ${select('status', "'ok'")},
           ${select('model')},
           ${select('tool_name')},
           ${select('mcp_server')},
           ${select('input_tokens')},
           ${select('output_tokens')},
           ${select('cost_usd')},
           ${select('duration_ms')},
           ${select('detail')}
         FROM hermes_events
         WHERE intent_id = ?
         ORDER BY ts ASC`,
      )
      .all(intentId) as Omit<AgentEvent, 'profile' | 'children'>[]

    db.close()
    return rows.map((r) => ({ ...r, profile }))
  } catch {
    try {
      db.close()
    } catch {}
    return []
  }
}

// ---------------------------------------------------------------------------
// Tree assembly
// ---------------------------------------------------------------------------

function buildTree(spans: AgentEvent[]): {
  root: AgentSpanNode | null
  totalDurationMs: number
  totalCostUsd: number
} {
  if (spans.length === 0) {
    return { root: null, totalDurationMs: 0, totalCostUsd: 0 }
  }

  // Build node map (span_id → node with empty children)
  const nodeMap = new Map<string, AgentSpanNode>()
  for (const span of spans) {
    nodeMap.set(span.span_id, { ...span, children: [] })
  }

  // Attach children to parents; collect orphans (parent missing or null)
  const roots: AgentSpanNode[] = []
  for (const [, node] of nodeMap) {
    if (!node.parent_span_id) {
      roots.push(node)
    } else {
      const parent = nodeMap.get(node.parent_span_id)
      if (parent) {
        parent.children.push(node)
      } else {
        // Parent span not in result set — treat as root
        roots.push(node)
      }
    }
  }

  // Sort children by ts ASC at every level
  function sortChildren(node: AgentSpanNode): void {
    node.children.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))
    for (const child of node.children) sortChildren(child)
  }

  // Aggregate metrics
  const timestamps = spans
    .map((s) => new Date(s.ts).getTime())
    .filter((t) => !isNaN(t))
  const totalDurationMs =
    timestamps.length >= 2
      ? Math.max(...timestamps) - Math.min(...timestamps)
      : 0
  const totalCostUsd = spans.reduce((sum, s) => sum + (s.cost_usd ?? 0), 0)

  let root: AgentSpanNode
  if (roots.length === 1) {
    root = roots[0]
  } else {
    // Multiple roots — wrap in a synthetic container
    const intentId = spans[0]?.intent_id ?? 'unknown'
    root = {
      span_id: `synthetic-root-${intentId}`,
      parent_span_id: null,
      intent_id: intentId,
      ts: timestamps.length ? new Date(Math.min(...timestamps)).toISOString() : new Date().toISOString(),
      kind: 'synthetic_root',
      label: `intent ${intentId} (${roots.length} roots)`,
      status: 'ok',
      cost_usd: 0,
      profile: 'synthetic',
      children: roots.sort((a, b) => (a.ts < b.ts ? -1 : 1)),
    }
  }

  sortChildren(root)
  return { root, totalDurationMs, totalCostUsd }
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute('/api/observe/intent/$intentId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticatedWithCFAccess(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { intentId } = params

        // ------------------------------------------------------------------
        // Fixture mode
        // ------------------------------------------------------------------
        const isFixture =
          intentId.startsWith('fixture-') || !existsSync(HERMES_PROFILES_DIR)

        if (isFixture) {
          const fixtureRoot = buildFixtureTree()
          const payload: IntentTreeResponse = {
            intent_id: intentId,
            root_span: fixtureRoot,
            span_count: 3,
            total_duration_ms: 2112,
            total_cost_usd: 0.0031,
            source: 'fixture',
          }
          return new Response(JSON.stringify(payload), {
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store',
              'x-cockpit-fixture': 'true',
            },
          })
        }

        // ------------------------------------------------------------------
        // SQLite mode
        // ------------------------------------------------------------------
        try {
          const profileDbs = discoverProfileDbs()

          if (profileDbs.length === 0) {
            // No profile DBs found — return empty
            const payload: IntentTreeResponse = {
              intent_id: intentId,
              root_span: null,
              span_count: 0,
              total_duration_ms: 0,
              total_cost_usd: 0,
              source: 'empty',
            }
            return new Response(JSON.stringify(payload), {
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
              },
            })
          }

          // Union all spans across profiles
          const allSpans: AgentEvent[] = []
          for (const { profile, path: dbPath } of profileDbs) {
            try {
              const rows = queryProfileDb(dbPath, profile, intentId)
              allSpans.push(...rows)
            } catch {
              // Per-profile failure is non-fatal — skip and continue
            }
          }

          if (allSpans.length === 0) {
            const payload: IntentTreeResponse = {
              intent_id: intentId,
              root_span: null,
              span_count: 0,
              total_duration_ms: 0,
              total_cost_usd: 0,
              source: 'empty',
            }
            return new Response(JSON.stringify(payload), {
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
              },
            })
          }

          // Sort all spans by ts ASC before tree assembly
          allSpans.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))

          const { root, totalDurationMs, totalCostUsd } = buildTree(allSpans)

          const payload: IntentTreeResponse = {
            intent_id: intentId,
            root_span: root,
            span_count: allSpans.length,
            total_duration_ms: totalDurationMs,
            total_cost_usd: totalCostUsd,
            source: 'sqlite',
          }

          return new Response(JSON.stringify(payload), {
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store',
            },
          })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          const payload: Omit<IntentTreeResponse, 'source'> & {
            source: string
            error: string
          } = {
            intent_id: intentId,
            root_span: null,
            span_count: 0,
            total_duration_ms: 0,
            total_cost_usd: 0,
            source: 'empty',
            error: msg,
          }
          return new Response(JSON.stringify(payload), {
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store',
            },
          })
        }
      },
    },
  },
})
