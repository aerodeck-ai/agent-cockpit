/**
 * GraphScreen — /graph community-view
 *
 * Initial view: community nodes from /graph-summary.json (<500 nodes, <2s render).
 * Click a community → expand to member nodes via /api/graph/community/{id}.
 * Search box → POST /api/graph/search → result list.
 *
 * Design: matches TopologyHome constraints — plain rectangles, thin borders,
 * Inter font, no glow/glassmorphism. Uses theme CSS tokens (var(--theme-*)).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Edge,
  type Node,
  type NodeProps,
  Handle,
  Position,
  useReactFlow,
  ReactFlowProvider,
  BackgroundVariant,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

// ─── Types ──────────────────────────────────────────────────────────────────

interface CommunityEntry {
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
  communities: CommunityEntry[]
  cross_edges: CrossEdge[]
  meta: {
    total_nodes: number
    total_links: number
    total_communities: number
    nodes_with_community: number
    generated_at: string
  }
}

interface ExpandedNode {
  id: string
  label: string
  repo?: string
  source_file?: string
}

interface SearchResult {
  ok: boolean
  query: string
  elapsed_ms: number
  result?: unknown
  error?: string
}

// ─── Color mapping for repos ─────────────────────────────────────────────────

const REPO_COLORS: Record<string, string> = {
  'hermes-agent':     '#a5b4fc',  // indigo
  'mcp-infra':        '#86efac',  // green
  'agent-cockpit':    '#fbbf24',  // amber
  'agent-cockpit-mac':'#fcd34d',  // amber-light
  'berlai-ops':       '#c4b5fd',  // violet
  'profiles':         '#f9a8d4',  // pink
  'wiki':             '#67e8f9',  // cyan
}

function getRepoColor(repos: Record<string, number>): string {
  const dominant = Object.entries(repos).sort(([, a], [, b]) => b - a)[0]?.[0]
  return REPO_COLORS[dominant ?? ''] ?? '#71717a'
}

// ─── Community node (summary view) ──────────────────────────────────────────

interface CommunityNodeData {
  kind: 'community'
  label: string
  center_label: string
  node_count: number
  repos: Record<string, number>
  expanded: boolean
  communityId: number
}

function CommunityNode({ data, selected }: NodeProps) {
  const d = data as CommunityNodeData
  const color = getRepoColor(d.repos)
  const isExpanded = d.expanded

  return (
    <div
      style={{
        width: 180,
        padding: '10px 12px',
        background: isExpanded ? '#111118' : '#0c0c12',
        border: `${selected ? 2 : 1}px solid ${selected ? color : '#3f3f46'}`,
        borderRadius: 6,
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        color: '#e4e4e7',
        cursor: 'pointer',
        transition: 'border-color 0.2s ease, background 0.2s ease',
        boxShadow: selected ? `0 0 0 1px ${color}22` : 'none',
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: '#3f3f46', width: 6, height: 6, border: 'none' }}
      />
      {/* Repo color bar */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: color,
          borderRadius: '6px 6px 0 0',
          opacity: 0.7,
        }}
      />
      <div style={{ fontSize: 10, fontWeight: 600, lineHeight: 1.3, marginTop: 2 }}>
        {d.center_label.length > 28 ? d.center_label.slice(0, 26) + '…' : d.center_label}
      </div>
      <div style={{ fontSize: 8, color: color, marginTop: 3, opacity: 0.9, letterSpacing: 0.3 }}>
        {Object.keys(d.repos)[0] ?? '?'}
      </div>
      <div
        style={{
          fontSize: 9,
          color: '#71717a',
          marginTop: 4,
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>{d.node_count.toLocaleString()} nodes</span>
        <span style={{ color: isExpanded ? '#22d3ee' : '#52525b' }}>
          {isExpanded ? 'expanded' : 'click to drill'}
        </span>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: '#3f3f46', width: 6, height: 6, border: 'none' }}
      />
    </div>
  )
}

// ─── Member node (expanded view) ─────────────────────────────────────────────

interface MemberNodeData {
  kind: 'member'
  label: string
  repo?: string
  source_file?: string
  communityId: number
}

