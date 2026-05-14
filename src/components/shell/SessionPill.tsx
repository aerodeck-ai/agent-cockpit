'use client'

/**
 * SessionPill — live token/context status pill for the LeftNav cockpit chrome.
 *
 * Renders: ● SESSION | IN <n> OUT <n> CTX <n>% COST $<n>
 * Color of ● tracks context %: green <60%, amber 60-85%, red >85%.
 * Click opens a popover with per-model breakdown.
 * Falls back to SESSION IDLE when no active session is found.
 *
 * Endpoint: GET /api/session-status
 * Poll: every 5 s with AbortController cleanup on unmount.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { ROUGH_COST_PER_1K_TOKENS_USD } from '@/lib/config/costs'

// ── Types ─────────────────────────────────────────────────────────────────────

type SessionPayload = {
  status?: string
  model?: string
  modelProvider?: string
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  contextPercent?: number
  maxTokens?: number
  usedTokens?: number
  sessions?: Array<{
    key: string
    label: string
    model?: string
    modelProvider?: string
    usage?: { input: number; output: number }
  }>
}

type FetchState =
  | { phase: 'loading' }
  | { phase: 'idle' }
  | { phase: 'live'; payload: SessionPayload }
  | { phase: 'error' }

// ── Helpers ───────────────────────────────────────────────────────────────────

function dotColor(pct: number): string {
  if (pct >= 85) return '#ef4444'
  if (pct >= 60) return '#f59e0b'
  return '#63d0a6'
}

function pillClass(pct: number, idle: boolean): string {
  if (idle) return 'cp-status-pill cp-status-idle'
  if (pct >= 85) return 'cp-status-pill cp-status-disconnected'
  if (pct >= 60) return 'cp-status-pill cp-status-partial'
  return 'cp-status-pill cp-status-connected'
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

function roughCost(total: number): string {
  return ((total / 1000) * ROUGH_COST_PER_1K_TOKENS_USD).toFixed(2)
}

function isIdlePayload(p: SessionPayload): boolean {
  return (
    !p.status ||
    p.status === 'idle' ||
    p.status === 'ended' ||
    ((p.inputTokens ?? 0) === 0 && (p.outputTokens ?? 0) === 0 && (p.contextPercent ?? 0) === 0)
  )
}

// ── Popover ───────────────────────────────────────────────────────────────────

function SessionPopover({
  anchor,
  payload,
  onClose,
}: {
  anchor: HTMLElement | null
  payload: SessionPayload
  onClose: () => void
}) {
  const popRef = useRef<HTMLDivElement | null>(null)
  const [style, setStyle] = useState<React.CSSProperties>({})

  useEffect(() => {
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    setStyle({
      position: 'fixed',
      top: rect.top,
      left: rect.right + 8,
      zIndex: 200,
      minWidth: 240,
      maxWidth: 320,
    })
  }, [anchor])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        popRef.current &&
        !popRef.current.contains(e.target as Node) &&
        (!anchor || !anchor.contains(e.target as Node))
      ) {
        onClose()
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [anchor, onClose])

  const inTok = payload.inputTokens ?? 0
  const outTok = payload.outputTokens ?? 0
  const totalTok = payload.totalTokens ?? inTok + outTok
  const ctx = payload.contextPercent ?? 0
  const model = payload.model || '—'
  const provider = payload.modelProvider || '—'
  const sessions = payload.sessions ?? []

  return (
    <div
      ref={popRef}
      className="leftnav-popover"
      style={style}
      role="dialog"
      aria-modal="false"
      aria-label="Session token details"
    >
      <div className="leftnav-popover-title">Session · Token Usage</div>

      <div className="leftnav-popover-metrics">
        <div className="leftnav-popover-metric">
          <span className="leftnav-popover-metric-value">{fmt(inTok)}</span>
          <span className="leftnav-popover-metric-label">input tokens</span>
        </div>
        <div className="leftnav-popover-metric">
          <span className="leftnav-popover-metric-value">{fmt(outTok)}</span>
          <span className="leftnav-popover-metric-label">output tokens</span>
        </div>
        <div className="leftnav-popover-metric">
          <span className="leftnav-popover-metric-value">{ctx.toFixed(0)}%</span>
          <span className="leftnav-popover-metric-label">ctx used</span>
        </div>
        <div className="leftnav-popover-metric">
          <span className="leftnav-popover-metric-value">${roughCost(totalTok)}</span>
          <span className="leftnav-popover-metric-label">est. cost</span>
        </div>
      </div>

      {/* Model + provider */}
      <div
        style={{
          marginTop: '10px',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <Row label="Model" value={model} />
        <Row label="Provider" value={provider} />
      </div>

      {/* Per-session breakdown */}
      {sessions.length > 1 && (
        <>
          <div className="leftnav-popover-title" style={{ marginTop: 12 }}>Sessions</div>
          <ul className="leftnav-popover-list">
            {sessions.slice(0, 6).map((s) => (
              <li key={s.key} className="leftnav-popover-item">
                <span className="leftnav-popover-item-title">{s.label || s.key}</span>
                {s.usage && (
                  <span className="leftnav-popover-item-meta">
                    {fmt(s.usage.input + s.usage.output)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: '0.65rem',
        opacity: 0.75,
        padding: '1px 0',
      }}
    >
      <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
      <span
        style={{
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          maxWidth: 180,
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </span>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

const POLL_MS = 5_000

export function SessionPill() {
  const [state, setState] = useState<FetchState>({ phase: 'loading' })
  const [open, setOpen] = useState(false)
  const pillRef = useRef<HTMLButtonElement | null>(null)

  const fetchStatus = useCallback(async (signal: AbortSignal) => {
    try {
      const res = await fetch('/api/session-status', { signal, cache: 'no-store' })
      if (!res.ok) {
        setState({ phase: 'error' })
        return
      }
      const data = (await res.json()) as { ok?: boolean; payload?: SessionPayload; error?: string }
      if (!data?.ok || !data.payload) {
        setState({ phase: 'idle' })
        return
      }
      const payload = data.payload
      if (isIdlePayload(payload)) {
        setState({ phase: 'idle' })
      } else {
        setState({ phase: 'live', payload })
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return
      setState({ phase: 'error' })
    }
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    void fetchStatus(ctrl.signal)
    const timer = window.setInterval(() => {
      void fetchStatus(ctrl.signal)
    }, POLL_MS)
    return () => {
      ctrl.abort()
      window.clearInterval(timer)
    }
  }, [fetchStatus])

  const handleClick = useCallback(() => {
    setOpen((v) => !v)
  }, [])

  const handleClose = useCallback(() => {
    setOpen(false)
  }, [])

  // ── Render ─────────────────────────────────────────────────────────────────

  if (state.phase === 'loading') return null

  if (state.phase === 'idle' || state.phase === 'error') {
    return (
      <div className="leftnav-session-pill-wrap">
        <span
          className="cp-status-pill cp-status-idle"
          style={{ fontSize: '0.6rem', cursor: 'default', userSelect: 'none' }}
          aria-label="Session idle"
        >
          SESSION IDLE
        </span>
      </div>
    )
  }

  // phase === 'live'
  const { payload } = state
  const inTok = payload.inputTokens ?? 0
  const outTok = payload.outputTokens ?? 0
  const totalTok = payload.totalTokens ?? inTok + outTok
  const ctx = payload.contextPercent ?? 0
  const cost = roughCost(totalTok)
  const dot = dotColor(ctx)
  const cls = pillClass(ctx, false)

  return (
    <>
      <div className="leftnav-session-pill-wrap">
        <button
          ref={pillRef}
          type="button"
          className={cn(cls, 'cp-session-pill leftnav-session-pill-btn atc-interactive')}
          onClick={handleClick}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Session: IN ${fmt(inTok)} OUT ${fmt(outTok)} CTX ${ctx.toFixed(0)}% COST $${cost}`}
          style={{ cursor: 'pointer', fontSize: '0.6rem' }}
        >
          {/* Override the ::before ● with colored inline dot */}
          <span
            aria-hidden="true"
            style={{
              fontSize: '0.55rem',
              color: dot,
              lineHeight: 1,
              // hide default ::before via negative margin trick not needed —
              // we suppress .cp-status-pill::before via data-attr below
            }}
          >
            ●
          </span>
          <span className="leftnav-counter-label" style={{ whiteSpace: 'nowrap' }}>
            SESSION
          </span>
          <span
            className="leftnav-counter-value"
            style={{ gap: 3, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}
          >
            <span>IN {fmt(inTok)}</span>
            <span style={{ opacity: 0.4 }}>|</span>
            <span>OUT {fmt(outTok)}</span>
            <span style={{ opacity: 0.4 }}>|</span>
            <span>CTX {ctx.toFixed(0)}%</span>
            <span style={{ opacity: 0.4 }}>|</span>
            <span>COST ${cost}</span>
          </span>
        </button>
      </div>

      {open && pillRef.current && (
        <SessionPopover
          anchor={pillRef.current}
          payload={payload}
          onClose={handleClose}
        />
      )}
    </>
  )
}
