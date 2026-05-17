#!/usr/bin/env node
/**
 * prepare-graph-summary.ts
 *
 * Reads ~/graphify-fleet/cross-host-graph.json (349k nodes, ~438MB actual),
 * computes a community-summary view, and writes
 * ~/agent-cockpit/public/graph-summary.json (<1MB target).
 *
 * Output schema:
 *   communities: [{id, label, node_count, center_label, top_nodes, repos}]
 *   cross_edges:  [{source, target, weight}]  — community-to-community
 *   meta: {total_nodes, total_links, total_communities, generated_at}
 *
 * Usage:  npx tsx scripts/prepare-graph-summary.ts
 * npm run: graph:prepare
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

const GRAPH_PATH = path.join(os.homedir(), 'graphify-fleet', 'cross-host-graph.json')
const OUT_PATH = path.join(os.homedir(), 'agent-cockpit', 'public', 'graph-summary.json')

const TOP_N_COMMUNITIES = 300 // max communities in summary
const TOP_NODES_PER_COMMUNITY = 5

interface RawNode {
  id: string
  label: string
  file_type?: string
  source_file?: string
  source_location?: string
  repo?: string
  community?: number
  norm_label?: string
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

interface CommunitySummary {
  id: number
  label: string
  node_count: number
  center_label: string
  top_nodes: { id: string; label: string; repo: string }[]
  repos: Record<string, number>
}

interface CrossEdge {
  source: number
  target: number
  weight: number
}

interface GraphSummary {
  communities: CommunitySummary[]
  cross_edges: CrossEdge[]
  meta: {
    total_nodes: number
    total_links: number
    total_communities: number
    nodes_with_community: number
    generated_at: string
  }
}

console.log('[graph-summary] Loading graph…')
const t0 = Date.now()
const raw = fs.readFileSync(GRAPH_PATH, 'utf8')
console.log(`[graph-summary] Read ${(raw.length / 1e6).toFixed(1)}MB in ${Date.now() - t0}ms`)

const t1 = Date.now()
const graph: RawGraph = JSON.parse(raw)
console.log(`[graph-summary] Parsed in ${Date.now() - t1}ms`)

const nodes = graph.nodes
const edges: RawEdge[] = graph.links ?? graph.edges ?? []
console.log(`[graph-summary] ${nodes.length} nodes, ${edges.length} edges`)

// Group nodes by community
const t2 = Date.now()
const communityNodes = new Map<number, RawNode[]>()
let nodesWithCommunity = 0

for (const n of nodes) {
  if (n.community == null) continue
  nodesWithCommunity++
  const cid = n.community
  if (!communityNodes.has(cid)) {
    communityNodes.set(cid, [])
  }
  communityNodes.get(cid)!.push(n)
}

console.log(`[graph-summary] ${communityNodes.size} communities, ${nodesWithCommunity} labeled nodes (${Date.now() - t2}ms)`)

// Build node-id → community map for edge cross-counting
const nodeToCommunity = new Map<string, number>()
for (const [cid, cnodes] of communityNodes) {
  for (const n of cnodes) {
    nodeToCommunity.set(n.id, cid)
  }
}

// Count cross-community edges
const t3 = Date.now()
const crossEdgeMap = new Map<string, number>()

for (const e of edges) {
  const sc = nodeToCommunity.get(e.source)
  const tc = nodeToCommunity.get(e.target)
  if (sc == null || tc == null || sc === tc) continue
  const key = `${sc}:${tc}`
  crossEdgeMap.set(key, (crossEdgeMap.get(key) ?? 0) + (e.weight ?? 1))
}
console.log(`[graph-summary] ${crossEdgeMap.size} cross-community edges computed (${Date.now() - t3}ms)`)

// Sort communities by size, take top N
const sortedCommunities = [...communityNodes.entries()]
  .sort(([, a], [, b]) => b.length - a.length)
  .slice(0, TOP_N_COMMUNITIES)

// Build community summaries
const communities: CommunitySummary[] = sortedCommunities.map(([cid, cnodes]) => {
  // Count repos
  const repoCounts: Record<string, number> = {}
  for (const n of cnodes) {
    const repo = n.repo ?? 'unknown'
    repoCounts[repo] = (repoCounts[repo] ?? 0) + 1
  }

  // Dominant repo for label
  const dominantRepo = Object.entries(repoCounts).sort(([, a], [, b]) => b - a)[0]?.[0] ?? 'unknown'

  // Find the most "central" label — highest frequency non-generic
  const labelCounts: Record<string, number> = {}
  for (const n of cnodes) {
    const lbl = n.label?.trim()
    if (!lbl || lbl.length < 3) continue
    labelCounts[lbl] = (labelCounts[lbl] ?? 0) + 1
  }
  const centerLabel =
    Object.entries(labelCounts).sort(([, a], [, b]) => b - a)[0]?.[0] ?? `community-${cid}`

  // Pick top representative nodes (highest degree proxy = most label occurrences, diverse repos)
  const seenRepos = new Set<string>()
  const topNodes: { id: string; label: string; repo: string }[] = []
  for (const n of cnodes) {
    if (topNodes.length >= TOP_NODES_PER_COMMUNITY) break
    const repo = n.repo ?? 'unknown'
    if (!seenRepos.has(repo) || topNodes.length < 2) {
      topNodes.push({ id: n.id, label: n.label, repo })
      seenRepos.add(repo)
    }
  }

  // Label: use dominant repo + center_label
  const label = `${dominantRepo} · ${centerLabel}`

  return {
    id: cid,
    label,
    node_count: cnodes.length,
    center_label: centerLabel,
    top_nodes: topNodes,
    repos: repoCounts,
  }
})

// Included community IDs set (for filtering cross-edges)
const includedCommunityIds = new Set(communities.map((c) => c.id))

// Build cross-edge list (only between included communities, top 1000 by weight)
const crossEdges: CrossEdge[] = [...crossEdgeMap.entries()]
  .map(([key, weight]) => {
    const [s, t] = key.split(':').map(Number)
    return { source: s, target: t, weight }
  })
  .filter((e) => includedCommunityIds.has(e.source) && includedCommunityIds.has(e.target))
  .sort((a, b) => b.weight - a.weight)
  .slice(0, 1000)

const summary: GraphSummary = {
  communities,
  cross_edges: crossEdges,
  meta: {
    total_nodes: nodes.length,
    total_links: edges.length,
    total_communities: communityNodes.size,
    nodes_with_community: nodesWithCommunity,
    generated_at: new Date().toISOString(),
  },
}

// Ensure public dir exists
const publicDir = path.dirname(OUT_PATH)
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true })
}

const outStr = JSON.stringify(summary)
fs.writeFileSync(OUT_PATH, outStr, 'utf8')
const outKB = (outStr.length / 1024).toFixed(1)

console.log(`[graph-summary] Written ${outKB}KB → ${OUT_PATH}`)
console.log(`[graph-summary] Communities: ${communities.length}, cross-edges: ${crossEdges.length}`)
console.log(`[graph-summary] Sample communities:`)
for (const c of communities.slice(0, 3)) {
  console.log(`  [${c.id}] ${c.label} — ${c.node_count} nodes`)
}
console.log(`[graph-summary] Total time: ${Date.now() - t0}ms`)
