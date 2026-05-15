/**
 * Panel2CurrentSubtask
 *
 * Polls /api/goal/$id every 5s.
 * Shows active task + model tier + status badge.
 */
import { useEffect, useState } from 'react'
import type { GoalSession } from '@/server/goal-sessions-store'

interface Props {
  goalId: string
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-neutral-400',
  running: 'bg-emerald-400 animate-pulse',
  paused: 'bg-amber-400',
  killed: 'bg-red-500',
  completed: 'bg-blue-400',
}

export function Panel2CurrentSubtask({ goalId }: Props) {
  const [session, setSession] = useState<GoalSession | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function poll() {
      try {
        const res = await fetch(`/api/goal/${goalId}`)
        if (!res.ok) {
          setError(`HTTP ${res.status}`)
          return
        }
        const data = (await res.json()) as GoalSession
        if (!cancelled) {
          setSession(data)
          setError(null)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Network error')
      }
    }

    void poll()
    const timer = setInterval(() => { void poll() }, 5_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [goalId])

  const dotColor = session ? (STATUS_COLORS[session.status] ?? 'bg-neutral-400') : 'bg-neutral-300'

  return (
    <div className="rounded-xl border border-primary-200 bg-primary-50/85 p-4 backdrop-blur-xl dark:border-neutral-700 dark:bg-neutral-900/80">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink/50">
        Current Subtask
      </h3>

      {error && <p className="mb-2 text-xs text-amber-500">{error}</p>}

      <div className="mb-3 flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${dotColor}`} />
        <span className="text-sm font-medium text-ink capitalize">
          {session?.status ?? '—'}
        </span>
      </div>

      {session && (
        <>
          <p className="mb-2 line-clamp-3 text-sm text-ink/80">{session.goal_text}</p>
          <div className="flex flex-wrap gap-2 text-xs text-ink/50">
            {session.cost_view_usd > 0 && (
              <span className="rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/5">
                ${session.cost_view_usd.toFixed(4)} spent
              </span>
            )}
            {session.cost_ceiling && (
              <span className="rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/5">
                ceiling ${session.cost_ceiling}
              </span>
            )}
            {session.time_ceiling_hr && (
              <span className="rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/5">
                {session.time_ceiling_hr}h wall
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
