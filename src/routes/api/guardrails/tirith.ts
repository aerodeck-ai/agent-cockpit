/**
 * /api/guardrails/tirith
 *
 * Read-only view of each profile's Tirith policy fields:
 *   security.tirith_enabled, security.tirith_fail_open, security.tirith_timeout
 *
 * Phase-3.12 flagged tirith_fail_open: true on multiple profiles as a risk:
 *   "Policy engine crash = bypass" — surfaced as a warning in the UI.
 *
 * GET → { profiles: TirithProfile[] }
 */

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import YAML from 'yaml'
import { isAuthenticatedWithCFAccess } from '../../../server/auth-middleware'
import { resolveTenantFromRequest } from '../../../lib/auth/tenants'

const HERMES_ROOT =
  process.env.HERMES_HOME ??
  process.env.CLAUDE_HOME ??
  join(homedir(), '.hermes')

const PROFILES_ROOT = join(HERMES_ROOT, 'profiles')

const MALLY_VISIBLE_PROFILES = new Set(['mally', 'mally-second'])

export interface TirithProfileData {
  name: string
  tirith_enabled: boolean | null
  tirith_fail_open: boolean | null
  tirith_timeout: number | null
  fail_open_risk: boolean
}

function getAccessibleProfiles(tenant: string): string[] {
  try {
    const entries = readdirSync(PROFILES_ROOT, { withFileTypes: true })
    const all = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
    if (tenant === 'henry_cos') return all
    return all.filter((n) => MALLY_VISIBLE_PROFILES.has(n))
  } catch {
    return []
  }
}

function readTirithData(profileName: string): TirithProfileData {
  const configPath = join(PROFILES_ROOT, profileName, 'config.yaml')
  if (!existsSync(configPath)) {
    return {
      name: profileName,
      tirith_enabled: null,
      tirith_fail_open: null,
      tirith_timeout: null,
      fail_open_risk: false,
    }
  }
  try {
    const raw = readFileSync(configPath, 'utf-8')
    const config = YAML.parse(raw) as Record<string, unknown>
    const security = config?.security as Record<string, unknown> | undefined

    const tirith_enabled = security?.tirith_enabled != null
      ? Boolean(security.tirith_enabled)
      : null
    const tirith_fail_open = security?.tirith_fail_open != null
      ? Boolean(security.tirith_fail_open)
      : null
    const tirith_timeout =
      typeof security?.tirith_timeout === 'number' ? security.tirith_timeout : null

    return {
      name: profileName,
      tirith_enabled,
      tirith_fail_open,
      tirith_timeout,
      // Risk flag: enabled + fail_open = crash becomes bypass
      fail_open_risk: tirith_enabled === true && tirith_fail_open === true,
    }
  } catch {
    return {
      name: profileName,
      tirith_enabled: null,
      tirith_fail_open: null,
      tirith_timeout: null,
      fail_open_risk: false,
    }
  }
}

export const Route = createFileRoute('/api/guardrails/tirith')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticatedWithCFAccess(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        const tenantInfo = resolveTenantFromRequest(request)
        if (!tenantInfo) {
          return json({ error: 'Forbidden — no tenant resolved' }, { status: 403 })
        }

        const profileNames = getAccessibleProfiles(tenantInfo.tenant)
        const profiles = profileNames.map(readTirithData)
        const riskCount = profiles.filter((p) => p.fail_open_risk).length

        return json({
          profiles,
          risk_summary: {
            fail_open_count: riskCount,
            has_risk: riskCount > 0,
          },
        })
      },
    },
  },
})
