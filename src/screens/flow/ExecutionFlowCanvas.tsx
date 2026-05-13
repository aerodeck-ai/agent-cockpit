/**
 * ExecutionFlowCanvas — 7-stage God Mode loop map (ReactFlow).
 * Ported from ~/atc/components/ExecutionFlowCanvas.tsx
 * Adapted for TanStack Start / cockpit conventions (no 'use client').
 */

import { useEffect, useMemo, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Edge,
  type Node,
  Position,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

export type TraceEvent = {
  id: number
  trace_id: string
  ts: string
  source: string
  kind: string
  status: string
  label: string
  detail?: string | null
  model_req?: string | null
  model_used?: string | null
  provider?: string | null
  input_tokens?: number | null
  output_tokens?: number | null
  cost_usd?: number | null
  pane_id?: number | null
  mcp_server?: string | null
  tool_name?: string | null
}

type Pane = {
  session: string
  window: number
  index: number
  paneId: string
  pid: number
  active: boolean
  title: string
  command: string
  path: string
  role: string
  status: string
}
type Snapshot = {
  ok: boolean
  source: string
  capturedAt?: string
  panes: Pane[]
  error?: string
}

type Stage = {
  id: string
  lane: 'control' | 'context' | 'work'
  label: string
  research: string
  empty: string
  match: (e: TraceEvent) => boolean
}

const STAGES: Stage[] = [
  {
    id: 'intake',
    lane: 'control',
    label: '1. Intake',
    research:
      'Claude Code/Hermes pattern: keep the human in the existing entrypoint, do not force a new IDE.',
    empty: 'Telegram, ATC, API, cron or webhook creates a turn.',
    match: (e) =>
      e.kind === 'message' ||
      ['telegram', 'atc', 'api', 'cron', 'webhook'].includes(e.source),
  },
  {
    id: 'policy',
    lane: 'context',
    label: '2. Scope, memory, approvals',
    research:
      'LangSmith/Weave pattern: provenance and guardrails are first-class trace state, not copy.',
    empty: 'Scope boundary, memory load, approval gate and redaction status.',
    match: (e) =>
      ['policy', 'memory', 'approval', 'redaction', 'route_decision'].includes(
        e.kind,
      ) || e.source.includes('memory'),
  },
  {
    id: 'plan',
    lane: 'control',
    label: '3. Plan / route decision',
    research:
      'LangGraph Studio pattern: graph state should show why the next node ran.',
    empty:
      'Hermes decides: answer directly, call tools, delegate, schedule, or use pane.',
    match: (e) =>
      ['route_decision', 'plan', 'todo', 'delegate'].includes(e.kind) ||
      e.source === 'hermes',
  },
  {
    id: 'dispatch',
    lane: 'work',
    label: '4. Dispatch worker',
    research:
      'Claude Code async-agent pattern: workers are parallel actors, but only when explicitly claimed.',
    empty:
      'Foreground Hermes, cron worker, Claude pane, MCP server or background process.',
    match: (e) =>
      ['worker', 'terminal', 'process', 'background'].includes(e.kind) ||
      ['tmux', 'ssh-mac', 'terminal'].includes(e.source),
  },
  {
    id: 'tooling',
    lane: 'work',
    label: '5. Tool / model spans',
    research:
      'Agent observability pattern: tool calls, model fuel and latency belong in the same trace.',
    empty:
      'MCP/tool calls, model calls, browser checks, file writes and token updates.',
    match: (e) =>
      ['tool_call', 'model_call', 'token_update'].includes(e.kind) ||
      ['mcp', 'litellm', 'harness', 'browser', 'file'].includes(e.source),
  },
  {
    id: 'verify',
    lane: 'control',
    label: '6. Verify',
    research:
      'Production-agent pattern: traces are evidence; the UI must separate claim from verification.',
    empty:
      'Build/test/visual/API check, error, blocked state or final proof.',
    match: (e) =>
      ['verify', 'test', 'build', 'error'].includes(e.kind) ||
      ['next-build', 'vision', 'playwright'].includes(e.source) ||
      e.status === 'error',
  },
  {
    id: 'deliver',
    lane: 'control',
    label: '7. Deliver / journal',
    research:
      'God Mode pattern: the loop ends by updating the human and durable state.',
    empty: 'Telegram reply, ATC result, journal, queue update or handoff.',
    match: (e) =>
      ['result', 'delivery', 'journal'].includes(e.kind) ||
      ['telegram-send', 'send_message'].includes(e.source),
  },
]

function latest(
  events: TraceEvent[],
  predicate: (e: TraceEvent) => boolean,
): TraceEvent | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1)
    if (predicate(events[i])) return events[i]
  return undefined
}

