/**
 * TopologyHome — /flow factory-floor topology view.
 *
 * Day 1: static skeleton from /flow-graph.json (Graphify curator).
 * Day 2: live overlay
 *   - real path: /api/flow/events?stream=1 (SSE from hermes_findings)
 *   - demo path: ?demo=1 fires a scripted local sequence (no S2 dep)
 *
 * Design constraints (S3 brief):
 *  - Plain rectangles, thin borders, Inter font.
 *  - Cyan = active; red = failed. ≤10% color real-estate.
 *  - No glow, no glassmorphism, no smoothstep edges.
 *  - Pan + zoom + minimap. Not editable.
 */

import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Edge,
  type Node,
  Position,
  Handle,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

type CuratedNode = {
  id: string
  label: string
  type: 'app' | 'hermes' | 'profile' | 'mcp' | 'pipeline' | 'script' | 'api'
  file_count: number
  x: number
  y: number
}
type CuratedEdge = {
  id: string
  source: string
  target: string
  weight: number
}
type CuratedGraph = {
  generated_at: string
  source: string
  nodes: CuratedNode[]
  edges: CuratedEdge[]
  stats: { nodes: number; edges: number; by_type: Record<string, number> }
}

type FindingEvent = {
  id: number
  ts: string
  source: string
  kind?: string
  status?: string
  label?: string
  mcp_server?: string | null
  tool_name?: string | null
}

const TYPE_STYLES: Record<
  CuratedNode['type'],
  { border: string; bg: string; label: string }
> = {
  app:      { border: '#a3a3a3', bg: '#1a1a1f', label: 'app' },
  hermes:   { border: '#fbbf24', bg: '#1f1a0a', label: 'hermes' },
  profile:  { border: '#a5b4fc', bg: '#15151f', label: 'profile' },
  mcp:      { border: '#86efac', bg: '#0f1a14', label: 'mcp' },
  pipeline: { border: '#c4b5fd', bg: '#16121f', label: 'pipeline' },
  script:   { border: '#fda4af', bg: '#1f1216', label: 'script' },
  api:      { border: '#52525b', bg: '#111114', label: 'api' },
}

const TYPE_WIDTH: Record<CuratedNode['type'], number> = {
  app: 180, hermes: 170, profile: 160, mcp: 160, pipeline: 160, script: 160, api: 140,
}

type ActiveState = 'idle' | 'active' | 'failed'

type TopologyNodeData = {
  label: string
  nodeType: CuratedNode['type']
  fileCount: number
  state: ActiveState
  lastDetail?: string
}

function TopologyNode({ data }: NodeProps) {
  const d = data as TopologyNodeData
  const s = TYPE_STYLES[d.nodeType]
  const w = TYPE_WIDTH[d.nodeType]
  let borderColor = s.border
  let bg = s.bg
  let opacity = 1
  if (d.state === 'active') borderColor = '#22d3ee'
  else if (d.state === 'failed') { borderColor = '#fb7185'; bg = '#1f0a0e' }
  else opacity = 0.65
  return (
    <div
      style={{
        width: w,
        padding: '8px 10px',
        background: bg,
        border: `${d.state === 'idle' ? 1 : 1.5}px solid ${borderColor}`,
        borderRadius: 4,
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        color: '#e4e4e7',
        opacity,
        transition: 'border-color 0.3s ease, opacity 0.3s ease, background 0.3s ease',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: '#3f3f46', width: 6, height: 6, border: 'none' }} />
      <div style={{ fontSize: 11, fontWeight: 500, lineHeight: 1.2 }}>{d.label}</div>
      <div style={{ fontSize: 9, color: s.border, marginTop: 2, opacity: 0.8 }}>{s.label}</div>
      {d.state !== 'idle' && d.lastDetail && (
        <div style={{ fontSize: 9, color: d.state === 'failed' ? '#fda4af' : '#67e8f9', marginTop: 3 }}>
          {d.lastDetail}
        </div>
      )}
      <Handle type="source" position={Position.Right} style={{ background: '#3f3f46', width: 6, height: 6, border: 'none' }} />
    </div>
  )
}

const nodeTypes = { topology: TopologyNode }

