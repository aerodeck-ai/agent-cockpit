/**
 * GoalPage — God Mode dashboard
 *
 * Top: GoalForm (Rule 7 validator)
 * Below: 5-panel grid
 *   Panel1CostRate | Panel2CurrentSubtask | Panel3LastActions
 *   Panel4ExitConditions | Panel5KillSwitch
 */
import { useState } from 'react'
import { GoalForm } from './GoalForm'
import { Panel1CostRate } from '@/components/god-mode/Panel1CostRate'
import { Panel2CurrentSubtask } from '@/components/god-mode/Panel2CurrentSubtask'
import { Panel3LastActions } from '@/components/god-mode/Panel3LastActions'
import { Panel4ExitConditions } from '@/components/god-mode/Panel4ExitConditions'
import { Panel5KillSwitch } from '@/components/god-mode/Panel5KillSwitch'
import type { GoalSession } from '@/server/goal-sessions-store'

export function GoalPage() {
  const [activeGoal, setActiveGoal] = useState<GoalSession | null>(null)

  return (
    <div className="min-h-full overflow-y-auto bg-surface text-ink">
      <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-500/10">
            <span className="text-lg font-bold text-red-500">⚡</span>
          </div>
          <div>
            <h1 className="text-xl font-semibold text-ink">God Mode</h1>
            <p className="text-sm text-ink/50">Autonomous agent with safety ceilings</p>
          </div>
        </div>

        {/* Goal form */}
        <div className="mb-6">
          <GoalForm
            onCreated={(session) => setActiveGoal(session)}
          />
        </div>

        {/* 5-panel grid — only shown when an active goal exists */}
        {activeGoal && (
          <div className="space-y-4">
            {/* Row 1: Cost + Subtask + Actions */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <Panel1CostRate />
              <Panel2CurrentSubtask goalId={activeGoal.id} />
              <Panel3LastActions />
            </div>
            {/* Row 2: Exit conditions + Kill switch */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Panel4ExitConditions goal={activeGoal} />
              <Panel5KillSwitch
                goalId={activeGoal.id}
                status={activeGoal.status}
                onStatusChange={(updated) => setActiveGoal(updated)}
              />
            </div>
          </div>
        )}

        {/* Placeholder when no goal is active */}
        {!activeGoal && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-primary-200 bg-primary-50/50 py-16 text-center dark:border-neutral-700 dark:bg-neutral-900/50">
            <div className="mb-3 text-4xl opacity-30">⚡</div>
            <p className="text-sm text-ink/50">Submit a goal above to activate the dashboard</p>
          </div>
        )}
      </div>
    </div>
  )
}