function stageEvent(
  stage: Stage,
  events: TraceEvent[],
): TraceEvent | undefined {
  if (stage.id === 'policy') {
    return (
      latest(events, (e) =>
        ['policy', 'memory', 'approval', 'redaction'].includes(e.kind),
      ) ?? latest(events, stage.match)
    )
  }
  if (stage.id === 'plan')
    return (
      latest(events, (e) =>
        ['route_decision', 'plan', 'todo', 'delegate'].includes(e.kind),
      ) ?? latest(events, stage.match)
    )
  return latest(events, stage.match)
}

function palette(
  status?: string,
  lane?: Stage['lane'],
): React.CSSProperties {
  if (status === 'ok')
    return {
      background: '#052e24',
      border: '1px solid #34d399',
      color: '#d1fae5',
      boxShadow: '0 0 24px rgba(52,211,153,.12)',
    }
  if (status === 'running')
    return {
      background: '#083344',
      border: '1px solid #22d3ee',
      color: '#cffafe',
      boxShadow: '0 0 28px rgba(34,211,238,.18)',
    }
  if (status === 'error')
    return {
      background: '#4c0519',
      border: '1px solid #fb7185',
      color: '#ffe4e6',
    }
  if (status === 'blocked' || status === 'cooldown')
    return {
      background: '#451a03',
      border: '1px solid #fbbf24',
      color: '#fef3c7',
    }
  if (lane === 'context')
    return {
      background: '#111827',
      border: '1px dashed #818cf8',
      color: '#c7d2fe',
    }
  if (lane === 'work')
    return {
      background: '#18181b',
      border: '1px dashed #a78bfa',
      color: '#ede9fe',
    }
  return {
    background: '#09090b',
    border: '1px dashed #3f3f46',
    color: '#d4d4d8',
  }
}

function tokenText(e?: TraceEvent): string {
  if (!e) return ''
  const input = e.input_tokens ?? 0
  const output = e.output_tokens ?? 0
  if (!input && !output) return ''
  return `${input + output} tokens · ${input} in / ${output} out`
}

function eventDetail(stage: Stage, e?: TraceEvent): string {
  if (!e) return stage.empty
  if (e.tool_name || e.mcp_server)
    return `${e.mcp_server ?? 'mcp'} · ${e.tool_name ?? 'tool'} · ${e.status}`
  if (e.model_used || e.model_req || e.provider)
    return `${e.model_used ?? e.model_req ?? 'model'} · ${e.provider ?? e.source} · ${tokenText(e) || e.status}`
  return e.detail ?? `${e.source} · ${e.status}`
}

function stageNode(stage: Stage, idx: number, e?: TraceEvent): Node {
  const active = Boolean(e)
  return {
    id: stage.id,
    position: { x: 48, y: idx * 145 + 34 },
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
    data: {
      label: (
        <div className="w-80 text-left font-mono">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] uppercase tracking-[0.22em] opacity-60">
              {stage.lane}
            </div>
            <div className="rounded-full bg-black/30 px-2 py-0.5 text-[10px]">
              {e?.status ?? 'expected'}
            </div>
          </div>
          <div className="mt-1 text-sm font-semibold">
            {e?.label ?? stage.label}
          </div>
          <div className="mt-2 text-[10px] leading-snug opacity-75">
            {eventDetail(stage, e)}
          </div>
          <div className="mt-2 rounded-lg border border-white/10 bg-black/20 p-2 text-[10px] leading-snug opacity-70">
            {stage.research}
          </div>
          {e?.source && (
            <div className="mt-2 text-[10px] text-cyan-200/80">
              source: {e.source}
              {e.kind ? ` · ${e.kind}` : ''}
            </div>
          )}
        </div>
      ),
    },
    style: {
      borderRadius: 18,
      padding: 0,
      opacity: active ? 1 : 0.72,
      ...palette(e?.status, stage.lane),
    },
    draggable: false,
  }
}

