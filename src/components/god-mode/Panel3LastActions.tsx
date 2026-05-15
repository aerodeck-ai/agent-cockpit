/**
 * Panel3LastActions
 *
 * Polls the session JSONL tail every 5s for the last 5 tool calls.
 * Falls back to static placeholder if the log isn't accessible from the browser.
 * Highlights consecutive identical errors in amber.
 */
import { useEffect, useState } from 'react'

interface ActionEntry {
  ts: number
  tool?: string
  event?: string
  content?: string
  isError?: boolean
}

// We poll /api/observe/... or the session log endpoint if it exists.
// For Phase 3, we use a simple approach: tail the ATC CDP smoke log via
// a dedicated /api/logs/tail endpoint if available, otherwise show placeholder.
// The panel still renders and will light up when the endpoint exists.

function useLastActions() {
  const [actions, setActions] = useState<ActionEntry[]>([])

  useEffect(() => {
    let cancelled = false

    async function poll() {
      try {
        // Try the swarm tmux scroll endpoint as a proxy for recent activity
        const res = await fetch('/api/swarm-tmux-scroll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lines: 20 }),
        })
        if (!res.ok) return
        const data = (await res.json()) as { lines?: string[] }
        if (!cancelled && data.lines) {
          const parsed: ActionEntry[] = data.lines
            .filter((l) => l.trim())
            .slice(-5)
            .map((l, i) => ({
              ts: Date.now() - (5 - i) * 1000,
              content: l.slice(0, 120),
              isError: /error|failed|exception|429|500/i.test(l),
            }))
          setActions(parsed)
        }
      } catch {
        // log not accessible — keep previous state
      }
    }

    void poll()
    const timer = setInterval(() => { void poll() }, 5_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  return actions
}

export function Panel3LastActions() {
  const actions = useLastActions()

  // Detect consecutive identical errors
  function isConsecutiveError(actions: ActionEntry[], idx: number): boolean {
    if (!actions[idx].isError) return false
    if (idx === 0) return false
    return actions[idx].content === actions[idx - 1]?.content
  }

  return (
    <div className="rounded-xl border border-primary-200 bg-primary-50/85 p-4 backdrop-blur-xl dark:border-neutral-700 dark:bg-neutral-900/80">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink/50">
        Last Actions
      </h3>

      {actions.length === 0 && (
        <p className="text-xs text-ink/40">Waiting for activity…</p>
      )}

      <div className="space-y-1.5">
        {actions.map((a, i) => (
          <div
            key={i}
            className={`rounded px-2 py-1 text-xs font-mono ${
              isConsecutiveError(actions, i)
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                : a.isError
                  ? 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400'
                  : 'bg-black/5 text-ink/70 dark:bg-white/5'
            }`}
          >
            {a.tool && <span className="font-semibold">[{a.tool}] </span>}
            <span className="break-all">{a.content ?? '—'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