function Legend({ source }: { source: 'sse' | 'demo' | 'idle' }) {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 16,
        left: 16,
        zIndex: 5,
        background: '#0a0a0f',
        border: '1px solid #27272a',
        borderRadius: 6,
        padding: '10px 12px',
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        fontSize: 11,
        color: '#a1a1aa',
      }}
    >
      <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1.5, color: '#71717a', marginBottom: 6 }}>
        legend
      </div>
      {(Object.entries(TYPE_STYLES) as [CuratedNode['type'], typeof TYPE_STYLES['app']][]).map(([k, s]) => (
        <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{ display: 'inline-block', width: 10, height: 10, border: `1px solid ${s.border}`, background: s.bg }} />
          <span>{s.label}</span>
        </div>
      ))}
      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #27272a', fontSize: 9, color: '#52525b' }}>
        <div><span style={{ color: '#22d3ee' }}>cyan</span> = active &nbsp; <span style={{ color: '#fb7185' }}>red</span> = failed</div>
        <div style={{ marginTop: 3 }}>overlay: {source}</div>
      </div>
    </div>
  )
}

// Match an event to a topology node id. Fallback to first node whose label
// substring-matches event source. NOT tool-span granular — degraded view
// pending S2's hermes_findings schema delta (mcp_server + tool_name cols).
function matchNode(ev: FindingEvent, nodes: CuratedNode[]): string | null {
  if (ev.mcp_server) {
    const n = nodes.find((n) => n.id === `mcp:${ev.mcp_server}` || n.label === ev.mcp_server)
    if (n) return n.id
  }
  if (ev.tool_name) {
    const n = nodes.find((n) => n.label.toLowerCase().includes(ev.tool_name!.toLowerCase()))
    if (n) return n.id
  }
  const src = (ev.source || '').toLowerCase()
  // hand-tuned source-prefix matches for the events we actually see today
  const hardMap: [string, string][] = [
    ['etl.hermes-history', 'hermes:agentic'],
    ['infra.log.error', 'hermes:agentic'],
    ['infra.service.down', 'hermes:agentic'],
    ['embedding', 'script:embeddings-outbox-drainer'],
    ['meeting', 'script:meeting-ingest'],
    ['kanban', 'mcp:kanban-mcp'],
    ['mally', 'profile:mally'],
    ['chief-of-staff', 'profile:hermes-chief-of-staff'],
    ['ares', 'profile:ares'],
    ['jiddlers', 'profile:jiddlers'],
    ['vectos', 'app:vectos'],
  ]
  for (const [needle, id] of hardMap) {
    if (src.includes(needle) && nodes.some((n) => n.id === id)) return id
  }
  // fallback: label substring
  const fallback = nodes.find((n) => src.includes(n.label.toLowerCase()))
  return fallback?.id ?? null
}