export default function ExecutionFlowCanvas({
  events,
}: {
  events: TraceEvent[]
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)

  useEffect(() => {
    let live = true
    const load = async () => {
      const r = await fetch('/api/tmux-snapshot', { cache: 'no-store' }).catch(
        () => null,
      )
      if (!r || !live) return
      const data = await r.json().catch(() => null)
      if (data) setSnapshot(data)
    }
    load()
    const id = setInterval(load, 2500)
    return () => {
      live = false
      clearInterval(id)
    }
  }, [])

  const { nodes, edges, claimedPaneId } = useMemo(() => {
    const stageEvents = Object.fromEntries(
      STAGES.map((stage) => [stage.id, stageEvent(stage, events)]),
    ) as Record<string, TraceEvent | undefined>

    const mainNodes = STAGES.map((stage, idx) =>
      stageNode(stage, idx, stageEvents[stage.id]),
    )

    const mainEdges: Edge[] = STAGES.slice(0, -1).map((stage, idx) => {
      const next = STAGES[idx + 1]
      const real = Boolean(stageEvents[stage.id] && stageEvents[next.id])
      return {
        id: `loop-${stage.id}-${next.id}`,
        source: stage.id,
        target: next.id,
        animated: real && !stageEvents.deliver,
        type: 'smoothstep',
        style: {
          stroke: real ? '#22d3ee' : '#3f3f46',
          strokeDasharray: real ? undefined : '6 7',
          strokeWidth: real ? 2.4 : 1.2,
        },
      }
    })

    const worker = stageEvents.dispatch
    const claimed =
      worker?.pane_id == null ? null : `pane-${worker.pane_id}`

    const paneNodes: Node[] = (snapshot?.panes ?? [])
      .slice(0, 5)
      .map((p, idx) => ({
        id: `pane-${p.index}`,
        position: { x: 470, y: 326 + idx * 92 },
        targetPosition: Position.Left,
        data: {
          label: (
            <div className="w-60 text-left font-mono">
              <div className="text-[10px] uppercase tracking-[0.18em] opacity-60">
                observed pane {p.index} · {p.role}
              </div>
              <div className="mt-1 truncate text-xs font-semibold">
                {p.title || p.command}
              </div>
              <div className="mt-1 text-[10px] opacity-70">
                pid {p.pid} · {p.active ? 'active' : 'attached'} · {p.status}
              </div>
              <div className="mt-1 text-[10px] text-purple-200/80">
                not used unless solid-linked
              </div>
            </div>
          ),
        },
        style: {
          borderRadius: 14,
          padding: 0,
          ...palette(
            p.index === worker?.pane_id ? 'running' : undefined,
            'work',
          ),
        },
        draggable: false,
      }))

    const paneEdges: Edge[] = paneNodes.map((n) => ({
      id: `dispatch-${n.id}`,
      source: 'dispatch',
      target: n.id,
      animated: n.id === claimed,
      type: 'smoothstep',
      style: {
        stroke: n.id === claimed ? '#a78bfa' : '#3f3f46',
        strokeDasharray: n.id === claimed ? undefined : '6 7',
        strokeWidth: n.id === claimed ? 2.4 : 1,
      },
    }))

    return {
      nodes: [...mainNodes, ...paneNodes],
      edges: [...mainEdges, ...paneEdges],
      claimedPaneId: claimed,
    }
  }, [events, snapshot])

  const latestEvent = events[events.length - 1]

  return (
    <div className="h-[720px] overflow-hidden rounded-2xl border border-zinc-800 bg-[#050509] shadow-2xl">
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950/90 px-4 py-3 font-mono">
        <div>
          <div className="text-[10px] uppercase tracking-[0.32em] text-cyan-300/70">
            God Mode loop map · top to bottom
          </div>
          <div className="text-sm font-semibold text-white">
            Single vertical spine: intake → scope/memory → plan → dispatch →
            spans → verify → deliver
          </div>
          <div className="mt-1 text-[10px] text-zinc-500">
            Research synthesis: LangSmith/Weave/Phoenix trace primitives +
            LangGraph Studio state graph + Claude Code terminal-first workflow.
          </div>
        </div>
        <div className="text-right text-[10px] text-zinc-500">
          <div>
            trace events: {events.length} · latest:{' '}
            {latestEvent
              ? `${latestEvent.source}:${latestEvent.kind}`
              : 'none'}
          </div>
          <div>
            tmux panes: {snapshot?.panes?.length ?? '—'} · claimed:{' '}
            {claimedPaneId ?? 'none'} ·{' '}
            {snapshot?.ok ? 'live' : snapshot?.error ?? 'loading'}
          </div>
        </div>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        minZoom={0.25}
        maxZoom={1.2}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#27272a" gap={22} />
        <MiniMap
          pannable
          zoomable
          nodeStrokeWidth={2}
          maskColor="rgba(5,5,9,.72)"
          nodeColor="#164e63"
          nodeStrokeColor="#22d3ee"
          style={{
            background: '#09090b',
            border: '1px solid #27272a',
            borderRadius: 12,
          }}
        />
        <Controls
          showInteractive={false}
          style={{
            background: '#09090b',
            border: '1px solid #27272a',
            borderRadius: 12,
            color: '#e4e4e7',
          }}
        />
      </ReactFlow>
    </div>
  )
}
