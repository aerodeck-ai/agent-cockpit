/**
 * GET /api/budget/status
 *
 * Returns per-tenant budget status for the dashboard widget.
 * Henry (henry_cos) sees all tenants. Mally sees only his own row.
 *
 * Response shape:
 *   { tenants: Array<{ tenant, displayName, spent, cap, pct, projection, withinCap }> }
 *
 * pct = spent/cap * 100 (null when no cap).
 * projection = linear 24h extrapolation based on current spend at time-of-day.
 */

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { resolveTenantFromRequest } from '../../../lib/auth/tenants'
import { checkBudget } from '../../../server/budget-enforcement'

const ALL_TENANTS = [
  { id: 'henry_cos', displayName: 'Henry' },
  { id: 'mally',     displayName: 'Mally' },
]

function calcProjection(spent: number): number {
  // Linear projection: scale current spend to a full 24 h window.
  const now = new Date()
  const hoursElapsed = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600
  if (hoursElapsed < 0.5) return spent  // too early — don't inflate
  return (spent / hoursElapsed) * 24
}

export const Route = createFileRoute('/api/budget/status')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        const tenantInfo = resolveTenantFromRequest(request)
        const callerTenant = tenantInfo?.tenant ?? null

        // Mally sees only his own row; Henry / unknown sees all.
        const visible =
          callerTenant === 'mally'
            ? ALL_TENANTS.filter((t) => t.id === 'mally')
            : ALL_TENANTS

        const tenants = visible.map((t) => {
          const budget = checkBudget(t.id)
          const pct =
            budget.cap != null && budget.cap > 0
              ? Math.round((budget.spent / budget.cap) * 100)
              : null
          const projection = calcProjection(budget.spent)
          return {
            tenant:      t.id,
            displayName: t.displayName,
            spent:       budget.spent,
            cap:         budget.cap,
            pct,
            projection,
            withinCap:   budget.withinCap,
          }
        })

        return json({ tenants }, {
          headers: { 'Cache-Control': 'no-store, max-age=0' },
        })
      },
    },
  },
})
