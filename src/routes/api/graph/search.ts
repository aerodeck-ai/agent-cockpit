/**
 * POST /api/graph/search
 * Body: { q: string }
 *
 * Shells out to: graphify query "$q" --graph ... --budget 800
 * 8s timeout. Returns stdout JSON from graphify.
 */

import { createFileRoute } from '@tanstack/react-router'
import { execFile } from 'node:child_process'
import * as path from 'node:path'
import * as os from 'node:os'

const GRAPHIFY_BIN = path.join(
  os.homedir(),
  'mcp-infra',
  'graphify',
  'venv',
  'bin',
  'graphify',
)
const GRAPH_PATH = path.join(os.homedir(), 'graphify-fleet', 'cross-host-graph.json')
const TIMEOUT_MS = 8000

function runGraphifyQuery(query: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('graphify query timed out after 8s'))
    }, TIMEOUT_MS)

    const child = execFile(
      GRAPHIFY_BIN,
      ['query', query, '--graph', GRAPH_PATH, '--budget', '800'],
      { maxBuffer: 10 * 1024 * 1024 }, // 10MB stdout buffer
      (err, stdout, stderr) => {
        clearTimeout(timer)
        if (err) {
          // Still try to parse stdout — graphify may exit non-zero but produce valid JSON
          try {
            resolve(JSON.parse(stdout))
          } catch {
            reject(new Error(`graphify error: ${err.message}\nstderr: ${stderr}`))
          }
          return
        }
        try {
          resolve(JSON.parse(stdout))
        } catch {
          // Return raw text if not JSON
          resolve({ raw: stdout, query })
        }
      },
    )
  })
}

export const Route = createFileRoute('/api/graph/search')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { q?: string }
        try {
          body = await request.json()
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
        }

        const q = body?.q?.trim()
        if (!q || q.length < 1) {
          return Response.json({ error: 'Missing query field "q"' }, { status: 400 })
        }

        if (q.length > 500) {
          return Response.json({ error: 'Query too long (max 500 chars)' }, { status: 400 })
        }

        const t0 = Date.now()

        try {
          const result = await runGraphifyQuery(q)
          return Response.json({
            ok: true,
            query: q,
            elapsed_ms: Date.now() - t0,
            result,
          })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return Response.json(
            {
              ok: false,
              query: q,
              elapsed_ms: Date.now() - t0,
              error: msg,
            },
            { status: 502 },
          )
        }
      },
    },
  },
})
