/**
 * POST /api/cc-pane/spawn
 *
 * Spawns a Claude Code terminal session for a cockpit pane.
 * Body: { paneId: string, workdir?: string, accountKey?: string, longContext?: boolean }
 *
 * Returns: { ok: true, sessionId: string }
 *
 * Long-context: when longContext=true, adds ANTHROPIC_BETA=context-1m-2025-08-07 to the env.
 * (Requires billing tier — UI warns the user before enabling.)
 *
 * Multi-tenancy (F2):
 * - Reads `cf-access-authenticated-user-email` from request headers
 * - Resolves to tenant via resolveTenantFromEmail
 * - Maps tenant → cliproxy partition:
 *     henry_cos → henry-personal (default)
 *     mally     → mally
 * - If tenant is mally but ~/.cli-proxy-api/mally/ doesn't exist yet, returns 503
 * - Logs every spawn to ~/.claude/logs/cc-pane-spawn.jsonl
 */
import { createFileRoute } from '@tanstack/react-router'
import { requireLocalOrAuth, getCFAccessEmail } from '../../../server/auth-middleware'
import { resolveTenantFromEmail } from '../../../lib/auth/tenants'
import { createTerminalSession } from '../../../server/terminal-sessions'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  requireJsonContentType,
} from '../../../server/rate-limit'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// ─── Tenant → partition mapping ────────────────────────────────────────────

const TENANT_PARTITION: Record<string, string> = {
  henry_cos: 'henry-personal',
  mally: 'mally',
}

/** Default partition for local / unauthenticated-via-CF requests. */
const DEFAULT_PARTITION = 'henry-personal'

function resolvePartition(request: Request): {
  partition: string
  tenant: string
  error?: string
  status?: number
} {
  const email = getCFAccessEmail(request)
  if (!email) {
    // No CF Access header → local dev or password-auth session → default partition.
    return { partition: DEFAULT_PARTITION, tenant: 'henry_cos' }
  }

  const tenantInfo = resolveTenantFromEmail(email)
  if (!tenantInfo) {
    return {
      partition: DEFAULT_PARTITION,
      tenant: 'unknown',
      error: `Email ${email} not in tenant allowlist`,
      status: 403,
    }
  }

  const partition = TENANT_PARTITION[tenantInfo.tenant] ?? DEFAULT_PARTITION

  // Guard: if mally partition directory doesn't exist yet, F1 hasn't run.
  if (tenantInfo.tenant === 'mally') {
    const cliProxyDir = getCliProxyDir()
    const mallyDir = path.join(cliProxyDir, 'mally')
    if (!fs.existsSync(mallyDir)) {
      return {
        partition,
        tenant: tenantInfo.tenant,
        error:
          'Mally partition not yet provisioned. Henry must complete F1 OAuth login first.',
        status: 503,
      }
    }
  }

  return { partition, tenant: tenantInfo.tenant }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function getCliProxyDir(): string {
  return (
    process.env.CLI_PROXY_API_DIR ??
    path.join(os.homedir(), '.cli-proxy-api')
  )
}

function readAuthToken(partition: string): string | undefined {
  const tokenFile = path.join(getCliProxyDir(), partition, 'tokens.json')
  try {
    const raw = fs.readFileSync(tokenFile, 'utf-8')
    const data = JSON.parse(raw) as Record<string, unknown>
    if (typeof data.token === 'string') return data.token
    if (typeof data.anthropic_auth_token === 'string')
      return data.anthropic_auth_token
  } catch {
    // fall through — use process env
  }
  return undefined
}

// ─── Audit log ─────────────────────────────────────────────────────────────

const SPAWN_LOG_FILE = path.join(
  process.env.HOME ?? os.homedir(),
  '.claude',
  'logs',
  'cc-pane-spawn.jsonl',
)

function logSpawn(entry: {
  ts: string
  tenant: string
  partition: string
  paneId: string
  accountKey: string | undefined
  sessionId?: string
  error?: string
}): void {
  try {
    const dir = path.dirname(SPAWN_LOG_FILE)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    }
    fs.appendFileSync(SPAWN_LOG_FILE, JSON.stringify(entry) + '\n', {
      encoding: 'utf-8',
      mode: 0o600,
    })
  } catch {
    // Non-fatal — logging is best-effort.
  }
}

// ─── Route ─────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/api/cc-pane/spawn')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!requireLocalOrAuth(request)) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Unauthorized' }),
            { status: 401, headers: { 'Content-Type': 'application/json' } },
          )
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        const ip = getClientIp(request)
        if (!rateLimit(`cc-pane-spawn:${ip}`, 20, 60_000)) {
          return rateLimitResponse()
        }

        // ── Tenant resolution ──────────────────────────────────────────────
        const tenantResolution = resolvePartition(request)
        if (tenantResolution.error && tenantResolution.status) {
          return new Response(
            JSON.stringify({ ok: false, error: tenantResolution.error }),
            {
              status: tenantResolution.status,
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }

        const { partition, tenant } = tenantResolution

        const body = (await request.json().catch(() => ({}))) as Record<
          string,
          unknown
        >

        const paneId =
          typeof body.paneId === 'string' && body.paneId.trim()
            ? body.paneId.trim()
            : `pane-${Date.now()}`
        const workdir =
          typeof body.workdir === 'string' && body.workdir.trim()
            ? body.workdir.trim()
            : os.homedir()
        // accountKey in the request body is honoured if provided, but
        // overridden by the tenant partition resolved from CF Access email
        // so that a Mally session cannot use Henry's partition.
        const requestedAccountKey =
          typeof body.accountKey === 'string' && body.accountKey.trim()
            ? body.accountKey.trim()
            : undefined
        // Use the tenant-resolved partition as accountKey for token lookup.
        const accountKey = requestedAccountKey ?? partition
        const longContext = body.longContext === true

        const authToken = readAuthToken(partition)

        const extraEnv: Record<string, string> = {}
        if (authToken) {
          extraEnv.ANTHROPIC_AUTH_TOKEN = authToken
        }
        if (longContext) {
          extraEnv.ANTHROPIC_BETA = 'context-1m-2025-08-07'
        }

        const session = createTerminalSession({
          command: ['claude'],
          cwd: workdir,
          env: extraEnv,
          cols: 220,
          rows: 50,
        })

        // ── Audit log ──────────────────────────────────────────────────────
        logSpawn({
          ts: new Date().toISOString(),
          tenant,
          partition,
          paneId,
          accountKey,
          sessionId: session.id,
        })

        return new Response(
          JSON.stringify({ ok: true, sessionId: session.id }),
          { headers: { 'Content-Type': 'application/json' } },
        )
      },
    },
  },
})
