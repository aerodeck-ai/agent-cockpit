/**
 * Budget enforcement — per-tenant daily USD cap gate.
 *
 * getDailySpendUSD  — queries harness.db llm_calls for last 24 h spend.
 * getDailyCapUSD    — reads agent.cost_cap_usd_daily from the tenant profile config.
 * checkBudget       — returns {withinCap, spent, cap}. Caches 30 s per tenant.
 *
 * Failure policy: if any query throws, withinCap = true (graceful degrade — better
 * to overrun cap than to brick chat).
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import YAML from 'yaml'

// ── Types ────────────────────────────────────────────────────────────────────

export type BudgetStatus = {
  withinCap: boolean
  spent: number        // USD in last 24 h (0 when unknown)
  cap: number | null   // null = no cap configured
}

// ── Tenant → profile name mapping ───────────────────────────────────────────

/** Map from cockpit tenant id to Hermes profile directory name. */
const TENANT_PROFILE: Record<string, string> = {
  henry_cos: 'default',
  mally:     'mally',
}

/**
 * Caller-name prefix patterns per tenant.
 * henry_cos owns every caller that is NOT a known mally-owned prefix.
 */
const MALLY_CALLER_PREFIXES = ['mally']

// ── Config reader ────────────────────────────────────────────────────────────

function getHermesRoot(): string {
  return process.env.HERMES_HOME ?? path.join(os.homedir(), '.hermes')
}

/**
 * Read agent.cost_cap_usd_daily from the tenant's profile config.yaml.
 * Returns null if not present or on any error.
 */
export function getDailyCapUSD(tenant: string): number | null {
  try {
    const profileName = TENANT_PROFILE[tenant] ?? tenant
    const configPath = path.join(
      getHermesRoot(),
      'profiles',
      profileName,
      'config.yaml',
    )
    if (!fs.existsSync(configPath)) return null
    const raw = fs.readFileSync(configPath, 'utf8')
    const parsed = YAML.parse(raw) as Record<string, unknown>
    const agent = parsed?.agent as Record<string, unknown> | undefined
    const cap = agent?.cost_cap_usd_daily
    if (typeof cap === 'number' && Number.isFinite(cap) && cap > 0) return cap
    return null
  } catch (err) {
    console.warn('[budget] getDailyCapUSD error:', err)
    return null
  }
}

// ── Spend reader ─────────────────────────────────────────────────────────────

const HARNESS_DB = path.join(
  os.homedir(),
  'data/sqlite/shared/harness/harness.db',
)

const SPEND_QUERY_HENRY = [
  "SELECT COALESCE(SUM(cost_usd),0) as spent",
  "FROM llm_calls",
  "WHERE ts > strftime('%s','now','-1 day')",
  "AND (caller IS NULL OR caller NOT LIKE 'mally%')",
  "AND cost_usd IS NOT NULL;",
].join(' ')

const SPEND_QUERY_MALLY = [
  "SELECT COALESCE(SUM(cost_usd),0) as spent",
  "FROM llm_calls",
  "WHERE ts > strftime('%s','now','-1 day')",
  "AND caller LIKE 'mally%'",
  "AND cost_usd IS NOT NULL;",
].join(' ')

/**
 * Query harness.db for total spend in the last 24 h for the given tenant.
 * Uses execFileSync to avoid needing a native Node sqlite3 binding.
 * Returns null on any error so the caller can degrade gracefully.
 */
export function getDailySpendUSD(tenant: string): number | null {
  try {
    if (!fs.existsSync(HARNESS_DB)) {
      console.warn('[budget] harness.db not found at', HARNESS_DB)
      return null
    }
    const query = tenant === 'mally' ? SPEND_QUERY_MALLY : SPEND_QUERY_HENRY
    const out = execFileSync(
      'sqlite3',
      ['-separator', ',', HARNESS_DB, query],
      { encoding: 'utf8', timeout: 5000 },
    ).trim()
    const n = parseFloat(out)
    return Number.isFinite(n) ? n : 0
  } catch (err) {
    console.warn('[budget] getDailySpendUSD error:', err)
    return null
  }
}

// ── Cache ────────────────────────────────────────────────────────────────────

type CacheEntry = { status: BudgetStatus; expiresAt: number }
const CACHE = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 30_000

export function checkBudget(tenant: string): BudgetStatus {
  const now = Date.now()
  const cached = CACHE.get(tenant)
  if (cached && cached.expiresAt > now) return cached.status

  try {
    const cap = getDailyCapUSD(tenant)
    if (cap === null) {
      // No cap configured — always allow
      const status: BudgetStatus = { withinCap: true, spent: 0, cap: null }
      CACHE.set(tenant, { status, expiresAt: now + CACHE_TTL_MS })
      return status
    }
    const spentRaw = getDailySpendUSD(tenant)
    const spent = spentRaw ?? 0
    // Degrade to allow on null (DB unreachable)
    const withinCap = spentRaw === null || spent < cap
    const status: BudgetStatus = { withinCap, spent, cap }
    CACHE.set(tenant, { status, expiresAt: now + CACHE_TTL_MS })
    return status
  } catch (err) {
    console.error('[budget] checkBudget unexpected error — allowing request:', err)
    return { withinCap: true, spent: 0, cap: null }
  }
}

/** Bust the cache for a tenant (used after smoke tests that modify the cap). */
export function bustBudgetCache(tenant: string): void {
  CACHE.delete(tenant)
}