export default function TopologyHome() {
  const [graph, setGraph] = useState<CuratedGraph | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  // Map nodeId → { state, lastTs, lastDetail }
  const [activity, setActivity] = useState<Map<string, { state: ActiveState; lastTs: number; lastDetail: string }>>(new Map())
  const [overlaySrc, setOverlaySrc] = useState<'sse' | 'demo' | 'idle'>('idle')
  const [tick, setTick] = useState(0)
  const activityRef = useRef(activity)
  activityRef.current = activity

  // Demo modes:
  //  ?demo=1   → scripted setInterval sequence (most realistic)
  //  ?demo=live → static snapshot: 5 active + 0 failed (Day-2 screenshot)
  //  ?demo=fail → static snapshot: 3 active + 2 failed (Day-3 screenshot)
  const demoParam = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('demo') : null
  const demoMode = demoParam === '1'
  const demoStatic = demoParam === 'live' || demoParam === 'fail' ? demoParam : null

  useEffect(() => {
    let alive = true
    fetch('/flow-graph.json', { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((g: CuratedGraph) => { if (alive) setGraph(g) })
      .catch((e) => { if (alive) setLoadErr(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [])

  // Apply a finding event to activity state
  const apply = useCallback((ev: FindingEvent, nodes: CuratedNode[]) => {
    const id = matchNode(ev, nodes)
    if (!id) return
    const state: ActiveState = ev.status === 'error' || ev.status === 'failed' ? 'failed' : 'active'
    const detail =
      ev.tool_name ? `${ev.tool_name} · ${ev.status ?? ''}`.trim()
      : ev.label ?? ev.source
    setActivity((prev) => {
      const next = new Map(prev)
      next.set(id, { state, lastTs: Date.now(), lastDetail: detail.slice(0, 40) })
      return next
    })
  }, [])

  // Ticker — every 1.5s, decay any node whose lastTs is > 5s old to idle.
  // Failed state is sticky (persists until next event on same node).
  // Skipped in demoStatic modes (states are pre-seeded to remain visible).
  useEffect(() => {
    if (demoStatic) return
    const t = setInterval(() => {
      const now = Date.now()
      setActivity((prev) => {
        let changed = false
        const next = new Map(prev)
        for (const [id, v] of prev) {
          if (v.state === 'active' && now - v.lastTs > 5000) {
            next.delete(id); changed = true
          }
        }
        return changed ? next : prev
      })
      setTick((x) => x + 1)
    }, 1500)
    return () => clearInterval(t)
  }, [])

  // Static demo snapshots — render-once, deterministic for screenshots.
  useEffect(() => {
    if (!graph || !demoStatic) return
    setOverlaySrc('demo')
    const liveSeed: Array<[string, ActiveState, string]> = [
      ['script:meeting-ingest',           'active', 'fetching granola · running'],
      ['profile:hermes-chief-of-staff',   'active', 'dispatching mally · running'],
      ['profile:mally',                   'active', 'classify candidate · running'],
      ['mcp:kanban-mcp',                  'active', 'enqueue M3-7 · ok'],
      ['script:embeddings-outbox-drainer','active', 'flush outbox (12 rows) · ok'],
      ['app:vectos',                      'active', 'workflows/triage-classify · ok'],
    ]
    const failSeed: Array<[string, ActiveState, string]> = [
      ['script:meeting-ingest',           'active', 'fetching granola · running'],
      ['profile:hermes-chief-of-staff',   'active', 'dispatching · running'],
      ['mcp:kanban-mcp',                  'active', 'enqueue M3-7 · ok'],
      ['hermes:agentic',                  'failed', 'voice-fanout-router 404 · error'],
      ['profile:mally',                   'failed', 'mally tenant leak · error'],
    ]
    const seed = demoStatic === 'fail' ? failSeed : liveSeed
    const now = Date.now()
    const m = new Map<string, { state: ActiveState; lastTs: number; lastDetail: string }>()
    for (const [id, state, detail] of seed) {
      if (graph.nodes.some((n) => n.id === id)) m.set(id, { state, lastTs: now, lastDetail: detail })
    }
    setActivity(m)
  }, [graph, demoStatic])

  // SSE (real) or scripted demo overlay
  useEffect(() => {
    if (!graph || demoStatic) return
    if (demoMode) {
      setOverlaySrc('demo')
      const seq: FindingEvent[] = [
        { id: 1, ts: '', source: 'meeting-ingest.fetch', label: 'fetching granola meeting', status: 'running' },
        { id: 2, ts: '', source: 'mally.warroom', label: 'classify candidate', status: 'running' },
        { id: 3, ts: '', source: 'kanban.create', label: 'enqueued M3-7', status: 'ok' },
        { id: 4, ts: '', source: 'hermes-chief-of-staff', label: 'dispatching mally', status: 'running' },
        { id: 5, ts: '', source: 'embedding-drainer', label: 'flush outbox (12 rows)', status: 'ok' },
        { id: 6, ts: '', source: 'infra.service.down', label: 'voice-fanout-router 404', status: 'error' },
        { id: 7, ts: '', source: 'vectos.api', label: 'workflows/triage-classify', status: 'ok' },
      ]
      let i = 0
      const iv = setInterval(() => {
        apply(seq[i % seq.length], graph.nodes)
        i++
      }, 1200)
      return () => clearInterval(iv)
    }
    setOverlaySrc('sse')
    let es: EventSource | null = null
    let pollId: ReturnType<typeof setInterval> | null = null
    const startPoll = () => {
      if (pollId) return
      pollId = setInterval(async () => {
        try {
          const r = await fetch('/api/flow/events?limit=30', { cache: 'no-store' })
          if (!r.ok) return
          const data = await r.json()
          const arr: FindingEvent[] = (data.events ?? []).slice(-10)
          for (const e of arr) apply(e, graph.nodes)
        } catch { /* swallow */ }
      }, 8000)
    }
    try {
      es = new EventSource('/api/flow/events?stream=1')
      es.addEventListener('snapshot', (ev) => {
        try {
          const d = JSON.parse((ev as MessageEvent).data)
          const arr: FindingEvent[] = (d.events ?? []).slice(-5)
          for (const e of arr) apply(e, graph.nodes)
        } catch { /* ignore */ }
      })
      es.addEventListener('nostream', () => {
        es?.close(); es = null; startPoll()
      })
      es.onmessage = (ev) => {
        try {
          const d = JSON.parse(ev.data)
          const arr: FindingEvent[] = d.events ?? []
          for (const e of arr) apply(e, graph.nodes)
        } catch { /* heartbeat */ }
      }
      es.onerror = () => { es?.close(); es = null; startPoll() }
    } catch { startPoll() }
    return () => {
      if (es) es.close()
      if (pollId) clearInterval(pollId)
    }
  }, [graph, demoMode, apply])

  const { nodes, edges, activeCount, failedCount } = useMemo(() => {
    if (!graph) return { nodes: [] as Node[], edges: [] as Edge[], activeCount: 0, failedCount: 0 }
    let active = 0, failed = 0
    const ns: Node[] = graph.nodes.map((n) => {
      const a = activity.get(n.id)
      const state: ActiveState = a?.state ?? 'idle'
      if (state === 'active') active++
      if (state === 'failed') failed++
      return {
        id: n.id,
        type: 'topology',
        position: { x: n.x, y: n.y },
        data: {
          label: n.label,
          nodeType: n.type,
          fileCount: n.file_count,
          state,
          lastDetail: a?.lastDetail,
        } satisfies TopologyNodeData,
        draggable: false,
        selectable: false,
      }
    })
    const es: Edge[] = graph.edges.map((e) => {
      const sActive = activity.get(e.source)?.state
      const tActive = activity.get(e.target)?.state
      const isLit = (sActive === 'active' || sActive === 'failed') && (tActive === 'active' || tActive === 'failed')
      const isFailed = sActive === 'failed' || tActive === 'failed'
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'default',
        animated: isLit,
        style: {
          stroke: isFailed ? '#fb7185' : isLit ? '#22d3ee' : '#3f3f46',
          strokeWidth: isLit ? 1.8 : Math.min(2, 0.6 + Math.log10(e.weight + 1)),
          opacity: isLit ? 1 : 0.55,
        },
      }
    })
    return { nodes: ns, edges: es, activeCount: active, failedCount: failed }
  }, [graph, activity, tick])

  return (
    <div
      style={{
        height: '100vh',
        width: '100%',
        background: '#0a0a0f',
        color: '#e4e4e7',
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 16,
          right: 16,
          zIndex: 5,
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 2, color: '#52525b' }}>
            factory floor · live topology{demoMode ? ' · demo mode' : ''}
          </div>
          <h1 style={{ fontSize: 18, fontWeight: 600, color: '#fafafa', margin: '2px 0 0 0' }}>
            What the system is
          </h1>
        </div>
        <div style={{ fontSize: 11, color: '#71717a', textAlign: 'right' }}>
          {graph
            ? `${graph.stats.nodes} units · ${graph.stats.edges} edges · `
              + `${activeCount} active · ${failedCount} failed`
            : loadErr
              ? `load error: ${loadErr}`
              : 'loading topology…'}
          <div style={{ fontSize: 9, color: '#3f3f46', marginTop: 2 }}>
            spine view: <code style={{ color: '#52525b' }}>/flow/loop</code>
            {!demoMode && ' · '}{!demoMode && <a href="?demo=1" style={{ color: '#52525b' }}>?demo=1</a>}
          </div>
        </div>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.2}
        maxZoom={1.8}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#1c1c20" gap={28} />
        <Controls showInteractive={false} style={{ background: '#0a0a0f', border: '1px solid #27272a', borderRadius: 4, color: '#a1a1aa' }} />
        <MiniMap
          pannable zoomable
          maskColor="rgba(10,10,15,.7)"
          nodeColor={(n) => {
            const d = n.data as TopologyNodeData | undefined
            if (d?.state === 'active') return '#22d3ee'
            if (d?.state === 'failed') return '#fb7185'
            return d ? TYPE_STYLES[d.nodeType].border : '#3f3f46'
          }}
          nodeStrokeWidth={0}
          style={{ background: '#0a0a0f', border: '1px solid #27272a', borderRadius: 4 }}
        />
      </ReactFlow>
      <Legend source={overlaySrc} />
    </div>
  )
}
