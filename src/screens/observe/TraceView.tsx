/**
 * TraceView — two-pane intent trace browser.
 *
 * Left: list of recent intents (last 15 min), polled every 5s.
 * Right: selected intent's span tree, rendered recursively.
 * Click a span node → Langfuse iframe side-panel.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AgentEvent {
  intent_id: string
  span_id: string
  parent_span_id: string | null
  ts: string // ISO-8601 or epoch ms string
  source_app: string
  kind: 'model_call' | 'mcp_call' | 'tool_call' | 'handoff'
  label: string
  mcp_server?: string
  tool_name?: string
  model_req?: string
  model_used?: string
  provider?: string
  input_tokens?: number
  output_tokens?: number
  cost_usd?: number
  status: 'ok' | 'error'
  error_message?: string
}

export interface TreeNode extends AgentEvent {
  children: TreeNode[]
}

interface IntentSummary {
  intent_id: string
  earliest_ts: number
  span_count: number
  total_cost: number
}

interface SpansResponse {
  spans: AgentEvent[]
  count: number
  source: string
}

interface IntentResponse {
  intent_id: string
  root_span: TreeNode
  span_count: number
  total_duration_ms: number
  total_cost_usd: number
  source: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

function timeAgo(ts: number): string {
  const diffMs = ts - Date.now()
  const diffSec = Math.round(diffMs / 1000)
  if (Math.abs(diffSec) < 60) return rtf.format(diffSec, 'second')
  const diffMin = Math.round(diffSec / 60)
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, 'minute')
  const diffHr = Math.round(diffMin / 60)
  return rtf.format(diffHr, 'hour')
}

function parseTs(ts: string): number {
  const n = Number(ts)
  if (!isNaN(n)) return n
  return new Date(ts).getTime()
}

function shortId(id: string): string {
  return id.length > 12 ? id.slice(0, 8) + '…' : id
}

function formatCost(usd?: number): string {
  if (!usd) return '—'
  if (usd < 0.01) return `$${(usd * 100).toFixed(3)}¢`
  return `$${usd.toFixed(4)}`
}

function formatDurationMs(ms?: number): string {
  if (!ms) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

const KIND_ICON: Record<AgentEvent['kind'], string> = {
  model_call: '🧠',
  mcp_call:   '🔌',
  tool_call:  '🛠',
  handoff:    '🤝',
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div className="px-3 py-2.5 flex flex-col gap-1 border-b border-border/40 animate-pulse">
      <div className="h-3 w-28 rounded bg-muted" />
      <div className="h-2.5 w-16 rounded bg-muted/60" />
    </div>
  )
}

function SkeletonTree() {
  return (
    <div className="p-4 flex flex-col gap-2 animate-pulse">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-2" style={{ paddingLeft: `${i * 16}px` }}>
          <div className="h-3 w-4 rounded bg-muted" />
          <div className="h-3 rounded bg-muted" style={{ width: `${120 - i * 20}px` }} />
        </div>
      ))}
      <p className="mt-4 text-xs text-muted-foreground text-center">Loading trace…</p>
    </div>
  )
}

// ── Intent List ───────────────────────────────────────────────────────────────

interface IntentRowProps {
  intent: IntentSummary
  selected: boolean
  onClick: () => void
}

function IntentRow({ intent, selected, onClick }: IntentRowProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left px-3 py-2.5 border-b border-border/40 transition-colors hover:bg-muted/40',
        selected && 'bg-primary/10 border-l-2 border-l-primary',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-semibold text-foreground truncate">
          {shortId(intent.intent_id)}
        </span>
        <span className="text-[10px] text-muted-foreground shrink-0">
          {formatCost(intent.total_cost)}
        </span>
      </div>
      <div className="flex items-center gap-2 mt-0.5">
        <span className="text-[10px] text-muted-foreground">
          {timeAgo(intent.earliest_ts)}
        </span>
        <span className="text-[10px] text-muted-foreground">·</span>
        <span className="text-[10px] text-muted-foreground">
          {intent.span_count} span{intent.span_count !== 1 ? 's' : ''}
        </span>
      </div>
    </button>
  )
}

// ── Span Tree Node ────────────────────────────────────────────────────────────

interface SpanNodeProps {
  node: TreeNode
  depth: number
  onClickNode: (node: TreeNode) => void
}

function SpanNode({ node, depth, onClickNode }: SpanNodeProps) {
  const [collapsed, setCollapsed] = useState(false)
  const hasChildren = node.children.length > 0

  const isError = node.status === 'error'
  const icon = KIND_ICON[node.kind] ?? '◉'
  const ts = new Date(parseTs(node.ts)).toLocaleTimeString()

  return (
    <div>
      <button
        onClick={() => onClickNode(node)}
        className={cn(
          'group w-full flex items-center gap-2 text-left py-1.5 pr-3 rounded transition-colors hover:bg-muted/40 text-xs',
          isError && 'border border-red-500/50 bg-red-500/5',
        )}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        title={isError ? (node.error_message ?? 'Error') : node.label}
      >
        {/* Collapse toggle */}
        {hasChildren ? (
          <span
            role="img"
            aria-label="toggle"
            className="shrink-0 text-muted-foreground w-3 text-center cursor-pointer hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation()
              setCollapsed((c) => !c)
            }}
          >
            {collapsed ? '▶' : '▼'}
          </span>
        ) : (
          <span className="shrink-0 w-3" />
        )}

        {/* Kind icon */}
        <span className="shrink-0">{icon}</span>

        {/* Label */}
        <span className="font-medium text-foreground truncate flex-1">
          {node.label}
        </span>

        {/* Source app badge */}
        <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] bg-muted text-muted-foreground border border-border">
          {node.source_app}
        </span>

        {/* Tool/server hint */}
        {(node.tool_name || node.mcp_server) && (
          <span className="shrink-0 font-mono rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground">
            {node.tool_name ?? node.mcp_server}
          </span>
        )}

        {/* Timestamp */}
        <span className="shrink-0 font-mono text-[9px] text-muted-foreground w-16 text-right">
          {ts}
        </span>

        {/* Cost */}
        <span className="shrink-0 font-mono text-[9px] text-muted-foreground w-12 text-right">
          {formatCost(node.cost_usd)}
        </span>

        {/* Error indicator */}
        {isError && (
          <span className="shrink-0 text-red-400 text-[10px] font-bold">ERR</span>
        )}
      </button>

      {!collapsed && hasChildren && (
        <div>
          {node.children.map((child) => (
            <SpanNode
              key={child.span_id}
              node={child}
              depth={depth + 1}
              onClickNode={onClickNode}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Langfuse Side-Panel ───────────────────────────────────────────────────────

function LangfusePanel({
  intentId,
  onClose,
}: {
  intentId: string
  onClose: () => void
}) {
  const url = `https://langfuse.berl.ai/traces?q=${encodeURIComponent(intentId)}`

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex flex-col w-full max-w-2xl h-full bg-background border-l border-border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3 shrink-0">
          <span className="text-sm font-semibold">Langfuse trace</span>
          <span className="font-mono text-xs text-muted-foreground truncate flex-1">
            {shortId(intentId)}
          </span>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline shrink-0"
          >
            open ↗
          </a>
          <button
            onClick={onClose}
            className="ml-2 text-muted-foreground hover:text-foreground shrink-0"
          >
            ✕
          </button>
        </div>

        {/* iframe */}
        <iframe
          src={url}
          className="flex-1 w-full border-0"
          title={`Langfuse trace: ${intentId}`}
          sandbox="allow-scripts allow-same-origin allow-forms"
        />
      </div>
    </div>
  )
}

// ── TraceView ─────────────────────────────────────────────────────────────────

export default function TraceView() {
  // ── Intent list state
  const [intents, setIntents]               = useState<IntentSummary[]>([])
  const [spansLoading, setSpansLoading]     = useState(true)
  const [spansError, setSpansError]         = useState<string | null>(null)

  // ── Selected intent + trace
  const [selectedId, setSelectedId]         = useState<string | null>(null)
  const [traceData, setTraceData]           = useState<IntentResponse | null>(null)
  const [traceLoading, setTraceLoading]     = useState(false)
  const [traceError, setTraceError]         = useState<string | null>(null)

  // ── Langfuse panel
  const [langfuseIntentId, setLangfuseIntentId] = useState<string | null>(null)

  // ── Poll /api/observe/spans every 5s
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchSpans = useCallback(() => {
    const ctrl = new AbortController()

    fetch('/api/observe/spans?since=15m', { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<SpansResponse>
      })
      .then((data) => {
        // Group by intent_id
        const byIntent = new Map<string, IntentSummary>()
        for (const span of data.spans) {
          const tsMs = parseTs(span.ts)
          const existing = byIntent.get(span.intent_id)
          if (!existing) {
            byIntent.set(span.intent_id, {
              intent_id:   span.intent_id,
              earliest_ts: tsMs,
              span_count:  1,
              total_cost:  span.cost_usd ?? 0,
            })
          } else {
            existing.span_count  += 1
            existing.total_cost  += span.cost_usd ?? 0
            if (tsMs < existing.earliest_ts) existing.earliest_ts = tsMs
          }
        }
        // Sort DESC by earliest_ts
        const sorted = [...byIntent.values()].sort((a, b) => b.earliest_ts - a.earliest_ts)
        setIntents(sorted)
        setSpansLoading(false)
        setSpansError(null)
      })
      .catch((err) => {
        if ((err as Error).name === 'AbortError') return
        setSpansError(String(err))
        setSpansLoading(false)
      })

    return ctrl
  }, [])

  useEffect(() => {
    const ctrl = fetchSpans()
    pollRef.current = setInterval(() => fetchSpans(), 5000)
    return () => {
      ctrl.abort()
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [fetchSpans])

  // ── Fetch trace when intent selected
  useEffect(() => {
    if (!selectedId) return
    setTraceLoading(true)
    setTraceError(null)
    setTraceData(null)

    const ctrl = new AbortController()

    fetch(`/api/observe/intent/${encodeURIComponent(selectedId)}`, { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<IntentResponse>
      })
      .then((data) => {
        setTraceData(data)
        setTraceLoading(false)
      })
      .catch((err) => {
        if ((err as Error).name === 'AbortError') return
        setTraceError(String(err))
        setTraceLoading(false)
      })

    return () => ctrl.abort()
  }, [selectedId])

  // ── Node click → Langfuse panel
  const handleNodeClick = useCallback((node: TreeNode) => {
    setLangfuseIntentId(node.intent_id)
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left pane: INTENTS ── */}
      <div className="w-64 shrink-0 flex flex-col border-r border-border overflow-hidden">
        {/* Pane header */}
        <div className="px-3 py-2.5 border-b border-border shrink-0 flex items-center gap-2">
          <span className="text-xs font-semibold text-foreground uppercase tracking-wide">
            Intents
          </span>
          <span className="text-[10px] text-muted-foreground">last 15 min</span>
          {spansLoading && (
            <span className="ml-auto h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
          )}
          {spansError && (
            <span
              className="ml-auto text-[10px] text-red-400"
              title={spansError}
            >
              ⚠ err
            </span>
          )}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {spansLoading ? (
            <>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </>
          ) : intents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 gap-2 text-muted-foreground">
              <span className="text-3xl">🔍</span>
              <p className="text-xs text-center">
                No intents in the last 15 minutes.
                <br />
                Events will appear as agents run.
              </p>
            </div>
          ) : (
            intents.map((intent) => (
              <IntentRow
                key={intent.intent_id}
                intent={intent}
                selected={selectedId === intent.intent_id}
                onClick={() => setSelectedId(intent.intent_id)}
              />
            ))
          )}
        </div>
      </div>

      {/* ── Right pane: TRACE ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Pane header */}
        <div className="px-4 py-2.5 border-b border-border shrink-0 flex items-center gap-3">
          <span className="text-xs font-semibold text-foreground uppercase tracking-wide">
            Trace
          </span>
          {selectedId && (
            <span className="font-mono text-xs text-muted-foreground">
              {shortId(selectedId)}
            </span>
          )}
          {traceData && (
            <>
              <span className="text-[10px] text-muted-foreground">
                {traceData.span_count} spans
              </span>
              <span className="text-[10px] text-muted-foreground">·</span>
              <span className="text-[10px] text-muted-foreground">
                {formatDurationMs(traceData.total_duration_ms)}
              </span>
              <span className="text-[10px] text-muted-foreground">·</span>
              <span className="text-[10px] text-muted-foreground">
                {formatCost(traceData.total_cost_usd)}
              </span>
              {traceData.source === 'fixture' && (
                <span className="ml-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-amber-400/20 text-amber-300 border border-amber-400/40">
                  FIXTURE DATA
                </span>
              )}
            </>
          )}

          {/* Column headers */}
          {traceData && (
            <div className="ml-auto flex items-center gap-3 text-[9px] text-muted-foreground font-mono uppercase">
              <span className="w-16 text-right">time</span>
              <span className="w-12 text-right">cost</span>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {!selectedId ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
              <span className="text-4xl">🧵</span>
              <p className="text-sm font-semibold">Select an intent</p>
              <p className="text-xs opacity-60 text-center max-w-xs">
                Pick an intent from the left to inspect its full span tree — model calls, MCP
                calls, tool calls, and sub-agent handoffs.
              </p>
            </div>
          ) : traceLoading ? (
            <SkeletonTree />
          ) : traceError ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <span className="text-3xl">⚠️</span>
              <p className="text-sm font-semibold text-foreground">Failed to load trace</p>
              <p className="text-xs text-red-400 font-mono max-w-sm text-center">{traceError}</p>
              <button
                onClick={() => setSelectedId((id) => id)}
                className="mt-1 rounded border border-border px-3 py-1 text-xs hover:bg-muted"
              >
                retry
              </button>
            </div>
          ) : traceData ? (
            <div className="p-2">
              <SpanNode
                node={traceData.root_span}
                depth={0}
                onClickNode={handleNodeClick}
              />
            </div>
          ) : null}
        </div>
      </div>

      {/* ── Langfuse side-panel ── */}
      {langfuseIntentId && (
        <LangfusePanel
          intentId={langfuseIntentId}
          onClose={() => setLangfuseIntentId(null)}
        />
      )}
    </div>
  )
}
