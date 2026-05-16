/**
 * Panel5KillSwitch
 *
 * Two buttons:
 * - Pause: single click → POST /api/goal/pause
 * - Hard Stop: requires two clicks within 3s → POST /api/goal/hard-stop { confirm: true }
 */
import { useEffect, useRef, useState } from 'react'
import type { GoalSession, GoalStatus } from '@/types/goal-session'

interface Props {
  goalId: string
  status: GoalStatus
  onStatusChange: (updated: GoalSession) => void
}

export function Panel5KillSwitch({ goalId, status, onStatusChange }: Props) {
  const [pausing, setPausing] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [hardStopArmed, setHardStopArmed] = useState(false)
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Disarm after 3s
  useEffect(() => {
    if (hardStopArmed) {
      armTimerRef.current = setTimeout(() => setHardStopArmed(false), 3_000)
    }
    return () => {
      if (armTimerRef.current) clearTimeout(armTimerRef.current)
    }
  }, [hardStopArmed])

  const isDone = status === 'killed' || status === 'completed'

  async function handlePause() {
    setPausing(true)
    setError(null)
    try {
      const res = await fetch('/api/goal/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: goalId }),
      })
      if (!res.ok) {
        const body = (await res.json()) as { error?: string }
        setError(body.error ?? 'Pause failed')
        return
      }
      const { session } = (await res.json()) as { session: GoalSession }
      onStatusChange(session)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setPausing(false)
    }
  }

  async function handleHardStop() {
    if (!hardStopArmed) {
      setHardStopArmed(true)
      return
    }
    // Second click within 3s
    setHardStopArmed(false)
    setStopping(true)
    setError(null)
    try {
      const res = await fetch('/api/goal/hard-stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: goalId, confirm: true }),
      })
      if (!res.ok) {
        const body = (await res.json()) as { error?: string }
        setError(body.error ?? 'Hard stop failed')
        return
      }
      const { session } = (await res.json()) as { session: GoalSession }
      onStatusChange(session)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setStopping(false)
    }
  }

  return (
    <div className="rounded-xl border border-red-200 bg-red-50/70 p-4 backdrop-blur-xl dark:border-red-900/40 dark:bg-red-950/20">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink/50">
        Kill Switch
      </h3>

      {isDone && (
        <div className="mb-3 rounded-lg bg-black/5 px-3 py-2 text-sm text-ink/50 dark:bg-white/5">
          Goal is {status} — no actions available.
        </div>
      )}

      {error && (
        <div className="mb-3 rounded-lg bg-red-100 px-3 py-2 text-xs text-red-600 dark:bg-red-900/30 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        {/* Pause */}
        <button
          onClick={() => { void handlePause() }}
          disabled={pausing || isDone || status === 'paused'}
          className="flex-1 rounded-lg border border-amber-400 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-700 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400"
        >
          {pausing ? 'Pausing…' : status === 'paused' ? 'Paused' : 'Pause'}
        </button>

        {/* Hard Stop (2-click gate) */}
        <button
          onClick={() => { void handleHardStop() }}
          disabled={stopping || isDone}
          className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
            hardStopArmed
              ? 'animate-pulse border-2 border-red-600 bg-red-500 text-white'
              : 'border border-red-400 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-700 dark:bg-red-900/20 dark:text-red-400'
          }`}
        >
          {stopping
            ? 'Stopping…'
            : hardStopArmed
              ? '⚠ Confirm — click again to KILL'
              : 'Hard Stop'}
        </button>
      </div>

      <p className="mt-2 text-center text-xs text-ink/30">
        Hard Stop requires two clicks within 3 seconds
      </p>
    </div>
  )
}
