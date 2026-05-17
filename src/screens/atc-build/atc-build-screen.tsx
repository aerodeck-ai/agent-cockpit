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
        // Polish #6 cyberpunk wallpaper bleeds through here when the asset
        // is placed (Henry approval gate 2). Falls back to solid bg.
        backgroundImage: 'var(--atc-build-wallpaper, none)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundColor: 'var(--theme-bg, #0a0a0a)',
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

      <div className="grid min-h-0 flex-1 grid-cols-3 grid-rows-2 gap-3">
        {Array.from({ length: PANE_COUNT }, (_, i) => (
          <BuildPane key={i + 1} paneIndex={i + 1} />
        ))}
      </div>
    </div>
  )
}
