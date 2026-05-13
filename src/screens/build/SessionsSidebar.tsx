/**
 * SessionsSidebar — active Claude Code sessions + recent agent activity.
 *
 * Reads from GET /api/sessions and lists active sessions.
 * Shows a [+ new session] button that adds a CC pane to the grid.
 */
import { useEffect, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon, ComputerTerminal01Icon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import { useCockpitStore } from '@/stores/cockpit-store'

type SessionSummary = {
  id?: string
  key?: string
  title?: string | null
  updatedAt?: number | string
  model?: string | null
}

function timeAgo(ts: number | string | undefined): string {
  if (!ts) return ''
  const ms = typeof ts === 'number' ? ts : Date.parse(ts as string)
  if (Number.isNaN(ms)) return ''
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

export function SessionsSidebar() {
  const [sessions, setSessions] = useState<Array<SessionSummary>>([])
  const [loading, setLoading] = useState(true)
  const addPane = useCockpitStore((s) => s.addPane)
  const count = useCockpitStore((s) => s.count)

  useEffect(function fetchSessions() {
    let cancelled = false

    async function load() {
      try {
        const res = await fetch('/api/sessions')
        if (!res.ok) return
        const data = (await res.json()) as {
          ok?: boolean
          sessions?: Array<SessionSummary>
        }
        if (!cancelled) {
          setSessions(data.sessions ?? [])
        }
      } catch {
        // non-critical
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    const timer = setInterval(() => { void load() }, 30_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  return (
    <div className="flex w-[250px] shrink-0 flex-col border-r border-primary-300 bg-primary-50">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-primary-300 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-primary-600">
          Sessions
        </span>
        <button
          type="button"
          onClick={addPane}
          disabled={count >= 6}
          title={count >= 6 ? 'Max 6 panes' : 'New CC pane'}
          className={cn(
            'flex items-center gap-1 rounded px-1.5 py-1 text-xs transition-colors',
            count >= 6
              ? 'cursor-not-allowed text-primary-400'
              : 'text-primary-700 hover:bg-primary-200 hover:text-primary-900',
          )}
        >
          <HugeiconsIcon icon={Add01Icon} size={14} strokeWidth={2} />
          New pane
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <p className="p-3 text-xs text-primary-400">Loading…</p>
        ) : sessions.length === 0 ? (
          <p className="p-3 text-xs text-primary-400">No active sessions</p>
        ) : (
          sessions.slice(0, 40).map((session) => {
            const key = session.key ?? session.id ?? Math.random().toString()
            const title =
              session.title?.trim() ||
              `Session ${(session.key ?? session.id ?? '').slice(0, 8)}`
            return (
              <div
                key={key}
                className="flex cursor-default flex-col gap-0.5 px-3 py-2 hover:bg-primary-100"
                title={title}
              >
                <div className="flex items-center gap-2">
                  <HugeiconsIcon
                    icon={ComputerTerminal01Icon}
                    size={14}
                    strokeWidth={1.5}
                    className="shrink-0 text-emerald-500"
                  />
                  <span className="truncate text-xs text-primary-800">
                    {title}
                  </span>
                </div>
                {session.updatedAt ? (
                  <div className="flex items-center gap-1 pl-5">
                    <span className="text-[10px] text-primary-400">
                      {timeAgo(session.updatedAt)}
                    </span>
                    {session.model ? (
                      <span className="ml-auto shrink-0 rounded bg-primary-200 px-1 text-[10px] text-primary-500">
                        {session.model}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
