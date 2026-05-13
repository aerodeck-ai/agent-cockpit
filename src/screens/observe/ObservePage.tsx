/**
 * ObservePage — tabbed observability canvas for the /observe route.
 *
 * Tabs:
 *   Flow    — live SSE event stream (disler port)
 *   Budgets — daily budget burn (BudgetBurnCard)
 *   Evals   — eval runs & compare (EvalsScreen)
 *   Cost    — v1.1 stub (Helicone iframe planned)
 *   Errors  — v1.1 stub (error feed planned)
 */

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { FlowTab } from './FlowTab'
import { BudgetsTab } from './BudgetsTab'
import { EvalsTab } from './EvalsTab'
import { CostTab } from './CostTab'
import { ErrorsTab } from './ErrorsTab'
import TraceView from './TraceView'
import WorkflowView from './WorkflowView'

type ObserveTab = 'flow' | 'trace' | 'workflow' | 'budgets' | 'evals' | 'cost' | 'errors'

const TABS: { id: ObserveTab; label: string; emoji: string }[] = [
  { id: 'flow',     label: 'Flow',     emoji: '🔵' },
  { id: 'trace',    label: 'Trace',    emoji: '🌳' },
  { id: 'workflow', label: 'Workflow', emoji: '⚙️' },
  { id: 'budgets',  label: 'Budgets',  emoji: '💰' },
  { id: 'evals',    label: 'Evals',    emoji: '✅' },
  { id: 'cost',     label: 'Cost',     emoji: '📊' },
  { id: 'errors',   label: 'Errors',   emoji: '🚨' },
]

export function ObservePage() {
  const [activeTab, setActiveTab] = useState<ObserveTab>('flow')

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Page header */}
      <div className="flex items-center gap-3 border-b border-border px-6 py-4 shrink-0">
        <svg
          className="h-5 w-5 text-muted-foreground shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
          />
        </svg>
        <h1 className="text-lg font-semibold">Observe</h1>
        <span className="ml-auto text-xs text-muted-foreground">
          Live agent observability · Hermes + Claude hooks
        </span>
      </div>

      {/* Tab strip */}
      <div className="border-b border-border px-6 shrink-0">
        <div className="flex gap-0">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px flex items-center gap-1.5',
                activeTab === tab.id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <span>{tab.emoji}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden relative">
        {activeTab === 'flow'     && <FlowTab />}
        {activeTab === 'trace'    && <TraceView />}
        {activeTab === 'workflow' && <WorkflowView />}
        {activeTab === 'budgets'  && <BudgetsTab />}
        {activeTab === 'evals'   && <EvalsTab />}
        {activeTab === 'cost'    && <CostTab />}
        {activeTab === 'errors'  && <ErrorsTab />}
      </div>
    </div>
  )
}
