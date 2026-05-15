/**
 * BudgetsTab — RELOCATED from the /observe tabbed view.
 *
 * Mounts the existing BudgetBurnCard component from the dashboard.
 * No rewrite — just wraps the canonical component.
 */

import { BudgetBurnCard } from '@/screens/dashboard/components/budget-burn-card'

export function BudgetsTab() {
  return (
    <div className="p-6">
      <div className="mb-4">
        <h2 className="text-base font-semibold">Daily Budget Burn</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Per-tenant spend vs. cap. Refreshes every 30s.
        </p>
      </div>
      <BudgetBurnCard />
    </div>
  )
}
