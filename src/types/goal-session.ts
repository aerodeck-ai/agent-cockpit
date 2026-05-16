/**
 * Shared GoalSession types used by both server-side store and client components.
 */

export type GoalStatus = 'pending' | 'running' | 'paused' | 'killed' | 'completed'

export interface GoalSession {
  id: string
  goal_text: string
  status: GoalStatus
  cost_ceiling: number | null
  time_ceiling_hr: number | null
  henry_bound: string | null      // JSON array string
  no_progress: string | null
  killed_sentinel: string | null
  created_at: string
  started_at: string | null
  paused_at: string | null
  killed_at: string | null
  completed_at: string | null
  cost_view_usd: number
  cost_real_usd: number
}
