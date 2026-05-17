'use client'

import { useCallback, useState } from 'react'
import { SwarmTerminal } from '@/components/swarm/swarm-terminal'
import { cn } from '@/lib/utils'

// ATC build-page: 6-pane grid. Each pane attaches an existing tmux session
// from the pool spawned by ~/mcp-infra/scripts/atc-build-panes.sh.
// Swap = change which session this pane attaches; the other 3 sessions stay
// alive detached (swap-without-kill — state preserved on swap-back).

type PaneMode = 'claude' | 'codex' | 'deepseek' | 'shell'

const MODES: Array<{ id: PaneMode; label: string }> = [
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'shell', label: 'Shell' },
]

const PANE_COUNT = 6

function tmuxAttachCommand(paneIndex: number, mode: PaneMode): Array<string> {
  // Attach (not new) — the session was pre-spawned by atc-build-panes.sh.
  // -d detaches other clients so the browser xterm owns the size.
  return ['tmux', 'attach', '-d', '-t', `build-pane-${paneIndex}-${mode}`]
}

function BuildPane({ paneIndex }: { paneIndex: number }) {
  const [mode, setMode] = useState<PaneMode>('claude')

  const command = tmuxAttachCommand(paneIndex, mode)

  return (
    <div
      className="flex flex-col overflow-hidden rounded-lg border"
      style={{
        borderColor: 'var(--theme-border, #2a2a2a)',
        background: 'rgba(13,13,13,0.78)',
      }}
    >
      <div
        className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs"
        style={{
          borderBottom: '1px solid var(--theme-border, #2a2a2a)',
          color: 'var(--theme-muted, #888)',
        }}
      >
        <span className="font-medium">
          build-pane-{paneIndex}
          <span style={{ color: 'var(--theme-accent, #7ec2ff)' }}>
            {' '}
            · {mode}
          </span>
        </span>
        <div className="flex gap-1">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={cn(
                'rounded px-2 py-0.5 text-[11px] transition-colors',
                mode === m.id ? 'font-semibold' : 'opacity-60 hover:opacity-100',
              )}
              style={{
                background:
                  mode === m.id
                    ? 'var(--theme-accent, #7ec2ff)'
                    : 'var(--theme-input, #1a1a1a)',
                color:
                  mode === m.id
                    ? 'var(--theme-bg, #0a0a0a)'
                    : 'var(--theme-text, #ddd)',
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <SwarmTerminal
          // workerId keyed by pane only (NOT mode) so the xterm DOM element is
          // reused across swaps — the reconnect is driven by `command` change.
          workerId={`atc-build-pane-${paneIndex}`}
          command={command}
          height={320}
          active
          className="h-full"
        />
      </div>
    </div>
  )
}

type DispatchEntry = {
  ts: number
  prompt: string
  reply: string
  ok: boolean
}

function HcosDispatcher() {
  const [pane, setPane] = useState(1)
  const [prompt, setPrompt] = useState('')
  const [log, setLog] = useState<Array<DispatchEntry>>([])
  const [busy, setBusy] = useState(false)

  const send = useCallback(async () => {
    const p = prompt.trim()
    if (!p || busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/build/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paneIndex: pane, prompt: p }),
      })
      const data = (await res.json()) as {
        ok?: boolean
        hcos_reply?: string
        directive?: string
        error?: string
      }
      setLog((l) =>
        [
          {
            ts: Date.now(),
            prompt: `[pane ${pane}] ${p}`,
            reply:
              data.directive ??
              data.hcos_reply ??
              data.error ??
              'no response',
            ok: Boolean(data.ok),
          },
          ...l,
        ].slice(0, 30),
      )
      setPrompt('')
    } catch (e) {
      setLog((l) =>
        [
          {
            ts: Date.now(),
            prompt: `[pane ${pane}] ${p}`,
            reply: `dispatch failed: ${(e as Error).message}`,
            ok: false,
          },
          ...l,
        ].slice(0, 30),
      )
    } finally {
      setBusy(false)
    }
  }, [prompt, pane, busy])

  return (
    <div
      className="flex w-72 shrink-0 flex-col gap-2 rounded-lg border p-3"
      style={{
        borderColor: 'var(--theme-border, #2a2a2a)',
        background: 'rgba(13,13,13,0.82)',
      }}
    >
      <div
        className="text-xs font-semibold"
        style={{ color: 'var(--theme-accent, #7ec2ff)' }}
      >
        HCoS Dispatcher
      </div>
      <div className="flex items-center gap-1 text-[11px]">
        <span style={{ color: 'var(--theme-muted, #888)' }}>→ pane</span>
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setPane(n)}
            className="rounded px-1.5 py-0.5"
            style={{
              background:
                pane === n
                  ? 'var(--theme-accent, #7ec2ff)'
                  : 'var(--theme-input, #1a1a1a)',
              color:
                pane === n
                  ? 'var(--theme-bg, #0a0a0a)'
                  : 'var(--theme-text, #ddd)',
            }}
          >
            {n}
          </button>
        ))}
      </div>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send()
        }}
        rows={3}
        placeholder="command for HCoS → pane (⌘/Ctrl+Enter)"
        className="resize-none rounded p-2 text-xs"
        style={{
          background: 'var(--theme-input, #1a1a1a)',
          color: 'var(--theme-text, #ddd)',
          border: '1px solid var(--theme-border, #2a2a2a)',
        }}
      />
      <button
        type="button"
        onClick={send}
        disabled={busy}
        className="rounded px-2 py-1 text-xs font-medium disabled:opacity-50"
        style={{
          background: 'var(--theme-accent, #7ec2ff)',
          color: 'var(--theme-bg, #0a0a0a)',
        }}
      >
        {busy ? 'dispatching…' : 'Dispatch'}
      </button>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto text-[11px]">
        {log.map((e) => (
          <div
            key={e.ts}
            className="rounded p-1.5"
            style={{
              background: 'var(--theme-input, #161616)',
              borderLeft: `2px solid ${e.ok ? 'var(--theme-accent, #7ec2ff)' : '#e0564f'}`,
            }}
          >
            <div style={{ color: 'var(--theme-muted, #888)' }}>{e.prompt}</div>
            <div
              style={{ color: 'var(--theme-text, #ddd)' }}
              className="mt-0.5 break-words font-mono"
            >
              {e.reply}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function AtcBuildScreen() {
  const [poolStatus, setPoolStatus] = useState<string>('')

  const refreshPool = useCallback(async () => {
    setPoolStatus('checking…')
    try {
      const res = await fetch('/api/build/pool-status', { method: 'GET' })
      const data = (await res.json()) as { ok?: boolean; sessions?: number }
      setPoolStatus(
        data.ok ? `${data.sessions ?? 0} sessions live` : 'pool unavailable',
      )
    } catch {
      setPoolStatus('pool check failed')
    }
  }, [])

  return (
    <div
      className="relative flex h-full flex-col gap-3 p-4"
      style={{
        // Polish #6: ships a tasteful default cyberpunk field (layered radial
        // glows + faint grid). Henry can override with a real AerOS wallpaper
        // by setting --atc-build-wallpaper to a url(...) — the var takes
        // precedence over the default gradient when present.
        backgroundColor: 'var(--theme-bg, #0a0a0a)',
        backgroundImage:
          // no-op fallback keeps the multi-layer declaration valid when the
          // var is unset; Henry sets --atc-build-wallpaper: url(...) to override
          'var(--atc-build-wallpaper, linear-gradient(transparent, transparent)),' +
          'radial-gradient(circle at 15% 20%, rgba(126,194,255,0.10), transparent 45%),' +
          'radial-gradient(circle at 85% 75%, rgba(190,120,255,0.10), transparent 45%),' +
          'linear-gradient(rgba(126,194,255,0.04) 1px, transparent 1px),' +
          'linear-gradient(90deg, rgba(126,194,255,0.04) 1px, transparent 1px)',
        backgroundSize: 'cover, cover, cover, 38px 38px, 38px 38px',
        backgroundPosition: 'center',
      }}
    >
      <div className="flex items-center justify-between">
        <div>
          <h1
            className="text-lg font-semibold"
            style={{ color: 'var(--theme-text, #fff)' }}
          >
            Build Grid
          </h1>
          <p
            className="text-xs"
            style={{ color: 'var(--theme-muted, #888)' }}
          >
            6 panes · swap Claude / Codex / DeepSeek / Shell without kill ·
            OAuth-direct via ~/.claude-active
          </p>
        </div>
        <button
          type="button"
          onClick={refreshPool}
          className="rounded px-3 py-1 text-xs"
          style={{
            background: 'var(--theme-input, #1a1a1a)',
            color: 'var(--theme-text, #ddd)',
            border: '1px solid var(--theme-border, #2a2a2a)',
          }}
        >
          {poolStatus || 'pool status'}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="grid min-h-0 flex-1 grid-cols-3 grid-rows-2 gap-3">
          {Array.from({ length: PANE_COUNT }, (_, i) => (
            <BuildPane key={i + 1} paneIndex={i + 1} />
          ))}
        </div>
        <HcosDispatcher />
      </div>
    </div>
  )
}
