/**
 * /api/guardrails/scope-deny
 *
 * GET  → { profiles: { [profileName]: string[] } }
 *         henry_cos sees ALL profiles; mally sees only 'mally' and 'mally-second'.
 *
 * POST → { profile: string, keywords: string[] }
 *         henry_cos only. Backs up config.yaml before writing. Restarts the
 *         profile's hermes-gateway-<profile> systemd user unit.
 *
 * Phase-3 risk: tirith_fail_open=true on several profiles — see /api/guardrails/tirith.
 */

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import YAML from 'yaml'
import { isAuthenticatedWithCFAccess } from '../../../server/auth-middleware'
import { resolveTenantFromRequest } from '../../../lib/auth/tenants'
import { requireJsonContentType } from '../../../server/rate-limit'

const HERMES_ROOT =
  process.env.HERMES_HOME ??
  process.env.CLAUDE_HOME ??
  join(homedir(), '.hermes')

const PROFILES_ROOT = join(HERMES_ROOT, 'profiles')

/** Profiles accessible for mally (read-only) */
const MALLY_VISIBLE_PROFILES = new Set(['mally', 'mally-second'])

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

function readScopeDenyKeywords(profileName: string): string[] {
  const configPath = join(PROFILES_ROOT, profileName, 'config.yaml')
  if (!existsSync(configPath)) return []
  try {
    const raw = readFileSync(configPath, 'utf-8')
    const config = YAML.parse(raw) as Record<string, unknown>
    const keywords = (config?.platforms as Record<string, unknown>)
      ?.api_server as Record<string, unknown>
    const extra = keywords?.extra as Record<string, unknown>
    const kws = extra?.scope_deny_keywords
    if (Array.isArray(kws)) return kws.map(String)
    return []
  } catch {
    return []
  }
}

function writeScopeDenyKeywords(profileName: string, keywords: string[]): void {
  const configPath = join(PROFILES_ROOT, profileName, 'config.yaml')
  if (!existsSync(configPath)) {
    throw new Error(`Profile config not found: ${profileName}`)
  }

  // Backup before write
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = `${configPath}.bak-pre-scope-edit-${ts}`
  copyFileSync(configPath, backupPath)

  const raw = readFileSync(configPath, 'utf-8')
  const config = YAML.parse(raw) as Record<string, unknown>

  // Ensure nested path exists
  if (!config.platforms) config.platforms = {}
  const platforms = config.platforms as Record<string, unknown>
  if (!platforms.api_server) platforms.api_server = {}
  const apiServer = platforms.api_server as Record<string, unknown>
  if (!apiServer.extra) apiServer.extra = {}
  const extra = apiServer.extra as Record<string, unknown>

  extra.scope_deny_keywords = keywords

  writeFileSync(configPath, YAML.stringify(config), 'utf-8')
}

function restartGateway(profileName: string): Promise<{ ok: boolean; msg: string }> {
  return new Promise((resolve) => {
    const unit = `hermes-gateway-${profileName}`
    execFile(
      'systemctl',
      ['--user', 'restart', unit],
      { timeout: 10_000 },
      (err, _stdout, stderr) => {
        if (err) {
          resolve({ ok: false, msg: stderr.trim() || err.message })
        } else {
          resolve({ ok: true, msg: `Restarted ${unit}` })
        }
      },
    )
  })
}

export const Route = createFileRoute('/api/guardrails/scope-deny')({
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

        const profiles = getAccessibleProfiles(tenantInfo.tenant)
        const result: Record<string, string[]> = {}
        for (const p of profiles) {
          result[p] = readScopeDenyKeywords(p)
        }

        return json({ profiles: result, tenant: tenantInfo.tenant })
      },

      POST: async ({ request }) => {
        if (!isAuthenticatedWithCFAccess(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        const tenantInfo = resolveTenantFromRequest(request)
        if (!tenantInfo) {
          return json({ error: 'Forbidden — no tenant resolved' }, { status: 403 })
        }
        // Hard gate: only henry_cos may write
        if (tenantInfo.tenant !== 'henry_cos') {
          return json({ error: 'Forbidden — read-only access for this tenant' }, { status: 403 })
        }

        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        let body: { profile?: string; keywords?: unknown }
        try {
          body = (await request.json()) as { profile?: string; keywords?: unknown }
        } catch {
          return json({ error: 'Invalid JSON body' }, { status: 400 })
        }

        if (!body.profile || typeof body.profile !== 'string') {
          return json({ error: 'profile is required' }, { status: 400 })
        }
        if (!Array.isArray(body.keywords)) {
          return json({ error: 'keywords must be an array' }, { status: 400 })
        }

        const keywords = body.keywords.map(String).filter((k) => k.trim().length > 0)

        // Verify the profile exists and is accessible
        const accessible = getAccessibleProfiles('henry_cos')
        if (!accessible.includes(body.profile)) {
          return json({ error: 'Profile not found' }, { status: 404 })
        }

        try {
          writeScopeDenyKeywords(body.profile, keywords)
        } catch (err) {
          return json(
            { error: err instanceof Error ? err.message : 'Write failed' },
            { status: 500 },
          )
        }

        const restart = await restartGateway(body.profile)
        return json({ ok: true, profile: body.profile, keywords, restart })
      },
    },
  },
})