function MemberNode({ data }: NodeProps) {
  const d = data as MemberNodeData
  const color = REPO_COLORS[d.repo ?? ''] ?? '#71717a'

  return (
    <div
      style={{
        width: 140,
        padding: '6px 8px',
        background: '#0a0a0f',
        border: `1px solid ${color}55`,
        borderRadius: 3,
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        color: '#a1a1aa',
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: '#27272a', width: 4, height: 4, border: 'none' }}
      />
      <div style={{ fontSize: 9, fontWeight: 500, lineHeight: 1.3, color: '#d4d4d8' }}>
        {d.label.length > 22 ? d.label.slice(0, 20) + '…' : d.label}
      </div>
      {d.repo && (
        <div style={{ fontSize: 8, color, marginTop: 2, opacity: 0.7 }}>{d.repo}</div>
      )}
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: '#27272a', width: 4, height: 4, border: 'none' }}
      />
    </div>
  )
}

const nodeTypes = { community: CommunityNode, member: MemberNode }

// ─── Layout helpers ──────────────────────────────────────────────────────────

/** Simple force-like grid layout for community nodes */
function layoutCommunityNodes(communities: CommunityEntry[]): Node[] {
  const cols = Math.ceil(Math.sqrt(communities.length * 1.5))
  const cellW = 240
  const cellH = 130

  return communities.map((c, i) => ({
    id: `community-${c.id}`,
    type: 'community',
    position: {
      x: (i % cols) * cellW,
      y: Math.floor(i / cols) * cellH,
    },
    data: {
      kind: 'community',
      label: c.label,
      center_label: c.center_label,
      node_count: c.node_count,
      repos: c.repos,
      expanded: false,
      communityId: c.id,
    } satisfies CommunityNodeData,
    draggable: true,
  }))
}

/** Radial layout for member nodes around a community center */
function layoutMemberNodes(
  members: ExpandedNode[],
  communityId: number,
  centerX: number,
  centerY: number,
): Node[] {
  const radius = Math.max(200, Math.sqrt(members.length) * 35)
  return members.map((m, i) => {
    const angle = (i / members.length) * 2 * Math.PI - Math.PI / 2
    return {
      id: `member-${m.id}`,
      type: 'member',
      position: {
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
      },
      data: {
        kind: 'member',
        label: m.label,
        repo: m.repo,
        source_file: m.source_file,
        communityId,
      } satisfies MemberNodeData,
      draggable: true,
    }
  })
}

// ─── Search panel ─────────────────────────────────────────────────────────────

interface SearchPanelProps {
  onSearch: (q: string) => void
  results: SearchResult | null
  searching: boolean
}

