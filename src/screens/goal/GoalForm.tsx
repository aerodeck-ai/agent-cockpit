/**
 * GoalForm — Rule 7 validator
 *
 * At least one of cost_ceiling | time_ceiling_hr | henry_bound required.
 * Defaults: $200 kill per-goal, 4h wall, 3-429 stop, 5-identical-error stop.
 */
import { useState } from 'react'
import type { GoalSession } from '@/types/goal-session'

interface Props {
  onCreated: (session: GoalSession) => void
}

const NO_PROGRESS_OPTIONS = [
  { value: '', label: 'None' },
  { value: '3-consecutive-429', label: '3 consecutive 429s' },
  { value: '5-identical-error', label: '5 identical errors' },
  { value: 'custom', label: 'Custom sentinel' },
]

export function GoalForm({ onCreated }: Props) {
  const [goalText, setGoalText] = useState('')
  const [costCeiling, setCostCeiling] = useState<string>('200')
  const [timeCeiling, setTimeCeiling] = useState<string>('4')
  const [henryBound, setHenryBound] = useState<string>('')
  const [noProgress, setNoProgress] = useState<string>('5-identical-error')
  const [killedSentinel, setKilledSentinel] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [globalError, setGlobalError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFieldErrors({})
    setGlobalError(null)

    const costNum = costCeiling.trim() ? parseFloat(costCeiling) : null
    const timeNum = timeCeiling.trim() ? parseFloat(timeCeiling) : null
    const henryItems = henryBound
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean)

    // Client-side Rule 7 check
    if (costNum === null && timeNum === null && henryItems.length === 0) {
      setFieldErrors({
        cost_ceiling: 'At least one safety ceiling required',
        time_ceiling_hr: 'At least one safety ceiling required',
        henry_bound: 'At least one safety ceiling required',
      })
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/goal/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal_text: goalText,
          cost_ceiling: costNum,
          time_ceiling_hr: timeNum,
          henry_bound: henryItems.length > 0 ? henryItems : undefined,
          no_progress: noProgress || undefined,
          killed_sentinel: killedSentinel.trim() || undefined,
        }),
      })

      if (!res.ok) {
        const body = (await res.json()) as { error?: string; fields?: Record<string, string> }
        if (body.fields) setFieldErrors(body.fields)
        else setGlobalError(body.error ?? 'Request failed')
        return
      }

      const session = (await res.json()) as GoalSession
      onCreated(session)
      setGoalText('')
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-primary-200 bg-primary-50/85 p-5 backdrop-blur-xl dark:border-neutral-700 dark:bg-neutral-900/80"
    >
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-ink/60">
        Define Goal
      </h2>

      {/* Goal text */}
      <div className="mb-4">
        <label className="mb-1 block text-sm font-medium text-ink/80">
          Goal <span className="text-red-500">*</span>
        </label>
        <textarea
          value={goalText}
          onChange={(e) => setGoalText(e.target.value)}
          rows={3}
          required
          placeholder="Describe the autonomous task…"
          className="w-full resize-none rounded-lg border border-primary-200 bg-white/60 px-3 py-2 text-sm text-ink placeholder:text-ink/40 focus:outline-none focus:ring-2 focus:ring-primary-400 dark:border-neutral-700 dark:bg-neutral-800"
        />
      </div>

      {/* Safety ceilings row */}
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* Cost ceiling */}
        <div>
          <label className="mb-1 block text-sm font-medium text-ink/80">
            Cost ceiling (USD)
          </label>
          <input
            type="number"
            min={0}
            step={10}
            value={costCeiling}
            onChange={(e) => setCostCeiling(e.target.value)}
            placeholder="200"
            className={`w-full rounded-lg border px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary-400 dark:bg-neutral-800 ${
              fieldErrors.cost_ceiling
                ? 'border-red-400'
                : 'border-primary-200 bg-white/60 dark:border-neutral-700'
            }`}
          />
          {fieldErrors.cost_ceiling && (
            <p className="mt-1 text-xs text-red-500">{fieldErrors.cost_ceiling}</p>
          )}
        </div>

        {/* Time ceiling */}
        <div>
          <label className="mb-1 block text-sm font-medium text-ink/80">
            Wall-clock ceiling (hours)
          </label>
          <input
            type="number"
            min={0}
            step={0.5}
            value={timeCeiling}
            onChange={(e) => setTimeCeiling(e.target.value)}
            placeholder="4"
            className={`w-full rounded-lg border px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary-400 dark:bg-neutral-800 ${
              fieldErrors.time_ceiling_hr
                ? 'border-red-400'
                : 'border-primary-200 bg-white/60 dark:border-neutral-700'
            }`}
          />
          {fieldErrors.time_ceiling_hr && (
            <p className="mt-1 text-xs text-red-500">{fieldErrors.time_ceiling_hr}</p>
          )}
        </div>

        {/* No-progress detector */}
        <div>
          <label className="mb-1 block text-sm font-medium text-ink/80">
            No-progress detector
          </label>
          <select
            value={noProgress}
            onChange={(e) => setNoProgress(e.target.value)}
            className="w-full rounded-lg border border-primary-200 bg-white/60 px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary-400 dark:border-neutral-700 dark:bg-neutral-800"
          >
            {NO_PROGRESS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Henry-bound items */}
      <div className="mb-4">
        <label className="mb-1 block text-sm font-medium text-ink/80">
          Henry-bound items (one per line — agent must stop and ask)
        </label>
        <textarea
          value={henryBound}
          onChange={(e) => setHenryBound(e.target.value)}
          rows={2}
          placeholder="e.g. git push to main&#10;send email to client"
          className={`w-full resize-none rounded-lg border px-3 py-2 text-sm text-ink placeholder:text-ink/40 focus:outline-none focus:ring-2 focus:ring-primary-400 dark:bg-neutral-800 ${
            fieldErrors.henry_bound
              ? 'border-red-400'
              : 'border-primary-200 bg-white/60 dark:border-neutral-700'
          }`}
        />
        {fieldErrors.henry_bound && (
          <p className="mt-1 text-xs text-red-500">{fieldErrors.henry_bound}</p>
        )}
      </div>

      {/* Killed sentinel (optional) */}
      <div className="mb-5">
        <label className="mb-1 block text-sm font-medium text-ink/80">
          Killed sentinel pattern (optional regex)
        </label>
        <input
          type="text"
          value={killedSentinel}
          onChange={(e) => setKilledSentinel(e.target.value)}
          placeholder="e.g. FATAL|SIGKILL"
          className="w-full rounded-lg border border-primary-200 bg-white/60 px-3 py-2 text-sm text-ink placeholder:text-ink/40 focus:outline-none focus:ring-2 focus:ring-primary-400 dark:border-neutral-700 dark:bg-neutral-800"
        />
      </div>

      {/* Rule 7 reminder */}
      <p className="mb-4 text-xs text-ink/40">
        Rule 7: at least one of cost ceiling, time ceiling, or Henry-bound items is required.
      </p>

      {globalError && (
        <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-400">
          {globalError}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || !goalText.trim()}
        className="w-full rounded-lg bg-red-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? 'Creating…' : 'Launch Goal'}
      </button>
    </form>
  )
}
