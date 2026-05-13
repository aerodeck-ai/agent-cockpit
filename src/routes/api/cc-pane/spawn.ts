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
 */
import { createFileRoute } from '@tanstack/react-router'
import { requireLocalOrAuth } from '../../../server/auth-middleware'
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

function getCliProxyDir(): string {
  return (
    process.env.CLI_PROXY_API_DIR ??
    path.join(os.homedir(), '.cli-proxy-api')
  )
}

function readAuthToken(accountKey: string | undefined): string | undefined {
  const partition = accountKey ?? 'default'
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

        const body = (await request.json().catch(() => ({}))) as Record<
          string,
          unknown
        >

        const workdir =
          typeof body.workdir === 'string' && body.workdir.trim()
            ? body.workdir.trim()
            : os.homedir()
        const accountKey =
          typeof body.accountKey === 'string' && body.accountKey.trim()
            ? body.accountKey.trim()
            : undefined
        const longContext = body.longContext === true

        const authToken = readAuthToken(accountKey)

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

        return new Response(
          JSON.stringify({ ok: true, sessionId: session.id }),
          { headers: { 'Content-Type': 'application/json' } },
        )
      },
    },
  },
})