function SearchPanel({ onSearch, results, searching }: SearchPanelProps) {
  const [q, setQ] = useState('')

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && q.trim()) {
      onSearch(q.trim())
    }
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        right: 16,
        zIndex: 10,
        width: 300,
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
      }}
    >
      <div
        style={{
          background: 'var(--theme-card, #111118)',
          border: '1px solid var(--theme-border, #27272a)',
          borderRadius: 8,
          padding: 12,
        }}
      >
        <div
          style={{
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: 1.2,
            color: 'var(--theme-muted, #71717a)',
            marginBottom: 8,
          }}
        >
          Graph Search
        </div>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search nodes… (Enter)"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            background: 'var(--theme-input, #0a0a0f)',
            border: '1px solid var(--theme-border, #3f3f46)',
            borderRadius: 4,
            padding: '6px 10px',
            fontSize: 12,
            color: 'var(--theme-text, #e4e4e7)',
            outline: 'none',
            fontFamily: 'inherit',
          }}
        />
        {searching && (
          <div style={{ fontSize: 10, color: 'var(--theme-muted, #71717a)', marginTop: 6 }}>
            Searching…
          </div>
        )}
        {results && !searching && (
          <div style={{ marginTop: 10, maxHeight: 280, overflowY: 'auto' }}>
            {results.ok ? (
              <>
                <div style={{ fontSize: 9, color: 'var(--theme-muted, #52525b)', marginBottom: 6 }}>
                  {results.elapsed_ms}ms
                </div>
                <pre
                  style={{
                    fontSize: 9,
                    color: 'var(--theme-text, #a1a1aa)',
                    background: 'var(--theme-bg, #060609)',
                    border: '1px solid var(--theme-border, #27272a)',
                    borderRadius: 4,
                    padding: 8,
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    maxHeight: 240,
                    overflowY: 'auto',
                  }}
                >
                  {JSON.stringify(results.result, null, 2)}
                </pre>
              </>
            ) : (
              <div style={{ fontSize: 10, color: '#fb7185', marginTop: 4 }}>
                {results.error ?? 'Search failed'}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Stats bar ───────────────────────────────────────────────────────────────

interface StatsBarProps {
  meta: GraphSummary['meta'] | null
  communityCount: number
  expandedCount: number
}

function StatsBar({ meta, communityCount, expandedCount }: StatsBarProps) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        left: 16,
        zIndex: 10,
        background: 'var(--theme-card, #111118)',
        border: '1px solid var(--theme-border, #27272a)',
        borderRadius: 8,
        padding: '10px 14px',
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        fontSize: 11,
        color: 'var(--theme-text, #a1a1aa)',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        minWidth: 200,
      }}
    >
      <div
        style={{
          fontSize: 9,
          textTransform: 'uppercase',
          letterSpacing: 1.2,
          color: 'var(--theme-muted, #71717a)',
          marginBottom: 2,
        }}
      >
        Cross-Host Graph
      </div>
      {meta && (
        <>
          <div>
            <span style={{ color: 'var(--theme-accent, #8b5cf6)' }}>
              {meta.total_nodes.toLocaleString()}
            </span>{' '}
            nodes
          </div>
          <div>
            <span style={{ color: 'var(--theme-accent, #8b5cf6)' }}>
              {meta.total_links.toLocaleString()}
            </span>{' '}
            edges
          </div>
          <div>
            <span style={{ color: 'var(--theme-accent, #8b5cf6)' }}>
              {meta.total_communities.toLocaleString()}
            </span>{' '}
            communities
          </div>
          <div style={{ borderTop: '1px solid var(--theme-border, #27272a)', paddingTop: 4, marginTop: 2 }}>
            showing{' '}
            <span style={{ color: '#22d3ee' }}>{communityCount}</span> communities
            {expandedCount > 0 && (
              <>, <span style={{ color: '#fbbf24' }}>{expandedCount}</span> expanded</>
            )}
          </div>
          <div style={{ fontSize: 9, color: 'var(--theme-muted, #52525b)' }}>
            {new Date(meta.generated_at).toLocaleString()}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

function GraphInner() {
  const [summary, setSummary] = useState<GraphSummary | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  // React Flow nodes + edges
  const [rfNodes, setRfNodes] = useState<Node[]>([])
  const [rfEdges, setRfEdges] = useState<Edge[]>([])

  // Expanded community set + loaded member nodes
  const [expandedCommunities, setExpandedCommunities] = useState<Set<number>>(new Set())
  const memberNodesByComm = useRef<Map<number, ExpandedNode[]>>(new Map())
  const loadingCommunities = useRef<Set<number>>(new Set())

  // Search
  const [searchResults, setSearchResults] = useState<SearchResult | null>(null)
  const [searching, setSearching] = useState(false)

  const { fitView, getNode } = useReactFlow()

  // Load summary on mount
  useEffect(() => {
    const t0 = performance.now()
    fetch('/graph-summary.json')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<GraphSummary>
      })
      .then((data) => {
        setSummary(data)
        const nodes = layoutCommunityNodes(data.communities)
        setRfNodes(nodes)

        // Cross-community edges (filter to top 300 by weight for initial render)
        const edgeLimit = 300
        const edges: Edge[] = data.cross_edges
          .slice(0, edgeLimit)
          .map((e) => ({
            id: `ce-${e.source}-${e.target}`,
            source: `community-${e.source}`,
            target: `community-${e.target}`,
            style: {
              stroke: '#27272a',
              strokeWidth: Math.min(3, Math.max(0.5, Math.log2(e.weight + 1) * 0.3)),
              opacity: 0.5,
            },
            animated: false,
          }))
        setRfEdges(edges)

        setTimeout(() => fitView({ padding: 0.1, duration: 600 }), 100)
        console.log(`[graph] summary loaded in ${(performance.now() - t0).toFixed(0)}ms`)
      })
      .catch((err) => {
        setLoadError(err instanceof Error ? err.message : String(err))
      })
  }, [fitView])

  // Rebuild React Flow nodes when expansion state changes
  const rebuildNodes = useCallback(
    (newExpanded: Set<number>, summaryData: GraphSummary) => {
      const communityFlowNodes: Node[] = layoutCommunityNodes(summaryData.communities).map(
        (n) => {
          const cid = (n.data as CommunityNodeData).communityId
          return {
            ...n,
            data: {
              ...n.data,
              expanded: newExpanded.has(cid),
            },
          }
        },
      )

      const memberFlowNodes: Node[] = []
      for (const [cid, members] of memberNodesByComm.current) {
        if (!newExpanded.has(cid)) continue
        const parentNode = communityFlowNodes.find(
          (n) => (n.data as CommunityNodeData).communityId === cid,
        )
        const cx = parentNode?.position.x ?? 0
        const cy = parentNode?.position.y ?? 0
        memberFlowNodes.push(...layoutMemberNodes(members, cid, cx, cy))
      }

      setRfNodes([...communityFlowNodes, ...memberFlowNodes])
    },
    [],
  )

  // Handle community node click → expand
  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const d = node.data as CommunityNodeData | MemberNodeData
      if (d.kind !== 'community') return

      const cid = d.communityId
      if (!summary) return

      if (expandedCommunities.has(cid)) {
        // Collapse
        const next = new Set(expandedCommunities)
        next.delete(cid)
        memberNodesByComm.current.delete(cid)
        setExpandedCommunities(next)
        rebuildNodes(next, summary)
        return
      }

      if (loadingCommunities.current.has(cid)) return
      loadingCommunities.current.add(cid)

      const t0 = performance.now()
      fetch(`/api/graph/community/${cid}`)
        .then((r) => r.json())
        .then((data: { nodes: ExpandedNode[]; meta?: { elapsed_ms?: number } }) => {
          loadingCommunities.current.delete(cid)
          console.log(
            `[graph] community ${cid} loaded ${data.nodes?.length} nodes in ${(performance.now() - t0).toFixed(0)}ms (server: ${data.meta?.elapsed_ms ?? '?'}ms)`,
          )
          memberNodesByComm.current.set(cid, data.nodes ?? [])
          setExpandedCommunities((prev) => {
            const next = new Set(prev)
            next.add(cid)
            rebuildNodes(next, summary)
            return next
          })
        })
        .catch((err) => {
          loadingCommunities.current.delete(cid)
          console.error('[graph] community load failed', cid, err)
        })
    },
    [summary, expandedCommunities, rebuildNodes],
  )

  // Search handler
  const handleSearch = useCallback(async (q: string) => {
    setSearching(true)
    setSearchResults(null)
    try {
      const r = await fetch('/api/graph/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q }),
      })
      const data: SearchResult = await r.json()
      setSearchResults(data)
    } catch (err) {
      setSearchResults({
        ok: false,
        query: q,
        elapsed_ms: 0,
        error: err instanceof Error ? err.message : 'Search failed',
      })
    } finally {
      setSearching(false)
    }
  }, [])

  if (loadError) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: '#fb7185',
          fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
          fontSize: 14,
        }}
      >
        Failed to load graph: {loadError}
      </div>
    )
  }

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <StatsBar
        meta={summary?.meta ?? null}
        communityCount={summary?.communities.length ?? 0}
        expandedCount={expandedCommunities.size}
      />

      <SearchPanel
        onSearch={handleSearch}
        results={searchResults}
        searching={searching}
      />

      {!summary && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            color: 'var(--theme-muted, #71717a)',
            fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
            fontSize: 13,
            zIndex: 10,
          }}
        >
          Loading graph…
        </div>
      )}

      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        fitView
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        panOnScroll={false}
        zoomOnScroll
        style={{ background: '#060609' }}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={0.8}
          color="#1a1a1f"
        />
        <Controls
          style={{
            bottom: 16,
            right: 16,
            left: 'auto',
            top: 'auto',
            background: '#111118',
            border: '1px solid #27272a',
          }}
        />
        <MiniMap
          style={{
            background: '#0a0a0f',
            border: '1px solid #27272a',
          }}
          nodeColor={(n) => {
            const d = n.data as CommunityNodeData | MemberNodeData
            if (d.kind === 'community') {
              return getRepoColor((d as CommunityNodeData).repos)
            }
            return '#3f3f46'
          }}
        />
      </ReactFlow>
    </div>
  )
}

export default function GraphScreen() {
  return (
    <div style={{ width: '100%', height: 'calc(100vh - 56px)' }}>
      <ReactFlowProvider>
        <GraphInner />
      </ReactFlowProvider>
    </div>
  )
}
