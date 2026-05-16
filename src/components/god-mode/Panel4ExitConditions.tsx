/**
 * Panel4ExitConditions
 *
 * Renders the goal's declared exit conditions with live cost/time status.
 * Green = safe, Amber = within 20% of ceiling, Red = breached/exceeded.
 */
import type { GoalSession } from '@/types/goal-session'

interface Props {
  goal: GoalSession
}

type ConditionStatus = 'green' | 'amber' | 'red'

interface Condition {
  label: string
  value: string
  status: ConditionStatus
}

function getStatus(current: number, ceiling: number): ConditionStatus {
  const pct = current / ceiling
  if (pct >= 1) return 'red'
  if (pct >= 0.8) return 'amber'
  return 'green'
}

const STATUS_DOT: Record<ConditionStatus, string> = {
  green: 'bg-emerald-400',
  amber: 'bg-amber-400',
  red: 'bg-red-500',
}

const STATUS_ROW: Record<ConditionStatus, string> = {
  green: '',
  amber: 'bg-amber-50/50 dark:bg-amber-900/10',
  red: 'bg-red-50/50 dark:bg-red-900/10',
}

export function Panel4ExitConditions({ goal }: Props) {
  const conditions: Condition[] = []

  // Cost ceiling
  if (goal.cost_ceiling !== null) {
    const current = goal.cost_view_usd ?? 0
    conditions.push({
      label: 'Cost ceiling',
      value: `$${current.toFixed(2)} / $${goal.cost_ceiling}`,
      status: getStatus(current, goal.cost_ceiling),
    })
  }

  // Time ceiling
  if (goal.time_ceiling_hr !== null && goal.started_at) {
    const elapsedHr = (Date.now() - new Date(goal.started_at).getTime()) / 3_600_000
    conditions.push({
      label: 'Wall-clock ceiling',
      value: `${elapsedHr.toFixed(2)}h / ${goal.time_ceiling_hr}h`,
      status: getStatus(elapsedHr, goal.time_ceiling_hr),
    })
  }

  // No-progress detector
  if (goal.no_progress) {
    conditions.push({
      label: 'No-progress detector',
      value: goal.no_progress,
      status: 'green',
    })
  }

  // Killed sentinel
  if (goal.killed_sentinel) {
    conditions.push({
      label: 'Killed sentinel',
      value: goal.killed_sentinel,
      status: 'green',
    })
  }

  // Henry-bound items
  if (goal.henry_bound) {
    let items: string[] = []
    try {
      items = JSON.parse(goal.henry_bound) as string[]
    } catch {
      items = [goal.henry_bound]
    }
    for (const item of items) {
      conditions.push({
        label: 'Henry-bound',
        value: item,
        status: 'green',
      })
    }
  }

  return (
    <div className="rounded-xl border border-primary-200 bg-primary-50/85 p-4 backdrop-blur-xl dark:border-neutral-700 dark:bg-neutral-900/80">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink/50">
        Exit Conditions
      </h3>

      {conditions.length === 0 ? (
        <p className="text-xs text-ink/40">No conditions declared.</p>
      ) : (
        <div className="space-y-1.5">
          {conditions.map((c, i) => (
            <div
              key={i}
              className={`flex items-center justify-between rounded-lg px-3 py-2 ${STATUS_ROW[c.status]}`}
            >
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${STATUS_DOT[c.status]}`} />
                <span className="text-xs text-ink/70">{c.label}</span>
              </div>
              <span className="text-xs tabular-nums text-ink/80 font-medium">{c.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
