/**
 * GET  /api/models/profiles  — current per-profile model assignments
 * POST /api/models/profiles  — write model assignment (Henry only; 403 for Mally)
 *
 * POST body: { profile: string; model: string }
 *
 * On write:
 *  1. Backup config.yaml → config.yaml.bak-pre-model-change-<ts>
 *  2. Update model.default in config.yaml
 *  3. Restart hermes-gateway-<profile> via systemctl --user
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import YAML from 'yaml'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { getProfilesDir } from '../../../server/claude-paths'
import { requireJsonContentType } from '../../../server/rate-limit'
import { resolveTenantFromRequest } from '../../../lib/auth/tenants'

const execFileAsync = promisify(execFile)

export type ProfileModelEntry = {
  profile: string
  model: string | null
  provider: string | null
  cost_cap_usd_daily: number | null
}

function readProfileModel(profileName: string): ProfileModelEntry {
  const configPath = path.join(getProfilesDir(), profileName, 'config.yaml')
  try {
    if (!fs.existsSync(configPath)) {
      return { profile: profileName, model: null, provider: null, cost_cap_usd_daily: null }
    }
    const raw = fs.readFileSync(configPath, 'utf-8')
    const parsed = YAML.parse(raw) as Record<string, unknown>
    let model: string | null = null
    let provider: string | null = null
    const modelField = parsed?.model
    if (typeof modelField === 'string') {
      model = modelField
    } else if (modelField && typeof modelField === 'object') {
      const mObj = modelField as Record<string, unknown>
      model = typeof mObj.default === 'string' ? mObj.default : null
      provider = typeof mObj.provider === 'string' ? mObj.provider : null
    }
    const agentField = parsed?.agent as Record<string, unknown> | undefined
    const cap = agentField?.cost_cap_usd_daily
    const cost_cap_usd_daily = typeof cap === 'number' ? cap : null
    return { profile: profileName, model, provider, cost_cap_usd_daily }
  } catch {
    return { profile: profileName, model: null, provider: null, cost_cap_usd_daily: null }
  }
}

function writeProfileModel(profileName: string, newModel: string): void {
  const profileDir = path.join(getProfilesDir(), profileName)
  const configPath = path.join(profileDir, 'config.yaml')
  if (!fs.existsSync(configPath)) {
    throw new Error(`Profile config not found: ${profileName}`)
  }
  // Backup first
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const backupPath = `${configPath}.bak-pre-model-change-${ts}`
  fs.copyFileSync(configPath, backupPath)

  // Parse + mutate
  const raw = fs.readFileSync(configPath, 'utf-8')
  const parsed = YAML.parse(raw) as Record<string, unknown>

  const modelField = parsed?.model
  if (!parsed.model || typeof parsed.model === 'string') {
    // Simple string or missing — write as object
    parsed.model = { default: newModel }
  } else if (typeof modelField === 'object' && modelField !== null) {
    (parsed.model as Record<string, unknown>).default = newModel
  } else {
    parsed.model = { default: newModel }
  }

  fs.writeFileSync(configPath, YAML.stringify(parsed), 'utf-8')
}

async function restartProfileGateway(profileName: string): Promise<{ ok: boolean; output: string }> {
  const serviceName = `hermes-gateway-${profileName}`
  try {
    // Try systemctl --user first
    const { stdout, stderr } = await execFileAsync(
      'systemctl',
      ['--user', 'restart', serviceName],
      { timeout: 10_000 },
    )
    return { ok: true, output: stdout + stderr }
  } catch (err) {
    // Non-fatal — service may not exist or not be user-managed
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, output: msg }
  }
}

export const Route = createFileRoute('/api/models/profiles')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const profilesDir = getProfilesDir()
          const entries = fs.readdirSync(profilesDir, { withFileTypes: true })
          const profiles = entries
            .filter((e) => e.isDirectory())
            .map((e) => readProfileModel(e.name))
          return json({ ok: true, profiles })
        } catch (err) {
          return json(
            { error: err instanceof Error ? err.message : String(err) },
            { status: 500 },
          )
        }
      },

      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        // Mally cannot write — server-side enforcement
        const tenant = resolveTenantFromRequest(request)
        if (tenant?.tenant !== 'henry_cos') {
          return json({ error: 'Forbidden: profile model writes require henry_cos role' }, { status: 403 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        const body = (await request.json()) as { profile?: string; model?: string }
        if (!body.profile || typeof body.profile !== 'string') {
          return json({ error: 'profile is required' }, { status: 400 })
        }
        if (!body.model || typeof body.model !== 'string') {
          return json({ error: 'model is required' }, { status: 400 })
        }

        try {
          writeProfileModel(body.profile, body.model)
          const restart = await restartProfileGateway(body.profile)
          return json({
            ok: true,
            profile: body.profile,
            model: body.model,
            restart,
          })
        } catch (err) {
          return json(
            { error: err instanceof Error ? err.message : String(err) },
            { status: 500 },
          )
        }
      },
    },
  },
})
