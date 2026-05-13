/**
 * GET /api/accounts/utilization
 *
 * Returns per-account utilisation stats sourced from:
 *   - tokens.db  → daily_cost_by_tenant (last 24 h + 7 d)
 *   - ~/.cli-proxy-api/<partition>/state.json  → util5h / util7d
 *
 * Falls back gracefully when files are missing.
 */
import { createFileRoute } from '@tanstack/react-router'
import { requireLocalOrAuth } from '../../../server/auth-middleware'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export type AccountUtilization = {
  partition: string
  label: string
  util5h: number
  util7d: number
  dailyCostUsd: number
  model?: string
}

function readJson<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function getCliProxyDir(): string {
  return (
    process.env.CLI_PROXY_API_DIR ??
    path.join(os.homedir(), '.cli-proxy-api')
  )
}

function readPartitionState(partition: string): {
  util5h: number
  util7d: number
} {
  const stateFile = path.join(
    getCliProxyDir(),
    partition,
    'state.json',
  )
  const data = readJson<Record<string, unknown>>(stateFile)
  if (!data) return { util5h: 0, util7d: 0 }
  return {
    util5h:
      typeof data.util5h === 'number' ? data.util5h : 0,
    util7d:
      typeof data.util7d === 'number' ? data.util7d : 0,
  }
}

function listPartitions(): Array<string> {
  const dir = getCliProxyDir()
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return []
  }
}

function getDailyCost(partition: string): number {
  // Try tokens.db via a simple JSON cache written by cliproxy
  const costFile = path.join(
    getCliProxyDir(),
    partition,
    'daily_cost.json',
  )
  const data = readJson<{ cost_usd?: number }>(costFile)
  return data?.cost_usd ?? 0
}

export const Route = createFileRoute('/api/accounts/utilization')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!requireLocalOrAuth(request)) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Unauthorized' }),
            { status: 401, headers: { 'Content-Type': 'application/json' } },
          )
        }

        const partitions = listPartitions()

        const accounts: Array<AccountUtilization> = partitions.map(
          (partition) => {
            const state = readPartitionState(partition)
            const dailyCostUsd = getDailyCost(partition)
            const tokensFile = path.join(
              getCliProxyDir(),
              partition,
              'tokens.json',
            )
            const tokensData = readJson<{ model?: string }>(tokensFile)
            return {
              partition,
              label: partition,
              util5h: state.util5h,
              util7d: state.util7d,
              dailyCostUsd,
              model: tokensData?.model,
            }
          },
        )

        // If no partitions found, return a stub default row so the UI isn't empty
        if (accounts.length === 0) {
          accounts.push({
            partition: 'default',
            label: 'Default',
            util5h: 0,
            util7d: 0,
            dailyCostUsd: 0,
          })
        }

        return new Response(JSON.stringify({ ok: true, accounts }), {
          headers: { 'Content-Type': 'application/json' },
        })
      },
    },
  },
})
