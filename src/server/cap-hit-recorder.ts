/**
 * cap-hit-recorder.ts — writes a hermes_findings row when a tenant hits their daily budget cap.
 *
 * Records to oracle:/home/ubuntu/data/sqlite/shared/hermes.db hermes_findings table.
 * Fire-and-forget: caller wraps in try/catch and ignores errors.
 */

import { execFileSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import type { BudgetStatus } from './budget-enforcement'

const HERMES_DB = path.join(
  os.homedir(),
  'data/sqlite/shared/hermes.db',
)

export function recordCapHit(tenant: string, budget: BudgetStatus): void {
  const spent = budget.spent.toFixed(4)
  const cap   = budget.cap != null ? budget.cap.toFixed(2) : 'unknown'
  const title = `Daily budget cap hit — ${tenant}`
  const body  = `Tenant "${tenant}" reached daily spend cap. Spent: $${spent} / Cap: $${cap}. Request blocked with HTTP 429.`
  const raw   = JSON.stringify({ tenant, spent: budget.spent, cap: budget.cap, ts: new Date().toISOString() })

  const sql = [
    "INSERT INTO hermes_findings (source, severity, title, body, raw_event, status, audience)",
    "VALUES ('budget.enforcer', 'high',",
    `'${title.replace(/'/g, "''")}',`,
    `'${body.replace(/'/g, "''")}',`,
    `'${raw.replace(/'/g, "''")}',`,
    "'pending',",
    `'${tenant}');`,
  ].join(' ')

  execFileSync('sqlite3', [HERMES_DB, sql], { encoding: 'utf8', timeout: 3000 })
}
