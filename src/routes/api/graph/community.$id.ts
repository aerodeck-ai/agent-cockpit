/**
 * GET /api/graph/community/$id
 *
 * Returns up to 5,000 nodes + internal edges for the requested community id.
 * Full graph is cached in module scope after first load (~232MB, one-time 2s parse).
 */

import { createFileRoute } from '@tanstack/react-router'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

const GRAPH_PATH = path.join(os.homedir(), 'graphify-fleet', 'cross-host-graph.json')
const MAX_NODES = 5000

interface RawNode {
  id: string
  label: string
  file_type?: string
  source_file?: string
  source_location?: string
  repo?: string
  community?: number
}

interface RawEdge {
  source: string
  target: string
  weight?: number
  relation?: string
}

interface RawGraph {
  nodes: RawNode[]
  links?: RawEdge[]
  edges?: RawEdge[]
}

// Module-scope cache — populated on first request
let cachedGraph: RawGraph | null = null
let cacheLoading = false
let cacheWaiters: Array<(g: RawGraph) => void> = []

async function getGraph(): Promise<RawGraph> {
  if (cachedGraph) return cachedGraph

  if (cacheLoading) {
    return new Promise<RawGraph>((resolve) => {
      cacheWaiters.push(resolve)
    })
  }

  cacheLoading = true
  return new Promise<RawGraph>((resolve) => {
    cacheWaiters.push(resolve)

    // Load asynchronously to avoid blocking the event loop
    setImmediate(() => {
      try {
        const raw = fs.readFileSync(GRAPH_PATH, 'utf8')
        const graph: RawGraph = JSON.parse(raw)
        cachedGraph = graph
        const waiters = cacheWaiters
        cacheWaiters = []
        cacheLoading = false
        for (const w of waiters) w(graph)
      } catch (err) {
        cacheLoading = false
        const waiters = cacheWaiters
        cacheWaiters = []
        for (const w of waiters) w({ nodes: [], links: [] })
      }
    })
  })
}

export const Route = createFileRoute('/api/graph/community/$id')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const t0 = Date.now()
        const communityId = parseInt(params.id, 10)

        if (isNaN(communityId)) {
          return Response.json({ error: 'Invalid community id' }, { status: 400 })
        }

        const graph = await getGraph()
        const edges = graph.links ?? graph.edges ?? []

        // Filter nodes
        const communityNodes = graph.nodes.filter(
          (n) => n.community === communityId,
        )

        if (communityNodes.length === 0) {
          return Response.json({ error: 'Community not found', id: communityId }, { status: 404 })
        }

        // Cap at MAX_NODES
        const cappedNodes = communityNodes.slice(0, MAX_NODES)
        const nodeIds = new Set(cappedNodes.map((n) => n.id))

        // Internal edges only
        const internalEdges = edges.filter(
          (e) => nodeIds.has(e.source) && nodeIds.has(e.target),
        )

        const elapsed = Date.now() - t0

        return Response.json(
          {
            community_id: communityId,
            nodes: cappedNodes,
            edges: internalEdges,
            meta: {
              node_count: cappedNodes.length,
              edge_count: internalEdges.length,
              total_in_community: communityNodes.length,
              capped: communityNodes.length > MAX_NODES,
              elapsed_ms: elapsed,
            },
          },
          {
            headers: {
              'Cache-Control': 'public, max-age=300',
            },
          },
        )
      },
    },
  },
})
